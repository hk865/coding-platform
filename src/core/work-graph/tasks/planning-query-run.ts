/**
 * The ONE trusted resolver for a running planning QueryRun, and the thin
 * dispatcher the note owner uses (§5.2.8(2), DR-P3-05/06).
 *
 * A planning round is an ordinary `intervention_planning` Query: it has no
 * request root and no request materials, so the secretary resolver refuses it.
 * This resolver reads only stored facts: the QueryRun named by the principal,
 * its entered execution state, the QueryJob's intent, the bound manifest (for
 * the frozen `answerShape`, the Goal and the Plan) and the Session's duty.
 * A `plan_round`/`plan_review` shape is trusted as written; a `null` shape is
 * trusted only when the frozen intent says `text` (or nothing) and the source
 * message is a Host system `action_request` (the `overlap-note:` round).
 * Anything else is `forbidden`; a read failure is `unavailable`.
 *
 * `resolveNoteQueryRun` only dispatches, three ways: it re-reads the same chain,
 * hands a `role_exploration` round (planning class, no Goal) to the exploration
 * resolver, which checks the cold start's trusted binding, a planning round to
 * the planning resolver, and `secretary`/`initial` rounds to the unchanged
 * secretary resolver. It performs no admission itself; each resolver still
 * validates its own round.
 *
 * `readProposerFacts` is the proposal owner's `query_run` proposer read over the
 * same chain: a stored, entered `role_exploration` round and its Session and role.
 *
 * The file lives in `tasks/` because `notes/` may not import `queries/` or
 * `sessions/`.
 */
import type { CoreCallContext, CorePrincipal } from '../../../contracts/core/call-context.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { OperationRef } from '../../../contracts/core/operations.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import type { QueryJobRef, QueryRunRef } from '../../../contracts/query-job.js';
import { queryAnswerShapeOf } from '../../../contracts/query-job.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { messageOf } from '../../../contracts/error-message.js';
import type { GoalRecordTransactionPort } from '../../record-store/ports.js';
import type { SessionDutyReadPort } from '../model/work-line-contracts.js';
import type { SessionMailboxPort } from '../model/communication-contracts.js';
import type { SecretaryQueryRunPort, SecretaryQueryRunV1 } from '../model/secretary-query-run-contracts.js';
import type { QueryExecutionDependencies } from '../queries/contracts.js';
import { loadQueryManifest } from '../queries/query-execution.js';
import { decodeQueryJobSnapshot, decodeQueryRunSnapshotRecord } from '../queries/query-record-codecs.js';
import type { SessionRef, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { SessionRoleFactsV1 } from '../../../contracts/role-lines.js';
import {
  decodeSessionOperationRecord, decodeSessionRecord, operationRefKey, plainSessionRefToAggregate,
  sessionAggregateRefKey,
} from '../sessions/session-record-codecs.js';
import { sessionRoleFactsCodec } from '../sessions/role-line-record-codecs.js';
import { coldStartOperationRef, type ColdStartActionV1 } from '../state/cold-start.js';
import type { ColdStartExplorationQueryRefV1, RoleLineActionV1, WorkspaceJoinActionV1 } from '../state/role-line-action.js';
import { workspaceJoinOperationRef } from '../state/workspace-join.js';
import {
  hostSystemActionRequest, roleExplorationBindingOf, type RoleExplorationBindingV1,
} from '../state/role-exploration.js';
import { sessionRoleFactsRef } from '../state/role-facts.js';
import { readOwnerRecord } from '../persistence/owner-record-read.js';
import type { ProposalQueryRunFactResolver } from '../architecture/proposal-service.js';
import { repairNoticeOf } from '../sessions/exploration-followup-service.js';

/** The frozen facts of one running planning QueryRun (spec §5.2.8(2)). */
export type PlanningQueryRunV1 = {
  principal: Extract<CorePrincipal, { kind: 'query_run' }>;
  session: SessionRef;
  /** `scribe` only on its `scribe_review` round (121-112). */
  duty: 'adviser' | 'secretary' | 'scribe';
  scope: WorkspaceScope;
  round: QueryJobRef;
  run: QueryRunRef;
  /** `manifest.goal?.ref.goalId`, never `prepared.requestEffectiveGoalId`. */
  effectiveGoalId: string | null;
  /** `manifest.focusPlan?.ref`; the Plan frozen at preparation. */
  planRef: PlanRevisionRef | null;
  sessionGeneration: number;
  /** Always `[]`: a planning round reads no `request_understanding` grants. */
  goals: readonly GoalRef[];
};

/** A `role_exploration` round: planning class on the adviser line a cold start opened, with its trusted binding. */
export type ExplorationQueryRunV1 = PlanningQueryRunV1 & {
  duty: 'adviser';
  binding: RoleExplorationBindingV1;
};

export type PlanningQueryRunDependencies = {
  records: Pick<GoalRecordTransactionPort, 'readMany'>;
  duties: SessionDutyReadPort;
  /** The raw body store the bound manifest is read from. */
  bodies: QueryExecutionDependencies['bodies'];
  /** The one source-message read used to recognise the `overlap-note:` round. */
  messages: Pick<SessionMailboxPort, 'readMessage'>;
  /** The unchanged secretary resolver the dispatcher hands non-planning rounds to. */
  secretaryQueryRun: SecretaryQueryRunPort;
};

/** The note owner's one source port: either resolver's round, tagged. */
export type NoteQueryRunSourcePort = {
  resolveNoteQueryRun(ctx: CoreCallContext): Promise<
    | { status: 'ready'; value: { kind: 'secretary'; round: SecretaryQueryRunV1 } }
    | { status: 'ready'; value: { kind: 'planning'; round: PlanningQueryRunV1 } }
    | CoreRejection>;
};

/** 121-114: the member owner's read of an adviser's planning round; the same resolver the note owner reaches. */
export type PlanningQueryRunPort = {
  resolvePlanningQueryRun(ctx: CoreCallContext): Promise<{ status: 'ready'; value: PlanningQueryRunV1 } | CoreRejection>;
};

const unavailable = (reason: string): CoreRejection => rejected('unavailable', reason);

/**
 * The shared QueryRun→QueryJob→manifest read chain: one QueryRun single-record
 * read, its QueryJob's `intent.execution`, and the manifest bound by
 * `prepared.bundleRef`/`inputDigest`. It never copies fields onto the QueryRun.
 */
async function readPlanningExecution(
  ctx: CoreCallContext, deps: Pick<PlanningQueryRunDependencies, 'records' | 'bodies'>,
  queryRunRef: QueryRunRef,
) {
  const runRead = await readOwnerRecord({ store: deps.records,
    refKey: canonicalJson(queryRunRef as unknown as JsonValue),
    decode: decodeQueryRunSnapshotRecord, readError: unavailable });
  if (!runRead.ok) {
    return 'notFound' in runRead
      ? { status: 'notFound' as const }
      : { status: 'failed' as const, rejection: runRead.rejection };
  }
  const run = runRead.value;
  const execution = run.run.executionState;
  if (execution === undefined || execution.phase !== 'entered' || execution.prepared === null) {
    return { status: 'notEntered' as const, run };
  }
  const jobRead = await readOwnerRecord({ store: deps.records,
    refKey: canonicalJson(run.run.queryJobRef as unknown as JsonValue),
    decode: decodeQueryJobSnapshot, readError: unavailable });
  if (!jobRead.ok) {
    return 'notFound' in jobRead
      ? { status: 'failed' as const, rejection: unavailable('the round QueryJob is not stored') }
      : { status: 'failed' as const, rejection: jobRead.rejection };
  }
  const job = jobRead.value;
  const bound = await loadQueryManifest(deps.bodies, { queryRunRef,
    bundleRef: execution.prepared.bundleRef, inputDigest: execution.prepared.inputDigest });
  if (bound.status !== 'ready') {
    return { status: 'failed' as const,
      rejection: unavailable(`the round manifest cannot be read: ${'reason' in bound ? bound.reason : bound.status}`) };
  }
  return { status: 'read' as const, run, execution, job: job.job, manifest: bound.value.manifest };
}

type PlanningExecutionRead = Extract<Awaited<ReturnType<typeof readPlanningExecution>>, { status: 'read' }>;

/** The one ready value both resolvers build from the read chain: the round's frozen facts and its duty. */
function toPlanningFacts(
  principal: Extract<CorePrincipal, { kind: 'query_run' }>, read: PlanningExecutionRead,
  duty: PlanningQueryRunV1['duty'],
): PlanningQueryRunV1 {
  const { run, execution, manifest } = read;
  return {
    principal,
    session: execution.sessionRef,
    duty,
    scope: { projectId: run.ref.projectId, workspaceId: run.ref.workspaceId },
    round: run.run.queryJobRef,
    run: principal.queryRunRef,
    effectiveGoalId: manifest.goal === null ? null : manifest.goal.ref.goalId,
    planRef: manifest.focusPlan === null ? null : manifest.focusPlan.ref,
    sessionGeneration: execution.sessionGeneration,
    goals: [],
  };
}

/** The planning resolver's own admission (spec §5.2.8(2)). */
async function resolvePlanningQueryRun(
  ctx: CoreCallContext, deps: PlanningQueryRunDependencies,
): Promise<{ status: 'ready'; value: PlanningQueryRunV1 } | CoreRejection> {
  const principal = ctx.principal;
  if (principal.kind !== 'query_run') {
    return rejected('forbidden', 'only a running QueryRun may write a planning note');
  }
  const queryRunRef = principal.queryRunRef;
  const read = await readPlanningExecution(ctx, deps, queryRunRef);
  if (read.status === 'notFound') {
    return rejected('forbidden', 'the caller QueryRun is not the stored running round');
  }
  if (read.status === 'failed') return read.rejection;
  if (read.status === 'notEntered') {
    return rejected('forbidden', read.run.run.executionState === undefined
      ? 'the QueryRun has no execution'
      : 'the QueryRun is not an entered planning round');
  }
  const { execution, job, manifest } = read;

  const intent = job.intent.execution;
  if (job.intent.execution.kind !== 'intervention_planning') {
    return rejected('forbidden', 'the QueryRun is not a planning round');
  }
  if (intent.sourceMessageRef === undefined || intent.sourceMessageRef === null) {
    return rejected('forbidden', 'the planning round names no source message');
  }
  const answerShape = manifest.answerShape;
  if (answerShape !== queryAnswerShapeOf(intent, null)) {
    return rejected('forbidden', 'the manifest answerShape does not fit the round');
  }
  const trustedShape = answerShape === 'plan_round' || answerShape === 'plan_review'
    || answerShape === 'scribe_review';
  if (!trustedShape) {
    if (answerShape !== null) return rejected('forbidden', 'the QueryRun is not a planning note round');
    // The `overlap-note:` round: `answerShape` is `text` (manifest `null`) and
    // the source message is a Host system `action_request`.
    let messageRead;
    try {
      messageRead = await deps.messages.readMessage(ctx, intent.sourceMessageRef);
    } catch {
      return unavailable('the planning source message cannot be read');
    }
    if (messageRead.status !== 'ready') {
      return unavailable(`the planning source message cannot be read: ${'reason' in messageRead ? messageRead.reason : messageRead.status}`);
    }
    if (!hostSystemActionRequest(messageRead.value)) {
      return rejected('forbidden', 'the planning round is not a Host system action request');
    }
  }

  const sessionRead = await readOwnerRecord({ store: deps.records,
    refKey: sessionAggregateRefKey(plainSessionRefToAggregate(execution.sessionRef)),
    decode: decodeSessionRecord, readError: unavailable });
  if (!sessionRead.ok) {
    return unavailable('notFound' in sessionRead ? 'the round Session is missing'
      : `the round Session cannot be read: ${sessionRead.rejection.reason}`);
  }
  let dutyRead;
  try {
    dutyRead = await deps.duties(sessionRead.value.role, ctx);
  } catch {
    return unavailable('the round Session duty cannot be read');
  }
  if (dutyRead.status !== 'ready') return unavailable('the round Session duty cannot be read');
  // Coordination: a note's source names its author's duty and scope, so the round's shape and the Session's duty
  // must agree — the scribe writes only from its own review round, an adviser or secretary from a planning round.
  const duty = dutyRead.value;
  const admitted = answerShape === 'scribe_review' ? (duty === 'scribe' ? duty : null)
    : duty === 'adviser' || duty === 'secretary' ? duty : null;
  if (admitted === null) {
    return rejected('forbidden', answerShape === 'scribe_review'
      ? 'the review round Session is not a scribe' : 'the round Session is not an adviser or secretary duty');
  }

  return { status: 'ready', value: toPlanningFacts(principal, read, admitted) };
}

/** The round Session's stored role facts (the line's origin); a line without them has no exploration binding. */
async function readSessionRoleFacts(
  deps: Pick<PlanningQueryRunDependencies, 'records'>, session: SessionRef,
): Promise<{ status: 'ready'; value: SessionRoleFactsV1 } | CoreRejection> {
  const read = await readOwnerRecord({ store: deps.records,
    refKey: canonicalJson(sessionRoleFactsRef(session) as unknown as JsonValue),
    decode: sessionRoleFactsCodec.decode, readError: unavailable });
  if (!read.ok) {
    return 'notFound' in read
      ? rejected('forbidden', 'the exploration round Session has no role facts')
      : unavailable(`the exploration round Session role facts cannot be read: ${read.rejection.reason}`);
  }
  return { status: 'ready', value: read.value };
}

/**
 * The operation that opened the exploration run. A Query in a joined workspace
 * names its own `workspace_join` operation (keyed by project and workspace);
 * the primary workspace has none, so that read falls back to the project's
 * cold start. Both payloads share the `explorations` list
 * `roleExplorationBindingOf` consumes.
 */
type ExplorationOperationOwnerV1 = {
  operationRef: OperationRef;
  action: Pick<RoleLineActionV1, 'followUp'> & { explorations: ColdStartExplorationQueryRefV1[] };
};

async function readExplorationOperation(deps: PlanningQueryRunDependencies, projectId: string, workspaceId: string,
  correlationId: string | undefined):
  Promise<{ status: 'ready'; value: ExplorationOperationOwnerV1 } | CoreRejection> {
  // M4a: the QueryJob's platform-written correlation id names the exact operation; prefer it over guessing by workspace.
  if (correlationId !== undefined) {
    const ref: OperationRef = { aggregateType: 'CoreOperation', projectId, operationId: correlationId };
    const operation = await readOwnerRecord({ store: deps.records, refKey: operationRefKey(ref),
      decode: decodeSessionOperationRecord,
      readError: (reason) => rejected('unavailable', `the exploration operation cannot be read: ${reason}`) });
    if (!operation.ok) {
      return 'notFound' in operation
        ? rejected('forbidden', 'the exploration QueryRun names no operation')
        : rejected('unavailable', 'the exploration operation cannot be read');
    }
    const action = operation.value.action;
    if (action.kind !== 'role_line' || (action.action !== 'cold_start' && action.action !== 'workspace_join'
      && action.action !== 'exploration_followup')) {
      return rejected('forbidden', 'the QueryRun is not an exploration round of a role-line operation');
    }
    return { status: 'ready', value: { operationRef: ref, action: action as RoleLineActionV1 as ExplorationOperationOwnerV1['action'] } };
  }
  // 1. The join operation of the Query's own workspace, when one exists.
  const joinRef = workspaceJoinOperationRef(projectId, workspaceId);
  const join = await readOwnerRecord({ store: deps.records,
    refKey: operationRefKey(joinRef),
    decode: decodeSessionOperationRecord,
    readError: (reason) => rejected('unavailable', `the join operation cannot be read: ${reason}`) });
  if (join.ok && join.value.action.kind === 'role_line' && join.value.action.action === 'workspace_join') {
    return { status: 'ready', value: { operationRef: joinRef,
      action: join.value.action as WorkspaceJoinActionV1 } };
  }
  if (!join.ok && !('notFound' in join)) {
    return rejected('unavailable', 'the join operation cannot be read');
  }
  // 2. The project's cold start: the only operation on the primary workspace.
  const coldStartRef = coldStartOperationRef(projectId);
  const operation = await readOwnerRecord({ store: deps.records,
    refKey: operationRefKey(coldStartRef),
    decode: decodeSessionOperationRecord,
    readError: (reason) => rejected('unavailable', `the cold-start operation cannot be read: ${reason}`) });
  if (!operation.ok) {
    return 'notFound' in operation
      ? rejected('forbidden', 'the exploration QueryRun is not owned by a cold start')
      : rejected('unavailable', 'the cold-start operation cannot be read');
  }
  const action = operation.value.action.kind === 'role_line' && operation.value.action.action === 'cold_start'
    ? operation.value.action as ColdStartActionV1 : null;
  if (action === null) return rejected('forbidden', 'the exploration QueryRun is not owned by a cold start');
  return { status: 'ready', value: { operationRef: coldStartRef, action } };
}

/**
 * The exploration resolver: the round must be a `role_exploration` Query that the exploration operation which opened
 * it (the project's cold start or a second workspace's join) wrote on this line, answering the Host system “please
 * act” message (the one binding check in `state/role-exploration.ts`). The duty is the adviser literal.
 */
async function resolveExplorationQueryRun(
  ctx: CoreCallContext, deps: PlanningQueryRunDependencies, read: PlanningExecutionRead,
): Promise<{ status: 'ready'; value: ExplorationQueryRunV1 } | CoreRejection> {
  const principal = ctx.principal;
  if (principal.kind !== 'query_run') {
    return rejected('forbidden', 'only a running QueryRun may write an exploration note');
  }
  if (read.job.intent.execution.kind !== 'role_exploration') {
    return rejected('forbidden', 'the QueryRun is not a role-exploration round');
  }
  const facts = await readSessionRoleFacts(deps, read.execution.sessionRef);
  if (facts.status !== 'ready') return facts;
  const owner = await readExplorationOperation(deps, read.run.ref.projectId, read.run.ref.workspaceId,
    read.job.intent.correlationId);
  if (owner.status !== 'ready') return owner;
  const { action } = owner.value;
  const entry = action.explorations.find(candidate => candidate.queryRunRef.runId === read.run.run.runId);
  if (entry === undefined) return rejected('forbidden', 'the QueryRun is not one this exploration operation opened');
  let messageRead;
  try {
    messageRead = await deps.messages.readMessage(ctx, entry.messageRef);
  } catch {
    return unavailable('the exploration system message cannot be read');
  }
  if (messageRead.status !== 'ready') {
    return unavailable(`the exploration system message cannot be read: ${'reason' in messageRead ? messageRead.reason : messageRead.status}`);
  }
  const binding = roleExplorationBindingOf({ operationRef: owner.value.operationRef,
    lineOperation: facts.value.originOperation, action, queryRunRef: read.run.ref, message: messageRead.value });
  if (binding.status === 'rejected') return binding;
  return { status: 'ready', value: { ...toPlanningFacts(principal, read, 'adviser'),
    duty: 'adviser', binding: binding.value } };
}

/**
 * The note owner's one entry: dispatch only. A `role_exploration` round goes to
 * the exploration resolver; a `plan_round`/`plan_review`/`scribe_review` manifest shape, or a
 * `null` shape whose source message is a Host system `action_request`, goes to
 * the planning resolver; every other round goes to the unchanged secretary
 * resolver.
 */
export async function resolveNoteQueryRun(
  ctx: CoreCallContext, deps: PlanningQueryRunDependencies,
): Promise<
  | { status: 'ready'; value: { kind: 'secretary'; round: SecretaryQueryRunV1 } }
  | { status: 'ready'; value: { kind: 'planning'; round: PlanningQueryRunV1 } }
  | CoreRejection> {
  const principal = ctx.principal;
  if (principal.kind !== 'query_run') {
    return rejected('forbidden', 'only a running QueryRun may write a note');
  }
  const read = await readPlanningExecution(ctx, deps, principal.queryRunRef);
  if (read.status === 'failed') return read.rejection;
  if (read.status === 'read') {
    const intent = read.job.intent.execution;
    if (intent.kind === 'role_exploration') {
      const resolved = await resolveExplorationQueryRun(ctx, deps, read);
      if (resolved.status !== 'ready') return resolved;
      return { status: 'ready', value: { kind: 'planning', round: resolved.value } };
    }
    if (intent.kind === 'intervention_planning') {
      const shape = read.manifest.answerShape;
      const planned = shape === 'plan_round' || shape === 'plan_review' || shape === 'scribe_review';
      if (planned) {
        const resolved = await resolvePlanningQueryRun(ctx, deps);
        if (resolved.status !== 'ready') return resolved;
        return { status: 'ready', value: { kind: 'planning', round: resolved.value } };
      }
      if (shape === null && (intent.answerShape === undefined || intent.answerShape === 'text')
        && intent.sourceMessageRef !== undefined && intent.sourceMessageRef !== null) {
        let messageRead;
        try {
          messageRead = await deps.messages.readMessage(ctx, intent.sourceMessageRef);
        } catch (error) {
          return unavailable(`the planning source message read failed: ${messageOf(error)}`);
        }
        if (messageRead.status !== 'ready') {
          return unavailable(`the planning source message cannot be read: ${'reason' in messageRead ? messageRead.reason : messageRead.status}`);
        }
        if (hostSystemActionRequest(messageRead.value)) {
          const resolved = await resolvePlanningQueryRun(ctx, deps);
          if (resolved.status !== 'ready') return resolved;
          return { status: 'ready', value: { kind: 'planning', round: resolved.value } };
        }
      }
    }
  }
  const secretary = await deps.secretaryQueryRun.resolveSecretaryQueryRun(ctx);
  if (secretary.status !== 'ready') return secretary;
  return { status: 'ready', value: { kind: 'secretary', round: secretary.value } };
}

/** The proposal owner's trusted `query_run` proposer: only a stored, entered `role_exploration` round. */
async function readProposerFacts(ctx: CoreCallContext, deps: PlanningQueryRunDependencies, queryRunRef: QueryRunRef):
  ReturnType<ProposalQueryRunFactResolver> {
  const read = await readPlanningExecution(ctx, deps, queryRunRef);
  if (read.status === 'failed') return read.rejection;
  if (read.status !== 'read') return rejected('forbidden', 'the caller QueryRun is not a stored running round');
  if (read.job.intent.execution.kind !== 'role_exploration') {
    return rejected('forbidden', 'the QueryRun is not a role-exploration round');
  }
  const correlationId = read.job.intent.correlationId;
  // 4-18 / PRODUCT §7: the round's segment, from the operation that opened it; a coarse split's proposal is the
  // initial architecture, which the structural auto-approval leaves to the person.
  const owner = await readExplorationOperation(deps, read.run.ref.projectId, read.run.ref.workspaceId, correlationId);
  if (owner.status !== 'ready') return owner;
  const segment = owner.value.action.explorations
    .find(entry => entry.queryRunRef.runId === read.run.run.runId)?.segment ?? null;
  // KC-3: the notice a knowledge_conflict repair round (or its “不对，重新提”) repairs, from the operation that opened it.
  const notice = await repairNoticeOf(deps.records, { ref: owner.value.operationRef, action: owner.value.action });
  if (notice.status !== 'ready') return notice;
  return { status: 'ready',
    value: { sessionRef: read.execution.sessionRef, role: read.execution.role, kind: 'role_exploration',
      // M6: the platform wrote this correlation id with the QueryJob; it is the operation that opened the round.
      operationRef: correlationId === undefined ? null
        : { aggregateType: 'CoreOperation', projectId: read.job.intent.projectId, operationId: correlationId },
      queryRunRef: { ...queryRunRef }, segment,
      followUp: notice.value === null ? null : { kind: 'knowledge_conflict', noticeId: notice.value } } };
}

export function createPlanningQueryRun(
  deps: PlanningQueryRunDependencies,
): NoteQueryRunSourcePort & PlanningQueryRunPort & { readProposerFacts: ProposalQueryRunFactResolver } {
  return {
    resolveNoteQueryRun: (ctx: CoreCallContext) => resolveNoteQueryRun(ctx, deps),
    resolvePlanningQueryRun: (ctx: CoreCallContext) => resolvePlanningQueryRun(ctx, deps),
    readProposerFacts: (ctx, queryRunRef) => readProposerFacts(ctx, deps, queryRunRef),
  };
}
