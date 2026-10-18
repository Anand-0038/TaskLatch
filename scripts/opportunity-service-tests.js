import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Interface, Wallet, keccak256 } from 'ethers';
import { createOpportunityService, OPPORTUNITY_RUN_ID } from '../server/opportunity-service.js';
import { handleOpportunityRoute } from '../server/opportunity-api.js';
import { ARC_TESTNET_CHAIN_ID, ARC_TESTNET_USDC, jobIdBytes32, resultIdBytes32 } from '../shared/evidence.js';

const rootDir = await mkdtemp(join(tmpdir(), 'proofpay-opportunity-'));
const buyer = Wallet.createRandom(), provider = Wallet.createRandom(), agentAddress = Wallet.createRandom().address;
const escrowAddress = Wallet.createRandom().address;
const env = { PROOFPAY_ESCROW_ADDRESS: escrowAddress, ARC_USDC_ADDRESS: ARC_TESTNET_USDC, PROOFPAY_PROVIDER_ADDRESS: provider.address, PROOFPAY_AGENT_ADDRESS: agentAddress };
const event = new Interface(['event ResultResolved(bytes32 indexed jobId,bytes32 indexed resultId,bool accepted,bytes32 evidenceHash,uint256 amount)']);
let fetches = 0, broadcasts = 0, balanceReads = 0, receipt = null;
const funded = { exists: true, buyer: buyer.address, provider: provider.address, agent: agentAddress, unitPrice: 100000n, maxUnits: 10n, accepted: 0n, expiresAt: BigInt(Math.floor(Date.now() / 1000) + 86400) };
const chain = {
  buyer,
  provider,
  agent: { address: agentAddress, populateTransaction: async request => request, signTransaction: async () => '0x1234' },
  rpc: {
    getNetwork: async () => ({ chainId: ARC_TESTNET_CHAIN_ID }),
    getBlock: async () => ({ timestamp: Math.floor(Date.now() / 1000) }),
    getTransactionCount: async () => 1,
    broadcastTransaction: async signed => {
      broadcasts++;
      const state = JSON.parse(await readFile(join(rootDir, 'data', 'operator-opportunities-20260927', 'run.json'), 'utf8'));
      const accepted = state.results.find(result => result.decision === 'ACCEPT');
      const log = event.encodeEventLog('ResultResolved', [jobIdBytes32(OPPORTUNITY_RUN_ID), resultIdBytes32(accepted.id), true, accepted.receiptHash, 100000n]);
      receipt = { status: 1, to: escrowAddress, from: agentAddress, blockNumber: 42, hash: keccak256(signed), logs: [{ address: escrowAddress, ...log }] };
      return { hash: receipt.hash };
    },
    getTransactionReceipt: async () => receipt,
  },
  escrow: {
    usdc: async () => ARC_TESTNET_USDC,
    jobs: async () => funded,
    resolved: async () => false,
    connect: () => ({ resolve: { populateTransaction: async () => ({ to: escrowAddress }) } }),
  },
  token: { balanceOf: async () => { balanceReads++; return balanceReads === 1 ? 1_000_000n : 1_100_000n; } },
};
const pages = {
  'https://www.ziroh.com/hackathon': '₹7,50,000 prize pool. The entry project submission link will be open till 16th October, 2026. Deadline: 16th October, 2026. A national-level AI Challenge for students and working professionals in India. Build AI Applications.',
  'https://ethglobal.com/events/ethonline2026': 'ETHOnline 2026 September 4–16, 2026.',
  'https://algorand.co/global-x402-challenge': '100K USD prize pool. Must submit by September 30.',
  'https://luma.com/building-on-x402': 'Registration closes to new entrants at 11:45 pm ET on 1 September.',
};
const fetchPage = async url => { fetches++; return { ok: true, status: 200, text: async () => pages[url] }; };
let judgments = 0;
const judgeCandidate = async (item, evidence) => { judgments++; return { decision: 'ACCEPT', confidence: 0.95, evidence: [{ claim: 'Official source supports the candidate', source: evidence.sources[0].url, supports: true }], reason: `Official evidence reviewed for ${item.title}.` }; };
const options = { rootDir, env, chain, fetchPage, judgeCandidate, clock: () => new Date('2026-09-27T09:00:00Z'), logger: { log() {} } };
const service = createOpportunityService(options);
async function signed(candidate, signer = provider) {
  const nonce = 'testnonce12345678';
  const message = `ProofPay opportunity\njob=${OPPORTUNITY_RUN_ID}\nresult=${candidate.id}\nurl=${candidate.url}\nnonce=${nonce}`;
  return { ...candidate, nonce, signature: await signer.signMessage(message) };
}

try {
  const [valid, expired, algorandCandidate] = service.submissions;
  await assert.rejects(service.submitResult(await signed(valid, Wallet.createRandom())), /Provider identity/);
  assert.equal(fetches, 0, 'invalid signature must fail before evidence retrieval');
  const apiBase = `/api/v1/jobs/${OPPORTUNITY_RUN_ID}`;
  const malformedSignature = { ...await signed(valid), signature: `0x${'00'.repeat(65)}` };
  const malformedSignatureResponse = await handleOpportunityRoute('POST', `${apiBase}/results`, malformedSignature, service);
  assert.equal(malformedSignatureResponse.status, 400, 'a well-shaped but cryptographically invalid signature is a client error, not an infrastructure failure');
  assert.equal(fetches, 0, 'invalid cryptographic signatures must fail before source retrieval');
  const projectionDir = await mkdtemp(join(tmpdir(), 'proofpay-stale-projection-'));
  try {
    await mkdir(join(projectionDir, 'public', 'operator-run.json'), { recursive: true });
    const projectionService = createOpportunityService({ ...options, rootDir: projectionDir });
    const savedDespiteProjectionFailure = await projectionService.submitResult(await signed(valid));
    assert.equal(savedDespiteProjectionFailure.id, valid.id, 'a static projection failure must not turn the canonical submission into a 503');
    assert.equal((await projectionService.getReceipt(valid.id)).decision, 'ACCEPT', 'canonical receipt remains available from the private ledger');
  } finally { await rm(projectionDir, { recursive: true, force: true }); }
  const fetchesBeforeValid = fetches;
  const viaApi = await handleOpportunityRoute('POST', `${apiBase}/results`, await signed(valid), service);
  assert.equal(viaApi.status, 201);
  assert.equal(viaApi.body.data.decision, 'ACCEPT');
  assert.equal(viaApi.body.data.payment.txHash, null, 'evaluation alone must not pay');
  const sanitizedFailure = await handleOpportunityRoute('POST', `${apiBase}/results`, {}, { submitResult: async () => { throw Error('RPC failed at https://rpc.invalid/?api-key=secret'); } });
  assert.equal(sanitizedFailure.status, 503);
  assert.equal(sanitizedFailure.body.error.includes('secret'), false, 'internal RPC credentials must not reach API responses');
  await assert.rejects(service.submitResult(await signed(valid)), /already submitted/);
  assert.equal(fetches, fetchesBeforeValid + 1, 'duplicate must fail before evidence retrieval');
  const judgmentsBeforeHardFailures = judgments;
  const expiredResult = await service.submitResult(await signed(expired));
  assert.equal(expiredResult.decision, 'REJECT');
  assert.equal(expiredResult.aiJudgment.status, 'SKIPPED', 'expired hard failure should record that AI was not invoked');
  const algorand = await service.submitResult(await signed(algorandCandidate));
  assert.equal(algorand.decision, 'REJECT', 'closed new-entrant registration is a hard failure despite the later submission deadline');
  assert.match(algorand.reason, /closed new-entrant registration/i);
  assert.equal(algorand.hardChecks.status, 'REJECT');
  assert.equal(algorand.aiJudgment.status, 'SKIPPED');
  assert.equal(judgments, judgmentsBeforeHardFailures, 'a hard failure must not invoke the judgment provider');
  assert.equal((await service.getResults()).length, 3);
  assert.equal((await service.getResult(valid.id)).pageText, undefined, 'API view must omit raw source text');
  assert.equal((await service.getResult(valid.id)).signature, undefined, 'API view must omit provider signature');
  const savedBefore = await service.getReceipt(valid.id);
  assert.deepEqual((await handleOpportunityRoute('GET', `${apiBase}/results/${valid.id}/receipt`, null, service)).body.data, savedBefore, 'API must expose the canonical stored receipt');
  const restarted = createOpportunityService(options);
  assert.deepEqual(await restarted.getReceipt(valid.id), savedBefore, 'receipt must survive restart');
  assert.equal((await restarted.getJob()).unitPrice, '0.10');

  funded.accepted = 10n;
  await assert.rejects(service.settle(), /terms\/cap\/expiry/);
  assert.equal(broadcasts, 0);
  funded.accepted = 0n;
  funded.expiresAt = 1n;
  await assert.rejects(service.settle(), /terms\/cap\/expiry/);
  assert.equal(broadcasts, 0);
  funded.expiresAt = BigInt(Math.floor(Date.now() / 1000) + 86400);
  funded.buyer = Wallet.createRandom().address;
  await assert.rejects(service.settle(), /terms\/cap\/expiry/);
  assert.equal(broadcasts, 0, 'a job funded by an unexpected buyer cannot settle');
  funded.buyer = buyer.address;
  funded.provider = Wallet.createRandom().address;
  await assert.rejects(service.settle(), /terms\/cap\/expiry/);
  assert.equal(broadcasts, 0);
  funded.provider = provider.address;
  await service.settle();
  assert.equal(broadcasts, 1);
  const after = await restarted.getReceipt(valid.id);
  assert.equal(after.payment.status, 'CONFIRMED ARC TESTNET USDC');
  assert.equal(after.payment.amount, '0.10');
  assert.equal(after.payment.txHash, receipt.hash);
  assert.equal((await restarted.getReceipt(expired.id)).payment.txHash, null);
  assert.equal((await restarted.getReceipt(algorandCandidate.id)).payment.txHash, null);
  await assert.rejects(service.settle(), /already recorded/);
  assert.equal(broadcasts, 1, 'replay must not broadcast again');
  const persisted = JSON.parse(await readFile(join(rootDir, 'data', 'operator-opportunities-20260927', 'run.json'), 'utf8'));
  assert.equal(persisted.results.find(result => result.id === valid.id).payment.txHash, after.payment.txHash);

  const recoveryDir = await mkdtemp(join(tmpdir(), 'proofpay-partial-run-'));
  try {
    const beforeRecoveryFetches = fetches;
    const recovery = createOpportunityService({ ...options, rootDir: recoveryDir });
    await recovery.submitResult(await signed(valid));
    await recovery.evaluate();
    assert.equal((await recovery.getResults()).length, 3, 'rerunning evaluation resumes missing candidates without duplicating the saved candidate');
    assert.equal(fetches, beforeRecoveryFetches + 4, 'only the unsaved candidates and their official source pages are fetched again');
  } finally { await rm(recoveryDir, { recursive: true, force: true }); }

  const redirectDir = await mkdtemp(join(tmpdir(), 'proofpay-redirect-'));
  try {
    const redirecting = createOpportunityService({
      ...options,
      rootDir: redirectDir,
      fetchPage: async () => ({ ok: false, status: 302, headers: { get: name => name === 'location' ? 'https://attacker.invalid/private' : null } }),
    });
    await assert.rejects(redirecting.submitResult(await signed(valid)), /redirected outside the approved HTTPS source list/);
  } finally { await rm(redirectDir, { recursive: true, force: true }); }

  const invalidReceiptDir = await mkdtemp(join(tmpdir(), 'proofpay-invalid-receipt-'));
  const savedReceipt = receipt;
  try {
    const invalidReceiptService = createOpportunityService({ ...options, rootDir: invalidReceiptDir });
    const candidate = await invalidReceiptService.submitResult(await signed(valid));
    const invalidStatePath = join(invalidReceiptDir, 'data', 'operator-opportunities-20260927', 'run.json');
    const invalidState = JSON.parse(await readFile(invalidStatePath, 'utf8'));
    invalidState.results[0].payment = { status: 'PENDING ARC TESTNET VERIFICATION', txHash: `0x${'33'.repeat(32)}`, balanceBefore: '0.0' };
    await (await import('node:fs/promises')).writeFile(invalidStatePath, JSON.stringify(invalidState, null, 2));
    receipt = { status: 1, to: escrowAddress, from: agentAddress, blockNumber: 99, hash: `0x${'33'.repeat(32)}`, logs: [] };
    await assert.rejects(invalidReceiptService.verify(), /did not match the decision receipt hash/);
    const manual = await invalidReceiptService.getReceipt(candidate.id);
    assert.equal(manual.payment.status, 'NEEDS MANUAL REVIEW', 'a confirmed but mismatched receipt must not remain labeled pending');
    assert.match(manual.payment.verificationMessage, /no retry was made/);
  } finally { receipt = savedReceipt; await rm(invalidReceiptDir, { recursive: true, force: true }); }

  const incompleteDir = await mkdtemp(join(tmpdir(), 'proofpay-incomplete-evidence-'));
  try {
    pages['https://luma.com/building-on-x402'] = 'The event offers prizes and project submissions are due September 30.';
    const incompleteService = createOpportunityService({ ...options, rootDir: incompleteDir });
    const incomplete = await incompleteService.submitResult(await signed(algorandCandidate));
    assert.equal(incomplete.decision, 'ESCALATE', 'missing entrant eligibility evidence should remain unresolved');
    assert.equal(incomplete.payment.amount, '0.00');
    assert.equal(incomplete.aiJudgment.status, 'SKIPPED', 'uncertain hard evidence should escalate without invoking the model');
  } finally {
    pages['https://luma.com/building-on-x402'] = 'Registration closes to new entrants at 11:45 pm ET on 1 September.';
    await rm(incompleteDir, { recursive: true, force: true });
  }
  async function evaluateDeadline(text, evaluatedAt) {
    const deadlineDir = await mkdtemp(join(tmpdir(), 'proofpay-deadline-'));
    try {
      const deadlineService = createOpportunityService({
        ...options,
        rootDir: deadlineDir,
        fetchPage: async url => ({ ok: true, status: 200, text: async () => url === valid.url ? text : pages[url] }),
        clock: () => new Date(evaluatedAt),
      });
      return await deadlineService.submitResult(await signed(valid));
    } finally {
      await rm(deadlineDir, { recursive: true, force: true });
    }
  }
  const currentDeadline = await evaluateDeadline('₹7,50,000 prize pool. Submission link open till 16th October, 2026. Deadline: 16th October, 2026. A national-level AI Challenge for students and working professionals in India. Build AI Applications.', '2026-10-05T09:00:00Z');
  assert.equal(currentDeadline.decision, 'ACCEPT', 'a deadline fetched from the official page must be evaluated dynamically');
  assert.ok(currentDeadline.hardChecks.citations.some(c => c.claim === 'Submission open until 16 October 2026'));
  const inclusiveDeadline = await evaluateDeadline('₹7,50,000 prize pool. Deadline: 16th October, 2026. A national-level AI Challenge for students and working professionals in India. Build AI Applications.', '2026-10-16T18:29:59.999Z');
  assert.equal(inclusiveDeadline.hardChecks.checks.find(c => c.label === 'Official deadline remains open').pass, true, 'deadline date is inclusive through 23:59:59.999 IST');
  const afterDeadline = await evaluateDeadline('₹7,50,000 prize pool. Deadline: 16th October, 2026. A national-level AI Challenge for students and working professionals in India. Build AI Applications.', '2026-10-16T18:30:00.000Z');
  assert.equal(afterDeadline.decision, 'REJECT', 'the deadline closes immediately after 23:59:59.999 IST');
  assert.equal(afterDeadline.payment.amount, '0.00');
  const expiredDeadline = await evaluateDeadline('₹7,50,000 prize pool. Deadline: 1st October, 2026. A national-level AI Challenge for students and working professionals in India. Build AI Applications.', '2026-10-05T09:00:00Z');
  assert.equal(expiredDeadline.decision, 'REJECT', 'expired hard deadline blocks a mocked AI ACCEPT');
  assert.equal(expiredDeadline.payment.amount, '0.00');
  const conflictingDeadline = await evaluateDeadline('₹7,50,000 prize pool. Submission link open till 16th October, 2026. Deadline: 15th October, 2026. A national-level AI Challenge for students and working professionals in India. Build AI Applications.', '2026-10-05T09:00:00Z');
  assert.equal(conflictingDeadline.decision, 'ESCALATE', 'different official deadline dates fail closed');
  assert.equal(conflictingDeadline.payment.amount, '0.00');
  const missingDeadline = await evaluateDeadline('₹7,50,000 prize pool. Applications are open. A national-level AI Challenge for students and working professionals in India. Build AI Applications.', '2026-10-05T09:00:00Z');
  assert.equal(missingDeadline.decision, 'ESCALATE', 'a vague open-status claim is not a verifiable deadline');
  assert.equal(missingDeadline.payment.amount, '0.00');
  const malformedDeadline = await evaluateDeadline('₹7,50,000 prize pool. Deadline: 31st February, 2026. A national-level AI Challenge for students and working professionals in India. Build AI Applications.', '2026-10-05T09:00:00Z');
  assert.equal(malformedDeadline.decision, 'ESCALATE', 'an impossible official deadline date fails closed');
  assert.equal(malformedDeadline.payment.amount, '0.00');
  console.log('Opportunity service: signatures, hard gates, duplicate, buyer/cap/expiry checks, restart, recovery, redirects, receipt verification, and mocked settlement passed; no Arc transaction was sent.');
} finally {
  await rm(rootDir, { recursive: true, force: true });
}
