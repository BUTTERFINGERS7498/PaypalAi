import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { TestContext } from 'node:test';

export const root = fileURLToPath(new URL('../../', import.meta.url));
const guard = fileURLToPath(new URL('./no-network.mjs', import.meta.url));
export const catalog = [
  { sku: 'GRO-OAT-01', name: 'Rolled oats 1kg', category: 'groceries', value: '4.50' },
  { sku: 'QA-GRO-42', name: 'Pantry pack small', category: 'groceries', value: '42.00' },
  { sku: 'QA-GRO-51', name: 'Pantry pack large', category: 'groceries', value: '51.00' },
  { sku: 'QA-ELE-129', name: 'Espresso machine', category: 'electronics', value: '129.00' },
  { sku: 'QA-ELE-299', name: 'Games console', category: 'electronics', value: '299.00' },
  { sku: 'QA-HOUSE-12', name: 'Storage box', category: 'household', value: '12.00' },
];

export async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((res, rej) => server.close(e => e ? rej(e) : res()));
  return port;
}

export function withDb<T>(path: string, action: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path);
  try { db.exec('PRAGMA busy_timeout=3000'); return action(db); }
  finally { db.close(); }
}

export async function startServer(t: TestContext, options: { checkout?: string; approvalToken?: string } = {}) {
  const entry = resolve(root, 'src/server/index.ts');
  await access(entry).catch(() => assert.fail('OPEN DEPENDENCY: src/server/index.ts is missing; backend contract tests cannot start'));
  const scratch = join(root, 'tests', '.tmp');
  await mkdir(scratch, { recursive: true });
  const dir = await mkdtemp(join(scratch, 'server-'));
  const database = join(dir, 'mandate.db');
  const audit = join(dir, 'network.log');
  let child: ReturnType<typeof spawn> | undefined;
  let exited: Promise<unknown> | undefined;
  t.after(async () => {
    try {
      if (child && child.exitCode === null && child.signalCode === null) child.kill();
      if (exited) await exited;
      const attempts = await readFile(audit, 'utf8').catch((e) => { if (e.code === 'ENOENT') return ''; throw e; });
      assert.equal(attempts, '', 'Mock child attempted outbound I/O (blocked and recorded)');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  const port = await freePort();
  // Allowlist rather than inherit env: real credentials, NODE_OPTIONS and .env never enter mock children.
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, {
    PORT: String(port), DATABASE_PATH: database, PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
    PAYPAL_ENV: 'sandbox', PAYPAL_MODE: 'mock', AGENT_MODE: 'mock', WEBHOOK_VERIFY: 'off',
    CHECKOUT_MODE: options.checkout ?? 'payer_approval', QA_NETWORK_AUDIT: audit,
  });
  if (options.approvalToken) env.APPROVAL_TOKEN = options.approvalToken;
  child = spawn(process.execPath, ['--import', pathToFileURL(guard).href, entry], {
    cwd: root, env, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true,
  });
  let launchFailed = false;
  child.on('error', () => { launchFailed = true; });
  exited = new Promise<void>(res => child!.once('close', () => res()));
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    assert(!launchFailed && child.exitCode === null && child.signalCode === null,
      'Backend exited before /api/health was ready; inspect backend locally (child output suppressed to protect secrets)');
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(400) });
      if (res.ok) { ready = true; break; }
    } catch { /* startup race */ }
    await new Promise(res => setTimeout(res, 40));
  }
  assert(ready, 'Backend did not become healthy within 10 seconds');
  withDb(database, db => {
    const insert = db.prepare('INSERT OR REPLACE INTO catalog_items (sku,name,category,price_value,currency_code,merchant) VALUES (?,?,?,?,?,?)');
    for (const item of catalog) insert.run(item.sku, item.name, item.category, item.value, 'USD', 'QA Pantry');
  });
  async function request(method: string, path: string, body?: unknown, status = 200, authenticated = true) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.approvalToken && authenticated) headers.authorization = `Bearer ${options.approvalToken}`;
    const res = await fetch(`${base}${path}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000),
    });
    assert.equal(res.status, status, `${method} ${path}: expected HTTP ${status}, got ${res.status}`);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    return res.json();
  }
  return {
    database, base, request,
    get: (path: string) => request('GET', path),
    post: (path: string, body?: unknown, status = 200) => request('POST', path, body, status),
    mandate: (limits: Record<string, unknown> = {}) => request('POST', '/api/mandates', {
      label: 'QA mandate', owner: 'qa-user',
      limits: { monthly_cap: '1000.00', categories: ['groceries'], approval_above: '500.00', ...limits },
    }, 201),
    instruct: (id: string, sku = 'GRO-OAT-01', rogue = false, text?: string) => request('POST', '/api/agent/instructions', {
      mandate_id: id, text: text ?? `buy sku ${sku}`, demo_rogue: rogue,
    }, 201),
  };
}
export type Server = Awaited<ReturnType<typeof startServer>>;
