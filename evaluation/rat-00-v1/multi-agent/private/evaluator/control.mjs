import { readFile } from 'node:fs/promises';
const sourceVersions = JSON.parse(await readFile(new URL('../source-versions.json',import.meta.url),'utf8'));
const expectedCallChain = JSON.parse(await readFile(new URL('../expected-call-chain.json',import.meta.url),'utf8'));
import { resolve } from 'node:path';
const has = (array, value) => array?.includes(value);
const unique = array => new Set(array).size === array.length;
export const rules = {
 'MA-01': {
  'exploration.source-call-chain': o => o.sourceDigest === sourceVersions.base.digest && expectedCallChain.requiredEdges.every(edge => o.edges.some(e => e.from===edge[0] && e.to===edge[1] && o.reportRefs.includes(e.reportRef))),
  'exploration.reader-overlap': o => o.configuration !== 'parallel' || o.readerIntervals.some((a,i)=>o.readerIntervals.slice(i+1).some(b=>a.runId!==b.runId&&Math.max(a.start,b.start)<Math.min(a.end,b.end))),
  'exploration.merge-and-unknowns': o => unique(o.findings.map(x=>x.canonicalLocation)) && has(o.unknowns,'external deployment behavior'),
  'collaboration.real-consumption': o => consumption(o)
 },
 'MA-02': {
  'feature.accepted-proposal-consumed': o => o.proposal.accepted && o.writer.inputRefs.includes(o.proposal.ref) && o.writer.start>o.proposal.acceptedAt && o.writer.runId!==o.proposal.authorRun,
  'feature.independent-verification': o => o.verifier.runId!==o.writer.runId && o.verifier.candidateDigest===o.candidateDigest && o.verifier.startedAt>o.writer.finishedAt && o.verifier.result==='PASS',
  'feature.review-after-checks': o => o.reviewer.runId!==o.writer.runId && o.reviewer.startedAt>o.verifier.finishedAt && o.reviewer.candidateDigest===o.candidateDigest && o.reviewer.inputRefs.includes(o.verifier.ref),
  'collaboration.real-consumption': o => consumption(o)
 },
 'MA-03': {
  'bug.reproduce-then-fix': o => o.reproduction.baseResult==='FAIL' && o.reproduction.candidateResult==='PASS' && o.reproduction.baseDigest!==o.reproduction.candidateDigest && o.reproduction.baseFinishedAt<o.writer.start && o.reproduction.candidateStartedAt>o.writer.finishedAt,
  'bug.fixed-negative-not-confirmed': o => o.negativeControl.checkoutDigest===sourceVersions.paginationFixed.digest && o.negativeControl.findings.filter(x=>x.defectId==='pagination-status-v1'&&x.confirmed).length===0 && o.negativeControl.executedChecks>0,
  'bug.independent-chain': o => unique([o.finder.runId,o.reproducer.runId,o.writer.runId,o.verifier.runId]) && o.reproducer.inputRefs.includes(o.finder.ref)&&o.writer.inputRefs.includes(o.reproducer.ref)&&o.verifier.inputRefs.includes(o.writer.ref)&&o.verifier.candidateDigest===o.candidateDigest,
  'collaboration.real-consumption': o => consumption(o)
 },
 'MA-04': {
  'conflict.evidence-adjudication': o => o.conflict.method==='executable-evidence' && o.conflict.consideredRefs.length===2 && o.conflict.evidenceRefs.length>0 && o.conflict.evidenceRevision===o.currentRevision,
  'lease.exclusive-current-and-scoped': o => o.leases.length>=2 && o.leases.every((a,i)=>o.leases.slice(i+1).every(b=>a.workspace!==b.workspace||Math.max(a.start,b.start)>=Math.min(a.end,b.end))) && o.writeAttempts.some(w=>w.reason==='expired-lease'&&!w.accepted) && o.writeAttempts.some(w=>w.reason==='out-of-scope'&&!w.accepted) && o.writeAttempts.every(w=>!w.accepted||(w.revision===o.currentRevision&&o.leases.some(l=>l.id===w.lease&&l.workspace===w.workspace&&w.at>=l.start&&w.at<l.end))),
  'lease.accepted-change-preserved': o => o.checkpoint.acceptedFiles.length>0 && o.checkpoint.acceptedFiles.every(f=>o.checkpoint.afterFiles.some(x=>x.path===f.path&&x.digest===f.digest)),
  'completion.current-fail-blocks': o => o.completion.effectiveEvidence.some(e=>e.required&&e.result==='FAIL') && !['COMPLETED','satisfied'].includes(o.completion.phase)
 },
 'MA-05': {
  'message.replay-exactly-once': o => o.messages.length>=2 && o.messages[0].correlation===o.messages[1].correlation && ['wakeups','dispatches','acceptedEffects'].every(k=>o[k].filter(x=>x.correlation===o.messages[0].correlation).length===1),
  'message.stale-and-cross-project-rejected': o => ['stale-binding','cross-project'].every(reason=>o.rejections.some(x=>x.reason===reason&&x.beforeDigest===x.afterDigest)),
  'message.uncommitted-body-invisible': o => o.artifactWrites.some(x=>!x.commitSucceeded&&!o.acceptedReports.includes(x.ref)&&!o.visibleReports.includes(x.ref)),
  'isolation.independent-progress': o => o.independentEvents.some(x=>x.kind==='tool-completed'&&x.at>o.failureAt)&&!o.independentEvents.some(x=>x.kind==='cancelled')
 },
 'MA-06': {
  'failure.no-cascade': o => ['reader','coordinator'].every(role=>o.failures.some(x=>x.role===role))&&o.independentEvents.some(x=>x.kind==='tool-completed'&&x.at>Math.max(...o.failures.map(y=>y.at)))&&!o.independentEvents.some(x=>x.kind==='cancelled'),
  'handoff.inherits-obligations-and-reasons': o => ['obligations','rationaleRefs','unresolved','acceptedRefs'].every(k=>o.handoff.before[k].length>0&&o.handoff.before[k].every(x=>o.handoff.after[k].includes(x)))&&o.handoff.successorRun!==o.handoff.previousRun,
  'recovery.reconcile-before-retry-once': o => o.operation.outcomeBefore==='unknown'&&o.operation.reconciledAt>o.operation.interruptedAt&&o.operation.retries.every(x=>x.at>o.operation.reconciledAt)&&o.operation.records.filter(x=>x.id==='trial-note').length===1&&o.operation.claims.every(x=>x.at>=o.operation.reconciledAt)&&o.operation.retries.length===0,
  'recovery.stale-lease-cannot-advance': o => o.staleFeedback.lease!==o.currentLease&&!o.staleFeedback.accepted&&o.staleFeedback.beforeDigest===o.staleFeedback.afterDigest
 },
 'MA-07': {
  'human.query-preserves-source-run': o => ['contextDigest','lease','budgetUsed','obligationRevision','runState'].every(k=>o.query.before[k]===o.query.after[k])&&o.query.kind==='fact'&&o.query.injectedExecutionMessages===0,
  'human.change-version-and-affected-scope': o => o.change.oldRevision!==o.change.newRevision&&o.change.accepted&&o.change.affectedPaths.includes('src/store.mjs')&&o.change.refreshedRuns.length>0&&o.change.refreshedRuns.every(x=>x.revision===o.change.newRevision),
  'human.stale-result-and-independent-work': o => o.oldResult.revision!==o.change.newRevision&&!o.oldResult.satisfiesCurrent&&o.independentEvents.some(x=>x.kind==='tool-completed'&&x.at>o.change.at),
  'human.cancel-run-versus-goal': o => o.cancelRun.goalPhase!=='CANCELLED'&&o.cancelRun.runPhase==='cancelled'&&o.cancelGoal.authority==='goal'&&o.cancelGoal.goalPhase==='CANCELLED'
 },
 'MA-08': {
  'rework.failure-before-review': o => o.attempts[0].checks.some(x=>x.result==='FAIL')&&o.attempts[0].reviewRuns.length===0&&o.attempts[0].phase!=='satisfied'&&o.attempts[0].claims.length>=2,
  'rework.failure-preserved-and-new-evidence': o => o.attempts[0].candidateDigest!==o.attempts[1].candidateDigest&&o.attempts[1].checks.length>0&&o.attempts[1].checks.every(x=>x.result==='PASS')&&o.preservedEvidenceRefs.includes(o.attempts[0].checks.find(x=>x.result==='FAIL').ref),
  'rework.independent-review-after-pass': o => o.attempts[1].reviewRuns.length===1&&o.attempts[1].reviewRuns[0].runId!==o.attempts[1].writerRun&&o.attempts[1].reviewRuns[0].at>Math.max(...o.attempts[1].checks.map(x=>x.at))&&o.attempts[1].reviewRuns[0].candidateDigest===o.attempts[1].candidateDigest,
  'completion.control-current-evidence-only': o => o.reduction.author==='Control'&&o.reduction.candidateDigest===o.attempts[1].candidateDigest&&o.reduction.phase==='COMPLETED'&&o.reduction.evidenceRefs.length>0&&o.reduction.evidenceRefs.every(ref=>o.attempts[1].checks.some(x=>x.ref===ref))&&o.reduction.at>o.attempts[1].reviewRuns[0].at
 }
};
function consumption(o) {
 if(o.configuration==='single')return o.runs.length===1&&o.runs[0].modelInvocations>0;
 const consumed=o.consumptions.filter(c=>o.reports.some(r=>r.accepted&&r.ref===c.ref&&r.revision===c.revision&&r.authorRun!==c.runId&&r.publishedAt<c.at));
 return new Set(consumed.map(c=>o.reports.find(r=>r.ref===c.ref).authorRun)).size>=2&&o.runs.every(r=>r.modelInvocations>0&&r.sessionRef&&r.toolEventRef);
}
export function evaluateControl(trace) {
 const checks=rules[trace?.scenarioId];
 const allowed = ['MA-01','MA-02','MA-03'].includes(trace?.scenarioId) ? ['single','serial','parallel'] : ['parallel-with-injection'];
 if (!checks || !allowed.includes(trace?.observations?.configuration)) return {schemaVersion:1,scenarioId:trace?.scenarioId??null,layer:'normalized-trace-assertion-evaluator',inputOrigin:trace?.origin??null,status:'FAIL',assertions:[{id:'trace.registered-scenario-configuration',status:'FAIL',reason:'Missing, unknown or incompatible scenario/configuration; no applicability exemptions permitted.'}],productCapabilityResult:'NOT_RUN'};
 const inapplicable = new Set(trace.observations?.configuration === 'single' ? ['feature.accepted-proposal-consumed','feature.independent-verification','feature.review-after-checks','bug.independent-chain'] : []);
 if (trace.observations?.configuration !== 'parallel') inapplicable.add('exploration.reader-overlap');
 const assertions=Object.entries(checks).map(([id,test])=>{if(inapplicable.has(id))return{id,status:'NOT_APPLICABLE',reason:'Distinct-Run collaboration or overlap is excluded from this ablation metric; functional scoring remains identical.'};try{return{id,status:test(trace.observations)?'PASS':'FAIL'};}catch(e){return{id,status:'FAIL',reason:'Missing or malformed observation: '+e.message};}});
 const all=assertions.every(x=>x.status==='PASS'||x.status==='NOT_APPLICABLE');
 return {schemaVersion:1,scenarioId:trace.scenarioId,layer:'normalized-trace-assertion-evaluator',inputOrigin:trace.origin,status:all?'PASS':'FAIL',assertions,productCapabilityResult:'NOT_RUN',note:'A normalized trace can only test evaluator logic here. A platform export adapter and independent raw-evidence authentication are NOT_PREPARED; constructed traces are never product evidence.'};
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname){const result=evaluateControl(JSON.parse(await readFile(process.argv[2],'utf8')));console.log(JSON.stringify(result,null,2));process.exitCode=result.status==='PASS'?0:1;}
