// Demo seed adapter, called by scripts/seed.ts (platform) with an already schema-initialised database.
// Uses the app's OWN signing and evidence recorder, makes no network calls, and is idempotent: stable ids,
// nothing existing is ever deleted or rewritten. All PayPal ids it writes are obviously synthetic.
import type { DatabaseSync } from 'node:sqlite';
import { createServices } from './app.ts';
import { loadConfig } from './config.ts';
import { centsToMoney, toCents } from './util.ts';

export const SEED_MANDATE_ID = 'm_seed_groceries';

const HISTORY = [
  { id: 'pur_seed_001', sku: 'GRO-COFFEE-01', rationale: 'only coffee beans in the catalog', order: 'ORD-SEED-0001', capture: 'CAP-SEED-0001' },
  { id: 'pur_seed_002', sku: 'GRO-APPLE-01', rationale: 'cheapest fresh fruit option', order: 'ORD-SEED-0002', capture: 'CAP-SEED-0002' },
  { id: 'pur_seed_003', sku: 'GRO-OAT-01', rationale: 'cheapest in-category match', order: 'ORD-SEED-0003', capture: 'CAP-SEED-0003' },
] as const;

export async function seedDemo(db: DatabaseSync): Promise<{ mandate_id: string; purchases_added: number }> {
  // A throwaway mock-mode config: seeding never needs credentials. The signing key still comes from
  // MANDATE_SIGNING_KEY if set, else from the database (same as the running server).
  const cfg = loadConfig({
    PAYPAL_ENV: 'sandbox', PAYPAL_MODE: 'mock', AGENT_MODE: 'mock', WEBHOOK_VERIFY: 'off',
    MANDATE_SIGNING_KEY: process.env.MANDATE_SIGNING_KEY ?? '',
  } as NodeJS.ProcessEnv);
  const s = createServices(cfg, db);

  const mandate = s.mandates.get(SEED_MANDATE_ID) ?? s.mandates.create({
    id: SEED_MANDATE_ID,
    label: 'Groceries, $200/month',
    owner: 'demo-user',
    limits: { monthly_cap: '200.00', categories: ['groceries'], approval_above: '75.00' },
  });

  let added = 0;
  for (const h of HISTORY) {
    if (s.store.getPurchase(h.id)) continue; // idempotent
    const item = s.store.getItem(h.sku);
    if (!item) throw new Error(`Seed catalog item ${h.sku} is missing`);
    const price = toCents(item.price.value);
    const spent = s.store.spentCents(mandate.id);
    const snap = s.mandates.snapshot(s.mandates.require(mandate.id));
    const purchase = s.store.insertPurchase({
      id: h.id, mandate_id: mandate.id, mandate_version: mandate.version, sku: item.sku, item_name: item.name, category: item.category,
      amount: { currency_code: item.price.currency_code, value: item.price.value }, status: 'awaiting_payer',
      within_mandate: true, breaches: [], demo_rogue: false, request_id: null,
    });
    const common = { mandate: snap, purchase_id: purchase.id, choice: { sku: item.sku, price: item.price.value }, within_mandate: true, breaches: [] as string[] };
    s.evidence.append({
      ...common, decision: 'selected', user_instruction: '(synthetic seed history)',
      options_seen: [{ sku: item.sku, name: item.name, category: item.category, price: item.price.value }],
      rationale: h.rationale, budget_before: centsToMoney(spent), budget_after: centsToMoney(spent + price), data: { synthetic: true },
    });
    s.store.updatePurchase(purchase.id, { paypal_order_id: h.order });
    s.evidence.append({
      ...common, decision: 'order_created', paypal_order_id: h.order, budget_before: centsToMoney(spent + price), budget_after: centsToMoney(spent + price),
      data: { synthetic: true, authorised_by: 'mandate', paypal_mode: 'seed' },
    });
    s.store.updatePurchase(purchase.id, { status: 'completed', paypal_capture_id: h.capture, completed_at: new Date().toISOString() });
    s.evidence.append({
      ...common, decision: 'captured', paypal_order_id: h.order, budget_before: centsToMoney(spent + price), budget_after: centsToMoney(spent + price),
      data: { synthetic: true, paypal_capture_id: h.capture },
    });
    added += 1;
  }
  return { mandate_id: mandate.id, purchases_added: added };
}
