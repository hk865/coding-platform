import {edit,replace} from './edit.mjs';
import fs from 'node:fs';
const impl='src/data/context-compiler/planning-context-compiler.ts';
const old=fs.readFileSync(impl,'utf8');
const start=old.indexOf('export type PlanningContextRequest ='),end=old.indexOf('/** LANE-B',start);
const types=old.slice(start,end).replaceAll('../../contracts/','./');
edit('src/contracts/planning.ts',s=>s.replace("import type { GoalSnapshot }", "import type { GoalRef, GoalSnapshot }")+`\n${types}\n/** Bounded planning material. This compiles sources; it does not run an Agent. */
export interface PlanningContextPort {
  assemblePlanningContext(request: PlanningContextRequest): Promise<PlanningContextResult>;
}
`);
edit('src/contracts/goal-change.ts',s=>s.replace(/export interface PlanningContextPort \{[\s\S]*?\r?\n\}\r?\n/,''));
edit(impl,s=>{
 s=s.slice(0,start)+s.slice(end);
 s=replace(s,'import type { PlanningContextPort } from "../../contracts/goal-change.js";', 'import type { PlanningContextPort, PlanningContextRequest, PlanningContextResult, PlanningContextRejectionCode } from "../../contracts/planning.js";');
 return s.replace('/** LANE-B implementation (ctor deps frozen; never starts a model; no canonical write). */','/** Task-context adaptation with planning-specific material gaps and size limits. */').replace('StateLedger, GoalRef, WorkspaceSnapshot','StateLedger, WorkspaceSnapshot').replace('import type { PlanRevisionRef } from "../../contracts/plan.js";','');
});
for(const file of ['src/harness/in-memory-harness.ts','src/harness/persistent-harness.ts'])edit(file,s=>s.replace("{ PlanCompilerPort }",'{ PlanCompilerPort, PlanningContextPort }').replace('import type { PlanningContextPort } from "../contracts/goal-change.js";',''));
edit('tests/contract-suite/p1-11-harness.ts',s=>s.replace("{ PlanCompilerPort }",'{ PlanCompilerPort, PlanningContextPort }').replace('import type { PlanningContextPort } from "../../src/contracts/goal-change.js";','').replace("import type { PlanningContextPort } from '../../src/contracts/goal-change.js';",''));
// Migrate the actual type consumers, not just the implementation's implements clause.
edit('tests/context/planning-context-compiler.test.ts',s=>s.replace(/import type \{ PlanningContextRequest \} from [^;]+;/,"import type { PlanningContextRequest } from '../../src/contracts/planning.js';"));
// Preserve amendment null/default semantics, derive every plan-content field from PlanRevisionDraft.
edit('src/contracts/goal-change.ts',s=>{
 s="import type { PlanRevisionDraft } from './plan.js';\n"+s;
 const a=s.indexOf('    newPlanDraft: {'),b=s.indexOf('    changeReason: string;',a);
 if(a<0||b<0)throw Error('Command draft missing');
 return s.slice(0,a)+`    newPlanDraft: (Pick<PlanRevisionDraft, 'planId' | 'planRevision' | 'obligations'> & {
      objective: string;
      stages: PlanRevisionDraft['stages'] | null;
      taskHierarchy: PlanRevisionDraft['taskHierarchy'] | null;
      executionDag: PlanRevisionDraft['executionDag'] | null;
      /** Omission inherits source tasks; supplied tasks must match the accepted delta. */
      tasks?: PlanRevisionDraft['tasks'];
      /** Null/omission inherits source assignments; supplied values are re-derived and checked. */
      assignments?: PlanRevisionDraft['assignments'] | null;
    }) | null;
`+s.slice(b);
});
