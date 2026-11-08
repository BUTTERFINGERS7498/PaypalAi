"use client";
import { useMemo, useState } from "react";
import { AllCommunityModule, ModuleRegistry } from "ag-grid-community";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { fmtMoney, fmtTime } from "../lib/format";
import { useStore } from "../lib/store";
import type { AgentResult, Purchase } from "../lib/types";
import { Chip, Flags, Notice, Section, StatusChip, useAction } from "./ui";

ModuleRegistry.registerModules([AllCommunityModule]);

function AskAgent() {
  const { api, mandates, go } = useStore();
  const active = mandates.filter((m) => m.status === "active");
  const [mid, setMid] = useState("");
  const [text, setText] = useState("restock the pantry basics");
  const [rogue, setRogue] = useState(false);
  const [result, setResult] = useState<AgentResult | null>(null);
  const act = useAction();
  const selected = mid && active.some((m) => m.id === mid) ? mid : active[0]?.id ?? "";

  return (
    <Section id="ask-h" title="Ask the agent">
      <form
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          setResult(null);
          const r = await act.run(() => api.instruct({ mandate_id: selected, text, demo_rogue: rogue }));
          if (r) setResult(r);
        }}
      >
        <label htmlFor="agent-mandate">Mandate</label>
        <select id="agent-mandate" value={selected} onChange={(e) => setMid(e.target.value)}>
          {active.length === 0 && <option value="">No active mandate</option>}
          {active.map((m) => <option key={m.id} value={m.id}>{m.label} (v{m.version})</option>)}
        </select>
        <label htmlFor="agent-text">Instruction (plain English)</label>
        <input id="agent-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. restock the pantry basics" required />
        <div className={`rogue ${rogue ? "rogue-on" : ""}`}>
          <label className="check">
            <input type="checkbox" checked={rogue} onChange={(e) => setRogue(e.target.checked)} />
            <span><strong>Demo: let the agent break its mandate</strong></span>
          </label>
          <p className="small">
            Sandbox demo only. Turns off the guard so an out-of-mandate choice goes through (try “buy sku ELE-CON-01”). The checker still records the breach honestly and a later dispute will be a MANDATE BREACH.
          </p>
        </div>
        <div className="row">
          <button className="btn primary" disabled={act.busy || !selected || !text.trim()}>{act.busy ? "Agent is working…" : "Send to agent"}</button>
        </div>
      </form>
      {act.error && <Notice kind="error">{act.error}</Notice>}
      {result && (
        <Notice kind={result.outcome === "blocked" ? "warn" : "ok"}>
          <p>
            <Chip tone={result.outcome === "blocked" ? "bad" : "info"}>{result.outcome.replace("_", " ")}</Chip>{" "}
            {result.reply}
          </p>
          <div className="row wrap">
            {result.purchase?.approve_url && (
              <a className="btn" href={result.purchase.approve_url} target="_blank" rel="noopener noreferrer">Open PayPal to approve (sandbox)</a>
            )}
            {result.purchase && <button className="btn" onClick={() => go("evidence", result.purchase!.id)}>View evidence trail</button>}
          </div>
        </Notice>
      )}
    </Section>
  );
}

function ApprovalQueue() {
  const { api, approvals, purchases, operator, go } = useStore();
  const act = useAction();
  return (
    <Section id="appr-h" title={`Approval queue (${approvals.length})`}>
      {approvals.length === 0 && <p className="muted">Nothing waiting for approval. Purchases above the mandate’s approval threshold appear here.</p>}
      {act.error && <Notice kind="error">{act.error}</Notice>}
      <ul className="plain">
        {approvals.map((a) => {
          const p = purchases.find((x) => x.id === a.purchase_id);
          return (
            <li key={a.id} className="approval">
              <div>
                <strong>{a.summary}</strong>
                <div className="muted small">
                  {a.reasons.join(", ")} · requested {fmtTime(a.created_at)} · decision recorded as “{operator}”
                </div>
              </div>
              <div className="row wrap">
                <button className="btn primary" disabled={act.busy} onClick={() => act.run(() => api.decideApproval(a.id, "approve", { decided_by: operator }))}>Approve</button>
                <button className="btn danger" disabled={act.busy} onClick={() => act.run(() => api.decideApproval(a.id, "reject", { decided_by: operator }))}>Reject</button>
                {p && <button className="btn" onClick={() => go("evidence", p.id)}>Evidence</button>}
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export default function LedgerView() {
  const { purchases, mandates, go, live, api } = useStore();
  const [sel, setSel] = useState<string | null>(null);
  const label = (id: string) => mandates.find((m) => m.id === id)?.label ?? id;

  const cols = useMemo<ColDef<Purchase>[]>(
    () => [
      { headerName: "Time", field: "created_at", valueFormatter: (p) => fmtTime(p.value as string), width: 190, sort: "desc" },
      { headerName: "Item", field: "item_name", flex: 1, minWidth: 160, tooltipField: "sku" },
      { headerName: "Amount", valueGetter: (p) => fmtMoney(p.data?.amount), width: 120 },
      { headerName: "Status", field: "status", width: 170, cellRenderer: (p: ICellRendererParams<Purchase>) => (p.data ? <StatusChip status={p.data.status} /> : null) },
      {
        headerName: "Mandate check",
        minWidth: 260,
        flex: 1.2,
        autoHeight: true,
        wrapText: true,
        cellRenderer: (p: ICellRendererParams<Purchase>) =>
          p.data ? <Flags within={p.data.within_mandate} breaches={p.data.breaches} rogue={p.data.demo_rogue} /> : null,
      },
      { headerName: "Mandate", valueGetter: (p) => (p.data ? `${label(p.data.mandate_id)} v${p.data.mandate_version}` : ""), minWidth: 180 },
      {
        headerName: "Actions",
        width: 270,
        sortable: false,
        cellRenderer: (p: ICellRendererParams<Purchase>) =>
          p.data ? (
            <span className="row">
              <button className="btn small-btn" onClick={() => go("evidence", p.data!.id)}>Evidence</button>
              {p.data.status === "awaiting_payer" && p.data.approve_url && (
                <a className="btn small-btn" href={p.data.approve_url} target="_blank" rel="noopener noreferrer">Open PayPal to approve</a>
              )}
            </span>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mandates],
  );

  return (
    <div className="stack">
      <AskAgent />
      <ApprovalQueue />
      <Section
        id="ledger-h"
        title="Purchase ledger"
        actions={<Chip tone={live ? "ok" : "neutral"} title="Rows update as server-sent events arrive">{api.kind === "mock" ? "Live (mock events)" : live ? "Live (SSE)" : "Connecting…"}</Chip>}
      >
        {purchases.length === 0 && <p className="muted">No purchases yet. Send an instruction above.</p>}
        <div className="grid-wrap">
          <AgGridReact<Purchase>
            rowData={purchases}
            columnDefs={cols}
            getRowId={(p) => p.data.id}
            domLayout="autoHeight"
            defaultColDef={{ sortable: true, resizable: true }}
            onRowClicked={(e) => setSel(e.data?.id ?? null)}
            rowClassRules={{ "row-breach": (p) => !!p.data && !p.data.within_mandate }}
            overlayNoRowsTemplate="No purchases"
            suppressCellFocus={false}
          />
        </div>
        {sel && <p className="muted small">Selected {sel}. Use the Evidence button on the row to follow it to its trail.</p>}
      </Section>
    </div>
  );
}
