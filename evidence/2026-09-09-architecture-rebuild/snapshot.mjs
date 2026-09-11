import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Run from the product root. A read-only source inventory; evidence and build
// output are excluded so test logs cannot change the tested source identity.
const phase = process.argv[2];
if (!phase || !/^[a-z0-9-]+$/.test(phase)) throw Error('Provide a snapshot name');
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
fs.writeFileSync(`evidence/2026-09-09-architecture-rebuild/${phase}-source-sha256.json`, JSON.stringify(snapshot, null, 2) + '\n');
console.log(JSON.stringify({ phase, files: files.length, digest: snapshot.digest }));
