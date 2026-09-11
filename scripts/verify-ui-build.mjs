/**
 * Build/serve identity check for the React workbench (acceptance R1).
 *
 * The defect this guards against: Vite wrote the bundle into src/app/public/workbench
 * while the server read dist/app/public/workbench, and copy-ui ran BEFORE ui:build,
 * so a single build served the previous bundle and `ui:build` alone never updated
 * what the server returned.
 *
 * The script performs REAL builds and a REAL server start in two situations:
 *   1. clean output directory  — the served page must reference assets that exist;
 *   2. directory holding an old build — the stale artifact must be gone afterwards.
 * It then does a full `pnpm build` from a removed public tree and checks /, /workbench
 * and /legacy over HTTP. Exit code 0 means the served bytes are the built bytes.
 *
 * Usage: node scripts/verify-ui-build.mjs   (run with the repo toolchain on PATH)
 */
import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const repo = fileURLToPath(new URL('..', import.meta.url));
const workbench = join(repo, 'dist/app/public/workbench');
const legacy = join(repo, 'dist/app/public');
const dataDir = join(repo, '.local/verify-ui-build-data');
const steps = [];
const step = (name, detail) => { steps.push({ name, detail }); console.log('STEP ' + name + (detail ? ' · ' + detail : '')); };
function ensure(condition, message) { if (!condition) throw new Error(message); }

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

async function startServer(port) {
  const child = spawn(process.execPath, ['dist/app/server.js'], { cwd: repo, env: { ...process.env, PORT: String(port), PLATFORM_GUI_DATA: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  await new Promise((ready, reject) => {
    const timer = setTimeout(() => reject(new Error('server start timeout: ' + output)), 60000);
    child.stdout.on('data', chunk => { output += String(chunk); if (output.includes('Agent Platform GUI')) { clearTimeout(timer); ready(); } });
    child.stderr.on('data', chunk => { output += String(chunk); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code + ': ' + output)); });
  });
  return { child, stop: () => new Promise(done => { child.once('exit', done); child.kill('SIGTERM'); setTimeout(() => { child.kill('SIGKILL'); done(); }, 10000).unref(); }) };
}

/** Fetch the workbench page and every asset it references; return the checked URLs. */
async function assertServed(port, label) {
  const page = await fetch('http://127.0.0.1:' + port + '/workbench');
  ensure(page.status === 200, label + ': /workbench returned ' + page.status);
  const html = await page.text();
  const entry = (html.match(/\/workbench\/assets\/index-[A-Za-z0-9_-]+\.js/) ?? [])[0] ?? null;
  ensure(entry, label + ': the served page has no entry bundle');
  const assets = [...html.matchAll(/(?:src|href)="(\/workbench\/assets\/[A-Za-z0-9._-]+)"/g)].map(match => match[1]);
  ensure(assets.length >= 2, label + ': the served page references no built assets');
  for (const asset of assets) {
    const response = await fetch('http://127.0.0.1:' + port + asset);
    ensure(response.status === 200, label + ': ' + asset + ' returned ' + response.status);
    const served = Buffer.from(await response.arrayBuffer());
    const onDisk = await readFile(join(workbench, 'assets', asset.slice('/workbench/assets/'.length)));
    ensure(served.equals(onDisk), label + ': ' + asset + ' served bytes differ from the built file');
  }
  const root = await fetch('http://127.0.0.1:' + port + '/');
  ensure(root.status === 200 && (await root.text()).includes('/workbench/assets/'), label + ': / is not the workbench page');
  const legacyPage = await fetch('http://127.0.0.1:' + port + '/legacy');
  ensure(legacyPage.status === 200, label + ': /legacy returned ' + legacyPage.status);
  const legacyHtml = await legacyPage.text();
  ensure(legacyHtml.includes('app.js'), label + ': /legacy page lost its script reference');
  ensure((await fetch('http://127.0.0.1:' + port + '/app.js')).status === 200, label + ': legacy /app.js is not served');
  return { assets, entry, legacy: legacyHtml.length };
}

async function main() {
  // 1. Static wiring: build output, copy step and the served directory must agree.
  const vite = await readFile(join(repo, 'src/ui/vite.config.ts'), 'utf8');
  ensure(vite.includes("'../../dist/app/public/workbench'"), 'vite outDir no longer points at the served workbench directory');
  const pkg = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
  const build = String(pkg.scripts.build);
  ensure(build.indexOf('copy-ui.mjs') < build.indexOf('ui:build'), 'build must copy legacy assets before Vite writes the workbench');
  const server = await readFile(join(repo, 'src/app/server.ts'), 'utf8');
  ensure(server.includes("new URL('./public/workbench/', import.meta.url)"), 'server no longer serves ./public/workbench/');
  step('wiring', 'vite outDir = server workbench root; copy-ui before ui:build');

  // 2. Clean output directory: a Vite build alone must produce a servable artifact.
  await rm(workbench, { recursive: true, force: true });
  run('pnpm', ['--dir', 'src/ui', 'run', 'build'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const cleanFiles = await readdir(join(workbench, 'assets'));
  step('clean build', cleanFiles.length + ' assets in a fresh output directory');

  let serverHandle = await startServer(5181);
  try {
    const clean = await assertServed(5181, 'clean');
    step('served clean build', clean.assets.length + ' assets, bytes match');
  } finally { await serverHandle.stop(); }

  // 3. Existing older artifact: rebuild must remove it, not serve it.
  await mkdir(join(workbench, 'assets'), { recursive: true });
  await writeFile(join(workbench, 'assets/stale-marker.js'), 'export const stale = true;\n');
  await writeFile(join(workbench, 'index.html'), '<!doctype html><html><head><script type="module" src="/workbench/assets/stale-marker.js"></script></head><body><div id="root"></div></body></html>\n');
  run('pnpm', ['--dir', 'src/ui', 'run', 'build'], { stdio: ['ignore', 'pipe', 'pipe'] });
  ensure(!existsSync(join(workbench, 'assets/stale-marker.js')), 'a stale asset survived the rebuild');
  ensure(!(await readFile(join(workbench, 'index.html'), 'utf8')).includes('stale-marker'), 'the stale index.html survived the rebuild');
  serverHandle = await startServer(5182);
  try {
    await assertServed(5182, 'after rebuild');
    step('stale artifact', 'replaced by the new build, no stale asset served');
  } finally { await serverHandle.stop(); }

  // 4. Full build from a removed public tree (kernel + backend + legacy + workbench).
  await rm(legacy, { recursive: true, force: true });
  run('pnpm', ['run', 'build'], { stdio: ['ignore', 'pipe', 'pipe'] });
  ensure(existsSync(join(workbench, 'index.html')), 'full build produced no workbench index.html');
  ensure(existsSync(join(legacy, 'index.html')), 'full build produced no legacy index.html');
  serverHandle = await startServer(5183);
  try {
    const full = await assertServed(5183, 'full build');
    step('full build', full.assets.length + ' assets + legacy page served');
  } finally { await serverHandle.stop(); }

  // 5. A source change followed by ONE build must change what the server serves.
  const formatPath = join(repo, 'src/ui/src/format.ts');
  const originalFormat = await readFile(formatPath, 'utf8');
  const beforeEntry = (await readFile(join(workbench, 'index.html'), 'utf8')).match(/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? '';
  try {
    // A comment would be stripped by minification; this top-level side effect survives
    // and therefore changes the emitted bundle exactly like a real edit does.
    await writeFile(formatPath, originalFormat + '\n(globalThis as unknown as Record<string, string>)["__buildIdentityProbe"] = "' + Date.now() + '";\n');
    run('pnpm', ['run', 'build'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const afterEntry = (await readFile(join(workbench, 'index.html'), 'utf8')).match(/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? '';
    ensure(afterEntry && afterEntry !== beforeEntry, 'one build after a source change did not change the bundle: ' + beforeEntry);
    serverHandle = await startServer(5184);
    try {
      const changed = await assertServed(5184, 'after source change');
      ensure(changed.entry === '/workbench/assets/' + afterEntry, 'the server still serves the previous bundle: ' + changed.entry);
      step('single build after change', beforeEntry + ' -> ' + afterEntry + ' served');
    } finally { await serverHandle.stop(); }
  } finally {
    await writeFile(formatPath, originalFormat);
    run('pnpm', ['run', 'build'], { stdio: ['ignore', 'pipe', 'pipe'] });
  }

  await rm(dataDir, { recursive: true, force: true });
  console.log('\nRESULT ' + JSON.stringify({ ok: true, steps }, null, 2));
}

main().catch(async error => {
  console.error('\nRESULT ' + JSON.stringify({ ok: false, steps, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});
