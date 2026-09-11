import {edit,replace,files} from './edit.mjs';
edit('src/contracts/planning.ts',s=>replace(s,'  request(intent: InitialPlanningRequest): Promise<InitialPlanningRequestResult>;','  requestInitial(intent: InitialPlanningRequest): Promise<InitialPlanningRequestResult>;'));
edit('src/control/plan-compiler/plan-compiler.ts',s=>{
 const a=s.indexOf('  request(intent: AmendGoalRequestV1):'),b=s.indexOf('    // 1) Bounded intent validation',a);
 if(a<0||b<0)throw Error('Compiler request missing');
 return s.slice(0,a)+`  async requestInitial(intent: InitialPlanningRequest): Promise<InitialPlanningRequestResult> {
    if (!intent || typeof intent !== 'object') return { status: 'rejected', code: 'invalid_request', message: 'planning intent is required' };
    return this.initial?.request(intent) ?? { status: 'rejected', code: 'unavailable', message: 'initial coordination is not configured' };
  }

  async request(amendment: AmendGoalRequestV1): Promise<PlanProposalResult> {
    if (!amendment || typeof amendment !== 'object') return { status: 'rejected', code: 'invalid_request', message: 'planning intent is required' };
`+s.slice(b);
});
for(const f of ['src/app/initial-planning.ts','tests/control/planning-interface.test.ts','tests/control/rework-task-dispatch.test.ts'])edit(f,s=>s.replace(/\b(compiler|reopened)\.request\(/g,'$1.requestInitial('));
const methods=['recordPlanChangeProposal','recordUserDecision','applyPlanChange'];
for(const f of ['src/harness/in-memory-harness.ts','src/harness/persistent-harness.ts'])edit(f,s=>{
 for(const name of methods)s=s.replace(new RegExp(`^.*${name}\\(command:[^\\n]+\\r?\\n`,'gm'),'').replace(new RegExp(`^.*${name}: \\(command\\)[^\\n]+\\r?\\n`,'gm'),'');
 return s.replace("explicit Pick<PlanCompilerPort, 'request'>",'amendment proposal entry');
});
edit('tests/contract-suite/p1-11-harness.ts',s=>{
 s="import type { ControlEngine } from '../../src/contracts/modules.js';\n"+s;
 for(const name of methods)s=s.replace(new RegExp(`^  ${name}[^\\n]+\\r?\\n`,'gm'),'');
 s=s.replace('extends P1_08TestHarness {',"extends P1_08TestHarness {\n  control: Pick<ControlEngine, 'recordPlanChangeProposal' | 'recordUserDecision' | 'applyPlanChange'>;");
 s=s.replace('P1_08HarnessLike & {',"P1_08HarnessLike & {\n  control: Pick<ControlEngine, 'recordPlanChangeProposal' | 'recordUserDecision' | 'applyPlanChange'>;");
 return s;
});
for(const f of files('tests'))edit(f,s=>s.replace(/\b(h|harness)\.(recordPlanChangeProposal|recordUserDecision|applyPlanChange)\(/g,'$1.control.$2('));
