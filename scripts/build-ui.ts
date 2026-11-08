import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const ui = join(root, 'src', 'ui');
const exported = join(ui, 'out');
const destination = join(root, 'dist', 'ui');
if (!existsSync(join(ui, 'app')) && !existsSync(join(ui, 'pages')) && !existsSync(join(ui, 'src'))) {
  console.error('UI source is not available yet; src/ui must contain the Next.js app.');
  process.exit(1);
}
const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [require.resolve('next/dist/bin/next'), 'build', ui], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
});
if (result.error || result.status !== 0) process.exit(result.status ?? 1);
if (!existsSync(join(exported, 'index.html'))) {
  console.error("No static export found. UI owner: set output: 'export' in src/ui/next.config.*.");
  process.exit(1);
}
mkdirSync(join(root, 'dist'), { recursive: true });
rmSync(destination, { recursive: true, force: true });
cpSync(exported, destination, { recursive: true });
console.log('Static UI exported to dist/ui/.');
