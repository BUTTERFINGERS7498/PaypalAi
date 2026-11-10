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

/** A past purchase on the same mandate, for "the usual" and for preferring what you bought before. */
export interface HistoryItem {
  sku: string;
  at: string;
}

/** How the engine reached its choice. Stored in the evidence record, so "why did it choose that" has numbers behind it. */
export interface EngineTrace {
  mode: 'engine';
  backend: 'embeddings' | 'keyword' | 'rule';
  model: string;
  /** what was matched, after the price phrase and SKU were removed */
  query: string;
  /** concept-map rules that fired, e.g. "porridge → oats" */
  expansions: string[];
  /** similarity of the top catalog items, best first */
  scores: { sku: string; score: number }[];
  /** similarity of the chosen item (1 for an explicit SKU or "the usual") */
  confidence: number | null;
  low_confidence: boolean;
  substitution?: { wanted_sku: string; wanted_name: string; reason: 'category_not_allowed' | 'over_remaining_budget' };
  preference?: { sku: string; times: number; last: string };
  /** phrases in the instruction that tried to override the rules (they change nothing) */
  injection?: string[];
}

export type EngineDecision =
  | { kind: 'selected'; item: CatalogItem; rationale: string; options: CatalogItem[]; trace: EngineTrace }
  | { kind: 'no_match'; options: CatalogItem[]; text: string; trace: EngineTrace }
  | { kind: 'needs_info'; text: string; trace?: EngineTrace }
  | { kind: 'clarify'; text: string; choices: CatalogItem[]; options: CatalogItem[]; trace: EngineTrace };

/** At or above this similarity the engine is confident. Below it (and above MIN_SIMILARITY) the match counts as
 *  unsure: a mandate with the ask_when_unsure clause then sends it to a human. Calibrated on the 18-request set. */
export const CONFIDENT = 0.50;
/** When unsure, two different allowed items closer than this are a real ambiguity: ask instead of guessing. */
export const CLARIFY_GAP = 0.05;
/** A substitute must score at most this much below the item it replaces. */
export const SUB_GAP = 0.15;
/** A three-way (or wider) tie below this score is treated as ambiguous, even above CONFIDENT. */
export const WIDE_TIE_MAX = 0.60;
/** Weight of the concept-map words scored on their own (see decide()). Below 1 so the user's own words still lead. */
export const EXPANSION_WEIGHT = 0.9;

/**
 * The concept map: a small, hand-written list that adds catalog words to a request whose words the embedding model
 * does not connect on its own (it scored "porridge" closer to rice than to oats). Every rule that fires is recorded
 * in the evidence. It only changes the search text; it never selects an item by itself.
 */
export const EXPANSIONS: { when: RegExp; add: string; why: string }[] = [
  { when: /\b(porridge|oatmeal|muesli|granola)\b/i, add: 'rolled oats', why: 'porridge → oats' },
  { when: /\b(?:warm|hot)\b(?:\s+\w+){0,2}\s+(?:drinks?|beverages?)\b|\bmorning (?:drink|brew|pick-me-up)\b|\bdrink in the morning\b|\bcaffeine\b/i, add: 'coffee', why: 'warm morning drink → coffee' },
  { when: /\bbreakfast\b/i, add: 'oats, milk, coffee', why: 'breakfast → oats, milk, coffee' },
  { when: /\b(?:dairy[- ]free|plant[- ]based milk|vegan milk|non[- ]dairy)\b/i, add: 'oat milk', why: 'dairy-free → oat milk' },
  { when: /\bfruits?\b/i, add: 'apples', why: 'fruit → apples' },
  { when: /\b(?:clean|cleaning|scrub|wash|tidy|disinfect|mop)\b/i, add: 'cleaning kit', why: 'cleaning → cleaning kit' },
  { when: /\b(?:earbuds|earphones|music|audio|podcasts?)\b/i, add: 'headphones', why: 'audio → headphones' },
  { when: /\b(?:gaming|video games?|play games)\b/i, add: 'games console', why: 'gaming → games console' },
  { when: /\b(?:spaghetti|noodles)\b/i, add: 'pasta', why: 'noodles → pasta' },
];

/** Phrases that try to talk the agent out of its rules. The engine is not a language model, so they cannot steer it;
 *  they are flagged so the evidence shows the attempt. The checker decides either way. */
const INJECTION: RegExp[] = [
  /\bignore (?:all |any |your |the |my |previous |prior |earlier )*(?:rules|instructions|mandate|limits|policy|policies|guardrails)\b/i,
  /\b(?:bypass|override|disable|turn off|skip) (?:the |your |all |any )?(?:mandate|checker|limits?|rules|guard|guardrails|approval|checks?)\b/i,
  /\bdisregard\b[^.]*\b(?:rules|instructions|mandate|limits)\b/i,
  /\byou are now\b/i,
  /\b(?:system|developer) (?:prompt|message|override)\b|^\s*system\s*:/im,
  /\bpretend (?:you|that|to)\b/i,
  /\bno (?:spending )?limits?\b/i,
  /\bapprove (?:it|this|everything|all) (?:automatically|yourself)\b/i,
];

export function detectInjection(text: string): string[] {
  const hits: string[] = [];
  for (const re of INJECTION) { const m = text.match(re); if (m) hits.push(m[0].trim().slice(0, 80)); }
  return hits;
}

const USUAL = /\b(?:the usual|my usual|same as (?:last time|before)|(?:buy|get|order) (?:it|that|them) again|re-?order)\b/i;

/** The most often bought item in the history (latest wins a tie), if it is still in the catalog. */
function favourite(history: HistoryItem[], items: CatalogItem[]): { item: CatalogItem; times: number; last: string } | null {
  const by = new Map<string, { times: number; last: string }>();
  for (const h of history) {
    const cur = by.get(h.sku) ?? { times: 0, last: '' };
    by.set(h.sku, { times: cur.times + 1, last: h.at > cur.last ? h.at : cur.last });
  }
  const best = [...by.entries()].sort((a, b) => b[1].times - a[1].times || b[1].last.localeCompare(a[1].last))
    .map(([sku, v]) => ({ item: items.find((i) => i.sku === sku), ...v })).find((x) => x.item);
  return best ? { item: best.item!, times: best.times, last: best.last } : null;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const day = (iso: string) => iso.slice(0, 10);
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

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

  /**
   * The whole decision: parse intent, expand with the concept map, rank, apply the price cap, then the selection
   * policy (ask when ambiguous, prefer what you bought before, substitute an allowed item, flag low confidence).
   * `remainingCents` and `history` are optional context; without them the engine behaves as before.
   */
  async decide(input: {
    text: string; items: CatalogItem[]; allowedCategories: string[]; rogue: boolean;
    remainingCents?: number | null; history?: HistoryItem[];
  }): Promise<EngineDecision> {
    const { text, items, allowedCategories, rogue } = input;
    const remaining = input.remainingCents ?? null;
    const history = input.history ?? [];
    const intent = parseIntent(text);
    const allowed = new Set(allowedCategories.map((c) => c.toLowerCase()));
    const isAllowed = (c: Candidate | CatalogItem) => allowed.has(('item' in c ? c.item : c).category.toLowerCase());
    const cents = (c: Candidate | CatalogItem) => toCents(('item' in c ? c.item : c).price.value);
    const injection = detectInjection(text);
    const injNote = injection.length ? ' The instruction also tried to override the rules; that text changes nothing, and the mandate checker still decides.' : '';
    const modelName = this.opts.model.split('/').pop() ?? this.opts.model;
    const trace: EngineTrace = {
      mode: 'engine', backend: 'rule', model: modelName, query: intent.query, expansions: [], scores: [],
      confidence: null, low_confidence: false, ...(injection.length ? { injection } : {}),
    };

    // An explicit SKU wins outright.
    if (intent.sku) {
      const item = items.find((i) => i.sku.toUpperCase() === intent.sku);
      if (!item) return { kind: 'no_match', options: [], text: `I couldn't find sku ${intent.sku} in the catalog.`, trace };
      return { kind: 'selected', item, options: [item], rationale: `Explicit sku ${item.sku} requested.${injNote}`, trace: { ...trace, confidence: 1 } };
    }

    // "The usual": the item bought most often on this mandate.
    if (USUAL.test(text)) {
      const fav = favourite(history, items);
      if (!fav) return { kind: 'needs_info', text: "There are no past purchases on this mandate yet, so I don't know your usual. Tell me what to buy.", trace };
      return {
        kind: 'selected', item: fav.item, options: [fav.item],
        rationale: `You asked for the usual: ${fav.item.name}, bought ${fav.times} time${fav.times === 1 ? '' : 's'} on this mandate (last on ${day(fav.last)}).${injNote}`,
        trace: { ...trace, confidence: 1, preference: { sku: fav.item.sku, times: fav.times, last: fav.last } },
      };
    }

    // Nothing to match on (empty, or only filler words like "please buy"): ask. Anything else that finds no match says so.
    const content = intent.query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));
    if (!content.length) return { kind: 'needs_info', text: 'What should I buy? For example: "restock the pantry basics" or "buy rolled oats under $10".', trace };

    // The concept map adds catalog words; what fired is recorded.
    // A long sentence dilutes the added words, so the concept words are also scored alone, at a discount, and each item
    // keeps its better score.
    const fired = EXPANSIONS.filter((e) => e.when.test(intent.query));
    let { backend, ranked } = await this.rank(fired.length ? `${intent.query} (${fired.map((e) => e.add).join(', ')})` : intent.query, items);
    if (fired.length) {
      const alone = await this.rank(fired.map((e) => e.add).join(', '), items);
      const boost = new Map(alone.ranked.map((c) => [c.item.sku, c.score * EXPANSION_WEIGHT]));
      ranked = ranked.map((c) => ({ item: c.item, score: Math.max(c.score, boost.get(c.item.sku) ?? 0) })).sort((a, b) => b.score - a.score);
      backend = alone.backend === 'keyword' ? 'keyword' : backend;
    }
    trace.backend = backend;
    trace.expansions = fired.map((e) => e.why);
    trace.scores = ranked.slice(0, 8).map((c) => ({ sku: c.item.sku, score: r3(c.score) }));

    const capped = intent.maxCents === null ? ranked : ranked.filter((c) => cents(c) <= intent.maxCents!);
    const best = capped[0];
    const options = (capped.length ? capped : ranked).slice(0, 5).map((c) => c.item);

    // The cap removed the real match: say so, rather than quietly buying a different product that merely scores close.
    const closest = ranked[0];
    if (intent.maxCents !== null && closest && closest.score >= MIN_SIMILARITY && (!best || best.score < closest.score - CAP_GAP)) {
      return { kind: 'no_match', options, trace, text: `The closest match, ${closest.item.name}, costs $${closest.item.price.value}, which is above your ${usd(intent.maxCents)} cap.` };
    }
    if (!best) return { kind: 'no_match', options, trace, text: `Nothing in the catalog is available under ${usd(intent.maxCents ?? 0)}.` };
    if (best.score < MIN_SIMILARITY) {
      return { kind: 'no_match', options, trace, text: `I couldn't find anything in the catalog that matches "${intent.query}".` };
    }

    // Ask instead of guessing when two different allowed items are nearly tied and the engine is unsure, or when three
    // or more allowed items tie on a middling score ("snacks" ties oats, apples and the pantry bundle).
    const tiedAllowed = capped.filter((c) => c.score >= Math.max(MIN_SIMILARITY, best.score - NEAR_TIE) && isAllowed(c)).length;
    if (!rogue && (best.score < CONFIDENT || (tiedAllowed >= 3 && best.score < WIDE_TIE_MAX))) {
      const close = capped.filter((c) => c.score >= MIN_SIMILARITY && best.score - c.score < CLARIFY_GAP && isAllowed(c)).slice(0, 3);
      if (close.length >= 2) {
        const names = close.map((c) => `${c.item.name} ($${c.item.price.value})`);
        return {
          kind: 'clarify', choices: close.map((c) => c.item), options, trace: { ...trace, confidence: r3(best.score), low_confidence: true },
          text: `I'm not sure which you mean: ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}?`,
        };
      }
    }

    // Near-equal matches, then prefer allowed categories (unless the labelled demo override is on), then what you bought
    // before, then the cheapest.
    const near = capped.filter((c) => c.score >= Math.max(MIN_SIMILARITY, best.score - NEAR_TIE));
    const inMandate = near.filter(isAllowed);
    const pool = rogue ? near : inMandate.length ? inMandate : near;
    let pick = [...pool].sort((a, b) => cents(a) - cents(b) || b.score - a.score)[0];
    const notes: string[] = [];

    const boughtBefore = rogue ? [] : pool.map((c) => ({ c, times: history.filter((h) => h.sku === c.item.sku).length })).filter((x) => x.times > 0);
    if (boughtBefore.length) {
      const fav = boughtBefore.sort((a, b) => b.times - a.times)[0];
      const last = history.filter((h) => h.sku === fav.c.item.sku).map((h) => h.at).sort().pop() ?? '';
      if (fav.c !== pick) notes.push(`chose ${fav.c.item.name} over the cheaper near-equal match because you bought it before`);
      pick = fav.c;
      trace.preference = { sku: pick.item.sku, times: fav.times, last };
    }

    // The best match breaks the mandate or this month's remaining budget: offer the closest allowed item instead.
    const wanted = pick;
    const breaksCategory = !isAllowed(wanted);
    const overBudget = remaining !== null && cents(wanted) > remaining;
    if (!rogue && (breaksCategory || overBudget)) {
      const alt = capped.find((c) => c !== wanted && isAllowed(c) && (remaining === null || cents(c) <= remaining)
        && c.score >= MIN_SIMILARITY && c.score >= wanted.score - SUB_GAP);
      if (alt) {
        const reason = breaksCategory ? 'category_not_allowed' as const : 'over_remaining_budget' as const;
        trace.substitution = { wanted_sku: wanted.item.sku, wanted_name: wanted.item.name, reason };
        notes.push(breaksCategory
          ? `substituted for ${wanted.item.name} ($${wanted.item.price.value}), which is outside the allowed categories`
          : `substituted for ${wanted.item.name} ($${wanted.item.price.value}), which is more than the ${usd(remaining!)} left this month`);
        pick = alt;
      }
    }

    trace.confidence = r3(pick.score);
    trace.low_confidence = pick.score < CONFIDENT;
    const inCategory = isAllowed(pick);
    const how = backend === 'embeddings'
      ? `Semantic match (${modelName}): "${intent.query}"${fired.length ? ` [concept map: ${trace.expansions.join('; ')}]` : ''} → ${pick.item.name} (similarity ${pick.score.toFixed(2)})`
      : `Keyword match (the semantic model was not available): "${intent.query}" → ${pick.item.name}`;
    const parts = [
      how,
      pool.length > 1 && !trace.substitution && !trace.preference ? `cheapest of ${pool.length} near-equal matches` : 'best match',
      ...notes,
      intent.maxCents !== null ? `within the ${usd(intent.maxCents)} cap` : null,
      trace.low_confidence ? `not a confident match (below ${CONFIDENT.toFixed(2)})` : null,
      inCategory ? 'in an allowed category' : 'outside the allowed categories (the mandate checker will decide)',
    ].filter(Boolean);
    const shown = [pick.item, ...(trace.substitution ? [wanted.item] : []), ...options];
    const uniq = shown.filter((o, i) => shown.findIndex((x) => x.sku === o.sku) === i).slice(0, 5);
    return { kind: 'selected', item: pick.item, options: uniq, rationale: parts.join('; ') + '.' + injNote, trace };
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
