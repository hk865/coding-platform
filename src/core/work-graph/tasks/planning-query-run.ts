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
 * `resolveNoteQueryRun` only dispatches: it re-reads the same chain and hands
 * `secretary`/`initial` rounds to the unchanged secretary resolver. It performs
 * no admission itself; each resolver still validates its own round.
 *
 * The file lives in `tasks/` because `notes/` may not import `queries/` or
 * `sessions/`.
 */
import type { CoreCallContext, CorePrincipal } from '../../../contracts/core/call-context.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
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
import {
  decodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey,
} from '../sessions/session-record-codecs.js';
import { readOwnerRecord } from './owner-record-read.js';

/** The frozen facts of one running planning QueryRun (spec §5.2.8(2)). */
export type PlanningQueryRunV1 = {
  principal: Extract<CorePrincipal, { kind: 'query_run' }>;
  session: SessionRef;
  duty: 'adviser' | 'secretary';
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

/** Host system `action_request`: the `overlap-note:` source shape, read from the record only. */
function hostSystemActionRequest(message: { sender: { kind: string; actor?: { kind: string } }; intent?: string }): boolean {
  return message.sender.kind === 'host' && message.sender.actor?.kind === 'system'
    && message.intent === 'action_request';
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
  const { run, execution, job, manifest } = read;

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
  const trustedShape = answerShape === 'plan_round' || answerShape === 'plan_review';
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
  if (dutyRead.value !== 'adviser' && dutyRead.value !== 'secretary') {
    return rejected('forbidden', 'the round Session is not an adviser or secretary duty');
  }

  return { status: 'ready', value: {
    principal,
    session: execution.sessionRef,
    duty: dutyRead.value,
    scope: { projectId: run.ref.projectId, workspaceId: run.ref.workspaceId },
    round: run.run.queryJobRef,
    run: queryRunRef,
    effectiveGoalId: manifest.goal === null ? null : manifest.goal.ref.goalId,
    planRef: manifest.focusPlan === null ? null : manifest.focusPlan.ref,
    sessionGeneration: execution.sessionGeneration,
    goals: [],
  } };
}

/**
 * The note owner's one entry: dispatch only. A `plan_round`/`plan_review`
 * manifest shape, or a `null` shape whose source message is a Host system
 * `action_request`, goes to the planning resolver; every other round goes to
 * the unchanged secretary resolver.
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
    if (intent.kind === 'intervention_planning') {
      const shape = read.manifest.answerShape;
      const planned = shape === 'plan_round' || shape === 'plan_review';
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

export function createPlanningQueryRun(
  deps: PlanningQueryRunDependencies,
): NoteQueryRunSourcePort {
  return {
    resolveNoteQueryRun: (ctx: CoreCallContext) => resolveNoteQueryRun(ctx, deps),
  };
}
