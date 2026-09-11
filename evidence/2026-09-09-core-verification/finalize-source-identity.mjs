import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const directory = 'evidence/2026-09-09-core-verification';
const read = phase => JSON.parse(fs.readFileSync(`${directory}/${phase}-source-sha256.json`, 'utf8'));
const candidate = read('candidate'), full = read('full-end'), browser = read('browser-end'), pause = read('pause');
assert.deepEqual(full.files, candidate.files);
assert.deepEqual(browser.files, candidate.files);
assert.deepEqual(pause.files, candidate.files);
const architecture = JSON.parse(fs.readFileSync('evidence/2026-09-09-architecture-rebuild/browser-final-end-source-sha256.json', 'utf8'));
const before = new Map(architecture.files.map(file => [file.path, file.sha256]));
const after = new Map(candidate.files.map(file => [file.path, file.sha256]));
const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
const changes = paths.filter(path => before.get(path) !== after.get(path)).map(path => ({
  path, before: before.get(path) ?? null, after: after.get(path) ?? null,
}));
const logs = ['full-tests.log', 'full-tests-workers2.log', 'types-final.log', 'ui-types-final.log', 'build-final.log', 'browser-final.log', 'module-boundaries-final.json', 'human-dag-match.json', 'docs-final.log', 'docs-paused.log'];
const result = {
  recordedAt: new Date().toISOString(), files: candidate.files.length, digest: candidate.digest,
  unchangedAcrossFullTestsAndBrowser: true,
  unchangedAtUserPause: true,
  taskStatus: 'paused_by_user; final independent full-log confirmation pending; no Reviewer source implementation started',
  inventory: 'src, tests, scripts and root build configuration; excludes dependencies, generated output, fixtures data and evidence',
  architectureBaseline: { files: architecture.files.length, digest: architecture.digest }, changes,
  logs: logs.map(path => ({ path, sha256: createHash('sha256').update(fs.readFileSync(`${directory}/${path}`)).digest('hex') })),
};
fs.writeFileSync(`${directory}/final-source-identity.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ files: result.files, digest: result.digest, changes: changes.length, unchanged: true }));
