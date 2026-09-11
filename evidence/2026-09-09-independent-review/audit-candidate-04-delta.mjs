import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const base = 'evidence/2026-09-09-independent-review/';
const read = name => JSON.parse(readFileSync(base + name + '-source-sha256.json', 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
const prior = read('candidate-03'), current = read('candidate-04'), priorEnd = read('full-end-03');
const priorIndex = new Map(prior.files.map(entry => [entry.path, entry.sha256]));
const currentIndex = new Map(current.files.map(entry => [entry.path, entry.sha256]));
const added = current.files.filter(entry => !priorIndex.has(entry.path)).map(entry => entry.path);
const changed = current.files.filter(entry => priorIndex.has(entry.path) && priorIndex.get(entry.path) !== entry.sha256).map(entry => entry.path);
const removed = prior.files.filter(entry => !currentIndex.has(entry.path)).map(entry => entry.path);
const path = 'src/verification/verification-rounds.ts';
const source = readFileSync(path, 'utf8');
const oldMessage = "throw new ReportMaterialUnavailable('原始检查报告当前不可读取')";
const newMessage = "throw new ReportMaterialUnavailable('原始检查报告不可读取')";
const result = {
  prior: prior.digest, current: current.digest, added, changed, removed,
  fullEnd03DeclaredDigest: priorEnd.digest,
  fullEnd03ComputedDigest: sha(JSON.stringify(priorEnd.files)),
  fullEnd03EqualsCandidate03: JSON.stringify(priorEnd.files) === JSON.stringify(prior.files),
  currentMessageOccurrences: source.split(newMessage).length - 1,
  oldMessageAbsent: !source.includes(oldMessage),
  currentSourceMatchesCandidate04: sha(source) === currentIndex.get(path),
  restoringOnlyMessageMatchesCandidate03: sha(source.replace(newMessage, oldMessage)) === priorIndex.get(path),
};
writeFileSync(base + 'audit-candidate-04-delta.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (added.length || removed.length || changed.length !== 1 || changed[0] !== path ||
  !result.fullEnd03EqualsCandidate03 || result.fullEnd03ComputedDigest !== priorEnd.digest ||
  result.currentMessageOccurrences !== 1 || !result.oldMessageAbsent ||
  !result.currentSourceMatchesCandidate04 || !result.restoringOnlyMessageMatchesCandidate03) process.exitCode = 1;
