// Runtime configuration from env. Never log secret values.
import { resolve } from 'node:path';

export type PaypalMode = 'sandbox' | 'mock';
/** live = Claude tool-calling · mock = deterministic keyword parser (tests) · engine = on-server semantic engine, no external AI */
export type AgentMode = 'live' | 'mock' | 'engine';
export type WebhookVerify = 'paypal' | 'off';
export type CheckoutMode = 'payer_approval' | 'card';

export interface Config {
  paypalEnv: 'sandbox';
  paypalMode: PaypalMode;
  paypalClientId: string;
  paypalClientSecret: string;
  paypalBuyerEmail: string;
  paypalWebhookId: string;
  webhookVerify: WebhookVerify;
  checkoutMode: CheckoutMode;
  anthropicApiKey: string;
  anthropicBaseUrl: string;
  anthropicModel: string;
  agentMode: AgentMode;
  /** Embedding model for AGENT_MODE=engine (a Hugging Face id), where it is cached, and whether it may be downloaded. */
  engineModel: string;
  engineModelDir: string;
  engineAllowDownload: boolean;
  approvalToken: string;
  /** Max agent requests per client per hour. 0 = off. Default 30 against the real sandbox, off in mock mode (tests). */
  agentRateLimitPerHour: number;
  /** Max agent requests across all clients per 24 hours (caps total model spend). 0 = off. Default 300, off in mock mode. */
  agentDailyLimit: number;
  /** Seconds between reconciliation passes that capture buyer-approved orders PayPal's webhook was slow to announce. 0 = off. */
  reconcileIntervalSeconds: number;
  mandateSigningKey: string;
  databasePath: string;
  port: number;
  publicBaseUrl: string;
}

export const PAYPAL_SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';

function pick<T extends string>(name: string, value: string | undefined, allowed: readonly T[], fallback: T): T {
  // Case-insensitive: dashboards and .env files get typed by hand ("Off", "SANDBOX"), and enum values are lowercase.
  const v = (value ?? '').trim().toLowerCase() || fallback;
  if (!(allowed as readonly string[]).includes(v)) throw new Error(`${name} must be one of ${allowed.join(', ')} (got "${v}")`);
  return v as T;
}

/** A non-negative integer from env; blank or invalid falls back to `fallback`. */
function nonNegInt(raw: string | undefined, fallback: number): number {
  const s = (raw ?? '').trim();
  if (s === '') return fallback;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if ((env.PAYPAL_ENV ?? '').trim() !== 'sandbox') {
    throw new Error('PAYPAL_ENV must be "sandbox". Mandate Ledger never talks to live PayPal.');
  }
  const port = Number(env.PORT ?? 8787);
  const okPort = Number.isFinite(port) && port > 0 ? port : 8787;
  const cfg: Config = {
    paypalEnv: 'sandbox',
    paypalMode: pick('PAYPAL_MODE', env.PAYPAL_MODE, ['sandbox', 'mock'] as const, 'sandbox'),
    paypalClientId: env.PAYPAL_CLIENT_ID ?? '',
    paypalClientSecret: env.PAYPAL_CLIENT_SECRET ?? '',
    paypalBuyerEmail: env.PAYPAL_BUYER_EMAIL ?? '',
    paypalWebhookId: env.PAYPAL_WEBHOOK_ID ?? '',
    webhookVerify: pick('WEBHOOK_VERIFY', env.WEBHOOK_VERIFY, ['paypal', 'off'] as const, 'paypal'),
    checkoutMode: pick('CHECKOUT_MODE', env.CHECKOUT_MODE, ['payer_approval', 'card'] as const, 'payer_approval'),
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? '',
    // The SDK appends /v1/messages itself, so accept either http://host:port or http://host:port/v1.
    anthropicBaseUrl: (env.ANTHROPIC_BASE_URL ?? '').trim().replace(/\/+$/, '').replace(/\/v1$/, ''),
    anthropicModel: (env.ANTHROPIC_MODEL ?? '').trim() || 'claude-sonnet-5-5',
    agentMode: pick('AGENT_MODE', env.AGENT_MODE, ['live', 'mock', 'engine'] as const, 'live'),
    engineModel: (env.ENGINE_MODEL ?? '').trim() || 'Xenova/all-MiniLM-L6-v2',
    engineModelDir: resolve(import.meta.dirname, '..', '..', (env.ENGINE_MODEL_DIR ?? '').trim() || 'models'),
    engineAllowDownload: (env.ENGINE_OFFLINE ?? '').trim() !== '1',
    approvalToken: env.APPROVAL_TOKEN ?? '',
    agentRateLimitPerHour: nonNegInt(env.AGENT_RATE_LIMIT_PER_HOUR, (env.PAYPAL_MODE ?? 'sandbox').trim().toLowerCase() === 'mock' ? 0 : 30),
    agentDailyLimit: nonNegInt(env.AGENT_DAILY_LIMIT, (env.PAYPAL_MODE ?? 'sandbox').trim().toLowerCase() === 'mock' ? 0 : 300),
    // Default: 15 s against the real sandbox, off for the in-process mock (tests drive it explicitly).
    reconcileIntervalSeconds: (() => {
      const raw = (env.RECONCILE_INTERVAL_SECONDS ?? '').trim();
      if (raw !== '') { const n = Number(raw); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 15; }
      return (env.PAYPAL_MODE ?? 'sandbox').trim().toLowerCase() === 'mock' ? 0 : 15;
    })(),
    mandateSigningKey: (env.MANDATE_SIGNING_KEY ?? '').trim(),
    databasePath: (env.DATABASE_PATH ?? '').trim() || './data/mandate.db',
    port: okPort,
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? '').trim() || `http://localhost:${okPort}`,
  };
  const missing: string[] = [];
  if (cfg.paypalMode === 'sandbox') {
    if (!cfg.paypalClientId) missing.push('PAYPAL_CLIENT_ID');
    if (!cfg.paypalClientSecret) missing.push('PAYPAL_CLIENT_SECRET');
  }
  if (cfg.webhookVerify === 'paypal' && cfg.paypalMode === 'sandbox' && !cfg.paypalWebhookId) missing.push('PAYPAL_WEBHOOK_ID');
  if (cfg.agentMode === 'live' && !cfg.anthropicApiKey) missing.push('ANTHROPIC_API_KEY');
  if (missing.length) {
    throw new Error(`Missing required env: ${missing.join(', ')}. See .env.example (or use PAYPAL_MODE=mock AGENT_MODE=mock WEBHOOK_VERIFY=off).`);
  }
  return cfg;
}
