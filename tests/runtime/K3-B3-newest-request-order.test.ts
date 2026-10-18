/**
 * K3 B3 rework 10, F-098 (G6): ONE "newest request" order in the continuation
 * brief and on the request card.
 *
 * The prior state is reached only through public owners: two real blocked / review
 * steps (`blockedRecordWithClaim`: real Run -> RUN-20/RUN-22 -> `skip_as_done`),
 * the public request entry `requestRerun` (the injected clock and
 * `meta.requestId` make the two `a`/`B` requests, whose locale order and
 * code-unit order disagree), the public decision answer, a real continuation
 * claim, the production prepare (its assembled continuation brief carries the
 * `requestState`), and the public card read. The third request uses a second
 * real owner over the SAME records with a later injected Host clock (A8).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { createCommandRecognizer } from '../../src/core/work-graph/tasks/command-recognition.js';
import {
  createCommandRerunRequestService,
} from '../../src/core/work-graph/tasks/command-rerun-request-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { readTaskClosure } from '../../src/core/work-graph/tasks/plan-readers.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import {
  blockedRecordWithClaim, crrCardOf, CRR_COMMAND, requestRerunOf, requeueBlockedRecord, runIdGeneratorOf,
} from '../helpers/B2-crr-world.js';
import { openB2HookWorld, runHook } from '../helpers/B2-blocked-runtime.js';
import { openRealRunHarness } from '../helpers/K3-35-continuation-fixture.js';
import { prepareContinuation } from '../helpers/K3-35-prepare.js';
import { PLAN_B2, T, WORKSPACE_SCOPE } from '../helpers/S5-decision-fixture.js';

// §5.1's blocking `shell` stand-in, hoisted per test file: the record Run's
// real Kernel Turn holds its first call so RUN-20/RUN-22 read a real unresolved
// call. The stand-in is an injected dependency, never a fact.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

/** The real Task-review paging read the request owner requires. */
async function taskReviewsOf(world: K3ReviewCardWorld, ctx: CoreCallContext,
  input: { goalRef: { aggregateType: 'Goal'; projectId: string; goalId: string }; taskId: string }) {
  const page = await world.reviews.listReviews(ctx, { workspace: WORKSPACE_SCOPE,
    filter: { goalRef: input.goalRef, taskId: input.taskId }, page: { limit: 200 } });
  return page.status === 'ready' ? { status: 'ready' as const, value: page.value.items } : page;
}

/** The public Work-Run context of a claimed Run (the owner reads no Run state). */
async function workRunContextOf(world: K3ReviewCardWorld, runRef: {
  aggregateType: 'Run'; projectId: string; goalId: string; runId: string }): Promise<CoreCallContext> {
  const read = await createRunStateReader({ records: world.records }).readExecution(world.fixture.ctx, runRef);
  if (read.status !== 'ready') throw new Error(`the continuation Run is not readable: ${JSON.stringify(read)}`);
  return {
    projectId: WORKSPACE_SCOPE.projectId, workspaceId: WORKSPACE_SCOPE.workspaceId,
    principal: { kind: 'work_run', runRef, roleBinding: read.value.run.roleBinding },
    materialReader: { kind: 'run', requester: runRef },
    signal: world.fixture.ctx.signal,
  };
}

describe.each(['memory', 'sqlite'] as const)('F-098: one newest-request order (%s)', kind => {
  it('the brief and the card both take request `a` before `B` at the same createdAt, and list `a`, `B` on the later card', async () => {
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
    worlds.push(world);
    const taskId = 'k3-20-a';
    const blocked = await blockedRecordWithClaim(world, taskId, `f098-${kind}`,
      [{ callId: `f098-call-${kind}`, command: CRR_COMMAND }]);
    const record: UnknownCallReviewV1 = blocked.record;

    // Request `a` from the reviewed Run at the fixture's fixed clock T.
    const a = await requestRerunOf(world, record, 'a', CRR_COMMAND, 'the first request');
    expect(a).toMatchObject({ state: 'pending', createdAt: T, ref: { requestId: 'a' } });
    // Deny `a` through the saved public decision answer.
    const aCard = await crrCardOf(world);
    const denied = await world.decisionActions.resolveDecision(world.fixture.ctx, {
      input: { source: aCard.source, selection: { kind: 'option', optionId: 'deny' }, text: '', annotations: [] },
      meta: { requestId: `f098-deny-${kind}`, expected: aCard.source.pins },
    });
    expect(denied).toMatchObject({ status: 'ready', value: { state: 'applied' } });

    // `B` comes from ANOTHER real Run of the same Task (a public requeue +
    // claim); the denied record names the reviewed Run, so `denied_in_this_run`
    // cannot refuse it. The owner entry is used directly so the caller owns the
    // requestId and the fixture clock.
    const requeue = await requeueBlockedRecord(world, blocked.claim, `f098 continuation ${kind}`);
    const harness = await openRealRunHarness(world, { newId: runIdGeneratorOf(world) });
    const session = await world.fixture.createS5Session(`f098-continuation-session-${kind}`);
    const continuation = await harness.claimRun({ sessionRef: session, planRef: PLAN_B2, taskId,
      requeueRef: requeue.ref, requestId: `f098-continuation-claim-${kind}` });
    const ctx = await workRunContextOf(world, continuation.runRef);
    const bWrite = await world.commandRerun.requestRerun(ctx, {
      input: { runRef: continuation.runRef,
        task: record.task, command: CRR_COMMAND, reason: 'the second request' },
      meta: { requestId: 'B', expected: [] },
    });
    expect(bWrite).toMatchObject({ status: 'committed',
      value: { request: { state: 'pending', createdAt: T, ref: { requestId: 'B' } } } });
    if (bWrite.status !== 'committed') throw new Error(JSON.stringify(bWrite));
    const bRef = bWrite.value.request.ref;
    // `B` is allowed: the human answer takes the one-time allowance.
    const bCard = await crrCardOf(world);
    const allowed = await world.decisionActions.resolveDecision(world.fixture.ctx, {
      input: { source: bCard.source, selection: { kind: 'option', optionId: 'allow_rerun' }, text: '', annotations: [] },
      meta: { requestId: `f098-allow-${kind}`, expected: bCard.source.pins },
    });
    expect(allowed).toMatchObject({ status: 'ready', value: { state: 'applied' } });

    // FIRST the production prepare's assembled continuation brief. At the same
    // createdAt the code-unit request id decides: `a` is the newest and its
    // `denied` state is the one the brief names (`B` would name the allowance).
    const prepared = await prepareContinuation({ world, records: world.records,
      task: continuation.task, runRef: continuation.runRef, tools: ['read'], writeScope: [], now: () => T });
    const newestLine = `- #1@${record.ref.runId.slice(0, 8)}：被拦；不允许`;
    expect(prepared.input.split('\n')).toContain(newestLine);
    expect(prepared.input).not.toContain('被拦；允许一次（未用）');

    // THEN consume `B`'s allowance through the real shell hook (the public
    // `before_tool` seam), so a third request can be created and the card can
    // list the two earlier requests.
    const hookWorld = await openB2HookWorld(world, record, { runRef: continuation.runRef });
    const hookDecision = await runHook(hookWorld.hook, {
      schemaVersion: 1, callId: `f098-hook-call-${kind}`, name: 'shell',
      arguments: { command: CRR_COMMAND },
    } as never);
    expect(hookDecision).toEqual({ point: 'before_tool', kind: 'continue' });
    const used = await world.commandRerun.readRequest(world.fixture.ctx, { ref: bRef });
    expect(used).toMatchObject({ status: 'ready', value: { state: 'used' } });

    // The third request at a LATER Host clock: a second real owner over the same
    // records. The card leaves out same-time siblings, so a strictly-later
    // request is what makes `a` and `B` "earlier".
    const later = '2026-10-08T00:00:01.000Z';
    const readWorkspace = {
      async readWorkspace() {
        return { status: 'rejected' as const, code: 'not_found' as const,
          reason: 'the fixture workspace has no package.json' };
      },
    };
    const laterOwner = createCommandRerunRequestService({
      records: world.records,
      listTaskReviews: (readCtx, input) => taskReviewsOf(world, readCtx, input),
      readTaskClosure: async (_ctx, task) => readTaskClosure(world.records,
        { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId }, task.taskId),
      recognize: createCommandRecognizer({ readWorkspace: readWorkspace as never }),
      now: () => later,
      eventId: () => `f098-third-event-${kind}`,
    });
    const third = await laterOwner.requestRerun(ctx, {
      input: { runRef: continuation.runRef,
        task: record.task, command: CRR_COMMAND, reason: 'the third request' },
      meta: { requestId: 'third', expected: [] },
    });
    expect(third).toMatchObject({ status: 'committed',
      value: { request: { state: 'pending', createdAt: later } } });

    // The public card read of the pending third request. Its earlier requests
    // are newest-first by (createdAt desc, requestRef code-unit desc): `a`, `B`.
    // The old brief order (localeCompare) would put `B` first.
    const thirdCard = await crrCardOf(world);
    const label = thirdCard.objects[0]!.label;
    const earlier = label.split('\n').filter(line => line.startsWith('以前：'));
    expect(earlier).toEqual([
      `以前：denied；${CRR_COMMAND}；不允许`,
      `以前：used；${CRR_COMMAND}；已用`,
    ]);
  }, 120_000);
});
