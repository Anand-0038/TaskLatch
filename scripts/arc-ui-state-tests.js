import assert from 'node:assert/strict';
import { arcPanelState } from '../src/arc-ui-state.js';

assert.deepEqual(arcPanelState({ connected: false, funded: false }), {
  message: 'Connect the buyer wallet to inspect the escrow.', canFund: false, canRefund: false,
});
assert.deepEqual(arcPanelState({ connected: true, wrongNetwork: true }), {
  message: 'Switch wallet to Arc Testnet · chain ID 5042002', canFund: false, canRefund: false,
});

const mismatchedTokenAfterExpiry = arcPanelState({
  connected: true,
  exists: true,
  funded: false,
  tokenMatches: false,
  isBuyer: true,
  chainTimestamp: 2_000,
  expiresAt: 1_000,
});
assert.equal(mismatchedTokenAfterExpiry.canFund, false, 'a token mismatch must never expose funding');
assert.equal(mismatchedTokenAfterExpiry.canRefund, true, 'the escrow buyer can still recover funds after expiry');
assert.match(mismatchedTokenAfterExpiry.message, /different token/);

const mismatchedTokenBeforeExpiry = arcPanelState({
  connected: true,
  exists: true,
  funded: false,
  tokenMatches: false,
  isBuyer: true,
  chainTimestamp: 999,
  expiresAt: 1_000,
});
assert.equal(mismatchedTokenBeforeExpiry.canRefund, false, 'refund remains hidden until on-chain expiry');

const wrongBuyer = arcPanelState({
  connected: true,
  exists: true,
  funded: false,
  tokenMatches: true,
  isBuyer: false,
  authorizedBuyer: false,
  chainTimestamp: 2_000,
  expiresAt: 1_000,
});
assert.equal(wrongBuyer.canFund, false);
assert.equal(wrongBuyer.canRefund, false, 'only the on-chain buyer can refund');

assert.equal(arcPanelState({
  connected: true, exists: false, funded: false, tokenMatches: true, authorizedBuyer: true,
}).canFund, true);

console.log('Arc UI-state checks passed: missing wallet, wrong network, token mismatch, buyer authorization, and post-expiry refund recovery.');
