import {edit,files} from './edit.mjs';
const entries={assembleQueryContext:['queryContext','QueryContextPort','query-job'],assembleWorkContext:['workContext','WorkContextPort','work-context-port'],assembleCompletedWorkContext:['completedWork','CompletedWorkContextPort','completed-work-context'],amend:['collaboration',"Pick<HumanCollaboration, 'amend'>",'modules']};
for(const file of ['src/harness/in-memory-harness.ts','src/harness/persistent-harness.ts'])edit(file,s=>{
 for(const method of Object.keys(entries))s=s.replace(new RegExp(`^  ${method}\\([^\\n]+\\r?\\n`,'gm'),'').replace(new RegExp(`^\\s+${method}: \\(request\\)[^\\n]+\\r?\\n`,'gm'),'');
 // The capability comments belong to the module properties above, not orphaned methods.
 for(const comment of ['record one immutable plan-change proposal (Planner proposes only).','record one immutable user decision.','apply an ACCEPTED decision (CAS new revision + goal).','bounded proposal request (compiler port).','bounded planning-context assembly.','HumanCollaboration goal-change face (amend compiles then records).','assemble the bounded query context (never a transcript).'])s=s.replace(`  /** ${comment} */\r\n`,'').replace(`  /** ${comment} */\n`,'');
 return s;
});
for(const [file,method] of [['tests/contract-suite/p1-09-harness.ts','assembleQueryContext'],['tests/contract-suite/p1-16-harness.ts','assembleWorkContext'],['tests/contract-suite/p1-17-harness.ts','assembleCompletedWorkContext'],['tests/contract-suite/p1-11-harness.ts','amend']])edit(file,s=>{
 const [property,type,module]=entries[method];
 s=`import type { ${type.startsWith('Pick')?'HumanCollaboration':type} } from '../../src/contracts/${module}.js';\n`+s;
 return s.replace(new RegExp(`^  ${method}[^\\n]+`,'gm'),`  ${property}: ${type};`);
});
for(const file of files('tests'))edit(file,s=>{
 for(const [method,[property]]of Object.entries(entries))s=s.replace(new RegExp(`\\b(h|harness)\\.${method}\\(`,'g'),`$1.${property}.${method}(`);
 return s;
});
