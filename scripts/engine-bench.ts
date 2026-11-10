// Benchmark for the on-server semantic engine.
//   npm run bench:engine                                  -> the default model, full decisions
//   npm run bench:engine -- Xenova/bge-small-en-v1.5      -> another model (downloaded into ./models on first use)
// For each request set it prints how often the engine lands on an acceptable item, and how well the raw similarity
// separates real matches from things the catalog does not sell (the gap must be positive for MIN_SIMILARITY to work).
import { fileURLToPath } from 'node:url';
import { SemanticEngine } from '../src/server/engine.ts';
import { CASES, HELD_OUT, NEGATIVES } from '../tests/helpers/engine-cases.ts';
import { catalog } from './catalog.ts';

const model = process.argv[2] ?? 'Xenova/all-MiniLM-L6-v2';
const items = catalog.map((c) => ({ sku: c.sku, name: c.name, category: c.category, price: { currency_code: 'USD', value: c.value }, merchant: c.merchant }));
const engine = new SemanticEngine({ model, modelDir: fileURLToPath(new URL('../models', import.meta.url)), allowDownload: true });
await engine.warmup();
const st = engine.status();
if (st.state !== 'ready') { console.error(`model ${model} did not load: ${st.error}`); process.exit(1); }

const all = ['groceries', 'electronics', 'household'];
async function run(name: string, set: [string, string[]][]) {
  let decided = 0; let rawTop = 0; let lowest = 1;
  for (const [q, ok] of set) {
    const d = await engine.decide({ text: q, items, allowedCategories: all, rogue: false });
    if (d.kind === 'selected' && ok.includes(d.item.sku)) decided++;
    const { ranked } = await engine.rank(q, items);
    if (ok.includes(ranked[0].item.sku)) rawTop++;
    lowest = Math.min(lowest, ranked.find((c) => ok.includes(c.item.sku))?.score ?? 0);
  }
  console.log(`${name.padEnd(10)} decisions ${decided}/${set.length}   raw top-1 ${rawTop}/${set.length}   lowest correct score ${lowest.toFixed(3)}`);
  return lowest;
}

console.log(`model ${model} (loaded in ${st.load_ms} ms)`);
const lowDev = await run('tuning set', CASES);
const lowHeld = await run('held-out', HELD_OUT);
let highestNeg = 0; let refused = 0;
for (const q of NEGATIVES) {
  highestNeg = Math.max(highestNeg, (await engine.rank(q, items)).ranked[0].score);
  const d = await engine.decide({ text: q, items, allowedCategories: all, rogue: false });
  if (d.kind === 'no_match') refused++;
}
console.log(`negatives  correctly refused ${refused}/${NEGATIVES.length}   highest score ${highestNeg.toFixed(3)} (MIN_SIMILARITY is tuned for MiniLM)`);
void lowDev; void lowHeld;
