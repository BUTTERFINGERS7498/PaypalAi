// Composition root. `createServices` is also what scripts/seed.ts imports, so seeded mandates are
// signed and seeded evidence is hash-chained by exactly the same code the server runs.
import { ShoppingAgent } from './agent.ts';
import type { Config } from './config.ts';
import { openDb, type Db } from './db.ts';
import { DisputeService } from './disputes.ts';
import { SemanticEngine } from './engine.ts';
import { EventBus } from './events.ts';
import { EvidenceLog } from './evidence.ts';
import { Gate } from './gate.ts';
import { MandateService } from './mandates.ts';
import { MockPaypalClient } from './paypal/mock.ts';
import { SandboxPaypalClient } from './paypal/sandbox.ts';
import type { PaypalClient } from './paypal/types.ts';
import { Signer } from './signing.ts';
import { Store } from './store.ts';
import { WebhookHandler } from './webhooks.ts';

/** Pass `existingDb` (already schema-initialised) to reuse a connection, as the seed adapter does. */
export function createServices(cfg: Config, existingDb?: Db) {
  const db = existingDb ?? openDb(cfg.databasePath);
  const bus = new EventBus();
  const store = new Store(db, bus);
  const evidence = new EvidenceLog(db, bus);
  const signer = new Signer(db, cfg.mandateSigningKey);
  const mandates = new MandateService(db, bus, signer, evidence, store);
  const paypal: PaypalClient = cfg.paypalMode === 'mock'
    ? new MockPaypalClient()
    : new SandboxPaypalClient({
      clientId: cfg.paypalClientId, clientSecret: cfg.paypalClientSecret, checkoutMode: cfg.checkoutMode,
      returnBaseUrl: cfg.publicBaseUrl, webhookId: cfg.paypalWebhookId,
    });
  const gate = new Gate(store, paypal, mandates, evidence, cfg);
  // The semantic engine loads its model in the background so the server starts at once; until it is ready it answers
  // with the keyword fallback.
  const engine = cfg.agentMode === 'engine'
    ? new SemanticEngine({ model: cfg.engineModel, modelDir: cfg.engineModelDir, allowDownload: cfg.engineAllowDownload })
    : undefined;
  void engine?.warmup();
  const agent = new ShoppingAgent(store, mandates, gate, evidence, cfg, engine);
  const disputes = new DisputeService(store, evidence, gate, paypal, cfg);
  const webhooks = new WebhookHandler(store, paypal, gate, disputes, cfg);
  return { cfg, db, bus, store, evidence, signer, mandates, paypal, gate, agent, disputes, webhooks, engine };
}

export type Services = ReturnType<typeof createServices>;
