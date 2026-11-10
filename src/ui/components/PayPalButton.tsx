"use client";
// Feature B6: the buyer approves with PayPal's own button inside the console, instead of a new tab.
// The order already exists (created by the gate); the button only lets the buyer approve it. After approval the
// console asks the server to reconcile: the server sees the order APPROVED at PayPal and captures it through the
// gate (authorised by the payer), exactly as the CHECKOUT.ORDER.APPROVED webhook would.
// Only shown against the real sandbox with buyer approval; mock mode and card checkout keep their own flow.
import { useEffect, useRef, useState } from "react";
import { useStore } from "../lib/store";
import type { Purchase } from "../lib/types";
import { Notice } from "./ui";

type PayPalSdk = { Buttons: (o: Record<string, unknown>) => { render: (el: HTMLElement) => Promise<void>; close?: () => Promise<void>; isEligible?: () => boolean } };

let sdkPromise: Promise<PayPalSdk> | null = null;

function loadSdk(clientId: string): Promise<PayPalSdk> {
  const w = window as unknown as { paypal?: PayPalSdk };
  if (w.paypal) return Promise.resolve(w.paypal);
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      // Sandbox client id: PayPal routes it to the sandbox environment.
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons`;
      s.async = true;
      s.onload = () => (w.paypal ? resolve(w.paypal) : reject(new Error("PayPal SDK loaded without the paypal object")));
      s.onerror = () => { sdkPromise = null; reject(new Error("Could not load the PayPal button (network or blocker)")); };
      document.head.appendChild(s);
    });
  }
  return sdkPromise;
}

export default function PayPalButton({ purchase }: { purchase: Purchase }) {
  const { api, health, refresh } = useStore();
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "approving" | "done" | "error">("loading");
  const [msg, setMsg] = useState<string | null>(null);
  const clientId = health?.paypal_client_id ?? null;
  const usable = !!clientId && health?.paypal_mode === "sandbox" && health?.checkout_mode === "payer_approval"
    && purchase.status === "awaiting_payer" && !!purchase.paypal_order_id;

  useEffect(() => {
    if (!usable || !box.current) return;
    let closed = false;
    let buttons: ReturnType<PayPalSdk["Buttons"]> | null = null;
    loadSdk(clientId!).then((paypal) => {
      if (closed || !box.current) return;
      buttons = paypal.Buttons({
        style: { layout: "horizontal", height: 38, tagline: false, label: "pay" },
        createOrder: () => purchase.paypal_order_id, // the gate already created it
        onApprove: async () => {
          setState("approving");
          try {
            const r = await api.reconcilePurchase(purchase.id);
            setMsg(r.purchase.status === "completed" ? "Approved at PayPal and captured." : `PayPal says ${r.paypal_status ?? "unknown"}; the server will keep checking.`);
            setState("done");
            await refresh();
          } catch (e) {
            setMsg(e instanceof Error ? e.message : String(e));
            setState("error");
          }
        },
        onCancel: () => setMsg("Approval cancelled. The order is still waiting."),
        onError: (e: unknown) => { setMsg(e instanceof Error ? e.message : "PayPal reported an error"); setState("error"); },
      });
      return buttons.render(box.current).then(() => { if (!closed) setState("ready"); });
    }).catch((e) => { if (!closed) { setMsg(e instanceof Error ? e.message : String(e)); setState("error"); } });
    return () => { closed = true; void buttons?.close?.(); };
  }, [usable, clientId, purchase.id, purchase.paypal_order_id, api, refresh]);

  if (!usable) return null;
  return (
    <div className="sx-ppbtn" aria-label="Approve with PayPal (sandbox)">
      <div className="small muted" style={{ marginBottom: 4 }}>Buyer: approve here with your PayPal sandbox account</div>
      <div ref={box} style={{ maxWidth: 320, minHeight: state === "loading" ? 38 : undefined }} />
      {state === "approving" && <p className="small muted">Capturing…</p>}
      {msg && <Notice kind={state === "error" ? "error" : "info"}>{msg}</Notice>}
    </div>
  );
}
