/**
 * L-host-gates: `consumeIdle`'s INBOX and OUTBOX reads with one real `inputConsumers` period; the all-Session
 * walk reaches the sending Work line and the secretary recipient. P2 replaces the message-release gate with the
 * action gate:
 *
 * | cell | send | state before the Host reads |
 * |------|------|-----------------------------|
 * | inbox inquiry | the person's `messages/send` | `wake` and `needsReply`, no release |
 * | dispatch | the secretary request round's `dispatch_task` | `action_release` card pending, no message |
 *
 * The card is read back at `decisions/queue` (never a hand-coded cardKey), and the dispatch must not appear as an
 * ordinary message in the recipient's inbox. The Host's own consume pass is the completion barrier.
 */
import { afterEach, expect, it, vi } from 'vitest';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { advanceUntil, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld, type S6AReply } from '../helpers/S6A-host-fixture.js';
import {
  S6A_SCOPE, S6A_SECRETARY_PROFILE_ID, S6A_SECRETARY_ROLE, type S6ASession,
} from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from '../helpers/S6B1-fixture.js';
import { committed, holdS7AQueryRound, ready, replyS7AMessage, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';

// A4: one real in-memory records backend and one real body store, shared by every Host start; the backend's `close`
// leaves it open (the body store has none), so `world.reopen({ sharedMemoryStore: true })` is a real same-store reopen.
const shared = vi.hoisted(() => ({ backend: undefined as unknown, bodies: undefined as unknown }));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>();
  return { ...actual, createInMemoryRecordBackend: (options: Parameters<typeof actual.createInMemoryRecordBackend>[0]) => {
    if (shared.backend === undefined) {
      shared.backend = { ...actual.createInMemoryRecordBackend(options), close: async () => undefined };
    }
    return shared.backend;
  } };
});
vi.mock('../../src/core/record-store/body-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/body-store.js')>();
  return { ...actual, RawArtifactBodyStore: class SharedRawArtifactBodyStore {
    constructor() {
      shared.bodies ??= new actual.RawArtifactBodyStore();
      return shared.bodies as never;
    }
  } as never };
});

const worlds: S6AHostWorld[] = [];
afterEach(async () => { await Promise.all(worlds.splice(0).map(world => world.close())); });

/** Walk the all-Session batch until the named real consume completes: each beat is one real pass. */
async function pumpUntil(world: S6AHostWorld, reached: Promise<void>, beats = 12): Promise<void> {
  let done = false;
  void reached.then(() => { done = true; });
  for (let beat = 0; beat < beats && !done; beat += 1) {
    const settled = world.consumeBarrier();
    world.clock.advance(25);
    await settled;
    await Promise.resolve();
  }
  await reached;
}
/** The person's own send: `release: null`, the only release a public owner writes. */
const sendAsPerson = async (world: S6AHostWorld, recipient: S6ASession, label: string,
  text: string): Promise<SessionMessage> => committed<SessionMessage>(await world.post('messages/send',
  graphWrite(S6A_SCOPE, { recipient: recipient.ref, text, needsReply: true,
    goalRef: world.goals.first }, label)),
'control');
const withdrawAsPerson = async (world: S6AHostWorld, messageRef: SessionMessage['ref'], label: string):
Promise<SessionMessage> => committed<SessionMessage>(await world.dispatch('messages/withdraw', world.humanContext(),
  graphWrite(S6A_SCOPE, { messageRef }, label)), 'withdrawal');
/** A3: forward every real consume unchanged; record it after it COMPLETES and resolve the named barrier. */
function consumptionBarrier(workflow: S6AHostWorld['platform']['workflow']) {
  const consumed: Array<{ messageId: string }> = [];
  const waiters: Array<{ ids: Set<string>; resolve: () => void }> = [];
  const real = workflow.consumeConsultation!;
  workflow.consumeConsultation = async (ctx, input) => {
    const result = await real(ctx, input);
    consumed.push({ messageId: input.messageRef.messageId });
    for (const waiter of [...waiters]) {
      if ([...waiter.ids].every(id => consumed.some(entry => entry.messageId === id))) waiter.resolve();
    }
    return result;
  };
  const waitFor = (ids: readonly string[]): Promise<void> => {
    const set = new Set(ids);
    if ([...set].every(id => consumed.some(entry => entry.messageId === id))) return Promise.resolve();
    return new Promise(resolve => waiters.push({ ids: set, resolve }));
  };
  return { consumed, waitFor };
}
/** One real Work Run of the sending line that sends `calls` and ends before the Workflow's open checks. */
async function sendRun(world: S6AHostWorld, sender: S6ASession, taskId: string, label: string,
  calls: Extract<S6AReply, { kind: 'calls' }>['calls']): Promise<void> {
  await world.scripted.script(sender, [{ kind: 'calls', calls },
    { kind: 'text', text: `S7A gate ${label} sent` }]);
  const next = await advanceUntil(world.ag2b, { schemaVersion: 1, goalRef: world.goals.first,
    flowId: `s7a-gate-${label}`, sessionHint: sender.ref, kind: 'select_work', taskId }, 'claim_task');
  await driveWorkflow(world.ag2b, next, { stopBefore: 'open_checks' });
}
/** The recipient's real Work reply, through the shared helper the other S7A tests use. */
async function replyRun(world: S6AHostWorld, recipient: S6ASession, messageRef: SessionMessage['ref'],
  taskId: string, label: string): Promise<void> {
  await replyS7AMessage(world, { goal: world.goals.second, recipient, messageRef, taskId, label,
    text: `the ${label} reply` });
}

it('gates a dispatch on an action_release card and consumes an ordinary inquiry', async () => {
  const world = await openS6AHostWorld({ backend: 'memory', secretaryWork: true,
    secretaryTools: ['read', 'send_session_message', 'respond_session_message', 'dispatch_task'] });
  worlds.push(world);
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  await world.setResumeOnStartup(false);
  await governS6B(world, main, world.goals);
  const goal = world.goals.first;
  const { tasks } = await adoptS6BPlan(main, goal, { label: 's7a-gate',
    taskIds: ['s7a-gate-dispatch'], role: S6A_SECRETARY_ROLE.templateId });
  const made = await createS6BLine(main, { label: 's7a-gate-sender', role: S6A_SECRETARY_ROLE, tasks });
  const senderCard = await world.readSession(made.ref);
  const sender: S6ASession = { ...made, aggregateRef: senderCard.record.ref,
    role: structuredClone(senderCard.record.role), createdAt: senderCard.record.createdAt };
  const recipient = await world.createSecretary('s7a-gate-recipient');
  await setS7AAutonomy(world, goal, 'every_step');
  // The action owner: a dispatch request is a card, never a message with a release flag. A Work Run is not granted
  // `dispatch_task` (设计 3.2: 做事轮不给); the secretary's request round asks the owner with its own Runtime context.
  const requested = await holdS7AQueryRound(world, { label: 's7a-gate-dispatch', goalId: goal.goalId },
    async context => world.platform.actionRequests.requestDispatch(context, {
      input: { taskRef: { projectId: goal.projectId, goalId: goal.goalId, taskId: tasks[0]!.taskId },
        reason: 'S7A gate dispatch' },
      meta: { requestId: 's7a-gate-dispatch', expected: [] },
    }));
  expect(requested).toMatchObject({ status: 'needs_decision' });
  // The card is read through `decisions/queue`'s own `waitingAnswer` section (`DecisionQueueReadV1`).
  const queue = ready<DecisionQueueReadV1>(
    await world.post('decisions/queue', plain(S6A_SCOPE,
      { workspace: S6A_SCOPE, goalRef: goal, sections: ['waiting_answer'], page: { limit: 100 } })),
    'the decision queue');
  expect(queue.waitingAnswer.filter(entry => entry.source.kind === 'action_release')).toContainEqual(
    expect.objectContaining({ source: expect.objectContaining({ kind: 'action_release' }) }));
  // The dispatch never became an ordinary message in the recipient's inbox.
  expect((await listed(world, 'inbox', recipient)).filter(message => message.sender.kind === 'secretary_round')).toEqual([]);
  // An ordinary person inquiry is mail, not a card: it is offered to the recipient's consumer without a release.
  const inquiry = await sendAsPerson(world, recipient, 's7a-gate-inquiry', 'S7A gate ordinary inquiry');
  expect(inquiry).toMatchObject({ wake: true, status: 'pending' });
  const offered = listed(world, 'inbox', recipient);
  expect((await offered).some(message => message.ref.messageId === inquiry.ref.messageId)).toBe(true);
}, 120_000);
