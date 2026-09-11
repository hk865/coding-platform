import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const base = 'evidence/2026-09-09-independent-review/';
const json = name => JSON.parse(readFileSync(base + name, 'utf8'));
const sha = body => createHash('sha256').update(body).digest('hex');
const current = json('verification-results.json'), prior = json('verification-results-preacceptance.json');
const identity = json('final-source-identity.json'), oldIdentity = json('final-source-identity-preacceptance.json');
const omit = (object, keys) => Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)));
const logChecks = identity.logs.map(entry => ({ path: entry.path, expected: entry.sha256, actual: sha(readFileSync(base + entry.path)) }));
const addedLogs = identity.logs.filter(entry => !oldIdentity.logs.some(old => old.path === entry.path));
const removedLogs = oldIdentity.logs.filter(entry => !identity.logs.some(now => now.path === entry.path));
const check = {
  executionRecordsUnchanged: JSON.stringify(omit(current, ['documents'])) === JSON.stringify(omit(prior, ['documents'])),
  identitySourceAndChangesUnchanged: JSON.stringify(omit(identity, ['recordedAt', 'validation', 'logs'])) === JSON.stringify(omit(oldIdentity, ['recordedAt', 'validation', 'logs'])),
  embeddedResultsMatch: JSON.stringify(current) === JSON.stringify(identity.validation),
  documents: current.documents,
  documentLogHasCompleteSuccess: readFileSync(base + current.documents.log, 'utf8').includes('Documentation validation: 13/13 checks passed.'),
  logsChecked: logChecks.length, mismatchedLogs: logChecks.filter(entry => entry.actual !== entry.expected),
  addedLogs, removedLogs,
  retainedLogsUnchanged: identity.logs.filter(entry => oldIdentity.logs.some(old => old.path === entry.path)).every(entry => oldIdentity.logs.find(old => old.path === entry.path).sha256 === entry.sha256),
  scope: 'Documentation and machine index closeout only; no product source hashing or test execution repeated.',
};
writeFileSync(base + 'audit-document-closeout.json', JSON.stringify(check, null, 2) + '\n');
console.log(JSON.stringify(check, null, 2));
if (!check.executionRecordsUnchanged || !check.identitySourceAndChangesUnchanged || !check.embeddedResultsMatch || !check.documentLogHasCompleteSuccess ||
  check.mismatchedLogs.length || !check.retainedLogsUnchanged || current.documents.exitCode !== 0 || current.documents.log !== 'docs-final.log') process.exitCode = 1;
