"use client";
// Feature B8: the merchant's side. Before shipping an order placed by someone's AI agent, the merchant checks the
// proof: the signed mandate (the exact version that governed the purchase), the evidence chain, whether the purchase
// was inside the mandate, and whether the payment is captured. Read-only.
import { useState } from "react";
import { fmtMoney, fmtTime, short } from "../lib/format";
import { useStore } from "../lib/store";
import type { Purchase, PurchaseProof } from "../lib/types";
import { Chip, Notice, Section, Stamp, StatusChip, useAction } from "./ui";

const LABEL: Record<PurchaseProof["recommendation"], { text: string; tone: "ok" | "warn" | "bad" }> = {
  ship: { text: "Ship it", tone: "ok" },
  wait: { text: "Wait", tone: "warn" },
  do_not_ship: { text: "Do not ship", tone: "bad" },
};

function OrderCard({ p, proof, onCheck, busy }: { p: Purchase; proof: PurchaseProof | undefined; onCheck: () => void; busy: boolean }) {
  const { go } = useStore();
  return (
    <article className={`sx-rcpt ${proof?.recommendation === "do_not_ship" ? "breach" : ""}`} aria-label={`Order ${p.item_name}`}>
      <div className="row spread">
        <span className="sx-kicker">{fmtTime(p.created_at)}</span>
        <StatusChip status={p.status} />
      </div>
      <h3 style={{ margin: "8px 0 2px" }}>{p.item_name}</h3>
      <p className="muted small mono">PayPal order {p.paypal_order_id ?? "—"}</p>
      <div className="amt">{fmtMoney(p.amount)}</div>
      <hr />
      {proof ? (
        <div className="stack" style={{ gap: 8 }}>
          <div className="stampzone"><Stamp tone={LABEL[proof.recommendation].tone} large pop>{LABEL[proof.recommendation].text}</Stamp></div>
          <div className="row wrap" style={{ gap: 6 }}>
            <Chip tone={proof.mandate.signature.valid ? "ok" : "bad"}>{proof.mandate.signature.valid ? "✔" : "✖"} mandate v{proof.mandate.version} signature</Chip>
            <Chip tone={proof.chain.valid ? "ok" : "bad"}>{proof.chain.valid ? "✔" : "✖"} evidence chain</Chip>
            <Chip tone={proof.purchase.within_mandate ? "ok" : "bad"}>{proof.purchase.within_mandate ? "✔ inside" : "✖ outside"} the mandate</Chip>
            <Chip tone={proof.purchase.status === "completed" ? "ok" : "warn"}>{proof.purchase.status === "completed" ? "✔ paid" : "not paid yet"}</Chip>
          </div>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {proof.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
          <p className="small muted" style={{ margin: 0 }}>
            {proof.evidence.count} evidence records · last hash <span className="mono">{short(proof.evidence.last_hash, 12)}</span>
          </p>
        </div>
      ) : (
        <p className="small muted">Not checked yet.</p>
      )}
      <div className="row wrap" style={{ marginTop: 10 }}>
        <button className="sx-btn sm primary" disabled={busy} onClick={onCheck}>{proof ? "Check again" : "Check proof"}</button>
        <button className="sx-btn sm" onClick={() => go("evidence", p.id)}>Evidence</button>
      </div>
    </article>
  );
}

export default function MerchantView() {
  const { api, purchases } = useStore();
  const orders = purchases.filter((p) => p.paypal_order_id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const [proofs, setProofs] = useState<Record<string, PurchaseProof>>({});
  const act = useAction();
  const check = async (ids: string[]) => {
    await act.run(async () => {
      const got = await Promise.all(ids.map((id) => api.purchaseProof(id)));
      setProofs((cur) => ({ ...cur, ...Object.fromEntries(got.map((g) => [g.purchase.id, g])) }));
    });
  };
  return (
    <div className="stack">
      <Section id="merchant-h" title="Orders placed by AI agents" actions={
        <button className="sx-btn primary" disabled={act.busy || !orders.length} onClick={() => check(orders.map((o) => o.id))}>{act.busy ? "Checking…" : "Check all"}</button>
      }>
        <p className="muted">
          You sell to people whose AI agents shop for them. Before you ship, check the proof that came with each order:
          the buyer&apos;s signed mandate, the hash-chained evidence of the agent&apos;s decision, and the PayPal payment.
          An order the agent placed outside its mandate is the one most likely to come back as a dispute.
        </p>
        {act.error && <Notice kind="error">{act.error}</Notice>}
        {orders.length === 0 && <p className="muted">No agent orders yet.</p>}
      </Section>
      <div className="sx-rcpts">
        {orders.map((p) => <OrderCard key={p.id} p={p} proof={proofs[p.id]} busy={act.busy} onCheck={() => check([p.id])} />)}
      </div>
    </div>
  );
}
