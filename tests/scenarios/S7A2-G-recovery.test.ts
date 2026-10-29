/**
 * G-recovery (7a:726; SR4 §5): the two crash windows of the `message_release` answer — the answer saved before its
 * approval, and the approval committed before the answer's application record — are both recovered by the SQLite
 * Host's start-up reconcile. The saved answer's `application` is read back with `messages/read`; the release
 * message's own facts carry the approval. Only the human answerer's saved answer is applied (a system answer is
 * `forbidden`), and the recovered event actor is that saved human, never the recovery context.
 *
 * Deferred form (SR4 §5; frozen fixture): `exercise(window)` holds every public step and assertion; the card source
 * is L's registration, so each `it.each` case ends on `readS7A2Card`'s own named error and L replaces only that
 * statement with `await exercise(window);`.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { byIdentityPrefix, commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { waitFor } from './harness.js';
import {
  crashS7AHost, holdS7ACommitter, openS7AQueryWorld, ready, seedS7AGoalPlan, setS7AAutonomy,
} from '../helpers/S7A-fixture.js';
import {
  answerS7A2Card, approveS7A2Message, readS7A2Card, sendS7A2Request,
} from '../helpers/S7A2-fixture.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

const goal: GoalRef = { aggregateType: 'Goal', projectId: S6A_SCOPE.projectId, goalId: 's7a-goal-recovery' };
const windows = [
  { name: 'the answer saved before its approval', hold: 'message.release:' },
  { name: 'the approval committed before the application record', hold: 'session-message-decision-application:' },
] as const;
const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  const left = commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  expect(left).toEqual([]);
});

it.each(windows)('G-recovery: $name (SQLite)', async window => {
  const exercise = async (which: typeof window) => {
    const opened = await openS7AQueryWorld({ backend: 'sqlite' });
    worlds.push(opened.world);
    await opened.world.setResumeOnStartup(true);
    const { goal: seeded } = await seedS7AGoalPlan(opened.world, { pointer: 'recovery' });
    expect(seeded).toEqual(goal);
    await setS7AAutonomy(opened.world, goal, 'every_step');
    const view = async (ref: SessionMessage['ref']) => ready<SessionMessage>(
      await opened.world.post('messages/read', plain(S6A_SCOPE, ref)), 'the message read');
    const message = await sendS7A2Request(opened.world,
      { label: `g-rec-${which.name.length}`, goal, recipient: opened.session.ref, intent: 'inquiry' });
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

    // After the restart: the answer's application and the release message's own facts.
    const recoveredCard = await readS7A2Card(opened.world, goal);
    const answerRef = recoveredCard.card.answerMessageRef;
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
    expect(application.receipt.identityKey.startsWith('message.release:')).toBe(true);
    expect(application.changes).toEqual([{
      before: { ref: message.ref, revision: message.revision },
      after: { ref: message.ref, revision: message.revision + 1 },
    }]);
    const approved = await view(message.ref);
    // the restart's re-drive may already have released it (the driver runs on): approved or released, never awaiting.
    expect(['approved', 'released']).toContain(approved.release);
    expect(approved.approvedAt).not.toBeNull();
    expect(approved.approvalRevision).toBe(message.revision + 1);
    expect(recoveredCard.card.state).not.toBe('waiting_answer');
    expect(recoveredCard.card.answerMessageRef).toEqual(answerRef);
    expect(recoveredCard.card.answer?.decision.source).toEqual(card.source);

    // A direct `messages/release` approval writes no answer; the card's facts still follow the message revision.
    const directWorld = await openS7AQueryWorld({ backend: 'sqlite' });
    worlds.push(directWorld.world);
    const { goal: directGoal } = await seedS7AGoalPlan(directWorld.world, { pointer: 'recovery-direct' });
    await setS7AAutonomy(directWorld.world, directGoal, 'every_step');
    const directMessage = await sendS7A2Request(directWorld.world,
      { label: `g-rec-direct-${which.name.length}`, goal: directGoal, recipient: directWorld.session.ref,
        intent: 'inquiry' });
    const direct = await approveS7A2Message(directWorld.world, directMessage,
      `g-rec-direct-${which.name.length}`);
    expect(direct.release).toBe('approved');
    expect(direct.revision).toBe(directMessage.revision + 1);
    const directCard = await readS7A2Card(directWorld.world, directGoal);
    expect(directCard.card.answerMessageRef).toBeNull();
    expect(directCard.card.source.pins).toContainEqual({ ref: direct.ref, revision: direct.revision });
    expect(directCard.card.messageRelease?.deadline).toBeNull();
    // The held release commit is the last thing the window releases.
    commitBarrier.reset();
  };
  await exercise(window);
});
