// A small in-memory sliding-window rate limiter. It protects the expensive endpoints (the agent spends model
// quota and creates PayPal orders) when the deployment is public. State is per process: it resets on restart,
// which is acceptable for a single-instance demo and is documented as such.

export type LimitScope = 'client' | 'global';

export type LimitResult =
  | { ok: true }
  | { ok: false; scope: LimitScope; retryAfterSeconds: number };

export interface LimiterOptions {
  /** Max requests per client within `perClientWindowMs`. 0 disables the per-client limit. */
  perClientLimit: number;
  perClientWindowMs: number;
  /** Max requests across ALL clients within `globalWindowMs`. 0 disables the global limit. */
  globalLimit: number;
  globalWindowMs: number;
}

const MAX_TRACKED_CLIENTS = 5000;

export class RateLimiter {
  private o: LimiterOptions;
  private clients = new Map<string, number[]>();
  private global: number[] = [];
  private now: () => number;

  constructor(options: LimiterOptions, now: () => number = Date.now) {
    this.o = options;
    this.now = now;
  }

  get enabled(): boolean {
    return this.o.perClientLimit > 0 || this.o.globalLimit > 0;
  }

  /** Records the request if allowed. A rejected request is NOT counted, so a blocked client cannot extend its own block. */
  check(clientKey: string): LimitResult {
    const t = this.now();

    if (this.o.globalLimit > 0) {
      this.global = this.global.filter((x) => t - x < this.o.globalWindowMs);
      if (this.global.length >= this.o.globalLimit) {
        return { ok: false, scope: 'global', retryAfterSeconds: Math.max(1, Math.ceil((this.global[0] + this.o.globalWindowMs - t) / 1000)) };
      }
    }

    if (this.o.perClientLimit > 0) {
      const hits = (this.clients.get(clientKey) ?? []).filter((x) => t - x < this.o.perClientWindowMs);
      if (hits.length >= this.o.perClientLimit) {
        this.clients.set(clientKey, hits);
        return { ok: false, scope: 'client', retryAfterSeconds: Math.max(1, Math.ceil((hits[0] + this.o.perClientWindowMs - t) / 1000)) };
      }
      hits.push(t);
      this.clients.set(clientKey, hits);
      if (this.clients.size > MAX_TRACKED_CLIENTS) this.prune(t);
    }

    if (this.o.globalLimit > 0) this.global.push(t);
    return { ok: true };
  }

  private prune(t: number): void {
    for (const [k, hits] of this.clients) {
      if (!hits.some((x) => t - x < this.o.perClientWindowMs)) this.clients.delete(k);
    }
    // Still too many distinct keys (an attacker rotating identities): drop the oldest half rather than grow without bound.
    if (this.clients.size > MAX_TRACKED_CLIENTS) {
      let drop = Math.floor(this.clients.size / 2);
      for (const k of this.clients.keys()) { if (drop-- <= 0) break; this.clients.delete(k); }
    }
  }
}
