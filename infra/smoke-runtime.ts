// Verifies the actual npm start command with isolated, no-credential mock settings.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = join(root, 'infra', '.verification');
mkdirSync(work, { recursive: true });
const temp = mkdtempSync(join(work, 'runtime-'));
assert.ok(resolve(temp).startsWith(resolve(work) + sep));
const lease = createServer();
lease.listen(0, '127.0.0.1');
await once(lease, 'listening');
const port = (lease.address() as { port: number }).port;
await new Promise<void>((done) => lease.close(() => done()));
const npmCli = process.env.npm_execpath || join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
assert.ok(existsSync(npmCli), 'Run through npm or install Node 24 with npm.');
const env = {
    ...process.env,
    PAYPAL_ENV: 'sandbox', PAYPAL_MODE: 'mock', AGENT_MODE: 'mock', WEBHOOK_VERIFY: 'off',
    CHECKOUT_MODE: 'payer_approval', PAYPAL_CLIENT_ID: '', PAYPAL_CLIENT_SECRET: '',
    PAYPAL_WEBHOOK_ID: '', ANTHROPIC_API_KEY: '', APPROVAL_TOKEN: '', MANDATE_SIGNING_KEY: '',
    DATABASE_PATH: join(temp, 'runtime.db'), PORT: String(port), PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
};
const seed = spawnSync(process.execPath, [npmCli, 'run', 'seed'], { cwd: root, env, stdio: 'ignore', timeout: 15000 });
assert.equal(seed.status, 0, 'The documented npm run seed must finish before startup.');
const child = spawn(process.execPath, [npmCli, 'start'], {
  cwd: root,
  stdio: 'ignore',
  detached: process.platform !== 'win32',
  env,
});
let startError = false;
child.on('error', () => { startError = true; });
const base = `http://127.0.0.1:${port}`;
try {
  let health: Record<string, unknown> | undefined;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && child.exitCode === null && !startError) {
    try {
      const response = await fetch(base + '/api/health', { signal: AbortSignal.timeout(1000) });
      if (response.ok) { health = await response.json() as Record<string, unknown>; break; }
    } catch { /* The listener is not ready yet. */ }
    await new Promise((done) => setTimeout(done, 150));
  }
  assert.ok(health, 'npm start must expose /api/health within 15 seconds.');
  assert.equal(health.ok, true);
  assert.equal(health.paypal_env, 'sandbox');
  assert.equal(health.paypal_mode, 'mock');
  assert.equal(health.agent_mode, 'mock');
  const mandates = await (await fetch(base + '/api/mandates')).json() as { mandates: unknown[] };
  assert.equal(mandates.mandates.length, 1);
  const purchases = await (await fetch(base + '/api/purchases')).json() as { purchases: unknown[] };
  assert.equal(purchases.purchases.length, 3);
  const chain = await (await fetch(base + '/api/evidence/verify')).json() as { valid: boolean; checked: number };
  assert.equal(chain.valid, true);
  assert.equal(chain.checked, 9);
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type') ?? '', /text\/html/);
  const html = await page.text();
  assert.match(html, /Mandate Ledger/i);
  const asset = html.match(/src="([^\"]+\.js[^\"]*)"/);
  assert.ok(asset, 'Static export must reference a JavaScript asset.');
  assert.equal((await fetch(new URL(asset[1].replaceAll('&amp;', '&'), base))).status, 200);
  const webhook = await fetch(base + '/webhooks/paypal', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'WH-PLATFORM-SMOKE', event_type: 'PLATFORM.SMOKE', resource_type: 'test', resource: {} }),
  });
  assert.equal(webhook.status, 200);
  assert.deepEqual(await webhook.json(), { received: true, duplicate: false });
  const events = await (await fetch(base + '/api/webhooks')).json() as { events: { id: string; verified: boolean }[] };
  assert.ok(events.events.some((event) => event.id === 'WH-PLATFORM-SMOKE' && event.verified === false));
  console.log(JSON.stringify({ npm_seed: 'passed', npm_start: 'passed', health: 'passed', seeded_api_state: 'passed', static_ui: 'passed', static_asset: 'passed', local_unverified_webhook: 'passed' }));
} finally {
  // npm spawns the server; terminate its tree so no listener or database handle is left behind.
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    await once(killer, 'exit');
  } else {
    if (child.pid) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* It already exited. */ }
    }
    if (child.exitCode === null) await once(child, 'exit');
  }
  rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
