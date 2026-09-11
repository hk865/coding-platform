import { expect, it } from 'vitest';
import { FeedbackMaterialCompiler } from '../../src/data/context-compiler/feedback-materials.js';
import { ExecutionFeedbackContext } from '../../src/data/context-compiler/execution-feedback-context.js';
import type { QueryJobSnapshot } from '../../src/contracts/query-job.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';

function fixture() {
  const run={aggregateType:'Run' as const,projectId:'p',goalId:'g',runId:'original'};
  const plan={aggregateType:'PlanRevision',projectId:'p',planId:'plan'};
  const pin={schemaVersion:1,projectId:'p',workspaceId:'w',sourceSet:{kind:'workspace_paths',paths:['.']},identity:{workspace:'w',commit:null},manifestDigest:'b'.repeat(64)};
  const reportRef={digest:'a'.repeat(64)};
  const job=(id:string, supersedesQueryJobId?:string)=>({ref:{aggregateType:'QueryJob',projectId:'p',workspaceId:'w',queryJobId:id},revision:1,job:{queryJobId:id,projectId:'p',workspaceId:'w',goalId:'g',status:'answered',runRef:{aggregateType:'QueryRun',projectId:'p',workspaceId:'w',queryJobId:id,runId:id},answerRefs:[{aggregateType:'QueryJobAnswer',projectId:'p',workspaceId:'w',queryJobId:id,answerId:id}],intent:{execution:{kind:'execution_coordination',feedback:{runRef:run,taskId:'t',planRef:plan,workspaceRevision:1,sourcePin:pin,reportRef,...(supersedesQueryJobId?{supersedesQueryJobId}:{})}}}}}) as QueryJobSnapshot;
  const old=job('old'), next=job('next','old');
  const jobs=[old,next];
  const answer=(j:QueryJobSnapshot,version:string)=>({ref:j.job.answerRefs[0],answer:{runRef:j.job.runRef,stale:false,bodyRef:reportRef,answer:JSON.stringify({kind:'feedback_resolution',action:'supplement',availability:'available',summary:'Rule read',material:'Use the current rule',sourcePaths:['RULES.md']}),sources:[{kind:'workspace_source',version},{kind:'workspace_read',refKey:'RULES.md',version:'r'}]}});
  const answers=new Map([['old',answer(old,'old-source')],['next',answer(next,'current')]]);
  const envelope={projectId:'p',workspaceId:'w',goalId:'g',taskId:'next-task',runRef:{...run,runId:'successor'},planRef:plan,workspaceSnapshot:{revision:1}} as TaskEnvelopeV1;
  const ledger={load:async(ref:any)=>({status:'found',snapshot:ref.aggregateType==='WorkContextBinding'?{binding:{linkedRunRefs:[run]}}:ref.aggregateType==='QueryJob'?jobs.find(j=>j.job.queryJobId===ref.queryJobId):ref.aggregateType==='QueryJobAnswer'?answers.get(ref.queryJobId):ref.aggregateType==='Goal'?{activePlanRevision:plan}:ref.aggregateType==='Workspace'?{revision:1}:{ref:run,revision:1,status:'ended',outcome:'completed',envelope:{},task:{taskId:'t'},workspaceSnapshot:{workspaceId:'w'},planRef:plan,endedAt:'2026-09-11T00:00:00Z'}})};
  const source={sourceRevision:async()=> 'current'};
  const applicability={capture:async()=>({status:'sourced',pin})};
  const compiler=new FeedbackMaterialCompiler({ledger,catalog:{jobs:async()=>jobs},source,applicability,vault:{}} as never);
  const stored:any[]=[];
  const context=new ExecutionFeedbackContext({ledger,catalog:{jobs:async()=>jobs},querySource:source,source:applicability,vault:{put:async(v:any)=>{stored.push(v);return {status:'stored',ref:reportRef};}},observations:{all:()=>[{status:'completed',spec:{projectId:'p',workspaceId:'w',goalId:'g',runId:'original',taskId:'t'},trace:[{type:'assistant.message_completed',data:{message:{content:JSON.stringify({kind:'execution_feedback',category:'missing_material',summary:'Rule needed',question:'Read rules'})}}}]}]}} as never);
  return {compiler,context,envelope,jobs,old,next,answers,pin,plan,run,stored,ledger};
}

it('blocks a successor while the persisted replacement investigation is pending',async()=>{
  const f=fixture(); f.next.job.status='pending'; f.next.job.answerRefs=[];
  await expect(f.compiler.select(f.envelope,'work')).rejects.toThrow('incomplete: next');
});
it('uses the witnessed replacement without deleting its stale ancestor',async()=>{
  const f=fixture(); const before=JSON.stringify(f.old);
  const result=await f.compiler.select(f.envelope,'work');
  expect(result.selected.map(row=>row.ref.queryJobId)).toEqual(['next']);
  expect(JSON.stringify(f.old)).toBe(before); expect(f.jobs).toHaveLength(2);
});
it('cannot suppress an unrelated run investigation with a forged replacement link',async()=>{
  const f=fixture(); f.next.job.intent.execution!.feedback!.runRef={...f.run,runId:'other'};
  await expect(f.compiler.select(f.envelope,'work')).rejects.toThrow('source changed');
});
it('keeps a current replacement requiring human decision blocked',async()=>{
  const f=fixture(); const a=f.answers.get('next')!.answer;
  a.answer=a.answer.replace('"supplement"','"needs_decision"');
  await expect(f.compiler.select(f.envelope,'work')).rejects.toThrow('needs_decision');
});
it('checks answered query source and pending source pin against actual current identity',async()=>{
  const f=fixture(); expect(await f.context.current(f.old)).toBe(false); expect(await f.context.current(f.next)).toBe(true);
  f.next.job.status='pending'; expect(await f.context.current(f.next)).toBe(true);
  f.next.job.intent.execution!.feedback!.sourcePin={...f.pin,manifestDigest:'c'.repeat(64)} as never;
  expect(await f.context.current(f.next)).toBe(false);
});
it('renews on a new plan only through the exact persisted same-run predecessor and preserves report ownership',async()=>{
  const f=fixture(); f.old.job.intent.execution!.feedback!.planRef={...f.plan,planId:'old-plan'} as never;
  const prepared=await f.context.prepare(f.run as never,f.old);
  expect(prepared?.source.supersedesQueryJobId).toBe('old'); expect(prepared?.source.planRef).toEqual(f.plan);
  expect(f.stored[0].ownerRef).toEqual(f.run); expect(JSON.parse(f.stored[0].body).feedback.question).toBe('Read rules');
  const forged=structuredClone(f.old); forged.job.workspaceId='elsewhere';
  await expect(f.context.prepare(f.run as never,forged)).rejects.toThrow('unbound');
});

it('keeps malformed failure coordination local to its investigation',async()=>{
  const f=fixture(); f.next.job.intent.execution!.feedback!.failureIssueIds=['issue'];
  f.answers.get('next')!.answer.answer='not json';
  expect(await f.context.failureResolution('next')).toBeNull();
});

it('allows a persisted decision successor to replace the old needs_decision answer while retaining its record',async()=>{
  const f=fixture();
  const oldAnswer=f.answers.get('old')!.answer;
  oldAnswer.answer=oldAnswer.answer.replace('"supplement"','"needs_decision"');
  f.next.job.intent.execution!.feedback!.decisionRef={aggregateType:'UserDecision',projectId:'p',workspaceId:'w',decisionId:'accepted-decision'};
  const load=f.ledger.load;
  f.ledger.load=async(ref:any)=>ref.aggregateType==='UserDecision'?{status:'found',snapshot:{ref,decision:{outcome:'accept',actor:{kind:'human'},subject:{goalRef:{goalId:'g'}},workspaceId:'w'}}} as never:load(ref);
  const result=await f.compiler.select(f.envelope,'work');
  expect(result.selected.map(row=>row.ref.queryJobId)).toEqual(['next']);
  expect(f.answers.get('old')!.answer.answer).toContain('needs_decision');
  expect(f.jobs).toHaveLength(2);
});
