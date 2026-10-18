const json = schema => ({ 'application/json': { schema } });
const response = (description, schema = { type: 'object', additionalProperties: true }) => ({ description, content: json(schema) });
const idParam = name => ({ name, in: 'path', required: true, schema: { type: 'string' } });
const resultSchema = { $ref: '#/components/schemas/Result' };
const receiptSchema = { $ref: '#/components/schemas/DecisionReceipt' };
const ok = schema => ({ '200': response('Successful response', schema), '404': response('Record not found', { $ref: '#/components/schemas/Error' }) });

export function buildOpenApi({ jobId, opportunityRunId, legacySubmissionsEnabled = false, paidEvidenceEnabled = false }) {
  const opportunityPath = `/api/v1/jobs/${opportunityRunId}`;
  const fixturePath = `/api/v1/jobs/${jobId}`;
  const paths = {
    '/api/v1/jobs': { get: { summary: 'List configured jobs', responses: { '200': response('Configured jobs', { type: 'object', required: ['data'], properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Job' } }, mode: { type: 'string' }, readinessMessage: { type: 'string' } } }) } } },
    [opportunityPath]: { get: { summary: 'Read the fixed opportunity research job', responses: ok({ type: 'object', required: ['data'], properties: { data: { $ref: '#/components/schemas/Job' } } }) } },
    [`${opportunityPath}/results`]: {
      get: { summary: 'List persisted results for the opportunity run', responses: { '200': response('Sanitized result records', { type: 'object', required: ['data'], properties: { data: { type: 'array', items: resultSchema } } }) } },
      post: {
        summary: 'Submit one signed candidate in the fixed opportunity run',
        description: 'Accepts only the three recorded candidate IDs and their official URLs. Evaluation and persistence use the existing operator service. This route does not fund or settle the job.',
        requestBody: { required: true, content: json({ $ref: '#/components/schemas/SignedCandidate' }) },
        responses: { '201': response('Result evaluated and persisted', { type: 'object', required: ['data'], properties: { data: resultSchema } }), '400': response('Invalid candidate or provider signature', { $ref: '#/components/schemas/Error' }), '409': response('Duplicate, locked run, or exhausted cap', { $ref: '#/components/schemas/Error' }), '503': response('Evaluation service unavailable', { $ref: '#/components/schemas/Error' }) },
      },
    },
    [`${opportunityPath}/results/{resultId}`]: { get: { summary: 'Read one sanitized opportunity result', parameters: [idParam('resultId')], responses: ok({ type: 'object', required: ['data'], properties: { data: resultSchema } }) } },
    [`${opportunityPath}/results/{resultId}/receipt`]: { get: { summary: 'Read the canonical persisted decision receipt', parameters: [idParam('resultId')], responses: ok({ type: 'object', required: ['data'], properties: { data: receiptSchema } }) } },
    [`${fixturePath}/results`]: { get: { summary: 'List historical company-research fixture results', responses: { '200': response('Historical results', { type: 'object', additionalProperties: true }) } } },
    [`${fixturePath}/settle-pending`]: { post: { summary: 'Settle eligible historical results after escrow funding', description: 'Does not retry uncertain transactions.', responses: { '200': response('Settlement outcomes', { type: 'object', additionalProperties: true }), '503': response('Arc Testnet setup is incomplete', { $ref: '#/components/schemas/Error' }) } } },
    [`${fixturePath}/reconcile-pending`]: { post: { summary: 'Reconcile saved historical transaction hashes', description: 'Read-only chain verification; does not broadcast transactions.', responses: { '200': response('Reconciliation outcomes', { type: 'object', additionalProperties: true }) } } },
    '/api/v1/receipts': { get: { summary: 'List historical company-research receipts', responses: { '200': response('Historical receipts', { type: 'object', additionalProperties: true }) } } },
    '/api/v1/openapi': { get: { summary: 'Return this OpenAPI document', responses: { '200': response('OpenAPI 3.1 document', { type: 'object', required: ['openapi', 'info', 'paths'], properties: { openapi: { const: '3.1.0' }, info: { type: 'object' }, paths: { type: 'object' }, components: { type: 'object' } } }) } } },
  };
  paths[`${fixturePath}/results`].post = legacySubmissionsEnabled
    ? { summary: 'Submit a historical claim-based fixture result', deprecated: true, requestBody: { required: true, content: json({ type: 'object', required: ['company', 'domain', 'category', 'employeeCountAtLeast', 'evidenceUrl'], properties: { company: { type: 'string' }, domain: { type: 'string' }, category: { type: 'string' }, employeeCountAtLeast: { type: 'integer', minimum: 1 }, evidenceUrl: { type: 'string', format: 'uri' } } }) }, responses: { '201': response('Rejected or settled fixture result'), '202': response('Eligible result saved but settlement is pending', { type: 'object', properties: { data: { type: 'object', properties: { settlement: { type: 'object' } } }, mode: { type: 'string' } } }), '400': response('Invalid input', { $ref: '#/components/schemas/Error' }), '409': response('Duplicate result', { $ref: '#/components/schemas/Error' }), '503': response('Testnet settlement is unavailable', { $ref: '#/components/schemas/Error' }) } }
    : { summary: 'Legacy fixture submissions are closed', deprecated: true, responses: { '410': response('Legacy submission route is disabled', { $ref: '#/components/schemas/Error' }) } };
  paths[`${fixturePath}/agent-results`] = paidEvidenceEnabled
    ? { post: { summary: 'Experimental signed company research route', description: 'This separate legacy path is not used by the opportunity research job. It requires operator-controlled enablement and configured evidence and model services.', deprecated: true, requestBody: { required: true, content: json({ type: 'object', additionalProperties: true }) }, responses: { '201': response('Agent result processed'), '202': response('Human review required'), '400': response('Invalid input', { $ref: '#/components/schemas/Error' }), '403': response('Invalid provider signature', { $ref: '#/components/schemas/Error' }), '409': response('Duplicate result', { $ref: '#/components/schemas/Error' }), '503': response('This legacy route is disabled or unavailable', { $ref: '#/components/schemas/Error' }) } } }
    : { post: { summary: 'Legacy experimental submission route is disabled', description: 'This route is not part of the current operator workflow.', deprecated: true, responses: { '503': response('Experimental route is disabled', { $ref: '#/components/schemas/Error' }) } } };
  paths[`${fixturePath}/results/{resultId}/recommendation`] = { post: { summary: 'External recommendations are not accepted', deprecated: true, parameters: [idParam('resultId')], responses: { '410': response('Recommendations cannot alter decisions', { $ref: '#/components/schemas/Error' }) } } };
  for (const action of ['accept', 'reject']) paths[`${fixturePath}/results/{resultId}/${action}`] = { post: { summary: 'Manual result decisions are disabled', deprecated: true, parameters: [idParam('resultId')], responses: { '410': response('Decisions are automatic; manual settlement is disabled', { $ref: '#/components/schemas/Error' }) } } };

  return {
    openapi: '3.1.0',
    info: { title: 'TaskLatch Local Testnet API', version: '0.5.0', description: 'The opportunity routes expose only the fixed recorded operator task. They do not create arbitrary jobs or perform automatic settlement.' },
    paths,
    components: { schemas: {
      Error: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } },
      Job: { type: 'object', additionalProperties: true, properties: { id: { type: 'string' }, operatorRequest: { type: 'object' }, unitPrice: { type: 'string' }, cap: { type: 'string' }, maxUnits: { type: 'integer' }, chainId: { type: 'integer' }, escrow: { type: 'string' }, provider: { type: 'string' }, providerWallet: { type: 'string' }, agent: { type: 'string' }, buyerWallet: { type: 'string' }, resultCount: { type: 'integer' } } },
      SignedCandidate: { type: 'object', additionalProperties: false, required: ['id', 'title', 'url', 'nonce', 'signature'], properties: { id: { type: 'string', enum: ['ziroh-build-next-2026', 'ethonline-2026', 'algorand-x402-challenge-2026'] }, title: { type: 'string' }, url: { type: 'string', format: 'uri', pattern: '^https://' }, secondaryUrl: { type: 'string', format: 'uri', pattern: '^https://' }, nonce: { type: 'string', minLength: 8, maxLength: 80 }, signature: { type: 'string', pattern: '^0x[0-9a-fA-F]{130}$' } } },
      Result: { type: 'object', required: ['id', 'title', 'url', 'decision', 'receiptHash', 'payment'], properties: { id: { type: 'string' }, title: { type: 'string' }, url: { type: 'string', format: 'uri' }, decision: { type: 'string', enum: ['ACCEPT', 'REJECT', 'ESCALATE'] }, reason: { type: 'string' }, hardChecks: { type: 'object' }, independentEvidence: { type: 'object' }, aiJudgment: { type: 'object' }, payment: { type: 'object' }, receiptHash: { type: 'string' }, signatureValid: { type: 'boolean' } } },
      DecisionReceipt: { type: 'object', required: ['jobId', 'resultId', 'operatorRequest', 'submittedResult', 'hardChecks', 'independentEvidence', 'aiJudgment', 'decision', 'payment', 'receiptHash'], properties: { jobId: { type: 'string' }, resultId: { type: 'string' }, operatorRequest: { type: 'object' }, submittedResult: { type: 'object' }, hardChecks: { type: 'object' }, independentEvidence: { type: 'object' }, aiJudgment: { type: 'object' }, decision: { type: 'string', enum: ['ACCEPT', 'REJECT', 'ESCALATE'] }, reason: { type: 'string' }, payment: { type: 'object' }, receiptHash: { type: 'string' } } },
    } },
  };
}
