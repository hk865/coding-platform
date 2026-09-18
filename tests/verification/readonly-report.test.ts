import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInMemoryHarness } from '../../src/harness/in-memory-harness.js';
import { VerificationService } from '../../src/control/verification-engine/verification-service.js';
import { VerificationContextCompiler } from '../../src/data/context-compiler/verification-context.js';
import { VerificationWorkspaceReader } from '../../src/data/workspace-reader/verification-workspace-reader.js';
import { CandidateWorkspaceReader } from '../../src/data/workspace-reader/candidate-workspace-reader.js';
import { ControlReworkDisposition } from '../../src/control/control-engine/rework-disposition.js';
import { prepareP107Scenario, runP107Task, toP1_07Harness, P107_PROJECT, P107_WORKSPACE, P107_GOAL, P107_SCHEMA } from '../contract-suite/p1-07-harness.js';
import { P107_PLAN_REVISION_FIXTURE_V1, P107_TASK_READER_A, P107_ROLE_BINDING_READER_V1, P107_BUDGET_READER_V1 } from '../contract-support/fixtures/workspace-fixtures.js';
import type { VerificationServiceDeps } from '../../src/control/verification-engine/verification-deps.js';
import type { VerificationRoundStartInput } from '../../src/contracts/verification-round.js';
const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const scope={projectId:P107_PROJECT,workspaceId:P107_WORKSPACE,goalId:P107_GOAL,taskId:P107_TASK_READER_A,runId:'readonly-producer'};
const request=():VerificationRoundStartInput=>({requestId:'readonly-round',allowExecute:true,configuration:{checks:[{checkId:'report-source',mode:'readonly-report',kind:'static',requiredReadPaths:['source.txt'],appliesTo:{workspaceId:scope.workspaceId,taskIds:[scope.taskId]}}]}} as VerificationRoundStartInput);
async function fixture(kinds:Array<'static'|'dynamic'|'reviewer'>=['static','reviewer']) {
 const root=await mkdtemp(join(tmpdir(),'readonly-report-')),directory=await mkdtemp(join(tmpdir(),'readonly-report-journal-'));roots.push(root,directory);await writeFile(join(root,'source.txt'),'real source');
 const h=createInMemoryHarness({deps:{clock:()=>P107_SCHEMA}}),p107=toP1_07Harness(h),draft=structuredClone(P107_PLAN_REVISION_FIXTURE_V1);
 for (const o of draft.obligations.filter(o=>o.taskIds.includes(scope.taskId))) for(const vr of o.verificationRequirements) vr.kind='static';
 draft.obligations.push({obligationId:'readonly-obligation',title:'Read and report',requirementLevel:'required',taskIds:[scope.taskId],verificationRequirements:kinds.map((kind,i)=>({requirementId:'vr-'+i,kind,requirementLevel:'required',description:'Required '+kind}))});
 await prepareP107Scenario(p107,draft);await runP107Task(p107,{taskId:scope.taskId,runId:scope.runId,attemptId:'readonly-attempt',roleBinding:P107_ROLE_BINDING_READER_V1,declaredPermissions:{tools:['read'],writeScope:[]},budget:P107_BUDGET_READER_V1});
 const context=new VerificationContextCompiler({ledger:h.ledger,vault:h.vault,runtime:{all:()=>[{spec:scope,status:'completed'}]},rootFor:()=>root,workspaceSource:new CandidateWorkspaceReader(),roundSource:new VerificationWorkspaceReader()});
 // Explicit Context observation seam; integration of real trace/current source is tested separately.
 const witness={report:'The source declares the shared record; this exact original report must reach Reviewer.',completeReadPaths:['source.txt'],observationDigest:'a'.repeat(64),sourceReads:[{callId:'read-1',path:'source.txt',revision:'source-version',startLine:1,endLine:1}],observedTools:['read','coordination_request'],workspaceEffects:'none' as 'none'|'changed'|'unknown'};
 const observe=vi.fn(async()=>({status:'ready' as const,...structuredClone(witness),sourceDigest:await context.workspaceDigest(scope)}));
 Object.assign(context,{readonlyReport:observe});
 const deps:VerificationServiceDeps={directory,context,vault:h.vault,control:h.control,workspaceLease:h.workspaceLease,disposition:new ControlReworkDisposition(h.ledger as never),candidatePatchCheck:{check:async()=>{throw Error('No shell/candidate operation permitted');}}};
 const reopen=async()=>{const s=new VerificationService(deps);await s.init();return s;};
 return{h,context,witness,observe,root,directory,reopen,service:await reopen()};
}
it('ordinary readonly report checks produce static evidence and keep independent Reviewer pending without a command or lease',async()=>{
 const s=await fixture(),r=await s.service.startRound(scope,request());
 expect(r.round.status,JSON.stringify(r.round.gaps)).toBe('completed');
 expect(r.round.coverage).toEqual(expect.arrayContaining([expect.objectContaining({kind:'static',result:'PASS'}),expect.objectContaining({kind:'reviewer',result:null})]));
 expect(r.round.control.taskPhase).not.toBe('satisfied');
 expect(r.round.checks[0]!.record).toMatchObject({command:null,timeoutMs:null,lifecycle:'observation_complete'});expect(r.round.checks[0]!.record!.leaseId).toBeUndefined();
 const material=await s.service.reviewMaterial(scope,'readonly-round');expect(material.status,JSON.stringify(material)).toBe('ready');
 if(material.status!=='ready')throw Error('Reviewer material absent');
 const original=await s.h.vault.open(material.descriptor.tools[0]!.reportRef,{requesterRunRef:material.descriptor.subject.producerRunRef});
 expect(original.status).toBe('ready');if(original.status==='ready')expect(JSON.parse(original.record.body).readonlyReport.report).toBe(s.witness.report);
 expect((await s.service.startRound(scope,request())).replayed).toBe(true);const restored=await s.reopen();expect((await restored.resumeRound(scope,{requestId:'readonly-round',allowExecute:true})).replayed).toBe(true);expect(s.observe).toHaveBeenCalledTimes(1);
},60000);
it.each(['missing-report','missing-read','partial-read','unknown-effects','changed-effects'] as const)('readonly %s never becomes PASS by repeating or reopening',async(failure)=>{
 const s=await fixture();if(failure==='missing-report')s.witness.report='';if(failure==='missing-read')s.witness.sourceReads=[];if(failure==='partial-read')s.witness.completeReadPaths=[];if(failure==='unknown-effects')s.witness.workspaceEffects='unknown';if(failure==='changed-effects')s.witness.workspaceEffects='changed';
 const first=await s.service.startRound(scope,request());expect(first.round.status,JSON.stringify(first.round.gaps)).toBe('completed');expect(first.round.coverage.filter(c=>c.kind==='static').every(c=>c.result!=='PASS')).toBe(true);expect(first.round.control.taskPhase).not.toBe('satisfied');expect((await s.service.reviewMaterial(scope,'readonly-round')).status).not.toBe('ready');
 s.witness.report='A better answer is not a recovery authority';s.witness.sourceReads=[{callId:'read-1',path:'source.txt',revision:'source-version',startLine:1,endLine:1}];s.witness.completeReadPaths=['source.txt'];s.witness.workspaceEffects='none';
 const restored=await s.reopen();const replay=await restored.resumeRound(scope,{requestId:'readonly-round',allowExecute:true});expect(replay.round.outcome).toBe(first.round.outcome);expect(s.observe).toHaveBeenCalledTimes(1);
},60000);
it('static predicates cannot cover dynamic obligations, while an explicit static-only task can be formally satisfied',async()=>{
 const s=await fixture(['dynamic','reviewer']);const round=await s.service.startRound(scope,request());expect(round.round.coverage).toContainEqual(expect.objectContaining({kind:'dynamic',checkIds:[],result:null}));expect(round.round.control.taskPhase).not.toBe('satisfied');expect((await s.service.reviewMaterial(scope,'readonly-round')).status).not.toBe('ready');
 const staticTask=await fixture(['static']);expect((await staticTask.service.startRound(scope,request())).round.control.taskPhase).toBe('satisfied');
},60000);
it('resume after Vault failure uses the saved original observation and deterministic report time without re-reading or executing',async()=>{
 const s=await fixture();vi.spyOn(s.h.vault,'put').mockRejectedValueOnce(Error('fault: observation saved before report storage'));
 const interrupted=await s.service.startRound(scope,request());expect(interrupted.round.status).toBe('interrupted');const observed=interrupted.round.checks[0]!.record!;expect(observed.readonlyObservation?.report).toBe(s.witness.report);expect(observed.finishedAt).not.toBeNull();
 const original=s.witness.report;s.witness.report='DO NOT SELECT THIS LATER ANSWER';const restored=await s.reopen();const recovered=await restored.resumeRound(scope,{requestId:'readonly-round',allowExecute:true});expect(recovered.round.status,JSON.stringify(recovered.round.gaps)).toBe('completed');expect(s.observe).toHaveBeenCalledTimes(1);
 const record=recovered.round.checks[0]!.record!;expect(record.progress?.phase).toBe('report_stored');if(record.progress?.phase!=='report_stored')throw Error('report missing');const stored=await s.h.vault.open(record.progress.artifactRef,{requesterRunRef:record.roundBinding!.identity.runRef});expect(stored.status).toBe('ready');if(stored.status==='ready')expect(JSON.parse(stored.record.body)).toMatchObject({readonlyReport:{report:original},endedAt:observed.finishedAt});
},60000);
it('stale source and static shell requests stay blocked for readonly producers',async()=>{
 const s=await fixture();s.observe.mockImplementationOnce(async()=>({status:'ready',...s.witness,sourceDigest:'stale-source'}));const stale=await s.service.startRound(scope,request());expect(stale.round.status).toBe('interrupted');expect(stale.round.control.taskPhase).not.toBe('satisfied');
 const shell=await s.service.startRound(scope,{requestId:'forbidden-shell',allowExecute:true,configuration:{checks:[{checkId:'shell',kind:'static',command:'touch must-not-exist',cwd:'.',timeoutMs:1000,appliesTo:{workspaceId:scope.workspaceId,taskIds:[scope.taskId]}}]}});expect(shell.round.status).toBe('interrupted');expect(shell.round.gaps.some(g=>g.message.includes('只读探索运行不能启动命令检查'))).toBe(true);
 const { access }=await import('node:fs/promises');await expect(access(join(s.root,'must-not-exist'))).rejects.toThrow();
},60000);
it('readonly failure diagnostics retain predicate issues without inventing a missing shell execution',async()=>{
 const s=await fixture();s.witness.completeReadPaths=[];await s.service.startRound(scope,request());
 const view=await s.service.openIssues({schemaVersion:1,...scope,taskIds:[scope.taskId]});expect(view.status).toBe('ready');if(view.status!=='ready')throw Error('issues missing');
 const failures=view.issues.flatMap(i=>i.failedRequirements).filter(r=>r.failure.category==='readonly_report_check');expect(failures.length).toBeGreaterThan(0);
 for(const row of failures){expect(row.failure).toMatchObject({command:null,exitCode:null,timedOut:null,stderrExcerpt:null,reportIssues:['missing_complete_required_read:source.txt']});expect(row.failure.gaps.some(g=>g.includes('未收录')||g.includes('没有登记命令')||g.includes('没有命令执行'))).toBe(false);expect(row.reason).toContain('missing_complete_required_read:source.txt');}
},60000);
