/**
 * B2 Runtime execution behavior contract.
 *
 * PHASE-1 SKELETON: the production `prepareExecution`/`startRun`/`observeRun`
 * (and the WorkGraph entry/model-call services they must consume) still return
 * explicit `unsupported`. The RED cases below describe the target contract.
 * Execution cases currently stop at the Runtime unsupported boundary; separate
 * budget cases reach the unsupported limit mapping or the missing reservation
 * guard. Later assertions are not claimed exercised. No test fabricates a
 * Kernel identity, a provider call or a terminal.
 *
 * The GREEN cases assert only the skeleton's fail-closed guarantee: an
 * unsupported path is explicit and makes zero provider calls.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import * as sourceAccess from '../../src/core/agent-runtime/source-capture-access.js';
import { BudgetExceeded } from '../../src/core/agent-runtime/model-budget.js';
import type { ModelClientPort, ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { PreparedTaskExecution } from '../../src/contracts/core/prepared-execution.js';
import { DEFAULT_RUNTIME_BUDGET, ModelBudget } from '../../src/core/agent-runtime/model-budget.js';
import { kernelRunLimits } from '../../src/core/agent-runtime/run-limits.js';
import type { ExecutionEntryPort } from '../../src/core/work-graph/tasks/execution-entry-contracts.js';
import { createB2RuntimeFixture, type B2RuntimeFixture } from '../helpers/B2-runtime-fixture.js';

const fixtures: B2RuntimeFixture[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(fixture => fixture.close()));
  vi.restoreAllMocks();
});

async function makeFixture(options?: Parameters<typeof createB2RuntimeFixture>[0]): Promise<B2RuntimeFixture> {
  const fixture = await createB2RuntimeFixture(options);
  fixtures.push(fixture);
  return fixture;
}

function rejectionOf(result: unknown): string {
  const value = result as { status?: string; code?: string };
  return `${value.status}/${value.code}`;
}

describe('B2 Runtime skeleton fail-closed boundary', () => {
  it('keeps the no-argument factory explicit-unsupported and never starts a provider', async () => {
    const { createAgentRuntime } = await import('../../src/core/agent-runtime/runtime.js');
    const runtime = createAgentRuntime();
    const ctx = { projectId: 'p', workspaceId: 'w',
      principal: { kind: 'host' as const, actor: { kind: 'human' as const, id: 'b2-reviewer' } },
      materialReader: { kind: 'host' as const, projectId: 'p', workspaceId: 'w', actor: { kind: 'human' as const, id: 'b2-reviewer' } },
      signal: new AbortController().signal };
    const runRef = { aggregateType: 'Run' as const, projectId: 'p', goalId: 'g', runId: 'r' };
    for (const result of [
      await runtime.port.prepareExecution(ctx, { runRef, requestId: 'x' }),
      await runtime.port.startRun(ctx, { prepared: {} as PreparedTaskExecution, consumerId: 'c', requestId: 'x' }),
      await runtime.port.observeRun(ctx, { runRef }),
    ]) {
      expect(rejectionOf(result)).toBe('rejected/unsupported');
    }
  });


});

describe('B2 Runtime execution target contract (RED until implementation)', () => {
  it('prepares from the real WG11 Claim and sends the trusted Role/Skill/Task spec into the request', async () => {
    const fx = await makeFixture({ scriptedReplies: [{ kind: 'text', text: 'done' }] });
    const prepared = await fx.runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 'prep-ok' });
    expect(rejectionOf(prepared)).toBe('ready/undefined');
    if (prepared.status !== 'ready') return;
    // The prepared value carries only verifiable references: fixed Run/Claim,
    // envelope.bundleRef and the input binding digest.
    expect(prepared.value.claim).toEqual(fx.claim);
    expect(prepared.value.envelope.bundleRef.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(prepared.value.inputBinding.inputDigest).toMatch(/^[0-9a-f]{64}$/);

    const started = await fx.runtime.port.startRun(fx.ctx, {
      prepared: prepared.value, consumerId: 'b2-driver-1', requestId: 'start-ok',
    });
    expect(rejectionOf(started)).toBe('ready/undefined');
    const request = fx.scripted.lastRequest();
    expect(request).toBeDefined();
    expect(request!.systemPrompt).toContain('B2 trusted static role guidance');
    expect(request!.systemPrompt).toContain('B2_SKILL_FROM_REAL_FILE');
    expect(JSON.stringify(request!.messages)).toContain('Implement A');
    expect(JSON.stringify(request)).toContain('B2_ROLE_EXACT_PIN');
    expect(fx.scripted.calls()).toBe(1);
    expect(request!.tools.map(tool => tool.name)).toContain('read');
    expect(request!.messages.some(message => message.role === 'user')).toBe(true);
  });

  it('rejects a tampered Prepared value instead of granting a Kernel call', async () => {
    const fx = await makeFixture();
    const prepared = await fx.runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 'prep-tamper' });
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') return;
    const tampered = structuredClone(prepared.value);
    tampered.envelope.bundleRef = { ...tampered.envelope.bundleRef, digest: 'f'.repeat(64) };
    const started = await fx.runtime.port.startRun(fx.ctx, {
      prepared: tampered, consumerId: 'b2-driver-tamper', requestId: 'start-tamper',
    });
    expect(rejectionOf(started)).toBe('rejected/invalid');
    expect(fx.scripted.calls()).toBe(0);
  });

  it('rechecks a revoked Host grant after valid preparation and makes zero provider calls', async()=>{
    const fx=await makeFixture();
    const prepared=await fx.runtime.port.prepareExecution(fx.ctx,{runRef:fx.claim.runRef,requestId:'prepare-before-revoke'});
    expect(prepared.status).toBe('ready');if(prepared.status!=='ready')return;
    const revoked=fx.rebuild({host:{...fx.host,async resolveConfiguration(){return {status:'rejected',code:'forbidden',reason:'Host revoked this grant'};}}});
    expect(await revoked.port.startRun(fx.ctx,{prepared:prepared.value,consumerId:'revoked-consumer',requestId:'revoked-start'})).toMatchObject({status:'rejected',code:'forbidden'});
    expect(fx.scripted.calls()).toBe(0);
  });

  it('allows exactly one fresh begin when two drivers race on the same Run', async () => {
    const fx = await makeFixture();
    const prepared = await fx.runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 'prep-race' });
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') return;
    const [first, second] = await Promise.all([
      fx.runtime.port.startRun(fx.ctx, { prepared: prepared.value, consumerId: 'b2-driver-a', requestId: 'start-race' }),
      fx.runtime.port.startRun(fx.ctx, { prepared: prepared.value, consumerId: 'b2-driver-b', requestId: 'start-race' }),
    ]);
    const ready = [first, second].filter(result => result.status === 'ready');
    const rejected = [first, second].filter(result => result.status === 'rejected');
    expect(ready).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(fx.scripted.calls()).toBe(1);
  });

  it('keeps provider and source open at zero when the awaited entered write fails', async () => {
    const fx = await makeFixture();
    let sourceOpens=0;
    const originalFactory=sourceAccess.createRuntimeSourceCaptureFactory;
    vi.spyOn(sourceAccess,'createRuntimeSourceCaptureFactory').mockImplementation((...args)=>{const factory=originalFactory(...args);return(...openArgs)=>{sourceOpens++;return factory(...openArgs);};});
    let enteredCalls=0;
    const failingEntry: ExecutionEntryPort = {
      authorizeRuntimeEntry: fx.entry.authorizeRuntimeEntry,
      beginRuntimeEntry: fx.entry.beginRuntimeEntry,
      async recordExecutionEntered(_ctx,request) {
        enteredCalls++;
        const source=request.input.kernelSource;
        const page=await fx.deps.kernelStores.withStore(source.adapterId,store=>store.read(source.kernelSessionId,0,200,{signal:fx.ctx.signal}));
        expect(page.records.some(record=>record.recordType==='turn.started')).toBe(true);
        expect(JSON.stringify(page.records)).toContain('run.started');
        expect(page.records.some(record=>record.position===source.position)).toBe(true);
        return { status: 'rejected', code: 'unavailable', reason: 'B2 entered write failed' };
      },
      recordRunResult: fx.entry.recordRunResult,
    };
    const runtime = fx.rebuild({ entry: failingEntry });
    const prepared = await runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 'prep-entered' });
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') return;
    const started = await runtime.port.startRun(fx.ctx, {
      prepared: prepared.value, consumerId: 'b2-driver-entered', requestId: 'start-entered',
    });
    expect(rejectionOf(started)).toBe('rejected/unavailable');
    expect(fx.scripted.calls()).toBe(0);
    expect(enteredCalls).toBe(1);
    expect(sourceOpens).toBe(0);
  });

  it('replays the same start request without a second provider call', async () => {
    const fx = await makeFixture({ scriptedReplies: [{ kind: 'text', text: 'first' }, { kind: 'text', text: 'second' }] });
    const prepared = await fx.runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 'prep-permit' });
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') return;
    const started = await fx.runtime.port.startRun(fx.ctx, {
      prepared: prepared.value, consumerId: 'b2-driver-permit', requestId: 'start-permit',
    });
    expect(rejectionOf(started)).toBe('ready/undefined');
    const calls = fx.scripted.calls();
    const replay = await fx.runtime.port.startRun(fx.ctx, {
      prepared: prepared.value, consumerId: 'b2-driver-permit', requestId: 'start-permit',
    });
    expect(rejectionOf(replay)).toBe('ready/undefined');
    expect(fx.scripted.calls()).toBe(calls);
  });

  it('drives a real terminal to the Run/Attempt/outbox/Lease/Session reduction with the Task still incomplete', async () => {
    const fx = await makeFixture({ scriptedReplies: [{ kind: 'text', text: 'terminal' }] });
    const prepared = await fx.runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 'prep-terminal' });
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') return;
    await fx.runtime.port.startRun(fx.ctx, { prepared: prepared.value, consumerId: 'b2-driver-terminal', requestId: 'start-terminal' });
    const record = await fx.deps.executions.readExecution(fx.ctx, fx.claim.runRef);
    expect(record.status).toBe('ready');
    if (record.status !== 'ready') return;
    expect(record.value.run.status).toBe('ended');
    expect(record.value.attempt.status).toBe('ended');
    expect(record.value.lease?.release).toBeDefined();
    expect(record.value.session.occupancy).toBeNull();
    // Run completion is not Task satisfaction.
    expect(record.value.outbox.status).toBe('settled');
    expect(record.value.run.executionHistory?.endPosition).not.toBeNull();
    const graph=await fx.claimFixture.plans.queryTaskGraph(fx.ctx,{goalRef:fx.claimFixture.goalRef});
    expect(graph.status).toBe('ready');if(graph.status==='ready')expect(graph.value.tasks.find(task=>task.ref.taskId===fx.claim.task.taskId)?.effectivePhase).not.toBe('satisfied');
  });

  it('does not infer completion from a claimed Run with no Kernel entry or terminal', async () => {
    const fx = await makeFixture();
    const observed = await fx.runtime.port.observeRun(fx.ctx, { runRef: fx.claim.runRef });
    expect(rejectionOf(observed)).toBe('ready/undefined');
    if (observed.status !== 'ready') return;
    expect(observed.value.run.status).toBe('starting');
    expect(observed.value.session.occupancy).not.toBeNull();
  });

  it('does not rerun the model when a reopened database is observed', async () => {
    const fx = await makeFixture({ kind: 'sqlite', scriptedReplies: [{ kind: 'text', text: 'once' }] });
    const prepared = await fx.runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 'prep-reopen' });
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') return;
    await fx.runtime.port.startRun(fx.ctx, { prepared: prepared.value, consumerId: 'b2-driver-reopen', requestId: 'start-reopen' });
    const calls = fx.scripted.calls();
    await fx.reopen();
    const observed = await fx.runtime.port.observeRun(fx.ctx, { runRef: fx.claim.runRef });
    expect(observed).toMatchObject({status:'ready',value:{run:{status:'ended'}}});
    expect(fx.scripted.calls()).toBe(calls);
  });

  it('continues the same Session for a second Task using the real completed history boundary', async () => {
    const fx = await makeFixture({ scriptedReplies: [{ kind: 'text', text: 'first task' }, { kind: 'text', text: 'second task' }] });
    const first = await fx.runtime.port.prepareExecution(fx.ctx, { runRef: fx.claim.runRef, requestId: 'prep-first' });
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') return;
    await fx.runtime.port.startRun(fx.ctx, { prepared: first.value, consumerId: 'b2-driver-first', requestId: 'start-first' });

    const secondRequest = await fx.claimFixture.buildRequest({
      input: { taskId: fx.claimFixture.tasks.second.taskId, sessionRef: fx.claimFixture.sessions.first },
      requestId: 'b2-second-claim',
    });
    const secondClaim = await fx.claimFixture.service.claimTask(fx.ctx, secondRequest);
    expect(secondClaim.status).toBe('committed');
    if (secondClaim.status !== 'committed') return;
    fx.allowRun(secondClaim.value.runRef);
    const second = await fx.runtime.port.prepareExecution(fx.ctx, { runRef: secondClaim.value.runRef, requestId: 'prep-second' });
    expect(second.status).toBe('ready');
    if (second.status !== 'ready') return;
    await fx.runtime.port.startRun(fx.ctx, { prepared: second.value, consumerId: 'b2-driver-second', requestId: 'start-second' });
    const request = fx.scripted.lastRequest();
    expect(request!.messages.some(message => message.role === 'assistant')).toBe(true);
    expect(request!.messages.filter(message => message.role === 'user')).toHaveLength(2);
  });
});


describe('B2 persistent task budget boundary', () => {
  it('maps the persistent Run budget into the Kernel limits without inventing a default (RED while explicit unsupported)', () => {
    const mapped = kernelRunLimits(
      { ...DEFAULT_RUNTIME_BUDGET, timeoutMs: 60_000 },
      { tokenBudget: 1_234, deadline: '2026-09-26T00:01:00.000Z' },
      () => '2026-09-26T00:00:30.000Z',
    );
    expect(mapped.maxTotalTokens).toBe(1_234);
    expect(mapped.deadlineMs).toBe(30_000);
    // Absent task budget and absent relative timeout both stay null.
    const absent = kernelRunLimits({ ...DEFAULT_RUNTIME_BUDGET, timeoutMs: null });
    expect(absent.maxTotalTokens).toBeNull();
    expect(absent.deadlineMs).toBeNull();
  });

  it('refuses the first model request whose reserve alone exceeds the persistent task budget (RED until implementation)', async () => {
    const budget = { ...DEFAULT_RUNTIME_BUDGET, contextWindowTokens: 200_000, perResponseTokens: 512 };
    const meter = new ModelBudget(budget, async () => {}, {
      count: () => ({ tokens: 50_000, method: 'model_tokenizer', tokenizer: 'b2-task-budget-counter' }),
    }, { tokenBudget: 1_000, deadline: null });
    let providerCalls = 0;
    const client: ModelClientPort = {
      async *stream() {
        providerCalls += 1;
        yield { schemaVersion: 1 as const, requestId: 'r', sequence: 1, type: 'completed' as const, reason: 'final_answer' as const };
      },
    };
    const wrapped = meter.wrap(client);
    let failure:unknown;
    try {
      for await (const _event of wrapped.stream({schemaVersion:1,runId:'budget-run',systemPrompt:'budget test',messages:[{role:'user',messageId:'budget-input',content:'test'}],tools:[],requestId:'r',maxOutputTokens:128}, { signal: new AbortController().signal })) { /* drain */ }
    } catch(error) { failure=error; }
    // The Kernel maxTotalTokens guard runs only AFTER usage returns; the B2
    // requirement is that the reserve is refused before the provider is called.
    expect(failure).toBeInstanceOf(BudgetExceeded);
    expect(providerCalls).toBe(0);
  });
});


it('uses a genuine Kernel pause record and keeps the Session and lease occupied',async()=>{
  const fx=await makeFixture();
  const runtime=createAgentRuntime({...fx.deps,kernel:{...fx.deps.kernel,runCodingAgent:options=>fx.deps.kernel.runCodingAgent({...options,
    controlHooks:[...(options.controlHooks??[]),{hookId:'b2-test-pause',point:'before_model',priority:10000,async execute(){return {point:'before_model',kind:'pause',reason:'B2 observation test'};}}],
  })}});
  const prepared=await runtime.port.prepareExecution(fx.ctx,{runRef:fx.claim.runRef,requestId:'pause-prepare'});
  expect(prepared.status).toBe('ready');if(prepared.status!=='ready')return;
  await runtime.port.startRun(fx.ctx,{prepared:prepared.value,consumerId:'pause-consumer',requestId:'pause-start'});
  const observed=await runtime.port.observeRun(fx.ctx,{runRef:fx.claim.runRef});
  expect(observed.status).toBe('ready');if(observed.status!=='ready')return;
  expect(observed.value.session.occupancy).toMatchObject({kind:'execution',executionRef:fx.claim.runRef});
  expect(observed.value.lease?.release).toBeUndefined();
  expect(observed.value.run.executionHistory?.endPosition).toBeNull();
  expect(fx.scripted.calls()).toBe(0);
  const card=await fx.deps.sessions.readSession(fx.ctx,fx.claim.sessionRef);
  expect(card.status).toBe('ready');if(card.status!=='ready')return;
  const raw=await fx.deps.kernelStores.withStore(card.value.record.kernel.adapterId,store=>store.read(card.value.record.kernel.kernelSessionId,0,200,{signal:fx.ctx.signal}));
  expect(JSON.stringify(raw.records)).toContain('run.paused');
});

it('each final provider request has a fresh issued and consumed durable permit',async()=>{
  const fx=await makeFixture({scriptedReplies:[{kind:'calls',calls:[{callId:'b2-read',name:'read',args:{path:'b2-read.txt'}}]},{kind:'text',text:'done after tool'}]});
  let issued=0;let consumed=0;const digests:string[]=[];const permits:string[]=[];
  const runtime=fx.rebuild({modelRequests:{
    async authorizeModelRequest(ctx,request){issued++;digests.push(request.input.requestDigest);return fx.modelRequests.authorizeModelRequest(ctx,request);},
    async recordModelRequestAttempt(ctx,request){consumed++;permits.push(JSON.stringify(request.input.permitRef));return fx.modelRequests.recordModelRequestAttempt(ctx,request);},
  }});
  const prepared=await runtime.port.prepareExecution(fx.ctx,{runRef:fx.claim.runRef,requestId:'two-calls-prepare'});
  expect(prepared.status).toBe('ready');if(prepared.status!=='ready')return;
  expect(await runtime.port.startRun(fx.ctx,{prepared:prepared.value,consumerId:'two-calls-consumer',requestId:'two-calls-start'})).toMatchObject({status:'ready'});
  expect(fx.scripted.calls()).toBe(2);expect(issued).toBe(2);expect(consumed).toBe(2);
  expect(new Set(digests).size).toBe(2);expect(new Set(permits).size).toBe(2);
  expect(fx.scripted.requests[1]!.messages.some(message=>message.role==='tool'&&message.callId==='b2-read')).toBe(true);
});

it('unknown usage keeps its reservation and rejects the next request before a second provider call',async()=>{
  const meter=new ModelBudget({...DEFAULT_RUNTIME_BUDGET,contextWindowTokens:200000,perResponseTokens:128},async()=>{},
    {count:()=>({tokens:400,method:'model_tokenizer',tokenizer:'b2-fixed'})},{tokenBudget:800,deadline:null});
  let calls=0;
  const client:ModelClientPort={async *stream(request){calls++;yield {schemaVersion:1,requestId:request.requestId,sequence:1,type:'completed',reason:'final_answer'};}};
  const request=(id:string):ModelRequest=>({schemaVersion:1,runId:'budget-run',requestId:id,systemPrompt:'budget',messages:[{role:'user',messageId:id,content:'test'}],tools:[],maxOutputTokens:128});
  const drain=async(id:string)=>{for await(const _ of meter.wrap(client).stream(request(id),{signal:new AbortController().signal})){}};
  await drain('one');expect(meter.entries[0]?.status).toBe('unknown');
  await expect(drain('two')).rejects.toBeInstanceOf(BudgetExceeded);
  expect(calls).toBe(1);
});


it('observes a live genuine Turn incrementally and never releases before the provider completes',async()=>{
  let entered!:()=>void;const providerEntered=new Promise<void>(resolve=>{entered=resolve;});
  let release!:()=>void;const providerRelease=new Promise<void>(resolve=>{release=resolve;});
  const fx=await makeFixture({beforeReply:async()=>{entered();await providerRelease;}});
  const reads:{after:number;limit:number}[]=[];
  const original=fx.deps.kernelStores;
  const traced:typeof original={...original,async withStore(adapterId,use){return original.withStore(adapterId,async store=>{
    const read=store.read.bind(store);
    const proxy=new Proxy(store,{get(target,property){
      if(property==='read')return (...args:Parameters<typeof read>)=>{reads.push({after:args[1],limit:args[2]});return read(...args);};
      const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
    }});
    return use(proxy);
  });}};
  const runtime=fx.rebuild({kernelStores:traced});
  const prepared=await runtime.port.prepareExecution(fx.ctx,{runRef:fx.claim.runRef,requestId:'incremental-prepare'});
  expect(prepared.status).toBe('ready');if(prepared.status!=='ready')return;
  const running=runtime.port.startRun(fx.ctx,{prepared:prepared.value,consumerId:'incremental-consumer',requestId:'incremental-start'});
  try{
    const first=await Promise.race([providerEntered.then(()=>true),running.then(()=>false)]);
    expect(first).toBe(true);if(!first)return;
    const observed=await runtime.port.observeRun(fx.ctx,{runRef:fx.claim.runRef});
    expect(observed.status).toBe('ready');if(observed.status!=='ready')return;
    const locator=observed.value.run.executionHistory;
    expect(locator).toBeDefined();expect(locator?.endPosition).toBeNull();expect(observed.value.session.occupancy).not.toBeNull();
    const before=reads.length;
    expect(await runtime.port.observeRun(fx.ctx,{runRef:fx.claim.runRef})).toMatchObject({status:'ready'});
    // Header proof may read position one; data pages must resume from the already inspected watermark.
    expect(reads.slice(before).filter(read=>read.limit>1).every(read=>read.after>=locator!.observedThroughPosition)).toBe(true);
    expect(fx.scripted.calls()).toBe(1);
  }finally{release();await running;}
});

it('a failed terminal write leaves occupancy until a later genuine-history reconcile, without rerunning the model',async()=>{
  const fx=await makeFixture();let attempts=0;
  const runtime=fx.rebuild({entry:{...fx.entry,async recordRunResult(){attempts++;return {status:'rejected',code:'unavailable',reason:'injected terminal ledger failure'};}}});
  const prepared=await runtime.port.prepareExecution(fx.ctx,{runRef:fx.claim.runRef,requestId:'terminal-failure-prepare'});
  expect(prepared.status).toBe('ready');if(prepared.status!=='ready')return;
  await runtime.port.startRun(fx.ctx,{prepared:prepared.value,consumerId:'terminal-failure-consumer',requestId:'terminal-failure-start'});
  expect(attempts).toBeGreaterThan(0);expect(fx.scripted.calls()).toBe(1);
  const pending=await fx.deps.executions.readExecution(fx.ctx,fx.claim.runRef);
  expect(pending.status).toBe('ready');if(pending.status!=='ready')return;
  expect(pending.value.session.occupancy).not.toBeNull();expect(pending.value.lease?.release).toBeUndefined();
  const recovered=await fx.runtime.port.observeRun(fx.ctx,{runRef:fx.claim.runRef});
  expect(recovered).toMatchObject({status:'ready',value:{run:{status:'ended'},session:{occupancy:null}}});
  expect(fx.scripted.calls()).toBe(1);
});


it('rechecks the actual deadline after the awaited entered commit before issuing a provider request',async()=>{
  const fx=await makeFixture({taskBudget:{tokenBudget:100000,deadline:'2026-09-26T00:00:01.000Z'}});
  let entered=0;
  const runtime=fx.rebuild({entry:{...fx.entry,async recordExecutionEntered(ctx,request){
    const result=await fx.entry.recordExecutionEntered(ctx,request);
    if(result.status==='committed'){entered++;fx.setNow('2026-09-26T00:00:02.000Z');}
    return result;
  }}});
  const prepared=await runtime.port.prepareExecution(fx.ctx,{runRef:fx.claim.runRef,requestId:'deadline-prepare'});
  expect(prepared.status).toBe('ready');if(prepared.status!=='ready')return;
  await runtime.port.startRun(fx.ctx,{prepared:prepared.value,consumerId:'deadline-consumer',requestId:'deadline-start'});
  expect(entered).toBe(1);expect(fx.scripted.calls()).toBe(0);
});


it('a consumed-permit replay never reaches the provider even when the real consumption was committed',async()=>{
  const fx=await makeFixture();let consumed=0;
  const runtime=fx.rebuild({modelRequests:{...fx.modelRequests,async recordModelRequestAttempt(ctx,request){
    const result=await fx.modelRequests.recordModelRequestAttempt(ctx,request);
    if(result.status==='committed'){consumed++;return {...result,replayed:true};}
    return result;
  }}});
  const prepared=await runtime.port.prepareExecution(fx.ctx,{runRef:fx.claim.runRef,requestId:'permit-replay-prepare'});
  expect(prepared.status).toBe('ready');if(prepared.status!=='ready')return;
  await runtime.port.startRun(fx.ctx,{prepared:prepared.value,consumerId:'permit-replay-consumer',requestId:'permit-replay-start'});
  expect(consumed).toBe(1);expect(fx.scripted.calls()).toBe(0);
});

it('the actual builtin read checks the current Host path grant and never leaks forbidden bytes to the provider',async()=>{
  const secret='B2_FORBIDDEN_FILE_BYTES_NEVER_IN_MODEL_CONTEXT';
  const fx=await makeFixture({scriptedReplies:[
    {kind:'calls',calls:[{callId:'b2-forbidden-read',name:'read',args:{path:'forbidden.txt'}}]},
    {kind:'text',text:'The requested file was denied'},
  ]});
  await writeFile(join(fx.directory,'forbidden.txt'),secret);
  const checkedPaths:string[]=[];let authorizedAfterModelCall=false;
  const runtime=fx.rebuild({workspaceHost:{
    ...fx.deps.workspaceHost,
    async authorize(ctx,scope){
      const authorization=await fx.deps.workspaceHost.authorize(ctx,scope);
      // The authority check is asynchronous and must be awaited by before_tool.
      await Promise.resolve();
      if(fx.scripted.calls()>0)authorizedAfterModelCall=true;
      if(authorization.status!=='ready')return authorization;
      return {...authorization,value:{...authorization.value,allowsRead(path){
        checkedPaths.push(path);return authorization.value.allowsRead(path);
      }}};
    },
  }});
  const prepared=await runtime.port.prepareExecution(fx.ctx,{runRef:fx.claim.runRef,requestId:'forbidden-read-prepare'});
  expect(prepared.status).toBe('ready');if(prepared.status!=='ready')return;
  const started=await runtime.port.startRun(fx.ctx,{prepared:prepared.value,consumerId:'forbidden-read-consumer',requestId:'forbidden-read-start'});
  expect(started.status).toBe('ready');
  expect(fx.scripted.calls()).toBe(2);
  expect(authorizedAfterModelCall).toBe(true);expect(checkedPaths).toContain('forbidden.txt');
  const toolResult=fx.scripted.requests[1]!.messages.find(message=>message.role==='tool'&&message.callId==='b2-forbidden-read');
  expect(toolResult).toMatchObject({role:'tool',result:{status:'error'}});
  expect(JSON.stringify(fx.scripted.requests)).not.toContain(secret);
  expect(JSON.stringify(started)).not.toContain(secret);
});

it('projects a wider current Host grant through the real Role ceiling before entering the Run',async()=>{
  const fx=await makeFixture();
  const runtime=fx.rebuild({host:{async resolveConfiguration(ctx,input){
    const current=await fx.host.resolveConfiguration(ctx,input);
    return current.status==='ready'?{...current,value:{...current.value,tools:['read','write']}}:current;
  }}});
  const prepared=await runtime.port.prepareExecution(fx.ctx,{runRef:fx.claim.runRef,requestId:'wider-host-prepare'});
  expect(prepared.status).toBe('ready');if(prepared.status!=='ready')return;
  expect(prepared.value.envelope.permissions.tools).toEqual(['read']);
  expect(prepared.value.envelope.permissions.writeScope).toEqual([]);
  const started=await runtime.port.startRun(fx.ctx,{prepared:prepared.value,consumerId:'wider-host-consumer',requestId:'wider-host-start'});
  expect(started).toMatchObject({status:'ready',value:{run:{status:'ended'}}});
  expect(fx.scripted.calls()).toBe(1);
  expect(fx.scripted.requests[0]!.tools.map(tool=>tool.name)).not.toContain('write');
  const persisted=await fx.deps.executions.readExecution(fx.ctx,fx.claim.runRef);
  expect(persisted).toMatchObject({status:'ready',value:{run:{envelope:{permissions:{tools:['read'],writeScope:[]}}}}});
});

it('a start replay after Host revocation only reconciles already genuine terminal history',async()=>{
  const fx=await makeFixture();let terminalAttempts=0;
  const first=fx.rebuild({entry:{...fx.entry,async recordRunResult(){
    terminalAttempts++;return {status:'rejected',code:'unavailable',reason:'temporarily unavailable terminal ledger'};
  }}});
  const prepared=await first.port.prepareExecution(fx.ctx,{runRef:fx.claim.runRef,requestId:'revoke-replay-prepare'});
  expect(prepared.status).toBe('ready');if(prepared.status!=='ready')return;
  const request={prepared:prepared.value,consumerId:'revoke-replay-consumer',requestId:'revoke-replay-start'};
  await first.port.startRun(fx.ctx,request);
  expect(terminalAttempts).toBe(1);expect(fx.scripted.calls()).toBe(1);
  const pending=await fx.deps.executions.readExecution(fx.ctx,fx.claim.runRef);
  expect(pending.status).toBe('ready');if(pending.status!=='ready')return;
  expect(pending.value.session.occupancy).not.toBeNull();
  const replay=fx.rebuild({host:{async resolveConfiguration(){
    return {status:'rejected',code:'forbidden',reason:'current Host no longer grants new model execution'};
  }}});
  expect(await replay.port.startRun(fx.ctx,request)).toMatchObject({status:'ready',value:{run:{status:'ended'},session:{occupancy:null}}});
  expect(fx.scripted.calls()).toBe(1);
});

it('enters a second genuine Turn after more than 200 persisted Session records',async()=>{
  const fx=await makeFixture({taskBudget:{tokenBudget:100000,deadline:null},scriptedReplies:[
    {kind:'calls',calls:Array.from({length:110},(_,index)=>({callId:`long-history-${index}`,name:'read',args:{path:'b2-read.txt'}}))},
    {kind:'text',text:'LONG_HISTORY_FIRST_TASK_COMPLETE'},
    {kind:'text',text:'second task after the real history boundary'},
  ]});
  const runtime=fx.rebuild({host:{async resolveConfiguration(ctx,input){
    const current=await fx.host.resolveConfiguration(ctx,input);
    return current.status==='ready'?{...current,value:{...current.value,budget:{...current.value.budget,maxToolCalls:256}}}:current;
  }}});
  const first=await runtime.port.prepareExecution(fx.ctx,{runRef:fx.claim.runRef,requestId:'long-history-first-prepare'});
  expect(first.status).toBe('ready');if(first.status!=='ready')return;
  const ended=await runtime.port.startRun(fx.ctx,{prepared:first.value,consumerId:'long-history-first-consumer',requestId:'long-history-first-start'});
  expect(ended).toMatchObject({status:'ready',value:{run:{status:'ended'}}});
  if(ended.status!=='ready')return;
  const endPosition=ended.value.run.executionHistory?.endPosition;
  expect(endPosition).toBeGreaterThan(200);
  const claim=await fx.claimFixture.service.claimTask(fx.ctx,await fx.claimFixture.buildRequest({
    input:{taskId:fx.claimFixture.tasks.second.taskId,sessionRef:fx.claimFixture.sessions.first,budget:{tokenBudget:100000,deadline:null}},
    requestId:'long-history-second-claim',
  }));
  expect(claim.status).toBe('committed');if(claim.status!=='committed')return;
  fx.allowRun(claim.value.runRef);
  const second=await runtime.port.prepareExecution(fx.ctx,{runRef:claim.value.runRef,requestId:'long-history-second-prepare'});
  expect(second.status).toBe('ready');if(second.status!=='ready')return;
  const completed=await runtime.port.startRun(fx.ctx,{prepared:second.value,consumerId:'long-history-second-consumer',requestId:'long-history-second-start'});
  expect(completed).toMatchObject({status:'ready',value:{run:{status:'ended'},session:{occupancy:null}}});
  if(completed.status!=='ready')return;
  expect(completed.value.run.executionHistory!.startPosition).toBeGreaterThan(endPosition!);
  expect(claim.value.sessionRef).toEqual(fx.claim.sessionRef);
  expect(fx.scripted.calls()).toBe(3);
  expect(fx.scripted.requests[2]!.messages.filter(message=>message.role==='user')).toHaveLength(2);
  expect(JSON.stringify(fx.scripted.requests[2]!.messages)).toContain('LONG_HISTORY_FIRST_TASK_COMPLETE');
},60000);

it('search and source_excerpt enforce the actual Host path grant without exposing forbidden source bytes',async()=>{
  const secret='B2_FORBIDDEN_LOOKUP: confidential source payload 874d919';
  const fx=await makeFixture({scriptedReplies:[
    {kind:'calls',calls:[
      {callId:'forbidden-search',name:'search',args:{query:'B2_FORBIDDEN_LOOKUP',paths:['forbidden.txt']}},
      {callId:'forbidden-excerpt',name:'source_excerpt',args:{path:'forbidden.txt',expectedDigest:createHash('sha256').update(secret).digest('hex'),startLine:1,endLine:1}},
    ]},
    {kind:'text',text:'The source is outside the Host read grant'},
  ]});
  await writeFile(join(fx.directory,'forbidden.txt'),secret);
  const checkedPaths:string[]=[];
  const runtime=fx.rebuild({workspaceHost:{...fx.deps.workspaceHost,async authorize(ctx,scope){
    const current=await fx.deps.workspaceHost.authorize(ctx,scope);
    if(current.status!=='ready')return current;
    return {...current,value:{...current.value,allowsRead(path){checkedPaths.push(path);return current.value.allowsRead(path);}}};
  }}});
  const prepared=await runtime.port.prepareExecution(fx.ctx,{runRef:fx.claim.runRef,requestId:'source-path-prepare'});
  expect(prepared.status).toBe('ready');if(prepared.status!=='ready')return;
  const started=await runtime.port.startRun(fx.ctx,{prepared:prepared.value,consumerId:'source-path-consumer',requestId:'source-path-start'});
  expect(started).toMatchObject({status:'ready',value:{run:{status:'ended'}}});
  expect(fx.scripted.calls()).toBe(2);
  expect(fx.scripted.requests[0]!.tools.map(tool=>tool.name)).toEqual(expect.arrayContaining(['search','source_excerpt']));
  expect(checkedPaths).toContain('forbidden.txt');
  for(const callId of ['forbidden-search','forbidden-excerpt']){
    const toolResult=fx.scripted.requests[1]!.messages.find(message=>message.role==='tool'&&message.callId===callId);
    expect(toolResult).toBeDefined();
    expect(JSON.stringify(toolResult)).not.toContain(secret);
  }
  expect(JSON.stringify(fx.scripted.requests)).not.toContain(secret);
});

it('the same observer retries a failed genuine terminal commit without needing new Kernel records',async()=>{
  const fx=await makeFixture();let attempts=0;
  const runtime=fx.rebuild({entry:{...fx.entry,async recordRunResult(ctx,request){
    attempts++;
    if(attempts===1)return {status:'rejected',code:'unavailable',reason:'one transient terminal write failure'};
    return fx.entry.recordRunResult(ctx,request);
  }}});
  const prepared=await runtime.port.prepareExecution(fx.ctx,{runRef:fx.claim.runRef,requestId:'same-observer-prepare'});
  expect(prepared.status).toBe('ready');if(prepared.status!=='ready')return;
  await runtime.port.startRun(fx.ctx,{prepared:prepared.value,consumerId:'same-observer-consumer',requestId:'same-observer-start'});
  expect(attempts).toBe(1);expect(fx.scripted.calls()).toBe(1);
  const pending=await fx.deps.executions.readExecution(fx.ctx,fx.claim.runRef);
  expect(pending.status).toBe('ready');if(pending.status!=='ready')return;
  expect(pending.value.session.occupancy).not.toBeNull();expect(pending.value.lease?.release).toBeUndefined();
  const retried=await runtime.port.observeRun(fx.ctx,{runRef:fx.claim.runRef});
  expect(retried).toMatchObject({status:'ready',value:{run:{status:'ended'},session:{occupancy:null}}});
  expect(attempts).toBe(2);expect(fx.scripted.calls()).toBe(1);
});
