/**
 * K3 L13 (review-round preparation; D8): the structured `UnknownCallReviewInputV1`
 * and its rendered instruction.
 *
 * The pure builder/renderer/trim rows moved to `K3-review-input-pure.test.ts`
 * (F-046). F-054: the `prepare` rows run over the REAL blocked Run and the real
 * review round on memory and SQLite (`openK3ReviewCardWorld`), reading the Run,
 * Role, review record and prepared manifest through the platform's own owners
 * and the world's ONE artifact-body store; only the Host configuration is the
 * A8 input. Rework 2 item 2 adds prepare rows over the REAL blocked Run and
 * continuation Run (`openCrrWorld`); like every other test of that fixture,
 * this file installs §5.1's stand-in `shell` (the real Run's one process call
 * goes through it).
 */
import { describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import { renderUnknownCallReviewZh } from '../../src/contracts/core/prepared-execution.js';
import type { RunRef } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { ResolvedRuntimeConfiguration } from '../../src/core/agent-runtime/execution-contracts.js';
import type { ExecutionPreparationDependencies } from '../../src/core/agent-runtime/execution-preparation.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import {
  createExecutionPreparation, loadPreparedManifest,
} from '../../src/core/agent-runtime/execution-preparation.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { readTaskClosure } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createRunControlService } from '../../src/core/work-graph/tasks/control-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { openCrrWorld } from '../helpers/K3-crr-fixture.js';
import { openK3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { createK3PendingReview, readK3Review } from '../helpers/K3-proposal-round.js';
import { openRealRunHarness } from '../helpers/K3-35-continuation-fixture.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { setK3TaskDisposition } from '../helpers/K3-review-card-fixture.js';
import { GOAL_B, PLAN_B2, T } from '../helpers/S5-decision-fixture.js';

// §5.1's stand-in `shell`, hoisted per test file (the fixture's real Run uses it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

function hostConfiguration(): ResolvedRuntimeConfiguration {
  return {
    configurationRevision: 'host@1',
    model: { configuration: { revision: 'm@1', provider: 'scripted', model: 'm', baseUrl: 'http://127.0.0.1' },
      client: {} as unknown as ResolvedRuntimeConfiguration['model']['client'] },
    budget: { contextWindowTokens: 128000, inputTokens: null, outputTokens: null, maxRequests: 4,
      maxToolCalls: 8, timeoutMs: null, perResponseTokens: 512 },
    hostTemplate: null, tools: ['read'], writeScope: ['.'],
    skills: { resourceRoot: 'skills', enabledIds: [] },
    systemInstruction: 'executor', deniedPrefixes: [], processSandboxOptions: {}, materialBasis: null,
  };
}

/**
 * F-054: the ONE review-purpose Run over the world's real record store. The
 * blocked Run (and its record) is the shared `createK3PendingReview` path (real
 * claim -> production prepare/Runtime start -> RUN-20/RUN-22 -> the record);
 * the round is the world's real review claim (TASK-03r writes `activeRound` and
 * commits the Run `starting`), NOT prepared here so the row can drive the
 * production preparation itself.
 */
type ReviewWorld = Awaited<ReturnType<typeof openK3ReviewCardWorld>>;

async function claimReviewRound(world: ReviewWorld, record: UnknownCallReviewV1): Promise<TaskClaim> {
  const session = await world.fixture.createS5Session(`k3-f054-review-session-${record.ref.runId}`);
  const claim = await world.fixture.claimRun({
    requestId: `k3-f054-review-claim-${record.ref.runId}`,
    goalRef: GOAL_B, planRef: PLAN_B2, taskId: record.task.taskId, sessionRef: session,
    review: { reviewRef: record.ref, expectedRevision: record.revision, phase: 'review' },
  });
  const current = await readK3Review(world, record.ref);
  if (current.activeRound === null || current.activeRound.runRef.runId !== claim.runRef.runId) {
    throw new Error('F-054: the real claim did not record this Run as the active review round');
  }
  return claim;
}

/**
 * The production preparation over the world's own owners: the real Run/Role
 * readers, the world's review owner, its ONE artifact-body store and the real
 * Kernel store registry. The Host configuration is the A8 input (a normal Work
 * grant with a whole-workspace write scope), so the review purpose's fixed tool
 * list and empty write scope are the production behavior the rows assert.
 */
async function prepareReviewRun(world: ReviewWorld, claim: TaskClaim) {
  const records = world.records;
  const kernelStores = await createKernelStoreRegistry({ entries: [{
    adapterId: 's5-kernel', storeKey: 's5-kernel-store', workspace: world.fixture.base.scope,
    databasePath: join(world.fixture.base.directory, 's5-kernel.sqlite'),
  }] });
  const deps: ExecutionPreparationDependencies = {
    executions: createRunStateReader({ records }),
    roles: createRoleConfigurationService({ records, now: () => T, eventId: () => 'k3-f054-role' }),
    bodies: world.fixture.bodies,
    host: { resolveConfiguration: async () => ({ status: 'ready', value: {
      ...hostConfiguration(),
      hostTemplate: { templateId: 'builder', revision: '1', digest: 'k3-f054-template' } } }) } as never,
    materials: createMaterialService({ bodies: world.fixture.bodies, authority: createMaterialRecordReaders(records).authority, now: () => T }),
    unknownCallReviews: world.reviews,
    kernelStores,
    now: () => T,
    newId: () => 'k3-f054-id',
    readTaskClosure: async (_ctx, task) => readTaskClosure(records, GOAL_B, task.taskId),
  };
  const prepared = await createExecutionPreparation(deps).prepare(world.fixture.ctx,
    { runRef: claim.runRef, requestId: 'k3-f054-prepare' });
  if (prepared.status !== 'ready') throw new Error(`prepare: ${JSON.stringify(prepared)}`);
  const loaded = await loadPreparedManifest(world.fixture.bodies, prepared.value);
  if (loaded.status !== 'ready') throw new Error(`manifest: ${loaded.status}`);
  return { prepared: prepared.value, manifest: loaded.value.manifest };
}

/**
 * F-054: the ONE real record whose capture holds 250 changed paths.
 * `createK3PendingReview` cannot insert workspace changes between the run-start
 * baseline and RUN-22, so this row drives the SAME shared harness steps: the
 * public claim, the production prepare/Runtime start with the §5.1 shell held,
 * 250 real files written on disk while the Run is in flight, then the
 * production RUN-20/RUN-22 record read over the real `captureWorkspace`. No
 * item, workspace capture or record is built by the test.
 */
async function createFullCaptureRecord(world: ReviewWorld): Promise<UnknownCallReviewV1> {
  const directory = world.fixture.base.directory;
  const harness = await openRealRunHarness(world, { gitWorkspace: true });
  try {
    const session = await world.fixture.createS5Session('k3-f054-full-capture-session');
    const claim = await harness.claimRun({ sessionRef: session, planRef: PLAN_B2, taskId: 'k3-20-a',
      requestId: 'k3-f054-full-capture-claim' });
    const run = await harness.prepareAndStart(claim, {
      model: createScriptedModel([{ kind: 'calls', calls: [{ callId: 'k3-f054-full-capture-call',
        name: 'shell', args: { command: 'echo k3-f054-full-capture' } }] }]),
      tools: ['read', 'shell'], writeScope: ['.'], blockOnShell: true });
    try {
      // The Run is in flight with its shell call held: the real files written
      // now are the Run's real workspace changes, captured by RUN-22.
      await mkdir(join(directory, 'changed'), { recursive: true });
      for (let index = 0; index < 250; index += 1) {
        await writeFile(join(directory, 'changed', `path-${String(index).padStart(3, '0')}.ts`),
          `// K3 L13 changed path ${String(index)}\n`);
      }
      return await harness.createRecord(claim);
    } finally {
      shellSeam.release();
      await run.started.catch(() => undefined);
    }
  } finally {
    await harness.closeUnion();
  }
}

const EXPECTED_REVIEW_TOOLS = [
  'read', 'run_readonly_command', 'record_unknown_call_review',
];

describe('K3 L13 review-purpose prepare', () => {
  it.each(['memory', 'sqlite'] as const)('(%s) K3-12 K3-L13-5 prepares with the L13 tools, empty write scope, sessionBasis and the review section', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    try {
      const record = await createK3PendingReview(world);
      const claim = await claimReviewRound(world, record);
      const { prepared, manifest } = await prepareReviewRun(world, claim);
      expect(manifest.permissions.tools).toEqual(EXPECTED_REVIEW_TOOLS);
      expect(manifest.permissions.writeScope).toEqual([]);
      // K3-12: the written tools survive through the returned envelope too.
      expect(prepared.envelope.permissions.tools).toEqual(EXPECTED_REVIEW_TOOLS);
      expect(prepared.envelope.permissions.writeScope).toEqual([]);
      // K3-12: the fixed tool list is rendered into the instruction.
      expect(manifest.input).toContain('run_readonly_command');
      // L12: the review round in a fresh Session seeds the model history from
      // the ORIGINAL Run's Kernel history; the original Run's own record is the
      // expected source (the review record's `runRef` names that Run).
      const original = await createRunStateReader({ records: world.records })
        .readExecution(world.fixture.ctx, record.runRef);
      if (original.status !== 'ready') {
        throw new Error(`the original Run must be readable: ${JSON.stringify(original)}`);
      }
      const history = original.value.run.executionHistory;
      if (history === undefined) throw new Error('the original Run has no execution history');
      // The original blocked Run never completed a Turn (its held shell call
      // never returned), so L12's seed is the explicit EMPTY baseline; the
      // source Kernel session is still the original Run's real one.
      expect(manifest.sessionBasis).toEqual({
        sourceKernelSessionId: history.kernel.kernelSessionId, throughPosition: null,
      });
      // The real blocked record carries ONE process item (alias 1); its Kernel
      // callId must not leak into the instruction.
      expect(manifest.unknownCallReview?.items.map(item => item.alias)).toEqual([1]);
      expect(JSON.stringify(manifest.unknownCallReview)).not.toContain('call-');
      expect(manifest.input).toContain('## Unknown-call review');
      expect(manifest.input).toContain('做没做完：已做 / 没做 / 做了一半 / 判断不了，附依据');
      expect(manifest.inputDigest).toBe(prepared.inputBinding.inputDigest);
      // R1/D1: the review instruction is its own LAST section; the call stays work.
      const sections = manifest.contextAssembly!.sections;
      expect(manifest.contextAssembly!.callKind).toBe('work');
      const last = sections[sections.length - 1]!;
      expect(last.name).toBe('unknown_call_review');
      const suffix = renderUnknownCallReviewZh(manifest.unknownCallReview!);
      const totalBytes = Buffer.byteLength(manifest.input, 'utf8');
      expect(last.endByte).toBe(totalBytes);
      expect(last.startByte).toBe(totalBytes - Buffer.byteLength(suffix, 'utf8'));
      expect(manifest.input.endsWith(`\n\n${suffix}`)).toBe(true);
    } finally {
      await world.close();
    }
  });

  it.each(['memory', 'sqlite'] as const)('(%s) K3-L13-7 lists the first 200 changed paths from the FULL capture, not the 50-path sample', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    try {
      // The record's own capture is a real 250-path capture; its sample is 50.
      const record = await createFullCaptureRecord(world);
      const captured = record.workspace;
      if (captured.status !== 'captured') {
        throw new Error(`the RUN-22 workspace capture must be real: ${JSON.stringify(captured)}`);
      }
      expect(captured.changedCount).toBe(250);
      expect(captured.sample).toHaveLength(50);
      const claim = await claimReviewRound(world, record);
      const { manifest } = await prepareReviewRun(world, claim);
      const workspace = manifest.unknownCallReview!.workspace;
      expect(workspace.changedSample).toHaveLength(200);
      expect(workspace.changedSample[0]?.path).toBe('changed/path-000.ts');
      expect(workspace.changedSample[199]?.path).toBe('changed/path-199.ts');
      expect(workspace.changedOmitted).toBe(50);
    } finally {
      await world.close();
    }
  });
});


// -------------------------------------------------------------------------- //
// Rework 2 item 2: the Task-closure reader is required for prepare          //
// -------------------------------------------------------------------------- //

/**
 * A REAL blocked Work Run (the `openCrrWorld` chain: real claim -> shell ->
 * RUN-20/22 -> `skip_as_done` -> ② writes `blockedCommands`) plus a REAL
 * continuation Run from the public requeue/claim path, which is `starting` and
 * not yet prepared. Only the Host configuration and the Kernel registry are
 * narrow doubles; the review records and the Closure reader are real.
 */
async function workPrepare(kind: 'memory' | 'sqlite',
  readTaskClosure: ExecutionPreparationDependencies['readTaskClosure']):
Promise<{ world: Awaited<ReturnType<typeof openCrrWorld>>; runRef: RunRef;
  deps: ExecutionPreparationDependencies }> {
  const world = await openCrrWorld(kind);
  const continuation = await world.createContinuationRun();
  const records = world.blocked.world.fixture.records;
  // The SAME Kernel store the fixture's real Runs wrote to (the continuation
  // brief reads the previous Turn from it).
  const kernelStores = await createKernelStoreRegistry({ entries: [{
    adapterId: 's5-kernel', storeKey: 's5-kernel-store',
    workspace: world.blocked.world.fixture.base.scope,
    databasePath: join(world.blocked.world.fixture.base.directory, 's5-kernel.sqlite'),
  }] });
  const deps: ExecutionPreparationDependencies = {
    executions: createRunStateReader({ records }),
    roles: createRoleConfigurationService({ records, now: () => T, eventId: () => 'k3-prep-role' }),
    bodies: world.blocked.world.fixture.bodies,
    // The continuation Session's role is the fixture's legacy `builder@1`
    // template; a Work Run with an absent Role spec needs that trusted Host
    // template, matches it, and writes nothing.
    host: { resolveConfiguration: async () => ({ status: 'ready', value: {
      ...hostConfiguration(), writeScope: [],
      hostTemplate: { templateId: 'builder', revision: '1', digest: 'k3-prep-template' } } }) } as never,
    materials: createMaterialService({ bodies: world.blocked.world.fixture.bodies, authority: createMaterialRecordReaders(records).authority, now: () => T }),
    unknownCallReviews: world.blocked.reviews,
    kernelStores,
    now: () => T,
    newId: () => 'k3-prep-id',
    readTaskClosure,
  };
  return { world, runRef: continuation.runRef, deps };
}

describe('K3 rework 2 item 2: prepare and the one required Task closure', () => {
  it.each(['memory', 'sqlite'] as const)('(%s) an unwired closure reader fails closed, never "absent means open"', async kind => {
    // The dependency is REQUIRED; this pins the removed old branch (absent ->
    // `closed: false`). A legacy direct caller is exactly the wiring bug.
    const { world, runRef, deps } = await workPrepare(kind, undefined as never);
    try {
      expect(await createExecutionPreparation(deps).prepare(world.hostCtx, {
        runRef, requestId: 'work-closure-absent' }))
        .toMatchObject({ status: 'rejected', code: 'unavailable' });
    } finally { await world.close(); }
  });

  it.each(['memory', 'sqlite'] as const)('(%s) a closure-read rejection makes prepare unavailable, never blocks as open', async kind => {
    const { world, runRef, deps } = await workPrepare(kind, async () => {
      throw new Error('injected Task-closure read failure');
    });
    try {
      expect(await createExecutionPreparation(deps).prepare(world.hostCtx, {
        runRef, requestId: 'work-closure-fail' }))
        .toMatchObject({ status: 'rejected', code: 'unavailable' });
    } finally { await world.close(); }
  });

  // The closed Task IS reachable through the snapshot/closure window. Prepare
  // reads the Run snapshot (still `starting`) BEFORE it reads the closure, so
  // the test holds it at the closure read with a latch and closes the world
  // underneath it. The order matters: the public plan close is refused `busy`
  // while the continuation execution is unfinished (plan Guard 1), so the
  // not-yet-entered Run is cancelled through the public control owner FIRST
  // (a `starting` cancel is the `platform_not_entered` stop), and then the
  // public plan change cancels the Task. On release the production closure
  // reader sees `{closed:true, cause:'cancelled'}`; prepare keeps the snapshot
  // it already read and therefore returns ready with no blocked binding/line.
  it.each(['memory', 'sqlite'] as const)('(%s) a closed Task carries no blocked binding/lines and its prepared start is refused busy', async kind => {
    let release!: () => void;
    const latch = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    let realRead: ExecutionPreparationDependencies['readTaskClosure'] | undefined;
    const { world, runRef, deps } = await workPrepare(kind, async (ctx, task) => {
      entered();
      await latch;
      if (realRead === undefined) throw new Error('the test did not install the production closure reader');
      return realRead(ctx, task);
    });
    realRead = (ctx, task) => readTaskClosure(world.blocked.world.fixture.records, GOAL_B, task.taskId);
    try {
      const preparing = createExecutionPreparation(deps).prepare(world.hostCtx, {
        runRef, requestId: 'work-closed' });
      // A prepare that finishes without the closure read fails here, not by
      // hanging on the latch.
      await Promise.race([reached, preparing.then(prepared => {
        throw new Error(`prepare finished before the closure read: ${JSON.stringify(prepared)}`);
      })]);

      const records = world.blocked.world.fixture.records;
      const reads = createRunStateReader({ records });
      const controls = createRunControlService({ records,
        authority: createMaterialRecordReaders(records).authority, reads,
        now: () => T, eventId: () => 'k3-prep-control' });
      const before = await reads.readExecution(world.hostCtx, runRef);
      if (before.status !== 'ready') throw new Error(`the continuation Run must be readable: ${JSON.stringify(before)}`);
      const cancelled = await controls.submitControl(world.hostCtx, {
        input: { runRef, kind: 'cancel', reason: 'cancel the not-yet-entered continuation Run' },
        meta: { requestId: 'k3-prep-cancel', expected: [{ ref: runRef, revision: before.value.run.revision }] },
      });
      if (cancelled.status !== 'committed') throw new Error(`cancel: ${JSON.stringify(cancelled)}`);
      expect(cancelled.status).toBe('committed');
      expect(cancelled.value.intent).toMatchObject({ status: 'applied',
        observation: { origin: 'platform_not_entered', kind: 'cancelled' } });

      await expect(setK3TaskDisposition(world.blocked.world, world.task.taskId, 'cancelled'))
        .resolves.toBeUndefined();
      release();

      const prepared = await preparing;
      if (prepared.status !== 'ready') throw new Error(`prepare: ${JSON.stringify(prepared)}`);
      const loaded = await loadPreparedManifest(world.blocked.world.fixture.bodies, prepared.value);
      if (loaded.status !== 'ready') throw new Error(`manifest: ${loaded.status}`);
      expect(loaded.value.manifest.blockedCommands ?? []).toEqual([]);
      // The standard continuation brief keeps L20's fixed sentence; a CLOSED
      // Task adds no per-command blocked line (`#<alias>@<runId8>`).
      expect(loaded.value.manifest.input).not.toContain('#1@');
      // The two public steps really closed the Task for the production reader.
      expect(await readTaskClosure(records, GOAL_B, world.task.taskId))
        .toEqual({ status: 'ready', value: { closed: true, cause: 'cancelled' } });

      // Lead ruling (rework 5 item 3): prepare's closed branch stays `ready`
      // with no blocked binding/line. The test adds the consequence: the
      // following public start of the produced value for the CANCELLED Run is
      // refused, so nothing enters and nothing runs.
      const closed = await reads.readExecution(world.hostCtx, runRef);
      if (closed.status !== 'ready') throw new Error(`the cancelled Run must stay readable: ${JSON.stringify(closed)}`);
      expect(closed.value.run.status).toBe('ended');
      expect(closed.value.run.outcome).toBe('cancelled');
      expect(closed.value.run.executionAuthorization).toBeUndefined();
      const kernelStores = deps.kernelStores;
      if (kernelStores === undefined) throw new Error('the test wired no Kernel store registry');
      const turnCount = async (): Promise<number> => kernelStores.withStore('s5-kernel', async store => {
        const sessionId = closed.value.session.kernel.kernelSessionId;
        let after = 0;
        let count = 0;
        for (;;) {
          const page = await store.read(sessionId, after, 256, { signal: new AbortController().signal });
          count += page.records.filter(record => record.recordType === 'turn.started').length;
          if (page.nextPosition === null) return count;
          after = page.nextPosition;
        }
      });
      const turnsBefore = await turnCount();
      // The public start of the prepared value. Observed refusal:
      // { status: 'rejected', code: 'busy',
      //   reason: 'the Run already ended without an entry authorization' }.
      const started = await world.blocked.startPrepared(prepared.value);
      expect(started.status).not.toBe('ready');
      if (started.status !== 'rejected') throw new Error(`start: ${JSON.stringify(started)}`);
      expect(started.code).toBe('busy');
      // Nothing ran: the Run is still the ended/cancelled one the cancel wrote,
      // with no entry authorization bound and no new Kernel turn.
      const afterStart = await reads.readExecution(world.hostCtx, runRef);
      if (afterStart.status !== 'ready') throw new Error(`the Run must stay readable: ${JSON.stringify(afterStart)}`);
      expect(afterStart.value.run.status).toBe('ended');
      expect(afterStart.value.run.outcome).toBe('cancelled');
      expect(afterStart.value.run.executionAuthorization).toBeUndefined();
      expect(afterStart.value.run.revision).toBe(closed.value.run.revision);
      expect(await turnCount()).toBe(turnsBefore);
    } finally {
      release();
      await world.close();
    }
  });
});
