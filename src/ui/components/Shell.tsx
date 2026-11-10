"use client";
import { useCallback, useEffect, useState } from "react";
import { StoreProvider, useStore } from "../lib/store";
import { agentLabel } from "../lib/types";
import type { TabId } from "../lib/store";
import DisputeView from "./DisputeView";
import EvidenceView from "./EvidenceView";
import FenceView from "./FenceView";
import Landing from "./Landing";
import LedgerView from "./LedgerView";
import MandateView from "./MandateView";
import MerchantView from "./MerchantView";
import { Chip, Notice } from "./ui";

const TABS: { id: TabId; n: string; label: string; title: string; help: string }[] = [
  { id: "fence", n: "00", label: "The fence", title: "The fence", help: "Your mandate drawn as a space. Every purchase is a dot: inside the ring it is allowed, between the rings it asked you first, in the hatched band it broke the rules." },
  { id: "mandates", n: "01", label: "Mandates", title: "Mandates", help: "The rules you sign for the agent: how much, which kinds of things, and when it must ask you first. Editing creates a new signed version; old versions never change." },
  { id: "ledger", n: "02", label: "Purchase ledger", title: "Purchase ledger", help: "Tell the agent what to buy. Every choice lands here with its mandate check, and larger ones wait in the approval queue." },
  { id: "evidence", n: "03", label: "Evidence trail", title: "Evidence trail", help: "The notebook behind each purchase: what the agent saw, what it chose and whether it was allowed. Records are hash-chained, so edits show." },
  { id: "disputes", n: "04", label: "Disputes", title: "Disputes", help: "When a charge is challenged, the response is built from the evidence. The verdict (defensible or mandate breach) is computed by code." },
  { id: "merchant", n: "05", label: "Merchant view", title: "Merchant view", help: "The seller's side: before shipping an order placed by an AI agent, check the signed mandate, the evidence chain and the payment. Ship, wait, or do not ship." },
];

function Console({ onHome }: { onHome: () => void }) {
  const { tab, go, api, health, loadError, refresh, token, setToken, operator, setOperator, approvals, live } = useStore();
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  return (
    <div className="sx">
      <a className="skip" href="#main">Skip to content</a>
      <aside className="sx-rail">
        <button className="sx-brand" onClick={onHome} aria-label="Sentry home">
          <span className="sx-seal" aria-hidden="true">S</span>
          <span>
            <span className="sx-brand-name">Sentry</span>
            <span className="sx-brand-tag">Receipts for agentic payments</span>
          </span>
        </button>
        <nav aria-label="Console views" className="sx-nav" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls="main" onClick={() => go(t.id)}>
              <span className="n" aria-hidden="true">{t.n}</span>
              <span>{t.label}</span>
              {t.id === "ledger" && approvals.length > 0 ? <span className="badge" aria-label={`${approvals.length} awaiting approval`}>{approvals.length}</span> : <span />}
            </button>
          ))}
        </nav>
        <div className="sx-rail-foot">
          <div className="sx-status">
            <span><span className={`dot ${live ? "on" : ""}`} aria-hidden="true" />{live ? "Live" : "Connecting…"}</span>
            <span>PayPal SANDBOX · no real money</span>
            {api.kind === "mock" && <span>MOCK DATA: no backend connected</span>}
            {health && api.kind === "api" && <span>{health.paypal_mode} PayPal · {agentLabel(health)}</span>}
          </div>
          <details className="sx-who">
            <summary>Name &amp; password</summary>
            <div className="sx-who-pop">
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
      </aside>

      <main id="main" className="sx-main" role="tabpanel" aria-labelledby={`tab-${tab}`} tabIndex={-1}>
        <header className="sx-head">
          <span className="sx-kicker">Console · {current.n}</span>
          <div className="row wrap spread">
            <h1>{current.title}</h1>
            <span className="row wrap">
              <Chip tone="info">PayPal SANDBOX</Chip>
              {api.kind === "mock" && <Chip tone="demo">MOCK DATA</Chip>}
            </span>
          </div>
          <p className="sx-help">{current.help}</p>
        </header>
        {loadError && (
          <Notice kind="error">
            {loadError} <button className="sx-btn sm" onClick={() => void refresh()}>Retry</button>
          </Notice>
        )}
        {tab === "fence" && <FenceView />}
        {tab === "mandates" && <MandateView />}
        {tab === "ledger" && <LedgerView />}
        {tab === "evidence" && <EvidenceView />}
        {tab === "disputes" && <DisputeView />}
        {tab === "merchant" && <MerchantView />}
        <footer className="sx-foot">
          Signatures use our own ed25519 demo key. This project does not claim AP2/FIDO conformance, card-network integration or production readiness, and it does not shift liability. Everything runs against the PayPal sandbox.
        </footer>
      </main>
    </div>
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
