import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const root = process.cwd();
const sha = value => createHash('sha256').update(value).digest('hex');
const changes = [
  {
    source: 'src/contracts/integration.ts', target: 'src/control/policies/integration.ts',
    name: 'detectEvidenceConflicts', start: '/**\r\n * FROZEN pure detection:',
    end: '// ------------------------------------------------------------------------ //\r\n// Aggregate',
    imports: 'import { canonicalJson, sha256Hex } from "../../contracts/fingerprint.js";\r\nimport type { EvidenceCoverageV1 } from "../../contracts/evidence.js";\r\nimport { evidenceConflictKeyFor, type IntegrationInputRefV1, type EvidenceConflictFactV1, type EvidenceConflictRecordV1 } from "../../contracts/integration.js";\r\n\r\n',
  },
  {
    source: 'src/contracts/remediation.ts', target: 'src/control/policies/remediation.ts',
    name: 'remediationTaskOccupiesDedupKey', start: '/** Pure: the only statuses that keep the dedup key',
    imports: 'import type { RemediationTaskStatus } from "../../contracts/remediation.js";\r\n\r\n',
  },
];
const evidence = [];
for (const change of changes) {
  const original = readFileSync(resolve(root, change.source), 'utf8');
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const start = original.indexOf(change.start.replaceAll('\r\n', newline));
  const end = change.end ? original.indexOf(change.end.replaceAll('\r\n', newline), start) : original.length;
  if (start < 0 || end <= start) throw Error('Extraction bounds absent: ' + change.source);
  const block = original.slice(start, end);
  const target = change.imports + block;
  writeFileSync(resolve(root, change.target), target);
  writeFileSync(resolve(root, change.source), original.slice(0, start) + original.slice(end));
  const copied = readFileSync(resolve(root, change.target), 'utf8').slice(change.imports.length);
  if (block !== copied) throw Error('Changed algorithm bytes: ' + change.name);
  evidence.push({ name: change.name, source: change.source, target: change.target, sha256: sha(block), byteLength: Buffer.byteLength(block), literalNulBytes: Buffer.from(block).filter(n => n === 0).length, escapedNulSequences: (block.match(/\\u0000/g) ?? []).length, exactCopy: true });
}
writeFileSync(resolve(root, 'evidence/2026-09-09-architecture-rebuild/capability-policy-move.json'), JSON.stringify(evidence, null, 2) + '\n');
