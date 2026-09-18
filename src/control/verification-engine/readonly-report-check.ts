import { canonicalJson } from '../../contracts/fingerprint.js';
import type { CommandCheckRecord } from '../../contracts/verification-service.js';
import type { VerificationRoundCheckBinding } from '../../contracts/verification-round.js';
import type { VerificationRoundScope, VerificationReadonlyReportObservation } from '../../contracts/verification-context.js';
import type { VerificationServiceDeps } from './verification-deps.js';
import { VerificationJournal } from './verification-journal.js';
import { digest, ensure, vScope } from './verification-input.js';

/** Pure report/source predicates. No command, lease, runtime execution or semantic verdict. */
export class ReadonlyReportCheck {
 constructor(private readonly deps:VerificationServiceDeps,private readonly journal:VerificationJournal){}
 async run(scope:VerificationRoundScope,requestId:string,binding:VerificationRoundCheckBinding,prior?:CommandCheckRecord){
  const definition=binding.definition;ensure(definition.mode==='readonly-report'&&definition.kind==='static'&&!scope.gateSubject,'只读报告仅适用于普通 Task 的 static 检查');
  const current=await this.deps.context.resolveRound(scope,binding.identity);ensure(current.status==='ready','只读报告当前材料失效');
  const run=current.material.run;
  ensure(run.status==='ended'&&run.outcome==='completed'&&run.envelope&&run.envelope.permissions.tools.every(t=>t==='read')&&run.envelope.permissions.writeScope.length===0,'需要当前已完成只读 Run');
  const id=digest(canonicalJson([vScope(scope),requestId]));
  let check=prior;
  if(!check){
   check={...vScope(scope),requestId,fingerprint:digest(canonicalJson(binding)),roundBinding:structuredClone(binding),status:'running',command:null,kind:'static',timeoutMs:null,startedAt:new Date().toISOString(),finishedAt:null,result:null,lifecycle:'intent_recorded'};
   await this.journal.save('check',id,check);this.journal.rememberCheck(check,id);this.journal.checks.push(check);
   ensure(this.deps.context.readonlyReport,'只读报告观察端口未配置');
   const observed=await this.deps.context.readonlyReport(scope,binding.identity);
   ensure(observed.status==='ready','只读报告来源不可确认：'+JSON.stringify(observed));
   check.readonlyObservation=structuredClone(observed);check.finishedAt=new Date().toISOString();await this.journal.save('check',id,check);
  }
  ensure(check.roundBinding&&canonicalJson(check.roundBinding)===canonicalJson(binding),'只读检查绑定改变');
  // An interrupted attempt without an observation is explicit unknown. Resume
  // never reselects an improved report or reruns a producer to turn it into PASS.
  const observed=check.readonlyObservation;ensure(observed,'中断前未保存只读观察；不能重新采样刷通过');
  ensure(observed.sourceDigest===binding.identity.sourceDigest,'只读报告来源已变化');
  const issues=readonlyReportIssues(observed,definition.requiredReadPaths);
  const result=observed.workspaceEffects==='unknown'?'INCONCLUSIVE' as const:issues.length?'FAIL' as const:'PASS' as const;
  const context={projectId:scope.projectId,goalId:scope.goalId,taskId:scope.taskId,planRef:binding.identity.planRef,workspaceRevision:binding.identity.workspaceRevision,changeScope:binding.plan.changeScope};
  const observationId='readonly-report-'+id,category='readonly_report_check',effects='not_started' as const;
  const body=canonicalJson({schemaVersion:1,observationId,owner:binding.identity.runRef,context,sourceDigest:binding.identity.sourceDigest,definition,startedAt:check.startedAt,endedAt:check.finishedAt,category,result,effects,readonlyReport:observed,issues,authority:'Mechanical report/source and workspace effect checks only; content correctness requires independent Reviewer.'});
  if(check.progress?.phase!=='report_stored'){
   const stored=await this.deps.vault.put({body,contentType:'application/json',ownerRef:binding.identity.runRef,requestedAt:check.startedAt!,sourceRefs:[{kind:'workspace',refId:scope.workspaceId,revision:String(binding.identity.workspaceRevision),digest:binding.identity.sourceDigest}]});
   ensure(stored.status==='stored','只读检查原始报告未保存');
   check.progress={phase:'report_stored',observationId,context,sourceDigest:binding.identity.sourceDigest,artifactRef:stored.ref,result,category,effects};check.lifecycle='report_stored';await this.journal.save('check',id,check);
  }
  const saved=await this.deps.context.openReport(check.progress.artifactRef,binding.identity.runRef);ensure(saved.status==='ready'&&saved.record.body===body,'只读检查原文与已保存观察不一致');
  const after=await this.deps.context.resolveRound(scope,binding.identity);ensure(after.status==='ready','只读检查保存后来源失效');
  check.result={status:'ready',plan:binding.plan,verificationPlanRef:{planId:binding.plan.planId,planDigest:binding.plan.planDigest},observations:[{checkId:definition.checkId,kind:'static',coverage:binding.plan.checks.find(c=>c.checkId===definition.checkId)!.coverage,result,summary:'Readonly report/source predicates: '+result+'; '+issues.join('; '),artifactRef:check.progress.artifactRef}]};
  check.status='finished';check.lifecycle='observation_complete';check.finishedAt=check.finishedAt??new Date().toISOString();delete check.recovery;await this.journal.save('check',id,check);
 }
}
export function readonlyReportIssues(observed:VerificationReadonlyReportObservation,required:string[]):string[]{
 const issues:string[]=[];
 if(!observed.report?.trim())issues.push('missing_final_report');
 if(!observed.sourceReads.length)issues.push('missing_successful_read');
 for(const path of required)if(!observed.sourceReads.some(r=>r.path===path)||!observed.completeReadPaths?.includes(path))issues.push('missing_complete_required_read:'+path);
 if(observed.workspaceEffects!=='none')issues.push('workspace_effects_'+observed.workspaceEffects);
 return issues;
}
export function settledCheck(check:CommandCheckRecord|undefined|null):boolean{return !!check&&check.status==='finished'&&(check.roundBinding?.definition.mode==='readonly-report'?check.lifecycle==='observation_complete'&&!check.leaseId:check.lifecycle==='lease_released');}
