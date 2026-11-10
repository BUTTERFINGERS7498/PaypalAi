"use client";
import { useMemo, useState } from "react";
import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { fmtMoney, fmtTime, reasonLabel } from "../lib/format";
import { useStore } from "../lib/store";
import type { AgentResult, Purchase } from "../lib/types";
import { Chip, Flags, Notice, Section, StatusChip, useAction } from "./ui";

ModuleRegistry.registerModules([AllCommunityModule]);

/** PayPal guarantees held funds for 3 days (the honor period). */
const HONOR_MS = 3 * 86_400_000;

const gridTheme = themeQuartz.withParams({
  backgroundColor: "#fffdf8",
  foregroundColor: "#17130f",
  headerBackgroundColor: "#ebe3d2",
  headerTextColor: "#17130f",
  borderColor: "#d9cdb6",
  rowHoverColor: "#f4efe5",
  accentColor: "#17130f",
  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  wrapperBorderRadius: 12,
});

function Receipts({ purchases, label }: { purchases: Purchase[]; label: (id: string) => string }) {
  const { go } = useStore();
  return (
    <div className="sx-rcpts">
      {purchases.map((p) => {
        const dim = p.status === "rejected" || p.status === "failed";
        return (
          <article key={p.id} className={`sx-rcpt ${p.within_mandate ? "" : "breach"} ${dim ? "dim" : ""}`} aria-label={`Receipt: ${p.item_name}`}>
            <div className="row spread">
              <span className="sx-kicker">{fmtTime(p.created_at)}</span>
              <span className="row" style={{ gap: 4 }}>
                <StatusChip status={p.status} />
                {p.status === "pending_approval" && p.paypal_authorization_id && <Chip tone="info" title={`PayPal authorization ${p.paypal_authorization_id}`}>held</Chip>}
              </span>
            </div>
            <h3 style={{ margin: "8px 0 2px" }}>{p.item_name}</h3>
            <p className="muted small mono">{p.sku} · {p.category}</p>
            <div className="amt">{fmtMoney(p.amount)}</div>
            <hr />
            <div className="stampzone"><Flags within={p.within_mandate} breaches={p.breaches} rogue={p.demo_rogue} stamp /></div>
            <p className="small muted" style={{ margin: "10px 0" }}>{label(p.mandate_id)} v{p.mandate_version}</p>
            <div className="row wrap">
              <button className="sx-btn sm" onClick={() => go("evidence", p.id)}>Evidence</button>
              {p.status === "awaiting_payer" && p.approve_url && (
                <a className="sx-btn sm" href={p.approve_url} target="_blank" rel="noopener noreferrer">Open PayPal to approve</a>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function AskAgent() {
  const { api, mandates, go, health } = useStore();
  const active = mandates.filter((m) => m.status === "active");
  const [mid, setMid] = useState("");
  const [text, setText] = useState("restock the pantry basics");
  const [rogue, setRogue] = useState(false);
  const [result, setResult] = useState<AgentResult | null>(null);
  const act = useAction();
  const selected = mid && active.some((m) => m.id === mid) ? mid : active[0]?.id ?? "";

  return (
    <Section id="ask-h" title="Ask the agent">
      {health?.agent_mode === "engine" && (
        <p className="small">
          This agent is an <strong>on-server semantic engine</strong>, not Claude. It matches your words to catalog items by meaning using a small open-source embedding model, and it can understand a price cap such as “under $10” or an explicit “sku …”. It only proposes a choice: the mandate checker still decides what is allowed.
        </p>
      )}
      <form
        className="sx-form"
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
        <div className={`sx-rogue ${rogue ? "on" : ""}`}>
          <label className="sx-check">
            <input type="checkbox" checked={rogue} onChange={(e) => setRogue(e.target.checked)} />
            <span><strong>Demo: let the agent break its mandate</strong></span>
          </label>
          <p className="small">
            Sandbox demo only. Turns off the guard so an out-of-mandate choice goes through (try “buy sku ELE-GAME-01”). The checker still records the breach honestly and a later dispute will be a MANDATE BREACH.
          </p>
        </div>
        <div className="row">
          <button className="sx-btn primary" disabled={act.busy || !selected || !text.trim()}>{act.busy ? "Agent is working…" : "Send to agent"}</button>
        </div>
      </form>
      {act.error && <Notice kind="error">{act.error}</Notice>}
      {result && (
        <Notice kind={result.outcome === "blocked" ? "warn" : result.choices?.length ? "info" : "ok"}>
          <p>
            <Chip tone={result.outcome === "blocked" ? "bad" : "info"}>{result.choices?.length ? "question" : result.outcome.replace("_", " ")}</Chip>{" "}
            {result.reply}
          </p>
          {result.choices && result.choices.length > 0 && (
            <div className="row wrap" role="group" aria-label="Choose one" style={{ marginBottom: 8 }}>
              {result.choices.map((c) => (
                <button key={c.sku} className="sx-btn primary" disabled={act.busy} onClick={async () => {
                  const answer = `buy sku ${c.sku}`;
                  setText(answer);
                  const r = await act.run(() => api.instruct({ mandate_id: selected, text: answer, demo_rogue: rogue }));
                  if (r) setResult(r);
                }}>{c.name} · ${c.price}</button>
              ))}
            </div>
          )}
          <div className="row wrap">
            {result.purchase?.approve_url && (
              <a className="sx-btn" href={result.purchase.approve_url} target="_blank" rel="noopener noreferrer">Open PayPal to approve (sandbox)</a>
            )}
            {result.purchase && <button className="sx-btn" onClick={() => go("evidence", result.purchase!.id)}>View evidence trail</button>}
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
          const held = !!p?.paypal_authorization_id;
          return (
            <li key={a.id} className="sx-approval">
              <div>
                <strong>{a.summary}</strong>
                {held && p && (
                  <div className="row wrap" style={{ margin: "4px 0", gap: 6 }}>
                    <Chip tone="info" title={`PayPal authorization ${p.paypal_authorization_id}`}>
                      {fmtMoney(p.amount)} held at PayPal · not charged yet{p.hold_expires_at ? ` · until ${fmtTime(p.hold_expires_at)}` : ""}
                    </Chip>
                    {Date.now() - Date.parse(p.created_at) > HONOR_MS && (
                      <Chip tone="warn" title="PayPal guarantees held funds for 3 days. After that the capture can fail; Sentry then places a new order instead.">
                        past PayPal&apos;s 3-day honor period
                      </Chip>
                    )}
                  </div>
                )}
                <div className="muted small">
                  {a.reasons.map(reasonLabel).join(", ")} · requested {fmtTime(a.created_at)} · decision recorded as “{operator}”
                </div>
              </div>
              <div className="row wrap">
                <button className="sx-btn primary" disabled={act.busy} onClick={() => act.run(() => api.decideApproval(a.id, "approve", { decided_by: operator }))}>{held ? "Approve and capture" : "Approve"}</button>
                <button className="sx-btn danger" disabled={act.busy} onClick={() => act.run(() => api.decideApproval(a.id, "reject", { decided_by: operator }))}>{held ? "Reject and release hold" : "Reject"}</button>
                {p && <button className="sx-btn" onClick={() => go("evidence", p.id)}>Evidence</button>}
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
  const [mode, setMode] = useState<"receipts" | "table">("receipts");
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
              <button className="sx-btn sm" onClick={() => go("evidence", p.data!.id)}>Evidence</button>
              {p.data.status === "awaiting_payer" && p.data.approve_url && (
                <a className="sx-btn sm" href={p.data.approve_url} target="_blank" rel="noopener noreferrer">Open PayPal to approve</a>
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
        actions={
          <span className="row wrap">
            <span className="sx-seg" role="group" aria-label="Ledger layout">
              <button aria-pressed={mode === "receipts"} onClick={() => setMode("receipts")}>Receipts</button>
              <button aria-pressed={mode === "table"} onClick={() => setMode("table")}>Table</button>
            </span>
            <Chip tone={live ? "ok" : "neutral"} title="Rows update as server-sent events arrive">{api.kind === "mock" ? "Live (mock events)" : live ? "Live (SSE)" : "Connecting…"}</Chip>
          </span>
        }
      >
        {purchases.length === 0 && <p className="muted">No purchases yet. Send an instruction above.</p>}
        {mode === "receipts" ? <Receipts purchases={[...purchases].sort((a, b) => b.created_at.localeCompare(a.created_at))} label={label} /> : (
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
            theme={gridTheme}
          />
        </div>)}
        {sel && <p className="muted small">Selected {sel}. Use the Evidence button on the row to follow it to its trail.</p>}
      </Section>
    </div>
  );
}
