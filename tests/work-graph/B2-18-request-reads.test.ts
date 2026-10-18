/**
 * Rework 2 item 4 (Codex 10) / B2-18 (L19a): the request owner's read bound and
 * its no-write return contract, reached entirely through the public path.
 *
 * There is no made-up Run, Kernel identity, position, cursor or answer: the
 * blocked record comes from the real `openK3BlockedReviewServices.seed` Run
 * (public claim -> production `startRun` with §5.1's blocking `shell` stand-in
 * -> the Host classifier / production draft / RUN-22) and the real
 * `skip_as_done` disposition. That first Run is already ended by the real
 * RUN-20/RUN-22 chain (read back: `ended`/`crashed`).
 *
 * The owner under test is the production `createCommandRerunRequestService`
 * with the REQUIRED canonical `readTaskClosure`; only the PUBLIC store read
 * port is wrapped with a counter (accounting/fault-injection).
 *
 * The R = 401 request row moved to the ONE shared 401-Run world
 * (`B2-401-world.test.ts`, rework 4 item 5), where the 401 real continuation
 * Runs are built once for both this row and B2-16 (iii).
 */
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { GoalRecordTransactionPort } from '../../src/core/record-store/ports.js';
import type { RecordLookupPort, RecordLookupRequest } from '../../src/core/record-store/lookup-ports.js';
import type { CommandRerunRequestReplyV1 } from '../../src/core/work-graph/model/command-rerun-request-contracts.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { createCommandRerunRequestService } from '../../src/core/work-graph/tasks/command-rerun-request-service.js';
import { createCommandRecognizer } from '../../src/core/work-graph/tasks/command-recognition.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { readTaskClosure } from '../../src/core/work-graph/tasks/plan-readers.js';
import {
  K3_CRR_BY_GOAL_STATE_LOOKUP, K3_CRR_BY_TASK_ALIAS_LOOKUP, K3_CRR_BY_TASK_LOOKUP,
} from '../../src/core/work-graph/tasks/command-rerun-request-codecs.js';
import { settleK3Review } from '../helpers/K3-proposal-round.js';
import { openK3BlockedReviewServices } from '../helpers/K3-blocked-command-fixture.js';
import { openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { crrCardOf } from '../helpers/B2-crr-world.js';
import { openRealWorkspace, type RealWorkspace } from '../helpers/K3-real-workspace.js';
import { GOAL_B, T, WORKSPACE_SCOPE } from '../helpers/S5-decision-fixture.js';

// §5.1's stand-in `shell`, hoisted per test file: the seed's real Run uses it.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: K3ReviewCardWorld[] = [];
const workspaces: RealWorkspace[] = [];
afterEach(async () => {
  for (const workspace of workspaces.splice(0)) await workspace.close();
  for (const world of worlds.splice(0)) await world.close();
});

type Reply = CommandRerunRequestReplyV1;
function committed(reply: Reply): Extract<Reply, { status: 'committed' }> {
  if (reply.status !== 'committed') throw new Error(`expected committed, got ${JSON.stringify(reply)}`);
  return reply;
}

type SeededBlockedRun = { record: UnknownCallReviewV1; claim: TaskClaim };

/**
 * The ONE real blocked-Run path: a public claim, the production `startRun` with
 * the §5.1 `shell` stand-in, the Host classifier / production draft / RUN-22,
 * and the real `skip_as_done` disposition that writes `blockedCommands`. The
 * Run is ended by the real RUN-20/RUN-22 chain; its claim is the requeue basis.
 */
async function realBlockedRun(world: K3ReviewCardWorld): Promise<SeededBlockedRun> {
  const services = await openK3BlockedReviewServices(world, {});
  const seeded = await services.seed({
    taskId: 'k3-20-a',
    commands: { 'b2-18-call-1': { command: 'echo k3-fixture' } },
    label: 'b2-18',
  });
  let record = seeded.record;
  if (record.status === 'pending_review') {
    record = await settleK3Review(world, record, { cause: 'review_unavailable' });
  }
  record = await services.answer(record, 'skip_as_done', { text: 'done' });
  if (record.blockedCommands.length === 0) throw new Error('② wrote no blockedCommands');
  return { record, claim: seeded.claim };
}

/** The real `work_run` context of one recorded Run (its own RunRef and role binding). */
function workCtxOf(world: K3ReviewCardWorld, run: RunSnapshot): CoreCallContext {
  return { projectId: run.ref.projectId, workspaceId: world.fixture.base.scope.workspaceId,
    principal: { kind: 'work_run', runRef: run.ref, roleBinding: run.roleBinding },
    materialReader: { kind: 'run', requester: run.ref },
    signal: world.fixture.ctx.signal };
}

describe.each(['memory', 'sqlite'] as const)('rework 2 item 4 / B2-18 request reads (%s)', kind => {
  it('listRequests issues exactly one physical page per call for all three filters', async () => {
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
    worlds.push(world);
    const { record } = await realBlockedRun(world);
    const base = world.records;
    const counts = new Map<string, number>();
    const countingRecorder = {
      readMany: (keys: readonly string[]) => base.readMany(keys),
      lookupCommit: (input: Parameters<GoalRecordTransactionPort['lookupCommit']>[0]) => base.lookupCommit(input),
      eventAt: (cursor: Parameters<GoalRecordTransactionPort['eventAt']>[0]) => base.eventAt(cursor),
      commit: (input: Parameters<GoalRecordTransactionPort['commit']>[0]) => base.commit(input),
      lookup: (request: RecordLookupRequest) => {
        counts.set(request.index, (counts.get(request.index) ?? 0) + 1);
        return base.lookup(request);
      },
    } as GoalRecordTransactionPort & RecordLookupPort;
    const service = createCommandRerunRequestService({
      records: countingRecorder,
      listTaskReviews: async () => ({ status: 'ready', value: [record] }),
      readTaskClosure: async (_ctx, target) => readTaskClosure(base, GOAL_B, target.taskId),
      recognize: async () => ({ status: 'ready', value: null }),
      now: () => T, eventId: () => 'b2-18-one-page',
    });
    const workspace = { projectId: 'P', workspaceId: WORKSPACE_SCOPE.workspaceId };
    const ctx = world.fixture.ctx;
    counts.clear();
    expect(await service.listRequests(ctx, { workspace,
      filter: { goalId: record.task.goalId, taskId: record.task.taskId }, page: { limit: 200 } }))
      .toMatchObject({ status: 'ready' });
    expect(counts.get(K3_CRR_BY_TASK_LOOKUP)).toBe(1);
    counts.clear();
    expect(await service.listRequests(ctx, { workspace,
      filter: { goalId: record.task.goalId, taskId: record.task.taskId,
        reviewRunId: record.ref.runId, alias: 1 }, page: { limit: 200 } }))
      .toMatchObject({ status: 'ready' });
    expect(counts.get(K3_CRR_BY_TASK_ALIAS_LOOKUP)).toBe(1);
    counts.clear();
    expect(await service.listRequests(ctx, { workspace,
      filter: { goalRef: GOAL_B, state: 'pending' }, page: { limit: 200 } }))
      .toMatchObject({ status: 'ready' });
    expect(counts.get(K3_CRR_BY_GOAL_STATE_LOOKUP)).toBe(1);
  }, 120_000);

  it('no-write branches say not_written and are not reported as committed', async () => {
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
    worlds.push(world);
    const { record, claim } = await realBlockedRun(world);
    const task = record.task;
    const base = world.records;
    let seq = 0;
    // F-021: the recognizer reads real files through the production workspace
    // reader (this row's commands are not runners, so it stays at zero reads).
    const workspace = await openRealWorkspace({
      root: join(world.fixture.base.directory, 'real-workspace'),
      workspace: { aggregateType: 'Workspace', projectId: task.projectId, workspaceId: record.workspaceId },
      files: { 'package.json': JSON.stringify({ scripts: { build: 'echo build' } }) },
    });
    workspaces.push(workspace);
    const service = createCommandRerunRequestService({
      records: base,
      listTaskReviews: async () => ({ status: 'ready', value: [record] }),
      readTaskClosure: async (_ctx, target) => readTaskClosure(base, GOAL_B, target.taskId),
      recognize: createCommandRecognizer({ readWorkspace: workspace }),
      now: () => T, eventId: () => `b2-18-nw-${String(++seq)}`,
    });
    const reads = createRunStateReader({ records: base });
    const firstRun = await reads.readExecution(world.fixture.ctx, claim.runRef);
    if (firstRun.status !== 'ready') throw new Error('the blocked record Run is not readable');
    const runRef = firstRun.value.run.ref;
    const ctx = workCtxOf(world, firstRun.value.run);
    const notBlocked = await service.requestRerun(ctx, {
      input: { task, runRef, command: 'git status', reason: 'not blocked' },
      meta: { requestId: 'b2-18-not-blocked', expected: [] },
    }) as unknown as Reply;
    expect(notBlocked).toEqual({ status: 'not_written', outcome: { status: 'not_blocked' } });

    const created = await service.requestRerun(ctx, {
      input: { task, runRef, command: 'echo k3-fixture', reason: 'please' },
      meta: { requestId: 'b2-18-write', expected: [] },
    }) as unknown as Reply;
    const write = committed(created);
    expect(write.value.outcome.status).toBe('requested');
    expect(write.cursor).toBeDefined();
    expect(write.value.request.ref.requestId).toBeTruthy();

    // Same alias, still pending: a no-write pending reply (item 3: it carries
    // the WAITING request's command), no fabricated cursor.
    const pending = await service.requestRerun(ctx, {
      input: { task, runRef, command: 'echo k3-fixture', reason: 'again' },
      meta: { requestId: 'b2-18-pending', expected: [] },
    }) as unknown as Reply;
    expect(pending).toEqual({ status: 'not_written', outcome: {
      status: 'pending', requestId: write.value.request.ref.requestId, command: 'echo k3-fixture' } });

    // Item 3's other no-write branch: an unused allowance names the waiting command.
    const card = await crrCardOf(world);
    const allowed = await world.decisionActions.resolveDecision(world.fixture.ctx, {
      input: { source: card.source, selection: { kind: 'option', optionId: 'allow_rerun' },
        text: 'once', annotations: [] },
      meta: { requestId: 'b2-18-allow', expected: card.source.pins },
    });
    if (allowed.status !== 'ready' || allowed.value.state !== 'applied'
      || allowed.value.action === null || allowed.value.action.status !== 'committed') {
      throw new Error(`the allowance did not apply: ${JSON.stringify(allowed)}`);
    }
    const again = await service.requestRerun(ctx, {
      input: { task, runRef, command: 'echo k3-fixture', reason: 'again' },
      meta: { requestId: 'b2-18-allowed', expected: [] },
    }) as unknown as Reply;
    expect(again).toEqual({ status: 'not_written', outcome: {
      status: 'allowed', requestId: write.value.request.ref.requestId, command: 'echo k3-fixture' } });
  }, 120_000);
});
