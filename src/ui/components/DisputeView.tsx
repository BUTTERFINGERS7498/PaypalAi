"use client";
import { useState } from "react";
import { fmtMoney, fmtTime, short } from "../lib/format";
import { useStore } from "../lib/store";
import type { Dispute } from "../lib/types";
import { Chip, Notice, Section, Stamp, useAction } from "./ui";

function DisputeCard({ d }: { d: Dispute }) {
  const { api, operator, go } = useStore();
  const act = useAction();
  const pk = d.packet;
  const submitted = d.status === "submitted" || d.status === "resolved";
  const breach = pk?.verdict === "MANDATE_BREACH";
  return (
    <article className="sx-doc" aria-label={`Dispute ${d.id}`}>
      <header className="sx-doc-head">
        <div>
          <span className="sx-kicker">Case file</span>
          <h3 className="sx-big" style={{ fontSize: "1.4rem" }}>{d.paypal_dispute_id ?? d.id}</h3>
          <p className="muted mono">{d.id} · purchase {d.purchase_id ?? "—"}</p>
        </div>
        <span className="row wrap">
          {d.simulated && (
            <Chip tone="demo" title="Created locally; it did not come from PayPal">SIMULATED dispute (not from PayPal)</Chip>
          )}
          <Chip tone={submitted ? "ok" : "info"}>{d.status.replace("_", " ")}</Chip>
        </span>
      </header>
      <dl className="sx-kv">
        <dt>Reason</dt><dd>{d.reason}</dd>
        <dt>Amount</dt><dd>{fmtMoney(d.amount)}</dd>
        <dt>Opened</dt><dd>{fmtTime(d.created_at)}</dd>
      </dl>

      <div className="row wrap">
        <button className="sx-btn primary" disabled={act.busy || submitted} onClick={() => act.run(() => api.assembleDispute(d.id))}>
          {act.busy ? "Working…" : pk ? "Re-assemble evidence" : "Assemble evidence"}
        </button>
        <button className="sx-btn" disabled={act.busy || !pk || submitted} onClick={() => act.run(() => api.submitDispute(d.id, { decided_by: operator }))}>
          Submit response
        </button>
        {d.purchase_id && <button className="sx-btn" onClick={() => go("evidence", d.purchase_id!)}>View evidence trail</button>}
      </div>
      {act.error && <Notice kind="error">{act.error}</Notice>}

      {pk && (
        <div>
          <div className={`sx-verdict ${breach ? "bad" : "ok"}`}>
            <Stamp tone={breach ? "bad" : "ok"} large pop tilt={-4}>{breach ? "MANDATE BREACH" : "DEFENSIBLE"}</Stamp>
            <p style={{ margin: "10px 0 2px" }}>
              <span className="lbl">Response action</span>{" "}
              {pk.action === "accept_claim"
                ? "Accept the claim. The agent overstepped its mandate, so we report that honestly instead of contesting."
                : "Provide evidence to PayPal."}
            </p>
            <p className="small muted">Verdict is computed by code from the evidence; the AI only writes the narrative.</p>
            <div className="row wrap" style={{ justifyContent: "center" }}>
              <Chip tone={pk.chain_valid ? "ok" : "bad"}>{pk.chain_valid ? "✔ Evidence chain valid" : "✖ Evidence chain INVALID"}</Chip>
            </div>
          </div>
          <p><span className="lbl">Summary</span> {pk.summary}</p>
          <h4>Narrative</h4>
          <p className="sx-letter">{pk.narrative}</p>
          <p className="small">
            <span className="lbl">Evidence records</span>{" "}
            {pk.evidence_record_ids.map((id) => <span key={id} className="mono tag">{short(id, 14)}</span>)}
          </p>
          <p className="small muted">Assembled {fmtTime(pk.assembled_at)}{pk.submitted_at ? ` · submitted ${fmtTime(pk.submitted_at)}` : " · not yet submitted"}</p>
          {pk.paypal_response != null && (
            <p className="small">
              <span className="lbl">PayPal response</span>{" "}
              {(pk.paypal_response as { simulated?: boolean }).simulated
                ? "Simulated: no call was made to PayPal."
                : <span className="mono">{JSON.stringify(pk.paypal_response)}</span>}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

export default function DisputeView() {
  const { api, disputes, purchases, refresh } = useStore();
  const eligible = purchases.filter((p) => p.status === "completed");
  const [pid, setPid] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const sync = useAction();
  const sim = useAction();
  const chosen = pid && eligible.some((p) => p.id === pid) ? pid : eligible[0]?.id ?? "";
  const current = disputes.find((d) => d.id === openId) ?? disputes[0];
  return (
    <div className="stack">
      <Section id="dsp-h" title="Dispute console">
        <p className="muted">
          When a buyer disputes a payment, assemble the agent’s decision trail into a response. If the agent overstepped its mandate, the honest verdict is MANDATE BREACH and the claim is accepted.
        </p>
        <div className="row wrap">
          <button className="sx-btn" disabled={sync.busy} onClick={async () => { await sync.run(() => api.syncDisputes()); await refresh(); }}>
            {sync.busy ? "Syncing…" : "Sync disputes from PayPal sandbox"}
          </button>
        </div>
        {sync.error && <Notice kind="warn">{sync.error} You can create a clearly labelled simulated dispute below.</Notice>}
        <div className="sx-sub">
          <h3>Simulate a dispute (fallback)</h3>
          <p className="muted small">Creates a local dispute labelled SIMULATED. It is never presented as coming from PayPal.</p>
          <div className="sx-form">
            <label htmlFor="sim-purchase">Completed purchase</label>
            <select id="sim-purchase" value={chosen} onChange={(e) => setPid(e.target.value)}>
              {eligible.length === 0 && <option value="">No completed purchases</option>}
              {eligible.map((p) => <option key={p.id} value={p.id}>{p.item_name} · {fmtMoney(p.amount)} · {p.id}{p.within_mandate ? "" : " (outside mandate)"}</option>)}
            </select>
          </div>
          <button className="sx-btn" disabled={sim.busy || !chosen} onClick={() => sim.run(() => api.simulateDispute({ purchase_id: chosen }))}>
            Create simulated dispute
          </button>
          {sim.error && <Notice kind="error">{sim.error}</Notice>}
        </div>
      </Section>
      {disputes.length === 0 && <Notice kind="info">No disputes yet.</Notice>}
      {current && (
        <div className="sx-case">
          <div className="sx-caselist" role="list" aria-label="Disputes">
            {disputes.map((d) => (
              <button key={d.id} role="listitem" className="sx-caseitem" aria-current={d.id === current.id} onClick={() => setOpenId(d.id)}>
                <span className="row spread">
                  <strong>{d.paypal_dispute_id ?? d.id}</strong>
                  <span>{fmtMoney(d.amount)}</span>
                </span>
                <span className="small muted">{d.reason}</span>
                <span className="row wrap">
                  <Chip tone={d.status === "submitted" || d.status === "resolved" ? "ok" : "info"}>{d.status.replace("_", " ")}</Chip>
                  {d.packet && (
                    <Stamp tone={d.packet.verdict === "MANDATE_BREACH" ? "bad" : "ok"} tilt={-2}>{d.packet.verdict === "MANDATE_BREACH" ? "breach" : "defensible"}</Stamp>
                  )}
                </span>
              </button>
            ))}
          </div>
          <DisputeCard key={current.id} d={current} />
        </div>
      )}
    </div>
  );
}
