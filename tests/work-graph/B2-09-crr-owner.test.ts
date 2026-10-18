/**
 * B2-09 / rework 1 items 8 and 4 (L19a/L19): the CRR owner's identity, replay,
 * revision, allowance and no-write return contract.
 *
 * The record is real: ONE `pending_review` record from a real blocked Run
 * (`createK3PendingReview`: claim → production prepare → the Runtime's own
 * start/end over §5.1's shell stand-in, RUN-20/RUN-22 over the real draft),
 * settled, then answered `skip_as_done` through the real `resolveDecision` so ②
 * writes the real `blockedCommands`. The owner under test is the production
 * `createCommandRerunRequestService`; the Task-closure reader is a documented
 * test seam (the same one the composition injects from `readTaskClosure`).
 * F-021: its recognizer is the production one over the REAL workspace reader;
 * one row requests a script form that only the real `package.json` expansion
 * can match.
 */
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunSnapshot, TaskTriple } from '../../src/contracts/dispatch.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import type { CommandRerunRequestRef } from '../../src/contracts/command-rerun-request.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { CommandRerunRequestReplyV1 } from '../../src/core/work-graph/model/command-rerun-request-contracts.js';
import type { DecisionSourceV1 } from '../../src/contracts/goal-decisions.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort, RecordLookupRequest } from '../../src/core/record-store/lookup-ports.js';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { createCommandRecognizer } from '../../src/core/work-graph/tasks/command-recognition.js';
import {
  createCommandRerunRequestService, type CommandRerunRequestService,
} from '../../src/core/work-graph/tasks/command-rerun-request-service.js';
import {
  COMMAND_RERUN_REQUEST_CHANGED_EVENT_TYPE, COMMAND_RERUN_REQUEST_SCHEMA_ID,
} from '../../src/core/work-graph/tasks/command-rerun-request-codecs.js';
import { commandRerunRequestCardIdentity } from '../../src/core/work-graph/tasks/command-rerun-request-card.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import {
  createCommandRerunRequestApplicationAdapter, createDecisionActions,
} from '../../src/business/workflow/decision-actions.js';
import { createGoalSettingsService } from '../../src/core/work-graph/tasks/goal-settings-service.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import {
  createK3PendingReview, readK3ReviewCard, settleK3Review,
} from '../helpers/K3-proposal-round.js';
import { openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { openRealWorkspace } from '../helpers/K3-real-workspace.js';
import { T, WORKSPACE_SCOPE } from '../helpers/S5-decision-fixture.js';

// §5.1's stand-in `shell`, hoisted per test file (the fixture's real Run uses it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

type Reply = CommandRerunRequestReplyV1;
type Committed = Extract<Reply, { status: 'committed' }>;

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

let seq = 0;
const nextId = (): string => `b2-09-${String(++seq)}`;

type World = {
  world: K3ReviewCardWorld; record: UnknownCallReviewV1; task: TaskTriple; run: RunSnapshot;
  service: CommandRerunRequestService; workCtx: CoreCallContext; hostCtx: CoreCallContext;
  /** The production decision coordinator wired to THIS world's counted/faulted CRR owner. */
  decisionActions: ReturnType<typeof createDecisionActions>;
  counts: { commits: number }; setClosed(value: boolean): void;
  failNextCommit(): void; failClosure(): void;
  /** F-069: the NEXT `listTaskReviews` returns this fault; later calls use the real pager. */
  failNextReview(fault: ReviewFault): void;
};

/** F-069: one injected dependency result for the Task-review reader. */
type ReviewFault = () => Promise<ReadResult<readonly UnknownCallReviewV1[]>>;

/** F-069: a `not_ready` read still has to publish a real ReadStamp. */
const REVIEW_FAULT_CURSOR = 'f-069-review-read-cursor' as CommitCursor;

async function openCrr(kind: 'memory' | 'sqlite', options: { command?: string; files?: Record<string, string> } = {}): Promise<World> {
  // The production Kernel command reader over the SAME s5-kernel store: the
  // `skip_as_done` answer reads the declared command from the real record's Run.
  const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
  worlds.push(world);
  const workspace = await openRealWorkspace({
    root: join(world.fixture.base.directory, 'real-workspace'),
    workspace: { aggregateType: 'Workspace', projectId: world.fixture.base.scope.projectId,
      workspaceId: world.fixture.base.scope.workspaceId },
    files: options.files ?? {},
  });
  const pending = await settleK3Review(world, await createK3PendingReview(world, {
    taskId: 'k3-20-a', label: 'b2-09', callId: 'b2-09-call-1',
    command: options.command ?? 'echo k3-fixture',
  }), { cause: 'review_unavailable' });
  const { card } = await readK3ReviewCard(world, pending);
  const applied = await world.decisionActions.resolveDecision(world.fixture.ctx, {
    input: { source: card.source, selection: { kind: 'option', optionId: 'skip_as_done' },
      text: 'done', annotations: [] },
    meta: { requestId: nextId(), expected: card.source.pins },
  });
  if (applied.status !== 'ready' || applied.value.state !== 'applied'
    || applied.value.action === null || applied.value.action.status !== 'committed') {
    throw new Error(`the disposition did not apply: ${JSON.stringify(applied)}`);
  }
  const record = applied.value.action.value as unknown as UnknownCallReviewV1;
  const base = world.fixture.records;
  const runRead = await createRunStateReader({ records: base }).readExecution(world.fixture.ctx, record.runRef);
  if (runRead.status !== 'ready') throw new Error('the original Run is not readable');
  const run = runRead.value.run;
  const counts = { commits: 0 };
  const faults = { commit: 0, closure: 0, review: [] as ReviewFault[] };
  const active = { closed: false };
  const records = {
    readMany: (keys: readonly string[]) => base.readMany(keys),
    lookupCommit: (input: Parameters<GoalRecordTransactionPort['lookupCommit']>[0]) => base.lookupCommit(input),
    eventAt: (cursor: Parameters<GoalRecordTransactionPort['eventAt']>[0]) => base.eventAt(cursor),
    lookup: (request: RecordLookupRequest) => base.lookup(request),
    async commit(input: Parameters<GoalRecordTransactionPort['commit']>[0]) {
      const crr = input.records.some(row => row.schemaId === COMMAND_RERUN_REQUEST_SCHEMA_ID)
        || input.events.some(event => event.eventType === COMMAND_RERUN_REQUEST_CHANGED_EVENT_TYPE);
      if (crr && faults.commit > 0) {
        faults.commit -= 1;
        return { status: 'rejected' as const, code: 'unavailable' as const, reason: 'injected commit failure' };
      }
      const result = await base.commit(input);
      if (crr && result.status === 'committed') counts.commits += 1;
      return result;
    },
  } as GoalRecordTransactionPort & RecordLookupPort;
  const service = createCommandRerunRequestService({
    records,
    listTaskReviews: async (ctx, input) => {
      const fault = faults.review.shift();
      if (fault !== undefined) return fault();
      const all: UnknownCallReviewV1[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await world.reviews.listReviews(ctx, { workspace: WORKSPACE_SCOPE,
          filter: { goalRef: input.goalRef, taskId: input.taskId },
          page: { limit: 200, ...(cursor === undefined ? {} : { cursor }) } });
        if (page.status !== 'ready') return page;
        all.push(...page.value.items);
        if (page.value.nextCursor === null) return { status: 'ready', value: all };
        cursor = page.value.nextCursor;
      }
    },
    readTaskClosure: async (): Promise<ReadResult<{ closed: boolean;
      cause: 'satisfied' | 'cancelled' | 'superseded' | null }>> => {
      if (faults.closure > 0) {
        faults.closure -= 1;
        return { status: 'rejected', code: 'unavailable', reason: 'injected closure read failure' };
      }
      return { status: 'ready', value: { closed: active.closed,
        cause: active.closed ? 'satisfied' : null } };
    },
    // F-021: the production recognizer over the REAL workspace reader.
    recognize: createCommandRecognizer({ readWorkspace: workspace }),
    now: () => T, eventId: () => `b2-09-event-${String(++seq)}`,
  });
  const decisionActions = createDecisionActions({
    goalSettings: createGoalSettingsService({ records: world.fixture.records, now: () => T,
      newId: () => `b2-09-settings-${String(++seq)}`, operatorActor: world.fixture.operatorActor }),
    decisionMessages: {
      answerDecision: world.decisions.answerDecision.bind(world.decisions),
      readDecisionAnswer: world.decisions.readDecisionAnswer.bind(world.decisions),
      recordDecisionApplication: world.decisions.recordDecisionApplication.bind(world.decisions),
    },
    applicationReceipt: world.applicationReceipt,
    decisionApplications: { command_rerun_request: createCommandRerunRequestApplicationAdapter(service) },
  });
  const workCtx: CoreCallContext = {
    projectId: record.ref.projectId, workspaceId: record.workspaceId,
    principal: { kind: 'work_run', runRef: record.runRef, roleBinding: run.roleBinding },
    materialReader: { kind: 'run', requester: record.runRef },
    signal: world.fixture.ctx.signal,
  };
  return {
    world, record, task: record.task, run, service, workCtx, hostCtx: world.fixture.ctx,
    decisionActions, counts,
    setClosed: (value: boolean) => { active.closed = value; },
    failNextCommit: () => { faults.commit += 1; },
    failClosure: () => { faults.closure += 1; },
    failNextReview: (fault: ReviewFault) => { faults.review.push(fault); },
  };
}

function request(world: World, input: {
  command?: string; reason?: string; requestId?: string;
  rewriteOf?: { review: string; alias: number };
}) {
  return world.service.requestRerun(world.workCtx, {
    input: { task: world.task, runRef: world.record.runRef,
      command: input.command ?? 'echo k3-fixture', reason: input.reason ?? 'please allow this rerun',
      ...(input.rewriteOf === undefined ? {} : { rewriteOf: input.rewriteOf }) },
    meta: { requestId: input.requestId ?? nextId(), expected: [] },
  }) as unknown as Promise<Reply>;
}

function commit(reply: Reply): Committed {
  if (reply.status !== 'committed') throw new Error(`not committed: ${JSON.stringify(reply)}`);
  return reply;
}

/** F-069: the public read's ref for the request id this call would write. */
function requestRefOf(world: World, requestId: string): CommandRerunRequestRef {
  return { aggregateType: 'CommandRerunRequest', projectId: world.task.projectId,
    goalId: world.task.goalId, taskId: world.task.taskId, requestId };
}

type RequestRef = Parameters<World['service']['applyAnswer']>[1]['input']['requestRef'];

const refKeyOf = (ref: RequestRef): string =>
  `${ref.projectId}\u0000${ref.goalId}\u0000${ref.taskId}\u0000${ref.requestId}`;

/**
 * L19a/F-100: the REAL `command_rerun_request` source for this request, read
 * through the public card source (never hand-built). A request that has already
 * moved or closed is not on a page, so the real source read once is reused —
 * exactly the card the saved answer captured.
 */
const sourcesOf = new WeakMap<K3ReviewCardWorld, Map<string, DecisionSourceV1>>();
async function cardSourceOf(world: World, requestRef: RequestRef): Promise<DecisionSourceV1> {
  let sources = sourcesOf.get(world.world);
  if (sources === undefined) { sources = new Map(); sourcesOf.set(world.world, sources); }
  const key = refKeyOf(requestRef);
  const cached = sources.get(key);
  if (cached !== undefined) return cached;
  const page = await world.world.commandRerunCardSource.readPage(world.world.fixture.ctx, {
    workspace: WORKSPACE_SCOPE,
    goalRef: { aggregateType: 'Goal', projectId: requestRef.projectId, goalId: requestRef.goalId },
    page: { limit: 100 },
  });
  if (page.status !== 'ready') throw new Error(`B2-09: the CRR card page failed: ${JSON.stringify(page)}`);
  const card = page.value.items.find((item) => {
    const identity = commandRerunRequestCardIdentity(item.source);
    return identity !== null && refKeyOf(identity.requestRef) === key;
  });
  if (card === undefined) throw new Error(`B2-09: no CRR card for ${key}`);
  sources.set(key, card.source);
  return card.source;
}

/**
 * L19a: the answer is SAVED through the real public decision path FIRST (the
 * real card source), and the CRR application ② is what this helper returns.
 * `messageId` is the answer's own decision request identity: repeating it
 * replays the saved answer and its receipt; a fresh id is a new answer attempt.
 */
async function answer(world: World, requestRef: RequestRef,
  selection: 'allow_rerun' | 'deny' | 'deny_final', revision: number, messageId = nextId()) {
  const source = await cardSourceOf(world, requestRef);
  const expected = source.pins.map(pin => pin.ref.aggregateType === 'CommandRerunRequest'
    && refKeyOf(pin.ref as unknown as RequestRef) === refKeyOf(requestRef)
    ? { ref: structuredClone(pin.ref), revision } : { ref: structuredClone(pin.ref), revision: pin.revision });
  const resolved = await world.decisionActions.resolveDecision(world.hostCtx, {
    input: { source, selection: { kind: 'option', optionId: selection }, text: '', annotations: [] },
    meta: { requestId: `b2-09-answer:${messageId}`, expected },
  });
  if (resolved.status !== 'ready') return resolved;
  return resolved.value.action;
}

describe('B2-09 CRR identity, replay, revision and allowance', () => {
  it.each(['memory', 'sqlite'] as const)('F-021 (%s): a script-form request expands through the real workspace reader', async (kind) => {
    const world = await openCrr(kind, {
      command: 'prisma migrate deploy',
      files: { 'package.json': JSON.stringify({ scripts: { migrate: 'prisma migrate deploy' } }) },
    });
    const created = commit(await request(world, { command: 'npm run migrate' }));
    expect(created.value.request.match).toMatchObject({ kind: 'action',
      action: { text: 'npm run migrate' }, viaScript: { scriptName: 'migrate', dir: '.' } });
  });

  it.each(['memory', 'sqlite'] as const)('the same request identity and fingerprint replays the original write with its cursor (%s)', async kind => {
    const world = await openCrr(kind);
    const requestId = nextId();
    const first = commit(await request(world, { requestId }));
    expect(first.value.outcome).toMatchObject({ status: 'requested' });
    expect(first.cursor).toBeTruthy();
    expect(first.replayed).toBe(false);
    const before = world.counts.commits;
    const second = commit(await request(world, { requestId }));
    expect(second.replayed).toBe(true);
    expect(second.cursor).toEqual(first.cursor);
    expect(second.value.request.ref).toEqual(first.value.request.ref);
    expect(world.counts.commits).toBe(before);
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)('the same identity with different content is idempotency_conflict (%s)', async kind => {
    const world = await openCrr(kind);
    const requestId = nextId();
    commit(await request(world, { requestId }));
    const before = world.counts.commits;
    expect(await request(world, { requestId, command: 'echo other' }))
      .toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    expect(world.counts.commits).toBe(before);
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)('applying the same answer twice replays the first application once (%s)', async kind => {
    const world = await openCrr(kind);
    const created = commit(await request(world, {}));
    const first = await answer(world, created.value.request.ref, 'allow_rerun', 1, 'b2-09-same-answer');
    expect(first).toMatchObject({ status: 'committed', replayed: false, value: { revision: 2, state: 'allowed' } });
    const before = world.counts.commits;
    const second = await answer(world, created.value.request.ref, 'allow_rerun', 1, 'b2-09-same-answer');
    expect(second).toMatchObject({ status: 'committed', replayed: true });
    expect(world.counts.commits).toBe(before);
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)('a moved request answers revision_conflict with the current revision (%s)', async kind => {
    const world = await openCrr(kind);
    const created = commit(await request(world, {}));
    expect(await answer(world, created.value.request.ref, 'allow_rerun', 1))
      .toMatchObject({ status: 'committed', value: { revision: 2 } });
    const stale = await answer(world, created.value.request.ref, 'deny', 1, nextId());
    expect(stale).toMatchObject({ status: 'rejected', code: 'revision_conflict',
      current: [{ ref: created.value.request.ref, revision: 2 }] });
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)('consumeAllowance records usedBy in the returned request state (%s)', async kind => {
    const world = await openCrr(kind);
    const created = commit(await request(world, {}));
    expect(await answer(world, created.value.request.ref, 'allow_rerun', 1))
      .toMatchObject({ status: 'committed', value: { state: 'allowed' } });
    const usedBy = { runId: world.record.runRef.runId, callId: 'call-7' };
    const used = await world.service.consumeAllowance(world.workCtx, {
      input: { requestRef: created.value.request.ref, usedBy },
      meta: { requestId: nextId(), expected: [{ ref: created.value.request.ref as never, revision: 2 }] },
    });
    expect(used).toMatchObject({ status: 'committed', replayed: false, value: {
      revision: 3, state: 'used', usedAt: T, usedBy,
    } });
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)('a failed allowance commit leaves the allowance untouched and rejects the call (%s)', async kind => {
    const world = await openCrr(kind);
    const created = commit(await request(world, {}));
    await answer(world, created.value.request.ref, 'allow_rerun', 1);
    world.failNextCommit();
    expect(await world.service.consumeAllowance(world.workCtx, {
      input: { requestRef: created.value.request.ref, usedBy: { runId: world.record.runRef.runId, callId: 'call-8' } },
      meta: { requestId: nextId(), expected: [{ ref: created.value.request.ref as never, revision: 2 }] },
    })).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(await world.service.readRequest(world.hostCtx, { ref: created.value.request.ref }))
      .toMatchObject({ status: 'ready', value: { revision: 2, state: 'allowed', usedAt: null } });
  }, 120_000);
});

describe.each(['memory', 'sqlite'] as const)('B2-09 / rework 1 item 8: the no-write return contract (%s)', kind => {
  it('not_blocked, pending and allowed are not_written; only CRR-01 commits', async () => {
    const world = await openCrr(kind);
    expect(await request(world, { command: 'git status' }))
      .toEqual({ status: 'not_written', outcome: { status: 'not_blocked' } });
    expect(world.counts.commits).toBe(0);

    const created = await request(world, {});
    const createdWrite = commit(created);
    expect(createdWrite.value.outcome.status).toBe('requested');
    expect(createdWrite.cursor).toBeTruthy();

    // Same alias, still pending: no write and no fabricated cursor. Rework 2
    // item 3: the waiting record's own command comes back with the requestId.
    expect(await request(world, {})).toEqual({ status: 'not_written', outcome: {
      status: 'pending', requestId: createdWrite.value.request.ref.requestId,
      command: createdWrite.value.request.command } });
    expect(world.counts.commits).toBe(1);

    expect(await answer(world, createdWrite.value.request.ref, 'allow_rerun', 1))
      .toMatchObject({ status: 'committed', value: { state: 'allowed' } });
    expect(await request(world, {})).toEqual({ status: 'not_written', outcome: {
      status: 'allowed', requestId: createdWrite.value.request.ref.requestId,
      command: createdWrite.value.request.command } });
    expect(world.counts.commits).toBe(2);
  }, 120_000);

  it('CRR-07 forms_added on a denied_final request commits with its real cursor and refused outcome', async () => {
    const world = await openCrr(kind);
    const created = commit(await request(world, {}));
    expect(await answer(world, created.value.request.ref, 'deny_final', 1))
      .toMatchObject({ status: 'committed', value: { state: 'denied_final' } });
    // An unrecognised form declared for the alias appends to the denied record.
    const declaredRequestId = nextId();
    const declared = await request(world, { requestId: declaredRequestId, command: 'echo custom', rewriteOf: {
      review: world.record.ref.runId, alias: 1 } });
    const write = commit(declared);
    expect(write.value.outcome).toEqual({ status: 'refused', reason: 'denied_final' });
    expect(write.cursor).toBeTruthy();
    expect(write.replayed).toBe(false);
    expect(write.value.request.declaredForms.map(form => form.text)).toContain('echo custom');

    // Replaying the SAME tool call (same request id and content) returns the
    // original receipt; a brand-new call with an already-declared form does not
    // append a duplicate.
    const replay = commit(await request(world, { requestId: declaredRequestId, command: 'echo custom', rewriteOf: {
      review: world.record.ref.runId, alias: 1 } }));
    expect(replay.replayed).toBe(true);
    expect(replay.cursor).toEqual(write.cursor);
  }, 120_000);

  it('a replayed pending forms_added reply carries the waiting record\'s command', async () => {
    const world = await openCrr(kind);
    const first = commit(await request(world, { command: 'echo first-form', rewriteOf: {
      review: world.record.ref.runId, alias: 1 } }));
    expect(first.value.outcome).toMatchObject({ status: 'requested' });
    // A different declared form appends to the SAME pending record.
    const requestId = nextId();
    const second = commit(await request(world, { requestId, command: 'echo second-form', rewriteOf: {
      review: world.record.ref.runId, alias: 1 } }));
    expect(second.value.outcome).toMatchObject({ status: 'pending',
      requestId: first.value.request.ref.requestId });

    // Replaying the forms_added call replays its receipt: the pending outcome
    // must still name the record's waiting command, not the replayed input.
    const replay = commit(await request(world, { requestId, command: 'echo second-form', rewriteOf: {
      review: world.record.ref.runId, alias: 1 } }));
    expect(replay.replayed).toBe(true);
    expect(replay.value.outcome).toEqual({ status: 'pending',
      requestId: first.value.request.ref.requestId, command: 'echo first-form' });
  }, 120_000);
});

describe.each(['memory', 'sqlite'] as const)('B2-09 / rework 1 item 4: closed derived from the one closure (%s)', kind => {
  it('readRequest derives closed without persisting while the Task is closed', async () => {
    const world = await openCrr(kind);
    const created = commit(await request(world, {}));
    world.setClosed(true);
    expect(await world.service.readRequest(world.hostCtx, { ref: created.value.request.ref }))
      .toMatchObject({ status: 'ready', value: { revision: 1, state: 'closed' } });
    expect(world.counts.commits).toBe(1);
  }, 120_000);

  it('a closure read failure is unavailable, never still valid', async () => {
    const world = await openCrr(kind);
    const created = commit(await request(world, {}));
    world.failClosure();
    expect(await world.service.readRequest(world.hostCtx, { ref: created.value.request.ref }))
      .toMatchObject({ status: 'rejected', code: 'unavailable' });
  }, 120_000);

  it('the next applyAnswer persists closed and returns busy', async () => {
    const world = await openCrr(kind);
    const created = commit(await request(world, {}));
    world.setClosed(true);
    const before = world.counts.commits;
    expect(await answer(world, created.value.request.ref, 'allow_rerun', 1))
      .toMatchObject({ status: 'rejected', code: 'busy' });
    expect(world.counts.commits).toBe(before + 1);
    world.setClosed(false);
    expect(await world.service.readRequest(world.hostCtx, { ref: created.value.request.ref }))
      .toMatchObject({ status: 'ready', value: { revision: 2, state: 'closed' } });
  }, 120_000);

  it('the next requestRerun persists closed and returns busy', async () => {
    const world = await openCrr(kind);
    commit(await request(world, {}));
    world.setClosed(true);
    const before = world.counts.commits;
    expect(await request(world, { command: 'echo k3-fixture' }))
      .toMatchObject({ status: 'rejected', code: 'busy' });
    expect(world.counts.commits).toBe(before + 1);
  }, 120_000);

  it('consumeAllowance on a closed Task rejects and voids the allowance', async () => {
    const world = await openCrr(kind);
    const created = commit(await request(world, {}));
    await answer(world, created.value.request.ref, 'allow_rerun', 1);
    world.setClosed(true);
    const before = world.counts.commits;
    expect(await world.service.consumeAllowance(world.workCtx, {
      input: { requestRef: created.value.request.ref, usedBy: { runId: world.record.runRef.runId, callId: 'closed-call' } },
      meta: { requestId: nextId(), expected: [{ ref: created.value.request.ref as never, revision: 2 }] },
    })).toMatchObject({ status: 'rejected', code: 'busy' });
    expect(world.counts.commits).toBe(before + 1);
  }, 120_000);

  it('listRequests task form returns pending items as closed', async () => {
    const world = await openCrr(kind);
    const created = commit(await request(world, {}));
    world.setClosed(true);
    const page = await world.service.listRequests(world.hostCtx, {
      workspace: { projectId: 'P', workspaceId: WORKSPACE_SCOPE.workspaceId },
      filter: { goalId: world.task.goalId, taskId: world.task.taskId }, page: { limit: 200 },
    });
    expect(page).toMatchObject({ status: 'ready', value: { items: [{ revision: 1, state: 'closed' }] } });
    expect(world.counts.commits).toBe(1);
    expect(created.value.request.ref.requestId).toBeTruthy();
  }, 120_000);

  it('a closure read failure makes the task list unavailable, never open', async () => {
    const world = await openCrr(kind);
    commit(await request(world, {}));
    world.failClosure();
    expect(await world.service.listRequests(world.hostCtx, {
      workspace: { projectId: 'P', workspaceId: WORKSPACE_SCOPE.workspaceId },
      filter: { goalId: world.task.goalId, taskId: world.task.taskId }, page: { limit: 200 },
    })).toMatchObject({ status: 'rejected', code: 'unavailable' });
  }, 120_000);
});

/**
 * F-069: the owner ITSELF meets a Task-review read that is not ready. The
 * production `listTaskReviews` wiring is the real pager over this world; the
 * fault queue makes exactly the NEXT reader call return one failure, and every
 * later call delegates to that real pager. The request is driven through the
 * public `requestRerun` entry, and the public `readRequest` shows nothing was
 * written for the id the call would have used.
 */
describe.each(['memory', 'sqlite'] as const)('F-069: a failed Task-review read refuses the request before any write (%s)', kind => {
  it('a not_ready read is unavailable and leaves no request', async () => {
    const world = await openCrr(kind);
    world.failNextReview(async () => ({ status: 'not_ready', observed: null,
      required: { kind: 'platform', cursor: REVIEW_FAULT_CURSOR } }));
    const requestId = nextId();
    expect(await request(world, { requestId })).toEqual({ status: 'rejected', code: 'unavailable',
      reason: 'the task review records are not readable' });
    expect(await world.service.readRequest(world.hostCtx, { ref: requestRefOf(world, requestId) }))
      .toEqual({ status: 'not_found' });
    expect(world.counts.commits).toBe(0);
  }, 120_000);

  it('a cancelled read is propagated as cancelled and leaves no request', async () => {
    const world = await openCrr(kind);
    world.failNextReview(async () => ({ status: 'rejected', code: 'cancelled',
      reason: 'injected review read cancellation' }));
    const requestId = nextId();
    expect(await request(world, { requestId })).toEqual({ status: 'rejected', code: 'cancelled',
      reason: 'injected review read cancellation' });
    expect(await world.service.readRequest(world.hostCtx, { ref: requestRefOf(world, requestId) }))
      .toEqual({ status: 'not_found' });
    expect(world.counts.commits).toBe(0);
  }, 120_000);

  it('an unavailable read is propagated as unavailable and leaves no request', async () => {
    const world = await openCrr(kind);
    world.failNextReview(async () => ({ status: 'rejected', code: 'unavailable',
      reason: 'injected review read failure' }));
    const requestId = nextId();
    expect(await request(world, { requestId })).toEqual({ status: 'rejected', code: 'unavailable',
      reason: 'injected review read failure' });
    expect(await world.service.readRequest(world.hostCtx, { ref: requestRefOf(world, requestId) }))
      .toEqual({ status: 'not_found' });
    expect(world.counts.commits).toBe(0);
  }, 120_000);
});
