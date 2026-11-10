// Mandate drafting (feature C1): a plain-English sentence such as
//   "groceries only, $200 a month, ask me above $75"
// becomes a DRAFT of mandate limits. Nothing is signed here: the person checks the draft in the form and signs it.
// Plain rules, plus the semantic engine (when it is loaded) to map unusual category words onto the catalog's
// categories. Every value says where it came from, and anything not found is listed instead of invented.
import type { SemanticEngine } from './engine.ts';
import type { CatalogItem } from './types.ts';
import { centsToMoney, toCents } from './util.ts';

export interface MandateDraft {
  label: string;
  limits: { monthly_cap: string | null; categories: string[]; approval_above: string | null; ask_when_unsure: boolean };
  /** One line per value: what was read and from which words. */
  notes: string[];
  /** What could not be read and must be filled in by hand. */
  missing: ('monthly_cap' | 'categories' | 'approval_above')[];
  /** Categories the text excluded ("no electronics"). */
  excluded: string[];
}

const NUM = String.raw`\$?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:dollars|usd|bucks)?`;
const PERIOD = String.raw`(?:a|per|each|every|\/)\s*(month|mo|week|wk|day|year|yr)`;

/** Words that point at each catalog category. Only categories that exist in the catalog are offered. */
const CATEGORY_WORDS: Record<string, string[]> = {
  groceries: ['grocery', 'groceries', 'food', 'foods', 'pantry', 'snacks', 'drinks', 'coffee', 'produce', 'fruit', 'vegetables', 'meals', 'kitchen staples', 'supermarket'],
  electronics: ['electronics', 'electronic', 'gadgets', 'gadget', 'tech', 'devices', 'device', 'headphones', 'gaming', 'consoles', 'computers'],
  household: ['household', 'home supplies', 'cleaning', 'cleaning supplies', 'toiletries', 'home goods', 'house'],
};

const PER_MONTH: Record<string, number> = { month: 1, mo: 1, week: 52 / 12, wk: 52 / 12, day: 365 / 12, year: 1 / 12, yr: 1 / 12 };

/** The matched words, for the note, without trailing punctuation ("$75," -> "$75"). */
const said = (s: string) => s.trim().replace(/[\s,;.:]+$/, '');

function money(raw: string): number | null {
  try { const c = toCents(raw.replace(/,/g, '')); return c > 0 ? c : null; } catch { return null; }
}

function findCap(text: string): { cents: number; note: string } | null {
  // "$200 a month", "200 dollars per week"
  let m = text.match(new RegExp(NUM + String.raw`\s*` + PERIOD, 'i'));
  if (m) {
    const c = money(m[1]); const unit = m[2].toLowerCase();
    if (c) {
      const monthly = Math.round(c * PER_MONTH[unit]);
      return { cents: monthly, note: unit.startsWith('mo') ? `monthly cap $${centsToMoney(monthly)} from "${said(m[0])}"` : `monthly cap $${centsToMoney(monthly)}, converted from "${said(m[0])}"` };
    }
  }
  // "monthly budget of 200", "budget: $150 per month", "cap it at $300"
  m = text.match(new RegExp(String.raw`\b(?:monthly\s+)?(?:budget|cap|limit|spend(?:ing)?|allowance)\s*(?:it\s+|that\s+)?(?:of|is|at|to|:)?\s*` + NUM, 'i'));
  if (m) { const c = money(m[1]); if (c) return { cents: c, note: `monthly cap $${centsToMoney(c)} from "${said(m[0])}"` }; }
  m = text.match(new RegExp(String.raw`\b(?:up to|at most|no more than|max(?:imum)?(?: of)?)\s*` + NUM + String.raw`(?!\s*(?:each|per item|a piece))`, 'i'));
  if (m && !/\b(?:ask|approv|check with|confirm)/i.test(text.slice(Math.max(0, (m.index ?? 0) - 30), m.index))) {
    const c = money(m[1]); if (c) return { cents: c, note: `monthly cap $${centsToMoney(c)} from "${said(m[0])}" (no period given, read as monthly)` };
  }
  return null;
}

function findApproval(text: string): { cents: number; note: string } | null {
  const patterns = [
    // "ask me above $75", "check with me before anything over 50", "ask me first for purchases over $40"
    String.raw`\b(?:ask|check with|confirm with|ping|tell)\s+me\b[^.;]{0,40}?\b(?:above|over|more than|bigger than|beyond|>)\s*` + NUM,
    // "anything over $75 needs my approval", "purchases above 100 require approval"
    String.raw`\b(?:anything|purchases?|items?|orders?|spending)\s+(?:above|over|more than|bigger than)\s*` + NUM + String.raw`[^.;]{0,30}\b(?:approv|ask|check|confirm)\w*`,
    // "approval above $75", "approve anything over 60"
    String.raw`\bapprov\w*\s+(?:for\s+)?(?:anything\s+|purchases?\s+|items?\s+)?(?:above|over|more than)\s*` + NUM,
  ];
  for (const p of patterns) {
    const m = text.match(new RegExp(p, 'i'));
    if (m) { const c = money(m[1]); if (c) return { cents: c, note: `approval needed above $${centsToMoney(c)} from "${said(m[0])}"` }; }
  }
  return null;
}

const NEGATION = /\b(?:no|not|never|except|excluding|without|but not|nothing from)\s+(?:any\s+)?$/i;

export async function draftMandate(text: string, catalog: CatalogItem[], engine?: SemanticEngine): Promise<MandateDraft> {
  const known = [...new Set(catalog.map((c) => c.category.toLowerCase()))].sort();
  const notes: string[] = [];
  const missing: MandateDraft['missing'] = [];
  const lower = text.toLowerCase();

  // ----- categories: keyword map first, negations excluded -----
  const included = new Set<string>();
  const excluded = new Set<string>();
  for (const cat of known) {
    const words = [cat, ...(CATEGORY_WORDS[cat] ?? [])];
    for (const w of words) {
      const re = new RegExp(String.raw`\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\b`, 'gi');
      let m: RegExpExecArray | null;
      while ((m = re.exec(lower))) {
        const before = lower.slice(Math.max(0, m.index - 24), m.index);
        if (NEGATION.test(before)) excluded.add(cat); else included.add(cat);
      }
    }
  }
  for (const c of excluded) included.delete(c);
  if (included.size) notes.push(`categories ${[...included].join(', ')} from the words in your text`);

  // ----- categories: the semantic engine for words the map does not know ("toiletries for the bathroom" etc.) -----
  if (!included.size && engine && engine.status().state === 'ready') {
    const scored: { cat: string; score: number }[] = [];
    for (const cat of known) {
      const items = catalog.filter((c) => c.category.toLowerCase() === cat);
      const { ranked } = await engine.rank(text, items);
      if (ranked[0]) scored.push({ cat, score: ranked[0].score });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.filter((s) => s.score >= 0.42 && !excluded.has(s.cat));
    if (top.length) {
      included.add(top[0].cat);
      notes.push(`category ${top[0].cat} by meaning (the semantic engine matched your text to ${top[0].cat} items, similarity ${top[0].score.toFixed(2)})`);
    }
  }
  if (excluded.size) notes.push(`excluded ${[...excluded].join(', ')} because the text says not to`);
  if (!included.size) missing.push('categories');

  // ----- money -----
  const cap = findCap(text);
  if (cap) notes.push(cap.note); else missing.push('monthly_cap');
  let appr = findApproval(text);
  if (appr && cap && appr.cents > cap.cents) {
    notes.push(`the approval line ($${centsToMoney(appr.cents)}) was above the cap, so it was lowered to the cap`);
    appr = { cents: cap.cents, note: '' };
  }
  if (appr?.note) notes.push(appr.note);
  if (!appr) missing.push('approval_above');

  // ----- the optional clause -----
  const unsure = /\b(?:ask|check with|confirm with)\s+me\b[^.;]{0,30}\b(?:not sure|unsure|uncertain|in doubt|doubt)\b|\bwhen (?:you(?:'re| are) )?(?:not sure|unsure|in doubt)\b|\bif (?:you(?:'re| are) )?(?:not sure|unsure)\b/i.test(text);
  if (unsure) notes.push('"ask me when unsure" clause from your text');

  const cats = [...included];
  const title = cats.length ? cats.map((c) => c[0].toUpperCase() + c.slice(1)).join(' & ') : 'New mandate';
  return {
    label: cap ? `${title}, $${Number(centsToMoney(cap.cents)).toFixed(0)}/month` : title,
    limits: {
      monthly_cap: cap ? centsToMoney(cap.cents) : null,
      categories: cats,
      approval_above: appr ? centsToMoney(appr.cents) : null,
      ask_when_unsure: unsure,
    },
    notes,
    missing,
    excluded: [...excluded],
  };
}
