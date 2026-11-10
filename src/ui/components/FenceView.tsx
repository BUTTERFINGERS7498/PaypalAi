"use client";
import { useMemo, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { fmtMoney, fmtTime } from "../lib/format";
import { useStore } from "../lib/store";
import type { Mandate, Purchase } from "../lib/types";
import { Flags, StatusChip } from "./ui";

/* The Fence: the mandate drawn as a space. Dot distance from the centre grows with the amount (approximate scale) (square-root scale).
   Green ring = monthly cap, dashed ring = approval threshold, hatched band = outside the mandate. */

const C = 340; // centre of the 680 x 680 viewBox
const R = 205; // cap ring radius
const OUT = 292; // outer edge of the "outside" band
const TAU = Math.PI * 2;

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/** Distance from the centre for an amount. The 0.38 offset keeps small purchases clear of the "remaining" number. */
const dist = (amt: number, cap: number) => R * (0.38 + 0.62 * Math.sqrt(Math.min(Math.max(amt / cap, 0), 1.5)));
const pol = (r: number, a: number) => ({ x: C + r * Math.cos(a), y: C + r * Math.sin(a) });
const tone = (p: Purchase): "ok" | "warn" | "bad" | "neutral" => {
  if (!p.within_mandate) return "bad";
  if (p.status === "rejected" || p.status === "failed" || p.status === "dispute_resolved") return "neutral";
  if (p.status === "pending_approval" || p.status === "awaiting_payer") return "warn";
  return "ok";
};

interface Placed { p: Purchase; x: number; y: number; tone: ReturnType<typeof tone>; }

function layout(m: Mandate, purchases: Purchase[]): Placed[] {
  const cap = parseFloat(m.limits.monthly_cap) || 1;
  const cats = m.limits.categories;
  const inShare = 0.78; // share of the circle given to allowed categories
  const span = (TAU * inShare) / Math.max(cats.length, 1);
  const start = -Math.PI / 2;
  return purchases.map((p) => {
    const amt = parseFloat(p.amount.value) || 0;
    const catIdx = cats.indexOf(p.category);
    const jitter = hash01(p.id);
    let a: number;
    let r = dist(amt, cap);
    if (catIdx >= 0) a = start + catIdx * span + span * (0.14 + 0.72 * jitter);
    else {
      a = start + TAU * inShare + TAU * (1 - inShare) * (0.15 + 0.7 * jitter);
      r = Math.max(r, R * 1.1);
    }
    if (!p.within_mandate) r = Math.max(r, R * 1.1 + 18 * hash01(p.id + "r"));
    r = Math.min(r, OUT - 12);
    return { p, ...pol(r, a), tone: tone(p) };
  });
}

function Detail({ p }: { p: Purchase }) {
  const { go } = useStore();
  return (
    <div className="sx-pick" aria-live="polite">
      <div className="row spread wrap">
        <h3>{p.item_name}</h3>
        <span className="sx-big">{fmtMoney(p.amount)}</span>
      </div>
      <p className="muted small mono">{p.id} · {p.sku} · {p.category}</p>
      <div className="row wrap" style={{ margin: "6px 0" }}>
        <StatusChip status={p.status} />
        <Flags within={p.within_mandate} breaches={p.breaches} rogue={p.demo_rogue} stamp />
      </div>
      <p className="small muted">{fmtTime(p.created_at)}</p>
      <div className="row wrap">
        <button className="sx-btn sm" onClick={() => go("evidence", p.id)}>Open evidence trail</button>
        {p.status === "awaiting_payer" && p.approve_url && (
          <a className="sx-btn sm" href={p.approve_url} target="_blank" rel="noopener noreferrer">Approve at PayPal (sandbox)</a>
        )}
      </div>
    </div>
  );
}

export default function FenceView() {
  const { mandates, purchases, approvals, go, lastEvidence, api } = useStore();
  const active = mandates.filter((m) => m.status === "active");
  const [mid, setMid] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const m = active.find((x) => x.id === mid) ?? active[0];
  const mine = useMemo(() => (m ? purchases.filter((p) => p.mandate_id === m.id) : []), [m, purchases]);
  const placed = useMemo(() => (m ? layout(m, mine) : []), [m, mine]);

  if (!m) {
    return (
      <div className="sx-panel">
        <h2>No active mandate</h2>
        <p className="muted">The fence needs a signed mandate. Create one to see the boundary.</p>
        <button className="sx-btn primary" onClick={() => go("mandates")}>Go to mandates</button>
      </div>
    );
  }

  const cap = parseFloat(m.limits.monthly_cap) || 1;
  const spent = parseFloat(m.budget.spent) || 0;
  const pctSpent = Math.min(spent / cap, 1);
  const thrR = dist(Math.min(parseFloat(m.limits.approval_above), cap), cap);
  const circ = TAU * R;
  const breaches = mine.filter((p) => !p.within_mandate).length;
  const sel = mine.find((p) => p.id === selId) ?? null;
  const cats = m.limits.categories;
  const span = (TAU * 0.78) / Math.max(cats.length, 1);
  const outMid = -Math.PI / 2 + TAU * 0.78 + (TAU * 0.22) / 2;

  const onKey = (id: string) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSelId(id);
    }
  };

  // Outer-band wedge path (hatched) for the outside zone, drawn as a ring slice over the whole circle.
  return (
    <div className="stack">
      {active.length > 1 && (
        <div className="sx-form">
          <label htmlFor="fence-mandate">Mandate</label>
          <select id="fence-mandate" value={m.id} onChange={(e) => { setMid(e.target.value); setSelId(null); }}>
            {active.map((x) => <option key={x.id} value={x.id}>{x.label} (v{x.version})</option>)}
          </select>
        </div>
      )}
      <div className="sx-fence">
        <div>
          <div className="sx-map">
            <svg viewBox="0 0 680 680" role="group" aria-label={`Fence for ${m.label}: ${mine.length} purchases, ${breaches} outside the mandate`}>
              <defs>
                <pattern id="hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="9" height="9" fill="rgba(163,34,26,.04)" />
                  <line x1="0" y1="0" x2="0" y2="9" stroke="rgba(163,34,26,.22)" strokeWidth="2" />
                </pattern>
              </defs>
              <circle className="zone-out" cx={C} cy={C} r={OUT} />
              <circle className="ring-cap" cx={C} cy={C} r={R} />
              <circle className="ring-thr" cx={C} cy={C} r={thrR} />
              {cats.map((_, i) => {
                const a = -Math.PI / 2 + i * span;
                const p1 = pol(0, a), p2 = pol(R, a);
                return <line key={i} className="sector-line" x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} />;
              })}
              {(() => {
                const a = -Math.PI / 2 + TAU * 0.78;
                const p1 = pol(R, a), p2 = pol(OUT, a);
                return <line className="sector-line" x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} />;
              })()}
              <circle className="spent" cx={C} cy={C} r={R} strokeDasharray={`${circ * pctSpent} ${circ}`} transform={`rotate(-90 ${C} ${C})`} />

              {cats.map((c, i) => {
                const q = pol(R + 30, -Math.PI / 2 + i * span + span / 2);
                return <text key={c} x={q.x} y={q.y} textAnchor="middle" dominantBaseline="middle">{c}</text>;
              })}
              {(() => {
                const q = pol(OUT + 18, outMid);
                return <text x={q.x} y={q.y} textAnchor="middle" dominantBaseline="middle" style={{ fill: "var(--wax)" }}>outside</text>;
              })()}
              <text className="ring-lbl" x={C} y={C - thrR - 6} textAnchor="middle">approval above ${m.limits.approval_above}</text>
              <text className="ring-lbl" x={C} y={C - R - 8} textAnchor="middle">cap ${m.limits.monthly_cap}</text>
              <text className="center-lbl" x={C} y={C - 6} textAnchor="middle">remaining</text>
              <text className="center-num" x={C} y={C + 28} textAnchor="middle">${m.budget.remaining}</text>

              {placed.map(({ p, x, y, tone: t }, i) => (
                <g
                  key={p.id}
                  className={`sx-dot ${t} ${selId === p.id ? "sel" : ""}`}
                  style={{ ["--i" as string]: i } as CSSProperties}
                  role="button"
                  tabIndex={0}
                  aria-label={`${p.item_name}, ${fmtMoney(p.amount)}, ${p.within_mandate ? "within mandate" : "outside mandate"}`}
                  onClick={() => setSelId(p.id)}
                  onKeyDown={onKey(p.id)}
                >
                  <circle className="halo" cx={x} cy={y} r={12} />
                  <circle className="core" cx={x} cy={y} r={9} />
                  <title>{p.item_name} · {fmtMoney(p.amount)}</title>
                </g>
              ))}
            </svg>
            <div className="sx-legend" aria-hidden="true">
              <span><i style={{ background: "var(--green)" }} />within mandate</span>
              <span><i style={{ background: "#d19a1a" }} />waiting on approval or payer</span>
              <span><i style={{ background: "var(--wax)" }} />outside mandate</span>
              <span>distance from the centre grows with the amount (approximate scale)</span>
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="sx-stats">
            <div className="sx-stat"><b>${m.budget.spent}</b><span>spent of ${m.limits.monthly_cap} ({m.budget.period})</span></div>
            <div className="sx-stat"><b>{mine.length}</b><span>purchases on this mandate</span></div>
            <button className="sx-stat" style={{ textAlign: "left", cursor: "pointer", font: "inherit" }} onClick={() => go("ledger")} aria-label={`${approvals.length} awaiting your approval. Open the ledger`}>
              <b>{approvals.length}</b><span>waiting for your approval</span>
            </button>
            <div className={`sx-stat ${breaches ? "alert" : ""}`}><b>{breaches}</b><span>outside the mandate</span></div>
          </div>

          {sel ? <Detail p={sel} /> : (
            <div className="sx-panel">
              <h3>Pick a dot</h3>
              <p className="muted small">Each dot is one purchase. Select one to read its mandate check and open its evidence trail. A list with the same data follows the map.</p>
              <div className="row wrap">
                <button className="sx-btn primary" onClick={() => go("ledger")}>Ask the agent to buy</button>
                <button className="sx-btn" onClick={() => go("mandates")}>Edit the fence</button>
              </div>
            </div>
          )}

          <div className="sx-panel">
            <h3>Latest evidence</h3>
            {lastEvidence ? (
              <p className="small">
                <strong>{lastEvidence.decision.replace(/_/g, " ")}</strong> · seq {lastEvidence.seq}<br />
                <span className="mono">{lastEvidence.record_id}</span><br />
                <span className="muted">{fmtTime(lastEvidence.timestamp)}</span>
              </p>
            ) : (
              <p className="muted small">New decisions appear here as they happen{api.kind === "mock" ? " (mock data)" : ""}.</p>
            )}
          </div>
        </div>
      </div>

      <section className="sx-panel" aria-labelledby="fence-list">
        <div className="sx-panel-head"><h2 id="fence-list">The same data as a list</h2></div>
        {mine.length === 0 ? <p className="muted">No purchases on this mandate yet.</p> : (
          <div className="sx-table-wrap">
            <table>
              <thead><tr><th scope="col">Item</th><th scope="col" className="num">Amount</th><th scope="col">Status</th><th scope="col">Mandate check</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
              <tbody>
                {mine.map((p) => (
                  <tr key={p.id} className={sel?.id === p.id ? "picked" : ""}>
                    <td>{p.item_name}</td>
                    <td className="num">{fmtMoney(p.amount)}</td>
                    <td><StatusChip status={p.status} /></td>
                    <td><Flags within={p.within_mandate} breaches={p.breaches} rogue={p.demo_rogue} /></td>
                    <td><button className="sx-btn sm" onClick={() => go("evidence", p.id)}>Evidence</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
