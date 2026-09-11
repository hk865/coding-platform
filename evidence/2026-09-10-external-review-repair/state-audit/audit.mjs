import fs from 'node:fs';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import path from 'node:path';
const root = process.cwd();
const out = path.join(root, 'evidence/2026-09-10-external-review-repair/state-audit');
fs.mkdirSync(out, { recursive: true });
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const read = p => fs.readFileSync(path.join(root, p));
const manifest = JSON.parse(read('evidence/2026-09-10-external-review-repair/final/final-source-sha256.json'));
const before = JSON.parse(read('evidence/2026-09-10-external-review-repair/before/candidate-04-source-sha256.json'));
const actual = manifest.files.map(f => { try { return { path: f.path, expected: f.sha256, actual: hash(read(f.path)) }; } catch (e) { return { path: f.path, expected: f.sha256, error: e.code }; } });
const bm = new Map(before.files.map(f => [f.path, f.sha256]));
const fm = new Map(manifest.files.map(f => [f.path, f.sha256]));
const e1 = read('evidence/2026-09-10-external-review-repair/E-1-recovered-original/tests-app-explorations.original-19161.test.ts');
const blobId = 'e1eda07e1a8f6dbe22915d24e78ace91be8b993a';
const blob = cp.execFileSync('git', ['cat-file', 'blob', blobId]);
const closeout = JSON.parse(read('evidence/2026-09-09-module-completion/closeout-source-sha256.json'));
const frozen = ['src/control/leased-worker-runtime.ts', 'src/app/server.ts', 'tests/control/reviewer-lease-conflict-recovery.test.ts', 'tests/control/remediation-writer-chain.test.ts'];
for (const p of frozen) fs.writeFileSync(path.join(out, 'audited-' + p.replaceAll('/', '_')), read(p));
const logs = ['full-tests-final.log', 'browser-final.log', 'module-boundaries-final.json', 'validate-docs-final.log'].map(p => {
 const b = read('evidence/2026-09-10-external-review-repair/final/' + p);
 return { path: 'final/' + p, bytes: b.length, sha256: hash(b), tail: b.toString().split(/\r?\n/).slice(-10) };
});
const result = {
 auditedAt: new Date().toISOString(), root, manifestPath: 'evidence/2026-09-10-external-review-repair/final/final-source-sha256.json',
 manifestFileSha256: hash(read('evidence/2026-09-10-external-review-repair/final/final-source-sha256.json')),
 digestAlgorithm: 'SHA-256 over UTF-8 JSON.stringify(manifest.files), retaining array and object property order',
 declaredDigest: manifest.digest, calculatedDigest: hash(JSON.stringify(manifest.files)), fileCount: actual.length,
 mismatches: actual.filter(f => f.actual !== f.expected),
 candidate04Difference: { added: manifest.files.filter(f => !bm.has(f.path)), modified: manifest.files.filter(f => bm.has(f.path) && bm.get(f.path) !== f.sha256), deleted: before.files.filter(f => !fm.has(f.path)) },
 e1: { recoveredBytes: e1.length, recoveredSha256: hash(e1), blobId, blobBytes: blob.length, blobSha256: hash(blob), bytesEqual: blob.equals(e1), historicalManifestEntry: closeout.files.find(f => f.path === 'tests/app/explorations.test.ts'), provenanceLimit: 'Blob has no creation timestamp; closeout manifest is untracked. Byte identity is established; September 9 chronological origin is not independently proven.' },
 logs,
};
fs.writeFileSync(path.join(out, 'initial-state-audit.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ digest: result.calculatedDigest, fileCount: actual.length, mismatches: result.mismatches.length, candidate04: Object.fromEntries(Object.entries(result.candidate04Difference).map(([k,v]) => [k,v.length])), e1: result.e1, logs: logs.map(({ tail, ...rest }) => rest) }, null, 2));
