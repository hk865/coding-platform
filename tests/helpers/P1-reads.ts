/**
 * P1's public reads and write envelopes, shared by the P1 service rows (contract section 五 "看"): the new owners'
 * `readRequest`/`readHold` as the Host reads them, the dispatch sequence (`goals/dispatch-basis`), a Session's inbox
 * (`messages/inbox`), a Run (`executions/read`) with its control intents (`controls/read`), a Task's rework entries
 * (`tasks/query`), the adopted Plan, and the Workflow's own claim performed through `workflow/advance`; plus the
 * person's sends and Plan change. Every read is a public read and every ref it is given came from a public step.
 */
import type { ActionRequestRef } from '../../src/contracts/action-request.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { ControlIntentRef, ControlIntentSnapshotV1 } from '../../src/contracts/control-intent.js';
import { draftFrom } from '../scenarios/support/common.js';
import type { RunRef, TaskTriple } from '../../src/contracts/dispatch.js';
import type { WorkflowAdvanceInput } from '../../src/business/workflow/contracts.js';
import type { SendMessageResultV1, SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { TaskRow } from '../../src/core/work-graph/model/plan-contracts.js';
import type { ActionRequestV1 } from '../../src/core/work-graph/state/action-request.js';
import type { TaskClaimHoldV1 } from '../../src/core/work-graph/state/task-claim-hold.js';
import { graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from './S6A-cards-fixture.js';
import type { S6AHostWorld } from './S6A-host-fixture.js';
import { S6A_SCOPE } from './S6A-request-fixture.js';
import { committed, ready } from './S7A-fixture.js';
import { readS7A2DispatchBasis } from './S7A2-fixture.js';
import { openP1World, type P1World } from './P1-round-fixture.js';

/** A command envelope (`GraphWrite`) with no pins: the new owners read their own facts in one window. */
export const write = <T>(input: T, requestId: string) => ({ input, meta: { requestId, expected: [] } });

type Ready<T> = { status: 'ready'; value: T } | { status: string };
function readyOrNull<T>(result: Ready<T>, what: string): T | null {
  if (result.status === 'ready') return (result as { value: T }).value;
  if (result.status === 'not_found') return null;
  throw new Error(`P1: ${what} is not readable: ${JSON.stringify(result)}`);
}

/** The Task's `TaskClaimHold` as the Host reads it (2.4 `readHold`); null when the Task has none. */
export async function holdOf(p1: P1World, task: TaskTriple): Promise<TaskClaimHoldV1 | null> {
  const read = await p1.world.platform.claimHolds.readHold(p1.world.humanContext(), { taskRef: task });
  return readyOrNull<TaskClaimHoldV1>(read, 'the hold');
}

/** The request as the Host reads it (2.3 `readRequest`); null when it does not exist. */
export async function requestOf(p1: P1World, ref: ActionRequestRef): Promise<ActionRequestV1 | null> {
  const read = await p1.world.platform.actionRequests.readRequest(p1.world.humanContext(), { ref });
  return readyOrNull<ActionRequestV1>(read, 'the request');
}

/** The `actionRef` an owner's answer carries; an answer without one (a refusal) fails the row with what it said. */
export function actionRefOf(answer: object): ActionRequestRef {
  if ('actionRef' in answer) return answer.actionRef as ActionRequestRef;
  throw new Error(`P1: the answer names no request: ${JSON.stringify(answer)}`);
}

/** The reason of `hold` whose text is `text` (each row writes its own reason text). */
export function reasonNamed(hold: TaskClaimHoldV1 | null, text: string): TaskClaimHoldV1['reasons'][number] {
  const reason = hold?.reasons.find((entry: { reason: string }) => entry.reason === text);
  if (reason === undefined) throw new Error(`P1: no hold reason '${text}' in ${JSON.stringify(hold)}`);
  return reason;
}

/** The pointer's request ref (the record keeps the ref itself, `TaskClaimHold.pendingStop`/`openDispatch`). */
export const pointerRef = (pointer: ActionRequestRef | null | undefined): ActionRequestRef | null => pointer ?? null;

export async function dispatchSequence(p1: P1World): Promise<number> {
  return (await readS7A2DispatchBasis(p1.world, p1.goal)).dispatchSequence;
}

export async function inbox(world: S6AHostWorld, line: { ref: SessionRef }): Promise<SessionMessage[]> {
  return ready<{ items: SessionMessage[] }>(await world.post('messages/inbox', plain(S6A_SCOPE, {
    recipient: line.ref, page: { limit: 50 } })), 'the inbox').items;
}

export async function messageOf(world: S6AHostWorld, ref: SessionMessage['ref']): Promise<SessionMessage> {
  return ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, ref)), 'the message');
}

export async function runRecordOf(world: S6AHostWorld, run: RunRef) {
  return ready<{ run: { revision: number; status: string; controlInputs?: ControlIntentRef[] } }>(
    await world.post('executions/read', plain(S6A_SCOPE, run)), 'the Run').run;
}

/** The Run's directional control intents (its `controlInputs`), each read through `controls/read`. */
export async function steersOf(world: S6AHostWorld, run: RunRef): Promise<ControlIntentSnapshotV1[]> {
  const refs = (await runRecordOf(world, run)).controlInputs ?? [];
  return await Promise.all(refs.map(async ref =>
    ready<ControlIntentSnapshotV1>(await world.post('controls/read', plain(S6A_SCOPE, ref)), 'the control intent')));
}

/** The control intent of a successful answer only: `deliverStop`'s `steer` or a committed `controls/submit`. */
export function answeredIntentOf(answer: unknown): ControlIntentSnapshotV1 | null {
  const read = answer as { status?: string; intent?: ControlIntentSnapshotV1; value?: { intent?: ControlIntentSnapshotV1 } };
  if (read.status === 'steer') return read.intent ?? null;
  return read.status === 'committed' ? read.value?.intent ?? null : null;
}

export async function reworkEntries(p1: P1World, task: TaskTriple) {
  const graph = ready<{ tasks: TaskRow[] }>(await p1.world.post('tasks/query', plain(S6A_SCOPE, { goalRef: p1.goal })),
    'the Task graph');
  return graph.tasks.find(row => row.ref.taskId === task.taskId)?.rework?.entries ?? [];
}

/** The Goal and Run pins a rework names (the person's own `tasks/requeue` pins, read just before). */
export async function reworkPins(p1: P1World, run: RunRef) {
  const goal = ready<{ goal: { revision: number } }>(await p1.world.post('goals/read', plain(S6A_SCOPE, p1.goal)),
    'the Goal');
  const runRevision = (await runRecordOf(p1.world, run)).revision;
  return [{ ref: p1.goal, revision: goal.goal.revision }, { ref: run, revision: runRevision }];
}

/** The Workflow's own claim step, performed through the public `workflow/advance`; the claim result it recorded. */
export async function performClaim(world: S6AHostWorld, step: WorkflowAdvanceInput) {
  type Result = { status: string; code?: string; reason?: string; value?: { sessionRef: SessionRef; runRef: RunRef } };
  const advanced = ready<{ receipt: { kind: string; result: Result } | null }>(
    await world.post('workflow/advance', plain(S6A_SCOPE, step)), 'the claim step');
  if (advanced.receipt?.kind !== 'claim_task') throw new Error(`P1: no claim receipt: ${JSON.stringify(advanced)}`);
  return advanced.receipt.result;
}

/** Waits until a gate holds `call`; a call that settles first (a refusal, as today) fails the row at once. */
export async function reachedBefore(reached: Promise<unknown>, call: Promise<unknown>): Promise<void> {
  const ended = call.then(result => {
    throw new Error(`P1: the call settled before its held point: ${JSON.stringify(result)}`);
  });
  ended.catch(() => undefined);
  await Promise.race([reached, ended]);
}

/** The person's message through `messages/send` (a Host sender); its saved ref. */
export async function personSends(world: S6AHostWorld, to: { ref: SessionRef }, text: string, requestId: string,
  needsReply = true): Promise<SessionMessage['ref']> {
  return committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE,
    { recipient: to.ref, text, intent: 'inquiry', needsReply }, requestId)), 'the person message').ref;
}

/** The person's direct `action_request` on `task` to `to` (the intervention a marked claim carries, Q6a). */
export async function personRequestsAction(p1: P1World, to: { ref: SessionRef }, task: TaskTriple, text: string,
  requestId: string): Promise<SessionMessage['ref']> {
  return committed<SessionMessage>(await p1.world.post('messages/send', graphWrite(S6A_SCOPE, { recipient: to.ref, text,
    intent: 'action_request', needsReply: false, goalRef: p1.goal, taskRef: task }, requestId)),
  'the person action_request').ref;
}

/** The goal's gate Task (`ag2bPlanDraft` adopts one with every P1 Plan), read from the adopted Plan. */
export async function gateTaskOf(p1: P1World): Promise<TaskTriple> {
  const plan = await s6aCardsWorkspace(p1.world, S6A_SCOPE).activePlan(p1.goal);
  const gate = plan?.tasks.find(task => task.taskKind === 'gate');
  if (gate === undefined) throw new Error('P1: the adopted Plan has no gate Task');
  return { projectId: p1.goal.projectId, goalId: p1.goal.goalId, taskId: gate.taskId };
}

/** The person adopts the next Plan revision with `task` cancelled (`plans/propose` on the adopted Plan, `plans/apply`). */
export async function cancelByPlan(p1: P1World, task: TaskTriple, label: string): Promise<void> {
  const plan = await s6aCardsWorkspace(p1.world, S6A_SCOPE).activePlan(p1.goal);
  if (plan === null) throw new Error('P1: no adopted Plan');
  const draft = draftFrom(plan, `p1-plan-${label}`, next => ({ ...next, tasks: next.tasks.map(entry =>
    entry.taskId === task.taskId ? { ...entry, disposition: 'cancelled' as const } : entry) }));
  const proposed = committed<{ ref: unknown; revision: number }>(await p1.world.post('plans/propose',
    graphWrite(S6A_SCOPE, { goalRef: p1.goal, basedOn: plan.ref, draft,
      reason: { text: `P1 ${label}`, sources: [], affectedTaskIds: [task.taskId] } }, `p1-${label}-propose`)),
  'the cancelling Plan');
  committed(await p1.world.post('plans/apply', graphWrite(S6A_SCOPE, { proposalRef: proposed.ref,
    expectedProposalRevision: proposed.revision, decisionRefs: [] }, `p1-${label}-apply`)), 'its adoption');
}

/** A round's reply to `ref` (`respondMessage`), pinned at the message revision the Host reads just before (the
 *  respond model takes its one message pin in `meta.expected`). */
export async function replyAs(world: S6AHostWorld, ctx: CoreCallContext, ref: SessionMessage['ref'], text: string,
  requestId: string) {
  const revision = (await messageOf(world, ref)).revision;
  return world.platform.messages.respondMessage(ctx, { input: { messageRef: ref, text },
    meta: { requestId, expected: [{ ref, revision }] } });
}

/** The saved ref of a committed send; any other answer fails the row with what the owner said. */
export function sentRef(result: SendMessageResultV1): SessionMessage['ref'] {
  if (result.status !== 'committed') throw new Error(`P1: the send did not commit: ${JSON.stringify(result)}`);
  return result.value.ref;
}

/** One test file's P1 worlds: `open` opens and keeps one; `closeAll` (the file's `afterEach`) closes them all. */
export function p1Worlds() {
  const opened: P1World[] = [];
  return {
    async open(options: Parameters<typeof openP1World>[0] = {}): Promise<P1World> {
      const p1 = await openP1World(options);
      opened.push(p1);
      return p1;
    },
    async closeAll(): Promise<void> { for (const p1 of opened.splice(0)) await p1.close(); },
  };
}
