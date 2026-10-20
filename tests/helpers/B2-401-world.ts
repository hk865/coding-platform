/**
 * B2-18 / B2-16 rework 4 item 5: ONE shared 401-Run world, built once per test
 * file (vitest isolates files).
 *
 * The first blocked record is the REAL `openK3BlockedReviewServices.seed` Run
 * (public claim -> production `startRun` with §5.1's blocking `shell` stand-in
 * -> RUN-20/RUN-22) and the REAL `skip_as_done` answer, so `blockedCommands`
 * exist. Every later Run is a REAL continuation: the public requeue owner after
 * the previous Run, the public claim owner with that `requeueRef`, the
 * production preparation and `runtime.port.startRun`, held in flight by a
 * scripted model. Each request is written through ONE production
 * `createCommandRerunRequestService` (with the required canonical
 * `readTaskClosure` and the real recognizer) and answered through the REAL
 * `decisions/answer` owner (`resolveDecision`), exactly as a person would:
 * the first 400 are `deny`, the LAST one (F-032, on task page 3) is the real
 * unused `allow_rerun` whose one-time allowance the hook row consumes.
 *
 * END OF A CONTINUATION (book `./.dsh-ref/k3-g4b3-rework-5.md` item 5): a
 * `beforeReply` fault the Runtime records as `run_crashed` is accepted for
 * B2-16/B2-18's read-count proof. A completed ordinary Run leaves the Task
 * verifying, and the public requeue then refuses it with exactly
 * `{"status":"rejected","code":"busy","reason":"the selected Run is verifying; finalize its round first"}`
 * (`src/core/work-graph/state/task-machine.ts:1218`, row P11). A tools:[] text
 * Run has no review draft/record, so no public review round can be claimed to
 * finalize it. The chain is the one the book allows for a crashed end: the
 * scripted model throws in `beforeReply` after the gate, and the Runtime records
 * `run_crashed` itself. `END` below is the one switch between the two.
 *
 * Only the PUBLIC record port is wrapped, for accounting: physical CRR pages
 * per index, CRR commits, `readMany` point-read keys, plus the hook's record /
 * closure / workspace reads. No record, page or event is hand-encoded.
 */
import type { HookPort, ToolCall } from '../../vendor/coding-agent/dist/public-api.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { RunSnapshot, TaskTriple } from '../../src/contracts/dispatch.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort, RecordLookupRequest } from '../../src/core/record-store/lookup-ports.js';
import type { ReadWorkspaceRequest, WorkspaceFile } from '../../src/core/workspace/ports.js';
import type { CommandRerunRequestReplyV1 } from '../../src/core/work-graph/model/command-rerun-request-contracts.js';
import type { CommandRerunRequestV1 } from '../../src/contracts/command-rerun-request.js';
import type { KernelExecutionBinding } from '../../src/core/work-graph/model/execution-entry-contracts.js';
import type { TaskExecutionRecord } from '../../src/core/work-graph/model/execution-read-contracts.js';
import { createShellBlockedHook } from '../../src/core/agent-runtime/execution-driver.js';
import { createCommandRerunRequestService } from '../../src/core/work-graph/tasks/command-rerun-request-service.js';
import { createCommandRecognizer } from '../../src/core/work-graph/tasks/command-recognition.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { readTaskClosure } from '../../src/core/work-graph/tasks/plan-readers.js';
import {
  commandRerunRequestRefKey,
  COMMAND_RERUN_REQUEST_CHANGED_EVENT_TYPE, COMMAND_RERUN_REQUEST_SCHEMA_ID, K3_CRR_BY_TASK_LOOKUP,
} from '../../src/core/work-graph/tasks/command-rerun-request-codecs.js';
import { bindingOf, type B2TaskClosureReader } from './B2-blocked-runtime.js';
import { openK3BlockedCommandWorld, sha256Of } from './K3-blocked-command-fixture.js';
import type { K3ReviewCardWorld } from './K3-review-card-fixture.js';
import { crrCardOf } from './B2-crr-world.js';
import { openRealRunHarness, type K3_35RealRunHarness } from './K3-35-continuation-fixture.js';
import { createScriptedModel, type ScriptedModel } from './B2-runtime-fixture.js';
import { PLAN_B2, T } from './S5-decision-fixture.js';

/** R = 401 CRR rows on one alias of one Task: ceil(401 / 200) = 3 pages. */
export const B401_R = 401;
const COMMAND = 'npm run db:migrate';
const BLOCKED_CALL_ID = 'b2-401-call-1';
/** `'completed'` is the natural final reply; `'crashed'` is the Runtime's own `run_crashed`. */
const END: 'completed' | 'crashed' = 'crashed';

const FILES: Record<string, string> = {
  'app/package.json': JSON.stringify({ scripts: { 'db:migrate': 'prisma migrate deploy' } }),
  'package.json': JSON.stringify({ scripts: { 'db:migrate': 'prisma migrate deploy' } }),
};

export type B401PageCall = { limit: number; after: string | undefined; records: string[] };

/** One shared counter set; `resetCounters()` clears every list and count. */
export type B401Counters = {
  /** Every physical page request per CRR index, in order. */
  pages: Map<string, B401PageCall[]>;
  /** CRR record/event commits through the wrapped public port. */
  crrWrites: number;
  /** `readMany` keys naming a CommandRerunRequest, in order. */
  pointReadKeys: string[];
  /** Every record read through the hook's counting reviews port, in order. */
  recordReads: string[];
  /** Every `readTaskClosure` call, in order. */
  closureReads: string[];
  /** Every workspace path read through the recognizer, in order. */
  packageReads: string[];
};

export type B401NextRun = {
  claim: TaskClaim;
  entered: { run: RunSnapshot; kernel: KernelExecutionBinding };
  /** The measured Run's own real `work_run` context (the CRR owner's read). */
  ctx: CoreCallContext;
  started: Promise<ReadResult<TaskExecutionRecord>>;
  /** Release the gate: the scripted model then throws (Runtime records the crash). */
  release(): void;
};

/** The in-flight part of any started Run: enough to release it and await its end. */
type B401LiveRun = Pick<B401NextRun, 'claim' | 'started' | 'release'>;

export type B401World = {
  world: K3ReviewCardWorld;
  task: TaskTriple;
  record: UnknownCallReviewV1;
  /** The ONE production CRR owner over the counting public port. */
  requestService: ReturnType<typeof createCommandRerunRequestService>;
  /** The production `before_tool` shell hook, over the SAME 401 requests. */
  hook: HookPort;
  /** The seeded real Run's own `work_run` context (the hook reads under it). */
  ctx: CoreCallContext;
  workspace: { projectId: string; workspaceId: string };
  counters: B401Counters;
  resetCounters(): void;
  /** The number of real requests committed by the world build (R). */
  requestCount: number;
  /** The LAST built request (the one on the last task page, F-032). */
  lastRequest: CommandRerunRequestV1;
  /** Its canonical refKey, so a row can place it on a physical page. */
  lastRequestRefKey: string;
  /** Wall time of the one world build, in ms. */
  buildMs: number;
  /** The 402nd continuation Run: requeue + claim + start, gated before its end. */
  startNext(): Promise<B401NextRun>;
  close(): Promise<void>;
};

function countersOf(): B401Counters {
  return { pages: new Map(), crrWrites: 0, pointReadKeys: [], recordReads: [], closureReads: [], packageReads: [] };
}

/** A scripted model held before its reply; `release()` lets it end the Run. */
function gatedModel(index: number): { model: ScriptedModel; release(): void } {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const model = createScriptedModel([{ kind: 'text', text: `B2-401 continuation reply ${String(index)}` }],
    async () => {
      await gate;
      if (END === 'crashed') throw new Error(`B2-401 round ${String(index)} crashed`);
    });
  return { model, release };
}

/** Poll the PUBLIC execution read until the real `startRun` recorded `entered`. */
async function waitEntered(
  harness: K3_35RealRunHarness, world: K3ReviewCardWorld, claim: TaskClaim,
): Promise<{ run: RunSnapshot; kernel: KernelExecutionBinding }> {
  const reads = createRunStateReader({ records: harness.records });
  const deadline = Date.now() + 30_000;
  for (;;) {
    const read = await reads.readExecution(world.fixture.ctx, claim.runRef);
    if (read.status === 'ready') {
      const authorization = read.value.run.executionAuthorization;
      if (authorization !== undefined && 'schemaVersion' in authorization
        && authorization.schemaVersion === 2 && authorization.phase === 'entered'
        && authorization.kernel !== null) {
        return { run: read.value.run, kernel: authorization.kernel };
      }
    }
    if (Date.now() > deadline) throw new Error('the started Run never reached the entered phase');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

/** The real `work_run` context of one recorded Run (its own RunRef and role binding). */
function workCtxOf(world: K3ReviewCardWorld, run: RunSnapshot): CoreCallContext {
  return { projectId: run.ref.projectId, workspaceId: world.fixture.base.scope.workspaceId,
    principal: { kind: 'work_run', runRef: run.ref, roleBinding: run.roleBinding },
    materialReader: { kind: 'run', requester: run.ref },
    signal: world.fixture.ctx.signal };
}

function committed(reply: CommandRerunRequestReplyV1): Extract<CommandRerunRequestReplyV1, { status: 'committed' }> {
  if (reply.status !== 'committed') throw new Error(`expected committed, got ${JSON.stringify(reply)}`);
  return reply;
}

export async function openB401World(options: { runs?: number } = {}): Promise<B401World> {
  const total = options.runs ?? B401_R;
  const buildMs = Date.now();
  const blocked = await openK3BlockedCommandWorld('sqlite', {
    commands: { [BLOCKED_CALL_ID]: { command: COMMAND } }, files: FILES,
  });
  const world = blocked.world;
  let harness: K3_35RealRunHarness | undefined;
  let closed = false;
  let live: B401LiveRun | undefined;
  try {
    const record = await blocked.answer(blocked.record, 'skip_as_done', { text: 'done' });
    if (record.blockedCommands.length === 0) throw new Error('② wrote no blockedCommands');
    const task: TaskTriple = record.task;
    harness = await openRealRunHarness(world);
    const real = harness;
    const workspace = { projectId: world.fixture.base.scope.projectId,
      workspaceId: world.fixture.base.scope.workspaceId };
    const counters = countersOf();
    const base = world.records;
    const records = {
      readMany: (keys: readonly string[]) => {
        for (const key of keys) {
          if (key.startsWith('{"aggregateType":"CommandRerunRequest"')) counters.pointReadKeys.push(key);
        }
        return base.readMany(keys);
      },
      lookupCommit: (input: Parameters<GoalRecordTransactionPort['lookupCommit']>[0]) => base.lookupCommit(input),
      eventAt: (cursor: Parameters<GoalRecordTransactionPort['eventAt']>[0]) => base.eventAt(cursor),
      async commit(input: Parameters<GoalRecordTransactionPort['commit']>[0]) {
        const committedNow = await base.commit(input);
        const crr = input.records.some(row => row.schemaId === COMMAND_RERUN_REQUEST_SCHEMA_ID)
          || input.events.some(event => event.eventType === COMMAND_RERUN_REQUEST_CHANGED_EVENT_TYPE);
        if (crr && committedNow.status === 'committed') counters.crrWrites += 1;
        return committedNow;
      },
      async lookup(request: RecordLookupRequest) {
        const page = await base.lookup(request);
        const list = counters.pages.get(request.index) ?? [];
        list.push({ limit: request.limit, after: request.after,
          records: page.status === 'ready' ? page.value.records.map(record => record.refKey) : [] });
        counters.pages.set(request.index, list);
        return page;
      },
    } as GoalRecordTransactionPort & RecordLookupPort;
    const readWorkspace = {
      async readWorkspace(_ctx: CoreCallContext, input: ReadWorkspaceRequest): Promise<ReadResult<WorkspaceFile>> {
        counters.packageReads.push(input.path);
        const content = FILES[input.path];
        if (content === undefined) {
          return { status: 'rejected', code: 'not_found', reason: `no such workspace file: ${input.path}` };
        }
        return { status: 'ready', value: {
          path: input.path, content, digest: sha256Of(content), sizeBytes: Buffer.byteLength(content, 'utf8'),
          digestBasis: 'raw_bytes', version: { kind: 'working_tree' }, readAt: T,
        } };
      },
    };
    const recognizer = createCommandRecognizer({ readWorkspace: readWorkspace as never });
    const readTaskReviews = async (ctx: CoreCallContext, input: {
      goalRef: { aggregateType: 'Goal'; projectId: string; goalId: string }; taskId: string;
    }) => {
      const all: UnknownCallReviewV1[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await world.reviews.listReviews(ctx, { workspace,
          filter: { goalRef: input.goalRef, taskId: input.taskId },
          page: { limit: 200, ...(cursor === undefined ? {} : { cursor }) } });
        if (page.status !== 'ready') return page;
        all.push(...page.value.items);
        if (page.value.nextCursor === null) return { status: 'ready' as const, value: all };
        cursor = page.value.nextCursor;
      }
    };
    /** The REQUIRED canonical closure: ONE read per CRR operation, counted. */
    const readClosure: B2TaskClosureReader = async (_ctx, target) => {
      counters.closureReads.push(target.taskId);
      return readTaskClosure(records, { aggregateType: 'Goal',
        projectId: target.projectId, goalId: target.goalId }, target.taskId);
    };
    let eventSeq = 0;
    const requestService = createCommandRerunRequestService({
      records,
      listTaskReviews: readTaskReviews,
      readTaskClosure: readClosure,
      recognize: recognizer,
      now: () => T,
      eventId: () => `b2-401-event-${String(++eventSeq)}`,
    });
    // The hook's own record read is counted; the record is the REAL one ② wrote.
    const reviews = {
      async readReview(ctx: CoreCallContext, input: { ref: { runId: string } }) {
        counters.recordReads.push(input.ref.runId);
        return blocked.reviews.readReview(ctx, input as never);
      },
    };
    const ctx: CoreCallContext = {
      projectId: workspace.projectId, workspaceId: workspace.workspaceId,
      principal: { kind: 'work_run', runRef: blocked.run.ref, roleBinding: blocked.run.roleBinding },
      materialReader: { kind: 'run', requester: blocked.run.ref },
      signal: new AbortController().signal,
    };
    const hook = createShellBlockedHook({
      ctx, runRef: blocked.run.ref, taskId: task.taskId, workspace,
      binding: bindingOf(record), reviews: reviews as never, requests: requestService, recognizer,
    });

    // ---- the 401 real continuation Runs, one request each ------------------
    const reads = createRunStateReader({ records: real.records });
    const requestIds: string[] = [];
    // F-032: the LAST request (page 3) is captured so the hook row can name it.
    let lastRequest: CommandRerunRequestV1 | undefined;
    let prevClaim = blocked.claim;
    for (let index = 1; index <= total; index += 1) {
      // Item 6: `live` holds the Run from the instant `prepareAndStart` returns,
      // so a throw in `waitEntered`, the request or the deny still releases the
      // gate and awaits the Run in `finally` before anything closes.
      let iterationLive: B401LiveRun | undefined;
      try {
        // The real requeue owner after the previous ended Run, then the real
        // claim owner minting the Run this request runs in.
        const requeued = await real.requeue(prevClaim,
          `B2-401 round ${String(index)}: the previous Run was denied another attempt`);
        const session = await world.fixture.createS5Session(`b2-401-continuation-${String(index)}`);
        const claim = await real.claimRun({ sessionRef: session, planRef: PLAN_B2, taskId: task.taskId,
          requeueRef: requeued.ref, requestId: `b2-401-claim-${String(index)}` });
        const gated = gatedModel(index);
        const start = await real.prepareAndStart(claim, {
          model: gated.model, tools: [], writeScope: [], blockOnShell: false });
        iterationLive = { claim, started: start.started, release: gated.release };
        live = iterationLive;
        const entered = await waitEntered(real, world, claim);
        const asked = await requestService.requestRerun(workCtxOf(world, entered.run), {
          input: { task, runRef: entered.run.ref, command: COMMAND, reason: `round ${String(index)}` },
          // Zero-padded ids keep the created order equal to the canonical
          // refKey page order: the LAST built request really is on page 3.
          meta: { requestId: `b2-401-request-${String(index).padStart(3, '0')}`, expected: [] },
        });
        // Item 8: a real CRR-01 write returns the request plus its outcome.
        const write = committed(asked);
        if (write.value.outcome.status !== 'requested') throw new Error('the CRR write was not requested');
        requestIds.push(write.value.request.ref.requestId);
        // F-032: the LAST request (the one on page 3) gets the REAL
        // `allow_rerun` answer, so an `allowed`/unused request exists on the
        // last page and the hook's answer really depends on reading it. The
        // other 400 are refused through the same owner.
        const last = index === total;
        const card = await crrCardOf(world);
        const answered = await world.decisionActions.resolveDecision(world.fixture.ctx, {
          input: { source: card.source, selection: { kind: 'option', optionId: last ? 'allow_rerun' : 'deny' },
            text: last ? 'run it once' : 'not this time', annotations: [] },
          meta: { requestId: `b2-401-answer-${String(index)}`, expected: card.source.pins },
        });
        if (answered.status !== 'ready' || answered.value.state !== 'applied'
          || answered.value.action === null || answered.value.action.status !== 'committed') {
          throw new Error(`the answer did not apply: ${JSON.stringify(answered)}`);
        }
        const expectedState = last ? 'allowed' : 'denied';
        if ((answered.value.action.value as { state?: string }).state !== expectedState) {
          throw new Error(`the answer did not commit ${expectedState}: ${JSON.stringify(answered.value.action.value)}`);
        }
        // The LAST request is captured after its real answer commits.
        if (last) lastRequest = answered.value.action.value as unknown as CommandRerunRequestV1;
        // The Run ends only through the Runtime: release the model's gate and
        // await the real `startRun`; then read it back through the PUBLIC read.
        gated.release();
        await start.started.catch(() => undefined);
        const ended = await reads.readExecution(world.fixture.ctx, claim.runRef);
        const expected = END === 'crashed' ? 'crashed' : 'completed';
        if (ended.status !== 'ready' || ended.value.run.status !== 'ended'
          || ended.value.run.outcome !== expected) {
          throw new Error(`the continuation did not end ${expected}: ${JSON.stringify(ended)}`);
        }
        prevClaim = claim;
      } finally {
        if (iterationLive !== undefined) {
          iterationLive.release();
          await iterationLive.started.catch(() => undefined);
          if (live === iterationLive) live = undefined;
        }
      }
    }
    if (requestIds.length !== total || new Set(requestIds).size !== total) {
      throw new Error(`the world built ${String(requestIds.length)} requests, not ${String(total)} unique`);
    }
    if (lastRequest === undefined) throw new Error('the world built no last request');
    const lastRequestRefKey = commandRerunRequestRefKey(lastRequest.ref);

    const startNext = async (): Promise<B401NextRun> => {
      const requeued = await real.requeue(prevClaim,
        `B2-401: the next Run continues after the ${String(total)} refused requests`);
      const session = await world.fixture.createS5Session('b2-401-continuation-402');
      const claim = await real.claimRun({ sessionRef: session, planRef: PLAN_B2, taskId: task.taskId,
        requeueRef: requeued.ref, requestId: 'b2-401-claim-402' });
      const gated = gatedModel(total + 1);
      const start = await real.prepareAndStart(claim, {
        model: gated.model, tools: [], writeScope: [], blockOnShell: false });
      const liveRun: B401LiveRun = { claim, started: start.started, release: gated.release };
      live = liveRun;
      // Item 6: the handle clears `live` as soon as this Run ends; `close()`
      // only has to wait for a Run still in flight.
      const clearLive = (): void => { if (live === liveRun) live = undefined; };
      void start.started.then(clearLive, clearLive);
      try {
        const entered = await waitEntered(real, world, claim);
        prevClaim = claim;
        return { claim, entered, ctx: workCtxOf(world, entered.run),
          started: start.started, release: gated.release };
      } catch (error) {
        gated.release();
        await start.started.catch(() => undefined);
        clearLive();
        throw error;
      }
    };

    return {
      world, task, record, requestService, hook, ctx, workspace, counters,
      resetCounters() {
        counters.pages.clear();
        counters.crrWrites = 0;
        counters.pointReadKeys.length = 0;
        counters.recordReads.length = 0;
        counters.closureReads.length = 0;
        counters.packageReads.length = 0;
      },
      requestCount: requestIds.length,
      lastRequest,
      lastRequestRefKey,
      buildMs: Date.now() - buildMs,
      startNext,
      async close() {
        if (closed) return;
        closed = true;
        try {
          if (live !== undefined) {
            live.release();
            await live.started.catch(() => undefined);
            live = undefined;
          }
        } finally {
          // Item 6: release the gate, await the Run, close the union in finally.
          try {
            await real.closeUnion();
          } finally {
            await world.close();
          }
        }
      },
    };
  } catch (error) {
    // Item 6: release and await any Run still in flight BEFORE the union/store
    // close. (The loop's own `finally` normally leaves `live` empty.)
    if (live !== undefined) {
      live.release();
      await live.started.catch(() => undefined);
      live = undefined;
    }
    if (harness !== undefined) await harness.closeUnion().catch(() => undefined);
    await world.close().catch(() => undefined);
    throw error;
  }
}

/** The production `before_tool` call the Kernel would hand the hook. */
export const shellCall = (callId: string, command: string): ToolCall =>
  ({ schemaVersion: 1, callId, name: 'shell', arguments: { command } });
