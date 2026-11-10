import { ApiError } from "./types";
import type { Api, StreamEvent } from "./types";

// The approval password lives in memory only. It is never read from env and never persisted.
let approvalToken = "";
export function setApprovalToken(t: string) {
  approvalToken = t;
}

const BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (approvalToken) headers["authorization"] = `Bearer ${approvalToken}`;
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network", "Cannot reach the server. Is it running?");
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? "error", e?.message ?? `HTTP ${res.status}`);
  }
  return json as T;
}

const STREAM_TYPES = [
  "purchase.updated",
  "approval.updated",
  "evidence.appended",
  "dispute.updated",
  "mandate.updated",
] as const;

export function createHttpApi(): Api {
  return {
    kind: "api",
    health: () => req("GET", "/api/health"),
    listMandates: async () => (await req<{ mandates: never[] }>("GET", "/api/mandates")).mandates,
    mandateVersions: async (id) =>
      (await req<{ versions: never[] }>("GET", `/api/mandates/${id}/versions`)).versions,
    createMandate: (b) => req("POST", "/api/mandates", b),
    draftMandate: (text) => req("POST", "/api/mandates/draft", { text }),
    updateLimits: (id, b) => req("POST", `/api/mandates/${id}/limits`, b),
    revokeMandate: (id) => req("POST", `/api/mandates/${id}/revoke`),
    verifyMandate: (id, version) =>
      req("POST", `/api/mandates/${id}/verify`, version ? { version } : undefined),
    instruct: (b) => req("POST", "/api/agent/instructions", b),
    listPurchases: async () =>
      (await req<{ purchases: never[] }>("GET", "/api/purchases")).purchases,
    purchaseEvidence: (id) => req("GET", `/api/purchases/${id}/evidence`),
    purchaseWebhooks: (id) => req("GET", `/api/purchases/${id}/webhooks`),
    reconcilePurchase: (id) => req("POST", `/api/purchases/${id}/reconcile`),
    purchaseProof: (id) => req("GET", `/api/purchases/${id}/proof`),
    verifyChain: () => req("GET", "/api/evidence/verify"),
    listApprovals: async () =>
      (await req<{ approvals: never[] }>("GET", "/api/approvals?status=pending")).approvals,
    decideApproval: (id, verdict, b) => req("POST", `/api/approvals/${id}/${verdict}`, b),
    listDisputes: async () =>
      (await req<{ disputes: never[] }>("GET", "/api/disputes")).disputes,
    syncDisputes: async () =>
      (await req<{ disputes: never[] }>("POST", "/api/disputes/sync")).disputes,
    simulateDispute: (b) => req("POST", "/api/disputes/simulate", b),
    assembleDispute: (id) => req("POST", `/api/disputes/${id}/assemble`),
    submitDispute: (id, b) => req("POST", `/api/disputes/${id}/submit`, b),
    payoutDispute: (id, b) => req("POST", `/api/disputes/${id}/payout`, b),
    checkPayout: (id) => req("POST", `/api/disputes/${id}/payout/check`),
    subscribe(handler) {
      if (typeof EventSource === "undefined") return () => {};
      const es = new EventSource(BASE + "/api/stream");
      let dropped = false;
      for (const t of STREAM_TYPES) {
        es.addEventListener(t, (ev) => {
          try {
            handler({ type: t, data: JSON.parse((ev as MessageEvent).data) } as StreamEvent);
          } catch {
            /* ignore malformed event */
          }
        });
      }
      es.onerror = () => {
        dropped = true;
      };
      es.onopen = () => {
        // Contract: clients refetch lists on reconnect.
        if (dropped) {
          dropped = false;
          handler({ type: "reconnected", data: null });
        }
      };
      return () => es.close();
    },
  };
}
