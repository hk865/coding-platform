import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const base = 'evidence/2026-09-09-independent-review/';
const name = process.argv[2] ?? 'candidate-02';
if (!/^[a-z0-9-]+$/.test(name)) throw Error('Invalid manifest name');
const manifest = JSON.parse(readFileSync(base + name + '-source-sha256.json', 'utf8'));
const sha = data => createHash('sha256').update(data).digest('hex');
const missing = [], changed = [];
for (const entry of manifest.files) {
  try { const actual = sha(readFileSync(entry.path)); if (actual !== entry.sha256) changed.push({ path: entry.path, expected: entry.sha256, actual }); }
  catch (error) { missing.push({ path: entry.path, error: String(error) }); }
}
const excluded = new Set(['node_modules', 'dist', '.vite', 'test-results', 'playwright-report']);
function enumerate(directory) { return readdirSync(directory, { withFileTypes: true }).flatMap(entry => excluded.has(entry.name) ? [] : entry.isDirectory() ? enumerate(directory + '/' + entry.name) : entry.isFile() ? [directory + '/' + entry.name] : []); }
const rootConfig = readdirSync('.', { withFileTypes: true }).filter(entry => entry.isFile() && /^(package.*\.json|.*lock.*|tsconfig.*\.json|vitest.*\.[cm]?[jt]s)$/.test(entry.name)).map(entry => entry.name);
const inventory = [...new Set(['src', 'tests', 'scripts'].flatMap(enumerate).concat(rootConfig))].sort();
const manifestPaths = new Set(manifest.files.map(f => f.path));
const result = { manifest: name, declaredDigest: manifest.digest, computedDigest: sha(JSON.stringify(manifest.files)), files: manifest.files.length, duplicatePaths: manifest.files.length - manifestPaths.size, missing, changed, extraInventory: inventory.filter(path => !manifestPaths.has(path)), outsideInventory: [...manifestPaths].filter(path => !inventory.includes(path)) };
writeFileSync(base + 'audit-' + name + '-identity.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
if (missing.length || changed.length || result.extraInventory.length || result.outsideInventory.length || result.computedDigest !== result.declaredDigest) process.exitCode = 1;
