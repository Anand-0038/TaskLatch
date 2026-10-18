import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';
import { resolveApiPort, resolveJobId } from './server/http-utils.js';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const apiPort = resolveApiPort(env.API_PORT);
  const jobId = resolveJobId(env.PROOFPAY_JOB_ID || env.VITE_PROOFPAY_JOB_ID);
  return {
    define: { __TASKLATCH_JOB_ID__: JSON.stringify(jobId) },
    server: {
      proxy: { '/api': `http://127.0.0.1:${apiPort}` },
    },
    build: {
      rollupOptions: {
        input: {
          main: resolve('index.html'),
          fixture: resolve('fixture.html'),
        },
      },
    },
  };
});
