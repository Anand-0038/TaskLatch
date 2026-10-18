import assert from 'node:assert/strict';
import { Wallet, ZeroAddress } from 'ethers';
import { canonicalizeAcceptancePolicy, hashAcceptancePolicy, signAcceptancePolicy, validateAcceptancePolicy, verifyAcceptancePolicy } from '../server/acceptance-policy.js';

const buyer = Wallet.createRandom();
const provider = Wallet.createRandom();
const other = Wallet.createRandom();
const policy = {
  schemaVersion: 1,
  policyId: 'pilot:research-001',
  version: 1,
  buyer: buyer.address,
  provider: provider.address,
  task: 'Find one active AI builder program with an official open deadline.',
  currency: 'USDC',
  chainId: 5042002,
  unitPriceAtomic: '100000',
  maxBudgetAtomic: '500000',
  deadline: '2026-10-10T18:29:00Z',
  evidenceRequirements: ['Official program URL', 'Prize and deadline source evidence'],
  hardRules: [{ id: 'deadline-open', verifier: 'TIME_WINDOW', description: 'Submission deadline must be in the future.' }],
  qualityRubric: ['Program is useful to the buyer and has a concrete application path.'],
  nonce: 'buyerpolicy1234567890',
  expiresAt: '2026-10-10T18:30:00Z',
};

const signed = await signAcceptancePolicy(policy, buyer);
assert.equal(verifyAcceptancePolicy({ policy, ...signed }).valid, true, 'buyer signature verifies');
assert.equal(verifyAcceptancePolicy({ policy, ...signed, providerSignature: await provider.signMessage(Buffer.from(signed.policyHash.slice(2), 'hex')) }).providerAcknowledged, true, 'provider acknowledgement verifies');
assert.equal(verifyAcceptancePolicy({ policy, ...signed, providerSignature: await other.signMessage(Buffer.from(signed.policyHash.slice(2), 'hex')) }).valid, false, 'wrong provider cannot acknowledge');
assert.equal(await (async () => {
  try { await signAcceptancePolicy(policy, provider); return false; } catch { return true; }
})(), true, 'non-buyer cannot sign policy');

const reordered = Object.fromEntries(Object.entries(policy).reverse());
assert.equal(canonicalizeAcceptancePolicy(reordered), canonicalizeAcceptancePolicy(policy), 'key order does not change canonical policy');
assert.equal(hashAcceptancePolicy(reordered), signed.policyHash, 'key order does not change policy hash');
assert.equal(verifyAcceptancePolicy({ policy: { ...policy, unitPriceAtomic: '200000' }, ...signed }).valid, false, 'mutating terms invalidates the signature');
assert.equal(verifyAcceptancePolicy({ policy, ...signed, policyHash: `0x${'00'.repeat(32)}` }).valid, false, 'mismatched hash is rejected');
assert.throws(() => validateAcceptancePolicy({ ...policy, maxBudgetAtomic: '1' }), /cover at least one result/);
assert.throws(() => validateAcceptancePolicy({ ...policy, buyer: policy.provider }), /distinct/);
assert.throws(() => validateAcceptancePolicy({ ...policy, buyer: ZeroAddress }), /zero address/);
assert.throws(() => validateAcceptancePolicy({ ...policy, deadline: '2026-02-31T12:00:00Z' }), /real UTC calendar timestamp/);
assert.throws(() => validateAcceptancePolicy({ ...policy, deadline: '2026-10-05T24:00:00Z' }), /real UTC calendar timestamp/);
assert.throws(() => validateAcceptancePolicy({ ...policy, hardRules: [{ ...policy.hardRules[0], verifier: 'LLM_RUBRIC' }] }), /unsupported/);
assert.throws(() => validateAcceptancePolicy({ ...policy, surpriseField: true }), /missing or unsupported fields/);

console.log('Acceptance policy tests passed: canonicalization, buyer/provider signatures, mutation, and schema constraints.');
