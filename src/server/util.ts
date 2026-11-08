import { createHash, randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

/** Time-sortable id: prefix + 10 chars time + 10 chars random. */
export function newId(prefix: string): string {
  let t = Date.now();
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let rand = '';
  for (const b of randomBytes(10)) rand += ALPHABET[b % 32];
  return `${prefix}_${time}${rand}`;
}

export const nowIso = (): string => new Date().toISOString();
export const monthKey = (d: Date = new Date()): string => d.toISOString().slice(0, 7);

/** Keys sorted recursively, no whitespace. The signing and hashing input must be exactly this. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

export const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
export const GENESIS_HASH = '0'.repeat(64);

// ---------- money (integer cents internally, 2-dp decimal strings externally) ----------
export function toCents(value: string | number): number {
  const s = typeof value === 'number' ? String(value) : String(value).replace(/[,$\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`Invalid amount: ${value}`);
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number((frac + '00').slice(0, 2));
}
export const centsToMoney = (cents: number): string => (cents / 100).toFixed(2);
export const formatMoney = (currency: string, value: string): string =>
  `${currency} ${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---------- errors ----------
export class HttpError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const badRequest = (m: string, d: Record<string, unknown> = {}) => new HttpError(400, 'bad_request', m, d);
export const notFound = (m: string) => new HttpError(404, 'not_found', m);
export const invalidState = (m: string, d: Record<string, unknown> = {}) => new HttpError(409, 'invalid_state', m, d);
export const mandateInactive = (m: string) => new HttpError(409, 'mandate_inactive', m);
export const upstream = (m: string, d: Record<string, unknown> = {}) => new HttpError(502, 'upstream_error', m, d);
