/**
 * The request-round constructors (spec L1's routing-round construction).
 *
 * Pure record constructors: no I/O, no store, no clock. Each returns the next
 * snapshots and leaves its input untouched; the owner service checks its
 * preconditions and commits the result (rule 4: state transitions live here).
 */
import type { SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { GoalRef, VersionedRef } from '../../../contracts/ledger.js';
import { canonicalJson, sameJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type {
  PendingQueryJobSnapshot,
  QueryExecutionStateV1,
  QueryJobIntentV1,
  QueryJobRef,
  QueryJobSnapshot,
  QueryJobV1,
  QueryRunRef,
  QueryRunSnapshot,
  QuerySubmissionBindingV1,
  RequestCommandReceiptV1,
  RequestUnderstandingCommandV1,
  SecretaryRoundMaterialV1,
} from '../../../contracts/query-job.js';
import { queryJobRefFor } from '../../../contracts/query-job.js';
import {
  newPendingQueryRecords,
  type PendingQueryLifecycleRecords,
  type QueryLifecycleRecords,
} from './query-run-recovery.js';

/** The only message a routing round's terminal close has (the spec fixes the code, not the words). */
const ROUTING_CLOSE_MESSAGE = 'routing_round_created_closed';
/** The only message an absorbed round's terminal close has (the spec fixes the outcome, not the words). */
const ABSORBED_CLOSE_MESSAGE = 'absorbed_into_execution_round';

export type NewRequestRoundInput = {
  queryJobId: string;
  runId: string;
  scope: WorkspaceScope;
  intent: QueryJobIntentV1;
  kind: 'request' | 'followup' | 'reply' | 'expiry';
  /** `null` = the round is its request's root, so it points at itself. */
  requestRoot: QueryJobRef | null;
  requestGoalId: string | null;
  assignedSession: SessionRef | null;
  intakeSession: SessionRef | null;
  selectedIdea: QueryJobV1['selectedIdea'];
  relatedCardRefs: VersionedRef[];
  /** The message a reply/expiry round answers; `null` on request, follow-up, routing and understanding rounds. */
  relatedMessageRef: SessionMessageRef | null;
  receipt: RequestCommandReceiptV1;
  submission: QuerySubmissionBindingV1;
  submittedAt: string;
  /** The internal understanding command this round writes; `null` on every other round. */
  understanding: RequestUnderstandingCommandV1 | null;
};

/**
 * A request or follow-up round is a pending QueryJob + pending QueryRun pair,
 * like any Query; its request fields are set here and every other field is
 * written in its non-request form.
 */
export function newRequestRound(input: NewRequestRoundInput): PendingQueryLifecycleRecords {
  const scope = input.scope;
  const pending = newPendingQueryRecords({
    queryRunRef: { aggregateType: 'QueryRun', projectId: scope.projectId, workspaceId: scope.workspaceId,
      queryJobId: input.queryJobId, runId: input.runId },
    goalId: input.requestGoalId,
    intent: input.intent,
    submittedAt: input.submittedAt,
    submission: input.submission,
  });
  const requestRoot = input.requestRoot === null ? pending.job.ref : input.requestRoot;
  const job: PendingQueryJobSnapshot = {
    ...pending.job,
    job: {
      ...pending.job.job,
      requestRoot: { ...requestRoot },
      roundKind: input.kind,
      requestGoalId: input.requestGoalId,
      assignedSession: cloneSession(input.assignedSession),
      intakeSession: cloneSession(input.intakeSession),
      selectedIdea: cloneSelectedIdea(input.selectedIdea),
      relatedCardRefs: structuredClone(input.relatedCardRefs),
      relatedMessageRef: input.relatedMessageRef === null ? null : structuredClone(input.relatedMessageRef),
      receipt: structuredClone(input.receipt),
      understanding: input.understanding === null ? null : structuredClone(input.understanding),
    },
  };
  return { job, run: pending.run };
}

export type NewRoutingRoundInput = {
  queryJobId: string;
  scope: WorkspaceScope;
  root: QueryJobSnapshot;
  receipt: RequestCommandReceiptV1 | null;
  submission: QuerySubmissionBindingV1;
  submittedAt: string;
} & (
  | { routing: NonNullable<QueryJobV1['routing']> }
  | { routing: null; goalAttribution: GoalRef }
);

/**
 * Spec L1's routing round: created terminal (`runRef: null`, `closed`, `not_entered`), never runs a model,
 * never occupies a Session and creates no QueryRun; its intent is the root's, kept as source metadata only.
 * An attribution round stores the Goal id as `goalId` and `goalAttribution`; its `understanding` stays null.
 */
export function newRoutingRound(input: NewRoutingRoundInput): PendingQueryJobSnapshot {
  const scope = input.scope;
  const ref = queryJobRefFor(scope.projectId, scope.workspaceId, input.queryJobId);
  const root = input.root;
  const attributionGoalId = input.routing === null ? input.goalAttribution.goalId : null;
  const goalId = attributionGoalId === null ? root.job.requestGoalId : attributionGoalId;
  const job: QueryJobV1 = {
    schemaVersion: 1,
    queryJobId: ref.queryJobId,
    projectId: scope.projectId,
    workspaceId: scope.workspaceId,
    goalId,
    intent: structuredClone(root.job.intent),
    status: 'closed',
    runRef: null,
    answerRefs: [],
    closeReason: { code: 'not_entered', message: ROUTING_CLOSE_MESSAGE, detail: null },
    submittedAt: input.submittedAt,
    updatedAt: input.submittedAt,
    requestRoot: { ...root.ref },
    roundKind: 'routing',
    requestGoalId: root.job.requestGoalId,
    assignedSession: null,
    routing: input.routing === null ? null : structuredClone(input.routing),
    relatedMessageRef: null,
    absorbedInto: null,
    absorbedRounds: [],
    selectedIdea: null,
    goalAttribution: attributionGoalId,
    relatedCardRefs: [],
    enteredSession: null,
    intakeSession: null,
    receipt: input.receipt === null ? null : structuredClone(input.receipt),
    understanding: null,
  };
  return { ref, revision: 1, schemaVersion: 1, job, submission: structuredClone(input.submission), since: null };
}

/**
 * Ends a round that did not enter the Kernel (a drop, `end_unbound`): the Job
 * closes `cancelled` with its detail, the QueryRun closes `not_entered`. A
 * pending QueryRun has no execution state and this constructor invents none;
 * a claimed/prepared one moves to `settled`, so a closed run never keeps an
 * open execution phase.
 */
export function endUnstartedRound(
  records: QueryLifecycleRecords,
  input: { detail: 'dropped' | 'no_binding'; message: string; occurredAt: string },
): QueryLifecycleRecords {
  requireUnsettled(records, 'endUnstartedRound');
  const { job, run } = records;
  const closeReason: QueryJobV1['closeReason'] = { code: 'cancelled', message: input.message, detail: input.detail };
  const executionState = settledExecution(run);
  return {
    job: { ...job, revision: job.revision + 1, job: { ...job.job, status: 'closed', closeReason, updatedAt: input.occurredAt } },
    run: { ...run, revision: run.revision + 1, run: { ...run.run, status: 'closed', outcome: 'not_entered', endedAt: input.occurredAt,
      ...(executionState === null ? {} : { executionState }) } },
  };
}

export type NewAttemptTrigger = 'owner_changed' | 'owner_archived' | 'not_entered' | 'fenced';

/**
 * A new attempt on the same Job: the old Run closes `not_entered`
 * (abandoned), the Job returns to `pending` and its `runRef` moves to a new
 * pending Run whose id derives from the old run id and the trigger, so a replay
 * makes no second Run. A late observation of the old Run cannot change the Job
 * (`job.runRef` guard). A Job that already started is abandoned only while its
 * Run is `entering` (QRR-02's proven pre-entry state).
 */
export function newAttempt(
  records: QueryLifecycleRecords,
  input: { trigger: NewAttemptTrigger; occurredAt: string },
): { job: QueryJobSnapshot; oldRun: QueryRunSnapshot; newRun: QueryRunSnapshot } {
  const { job, run } = records;
  if (job.job.status !== 'pending' && job.job.status !== 'running') {
    throw new Error(`newAttempt: the QueryJob is ${job.job.status}; an attempt is abandoned only while the Job is pending or running`);
  }
  requireSameRun(job, run, 'newAttempt');
  if (run.run.status === 'answered' || run.run.status === 'closed' || run.run.outcome !== null || run.run.endedAt !== null) {
    throw new Error('newAttempt: the QueryRun is already settled');
  }
  if (job.job.status === 'running' && run.run.executionState?.phase !== 'entering') {
    throw new Error(`newAttempt: a running Job is abandoned only while its QueryRun is entering, not ${run.run.executionState?.phase ?? 'absent'}`);
  }
  const executionState = settledExecution(run);
  const oldRun: QueryRunSnapshot = {
    ...run,
    revision: run.revision + 1,
    run: { ...run.run, status: 'closed', outcome: 'not_entered', endedAt: input.occurredAt,
      ...(executionState === null ? {} : { executionState }) },
  };
  const digest = sha256Hex(canonicalJson({ runId: run.run.runId, trigger: input.trigger }));
  const newRunRef: QueryRunRef = { ...run.ref, runId: `attempt-${digest}` };
  const newRun: QueryRunSnapshot = {
    ref: newRunRef,
    revision: 1,
    schemaVersion: 1,
    run: {
      schemaVersion: 1,
      queryJobRef: queryJobRefFor(newRunRef.projectId, newRunRef.workspaceId, newRunRef.queryJobId),
      runId: newRunRef.runId,
      status: 'pending',
      startedAt: null,
      endedAt: null,
      outcome: null,
    },
  };
  return {
    job: { ...job, revision: job.revision + 1, job: { ...job.job, status: 'pending', runRef: { ...newRunRef }, updatedAt: input.occurredAt } },
    oldRun,
    newRun,
  };
}

/**
 * Absorbs a batch round into the executing round: the pair closes
 * `not_entered`, the Job points at its execution round (`absorbedInto`).
 */
export function absorbRound(
  records: QueryLifecycleRecords,
  input: { into: QueryJobRef; occurredAt: string },
): QueryLifecycleRecords {
  requireUnsettled(records, 'absorbRound');
  const { job, run } = records;
  if (sameJson(input.into, job.ref)) {
    throw new Error('absorbRound: a round cannot be absorbed into itself');
  }
  const closeReason: QueryJobV1['closeReason'] = { code: 'not_entered', message: ABSORBED_CLOSE_MESSAGE, detail: null };
  const executionState = settledExecution(run);
  return {
    job: { ...job, revision: job.revision + 1, job: { ...job.job, status: 'closed', absorbedInto: { ...input.into }, closeReason,
      updatedAt: input.occurredAt } },
    run: { ...run, revision: run.revision + 1, run: { ...run.run, status: 'closed', outcome: 'not_entered', endedAt: input.occurredAt,
      ...(executionState === null ? {} : { executionState }) } },
  };
}

/**
 * Lists the batch rounds an executing Job absorbed, once each, in
 * insertion order; no other field changes.
 */
export function recordAbsorbedRounds(job: QueryJobSnapshot, rounds: QueryJobRef[]): QueryJobSnapshot {
  const absorbed = [...job.job.absorbedRounds];
  for (const round of rounds) {
    if (!absorbed.some((existing) => sameJson(existing, round))) absorbed.push({ ...round });
  }
  return { ...job, revision: job.revision + 1, job: { ...job.job, absorbedRounds: absorbed } };
}

/**
 * Sets or clears the `secretary-intake:<S>` holder on a pending round; only
 * `intakeSession` changes.
 */
export function setIntake(job: QueryJobSnapshot, session: SessionRef | null): QueryJobSnapshot {
  if (sameJson(job.job.intakeSession, session)) return { ...job, job: { ...job.job } };
  return { ...job, revision: job.revision + 1, job: { ...job.job, intakeSession: cloneSession(session) } };
}

/**
 * Writes the `enteredSession` of a request round once. A second
 * call with another Session throws: the proven entry is never rewritten.
 */
export function recordEntered(job: QueryJobSnapshot, session: SessionRef): QueryJobSnapshot {
  const current = job.job.enteredSession;
  if (current !== null) {
    if (!sameJson(current, session)) {
      throw new Error('recordEntered: enteredSession was already written with another Session');
    }
    return { ...job, job: { ...job.job } };
  }
  return { ...job, revision: job.revision + 1, job: { ...job.job, enteredSession: cloneSession(session) } };
}

/**
 * One state move of the stored understanding command: `live -> closed`,
 * `live -> consumed` or `closed -> consumed`. The immutable input never changes;
 * only `state` and `updatedAt` move, at `revision + 1`. An already `consumed`
 * command, a `closed -> closed`/backwards move, or a Job that does not carry
 * this `commandId` is a programming error and throws.
 */
export function transitionUnderstandingCommand(
  job: QueryJobSnapshot,
  input: { commandId: string; to: 'closed' | 'consumed'; occurredAt: string },
): QueryJobSnapshot {
  const command = job.job.understanding;
  if (command === null || command.commandId !== input.commandId) {
    throw new Error('transitionUnderstandingCommand: the QueryJob carries no understanding command with this commandId');
  }
  const legal = (command.state === 'live' && (input.to === 'closed' || input.to === 'consumed'))
    || (command.state === 'closed' && input.to === 'consumed');
  if (!legal) {
    throw new Error(`transitionUnderstandingCommand: ${command.state} -> ${input.to} is not a legal understanding command move`);
  }
  return {
    ...job,
    revision: job.revision + 1,
    job: {
      ...job.job,
      understanding: { ...structuredClone(command), state: input.to },
      updatedAt: input.occurredAt,
    },
  };
}

/**
 * Folds a completed understanding transition into another Job snapshot: the end
 * commit's own next snapshot keeps its revision and update time, and takes only
 * the command state the transition produced. The transition result is the only
 * writer of the command; passing a snapshot without one is a programming error.
 */
export function foldUnderstandingCommand(job: QueryJobSnapshot, transitioned: QueryJobSnapshot): QueryJobSnapshot {
  const command = transitioned.job.understanding;
  if (command === null) {
    throw new Error('foldUnderstandingCommand: the transitioned QueryJob carries no understanding command');
  }
  return { ...job, job: { ...job.job, understanding: command } };
}

/** The claimed/prepared/settled execution state moves to `settled`; a pending Run has none. */
function settledExecution(run: QueryRunSnapshot): QueryExecutionStateV1 | null {
  const state = run.run.executionState;
  return state === undefined ? null : { ...structuredClone(state), phase: 'settled' as const };
}

function cloneSession(session: SessionRef | null): SessionRef | null {
  return session === null ? null : structuredClone(session);
}

function cloneSelectedIdea(idea: QueryJobV1['selectedIdea']): QueryJobV1['selectedIdea'] {
  return idea === null ? null : structuredClone(idea);
}

function requireSameRun(job: QueryJobSnapshot, run: QueryRunSnapshot, constructor: string): void {
  if (!sameJson(job.job.runRef, run.ref)) {
    throw new Error(`${constructor}: the QueryJob runRef is not this QueryRun`);
  }
}

function requireUnsettled(records: QueryLifecycleRecords, constructor: string): void {
  const { job, run } = records;
  if (job.job.status !== 'pending' && job.job.status !== 'running') {
    throw new Error(`${constructor}: the QueryJob is already ${job.job.status}`);
  }
  if (run.run.status === 'answered' || run.run.status === 'closed' || run.run.outcome !== null || run.run.endedAt !== null) {
    throw new Error(`${constructor}: the QueryRun is already settled`);
  }
  requireSameRun(job, run, constructor);
}

/** One distinct `command.operation`'s current facts, read once over the whole frozen material list. */
export type UnderstandingOperationFactsV1 = {
  operation: OperationRef;
  /** `currentUnderstandingGeneration(operation)`; `null` when the operation has no record. */
  generation: number | null;
  /** The handoff operation's source (`action.input.source`). */
  source: SessionRef;
  /** True only when the request root's current owner (`facts.owner`) is `source`. */
  ownsRoot: boolean;
};

/** The still-valid grants of `[round, ...batch]`: each command is judged against its own operation; one entry per goal. */
export function liveUnderstandingGrants(input: {
  materials: readonly SecretaryRoundMaterialV1[];
  requestRoot: QueryJobRef;
  operations: readonly UnderstandingOperationFactsV1[];
}): readonly GoalRef[] {
  const factsByOperation = new Map<string, UnderstandingOperationFactsV1>();
  for (const facts of input.operations) {
    factsByOperation.set(canonicalJson(facts.operation as unknown as JsonValue), facts);
  }
  const grants: GoalRef[] = [];
  const seen = new Set<string>();
  for (const material of input.materials) {
    const command = material.command;
    if (command === null || command.kind !== 'request_understanding') continue;
    if (command.state !== 'live') continue;
    const facts = factsByOperation.get(canonicalJson(command.operation as unknown as JsonValue));
    if (facts === undefined || facts.generation === null || !facts.ownsRoot) continue;
    if (command.generation !== facts.generation) continue;
    if (!sameJson(command.requestRoot, input.requestRoot)) continue;
    for (const goal of command.goals) {
      const key = canonicalJson(goal.goalRef as unknown as JsonValue);
      if (seen.has(key)) continue;
      seen.add(key);
      grants.push({ ...goal.goalRef });
    }
  }
  return grants;
}

/** The operation's current understanding generation: the greatest record, or null when it has none. */
export function currentUnderstandingGeneration(
  operation: { action: { kind: 'handoff'; progress: { understanding: readonly { generation: number }[] } } | { kind: 'create' | 'secretary_archive' } },
): number | null {
  if (operation.action.kind !== 'handoff') return null;
  let current: number | null = null;
  for (const record of operation.action.progress.understanding) {
    if (current === null || record.generation > current) current = record.generation;
  }
  return current;
}
