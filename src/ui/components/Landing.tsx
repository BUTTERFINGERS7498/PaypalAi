"use client";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useStore } from "../lib/store";
import type { TabId } from "../lib/store";
import { agentLabel } from "../lib/types";

/* ----------------------------- small illustrations ----------------------------- */

function Robot({ mood }: { mood: "worried" | "happy" | "calm" }) {
  return (
    <g className="rb">
      <line x1="60" y1="14" x2="60" y2="26" stroke="#0f1b2d" strokeWidth="3" strokeLinecap="round" />
      <circle cx="60" cy="12" r="5" fill="#f59e0b" className="rb-ant" />
      <rect x="30" y="26" width="60" height="46" rx="14" fill="#e8eefc" stroke="#0f1b2d" strokeWidth="3" />
      <circle cx="47" cy="48" r="5" fill="#0f1b2d" />
      <circle cx="73" cy="48" r="5" fill="#0f1b2d" />
      {mood === "worried" && <path d="M48 62 q12 -7 24 0" fill="none" stroke="#0f1b2d" strokeWidth="3" strokeLinecap="round" />}
      {mood === "happy" && <path d="M48 58 q12 10 24 0" fill="none" stroke="#0f1b2d" strokeWidth="3" strokeLinecap="round" />}
      {mood === "calm" && <path d="M50 60 h20" fill="none" stroke="#0f1b2d" strokeWidth="3" strokeLinecap="round" />}
      <rect x="38" y="76" width="44" height="30" rx="10" fill="#1d3f9e" stroke="#0f1b2d" strokeWidth="3" />
    </g>
  );
}

function ProblemArt() {
  return (
    <svg viewBox="0 0 320 190" role="img" aria-label="A shopping robot, a basket holding a games console, and a puzzled person with a question mark" className="art">
      <rect x="0" y="150" width="320" height="4" rx="2" fill="#d9e0ea" />
      <g transform="translate(20 38)"><Robot mood="calm" /></g>
      <g transform="translate(132 96)">
        <path d="M0 0 h72 l-9 40 h-54 z" fill="#fff" stroke="#0f1b2d" strokeWidth="3" strokeLinejoin="round" />
        <circle cx="16" cy="52" r="6" fill="#0f1b2d" /><circle cx="52" cy="52" r="6" fill="#0f1b2d" />
        <rect x="14" y="-22" width="44" height="22" rx="4" fill="#fde2e1" stroke="#7a0f0b" strokeWidth="3" />
        <circle cx="26" cy="-11" r="4" fill="#7a0f0b" /><rect x="40" y="-14" width="12" height="6" rx="2" fill="#7a0f0b" />
      </g>
      <text x="232" y="60" className="qm q1">?</text>
      <text x="262" y="100" className="qm q2">?</text>
      <text x="240" y="130" className="qm q3">?</text>
    </svg>
  );
}

function SlipArt() {
  return (
    <svg viewBox="0 0 320 190" role="img" aria-label="A signed permission slip, a checker with a tick, and a notebook of linked pages" className="art">
      <rect x="0" y="150" width="320" height="4" rx="2" fill="#d9e0ea" />
      <g transform="translate(10 22)">
        <rect width="92" height="118" rx="8" fill="#fff" stroke="#0f1b2d" strokeWidth="3" />
        <rect x="12" y="14" width="44" height="6" rx="3" fill="#1d3f9e" />
        <rect x="12" y="30" width="68" height="5" rx="2.5" fill="#cfd6e0" />
        <rect x="12" y="42" width="60" height="5" rx="2.5" fill="#cfd6e0" />
        <rect x="12" y="54" width="64" height="5" rx="2.5" fill="#cfd6e0" />
        <path className="sign" d="M14 96 q10 -22 20 0 t22 -4 t18 2" fill="none" stroke="#0f766e" strokeWidth="3.5" strokeLinecap="round" />
      </g>
      <g transform="translate(120 44)">
        <circle cx="34" cy="34" r="32" fill="#e6f6f2" stroke="#0f766e" strokeWidth="3" />
        <path className="tick" d="M18 36 l12 12 l22 -26" fill="none" stroke="#0f766e" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g transform="translate(212 40)">
        {[0, 1, 2].map((i) => (
          <g key={i} transform={`translate(0 ${i * 34})`}>
            <g className={`page p${i}`}>
              <rect width="92" height="28" rx="6" fill="#fff" stroke="#0f1b2d" strokeWidth="3" />
              <rect x="10" y="9" width="40" height="5" rx="2.5" fill="#cfd6e0" />
              <rect x="10" y="18" width="26" height="4" rx="2" fill="#1d3f9e" />
              <circle cx="76" cy="14" r="5" fill="#f59e0b" />
            </g>
          </g>
        ))}
        <path d="M46 28 v6 M46 62 v6" stroke="#0f1b2d" strokeWidth="3" strokeDasharray="2 3" />
      </g>
    </svg>
  );
}

function ResultArt() {
  return (
    <svg viewBox="0 0 320 190" role="img" aria-label="An open notebook with a green tick and a happy robot" className="art">
      <rect x="0" y="150" width="320" height="4" rx="2" fill="#d9e0ea" />
      <g transform="translate(190 40)"><Robot mood="happy" /></g>
      <g transform="translate(22 34)">
        <rect width="132" height="108" rx="10" fill="#fff" stroke="#0f1b2d" strokeWidth="3" />
        <line x1="66" y1="6" x2="66" y2="102" stroke="#cfd6e0" strokeWidth="3" />
        <rect x="14" y="20" width="40" height="5" rx="2.5" fill="#cfd6e0" />
        <rect x="14" y="32" width="34" height="5" rx="2.5" fill="#cfd6e0" />
        <rect x="14" y="44" width="38" height="5" rx="2.5" fill="#cfd6e0" />
        <rect x="78" y="20" width="40" height="5" rx="2.5" fill="#cfd6e0" />
        <g transform="translate(84 52)">
          <g className="stamp">
            <rect width="42" height="26" rx="5" fill="#dff3e4" stroke="#0d4a1f" strokeWidth="2.5" transform="rotate(-6 21 13)" />
            <path d="M12 14 l6 6 l12 -13" fill="none" stroke="#0d4a1f" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" transform="rotate(-6 21 13)" />
          </g>
        </g>
      </g>
    </svg>
  );
}

/* --------------------------------- hero visual --------------------------------- */

function HeroFlow() {
  return (
    <div className="flow" aria-label="Example: a purchase travels from signed mandate to agent choice, to a hash-chained record, to a dispute verdict">
      <div className="flow-tag">Example, step by step</div>
      <ol className="flow-list">
        <li className="fc fc1">
          <span className="fc-n">1</span>
          <div>
            <strong>Permission slip</strong>
            <p>Groceries only · $200 a month · ask me above $75</p>
          </div>
          <span className="chip chip-info">Signed · v1</span>
        </li>
        <li className="fc fc2">
          <span className="fc-n">2</span>
          <div>
            <strong>Agent picks: Coffee beans 1kg, $18.00</strong>
            <p>Checker (plain code): category ✓ budget ✓ under $75 ✓</p>
          </div>
          <span className="chip chip-ok">Within mandate</span>
        </li>
        <li className="fc fc3">
          <span className="fc-n">3</span>
          <div>
            <strong>Written in the notebook</strong>
            <p className="mono">prev 71b0…c3d8 → 9f2c…a41e</p>
          </div>
          <span className="chip chip-neutral">Linked</span>
        </li>
        <li className="fc fc4">
          <span className="fc-n">4</span>
          <div>
            <strong>If the charge is disputed</strong>
            <p>Evidence is assembled; the verdict comes from code</p>
          </div>
          <span className="chip chip-ok">Defensible</span>
        </li>
      </ol>
    </div>
  );
}

/* ------------------------------ interactive walkthrough ------------------------------ */

type CaseId = "ok" | "bad";
const STEPS = ["Sign the mandate", "Agent chooses", "Checker decides", "Evidence is written", "Dispute arrives"] as const;

function Walkthrough() {
  const [kase, setKase] = useState<CaseId>("ok");
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const ok = kase === "ok";

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      setStep((s) => {
        if (s >= STEPS.length - 1) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, 2200);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing]);

  const choose = (c: CaseId) => {
    setKase(c);
    setStep(0);
    setPlaying(false);
  };

  const panel: Record<number, ReactNode> = {
    0: (
      <>
        <h3>You give the agent a signed permission slip</h3>
        <dl className="kv">
          <dt>Label</dt><dd>Groceries, $200/month</dd>
          <dt>Allowed</dt><dd>groceries only</dd>
          <dt>Monthly cap</dt><dd>$200.00</dd>
          <dt>Ask me first above</dt><dd>$75.00</dd>
          <dt>Seal</dt><dd>ed25519 signature · version 1 (a later edit becomes version 2; old versions never change)</dd>
        </dl>
      </>
    ),
    1: ok ? (
      <>
        <h3>You say: “restock the coffee”</h3>
        <p>The agent looks at the shop’s catalog and records every option it saw, then picks one and says why.</p>
        <p><span className="chip chip-info">Picked</span> <strong>Coffee beans 1kg, $18.00</strong> <span className="muted">· “only coffee beans in the catalog”</span></p>
      </>
    ) : (
      <>
        <h3>You say: “buy sku ELE-GAME-01” with the demo switch on</h3>
        <p>Normally the guard would stop this. The sandbox demo switch lets the agent break its slip on purpose, so you can see how the record handles it.</p>
        <p><span className="chip chip-demo">Demo override</span> <strong>Games console, $299.00</strong> <span className="muted">· electronics</span></p>
      </>
    ),
    2: ok ? (
      <>
        <h3>The checker is plain code, not an AI</h3>
        <ul className="checks">
          <li className="yes">Category “groceries” is allowed</li>
          <li className="yes">$18.00 fits the $200.00 monthly cap</li>
          <li className="yes">Under the $75.00 approval line, so no pause for you</li>
        </ul>
        <p><span className="chip chip-ok">Within mandate</span> The agent may go ahead.</p>
      </>
    ) : (
      <>
        <h3>The checker is plain code, not an AI</h3>
        <ul className="checks">
          <li className="no">Category “electronics” is not on the slip</li>
          <li className="no">$299.00 is more than the $200.00 monthly cap</li>
          <li className="no">Over the $75.00 approval line</li>
        </ul>
        <p><span className="chip chip-bad">Outside mandate</span> The record says so honestly, even though the demo override let it through.</p>
      </>
    ),
    3: (
      <>
        <h3>Every decision becomes a linked page</h3>
        <p>Each record holds what the agent saw, what it chose, which mandate version applied and whether it was allowed. Each one carries the fingerprint of the one before it, so changing an old page breaks every page after it.</p>
        <div className="chain" aria-label="Three linked evidence records">
          {["selected", "order_created", "captured"].map((d, i) => (
            <div key={d} className={`block b${i}`}>
              <strong>{d}</strong>
              <span className="mono">{["a41e…07", "c9d2…5b", "3e80…f1"][i]}</span>
              <span className="muted small">{i === 0 ? "prev: 0000…" : `prev: ${["a41e…07", "c9d2…5b"][i - 1]}`}</span>
            </div>
          ))}
        </div>
        <p className="small muted">Example fingerprints. The live console has a “verify chain” check that recomputes the real ones.</p>
      </>
    ),
    4: ok ? (
      <>
        <h3>The buyer disputes the charge</h3>
        <p>The response is assembled from the evidence, and the verdict is computed by code.</p>
        <p><span className="chip chip-ok">DEFENSIBLE</span> Recommended action: <strong>provide evidence</strong>. The agent stayed inside its signed mandate, and the record proves it.</p>
      </>
    ) : (
      <>
        <h3>The buyer disputes the charge</h3>
        <p>The response is assembled from the evidence, and the verdict is computed by code. A model never gets to talk its way around it.</p>
        <p><span className="chip chip-bad">MANDATE BREACH</span> Recommended action: <strong>accept the claim</strong>. The agent went outside its mandate, so we say so instead of defending it.</p>
      </>
    ),
  };

  return (
    <div className="walk">
      <div className="seg" role="tablist" aria-label="Choose an example purchase">
        <button role="tab" aria-selected={ok} className={ok ? "on" : ""} onClick={() => choose("ok")}>Coffee beans · $18</button>
        <button role="tab" aria-selected={!ok} className={!ok ? "on" : ""} onClick={() => choose("bad")}>Games console · $299</button>
      </div>
      <ol className="steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button className={`stepbtn ${i === step ? "on" : ""} ${i < step ? "done" : ""}`} aria-current={i === step ? "step" : undefined} onClick={() => { setStep(i); setPlaying(false); }}>
              <span className="sn">{i < step ? "✓" : i + 1}</span>
              <span className="sl">{s}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className={`walk-panel ${ok ? "" : "walk-bad"}`} key={`${kase}-${step}`} aria-live="polite">
        {panel[step]}
      </div>
      <div className="row wrap">
        <button className="btn" disabled={step === 0} onClick={() => { setStep(step - 1); setPlaying(false); }}>Back</button>
        <button className="btn primary" disabled={step === STEPS.length - 1} onClick={() => { setStep(step + 1); setPlaying(false); }}>Next</button>
        <button className="btn" onClick={() => { if (step >= STEPS.length - 1) setStep(0); setPlaying((p) => !p); }}>{playing ? "Pause" : "Play it through"}</button>
      </div>
    </div>
  );
}

/* ---------------------------------- the page ---------------------------------- */

const PRODUCT: { tab: TabId; title: string; text: string; icon: string }[] = [
  { tab: "mandates", title: "1. Mandates", text: "Write the rules: how much, which kinds of things, when to ask you first. Edit them and a new signed version appears.", icon: "✎" },
  { tab: "ledger", title: "2. Purchase ledger", text: "Tell the agent what to buy. Every choice lands here with its mandate check, and large ones wait for your approval.", icon: "☰" },
  { tab: "evidence", title: "3. Evidence trail", text: "Open any purchase to see what the agent saw, what it chose and why, plus a one-click chain check.", icon: "⛓" },
  { tab: "disputes", title: "4. Disputes", text: "Simulate a dispute and get a response built from the evidence, with the verdict computed by code.", icon: "⚖" },
];

export default function Landing({ onOpen }: { onOpen: (tab?: TabId) => void }) {
  const { health, api } = useStore();
  return (
    <div className="landing">
      <a className="skip" href="#story">Skip to the story</a>
      <header className="lp-top">
        <div className="lp-wrap lp-top-in">
          <span className="brand-mark"><span className="bm-dot" aria-hidden="true" />Sentry</span>
          <nav aria-label="Page sections" className="lp-links">
            <a href="#story">The story</a>
            <a href="#how">How it works</a>
            <a href="#product">The product</a>
            <a href="#honest">What’s real</a>
          </nav>
          <button className="btn primary" onClick={() => onOpen()}>Open the console</button>
        </div>
      </header>

      <section className="hero">
        <div className="lp-wrap hero-in">
          <div className="hero-copy">
            <span className="chip chip-demo hero-chip">PayPal SANDBOX · no real money</span>
            <h1>When an AI agent spends your money, keep the receipt that proves <em>why</em>.</h1>
            <p className="lede">
              Sentry gives every agent purchase a signed permission slip and a tamper-evident notebook entry. When a charge is disputed, the answer comes from evidence, not guesswork.
            </p>
            <div className="row wrap">
              <button className="btn primary big" onClick={() => onOpen()}>Try the live console</button>
              <a className="btn big ghost" href="#story">See the story in 60 seconds</a>
            </div>
            <p className="hero-status small">
              {health && api.kind === "api" ? (
                <>
                  <span className="dot ok" aria-hidden="true" /> Live now · {health.paypal_mode} PayPal · {agentLabel(health)}
                </>
              ) : api.kind === "mock" ? (
                <>
                  <span className="dot demo" aria-hidden="true" /> Preview with mock data
                </>
              ) : (
                <>
                  <span className="dot" aria-hidden="true" /> Waking the server (the free host sleeps when idle)…
                </>
              )}
            </p>
          </div>
          <HeroFlow />
        </div>
      </section>

      <section id="story" className="lp-sec">
        <div className="lp-wrap">
          <p className="eyebrow">The story</p>
          <h2 className="lp-h2">A helper robot goes shopping</h2>
          <p className="lp-sub">Three scenes, no jargon.</p>
          <div className="trio">
            <article className="scene">
              <span className="scene-n">The problem</span>
              <ProblemArt />
              <h3>Nobody wrote down what the robot was allowed to do</h3>
              <p>
                You let a helper robot do your shopping. Later the shop says “someone paid for a games console!” Was the robot allowed to? Why did it pick that? Nobody can prove it either way, and the money is stuck in an argument.
              </p>
            </article>
            <article className="scene">
              <span className="scene-n">How we help</span>
              <SlipArt />
              <h3>A signed slip, a strict checker, and a notebook that can’t be quietly changed</h3>
              <p>
                Before it shops, the robot gets a permission slip you sign: how much, and what kinds of things. Each time it picks something, a checker made of plain code says yes or no, and the choice is written in a notebook where every page is stitched to the last.
              </p>
            </article>
            <article className="scene">
              <span className="scene-n">The result</span>
              <ResultArt />
              <h3>When there’s a fight, we open the notebook</h3>
              <p>
                If the robot followed the slip, you show the proof. If it broke the slip, the notebook says so and we recommend giving the money back. The verdict is worked out by code, so it stays honest either way.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section id="how" className="lp-sec lp-alt">
        <div className="lp-wrap">
          <p className="eyebrow">How it works</p>
          <h2 className="lp-h2">Follow one purchase</h2>
          <p className="lp-sub">Pick an example and step through it. This mirrors what the console records.</p>
          <Walkthrough />
        </div>
      </section>

      <section id="product" className="lp-sec">
        <div className="lp-wrap">
          <p className="eyebrow">What we built</p>
          <h2 className="lp-h2">A working console, four views</h2>
          <p className="lp-sub">Real server, real PayPal sandbox orders, live updates. Click a view to jump straight in.</p>
          <div className="prod">
            <div className="prod-cards">
              {PRODUCT.map((p) => (
                <button key={p.tab} className="pcard" onClick={() => onOpen(p.tab)}>
                  <span className="pi" aria-hidden="true">{p.icon}</span>
                  <strong>{p.title}</strong>
                  <span>{p.text}</span>
                  <span className="go">Open this view →</span>
                </button>
              ))}
            </div>
            <div className="mini" aria-label="Example of the purchase ledger">
              <div className="mini-bar"><span className="chip chip-neutral">Example data</span><strong>Purchase ledger</strong></div>
              <table>
                <thead><tr><th>Item</th><th className="num">Amount</th><th>Status</th><th>Mandate check</th></tr></thead>
                <tbody>
                  <tr><td>Olive oil 1L</td><td className="num">$9.00</td><td><span className="chip chip-ok">Completed</span></td><td><span className="chip chip-ok">Within mandate</span></td></tr>
                  <tr><td>Pantry restock box A</td><td className="num">$42.00</td><td><span className="chip chip-info">Awaiting payer</span></td><td><span className="chip chip-ok">Within mandate</span></td></tr>
                  <tr className="picked-bad"><td>Games console</td><td className="num">$299.00</td><td><span className="chip chip-warn">Disputed</span></td><td><span className="chip chip-bad">Outside mandate</span></td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="row wrap cta-row">
            <button className="btn primary big" onClick={() => onOpen()}>Open the console</button>
            <button className="btn big ghost" onClick={() => onOpen("ledger")}>Ask the agent to buy something</button>
          </div>
        </div>
      </section>

      <section id="honest" className="lp-sec lp-alt">
        <div className="lp-wrap">
          <p className="eyebrow">What’s real</p>
          <h2 className="lp-h2">Honest about the edges</h2>
          <div className="honest">
            <div>
              <h3>Real</h3>
              <ul>
                <li>Orders and captures on the PayPal <strong>sandbox</strong>, with signed webhooks</li>
                <li>ed25519-signed, versioned mandates</li>
                <li>A hash-chained evidence record with a chain check</li>
                <li>A checker and dispute verdict written as code</li>
              </ul>
            </div>
            <div>
              <h3>Not claimed</h3>
              <ul>
                <li>Disputes in this demo are <strong>simulated</strong></li>
                <li>No AP2 or FIDO conformance, no card-network integration, no liability shift</li>
                <li>Signatures use our own demo key</li>
                <li>The hosted agent is a small on-server matcher, not a large language model</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <span><strong>Sentry</strong> · built for the PayPal AI Hackathon 2026</span>
          <span className="row wrap">
            <a href="https://github.com/BUTTERFINGERS7498/PaypalAi" target="_blank" rel="noopener noreferrer">Source on GitHub</a>
            <button className="linkbtn" onClick={() => onOpen()}>Open the console</button>
          </span>
        </div>
      </footer>
    </div>
  );
}
