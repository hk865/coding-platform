import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dependencies = resolve(project, '..', 'node_modules');
const kernelDependencies = resolve(project, '..', 'vendor', 'coding-agent', 'node_modules');
const temporary = await mkdtemp(join(tmpdir(), 'coding-platform-next-'));
const isolated = join(temporary, 'next');
try {
  await cp(project, isolated, { recursive: true, filter: path =>
    basename(path) !== 'node_modules' && resolve(path) !== resolve(project, 'dist') });
  // The only link into the old checkout is the already installed dependency
  // tree. Source and contract files are copied; the old src is absent.
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
  process.stdout.write('next isolated copy: typecheck, build and tests passed\n');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
