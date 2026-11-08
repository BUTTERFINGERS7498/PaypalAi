// Tests for the on-server semantic engine (AGENT_MODE=engine). In-process: no child server needed.
// Tests that need the embedding model skip (with a reason) when it has not been downloaded: run `npm run build:engine`.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServices } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { keywordRank, MIN_SIMILARITY, parseIntent, SemanticEngine } from '../src/server/engine.ts';

const ITEMS: [string, string, string, string][] = [
  ['GRO-OAT-01', 'Rolled oats 1kg', 'groceries', '4.50'], ['GRO-RICE-01', 'Long grain rice 2kg', 'groceries', '8.00'],
  ['GRO-BEAN-01', 'Black beans 400g', 'groceries', '2.00'], ['GRO-MILK-01', 'Oat milk 1L', 'groceries', '3.50'],
  ['GRO-PASTA-01', 'Pasta 500g', 'groceries', '2.75'], ['GRO-APPLE-01', 'Apples 1kg', 'groceries', '5.00'],
  ['GRO-COFFEE-01', 'Coffee beans 1kg', 'groceries', '18.00'], ['GRO-PANTRY-42', 'Pantry basics bundle', 'groceries', '42.00'],
  ['GRO-PANTRY-51', 'Pantry basics premium bundle', 'groceries', '51.00'], ['GRO-OIL-01', 'Olive oil gift set', 'groceries', '60.00'],
  ['ELE-ESP-01', 'Espresso machine', 'electronics', '129.00'], ['ELE-GAME-01', 'Games console', 'electronics', '299.00'],
  ['ELE-HEAD-01', 'Wireless headphones', 'electronics', '39.00'], ['HOU-CLEAN-01', 'Household cleaning kit', 'household', '18.50'],
];

function boot(env: Record<string, string> = {}) {
  const cfg = loadConfig({
    PAYPAL_ENV: 'sandbox', PAYPAL_MODE: 'mock', AGENT_MODE: 'engine', WEBHOOK_VERIFY: 'off', DATABASE_PATH: ':memory:',
    ENGINE_OFFLINE: '1', // never touch the network from a test
    ...env,
  });
  const s = createServices(cfg);
  const ins = s.db.prepare("INSERT INTO catalog_items (sku,name,category,price_value,currency_code,merchant) VALUES (?, ?, ?, ?, 'USD', 'Demo')");
  for (const [sku, name, cat, price] of ITEMS) ins.run(sku, name, cat, price);
  const mandate = s.mandates.create({ label: 'groceries', limits: { monthly_cap: '500', categories: ['groceries'], approval_above: '400' } });
  return { s, mandate, items: s.store.listCatalog() };
}

test('parseIntent: explicit SKUs, price caps and false positives', () => {
  assert.equal(parseIntent('buy sku gro-oat-01').sku, 'GRO-OAT-01');
  assert.equal(parseIntent('coffee under $20').maxCents, 2000);
  assert.equal(parseIntent('something for $30').maxCents, 3000);
  assert.equal(parseIntent('headphones $15 or less').maxCents, 1500);
  assert.equal(parseIntent('at most 12.50 of pasta').maxCents, 1250);
  assert.equal(parseIntent('coffee for 2 people').maxCents, null, 'a bare "for 2" is not a price');
  assert.equal(parseIntent('under 5kg of rice').maxCents, null, 'a weight is not a price');
  assert.equal(parseIntent('restock the pantry basics').maxCents, null);
  assert.equal(parseIntent('buy coffee under $20').query, 'buy coffee', 'the price phrase is removed from what gets embedded');
  assert.equal(parseIntent('restock the pantry basics').hasVerb, true);
  assert.equal(parseIntent('breakfast stuff').hasVerb, false);
});

test('engine mode is accepted case-insensitively and needs no API key', () => {
  const c = loadConfig({ PAYPAL_ENV: 'sandbox', PAYPAL_MODE: 'mock', AGENT_MODE: 'Engine' });
  assert.equal(c.agentMode, 'engine');
  assert.throws(() => loadConfig({ PAYPAL_ENV: 'sandbox', PAYPAL_MODE: 'mock', AGENT_MODE: 'live' }), /ANTHROPIC_API_KEY/);
});

test('keyword fallback works when the model cannot load, and says so in the rationale', async () => {
  const { s, items } = boot({ ENGINE_MODEL: 'no-such-org/no-such-model' });
  await s.engine!.warmup();
  assert.equal(s.engine!.status().state, 'failed');
  assert.equal(s.engine!.status().backend, 'keyword');
  const d = await s.engine!.decide({ text: 'restock the pantry basics', items, allowedCategories: ['groceries'], rogue: false });
  assert.equal(d.kind, 'selected');
  if (d.kind === 'selected') {
    assert.equal(d.item.sku, 'GRO-PANTRY-42', 'cheapest of the near-equal keyword matches');
    assert.match(d.rationale, /Keyword match/);
  }
  const none = await s.engine!.decide({ text: 'buy a bicycle', items, allowedCategories: ['groceries'], rogue: false });
  assert.equal(none.kind, 'no_match');
  assert.ok(keywordRank('pasta', items)[0].item.sku === 'GRO-PASTA-01');
});

test('filler-only requests ask what to buy; anything with content but no match says so', async () => {
  const { s, items } = boot({ ENGINE_MODEL: 'no-such-org/no-such-model' });
  for (const q of ['please buy', 'buy', '   ']) {
    const d = await s.engine!.decide({ text: q, items, allowedCategories: ['groceries'], rogue: false });
    assert.equal(d.kind, 'needs_info', `"${q}"`);
  }
  const d = await s.engine!.decide({ text: 'a garden hose', items, allowedCategories: ['groceries'], rogue: false });
  assert.equal(d.kind, 'no_match');
  if (d.kind === 'no_match') assert.match(d.text, /garden hose/);
});

test('explicit SKU selects it; an unknown SKU is no_match', async () => {
  const { s, items } = boot({ ENGINE_MODEL: 'no-such-org/no-such-model' });
  const ok = await s.engine!.decide({ text: 'buy sku ELE-ESP-01', items, allowedCategories: ['groceries'], rogue: false });
  assert.ok(ok.kind === 'selected' && ok.item.sku === 'ELE-ESP-01');
  const bad = await s.engine!.decide({ text: 'buy sku NOPE-1', items, allowedCategories: ['groceries'], rogue: false });
  assert.equal(bad.kind, 'no_match');
});

// ---------------------------------------------------------------------------------------------------------------
// Everything below needs the real embedding model (npm run build:engine). Skipped with a reason otherwise.
// ---------------------------------------------------------------------------------------------------------------
async function withModel(t: { skip: (m?: string) => void }) {
  const b = boot();
  await b.s.engine!.warmup();
  if (b.s.engine!.status().state !== 'ready') { t.skip('embedding model not available offline: run `npm run build:engine`'); return null; }
  return b;
}

const CASES: [string, string[]][] = [
  ['restock the pantry basics', ['GRO-PANTRY-42', 'GRO-PANTRY-51']], ['breakfast stuff', ['GRO-OAT-01', 'GRO-MILK-01', 'GRO-COFFEE-01']],
  ['something for pasta night', ['GRO-PASTA-01']], ['I need to clean the house', ['HOU-CLEAN-01']], ['cheap headphones', ['ELE-HEAD-01']],
  ['coffee', ['GRO-COFFEE-01']], ['a gaming system', ['ELE-GAME-01']], ['fresh fruit', ['GRO-APPLE-01']],
  ['dinner staples like rice or beans', ['GRO-RICE-01', 'GRO-BEAN-01']], ['a milk alternative', ['GRO-MILK-01']],
  ['wireless earbuds for music', ['ELE-HEAD-01']], ['make espresso at home', ['ELE-ESP-01', 'GRO-COFFEE-01']],
  ['healthy grain for porridge', ['GRO-OAT-01']], ['a nice cooking oil gift', ['GRO-OIL-01']],
  ['something warm to drink in the morning', ['GRO-COFFEE-01']], ['tools to scrub the kitchen', ['HOU-CLEAN-01']],
  ['black beans', ['GRO-BEAN-01']], ['games console', ['ELE-GAME-01']],
];

test('semantic engine: picks an acceptable item for at least 15 of 18 hand-written requests, and beats keyword matching', async (t) => {
  const b = await withModel(t); if (!b) return;
  let hits = 0; let kwHits = 0; const misses: string[] = [];
  for (const [q, ok] of CASES) {
    const d = await b.s.engine!.decide({ text: q, items: b.items, allowedCategories: ['groceries', 'electronics', 'household'], rogue: false });
    if (d.kind === 'selected' && ok.includes(d.item.sku)) hits++; else misses.push(q);
    const k = keywordRank(parseIntent(q).query, b.items)[0];
    if (k.score >= MIN_SIMILARITY && ok.includes(k.item.sku)) kwHits++;
  }
  assert.ok(hits >= 15, `only ${hits}/18 correct; misses: ${misses.join(' | ')}`);
  assert.ok(hits > kwHits, `semantic ${hits} should beat keyword ${kwHits}`);
});

test('semantic engine: requests the catalog cannot satisfy are no_match, not a wrong purchase', async (t) => {
  const b = await withModel(t); if (!b) return;
  for (const q of ['buy a pair of running shoes', 'get some tea bags', 'I want a new laptop', 'order a bicycle', 'a garden hose', 'buy a winter jacket']) {
    const d = await b.s.engine!.decide({ text: q, items: b.items, allowedCategories: ['groceries'], rogue: false });
    assert.equal(d.kind, 'no_match', `"${q}" should not match anything, got ${d.kind === 'selected' ? d.item.name : d.kind}`);
  }
});

test('semantic engine: restock the pantry basics → GRO-PANTRY-42 with a rationale that names the match', async (t) => {
  const b = await withModel(t); if (!b) return;
  const r = await b.s.agent.handle({ mandate_id: b.mandate.id, text: 'restock the pantry basics' });
  assert.equal(r.outcome, 'awaiting_payer');
  assert.equal(r.purchase?.sku, 'GRO-PANTRY-42');
  const ev = b.s.evidence.forPurchase(r.purchase!.id).find((e) => e.decision === 'selected')!;
  assert.match(ev.rationale, /Semantic match \(all-MiniLM-L6-v2\)/);
  assert.match(ev.rationale, /similarity 0\.\d\d/);
  assert.ok(ev.options_seen.length >= 2 && ev.options_seen.some((o) => o.sku === 'GRO-PANTRY-42'));
  assert.equal(ev.within_mandate, true);
});

test('semantic engine: unrelated items that merely score close are not treated as ties', async (t) => {
  const b = await withModel(t); if (!b) return;
  const d = await b.s.engine!.decide({ text: 'breakfast stuff', items: b.items, allowedCategories: ['groceries'], rogue: false });
  assert.ok(d.kind === 'selected' && ['GRO-OAT-01', 'GRO-MILK-01', 'GRO-COFFEE-01'].includes(d.item.sku), `got ${d.kind === 'selected' ? d.item.name : d.kind}`);
});

test('semantic engine: when a price cap removes the real match it says so instead of buying a different product', async (t) => {
  const b = await withModel(t); if (!b) return;
  const d = await b.s.engine!.decide({ text: 'coffee beans under $10', items: b.items, allowedCategories: ['groceries'], rogue: false });
  assert.equal(d.kind, 'no_match', d.kind === 'selected' ? `bought ${d.item.name}` : d.kind);
  if (d.kind === 'no_match') assert.match(d.text, /Coffee beans 1kg.*\$18\.00.*\$10\.00 cap/);
  const fine = await b.s.engine!.decide({ text: 'coffee beans under $25', items: b.items, allowedCategories: ['groceries'], rogue: false });
  assert.ok(fine.kind === 'selected' && fine.item.sku === 'GRO-COFFEE-01');
});

test('semantic engine: a price cap is respected', async (t) => {
  const b = await withModel(t); if (!b) return;
  const d = await b.s.engine!.decide({ text: 'coffee beans under $10', items: b.items, allowedCategories: ['groceries'], rogue: false });
  assert.ok(d.kind !== 'selected' || Number(d.item.price.value) <= 10, 'never selects an item above the stated cap');
  const ok = await b.s.engine!.decide({ text: 'pasta under $5', items: b.items, allowedCategories: ['groceries'], rogue: false });
  assert.ok(ok.kind === 'selected' && ok.item.sku === 'GRO-PASTA-01' && /within the \$5\.00 cap/.test(ok.rationale));
});

test('the checker, not the engine, decides: an out-of-mandate pick is blocked, and only the labelled demo flag lets it through', async (t) => {
  const b = await withModel(t); if (!b) return;
  const blocked = await b.s.agent.handle({ mandate_id: b.mandate.id, text: 'buy a gaming system' });
  assert.equal(blocked.outcome, 'blocked');
  assert.equal(blocked.purchase, null);
  const ev = b.s.evidence.get(blocked.evidence_record_id!)!;
  assert.equal(ev.decision, 'blocked');
  assert.deepEqual(ev.breaches, ['category_not_allowed']);
  assert.match(ev.rationale, /outside the allowed categories/);

  const rogue = await b.s.agent.handle({ mandate_id: b.mandate.id, text: 'buy a gaming system', demo_rogue: true });
  assert.equal(rogue.purchase?.within_mandate, false);
  assert.equal(rogue.purchase?.demo_rogue, true);
  assert.deepEqual(rogue.purchase?.breaches, ['category_not_allowed']);
});

test('engine inference makes no network calls and is fast', async (t) => {
  const b = await withModel(t); if (!b) return;
  const realFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = ((...a: Parameters<typeof fetch>) => { calls++; return realFetch(...a); }) as typeof fetch;
  try {
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      await b.s.engine!.decide({ text: CASES[i % CASES.length][0], items: b.items, allowedCategories: ['groceries'], rogue: false });
      times.push(performance.now() - t0);
    }
    times.sort((a, c) => a - c);
    assert.equal(calls, 0, 'a decision must not call fetch');
    assert.ok(times[10] < 200, `median decision took ${times[10].toFixed(0)} ms`);
  } finally { globalThis.fetch = realFetch; }
});

test('engine status is reported for the health endpoint', async (t) => {
  const b = await withModel(t); if (!b) return;
  const st = (b.s.engine as SemanticEngine).status();
  assert.deepEqual([st.state, st.backend, st.model], ['ready', 'embeddings', 'Xenova/all-MiniLM-L6-v2']);
  assert.ok(typeof st.load_ms === 'number');
});
