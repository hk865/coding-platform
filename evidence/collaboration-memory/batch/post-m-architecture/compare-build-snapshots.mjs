import { readFileSync, writeFileSync } from 'node:fs';

const [oldPath, newPath, outputPath] = process.argv.slice(2);
if (!oldPath || !newPath || !outputPath) {
  throw new Error('usage: compare-build-snapshots.mjs <old> <new> <output>');
}

const oldSnapshot = JSON.parse(readFileSync(oldPath, 'utf8'));
const newSnapshot = JSON.parse(readFileSync(newPath, 'utf8'));
const oldFiles = new Map(oldSnapshot.files.map(file => [file.path, file.sha256]));
const newFiles = new Map(newSnapshot.files.map(file => [file.path, file.sha256]));
const result = {
  oldFingerprint: oldSnapshot.fingerprintSha256,
  newFingerprint: newSnapshot.fingerprintSha256,
  added: [...newFiles.keys()].filter(path => !oldFiles.has(path)).sort(),
  removed: [...oldFiles.keys()].filter(path => !newFiles.has(path)).sort(),
  changed: [...newFiles.keys()].filter(path => oldFiles.has(path) && oldFiles.get(path) !== newFiles.get(path)).sort(),
};

writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
