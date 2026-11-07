/**
 * The project's goal adviser queue and its one writer (book :526–:561, L33). `allocate` is the one assignment
 * entry: a candidate adviser takes the goal; else the platform opens a new adviser line (O1b's `role_line_add`) and
 * the goal goes to it; only a line add refused at the cap appends the goal to the queue. The person's `reorder` and
 * `assign` and every internal assignment go through the one internal `write`; `drain` is the bounded walk the Host
 * runs after each lifecycle pass.
 *
 * Every queue commit is the shared event writer with one `GoalAdviserQueueChanged` (D-16): an assignment commits the
 * queue, the goal's responsible link, its `role-scope:` claim, the adviser Session's next revision and the closing of
 * the goal's not-yet-started card and line add in one commit (failed `{cancelled, goal_assigned}`; the approved card
 * still completes), guarded by the queue revision the assignment was decided on, the Goal, its phase, the adviser
 * Session at the revision the choice read (o4a ruling 54) and the link. A line add closed this way is opened again
 * under the next generation's identity (`goal-line#<n>:<goalId>`). A command
 * identity is (operation, the goal's workspace, the principal, commandId): the platform callers share the principal
 * `WORKFLOW_AUTOMATION_ACTOR` and `goal-queue:<goalId>`, so a confirm, a Workflow trigger and a drain entry of one goal
 * are one command and replay one receipt. Every result is the queue record re-read, never projected from an event.
 */
import type { CoreCallContext, CorePrincipal } from '../../../contracts/core/call-context.js';
import type { SessionRef } from '../../../contracts/core/identity.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { SessionWorkLink } from '../../../contracts/core/session.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import { rejected, rejectedWithCurrent } from '../../../contracts/core/rejections.js';
import { canonicalKey, type JsonValue } from '../../../contracts/fingerprint.js';
import { compareCursors } from '../../../contracts/ledger.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { GoalScreeningV1 } from '../../../contracts/query-job.js';
import {
  roleLineDutyOf, type GoalAdviserQueueV1, type NotifyProjectInputV1, type ProjectNoticeV1,
} from '../../../contracts/role-lines.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../../contracts/task-requeue.js';
import type { EncodedRecord, GoalRecordTransactionPort, RecordCommitIdentityPort, RecordGuard } from '../../record-store/ports.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import {
  commandIdentity, commandKeys, executeWriteCommand, type CommitFragment,
} from '../persistence/command-executor.js';
import { readGoalSettings } from '../persistence/record-codecs.js';
import { decodeRun } from '../persistence/run-record-codecs.js';
import {
  lookupCommittedReceipt, lookupCommittedReceiptByIdentity, type CommittedReceipt,
} from '../persistence/receipt-lookup.js';
import type { InitializationBindingReadPort } from '../model/goal-card-contracts.js';
import type { SessionActivityReadPort } from '../model/session-activity-contracts.js';
import type { RoleLineOperationV1, SessionCard, SessionDirectoryPort } from '../model/session-contracts.js';
import type { SessionDutyReadPort } from '../model/work-line-contracts.js';
import { decodeQueryRunSnapshotRecord } from '../queries/query-record-codecs.js';
import { failedRoleLineRecordOf, type RoleLineOperationsPort } from '../sessions/role-line-operations.js';
import { roleLineStepSession } from '../sessions/role-line-operation-write.js';
import { goalAdviserQueueChangedCodec, goalAdviserQueueCodec } from '../sessions/role-line-orchestration-codecs.js';
import { roleLineCommitContribution } from '../sessions/role-scope-commit.js';
import { readHandoffFence } from '../sessions/session-handoff-fence.js';
import { handoffContextOf } from '../sessions/session-handoff-service.js';
import {
  decodeSessionOperationRecord, decodeSessionRecord, decodeSessionWorkLink, encodeSessionOperationRecord,
  encodeSessionRecord, operationRefKey, plainSessionRef, plainSessionRefKey, sessionWorkLinkRefKey,
} from '../sessions/session-record-codecs.js';
import { responsibleLinkRef } from '../sessions/session-responsibility-service.js';
import { eventIdOf, trustedContext } from '../sessions/trusted-context.js';
import { decisionActionPolicy } from '../state/decision-policy.js';
import { dropGoal, emptyGoalAdviserQueue, enqueueGoal, reorderGoals } from '../state/goal-adviser-queue.js';
import { planReanchor } from '../state/reanchor.js';
import { roleLineOperationRef, roleLineStepTransition } from '../state/role-line-operation.js';
import { latestActivityAt } from '../state/session-activity.js';
import { adviserCandidateOf, type AdviserSlotFactsV1 } from './adviser-slots.js';
import { readOwnerRecord, type OwnerRecordRead } from './owner-record-read.js';
import { asWriteRejection } from './plan-result-helpers.js';
import { readGoal, readGoalPhase, readOpenResponsibilityLines } from './plan-readers.js';

export type GoalAdviserQueueDependenciesV1 = {
  records: GoalRecordTransactionPort & RecordLookupPort;      // the queue record + goal/link lookups
  /** A replay reads a committed receipt by its identity alone: an assignment's fingerprint names the adviser. */
  commitIdentities: Pick<RecordCommitIdentityPort, 'readCommitByIdentity'>;
  duty: SessionDutyReadPort;                                   // model/work-line-contracts.ts:19
  sessions: Pick<SessionDirectoryPort, 'findSessions' | 'readSession' | 'getSessionOperation'>;
  activity: Pick<SessionActivityReadPort, 'readSessionActivity'>;
  bindings: Pick<InitializationBindingReadPort, 'readBindingByGoal'>;   // the goal's screening
  lines: Pick<RoleLineOperationsPort, 'open'>;                 // O1b's one create/link writer (role_line_add)
  notices: { projectNoticeWriter(input: NotifyProjectInputV1): Promise<WriteResult<ProjectNoticeV1>> }; // notifyProject
  now(): string;
  eventId(): string;
};

// the internal write kinds; the port's `allocate` is the one public entry (candidate -> assign; else
// role_line_add -> assign; at_cap -> enqueue), and the port's `assign`/`reorder` are thin wrappers over `write`
export type GoalQueueWriteV1 =
  | { commandId: string; kind: 'enqueue'; goalRef: GoalRef }
  | { commandId: string; kind: 'assign'; goalRef: GoalRef; adviser: SessionRef; expectedRevision: number;
      operationRef?: OperationRef }                              // set only by a card approval: closes the saved operation
  | { commandId: string; kind: 'reorder'; expectedRevision: number; order: readonly GoalRef[] };

/** Every arm is a committed value; `needs_decision` is the line add waiting on a person's `role_line_change` card. */
export type GoalAdviserAllocationV1 =
  | { status: 'assigned'; queue: GoalAdviserQueueV1 }
  | { status: 'queued'; queue: GoalAdviserQueueV1 }
  | { status: 'line_pending'; operation: OperationRef; queue: GoalAdviserQueueV1 }
  | { status: 'needs_decision'; cardKey: string; operation: OperationRef; queue: GoalAdviserQueueV1 };

export type GoalDrainResultV1 = { assigned: number; blocked: number; queued: number; more: boolean };

/** A card answer's pin: the saved operation and the revision the card showed. */
type OperationPinV1 = { operationRef: OperationRef; expectedRevision: number };

export interface GoalAdviserQueuePort {
  /** L44: the queue's one project read (route owner `goalAdviserQueue.read`); the route body's input is `{}`. */
  read(ctx: CoreCallContext, input: Record<string, never>): Promise<ReadResult<GoalAdviserQueueV1>>;
  /** A person's reorder: the thin public wrapper over `write`. */
  reorder(ctx: CoreCallContext, input: Omit<Extract<GoalQueueWriteV1, { kind: 'reorder' }>, 'kind'>):
    Promise<WriteResult<GoalAdviserQueueV1>>;
  /** A person's assign: the thin public wrapper over `write`. */
  assign(ctx: CoreCallContext, input: Omit<Extract<GoalQueueWriteV1, { kind: 'assign' }>, 'kind'>):
    Promise<WriteResult<GoalAdviserQueueV1>>;
  /** `approval`: a queue-assign card's approve (only the candidate step); `rejection`: a line-add card's reject
   *  (enqueue and end the operation failed in one commit). A caller passes at most one of them. */
  allocate(ctx: CoreCallContext, input: { commandId: string; goalRef: GoalRef;
    approval?: OperationPinV1; rejection?: OperationPinV1 }): Promise<WriteResult<GoalAdviserAllocationV1>>;
  drain(ctx: CoreCallContext, input: { limit: number }): Promise<ReadResult<GoalDrainResultV1>>;
}

type QueueWriteKindV1 = 'enqueue' | 'reorder' | 'assign' | 'drop' | 'wait';
/** One try of the allocation's decision: its answer, the queue revision it was decided on, the kind it committed
 *  (null when it reached no queue commit) and, for a candidate's assignment, the Session revision the choice read, so
 *  a lost commit can be recovered or decided once more. */
type AllocationAttemptV1 = { result: WriteResult<GoalAdviserAllocationV1>; queueRevision: number | null;
  kind: 'assign' | 'enqueue' | null; adviser?: { session: SessionRef; revision: number } };

/** The writer's one sentence for a card that no longer waits at the revision it showed (`writeDecision`'s). */
const NO_LONGER_WAITS = 'the role-line operation no longer waits on this card';
/** The project's lines are paged as the line maintenance pages them. */
const ADVISER_PAGE_LIMIT = 100;

/** The queue record: no record is the empty queue at revision 0; a damaged record is `unavailable`. */
async function readQueueRecord(records: Pick<GoalRecordTransactionPort, 'readMany'>, projectId: string):
  Promise<{ status: 'ready'; value: GoalAdviserQueueV1 } | CoreRejection> {
  const read = await readOwnerRecord({ store: records,
    refKey: canonicalKey({ aggregateType: 'GoalAdviserQueue', projectId }),
    decode: (record) => goalAdviserQueueCodec.decode(record),
    readError: (message) => rejected('unavailable', `the goal adviser queue read failed: ${message}`) });
  if (read.ok) return { status: 'ready', value: read.value };
  if ('notFound' in read) return { status: 'ready', value: emptyGoalAdviserQueue({ projectId }) };
  return read.rejection.code === 'invalid' ? rejected('unavailable', 'the goal adviser queue record is damaged')
    : read.rejection;
}

/** O4a-03: the first queue write is guarded by absence; revision 0 is never stored. */
function queueGuardOf(queue: GoalAdviserQueueV1): RecordGuard {
  return { refKey: canonicalKey(queue.ref), expectedRevision: queue.revision === 0 ? null : queue.revision };
}

function queueEntryOf(queue: GoalAdviserQueueV1, goalRef: GoalRef): GoalAdviserQueueV1['entries'][number] | undefined {
  const key = canonicalKey(goalRef);
  return queue.entries.find((entry) => canonicalKey(entry.goalRef) === key);
}

function inQueue(queue: GoalAdviserQueueV1, goalRef: GoalRef): boolean {
  return queueEntryOf(queue, goalRef) !== undefined;
}

/** TS-19's context (终稿 :1349–:1356) bound to the goal's own workspace, with the caller's principal: whichever
 *  workspace a caller comes from, one goal, one principal and one commandId are one command. */
function goalContextOf(goal: GoalSnapshot, ctx: CoreCallContext): CoreCallContext {
  const scoped = { ...ctx, projectId: goal.workspaceRef.projectId, workspaceId: goal.workspaceRef.workspaceId };
  return ctx.principal.kind === 'host' ? handoffContextOf(scoped, ctx.principal) : scoped;
}

/** The platform's principal: every platform allocation shares it, so its command identity is the same. */
function platformPrincipal(): CorePrincipal {
  return { kind: 'host', actor: { ...WORKFLOW_AUTOMATION_ACTOR } };
}

function ownerReadValue<T>(read: OwnerRecordRead<T>): { status: 'ready'; value: T | null } | CoreRejection {
  if (read.ok) return { status: 'ready', value: read.value };
  return 'notFound' in read ? { status: 'ready', value: null } : read.rejection;
}

/** The approved card's terminal record of an assignment that answers it (v4 :4939–:4942). */
function closedOperationOf(operation: RoleLineOperationV1, at: string): RoleLineOperationV1 {
  return { ...operation, revision: operation.revision + 1, updatedAt: at, phase: 'completed',
    action: { ...operation.action, phase: 'done', result: { status: 'done', reason: null } } };
}

/** The end reason of an operation an assignment made moot (o5b ruling 25). */
const GOAL_ASSIGNED = 'goal_assigned';

/** A goal's line-add identity of one generation: generation 1 is `goal-line:<goalId>`, generation n ≥ 2 is
 *  `goal-line#<n>:<goalId>` (n in decimal). */
function lineAddCommandId(goalId: string, generation: number): string {
  return generation === 1 ? `goal-line:${goalId}` : `goal-line#${generation}:${goalId}`;
}

/** A platform allocation command's identity of one generation: generation 1 is `goal-queue:<goalId>`, generation
 *  n ≥ 2 is `goal-queue#<n>:<goalId>` (n in decimal). */
function allocationCommandId(goalId: string, generation: number): string {
  return generation === 1 ? `goal-queue:${goalId}` : `goal-queue#${generation}:${goalId}`;
}

/** A queue-assign card's identity of one generation: generation 1 is `goal-queue-assign:<goalId>`, generation n ≥ 2
 *  is `goal-queue-assign#<n>:<goalId>`. */
function queueCardCommandId(goalId: string, generation: number): string {
  return generation === 1 ? `goal-queue-assign:${goalId}` : `goal-queue-assign#${generation}:${goalId}`;
}

/** The SessionWorkLink record an assignment receipt wrote; null when it names none. */
function assignmentLinkKeyOf(receipt: CommittedReceipt): string | null {
  return receipt.versions.map((version) => version.refKey)
    .find((refKey) => (JSON.parse(refKey) as { aggregateType?: unknown }).aggregateType === 'SessionWorkLink')
    ?? null;
}

/** One generation's current allocation command and the assignment still alive under it, if any. */
type CurrentAllocationCommandV1 = { commandId: string; generation: number;
  assignment: { receipt: CommittedReceipt; link: SessionWorkLink } | null };

/** One generation's queue-assign card: its identity and its saved operation, or null when it has none. */
type CurrentQueueCardV1 = { commandId: string; generation: number; operation: RoleLineOperationV1 | null };

/** The record an assignment ends a not-yet-started card or line add with, or `null` when the operation is not one an
 *  assignment ends (its record phase is not `accepted`, or a step has left `pending`). */
function goalAssignedCloseOf(operation: RoleLineOperationV1, at: string): RoleLineOperationV1 | null {
  if (operation.phase !== 'accepted' || operation.action.steps.some((step) => step.state !== 'pending')) return null;
  let action = operation.action;
  for (let index = 0; index < action.steps.length; index += 1) {
    const moved = roleLineStepTransition(action, index, { state: 'failed' });
    if (!moved.ok) return null;
    action = moved.action;
  }
  return failedRoleLineRecordOf(operation, action, rejected('cancelled', GOAL_ASSIGNED), at);
}

/** One saved operation a commit ends: the record as read and the record the commit writes. */
type OperationClosingV1 = { prior: RoleLineOperationV1; next: RoleLineOperationV1 };

/** The records and guards of the operations one commit ends: each `next` record, guarded at its `prior` revision. */
function closingWritesOf(closing: readonly OperationClosingV1[]): { records: EncodedRecord[]; guards: RecordGuard[] } {
  return {
    records: closing.map((entry) => encodeSessionOperationRecord(entry.next)),
    guards: closing.map((entry) => ({ refKey: operationRefKey(entry.prior.ref), expectedRevision: entry.prior.revision })),
  };
}

export function createGoalAdviserQueueService(deps: GoalAdviserQueueDependenciesV1): GoalAdviserQueuePort {
  const readError = (message: string): CoreRejection => rejected('unavailable', `a queue read failed: ${message}`);

  /** A saved role-line operation by its ref, wherever it lives (a queue card in the goal's workspace, a line add in
   *  the main one); `null` when absent. */
  async function readRoleLineOperation(ref: OperationRef):
    Promise<{ status: 'ready'; value: RoleLineOperationV1 | null } | CoreRejection> {
    const read = ownerReadValue(await readOwnerRecord({ store: deps.records, refKey: operationRefKey(ref),
      decode: decodeSessionOperationRecord, readError }));
    if (read.status !== 'ready' || read.value === null) return read as { status: 'ready'; value: null } | CoreRejection;
    if (read.value.action.kind !== 'role_line') return rejected('invalid', 'not a role_line operation');
    return { status: 'ready', value: read.value as RoleLineOperationV1 };
  }

  /** The responsible link an assignment receipt wrote, as stored now. */
  async function assignmentLinkOf(receipt: CommittedReceipt):
    Promise<{ status: 'ready'; value: SessionWorkLink } | CoreRejection> {
    const linkKey = assignmentLinkKeyOf(receipt);
    if (linkKey === null) return rejected('unavailable', 'the assignment receipt names no responsible link');
    const link = ownerReadValue(await readOwnerRecord({ store: deps.records, refKey: linkKey,
      decode: decodeSessionWorkLink, readError }));
    if (link.status !== 'ready') return link;
    if (link.value === null) return rejected('unavailable', 'the assignment receipt names a missing link');
    return { status: 'ready', value: link.value };
  }

  /** The goal's current platform allocation generation: the first generation that is not used up. A generation is used
   *  up when its assignment's link is closed, its enqueue receipt no longer matches the queued entry, a drop receipt
   *  exists, or (without a platform receipt) its saved wait card belongs to a round that already left the queue. */
  async function currentAllocationCommandOf(goalCtx: CoreCallContext, goalRef: GoalRef):
    Promise<{ status: 'ready'; value: CurrentAllocationCommandV1 } | CoreRejection> {
    for (let generation = 1; ; generation += 1) {
      const commandId = allocationCommandId(goalRef.goalId, generation);
      const assign = await lookupCommittedReceiptByIdentity(deps.commitIdentities,
        queueIdentityOf(goalCtx, 'assign', commandId));
      if (assign.status !== 'missing') {
        if (assign.status !== 'found') return rejected(assign.status, assign.reason);
        const link = await assignmentLinkOf(assign.receipt);
        if (link.status !== 'ready') return link;
        if (link.value.until !== null) continue;
        return { status: 'ready', value: { commandId, generation,
          assignment: { receipt: assign.receipt, link: link.value } } };
      }
      const enqueue = await lookupCommittedReceiptByIdentity(deps.commitIdentities,
        queueIdentityOf(goalCtx, 'enqueue', commandId));
      if (enqueue.status !== 'missing') {
        if (enqueue.status !== 'found') return rejected(enqueue.status, enqueue.reason);
        const queue = await readQueueRecord(deps.records, goalRef.projectId);
        if (queue.status !== 'ready') return queue;
        const entry = queueEntryOf(queue.value, goalRef);
        if (entry === undefined || entry.enqueuedAt !== enqueue.receipt.cursor) continue;
        return { status: 'ready', value: { commandId, generation, assignment: null } };
      }
      const drop = await lookupCommittedReceiptByIdentity(deps.commitIdentities,
        queueIdentityOf(goalCtx, 'drop', commandId));
      if (drop.status !== 'missing') {
        if (drop.status !== 'found') return rejected(drop.status, drop.reason);
        continue;
      }
      const card = await queueCardAt(goalRef, generation);
      if (card.status !== 'ready') return card;
      if (card.value.operation !== null) {
        const queue = await readQueueRecord(deps.records, goalRef.projectId);
        if (queue.status !== 'ready') return queue;
        const entry = queueEntryOf(queue.value, goalRef);
        if (entry === undefined) continue;
        const wait = await lookupCommittedReceiptByIdentity(deps.commitIdentities,
          queueIdentityOf(goalCtx, 'wait', queueCardCommandId(goalRef.goalId, generation)));
        if (wait.status !== 'missing') {
          if (wait.status !== 'found') return rejected(wait.status, wait.reason);
          if (compareCursors(entry.enqueuedAt, wait.receipt.cursor) > 0) continue;
        }
      }
      return { status: 'ready', value: { commandId, generation, assignment: null } };
    }
  }

  /** One generation's queue-assign card. */
  async function queueCardAt(goalRef: GoalRef, generation: number):
    Promise<{ status: 'ready'; value: CurrentQueueCardV1 } | CoreRejection> {
    const commandId = queueCardCommandId(goalRef.goalId, generation);
    const saved = await readRoleLineOperation({ aggregateType: 'CoreOperation', projectId: goalRef.projectId,
      operationId: commandId });
    if (saved.status !== 'ready') return saved;
    return { status: 'ready', value: { commandId, generation, operation: saved.value } };
  }

  /** The goal's queue-assign card of the current allocation generation. */
  async function currentQueueCardOf(goalCtx: CoreCallContext, goalRef: GoalRef):
    Promise<{ status: 'ready'; value: CurrentQueueCardV1 } | CoreRejection> {
    const current = await currentAllocationCommandOf(goalCtx, goalRef);
    if (current.status !== 'ready') return current;
    return queueCardAt(goalRef, current.value.generation);
  }

  /** The goal's current line add: the first generation not ended `goal_assigned`, and not a completed add whose line
   *  was archived. */
  async function currentLineAddOf(ctx: CoreCallContext, goalRef: GoalRef):
    Promise<{ status: 'ready'; value: { commandId: string; operation: RoleLineOperationV1 | null } } | CoreRejection> {
    for (let generation = 1; ; generation += 1) {
      const commandId = lineAddCommandId(goalRef.goalId, generation);
      const saved = await readRoleLineOperation(roleLineOperationRef(goalRef.projectId, 'open:add', commandId));
      if (saved.status !== 'ready') return saved;
      const operation = saved.value;
      if (operation === null) return { status: 'ready', value: { commandId, operation } };
      if (operation.phase === 'failed' && operation.failure?.reason === GOAL_ASSIGNED) continue;
      if (operation.phase === 'completed') {
        const step = operation.action.steps[0];
        if (step !== undefined) {
          const lineCtx = { ...ctx, workspaceId: operation.workspaceId };
          const planned = await roleLineStepSession(deps.sessions, lineCtx, step);
          if (planned.status === 'not_found') {
            return rejected('unavailable', 'the completed line add names a missing child operation');
          }
          if (planned.status === 'rejected') return rejected(planned.code, planned.reason);
          if (planned.status !== 'ready') {
            return rejected('unavailable', 'the completed line add child operation is not readable');
          }
          if (planned.value !== null) {
            const line = await deps.sessions.readSession(lineCtx, planned.value);
            if (line.status === 'not_found') {
              return rejected('unavailable', 'the line the completed line add created is missing');
            }
            if (line.status === 'rejected') return rejected(line.code, line.reason);
            if (line.status !== 'ready') {
              return rejected('unavailable', 'the line the completed line add created is not readable');
            }
            if (line.value.record.lifecycle === 'archived') continue;
          }
        }
      }
      return { status: 'ready', value: { commandId, operation } };
    }
  }

  /** The goal's current line add ended `goal_assigned` at `at`; `null` when it has none or it is not one an assignment
   *  ends. */
  async function lineAddClosingOf(ctx: CoreCallContext, goalRef: GoalRef, at: string):
    Promise<{ status: 'ready'; value: OperationClosingV1 | null } | CoreRejection> {
    const current = await currentLineAddOf(ctx, goalRef);
    if (current.status !== 'ready') return current;
    const operation = current.value.operation;
    if (operation === null) return { status: 'ready', value: null };
    const next = goalAssignedCloseOf(operation, at);
    return { status: 'ready', value: next === null ? null : { prior: operation, next } };
  }

  /** The goal's screening, from the binding the confirm wrote (`role-line-maintenance.ts` reads it the same way). */
  async function goalScreeningOf(ctx: CoreCallContext, goalRef: GoalRef):
    Promise<{ status: 'ready'; value: GoalScreeningV1 | null } | CoreRejection> {
    const bindings = await deps.bindings.readBindingByGoal(ctx, { goalRef });
    if (bindings.status !== 'ready') return asWriteRejection(bindings, 'the goal screening');
    return { status: 'ready', value: bindings.value[0]?.screening ?? null };
  }

  /** The same command identity the executor folds a queue commit under (`commandIdentity`, command-executor.ts:31). */
  function queueIdentityOf(ctx: CoreCallContext, kind: QueueWriteKindV1, commandId: string): string {
    return commandIdentity({ operation: `goal-adviser-queue:${kind}`,
      scope: { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null },
      principal: ctx.principal as unknown as JsonValue, commandId });
  }

  /** C/book :863–:866: one goal notice per assignment command; the writer's identity makes a replay write none, and a
   *  refused notice does not undo the committed assignment. */
  async function noticeAssignment(projectId: string, goalRef: GoalRef, adviser: SessionRef, commandId: string):
    Promise<void> {
    await deps.notices.projectNoticeWriter({ projectRef: { projectId }, subject: { kind: 'goal', goalRef },
      kind: 'automatic_adjustment',
      summary: `队列分配：${goalRef.goalId} → 顾问 ${adviser.sessionId}（规则：队列顺序；可重排或调高上限）`,
      operation: { aggregateType: 'CoreOperation', projectId, operationId: commandId } });
  }

  /** The replay answer: the queue as it is now, under the original receipt's cursor. */
  async function replayedQueue(projectId: string, cursor: Extract<WriteResult<unknown>, { status: 'committed' }>['cursor']):
    Promise<WriteResult<GoalAdviserQueueV1>> {
    const queue = await readQueueRecord(deps.records, projectId);
    if (queue.status !== 'ready') return queue;
    return { status: 'committed', value: queue.value, replayed: true, cursor };
  }

  /** An assignment already committed under this identity: its adviser is the one link the original receipt wrote.
   *  A caller that already read the receipt and its link passes them as `first` instead of reading them again. */
  async function replayedAssignment(goalCtx: CoreCallContext, goalRef: GoalRef, commandId: string,
    first?: { receipt: CommittedReceipt; link: SessionWorkLink }):
    Promise<WriteResult<GoalAdviserAllocationV1> | null> {
    let receipt: CommittedReceipt;
    let link: SessionWorkLink;
    if (first !== undefined) {
      receipt = first.receipt;
      link = first.link;
    } else {
      const found = await lookupCommittedReceiptByIdentity(deps.commitIdentities,
        queueIdentityOf(goalCtx, 'assign', commandId));
      if (found.status === 'missing') return null;
      if (found.status !== 'found') return rejected(found.status, found.reason);
      const read = await assignmentLinkOf(found.receipt);
      if (read.status !== 'ready') return read;
      receipt = found.receipt;
      link = read.value;
    }
    await noticeAssignment(goalCtx.projectId, goalRef, plainSessionRef(link.ref), commandId);
    const queue = await replayedQueue(goalCtx.projectId, receipt.cursor);
    return queue.status === 'committed' ? { ...queue, value: { status: 'assigned', queue: queue.value } } : queue;
  }

  /** An enqueue already committed under this identity answers `queued` with its original cursor. */
  async function replayedEnqueue(goalCtx: CoreCallContext, commandId: string):
    Promise<WriteResult<GoalAdviserAllocationV1> | null> {
    const found = await lookupCommittedReceiptByIdentity(deps.commitIdentities,
      queueIdentityOf(goalCtx, 'enqueue', commandId));
    if (found.status === 'missing') return null;
    if (found.status !== 'found') return rejected(found.status, found.reason);
    const queue = await replayedQueue(goalCtx.projectId, found.receipt.cursor);
    return queue.status === 'committed' ? { ...queue, value: { status: 'queued', queue: queue.value } } : queue;
  }

  /**
   * D-16 (TS-14): every queue commit is the shared writer's event path (`command-executor.ts:190`). The fragment is
   * the one the caller already built; the queue event is appended LAST, because the receipt check reads its last event
   * id. `revision` is the queue record revision this commit leaves (unchanged for the saved-operation commit). The
   * result is the owner's own record re-read (c04), never projected from the event.
   */
  async function commitQueue(ctx: CoreCallContext, input: {
    kind: QueueWriteKindV1; commandId: string; fingerprintInput: JsonValue; fragment: CommitFragment; revision: number;
  }): Promise<WriteResult<GoalAdviserQueueV1>> {
    const trusted = trustedContext(ctx, 'a goal adviser queue write');
    if (!trusted.ok) return trusted.rejection;
    const projectId = trusted.scope.projectId;
    const committed = await executeWriteCommand(deps.records, {
      operation: `goal-adviser-queue:${input.kind}`, principal: ctx.principal as unknown as JsonValue,
      commandId: input.commandId,
      scope: { projectId, workspaceId: trusted.scope.workspaceId },
      fingerprintInput: input.fingerprintInput,
      read: async () => ({ status: 'ready' as const, facts: null }),   // the caller read and guarded everything already
      decide: (): { refuse: never } | { decision: null } => ({ decision: null }),
      build: (_decision, keys) => ({ ...input.fragment, events: [...input.fragment.events,
        goalAdviserQueueChangedCodec.encode({ eventId: eventIdOf(keys.identityKey, 'changed'),
          eventType: 'GoalAdviserQueueChanged', schemaVersion: 1, occurredAt: deps.now(), projectId,
          workspaceId: trusted.scope.workspaceId, actor: trusted.actor, revision: input.revision })] }),
      result: { eventType: 'GoalAdviserQueueChanged', schemaVersion: 1,
        decode: (event) => goalAdviserQueueChangedCodec.decode(event),
        validate: (event, receipt, keys) => event.projectId !== projectId
          || event.workspaceId !== trusted.scope.workspaceId ? 'the event records another scope'
          : receipt.identityKey === keys.identityKey ? null : 'the receipt belongs to another command',
        project: (event) => event.revision },
    });
    if (committed.status === 'refused') return committed.refusal;
    if (committed.status === 'rejected') return rejectedWithCurrent(committed.code, committed.reason, committed.current);
    const queue = await readQueueRecord(deps.records, projectId);
    if (queue.status !== 'ready') return queue;
    return { status: 'committed', value: queue.value, replayed: committed.replayed, cursor: committed.cursor };
  }

  /** One queue append: the entry's `enqueuedAt` is bound to this commit's cursor by the Store (book :535). `extra`
   *  rides in the same commit (a line-add card's reject ends its operation here). */
  function enqueueFragmentOf(queue: GoalAdviserQueueV1, goalRef: GoalRef, screening: GoalScreeningV1 | null,
    extra: { records: readonly EncodedRecord[]; guards: readonly RecordGuard[] }): CommitFragment {
    const queueKey = canonicalKey(queue.ref);
    return { records: [goalAdviserQueueCodec.encode(enqueueGoal(queue, { goalRef, enqueuedAt: null, screening })),
      ...extra.records],
    guards: [queueGuardOf(queue), ...extra.guards], claims: [], events: [],
    commitCursorBindings: [{ refKey: queueKey, field: 'entries[].enqueuedAt' }] };
  }

  /**
   * The one write. A command already committed under its identity and input answers its receipt first, before the
   * queue is compared: the first success moves the queue, so a replay compared first would be a conflict. Then an
   * assignment or reorder must be decided on the queue revision it names (book :531, :541). `pinned.adviser` is the
   * adviser Session as the candidate step read it; without one (a person's assign, a line just opened) it is read here.
   */
  async function write(ctx: CoreCallContext, input: GoalQueueWriteV1,
    pinned: { approval?: { expectedRevision: number }; adviser?: SessionCard['record']; generation?: number } = {}):
    Promise<WriteResult<GoalAdviserQueueV1>> {
    const trusted = trustedContext(ctx, 'a goal adviser queue write');
    if (!trusted.ok) return trusted.rejection;
    const projectId = trusted.scope.projectId;
    const fingerprintInput: JsonValue = input.kind === 'enqueue' ? { goalRef: input.goalRef }
      : input.kind === 'reorder' ? { order: [...input.order], expectedRevision: input.expectedRevision }
      : { goalRef: input.goalRef, adviser: input.adviser, expectedRevision: input.expectedRevision };
    const keys = commandKeys({ operation: `goal-adviser-queue:${input.kind}`,
      scope: { projectId, workspaceId: trusted.scope.workspaceId },
      principal: ctx.principal as unknown as JsonValue, commandId: input.commandId, fingerprintInput });
    const prior = await lookupCommittedReceipt(deps.records, keys.identityKey, keys.fingerprint);
    if (prior.status === 'found') {
      // the fingerprint names the adviser, so the original assignment's adviser is this input's
      if (input.kind === 'assign') await noticeAssignment(projectId, input.goalRef, input.adviser, input.commandId);
      return replayedQueue(projectId, prior.receipt.cursor);
    }
    if (prior.status === 'conflict') return rejected('idempotency_conflict', prior.reason);
    if (prior.status !== 'missing') return rejected('unavailable', prior.reason);

    const queue = await readQueueRecord(deps.records, projectId);
    if (queue.status !== 'ready') return queue;
    if (input.kind !== 'enqueue' && queue.value.revision !== input.expectedRevision) {
      return rejected('revision_conflict', 'the queue changed after this write read it');
    }
    if (input.kind === 'enqueue') {
      const screening = await goalScreeningOf(ctx, input.goalRef);
      if (screening.status !== 'ready') return screening;
      return commitQueue(ctx, { kind: 'enqueue', commandId: input.commandId, fingerprintInput,
        fragment: enqueueFragmentOf(queue.value, input.goalRef, screening.value, { records: [], guards: [] }),
        revision: queue.value.revision + 1 });
    }
    if (input.kind === 'reorder') {
      const next = reorderGoals(queue.value, input.order);
      if (next === null) return rejected('invalid', 'a reorder names every queued goal exactly once');
      return commitQueue(ctx, { kind: 'reorder', commandId: input.commandId, fingerprintInput,
        fragment: { records: [goalAdviserQueueCodec.encode(next)], guards: [queueGuardOf(queue.value)],
          claims: [], events: [] },
        revision: next.revision });
    }

    // assign: the Goal and its phase (a formally completed goal is never assigned; completion writes only the
    // GoalPhase, so the Goal revision alone does not fence it), the adviser Session by its own key (it lives in the
    // main workspace, the goal maybe not), and the responsible link as it is stored now.
    const goal = await readGoal(deps.records, input.goalRef);
    if (goal.status !== 'ready') return goal;
    const phase = await readGoalPhase(deps.records,
      { aggregateType: 'GoalPhase', projectId: input.goalRef.projectId, goalId: input.goalRef.goalId });
    if (phase.status !== 'ready') return phase;
    if (phase.snapshot !== null) return rejected('revision_conflict', 'the goal is formally completed');
    const adviserRead = pinned.adviser !== undefined ? { status: 'ready' as const, value: pinned.adviser }
      : ownerReadValue(await readOwnerRecord({ store: deps.records, refKey: plainSessionRefKey(input.adviser),
        decode: decodeSessionRecord, readError }));
    if (adviserRead.status !== 'ready') return adviserRead;
    if (adviserRead.value === null) return rejected('not_found', 'the adviser Session does not exist');
    const adviser = adviserRead.value;
    // O5b ruling 35: the destination must be an adviser line. A person's assign may name any Session ref, and
    // `planReanchor` checks only that the destination may take the link, never its duty; the allocation's own
    // assignments pass the same check through the same duty read its candidate step uses (:510–:512).
    const destinationDuty = await deps.duty(adviser.role, ctx);
    if (destinationDuty.status !== 'ready') return asWriteRejection(destinationDuty, 'the destination Session duty');
    if (roleLineDutyOf(destinationDuty.value) !== 'adviser') {
      return rejected('invalid', 'the destination Session is not an adviser line');
    }
    const target = { kind: 'goal' as const, ref: input.goalRef };
    const link = responsibleLinkRef(input.adviser, target);
    const existing = ownerReadValue(await readOwnerRecord({ store: deps.records, refKey: sessionWorkLinkRefKey(link),
      decode: decodeSessionWorkLink, readError }));
    if (existing.status !== 'ready') return existing;
    // o4a ruling 59: the goal already has this adviser (a person's assign won the race the recompute lost); the open
    // below would write no link, and a receipt with no link cannot be replayed
    if (existing.value !== null && existing.value.until === null) return rejected('revision_conflict', 'goal_has_adviser');
    // o4a ruling 54: the goal responsibility's one open (planReanchor's `open`, D-3) refuses a destination that is no
    // longer eligible and moves the adviser Session's revision, so an archive committed on either side of this
    // assignment conflicts with it; a goal destination reads no catalog
    const planned = planReanchor({ projectRef: { projectId }, duty: 'adviser', moves: [], open: [{ link, target }],
      facts: { sessions: new Map([[adviser.ref.sessionId, adviser]]),
        links: new Map(existing.value === null ? [] : [[canonicalKey(link), existing.value]]),
        goals: new Map([[input.goalRef.goalId, { state: 'present' as const, ref: input.goalRef, snapshot: goal.goal,
          version: { ref: input.goalRef, revision: goal.goal.revision } }]]),
        catalog: { state: 'none', revision: 0 } },
      authorization: { actor: trusted.actor, scope: [{ kind: 'project' }] }, proposed: null });
    if (!planned.ok) return planned.refusals[0]!;

    // The operations this assignment makes moot: an approval names the card it answers and closes it completed; a
    // plain assignment closes the goal's waiting card; either closes the goal's current line add (o5b ruling 25).
    const at = deps.now();
    const closing: OperationClosingV1[] = [];
    if (input.operationRef !== undefined) {
      const pin = pinned.approval!;   // only an approval passes both; its one caller is `allocate`'s approval step
      const saved = await readRoleLineOperation(input.operationRef);
      if (saved.status !== 'ready') return saved;
      if (saved.value === null || saved.value.action.result?.status !== 'waiting'
        || saved.value.revision !== pin.expectedRevision) return rejected('source_stale', NO_LONGER_WAITS);
      closing.push({ prior: saved.value, next: closedOperationOf(saved.value, at) });
    } else {
      const card = pinned.generation === undefined
        ? await currentQueueCardOf(goalContextOf(goal.goal, { ...ctx, principal: platformPrincipal() }), input.goalRef)
        : await queueCardAt(input.goalRef, pinned.generation);
      if (card.status !== 'ready') return card;
      const next = card.value.operation === null ? null : goalAssignedCloseOf(card.value.operation, at);
      if (card.value.operation !== null && next !== null) closing.push({ prior: card.value.operation, next });
    }
    const add = await lineAddClosingOf(ctx, input.goalRef, at);
    if (add.status !== 'ready') return add;
    if (add.value !== null) closing.push(add.value);
    const writes = closingWritesOf(closing);
    const contribution = roleLineCommitContribution({
      projectRef: { projectId },
      records: [goalAdviserQueueCodec.encode(dropGoal(queue.value, input.goalRef)),
        ...planned.plan.sessions.map(encodeSessionRecord),
        ...writes.records],
      guards: [
        queueGuardOf(queue.value),
        { refKey: canonicalKey(input.goalRef), expectedRevision: goal.goal.revision },
        phase.guard,
        { refKey: plainSessionRefKey(input.adviser), expectedRevision: adviser.revision },
        { refKey: sessionWorkLinkRefKey(link), expectedRevision: existing.value?.revision ?? null },
        ...writes.guards,
      ],
      links: planned.plan.links, claimChanges: planned.plan.claimChanges, bindings: planned.plan.bindings,
      events: [],
      allocation: null,                                  // a person assign may exceed 3; no seat is re-admitted here
    }, null);
    if (!contribution.ok) return contribution.rejection;
    const committed = await commitQueue(ctx, { kind: 'assign', commandId: input.commandId, fingerprintInput,
      fragment: contribution.fragment, revision: queue.value.revision + 1 });
    if (committed.status === 'committed') {
      await noticeAssignment(projectId, input.goalRef, input.adviser, input.commandId);
    }
    return committed;
  }

  // ------------------------------------------------------------------------
  // the allocation's facts
  // ------------------------------------------------------------------------

  /** The instant of the line's last execution (the line card's clock gathers the same instant); null when it has
   *  none yet. Only an absent record is missing: a Run or Query that is claimed, preparing or waiting for a run slot
   *  has no start or end yet (o4a ruling 53), and that legal null goes to `latestActivityAt`. */
  async function lastExecutionAtOf(ctx: CoreCallContext, record: SessionCard['record']):
    Promise<{ status: 'ready'; value: string | null } | CoreRejection> {
    const ref = record.lastExecutionRef;
    if (ref === null) return { status: 'ready', value: null };
    const read = await readOwnerRecord<string | null>({ store: deps.records, refKey: canonicalKey(ref),
      decode: (encoded) => {
        if (ref.aggregateType === 'Run') {
          const run = decodeRun(encoded);
          return run.ok ? { status: 'decoded', value: run.value.endedAt ?? run.value.startedAt }
            : { status: 'invalid', reason: run.reason };
        }
        const query = decodeQueryRunSnapshotRecord(encoded);
        return query.status === 'decoded' ? { status: 'decoded', value: query.value.run.endedAt ?? query.value.run.startedAt }
          : query;
      }, readError });
    if (read.ok) return { status: 'ready', value: read.value };
    return 'notFound' in read ? rejected('unavailable', `the last execution of ${record.ref.sessionId} is missing`)
      : read.rejection;
  }

  /** One adviser line's slot facts (v4 :4784–:4794); a formally completed goal is not held (O4a-08). */
  async function adviserSlotOf(ctx: CoreCallContext, card: SessionCard):
    Promise<{ status: 'ready'; value: AdviserSlotFactsV1 } | CoreRejection> {
    const record = card.record;
    const session = plainSessionRef(record.ref);
    const open = card.links.filter((link) => link.until === null && link.ref.relation === 'responsible');
    const heldGoals: AdviserSlotFactsV1['heldGoals'][number][] = [];
    for (const link of open) {
      if (link.ref.target.kind !== 'goal') continue;
      const goalRef = link.ref.target.ref;
      const held = await readGoal(deps.records, goalRef);
      if (held.status !== 'ready') return held;
      const phase = await readGoalPhase(deps.records,
        { aggregateType: 'GoalPhase', projectId: goalRef.projectId, goalId: goalRef.goalId });
      if (phase.status !== 'ready') return phase;
      if (phase.snapshot !== null) continue;
      const screening = await goalScreeningOf(ctx, goalRef);
      if (screening.status !== 'ready') return screening;
      heldGoals.push({ goalRef, desiredState: held.goal.desiredState, size: screening.value?.size ?? null });
    }
    // the line's own workspace: its fence and activity are read where the line lives
    const lineCtx = { ...ctx, workspaceId: record.workspaceId };
    const fence = await readHandoffFence(deps.records, lineCtx, session);
    if (fence.status !== 'ready') return fence;
    const activity = await deps.activity.readSessionActivity(lineCtx, { session });
    if (activity.status !== 'ready') return asWriteRejection(activity, 'the line activity');
    const lastExecution = await lastExecutionAtOf(lineCtx, record);
    if (lastExecution.status !== 'ready') return lastExecution;
    return { status: 'ready', value: { session,
      available: record.health === 'available' && record.occupancy === null,
      handingOff: fence.value.held, lifecycle: record.lifecycle, retired: record.health === 'unavailable',
      heldGoals, unendedTasks: open.filter((link) => link.ref.target.kind === 'task').length,
      lastActivityAt: latestActivityAt(record.createdAt, [activity.value.lastActivityAt, lastExecution.value]) } };
  }

  /** The project's active adviser lines, paged by the last card's Session key (the line maintenance's paging), with
   *  each line's Session record as read, by Session key. A line with an archive request takes no new goal (o4a ruling
   *  57, the destination rule of `planReanchor`), so it is left out. A read failure is the allocation's refusal, never
   *  "no line" (v4 :5084–:5086). */
  async function readAdviserSlots(ctx: CoreCallContext, projectId: string): Promise<{ status: 'ready';
    value: { slots: AdviserSlotFactsV1[]; sessions: Map<string, SessionCard['record']> } } | CoreRejection> {
    const slots: AdviserSlotFactsV1[] = [];
    const sessions = new Map<string, SessionCard['record']>();
    let afterSessionKey: string | undefined;
    for (;;) {
      const found = await deps.sessions.findSessions(ctx, { workspace: { projectId }, includeArchived: false,
        page: { limit: ADVISER_PAGE_LIMIT, ...(afterSessionKey === undefined ? {} : { afterSessionKey }) } });
      if (found.status !== 'ready') return asWriteRejection(found, 'the project lines');
      for (const card of found.value.items) {
        afterSessionKey = plainSessionRefKey(card.record.ref);
        if (card.record.provenance.kind === 'readonly_copy' || card.record.lifecycle !== 'active'
          || (card.record.archiveRequest ?? null) !== null) continue;
        const duty = await deps.duty(card.record.role, ctx);
        if (duty.status !== 'ready') return asWriteRejection(duty, 'a line duty');
        if (roleLineDutyOf(duty.value) !== 'adviser') continue;
        const slot = await adviserSlotOf(ctx, card);
        if (slot.status !== 'ready') return slot;
        slots.push(slot.value);
        sessions.set(plainSessionRefKey(slot.value.session), card.record);
      }
      if (found.value.nextCursor === null || found.value.items.length === 0) break;
    }
    return { status: 'ready', value: { slots, sessions } };
  }

  /** The candidate step's facts: the queue, the goal's screening, every adviser line's slot and its Session record. */
  async function readAllocationFacts(goalCtx: CoreCallContext, goalRef: GoalRef): Promise<{ status: 'ready';
    value: { queue: GoalAdviserQueueV1; screening: GoalScreeningV1 | null; slots: AdviserSlotFactsV1[];
      sessions: ReadonlyMap<string, SessionCard['record']> } } | CoreRejection> {
    const queue = await readQueueRecord(deps.records, goalRef.projectId);
    if (queue.status !== 'ready') return queue;
    const screening = await goalScreeningOf(goalCtx, goalRef);
    if (screening.status !== 'ready') return screening;
    const slots = await readAdviserSlots(goalCtx, goalRef.projectId);
    if (slots.status !== 'ready') return slots;
    return { status: 'ready', value: { queue: queue.value, screening: screening.value, slots: slots.value.slots,
      sessions: slots.value.sessions } };
  }

  // ------------------------------------------------------------------------
  // allocate
  // ------------------------------------------------------------------------

  function assignedOf(written: WriteResult<GoalAdviserQueueV1>): WriteResult<GoalAdviserAllocationV1> {
    return written.status === 'committed' ? { ...written, value: { status: 'assigned', queue: written.value } } : written;
  }
  function queuedOf(written: WriteResult<GoalAdviserQueueV1>): WriteResult<GoalAdviserAllocationV1> {
    return written.status === 'committed' ? { ...written, value: { status: 'queued', queue: written.value } } : written;
  }

  /** A pinned card operation that no longer waits at the revision its card showed is `source_stale`. */
  async function pinStale(pin: OperationPinV1): Promise<CoreRejection | null> {
    const saved = await readRoleLineOperation(pin.operationRef);
    if (saved.status !== 'ready') return saved;
    return saved.value === null || saved.value.action.result?.status !== 'waiting'
      || saved.value.revision !== pin.expectedRevision ? rejected('source_stale', NO_LONGER_WAITS) : null;
  }

  /** The Session the candidate step chose is no longer at the revision that choice read (a missing one moved too). */
  async function adviserMoved(chosen: AllocationAttemptV1['adviser']): Promise<boolean> {
    if (chosen === undefined) return false;
    const read = ownerReadValue(await readOwnerRecord({ store: deps.records, refKey: plainSessionRefKey(chosen.session),
      decode: decodeSessionRecord, readError }));
    return read.status === 'ready' && (read.value === null || read.value.revision !== chosen.revision);
  }

  /** U1, a line-add card's reject: one commit appends the goal and ends the operation failed `{cancelled,
   *  decision_rejected}` (C11), guarded by the queue and the operation; no candidate, no line. */
  async function enqueueRejectedLineAdd(goalCtx: CoreCallContext, goalRef: GoalRef, commandId: string, pin: OperationPinV1):
    Promise<AllocationAttemptV1> {
    const saved = await readRoleLineOperation(pin.operationRef);
    if (saved.status !== 'ready') return { result: saved, queueRevision: null, kind: null };
    if (saved.value === null || saved.value.action.result?.status !== 'waiting'
      || saved.value.revision !== pin.expectedRevision) {
      return { result: rejected('source_stale', NO_LONGER_WAITS), queueRevision: null, kind: null };
    }
    const queue = await readQueueRecord(deps.records, goalRef.projectId);
    if (queue.status !== 'ready') return { result: queue, queueRevision: null, kind: null };
    const screening = await goalScreeningOf(goalCtx, goalRef);
    if (screening.status !== 'ready') return { result: screening, queueRevision: null, kind: null };
    const failed = failedRoleLineRecordOf(saved.value, saved.value.action, rejected('cancelled', 'decision_rejected'),
      deps.now());
    const committed = await commitQueue(goalCtx, { kind: 'enqueue', commandId,
      fingerprintInput: { goalRef, operation: pin.operationRef },
      fragment: enqueueFragmentOf(queue.value, goalRef, screening.value, {
        records: [encodeSessionOperationRecord(failed)],
        guards: [{ refKey: operationRefKey(saved.value.ref), expectedRevision: saved.value.revision }] }),
      revision: queue.value.revision + 1 });
    return { result: queuedOf(committed), queueRevision: queue.value.revision, kind: 'enqueue' };
  }

  /** Steps 4–7: the candidate, else a new adviser line, else the queue. */
  async function allocateToAdviser(goalCtx: CoreCallContext, input: { commandId: string; goalRef: GoalRef;
    approval?: OperationPinV1; generation?: number }): Promise<AllocationAttemptV1> {
    const facts = await readAllocationFacts(goalCtx, input.goalRef);
    if (facts.status !== 'ready') return { result: facts, queueRevision: null, kind: null };
    const queue = facts.value.queue;
    const candidate = adviserCandidateOf({ screening: facts.value.screening, slots: facts.value.slots });
    // a line the facts read is assigned on the Session record its choice read (o4a ruling 54); a line opened after
    // them is read by the write
    const assignToAdviser = async (adviser: SessionRef, approval?: OperationPinV1): Promise<AllocationAttemptV1> => {
      const read = facts.value.sessions.get(plainSessionRefKey(adviser));
      return { result: assignedOf(await write(goalCtx, { kind: 'assign', commandId: input.commandId,
        goalRef: input.goalRef, adviser, expectedRevision: queue.revision,
        ...(approval === undefined ? {} : { operationRef: approval.operationRef }) }, {
        ...(approval === undefined ? {} : { approval: { expectedRevision: approval.expectedRevision } }),
        ...(read === undefined ? {} : { adviser: read }),
        ...(input.generation === undefined ? {} : { generation: input.generation }) })),
      queueRevision: queue.revision, kind: 'assign',
      ...(read === undefined ? {} : { adviser: { session: adviser, revision: read.revision } }) };
    };
    // a queue-assign card's approve is only the candidate step; without one the card stays (卡补 §3.5)
    if (input.approval !== undefined) {
      if (candidate === null) {
        return { result: rejected('capacity', 'no adviser has room for this goal'), queueRevision: null, kind: null };
      }
      return assignToAdviser(candidate.session, input.approval);
    }
    if (candidate !== null) return assignToAdviser(candidate.session);
    // born with an empty scope: no initial goal link/claim, so the one assign below commits the Goal responsibility
    const current = await currentLineAddOf(goalCtx, input.goalRef);
    if (current.status !== 'ready') return { result: current, queueRevision: null, kind: null };
    const opened = await deps.lines.open(goalCtx, { commandId: current.value.commandId, duty: 'adviser',
      scope: [], affectedGoals: [input.goalRef] });
    if (opened.status === 'committed' && opened.value.cardKey !== undefined) {
      return { result: { status: 'committed', value: { status: 'needs_decision', cardKey: opened.value.cardKey,
        operation: opened.value.operation, queue }, replayed: opened.replayed, cursor: opened.cursor },
      queueRevision: null, kind: null };
    }
    if (opened.status === 'committed' && opened.value.session !== null) return assignToAdviser(opened.value.session);
    if (opened.status === 'committed') {                                 // accepted: the Host's next pass creates it
      return { result: { status: 'committed', value: { status: 'line_pending', operation: opened.value.operation,
        queue }, replayed: opened.replayed, cursor: opened.cursor }, queueRevision: null, kind: null };
    }
    // at the cap, or the line add a person declined (U1): the goal waits in the queue for an existing adviser
    if (opened.code !== 'capacity' && !(opened.code === 'cancelled' && opened.reason === 'decision_rejected')) {
      return { result: opened, queueRevision: null, kind: null };
    }
    if (!inQueue(queue, input.goalRef)) {
      return { result: queuedOf(await write(goalCtx, { kind: 'enqueue', commandId: input.commandId,
        goalRef: input.goalRef })), queueRevision: queue.revision, kind: 'enqueue' };
    }
    // already queued (O4a-09 ②): this command's own append answers its replay; another's writes nothing
    const replay = await replayedEnqueue(goalCtx, input.commandId);
    return { result: replay ?? opened, queueRevision: null, kind: null };
  }

  async function allocate(ctx: CoreCallContext, input: { commandId: string; goalRef: GoalRef;
    approval?: OperationPinV1; rejection?: OperationPinV1 }): Promise<WriteResult<GoalAdviserAllocationV1>> {
    // 0. the goal, by ref; every later read and commit is bound to its own workspace
    const goal = await readGoal(deps.records, input.goalRef);
    if (goal.status !== 'ready') return goal;
    const goalCtx = goalContextOf(goal.goal, ctx);
    // 1. a platform base command first finds its current generation (终稿 :1820); a card answer's `requestId` replays
    //    as itself. An alive assignment of the current generation answers `assigned` from the read that found it.
    const platformBase = input.approval === undefined && input.rejection === undefined
      && input.commandId === allocationCommandId(input.goalRef.goalId, 1);
    let effectiveCommandId = input.commandId;
    let generation: number | undefined;
    if (platformBase) {
      const current = await currentAllocationCommandOf(goalCtx, input.goalRef);
      if (current.status !== 'ready') return current;
      effectiveCommandId = current.value.commandId;
      generation = current.value.generation;
      if (current.value.assignment !== null) {
        const replay = await replayedAssignment(goalCtx, input.goalRef, effectiveCommandId,
          current.value.assignment);
        if (replay !== null) return replay;
      }
    } else {
      const assigned = await replayedAssignment(goalCtx, input.goalRef, input.commandId);
      if (assigned !== null) return assigned;
    }
    // 2. U1's reject recovers its own append first, before the adviser check: a later approval may have given the
    //    goal an adviser, and a repeated answer must still read as answered
    const rejection = input.rejection;
    if (rejection !== undefined) {
      const appended = await replayedEnqueue(goalCtx, input.commandId);
      if (appended !== null) return appended;
    } else {
      // 3. L-8 (i): a goal that already has an adviser is not allocated again
      const lines = await readOpenResponsibilityLines(deps.records, goalCtx, { goalRef: input.goalRef }, deps.duty);
      if (lines.status !== 'ready') return asWriteRejection(lines, 'the goal responsibility');
      if (lines.value.some((line) => line.duty === 'adviser')) return rejected('revision_conflict', 'goal_has_adviser');
    }
    const decideOnce = (): Promise<AllocationAttemptV1> => rejection !== undefined
      ? enqueueRejectedLineAdd(goalCtx, input.goalRef, effectiveCommandId, rejection)
      : allocateToAdviser(goalCtx, { commandId: effectiveCommandId, goalRef: input.goalRef,
        ...(input.approval === undefined ? {} : { approval: input.approval }),
        ...(generation === undefined ? {} : { generation }) });
    const first = await decideOnce();
    // 8. a lost queue commit (o4a rulings 4, 31, 48): a person's confirm must not fail because a drain moved another
    //    goal. Recover this command's receipt by its identity alone: the confirm, the Workflow triggers and a drain
    //    entry of one goal are one command, so the path that lost to the same command decided on other facts
    //    (`idempotency_conflict`) answers the winner's receipt; without one that conflict is the answer. A pinned card
    //    that moved is stale; only a moved queue, or a moved Session the candidate was chosen on (ruling 56), is
    //    decided once more from fresh facts (never the old fragment); any other conflict, or a second loss, is the
    //    answer.
    if (first.kind === null || first.result.status !== 'rejected') return first.result;
    const sameCommand = first.result.code === 'idempotency_conflict';
    if (!sameCommand && (first.result.code !== 'revision_conflict' || first.queueRevision === null)) return first.result;
    const recovered = first.kind === 'assign'
      ? await replayedAssignment(goalCtx, input.goalRef, effectiveCommandId)
      : await replayedEnqueue(goalCtx, effectiveCommandId);
    if (recovered !== null) return recovered;
    if (sameCommand) return first.result;
    const pin = input.approval ?? rejection;
    if (pin !== undefined) {
      const stale = await pinStale(pin);
      if (stale !== null) return stale;
    }
    const queue = await readQueueRecord(deps.records, input.goalRef.projectId);
    if (queue.status !== 'ready') return queue;
    if (queue.value.revision === first.queueRevision && !(await adviserMoved(first.adviser))) return first.result;
    return (await decideOnce()).result;
  }

  // ------------------------------------------------------------------------
  // drain
  // ------------------------------------------------------------------------

  /**
   * One bounded walk of the queue in order (O4a-09): a paused entry and a card entry are skipped and use no batch
   * slot; `limit` bounds only committed assignments; the walk stops at the end, or when an allocation queues or meets
   * the cap (book :551–:554). Every entry runs under the platform's principal on its goal's workspace, the identity the
   * confirm and the Workflow triggers use, so a drain entry replays their commands.
   */
  async function drain(ctx: CoreCallContext, input: { limit: number }): Promise<ReadResult<GoalDrainResultV1>> {
    const trusted = trustedContext(ctx, 'a goal adviser queue drain');
    if (!trusted.ok) return trusted.rejection;
    const projectId = trusted.scope.projectId;
    const start = await readQueueRecord(deps.records, projectId);
    if (start.status !== 'ready') return start;
    let assigned = 0;
    let blocked = 0;
    for (const entry of start.value.entries) {
      if (assigned >= input.limit) break;
      const goalRef = entry.goalRef;
      const goalRead = await readGoal(deps.records, goalRef);
      if (goalRead.status !== 'ready') { blocked += 1; continue; }
      const goal = goalRead.goal;
      const goalCtx = goalContextOf(goal, { ...ctx, principal: platformPrincipal() });
      // (a) a cancelled, formally completed or already advised goal leaves the queue (o4a ruling Q7); an advised
      //     goal's drop also closes its not-yet-started line add in that commit (o5b ruling 25)
      const phase = await readGoalPhase(deps.records,
        { aggregateType: 'GoalPhase', projectId: goalRef.projectId, goalId: goalRef.goalId });
      if (phase.status !== 'ready') { blocked += 1; continue; }
      const lines = await readOpenResponsibilityLines(deps.records, goalCtx, { goalRef }, deps.duty);
      if (lines.status !== 'ready') { blocked += 1; continue; }
      const advised = lines.value.some((line) => line.duty === 'adviser');
      if (goal.desiredState === 'cancelled' || phase.snapshot !== null || advised) {
        const queue = await readQueueRecord(deps.records, projectId);
        if (queue.status !== 'ready') { blocked += 1; continue; }
        if (!inQueue(queue.value, goalRef)) continue;
        const current = await currentAllocationCommandOf(goalCtx, goalRef);
        if (current.status !== 'ready') { blocked += 1; continue; }
        const add = advised ? await lineAddClosingOf(goalCtx, goalRef, deps.now())
          : { status: 'ready' as const, value: null };
        if (add.status !== 'ready') { blocked += 1; continue; }
        const writes = closingWritesOf(add.value === null ? [] : [add.value]);
        const dropped = await commitQueue(goalCtx, { kind: 'drop', commandId: current.value.commandId,
          fingerprintInput: { goalRef }, fragment: { records: [goalAdviserQueueCodec.encode(dropGoal(queue.value, goalRef)),
            ...writes.records], guards: [queueGuardOf(queue.value), ...writes.guards], claims: [], events: [] },
          revision: queue.value.revision + 1 });
        if (dropped.status !== 'committed') blocked += 1;
        continue;
      }
      // (b) a paused goal keeps its place and reads no candidate
      if (goal.desiredState === 'paused') continue;
      // (c) a goal whose assignment needs a person: one saved card per goal, only when an adviser has room; no seat
      //     is reserved and the walk goes on
      const verdict = decisionActionPolicy({ action: 'goal_queue_assign', actorClass: 'system',
        affectedGoals: [{ goalRef, autonomy: readGoalSettings(goal).autonomy, settingsRevision: goal.revision }] });
      if (verdict === 'needs_decision') {
        const card = await currentQueueCardOf(goalCtx, goalRef);
        if (card.status !== 'ready') { blocked += 1; continue; }
        if (card.value.operation !== null) continue;
        const operationRef: OperationRef = { aggregateType: 'CoreOperation', projectId,
          operationId: card.value.commandId };
        const facts = await readAllocationFacts(goalCtx, goalRef);
        if (facts.status !== 'ready') { blocked += 1; continue; }
        if (adviserCandidateOf({ screening: facts.value.screening, slots: facts.value.slots }) === null) continue;
        const at = deps.now();
        // the entry stayed in the queue; one goal_queue_assign operation is the card source's item
        const operation: RoleLineOperationV1 = {
          ref: operationRef, revision: 1, workspaceId: goal.workspaceRef.workspaceId, phase: 'accepted',
          requestedAt: at, updatedAt: at, observation: null, failure: null,
          action: { kind: 'role_line', action: 'goal_queue_assign', phase: 'waiting', goalRef,
            steps: [{ key: 'adviser', duty: 'adviser', childOperation: null, state: 'pending' }],
            result: { status: 'waiting', reason: null } },
        };
        const waited = await commitQueue(goalCtx, { kind: 'wait', commandId: card.value.commandId,
          fingerprintInput: { goalRef }, fragment: { records: [encodeSessionOperationRecord(operation)],
            guards: [{ refKey: operationRefKey(operationRef), expectedRevision: null }, queueGuardOf(facts.value.queue)],
            claims: [], events: [] }, revision: facts.value.queue.revision });
        if (waited.status !== 'committed') blocked += 1;
        continue;
      }
      // (d) the one allocation entry
      const allocated = await allocate(goalCtx, { commandId: `goal-queue:${goalRef.goalId}`, goalRef });
      if (allocated.status === 'committed') {
        if (allocated.value.status === 'queued') break;
        // a recovered receipt is not this pass's commit (o4a ruling 40)
        if (allocated.value.status === 'assigned' && !allocated.replayed) assigned += 1;
        continue;
      }
      if (allocated.code === 'capacity') break;
      if (allocated.code === 'revision_conflict' && allocated.reason === 'goal_has_adviser') continue;
      blocked += 1;
    }
    const after = await readQueueRecord(deps.records, projectId);
    if (after.status !== 'ready') return after;
    const queued = after.value.entries.length;
    return { status: 'ready', value: { assigned, blocked, queued, more: assigned >= input.limit && queued > 0 } };
  }

  // the two thin wrappers, built where the port object is returned
  return {
    read: (ctx) => readQueueRecord(deps.records, ctx.projectId),
    reorder: (ctx, input) => write(ctx, { kind: 'reorder', ...input }),
    assign: (ctx, input) => write(ctx, { kind: 'assign', ...input }),
    allocate, drain,
  };
}
