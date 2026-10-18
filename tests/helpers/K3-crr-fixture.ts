/**
 * K3 L19a: one real CRR world for the B2-03/B2-09/B2-14 owner tests.
 *
 * It reuses the blocked-command fixture (a real Work Run whose `shell` call
 * went through §5.1's stand-in; the real Kernel facts, record and `②`'s
 * `blockedCommands`), then builds the CRR owner over the SAME record store
 * (which registers `COMMAND_RERUN_REQUEST_RECORD_SCHEMAS`). Only the workspace
 * file reader is a test input→output seam (literal `package.json` content);
 * the Task closure is the production `plan-readers.readTaskClosure` over the
 * same records, and the recognizer is the real one.
 */
import { createHash } from 'node:crypto';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunRef, RunSnapshot, TaskTriple } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort, RecordLookupRequest } from '../../src/core/record-store/lookup-ports.js';
import { createCommandRecognizer } from '../../src/core/work-graph/tasks/command-recognition.js';
import {
  createCommandRerunRequestService, type CommandRerunRequestService,
} from '../../src/core/work-graph/tasks/command-rerun-request-service.js';
import {
  COMMAND_RERUN_REQUEST_CHANGED_EVENT_TYPE, COMMAND_RERUN_REQUEST_SCHEMA_ID,
  K3_CRR_BY_TASK_ALIAS_LOOKUP,
} from '../../src/core/work-graph/tasks/command-rerun-request-codecs.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createTaskRequeueService } from '../../src/core/work-graph/tasks/requeue-service.js';
import { readTaskClosure } from '../../src/core/work-graph/tasks/plan-readers.js';
import { openK3BlockedCommandWorld, type K3BlockedCommandWorld } from './K3-blocked-command-fixture.js';
import { GOAL_B, PLAN_B2, T, WORKSPACE_SCOPE } from './S5-decision-fixture.js';

export type CrrWorld = {
  blocked: K3BlockedCommandWorld;
  crr: CommandRerunRequestService;
  /** The record after the real `skip_as_done` (with `blockedCommands`). */
  record: UnknownCallReviewV1;
  run: RunSnapshot;
  task: TaskTriple;
  workCtx: CoreCallContext;
  hostCtx: CoreCallContext;
  counts: { crrCommits: number; aliasLookups: number };
  /** Fail the NEXT CRR write commit once (rejected `unavailable`). */
  failNextCrrCommit(): void;
  /** A real second Work Run of the same Task (requeue + claim). */
  createContinuationRun(): Promise<{ runRef: RunRef; ctx: CoreCallContext; run: RunSnapshot }>;
  close(): Promise<void>;
};

const sha256Of = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

export async function openCrrWorld(kind: 'memory' | 'sqlite' = 'memory', options: {
  taskId?: string;
  commands?: Record<string, { command: string; cwd?: string | null }>;
  files?: Record<string, string>;
} = {}): Promise<CrrWorld> {
  const taskId = options.taskId ?? 'k3-20-a';
  const commands = options.commands ?? { c1: { command: 'npm run db:migrate' } };
  const files = options.files ?? {
    'package.json': JSON.stringify({ scripts: { 'db:migrate': 'prisma migrate deploy' } }),
  };
  const blocked = await openK3BlockedCommandWorld(kind, { taskId, commands, files });
  const applied = await blocked.answer(blocked.record, 'skip_as_done');
  if (applied.blockedCommands.length === 0) {
    throw new Error('K3 CRR fixture: skip_as_done wrote no blocked command');
  }
  const runRead = await createRunStateReader({ records: blocked.world.fixture.records })
    .readExecution(blocked.world.fixture.ctx, applied.runRef);
  if (runRead.status !== 'ready') throw new Error(`K3 CRR fixture: the Run is not readable`);
  const run = runRead.value.run;
  const task: TaskTriple = { projectId: applied.task.projectId, goalId: applied.task.goalId, taskId };
  const workCtx: CoreCallContext = {
    projectId: applied.ref.projectId, workspaceId: applied.workspaceId,
    principal: { kind: 'work_run', runRef: applied.runRef, roleBinding: run.roleBinding },
    materialReader: { kind: 'run', requester: applied.runRef },
    signal: blocked.world.fixture.ctx.signal,
  };
  const hostCtx = blocked.world.fixture.ctx;
  const faults = { commit: 0 };
  const counts = { crrCommits: 0, aliasLookups: 0 };
  const base = blocked.world.fixture.records;
  const records = {
    readMany: (keys: readonly string[]) => base.readMany(keys),
    lookupCommit: (input: { identityKey: string; fingerprint: string }) => base.lookupCommit(input),
    eventAt: (cursor: Parameters<typeof base.eventAt>[0]) => base.eventAt(cursor),
    lookup: (request: RecordLookupRequest) => {
      if (request.index === K3_CRR_BY_TASK_ALIAS_LOOKUP) counts.aliasLookups += 1;
      return base.lookup(request);
    },
    commit: (input: Parameters<typeof base.commit>[0]) => {
      const crrWrite = input.records.some(record => record.schemaId === COMMAND_RERUN_REQUEST_SCHEMA_ID)
        || input.events.some(event => event.eventType === COMMAND_RERUN_REQUEST_CHANGED_EVENT_TYPE);
      if (crrWrite) {
        if (faults.commit > 0) {
          faults.commit -= 1;
          return Promise.resolve({ status: 'rejected' as const, code: 'unavailable' as const,
            reason: 'injected CRR commit failure' });
        }
        counts.crrCommits += 1;
      }
      return base.commit(input);
    },
  } as GoalRecordTransactionPort & RecordLookupPort & typeof base;

  const readTaskReviews = async (
    ctx: CoreCallContext, input: { goalRef: { aggregateType: 'Goal'; projectId: string; goalId: string }; taskId: string },
  ) => {
    const all: UnknownCallReviewV1[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await blocked.reviews.listReviews(ctx, { workspace: WORKSPACE_SCOPE,
        filter: { goalRef: input.goalRef, taskId: input.taskId },
        page: { limit: 200, ...(cursor === undefined ? {} : { cursor }) } });
      if (page.status !== 'ready') return page;
      all.push(...page.value.items);
      if (page.value.nextCursor === null) break;
      cursor = page.value.nextCursor;
    }
    return { status: 'ready' as const, value: all };
  };
  const readWorkspace = {
    readWorkspace: async (_ctx: CoreCallContext, input: { path: string }) => {
      const content = files[input.path];
      if (content === undefined) {
        return { status: 'rejected' as const, code: 'not_found' as const,
          reason: `no such workspace file: ${input.path}` };
      }
      return { status: 'ready' as const, value: {
        path: input.path, content, digest: sha256Of(content), sizeBytes: Buffer.byteLength(content, 'utf8'),
        digestBasis: 'raw_bytes' as const, version: { kind: 'working_tree' as const }, readAt: T,
      } };
    },
  };
  let seq = 0;
  const crr = createCommandRerunRequestService({
    records,
    listTaskReviews: readTaskReviews,
    // Rework 1 item 4 / rework 4 item 3: the ONE canonical Task-closure read.
    // No boolean stand-in: the production reader derives the closure from the
    // same records the Plan owner writes.
    readTaskClosure: async (_ctx, continuationTask) => readTaskClosure(base,
      { aggregateType: 'Goal', projectId: GOAL_B.projectId, goalId: GOAL_B.goalId }, continuationTask.taskId),
    recognize: createCommandRecognizer({ readWorkspace }),
    now: () => T,
    eventId: () => `crr-fixture-event-${String(++seq)}`,
  });

  async function createContinuationRun(): Promise<{ runRef: RunRef; ctx: CoreCallContext; run: RunSnapshot }> {
    const f = blocked.world.fixture;
    const reads = createRunStateReader({ records: base });
    let requeueSeq = 0;
    const requeues = createTaskRequeueService({
      records: base, reads,
      workspaceHost: { async resolveRoot() {
        return { status: 'ready' as const, value: { root: '/tmp/k3-crr-fixture', workspaceRevision: 1 } };
      } },
      source: { async captureDigest() { return { status: 'ready' as const, sourceDigest: 'a'.repeat(64) }; } },
      materials: { async storeArtifact() { throw new Error('the CRR fixture stores no artifact'); },
        async openArtifact() { throw new Error('the CRR fixture opens no artifact'); } },
      messages: { async readMessage() { return { status: 'not_found' as const }; } },
      now: () => T, eventId: () => `crr-requeue-event-${String(++requeueSeq)}`,
    });
    const goal = await f.b2.base.plans.queryGoal(hostCtx, GOAL_B);
    if (goal.status !== 'ready') throw new Error('K3 CRR fixture: the Goal is not readable');
    const runReadAgain = await reads.readExecution(hostCtx, applied.runRef);
    if (runReadAgain.status !== 'ready') throw new Error('K3 CRR fixture: the Run is not readable');
    const requeued = await requeues.requeueTask(hostCtx, {
      input: { taskRef: task, afterRunRef: applied.runRef, reason: 'continue after the CRR' },
      meta: { requestId: `crr-requeue-${String(++seq)}`, expected: [
        { ref: GOAL_B, revision: goal.value.goal.revision },
        { ref: applied.runRef, revision: runReadAgain.value.run.revision },
      ] },
    });
    if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') {
      throw new Error(`K3 CRR fixture: the requeue did not commit: ${JSON.stringify(requeued)}`);
    }
    const session = await f.createS5Session(`crr-continuation-${String(++seq)}`);
    const card = await f.b2.base.sessionsPort.readSession(hostCtx, session);
    if (card.status !== 'ready') throw new Error('K3 CRR fixture: the Session is not readable');
    const claimed = await f.b2.base.service.claimTask(hostCtx, {
      input: { goalRef: GOAL_B, planRef: PLAN_B2, taskId, sessionRef: session,
        roleBinding: runReadAgain.value.run.roleBinding, budget: runReadAgain.value.run.budget,
        requeueRef: requeued.value.requeue.ref },
      meta: { requestId: `crr-continuation-claim-${String(++seq)}`, expected: [
        { ref: GOAL_B, revision: goal.value.goal.revision },
        { ref: { aggregateType: 'Workspace', projectId: 'P', workspaceId: 'W' }, revision: f.workspace.revision },
        { ref: plainSessionRefToAggregate(session), revision: card.value.record.revision },
      ] },
    });
    if (claimed.status !== 'committed') throw new Error(`K3 CRR fixture: the continuation claim failed: ${JSON.stringify(claimed)}`);
    const claim = claimed.value;
    // The request owner reads no Run state; the claimed (not yet entered) Run is enough.
    const continuationRun = await reads.readExecution(hostCtx, claim.runRef);
    if (continuationRun.status !== 'ready') throw new Error('K3 CRR fixture: the continuation Run is not readable');
    const entered = continuationRun.value.run;
    return {
      runRef: claim.runRef, run: entered,
      ctx: { projectId: claim.runRef.projectId, workspaceId: applied.workspaceId,
        principal: { kind: 'work_run', runRef: claim.runRef, roleBinding: entered.roleBinding },
        materialReader: { kind: 'run', requester: claim.runRef },
        signal: f.ctx.signal },
    };
  }

  return {
    blocked, crr, record: applied, run, task, workCtx, hostCtx,
    counts,
    failNextCrrCommit: () => { faults.commit += 1; },
    createContinuationRun,
    close: () => blocked.close(),
  };
}
