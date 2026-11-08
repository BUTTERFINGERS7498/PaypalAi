"use client";
import { StoreProvider, useStore } from "../lib/store";
import type { TabId } from "../lib/store";
import DisputeView from "./DisputeView";
import EvidenceView from "./EvidenceView";
import LedgerView from "./LedgerView";
import MandateView from "./MandateView";
import { Chip, Notice } from "./ui";

const TABS: { id: TabId; label: string }[] = [
  { id: "mandates", label: "1. Mandates" },
  { id: "ledger", label: "2. Purchase ledger" },
  { id: "evidence", label: "3. Evidence trail" },
  { id: "disputes", label: "4. Disputes" },
];

function Inner() {
  const { tab, go, api, health, loadError, refresh, token, setToken, operator, setOperator, approvals } = useStore();
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="top">
        <div className="top-in">
          <div>
            <h1>Mandate Ledger</h1>
            <p className="tag">The receipt layer for agentic payments · PayPal sandbox demo</p>
          </div>
          <div className="top-fields">
            <div>
              <label htmlFor="op">Your name (recorded on decisions)</label>
              <input id="op" value={operator} onChange={(e) => setOperator(e.target.value)} autoComplete="off" />
            </div>
            <div>
              <label htmlFor="tok">Approval password (if the server asks)</label>
              <input id="tok" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" placeholder="kept in memory only" />
            </div>
          </div>
        </div>
        <div className="banner row wrap">
          <Chip tone="info">PayPal SANDBOX · no real money</Chip>
          {api.kind === "mock" && <Chip tone="demo">MOCK DATA: no backend connected</Chip>}
          {health && api.kind === "api" && (
            <span className="small">server: {health.paypal_mode} PayPal · {health.agent_mode} agent · checkout {health.checkout_mode}</span>
          )}
        </div>
        <nav aria-label="Console views">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls="main" className={`tab ${tab === t.id ? "on" : ""}`} onClick={() => go(t.id)}>
                {t.label}
                {t.id === "ledger" && approvals.length > 0 && <span className="badge" aria-label={`${approvals.length} awaiting approval`}>{approvals.length}</span>}
              </button>
            ))}
          </div>
        </nav>
      </header>

      <main id="main" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1}>
        {loadError && (
          <Notice kind="error">
            {loadError} <button className="btn" onClick={() => void refresh()}>Retry</button>
          </Notice>
        )}
        {tab === "mandates" && <MandateView />}
        {tab === "ledger" && <LedgerView />}
        {tab === "evidence" && <EvidenceView />}
        {tab === "disputes" && <DisputeView />}
      </main>

      <footer className="foot small">
        Signatures use our own ed25519 demo key. This project does not claim AP2/FIDO conformance, card-network integration or production readiness, and it does not shift liability. Everything runs against the PayPal sandbox.
      </footer>
    </>
  );
}

export default function Shell() {
  return (
    <StoreProvider>
      <Inner />
    </StoreProvider>
  );
}
