// R6.1a browser bundle + static asset publisher.
//
// The browser code is type-checked by its own DOM `tsconfig.ui.json` (no emit),
// then bundled with the locally pinned `esbuild` into two browser entries. The
// bundle inlines the local `marked` dependency, so the page never reaches a CDN
// and `src/ui` stays the only browser source. Only the two entries and the
// deterministic static assets are published; no source file is written and the
// Host static directory/whitelist is not widened.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Default is the product public dir. The documented test seam lets an isolated
// test build the same closure into a temporary directory without writing next/dist.
const output = process.env.WORKBENCH_OUT_DIR === undefined
  ? join(project, 'dist', 'app', 'public', 'workbench')
  : resolve(process.env.WORKBENCH_OUT_DIR);

function resolveTsc() {
  for (const candidate of [join(project, 'node_modules', 'typescript', 'bin', 'tsc')])
    if (existsSync(candidate)) return candidate;
  throw new Error('the TypeScript compiler is not installed in the next dependency closure');
}

const entries = ['main', 'views'];

// 1) The same DOM TypeScript check the build always ran; it emits nothing.
const compiler = resolveTsc();
const checked = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.ui.json', '--noEmit'], {
  cwd: project, stdio: 'inherit', env: process.env,
});
if (checked.status !== 0) throw new Error(`workbench typecheck/build failed (${checked.status ?? checked.signal})`);

// Build and validate in a temporary directory before replacing served assets.
const temporary = mkdtempSync(join(tmpdir(), 'next-workbench-'));
try {
  for (const name of entries) {
    await build({
      entryPoints: [join(project, 'src', 'ui', `${name}.ts`)],
      outfile: join(temporary, `${name}.js`),
      bundle: true, format: 'esm', platform: 'browser', target: ['es2024'],
      sourcemap: false, logLevel: 'warning',
    });
    const path = join(temporary, `${name}.js`);
    if (!existsSync(path) || statSync(path).size === 0)
      throw new Error(`the browser build did not emit a non-empty ${name}.js`);
    const source = readFileSync(path, 'utf8');
    if (source.includes('node:') || source.includes('../composition/'))
      throw new Error(`the browser bundle ${name}.js depends on a Host/Node artifact`);
  }
  for (const file of ['index.html', 'styles.css']) cpSync(join(project, 'src', 'ui', file), join(temporary, file));
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  for (const file of ['main.js', 'views.js', 'index.html', 'styles.css']) cpSync(join(temporary, file), join(output, file));
  process.stdout.write(`workbench build: published ${output}\n`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
