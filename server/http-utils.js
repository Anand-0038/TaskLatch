export const DEFAULT_API_PORT = 8787;
export const MAX_JSON_BODY_BYTES = 64 * 1024;

export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

export function resolveApiPort(value) {
  if (value === undefined || value === null || String(value).trim() === '') return DEFAULT_API_PORT;
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) throw new TypeError('API_PORT must be an integer from 1 to 65535.');
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new TypeError('API_PORT must be an integer from 1 to 65535.');
  return port;
}

export function resolveJobId(value) {
  const jobId = value || 'job-demo-001';
  if (typeof jobId !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(jobId) || jobId === '.' || jobId === '..') {
    throw new TypeError('PROOFPAY_JOB_ID must be a route-safe 1-80 character job ID.');
  }
  return jobId;
}

export async function readJsonBody(request) {
  const chunks = [];
  let byteLength = 0;
  let oversized = false;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;
    if (byteLength > MAX_JSON_BODY_BYTES) {
      oversized = true;
      chunks.length = 0;
    } else if (!oversized) {
      chunks.push(buffer);
    }
  }

  if (oversized) throw new HttpError(413, `Request body exceeds the ${MAX_JSON_BODY_BYTES}-byte limit.`);
  const contentType = String(request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') throw new HttpError(415, 'Content-Type must be application/json.');
  if (byteLength === 0) throw new HttpError(400, 'A JSON object request body is required.');

  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body must contain valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Request body must be a JSON object.');
  return value;
}

export function contentTypeForPath(path) {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return ({
    html: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    mjs: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    json: 'application/json; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
  })[extension] || 'application/octet-stream';
}
