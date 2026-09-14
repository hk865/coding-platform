import fs from 'node:fs';
import path from 'node:path';
import { owner } from '../../../../scripts/module-map.mjs';

const dir = 'evidence/collaboration-memory/batch/post-m-architecture';
const baseline = JSON.parse(fs.readFileSync(`${dir}/source-before.json`, 'utf8'));
const boundary = JSON.parse(fs.readFileSync(`${dir}/boundaries-before.json`, 'utf8'));
const rows = Object.keys(baseline.fileHashes).map(file => {
  const category = file.startsWith('src/') ? owner(file) : file.startsWith('tests/') ? 'Tests'
    : file.startsWith('scripts/') ? 'BuildAndVerification' : file.startsWith('vendor/') ? 'Vendor' : 'RootConfiguration';
  if (baseline.fileHashes[file] === 'deleted') return { file, category, deletedAtBaseline: true, namingCommentCandidates: [] };
  const saved = file === 'src/data/state-ledger/ledger-validation.ts' ? `${dir}/ledger-validation-before.txt`
    : file === 'src/data/read-model-index/read-model-index.ts' ? `${dir}/read-model-index-before.txt`
    : file === 'src/data/read-model-index/sqlite-read-model-index.ts' ? `${dir}/sqlite-read-model-index-before.txt` : file;
  const source = fs.readFileSync(saved, 'utf8');
  return { file, category, directory: path.posix.dirname(file), lines: source.split('\n').length,
    review: 'pending-semantic-review',
    namingCommentCandidates: source.split('\n').flatMap((text, index) =>
      /(?:\bP1[-0]?\d|\bLANE[- _]|Lane[A-Z]|冻结不可|暂不支持|no-ops)/.test(text)
        ? [{ line: index + 1, text: text.trim().slice(0, 240) }] : []),
  };
});
const surfaces = boundary.edges.filter(e => e.from !== e.to).reduce((acc, e) => {
  const row = acc[e.dest] ??= { file: e.dest, owner: e.to, consumers: [], review: 'observed-not-yet-approved-public-surface' };
  row.consumers.push({ file: e.file, owner: e.from, line: e.line, typeOnly: e.typeOnly });
  return acc;
}, {});
fs.writeFileSync(`${dir}/file-inventory-before.json`, JSON.stringify({ baseline: baseline.sourceFingerprintSha256,
  limitation: 'File coverage and observed imports are inventory, not completed semantic/interface review. Evidence and external documentation roots are not included in the source snapshot.', rows }, null, 2) + '\n');
fs.writeFileSync(`${dir}/observed-interfaces-before.json`, JSON.stringify(Object.values(surfaces), null, 2) + '\n');
console.log(JSON.stringify({ inventoried: rows.length, observedCrossOwnerFiles: Object.keys(surfaces).length,
  candidateFiles: rows.filter(r => r.namingCommentCandidates.length).length }));
