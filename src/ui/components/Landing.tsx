"use client";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useStore } from "../lib/store";
import type { TabId } from "../lib/store";
import { agentLabel } from "../lib/types";
import { Chip, Stamp } from "./ui";

/* ------------------------------ hero: a fence you can drag ------------------------------ */

const C = 260;
const R = 150;
const OUT = 222;
const TAU = Math.PI * 2;
const START = -Math.PI / 2;
const IN_SHARE = 0.78;

const dist = (amt: number, cap: number) => R * (0.38 + 0.62 * Math.sqrt(Math.min(Math.max(amt / cap, 0), 1.5)));
const pol = (r: number, a: number) => ({ x: C + r * Math.cos(a), y: C + r * Math.sin(a) });

type Cat = "groceries" | "electronics";

function HeroFence() {
  const [cap, setCap] = useState(200);
  const [appr, setAppr] = useState(75);
  const [price, setPrice] = useState(18);
  const [cat, setCat] = useState<Cat>("groceries");
  const apprEff = Math.min(appr, cap);

  const catOk = cat === "groceries";
  const overCap = price > cap;
  const verdict: "ok" | "ask" | "bad" = !catOk || overCap ? "bad" : price > apprEff ? "ask" : "ok";

  let r = dist(price, cap);
  const a = catOk ? START + TAU * IN_SHARE * 0.5 : START + TAU * IN_SHARE + TAU * (1 - IN_SHARE) * 0.5;
  if (!catOk) r = Math.max(r, R * 1.12);
  r = Math.min(r, OUT - 12);
  const dot = pol(r, a);
  const thr = dist(apprEff, cap);
  const labelOk = pol(R + 22, START + TAU * IN_SHARE * 0.5);
  const labelOut = pol(OUT + 14, START + TAU * IN_SHARE + TAU * (1 - IN_SHARE) * 0.5);
  const tone = verdict === "ok" ? "ok" : verdict === "ask" ? "warn" : "bad";
  const stampText = verdict === "ok" ? "Within mandate" : verdict === "ask" ? "Needs your approval" : "Outside mandate";

  return (
    <div className="lx-fence" aria-label="Interactive example of a spending mandate">
      <div className="lx-map">
        <svg viewBox="0 0 520 520" role="img" aria-label={`A purchase of $${price} in ${cat} against a $${cap} monthly cap is ${stampText.toLowerCase()}`}>
          <defs>
            <pattern id="lxhatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="9" height="9" fill="rgba(163,34,26,.04)" />
              <line x1="0" y1="0" x2="0" y2="9" stroke="rgba(163,34,26,.22)" strokeWidth="2" />
            </pattern>
          </defs>
          <circle cx={C} cy={C} r={OUT} fill="url(#lxhatch)" />
          <circle className="lx-cap" cx={C} cy={C} r={R} />
          <circle className="lx-thr" cx={C} cy={C} r={thr} />
          <line className="lx-sep" x1={pol(R, START + TAU * IN_SHARE).x} y1={pol(R, START + TAU * IN_SHARE).y} x2={pol(OUT, START + TAU * IN_SHARE).x} y2={pol(OUT, START + TAU * IN_SHARE).y} />
          <line className="lx-sep" x1={C} y1={C} x2={pol(R, START).x} y2={pol(R, START).y} />
          <text x={labelOk.x} y={labelOk.y} textAnchor="middle" dominantBaseline="middle">groceries</text>
          <text x={labelOut.x} y={labelOut.y} textAnchor="middle" dominantBaseline="middle" style={{ fill: "var(--wax)" }}>outside</text>
          <text className="lx-ring" x={C} y={C - R - 8} textAnchor="middle">cap ${cap}</text>
          <text className="lx-ring" x={C} y={C - thr - 6} textAnchor="middle">ask me above ${apprEff}</text>
          <text className="lx-mid" x={C} y={C + 8} textAnchor="middle">${price}</text>
          <g className={`lx-dot ${tone}`} style={{ transform: `translate(${dot.x}px, ${dot.y}px)` }}>
            <circle className="halo" r="14" />
            <circle className="core" r="10" />
          </g>
        </svg>
        <div className="lx-stampbar" aria-live="polite">
          <Stamp tone={tone} large tilt={-3} key={stampText}>{stampText}</Stamp>
          <p className="small muted">
            Checker (plain code): category {catOk ? "✓" : "✕"} · cap {overCap ? "✕" : "✓"} · approval line {price > apprEff && !overCap ? "reached" : "not reached"}
          </p>
        </div>
      </div>

      <div className="lx-controls">
        <h2 className="lx-ctl-h">Draw your agent’s fence</h2>
        <label htmlFor="lx-cap">Monthly cap <strong>${cap}</strong></label>
        <input id="lx-cap" type="range" min={50} max={500} step={10} value={cap} onChange={(e) => setCap(Number(e.target.value))} />
        <label htmlFor="lx-appr">Ask me first above <strong>${apprEff}</strong></label>
        <input id="lx-appr" type="range" min={10} max={cap} step={5} value={apprEff} onChange={(e) => setAppr(Number(e.target.value))} />
        <hr />
        <p className="muted small" style={{ margin: 0 }}>Now let the agent try to buy something.</p>
        <label htmlFor="lx-price">Price <strong>${price}</strong></label>
        <input id="lx-price" type="range" min={1} max={400} step={1} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
        <div className="sx-seg" role="group" aria-label="Category of the item">
          <button aria-pressed={cat === "groceries"} onClick={() => setCat("groceries")}>Groceries</button>
          <button aria-pressed={cat === "electronics"} onClick={() => setCat("electronics")}>Electronics</button>
        </div>
      </div>
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
        <dl className="sx-kv">
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
        <p><Chip tone="info">Picked</Chip> <strong>Coffee beans 1kg, $18.00</strong> <span className="muted">· “only coffee beans in the catalog”</span></p>
      </>
    ) : (
      <>
        <h3>You say: “buy sku ELE-GAME-01” with the demo switch on</h3>
        <p>Normally the guard would stop this. The sandbox demo switch lets the agent break its slip on purpose, so you can see how the record handles it.</p>
        <p><Chip tone="demo">Demo override</Chip> <strong>Games console, $299.00</strong> <span className="muted">· electronics</span></p>
      </>
    ),
    2: ok ? (
      <>
        <h3>The checker is plain code, not an AI</h3>
        <ul className="lx-checks">
          <li className="yes">Category “groceries” is allowed</li>
          <li className="yes">$18.00 fits the $200.00 monthly cap</li>
          <li className="yes">Under the $75.00 approval line, so no pause for you</li>
        </ul>
        <p><Stamp tone="ok">Within mandate</Stamp> The agent may go ahead.</p>
      </>
    ) : (
      <>
        <h3>The checker is plain code, not an AI</h3>
        <ul className="lx-checks">
          <li className="no">Category “electronics” is not on the slip</li>
          <li className="no">$299.00 is more than the $200.00 monthly cap</li>
          <li className="no">Over the $75.00 approval line</li>
        </ul>
        <p><Stamp tone="bad">Outside mandate</Stamp> The record says so honestly, even though the demo override let it through.</p>
      </>
    ),
    3: (
      <>
        <h3>Every decision becomes a linked page</h3>
        <p>Each record holds what the agent saw, what it chose, which mandate version applied and whether it was allowed. Each one carries the fingerprint of the one before it, so changing an old page breaks every page after it.</p>
        <div className="lx-chain" aria-label="Three linked evidence records">
          {["selected", "order_created", "captured"].map((d, i) => (
            <div key={d} className={`lx-block b${i}`}>
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
        <p><Stamp tone="ok" large>Defensible</Stamp></p>
        <p>Recommended action: <strong>provide evidence</strong>. The agent stayed inside its signed mandate, and the record proves it.</p>
      </>
    ) : (
      <>
        <h3>The buyer disputes the charge</h3>
        <p>The response is assembled from the evidence, and the verdict is computed by code. A model never gets to talk its way around it.</p>
        <p><Stamp tone="bad" large>Mandate breach</Stamp></p>
        <p>Recommended action: <strong>accept the claim</strong>. The agent went outside its mandate, so we say so instead of defending it.</p>
      </>
    ),
  };

  return (
    <div className="lx-walk">
      <div className="sx-seg" role="tablist" aria-label="Choose an example purchase">
        <button role="tab" aria-selected={ok} aria-pressed={ok} onClick={() => choose("ok")}>Coffee beans · $18</button>
        <button role="tab" aria-selected={!ok} aria-pressed={!ok} onClick={() => choose("bad")}>Games console · $299</button>
      </div>
      <ol className="lx-steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button className={`lx-stepbtn ${i === step ? "on" : ""} ${i < step ? "done" : ""}`} aria-current={i === step ? "step" : undefined} onClick={() => { setStep(i); setPlaying(false); }}>
              <span className="sn">{i < step ? "✓" : i + 1}</span>
              <span className="sl">{s}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className={`lx-panel ${ok ? "" : "bad"}`} key={`${kase}-${step}`} aria-live="polite">
        {panel[step]}
      </div>
      <div className="row wrap">
        <button className="sx-btn" disabled={step === 0} onClick={() => { setStep(step - 1); setPlaying(false); }}>Back</button>
        <button className="sx-btn primary" disabled={step === STEPS.length - 1} onClick={() => { setStep(step + 1); setPlaying(false); }}>Next</button>
        <button className="sx-btn" onClick={() => { if (step >= STEPS.length - 1) setStep(0); setPlaying((p) => !p); }}>{playing ? "Pause" : "Play it through"}</button>
      </div>
    </div>
  );
}

/* ---------------------------------- the page ---------------------------------- */

const PRODUCT: { tab: TabId; n: string; title: string; text: string }[] = [
  { tab: "fence", n: "00", title: "The fence", text: "Your mandate drawn as a space. Every purchase is a dot, and a breach stands out at once." },
  { tab: "mandates", n: "01", title: "Mandates", text: "Write the rules: how much, which kinds of things, when to ask you first. Edit them and a new signed version appears." },
  { tab: "ledger", n: "02", title: "Purchase ledger", text: "Tell the agent what to buy. Every choice lands here as a receipt with its mandate check, and large ones wait for your approval." },
  { tab: "evidence", n: "03", title: "Evidence trail", text: "Open any purchase to see what the agent saw, what it chose and why, plus a one-click chain check." },
  { tab: "disputes", n: "04", title: "Disputes", text: "Simulate a dispute and get a response built from the evidence, with the verdict computed by code." },
];

export default function Landing({ onOpen }: { onOpen: (tab?: TabId) => void }) {
  const { health, api } = useStore();
  return (
    <div className="sx lx">
      <a className="skip" href="#story">Skip to the story</a>
      <header className="lx-top">
        <div className="lx-wrap lx-top-in">
          <span className="lx-brand"><span className="sx-seal" aria-hidden="true">S</span>Sentry</span>
          <nav aria-label="Page sections" className="lx-links">
            <a href="#story">The story</a>
            <a href="#how">How it works</a>
            <a href="#product">The product</a>
            <a href="#honest">What’s real</a>
          </nav>
          <button className="sx-btn lx-gold" onClick={() => onOpen()}>Open the console</button>
        </div>
      </header>

      <section className="lx-hero">
        <div className="lx-wrap">
          <div className="lx-hero-copy">
            <span className="sx-kicker">Receipts for agentic payments · PayPal SANDBOX · no real money</span>
            <h1>Give your agent room. <em>Not the keys.</em></h1>
            <p className="lx-lede">
              When an AI agent spends your money, Sentry keeps the receipt that proves <em>why</em>: a signed permission slip, a strict checker and a notebook that cannot be quietly changed. When a charge is disputed, the answer comes from evidence, not guesswork.
            </p>
            <div className="row wrap">
              <button className="sx-btn primary lx-big" onClick={() => onOpen()}>Try the live console</button>
              <a className="sx-btn lx-big" href="#story">See the story in 60 seconds</a>
            </div>
            <p className="hero-status small muted">
              {health && api.kind === "api" ? (
                <>Live now · {health.paypal_mode} PayPal · {agentLabel(health)}</>
              ) : api.kind === "mock" ? (
                <>Preview with mock data</>
              ) : (
                <>Waking the server (the free host sleeps when idle)…</>
              )}
            </p>
          </div>
          <HeroFence />
        </div>
      </section>

      <section id="story" className="lx-sec">
        <div className="lx-wrap">
          <p className="sx-kicker">The story</p>
          <h2 className="lx-h2">A helper robot goes shopping</h2>
          <p className="lx-sub">Three scenes, no jargon.</p>
          <div className="lx-trio">
            <article className="lx-scene">
              <Stamp tone="bad" tilt={-4} pop>Unproven</Stamp>
              <span className="sx-kicker">The problem</span>
              <h3>Nobody wrote down what the robot was allowed to do</h3>
              <p>
                You let a helper robot do your shopping. Later the shop says “someone paid for a games console!” Was the robot allowed to? Why did it pick that? Nobody can prove it either way, and the money is stuck in an argument.
              </p>
            </article>
            <article className="lx-scene">
              <Stamp tone="ok" tilt={3} pop>Signed</Stamp>
              <span className="sx-kicker">How we help</span>
              <h3>A signed slip, a strict checker, and a notebook that can’t be quietly changed</h3>
              <p>
                Before it shops, the robot gets a permission slip you sign: how much, and what kinds of things. Each time it picks something, a checker made of plain code says yes or no, and the choice is written in a notebook where every page is stitched to the last.
              </p>
            </article>
            <article className="lx-scene">
              <Stamp tone="info" tilt={-2} pop>Case closed</Stamp>
              <span className="sx-kicker">The result</span>
              <h3>When there’s a fight, we open the notebook</h3>
              <p>
                If the robot followed the slip, you show the proof. If it broke the slip, the notebook says so and we recommend giving the money back. The verdict is worked out by code, so it stays honest either way.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section id="how" className="lx-sec lx-alt">
        <div className="lx-wrap">
          <p className="sx-kicker">How it works</p>
          <h2 className="lx-h2">Follow one purchase</h2>
          <p className="lx-sub">Pick an example and step through it. This mirrors what the console records.</p>
          <Walkthrough />
        </div>
      </section>

      <section id="product" className="lx-sec">
        <div className="lx-wrap">
          <p className="sx-kicker">What we built</p>
          <h2 className="lx-h2">A working console, five views</h2>
          <p className="lx-sub">Real server, real PayPal sandbox orders, live updates. Click a view to jump straight in.</p>
          <div className="lx-prod">
            <div className="lx-cards">
              {PRODUCT.map((p) => (
                <button key={p.tab} className="lx-card" onClick={() => onOpen(p.tab)}>
                  <span className="n" aria-hidden="true">{p.n}</span>
                  <strong>{p.title}</strong>
                  <span>{p.text}</span>
                  <span className="go">Open this view →</span>
                </button>
              ))}
            </div>
            <div className="lx-rcpts" aria-label="Example of the purchase ledger">
              <p className="sx-kicker" style={{ margin: "0 0 10px" }}>Example data · purchase ledger</p>
              <article className="sx-rcpt">
                <div className="row spread"><span className="sx-kicker">Completed</span><Chip tone="ok">Completed</Chip></div>
                <h3 style={{ margin: "6px 0 0" }}>Olive oil 1L</h3>
                <div className="amt">USD 9.00</div>
                <hr />
                <div className="stampzone"><Stamp tone="ok">Within mandate</Stamp></div>
              </article>
              <article className="sx-rcpt">
                <div className="row spread"><span className="sx-kicker">Awaiting payer</span><Chip tone="info">Awaiting payer</Chip></div>
                <h3 style={{ margin: "6px 0 0" }}>Pantry restock box A</h3>
                <div className="amt">USD 42.00</div>
                <hr />
                <div className="stampzone"><Stamp tone="ok">Within mandate</Stamp></div>
              </article>
              <article className="sx-rcpt breach">
                <div className="row spread"><span className="sx-kicker">Disputed</span><Chip tone="warn">Disputed</Chip></div>
                <h3 style={{ margin: "6px 0 0" }}>Games console</h3>
                <div className="amt">USD 299.00</div>
                <hr />
                <div className="stampzone"><Stamp tone="bad">Outside mandate</Stamp></div>
              </article>
            </div>
          </div>
          <div className="row wrap" style={{ marginTop: 30 }}>
            <button className="sx-btn primary lx-big" onClick={() => onOpen()}>Open the console</button>
            <button className="sx-btn lx-big" onClick={() => onOpen("ledger")}>Ask the agent to buy something</button>
          </div>
        </div>
      </section>

      <section id="honest" className="lx-sec lx-alt">
        <div className="lx-wrap">
          <p className="sx-kicker">What’s real</p>
          <h2 className="lx-h2">Honest about the edges</h2>
          <div className="lx-honest">
            <div className="real">
              <Stamp tone="ok" tilt={-3}>Real</Stamp>
              <ul>
                <li>Orders and captures on the PayPal <strong>sandbox</strong>, with signed webhooks</li>
                <li>ed25519-signed, versioned mandates</li>
                <li>A hash-chained evidence record with a chain check</li>
                <li>A checker and dispute verdict written as code</li>
              </ul>
            </div>
            <div className="not">
              <Stamp tone="warn" tilt={2}>Not claimed</Stamp>
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

      <footer className="lx-foot">
        <div className="lx-wrap lx-foot-in">
          <span><strong>Sentry</strong> · built for the PayPal AI Hackathon 2026</span>
          <span className="row wrap">
            <a href="https://github.com/BUTTERFINGERS7498/PaypalAi" target="_blank" rel="noopener noreferrer">Source on GitHub</a>
            <button className="lx-link" onClick={() => onOpen()}>Open the console</button>
          </span>
        </div>
      </footer>
    </div>
  );
}
