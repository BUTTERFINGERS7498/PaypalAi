// HTTP entry point: node:http, no framework. Routes follow docs/api-contract.md section 4.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { createServices, type Services } from './app.ts';
import { loadConfig, type Config } from './config.ts';
import { REPO_ROOT } from './db.ts';
import { draftMandate } from './mandate-draft.ts';
import { RateLimiter } from './ratelimit.ts';
import { badRequest, HttpError, notFound } from './util.ts';

const VERSION = '0.1.0';
const MAX_BODY = 1_000_000;
const UI_DIR = join(REPO_ROOT, 'dist', 'ui');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
};

export function buildHandler(s: Services): (req: IncomingMessage, res: ServerResponse) => void {
  const { cfg, store, evidence, mandates, gate, agent, disputes, webhooks, bus } = s;

  const sendJson = (res: ServerResponse, status: number, body: unknown, extraHeaders: Record<string, string> = {}) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), ...extraHeaders });
    res.end(text);
  };

  // Rate limits for the expensive endpoints (agent: model quota + PayPal orders; reconcile: PayPal reads).
  const agentLimiter = new RateLimiter({
    perClientLimit: cfg.agentRateLimitPerHour, perClientWindowMs: 3600_000,
    globalLimit: cfg.agentDailyLimit, globalWindowMs: 24 * 3600_000,
  });
  // Mandate drafts sign nothing, so they stay open, but each one can run the embedding model: rate limit them.
  const draftLimiter = new RateLimiter({
    perClientLimit: cfg.agentRateLimitPerHour > 0 ? 60 : 0, perClientWindowMs: 3600_000,
    globalLimit: cfg.agentRateLimitPerHour > 0 ? 1000 : 0, globalWindowMs: 24 * 3600_000,
  });
  const reconcileLimiter = new RateLimiter({
    perClientLimit: cfg.agentRateLimitPerHour > 0 ? 120 : 0, perClientWindowMs: 3600_000, globalLimit: 0, globalWindowMs: 0,
  });

  /**
   * Best-effort client identity. Render sits behind Cloudflare, which sets `cf-connecting-ip` itself (a client cannot
   * forge it); otherwise the RIGHT-most x-forwarded-for entry (appended by the nearest proxy), else the socket address.
   * The global limit exists because any per-client identity can be rotated.
   */
  const clientKey = (req: IncomingMessage): string => {
    const cf = String(req.headers['cf-connecting-ip'] ?? '').trim();
    if (cf) return cf;
    const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1];
    return req.socket.remoteAddress ?? 'unknown';
  };

  const enforceLimit = (limiter: RateLimiter, req: IncomingMessage, what: string) => {
    const r = limiter.check(clientKey(req));
    if (r.ok) return;
    throw new HttpError(429, 'rate_limited',
      r.scope === 'global'
        ? `The demo's daily ${what} limit has been reached. Try again later.`
        : `Too many ${what} requests from this client. Try again in ${r.retryAfterSeconds} seconds.`,
      { scope: r.scope, retry_after_seconds: r.retryAfterSeconds });
  };

  const readJson = async (req: IncomingMessage): Promise<any> => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY) throw badRequest('Request body too large');
      chunks.push(chunk as Buffer);
    }
    if (size === 0) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw badRequest('Body must be valid JSON'); }
  };

  /** Contract section 1, Auth: mutating endpoints need the bearer token when APPROVAL_TOKEN is set. */
  const requireAuth = (req: IncomingMessage) => {
    if (!cfg.approvalToken) return;
    const given = Buffer.from(String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
    const want = Buffer.from(cfg.approvalToken);
    if (given.length !== want.length || !timingSafeEqual(given, want)) {
      throw new HttpError(401, 'unauthorized', 'This action requires a valid bearer token');
    }
  };

  const decided = (body: any) => {
    const by = typeof body?.decided_by === 'string' ? body.decided_by.trim() : '';
    if (!by) throw badRequest('decided_by is required');
    const note = typeof body?.note === 'string' && body.note ? body.note.slice(0, 500) : null;
    return { by: by.slice(0, 64), note };
  };

  const serveStream = (req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(': connected\n\n');
    const unsubscribe = bus.subscribe((e) => res.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`));
    const ping = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.on('close', () => { clearInterval(ping); unsubscribe(); });
  };

  const serveStatic = (path: string, res: ServerResponse): boolean => {
    if (!existsSync(UI_DIR)) return false;
    const root = resolve(UI_DIR);
    let decoded: string;
    try { decoded = decodeURIComponent(path); } catch { return false; }
    let file = resolve(root, '.' + normalize('/' + decoded));
    if (file !== root && !file.startsWith(root + sep)) return false;
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file) && existsSync(file + '.html')) file = file + '.html'; // Next.js export: /ledger -> ledger.html
    if (!existsSync(file)) file = join(root, 'index.html'); // SPA-style fallback
    if (!existsSync(file)) return false;
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'content-length': body.length });
    res.end(body);
    return true;
  };

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method ?? 'GET';
    const q = url.searchParams;
    let m: RegExpMatchArray | null;

    if (method === 'GET' && path === '/api/health') {
      return sendJson(res, 200, {
        ok: true, paypal_env: cfg.paypalEnv, paypal_mode: cfg.paypalMode, agent_mode: cfg.agentMode,
        checkout_mode: cfg.checkoutMode, webhook_verify: cfg.webhookVerify, version: VERSION,
        // Only in engine mode: whether the semantic model is loaded ('embeddings') or the keyword fallback is in use.
        ...(s.engine ? { engine: s.engine.status() } : {}),
      });
    }

    // ----- mandates -----
    if (method === 'GET' && path === '/api/mandates') return sendJson(res, 200, { mandates: mandates.list() });
    if (method === 'POST' && path === '/api/mandates') {
      requireAuth(req);
      const b = await readJson(req);
      return sendJson(res, 201, mandates.create({ label: b.label, owner: b.owner, limits: b.limits }));
    }
    // A DRAFT only: reads limits from plain English. Nothing is created or signed; the person reviews and signs.
    if (method === 'POST' && path === '/api/mandates/draft') {
      enforceLimit(draftLimiter, req, 'draft');
      const b = await readJson(req);
      const text = typeof b.text === 'string' ? b.text.trim() : '';
      if (!text) throw badRequest('text is required');
      if (text.length > 500) throw badRequest('text must be 500 characters or fewer');
      return sendJson(res, 200, await draftMandate(text, store.listCatalog(), s.engine));
    }
    if (method === 'GET' && (m = path.match(/^\/api\/mandates\/([\w-]+)$/))) return sendJson(res, 200, mandates.require(m[1]));
    if (method === 'GET' && (m = path.match(/^\/api\/mandates\/([\w-]+)\/versions$/))) return sendJson(res, 200, { versions: mandates.versions(m[1]) });
    if (method === 'POST' && (m = path.match(/^\/api\/mandates\/([\w-]+)\/limits$/))) {
      requireAuth(req);
      return sendJson(res, 200, mandates.updateLimits(m[1], await readJson(req)));
    }
    if (method === 'POST' && (m = path.match(/^\/api\/mandates\/([\w-]+)\/revoke$/))) {
      requireAuth(req);
      return sendJson(res, 200, mandates.revoke(m[1]));
    }
    if (method === 'POST' && (m = path.match(/^\/api\/mandates\/([\w-]+)\/verify$/))) {
      const b = await readJson(req);
      return sendJson(res, 200, mandates.verify(m[1], Number.isInteger(b?.version) ? b.version : undefined));
    }

    // ----- catalog -----
    if (method === 'GET' && path === '/api/catalog') return sendJson(res, 200, { items: store.listCatalog(q.get('category') ?? undefined) });

    // ----- agent -----
    if (method === 'POST' && path === '/api/agent/instructions') {
      requireAuth(req); // the agent spends model quota and creates PayPal orders
      enforceLimit(agentLimiter, req, 'agent');
      const b = await readJson(req);
      const text = typeof b.text === 'string' ? b.text.trim() : '';
      if (!text) throw badRequest('text is required');
      if (text.length > 2000) throw badRequest('text must be 2000 characters or fewer');
      if (typeof b.mandate_id !== 'string' || !b.mandate_id) throw badRequest('mandate_id is required');
      return sendJson(res, 201, await agent.handle({ mandate_id: b.mandate_id, text, demo_rogue: b.demo_rogue === true }));
    }
    if (method === 'GET' && (m = path.match(/^\/api\/agent\/instructions\/([\w-]+)$/))) {
      const r = store.getAgentRequest(m[1]);
      if (!r) throw notFound(`Request ${m[1]} not found`);
      return sendJson(res, 200, r);
    }

    // ----- purchases -----
    if (method === 'GET' && path === '/api/purchases') return sendJson(res, 200, { purchases: store.listPurchases({ status: q.get('status') ?? undefined, mandate_id: q.get('mandate_id') ?? undefined }) });
    if (method === 'GET' && (m = path.match(/^\/api\/purchases\/([\w-]+)$/))) {
      const p = store.getPurchase(m[1]);
      if (!p) throw notFound(`Purchase ${m[1]} not found`);
      return sendJson(res, 200, p);
    }
    if (method === 'GET' && (m = path.match(/^\/api\/purchases\/([\w-]+)\/evidence$/))) {
      if (!store.getPurchase(m[1])) throw notFound(`Purchase ${m[1]} not found`);
      return sendJson(res, 200, { records: evidence.forPurchase(m[1]), chain_valid: evidence.verify().valid });
    }

    // Safety net: ask PayPal whether the buyer approved this order and, if so, capture it now (no webhook needed).
    if (method === 'POST' && (m = path.match(/^\/api\/purchases\/([\w-]+)\/reconcile$/))) {
      requireAuth(req); // can trigger a PayPal capture of a buyer-approved order
      enforceLimit(reconcileLimiter, req, 'reconcile');
      const p = store.getPurchase(m[1]);
      if (!p) throw notFound(`Purchase ${m[1]} not found`);
      const r = await gate.reconcilePurchase(p);
      return sendJson(res, 200, { purchase: r.purchase, action: r.action, paypal_status: r.paypal_status ?? null });
    }

    // ----- approvals -----
    if (method === 'GET' && path === '/api/approvals') return sendJson(res, 200, { approvals: store.listApprovals(q.get('status') ?? undefined) });
    if (method === 'POST' && (m = path.match(/^\/api\/approvals\/([\w-]+)\/(approve|reject)$/))) {
      requireAuth(req);
      const { by, note } = decided(await readJson(req));
      return sendJson(res, 200, m[2] === 'approve' ? await gate.approve(m[1], by, note) : gate.reject(m[1], by, note));
    }

    // ----- evidence -----
    if (method === 'GET' && path === '/api/evidence/verify') return sendJson(res, 200, evidence.verify());
    if (method === 'GET' && path === '/api/evidence') {
      return sendJson(res, 200, evidence.list({
        after_seq: Number(q.get('after_seq') ?? 0) || 0, limit: Number(q.get('limit') ?? 100) || 100,
        purchase_id: q.get('purchase_id') ?? undefined, order_id: q.get('order_id') ?? undefined, mandate_id: q.get('mandate_id') ?? undefined,
      }));
    }
    if (method === 'GET' && (m = path.match(/^\/api\/evidence\/([\w-]+)$/))) {
      const r = evidence.get(m[1]);
      if (!r) throw notFound(`Evidence record ${m[1]} not found`);
      return sendJson(res, 200, r);
    }

    // ----- disputes -----
    if (method === 'GET' && path === '/api/disputes') return sendJson(res, 200, { disputes: store.listDisputes() });
    if (method === 'POST' && path === '/api/disputes/sync') {
      const list = await disputes.sync();
      return sendJson(res, 200, { synced: list.length, disputes: list });
    }
    if (method === 'POST' && path === '/api/disputes/simulate') {
      requireAuth(req);
      const b = await readJson(req);
      if (typeof b.purchase_id !== 'string' || !b.purchase_id) throw badRequest('purchase_id is required');
      return sendJson(res, 201, disputes.simulate(b.purchase_id, typeof b.reason === 'string' ? b.reason : undefined));
    }
    if (method === 'GET' && (m = path.match(/^\/api\/disputes\/([\w-]+)$/))) {
      const d = store.getDispute(m[1]);
      if (!d) throw notFound(`Dispute ${m[1]} not found`);
      return sendJson(res, 200, d);
    }
    if (method === 'POST' && (m = path.match(/^\/api\/disputes\/([\w-]+)\/assemble$/))) return sendJson(res, 200, await disputes.assemble(m[1]));
    if (method === 'POST' && (m = path.match(/^\/api\/disputes\/([\w-]+)\/submit$/))) {
      requireAuth(req);
      const { by } = decided(await readJson(req));
      return sendJson(res, 200, await disputes.submit(m[1], by));
    }

    // ----- webhooks + stream -----
    if (method === 'GET' && path === '/api/webhooks') return sendJson(res, 200, { events: store.listWebhooks(Number(q.get('limit') ?? 50) || 50) });
    if (method === 'GET' && path === '/api/stream') return serveStream(req, res);
    if (method === 'POST' && path === '/webhooks/paypal') return sendJson(res, 200, await webhooks.handle(req.headers, await readJson(req)));

    if (path.startsWith('/api/') || path.startsWith('/webhooks/')) throw notFound(`No route for ${method} ${path}`);
    if (method === 'GET' && serveStatic(path, res)) return;
    throw notFound(`No route for ${method} ${path}`);
  }

  return (req, res) => {
    // Bearer-token auth, no cookies, so a wildcard origin is safe and lets a dev UI on another port call us.
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type, authorization');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    route(req, res).catch((err) => {
      const e = err instanceof HttpError ? err : new HttpError(500, 'internal', 'Internal server error');
      if (!(err instanceof HttpError)) console.error('[server] unhandled error:', err instanceof Error ? err.stack : err);
      if (res.headersSent) { res.end(); return; }
      const extra: Record<string, string> = e.code === 'rate_limited' ? { 'retry-after': String(e.details.retry_after_seconds ?? 60) } : {};
      sendJson(res, e.status, { error: { code: e.code, message: e.message, details: e.details } }, extra);
    });
  };
}

function main(): void {
  let cfg: Config;
  try {
    cfg = loadConfig();
  } catch (err) {
    console.error(`[config] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  const services = createServices(cfg);
  createServer(buildHandler(services)).listen(cfg.port, '0.0.0.0', () => {
    console.log(`Sentry ${VERSION} listening on :${cfg.port} (paypal=${cfg.paypalEnv}/${cfg.paypalMode}, agent=${cfg.agentMode}, checkout=${cfg.checkoutMode}, webhook_verify=${cfg.webhookVerify}, reconcile=${cfg.reconcileIntervalSeconds}s)`);
  });
  if (cfg.reconcileIntervalSeconds > 0) {
    let running = false; // never overlap passes
    setInterval(() => {
      if (running) return;
      running = true;
      services.gate.reconcileAll()
        .then((r) => { if (r.captured || r.completed) console.log(`[reconcile] checked=${r.checked} captured=${r.captured} completed=${r.completed}`); })
        .catch((err) => console.error('[reconcile] pass failed:', err instanceof Error ? err.message : err))
        .finally(() => { running = false; });
    }, cfg.reconcileIntervalSeconds * 1000);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
