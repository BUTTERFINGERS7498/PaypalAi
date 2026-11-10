"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { getApi } from "./datasource";
import { setApprovalToken } from "./http";
import { ApiError } from "./types";
import type { Api, Approval, Dispute, EvidenceRecord, Health, Mandate, Purchase } from "./types";

export type TabId = "fence" | "mandates" | "ledger" | "evidence" | "disputes";

interface Store {
  api: Api;
  health: Health | null;
  mandates: Mandate[];
  purchases: Purchase[];
  approvals: Approval[];
  disputes: Dispute[];
  loadError: string | null;
  live: boolean;
  lastEvidence: EvidenceRecord | null;
  token: string;
  setToken: (t: string) => void;
  operator: string;
  setOperator: (t: string) => void;
  tab: TabId;
  go: (tab: TabId, purchaseId?: string) => void;
  focusPurchase: string | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider missing");
  return s;
};

export function errMsg(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Unauthorized: enter the Approval password in the header bar and retry.";
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

function upsert<T extends { id: string }>(list: T[], item: T, front = true): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) {
    const copy = list.slice();
    copy[i] = item;
    return copy;
  }
  return front ? [item, ...list] : [...list, item];
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const api = useMemo(() => getApi(), []);
  const [health, setHealth] = useState<Health | null>(null);
  const [mandates, setMandates] = useState<Mandate[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [lastEvidence, setLastEvidence] = useState<EvidenceRecord | null>(null);
  const [token, setTokenState] = useState("");
  const [operator, setOperator] = useState("console-user");
  const [tab, setTab] = useState<TabId>("fence");
  const [focusPurchase, setFocus] = useState<string | null>(null);
  const alive = useRef(true);

  const setToken = useCallback((t: string) => {
    setApprovalToken(t);
    setTokenState(t);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [m, p, a, d] = await Promise.all([
        api.listMandates(),
        api.listPurchases(),
        api.listApprovals(),
        api.listDisputes(),
      ]);
      if (!alive.current) return;
      setMandates(m);
      setPurchases(p);
      setApprovals(a);
      setDisputes(d);
      setLoadError(null);
    } catch (e) {
      if (alive.current) setLoadError(errMsg(e));
    }
  }, [api]);

  useEffect(() => {
    alive.current = true;
    api.health().then(setHealth).catch(() => {});
    void refresh();
    const unsub = api.subscribe((ev) => {
      setLive(true);
      switch (ev.type) {
        case "purchase.updated":
          setPurchases((l) => upsert(l, ev.data));
          break;
        case "approval.updated":
          setApprovals((l) =>
            ev.data.status === "pending" ? upsert(l, ev.data) : l.filter((x) => x.id !== ev.data.id),
          );
          break;
        case "mandate.updated":
          setMandates((l) => {
            const i = l.findIndex((x) => x.id === ev.data.id);
            if (i < 0) return [ev.data, ...l];
            const c = l.slice();
            c[i] = ev.data;
            return c;
          });
          break;
        case "dispute.updated":
          setDisputes((l) => upsert(l, ev.data));
          break;
        case "evidence.appended":
          setLastEvidence(ev.data);
          break;
        case "reconnected":
          void refresh();
          break;
      }
    });
    // Mock backend has no connection state; the real one flips this on first event or open.
    if (api.kind === "mock") setLive(true);
    else {
      const t = setTimeout(() => setLive((v) => v || true), 1500);
      return () => {
        alive.current = false;
        clearTimeout(t);
        unsub();
      };
    }
    return () => {
      alive.current = false;
      unsub();
    };
  }, [api, refresh]);

  const go = useCallback((t: TabId, purchaseId?: string) => {
    setTab(t);
    if (purchaseId) setFocus(purchaseId);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, []);

  const value: Store = {
    api, health, mandates, purchases, approvals, disputes, loadError, live, lastEvidence,
    token, setToken, operator, setOperator, tab, go, focusPurchase, refresh,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
