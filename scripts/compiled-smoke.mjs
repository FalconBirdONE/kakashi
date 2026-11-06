import { fork } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// Plain Node, compiled entry point, no tsx/loader, no external API calls.
const dir = await mkdtemp(join(tmpdir(), 'tollbooth-smoke-'));
try {
  for (const factory of ['brain', 'trust', 'rails', 'rails,brain,trust']) {
    const child = fork(new URL('../apps/server/dist/index.js', import.meta.url), [], {
      execArgv: [], silent: true,
      env: { PATH: process.env.PATH, PORT: '0', DEMO_MODE: 'false', USE_REAL: factory,
        DB_PATH: join(dir, factory.replaceAll(',', '-') + '.sqlite'), SESSION_SECRET: 'smoke-only-secret',
        PERMIT_SECRET: 'ab'.repeat(32), AGENT_ACCOUNT_ID: '0.0.2000',
        MERCHANT_QUICKCAST_PAYTO: '0.0.3001', MERCHANT_HOURLYPRO_PAYTO: '0.0.3002',
        MERCHANT_GROUNDTRUTH_PAYTO: '0.0.3003', MERCHANT_GOUGER_PAYTO: '0.0.3004',
        HEDERA_OPERATOR_ID: '0.0.2001', HEDERA_OPERATOR_KEY: '01'.repeat(32), HCS_TOPIC_ID: '0.0.4000',
        WORLD_ISSUER: 'https://world.invalid', WORLD_CLIENT_ID: 'smoke', WORLD_CLIENT_SECRET: 'smoke',
        ZG_API_KEY: 'smoke', ZG_MODEL: 'smoke', INFERENCE_LIMIT: '0.1', INFERENCE_MAX_REQUEST_COST: '0.01' },
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    try {
      const port = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('startup timeout')), 8000);
        child.once('message', msg => { clearTimeout(timer); resolve(msg.port); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`startup exited ${code}: ${stderr}`)); });
      });
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      assert.equal(response.status, 200);
      const body = await response.json();
      for (const name of factory.split(',')) assert.equal(body.modes[name], 'real');
      console.log(`compiled startup passed: ${factory}`);
    } finally {
      if (child.exitCode === null) {
        const exited = new Promise(resolve => child.once('exit', resolve));
        child.kill('SIGTERM');
        await exited;
      }
    }
  }
} finally { await rm(dir, { recursive: true, force: true }); }
