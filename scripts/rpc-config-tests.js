import assert from 'node:assert/strict';
import { requireArcTestnetRpc } from '../shared/evidence.js';

assert.throws(
  () => requireArcTestnetRpc({}),
  /unique Arc Testnet endpoint.*no shared public RPC fallback/,
  'missing event endpoint must fail closed',
);
assert.throws(
  () => requireArcTestnetRpc({ ARC_RPC_URL: 'https://rpc.testnet.arc.io' }),
  /shared public Arc Testnet RPC is disallowed/,
  'shared public Arc RPC must be rejected',
);
assert.throws(
  () => requireArcTestnetRpc({ ARC_RPC_URL: 'http://canteen-rpc.example.invalid/token' }),
  /must use HTTPS/,
  'insecure RPC URL must be rejected',
);
assert.throws(
  () => requireArcTestnetRpc({ ARC_RPC_URL: 'not-a-url-secret-fragment' }),
  error => error.message.includes('valid HTTPS endpoint') && !error.message.includes('secret-fragment'),
  'invalid RPC errors must not disclose the supplied value',
);
assert.equal(
  requireArcTestnetRpc({ ARC_RPC_URL: 'https://rpc.example.invalid/canteen/session-key' }),
  'https://rpc.example.invalid/canteen/session-key',
  'a configured HTTPS endpoint should be passed through without logging it',
);

console.log('Arc RPC config checks passed: required unique HTTPS endpoint, shared endpoint rejection, and redacted errors.');
