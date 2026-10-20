import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dependencies = resolve(project, 'node_modules');
const kernelDependencies = resolve(project, 'vendor', 'coding-agent', 'node_modules');
const temporary = await mkdtemp(join(tmpdir(), 'coding-platform-next-'));
const isolated = join(temporary, 'next');
try {
  await cp(project, isolated, { recursive: true, filter: path =>
    !['node_modules', '.git'].includes(basename(path)) && resolve(path) !== resolve(project, 'dist') });
  // Only installed third-party dependencies are linked from this checkout.
  // Source, contracts and the frozen Kernel build are copied physically.
  await symlink(dependencies, join(isolated, 'node_modules'), 'dir');
  // The frozen public Kernel build is copied with next; only its third-party
  // packages are linked. No old application source is visible in the copy.
  await symlink(kernelDependencies, join(isolated, 'vendor', 'coding-agent', 'node_modules'), 'dir');
  const patchCheck = spawnSync(process.execPath, ['scripts/build-kernel-patch.mjs', '--check'],
    { cwd: isolated, stdio: 'inherit', env: process.env });
  if (patchCheck.status !== 0) throw Error(`isolated Kernel patch reproduction failed (${patchCheck.status ?? patchCheck.signal})`);
  for (const script of ['check:architecture', 'typecheck', 'build', 'test']) {
    const result = spawnSync(process.execPath, ['--run', script], { cwd: isolated, stdio: 'inherit', env: process.env });
    if (result.status !== 0) throw Error(`isolated ${script} failed (${result.status ?? result.signal})`);
  }
  const smoke = spawnSync(process.execPath, ['--input-type=module', '-e',
    "const { createTargetPlatform } = await import('./dist/composition/create-platform.js'); " +
    "const reject = async () => ({ status: 'rejected', code: 'forbidden', reason: 'smoke probe' }); " +
    "const platform = await createTargetPlatform({ storage: { kind: 'memory' }, " +
    "workspace: { resolveRoot: reject, authorize: reject } }); await platform.close();"],
    { cwd: isolated, stdio: 'inherit', env: process.env });
  if (smoke.status !== 0) throw Error(`isolated compiled entry failed (${smoke.status ?? smoke.signal})`);

  // The build emits no static page, so the smoke writes a temporary public
  // directory holding an `index.html` with the token placeholder (the same page
  // tests/helpers/host-page.ts writes). The Host substitutes the per-instance
  // token into it; the smoke then checks the token-protected bootstrap and the
  // loopback Host lifecycle. It never reads a private Host field.
  const workbenchSmoke = spawnSync(process.execPath, ['--input-type=module', '-e',
    "const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs'); " +
    "const { tmpdir } = await import('node:os'); " +
    "const { join } = await import('node:path'); " +
    "const { createLocalWorkbenchHost } = await import('./dist/app/host.js'); " +
    "const { PLATFORM_TOKEN_PLACEHOLDER } = await import('./dist/app/core-http-types.js'); " +
    "const root = mkdtempSync(join(tmpdir(), 'next-workbench-smoke-')); " +
    "const database = mkdtempSync(join(tmpdir(), 'next-workbench-db-')); " +
    "const publicDir = mkdtempSync(join(tmpdir(), 'next-workbench-public-')); " +
    "try { writeFileSync(join(publicDir, 'index.html'), '<!doctype html><meta name=\"platform-token\" content=\"' + PLATFORM_TOKEN_PLACEHOLDER + '\">'); " +
    "const host = await createLocalWorkbenchHost({ storage: { kind: 'sqlite', directory: database }, " +
    "actor: { kind: 'system', id: 'smoke-host' }, publicDir, " +
    "workspaces: [{ scope: { projectId: 'smoke', workspaceId: 'ws' }, name: 'smoke', root, workspaceRevision: 0, readPrefixes: [] }] }); " +
    "try { const address = await host.listen(); " +
    "const page = await fetch(address.url); const html = await page.text(); " +
    "const match = /<meta name=\"platform-token\" content=\"([^\"]+)\">/.exec(html); " +
    "if (page.status !== 200 || !match) throw new Error('workbench page did not expose the token meta'); " +
    "const coreUrl = address.url.replace('/workbench/', '/api/real/core/bootstrap'); " +
    "const authorized = await fetch(coreUrl, { headers: { 'x-platform-token': match[1] } }); " +
    "if (authorized.status !== 200) throw new Error('protected bootstrap failed: ' + authorized.status); " +
    "const anonymous = await fetch(coreUrl); " +
    "if (anonymous.status !== 403) throw new Error('bootstrap was readable without a token: ' + anonymous.status); " +
    "} finally { await host.close(); } " +
    "} finally { rmSync(publicDir, { recursive: true, force: true }); } console.log('workbench smoke ok');"],
    { cwd: isolated, stdio: 'inherit', env: process.env });
  if (workbenchSmoke.status !== 0) throw Error(`isolated workbench smoke failed (${workbenchSmoke.status ?? workbenchSmoke.signal})`);
  process.stdout.write('next isolated copy: typecheck, build and tests passed\n');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
