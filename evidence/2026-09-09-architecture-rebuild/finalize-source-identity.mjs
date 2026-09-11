import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const directory = 'evidence/2026-09-09-architecture-rebuild';
const read = name => JSON.parse(fs.readFileSync(`${directory}/${name}-source-sha256.json`, 'utf8'));
const candidate = read('ar12-candidate');
const tested = read('ar12-full-end');
const browserStart = read('browser-final-start');
const browserEnd = read('browser-final-end');
assert.deepEqual(candidate.files, tested.files);
assert.deepEqual(browserStart.files, browserEnd.files);
const before = new Map(tested.files.map(file => [file.path, file.sha256]));
const after = new Map(browserEnd.files.map(file => [file.path, file.sha256]));
const changed = [...new Set([...before.keys(), ...after.keys()])].filter(path => before.get(path) !== after.get(path));
assert.deepEqual(changed, ['src/ui/tests/ui-05-09-detail.spec.ts']);
const logs = ['full-tests.log', 'full-tests-workers4.log', 'ar12-types.log', 'ui-types-01.log', 'build-03.log', 'browser-tests.log', 'browser-tests-chromium.log', 'browser-tests-final.log'];
const result = {
  recordedAt: new Date().toISOString(),
  architectureCandidate: { files: tested.files.length, digest: tested.digest, fullTestSnapshotUnchanged: true },
  finalBrowserCandidate: { files: browserEnd.files.length, digest: browserEnd.digest, browserSnapshotUnchanged: true },
  changed,
  change: 'Browser fault injection follows the real /api/real/work route. Production, Vitest assertions and timeouts unchanged.',
  logs: logs.map(path => ({ path, sha256: createHash('sha256').update(fs.readFileSync(`${directory}/${path}`)).digest('hex') })),
};
fs.writeFileSync(`${directory}/final-source-identity.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
