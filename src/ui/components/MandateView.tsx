"use client";
import { useState } from "react";
import type { FormEvent } from "react";
import { fmtTime, short } from "../lib/format";
import { useStore } from "../lib/store";
import type { Mandate, MandateDraft, VerifyResult } from "../lib/types";
import { Notice, Section, Stamp, useAction } from "./ui";

const parseCats = (s: string) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
const validMoney = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.trim());
const two = (v: string) => parseFloat(v).toFixed(2);

type LimitsValue = { monthly_cap: string; categories: string[]; approval_above: string; ask_when_unsure: boolean };

function LimitsForm(props: {
  initial: { monthly_cap: string; categories: string; approval_above: string; ask_when_unsure?: boolean };
  submitLabel: string;
  busy: boolean;
  onSubmit: (v: LimitsValue) => void;
  onCancel?: () => void;
  idp: string;
}) {
  const [cap, setCap] = useState(props.initial.monthly_cap);
  const [cats, setCats] = useState(props.initial.categories);
  const [appr, setAppr] = useState(props.initial.approval_above);
  const [unsure, setUnsure] = useState(props.initial.ask_when_unsure === true);
  const [err, setErr] = useState<string | null>(null);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!validMoney(cap) || !validMoney(appr)) return setErr("Amounts must be numbers like 200 or 75.50.");
    if (parseFloat(appr) > parseFloat(cap)) return setErr("Approval threshold cannot exceed the monthly cap.");
    const c = parseCats(cats);
    if (!c.length) return setErr("Enter at least one category.");
    setErr(null);
    props.onSubmit({ monthly_cap: two(cap), categories: c, approval_above: two(appr), ask_when_unsure: unsure });
  }
  return (
    <form onSubmit={submit} className="sx-form">
      <label htmlFor={`${props.idp}-cap`}>Monthly cap (USD)</label>
      <input id={`${props.idp}-cap`} inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} required />
      <label htmlFor={`${props.idp}-cat`}>Allowed categories (comma separated)</label>
      <input id={`${props.idp}-cat`} value={cats} onChange={(e) => setCats(e.target.value)} required />
      <label htmlFor={`${props.idp}-apr`}>Ask me to approve purchases above (USD)</label>
      <input id={`${props.idp}-apr`} inputMode="decimal" value={appr} onChange={(e) => setAppr(e.target.value)} required />
      <label className="sx-check" style={{ fontWeight: 400, marginTop: 4 }}>
        <input type="checkbox" checked={unsure} onChange={(e) => setUnsure(e.target.checked)} />
        <span><strong>Ask me when the agent is unsure</strong>: a weak match waits for my approval, even under the approval line</span>
      </label>
      {err && <Notice kind="error">{err}</Notice>}
      <div className="row">
        <button className="sx-btn primary" disabled={props.busy}>{props.busy ? "Saving…" : props.submitLabel}</button>
        {props.onCancel && <button type="button" className="sx-btn" onClick={props.onCancel}>Cancel</button>}
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
    <article className={`sx-doc ${revoked ? "is-revoked" : ""}`} aria-label={`Mandate ${m.label}`}>
      <span className={`sx-sealmark ${verify?.valid ? "show" : ""}`} aria-hidden="true">SIGNATURE<br />VERIFIED</span>
      <header className="sx-doc-head">
        <div>
          <span className="sx-kicker">Mandate · version {m.version}</span>
          <h3 className="sx-big" style={{ fontSize: "1.5rem" }}>{m.label}</h3>
          <p className="muted mono">{m.id}</p>
        </div>
        <Stamp tone={revoked ? "bad" : "ok"} large pop>{revoked ? "Revoked" : "Active"}</Stamp>
      </header>

      <div style={{ margin: "14px 0 6px" }}>
        <p className="clause"><i>§1</i><span>The agent may spend up to <strong className="sx-big">USD {m.limits.monthly_cap}</strong> each month ({m.budget.period}, UTC).</span></p>
        <p className="clause"><i>§2</i><span>Only in these categories: <strong>{m.limits.categories.join(", ")}</strong>.</span></p>
        <p className="clause"><i>§3</i><span>Any single purchase above <strong className="sx-big">USD {m.limits.approval_above}</strong> waits for a human to approve it.</span></p>
        {m.limits.ask_when_unsure && (
          <p className="clause"><i>§4</i><span>When the agent is <strong>not sure</strong> an item is what was meant, it waits for a human to approve it.</span></p>
        )}
      </div>

      <div className="budget" aria-label="Budget">
        <div className="row spread">
          <span>Spent <strong>USD {m.budget.spent}</strong></span>
          <span>Remaining <strong>USD {m.budget.remaining}</strong></span>
        </div>
        <div className={`sx-gauge ${pct >= 85 ? "hot" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${pct}% of monthly cap spent`}>
          <div style={{ width: `${pct}%` }} />
        </div>
      </div>

      <p className="muted small" style={{ marginTop: 12 }}>
        Signed with the {m.signature.note} ({m.signature.alg}, {m.signature.key_id}). Payload hash{" "}
        <span className="mono">{short(m.signature.payload_hash, 12)}</span>. This is our own demo key; it is not an AP2/FIDO credential.
      </p>

      {editing ? (
        <div className="sx-sub">
          <h4>Edit limits (saves a new signed version {m.version + 1})</h4>
          <LimitsForm
            idp={`edit-${m.id}`}
            initial={{ monthly_cap: m.limits.monthly_cap, categories: m.limits.categories.join(", "), approval_above: m.limits.approval_above, ask_when_unsure: m.limits.ask_when_unsure }}
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
        <div className="row wrap" style={{ marginTop: 10 }}>
          <button className="sx-btn" disabled={act.busy || revoked} onClick={() => setEditing(true)}>Edit limits</button>
          <button className="sx-btn" disabled={act.busy} onClick={async () => { const r = await act.run(() => api.verifyMandate(m.id)); if (r) setVerify(r); }}>
            Verify signature
          </button>
          <button className="sx-btn" disabled={act.busy} onClick={async () => { const r = await act.run(() => api.mandateVersions(m.id)); if (r) setVersions(r); }}>
            Version history
          </button>
          {!revoked && !confirmRevoke && <button className="sx-btn danger" onClick={() => setConfirmRevoke(true)}>Revoke…</button>}
          {!revoked && confirmRevoke && (
            <span className="row" role="group" aria-label="Confirm revoke">
              <span>Revoke permanently? The agent will be unable to use it.</span>
              <button className="sx-btn danger" disabled={act.busy} onClick={async () => { await act.run(() => api.revokeMandate(m.id)); setConfirmRevoke(false); }}>Yes, revoke</button>
              <button className="sx-btn" onClick={() => setConfirmRevoke(false)}>No</button>
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
        <div className="sx-sub">
          <h4>Versions (immutable)</h4>
          <ul className="plain">
            {versions.map((v) => (
              <li key={v.version}>
                <strong>v{v.version}</strong> · cap USD {v.limits.monthly_cap} · {v.limits.categories.join(", ")} · approval &gt; USD {v.limits.approval_above}{v.limits.ask_when_unsure ? " · ask when unsure" : ""} · {fmtTime(v.created_at)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

/** Describe the mandate in plain English; the server drafts the limits. Nothing is signed until the form is submitted. */
function DraftFromText({ onDraft }: { onDraft: (d: MandateDraft) => void }) {
  const { api } = useStore();
  const [text, setText] = useState("Groceries only, $200 a month, ask me above $40, and ask me if you are not sure.");
  const [draft, setDraft] = useState<MandateDraft | null>(null);
  const act = useAction();
  return (
    <div className="sx-draft">
      <label htmlFor="draft-text"><strong>Describe it in plain English</strong> <span className="muted small">(optional: the agent drafts the form below, you check it and sign)</span></label>
      <div className="row wrap" style={{ alignItems: "stretch" }}>
        <input id="draft-text" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: "1 1 320px", width: "auto" }} />
        <button type="button" className="sx-btn" disabled={act.busy || !text.trim()} onClick={async () => {
          const d = await act.run(() => api.draftMandate(text.trim()));
          if (d) { setDraft(d); onDraft(d); }
        }}>{act.busy ? "Reading…" : "Draft the limits"}</button>
      </div>
      {act.error && <Notice kind="error">{act.error}</Notice>}
      {draft && (
        <div className={`sx-notice ${draft.missing.length ? "n-warn" : "n-info"}`} role="status">
          <p><strong>What I read</strong> (check it before you sign):</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {draft.notes.map((n) => <li key={n}>{n}</li>)}
            {draft.missing.map((m) => <li key={m}><strong>Not found:</strong> {m.replace(/_/g, " ")}. Fill it in by hand.</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function MandateView() {
  const { mandates, api } = useStore();
  const [label, setLabel] = useState("");
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState({ monthly_cap: "200.00", categories: "groceries", approval_above: "40.00", ask_when_unsure: false });
  const [formKey, setFormKey] = useState(0);
  const act = useAction();
  return (
    <div className="stack">
      <Section
        id="mandates-h"
        title="Mandates"
        actions={<button className="sx-btn primary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Close" : "New mandate"}</button>}
      >
        <p className="muted">
          A mandate is the signed set of limits your shopping agent must stay inside. Changing limits creates a new signed version; old versions are kept.
        </p>
        {open && (
          <div className="sx-sub">
            <h3>Create mandate</h3>
            <DraftFromText onDraft={(d) => {
              setLabel(d.label);
              setInitial({
                monthly_cap: d.limits.monthly_cap ?? "",
                categories: d.limits.categories.join(", "),
                approval_above: d.limits.approval_above ?? "",
                ask_when_unsure: d.limits.ask_when_unsure,
              });
              setFormKey((k) => k + 1); // remount the form with the drafted values
            }} />
            <div className="sx-form">
              <label htmlFor="new-label">Label</label>
              <input id="new-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Groceries, $200/month" />
            </div>
            <LimitsForm
              key={formKey}
              idp="new"
              initial={initial}
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
