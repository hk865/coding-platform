import fs from 'node:fs';import path from 'node:path';
let p='tests/contracts/module-ownership.test.ts',s=fs.readFileSync(p,'utf8');
for(const [mod,file] of [['ControlEngine','rework-disposition.ts'],['PlanCompiler','planning-work-materials.ts'],['ReadModelIndex','governance-view.ts'],['ContextCompiler','run-output-materials.ts']])s=s.replace('"'+mod+'": [','"'+mod+'": ["'+file+'", ');
fs.writeFileSync(p,s);
p='tests/control/plan-compiler.test.ts';s=fs.readFileSync(p,'utf8');const a=s.indexOf('    const taskVerify =');const b=s.indexOf('    expect(p.impact.staleAssumptions.length)',a);if(a<0||b<0)throw Error('missing expected test block');s=s.slice(0,a)+`    // Without a configured authority, no guessed work id may appear.
    expect(p.impact.affectedWorks).toEqual([]);
    expect(p.impact.staleAssumptions.some(row => row.assumption.startsWith('工作影响清单完整'))).toBe(true);
`+s.slice(b);fs.writeFileSync(p,s);
const root=path.resolve('../agent_learn/agent_dev/agent_platform/dev_docs/verification/2026-09-11-architecture-convergence/history');
for(const rel of ['PRODUCT.md','ARCHITECTURE.md','human/user-replies-2026-09-11.md','dev_docs/decisions/0003-rework-role-spec-architecture-reconciliation.md']){const src=path.join(root,rel);if(fs.existsSync(src))fs.renameSync(src,src+'.txt');}
