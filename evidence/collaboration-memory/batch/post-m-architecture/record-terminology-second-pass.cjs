const fs = require('node:fs');
const file = 'evidence/collaboration-memory/batch/post-m-architecture/current-terminology-files.json';
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const repaired = new Set([
  'src/app/README.md',
  'src/contracts/baseline-evolution.ts', 'src/contracts/dispatch.ts', 'src/contracts/events.ts',
  'src/contracts/human-role-collaboration.ts', 'src/contracts/role-spec-materials.ts',
  'src/control/control-engine/architecture-inspection.ts', 'src/control/control-engine/baseline-evolution.ts',
  'src/control/control-engine/goal-change.ts', 'src/control/control-engine/goal-reducer.ts',
  'src/control/control-engine/human-role-collaboration.ts', 'src/control/control-engine/README.md',
  'src/control/control-engine/run-facts.ts', 'src/control/control-engine/work-record.ts',
  'src/control/dispatch-engine/README.md', 'src/control/dispatch-engine/rework-drive.ts',
  'src/control/dispatch-engine/role-spec-read.ts', 'src/control/verification-engine/README.md',
  'src/control/verification-engine/role-output-completeness.ts', 'src/control/verification-engine/verification-rounds.ts',
  'src/data/context-compiler/README.md', 'src/ui/src/features/governance.tsx',
  'src/ui/src/features/misc.tsx', 'src/ui/src/features/settings.tsx'
]);
const concurrent = new Set(['src/data/read-model-index/read-model-index.ts', 'src/data/read-model-index/sqlite-read-model-index.ts']);
data.secondPass = {
  reviewedAt: '2026-09-14',
  rule: 'Review every file changed by the mechanical ticket/lane rewrite; restore business meaning rather than merely deleting tokens.',
  files: data.changed.map(file => ({
    file,
    disposition: concurrent.has(file) ? 'verified-after-concurrent-owner-repair' : repaired.has(file) ? 'repaired-business-wording' : 'reviewed-no-mechanical-damage-found',
    ...(concurrent.has(file) ? { evidence: 'concurrent-files-comment-findings.txt (empty after owner repair)' } : {}),
  })),
};
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(JSON.stringify({ reviewed: data.secondPass.files.length, repaired: data.secondPass.files.filter(x => x.disposition === 'repaired-business-wording').length, verifiedConcurrent: data.secondPass.files.filter(x => x.disposition === 'verified-after-concurrent-owner-repair').length }));
