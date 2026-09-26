/**
 * B2 Runtime behavior-test fixture.
 *
 * It composes the REAL TaskClaim fixture (Goal/Plan/Session/Role/Claim over the
 * real Memory or SQLite RecordStore) with the real WG11 execution reader, the
 * real WG12/RT7/RT8 history readers, the real WorkGraph entry/model-call skeleton
 * services and a local scripted Kernel model. It never fabricates a claim, a
 * terminal observation or a model call: the claim comes from the formal
 * `TaskClaimPort` and every provider call is counted.
 *
 * The phase-1 WorkGraph entry/model-call services return explicit `unsupported`;
 * Runtime prepare is currently the first unsupported boundary; no later assertion is claimed executed.
 */
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import { createHash } from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {canonicalJson,type JsonValue} from '../../src/contracts/fingerprint.js';
import type {RunRef} from '../../src/contracts/dispatch.js';
import {EXECUTION_ENTRY_RECORD_SCHEMAS} from '../../src/core/work-graph/persistence/execution-entry-codecs.js';
import {MODEL_REQUEST_RECORD_SCHEMAS} from '../../src/core/work-graph/persistence/model-request-codecs.js';
import {createSqliteRawArtifactStore} from '../../src/core/record-store/sqlite-body-store.js';
import {createSessionDirectory} from '../../src/core/work-graph/sessions/session-directory.js';
import {createPlanService} from '../../src/core/work-graph/tasks/plan-service.js';
import {roleSpecContentDigest,type RoleSpecContentV1} from '../../src/contracts/role-spec.js';
import {coordinationPolicyContentDigest,type CoordinationPolicyContentV1} from '../../src/contracts/human-role-collaboration.js';
import {createRoleConfigurationService} from '../../src/core/work-graph/configuration/role-memory-service.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { ModelClientPort, ModelEvent, ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { AuthorizeConfiguration } from '../../src/core/work-graph/tasks/execution-entry-contracts.js';
import type { ExecutionEntryPort } from '../../src/core/work-graph/tasks/execution-entry-contracts.js';
import type { ModelRequestPort } from '../../src/core/work-graph/tasks/model-call-contracts.js';
import type { RoleBindingFactsPort } from '../../src/core/work-graph/configuration/contracts.js';
import type { RuntimeExecutionDependencies, RuntimeHostBindings } from '../../src/core/agent-runtime/execution-contracts.js';
import type { AgentRuntimeService } from '../../src/core/agent-runtime/ports.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createExecutionHistoryService } from '../../src/core/work-graph/tasks/execution-history-service.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createModelCallService } from '../../src/core/work-graph/tasks/model-call-service.js';
import { createExecutionHistoryReader } from '../../src/core/agent-runtime/observation-recovery.js';
import { createGraphExecutionHistoryReader } from '../../src/core/agent-runtime/graph-execution-history.js';
import { createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createSourceAuthorityReader } from '../../src/core/work-graph/source-authority-reader.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createMaterialAccessResolver } from '../../src/core/work-graph/materials/applicability.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import { createTaskClaimFixture, type ClaimFixtureKind, type TaskClaimFixture } from './task-claim-fixture.js';

export const B2_AT = '2026-09-26T00:00:00.000Z';

export type ScriptedReply =
  | { kind: 'text'; text: string }
  | { kind: 'calls'; calls: ReadonlyArray<{ callId: string; name: string; args: Record<string, unknown> }> };

export type ScriptedModel = {
  client: ModelClientPort;
  requests: ModelRequest[];
  calls(): number;
  lastRequest(): ModelRequest | undefined;
};

/** Local scripted Kernel model. It never uses the network and counts every real
 * provider stream so a test can prove a rejected/observed path made zero calls. */
export function createScriptedModel(replies: readonly ScriptedReply[], beforeReply?: (request: ModelRequest, index: number, signal: AbortSignal) => Promise<void>): ScriptedModel {
  let round = 0;
  const requests: ModelRequest[] = [];
  const client: ModelClientPort = {
    async *stream(request, options) {
      options.signal.throwIfAborted();
      const index = round++;
      const snapshot = structuredClone(request);
      requests.push(snapshot);
      await beforeReply?.(snapshot,index,options.signal);
      const reply = replies[index];
      if (!reply) throw new Error(`B2 scripted model ran out of replies at round ${index}`);
      const base = { schemaVersion: 1 as const, requestId: request.requestId };
      let sequence = 0;
      if (reply.kind === 'text') {
        yield { ...base, sequence: ++sequence, type: 'text_delta', delta: reply.text };
        yield { ...base, sequence: ++sequence, type: 'completed', reason: 'final_answer' };
        return;
      }
      for (const [ordinal, call] of reply.calls.entries()) {
        yield { ...base, sequence: ++sequence, type: 'tool_call_started', callId: call.callId, name: call.name, ordinal };
        yield { ...base, sequence: ++sequence, type: 'tool_arguments_delta', callId: call.callId, delta: JSON.stringify(call.args) };
      }
      yield { ...base, sequence: ++sequence, type: 'completed', reason: 'tool_calls' };
    },
  };
  return { client, requests, calls: () => requests.length, lastRequest: () => requests.at(-1) };
}

export type B2RuntimeFixtureOverrides = {
  host?: RuntimeHostBindings;
  entry?: ExecutionEntryPort;
  modelRequests?: ModelRequestPort;
  sourceAuthority?: RuntimeExecutionDependencies['sourceAuthority'];
  kernelStores?: RuntimeExecutionDependencies['kernelStores'];
  workspaceHost?: RuntimeExecutionDependencies['workspaceHost'];
  sourcePolicyFor?: RuntimeExecutionDependencies['sourcePolicyFor'];
};

export type B2RuntimeFixture = {
  claimFixture: TaskClaimFixture;
  claim: TaskClaim;
  deps: RuntimeExecutionDependencies;
  runtime: AgentRuntimeService;
  host: RuntimeHostBindings;
  entry: ExecutionEntryPort;
  modelRequests: ModelRequestPort;
  scripted: ScriptedModel;
  ctx: CoreCallContext;
  scope: TaskClaimFixture['scope'];
  directory: string;
  allowRun(ref: RunRef): void;
  setNow(at:string):void;
  reopen(): Promise<void>;
  rebuild(overrides?: B2RuntimeFixtureOverrides): AgentRuntimeService;
  close(): Promise<void>;
};

/**
 * A documented trusted-Host test double. It mirrors the real projection shape
 * WorkGraph expects: it returns the declared grant for the exact bound Run and
 * rejects an unknown Run/role instead of short-circuiting true. The composition
 * root must replace it with the real Runtime Host projection.
 */
const refKey = (ref:object) => canonicalJson(ref as unknown as JsonValue);
export function createRuntimeHostDouble(input: {
  runRefs: Set<string>; scripted: ScriptedModel; root: string; skillRoot: string;
  scope: {projectId:string;workspaceId:string}; role:import('../../src/contracts/core/identity.js').RoleConfigurationRef; tools?:string[];writeScope?:string[];
}): RuntimeHostBindings {
  return {
    async resolveConfiguration(ctx, request) {
      if (ctx.projectId!==input.scope.projectId || ctx.workspaceId!==input.scope.workspaceId || !input.runRefs.has(refKey(request.runRef)))
        return {status:'rejected',code:'forbidden',reason:'Host is not bound to this complete Run/scope'};
      if(refKey(request.role)!==refKey(input.role))return {status:'rejected',code:'forbidden',reason:'Host exact Role pin mismatch'};
      if(request.roleResolution.status==='inadmissible') return {status:'rejected',code:'forbidden',reason:'Host refuses current Role'};
      if(request.role.kind==='legacy_template' && (request.role.templateId!=='builder'||request.role.templateRevision!=='1'))
        return {status:'rejected',code:'forbidden',reason:'Unknown exact legacy template'};
      return {status:'ready',value:{
        configurationRevision:'b2-host-config@1',
        model:{configuration:{revision:'b2-host-config@1',provider:'deepseek',model:'b2-local-scripted',baseUrl:'http://127.0.0.1'},client:input.scripted.client,
          inputCounter:{count:()=>({tokens:256,method:'model_tokenizer' as const,tokenizer:'b2-fixture-counter'})}},
        budget:{contextWindowTokens:200000,inputTokens:null,outputTokens:null,maxRequests:12,maxToolCalls:16,timeoutMs:30000,perResponseTokens:512},
        tools:[...(input.tools??['read'])],writeScope:[...(input.writeScope??[])],
        skills:{resourceRoot:input.skillRoot,enabledIds:['b2-trusted-skill']},systemInstruction:'B2 trusted static role guidance',
        hostTemplate:request.role.kind==='legacy_template'?{templateId:'builder',revision:'1',digest:digestOf('B2 trusted static role guidance')}:null,
        deniedPrefixes:[],processSandboxOptions:{},materialBasis:null,
      }};
    },

  };
}

export async function createB2RuntimeFixture(options: {
  kind?: ClaimFixtureKind;
  scriptedReplies?: readonly ScriptedReply[];
  taskBudget?:import('../../src/contracts/dispatch.js').TaskBudgetV1;
  host?: RuntimeHostBindings;
  beforeReply?: (request: ModelRequest,index:number,signal:AbortSignal)=>Promise<void>;
} = {}): Promise<B2RuntimeFixture> {
  const kind = options.kind ?? 'memory';
  const schemas=[EXECUTION_ENTRY_RECORD_SCHEMAS,MODEL_REQUEST_RECORD_SCHEMAS];
  const claimFixture = await createTaskClaimFixture(kind,{records:schemas.flatMap(s=>s.records),events:schemas.flatMap(s=>s.events),lookups:schemas.flatMap(s=>s.lookups??[])});
  const skillRoot=join(claimFixture.directory,'skills');
  await mkdir(join(skillRoot,'b2-trusted-skill'),{recursive:true});
  await writeFile(join(skillRoot,'b2-trusted-skill','skill.json'),JSON.stringify({schemaVersion:1,id:'b2-trusted-skill',title:'B2 trusted skill',kind:'instruction',priority:10,contentFile:'content.md'}));
  await writeFile(join(skillRoot,'b2-trusted-skill','content.md'),'B2_SKILL_FROM_REAL_FILE');
  await writeFile(join(claimFixture.directory,'b2-read.txt'),'B2_REAL_TOOL_CONTENT');
  // Install/activate a real exact RoleSpec and matrix, then bind the existing Session.
  // This seeds governance only; it never seeds Run entered or terminal facts.
  const f=claimFixture;const actor=f.ctx.principal.kind==='host'?f.ctx.principal.actor:{kind:'system' as const,id:'unreachable'};
  const content:RoleSpecContentV1={schemaVersion:1,label:'B2 builder',purpose:'B2_ROLE_EXACT_PIN',responsibility:['execution'],requiredMaterials:[{kind:'contract',reason:'Read the assigned Plan/Task'}],optionalMaterials:[],permissions:{tools:['read'],writeScope:'none'},budget:{source:'task-budget',scope:'assigned-task'},requiredOutputs:[{kind:'implementation-result',reason:'Report actual results'}],exit:{success:'Report result',stop:'Stop on missing permission',handoff:'Keep references'}};
  const installed=await f.roleService.installRoleSpec(f.ctx,{commandId:'b2-install-role',commandType:'InstallRoleSpecRevision',schemaVersion:1,correlationId:'b2-role',submittedAt:B2_AT,identity:{projectId:f.scope.projectId,actor,idempotencyKey:'b2-install-role'},payload:{roleId:'builder',revision:1,content,contentDigest:roleSpecContentDigest(content,'builder',1)}});
  if(installed.status!=='committed')throw Error(`B2 Role install: ${JSON.stringify(installed)}`);
  const pin={ref:installed.revisionRef,digest:installed.contentDigest};
  const activated=await f.roleService.activateRoleSpec(f.ctx,{commandId:'b2-activate-role',commandType:'ActivateRoleSpecRevision',schemaVersion:1,correlationId:'b2-role',submittedAt:B2_AT,identity:{projectId:f.scope.projectId,actor,idempotencyKey:'b2-activate-role'},aggregateId:'builder',expectedRevision:1,payload:{target:pin}});
  if(activated.status!=='committed')throw Error(`B2 Role activation: ${JSON.stringify(activated)}`);
  const projectId=f.scope.projectId;const policyId='b2-runtime-policy';
  const policy:CoordinationPolicyContentV1={schemaVersion:1,budget:{maxAutonomousReworks:0,maxClarifications:0},allowed:{inScopeRework:false,inScopeTesting:true},scope:{changesRequireHumanDecision:['requirement','acceptance','baseline']},upgrade:{path:'manual-decision',note:'Host decides'},roles:{catalog:{builder:pin},coordinator:{roleId:'builder',note:'Coordinate'}}};
  const policyRef={aggregateType:'CoordinationPolicyRevision',projectId,policyId,revision:1};
  const snapshots=[{ref:policyRef,revision:1,schemaVersion:1,policyId,contentRevision:1,content:policy,contentDigest:coordinationPolicyContentDigest(policy,policyId,1),installedAt:B2_AT},{ref:{aggregateType:'ProjectCoordinationPolicyActive',projectId},revision:1,projectId,activeRevision:policyRef}];
  const matrix=await f.commitRaw(snapshots.map(snapshot=>({refKey:refKey(snapshot.ref),schemaId:`${snapshot.ref.aggregateType}Snapshot@1`,revision:snapshot.revision,json:JSON.stringify(snapshot)})));
  if(matrix.status!=='committed')throw Error(`B2 matrix seed: ${JSON.stringify(matrix)}`);
  await f.overwriteSession(f.sessions.first,record=>({...record,role:{kind:'role_spec',pin}}));
  const request = await claimFixture.buildRequest(options.taskBudget?{input:{budget:options.taskBudget}}:{});
  const claimed = await claimFixture.service.claimTask(claimFixture.ctx, request);
  if (claimed.status !== 'committed') throw new Error(`B2 fixture claim failed: ${JSON.stringify(claimed)}`);
  const claim = claimed.value;

  let clock=B2_AT;
  const now = () => clock;
  let seq = 0;
  const newId = () => `b2-runtime-id-${++seq}`;
  const eventId = () => `b2-runtime-event-${++seq}`;

  let records=claimFixture.records;
  let bodies=kind==='sqlite'?createSqliteRawArtifactStore(join(claimFixture.directory,'artifacts.sqlite')):new RawArtifactBodyStore();
  const scripted=createScriptedModel(options.scriptedReplies??[{kind:'text',text:'B2 scripted answer'}],options.beforeReply);
  const allowedRuns=new Set([refKey(claim.runRef)]);
  const card=await claimFixture.sessionsPort.readSession(claimFixture.ctx,claim.sessionRef);
  if(card.status!=='ready')throw Error('B2 mapped Session unavailable');
  const host=options.host??createRuntimeHostDouble({runRefs:allowedRuns,scripted,root:claimFixture.directory,skillRoot,scope:claimFixture.scope,role:card.value.record.role});
  const kernelStores=await createKernelStoreRegistry({entries:[{adapterId:'r4c-claim-kernel',storeKey:'r4c-claim-kernel-store',workspace:claimFixture.scope,databasePath:join(claimFixture.directory,'kernel.sqlite')}]});
  let entry!:ExecutionEntryPort;let modelRequests!:ModelRequestPort;
  function buildDeps(overrides:B2RuntimeFixtureOverrides={}):RuntimeExecutionDependencies {
    const executions=createRunStateReader({records});
    const roles=createRoleConfigurationService({records,now,eventId});
    const reads=createMaterialRecordReaders(records);
    const materials=createMaterialService({bodies,authority:reads.authority,grants:createMaterialAccessResolver(reads.authority,reads.index),now});
    const plans=createPlanService({records,materials,now,eventId});
    const sessions=createSessionDirectory({records,lookups:records});
    const selectedKernelStores=overrides.kernelStores??kernelStores;
    const sessionOperations=createSessionOperations({sessions,kernelStores:selectedKernelStores});
    const activity=createExecutionHistoryReader({history:sessionOperations});
    const activeHost=overrides.host??host;
    const authorizeConfiguration:AuthorizeConfiguration=async(ctx,input)=>{
      const role=await roles.resolveRoleBinding(ctx,{roleBinding:input.run.roleBinding,declaredPermissions:input.permissions});
      if(role.status!=='ready')return role;
      const configured=await activeHost.resolveConfiguration(ctx,{runRef:input.run.ref,role:input.sessionRole,roleResolution:role.value});
      if(configured.status!=='ready')return configured;
      const value=configured.value;
      const template=input.sessionRole.kind==='legacy_template'?{templateId:'builder',revision:'1',digest:digestOf('B2 trusted static role guidance')}:null;
      // The accepted Run is the grant being exercised. Current Host grants may
      // be wider, but every accepted capability must still fit both current
      // Host and Role ceilings; resolving the Role above validates its pins.
      const permissions=input.run.envelope?.permissions??input.permissions;
      const ceiling=role.value.status==='resolved'?role.value.spec.permissions:null;
      if(value.configurationRevision!==input.configurationRevision
        || refKey(permissions)!==refKey(input.permissions)
        || permissions.policyRevision!==input.run.roleBinding.policyRevision
        || !permissions.tools.every(tool=>value.tools.includes(tool)&&(!ceiling||ceiling.tools.includes(tool)))
        || !permissions.writeScope.every(path=>value.writeScope.includes(path))
        || (ceiling?.writeScope==='none'&&permissions.writeScope.length!==0)
        || refKey({template})!==refKey({template:input.hostTemplate}))
        return {status:'rejected',code:'forbidden',reason:'Persisted configuration differs from real current Host grant'};
      return {status:'ready',value:{configurationRevision:value.configurationRevision,permissions:structuredClone(permissions),hostTemplate:template}};
    };
    const common={records,reads:executions,roles,plans,materials,bodies,authorizeConfiguration,now,eventId,newId};
    entry=createExecutionEntryService(common);modelRequests=createModelCallService(common);
    return {claims:claimFixture.makeService(records),executions,entry:overrides.entry??entry,modelRequests:overrides.modelRequests??modelRequests,
      roles,plans,sessions,materials,bodies,historyWriter:createExecutionHistoryService({records,now,eventId}),activity,graphHistory:createGraphExecutionHistoryReader({executions,history:activity}),sessionOperations,kernelStores:selectedKernelStores,
      workspaceHost:overrides.workspaceHost??{
        async resolveRoot(scope){return scope.projectId===claimFixture.scope.projectId&&scope.workspaceId===claimFixture.scope.workspaceId?{status:'ready',value:{root:claimFixture.directory,workspaceRevision:1}}:{status:'rejected',code:'forbidden',reason:'Unknown scope'};},
        async authorize(ctx,scope){
          if(ctx.projectId!==claimFixture.scope.projectId||ctx.workspaceId!==claimFixture.scope.workspaceId||scope.projectId!==ctx.projectId||scope.workspaceId!==ctx.workspaceId)
            return {status:'rejected',code:'forbidden',reason:'Host workspace scope mismatch'};
          return {status:'ready',value:{subjectKey:refKey(ctx.principal),permissionRevision:'b2-workspace-read@1',allowsRead:path=>path==='b2-read.txt'}};
        },
      },
      sourceAuthority:overrides.sourceAuthority??(()=>createSourceAuthorityReader({authority:reads.authority})),
      ...(overrides.sourcePolicyFor?{sourcePolicyFor:overrides.sourcePolicyFor}:{}),host:activeHost,kernel,now,newId};
  }
  const deps = buildDeps();
  let secondary:Awaited<ReturnType<TaskClaimFixture['reopenService']>>|undefined;
  const fixture:B2RuntimeFixture={
    claimFixture,claim,deps,runtime:createAgentRuntime(deps),host,entry,modelRequests,scripted,ctx:claimFixture.ctx,scope:claimFixture.scope,directory:claimFixture.directory,
    allowRun:ref=>{allowedRuns.add(refKey(ref));},setNow:at=>{clock=at;},
    rebuild:overrides=>createAgentRuntime(buildDeps(overrides)),
    async reopen(){
      if(kind!=='sqlite')throw Error('SQLite reopen only');
      await claimFixture.closeBackend();if('close' in bodies)await bodies.close();
      secondary=await claimFixture.reopenService();records=secondary.records;
      bodies=createSqliteRawArtifactStore(join(claimFixture.directory,'artifacts.sqlite'));
      fixture.deps=buildDeps();fixture.entry=entry;fixture.modelRequests=modelRequests;fixture.runtime=createAgentRuntime(fixture.deps);
    },
    async close(){await secondary?.close();if('close' in bodies)await bodies.close();await claimFixture.close();},
  };
  return fixture;
}

/** Deterministic digest helper for Prepared tamper tests. */
export function digestOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
