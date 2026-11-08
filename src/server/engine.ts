// The on-server semantic engine (AGENT_MODE=engine): turns a plain-English shopping instruction into a catalog
// selection with NO external AI service. A small open-source sentence-embedding model (all-MiniLM-L6-v2, ~23 MB,
// run locally through ONNX) matches the instruction to catalog items by meaning; rules handle SKUs and price caps.
// It is NOT a language model and does not generate text: rationales are templated from the match.
//
// The engine only PROPOSES. The mandate checker and the gate still decide what is allowed, exactly as with the
// live Claude agent. If the model cannot load (or has not finished loading yet) it falls back to keyword overlap.
import type { CatalogItem } from './types.ts';
import { toCents } from './util.ts';

export const ENGINE_MODEL_DEFAULT = 'Xenova/all-MiniLM-L6-v2';
/** Below this cosine similarity there is no credible match. Calibrated on the 14-item demo catalog (small sample). */
export const MIN_SIMILARITY = 0.42;
/** Matches within this much of the best score count as "near-equal"; the cheapest of them is chosen. Kept tight so
 *  unrelated items that merely score close (e.g. pasta for "breakfast stuff") are not treated as ties. */
export const NEAR_TIE = 0.03;
/** If a price cap removes the best match and what is left scores this much lower, say so instead of buying a different product. */
export const CAP_GAP = 0.10;

export interface EngineOptions {
  model: string;
  modelDir: string;
  /** false = never touch the network (the model must already be in modelDir). */
  allowDownload: boolean;
}

export type EngineState = 'idle' | 'loading' | 'ready' | 'failed';

export interface EngineStatus {
  state: EngineState;
  /** 'embeddings' once the model is loaded; 'keyword' while loading or if it failed. */
  backend: 'embeddings' | 'keyword';
  model: string;
  load_ms: number | null;
  error: string | null;
}

export interface Candidate {
  item: CatalogItem;
  score: number;
}

export type EngineDecision =
  | { kind: 'selected'; item: CatalogItem; rationale: string; options: CatalogItem[] }
  | { kind: 'no_match'; options: CatalogItem[]; text: string }
  | { kind: 'needs_info'; text: string };

export interface Intent {
  sku: string | null;
  /** price cap in cents, when the instruction states one ("under $20") */
  maxCents: number | null;
  hasVerb: boolean;
  /** the instruction with the price phrase and SKU removed: what gets embedded */
  query: string;
}

const STOP = new Set(['a', 'an', 'the', 'some', 'any', 'for', 'of', 'to', 'my', 'me', 'and', 'please', 'buy', 'purchase', 'get',
  'order', 'restock', 'sku', 'under', 'max', 'i', 'need', 'want', 'like', 'or', 'at', 'in', 'on', 'with', 'something', 'stuff', 'make']);

const VERB = /\b(buy|purchase|get|order|restock|need|want|pick up|grab|add|stock up)\b/i;
// A cap needs a clear signal: "under/below/at most/... [$]N", "for $N", or "$N or less". A bare "for 2 people" is not a price.
const PRICE = /\b(?:under|below|less than|no more than|up to|at most|max(?:imum)?(?: of)?|within)\s*\$?\s*([\d,]+(?:\.\d{1,2})?)\b|\bfor\s*\$\s*([\d,]+(?:\.\d{1,2})?)\b|\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:or less|max|maximum|or under)/i;

export function parseIntent(text: string): Intent {
  const skuMatch = text.match(/\bsku\s+([A-Za-z0-9-]+)/i);
  const sku = skuMatch ? skuMatch[1].toUpperCase() : null;
  let maxCents: number | null = null;
  const pm = text.match(PRICE);
  if (pm) {
    try { maxCents = toCents((pm[1] ?? pm[2] ?? pm[3]).replace(/,/g, '')); } catch { maxCents = null; }
  }
  let query = text;
  if (skuMatch) query = query.replace(skuMatch[0], ' ');
  if (pm) query = query.replace(pm[0], ' ');
  query = query.replace(/\s+/g, ' ').trim();
  return { sku, maxCents: maxCents && maxCents > 0 ? maxCents : null, hasVerb: VERB.test(text), query };
}

const itemText = (c: CatalogItem) => `${c.name}. ${c.category}.`;

export class SemanticEngine {
  private opts: EngineOptions;
  private extractor: any = null;
  private state: EngineState = 'idle';
  private loadMs: number | null = null;
  private error: string | null = null;
  private loading: Promise<void> | null = null;
  private catKey = '';
  private catVecs: number[][] = [];

  constructor(opts: EngineOptions) {
    this.opts = opts;
  }

  status(): EngineStatus {
    return { state: this.state, backend: this.state === 'ready' ? 'embeddings' : 'keyword', model: this.opts.model, load_ms: this.loadMs, error: this.error };
  }

  /** Starts loading the model once. Never throws: a failure just leaves the keyword fallback in place. */
  warmup(): Promise<void> {
    if (this.loading) return this.loading;
    this.state = 'loading';
    const t0 = performance.now();
    this.loading = (async () => {
      try {
        const mod: any = await import('@huggingface/transformers');
        mod.env.cacheDir = this.opts.modelDir;
        mod.env.allowRemoteModels = this.opts.allowDownload;
        this.extractor = await mod.pipeline('feature-extraction', this.opts.model, { dtype: 'q8' });
        this.loadMs = Math.round(performance.now() - t0);
        this.state = 'ready';
      } catch (err) {
        this.state = 'failed';
        this.error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
        console.warn(`[engine] model unavailable, using keyword fallback: ${this.error}`);
      }
    })();
    return this.loading;
  }

  private async embed(texts: string[]): Promise<number[][]> {
    const out = await this.extractor(texts, { pooling: 'mean', normalize: true });
    return out.tolist() as number[][];
  }

  /** Items ranked by similarity to `query`, best first. */
  async rank(query: string, items: CatalogItem[]): Promise<{ backend: 'embeddings' | 'keyword'; ranked: Candidate[] }> {
    if (this.state === 'ready' && this.extractor) {
      try {
        const key = items.map((i) => `${i.sku}|${itemText(i)}`).join('\n');
        if (key !== this.catKey) { this.catVecs = await this.embed(items.map(itemText)); this.catKey = key; }
        const [qv] = await this.embed([query]);
        const ranked = items.map((item, i) => ({ item, score: this.catVecs[i].reduce((s, x, k) => s + x * qv[k], 0) })).sort((a, b) => b.score - a.score);
        return { backend: 'embeddings', ranked };
      } catch (err) {
        console.warn('[engine] embedding failed, using keyword fallback for this request:', err instanceof Error ? err.message : err);
      }
    }
    return { backend: 'keyword', ranked: keywordRank(query, items) };
  }

  /** The whole decision: parse intent, rank, apply the price cap and the selection policy. */
  async decide(input: { text: string; items: CatalogItem[]; allowedCategories: string[]; rogue: boolean }): Promise<EngineDecision> {
    const { text, items, allowedCategories, rogue } = input;
    const intent = parseIntent(text);
    const allowed = new Set(allowedCategories.map((c) => c.toLowerCase()));

    // An explicit SKU wins outright.
    if (intent.sku) {
      const item = items.find((i) => i.sku.toUpperCase() === intent.sku);
      if (!item) return { kind: 'no_match', options: [], text: `I couldn't find sku ${intent.sku} in the catalog.` };
      return { kind: 'selected', item, options: [item], rationale: `Explicit sku ${item.sku} requested.` };
    }

    // Nothing to match on (empty, or only filler words like "please buy"): ask. Anything else that finds no match says so.
    const content = intent.query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));
    if (!content.length) return { kind: 'needs_info', text: 'What should I buy? For example: "restock the pantry basics" or "buy rolled oats under $10".' };

    const { backend, ranked } = await this.rank(intent.query, items);
    const capped = intent.maxCents === null ? ranked : ranked.filter((c) => toCents(c.item.price.value) <= intent.maxCents!);
    const best = capped[0];
    const options = (capped.length ? capped : ranked).slice(0, 5).map((c) => c.item);

    // The cap removed the real match: say so, rather than quietly buying a different product that merely scores close.
    const closest = ranked[0];
    if (intent.maxCents !== null && closest && closest.score >= MIN_SIMILARITY && (!best || best.score < closest.score - CAP_GAP)) {
      return { kind: 'no_match', options, text: `The closest match, ${closest.item.name}, costs $${closest.item.price.value}, which is above your $${(intent.maxCents / 100).toFixed(2)} cap.` };
    }
    if (!best) return { kind: 'no_match', options, text: `Nothing in the catalog is available under $${((intent.maxCents ?? 0) / 100).toFixed(2)}.` };
    if (best.score < MIN_SIMILARITY) {
      return { kind: 'no_match', options, text: `I couldn't find anything in the catalog that matches "${intent.query}".` };
    }

    // Near-equal matches, then prefer allowed categories (unless the labelled demo override is on), then cheapest.
    const near = capped.filter((c) => c.score >= Math.max(MIN_SIMILARITY, best.score - NEAR_TIE));
    const inMandate = near.filter((c) => allowed.has(c.item.category.toLowerCase()));
    const pool = rogue ? near : inMandate.length ? inMandate : near;
    const pick = [...pool].sort((a, b) => toCents(a.item.price.value) - toCents(b.item.price.value) || b.score - a.score)[0];
    const inCategory = allowed.has(pick.item.category.toLowerCase());

    const how = backend === 'embeddings'
      ? `Semantic match (${this.opts.model.split('/').pop()}): "${intent.query}" → ${pick.item.name} (similarity ${pick.score.toFixed(2)})`
      : `Keyword match (the semantic model was not available): "${intent.query}" → ${pick.item.name}`;
    const parts = [
      how,
      pool.length > 1 ? `cheapest of ${pool.length} near-equal matches` : 'best match',
      intent.maxCents !== null ? `within the $${(intent.maxCents / 100).toFixed(2)} cap` : null,
      inCategory ? 'in an allowed category' : 'outside the allowed categories (the mandate checker will decide)',
    ].filter(Boolean);
    return { kind: 'selected', item: pick.item, options: options.some((o) => o.sku === pick.item.sku) ? options : [pick.item, ...options].slice(0, 5), rationale: parts.join('; ') + '.' };
  }
}

/** Fallback scoring when the model is unavailable: word overlap with name+category, mapped onto the same 0..1 scale. */
export function keywordRank(query: string, items: CatalogItem[]): Candidate[] {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w));
  return items.map((item) => {
    const hay = `${item.name} ${item.category}`.toLowerCase();
    const overlap = words.filter((w) => hay.includes(w)).length;
    return { item, score: overlap === 0 ? 0 : Math.min(0.9, 0.45 + 0.15 * overlap) };
  }).sort((a, b) => b.score - a.score || toCents(a.item.price.value) - toCents(b.item.price.value));
}
