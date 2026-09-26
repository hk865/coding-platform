// R6.1a browser bundle + static asset publisher.
//
// The browser code is type-checked and emitted by its own DOM `tsconfig.ui.json`
// into an independent temporary outDir. This script copies ONLY the `src/ui`
// runtime JavaScript and the deterministic static assets into
// `dist/app/public/workbench`; Host/core/type-only outputs are never published
// and no source file is written.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

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

const temporary = mkdtempSync(join(tmpdir(), 'next-workbench-'));
try {
  const compiler = resolveTsc();
  const result = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.ui.json', '--outDir', temporary, '--noEmit', 'false'], {
    cwd: project, stdio: 'inherit', env: process.env,
  });
  if (result.status !== 0) throw new Error(`workbench typecheck/build failed (${result.status ?? result.signal})`);

  const emitted = join(temporary, 'ui');
  for (const file of ['main.js', 'views.js']) {
    const path = join(emitted, file);
    if (!existsSync(path) || statSync(path).size === 0)
      throw new Error(`the browser build did not emit a non-empty ${file}; refusing to publish an empty artifact`);
  }
  // A guard against accidentally publishing a Node-targeted Host artifact.
  for (const file of ['main.js', 'views.js']) {
    const source = readFileSync(join(emitted, file), 'utf8');
    if (source.includes('node:') || source.includes('../composition/'))
      throw new Error(`the browser bundle ${file} depends on a Host/Node artifact`);
  }

  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  for (const file of ['main.js', 'views.js']) cpSync(join(emitted, file), join(output, file));
  for (const file of ['index.html', 'styles.css']) cpSync(join(project, 'src', 'ui', file), join(output, file));
  process.stdout.write(`workbench build: published ${output}\n`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
