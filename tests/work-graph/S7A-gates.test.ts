/**
 * SR8's service gates: the rule through public owners on the C1 mailbox harness (`release: null` is the only state
 * it produces here) and the consultation rows on a real memory Host world whose ONE backend the A4 seam shares with
 * the withdraw owner; the pure table is `S7A-gates-pure.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMailboxInputSupply } from '../../src/core/agent-runtime/execution-inputs.js';
import { createC1Harness, type C1Harness } from '../helpers/C1-mailbox-fixture.js';
import { consultationQueryRefs } from '../../src/contracts/query-job.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import { createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createDispatchBasisReader } from '../../src/core/work-graph/tasks/dispatch-basis.js';
import { createGoalPointerFacts } from '../../src/core/work-graph/views/pointer-facts.js';
import { createRecipientExecutions } from '../../src/core/work-graph/sessions/recipient-executions.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import {
  AG2B_CONSUMER_ID, AG2B_PROJECT_REF, AG2B_QUERY_BUDGET, AG2B_RUNTIME_BUDGET, AG2B_WORK_ROLE_BINDING,
  AG2B_WORKSPACE_REF, AG2B_WORK_TASK_ID, graphWrite, plain, startBusyQuery,
} from '../helpers/AG2b-collaboration-fixture.js';
import { driveWorkflow, readExecution, readGoal, workRow } from '../helpers/A2-restart-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { adoptS6BPlan } from '../helpers/S6B1-fixture.js';
import { replyS7AMessage, setS7AAutonomy, S7A_REPLY_TOOLS } from '../helpers/S7A-fixture.js';
import { openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import {
  S6A_GOAL_1, S6A_SCOPE, S6A_WORK_ROLE, type S6AHttpAnswer, type S6ASession,
} from '../helpers/S6A-request-fixture.js';
import type { InMemoryRecordBackend } from '../../src/core/record-store/in-memory-record-store.js';

// A4: the wrapper keeps the ONE real memory backend each platform is built on, so the world and its withdraw owner
// share it; A3: it also counts that ledger's commits, forwarding every commit and its receipt unchanged.
const counted = vi.hoisted(() => ({ commits: 0, created: [] as unknown[] }));
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/record-store/in-memory-record-store.js')>();
  return { ...actual, createInMemoryRecordBackend: (options: Parameters<typeof actual.createInMemoryRecordBackend>[0]) => {
    const backend = actual.createInMemoryRecordBackend(options); counted.created.push(backend);
    const commit = backend.records.commit;
    return { ...backend, records: { ...backend.records,
      commit: (input: Parameters<typeof commit>[0]) => { counted.commits += 1; return commit(input); } } };
  } };
});

// Service rows: `release: null` is the only state a public owner produces here.
const harnesses: C1Harness[] = [];
afterEach(async () => { for (const harness of harnesses.splice(0)) await harness.close(); });
async function openHarness(): Promise<C1Harness> {
  const harness = await createC1Harness('memory');
  harnesses.push(harness);
  return harness;
}
const inputPoint = (h: C1Harness) => ({ sessionId: h.busySession.sessionId, runId: h.claim.runRef.runId,
  turnId: 'gates-turn', afterEventSequence: 0, acceptedInputIds: [] as string[] });

describe('SR8 service gates (reachable release: null)', () => {
  it('offers a real sent message to the execution input supplier', async () => {
    const h = await openHarness();
    const sent = await h.mailbox.sendMessage(h.ctxHost, { input: { recipient: h.busySession, text: 'offerable message' },
      meta: { requestId: 'gates-offerable', expected: [] } });
    expect(sent).toMatchObject({ status: 'committed', value: { release: null, withdrawnAt: null } });
    if (sent.status !== 'committed') return;
    const supply = createMailboxInputSupply({
      messages: h.mailbox, context: () => h.ctxWork, sessionRef: h.busySession, runRef: h.claim.runRef,
    });
    expect((await supply(inputPoint(h), { signal: new AbortController().signal })).map(item => item.text))
      .toEqual(['offerable message']);
  });

  it('public mailbox reads show every sent message', async () => {
    const h = await openHarness();
    for (const [index, text] of ['read-all-one', 'read-all-two'].entries()) {
      expect(await h.mailbox.sendMessage(h.ctxHost, { input: { recipient: h.idleSession, text },
        meta: { requestId: `gates-read-all-${index}`, expected: [] } })).toMatchObject({ status: 'committed' });
    }
    const inbox = await h.mailbox.readInbox(h.ctxHost, { recipient: h.idleSession, page: { limit: 10 } });
    expect(inbox).toMatchObject({ status: 'ready' });
    if (inbox.status !== 'ready') return;
    expect(inbox.value.items).toHaveLength(2);
  });

  it('a public read performs zero writes (counted delegating wrapper)', async () => {
    const h = await openHarness();
    expect(await h.mailbox.sendMessage(h.ctxHost, { input: { recipient: h.busySession, text: 'counted read' },
      meta: { requestId: 'gates-counted', expected: [] } })).toMatchObject({ status: 'committed' });
    let writes = 0; let reads = 0;
    const mailbox = h.makeMailbox({ ...h.fixture.records,
      async commit(batch) { writes++; return h.fixture.records.commit(batch); },
      lookup(input) { reads++; return h.fixture.records.lookup(input); },
    });
    const supply = createMailboxInputSupply({
      messages: mailbox, context: () => h.ctxWork, sessionRef: h.busySession, runRef: h.claim.runRef,
    });
    expect((await supply(inputPoint(h), { signal: new AbortController().signal })).map(item => item.text))
      .toEqual(['counted read']);
    expect(writes).toBe(0);
    expect(reads).toBeGreaterThan(0);
  });
});

// WA-01 / WA-02 / WA-05: no withdraw route is published yet, so one real mailbox owner writes the world's own
// ledger (A4: the memory backend the captured factory built for that world's platform).
const WA_TEXT = 'WA-01: the withdrawn message is not consumed';
const waClosers: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of waClosers.splice(0)) await close(); });
/** The ONE memory backend the captured factory built while a world opened: that world's platform's own ledger. */
function capturedLedger(created: readonly unknown[]): InMemoryRecordBackend {
  if (created.length !== 1) throw new Error(`the world built ${created.length} memory backends; the seam expects one`);
  return created[0] as InMemoryRecordBackend;
}
function waMailbox(world: S6AHostWorld, backend: InMemoryRecordBackend) {
  let sequence = 0; const newId = () => `wa-gates-${++sequence}`; const now = () => world.clock.now();
  const { records } = backend; const { sessions, executions, materials, sessionFacts } = world.platform;
  return createSessionMailbox({ records, sessions, executions, materials, now, newId,
    roles: createRoleConfigurationService({ records, now, eventId: newId }),
    defaultInquiryDeadlineMs: 86_400_000, systemActor: { kind: 'system', id: 'wa-gates-mailbox' },
    recipientExecutions: createRecipientExecutions({ sessions: sessionFacts, executions, records }) });
}
/** A real memory Host world, a person's inquiry on a new work line and (unless `submit` is false) its pending Query. */
async function waWorld(label: string, submit = true) {
  const opening = counted.created.length;
  const world = await openS6AHostWorld({ backend: 'memory' });
  waClosers.push(() => world.close().catch(() => undefined));
  const ledger = capturedLedger(counted.created.slice(opening));
  const recipient = await world.createWorkSession(`wa-${label}`);
  const sent = (await world.post('messages/send', graphWrite(S6A_SCOPE, { recipient: recipient.ref, text: WA_TEXT,
    intent: 'inquiry', needsReply: true }, `wa-${label}-send`, []))).body as WriteResult<{ ref: SessionMessageRef }>;
  if (sent.status !== 'committed') throw new Error(`the inquiry did not commit: ${JSON.stringify(sent)}`);
  const messageRef = sent.value.ref;
  const { queryJobRef, queryRunRef } = consultationQueryRefs(messageRef);
  if (submit) {
    const submitted = (await world.post('queries/submit', await submitBody(world, messageRef, recipient, label)))
      .body as WriteResult<unknown>;
    if (submitted.status !== 'committed') throw new Error(`the consultation Query did not submit: ${JSON.stringify(submitted)}`);
  }
  const card = await world.readSession(recipient.ref);
  return { world, ledger, pending: { messageRef, queryJobRef, queryRunRef,
    sessionRef: card.record.ref, sessionRevision: card.record.revision } };
}
/** The person withdraws the still-pending message through the real mailbox owner. */
async function withdraw(world: S6AHostWorld, backend: InMemoryRecordBackend, messageRef: SessionMessageRef,
  label: string) {
  const withdrawn = await waMailbox(world, backend).withdrawMessage(world.humanContext(), {
    input: { messageRef }, meta: { requestId: `wa-${label}-withdraw`, expected: [] } });
  if (withdrawn.status !== 'committed') throw new Error(`the withdraw did not commit: ${JSON.stringify(withdrawn)}`);
  return withdrawn.value;
}
const consultationBody = (messageRef: SessionMessageRef, goalRef: GoalRef = S6A_GOAL_1) => plain(S6A_SCOPE, {
  schemaVersion: 1, messageRef, goalRef, roleBinding: AG2B_WORK_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET,
  budget: AG2B_QUERY_BUDGET, consumerId: AG2B_CONSUMER_ID });
it('WA-01: an existing consultation Query never outlives a withdrawn message', async () => {
  const { world, ledger, pending } = await waWorld('wa01');
  expect(await withdraw(world, ledger, pending.messageRef, 'wa01'))
    .toMatchObject({ status: 'pending', withdrawnAt: expect.any(String) });
  const consulted = await world.post('workflow/consultation', consultationBody(pending.messageRef));
  expect(consulted.body).toMatchObject({ status: 'rejected', code: 'invalid' });
  expect(world.model.calls()).toBe(0);
});
it('WA-02: the direct prepare/start of a consultation Query re-reads its source message', async () => {
  const { world, ledger, pending } = await waWorld('wa02');
  await withdraw(world, ledger, pending.messageRef, 'wa02');
  // The formal claim, then the prepare/start routes, straight past the Workflow.
  expect((await world.post('queries/claim', graphWrite(S6A_SCOPE, { queryRunRef: pending.queryRunRef,
    sessionRef: pending.sessionRef }, 'wa02-claim', [{ ref: pending.queryJobRef, revision: 1 },
    { ref: pending.queryRunRef, revision: 1 }, { ref: pending.sessionRef, revision: pending.sessionRevision }]))).body)
    .toMatchObject({ status: 'committed' });
  await startBusyQuery(world.ag2b, pending, 'wa02');
  // The entry begins; the refusal is the model admission's: no Answer, no call.
  expect(world.model.calls()).toBe(0);
  expect((await world.post('queries/read', plain(S6A_SCOPE, pending.queryJobRef))).body).toMatchObject({ status: 'ready',
    value: { job: { job: { answerRefs: [] } }, run: { run: { outcome: 'failed' } } } });
  expect((await world.post('messages/read', plain(S6A_SCOPE, pending.messageRef))).body)
    .toMatchObject({ status: 'ready', value: { status: 'pending', response: null } });
});
// WA-05 at the rejected state: A′ is already running its admitted model call when the person withdraws. The Answer
// is still saved onto the withdrawn message, and the next consume replays that same result without a write or a call.
it('WA-05: a withdrawn message saves its running consultation Answer and replays it', async () => {
  const { world, ledger, pending } = await waWorld('wa05r', false);
  // 1. The refusal the missing Goal causes records the fixed A′ derivation first, so the copy is a public fact.
  const absent: GoalRef = { aggregateType: 'Goal', projectId: S6A_SCOPE.projectId, goalId: 'wa05-no-such-goal' };
  expect((await world.post('workflow/consultation', consultationBody(pending.messageRef, absent))).body)
    .toMatchObject({ status: 'rejected' });
  const inquiry = readyCellValue<SessionMessage>(
    await world.post('messages/read', plain(S6A_SCOPE, pending.messageRef)), 'the inquiry');
  const childRef = inquiry.consultationDerivation?.childSessionRef;
  if (childRef === undefined) throw new Error('WA-05: the refused consultation recorded no A′');
  const card = await world.readSession(childRef);
  const copy: S6ASession = { label: 'wa05-copy', ref: childRef, aggregateRef: card.record.ref,
    role: card.record.role, createdAt: card.record.createdAt };
  world.scriptReplies([{ kind: 'text', text: 'WA-05: the saved consultation answer' }]);
  const held = await world.gates.modelRequest(copy);
  // 2. The second consume submits A′'s Query, claims and starts it on the copy, and is held at A′'s model call.
  const opening = { commits: counted.commits, calls: world.model.calls() };
  const running = world.post('workflow/consultation', consultationBody(pending.messageRef));
  const endedEarly = running.then(() => { throw new Error('WA-05: the consultation ended before A′ reached the model'); });
  endedEarly.catch(() => undefined);
  await Promise.race([held.reached, endedEarly]);
  // 3. The person withdraws while A′ runs; the released model saves its Answer onto the withdrawn message.
  await withdraw(world, ledger, pending.messageRef, 'wa05r');
  expect((await world.post('messages/read', plain(S6A_SCOPE, pending.messageRef))).body)
    .toMatchObject({ status: 'ready', value: { status: 'pending', withdrawnAt: expect.any(String) } });
  held.release();
  const first = await running;
  expect(first.body).toMatchObject({ status: 'ready', value: { state: 'responded',
    answer: { answer: { answer: 'WA-05: the saved consultation answer' } } } });
  expect((await world.post('messages/read', plain(S6A_SCOPE, pending.messageRef))).body)
    .toMatchObject({ status: 'ready', value: { status: 'responded', withdrawnAt: expect.any(String) } });
  const saved = { commits: counted.commits, calls: world.model.calls() };
  // The control: the first consume really called the model and committed after the withdraw; the replay does neither.
  expect({ commits: saved.commits > opening.commits, calls: saved.calls > opening.calls })
    .toEqual({ commits: true, calls: true });
  expect((await world.post('workflow/consultation', consultationBody(pending.messageRef))).body).toEqual(first.body);
  expect({ commits: counted.commits, calls: world.model.calls() }).toEqual(saved);
});

// The gate cells: the one rule at every X-produced state, made by the public commands only — a Work Run's
// send at `awaiting` (`every_step`), the person's allow/deny, the person's withdraw. One table and one
// `it.each`; the two Host rows share one world per state, and every cell asserts on its own.
const gateFacts = (h: C1Harness) => createDispatchBasisReader({ records: h.backend.records,
  pointer: createGoalPointerFacts({ records: h.backend.records }) });
type OpenState = 'awaiting' | 'approved' | 'denied' | 'withdrawn';
/** `readMessagePart`'s four cells: the C1 harness's own Work context sends, the person decides. */
async function openCellState(h: C1Harness, state: OpenState) {
  await h.setGoalAutonomy('every_step');
  const mailbox = h.makeMailbox(h.backend.records, h.materials, undefined, undefined, gateFacts(h));
  const sent = await mailbox.sendMessage(h.ctxWork, { input: { recipient: h.idleSession, text: `open cell ${state}`,
    intent: 'action_request', needsReply: true, expected: { planRevision: 1, pointerRevision: 'none', dispatchSequence: 0 } },
    meta: { requestId: `open-cell-send-${state}`, expected: [] } });
  if (sent.status !== 'committed' || sent.value.release !== 'awaiting') throw new Error(`no awaiting message: ${JSON.stringify(sent)}`);
  const meta = { requestId: `open-cell-decide-${state}`, expected: [] };
  const decided = state === 'awaiting' ? sent : state === 'withdrawn'
    ? await mailbox.withdrawMessage(h.ctxHost, { input: { messageRef: sent.value.ref }, meta })
    : await mailbox.releaseMessage(h.ctxHost, { input: { messageRef: sent.value.ref, allow: state === 'approved' }, meta });
  if (decided.status !== 'committed') throw new Error(`no ${state} message: ${JSON.stringify(decided)}`);
  return mailbox;
}

const cellWorlds: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cellWorlds.splice(0)) await close(); counted.created.length = 0; });

function readyCellValue<T>(answer: S6AHttpAnswer, what: string): T {
  const body = answer.body as { status: string; value?: T };
  if (body.status !== 'ready' || body.value === undefined) throw new Error(`the ${what} is not ready: ${JSON.stringify(answer)}`);
  return body.value;
}

type WaitingCell = {
  world: S6AHostWorld;
  /** The world's own ledger, the one memory backend the seam captured (the withdraw owner's). */
  ledger: InMemoryRecordBackend;
  /** The secretary's line: its Work Run sent the inquiry and yielded waiting for the reply. */
  session: S6ASession;
  /** The Work line the inquiry was addressed to. */
  recipient: S6ASession;
  /** That yielded Run. */
  senderRun: { aggregateType: 'Run'; projectId: string; goalId: string; runId: string };
  /** The saved inquiry, as the mailbox read it back. */
  message: SessionMessage;
};

/**
 * The one state of a cell: `every_step` makes the secretary's Work Run wait for the person on its inquiry to a Work
 * line with no open execution, so the saved message is `awaiting`; the caller's next public command decides the rest.
 */
async function openWaitingCell(label: string): Promise<WaitingCell> {
  const opening = counted.created.length;
  // The Host input the reply Run needs (A8): only the id and `mergeTools` reach the Host's configuration.
  const world = await openS6AHostWorld({ backend: 'memory', secretaryWork: true, extraBindings: [S7A_REPLY_TOOLS] });
  cellWorlds.push(() => world.close().catch(() => undefined));
  const ledger = capturedLedger(counted.created.slice(opening));
  await setS7AAutonomy(world, S6A_GOAL_1, 'every_step');
  const waiting = await world.makeWorkWaitingSecretary(`gate-${label}`);
  const senderRun = (await workRow(world.ag2b)).execution;
  if (senderRun === null) throw new Error('the waiting Work Run is not in the task graph');
  const outbox = readyCellValue<{ items: SessionMessage[] }>(await world.post('messages/outbox',
    plain(S6A_SCOPE, { senderRun, page: { limit: 20 } })), 'waiting outbox');
  const message = outbox.items[0];
  if (message === undefined) throw new Error('the waiting Work Run sent no message');
  return { world, ledger, session: waiting.session, recipient: waiting.recipient, senderRun, message };
}

/** The explicit consultation submit's body: the current pins read publicly and the message's own question text. */
async function submitBody(world: S6AHostWorld, messageRef: SessionMessageRef, recipient: S6ASession, label: string) {
  const registration = await world.platform.projects.readWorkspaceRegistration(world.humanContext(),
    { projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId });
  if (registration.status !== 'ready') throw new Error(`the registration is not readable: ${JSON.stringify(registration)}`);
  const goal = await readGoal(world.ag2b);
  const body = readyCellValue<{ text: string }>(
    await world.post('messages/body', plain(S6A_SCOPE, { messageRef, part: 'message' })), 'waiting body');
  const refs = consultationQueryRefs(messageRef);
  return graphWrite(S6A_SCOPE, { queryJobId: refs.queryJobRef.queryJobId, runId: refs.queryRunRef.runId,
    intent: { schemaVersion: 1, intentId: refs.queryJobRef.queryJobId, projectId: S6A_SCOPE.projectId,
      workspaceId: S6A_SCOPE.workspaceId, goalId: S6A_GOAL_1.goalId, question: body.text, focusTaskRefs: [],
      budget: AG2B_QUERY_BUDGET, multiTurn: { maxRounds: 1 }, correlationId: `gate-${label}`,
      execution: { kind: 'semantic_query', roleBinding: AG2B_WORK_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET,
        consultation: { messageRef, recipient: recipient.ref } } } },
  `gate-submit-${label}`, [{ ref: AG2B_PROJECT_REF, revision: registration.value.project.revision },
    { ref: AG2B_WORKSPACE_REF, revision: registration.value.workspace.revision },
    { ref: S6A_GOAL_1, revision: goal.revision },
    { ref: refs.queryJobRef, revision: 0 }, { ref: refs.queryRunRef, revision: 0 }]);
}

/**
 * The recipient Work line answers the saved inquiry from a real Run: the second Goal's Plan gives the line a Task
 * (`sessions/link` opens the responsible link), the Workflow claims and starts the Run, and the scripted model's
 * reply tool saves the response through the mailbox owner.
 */
async function saveReply(cell: WaitingCell, label: string): Promise<void> {
  const { world } = cell;
  const plan = await adoptS6BPlan(s6aCardsWorkspace(world, S6A_SCOPE), world.goals.second,
    { label: `gate-reply-${label}`, taskIds: [`gate-reply-${label}`], role: S6A_WORK_ROLE.templateId });
  const task = plan.tasks[0];
  if (task === undefined) throw new Error('the reply Plan has no Task');
  await replyS7AMessage(world, { goal: world.goals.second, recipient: cell.recipient, messageRef: cell.message.ref,
    taskId: task.taskId, label, text: `the ${label} reply` });
}

/** The sender's own input supplier over the real mailbox: what a continuation Run of that line would read. */
async function replyInputs(cell: WaitingCell, label: string): Promise<string[]> {
  const execution = await readExecution(cell.world.ag2b, cell.senderRun);
  const ctx: CoreCallContext = { projectId: S6A_SCOPE.projectId, workspaceId: S6A_SCOPE.workspaceId,
    principal: { kind: 'work_run', runRef: cell.senderRun, roleBinding: execution.run.roleBinding },
    materialReader: { kind: 'run', requester: cell.senderRun }, signal: new AbortController().signal };
  const supply = createMailboxInputSupply({ messages: cell.world.platform.messages, context: () => ctx,
    sessionRef: cell.session.ref, runRef: cell.senderRun });
  const items = await supply({ sessionId: cell.session.ref.sessionId, runId: cell.senderRun.runId,
    turnId: `gate-${label}`, afterEventSequence: 0, acceptedInputIds: [] },
  { signal: new AbortController().signal });
  return items.map(item => item.text);
}

/** The Workflow's own continuation claim over the yielded Run and its saved reply. */
async function continuationClaim(cell: WaitingCell, label: string): Promise<unknown> {
  const receipts: WorkflowStepReceipt[] = [];
  await driveWorkflow(cell.world.ag2b, { schemaVersion: 1, goalRef: S6A_GOAL_1, flowId: `gate-claim-${label}`,
    sessionHint: cell.session.ref, kind: 'select_work', taskId: AG2B_WORK_TASK_ID }, { receipts });
  const claim = receipts.find(receipt => receipt.kind === 'claim_task');
  if (claim === undefined) throw new Error(`the ${label} Workflow never performed the continuation claim`);
  return claim.result;
}

/** One state's world, then its cells in order: consume, submit, one saved reply, claim and readResponse. */
async function runWaitingState(state: OpenState, expectedCode: 'busy' | 'invalid' | 'none'): Promise<void> {
  const cell = await openWaitingCell(state);
  // The withdraw route is not published yet: the person's withdraw runs through the real mailbox owner over the
  // world's own shared memory backend (A4).
  if (state === 'withdrawn') await withdraw(cell.world, cell.ledger, cell.message.ref, state);
  // The normal refusals write nothing, so the two can share this state before the one reply is saved.
  if (state === 'awaiting') {
    expect((await cell.world.post('workflow/consultation', consultationBody(cell.message.ref))).body)
      .toMatchObject({ status: 'rejected', code: expectedCode });
  }
  expect((await cell.world.post('queries/submit', await submitBody(cell.world, cell.message.ref, cell.recipient, state))).body)
    .toMatchObject({ status: 'rejected', code: expectedCode });
  await saveReply(cell, state);
  expect(await continuationClaim(cell, state)).toMatchObject({ status: 'rejected', code: expectedCode });
  expect(await replyInputs(cell, state)).toEqual([]);
}

type GateRow =
  | readonly [OpenState, 'readMessagePart', 'none']
  | readonly ['awaiting' | 'withdrawn', 'waiting', 'busy' | 'invalid'];
const gateCells: readonly GateRow[] = [
  ['awaiting', 'readMessagePart', 'none'],
  ['approved', 'readMessagePart', 'none'],
  ['denied', 'readMessagePart', 'none'],
  ['withdrawn', 'readMessagePart', 'none'],
  ['awaiting', 'waiting', 'busy'],
  ['withdrawn', 'waiting', 'invalid'],
];

it.each(gateCells)('the gate cells at %s (%s): no consumer reads a message the rule refuses', async (state, consumer, expectedCode) => {
  if (consumer === 'waiting') {
    await runWaitingState(state, expectedCode);
    return;
  }
  const h = await openHarness();
  const mailbox = await openCellState(h, state);
  const supply = createMailboxInputSupply({ messages: mailbox, context: () => h.ctxHost, sessionRef: h.idleSession,
    runRef: h.claim.runRef });
  // A supplier refuses silently.
  expect((await supply(inputPoint(h), { signal: new AbortController().signal })).map(item => item.text)).toEqual([]);
});
