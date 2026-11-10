"use client";
import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { DECISION_LABEL, fmtMoney, fmtTime, short } from "../lib/format";
import { useStore } from "../lib/store";
import type { ChainVerify, EvidenceRecord } from "../lib/types";
import { Chip, Flags, Notice, Section, StatusChip, useAction } from "./ui";

function Record({ r, index }: { r: EvidenceRecord; index: number }) {
  const agent = ["selected", "needs_approval", "blocked", "no_match"].includes(r.decision);
  return (
    <li className="sx-link" style={{ ["--i" as string]: index } as CSSProperties} aria-label={`Step ${index + 1}: ${DECISION_LABEL[r.decision] ?? r.decision}`}>
      <div className="sx-rail-line" aria-hidden="true">
        <span className={`sx-node ${r.within_mandate ? "" : "bad"}`}>{index + 1}</span>
        <span className="sx-wire" />
      </div>
      <div className="sx-rec">
      <div className="sx-rec-head">
        <div>
          <h4>{DECISION_LABEL[r.decision] ?? r.decision}</h4>
          <div className="muted small">{fmtTime(r.timestamp)} · seq {r.seq} · <span className="mono">{r.record_id}</span></div>
        </div>
        <Flags within={r.within_mandate} breaches={r.breaches} rogue={r.demo_rogue} stamp />
      </div>

      {agent && r.user_instruction && (
        <p><span className="lbl">Instruction</span> “{r.user_instruction}”</p>
      )}

      {r.options_seen.length > 0 && (
        <div className="sx-table-wrap">
          <table>
            <caption className="lbl">Options the agent saw</caption>
            <thead><tr><th scope="col">SKU</th><th scope="col">Item</th><th scope="col">Category</th><th scope="col" className="num">Price (USD)</th><th scope="col">Chosen</th></tr></thead>
            <tbody>
              {r.options_seen.map((o) => (
                <tr key={o.sku} className={r.choice?.sku === o.sku ? "picked" : ""}>
                  <td className="mono">{o.sku}</td><td>{o.name}</td><td>{o.category}</td><td className="num">{o.price}</td>
                  <td>{r.choice?.sku === o.sku ? "✔ chosen" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {r.choice && <p><span className="lbl">Choice</span> {r.choice.sku} at USD {r.choice.price}</p>}
      {r.rationale && <p><span className="lbl">Rationale</span> {r.rationale}</p>}
      {agent && (
        <p><span className="lbl">Budget</span> USD {r.budget_before} → USD {r.budget_after} <span className="muted small">(after = spend if the choice executes)</span></p>
      )}
      <p>
        <span className="lbl">Mandate</span> <span className="mono">{r.mandate.id}</span> v{r.mandate.version} ({r.mandate.status}) · cap USD {r.mandate.limits.monthly_cap}, {r.mandate.limits.categories.join(", ")}, approval &gt; USD {r.mandate.limits.approval_above}
        <span className="muted small"> · signature <span className="mono">{short(r.mandate.signature, 12)}</span></span>
      </p>
      {r.paypal_order_id && <p><span className="lbl">PayPal sandbox order</span> <span className="mono">{r.paypal_order_id}</span></p>}
      {Object.keys(r.data).length > 0 && <p><span className="lbl">Details</span> <span className="mono small">{JSON.stringify(r.data)}</span></p>}
      <div className="sx-hash small">
        <span className="lbl">hash</span><span className="mono" title={r.hash}>{short(r.hash, 12)}</span>
        <span className="lbl">prev_hash</span><span className="mono" title={r.prev_hash}>{short(r.prev_hash, 12)}</span>
      </div>
      </div>
    </li>
  );
}

export default function EvidenceView() {
  const { api, purchases, focusPurchase, go, lastEvidence } = useStore();
  const [pid, setPid] = useState<string>("");
  const [records, setRecords] = useState<EvidenceRecord[]>([]);
  const [trailValid, setTrailValid] = useState<boolean | null>(null);
  const [chain, setChain] = useState<ChainVerify | null>(null);
  const load = useAction();
  const verify = useAction();
  const current = pid || focusPurchase || purchases[0]?.id || "";
  const purchase = purchases.find((p) => p.id === current);

  const fetchTrail = useCallback(async () => {
    if (!current) return;
    const r = await load.run(() => api.purchaseEvidence(current));
    if (r) {
      setRecords(r.records);
      setTrailValid(r.chain_valid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, current]);

  useEffect(() => {
    setRecords([]);
    setTrailValid(null);
    void fetchTrail();
  }, [fetchTrail]);

  // Live: refetch when a record for this purchase is appended.
  useEffect(() => {
    if (lastEvidence && lastEvidence.purchase_id === current) void fetchTrail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEvidence]);

  return (
    <div className="stack">
      <Section id="evd-h" title="Evidence trail">
        <p className="muted">Every agent decision writes one append-only, hash-chained record, oldest first. Each hash covers the previous one, so editing history is detectable.</p>
        <div className="sx-form">
          <label htmlFor="evd-purchase">Purchase</label>
          <select id="evd-purchase" value={current} onChange={(e) => setPid(e.target.value)}>
            {purchases.length === 0 && <option value="">No purchases yet</option>}
            {purchases.map((p) => (
              <option key={p.id} value={p.id}>{p.item_name} · {fmtMoney(p.amount)} · {p.id}</option>
            ))}
          </select>
        </div>
        {purchase && (
          <div className="row wrap">
            <StatusChip status={purchase.status} />
            <Flags within={purchase.within_mandate} breaches={purchase.breaches} rogue={purchase.demo_rogue} />
            {trailValid !== null && (
              <Chip tone={trailValid ? "ok" : "bad"}>{trailValid ? "✔ Chain valid for this trail" : "✖ Chain INVALID"}</Chip>
            )}
            <button className="sx-btn" disabled={verify.busy} onClick={async () => { const r = await verify.run(() => api.verifyChain()); if (r) setChain(r); }}>
              {verify.busy ? "Verifying…" : "Verify whole chain"}
            </button>
            <button className="sx-btn" onClick={() => go("disputes")}>Go to disputes</button>
          </div>
        )}
        {verify.error && <Notice kind="error">{verify.error}</Notice>}
        {chain && (
          <Notice kind={chain.valid ? "ok" : "error"}>
            {chain.valid
              ? `Whole chain valid: ${chain.checked} records checked, head ${short(chain.head_hash, 12)}.`
              : `Chain BROKEN at seq ${chain.broken_at_seq}. Records after that point cannot be trusted.`}
          </Notice>
        )}
        {load.error && <Notice kind="error">{load.error}</Notice>}
      </Section>

      {purchase && records.length === 0 && !load.busy && !load.error && <Notice kind="info">No evidence records for this purchase.</Notice>}
      <ol className={`sx-chain ${chain?.valid ? "verified" : ""}`}>
        {records.map((r, i) => <Record key={r.record_id} r={r} index={i} />)}
      </ol>
    </div>
  );
}
