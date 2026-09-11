import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const directory = 'evidence/2026-09-09-independent-review';
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const readSnapshot = phase => readJson(`${directory}/${phase}-source-sha256.json`);
const sha = body => createHash('sha256').update(body).digest('hex');
const validation = readJson(`${directory}/verification-results.json`);
const source = validation.source;
assert.ok(source && typeof source.candidate === 'string' && Array.isArray(source.endSnapshots));
const candidate = readSnapshot(source.candidate);
assert.equal(candidate.digest, sha(JSON.stringify(candidate.files)));
assert.equal(source.endSnapshots.length, 4, 'Require build, browser, full suite and release snapshots');
for (const phase of source.endSnapshots) {
  const snapshot = readSnapshot(phase);
  assert.deepEqual(snapshot.files, candidate.files, `${phase} changed the source inventory`);
  assert.equal(snapshot.digest, candidate.digest);
}
for (const entry of candidate.files) assert.equal(sha(fs.readFileSync(entry.path)), entry.sha256, `Actual source changed: ${entry.path}`);

for (const name of ['backendTypes', 'uiTypes', 'build', 'browser', 'fullTests', 'moduleBoundaries', 'documents']) {
  assert.equal(validation[name].exitCode, 0, `${name} was not successfully completed`);
  assert.ok(fs.existsSync(`${directory}/${validation[name].log}`), `${name} log is missing`);
}
const baseline = readJson('evidence/2026-09-09-core-verification/full-end-source-sha256.json');
const before = new Map(baseline.files.map(entry => [entry.path, entry.sha256]));
const after = new Map(candidate.files.map(entry => [entry.path, entry.sha256]));
const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
const changes = paths.filter(file => before.get(file) !== after.get(file)).map(file => ({ path: file, before: before.get(file) ?? null, after: after.get(file) ?? null }));
const logs = [...new Set(Object.values(validation).filter(value => value?.log).map(value => value.log).concat([
  'audit-dag.json', 'audit-guards-fixed-02.log',
  'audit-legacy-dispatch-isolation-01.log', 'root-http-05.log', 'root-source-tools-02.log',
  'control-existing-drivers-01.log', 'verification-focused-04.log', 'context-focused-06.log',
]))];
const result = {
  recordedAt: new Date().toISOString(), files: candidate.files.length, digest: candidate.digest,
  source,
  unchangedAcrossBuildBrowserFullTestsAndRelease: true,
  inventory: 'src, tests, scripts and root build configuration; excludes dependencies, generated output, fixture data and evidence',
  validation, priorAcceptedBaseline: { files: baseline.files.length, digest: baseline.digest }, changes,
  logs: logs.map(file => ({ path: file, sha256: sha(fs.readFileSync(`${directory}/${file}`)) })),
  acceptanceAuthority: 'The VR-02 acceptance document and independent review; this file verifies source and evidence identity only.',
};
fs.writeFileSync(`${directory}/final-source-identity.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ files: result.files, digest: result.digest, changes: changes.length, unchanged: true }));
