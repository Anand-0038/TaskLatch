import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { contentTypeForPath, HttpError, MAX_JSON_BODY_BYTES, readJsonBody, resolveApiPort, resolveJobId } from '../server/http-utils.js';

function request(body, contentType = 'application/json') {
  return Object.assign(Readable.from(body === null ? [] : [body]), { headers: { 'content-type': contentType } });
}

assert.equal(resolveApiPort(undefined), 8787);
assert.equal(resolveApiPort('9123'), 9123);
for (const value of ['0', '-1', '65536', '12.5', 'abc', '1e3']) assert.throws(() => resolveApiPort(value), /API_PORT/);
assert.equal(resolveJobId(undefined), 'job-demo-001');
assert.equal(resolveJobId('custom-job-01'), 'custom-job-01');
for (const value of ['.', '..', '../other', 'job/id', 'x'.repeat(81)]) assert.throws(() => resolveJobId(value), /route-safe/);
assert.deepEqual(await readJsonBody(request('{"ok":true}')), { ok: true });
assert.deepEqual(await readJsonBody(request('{"ok":true}', 'Application/JSON; charset=utf-8')), { ok: true });
await assert.rejects(readJsonBody(request(null)), error => error instanceof HttpError && error.statusCode === 400);
await assert.rejects(readJsonBody(request('{broken')), error => error instanceof HttpError && error.statusCode === 400);
await assert.rejects(readJsonBody(request('null')), error => error instanceof HttpError && error.statusCode === 400);
await assert.rejects(readJsonBody(request('[]')), error => error instanceof HttpError && error.statusCode === 400);
await assert.rejects(readJsonBody(request('{}', 'text/plain')), error => error instanceof HttpError && error.statusCode === 415);
await assert.rejects(readJsonBody(request('"' + 'x'.repeat(MAX_JSON_BODY_BYTES) + '"')), error => error instanceof HttpError && error.statusCode === 413);
assert.equal(contentTypeForPath('app.json'), 'application/json; charset=utf-8');
assert.equal(contentTypeForPath('logo.svg'), 'image/svg+xml');
assert.equal(contentTypeForPath('app.js'), 'text/javascript; charset=utf-8');

console.log('HTTP utility checks passed: port validation, bounded JSON objects, content types, and MIME mappings.');
