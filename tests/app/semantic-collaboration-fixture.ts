import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import type {Server} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {createBuiltinProviderRegistry,type ModelClientPort,type ModelRequest} from '../../vendor/coding-agent/dist/public-api.js';
import type {ReviewerPacketV1} from '../../src/contracts/reviewer-context.js';
import type {ReviewerSemanticReportV1,ReviewRequestView} from '../../src/contracts/reviewer-verification.js';
import {queryJobAnswerRefFor} from '../../src/contracts/query-job.js';

/** Only decode material and public tool responses actually delivered to the model. */
function objects(value:unknown):Record<string,unknown>[] {
  if(Array.isArray(value))return value.flatMap(objects);
  if(value && typeof value==='object')return [value as Record<string,unknown>,...Object.values(value).flatMap(objects)];
  if(typeof value!=='string')return [];
  const result:Record<string,unknown>[]=[];
  for(const text of value.split('\n\n')){try{result.push(...objects(JSON.parse(text)));}catch{/* instruction prose */}}
  return result;
}

function reviewReply(request:ModelRequest,result:'PASS'|'FAIL') {
  const delivered=objects(request.messages),returned=objects(request.messages.filter(message=>message.role==='tool'));
  const packet=delivered.find(value=>value['kind']==='independent-review-packet') as ReviewerPacketV1|undefined;
  const binding=delivered.find(value=>typeof value['reviewId']==='string' && typeof value['packetDigest']==='string');
  assert.ok(packet && binding,'Reviewer must receive its actual independent packet');
  assert.ok(!returned.some(value=>value['status']==='error'||value['status']==='cancelled'),'Reviewer material tools must succeed');
  for(const path of ['normalize.py','RULES.md']) {
    if(!returned.some(value=>value['materialId']==='source:'+path && value['truncated']===false))
      return {call:{name:'read_source',arguments:{path,startLine:1,maxLines:150}}};
  }
  for(const entry of packet.materials) {
    const pages=returned.filter(value=>value['ref'] && (value['ref'] as Record<string,unknown>)['digest']===entry.ref.digest && typeof value['nextOffset']==='number');
    if(pages.some(page=>page['complete']===true))continue;
    return {call:{name:'read_material',arguments:{materialId:entry.materialId,offset:Math.max(0,...pages.map(page=>Number(page['nextOffset']))),maxBytes:32768}}};
  }
  const source=returned.find(value=>value['materialId']==='source:normalize.py')!;
  assert.match(String(source['content']),/strip\(\)\.translate\(/);
  const tool=packet.materials.find(entry=>entry.kind==='tool-report');assert.ok(tool);
  const coverage=packet.coverage.map(({obligationId,requirementId})=>({obligationId,requirementId}));
  const report:ReviewerSemanticReportV1={schemaVersion:1,kind:'independent-review-result',reviewId:packet.workRef.reviewId,
    descriptorDigest:packet.descriptorDigest,packetDigest:String(binding['packetDigest']),sourceDigest:packet.materialIdentity.sourceDigest,
    citations:[{citationId:'implementation',materialId:'source:normalize.py',digest:String(source['sourceDigest']),location:{kind:'source-lines',path:'normalize.py',startLine:1,endLine:2}},
      {citationId:'tool',materialId:tool.materialId,digest:tool.ref.digest,location:{kind:'artifact-section',pointer:'/result'}}],
    requirements:coverage.map(item=>({...item,result,rationale:result==='PASS'?'The actual source trims ends and translates only ASCII uppercase letters; the current original behavior report covers non-ASCII preservation and empty input.':'Deliberate independent-review failure case; tool PASS cannot replace this required semantic verdict.',citationIds:['implementation','tool'],issueIds:result==='FAIL'?['semantic-finding']:[],unknowns:[]})),
    issues:result==='FAIL'?[{issueId:'semantic-finding',coverage,description:'The protocol substitute deliberately rejects the semantic requirement.',impact:'Required independent review remains unsatisfied.',citationIds:['implementation']}]:[]};
  return {content:JSON.stringify(report)};
}

const plan={kind:'plan',summary:'Normalize a label using the repository rule; ask the coordinator to investigate the missing edge-case rule, then verify mechanically.',
  assignments:[{taskId:'normalize',role:'executor',instruction:'Read normalize.py. If the edge-case rule is missing, ask the coordinator to investigate it. Preserve uncertainty. Registered checks determine completion.'}],
  plan:{stages:[{stageId:'implementation',title:'Normalize label'}],tasks:[
    {taskId:'normalize',stageId:'implementation',title:'Normalize label',taskKind:'work',requirementLevel:'required',disposition:'active',phase:'pending',scope:{kind:'stage',stageId:'implementation'}},
    {taskId:'goal-gate',title:'Behavior acceptance',taskKind:'gate',requirementLevel:'required',disposition:'active',phase:'pending',scope:{kind:'goal'}}],
    obligations:[{obligationId:'label-rule',title:'Label normalization follows RULES.md',requirementLevel:'required',taskIds:['normalize','goal-gate'],
      verificationRequirements:[{requirementId:'behavior',requirementLevel:'required',kind:'dynamic',description:'Run check.py against current implementation'},
        {requirementId:'semantic-review',requirementLevel:'required',kind:'reviewer',description:'Independently inspect the actual implementation and original tool report against the ASCII normalization rule.'}]}],
    taskHierarchy:{parentOf:[{parentTaskId:'goal-gate',childTaskId:'normalize'}]},executionDag:{dependsOn:[{taskId:'goal-gate',dependsOnId:'normalize',requires:{kind:'gate-result',label:'Current evidence'}}]}}};

type Registry = ReturnType<typeof createBuiltinProviderRegistry>;
type ApplicationFactory = (directory:string,options:{workspaceRoots:Record<string,string>;modelSettings:{directory:string;registry:Pick<Registry,'list'|'get'> & {create:()=>ModelClientPort}}})=>Promise<{server:Server;close():Promise<void>}>;
type HumanChoiceInput={projectId:string;workspaceId:string;goalId:string;answerRef:ReturnType<typeof queryJobAnswerRefFor>;optionId:string};
export async function semanticCollaborationFixture(createApplication:ApplicationFactory, onCompleted?: (result:{base:string;scope:{projectId:string;workspaceId:string;goalId:string};final:any;originalRunId:string;review:ReviewRequestView})=>Promise<void>, fixtureOptions:{reviewResult?:'PASS'|'FAIL';humanChoice?:boolean;chooseHumanOption?:(base:string,input:HumanChoiceInput)=>Promise<{status:number;body:any}>;humanChoiceInterruption?:{stage:'before_apply'|'before_query';install:()=>()=>void}}={}) {
  const dir=await mkdtemp(join(tmpdir(),'semantic-collaboration-')),root=join(dir,'source');await mkdir(root);
  await writeFile(join(root,'RULES.md'),'Label rule v1: trim both ends, lowercase ASCII letters, preserve internal spaces; empty input stays empty.');
  if(fixtureOptions.humanChoice)await writeFile(join(root,'USE-CASE.md'),'Product scope is UNDECIDED and neither application is authorized yet. The normalize helper and its RULES.md acceptance are fixed. Choose one intended consumer: catalog import identifiers (machine-facing ingestion keys; display labels are outside this goal), or user-facing display labels (presentation text; catalog import keys are outside this goal). This task implements and verifies only the shared helper for the selected consumer; downstream adapters and UI changes are not included. Recommend catalog import identifiers because the next integration milestone is ingestion. A human must choose the product application; the coordinator may not assume either option or change the helper rules.');
  await writeFile(join(root,'normalize.py'),'def normalize(value):\n    return value\n');
  await writeFile(join(root,'check.py'),"from normalize import normalize\nassert normalize('  HELLO  World  ') == 'hello  world'\nassert normalize('') == ''\nassert normalize('  ÄBC  ') == 'Äbc'\n");
  const requests:ModelRequest[]=[],counts=new Map<string,number>(),registry=createBuiltinProviderRegistry();
  const client:ModelClientPort={async *stream(request){
    requests.push(structuredClone(request));const input=JSON.stringify(request.messages);
    const coordination=input.includes('"execution_coordination"')||input.includes('\\"execution_coordination\\"');
    const failureFeedback=objects(request.messages).some(value=>value['category']==='verification_failure');
    const humanDecision=objects(request.messages).map(value=>(value['executionFeedback'] as {report?:{humanDecision?:unknown}}|undefined)?.report?.humanDecision).find(Boolean) as {decisionId:string;outcome:string;summary:string}|undefined;
    if(humanDecision)assert.equal(humanDecision.outcome,'accept');
    const kind=request.tools.some(t=>t.name==='read_source')?'review':coordination?(humanDecision?'decision-feedback':failureFeedback?'failure-feedback':'feedback'):request.tools.some(t=>t.name==='edit')?(input.includes('已提交的失败事实')?'rework':'worker'):'planning';
    const n=counts.get(kind)??0;counts.set(kind,n+1);
    if(kind==='worker') assert.ok(input.includes('Platform public execution-feedback response contract v1') || input.includes('execution_feedback_protocol'));
    const tool=request.messages.filter(m=>m.role==='tool').at(-1);
    const metadata=tool?.role==='tool'?tool.result.output.find(o=>o.kind==='json'):null;
    const revision=metadata?.kind==='json'?(metadata.value as Record<string,unknown>)['revision']:undefined;
    const reviewer=kind==='review'?reviewReply(request,fixtureOptions.reviewResult??'PASS'):null;
    const returned=objects(request.messages.filter(message=>message.role==='tool'));
    const investigationPaths=['normalize.py','RULES.md',...(fixtureOptions.humanChoice?['USE-CASE.md']:[])];
    const unreadFailurePath=['failure-feedback','decision-feedback'].includes(kind)?investigationPaths.find(path=>!returned.some(value=>value['path']===path && value['revision'] && value['truncated']===false)):undefined;
    const call=reviewer?.call ?? (unreadFailurePath?{name:'read',arguments:{path:unreadFailurePath}}:
      kind==='planning'&&n===0?{name:'read',arguments:{path:'normalize.py'}}:
      kind==='feedback'&&!returned.some(value=>value['path']==='RULES.md' && value['revision'] && value['truncated']===false)?{name:'read',arguments:{path:'RULES.md'}}:
      kind==='worker'&&n===0?{name:'read',arguments:{path:'normalize.py'}}:
      kind==='rework'&&n===0?{name:'read',arguments:{path:'normalize.py'}}:
      kind==='rework'&&n===1?{name:'edit',arguments:{mode:'replace',path:'normalize.py',expectedRevision:revision,oldText:'return value',newText:"return value.strip().translate(str.maketrans('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'))"}}:null);
    if(kind==='rework') assert.ok(input.includes('Label rule v1'));
    const result=reviewer?.content ?? (kind==='planning'?plan:kind==='worker'?{kind:'execution_feedback',category:'missing_material',summary:'The implementation does not specify whitespace and case semantics.',question:'Investigate RULES.md and supply the exact label normalization rule and its source for this work.'}:
      kind==='failure-feedback'&&fixtureOptions.humanChoice?{kind:'feedback_resolution',action:'needs_decision',availability:'available',summary:'The implementation fails RULES.md, and USE-CASE.md leaves its product application unauthorized.',material:'USE-CASE.md requires a human to choose the intended consumer. Catalog ingestion identifiers and user-facing display labels have different application scope. Both retain the fixed helper behavior and all tool and Reviewer requirements; downstream adapters are excluded.',sourcePaths:investigationPaths,decision:{options:[{id:'catalog-identifiers',label:'Catalog import identifiers',objective:'Implement and verify the RULES.md normalize helper for catalog import identifiers. User-facing display labels and downstream adapters are outside this goal.',impact:'Authorize the machine-facing catalog ingestion use case; exclude presentation labels and retain the existing helper acceptance.'},{id:'display-labels',label:'User-facing display labels',objective:'Implement and verify the RULES.md normalize helper for user-facing display labels. Catalog import identifiers and downstream adapters are outside this goal.',impact:'Authorize the presentation-text use case; exclude catalog ingestion identifiers and retain the existing helper acceptance.'}],recommended:'catalog-identifiers',reason:'USE-CASE.md identifies ingestion as the next integration milestone; the product owner must still authorize its scope.',independentWork:'Retain the original failed report and fixed-rule verification materials while waiting; neither application may be assumed.'}}:
      ['failure-feedback','decision-feedback'].includes(kind)?{kind:'feedback_resolution',action:'adjust_plan',availability:'available',summary:'Read the failing implementation and applicable product scope; retain the acceptance rule and repair its current implementation.',material:(humanDecision?'Follow the delivered human decision '+humanDecision.decisionId+'. '+(humanDecision.summary.includes('catalog-identifiers')?'Apply the helper to catalog import identifiers only; user-facing display labels remain outside this goal. ':'Apply the helper to user-facing display labels only; catalog import identifiers remain outside this goal. '):'')+'The current normalize.py returns its input unchanged. Repair the same normalization task by stripping both ends and translating only ASCII A-Z to a-z, preserving Ä and internal spaces. Keep the existing behavioral and independent Reviewer requirements; do not weaken acceptance.',sourcePaths:investigationPaths}:
      kind==='feedback'?{kind:'feedback_resolution',action:'supplement',availability:'available',summary:'Read RULES.md; the edge cases are specified.',material:'Label rule v1: trim both ends, lowercase ASCII letters, preserve internal spaces; empty input stays empty. Applies to normalize in this workspace.',sourcePaths:['RULES.md']}:'Implemented the sourced rule; tool verification is still required.');
    const common={schemaVersion:1 as const,requestId:request.requestId};
    if(call){yield {...common,sequence:1,type:'tool_call_started',callId:kind+n,name:call.name,ordinal:0};yield {...common,sequence:2,type:'tool_arguments_delta',callId:kind+n,delta:JSON.stringify(call.arguments)};}
    else yield {...common,sequence:1,type:'text_delta',delta:typeof result==='string'?result:JSON.stringify(result)};
    yield {...common,sequence:call?3:2,type:'usage_snapshot',usage:{inputTokens:100,outputTokens:100,cachedInputTokens:0,costUsdMicros:null}};
    yield {...common,sequence:call?4:3,type:'completed',reason:call?'tool_calls':'final_answer'};
  }};
  const options={workspaceRoots:{'acceptance-alpha':root,'acceptance-beta':root},modelSettings:{directory:join(dir,'settings'),registry:{list:()=>registry.list(),get:(id:string)=>registry.get(id),create:()=>client}}};
  let app=await createApplication(join(dir,'data'),options),base='',token='';
  let closeAttempted=false;
  const closeApplication=async()=>{if(closeAttempted)return;closeAttempted=true;await app.close();};
  const listen=async()=>{await new Promise<void>(done=>app.server.listen(0,'127.0.0.1',done));const address=app.server.address();if(!address||typeof address==='string')throw Error('no port');base='http://127.0.0.1:'+address.port;token=(await(await fetch(base+'/api/meta')).json() as any).workspaceToken;};
  const scope={projectId:'acceptance-alpha',workspaceId:'workspace-main',goalId:'normalize-goal'};
  const post=async(path:string,input:unknown)=>{const response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-platform-token':token},body:JSON.stringify(input)});return {status:response.status,body:await response.json() as any};};
  const state=async()=>await(await fetch(base+'/api/state?'+new URLSearchParams(scope))).json() as any;
  const records=(types:string[])=>{
    // Built-in acceptance projects share the primary host's ledger.
    const db=new DatabaseSync(join(dir,'data','ledger.sqlite'),{readOnly:true});
    try{return db.prepare("SELECT snapshot_json FROM snapshots WHERE json_extract(snapshot_json, '$.ref.aggregateType') IN ("+types.map(()=>'?').join(',')+") ORDER BY ref_key").all(...types);}
    finally{db.close();}
  };
  const reviewRecords=()=>records(['ReviewWork','ReviewResult','Evidence']);
  const choiceRecords=()=>records(['UserDecision','PlanProposal','PlanRevision']);
  let chosen:{input:Record<string,unknown>;result:any;decisionRef:{decisionId:string};originalAnswer:string;answerId:string}|undefined;
  const until=async(predicate:(s:any)=>boolean)=>{const deadline=Date.now()+45000;for(;;){const s=await state();if(predicate(s))return s;if(Date.now()>deadline)throw Error('Timed out: '+JSON.stringify(s));await new Promise(done=>setTimeout(done,30));}};
  let failed=false,originalFailure:unknown;
  try{
    await listen();await post('/api/model-settings',{provider:'deepseek',model:'labelled-semantic-protocol-stub',baseUrl:'http://127.0.0.1',apiKey:'LOCAL_TEST_KEY'});
    await post('/api/goals',{...scope,requestId:scope.goalId,objective:fixtureOptions.humanChoice?'Implement the shared normalize helper according to RULES.md and verify edge cases; the intended product application remains undecided in USE-CASE.md.':'Implement label normalization according to RULES.md and verify edge cases.'});
    assert.equal((await post('/api/real/work',{...scope,requestId:'normalize-work',instruction:'Implement label normalization according to repository rules; ask for missing material and mechanically verify.',allowWrite:true})).status,200);
    const first=await until(s=>s.queries?.some((q:any)=>q.currentAnswer?.answer?.includes('feedback_resolution')));
    assert.equal(counts.get('feedback'),2);
    const run=first.liveRuns.find((r:any)=>r.spec.taskId==='normalize');assert.equal(run.status,'completed');
    const source={policyId:'semantic-policy',content:{schemaVersion:1,budget:{maxAutonomousReworks:1,maxClarifications:3},allowed:{inScopeRework:true,inScopeTesting:true},scope:{changesRequireHumanDecision:['requirement','acceptance','baseline']},upgrade:{path:'manual-decision',note:'Human choice for changed semantics'}}};
    const installed=await post('/api/real/governance/install',{...scope,kind:'CoordinationPolicy',source});assert.equal(installed.body.status,'committed');
    assert.equal((await post('/api/real/governance/activate',{...scope,kind:'CoordinationPolicy',pin:{ref:installed.body.revisionRef,digest:installed.body.contentDigest}})).body.status,'committed');
    const fail=await post('/api/real/verifications/rounds/start',{...scope,taskId:'normalize',runId:run.spec.runId,requestId:'first-check',allowExecute:true,configuration:{checks:[{checkId:'label-behavior',kind:'dynamic',command:'python3 -B check.py',cwd:'.',timeoutMs:3000,appliesTo:{workspaceId:scope.workspaceId,taskIds:['normalize']}}]}});
    assert.equal(fail.body.round?.outcome,'FAIL',JSON.stringify(fail));
    if(fixtureOptions.humanChoice){
      const waiting=await until(s=>s.queries?.some((q:any)=>q.currentAnswer?.answer?.includes('"needs_decision"')));
      assert.ok(!waiting.liveRuns.some((r:any)=>r.spec.taskId.startsWith('rework-')),'No repair may dispatch before the requested human decision');
      const answerRef=(answer:any)=>queryJobAnswerRefFor(answer.queryJobRef.projectId,answer.queryJobRef.workspaceId,answer.queryJobRef.queryJobId,answer.answerId);
      const answer=waiting.queries.find((q:any)=>q.currentAnswer?.answer?.includes('"needs_decision"')).currentAnswer;
      const initialAnswer=first.queries.find((q:any)=>q.currentAnswer?.answer?.includes('feedback_resolution')).currentAnswer;
      const before=choiceRecords();
      for(const input of [{...scope,answerRef:answerRef(initialAnswer),optionId:'catalog-identifiers'},{...scope,answerRef:answerRef(answer),optionId:'not-an-option'}]){
        const rejected=await post('/api/real/feedback/choose',input);
        assert.ok(rejected.status>=400,JSON.stringify(rejected));assert.deepEqual(choiceRecords(),before,'Invalid selection must not create a decision or plan');
      }
      assert.ok(answer.sources.some((source:any)=>source.kind==='workspace_read' && source.refKey==='USE-CASE.md' && source.version),'Product options require an actual read of the unresolved application scope');
      const input={...scope,answerRef:answerRef(answer),optionId:'catalog-identifiers'};
      const interruption=fixtureOptions.humanChoiceInterruption;
      const beforeChoice=choiceRecords();
      const restore=interruption?.install();
      let response;
      try{response=fixtureOptions.chooseHumanOption?await fixtureOptions.chooseHumanOption(base,input):await post('/api/real/feedback/choose',input);}finally{restore?.();}
      if(interruption){
        assert.equal(response.status,400,JSON.stringify(response));
        assert.match(response.body.error,/semantic fixture interruption/);
        const decode=(rows:ReturnType<typeof choiceRecords>)=>rows.map(row=>JSON.parse(String(row['snapshot_json'])));
        const old=decode(beforeChoice),interrupted=decode(choiceRecords());
        const decisions=interrupted.filter(row=>row.ref.aggregateType==='UserDecision' && !old.some(prior=>JSON.stringify(prior.ref)===JSON.stringify(row.ref)));
        assert.equal(decisions.length,1,'The real human decision must already be durably recorded');
        assert.equal(decisions[0].decision.actor.kind,'human');assert.equal(decisions[0].decision.outcome,'accept');
        const plans=(rows:any[])=>rows.filter(row=>row.ref.aggregateType==='PlanRevision').length;
        assert.equal(plans(interrupted)-plans(old),interruption.stage==='before_apply'?0:1,'Fault must hit the intended persisted boundary');
        assert.equal(counts.get('decision-feedback')??0,0,'The interrupted choice must not have dispatched a decision investigation');
        chosen={input,result:null,decisionRef:decisions[0].ref,originalAnswer:answer.answer,answerId:answer.answerId};
        await closeApplication();app=await createApplication(join(dir,'data'),options);closeAttempted=false;await listen();
        // No POST replay here: startup must reconstruct the saved choice and
        // complete apply/investigation/repair before the final replay assertions.
      }else{
        assert.equal(response.status,200,JSON.stringify(response));assert.equal(response.body.status,'applied');
        assert.ok(response.body.decisionRef && response.body.planRef && response.body.queryJobRef);chosen={input,result:response.body,decisionRef:response.body.decisionRef,originalAnswer:answer.answer,answerId:answer.answerId};
      }
    }
    const expectedReview=fixtureOptions.reviewResult??'PASS';
    const final=await until(s=>s.liveRuns.some((r:any)=>r.spec.mode!=='review' && r.spec.taskId.startsWith('rework-')&&r.rounds?.some((round:any)=>round.status==='completed' && round.control.goalPhase && round.aggregate?.admissions.length>0 && round.aggregate.admissions.every((a:any)=>a.status==='admitted')) && r.reviews?.some((review:any)=>review.phase==='settled') && (expectedReview==='FAIL'||s.matrix.matrix.rows.some((row:any)=>row.taskId===r.spec.taskId && row.livePhase==='satisfied'))));
    assert.ok((await readFile(join(root,'normalize.py'),'utf8')).includes('strip().translate('));
    const successor=final.liveRuns.find((r:any)=>r.spec.mode!=='review' && r.spec.taskId.startsWith('rework-'));
    assert.equal(successor.rounds[0].outcome,'INCONCLUSIVE','Tool round alone cannot discharge the required Reviewer requirement');
    assert.notEqual(successor.rounds[0].control.goalPhase,'COMPLETED');
    const reviewScope={...scope,taskId:successor.spec.taskId,runId:successor.spec.runId,requestId:successor.reviews[0].requestId};
    const readReview=async()=>(await post('/api/real/verifications/reviews/read',reviewScope)).body as ReviewRequestView;
    const review=await readReview();
    assert.equal(review.phase,'settled');
    assert.equal(review.assessment?.body.decision.status,'accepted',JSON.stringify(review));
    assert.ok(review.assessment?.body.decision.status==='accepted' && review.assessment.body.decision.requirements.every(requirement=>requirement.outcome===expectedReview));
    assert.ok(review.formal.resultRef);assert.equal(review.formal.evidenceRefs.length,1);
    assert.notEqual(review.formal.goalPhase,'COMPLETED');
    const taskPhase=final.matrix.matrix.rows.find((row:any)=>row.taskId===successor.spec.taskId).livePhase;
    if(expectedReview==='PASS'){assert.equal(review.formal.taskPhase,'satisfied');assert.equal(taskPhase,'satisfied');}
    else {assert.notEqual(review.formal.taskPhase,'satisfied');assert.notEqual(taskPhase,'satisfied');}
    const reviewerRun=final.liveRuns.find((r:any)=>r.spec.runId===review.work?.reviewerRunRef.runId);
    assert.equal(reviewerRun.spec.mode,'review');assert.equal(reviewerRun.status,'completed');
    assert.notEqual(reviewerRun.sessionId,successor.sessionId);
    const reviewerRequests=requests.filter(request=>request.tools.some(tool=>tool.name==='read_source'));
    assert.ok(reviewerRequests.length>3);
    for(const request of reviewerRequests){assert.ok(request.tools.some(tool=>tool.name==='read_material'));assert.ok(!request.tools.some(tool=>['edit','shell','read'].includes(tool.name)));}
    assert.ok((counts.get('failure-feedback')??0)>=3,'Failure coordination must read both source files before proposing an adjustment');
    assert.ok(successor.context.input.includes('feedback_resolution'));
    if(chosen){
      assert.equal(final.queries.find((q:any)=>q.currentAnswer?.answerId===chosen!.answerId)?.currentAnswer.answer,chosen.originalAnswer,'Human choice must preserve the original published answer');
      assert.ok((counts.get('decision-feedback')??0)>=4,'The decision Query must receive the actual human decision and read the implementation, rules and product-scope file');
      assert.ok(successor.context.input.includes(chosen.decisionRef.decisionId),'The accepted human decision must reach the repair model context');
      assert.ok(successor.context.input.includes('Apply the helper to catalog import identifiers only; user-facing display labels remain outside this goal.'),'The selected product application must reach the repair model, not merely its decision ID');
      const before=choiceRecords(),calls=requests.length;
      const replay=await post('/api/real/feedback/choose',chosen.input);
      assert.equal(replay.status,200,JSON.stringify(replay));assert.equal(replay.body.status,'applied');
      assert.deepEqual(replay.body.decisionRef,chosen.decisionRef);
      if(chosen.result){assert.deepEqual(replay.body.planRef,chosen.result.planRef);assert.deepEqual(replay.body.queryJobRef,chosen.result.queryJobRef);}
      else {assert.ok(replay.body.planRef && replay.body.queryJobRef);chosen.result=replay.body;}
      assert.deepEqual(choiceRecords(),before);assert.equal(requests.length,calls,'Identical human choice must not start another model investigation');
    }
    assert.ok(successor.context.manifest.selected.some((m:any)=>m.selectedBecause.includes('Coordinator consumed')));
    assert.equal((await post('/api/real/verifications/rounds/read',{...scope,taskId:'normalize',runId:run.spec.runId,requestId:'first-check'})).body.outcome,'FAIL');
    await closeApplication();const before=requests.length,recordsBefore=reviewRecords();app=await createApplication(join(dir,'data'),options);closeAttempted=false;await listen();
    assert.deepEqual((await state()).liveRuns.map((r:any)=>r.spec.runId).sort(),final.liveRuns.map((r:any)=>r.spec.runId).sort());assert.equal(requests.length,before);
    const replay=await post('/api/real/verifications/reviews/resume',reviewScope);
    assert.equal(replay.status,200);assert.deepEqual((await readReview()).formal,review.formal);
    assert.deepEqual((await readReview()).workRef,review.workRef);
    assert.deepEqual(reviewRecords(),recordsBefore,'Settled replay must not duplicate or mutate canonical ReviewWork, ReviewResult or Evidence');
    await onCompleted?.({base,scope,final,originalRunId:run.spec.runId,review});
    assert.equal(requests.length,before);
    await mkdir(join(process.cwd(),process.env['SEMANTIC_EVIDENCE_DIR'] ?? '.local/test-evidence/semantic-collaboration'),{recursive:true});
    await writeFile(join(process.cwd(),process.env['SEMANTIC_EVIDENCE_DIR'] ?? '.local/test-evidence/semantic-collaboration','semantic-task-'+Date.now()+'.json'),JSON.stringify({model:'labelled-local-protocol-stub',storage:'real SQLite',kernel:'real coding-agent',tools:'real read/edit/Python behavior check/read_source/read_material',humanChoice:fixtureOptions.humanChoice??false,injectedControlBoundary:fixtureOptions.humanChoiceInterruption?.stage??null,firstFailure:fail.body,final,review,recoveryBoundary:fixtureOptions.humanChoiceInterruption?'A one-shot exception at '+fixtureOptions.humanChoiceInterruption.stage+' leaves the real human decision persisted; graceful host restart automatically applies/delivers it and completes repair before any choice replay. Final settled records also replay unchanged. This is not process-kill or unknown-runtime-side-effect recovery.':'Settled records replay after graceful close; this is not an interrupted-runtime crash test.',modelRequestCount:requests.length,modelBranches:Object.fromEntries(counts),implementation:await readFile(join(root,'normalize.py'),'utf8')},null,2));
  }catch(error){failed=true;originalFailure=error;throw error;}
  finally{
    const cleanupErrors:unknown[]=[];
    try{await closeApplication();}catch(error){cleanupErrors.push(error);}
    try{await rm(dir,{recursive:true,force:true});}catch(error){cleanupErrors.push(error);}
    if(cleanupErrors.length)throw new AggregateError(failed?[originalFailure,...cleanupErrors]:cleanupErrors,'Semantic fixture cleanup failed; original failure, when present, is first',{cause:failed?originalFailure:cleanupErrors[0]});
  }
}


