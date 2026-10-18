import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Wallet } from 'ethers';
import { CIRCLE_CLI_TIMEOUT_MS, EVIDENCE_BUDGET_ATOMIC, EXA_SEARCH_COST_ATOMIC, circleChildEnvironment, hardChecks, hasCompanyDomain, normalizeCompanyDomain, normalizeExaEvidence, reserveUniqueCompanyDomain, runCircle, submissionMessage, validateJudgment, verifyProviderSubmission } from '../server/agentic.js';

const provider = Wallet.createRandom();
const job = { id: 'agentic-check-01', providerWallet: provider.address, status: 'open' };
const company = 'Example Research Co', domain = 'example-research.co', nonce = 'unique1234';
const signature = await provider.signMessage(submissionMessage(job.id, company, domain, nonce));
const input = { providerAddress: provider.address, nonce, signature };
assert.equal(verifyProviderSubmission(job, input, company, domain), true);
assert.equal(verifyProviderSubmission(job, input, company, 'other.co'), false);
assert.equal(verifyProviderSubmission({ ...job, id: 'wrong-job' }, input, company, domain), false);
assert.equal(verifyProviderSubmission(job, { ...input, providerAddress: Wallet.createRandom().address }, company, domain), false);

const row = { version: 2, company, domain, providerVerified: true };
assert.equal(hardChecks(row, [row], job).eligible, true);
assert.equal(hardChecks(row, [row, { domain }], job).eligible, false);
assert.equal(hardChecks({ ...row, domain: 'invalid' }, [row], job).eligible, false);
for (const domain of ['127.0.0.1', 'localhost', 'service.internal', 'madeup.example', 'not-real.test', 'company.invalid']) {
  assert.equal(hardChecks({ ...row, domain }, [{ ...row, domain }], job).eligible, false, `${domain} must not pass as a public company domain`);
}
for (const domain of ['example.com', 'docs.example.com', 'example.net', 'example.org']) {
  assert.equal(hardChecks({ ...row, domain }, [{ ...row, domain }], job).eligible, false, `${domain} is a reserved documentation domain`);
}
assert.equal(hardChecks({ ...row, providerVerified: false }, [row], job).eligible, false);
assert.equal(hardChecks({ ...row, domain: 'Example-Research.co' }, [row, { domain: 'example-research.co' }], job).eligible, false, 'domain duplicates are case-insensitive');
assert.equal(normalizeCompanyDomain('WWW.Example-Research.co.'), 'example-research.co');
assert.equal(hardChecks(row, [row, { domain: 'www.example-research.co' }], job).eligible, false, 'www and apex submissions must not bypass duplicate prevention');
assert.equal(hasCompanyDomain([{ domain: 'www.example-research.co' }], 'example-research.co'), true);
const concurrentReservations = [];
const reservationResults = await Promise.all([
  Promise.resolve().then(() => reserveUniqueCompanyDomain(concurrentReservations, { domain: 'example-research.co' })),
  Promise.resolve().then(() => reserveUniqueCompanyDomain(concurrentReservations, { domain: 'www.example-research.co' })),
]);
assert.equal(reservationResults.filter(Boolean).length, 1, 'duplicate result aliases may only be reserved once across async submissions');

const evidence = normalizeExaEvidence({ results: [{ url: 'https://example-research.co/about', title: 'About', text: 'B2B company.' }] }, { amount: '0.007', chain: 'ARC', seller: '0x123', receipt: { paymentId: 'example-proof' } });
assert.equal(evidence.sources.length, 1);
assert.equal(evidence.x402.amount, '0.007');
assert.throws(() => normalizeExaEvidence({ results: [{ url: 'http://insecure.co' }] }, { amount: '0.007', receipt: {} }));
assert.throws(() => normalizeExaEvidence({ results: [{ url: 'https://example-research.co/about', title: 'About' }] }, { amount: '0.007', receipt: {} }));
const source = evidence.sources[0].url;
const accepted = validateJudgment({ decision: 'ACCEPT', confidence: 0.9, evidence: [{ claim: 'B2B', source, supports: true }], reason: 'First-party site supports it.' }, evidence);
assert.equal(accepted.decision, 'ACCEPT');
assert.equal(validateJudgment({ ...accepted, confidence: 0.5 }, evidence).decision, 'ESCALATE');
assert.throws(() => validateJudgment({ ...accepted, confidence: Number.NaN }, evidence), /schema validation/);
assert.throws(() => validateJudgment({ ...accepted, confidence: Number.POSITIVE_INFINITY }, evidence), /schema validation/);
assert.throws(() => validateJudgment({ ...accepted, evidence: [{ claim: ' ', source, supports: true }] }, evidence), /malformed claim/);
assert.throws(() => validateJudgment({ ...accepted, evidence: [] }, evidence), /schema validation/);
assert.throws(() => validateJudgment({ ...accepted, evidence: [{ claim: 'B2B', source: 'https://unverified.co', supports: true }] }, evidence));
assert.equal(EXA_SEARCH_COST_ATOMIC, 7000);
assert.equal(EVIDENCE_BUDGET_ATOMIC, 100000);
assert.equal(CIRCLE_CLI_TIMEOUT_MS, 60_000);
const filteredEnvironment = circleChildEnvironment({ PATH: 'C:\\Windows', USERPROFILE: 'C:\\Users\\builder', APPDATA: 'C:\\Users\\builder\\AppData', GROQ_API_KEY: 'must-not-leak', ARC_TESTNET_PRIVATE_KEY: 'must-not-leak', CIRCLE_ACCESS_TOKEN: 'must-not-leak' });
assert.deepEqual(filteredEnvironment, { PATH: 'C:\\Windows', USERPROFILE: 'C:\\Users\\builder', APPDATA: 'C:\\Users\\builder\\AppData' }, 'Circle CLI receives only runtime paths, not app credentials');
let circleSpawnOptions;
const fakeCircleChild = new EventEmitter();
fakeCircleChild.stdout = new EventEmitter();
fakeCircleChild.stderr = new EventEmitter();
fakeCircleChild.kill = () => queueMicrotask(() => fakeCircleChild.emit('close', null, 'SIGTERM'));
await assert.rejects(runCircle(['wallet', 'status'], {
  timeoutMs: 5,
  environment: { PATH: 'C:\\Windows', GROQ_API_KEY: 'must-not-leak' },
  spawnChild: (_executable, _args, options) => { circleSpawnOptions = options; return fakeCircleChild; },
}), /timed out/);
assert.deepEqual(circleSpawnOptions.env, { PATH: 'C:\\Windows' });
console.log('Agentic checks passed: signatures, reserved/duplicate domains, evidence/judgment guards, Circle credential isolation, and CLI timeout.');
