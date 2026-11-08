"use client";
import { useCallback, useEffect, useState } from "react";
import { StoreProvider, useStore } from "../lib/store";
import { agentLabel } from "../lib/types";
import type { TabId } from "../lib/store";
import DisputeView from "./DisputeView";
import EvidenceView from "./EvidenceView";
import Landing from "./Landing";
import LedgerView from "./LedgerView";
import MandateView from "./MandateView";
import { Chip, Notice } from "./ui";

const TABS: { id: TabId; label: string; help: string }[] = [
  { id: "mandates", label: "1. Mandates", help: "The rules you sign for the agent: how much, which kinds of things, and when it must ask you first. Editing creates a new signed version; old versions never change." },
  { id: "ledger", label: "2. Purchase ledger", help: "Tell the agent what to buy. Every choice lands here with its mandate check, and larger ones wait in the approval queue." },
  { id: "evidence", label: "3. Evidence trail", help: "The notebook behind each purchase: what the agent saw, what it chose and whether it was allowed. Records are hash-chained, so edits show." },
  { id: "disputes", label: "4. Disputes", help: "When a charge is challenged, the response is built from the evidence. The verdict (defensible or mandate breach) is computed by code." },
];

function Console({ onHome }: { onHome: () => void }) {
  const { tab, go, api, health, loadError, refresh, token, setToken, operator, setOperator, approvals } = useStore();
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="top">
        <div className="top-in">
          <button className="brand" onClick={onHome} aria-label="Sentry home">
            <span className="bm-dot" aria-hidden="true" />
            <span>
              <span className="brand-name">Sentry</span>
              <span className="tag">Receipts for agentic payments</span>
            </span>
          </button>
          <div className="top-right">
            <div className="banner row wrap">
              <Chip tone="info">PayPal SANDBOX · no real money</Chip>
              {api.kind === "mock" && <Chip tone="demo">MOCK DATA: no backend connected</Chip>}
              {health && api.kind === "api" && (
                <span className="small top-status">{health.paypal_mode} PayPal · {agentLabel(health)}</span>
              )}
            </div>
            <details className="who">
              <summary>Name &amp; password</summary>
              <div className="who-pop">
                <div>
                  <label htmlFor="op">Your name (recorded on decisions)</label>
                  <input id="op" value={operator} onChange={(e) => setOperator(e.target.value)} autoComplete="off" />
                </div>
                <div>
                  <label htmlFor="tok">Approval password (only if the server asks)</label>
                  <input id="tok" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" placeholder="kept in memory only" />
                </div>
              </div>
            </details>
          </div>
        </div>
        <nav aria-label="Console views" className="top-nav">
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
        <p className="page-help">{current.help}</p>
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

function Router() {
  const { go } = useStore();
  const [view, setView] = useState<"home" | "console">("home");

  useEffect(() => {
    const sync = () => setView(window.location.hash === "#console" ? "console" : "home");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const openConsole = useCallback(
    (tab?: TabId) => {
      if (tab) go(tab);
      window.location.hash = "console";
      window.scrollTo({ top: 0 });
    },
    [go],
  );
  const goHome = useCallback(() => {
    window.location.hash = "home";
    window.scrollTo({ top: 0 });
  }, []);

  return view === "console" ? <Console onHome={goHome} /> : <Landing onOpen={openConsole} />;
}

export default function Shell() {
  return (
    <StoreProvider>
      <Router />
    </StoreProvider>
  );
}
