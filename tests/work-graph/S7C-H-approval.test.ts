/**
 * H-approval (book-7c.md:1378; 7c2-start-rulings-v2.md:1162): the accept's approval tier and card, the one
 * `handoff.decide` transition, and the replay of its application command. Service sub-cases only; the `history` and
 * `main/read` sub-cases belong to T+L2.
 *
 * Every prior state is a public step of FH-1's real world: the source Run wrote its understanding with the real
 * `record_note`, `sessions/link` adds the module responsibility, the accept is the platform's published handoff
 * owner, the card is read through `decisions/queue`, and its answer runs the real `decisions/answer` coordinator.
 * The `tool` fragment is the adapter's saved input (the tool itself is T's row); its caller Run is the fixture's real
 * source Run.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RunRef } from '../../src/contracts/dispatch.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { OperationRef } from '../../src/contracts/core/operations.js';
import type { HandoffToolFragmentV1 } from '../../src/contracts/handoff.js';
import type { HandoffAcceptInputV1 } from '../../src/core/work-graph/sessions/session-handoff-service.js';
import { agentActorOf } from '../../src/core/work-graph/model/tool-commit-arguments.js';
import { operationRefKey } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { openS7CHandoffWorldLight, type S7CHandoffCore } from '../helpers/S7C-handoff-fixture.js';
import { committed, setS7AAutonomy } from '../helpers/S7A-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

let opened: S7CHandoffCore | undefined;
// Restore mocks before closing: the fixture's close/reopen helpers and the handoff-entry capture are the only
// spies here, and restoring first keeps every row's world on the real Host factory.
afterEach(async () => {
  expect(commitBarrier.reset()).toEqual([]);
  vi.restoreAllMocks();
  await opened?.close();
  opened = undefined;
});

async function world(backend: 'memory' | 'sqlite' = 'memory'): Promise<S7CHandoffCore> {
  opened = await openS7CHandoffWorldLight({ backend });
  return opened;
}

function fragmentOf(target: S7CHandoffCore, caller: { session: SessionRef; run: RunRef;
  duty: 'executor' | 'adviser' }): HandoffToolFragmentV1 {
  return {
    caller: { actor: agentActorOf(caller.session, caller.run), session: caller.session, run: caller.run,
      duty: caller.duty },
    reason: 'S7C H-approval',
    understanding: [{ noteId: target.note.noteId, version: target.note.version }],
  };
}

type Assignments = HandoffAcceptInputV1['assignments'];

/** The accept through the platform's published owner; the fragment carries the fixture's real source Run. */
function acceptHandoffViaOwner(target: S7CHandoffCore, source: SessionRef, assignments: Assignments, fragment: HandoffToolFragmentV1,
  commandId: string) {
  return target.world.platform.sessionHandoff.acceptHandoff(target.world.systemContext(), {
    commandId, workspace: { ...S6A_SCOPE }, source, trigger: 'tool', assignments, tool: fragment,
  });
}

/** A real `responsible` module link on the source line, through `sessions/link`. */
async function linkModule(target: S7CHandoffCore, source: SessionRef, moduleId: string): Promise<void> {
  const card = await target.world.readSession(source);
  const moduleRef = { projectId: S6A_SCOPE.projectId, moduleId };
  const workTarget = { kind: 'module' as const, ref: moduleRef };
  const linkRef = { ...card.record.ref, aggregateType: 'SessionWorkLink' as const, target: workTarget,
    relation: 'responsible' as const };
  committed(await target.world.post('sessions/link', graphWrite(S6A_SCOPE, {
    sessionRef: source, target: workTarget, relation: 'responsible', active: true,
  }, `s7c-h-approval-module-${moduleId}`, [
    { ref: card.record.ref, revision: card.record.revision }, { ref: linkRef, revision: 0 },
  ])), `the module link ${moduleId}`);
}

/** The one open approval card with this key, through the project queue. */
async function approvalCardOf(target: S7CHandoffCore, cardKey: string) {
  const workspace = s6aCardsWorkspace(target.world, S6A_SCOPE);
  const cards = await workspace.readCards();
  const card = cards.find(candidate => candidate.source.kind === 'handoff_approval'
    && candidate.cardKey === cardKey);
  if (card === undefined) throw new Error(`H-approval: the card ${cardKey} is not in the queue`);
  return { card, workspace };
}

/** Answer the card through the real decision coordinator, as the person. */
async function answerApprovalCard(target: S7CHandoffCore, cardKey: string, optionId: 'approve' | 'reject',
  requestId: string) {
  const { card, workspace } = await approvalCardOf(target, cardKey);
  return workspace.post('decisions/answer', graphWrite(workspace.scope, {
    source: card.source, selection: { kind: 'option', optionId }, text: '', annotations: [],
  }, requestId, card.source.pins));
}

function approvalOf(target: S7CHandoffCore, operation: OperationRef) {
  return target.world.platform.sessions.getSessionOperation(target.world.systemContext(), operation);
}

describe('H-approval: the accept opens the card by the source duty and the Goal autonomy', () => {
  it('short handoff at every_step opens a pending short card', async () => {
    const target = await world();
    await setS7AAutonomy(target.world, target.goal, 'every_step');
    const accepted = await acceptHandoffViaOwner(target, target.lines.source.ref,
      [{ target: { kind: 'existing', session: target.lines.existing.ref }, tasks: [target.tasks[0]!] }],
      fragmentOf(target, { session: target.lines.source.ref, run: target.sourceRun, duty: 'executor' }), 'h-approval-short-card');
    expect(accepted).toMatchObject({ status: 'committed', value: { stage: 'accepted', phase: 'accepted',
      approval: { required: 'short', state: 'pending', answer: null } } });
    if (accepted.status !== 'committed' || accepted.value.approval === null) return;
    const { card } = await approvalCardOf(target, accepted.value.approval.cardKey);
    expect(card).toMatchObject({ state: 'waiting_answer', source: { kind: 'handoff_approval' },
      options: [{ id: 'approve' }, { id: 'reject' }] });
    expect(card.openedAt).not.toBeNull();
  }, 120_000);

  it.each([
    { name: 'one Goal', goals: ['main'] as const, subject: 'goal' as const },
    { name: 'two Goals', goals: ['main', 'clean'] as const, subject: 'project' as const },
  ])('the card subject is $subject for assignments of $name', async row => {
    const target = await world();
    await setS7AAutonomy(target.world, target.goal, 'every_step');
    const tasks = row.goals.map(goal => goal === 'main' ? target.tasks[0]! : target.clean.task);
    const accepted = await acceptHandoffViaOwner(target, target.lines.source.ref,
      [{ target: { kind: 'existing', session: target.lines.existing.ref }, tasks }],
      fragmentOf(target, { session: target.lines.source.ref, run: target.sourceRun, duty: 'executor' }),
      `h-approval-subject-${row.subject}`);
    expect(accepted).toMatchObject({ status: 'committed', value: { approval: { state: 'pending' } } });
    if (accepted.status !== 'committed' || accepted.value.approval === null) return;
    const { card } = await approvalCardOf(target, accepted.value.approval.cardKey);
    expect(card.source.subject.kind).toBe(row.subject);
    if (row.subject !== 'goal') return;
    const operation = await approvalOf(target, accepted.value.operation);
    expect(operation).toMatchObject({ status: 'ready' });
    if (operation.status === 'ready' && operation.value.action.kind === 'handoff') {
      expect(operation.value.action.input.assignments.flatMap(entry => entry.tasks.map(task => task.goalId)))
        .toEqual([target.tasks[0]!.goalId]);
    }
  }, 120_000);

  it('short handoff at after_plan_confirmation is automatic: no card, then the notice', async () => {
    const target = await world();
    await setS7AAutonomy(target.world, target.goal, 'after_plan_confirmation');
    // The source hands every Task it owns, so the transfer stage has no residual responsibility and the
    // composite reaches its own archive and notice stages.
    const handed = [...target.tasks.slice(0, 3), target.clean.task, target.other.task];
    const accepted = await acceptHandoffViaOwner(target, target.lines.source.ref,
      [{ target: { kind: 'existing', session: target.lines.existing.ref }, tasks: handed }],
      fragmentOf(target, { session: target.lines.source.ref, run: target.sourceRun, duty: 'executor' }), 'h-approval-short-auto');
    expect(accepted).toMatchObject({ status: 'committed', value: { approval: null } });
    if (accepted.status !== 'committed') return;
    const workspace = s6aCardsWorkspace(target.world, S6A_SCOPE);
    const cards = await workspace.readCards();
    expect(cards.filter(card => card.source.kind === 'handoff_approval')).toEqual([]);
    const advanced = await target.world.platform.workflow.sessionHandoff.advance(target.world.systemContext(),
      { operation: accepted.value.operation });
    expect(advanced).toMatchObject({ status: 'ready' });
    if (advanced.status === 'ready') expect(advanced.value.stage).not.toBe('accepted');
    // Drive the composite to the notice write itself (the automatic branch is never gated by the approval).
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const answer = await target.world.platform.workflow.sessionHandoff.advance(target.world.systemContext(),
        { operation: accepted.value.operation });
      if (answer.status !== 'ready') throw new Error(`H-approval: the advance failed: ${JSON.stringify(answer)}`);
      if (answer.value.stage === 'finished' || answer.value.phase === 'completed') break;
    }
    const notices = await workspace.readNotices({ categories: ['handoff'] });
    const itemKey = `handoff:${accepted.value.operation.operationId}`;
    expect(notices.notices.find(notice => notice.itemKey === itemKey)).toMatchObject({
      category: 'handoff', itemKey,
    });
  }, 120_000);

  it.each(['every_step', 'after_plan_confirmation'] as const)(
    'a long adviser line opens a long card at %s', async autonomy => {
      const target = await world();
      await setS7AAutonomy(target.world, target.goal, autonomy);
      const accepted = await acceptHandoffViaOwner(target, target.lines.adviser.ref,
        [{ target: { kind: 'create', duty: 'adviser' }, tasks: [] }],
        fragmentOf(target, { session: target.lines.adviser.ref, run: target.lines.adviserRun, duty: 'adviser' }),
        `h-approval-adviser-${autonomy}`);
      expect(accepted).toMatchObject({ status: 'committed', value: { approval: { required: 'long', state: 'pending' } } });
      if (accepted.status !== 'committed' || accepted.value.approval === null) return;
      const { card } = await approvalCardOf(target, accepted.value.approval.cardKey);
      expect(card.state).toBe('waiting_answer');
    }, 120_000);

  it.each(['every_step', 'after_plan_confirmation'] as const)(
    'a module-responsible executor opens a long card at %s', async autonomy => {
      const target = await world();
      await setS7AAutonomy(target.world, target.goal, autonomy);
      await linkModule(target, target.lines.source.ref, 's6a-core');
      const accepted = await acceptHandoffViaOwner(target, target.lines.source.ref,
        [{ target: { kind: 'create', duty: 'executor' }, tasks: [target.tasks[0]!] }],
        fragmentOf(target, { session: target.lines.source.ref, run: target.sourceRun, duty: 'executor' }),
        `h-approval-module-${autonomy}`);
      expect(accepted).toMatchObject({ status: 'committed', value: { approval: { required: 'long', state: 'pending' } } });
      if (accepted.status !== 'committed' || accepted.value.approval === null) return;
      const { card } = await approvalCardOf(target, accepted.value.approval.cardKey);
      expect(card.state).toBe('waiting_answer');
    }, 120_000);
});

describe('H-approval: the one handoff.decide transition', () => {
  it('rejects a pending card: the operation ends and nothing moves on the source', async () => {
    const target = await world();
    await setS7AAutonomy(target.world, target.goal, 'every_step');
    const accepted = await acceptHandoffViaOwner(target, target.lines.source.ref,
      [{ target: { kind: 'existing', session: target.lines.existing.ref }, tasks: [target.tasks[0]!] }],
      fragmentOf(target, { session: target.lines.source.ref, run: target.sourceRun, duty: 'executor' }), 'h-approval-reject');
    expect(accepted.status).toBe('committed');
    if (accepted.status !== 'committed' || accepted.value.approval === null) return;
    const before = await target.world.readSession(target.lines.source.ref);
    expect(await answerApprovalCard(target, accepted.value.approval.cardKey, 'reject', 'h-approval-reject-answer'))
      .toMatchObject({ status: 'ready' });
    const record = await approvalOf(target, accepted.value.operation);
    expect(record).toMatchObject({ status: 'ready', value: { phase: 'failed',
      action: { progress: { approval: { required: 'short', state: 'rejected',
        answer: { commandId: 'h-approval-reject-answer' } } } } } });
    expect(await target.world.readSession(target.lines.source.ref)).toEqual(before);
    // The ended operation is no longer a phase the composite drives, and no transfer ran.
    expect(await target.world.platform.workflow.sessionHandoff.advance(target.world.systemContext(),
      { operation: accepted.value.operation })).toMatchObject({ status: 'ready', value: { phase: 'failed' } });
    expect(await target.world.readSession(target.lines.source.ref)).toEqual(before);
  }, 120_000);

  it('approves a pending card: the phases run after the gate', async () => {
    const target = await world();
    await setS7AAutonomy(target.world, target.goal, 'every_step');
    const accepted = await acceptHandoffViaOwner(target, target.lines.source.ref,
      [{ target: { kind: 'existing', session: target.lines.existing.ref }, tasks: [target.tasks[0]!] }],
      fragmentOf(target, { session: target.lines.source.ref, run: target.sourceRun, duty: 'executor' }), 'h-approval-approve');
    expect(accepted.status).toBe('committed');
    if (accepted.status !== 'committed' || accepted.value.approval === null) return;
    // The gate stops the first drive before the fence and writes nothing.
    const gated = await target.world.platform.workflow.sessionHandoff.advance(target.world.systemContext(),
      { operation: accepted.value.operation });
    expect(gated).toMatchObject({ status: 'ready', value: { stage: 'accepted' } });
    const waiting = await approvalOf(target, accepted.value.operation);
    expect(waiting).toMatchObject({ status: 'ready', value: { revision: 1,
      action: { progress: { approval: { state: 'pending' } } } } });
    expect(await answerApprovalCard(target, accepted.value.approval.cardKey, 'approve', 'h-approval-approve-answer'))
      .toMatchObject({ status: 'ready' });
    expect(await approvalOf(target, accepted.value.operation)).toMatchObject({ status: 'ready',
      value: { action: { progress: { approval: { state: 'approved' } } } } });
    const advanced = await target.world.platform.workflow.sessionHandoff.advance(target.world.systemContext(),
      { operation: accepted.value.operation });
    expect(advanced).toMatchObject({ status: 'ready' });
    if (advanced.status !== 'ready') return;
    expect(advanced.value.revision).toBeGreaterThan(1);
    expect(advanced.value.stage).not.toBe('accepted');
  }, 120_000);

  it.each(['memory', 'sqlite'] as const)('replays the application command by its commandId on %s', async backend => {
    const target = await world(backend);
    await setS7AAutonomy(target.world, target.goal, 'every_step');
    const accepted = await acceptHandoffViaOwner(target, target.lines.source.ref,
      [{ target: { kind: 'existing', session: target.lines.existing.ref }, tasks: [target.tasks[1]!] }],
      fragmentOf(target, { session: target.lines.source.ref, run: target.sourceRun, duty: 'executor' }), 'h-approval-replay');
    expect(accepted.status).toBe('committed');
    if (accepted.status !== 'committed' || accepted.value.approval === null) return;
    const input = { commandId: 'h-approval-replay-decide', operation: accepted.value.operation,
      verdict: 'approve' as const };
    const first = await target.world.platform.sessionHandoff.decideHandoff(target.world.humanContext(), input);
    const second = await target.world.platform.sessionHandoff.decideHandoff(target.world.humanContext(), input);
    expect(first).toMatchObject({ status: 'committed', replayed: false,
      value: { state: 'approved' }, receipt: { fingerprint: expect.any(String) } });
    expect(second).toEqual({ ...first, replayed: true });
  }, 120_000);

  it('replays the application command when the operation read fails', async () => {
    const target = await world();
    await setS7AAutonomy(target.world, target.goal, 'every_step');
    const accepted = await acceptHandoffViaOwner(target, target.lines.source.ref,
      [{ target: { kind: 'existing', session: target.lines.existing.ref }, tasks: [target.tasks[1]!] }],
      fragmentOf(target, { session: target.lines.source.ref, run: target.sourceRun, duty: 'executor' }),
      'h-approval-replay-read-fault');
    expect(accepted.status).toBe('committed');
    if (accepted.status !== 'committed' || accepted.value.approval === null) return;
    const input = { commandId: 'h-approval-replay-read-fault-decide', operation: accepted.value.operation,
      verdict: 'approve' as const };
    const first = await target.world.platform.sessionHandoff.decideHandoff(target.world.humanContext(), input);
    expect(first).toMatchObject({ status: 'committed', replayed: false });
    // The receipt lookup comes before the facts read: the replay never reads the operation, so the armed
    // failure stays uncalled and the answer is still the committed receipt.
    const fault = commitBarrier.failReads(operationRefKey(accepted.value.operation), 'throw-once');
    const replay = await target.world.platform.sessionHandoff.decideHandoff(target.world.humanContext(), input);
    expect(fault.calls()).toBe(0);
    expect(replay).toMatchObject({ status: 'committed', replayed: true, value: { state: 'approved' } });
  }, 120_000);
});
