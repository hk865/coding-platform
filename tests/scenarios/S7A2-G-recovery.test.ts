/**
 * G-recovery (7a:726; SR4 §5; P2 §6 `S7A2-G-recovery:91`): the two crash windows of the `action_release` answer —
 * the answer saved before its application, and the application committed before the answer's own record — are both
 * recovered by the SQLite Host's start-up reconcile. The saved answer's `application` is read back with
 * `messages/read`; the action request's own facts carry the approval. Only the human answerer's saved answer is applied (a system answer is
 * `forbidden`), and the recovered event actor is that saved human, never the recovery context.
 *
 * Deferred form (SR4 §5; frozen fixture): `exercise(window)` holds every public step and assertion; the card source
 * is L's registration, so each `it.each` case ends on `readS7A2Card`'s own named error and L replaces only that
 * statement with `await exercise(window);`.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { DecisionCardV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { waitFor } from './harness.js';
import {
  crashS7AHost, holdS7ACommitter, openS7AQueryWorldWithActions, ready, seedS7AGoalPlan, setS7AAutonomy,
} from '../helpers/S7A-fixture.js';
import {
  answerS7A2Card, approveS7A2Message, readS7A2Card, sendS7A2RequestWithDispatch,
} from '../helpers/S7A2-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const goal: GoalRef = { aggregateType: 'Goal', projectId: S6A_SCOPE.projectId, goalId: 's7a-goal-recovery' };
const windows = [
  // P2 §2.6: an action_release answer's application (②) is the ActionRequest owner's approve commit; holding it
  // leaves the answer saved and unapplied.
  { name: 'the answer saved before its application', hold: 'action_request.approve:' },
  { name: 'the application committed before the answer record', hold: 'session-message-decision-application:' },
] as const;
const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  expect(left).toEqual([]);
});

it.each(windows)('G-recovery: $name (SQLite)', async window => {
  const exercise = async (which: typeof window) => {
    const opened = await openS7AQueryWorldWithActions({ backend: 'sqlite' });
    worlds.push(opened.world);
    await opened.world.setResumeOnStartup(true);
    const { goal: seeded } = await seedS7AGoalPlan(opened.world, { pointer: 'recovery' });
    expect(seeded).toEqual(goal);
    await setS7AAutonomy(opened.world, goal, 'every_step');
    const view = async (ref: SessionMessage['ref']) => ready<SessionMessage>(
      await opened.world.post('messages/read', plain(S6A_SCOPE, ref)), 'the message read');
    await sendS7A2RequestWithDispatch(opened.world,
      { label: `g-rec-${which.name.length}`, goal, recipient: opened.session.ref });
    const card = await readS7A2Card(opened.world, goal);

    // Only the configured human operator may answer; the trusted entry also refuses a system answer it is handed.
    const systemAnswer = await opened.world.dispatch('decisions/answer', opened.world.systemContext(),
      graphWrite(S6A_SCOPE, {
        source: card.source, selection: { kind: 'option', optionId: 'approve' }, text: '', annotations: [],
      }, `g-rec-system-${which.name.length}`, card.source.pins)) as { status?: string; code?: string };
    expect(systemAnswer).toMatchObject({ status: 'rejected', code: 'forbidden' });
    expect((await readS7A2Card(opened.world, goal)).card.answerMessageRef).toBeNull();

    // The crash window: the answer starts without being awaited; the held commit is the one that must recover.
    const hold = holdS7ACommitter(opened.world, byIdentityPrefix(which.hold));
    void answerS7A2Card(opened.world,
      { source: card.source, optionId: 'approve', label: `g-rec-approve-${which.name.length}` })
      .catch(() => undefined);
    await crashS7AHost(opened.world, hold);

    // After the restart: the answer's application and the action request's own facts. The settled card left the
    // waiting queue, so it is read back by the queue's own source.
    const recoveredCard = ready<DecisionCardV1>(
      await s6aCardsWorkspace(opened.world, S6A_SCOPE).route('decisions/card', { source: card.source }),
      'the recovered action-release card');
    const answerRef = recoveredCard.answerMessageRef;
    if (answerRef === null) throw new Error('S7A2: the recovered card lost its answer message');
    const answer = await waitFor(
      () => view(answerRef),
      value => value.application != null,
      'the recovered answer application',
    );
    const application = answer.application;
    if (application === null || application === undefined) {
      throw new Error('S7A2: the recovered answer has no application record');
    }
    const response = answer.response;
    if (response === null || !('decision' in response)) throw new Error('S7A2: the recovered answer is not a decision');
    // The actor is the saved answer's human actor, never the reconcile context's (no forged person context).
    expect(application.actor.kind).toBe('human');
    expect(application.actor).toEqual(response.sender.actor);
    // P2 §6 (S7A2-G-recovery:91): the recovered answer is an `action_release` card's decision; its receipt is the
    // ActionRequest owner's approve commit (§2.6 ② adapter); the message-release arm is gone.
    expect(application.receipt.identityKey.startsWith('action_request.approve:')).toBe(true);
    expect(recoveredCard.source).toMatchObject({ kind: 'action_release' });
    expect(recoveredCard.actionRelease?.ref).toMatchObject({ aggregateType: 'ActionRequest' });
    // The card's source pin is the action request's creation revision; the application moves it by one.
    const creationRevision = recoveredCard.source.pins
      .find(pin => pin.ref.aggregateType === 'ActionRequest')?.revision;
    if (creationRevision === undefined) throw new Error('S7A2: the recovered card source does not pin the action request');
    // The application moves the ActionRequest (and its hold), never the request message.
    const requestRef = recoveredCard.actionRelease?.ref;
    if (requestRef === undefined) throw new Error('S7A2: the recovered card has no action request');
    expect(application.changes).toEqual([{
      before: { ref: requestRef, revision: creationRevision },
      after: { ref: requestRef, revision: creationRevision + 1 },
    }]);
    expect(application.changes[0]!.after.revision).toBe(application.changes[0]!.before.revision + 1);
    // The recovered card stays answered by the same action card; the direct message-release arm is gone.
    expect(recoveredCard.state).not.toBe('waiting_answer');
    expect(recoveredCard.answerMessageRef).toEqual(answerRef);
    expect(recoveredCard.answer?.decision.source.kind).toBe('action_release');
    // The held release commit is the last thing the window releases.
    commitBarrier.reset();
  };
  await exercise(window);
});
