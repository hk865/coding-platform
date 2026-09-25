import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A single reviewed source patch, compiled against the frozen public build's
// declarations. No original Kernel source or generated platform build is read.
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = resolve(project, 'vendor/coding-agent');
const relativeSource = 'storage/adapters/sqlite/sqlite-stores.ts';
const outputStem = relativeSource.slice(0, -3);
const artifacts = ['.js', '.js.map', '.d.ts', '.d.ts.map'].map(suffix => outputStem + suffix);
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && !['--check', '--write'].includes(args[0]))) {
  throw new Error('Usage: node scripts/build-kernel-patch.mjs [--check|--write]');
}
const mode = args[0] ?? '--check';
const require = createRequire(import.meta.url);
const kernelRequire = createRequire(resolve(vendor, 'package.json'));
const installedKernelRequire = createRequire(resolve(project, '../vendor/coding-agent/package.json'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = await readFile(resolve(vendor, 'patches', relativeSource), 'utf8');
const expectedTypeScript = JSON.parse(await readFile(resolve(project, 'package.json'), 'utf8')).dependencies.typescript;
const actualTypeScript = JSON.parse(await readFile(require.resolve('typescript/package.json'), 'utf8')).version;
if (actualTypeScript !== expectedTypeScript) {
  throw new Error(`TypeScript version differs: expected ${expectedTypeScript}, found ${actualTypeScript}`);
}
let zodManifest;
try { zodManifest = kernelRequire.resolve('zod/package.json'); }
catch { zodManifest = installedKernelRequire.resolve('zod/package.json'); }

const temporary = await mkdtemp(join(tmpdir(), 'next-kernel-patch-'));
try {
  // Relative .js imports resolve to neighboring .d.ts from this copy. tsc emits
  // only the one explicit source file; it never recompiles or overwrites peers.
  await cp(resolve(vendor, 'dist'), join(temporary, 'src'), { recursive: true });
  await writeFile(join(temporary, 'src', relativeSource), source);
  await writeFile(join(temporary, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  await mkdir(join(temporary, 'node_modules/@types'), { recursive: true });
  await symlink(dirname(zodManifest), join(temporary, 'node_modules/zod'), 'dir');
  await symlink(dirname(require.resolve('@types/node/package.json')), join(temporary, 'node_modules/@types/node'), 'dir');
  await writeFile(join(temporary, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2024', module: 'NodeNext', moduleResolution: 'NodeNext',
      lib: ['ES2024'], types: ['node'], strict: true,
      noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true,
      noImplicitOverride: true, noFallthroughCasesInSwitch: true,
      noPropertyAccessFromIndexSignature: true, forceConsistentCasingInFileNames: true,
      isolatedModules: true, verbatimModuleSyntax: true, skipLibCheck: true,
      noEmitOnError: true, rootDir: 'src', outDir: 'dist',
      declaration: true, declarationMap: true, sourceMap: true,
    },
    files: ['src/' + relativeSource],
  }, null, 2));
  const compilation = spawnSync(process.execPath,
    [require.resolve('typescript/bin/tsc'), '-p', join(temporary, 'tsconfig.json')],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (compilation.error) throw compilation.error;
  if (compilation.status !== 0) {
    throw new Error(`Kernel patch compilation failed:\n${compilation.stdout}${compilation.stderr}`);
  }
  const generated = [];
  for (const path of artifacts) {
    const generatedPath = join(temporary, 'dist', path);
    let bytes = await readFile(generatedPath);
    if (path.endsWith('.map')) {
      const map = JSON.parse(bytes.toString('utf8'));
      if (map.sources.length !== 1 || map.sources[0] !== '../../../../src/' + relativeSource) {
        throw new Error(`Unexpected source-map origin: ${path}`);
      }
      // Match the frozen dependency convention: both mappings carry source
      // text for debugging without importing the original source tree.
      map.sourcesContent = [source];
      // The migration froze maps as compact, ASCII-escaped JSON. Preserve this
      // serialization too, so an unchanged source reproduces all four bytesets.
      bytes = Buffer.from(JSON.stringify(map).replace(/[\u0080-\uffff]/g,
        character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')));
    }
    const destination = resolve(vendor, 'dist', path);
    const current = await readFile(destination);
    generated.push({ path, destination, bytes, sha256: hash(bytes), currentSha256: hash(current), matches: bytes.equals(current) });
  }
  if (mode === '--write') {
    for (const item of generated) await writeFile(item.destination, item.bytes);
  }
  process.stdout.write(JSON.stringify({
    mode: mode.slice(2), source: 'vendor/coding-agent/patches/' + relativeSource,
    sourceSha256: hash(source), typeScript: actualTypeScript,
    artifacts: generated.map(({ path, sha256, currentSha256, matches }) => ({ path, sha256, currentSha256, matches })),
  }, null, 2) + '\n');
  if (mode === '--check' && generated.some(item => !item.matches)) process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
