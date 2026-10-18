import assert from 'node:assert/strict';
import { buildOpenApi } from '../server/openapi.js';
import { OPPORTUNITY_RUN_ID } from '../server/opportunity-service.js';

const doc = buildOpenApi({ jobId: 'fixture-job', opportunityRunId: OPPORTUNITY_RUN_ID });
assert.equal(doc.openapi, '3.1.0');
assert.equal(doc.paths['/api/v1/jobs/proofpay-opportunities-20260927-01/results'].post.requestBody.required, true);
const candidateSchema = doc.paths['/api/v1/jobs/proofpay-opportunities-20260927-01/results'].post.requestBody.content['application/json'].schema;
assert.deepEqual(candidateSchema, { $ref: '#/components/schemas/SignedCandidate' });
assert.deepEqual(doc.components.schemas.SignedCandidate.required, ['id', 'title', 'url', 'nonce', 'signature']);
assert.equal(doc.components.schemas.Job.properties.buyerWallet.type, 'string', 'the configured buyer required by browser funding is documented');
assert.ok(doc.paths['/api/v1/jobs/proofpay-opportunities-20260927-01/results/{resultId}/receipt'].get.responses['404']);
assert.equal(doc.paths['/api/v1/jobs/fixture-job/agent-results'].post.responses['503'].description, 'Experimental route is disabled');
assert.equal(doc.paths['/api/v1/jobs/fixture-job/results'].post.responses['410'].description, 'Legacy submission route is disabled');
const legacyEnabled = buildOpenApi({ jobId: 'fixture-job', opportunityRunId: OPPORTUNITY_RUN_ID, legacySubmissionsEnabled: true });
assert.ok(legacyEnabled.paths['/api/v1/jobs/fixture-job/results'].post.responses['202']);
assert.equal(doc.paths['/api/v1/jobs/fixture-job/results/{resultId}/accept'].post.responses['410'].description, 'Decisions are automatic; manual settlement is disabled');
for (const [path, pathItem] of Object.entries(doc.paths)) {
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!['get', 'post', 'put', 'patch', 'delete', 'options', 'head'].includes(method)) continue;
    assert.ok(operation.responses && Object.keys(operation.responses).length, `${method.toUpperCase()} ${path} must define responses`);
    for (const parameter of operation.parameters || []) {
      assert.ok(path.includes(`{${parameter.name}}`), `${method.toUpperCase()} ${path} declares a parameter absent from the path`);
    }
  }
}
const enabled = buildOpenApi({ jobId: 'fixture-job', opportunityRunId: OPPORTUNITY_RUN_ID, paidEvidenceEnabled: true });
assert.equal(enabled.paths['/api/v1/jobs/fixture-job/agent-results'].post.responses['503'].description, 'This legacy route is disabled or unavailable');
console.log('OpenAPI route/schema checks passed.');
