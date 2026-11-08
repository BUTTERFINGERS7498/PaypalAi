// Runtime configuration from env. Never log secret values.

export type PaypalMode = 'sandbox' | 'mock';
export type AgentMode = 'live' | 'mock';
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
  approvalToken: string;
  mandateSigningKey: string;
  databasePath: string;
  port: number;
  publicBaseUrl: string;
}

export const PAYPAL_SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';

function pick<T extends string>(name: string, value: string | undefined, allowed: readonly T[], fallback: T): T {
  const v = (value ?? '').trim() || fallback;
  if (!(allowed as readonly string[]).includes(v)) throw new Error(`${name} must be one of ${allowed.join(', ')} (got "${v}")`);
  return v as T;
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
    agentMode: pick('AGENT_MODE', env.AGENT_MODE, ['live', 'mock'] as const, 'live'),
    approvalToken: env.APPROVAL_TOKEN ?? '',
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
