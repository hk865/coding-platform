import { expect, it } from 'vitest';
import { FeedbackDecisionContext } from '../../src/data/context-compiler/feedback-decision-context.js';
import { FeedbackDecisionCompiler } from '../../src/control/plan-compiler/feedback-decision-compiler.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';

function fixture(options:{failBeforeDecision?:boolean}={}) {
  const scope={projectId:'p',workspaceId:'w',goalId:'g'};
  const answerRef={aggregateType:'QueryJobAnswer' as const,projectId:'p',workspaceId:'w',queryJobId:'q',answerId:'a'};
  const planRef={aggregateType:'PlanRevision',projectId:'p',planId:'old'};
  const runRef={aggregateType:'QueryRun',projectId:'p',workspaceId:'w',queryJobId:'q',runId:'qr'};
  const job:any={ref:{...answerRef,aggregateType:'QueryJob',answerId:undefined},job:{...scope,status:'answered',queryJobId:'q',runRef,answerRefs:[answerRef],intent:{execution:{feedback:{planRef,workspaceRevision:1}}}}};
  const resolution={kind:'feedback_resolution',action:'needs_decision',availability:'available',summary:'Choose wording',material:'Two exact objective options.',sourcePaths:['rules'],decision:{options:[{id:'a',label:'Alpha',objective:'Objective A',impact:'Preserve acceptance'},{id:'b',label:'Beta',objective:'Objective B',impact:'Preserve acceptance'}],recommended:'a',reason:'Clearer',independentWork:'None'}};
  const answer={ref:answerRef,answer:{runRef,stale:false,answer:JSON.stringify(resolution),sources:[{kind:'workspace_source',version:'current'}]}};
  const goal:any={ref:{aggregateType:'Goal',projectId:'p',goalId:'g'},revision:3,workspaceRef:{workspaceId:'w'},activePlanRevision:planRef};
  const plan:any={ref:planRef,planRevision:1,stages:[],tasks:[],assignments:[],taskHierarchy:{parentOf:[]},executionDag:{dependsOn:[]},obligations:[]};
  let proposal:any=null, decision:any=null, applied=false, failApply=true, source='current', planningCalls=0, applies=0;
  const ledger={load:async(ref:any)=>{
    const snapshot=ref.aggregateType==='QueryJob'?job:ref.aggregateType==='QueryJobAnswer'?answer:ref.aggregateType==='Goal'?goal:ref.aggregateType==='Workspace'?{revision:1}:ref.aggregateType==='PlanRevision'?plan:ref.aggregateType==='PlanProposal'?proposal:ref.aggregateType==='UserDecision'?decision:null;
    return snapshot?{status:'found',snapshot}:{status:'not_found'};
  }};
  const materials=new FeedbackDecisionContext(ledger as never,{sourceRevision:async()=>source},{jobs:async()=>[job]});
  const compiler=new FeedbackDecisionCompiler({materials,now:()=> '2026-09-11T00:00:00Z',planning:{request:async(request:any)=>{
    planningCalls++;
    return {status:'proposal',proposal:{schemaVersion:1,proposalId:'proposal-'+request.requestId,...scope,sourceGoalRef:goal.ref,sourcePlanRef:planRef,sourcePlanRevision:1,patch:{patchDraft:{objective:request.objectiveDelta.newObjective,obligationDeltas:[]}},impact:{},generatedAt:request.submittedAt}};
  }},control:{recordPlanChangeProposal:async(command:any)=>{proposal={ref:{aggregateType:'PlanProposal',projectId:'p',workspaceId:'w',proposalId:command.aggregateId},proposal:command.payload.proposal};return {status:'committed'};},recordUserDecision:async(command:any)=>{
    if(options.failBeforeDecision) throw Error('crash after proposal');
    if(decision) expect(canonicalJson(command.payload.decision)).toBe(canonicalJson(decision.decision));
    decision={ref:{aggregateType:'UserDecision',projectId:'p',workspaceId:'w',decisionId:command.aggregateId},decision:command.payload.decision};return {status:'committed',decisionRef:decision.ref};
  },applyPlanChange:async(command:any)=>{if(failApply) throw Error('crash after decision'); if(!applied){applies++;applied=true;goal.revision++;goal.activePlanRevision={...planRef,planId:command.payload.newPlanDraft.planId};}return {status:'committed',activePlanRef:goal.activePlanRevision};}}} as never);
  return {scope,answerRef,compiler,materials,goal,resume:()=>{failApply=false;options.failBeforeDecision=false;},changeSource:()=>{source='changed';},counts:()=>({planningCalls,applies}),decision:()=>decision};
}

it('recovers the exact persisted human choice after decision commit but before plan application, then replays idempotently',async()=>{
  const f=fixture();
  await expect(f.compiler.choose(f.scope,f.answerRef,'a')).rejects.toThrow('crash after decision');
  const rows=await f.materials.recordedChoices();
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({scope:f.scope,answerRef:f.answerRef,optionId:'a'});
  f.resume();
  await f.compiler.choose(rows[0]!.scope,rows[0]!.answerRef,rows[0]!.optionId);
  await f.compiler.choose(f.scope,f.answerRef,'a');
  expect(f.counts()).toEqual({planningCalls:1,applies:1});
  expect(JSON.parse(f.decision().decision.summary)).toMatchObject({kind:'feedback_clarification_choice',optionId:'a',answerRef:f.answerRef});
});
it('rejects a different option after a human choice was committed',async()=>{
  const f=fixture(); await expect(f.compiler.choose(f.scope,f.answerRef,'a')).rejects.toThrow('crash after decision');
  f.resume(); await expect(f.compiler.choose(f.scope,f.answerRef,'b')).rejects.toThrow('different recorded choice');
  expect(f.counts().applies).toBe(0);
});
it('rejects changed source before the first choice can be recorded',async()=>{
  const f=fixture(); f.changeSource();
  await expect(f.compiler.choose(f.scope,f.answerRef,'a')).rejects.toThrow('source changed');
  expect(f.counts()).toEqual({planningCalls:0,applies:0}); expect(f.decision()).toBeNull();
});

it('does not recover an unbound decision summary or a tampered authorized target',async()=>{
  const f=fixture(); await expect(f.compiler.choose(f.scope,f.answerRef,'a')).rejects.toThrow('crash after decision');
  const decision=f.decision().decision;
  const summary=decision.summary;
  decision.summary='Somebody selected something';
  expect(await f.materials.recordedChoices()).toEqual([]);
  decision.summary=summary;
  decision.authorizedTarget.newObjective='Unpublished objective';
  expect(await f.materials.recordedChoices()).toEqual([]);
});
it('recovers only an exact legacy option summary and preserves it for replay',async()=>{
  const f=fixture(); await expect(f.compiler.choose(f.scope,f.answerRef,'a')).rejects.toThrow('crash after decision');
  f.decision().decision.summary='Selected a from '+JSON.stringify(f.answerRef)+': Alpha';
  expect((await f.materials.recordedChoices())[0]?.optionId).toBe('a');
  f.resume(); await f.compiler.choose(f.scope,f.answerRef,'a');
  expect(f.counts()).toEqual({planningCalls:1,applies:1});
});

it('does not treat a proposal-only crash as human authorization after the source changes',async()=>{
  const f=fixture({failBeforeDecision:true});
  await expect(f.compiler.choose(f.scope,f.answerRef,'a')).rejects.toThrow('crash after proposal');
  expect(f.decision()).toBeNull();
  f.resume(); f.changeSource();
  await expect(f.compiler.choose(f.scope,f.answerRef,'a')).rejects.toThrow('source changed');
  expect(f.decision()).toBeNull(); expect(f.counts()).toEqual({planningCalls:1,applies:0});
  expect(await f.materials.recordedChoices()).toEqual([]);
});
it('rejects a new choice on a changed active plan after a proposal-only crash',async()=>{
  const f=fixture({failBeforeDecision:true});
  await expect(f.compiler.choose(f.scope,f.answerRef,'a')).rejects.toThrow('crash after proposal');
  f.resume(); f.goal.activePlanRevision={...f.goal.activePlanRevision,planId:'different-plan'};
  await expect(f.compiler.choose(f.scope,f.answerRef,'a')).rejects.toThrow('basis changed');
  expect(f.decision()).toBeNull(); expect(f.counts().applies).toBe(0);
});
