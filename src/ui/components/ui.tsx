"use client";
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { STATUS_LABEL, breachLabel } from "../lib/format";
import { errMsg } from "../lib/store";

type Tone = "ok" | "warn" | "bad" | "info" | "neutral" | "demo";

export function Chip({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`sx-chip t-${tone}`} title={title}>
      {children}
    </span>
  );
}

/** An ink stamp, like a notary mark. `pop` plays the press animation once on mount. */
export function Stamp({ tone, children, tilt = -3, title, large, pop }: { tone: Tone; children: ReactNode; tilt?: number; title?: string; large?: boolean; pop?: boolean }) {
  return (
    <span className={`sx-stamp t-${tone} ${large ? "lg" : ""} ${pop ? "pop" : ""}`} style={{ "--tilt": `${tilt}deg` } as CSSProperties} title={title}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  completed: "ok",
  awaiting_payer: "info",
  pending_approval: "warn",
  rejected: "neutral",
  failed: "bad",
  disputed: "warn",
  dispute_resolved: "neutral",
  refunded: "info",
};
export const StatusChip = ({ status }: { status: string }) => (
  <Chip tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</Chip>
);

export function Flags({ within, breaches, rogue, stamp }: { within: boolean; breaches: string[]; rogue: boolean; stamp?: boolean }) {
  const Mark = stamp ? Stamp : Chip;
  return (
    <span className="sx-flags">
      {!within && (
        <Mark tone="bad" title="The mandate checker found this choice outside the signed mandate">
          Outside mandate{breaches.length ? `: ${breaches.map(breachLabel).join(", ")}` : ""}
        </Mark>
      )}
      {rogue && (
        <Mark tone="demo" title="Demo switch: the guard was told to let the agent break its mandate">
          Demo: agent overrides its mandate
        </Mark>
      )}
      {within && !rogue && <Mark tone="ok">Within mandate</Mark>}
    </span>
  );
}

export function Notice({ kind, children }: { kind: "error" | "info" | "ok" | "warn"; children: ReactNode }) {
  return (
    <div className={`sx-notice n-${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

/** Runs an async action with busy/error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(errMsg(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}

export function Section({ title, children, actions, id }: { title: string; children: ReactNode; actions?: ReactNode; id?: string }) {
  return (
    <section className="sx-panel" aria-labelledby={id}>
      <div className="sx-panel-head">
        <h2 id={id}>{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
