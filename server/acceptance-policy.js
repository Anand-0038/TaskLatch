import { getAddress, getBytes, isAddress, keccak256, toUtf8Bytes, verifyMessage, ZeroAddress } from 'ethers';

const POLICY_KEYS = [
  'schemaVersion', 'policyId', 'version', 'buyer', 'provider', 'task',
  'currency', 'chainId', 'unitPriceAtomic', 'maxBudgetAtomic', 'deadline',
  'evidenceRequirements', 'hardRules', 'qualityRubric', 'nonce', 'expiresAt',
];

function requireText(value, label, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new TypeError(`${label} must be a non-empty string of at most ${max} characters.`);
}

function requireTimestamp(value, label) {
  requireText(value, label, 40);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) throw new TypeError(`${label} must be a UTC ISO-8601 timestamp.`);
  const parsed = new Date(value);
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,3}))?Z$/.exec(value);
  const milliseconds = Number((match[7] || '').padEnd(3, '0') || '0');
  if (!Number.isFinite(parsed.getTime()) || parsed.getUTCFullYear() !== Number(match[1]) || parsed.getUTCMonth() + 1 !== Number(match[2]) || parsed.getUTCDate() !== Number(match[3]) || parsed.getUTCHours() !== Number(match[4]) || parsed.getUTCMinutes() !== Number(match[5]) || parsed.getUTCSeconds() !== Number(match[6]) || parsed.getUTCMilliseconds() !== milliseconds) throw new TypeError(`${label} must be a real UTC calendar timestamp.`);
}

export function validateAcceptancePolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new TypeError('Acceptance policy must be an object.');
  const keys = Object.keys(policy).sort();
  const expected = [...POLICY_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, i) => key !== expected[i])) throw new TypeError('Acceptance policy has missing or unsupported fields.');
  if (policy.schemaVersion !== 1 || !Number.isSafeInteger(policy.version) || policy.version < 1) throw new TypeError('Unsupported acceptance policy version.');
  requireText(policy.policyId, 'policyId', 100);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,99}$/.test(policy.policyId)) throw new TypeError('policyId contains unsupported characters.');
  for (const name of ['buyer', 'provider']) {
    if (!isAddress(policy[name])) throw new TypeError(`${name} must be an EVM address.`);
    if (getAddress(policy[name]) === ZeroAddress) throw new TypeError(`${name} cannot be the zero address.`);
  }
  if (getAddress(policy.buyer) === getAddress(policy.provider)) throw new TypeError('Buyer and provider must be distinct.');
  requireText(policy.task, 'task');
  if (policy.currency !== 'USDC') throw new TypeError('Only USDC-denominated policies are supported.');
  if (!Number.isSafeInteger(policy.chainId) || policy.chainId <= 0) throw new TypeError('chainId must be a positive safe integer.');
  for (const name of ['unitPriceAtomic', 'maxBudgetAtomic']) if (typeof policy[name] !== 'string' || !/^[1-9]\d{0,37}$/.test(policy[name])) throw new TypeError(`${name} must be a positive atomic-unit integer string.`);
  if (BigInt(policy.maxBudgetAtomic) < BigInt(policy.unitPriceAtomic)) throw new TypeError('maxBudgetAtomic must cover at least one result.');
  requireTimestamp(policy.deadline, 'deadline');
  requireTimestamp(policy.expiresAt, 'expiresAt');
  if (Date.parse(policy.deadline) > Date.parse(policy.expiresAt)) throw new TypeError('Policy expiry cannot precede the task deadline.');
  if (!Array.isArray(policy.evidenceRequirements) || policy.evidenceRequirements.length > 20) throw new TypeError('evidenceRequirements must be an array of at most 20 strings.');
  policy.evidenceRequirements.forEach((item, i) => requireText(item, `evidenceRequirements[${i}]`, 500));
  if (!Array.isArray(policy.hardRules) || policy.hardRules.length > 20) throw new TypeError('hardRules must be an array of at most 20 rules.');
  const ruleIds = new Set();
  for (const [i, rule] of policy.hardRules.entries()) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule) || Object.keys(rule).sort().join(',') !== 'description,id,verifier') throw new TypeError(`hardRules[${i}] must contain exactly id, verifier, and description.`);
    requireText(rule.id, `hardRules[${i}].id`, 80);
    requireText(rule.description, `hardRules[${i}].description`, 500);
    if (!['EXACT_MATCH', 'URL_EXISTS', 'TIME_WINDOW', 'SCHEMA', 'NUMERIC_THRESHOLD', 'API_LOOKUP', 'REGISTRY_LOOKUP'].includes(rule.verifier)) throw new TypeError(`hardRules[${i}].verifier is unsupported.`);
    if (ruleIds.has(rule.id)) throw new TypeError('Hard-rule IDs must be unique.');
    ruleIds.add(rule.id);
  }
  if (!Array.isArray(policy.qualityRubric) || policy.qualityRubric.length > 20) throw new TypeError('qualityRubric must be an array of at most 20 strings.');
  policy.qualityRubric.forEach((item, i) => requireText(item, `qualityRubric[${i}]`, 500));
  requireText(policy.nonce, 'nonce', 100);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(policy.nonce)) throw new TypeError('nonce must contain 16–100 URL-safe characters.');
  return policy;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  if (typeof value === 'string' || typeof value === 'boolean' || value === null) return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  throw new TypeError('Acceptance policy contains a non-canonical value.');
}

export function canonicalizeAcceptancePolicy(policy) {
  validateAcceptancePolicy(policy);
  return canonical(policy);
}

export function hashAcceptancePolicy(policy) {
  return keccak256(toUtf8Bytes(canonicalizeAcceptancePolicy(policy)));
}

export async function signAcceptancePolicy(policy, signer) {
  validateAcceptancePolicy(policy);
  if (!signer || typeof signer.getAddress !== 'function' || typeof signer.signMessage !== 'function') throw new TypeError('A connected EVM signer is required.');
  if (getAddress(await signer.getAddress()) !== getAddress(policy.buyer)) throw new Error('Only the buyer named in the policy may sign it.');
  const policyHash = hashAcceptancePolicy(policy);
  return { policyHash, buyerSignature: await signer.signMessage(getBytes(policyHash)) };
}

export function verifyAcceptancePolicy({ policy, policyHash, buyerSignature, providerSignature = null }) {
  try {
    validateAcceptancePolicy(policy);
    const computedHash = hashAcceptancePolicy(policy);
    if (typeof policyHash !== 'string' || computedHash.toLowerCase() !== policyHash.toLowerCase()) return { valid: false, reason: 'Policy hash does not match the canonical policy.' };
    const payload = getBytes(computedHash);
    if (verifyMessage(payload, buyerSignature) !== getAddress(policy.buyer)) return { valid: false, reason: 'Buyer signature does not match the policy buyer.' };
    if (providerSignature !== null && verifyMessage(payload, providerSignature) !== getAddress(policy.provider)) return { valid: false, reason: 'Provider acknowledgement does not match the policy provider.' };
    return { valid: true, policyHash: computedHash, providerAcknowledged: providerSignature !== null };
  } catch (error) {
    return { valid: false, reason: error.message || 'Policy verification failed.' };
  }
}
