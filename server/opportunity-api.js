import { OPPORTUNITY_RUN_ID } from './opportunity-service.js';

// HTTP translation only. All evaluation, storage, and settlement live in the service.
export async function handleOpportunityRoute(method, path, body, service) {
  const base = `/api/v1/jobs/${OPPORTUNITY_RUN_ID}`;
  if (path === base && method === 'GET') return { status: 200, body: { data: await service.getJob() } };
  if (path === `${base}/results` && method === 'GET') return { status: 200, body: { data: await service.getResults() } };
  if (path === `${base}/results` && method === 'POST') {
    try {
      const result = await service.submitResult(body);
      return { status: 201, body: { data: await service.getResult(result.id) } };
    } catch (error) {
      const message = String(error?.message || '');
      const status = /already submitted|cap reached|already being changed/i.test(message) ? 409
        : /fixed operator run|Provider identity|HTTPS source/i.test(message) ? 400 : 503;
      const publicMessage = status === 400 || status === 409 ? message : 'Opportunity evaluation is temporarily unavailable. No payment was sent.';
      return { status, body: { error: publicMessage } };
    }
  }
  if (path.startsWith(`${base}/results/`) && method === 'GET') {
    const parts = path.slice(`${base}/results/`.length).split('/');
    if (parts.length === 1 && parts[0]) {
      const result = await service.getResult(parts[0]);
      return { status: result ? 200 : 404, body: result ? { data: result } : { error: 'Result not found' } };
    }
    if (parts.length === 2 && parts[0] && parts[1] === 'receipt') {
      const receipt = await service.getReceipt(parts[0]);
      return { status: receipt ? 200 : 404, body: receipt ? { data: receipt } : { error: 'Receipt not found' } };
    }
  }
  return null;
}
