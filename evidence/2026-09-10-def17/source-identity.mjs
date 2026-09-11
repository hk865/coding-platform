import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
const root = process.cwd(), out = resolve(root, 'evidence/2026-09-10-def17');
const hash = body => createHash('sha256').update(body).digest('hex');
function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', '.vite', '.local', '.git', 'dist', 'test-results', 'playwright-report'].includes(entry.name)) return [];
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? walk(path) : entry.isFile() ? [path] : [];
  });
}
if (process.argv[2] === 'sync-ui') {
  const source = resolve(root, 'src/app/public/workbench'), built = resolve(root, 'dist/app/public/workbench');
  const files = walk(built);
  for (const path of walk(source)) {
    const rel = relative(source, path), saved = resolve(out, 'source-mode-before-final', rel);
    mkdirSync(dirname(saved), { recursive: true });
    if (!existsSync(saved)) copyFileSync(path, saved);
    // Preserve old hash-named assets as well as the source-mode directory.
  }
  for (const path of files) {
    const dest = resolve(source, relative(built, path)); mkdirSync(dirname(dest), { recursive: true }); copyFileSync(path, dest);
  }
  console.log(JSON.stringify({ sourceModeFiles: files.length, allEqual: files.every(path => hash(readFileSync(path)) === hash(readFileSync(resolve(source, relative(built, path))))) }));
} else {
  const roots = ['AGENTS.md', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.app.json', 'vitest.config.ts'];
  const paths = [...roots.map(path => resolve(root, path)), ...['src', 'tests', 'scripts'].flatMap(path => walk(resolve(root, path)))];
  const files = paths.map(path => ({ path: relative(root, path).replaceAll('\\', '/'), sha256: hash(readFileSync(path)) })).sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const prior = JSON.parse(readFileSync(resolve(root, 'evidence/2026-09-10-external-review-repair/final/final-source-sha256.json')));
  const previous = new Map(prior.files.map(file => [file.path, file.sha256])), current = new Map(files.map(file => [file.path, file.sha256]));
  const result = { createdAt: new Date().toISOString(), root, scope: 'Same root configs + src/tests/scripts; excludes dependencies, caches, dist, test outputs; includes source-mode workbench', fileCount: files.length, digest: hash(JSON.stringify(files)), files,
    sinceOriginalRepair: { digest: prior.digest, added: files.filter(file => !previous.has(file.path)).map(file => file.path), modified: files.filter(file => previous.has(file.path) && previous.get(file.path) !== file.sha256).map(file => file.path), deleted: prior.files.filter(file => !current.has(file.path)).map(file => file.path) } };
  const label = process.argv[2] ?? 'candidate';
  if (!/^[a-z0-9-]+$/.test(label)) throw Error('Invalid snapshot label');
  writeFileSync(resolve(out, label + '-source-sha256.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ fileCount: result.fileCount, digest: result.digest, changes: result.sinceOriginalRepair }));
}
