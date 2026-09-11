import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const base = 'evidence/2026-09-09-independent-review/';
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const identity = json(base + 'final-source-identity.json');
const results = json(base + 'verification-results.json');
const current = json(base + 'candidate-04-source-sha256.json');
const prior = json('evidence/2026-09-09-core-verification/resume-02-source-sha256.json');
const oldMap = new Map(prior.files.map(entry => [entry.path, entry.sha256]));
const newMap = new Map(current.files.map(entry => [entry.path, entry.sha256]));
const changes = [...new Set([...oldMap.keys(), ...newMap.keys()])].sort().flatMap(path => {
  const before = oldMap.get(path) ?? null, after = newMap.get(path) ?? null;
  return before === after ? [] : [{ path, before, after }];
});
const claimedChanges = [...identity.changes].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const logChecks = identity.logs.map(entry => ({ ...entry, actual: sha(readFileSync(base + entry.path)) }));
const missingResultLogs = Object.values(results).flatMap(value => value?.log && !identity.logs.some(entry => entry.path === value.log) ? [value.log] : []);
const strip = text => text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
const full = strip(readFileSync(base + results.fullTests.log, 'utf8'));
const fileSummaries = [...full.matchAll(/^\s*✓\s+(tests\/\S+\.test\.[cm]?[jt]sx?)\s+\((\d+) tests?\).*$/gm)].map(match => ({ path: match[1], tests: Number(match[2]) }));
const otherLines = full.split(/\r?\n/).filter(line => line.trim() && !/^\s*(✓|RUN |Test Files |Tests |Start at |Duration )/.test(line));
const browser = strip(readFileSync(base + results.browser.log, 'utf8'));
const browserCases = [...browser.matchAll(/^\s*✓\s+(\d+)\s+(.+)$/gm)].map(match => ({ index: Number(match[1]), case: match[2] }));
const check = {
  fiveManifests: [results.source.candidate, ...results.source.endSnapshots].map(name => {
    const manifest = json(base + name + '-source-sha256.json');
    return { name, files: manifest.files.length, declaredDigest: manifest.digest, computedDigest: sha(JSON.stringify(manifest.files)), exactCandidateFiles: JSON.stringify(manifest.files) === JSON.stringify(current.files), mismatchedActualFiles: manifest.files.filter(entry => sha(readFileSync(entry.path)) !== entry.sha256).map(entry => entry.path) };
  }),
  identityMatchesResults: JSON.stringify(identity.validation) === JSON.stringify(results),
  identityMatchesSource: identity.files === current.files.length && identity.digest === current.digest,
  priorDigestDeclared: prior.digest, priorDigestComputed: sha(JSON.stringify(prior.files)),
  priorMatchesIdentity: prior.files.length === identity.priorAcceptedBaseline.files && prior.digest === identity.priorAcceptedBaseline.digest,
  changedCount: changes.length, added: changes.filter(entry => entry.before === null).length,
  modified: changes.filter(entry => entry.before !== null && entry.after !== null).length,
  deleted: changes.filter(entry => entry.after === null).length,
  changesMatchIdentity: JSON.stringify(changes) === JSON.stringify(claimedChanges),
  changedOutsideSourceScope: changes.filter(entry => !/^(src\/|tests\/|scripts\/)/.test(entry.path)).map(entry => entry.path),
  logsChecked: logChecks.length, mismatchedLogs: logChecks.filter(entry => entry.actual !== entry.sha256), missingResultLogs,
  full: { filesParsed: fileSummaries.length, uniqueFiles: new Set(fileSummaries.map(entry => entry.path)).size, testsFromFiles: fileSummaries.reduce((sum, entry) => sum + entry.tests, 0), summary: full.split(/\r?\n/).filter(line => /^\s*(Test Files |Tests |Start at |Duration )/.test(line)), otherLines },
  browser: { casesParsed: browserCases.length, sequential: browserCases.every((entry, index) => entry.index === index + 1), summary: browser.split(/\r?\n/).filter(line => /\d+ passed \(/.test(line)) },
};
writeFileSync(base + 'audit-final-verification.json', JSON.stringify({ ...check, changes, logChecks, fileSummaries, browserCases }, null, 2) + '\n');
writeFileSync(base + 'audit-full-tests-final-clean.log', full);
console.log(JSON.stringify(check, null, 2));
if (!check.identityMatchesResults || !check.identityMatchesSource || !check.priorMatchesIdentity || check.priorDigestDeclared !== check.priorDigestComputed ||
  !check.changesMatchIdentity || check.changedCount !== 87 || check.deleted || check.changedOutsideSourceScope.length || check.mismatchedLogs.length || check.missingResultLogs.length ||
  check.full.filesParsed !== 249 || check.full.uniqueFiles !== 249 || check.full.testsFromFiles !== 1633 || check.browser.casesParsed !== 23 || !check.browser.sequential ||
  check.fiveManifests.some(entry => !entry.exactCandidateFiles || entry.files !== 730 || entry.computedDigest !== current.digest || entry.mismatchedActualFiles.length)) process.exitCode = 1;
