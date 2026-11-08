"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import { STATUS_LABEL, breachLabel } from "../lib/format";
import { errMsg } from "../lib/store";

export function Chip({ tone, children, title }: { tone: "ok" | "warn" | "bad" | "info" | "neutral" | "demo"; children: ReactNode; title?: string }) {
  return (
    <span className={`chip chip-${tone}`} title={title}>
      {children}
    </span>
  );
}

const STATUS_TONE: Record<string, "ok" | "warn" | "bad" | "info" | "neutral"> = {
  completed: "ok",
  awaiting_payer: "info",
  pending_approval: "warn",
  rejected: "neutral",
  failed: "bad",
  disputed: "warn",
  dispute_resolved: "neutral",
};
export const StatusChip = ({ status }: { status: string }) => (
  <Chip tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</Chip>
);

export function Flags({ within, breaches, rogue }: { within: boolean; breaches: string[]; rogue: boolean }) {
  return (
    <span className="flags">
      {!within && (
        <Chip tone="bad" title="The mandate checker found this choice outside the signed mandate">
          Outside mandate{breaches.length ? `: ${breaches.map(breachLabel).join(", ")}` : ""}
        </Chip>
      )}
      {rogue && (
        <Chip tone="demo" title="Demo switch: the guard was told to let the agent break its mandate">
          Demo: agent overrides its mandate
        </Chip>
      )}
      {within && !rogue && <Chip tone="ok">Within mandate</Chip>}
    </span>
  );
}

export function Notice({ kind, children }: { kind: "error" | "info" | "ok" | "warn"; children: ReactNode }) {
  return (
    <div className={`notice notice-${kind}`} role={kind === "error" ? "alert" : "status"}>
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
    <section className="card" aria-labelledby={id}>
      <div className="card-head">
        <h2 id={id}>{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
