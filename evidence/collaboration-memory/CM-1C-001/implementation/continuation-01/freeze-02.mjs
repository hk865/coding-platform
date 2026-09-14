import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
const root = process.cwd();
const out = join(root, 'evidence/collaboration-memory/CM-1C-001/implementation/CM1C-001-snap-02');
if (existsSync(join(out, 'source-snapshot.json'))) throw Error('Frozen snapshot already exists');
mkdirSync(join(out, 'logs'), { recursive: true });
execFileSync(process.execPath, ['scripts/source-snapshot.mjs', '--out', join(out, 'source-snapshot.json')], { cwd: root });
const snapshot = JSON.parse(readFileSync(join(out, 'source-snapshot.json')));
const prior = JSON.parse(readFileSync(join(root, 'evidence/collaboration-memory/CM-1B-001/implementation/CM1B-001-snap-01/source-snapshot.json')));
const diff = JSON.parse(execFileSync(process.execPath, ['scripts/source-snapshot.mjs', '--diff', join(root, 'evidence/collaboration-memory/CM-1B-001/implementation/CM1B-001-snap-01/source-snapshot.json')], {cwd:root}));
writeFileSync(join(out, 'delivery-files.json'), JSON.stringify(diff, null, 2));
copyFileSync(join(root, 'evidence/collaboration-memory/CM-1B-001/implementation/CM1B-001-snap-01/source-snapshot.json'), join(out, 'adopted-source-snapshot.json'));
for (const [path, hash] of Object.entries(snapshot.fileHashes)) {
  if (hash === 'deleted') continue;
  const target = join(out, 'source-files', path); mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(root,path), target);
  if(createHash('sha256').update(readFileSync(target)).digest('hex') !== hash) throw Error('copy mismatch ' + path);
}
const docs = '/mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform';
const docPaths = ['AGENTS.md','ARCHITECTURE.md','human/module-status.md','dev_docs/interfaces/runtime-collaboration.md','dev_docs/interfaces/context-lifecycle.md',
  'dev_docs/interfaces/state-ledger.md','dev_docs/interfaces/memory-maintenance.md','dev_docs/interfaces/human-design-status.md', ...['control/dispatch-engine','control/control-engine','data/state-ledger','data/read-model-index','data/context-compiler','execution/worker-runtime','interaction/human-collaboration'].map(p=>'dev_docs/modules/'+p+'.md'), ...['CM-1C-001.md','PLAN.md','MAIN-AGENT-PROMPT.md','ACCEPTANCE-PROMPT.md'].map(p=>'dev_docs/planning/active/collaboration-memory/'+p)];
const docIndex = {};
for(const path of docPaths) { const target=join(out,'documents',path); mkdirSync(dirname(target),{recursive:true}); copyFileSync(join(docs,path),target); docIndex[path]=createHash('sha256').update(readFileSync(target)).digest('hex'); }
writeFileSync(join(out,'documents.json'),JSON.stringify(docIndex,null,2));
const repairInput=join(root,'evidence/collaboration-memory/CM-1C-001/implementation/CM1C-001-snap-01/source-snapshot.json');
copyFileSync(repairInput,join(out,'repair-input-snapshot.json'));
writeFileSync(join(out,'repair-files.json'),execFileSync(process.execPath,['scripts/source-snapshot.mjs','--diff',repairInput],{cwd:root}));
console.log(JSON.stringify({ out, count:snapshot.sourceFileCount, fingerprint:snapshot.sourceFingerprintSha256, diff }));
