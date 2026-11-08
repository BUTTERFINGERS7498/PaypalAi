"use client";
import { useState } from "react";
import type { FormEvent } from "react";
import { fmtTime, short } from "../lib/format";
import { useStore } from "../lib/store";
import type { Mandate, VerifyResult } from "../lib/types";
import { Chip, Notice, Section, useAction } from "./ui";

const parseCats = (s: string) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
const validMoney = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim());
const two = (v: string) => parseFloat(v).toFixed(2);

function LimitsForm(props: {
  initial: { monthly_cap: string; categories: string; approval_above: string };
  submitLabel: string;
  busy: boolean;
  onSubmit: (v: { monthly_cap: string; categories: string[]; approval_above: string }) => void;
  onCancel?: () => void;
  idp: string;
}) {
  const [cap, setCap] = useState(props.initial.monthly_cap);
  const [cats, setCats] = useState(props.initial.categories);
  const [appr, setAppr] = useState(props.initial.approval_above);
  const [err, setErr] = useState<string | null>(null);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!validMoney(cap) || !validMoney(appr)) return setErr("Amounts must be numbers like 200 or 75.50.");
    if (parseFloat(appr) > parseFloat(cap)) return setErr("Approval threshold cannot exceed the monthly cap.");
    const c = parseCats(cats);
    if (!c.length) return setErr("Enter at least one category.");
    setErr(null);
    props.onSubmit({ monthly_cap: two(cap), categories: c, approval_above: two(appr) });
  }
  return (
    <form onSubmit={submit} className="form-grid">
      <label htmlFor={`${props.idp}-cap`}>Monthly cap (USD)</label>
      <input id={`${props.idp}-cap`} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} required />
      <label htmlFor={`${props.idp}-cat`}>Allowed categories (comma separated)</label>
      <input id={`${props.idp}-cat`} value={cats} onChange={(e) => setCats(e.target.value)} required />
      <label htmlFor={`${props.idp}-apr`}>Ask me to approve purchases above (USD)</label>
      <input id={`${props.idp}-apr`} inputMode="decimal" value={appr} onChange={(e) => setAppr(e.target.value)} required />
      {err && <Notice kind="error">{err}</Notice>}
      <div className="row">
        <button className="btn primary" disabled={props.busy}>{props.busy ? "Saving…" : props.submitLabel}</button>
        {props.onCancel && <button type="button" className="btn" onClick={props.onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function MandateCard({ m }: { m: Mandate }) {
  const { api } = useStore();
  const [editing, setEditing] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [versions, setVersions] = useState<Mandate[] | null>(null);
  const act = useAction();
  const cap = parseFloat(m.limits.monthly_cap);
  const spent = parseFloat(m.budget.spent);
  const pct = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0;
  const revoked = m.status === "revoked";

  return (
    <article className={`mandate ${revoked ? "is-revoked" : ""}`} aria-label={`Mandate ${m.label}`}>
      <header className="card-head">
        <div>
          <h3>{m.label}</h3>
          <p className="muted mono">{m.id} · version {m.version}</p>
        </div>
        <Chip tone={revoked ? "bad" : "ok"}>{revoked ? "Revoked" : "Active"}</Chip>
      </header>

      <dl className="kv">
        <dt>Monthly cap</dt><dd>USD {m.limits.monthly_cap}</dd>
        <dt>Categories</dt><dd>{m.limits.categories.join(", ")}</dd>
        <dt>Approval needed above</dt><dd>USD {m.limits.approval_above}</dd>
        <dt>Period</dt><dd>{m.budget.period} (UTC)</dd>
      </dl>

      <div className="budget" aria-label="Budget">
        <div className="row spread">
          <span>Spent <strong>USD {m.budget.spent}</strong></span>
          <span>Remaining <strong>USD {m.budget.remaining}</strong></span>
        </div>
        <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${pct}% of monthly cap spent`}>
          <div className="bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <p className="muted small">
        Signed with the {m.signature.note} ({m.signature.alg}, {m.signature.key_id}). Payload hash{" "}
        <span className="mono">{short(m.signature.payload_hash, 12)}</span>. This is our own demo key; it is not an AP2/FIDO credential.
      </p>

      {editing ? (
        <div className="subcard">
          <h4>Edit limits (saves a new signed version {m.version + 1})</h4>
          <LimitsForm
            idp={`edit-${m.id}`}
            initial={{ monthly_cap: m.limits.monthly_cap, categories: m.limits.categories.join(", "), approval_above: m.limits.approval_above }}
            submitLabel={`Save as version ${m.version + 1}`}
            busy={act.busy}
            onCancel={() => setEditing(false)}
            onSubmit={async (v) => {
              const r = await act.run(() => api.updateLimits(m.id, v));
              if (r) { setEditing(false); setVerify(null); setVersions(null); }
            }}
          />
        </div>
      ) : (
        <div className="row wrap">
          <button className="btn" disabled={act.busy || revoked} onClick={() => setEditing(true)}>Edit limits</button>
          <button className="btn" disabled={act.busy} onClick={async () => { const r = await act.run(() => api.verifyMandate(m.id)); if (r) setVerify(r); }}>
            Verify signature
          </button>
          <button className="btn" disabled={act.busy} onClick={async () => { const r = await act.run(() => api.mandateVersions(m.id)); if (r) setVersions(r); }}>
            Version history
          </button>
          {!revoked && !confirmRevoke && <button className="btn danger" onClick={() => setConfirmRevoke(true)}>Revoke…</button>}
          {!revoked && confirmRevoke && (
            <span className="row" role="group" aria-label="Confirm revoke">
              <span>Revoke permanently? The agent will be unable to use it.</span>
              <button className="btn danger" disabled={act.busy} onClick={async () => { await act.run(() => api.revokeMandate(m.id)); setConfirmRevoke(false); }}>Yes, revoke</button>
              <button className="btn" onClick={() => setConfirmRevoke(false)}>No</button>
            </span>
          )}
        </div>
      )}

      {act.error && <Notice kind="error">{act.error}</Notice>}
      {verify && (
        <Notice kind={verify.valid ? "ok" : "error"}>
          {verify.valid
            ? `Signature valid: the stored payload hash recomputes and the ${verify.alg} signature verifies against key ${verify.key_id} (version ${verify.version}).`
            : `Signature INVALID for version ${verify.version}: ${verify.reason ?? "unknown reason"}`}
        </Notice>
      )}
      {versions && (
        <div className="subcard">
          <h4>Versions (immutable)</h4>
          <ul className="plain">
            {versions.map((v) => (
              <li key={v.version}>
                <strong>v{v.version}</strong> · cap USD {v.limits.monthly_cap} · {v.limits.categories.join(", ")} · approval &gt; USD {v.limits.approval_above} · {fmtTime(v.created_at)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

export default function MandateView() {
  const { mandates, api } = useStore();
  const [label, setLabel] = useState("");
  const [open, setOpen] = useState(false);
  const act = useAction();
  return (
    <div className="stack">
      <Section
        id="mandates-h"
        title="Mandates"
        actions={<button className="btn primary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Close" : "New mandate"}</button>}
      >
        <p className="muted">
          A mandate is the signed set of limits your shopping agent must stay inside. Changing limits creates a new signed version; old versions are kept.
        </p>
        {open && (
          <div className="subcard">
            <h3>Create mandate</h3>
            <div className="form-grid">
              <label htmlFor="new-label">Label</label>
              <input id="new-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Groceries, $200/month" />
            </div>
            <LimitsForm
              idp="new"
              initial={{ monthly_cap: "200.00", categories: "groceries", approval_above: "75.00" }}
              submitLabel="Create and sign"
              busy={act.busy}
              onSubmit={async (limits) => {
                if (!label.trim()) return act.setError("Give the mandate a label.");
                const r = await act.run(() => api.createMandate({ label: label.trim(), limits: { currency_code: "USD", ...limits } }));
                if (r) { setOpen(false); setLabel(""); }
              }}
            />
            {act.error && <Notice kind="error">{act.error}</Notice>}
          </div>
        )}
      </Section>
      {mandates.length === 0 && <Notice kind="info">No mandates yet. Create one to get started.</Notice>}
      {mandates.map((m) => <MandateCard key={m.id} m={m} />)}
    </div>
  );
}
