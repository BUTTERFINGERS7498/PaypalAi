// Build step for AGENT_MODE=engine: downloads the sentence-embedding model into ENGINE_MODEL_DIR (default ./models) so
// the deployed app starts with the model already on disk. It never fails the build: if the download is impossible, the
// server retries at runtime and, failing that, falls back to keyword matching (see src/server/engine.ts).
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const model = (process.env.ENGINE_MODEL ?? '').trim() || 'Xenova/all-MiniLM-L6-v2';
const dir = resolve(import.meta.dirname, '..', (process.env.ENGINE_MODEL_DIR ?? '').trim() || 'models');

function sizeOf(p: string): number {
  let total = 0;
  for (const name of readdirSync(p)) {
    const f = join(p, name);
    const s = statSync(f);
    total += s.isDirectory() ? sizeOf(f) : s.size;
  }
  return total;
}

try {
  const mod: any = await import('@huggingface/transformers');
  mod.env.cacheDir = dir;
  mod.env.allowRemoteModels = true;
  const t0 = Date.now();
  const extractor = await mod.pipeline('feature-extraction', model, { dtype: 'q8' });
  await extractor(['warm-up'], { pooling: 'mean', normalize: true }); // proves the model actually runs here
  console.log(`[prefetch-model] ${model} ready in ${((Date.now() - t0) / 1000).toFixed(1)}s, ${(sizeOf(dir) / 1048576).toFixed(1)} MB in ${dir}`);
} catch (err) {
  console.warn(`[prefetch-model] WARNING: could not prepare ${model}: ${err instanceof Error ? err.message : err}`);
  console.warn('[prefetch-model] The server will try again at runtime and otherwise use the keyword fallback.');
}
