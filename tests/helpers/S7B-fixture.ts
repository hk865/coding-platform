/**
 * 7B fixture Part A (fixture spec v3 §3; start ruling SR13): the four steps the group's rows drive before K's first row.
 * One S6A host world (memory or SQLite) carries every fact; this file composes the frozen steps of `S7A-fixture.ts`,
 * the cards and 6B fixtures and the public Workflow, and copies no helper. Every state comes from a public step: the
 * Host's own start and routes, `workflow/advance`, the Work Runs' own model tool calls and the public reads.
 * Part B adds the deferred expiry and intervention steps and the wait read; step 9 (`reopenS7BHost`) is L's.
 */
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { TaskTriple, RunRef } from '../../src/contracts/dispatch.js';
import { seqOfCommitCursor, type GoalRef } from '../../src/contracts/ledger.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import type { HandleInterventionResultV1 } from '../../src/business/workflow/ports.js';
import type { SessionFactsV1, SessionWaitV1, SessionWorkWaitV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import {
  deriveSessionInputId, type SessionMessage, type SessionMessagePage,
} from '../../src/core/work-graph/model/communication-contracts.js';
import { driveWorkflow } from './A2-restart-fixture.js';
import { graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from './S6A-cards-fixture.js';
import {
  callPublishedOwnerAsHost, openS6AHostWorld, type S6AHostWorld, type S6AReply, type S6AScriptedModel,
} from './S6A-host-fixture.js';
import {
  S6A_SCOPE, S6A_WORK_ROLE, type S6AClock, type S6ASession, type S6AWorldOptions,
} from './S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine, governS6B } from './S6B1-fixture.js';
import {
  S7A_REPLY_TOOLS, claimedRunOf, committed, ready, replyS7AMessage, sameRun, sameSession, sessionOf,
} from './S7A-fixture.js';

/**
 * Step 1. One real dual-backend world through `openS6AHostWorld`: its `extraBindings` carry the existing
 * `S7A_REPLY_TOOLS` (the Work binding's `respond_session_message`) and the same Work send merge the frozen 7A fixture
 * passes, so the Work binding has `read`, `send_session_message` and `respond_session_message`. Returns the world, its
 * controlled clock and its scripted model. It seeds the world's governance once through the public `governS6B`
 * (once per world, `S6B1-fixture.ts:60`; v3.4 fixture A-01); it opens no store and builds no `CoreCallContext`.
 */
export async function openS7BWorld(options: S6AWorldOptions):
Promise<{ world: S6AHostWorld; clock: S6AClock; scripted: S6AScriptedModel }> {
  const world = await openS6AHostWorld({ ...options, extraBindings: [
    S7A_REPLY_TOOLS, { ...S7A_REPLY_TOOLS, mergeTools: ['send_session_message'] }] });
  await governS6B(world, s6aCardsWorkspace(world, S6A_SCOPE), world.goals);
  return { world, clock: world.clock, scripted: world.scripted };
}

/**
 * Step 2. One goal with two Tasks and two Work Sessions: the sender line is created responsible for its Task, the
 * recipient line is created without one (step 3 opens its link before the reply Run). The sender line's model sends
 * the inquiry with `needsReply` and `waitAfterSend`; `workflow/advance` drives its real Run to the `yielded` /
 * `wait_reply` wait, and `messages/outbox` returns the saved message. Returns both Sessions, the goal, the two Tasks,
 * the yielded Run, its claim and the message ref.
 */
export async function runS7BWait(world: S6AHostWorld, input: { label: string }) {
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  const goal = (await main.createGoal(`s7b-goal-${input.label}`, 'S7B goal')).ref;
  const { tasks } = await adoptS6BPlan(main, goal, { label: `s7b-${input.label}`,
    taskIds: [`s7b-${input.label}-send`, `s7b-${input.label}-reply`], role: S6A_WORK_ROLE.templateId });
  const sender = await sessionOf(world,
    await createS6BLine(main, { label: `s7b-${input.label}-sender`, role: S6A_WORK_ROLE, tasks: [tasks[0]!] }));
  const recipient = await sessionOf(world,
    await createS6BLine(main, { label: `s7b-${input.label}-recipient`, role: S6A_WORK_ROLE }));
  await world.scripted.script(sender, [
    { kind: 'calls', calls: [{ callId: `s7b-${input.label}-send`, name: 'send_session_message',
      args: { recipient: recipient.ref, text: `S7B message from ${input.label}`, intent: 'inquiry',
        needsReply: true, waitAfterSend: true } }] },
    { kind: 'text', text: `S7B ${input.label} answered` },
  ]);
  const receipts: WorkflowStepReceipt[] = [];
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: `s7b-${input.label}`,
    sessionHint: sender.ref, kind: 'select_work', taskId: tasks[0]!.taskId }, { receipts });
  const { claim, run } = claimedRunOf(receipts, `the ${input.label} sender`);
  const outbox = ready<{ items: SessionMessage[] }>(await world.post('messages/outbox',
    plain(S6A_SCOPE, { senderRun: run, page: { limit: 20 } })), `the ${input.label} outbox`);
  const message = outbox.items[0];
  if (message === undefined) throw new Error(`S7B: the ${input.label} send is not in its Run outbox`);
  const record = ready<{ run: { status: string; outcome: string; continuation?: { kind: string } } }>(
    await world.post('executions/read', plain(S6A_SCOPE, run)), `the ${input.label} sender Run`);
  if (record.run.status !== 'ended' || record.run.outcome !== 'yielded'
    || record.run.continuation?.kind !== 'wait_reply') {
    throw new Error(`S7B: the ${input.label} Run did not yield on its reply: ${JSON.stringify(record.run)}`);
  }
  if (!sameSession(claim.sessionRef, sender.ref)) throw new Error(`S7B: the ${input.label} claim is not its line`);
  return { sender, recipient, goal, tasks, run, claim, message: message.ref };
}

/**
 * Step 3. The recipient's own Work Runtime answers: the frozen `replyS7AMessage` opens its responsible link and makes
 * the line's scripted `respond_session_message` call through its real Run; the saved message is read back through
 * `messages/read`, `responded` with the recipient line's own Run as the response sender.
 */
export async function answerS7BWait(world: S6AHostWorld, input: {
  goal: GoalRef; recipient: S6ASession; message: SessionMessage['ref']; task: TaskTriple; label: string;
}): Promise<SessionMessage> {
  await replyS7AMessage(world, { goal: input.goal, recipient: input.recipient, messageRef: input.message,
    taskId: input.task.taskId, label: input.label, text: `S7B ${input.label} reply` });
  const message = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, input.message)),
    `the ${input.label} reply`);
  const sender = message.response?.sender;
  if (message.status !== 'responded' || sender === undefined || sender.kind !== 'work_run'
    || !sameSession(sender.sessionRef, input.recipient.ref)) {
    throw new Error(`S7B: the ${input.label} reply is not the recipient's own Work reply: ${JSON.stringify(message)}`);
  }
  return message;
}

/**
 * Step 4. The original sender's continuation: `workflow/advance` re-drives its yielded Run, the continuation claim
 * creates a successor Run (never the yielded one), and the accepted reply is read back through `messages/read`.
 */
export async function acceptS7BReply(world: S6AHostWorld, input: {
  goal: GoalRef; sender: S6ASession; task: TaskTriple; run: RunRef; message: SessionMessage['ref']; label: string;
}): Promise<{ message: SessionMessage; run: RunRef }> {
  const receipts: WorkflowStepReceipt[] = [];
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: input.goal, flowId: `s7b-${input.label}-accept`,
    sessionHint: input.sender.ref, kind: 'select_work', taskId: input.task.taskId },
  { stopBefore: 'open_checks', receipts });
  const successor = claimedRunOf(receipts, `the ${input.label} continuation`);
  if (sameRun(successor.run, input.run)) throw new Error(`S7B: the ${input.label} continuation is the yielded Run`);
  const message = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, input.message)),
    `the ${input.label} accepted reply`);
  const accepted = message.acceptedInputs?.find(entry => entry.part === 'response');
  if (accepted === undefined || accepted.inputId !== deriveSessionInputId(input.message, 'response')) {
    throw new Error(`S7B: the ${input.label} continuation did not accept the response input`);
  }
  if (accepted.executionRef.aggregateType !== 'Run' || !sameRun(accepted.executionRef, successor.run)) {
    throw new Error(`S7B: the ${input.label} response is not the successor Run's input`);
  }
  return { message, run: successor.run };
}

/**
 * Step 5. The expiry owner on the injected clock: `platform.messageExpiry.recordExpiry` reads the message, calls the
 * one `decideExpiry` rule and commits `expiredAt` only; the reads back are `messages/read` and `sessions/facts`.
 * L publishes the member; until then the last statement is SR11 §11.5's `X-expiry` named-error helper (below).
 */
export async function expireS7BWait(world: S6AHostWorld, input: {
  messageRef: SessionMessage['ref'];
}): Promise<{ message: SessionMessage; wait: SessionWorkWaitV1 | null }> {
  await callPublishedOwnerAsHost(world, 'S7B', {
    owner: 'messageExpiry.recordExpiry', wave: '7B-1 L', scope: S6A_SCOPE,
  }, { messageRef: input.messageRef });
  const message = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, input.messageRef)),
    `the expired message ${input.messageRef.messageId}`);
  if (message.sender.kind !== 'work_run') throw new Error('S7B: the expired message has no Work sender line');
  const facts = ready<SessionFactsV1>(await world.post('sessions/facts', plain(S6A_SCOPE, message.sender.sessionRef)),
    `the wait of ${input.messageRef.messageId}`);
  return { message, wait: facts.wait };
}

/**
 * Step 6. The public wait read: `sessions/facts` returns the facts' `waits` and the singular `wait`, and the same
 * published `platform.sessionFacts` returns one `SessionWaitV1` through `readWait`. The state is the port's; this
 * step neither reads a store nor calls `waitStateOf`.
 */
export async function readS7BWaits(world: S6AHostWorld, input: {
  session: S6ASession; messageRef: SessionMessage['ref'];
}): Promise<{ waits: SessionWaitV1[]; wait: SessionWorkWaitV1 | null; waitByRef: SessionWaitV1 }> {
  const facts = ready<SessionFactsV1>(await world.post('sessions/facts', plain(S6A_SCOPE, input.session.ref)),
    `the waits of ${input.session.label}`);
  const waitByRef = ready<SessionWaitV1>(await world.platform.sessionFacts.readWait(world.humanContext(),
    { messageRef: input.messageRef }), `the wait of ${input.messageRef.messageId}`);
  return { waits: facts.waits, wait: facts.wait, waitByRef };
}

/**
 * Step 7. The sender-lookup world: one line over a plan with as many Tasks as the count needs. Each Task's real Work
 * Run sends its non-waiting inquiries through `send_session_message` within the 16-call Run budget; the last Run
 * sends the one `waitAfterSend` inquiry the way step 2 does. The sender's own outbox reads the messages back, and
 * their commit cursors give the send order. Returns the refs in send order, the sender line and the 100th ref.
 */
export async function openS7BLookupWorld(world: S6AHostWorld, input: { count: number }): Promise<{
  sender: S6ASession; recipient: S6ASession; messages: SessionMessage['ref'][]; pageBoundary: SessionMessage['ref'];
}> {
  const main = s6aCardsWorkspace(world, S6A_SCOPE);
  const goal = (await main.createGoal(`s7b-lookup-goal-${input.count}`, 'S7B lookup goal')).ref;
  const sending = input.count - 1;
  const runs = Math.ceil(sending / 16) + 1;
  const taskIds = Array.from({ length: runs }, (_, index) => `s7b-lookup-${index}`);
  const { tasks } = await adoptS6BPlan(main, goal, { label: 'lookup', taskIds, role: S6A_WORK_ROLE.templateId });
  const sender = await sessionOf(world,
    await createS6BLine(main, { label: 's7b-lookup-sender', role: S6A_WORK_ROLE, tasks }));
  const recipient = await sessionOf(world,
    await createS6BLine(main, { label: 's7b-lookup-recipient', role: S6A_WORK_ROLE }));
  const send = (index: number) => ({ callId: `s7b-lookup-${index}`, name: 'send_session_message',
    args: { recipient: recipient.ref, text: `S7B lookup message ${index}`, intent: 'inquiry' } });
  const replies: S6AReply[] = [];
  for (let index = 0; index < runs; index += 1) {
    const calls = index === runs - 1
      ? [{ ...send(sending), args: { ...send(sending).args, needsReply: true, waitAfterSend: true } }]
      : Array.from({ length: Math.min(16, sending - index * 16) }, (_, offset) => send(index * 16 + offset));
    replies.push({ kind: 'calls', calls }, { kind: 'text', text: `S7B lookup run ${index} answered` });
  }
  await world.scripted.script(sender, replies);
  for (const task of tasks) {
    await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: `s7b-lookup-${task.taskId}`,
      sessionHint: sender.ref, kind: 'select_work', taskId: task.taskId },
    task.taskId === tasks.at(-1)!.taskId ? {} : { stopBefore: 'open_checks' });
  }
  const entries: { ref: SessionMessage['ref']; sequence: number }[] = [];
  let cursor: string | undefined;
  do {
    const page = ready<SessionMessagePage>(await world.post('messages/outbox', plain(S6A_SCOPE, {
      senderSession: sender.ref, page: { limit: 100, ...(cursor === undefined ? {} : { cursor }) },
    })), 'the lookup sender outbox');
    page.items.forEach((message, index) => entries.push({ ref: message.ref,
      sequence: seqOfCommitCursor(page.cursors[index]!) }));
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  entries.sort((left, right) => left.sequence - right.sequence);
  const messages = entries.map(entry => entry.ref);
  if (messages.length !== input.count) throw new Error(`S7B: the lookup sent ${messages.length} of ${input.count}`);
  return { sender, recipient, messages, pageBoundary: messages[99]! };
}

/**
 * Step 8. The minimal existing-task intervention: a real wait on the line (step 2), then a person's message on the
 * same task and line through `messages/send`. The Host's message turn dispatches `workflow.handleIntervention`; L
 * publishes the member. Until then the step's last statement is the existing named-error helper (SR11 §11.5's
 * `B-intervention`; the stable rejection text is the literal below); after release it returns the wait, the
 * intervention Run and the claim.
 */
export async function openS7BInterventionWorld(world: S6AHostWorld, input: { label: string }): Promise<{
  wait: SessionWaitV1; run: RunRef; claim: TaskClaim;
}> {
  const wait = await runS7BWait(world, { label: `s7b-intervention-${input.label}` });
  const sent = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
    recipient: wait.sender.ref, text: `S7B intervention ${input.label}`, intent: 'action_request',
    goalRef: wait.goal, taskRef: wait.tasks[0],
  }, `s7b-${input.label}-intervention`)), `the ${input.label} person message`);
  const claimed = await callPublishedOwnerAsHost(world, 'S7B', {
    owner: 'workflow.handleIntervention', wave: '7B-1 L', scope: S6A_SCOPE,
  }, { messageRef: sent.ref }) as HandleInterventionResultV1;
  if (claimed.status !== 'claimed') throw claimed;
  await driveWorkflow(world.ag2b, { schemaVersion: 1,
    goalRef: { aggregateType: 'Goal', projectId: claimed.claim.task.projectId,
      goalId: claimed.claim.task.goalId },
    flowId: `intervention:${claimed.claim.runRef.runId}`, sessionHint: claimed.claim.sessionRef,
    kind: 'select_work', taskId: claimed.claim.task.taskId });
  const { waitByRef } = await readS7BWaits(world, { session: wait.sender, messageRef: wait.message });
  return { wait: waitByRef, run: claimed.claim.runRef, claim: claimed.claim };
}

/** Step 9. Window A's restart: hold the continuation claim's commit, crash the Host, start a new one on the same
 * SQLite directory, read the message and its wait back, then release the held claim; returns the world and clock. */
export async function reopenS7BHost(world: S6AHostWorld, input: {
  advance: unknown; messageRef: SessionMessage['ref']; session: S6ASession;
}): Promise<{ world: S6AHostWorld; clock: S6AClock; message: SessionMessage; wait: SessionWorkWaitV1 | null }> {
  const { commitBarrier, byIdentityPrefix } = await import('./S6A-commit-barrier.js');
  const hold = commitBarrier.hold(byIdentityPrefix('claim-continuation:'), 'the continuation claim');
  const pending = world.post('workflow/advance', plain(S6A_SCOPE, input.advance));
  await hold.reached;
  await world.crash();
  const message = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, input.messageRef)),
    `the reopened message ${input.messageRef.messageId}`);
  const facts = ready<SessionFactsV1>(await world.post('sessions/facts', plain(S6A_SCOPE, input.session.ref)),
    `the reopened wait of ${input.messageRef.messageId}`);
  hold.release();
  await pending.catch(() => undefined);
  return { world, clock: world.clock, message, wait: facts.wait };
}

/**
 * Step 10. The one message reader (L-10): the S6A world's public `messages/read` turns a `messageRef` into the typed
 * `SessionMessage`. X-accept, X-expiry and L-expiry share this; it is not `common.ts`'s `HostScenario` reader, whose
 * world and return shapes do not fit.
 */
export async function readS7BMessage(world: S6AHostWorld,
  messageRef: SessionMessage['ref']): Promise<SessionMessage> {
  return ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, messageRef)),
    `the message ${messageRef.messageId}`);
}

/**
 * Step 11. The one waiting-inquiry step (L-11): one real Work Run scripts the caller's `send_session_message` body
 * (inquiry, needs a reply, wait after send; the optional `deadlineMs` and `followupOf` are the callers' only
 * differences), drives `workflow/advance`, and returns the waiting message its own outbox saved. `label` names the
 * scripted call and the flow; the caller owns the Goal/Task/Session setup.
 */
export async function sendS7BWaitingInquiry(world: S6AHostWorld, input: {
  goal: GoalRef; session: S6ASession; taskId: string; label: string; trailingText?: boolean;
  body: {
    recipient: S6ASession['ref']; text: string; intent: 'inquiry'; needsReply: true; waitAfterSend: true;
    deadlineMs?: number; followupOf?: SessionMessage['ref'];
  };
}): Promise<SessionMessage> {
  await world.scripted.script(input.session, [
    { kind: 'calls', calls: [{ callId: `s7b-inquiry-${input.label}`, name: 'send_session_message',
      args: input.body }] },
    ...(input.trailingText === false ? [] : [{ kind: 'text' as const, text: `S7B ${input.label} answered` }]),
  ]);
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: input.goal, flowId: `s7b-inquiry-${input.label}`,
    sessionHint: input.session.ref, kind: 'select_work', taskId: input.taskId });
  const outbox = ready<{ items: SessionMessage[] }>(await world.post('messages/outbox',
    plain(S6A_SCOPE, { senderSession: input.session.ref, page: { limit: 20 } })), `the ${input.label} outbox`);
  const message = outbox.items.find(item => item.sender.kind === 'work_run' && item.waitAfterSend === true
    && (input.body.followupOf === undefined ? item.followupOf === null
      : JSON.stringify(item.followupOf) === JSON.stringify(input.body.followupOf)));
  if (message === undefined) throw new Error(`S7B: the ${input.label} waiting inquiry is not in its outbox`);
  return message;
}

/**
 * Step 12. Really retire the waiting sender (L-05): a person's `action_request` opens a real intervention Run on the
 * same line and Task (it consumes no wait). The Run's model reply is the real `send_session_message` tool call, held
 * as it starts; the Kernel store is then moved aside and the Host restarted. The next Host's start-up probe finds the
 * Kernel `missing` and retires the line `unavailable` (`healthConclusion: 'missing'`), as the A2 file-fault path
 * does. The original waiting inquiry is untouched. SQLite only (the Host restart).
 */
export async function retireS7BSender(world: S6AHostWorld, input: {
  goal: GoalRef; sender: S6ASession; task: TaskTriple; label: string;
}): Promise<void> {
  await world.scripted.script(input.sender, [
    { kind: 'calls', calls: [{ callId: `s7b-${input.label}-retire`, name: 'send_session_message',
      args: { recipient: input.sender.ref, text: `S7B ${input.label} retirement notice`, intent: 'notify' } }] },
  ]);
  const hold = await world.gates.toolCall(input.sender, 'send_session_message');
  const sent = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
    recipient: input.sender.ref, text: `S7B retire ${input.label}`, intent: 'action_request',
    goalRef: input.goal, taskRef: input.task,
  }, `s7b-${input.label}-retire`)), `the ${input.label} retirement intervention message`);
  const claimed = await callPublishedOwnerAsHost(world, 'S7B', {
    owner: 'workflow.handleIntervention', wave: '7B-1 L', scope: S6A_SCOPE,
  }, { messageRef: sent.ref }) as HandleInterventionResultV1;
  if (claimed.status !== 'claimed') throw claimed;
  void driveWorkflow(world.ag2b, { schemaVersion: 1,
    goalRef: { aggregateType: 'Goal', projectId: claimed.claim.task.projectId,
      goalId: claimed.claim.task.goalId },
    flowId: `intervention:${claimed.claim.runRef.runId}`, sessionHint: claimed.claim.sessionRef,
    kind: 'select_work', taskId: claimed.claim.task.taskId }).catch(() => undefined);
  await hold.reached;
  const { moveKernelAside } = await import('./A2-restart-fixture.js');
  await moveKernelAside(world.database);
  await world.crash();
}
