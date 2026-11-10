// Feature B3: the dispute evidence packet as a PDF, attached to provide-evidence and downloadable.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServices } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { textPdf } from '../src/server/packet-pdf.ts';
import type { MockPaypalClient } from '../src/server/paypal/mock.ts';
import { startServer } from './helpers/server.ts';
import { orderApproved } from './helpers/webhooks.ts';

test('the PDF writer produces a well-formed single-page PDF (header, xref pointing at the table, EOF)', () => {
  const pdf = textPdf('Title (with parens)', ['line one', 'a \\ backslash and (brackets)', 'unicode → arrow']).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4\n'));
  assert.ok(pdf.trimEnd().endsWith('%%EOF'));
  const startxref = Number(pdf.match(/startxref\n(\d+)\n/)![1]);
  assert.equal(pdf.slice(startxref, startxref + 4), 'xref', 'startxref points at the xref table');
  assert.match(pdf, /\(Title \\\(with parens\\\)\) Tj/);
  assert.match(pdf, /a \\\\ backslash and \\\(brackets\\\)/);
  assert.match(pdf, /unicode -> arrow/);
});

test('answering a real PayPal dispute attaches the evidence packet PDF to provide-evidence', async () => {
  const cfg = loadConfig({ PAYPAL_ENV: 'sandbox', PAYPAL_MODE: 'mock', AGENT_MODE: 'mock', WEBHOOK_VERIFY: 'off', DATABASE_PATH: ':memory:' });
  const s = createServices(cfg);
  s.db.prepare("INSERT INTO catalog_items (sku,name,category,price_value,currency_code,merchant) VALUES ('GRO-OAT-01','Rolled oats 1kg','groceries','4.50','USD','Demo')").run();
  const m = s.mandates.create({ label: 'groceries', limits: { monthly_cap: '100', categories: ['groceries'], approval_above: '50' } });
  const r = await s.agent.handle({ mandate_id: m.id, text: 'buy sku GRO-OAT-01' });
  const p = (await s.gate.onOrderApproved(r.purchase!.paypal_order_id!))!;
  const d = s.disputes.open({ paypal_dispute_id: 'PP-D-9', simulated: false, purchase: p, reason: 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', amount: p.amount });
  await s.disputes.assemble(d.id);
  await s.disputes.submit(d.id, 'qa');
  const call = (s.paypal as MockPaypalClient).calls.find((c) => c.op === 'provide_evidence')!;
  const ev = call.detail as { notes: string; pdf: Buffer; filename: string };
  assert.equal(ev.filename, `sentry-evidence-${d.id}.pdf`);
  const text = ev.pdf.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.match(text, /DEFENSIBLE/);
  for (const rec of s.evidence.forPurchase(p.id)) assert.ok(text.includes(rec.hash), `record ${rec.seq} hash is in the PDF`);
});

test('the packet PDF can be downloaded for any dispute', async (t) => {
  const s = await startServer(t);
  const m = await s.mandate();
  const r = await s.instruct(m.id);
  await s.post('/webhooks/paypal', orderApproved(r.purchase.paypal_order_id));
  const d = await s.post('/api/disputes/simulate', { purchase_id: r.purchase.id }, 201);
  await s.post(`/api/disputes/${d.id}/assemble`);
  const res = await fetch(`${s.base}/api/disputes/${d.id}/packet.pdf`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  const body = Buffer.from(await res.arrayBuffer()).toString('latin1');
  assert.ok(body.startsWith('%PDF-1.4'));
  assert.match(body, /SIMULATED/);
  assert.equal((await fetch(`${s.base}/api/disputes/dsp_nope/packet.pdf`)).status, 404);
});
