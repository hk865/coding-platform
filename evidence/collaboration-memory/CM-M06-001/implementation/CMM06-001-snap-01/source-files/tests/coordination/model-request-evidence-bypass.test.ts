/** Actual Runtime/provider boundary: each request consumes its own permit before stream. */
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPersistentSqliteHarness } from '../../src/harness/persistent-harness.js';
import { CodingAgentRuntime, type RunSpec } from '../../src/execution/worker-runtime/coding-agent-runtime.js';
import { LeasedWorkerRuntime } from '../../src/control/dispatch-engine/leased-worker-runtime.js';
import { RuntimeDispatch } from '../../src/control/dispatch-engine/runtime-dispatch.js';
import type { ModelClientPort, ModelEvent, ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { buildBootstrapCommand } from '../../src/contracts/bootstrap.js';
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from '../contract-support/fixtures/bootstrap-fixture-v1.js';
import { prepareP103Project, type P1_03TestHarness } from '../contract-suite/p1-03-harness.js';
import { buildDispatchClaimCommand, DISPATCH_ELIGIBLE_TASK_ID } from '../../src/fixtures/dispatch-fixtures.js';
import { modelRequestPermitIdFor, modelRequestPermitRefFor, type ModelRequestPermitSnapshot, dispatchOutboxRefFor, runRefFor, runFactFingerprint, type RunFactCommand, type RunSnapshot } from '../../src/contracts/dispatch.js';
import { buildRunFactCommand } from '../../src/contracts/commands/dispatch.js';

const AT = '2026-09-05T12:00:00.000Z';
/** Control/宿主时钟晚于运行时钟（运行事件用真实时钟），用来让许可的 issuedAt 晚于 Run 的 endedAt。 */
const LATE_CLOCK = '2030-01-01T00:00:00.000Z';
const PROJECT = 'proj-alpha';
const WORKSPACE = 'ws-shared';
const GOAL = 'goal-1';
const TASK = DISPATCH_ELIGIBLE_TASK_ID;
const RUN_ID = 'run-bypass';
const ATTEMPT_ID = 'att-bypass';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

function specFor(root: string, runId: string): RunSpec {
  return {
    projectId: PROJECT, workspaceId: WORKSPACE, goalId: GOAL, runId, taskId: TASK, root,
    instruction: 'BYPASS_INSTRUCTION',
    budget: { contextWindowTokens: 1_000_000, inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null, perResponseTokens: 32768 },
  };
}

/** 建一个与产品同形的世界：真实持久 harness + 真实内核（只读运行，材料通道为空）。 */
async function buildWorld(controlClock: string, options: { rounds?: number; evidence?: 'refuse' | 'tamper_context' | 'tamper_request'; cancelAfterFirst?: boolean } = {}) {
  const requests: ModelRequest[] = [];
  const permitsAtCall: ModelRequestPermitSnapshot[] = [];
  let h: Awaited<ReturnType<typeof createPersistentSqliteHarness>>;
  const client: ModelClientPort = {
    async *stream(request): AsyncIterable<ModelEvent> {
      requests.push(structuredClone(request));
      const ref = modelRequestPermitRefFor(PROJECT, WORKSPACE, modelRequestPermitIdFor(runRefFor(PROJECT, GOAL, RUN_ID), request.requestId));
      const loaded = await h.ledger.load(ref);
      expect(loaded.status).toBe('found');
      if (loaded.status !== 'found') throw Error('permit absent at provider boundary');
      permitsAtCall.push(structuredClone(loaded.snapshot as ModelRequestPermitSnapshot));
      const common = { schemaVersion: 1 as const, requestId: request.requestId };
      if (options.cancelAfterFirst && requests.length === 1) {
        const runRef = runRefFor(PROJECT, GOAL, RUN_ID);
        const cancelled = await h.control.submitControl({ schemaVersion: 1, commandType: 'SubmitControl', commandId: 'cancel-at-first',
          identity: { projectId: PROJECT, actor: { kind: 'human', id: 'user-1' }, idempotencyKey: 'cancel-at-first' },
          aggregateId: 'cancel-at-first', expectedRevision: 0, correlationId: 'cancel-at-first', submittedAt: controlClock,
          payload: { intent: { schemaVersion: 1, intentId: 'cancel-at-first', projectId: PROJECT, workspaceId: WORKSPACE,
            kind: 'cancel', scope: { projectId: PROJECT, workspaceId: WORKSPACE, goalId: GOAL, taskId: TASK, runRef },
            reason: 'test cancellation between calls', steer: null, desiredState: 'cancelled', status: 'queued', acks: [],
            resumeFromIntentRef: null, submittedAt: controlClock, updatedAt: controlClock } } });
        expect(cancelled.status).toBe('committed');
      }
      if (requests.length < (options.rounds ?? 1)) {
        const callId = 'read-' + requests.length;
        yield { ...common, sequence: 1, type: 'tool_call_started', callId, name: 'read', ordinal: 0 };
        yield { ...common, sequence: 2, type: 'tool_arguments_delta', callId, delta: JSON.stringify({ path: 'sample.txt' }) };
        yield { ...common, sequence: 3, type: 'completed', reason: 'tool_calls' };
        return;
      }
      yield { ...common, sequence: 1, type: 'text_delta', delta: '已读到本次材料。' };
      yield { ...common, sequence: 2, type: 'completed', reason: 'final_answer' };
    },
  };
  const dir = await mkdtemp(join(tmpdir(), 'cm1a-evidence-bypass-'));
  cleanup.push(async () => { await rm(dir, { recursive: true, force: true }); });
  const root = join(dir, 'source');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'sample.txt'), 'material nonce');
  const runtime = new CodingAgentRuntime(join(dir, 'runs'), async () => ({
    configuration: { revision: 'local', provider: 'deepseek', model: 'local-capture-client', baseUrl: 'http://127.0.0.1' },
    client,
  }));
  await runtime.init();
  cleanup.push(() => runtime.close());


  h = await createPersistentSqliteHarness({
    deps: { clock: () => controlClock },
    runtimePreparation: runtime,
    workspaceRootFor: () => root,
    runtime: {
      capabilities: () => runtime.capabilities(),
      start: async (envelope, access) => {
        const handle = await new LeasedWorkerRuntime({
          runtime, lease: () => h.workspaceLease, vault: () => h.vault, now: () => controlClock,
          materials: async () => undefined,
        }).start(envelope, access);
        // 注入点（只在这一层）：让本适配器不交出调用证据草稿，用于钉住协议 §4.13.6 的验证上限。
        // 其余全部是产品实现（真实账本、真实 Control、真实终态折叠）。
        return handle;
      },
    },
  });
  cleanup.push(async () => { await h.cleanup(); });

  const adapter: P1_03TestHarness = {
    ledger: h.ledger, readModel: h.readModel, runtime: h.runtime,
    bootstrap: h.bootstrap, submit: (command) => h.control.submit(command),
    install: h.install, activate: h.activate, applyPlan: h.applyPlan,
    dispatchReadiness: h.dispatchReadiness, claimTask: h.claimTask, startRun: h.startRun,
    runFact: h.runFact, drive: h.drive, advanceProjection: h.advanceProjection,
    observedCursor: h.observedCursor, planGraph: h.planGraph, taskDetail: h.taskDetail, activeAgent: h.activeAgent,
  };
  expect((await h.bootstrap(buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
    commandId: 'cmd-bypass-boot', correlationId: 'corr-bypass-boot', submittedAt: AT,
  }))).status).toBe('committed');
  await prepareP103Project(adapter, PROJECT, 'a');

  const claim = await h.claimTask(buildDispatchClaimCommand({
    commandId: 'cmd-bypass-claim', correlationId: 'corr-bypass-claim', submittedAt: AT, projectId: PROJECT,
    goalId: GOAL, taskId: TASK, attemptId: ATTEMPT_ID, runId: RUN_ID, idempotencyKey: 'bypass-claim',
    declaredPermissions: { tools: ['read'], writeScope: [] },
    budget: { tokenBudget: 1_000_000, deadline: null },
  }));
  expect(claim.status, JSON.stringify(claim)).toBe('committed');
  const runRef = runRefFor(PROJECT, GOAL, RUN_ID);
  await runtime.prepare(specFor(root, RUN_ID));

  const originalFact = h.control.runFact.bind(h.control);
  if (options.evidence) h.control.runFact = async command => {
    const fact = command.payload.fact;
    if (fact.kind !== 'model_request_evidence') return originalFact(command);
    if (options.evidence === 'refuse') return { status: 'rejected', commandId: command.commandId, code: 'unavailable' };
    const forged = options.evidence === 'tamper_context' ? { ...fact, contextInputDigest: 'f'.repeat(64) } : { ...fact, requestDigest: 'f'.repeat(64) };
    return originalFact({ ...command, payload: { fact: forged } });
  };
  const runtimeDispatch = new RuntimeDispatch({
    ledger: h.ledger, control: h.control,
    outbox: { drive: (trigger) => h.drive(trigger) },
    runtime, now: () => controlClock,
  });
  const result = await runtimeDispatch.drive({ reason: 'evidence-bypass', runRef });
  return { h, runtime, requests, runRef, result, permitsAtCall };
}


it.each([AT, LATE_CLOCK])('each actual provider request has already consumed its own exact permit (clock=%s)', async clock => {
  const w = await buildWorld(clock, { rounds: 2 });
  expect(w.requests, JSON.stringify(w.runtime.all().map(r => ({ error: r.error, trace: r.trace.slice(-4) })))).toHaveLength(2);
  expect(w.permitsAtCall).toHaveLength(2);
  expect(new Set(w.permitsAtCall.map(p => p.ref.permitId)).size).toBe(2);
  const runtime = w.runtime.all()[0]!;
  for (const [index, request] of w.requests.entries()) {
    const permit = w.permitsAtCall[index]!;
    expect(permit.revision).toBe(2);
    expect(permit.permit.consumedByAttemptId).toBe(request.requestId);
    expect(permit.permit.requestDigest).toBe(createHash('sha256').update(JSON.stringify(request)).digest('hex'));
    expect(permit.permit.contextInputDigest).toBe(runtime.context!.manifest.inputDigest);
  }
  const loaded = await w.h.ledger.load(w.runRef);
  expect(loaded.status === 'found' && (loaded.snapshot as RunSnapshot).outcome).toBe('completed');
  expect(w.result.failures).toEqual([]);
});

it.each(['refuse', 'tamper_context', 'tamper_request'] as const)('refuses %s before any provider side effect and records a known failure', async evidence => {
  const w = await buildWorld(AT, { evidence });
  expect(w.requests).toHaveLength(0);
  const run = await w.h.ledger.load(w.runRef);
  expect(run.status === 'found' && (run.snapshot as RunSnapshot).outcome).toBe('crashed');
  expect(w.runtime.all()[0]!.status).toBe('failed');
});

it('canonical cancellation between requests prevents the second provider request', async () => {
  const w = await buildWorld(AT, { rounds: 2, cancelAfterFirst: true });
  expect(w.requests).toHaveLength(1);
  const run = await w.h.ledger.load(w.runRef);
  expect(run.status === 'found' && (run.snapshot as RunSnapshot).controlState?.desiredState).toBe('cancelled');
});

it('direct ledger writes cannot forge a second consumed permit or a mismatched input digest', async () => {
  const w = await buildWorld(AT);
  const prior = w.permitsAtCall[0]!;
  const run = await w.h.ledger.load(w.runRef);
  if (run.status !== 'found') throw Error('run missing');
  const permit = { ...prior.permit, contextInputDigest: 'f'.repeat(64), consumedByAttemptId: 'forged' };
  const before = await w.h.ledger.events({ afterCursor: null, limit: 1000 });
  const receipt = await w.h.ledger.commit({ commitKind: 'run-fact', schemaVersion: 1,
    identity: { projectId: PROJECT, actor: { kind: 'system', id: 'dispatch' }, idempotencyKey: 'forged' }, fingerprint: 'forged' as never,
    expectedVersions: [{ ref: prior.ref, revision: 1 }, { ref: w.runRef, revision: run.snapshot.revision },
      { ref: { aggregateType: 'ProjectCoordinationPolicyActive', projectId: PROJECT }, revision: 0 }],
    snapshots: [{ ...prior, permit }], outboxIntents: [],
    events: [{ schemaVersion: 1, eventId: 'forged', eventType: 'ModelRequestEvidenceRecorded', projectId: PROJECT, workspaceId: WORKSPACE,
      aggregateType: 'ModelRequestPermit', aggregateId: prior.ref.permitId, aggregateRevision: 2,
      causationId: 'forged', correlationId: 'forged', idempotencyKey: 'forged', actor: { kind: 'system', id: 'dispatch' }, occurredAt: AT,
      payload: { permit, evidence: { permitId: prior.ref.permitId, attemptId: 'forged', requestDigest: permit.requestDigest!,
        contextInputDigest: permit.contextInputDigest!, deliveryRefs: [], observedAt: AT } } }] });
  expect(receipt.status).toBe('rejected');
  expect(await w.h.ledger.load(prior.ref)).toEqual({ status: 'found', snapshot: prior });
  expect((await w.h.ledger.events({ afterCursor: null, limit: 1000 })).events.length).toBe(before.events.length);
});
