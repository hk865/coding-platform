/**
 * FL-1's P-24 smoke row: the one L2 Host world (`tests/helpers/S7C-L2-world.ts`) opened through FT-1's
 * `openS7CToolWorld` really has the seeded Task graph. A green public page here means the fixture did not
 * silently open an empty Host; the L2 rows extend this file with the behaviour they read from the same world.
 *
 * A4: FL-1 restarts the memory Host once to configure attention after the real Session refs exist. The two
 * mocks share the ONE real in-memory records backend and the ONE body store across that world's starts, so the
 * reopen is the same store on the same directory (the shape `tests/app/S7A-host-gates.test.ts:31`–`:47` uses).
 * The same record-store mocks are the shared `commitBarrier` (A3/A2): L2-outbox fails one real send and holds the
 * first restart send, and T-receipt's SQLite half reopens the same database.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolveDecisionReadV1, WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { ToolCommitLookup, ToolCommitLookupInput } from '../../src/contracts/unknown-call-review.js';
import * as lookupModule from '../../src/composition/tool-commit-lookup.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { byIdentityPrefix, commitBarrier, type CommitHold } from '../helpers/S6A-commit-barrier.js';
import { canonicalRefKey } from '../../src/core/work-graph/persistence/record-codecs.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { committed, ready } from '../helpers/S7A-fixture.js';
import { holdS6BRequestRound } from '../helpers/S6B1-fixture.js';
import { openLink } from '../helpers/S7D1-role-line-world.js';
import { adoptL46Plan } from '../helpers/S7B-L46-fixture.js';
import { localWorkbenchGrant, type WorkbenchWorkspaceConfig } from '../../src/app/host.js';
import { LOCAL_WORKBENCH_ROLE } from '../../src/app/runtime-configuration.js';
import type { HostSettingsStoredModel } from '../../src/app/host-settings.js';
import type { PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import { readBody } from '../helpers/IV-host-fixture.js';
import {
  answerDecisionCard, attentionNotices, decisionQueueOf, mainNotices, openS7CReadWorld, openS7CSystemWorld, reworkNotices,
  S7C_L2_ATTENTION_PATH,
} from '../helpers/S7C-L2-world.js';

const shared = vi.hoisted(() => ({ backend: undefined as unknown, bodies: undefined as unknown }));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>();
  const barrier = await import('../helpers/S6A-commit-barrier.js');
  const wrapped = await barrier.inMemoryBarrierModule(async () => actual);
  const create = wrapped.createInMemoryRecordBackend;
  return { ...wrapped, createInMemoryRecordBackend: (options: Parameters<typeof actual.createInMemoryRecordBackend>[0]) => {
    if (shared.backend === undefined) {
      shared.backend = { ...create(options), close: async () => undefined };
    }
    return shared.backend;
  } };
});
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/body-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/body-store.js')>();
  return { ...actual, RawArtifactBodyStore: class SharedRawArtifactBodyStore {
    constructor() {
      shared.bodies ??= new actual.RawArtifactBodyStore();
      return shared.bodies as never;
    }
  } as never };
});

// One world per row: the A4 backend is shared only inside that row's open/reopen pair.
beforeEach(() => { shared.backend = undefined; shared.bodies = undefined; });

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();   // first: releases anything still held
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  expect(left).toEqual([]);
});

it('is not empty', async () => {
  const opened = await openS7CReadWorld();
  worlds.push(opened.world);
  try {
    const graph = ready<{ tasks: Array<{ ref: { taskId: string } }> }>(
      await opened.world.post('tasks/query', plain(S6A_SCOPE, { goalRef: opened.goal })), 'the L2 task graph');
    expect(graph.tasks.map(task => task.ref.taskId)).toContain(opened.task.taskId);
  } finally {
    await opened.close();
  }
});

// ---------------------------------------------------------------------------
// L2-attention (book 765–777; ruling §13.2.2): the goal's adviser first, the configured target when none.
// ---------------------------------------------------------------------------

describe('L2-attention', () => {
  it.each([{ adviser: true }, { adviser: false }])(
    'a watched-path delivery notifies the configured target when the attention scope has no Goal ($adviser)',
    async ({ adviser }) => {
      const opened = await openS7CSystemWorld({ adviser });
      worlds.push(opened.world);
      const recipient = opened.target;
      await mkdir(join(opened.world.root, 'src'), { recursive: true });
      await writeFile(join(opened.world.root, S7C_L2_ATTENTION_PATH), 'S7C L2: the watched path changed\n');
      await expect.poll(async () => (await attentionNotices(opened.world, recipient.ref)).length,
        { timeout: 20_000, interval: 25 }).toBe(1);
      const notices = await attentionNotices(opened.world, recipient.ref);
      expect(notices[0]!).toMatchObject({ intent: 'notify',
        recipient: { projectId: recipient.ref.projectId, sessionId: recipient.ref.sessionId } });
      if (adviser) expect(await attentionNotices(opened.world, opened.adviser!.ref)).toHaveLength(0);
    });

  // L2-13: the adviser-creation projection returns the failed duty read as a ReadResult, so the queue answers
  // `unavailable` (a plain read keeps its rejected body) instead of the route's 500.
  it('a failed duty read makes decisions/queue answer unavailable, not 500', async () => {
    const opened = await openS7CSystemWorld();
    worlds.push(opened.world);
    const unprofiled = await opened.world.createUnprofiledSecretary('s7c-l2-unprofiled');
    if (unprofiled.role.kind !== 'role_spec') {
      throw new Error('L2-attention: the unprofiled secretary does not carry a RoleSpec role');
    }
    // The queue's adviser-creation read follows the Goal's responsible links; the unprofiled secretary is linked so
    // resolving its duty reaches the failed read (the new premise of L2-13).
    const linked = await openLink(opened.world, { line: unprofiled, target: { kind: 'goal', ref: opened.goal },
      requestId: 's7c-l2-unprofiled-goal-link' });
    committed(linked.result, 'the unprofiled secretary Goal link');
    const fault = commitBarrier.failReads(canonicalRefKey(unprofiled.role.pin.ref), 'throw-always');
    try {
      const queue = await opened.world.post('decisions/queue', plain(S6A_SCOPE, {
        workspace: S6A_SCOPE, goalRef: opened.goal, sections: ['waiting_answer'], page: { limit: 100 } }));
      expect(queue.httpStatus).toBe(200);
      expect(queue.body).toMatchObject({ status: 'rejected', code: 'unavailable' });
    } finally { fault.release(); }
  });
});

// The queue's two required inputs (slice-5-SPEC.md:759-764): a read that leaves one out is the owner's `invalid`,
// answered like a bad cursor (a plain read keeps its rejected body with HTTP 200), never the route's 500.
describe('rejects: decisions/queue without a required input', () => {
  it.each([
    ['sections', { page: { limit: 100 } }, 'the queue read requires sections'],
    ['page', { sections: ['waiting_answer'] }, 'the queue read requires a page'],
  ] as const)('a queue read without %s is invalid with HTTP 200', async (_missing, rest, reason) => {
    const opened = await openS7CReadWorld();
    worlds.push(opened.world);
    const queue = await opened.world.post('decisions/queue', plain(S6A_SCOPE, { workspace: S6A_SCOPE, ...rest }));
    expect(queue).toEqual({ httpStatus: 200, body: { status: 'rejected', code: 'invalid', reason } });
  });
});


// ---------------------------------------------------------------------------
// L2-outbox (book 1393; drill L2-07/08; P-20): the saved delivery is retried and replayed, and the restart keeps
// the saved recipient. Storage behaviour runs on memory and SQLite; the restart cell is SQLite only (a Host restart
// needs the same SQLite directory).
// ---------------------------------------------------------------------------

describe('L2-outbox', () => {
  it.each(['memory', 'sqlite'] as const)(
    'a real send failure keeps the saved source for the retry: both counted reworks reach the secretary (%s)',
    async backend => {
      const opened = await openS7CSystemWorld({ backend, beforeCountedRework: () => {
        // After the Secretary round: the next session-message send is the notifier's first rework notice.
        commitBarrier.failCommitOnce(byIdentityPrefix('session-message-send:'));
      } });
      worlds.push(opened.world);
      // The first send's commit fails; the notifier keeps the source, and the retry sends it and the second source.
      await expect.poll(async () => (await reworkNotices(opened.world, opened.secretary.ref)).length,
        { timeout: 20_000, interval: 25 }).toBe(2);
      const notices = await reworkNotices(opened.world, opened.secretary.ref);
      expect(notices).toHaveLength(2);
      const bodies = await Promise.all(notices.map(item => readBody(opened.world, item.ref, 'message')));
      expect(bodies.every(body => body.startsWith(`自动返工 · ${opened.task.taskId}`))).toBe(true);
      expect(new Set(notices.map(item => item.ref.messageId)).size).toBe(2);
      await expect.poll(async () => (await reworkNotices(opened.world, opened.adviser!.ref)).length,
        { timeout: 20_000, interval: 25 }).toBe(1);
    });

  it('the restart replays the old source to the old secretary and sends the later source to the newer one',
    async () => {
      let sendHold: CommitHold | undefined;
      const opened = await openS7CSystemWorld({ backend: 'sqlite', beforeCountedRework: () => {
        // After the Secretary round: the next session-message send is the notifier's first rework notice.
        sendHold = commitBarrier.hold(byIdentityPrefix('session-message-send:'), 'the first rework notice send');
      } });
      worlds.push(opened.world);
      if (sendHold === undefined) throw new Error('L2-outbox: the send hold was not armed');
      await sendHold.reached;
      // The first source's send is held after its saved delivery; a newer real secretary request root replaces the
      // Goal's secretary while that send is not committed.
      const { value: newerSecretary } = await holdS6BRequestRound(opened.world,
        { label: 's7c-l2-newer-secretary', goalId: opened.goal.goalId }, async held => held.secretary);
      // The same SQLite database, crashed and reopened; the held send never committed.
      await opened.restart(sendHold);
      // The saved input keeps the old recipient; only the later source resolves the now-current secretary.
      await expect.poll(async () => (await reworkNotices(opened.world, opened.secretary.ref)).length,
        { timeout: 20_000, interval: 25 }).toBe(1);
      await expect.poll(async () => (await reworkNotices(opened.world, newerSecretary.ref)).length,
        { timeout: 20_000, interval: 25 }).toBe(1);
      expect(await reworkNotices(opened.world, opened.secretary.ref)).toHaveLength(1);
      expect(await reworkNotices(opened.world, newerSecretary.ref)).toHaveLength(1);
      // The abandoned Host's held send is released only after the reopened Host proved the replay; the same
      // requestId is the mailbox identity, so it can only replay.
      sendHold.release();
    });
});


// ---------------------------------------------------------------------------
// L2-wiring (book 1392; drill L2-17): the real local workbench grant's rework names, and not the mailbox replies.
// ---------------------------------------------------------------------------

describe('L2-wiring', () => {
  it('the local workbench grant offers the two rework tools and no ack/respond on a real Work Run', async () => {
    const workspace: WorkbenchWorkspaceConfig = { scope: S6A_SCOPE, name: 'S7C L2 local workbench',
      root: '/workspace', workspaceRevision: 1, readPrefixes: ['.'], writePrefixes: ['.'] };
    const model: HostSettingsStoredModel = { id: 's7c-l2', label: 'S7C L2 model', provider: 'deepseek',
      model: 'deepseek-flash' };
    const grant = localWorkbenchGrant(workspace, model);
    // The production function is the grant's source (the binding below carries exactly this object).
    const opened = await openS7CReadWorld({ role: LOCAL_WORKBENCH_ROLE as Extract<typeof LOCAL_WORKBENCH_ROLE, { kind: 'legacy_template' }>, grant });
    worlds.push(opened.world);
    const task = opened.tools.tasks[1]!;
    await opened.world.scripted.script(opened.line, [{ kind: 'text', text: 'S7C L2 wiring answer' }]);
    const started = await opened.startRun(task);
    const bundleRef = started.execution.run.envelope?.bundleRef;
    if (bundleRef === undefined) throw new Error('L2-wiring: the Run has no frozen prepared manifest');
    const frozen = ready<{ body: string }>(await opened.world.post('materials/open',
      plain(S6A_SCOPE, { ref: bundleRef, usage: 'historical_explanation' })), 'the wiring manifest');
    const manifest = JSON.parse(frozen.body) as PreparedTaskManifestV1;
    const names = manifest.permissions.tools;
    expect(names).toEqual(expect.arrayContaining(['request_rework', 'request_recheck']));
    expect(names).not.toContain('ack_session_message');
    expect(names).not.toContain('respond_session_message');
  });
});


// ---------------------------------------------------------------------------
// T-receipt (book 1388; drill L2-16): one real hand_off call, its receipt by identity, and the storage replay.
// ---------------------------------------------------------------------------

describe('T-receipt', () => {
  it.each(['memory', 'sqlite'] as const)(
    'one real hand_off call replays its committed receipt by identity, and the SQLite replay survives a restart (%s)',
    async backend => {
      const realFactory = lookupModule.createToolCommitLookup;
      let lookup: ToolCommitLookup | undefined;
      const spy = vi.spyOn(lookupModule, 'createToolCommitLookup').mockImplementation((...args) => {
        const built = realFactory(...args);
        lookup = built;
        return built;
      });
      try {
        const opened = await openS7CReadWorld({ backend });
        worlds.push(opened.world);
        const handoff = await opened.handOff({ task: opened.tools.tasks[1]!, target: opened.target.ref,
          reason: 'S7C T-receipt: hand the task off', callId: `s7c-t-receipt-${backend}` });
        expect(handoff.call.name).toBe('hand_off');
        const outputs = (handoff.result as { output?: Array<{ value?: unknown }> }).output ?? [];
        const accepted = outputs.map(entry => entry.value).find(
          value => typeof value === 'object' && value !== null && 'operation' in value) as
          { status: string; operation: OperationRef } | undefined;
        if (accepted === undefined) throw new Error(`T-receipt: the tool returned no operation: ${
          JSON.stringify(handoff.result)}`);
        expect(accepted.status).toBe('accepted');
        const operationRef = accepted.operation;

        if (lookup === undefined) throw new Error('T-receipt: the composed lookup was not captured');
        const input: ToolCommitLookupInput = { toolName: 'hand_off', arguments: handoff.call.arguments,
          kernelCallId: handoff.call.callId, origin: { runRef: handoff.execution.run.ref, sessionRef: opened.line.ref,
            generation: 0, workspaceId: S6A_SCOPE.workspaceId } };
        const first = await lookup(opened.world.systemContext(), input);
        expect(first.status).toBe('committed');
        if (first.status !== 'committed') throw new Error(`T-receipt: the handoff receipt is not committed: ${JSON.stringify(first)}`);
        expect(first.eventIds.length).toBeGreaterThan(0);
        const again = await lookup(opened.world.systemContext(), input);
        expect(again).toEqual(first);

        // One operation at the public read, in both backends and after the SQLite restart.
        const readOperation = async () => ready<{ action: { kind: string } }>(
          await opened.world.post('sessions/operation', plain(S6A_SCOPE, operationRef)),
          'the handoff operation');
        expect((await readOperation()).action.kind).toBe('handoff');

        if (backend === 'sqlite') {
          // A real send at the restart point: its commit is held, so the crash happens after the Host is idle.
          const hold = commitBarrier.hold(byIdentityPrefix('session-message-send:'), 'the T-receipt restart point');
          const sending = opened.world.post('messages/send', graphWrite(S6A_SCOPE,
            { recipient: opened.line.ref, text: 'S7C T-receipt: the restart point', intent: 'inquiry',
              needsReply: true }, 's7c-t-receipt-restart-send'));
          await hold.reached;
          hold.release();
          await sending;
          await opened.restart(hold);
          if (lookup === undefined) throw new Error('T-receipt: the reopened lookup was not captured');
          const replayed = await lookup(opened.world.systemContext(), input);
          expect(replayed).toEqual(first);
          expect((await readOperation()).action.kind).toBe('handoff');
        }
      } finally { spy.mockRestore(); }
    });
});


// ---------------------------------------------------------------------------
// L2-gate-handoff (book 1394; drill L2-09/12): a pending handoff card blocks only its Tasks and dependents, and an
// answer saved but not applied still blocks until the application commits.
// ---------------------------------------------------------------------------

describe('L2-gate-handoff', () => {
  async function selectWorkAdvance(world: S6AHostWorld, goalRef: GoalRef, taskId: string, flowId: string) {
    return ready<Extract<WorkflowAdvanceResult, { status: 'ready' }>['value']>(await world.post('workflow/advance',
      plain(S6A_SCOPE, { schemaVersion: 1, goalRef, flowId, sessionHint: null, kind: 'select_work', taskId })),
    `the advance of ${taskId}`);
  }

  it('a pending handoff card blocks the handed-over Task and its dependent, while the unrelated Task advances; approval releases the source',
    async () => {
      const opened = await openS7CReadWorld();
      worlds.push(opened.world);
      // The same FT-1 Host adopts the L46 plan onto the caller's own A/B Tasks: C's gate-result edge on A is the formal
      // dependency, D's expected_dependency stays advisory, and B is the unrelated work Task.
      const a = opened.tools.tasks[1]!;
      const b = opened.tools.tasks[0]!;
      await adoptL46Plan(opened.tools.main, opened.goal, { planId: 's7c-l2-gate-plan', label: 'dependency',
        ids: { A: a.taskId, B: b.taskId } });
      const task = (taskId: string) => ({ projectId: opened.goal.projectId, goalId: opened.goal.goalId, taskId });
      const c = task('s7b3-c');
      // every_step: the short handoff opens its approval card.
      const goalRead = ready<{ goal: { revision: number } }>(await opened.world.post('goals/read',
        plain(S6A_SCOPE, opened.goal)), 'the L2 Goal');
      committed(await opened.world.post('goals/settings/set', graphWrite(S6A_SCOPE, {
        goalRef: opened.goal, autonomy: 'every_step', waitForGoalRef: null },
        's7c-l2-every-step', [{ ref: opened.goal, revision: goalRead.goal.revision }])), 'the every_step setting');

      const handoff = await opened.handOff({ task: a, target: opened.target.ref,
        reason: 'S7C L2 gate: hand the caller task over', callId: 's7c-l2-gate-handoff' });
      const outputs = (handoff.result as { output?: Array<{ value?: unknown }> }).output ?? [];
      const decided = outputs.map(entry => entry.value).find(
        value => typeof value === 'object' && value !== null && 'cardKey' in value) as
        { status: string; cardKey: string } | undefined;
      if (decided === undefined) throw new Error(`L2-gate-handoff: the tool returned no card: ${
        JSON.stringify(handoff.result)}`);
      expect(decided.status).toBe('needs_decision');

      const handoffWaitingCard = async (): Promise<DecisionCardV1 | undefined> =>
        (await decisionQueueOf(opened.world, opened.goal, ['waiting_answer', 'answered_pending_application']))
          .waitingAnswer.find(card => card.source.kind === 'handoff_approval');
      await expect.poll(async () => (await handoffWaitingCard()) !== undefined,
        { timeout: 20_000, interval: 25 }).toBe(true);
      const card = (await handoffWaitingCard())!;
      expect(card.cardKey).toBe(decided.cardKey);

      const blocked = await selectWorkAdvance(opened.world, opened.goal, a.taskId, 's7c-l2-gate-source');
      expect(blocked).toMatchObject({ state: 'waiting', next: null,
        reason: `handoff_approval_pending:${card.cardKey}` });
      // The tree's `waiting` helper carries the card's formal source in `source` (`workflow.ts:525–529`), not in
      // `decisionCause`; the card's own kind is the same identity the cause names.
      expect(blocked.source?.kind).toBe('handoff_approval');

      // The formal dependent C waits through the same block; the unrelated work Task B is not blocked.
      const dependent = await selectWorkAdvance(opened.world, opened.goal, c.taskId, 's7c-l2-gate-dependent');
      expect(dependent).toMatchObject({ state: 'waiting', next: null,
        reason: `l46_dependency_blocked: the Task ${c.taskId} waits on ${a.taskId}` });
      const unrelated = await selectWorkAdvance(opened.world, opened.goal, b.taskId, 's7c-l2-gate-unrelated');
      expect(unrelated.state).toBe('advance');

      // The answer commits, but its handoff decision commit is held: the card is answered and not applied.
      const hold = commitBarrier.hold(byIdentityPrefix('handoff.decide:'), 'the handoff decision commit');
      const answering = opened.world.post('decisions/answer',
        { scope: S6A_SCOPE, request: { input: {
          source: card.source, selection: { kind: 'option', optionId: 'approve' }, text: '', annotations: [],
        }, meta: { requestId: 's7c-l2-gate-answer', expected: card.source.pins } } });
      await hold.reached;
      const stillBlocked = await selectWorkAdvance(opened.world, opened.goal, a.taskId,
        's7c-l2-gate-still-blocked');
      expect(stillBlocked).toMatchObject({ state: 'waiting', next: null,
        reason: `handoff_approval_pending:${card.cardKey}` });
      hold.release();
      const answered = ready<ResolveDecisionReadV1>(await answering, 'the gate answer');
      expect(answered.answer).toMatchObject({ status: 'committed' });
      expect(answered.action).toBeNull();

      // The applied card releases the source: the same named selection now advances.
      const released = await selectWorkAdvance(opened.world, opened.goal, a.taskId, 's7c-l2-gate-released');
      expect(released.state).toBe('advance');
    });
});
