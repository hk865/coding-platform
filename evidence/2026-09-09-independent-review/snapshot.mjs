import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Preserve the AR/VR-01 source inventory convention; do not rewrite prior evidence.
const phase = process.argv[2];
if (!phase || !/^[a-z0-9-]+$/.test(phase)) throw Error('Provide a snapshot name');
const output = `evidence/2026-09-09-independent-review/${phase}-source-sha256.json`;
if (fs.existsSync(output)) throw Error(`Preserve existing snapshot: ${output}`);
const excluded = new Set(['node_modules', 'dist', '.vite', 'test-results', 'playwright-report']);
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (excluded.has(entry.name)) return [];
    const file = path.join(directory, entry.name).replaceAll('\\', '/');
    return entry.isDirectory() ? walk(file) : entry.isFile() ? [file] : [];
  });
}
const rootConfig = fs.readdirSync('.').filter(file => /^(package.*\.json|.*lock.*|tsconfig.*\.json|vitest.*\.[cm]?[jt]s)$/.test(file) && fs.statSync(file).isFile());
const paths = [...new Set(['src', 'tests', 'scripts'].flatMap(walk).concat(rootConfig))].sort();
const sha = input => createHash('sha256').update(input).digest('hex');
const files = paths.map(file => ({ path: file, sha256: sha(fs.readFileSync(file)) }));
const snapshot = { createdAt: new Date().toISOString(), root: process.cwd(), digest: sha(JSON.stringify(files)), files };
fs.writeFileSync(output, JSON.stringify(snapshot, null, 2) + '\n');
console.log(JSON.stringify({ phase, files: files.length, digest: snapshot.digest }));
