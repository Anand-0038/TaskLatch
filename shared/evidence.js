import { keccak256, toUtf8Bytes } from 'ethers';

export const ARC_TESTNET_CHAIN_ID = 5042002n;
export const ARC_TESTNET_USDC = '0x3600000000000000000000000000000000000000';
export const ARC_EXPLORER = 'https://explorer.testnet.arc.io';

export function requireArcTestnetRpc(env = {}) {
  const endpoint = typeof env.ARC_RPC_URL === 'string' ? env.ARC_RPC_URL.trim() : '';
  if (!endpoint) {
    throw new Error('ARC_RPC_URL is required. Configure the unique Arc Testnet endpoint from the Canteen ARC CLI; no shared public RPC fallback is used.');
  }
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('ARC_RPC_URL must be a valid HTTPS endpoint from the Canteen ARC CLI.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('ARC_RPC_URL must use HTTPS.');
  }
  if (parsed.hostname.toLowerCase() === 'rpc.testnet.arc.io') {
    throw new Error('The shared public Arc Testnet RPC is disallowed for this event; configure the unique Canteen ARC CLI endpoint.');
  }
  return endpoint;
}

export function jobIdBytes32(jobId) {
  return keccak256(toUtf8Bytes(jobId));
}
export function resultIdBytes32(resultId) {
  return keccak256(toUtf8Bytes(resultId));
}
export function evidencePayload(jobId, row, evaluation, agentReview) {
  if (row.version === 2) {
    return {
      version: 2,
      jobId,
      resultId: row.id,
      output: { company: row.company, domain: row.domain, evidenceHint: row.evidenceHint || null, providerAddress: row.providerAddress },
      evaluation: { eligible: evaluation.eligible, checks: evaluation.checks, evaluator: evaluation.evaluator },
      independentEvidence: row.independentEvidence || null,
      x402EvidencePurchase: row.evidencePurchase || null,
      agentReview,
    };
  }
  return {
    jobId,
    resultId: row.id,
    output: {
      company: row.company,
      domain: row.domain,
      category: row.category,
      employeeCountAtLeast: row.employeeCountAtLeast,
      evidenceUrl: row.evidenceUrl
    },
    evaluation: {
      eligible: evaluation.eligible,
      checks: evaluation.checks,
      evaluator: evaluation.evaluator
    },
    agentReview: {
      agent: agentReview.agent,
      recommendation: agentReview.recommendation,
      rationale: agentReview.rationale,
      evaluatedAt: agentReview.evaluatedAt
    }
  };
}
export function evidenceHash(jobId, row, evaluation, agentReview) {
  return keccak256(toUtf8Bytes(JSON.stringify(evidencePayload(jobId, row, evaluation, agentReview))));
}
