/**
 * B2-07 / item 4 (ruling 4): the CRR card derives its `closed` from the ONE
 * canonical Task closure, and a closure read failure is `unavailable` — never
 * "still valid". The cancelled/superseded rows are reached through the real
 * Plan owner (`setK3TaskDisposition`); the failure row is a store read failing
 * once (fault injection, coordinator-mode rule).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { RUN_BY_TASK_INDEX } from '../../src/core/work-graph/tasks/plan-readers.js';
import { createCommandRerunRequestCardSource } from '../../src/core/work-graph/views/decision-read-model.js';
import {
  openK3ReviewCardWorld, setK3TaskDisposition, type K3ReviewCardWorld,
} from '../helpers/K3-review-card-fixture.js';
import {
  blockedRecord, blockedRecordWithClaim, crrCardOf, crrSourceOf, CRR_COMMAND, realKernelCommandReaderOf,
  requestRerunOf, requeueBlockedRecord,
} from '../helpers/B2-crr-world.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { GOAL_B, WORKSPACE_SCOPE } from '../helpers/S5-decision-fixture.js';

// §5.1's blocking `shell` stand-in, hoisted per test file: the record Run's
// real Kernel Turn holds its first call so RUN-20/RUN-22 read a real
// unresolved call. The stand-in is an injected dependency, never a fact.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

describe.each(['memory', 'sqlite'] as const)('B2-07: the CRR card derives closed from the canonical Task closure (%s)', kind => {
  it.each(['cancelled', 'superseded'] as const)(
    'B2-07: a %s Task closes the pending request card into history, with no options',
    async disposition => {
      const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
      worlds.push(world);
      const record = await blockedRecord(world, 'k3-20-a', `b2-07-${disposition}`,
        [{ callId: `k3-07-${disposition}`, command: CRR_COMMAND }]);
      const request = await requestRerunOf(world, record, `b2-07-${disposition}-request`);
      // The real Plan owner adopts a new revision with the Task's disposition.
      await setK3TaskDisposition(world, 'k3-20-a', disposition);
      const card = await crrCardOf(world);
      expect(card.state).toBe('closed');
      expect(card.closedReason).toBe('source_resolved');
      expect(card.options).toEqual([]);
      expect(card.actions).toEqual([]);
      expect(card.readOnly).toBe(true);
      // The by-key read serves the same history shape, not a stale open card.
      if (world.commandRerunCardSource.readByKey === undefined) throw new Error('no direct read');
      const direct = await world.commandRerunCardSource.readByKey(world.fixture.ctx, {
        workspace: WORKSPACE_SCOPE, source: card.source });
      expect(direct).toMatchObject({ status: 'ready', value: { state: 'closed', options: [],
        actions: [], readOnly: true, closedReason: 'source_resolved' } });
      expect(request.state).toBe('pending');
    }, 120_000);

  it('B2-07: a closure read failure makes the CRR card read unavailable', async () => {
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
    worlds.push(world);
    const record = await blockedRecord(world, 'k3-20-a', 'b2-07-closure-failure',
      [{ callId: 'k3-07-closure-failure', command: CRR_COMMAND }]);
    await requestRerunOf(world, record, 'b2-07-closure-failure-request');
    // Fault injection: the closure's directed RUN_BY_TASK lookup fails once.
    let failed = false;
    const faultyRecords = {
      ...world.fixture.records,
      async lookup(request: Parameters<K3ReviewCardWorld['records']['lookup']>[0]) {
        if (!failed && request.index === RUN_BY_TASK_INDEX) {
          failed = true;
          return { status: 'rejected' as const, code: 'unavailable' as const,
            reason: 'injected closure read failure' };
        }
        return world.fixture.records.lookup(request);
      },
    } as K3ReviewCardWorld['records'];
    // The blocked command text comes from the production reader over the SAME
    // Kernel store, never from a test-written map.
    const readKernelCommandFacts = await realKernelCommandReaderOf(world);
    const source = createCommandRerunRequestCardSource({
      records: faultyRecords,
      requests: world.commandRerun,
      reviews: world.reviews,
      executions: createRunStateReader({ records: faultyRecords }),
      readKernelCommandFacts,
    });
    const page = await source.readPage(world.fixture.ctx, {
      workspace: WORKSPACE_SCOPE, goalRef: GOAL_B, page: { limit: 100 } });
    expect(page).toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(failed).toBe(true);
  }, 120_000);

  it('B2-07: the Task card page reads the canonical closure exactly once per operation', async () => {
    const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
    worlds.push(world);
    // TWO real Runs of ONE Task leave TWO real blocked records; each disposes
    // through the real `skip_as_done` path and each leaves a pending request.
    // Two cards on one page are what tells "once per Task" apart from "once per
    // card". The second Run is entered through the public requeue of the first
    // (the Task has an ended Run, so a plain claim would be refused). Its
    // prepared binding carries the first record's blocked command, so the
    // production shell gate is installed: the human allows a rewrite of that
    // alias first, and the second Run consumes the one-time allowance before
    // its (seam-held) call. That is the only public way a continuation shell
    // call on a Task with a binding reaches the tool.
    const first = await blockedRecordWithClaim(world, 'k3-20-b', 'b2-07-read-once-1',
      [{ callId: 'k3-07-read-once-1', command: CRR_COMMAND }]);
    const secondCommand = 'prisma migrate status';
    const requeue = await requeueBlockedRecord(world, first.claim,
      'the Task continues into its second blocked Run');
    await requestRerunOf(world, first.record, 'b2-07-read-once-allowance',
      secondCommand, 'the continuation runs the allowed rewrite',
      { review: first.record.runRef.runId, alias: 1 });
    const allowanceCard = await crrCardOf(world);
    const allowed = await world.decisionActions.resolveDecision(world.fixture.ctx, {
      input: { source: allowanceCard.source, selection: { kind: 'option', optionId: 'allow_rerun' },
        text: '', annotations: [] },
      meta: { requestId: 'b2-07-read-once-allowance-answer', expected: allowanceCard.source.pins },
    });
    expect(allowed).toMatchObject({ status: 'ready', value: { state: 'applied' } });
    const second = await blockedRecord(world, 'k3-20-b', 'b2-07-read-once-2',
      [{ callId: 'k3-07-read-once-2', command: secondCommand }], { requeue: requeue.ref });
    expect(second.task).toEqual(first.record.task);
    expect(second.runRef.runId).not.toBe(first.record.runRef.runId);
    // One command per record, alias 1 each, distinct requestIds: the allowance
    // request above was consumed, so the two pending requests below are the two
    // cards, one per real record.
    const firstRequest = await requestRerunOf(world, first.record, 'b2-07-read-once-request-1');
    const secondRequest = await requestRerunOf(world, second, 'b2-07-read-once-request-2', secondCommand);
    expect(firstRequest.reviewRef.runId).toBe(first.record.runRef.runId);
    expect(secondRequest.reviewRef.runId).toBe(second.runRef.runId);
    expect(firstRequest.ref.requestId).not.toBe(secondRequest.ref.requestId);
    expect(firstRequest.alias).toBe(1);
    expect(secondRequest.alias).toBe(1);
    let closureReads = 0;
    const countedRecords = {
      ...world.fixture.records,
      async lookup(request: Parameters<K3ReviewCardWorld['records']['lookup']>[0]) {
        if (request.index === RUN_BY_TASK_INDEX) closureReads += 1;
        return world.fixture.records.lookup(request);
      },
    } as K3ReviewCardWorld['records'];
    const source = createCommandRerunRequestCardSource({
      records: countedRecords,
      requests: world.commandRerun,
      reviews: world.reviews,
      executions: createRunStateReader({ records: countedRecords }),
      readKernelCommandFacts: await realKernelCommandReaderOf(world),
    });
    const readOnce = async (): Promise<void> => {
      const page = await source.readPage(world.fixture.ctx, {
        workspace: WORKSPACE_SCOPE, goalRef: GOAL_B,
        page: { limit: 100, attempt: { cache: new Map() } } });
      expect(page.status).toBe('ready');
      if (page.status !== 'ready') throw new Error(JSON.stringify(page));
      // Both real cards of this Task are on the one page ...
      expect(page.value.items).toHaveLength(2);
      const keys = page.value.items.map(item => item.source.key);
      expect(keys).toContain(crrSourceOf(firstRequest).key);
      expect(keys).toContain(crrSourceOf(secondRequest).key);
    };
    await readOnce();
    // ONE directed canonical read for the Task both cards belong to.
    expect(closureReads).toBe(1);
    // The cache is per operation: the next operation reads it once again.
    closureReads = 0;
    await readOnce();
    expect(closureReads).toBe(1);
  }, 120_000);
});
