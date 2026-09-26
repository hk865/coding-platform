/**
 * R3c Plan task service — the WorkGraph owner of Goal plan adoption and task reads.
 *
 * This file only coordinates: it binds the caller, delegates canonical reads and
 * task facts to `plan-readers.ts`, pure admission to `plan-validation.ts` and the
 * one atomic fold to `plan-commit-compiler.ts`. It starts no transaction of its
 * own and never re-implements those rules.
 *
 * This slice implements the INITIAL plan path (candidate v2 -> accepted
 * PlanRevision) plus the six `PlanTaskPort` reads. A v2 candidate carries a full
 * draft, not the legacy restricted delta/target digest, so a CHANGE candidate
 * (`basedOn !== null`) is never authorized by a non-empty `decisionRefs`: apply
 * rejects it with `incomplete` (no accepted decision) or `unsupported`
 * (authorized delta compilation is not implemented yet). R3c is not closed here.
 *
 * W1 Stage 1 additionally RECOGNIZES the v2 future-plan revision
 * (`basedOn !== null`, schemaVersion 2) and routes it to ONE explicit
 * `unsupported` branch; it adopts no candidate and writes nothing. The initial
 * fold, the reads, replay and claim behavior are unchanged.
 */
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import { commandIdentityKey } from '../../../contracts/command-event.js';
import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../../contracts/core/identity.js';
import type { CoreError, ReadResult, ReadStamp, WriteResult } from '../../../contracts/core/results.js';
import type { PreparedQueryManifestV1 } from '../../../contracts/core/prepared-execution.js';
import type { RunRef } from '../../../contracts/dispatch.js';
import { canonicalJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import type { GoalRef } from '../../../contracts/ledger.js';
import { makeCommitCursor, seqOfCommitCursor } from '../../../contracts/ledger.js';
import type { CompletionPolicyContentV1 } from '../../../contracts/governance.js';
import type { Phase, PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot,
  PlanValidationError, RuntimeTask, TaskInputRequirementV2, TaskRelationV2 } from '../../../contracts/plan.js';
import type { GoalPhaseRef } from '../../../contracts/goal-phase.js';
import type {
  QueryJobAnswerRef,
  QueryJobRef,
  QueryJobSnapshot,
  QueryRunRef,
  QueryRunSnapshot,
} from '../../../contracts/query-job.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { RawArtifactStorePort } from '../../record-store/body-ports.js';
import type { MaterialPort } from '../materials/contracts.js';
import type {
  GoalRecordTransactionPort,
  RecordGuard,
  StoreCommitReceipt,
  StoreFailure,
} from '../../record-store/ports.js';
import { cloneActorRef } from '../persistence/record-codecs.js';
import { goalRefFor, projectRefFor, workspaceRefFor } from '../persistence/commit-compiler.js';
import { evaluateEligibility } from './eligibility.js';
import type {
  GoalCompletionView,
  GoalDetail,
  GoalPlanningDiagnostic,
  GoalPlanningView,
  PlanChangeReason,
  PlanPageRequest,
  InitialPlanProposalResult,
  PlanProposal,
  PlanProposalRef,
  PlanServicePort,
  PlanTaskPort,
  ReadyTask,
  TaskGraph,
  TaskPage,
  TaskPlanningDiagnostic,
  TaskRow,
} from './plan-contracts.js';
import { compileFuturePlanAdoption, compileInitialPlanAdoption } from './plan-commit-compiler.js';
import {
  decodeQueryJobAnswerSnapshot,
  decodeQueryJobSnapshot,
  decodeQueryRunSnapshotRecord,
} from '../queries/query-record-codecs.js';
import { QUERY_MANIFEST_CONTENT_TYPE } from '../queries/query-execution.js';
import {
  normalizeInitialPlanningResponseV2,
  parseInitialPlanningResponseV2,
  type InitialPlanAnswerFacts,
} from './initial-plan.js';
import {
  decodePlanProposalRecordedEvent,
  decodePlanRevisionAcceptedEvent,
  encodePlanProposal,
  encodePlanProposalRecordedEvent,
  planProposalRefKey,
  planRevisionRefKey,
  type PlanProposalRecordedEvent,
} from './plan-record-codecs.js';
import {
  confirmActivePlan,
  findPendingProposal,
  readCanonicalTaskFacts,
  readGoal,
  readGoalPlanWindow,
  readGoalPhase,
  readFutureChangeTaskFacts,
  readGoalScope,
  laterCursor,
  readPinnedCompletionPolicy,
  readPlan,
  readProposal,
  resolveGovernance,
  sameCursor,
  tryPolicyContent,
  type CanonicalTaskFacts,
} from './plan-readers.js';
import {
  deriveFuturePlanDelta,
  planPhaseGuardReasons,
  validateFutureObligationCoverage,
  validatePlanAssignments,
  validatePlanDraft,
} from './plan-validation.js';
import {
  authorizePlanWrite,
  identifyPlanWriter,
  type AgentPlanWriter,
  type PlanDelegatedWriteDependencies,
  type PlanWriteOperation,
} from './plan-write-admission.js';
import { mergeGuards, sameRef } from './execution-entry-service.js';

export type PlanServiceDependencies = { records: GoalRecordTransactionPort & RecordLookupPort;
  materials?: Pick<MaterialPort, 'openArtifact'>;
  /** R5b.4 §11.4: the SAME raw body store the composition root already holds.
   * It only reads the QueryRun's own prepared manifest body. Absence makes only
   * the new model-origin consumption explicitly unavailable; every old Plan
   * path keeps its exact I/O. */
  initialPlanning?: { bodies: Pick<RawArtifactStorePort, 'read'> };
  /** W2: optional delegated Agent admission. Absent keeps the original Host-only behavior. */
  delegatedWrites?: PlanDelegatedWriteDependencies;
  now(): string; eventId(): string };

const PLAN_PROPOSE_IDENTITY_PREFIX = 'plan-propose:';
const PLAN_APPLY_IDENTITY_PREFIX = 'plan-apply:';
const PLAN_PROPOSAL_ID_PREFIX = 'plan-proposal-';
const MAX_READY_PAGE = 200;

// --------------------------------------------------------------------------
// Input isolation and small value helpers
// --------------------------------------------------------------------------

type Owned<T> = { status: 'owned'; value: T } | { status: 'invalid'; reason: string };
type Rejection = { status: 'rejected'; code: CoreError; reason: string };

function ownJsonInput<T>(value: T, what: string): Owned<T> {
  try {
    const cloned = structuredClone(value);
    return { status: 'owned', value: JSON.parse(JSON.stringify(cloned)) as T };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: 'invalid', reason: `${what} cannot be isolated from the caller: ${detail}` };
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/**
 * Bind the caller's scope, identity and the ORIGINAL AbortSignal synchronously,
 * before the first await. `principal`/`materialReader` are copied so a later
 * caller mutation cannot relay a different identity into authorization or the
 * material layer; the signal is kept by reference (never JSON-cloned) so
 * cancellation is never lost.
 */
function ownCallContext(ctx: CoreCallContext): Owned<CoreCallContext> {
  const raw = ctx as unknown as {
    projectId?: unknown; workspaceId?: unknown; principal?: unknown;
    materialReader?: unknown; signal?: unknown;
  } | null | undefined;
  if (raw === null || raw === undefined) return { status: 'invalid', reason: 'a bound call context is required' };
  const projectId = raw.projectId;
  if (!nonEmpty(projectId)) return { status: 'invalid', reason: 'a project-bound call context is required' };
  const signal = raw.signal;
  if (typeof signal !== 'object' || signal === null
    || typeof (signal as { aborted?: unknown }).aborted !== 'boolean') {
    return { status: 'invalid', reason: 'the call context does not carry the caller AbortSignal' };
  }
  let principal: unknown;
  let materialReader: unknown;
  try {
    principal = structuredClone(raw.principal);
    materialReader = structuredClone(raw.materialReader);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: 'invalid', reason: `the call context identity cannot be isolated: ${detail}` };
  }
  const workspaceId = raw.workspaceId;
  return { status: 'owned', value: {
    projectId,
    ...(nonEmpty(workspaceId) ? { workspaceId } : {}),
    principal,
    materialReader,
    signal,
  } as unknown as CoreCallContext };
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function rejected(code: CoreError, reason: string): Rejection {
  return { status: 'rejected', code, reason };
}
function forbidden(reason: string): Rejection {
  return rejected('forbidden', reason);
}
/** Map pure plan-admission issues to the write rejection. An explicit
 * `unsupported_execution_change` (the Stage 1 executionIntent seam) must be
 * reported as `unsupported`, not silently downgraded to `incomplete`/`invalid`. */
function planAdmissionRejection(scopeLabel: string, issues: readonly PlanValidationError[]): Rejection {
  const rendered = `${scopeLabel}: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`;
  if (issues.some((issue) => issue.code === 'unsupported_execution_change')) {
    return rejected('unsupported', rendered);
  }
  const structural = issues.some((issue) => issue.code === 'dag_cycle' || issue.code === 'self_dependency'
    || issue.code === 'hierarchy_cycle' || issue.code === 'dangling_task_ref' || issue.code === 'dangling_stage_ref');
  return rejected(structural ? 'invalid' : 'incomplete', rendered);
}
/** ReadResult has a bare `not_found` variant; the reader's uniform `Rejected`
 * shape carries a reason. Translate at the read boundary so a missing record is
 * never reported as a rejected-with-reason read. */
function asReadResult<T>(rejection: Rejection): ReadResult<T> {
  if (rejection.code === 'not_found') return { status: 'not_found' };
  return rejection;
}
function actorsAgree(a: ActorRef, b: ActorRef): boolean {
  if (a.kind !== b.kind || a.id !== b.id) return false;
  if (a.kind === 'agent' && b.kind === 'agent') {
    return a.runRef.projectId === b.runRef.projectId && a.runRef.goalId === b.runRef.goalId
      && a.runRef.runId === b.runRef.runId;
  }
  return true;
}
function refKeyOf(ref: unknown): string {
  return canonicalJson(ref as JsonValue);
}
function goalRefFromUnknown(value: unknown, projectId: string): GoalRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'Goal' || value['projectId'] !== projectId || !nonEmpty(value['goalId'])) return null;
  return { aggregateType: 'Goal', projectId, goalId: value['goalId'] };
}
function planRevisionRefFromUnknown(value: unknown, projectId: string): PlanRevisionRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'PlanRevision' || value['projectId'] !== projectId || !nonEmpty(value['planId'])) return null;
  return { aggregateType: 'PlanRevision', projectId, planId: value['planId'] };
}
function planProposalRefFromUnknown(value: unknown): PlanProposalRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'PlanProposal' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['workspaceId']) || !nonEmpty(value['proposalId'])) return null;
  return { aggregateType: 'PlanProposal', projectId: value['projectId'],
    workspaceId: value['workspaceId'], proposalId: value['proposalId'] };
}

// --------------------------------------------------------------------------
// Identity, fingerprint and command-shape derivation
// --------------------------------------------------------------------------

function deriveCommandIds(identity: { projectId: string; actor: ActorRef; idempotencyKey: string },
  kind: string): { commandId: string; correlationId: string } {
  const digest = canonicalJson(identity as unknown as JsonValue);
  return { commandId: `${kind}-command:${digest}`, correlationId: `${kind}-request:${digest}` };
}
function planProposalIdFor(input: { projectId: string; workspaceId: string; goalId: string; requestId: string }): string {
  return PLAN_PROPOSAL_ID_PREFIX + sha256Hex(canonicalJson(input as unknown as JsonValue)).slice(0, 32);
}
/**
 * R5b.4 §11.2 initial-entry proposal identity. It is derived from the trusted
 * Host/workspace scope + the original meta.requestId only, so the SAME response
 * identity exists BEFORE the answer is read; the request fingerprint below binds
 * the complete original input/meta/actor. Reusing the answer-derived propose id
 * would force a body read before the original receipt could be restored.
 */
function initialPlanProposalIdFor(input: { projectId: string; workspaceId: string; requestId: string }): string {
  return PLAN_PROPOSAL_ID_PREFIX + sha256Hex(canonicalJson({
    schemaVersion: 1, entry: 'initial-plan-from-answer', ...input,
  } as unknown as JsonValue)).slice(0, 32);
}
function proposeFingerprint(input: {
  projectId: string; workspaceId: string; goalRef: GoalRef;
  basedOn: PlanRevisionRef | null; draft: PlanRevisionDraft; reason: unknown;
}): string {
  return sha256Hex(canonicalJson({ schemaVersion: 2, commandType: 'PlanPropose', ...input } as unknown as JsonValue));
}
/**
 * R5b.4 §11.2 the initial-entry request fingerprint. It binds the COMPLETE
 * original input (answerRef + reason), the complete meta (requestId + expected
 * pins) and the trusted actor/scope, so an already-committed request is restored
 * from its original event without reading or re-parsing the answer body and
 * without refreshing pins on a repeat.
 */
function initialProposeFingerprint(input: {
  projectId: string; workspaceId: string; actor: ActorRef;
  answerRef: unknown; reason: unknown; requestId: string; expected: unknown;
}): string {
  return sha256Hex(canonicalJson({
    schemaVersion: 1, commandType: 'PlanProposeInitial', ...input,
  } as unknown as JsonValue));
}
function applyFingerprint(input: {
  projectId: string; workspaceId: string; proposalRef: PlanProposalRef;
  expectedProposalRevision: number; decisionRefs: unknown;
}): string {
  return sha256Hex(canonicalJson({ schemaVersion: 1, commandType: 'PlanApply', ...input } as unknown as JsonValue));
}

// --------------------------------------------------------------------------
// Trusted caller pins
// --------------------------------------------------------------------------

type PlanPins = { project?: number; workspace?: number; goal?: number | null };

function normalizeCallerPlanPins(
  scope: { projectId: string; workspaceId: string; goalId?: string },
  pins: unknown,
): { status: 'ok'; pins: PlanPins } | { status: 'invalid'; reason: string } {
  if (pins === undefined) return { status: 'ok', pins: {} };
  if (!Array.isArray(pins)) return { status: 'invalid', reason: 'meta.expected must be an array of version pins' };
  const normalized: PlanPins = {};
  const seen = new Set<string>();
  for (const entry of pins as unknown[]) {
    if (!isRecord(entry)) return { status: 'invalid', reason: 'version pin must be an object' };
    const revision = entry['revision'];
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
      return { status: 'invalid', reason: 'version pin revision must be a safe non-negative integer' };
    }
    const ref = entry['ref'];
    if (!isRecord(ref)) return { status: 'invalid', reason: 'version pin ref must be an object' };
    if (!nonEmpty(ref['projectId']) || ref['projectId'] !== scope.projectId) {
      return { status: 'invalid', reason: 'version pin ref must belong to this project' };
    }
    const key = refKeyOf(ref);
    if (seen.has(key)) return { status: 'invalid', reason: 'duplicate version pin' };
    seen.add(key);
    const aggregateType = ref['aggregateType'];
    if (aggregateType === 'Project') normalized.project = revision;
    else if (aggregateType === 'Workspace') {
      if (ref['workspaceId'] !== scope.workspaceId) return { status: 'invalid', reason: 'Workspace version pin belongs to another workspace' };
      normalized.workspace = revision;
    } else if (aggregateType === 'Goal') {
      if (scope.goalId !== undefined && ref['goalId'] !== scope.goalId) {
        return { status: 'invalid', reason: 'Goal version pin belongs to another goal' };
      }
      normalized.goal = revision === 0 ? null : revision;
    } else if (aggregateType === 'PlanRevision') {
      if (!nonEmpty(ref['planId'])) return { status: 'invalid', reason: 'PlanRevision version pin has no planId' };
    } else if (aggregateType === 'PlanProposal') {
      if (ref['workspaceId'] !== scope.workspaceId || !nonEmpty(ref['proposalId'])) {
        return { status: 'invalid', reason: 'PlanProposal version pin does not match this workspace' };
      }
    } else {
      return { status: 'invalid', reason: 'version pin ref is not a Plan/Goal scope ref' };
    }
  }
  return { status: 'ok', pins: normalized };
}

function compareCallerPlanPins(
  scope: { projectId: string; workspaceId: string; goalId: string },
  pins: PlanPins,
  observed: { projectRevision: number; workspaceRevision: number; goalRevision: number },
): { status: 'ok' } | { status: 'conflict'; current: VersionPin[] } {
  const current: VersionPin[] = [];
  if (pins.project !== undefined && pins.project !== observed.projectRevision) {
    current.push({ ref: projectRefFor(scope.projectId), revision: observed.projectRevision });
  }
  if (pins.workspace !== undefined && pins.workspace !== observed.workspaceRevision) {
    current.push({ ref: workspaceRefFor(scope.projectId, scope.workspaceId), revision: observed.workspaceRevision });
  }
  if (pins.goal !== undefined && (pins.goal === null ? null : pins.goal) !== observed.goalRevision) {
    current.push({ ref: goalRefFor(scope.projectId, scope.goalId), revision: observed.goalRevision });
  }
  return current.length === 0 ? { status: 'ok' } : { status: 'conflict', current };
}

// --------------------------------------------------------------------------
// Read authority (host project scope, work-run goal scope, query-run workspace)
// --------------------------------------------------------------------------

type ReadPrincipal =
  | { kind: 'host'; actor: ActorRef; key: string; workspaceId: string | null }
  | { kind: 'work_run'; runRef: RunRef; key: string }
  | { kind: 'query_run'; queryRunRef: QueryRunRef; key: string };

function authorizeReadContext(ctx: CoreCallContext, projectId: string):
  { status: 'ok'; principal: ReadPrincipal } | Rejection {
  const bound = ctx as unknown as { projectId?: unknown; workspaceId?: unknown; principal?: unknown } | null | undefined;
  if (bound === null || bound === undefined) return forbidden('a bound call context is required');
  if (bound.projectId !== projectId) return forbidden('the call context is outside the requested project');
  const principal = bound.principal;
  if (!isRecord(principal)) return forbidden('the call context has no principal');
  if (principal['kind'] === 'host') {
    const actor = principal['actor'];
    if (!isRecord(actor) || (actor['kind'] !== 'human' && actor['kind'] !== 'system') || !nonEmpty(actor['id'])) {
      return forbidden('the host principal does not carry a human/system actor');
    }
    const actorRef = { kind: actor['kind'], id: actor['id'] } as ActorRef;
    return { status: 'ok', principal: { kind: 'host', actor: actorRef, key: `host:${actorRef.kind}:${actorRef.id}`,
      workspaceId: nonEmpty(bound.workspaceId) ? bound.workspaceId : null } };
  }
  if (principal['kind'] === 'work_run') {
    const runRef = principal['runRef'];
    if (!isRecord(runRef) || runRef['aggregateType'] !== 'Run' || runRef['projectId'] !== projectId
      || !nonEmpty(runRef['goalId']) || !nonEmpty(runRef['runId'])) {
      return forbidden('the work-run principal is not a complete Run scoped to this project');
    }
    const ref: RunRef = { aggregateType: 'Run', projectId, goalId: runRef['goalId'], runId: runRef['runId'] };
    return { status: 'ok', principal: { kind: 'work_run', runRef: ref,
      key: `work_run:${ref.projectId}:${ref.goalId}:${ref.runId}` } };
  }
  if (principal['kind'] === 'query_run') {
    const queryRunRef = principal['queryRunRef'];
    if (!isRecord(queryRunRef) || queryRunRef['aggregateType'] !== 'QueryRun' || queryRunRef['projectId'] !== projectId
      || !nonEmpty(queryRunRef['workspaceId']) || !nonEmpty(queryRunRef['queryJobId']) || !nonEmpty(queryRunRef['runId'])) {
      return forbidden('the query-run principal is not a complete QueryRun scoped to this project');
    }
    const ref: QueryRunRef = { aggregateType: 'QueryRun', projectId, workspaceId: queryRunRef['workspaceId'],
      queryJobId: queryRunRef['queryJobId'], runId: queryRunRef['runId'] };
    return { status: 'ok', principal: { kind: 'query_run', queryRunRef: ref,
      key: `query_run:${ref.projectId}:${ref.workspaceId}:${ref.queryJobId}:${ref.runId}` } };
  }
  return forbidden('unknown principal kind');
}

function authorizeGoal(principal: ReadPrincipal, goal: { ref: GoalRef; workspaceRef: { workspaceId: string } }): Rejection | null {
  if (principal.kind === 'work_run') {
    if (principal.runRef.goalId !== goal.ref.goalId) return forbidden('the work run is not scoped to this goal');
  } else if (principal.kind === 'query_run') {
    if (principal.queryRunRef.workspaceId !== goal.workspaceRef.workspaceId) return forbidden('the query run is not scoped to this workspace');
  } else if (principal.workspaceId !== null && principal.workspaceId !== goal.workspaceRef.workspaceId) {
    return forbidden('the host context is scoped to another workspace');
  }
  return null;
}
function authorizeProposal(principal: ReadPrincipal, proposal: Extract<PlanProposal, { kind: 'candidate_v2' }>): Rejection | null {
  if (principal.kind === 'work_run') {
    if (principal.runRef.goalId !== proposal.goalRef.goalId) return forbidden('the work run is not scoped to this proposal goal');
  } else if (principal.kind === 'query_run') {
    if (principal.queryRunRef.workspaceId !== proposal.ref.workspaceId) return forbidden('the query run is not scoped to this proposal workspace');
  } else if (principal.workspaceId !== null && principal.workspaceId !== proposal.ref.workspaceId) {
    return forbidden('the host context is scoped to another workspace');
  }
  return null;
}

// --------------------------------------------------------------------------
// Replay restoration (never from the current Goal)
// --------------------------------------------------------------------------

type CommittedReceipt = Extract<StoreCommitReceipt, { status: 'committed' }>;

async function restoreProposal(
  records: GoalRecordTransactionPort,
  receipt: CommittedReceipt,
  expected: { identityKey: string; projectId: string; workspaceId: string; proposalId: string;
    idempotencyKey: string; actor: ActorRef },
): Promise<{ status: 'restored'; proposal: PlanProposal } | Rejection> {
  if (receipt.identityKey !== expected.identityKey) return rejected('unavailable', 'idempotency receipt belongs to another identity');
  if (receipt.eventIds.length !== 1) return rejected('unavailable', 'a proposal receipt must reference exactly one event');
  const located = await records.eventAt(receipt.cursor);
  if (located.status !== 'ready') return mapStoreReadFailure(located, 'the original proposal event is unavailable');
  if (String(located.value.cursor) !== String(receipt.cursor)) return rejected('unavailable', 'eventAt returned a different cursor');
  const decoded = decodePlanProposalRecordedEvent(located.value.event);
  if (decoded.status !== 'decoded') return rejected('unavailable', `the original proposal event is corrupt: ${decoded.reason}`);
  const event = decoded.value;
  if (event.eventId !== receipt.eventIds[0]) return rejected('unavailable', 'the receipt points at another event');
  if (event.projectId !== expected.projectId || event.workspaceId !== expected.workspaceId
    || event.aggregateId !== expected.proposalId) return rejected('unavailable', 'the original proposal event is outside the recovered scope');
  if (event.idempotencyKey !== expected.idempotencyKey || !actorsAgree(event.actor, expected.actor)) {
    return rejected('unavailable', 'the original proposal event carries another identity');
  }
  return { status: 'restored', proposal: event.payload.proposal };
}

async function restoreAcceptedPlan(
  records: GoalRecordTransactionPort,
  receipt: CommittedReceipt,
  expected: { identityKey: string; projectId: string; workspaceId: string;
    idempotencyKey: string; actor: ActorRef },
): Promise<{ status: 'restored'; value: import('../../../contracts/plan.js').PlanRevisionSnapshot } | Rejection> {
  if (receipt.identityKey !== expected.identityKey) return rejected('unavailable', 'idempotency receipt belongs to another identity');
  if (receipt.eventIds.length !== 1) return rejected('unavailable', 'a plan-accept receipt must reference exactly one event');
  const located = await records.eventAt(receipt.cursor);
  if (located.status !== 'ready') return mapStoreReadFailure(located, 'the original plan event is unavailable');
  if (String(located.value.cursor) !== String(receipt.cursor)) return rejected('unavailable', 'eventAt returned a different cursor');
  const decoded = decodePlanRevisionAcceptedEvent(located.value.event);
  if (decoded.status !== 'decoded') return rejected('unavailable', `the original plan event is corrupt: ${decoded.reason}`);
  const event = decoded.value;
  const snapshot = event.payload.planRevision;
  if (event.eventId !== receipt.eventIds[0]) return rejected('unavailable', 'the receipt points at another event');
  if (event.projectId !== expected.projectId || event.workspaceId !== expected.workspaceId
    || event.aggregateId !== snapshot.planId || snapshot.ref.projectId !== expected.projectId) {
    return rejected('unavailable', 'the original plan event is outside the recovered scope');
  }
  if (event.idempotencyKey !== expected.idempotencyKey || !actorsAgree(event.actor, expected.actor)) {
    return rejected('unavailable', 'the original plan event carries another identity');
  }
  return { status: 'restored', value: snapshot };
}

function mapStoreReadFailure<T>(failure: { status: 'rejected'; code: string; reason: string }, fallback: string): Rejection {
  if (failure.code === 'not_found') return rejected('not_found', failure.reason);
  if (failure.code === 'invalid') return rejected('invalid', failure.reason);
  if (failure.code === 'unsupported') return rejected('incomplete', failure.reason);
  return rejected('unavailable', `${failure.code}: ${failure.reason}`);
}
function mapCommitFailure(receipt: StoreFailure): Rejection & { current?: VersionPin[] } {
  switch (receipt.code) {
    case 'revision_conflict': {
      const current: VersionPin[] = [];
      for (const entry of receipt.current) {
        if (entry.revision === null) continue;
        try {
          const ref = JSON.parse(entry.refKey) as unknown;
          if (isRecord(ref)) current.push({ ref: ref as unknown as VersionPin['ref'], revision: entry.revision });
        } catch { /* the reason still reports the conflict */ }
      }
      return current.length > 0
        ? { status: 'rejected', code: 'revision_conflict', reason: receipt.reason, current }
        : rejected('revision_conflict', receipt.reason);
    }
    case 'idempotency_conflict': return rejected('idempotency_conflict', receipt.reason);
    case 'invalid': return rejected('invalid', receipt.reason);
    case 'unique_conflict': return rejected('busy', receipt.reason);
    case 'corrupt': return rejected('unavailable', `corrupt: ${receipt.reason}`);
    case 'unsupported': return rejected('incomplete', `unsupported: ${receipt.reason}`);
    default: return rejected('unavailable', receipt.reason);
  }
}

// --------------------------------------------------------------------------
// Task rows and watermarks
// --------------------------------------------------------------------------

function phasesOf(facts: CanonicalTaskFacts): Map<string, Phase> {
  const phases = new Map<string, Phase>();
  for (const [taskId, state] of facts.byTaskId) phases.set(taskId, state.effectivePhase);
  return phases;
}
type TaskRowIndex = {
  relationsByTask: ReadonlyMap<string, TaskRelationV2[]>;
  inputsByTask: ReadonlyMap<string, TaskInputRequirementV2[]>;
};
/** One grouping pass per read query: each task must never re-scan the whole v2
 * relation/input lists. */
function buildTaskRowIndex(plan: PlanRevisionSnapshot): TaskRowIndex {
  const relationsByTask = new Map<string, TaskRelationV2[]>();
  const inputsByTask = new Map<string, TaskInputRequirementV2[]>();
  if (plan.schemaVersion === 2) {
    for (const relation of plan.taskRelations ?? []) {
      const endpoints = relation.fromTaskId === relation.toTaskId
        ? [relation.fromTaskId] : [relation.fromTaskId, relation.toTaskId];
      for (const taskId of endpoints) {
        const list = relationsByTask.get(taskId);
        if (list === undefined) relationsByTask.set(taskId, [relation]);
        else list.push(relation);
      }
    }
    for (const requirement of plan.inputRequirements ?? []) {
      const list = inputsByTask.get(requirement.consumerTaskId);
      if (list === undefined) inputsByTask.set(requirement.consumerTaskId, [requirement]);
      else list.push(requirement);
    }
  }
  return { relationsByTask, inputsByTask };
}
function planningDiagnosticKey(diagnostic: { code: string; taskId?: string }): string {
  return `${diagnostic.taskId ?? ''}\u0000${diagnostic.code}`;
}
function stablePlanningDiagnostics<T extends { code: string; taskId?: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const ordered = [...items].sort((left, right) => {
    const a = planningDiagnosticKey(left);
    const b = planningDiagnosticKey(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const result: T[] = [];
  for (const item of ordered) {
    const key = planningDiagnosticKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
/** In-memory Task planning projection from the ONE Plan already read plus the
 * canonical task facts. It opens no material, calls no Host/Role service, runs
 * no verification tool and reads no governance policy. */
function taskPlanningDiagnostics(plan: PlanRevisionSnapshot, task: RuntimeTask): TaskPlanningDiagnostic[] {
  const diagnostics: TaskPlanningDiagnostic[] = [];
  if (task.executionIntent === 'plan_only') {
    diagnostics.push({ code: 'planning_only', taskId: task.taskId,
      message: 'task records planning intent only and is not a dispatch candidate' });
  }
  const hasAcceptance = plan.obligations.some((obligation) => obligation.taskIds.includes(task.taskId)
    && obligation.verificationRequirements.length > 0);
  if (!hasAcceptance) {
    diagnostics.push({ code: 'acceptance_not_defined', taskId: task.taskId,
      message: 'task has no acceptance obligation with explicit verification requirements' });
  }
  return stablePlanningDiagnostics(diagnostics);
}
/** Goal completion interpretation over the SAME Plan + canonical facts read by
 * the caller. Empty diagnostics never authorize completion. */
function goalPlanningView(plan: PlanRevisionSnapshot, phases: ReadonlyMap<string, Phase>): GoalPlanningView {
  const diagnostics: GoalPlanningDiagnostic[] = [];
  for (const task of plan.tasks) {
    if (task.requirementLevel !== 'required') continue;
    if (task.disposition !== 'active' && task.disposition !== 'deferred') continue;
    if (phases.get(task.taskId) !== 'satisfied') {
      diagnostics.push({ code: 'required_task_unfinished', taskId: task.taskId,
        message: `required task ${task.taskId} is not formally satisfied` });
    }
  }
  if (!plan.obligations.some((obligation) => obligation.requirementLevel === 'required')) {
    diagnostics.push({ code: 'goal_acceptance_not_defined',
      message: 'the goal has no required acceptance obligation' });
  }
  const hasRequiredGoalGate = plan.tasks.some((task) => task.requirementLevel === 'required'
    && task.taskKind === 'gate' && task.disposition === 'active' && task.scope.kind === 'goal');
  if (!hasRequiredGoalGate) {
    diagnostics.push({ code: 'goal_gate_not_defined',
      message: 'the goal has no active required GoalGate' });
  }
  return { completionEvaluation: 'not_evaluated', diagnostics: stablePlanningDiagnostics(diagnostics) };
}
function taskRow(plan: PlanRevisionSnapshot, goalId: string,
  facts: CanonicalTaskFacts, phases: ReadonlyMap<string, Phase>, index: TaskRowIndex, taskId: string): TaskRow | null {
  const definition = plan.tasks.find((candidate) => candidate.taskId === taskId);
  const state = facts.byTaskId.get(taskId);
  if (definition === undefined || state === undefined) return null;
  const eligibility = evaluateEligibility({ plan, goalDesiredState: 'active', taskId,
    effectivePhases: phases, lease: state.lease });
  return {
    ref: { projectId: plan.ref.projectId, goalId, taskId },
    definition,
    effectivePhase: state.effectivePhase,
    disposition: definition.disposition,
    currentAttempt: state.currentAttempt,
    execution: state.execution,
    eligibilityScope: 'task_state',
    eligibility,
    // Literal accepted-Plan projection only. These fields never open material
    // or turn a legacy label into a verified input.
    relations: index.relationsByTask.get(taskId) ?? [],
    inputRequirements: (index.inputsByTask.get(taskId) ?? [])
      .map((requirement) => ({ requirement, verification: 'not_checked' as const })),
    legacyDependencies: plan.executionDag.dependsOn.filter((edge) => edge.taskId === taskId)
      .map((edge) => ({ dependsOnId: edge.dependsOnId, requires: edge.requires,
        verification: 'legacy_unverifiable' as const })),
    planningDiagnostics: taskPlanningDiagnostics(plan, definition),
  };
}
function compareWatermark(
  observed: CommitCursor | null,
  required: CommitCursor,
): { status: 'ok' } | { status: 'not_ready'; observed: ReadStamp | null; required: ReadStamp } {
  let observedSeq: number;
  let requiredSeq: number;
  try {
    requiredSeq = seqOfCommitCursor(required);
    observedSeq = observed === null ? 0 : seqOfCommitCursor(observed);
  } catch {
    return { status: 'not_ready', observed: observed === null ? null : { kind: 'platform', cursor: observed },
      required: { kind: 'platform', cursor: required } };
  }
  if (observedSeq >= requiredSeq) return { status: 'ok' };
  return { status: 'not_ready', observed: observed === null ? null : { kind: 'platform', cursor: observed },
    required: { kind: 'platform', cursor: required } };
}

// --------------------------------------------------------------------------
// Ready-task page cursor (scope + filter + plan version + watermark + principal)
// --------------------------------------------------------------------------

type ReadyPageCursor = {
  v: 1; principalKey: string; projectId: string; workspaceId: string; goalId: string; planRefKey: string;
  includeBlocked: boolean; roleIds: string[]; after: string | null; waterline: string | null;
};
function encodeReadyCursor(cursor: ReadyPageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}
function decodeReadyCursor(value: string): { status: 'ok'; cursor: ReadyPageCursor } | { status: 'invalid'; reason: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (!isRecord(parsed) || parsed['v'] !== 1 || !nonEmpty(parsed['principalKey']) || !nonEmpty(parsed['projectId'])
      || !nonEmpty(parsed['workspaceId']) || !nonEmpty(parsed['goalId']) || !nonEmpty(parsed['planRefKey'])
      || typeof parsed['includeBlocked'] !== 'boolean' || !Array.isArray(parsed['roleIds'])
      || !(parsed['roleIds'] as unknown[]).every(nonEmpty)
      || (parsed['after'] !== null && !nonEmpty(parsed['after']))
      || (parsed['waterline'] !== null && !nonEmpty(parsed['waterline']))) {
      return { status: 'invalid', reason: 'the page cursor is malformed' };
    }
    return { status: 'ok', cursor: parsed as unknown as ReadyPageCursor };
  } catch {
    return { status: 'invalid', reason: 'the page cursor is not decodable' };
  }
}
function sameRoleFilter(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((role) => right.includes(role));
}

// --------------------------------------------------------------------------
// The service
// --------------------------------------------------------------------------

export function createPlanService(deps: PlanServiceDependencies): PlanServicePort {
  const { records } = deps;

  /**
   * R5b.4 §11.4 the narrow fact read. It consumes only the persisted Query
   * owner's formal facts (Answer/Job/Run + the frozen prepared manifest body)
   * through the same records/materials/bodies instances; it never calls Runtime,
   * opens the Kernel store or rescans a transcript.
   */
  async function readInitialPlanAnswerFacts(
    ctx: CoreCallContext,
    answerRef: QueryJobAnswerRef,
  ): Promise<ReadResult<InitialPlanAnswerFacts>> {
    const materials = deps.materials;
    const bodies = deps.initialPlanning?.bodies;
    if (materials === undefined || bodies === undefined) {
      return rejected('unsupported', 'the initial-plan answer consumption requires the injected materials and prepared-body stores');
    }
    if (!isRecord(answerRef) || answerRef.aggregateType !== 'QueryJobAnswer'
      || !nonEmpty(answerRef.projectId) || !nonEmpty(answerRef.workspaceId)
      || !nonEmpty(answerRef.queryJobId) || !nonEmpty(answerRef.answerId)) {
      return rejected('invalid', 'the initial-plan consumer requires a complete QueryJobAnswerRef');
    }
    const wanted = answerRef as QueryJobAnswerRef;
    const answerKey = canonicalJson(wanted as unknown as JsonValue);
    let answerRead;
    try { answerRead = await records.readMany([answerKey]); }
    catch (error) { return rejected('unavailable', `the Query answer read failed: ${messageOf(error)}`); }
    if (answerRead.status !== 'ready') return mapStoreReadFailure(answerRead, 'the Query answer is not readable');
    const answerRecord = answerRead.value.records.find((record) => record.refKey === answerKey);
    if (answerRecord === undefined) {
      return answerRead.value.missing.includes(answerKey)
        ? { status: 'not_found' } : rejected('unavailable', 'the Query answer read was not reported');
    }
    const decodedAnswer = decodeQueryJobAnswerSnapshot(answerRecord);
    if (decodedAnswer.status !== 'decoded') {
      return rejected('unavailable', `the Query answer is not decodable: ${decodedAnswer.reason}`);
    }
    const answer = decodedAnswer.value;
    if (answer.ref.answerId !== wanted.answerId || answer.ref.queryJobId !== wanted.queryJobId
      || answer.ref.projectId !== wanted.projectId || answer.ref.workspaceId !== wanted.workspaceId) {
      return rejected('invalid', 'the stored Query answer does not match the requested answer identity');
    }
    const jobRef: QueryJobRef = { aggregateType: 'QueryJob', projectId: wanted.projectId,
      workspaceId: wanted.workspaceId, queryJobId: wanted.queryJobId };
    const runRef = answer.answer.runRef;
    if (!isRecord(runRef) || runRef.aggregateType !== 'QueryRun'
      || runRef.projectId !== wanted.projectId || runRef.workspaceId !== wanted.workspaceId
      || runRef.queryJobId !== wanted.queryJobId || !nonEmpty(runRef.runId)) {
      return rejected('invalid', 'the stored Query answer carries an inconsistent QueryRunRef');
    }
    const jobKey = canonicalJson(jobRef as unknown as JsonValue);
    const runKey = canonicalJson(runRef as unknown as JsonValue);
    let coreRead;
    try { coreRead = await records.readMany([jobKey, runKey]); }
    catch (error) { return rejected('unavailable', `the Query Job/Run read failed: ${messageOf(error)}`); }
    if (coreRead.status !== 'ready') return mapStoreReadFailure(coreRead, 'the Query Job/Run are not readable');
    const present = new Map(coreRead.value.records.map((record) => [record.refKey, record]));
    const jobRecord = present.get(jobKey);
    if (jobRecord === undefined) return rejected('not_found', 'the QueryJob record does not exist');
    const runRecord = present.get(runKey);
    if (runRecord === undefined) return rejected('not_found', 'the QueryRun record does not exist');
    const decodedJob = decodeQueryJobSnapshot(jobRecord);
    if (decodedJob.status !== 'decoded') return rejected('unavailable', `the QueryJob is not decodable: ${decodedJob.reason}`);
    const decodedRun = decodeQueryRunSnapshotRecord(runRecord);
    if (decodedRun.status !== 'decoded') return rejected('unavailable', `the QueryRun is not decodable: ${decodedRun.reason}`);
    const job: QueryJobSnapshot = decodedJob.value;
    const run: QueryRunSnapshot = decodedRun.value;
    // Same formal scope, the initial_coordination kind and the real answered facts.
    if (job.ref.projectId !== wanted.projectId || job.ref.workspaceId !== wanted.workspaceId
      || job.ref.queryJobId !== wanted.queryJobId
      || job.job.projectId !== wanted.projectId || job.job.workspaceId !== wanted.workspaceId) {
      return rejected('forbidden', 'the QueryJob is outside the requested answer scope');
    }
    if (job.job.intent.execution?.kind !== 'initial_coordination') {
      return rejected('invalid', 'the QueryJob intent is not an initial_coordination request');
    }
    if (!nonEmpty(job.job.goalId)) return rejected('incomplete', 'the QueryJob intent has no Goal');
    if (job.job.runRef === null || job.job.runRef.runId !== runRef.runId) {
      return rejected('invalid', 'the QueryJob does not point at the answered QueryRun');
    }
    if (job.job.status !== 'answered') return rejected('incomplete', 'the QueryJob is not formally answered');
    if (!job.job.answerRefs.some((ref) => canonicalJson(ref as unknown as JsonValue) === answerKey)) {
      return rejected('invalid', 'the QueryJob does not carry this answer');
    }
    if (run.ref.projectId !== wanted.projectId || run.ref.workspaceId !== wanted.workspaceId
      || run.ref.queryJobId !== wanted.queryJobId || run.ref.runId !== runRef.runId) {
      return rejected('forbidden', 'the QueryRun is outside the requested answer scope');
    }
    if (run.run.status !== 'answered' || run.run.outcome !== 'answered') {
      return rejected('incomplete', 'the QueryRun is not formally answered');
    }
    const state = run.run.executionState;
    if (state === undefined || state.phase !== 'settled') {
      return rejected('incomplete', 'the QueryRun has no settled execution observation');
    }
    if (state.history === null) return rejected('incomplete', 'the QueryRun has no saved history locator');
    if (state.prepared === null) return rejected('incomplete', 'the QueryRun has no frozen prepared manifest reference');
    // The exact persisted answer body, opened as a Host historical explanation.
    let opened;
    try {
      opened = await materials.openArtifact(ctx, {
        ref: answer.answer.bodyRef, usage: 'historical_explanation' });
    } catch (error) { return rejected('unavailable', `the Query answer body read failed: ${messageOf(error)}`); }
    if (opened.status !== 'ready') return opened;
    const body = opened.value;
    if (body.body !== answer.answer.answer || body.ref.digest !== answer.answer.bodyRef.digest
      || sha256Hex(body.body) !== answer.answer.bodyRef.digest) {
      return rejected('invalid', 'the stored Query answer body disagrees with the recorded answer');
    }
    if (body.ownerRunRef === null || body.ownerRunRef === undefined
      || canonicalJson(body.ownerRunRef as unknown as JsonValue) !== runKey) {
      return rejected('forbidden', 'the stored Query answer body is not owned by this QueryRun');
    }
    // The frozen prepared manifest body, re-read through the same raw body store.
    const prepared = state.prepared;
    const bundleRef = prepared.bundleRef;
    if (bundleRef.contentType !== QUERY_MANIFEST_CONTENT_TYPE) {
      return rejected('invalid', 'the prepared Query manifest reference is not a bounded query-execution manifest');
    }
    let storedManifest;
    try { storedManifest = await bodies.read(bundleRef); }
    catch (error) { return rejected('unavailable', `reading the prepared Query manifest failed: ${messageOf(error)}`); }
    if (storedManifest.status !== 'ready') {
      return rejected('invalid', 'the frozen prepared Query manifest body is not readable');
    }
    const raw = storedManifest.value;
    if (raw.ref.contentType !== bundleRef.contentType || raw.ref.digest !== bundleRef.digest
      || raw.ref.sizeBytes !== bundleRef.sizeBytes
      || sha256Hex(raw.body) !== bundleRef.digest
      || Buffer.byteLength(raw.body, 'utf8') !== bundleRef.sizeBytes) {
      return rejected('invalid', 'the stored Query manifest body disagrees with the prepared reference');
    }
    if (raw.origin.kind !== 'run'
      || canonicalJson(raw.origin.owner as unknown as JsonValue) !== runKey) {
      return rejected('forbidden', 'the prepared Query manifest is not owned by this QueryRun');
    }
    let parsedManifest: unknown;
    try { parsedManifest = JSON.parse(raw.body); }
    catch { return rejected('invalid', 'the prepared Query manifest is not valid JSON'); }
    if (!isRecord(parsedManifest) || parsedManifest['schemaVersion'] !== 1
      || parsedManifest['kind'] !== 'query_execution'
      || typeof parsedManifest['input'] !== 'string' || !nonEmpty(parsedManifest['inputDigest'])) {
      return rejected('invalid', 'the prepared Query manifest is incomplete');
    }
    const manifest = parsedManifest as unknown as PreparedQueryManifestV1;
    if (canonicalJson(manifest.queryRunRef as unknown as JsonValue) !== runKey) {
      return rejected('invalid', 'the prepared Query manifest disagrees with the QueryRun');
    }
    if (sha256Hex(manifest.input) !== manifest.inputDigest || manifest.inputDigest !== prepared.inputDigest) {
      return rejected('invalid', 'the prepared Query manifest input digest is inconsistent');
    }
    if (!isRecord(manifest.goal) || !isRecord(manifest.goal.ref)
      || manifest.goal.ref.projectId !== wanted.projectId || manifest.goal.ref.goalId !== job.job.goalId
      || manifest.workspace.ref.workspaceId !== wanted.workspaceId) {
      return rejected('invalid', 'the prepared Query manifest does not pin this Goal/Workspace');
    }
    return { status: 'ready', value: {
      answer: answer.answer, answerRef: { ...answer.ref }, job, run, manifest,
      answerText: answer.answer.answer } };
  }

  /**
   * R5b.4 §11.4 the apply-side provenance proof: the candidate must be the
   * UNIQUE normalization of its real persisted answer. The actual read versions
   * join the original local CAS; a mismatch is an explicit rejection and never a
   * repair of the stored draft.
   */
  async function verifyModelCoordinationDraft(
    ownedContext: Owned<CoreCallContext>,
    proposal: Extract<PlanProposal, { kind: 'candidate_v2' }>,
  ): Promise<{ guards: RecordGuard[] } | { rejection: Rejection }> {
    const origin = proposal.draft.origin;
    if (origin === undefined || origin.kind !== 'model_coordination') {
      return { rejection: rejected('invalid', 'the candidate does not carry the model-coordination origin it claims') };
    }
    if (deps.materials === undefined || deps.initialPlanning === undefined) {
      return { rejection: rejected('unsupported', 'model-coordination adoption requires the injected materials and prepared-body stores') };
    }
    if (ownedContext.status === 'invalid') return { rejection: rejected('invalid', ownedContext.reason) };
    const factsRead = await readInitialPlanAnswerFacts(ownedContext.value, origin.answerRef);
    if (factsRead.status !== 'ready') {
      return { rejection: asWriteRejection(factsRead, 'the initial-plan answer facts are not readable') };
    }
    const facts = factsRead.value;
    const parsed = parseInitialPlanningResponseV2(facts.answerText);
    if (parsed.status === 'rejected') return { rejection: parsed };
    const normalized = normalizeInitialPlanningResponseV2(parsed.response, facts);
    if (normalized.status !== 'plan') {
      return { rejection: rejected('invalid', 'the real answer no longer normalizes to the proposed plan') };
    }
    if (canonicalJson(normalized.draft as unknown as JsonValue)
      !== canonicalJson(proposal.draft as unknown as JsonValue)) {
      return { rejection: rejected('invalid', 'the candidate draft is not the unique normalization of the real answer') };
    }
    return { guards: [
      { refKey: canonicalJson(origin.answerRef as unknown as JsonValue), expectedRevision: 1 },
      { refKey: canonicalJson(facts.job.ref as unknown as JsonValue), expectedRevision: facts.job.revision },
      { refKey: canonicalJson(facts.run.ref as unknown as JsonValue), expectedRevision: facts.run.revision },
    ] };
  }

  /**
   * R5b.4 §11.2 the ONE Host candidate commit/receipt step shared by the direct
   * Host propose and the new answer-derived entry. The caller supplies the full
   * identity/fingerprint/proposal ref (already bound to the trusted actor/scope);
   * this step only does the original receipt lookup/restore, the pinned-scope CAS,
   * the bounded draft admission and the single `PlanProposalRecorded` commit.
   * `extraGuards` joins the same local CAS (e.g. the Answer/Job/Run revisions the
   * new entry actually read); it never becomes a second commit algorithm.
   */
  async function commitHostPlanProposal(input: {
    goalRef: GoalRef;
    workspaceId: string;
    actor: ActorRef;
    identityKey: string;
    fingerprint: string;
    proposalId: string;
    ref: PlanProposalRef;
    basedOn: PlanRevisionRef | null;
    draft: PlanRevisionDraft;
    reason: unknown;
    requestId: string;
    expected: unknown;
    extraGuards: readonly RecordGuard[];
  }): Promise<WriteResult<PlanProposal>> {
    const { goalRef, workspaceId } = input;
    const pins = normalizeCallerPlanPins({ projectId: goalRef.projectId, workspaceId, goalId: goalRef.goalId }, input.expected);
    if (pins.status === 'invalid') return rejected('invalid', pins.reason);

    const early = await records.lookupCommit({ identityKey: input.identityKey, fingerprint: input.fingerprint });
    if (early.status === 'ready') {
      const restored = await restoreProposal(records, early.value, { identityKey: input.identityKey,
        projectId: goalRef.projectId, workspaceId, proposalId: input.proposalId,
        idempotencyKey: input.requestId, actor: input.actor });
      if (restored.status !== 'restored') return rejected(restored.code, restored.reason);
      return { status: 'committed', value: restored.proposal, replayed: true, cursor: early.value.cursor };
    }
    if (early.code === 'idempotency_conflict') return rejected('idempotency_conflict', early.reason);
    if (early.code !== 'not_found') return rejected('unavailable', `${early.code}: ${early.reason}`);

    const scope = await readGoalScope(records, goalRef);
    if (scope.status !== 'ready') return scope;
    if (scope.goal.workspaceRef.workspaceId !== workspaceId) return forbidden('the goal does not belong to the requested workspace');
    const comparison = compareCallerPlanPins({ projectId: goalRef.projectId, workspaceId, goalId: goalRef.goalId },
      pins.pins, { projectRevision: scope.projectRevision, workspaceRevision: scope.workspaceRevision, goalRevision: scope.goal.revision });
    if (comparison.status === 'conflict') {
      return { status: 'rejected', code: 'revision_conflict',
        reason: 'the supplied version pins do not match the versions read in this call', current: comparison.current };
    }

    const policyRead = await tryPolicyContent(records, goalRef.projectId);
    const issues = validatePlanDraft(input.draft, policyRead.policy);
    const candidate: PlanProposal = { kind: 'candidate_v2', ref: input.ref, revision: 1, schemaVersion: 2,
      goalRef, basedOn: input.basedOn, draft: input.draft, reason: input.reason as unknown as PlanChangeReason,
      status: 'candidate', issues };
    const identity = { projectId: goalRef.projectId, actor: input.actor, idempotencyKey: input.requestId };
    const derived = deriveCommandIds(identity, 'plan-propose');
    const event: PlanProposalRecordedEvent = {
      eventId: deps.eventId(), eventType: 'PlanProposalRecorded', schemaVersion: 2,
      projectId: goalRef.projectId, workspaceId, aggregateType: 'PlanProposal', aggregateId: input.proposalId,
      aggregateRevision: 1, causationId: derived.commandId, correlationId: derived.correlationId,
      idempotencyKey: input.requestId, actor: input.actor, occurredAt: deps.now(), payload: { proposal: candidate },
    };
    // The FIRST read of the window is the horizon: any fact added after it must
    // conflict, even if a later optional read observed a newer head.
    const horizon = scope.readThrough;
    if (horizon === null) return rejected('incomplete', 'the ledger has no readable watermark for the proposal');
    const guards: RecordGuard[] = [
      ...input.extraGuards,
      { refKey: scope.projectKey, expectedRevision: scope.projectRevision },
      { refKey: scope.workspaceKey, expectedRevision: scope.workspaceRevision },
      { refKey: refKeyOf(goalRef), expectedRevision: scope.goal.revision },
      { refKey: planProposalRefKey(input.ref), expectedRevision: null },
    ];
    const committed = await records.commit({ identityKey: input.identityKey, fingerprint: input.fingerprint,
      guards, records: [encodePlanProposal(candidate)], claims: [], indexGuards: [], indexChanges: [],
      events: [encodePlanProposalRecordedEvent(event)], ledgerHorizon: horizon });
    if (committed.status !== 'committed') return mapCommitFailure(committed);
    if (!committed.replayed) return { status: 'committed', value: candidate, replayed: false, cursor: committed.cursor };
    const restored = await restoreProposal(records, committed, { identityKey: input.identityKey,
      projectId: goalRef.projectId, workspaceId, proposalId: input.proposalId,
      idempotencyKey: input.requestId, actor: input.actor });
    if (restored.status !== 'restored') return rejected(restored.code, restored.reason);
    return { status: 'committed', value: restored.proposal, replayed: true, cursor: committed.cursor };
  }

  async function proposePlan(
    ctx: CoreCallContext,
    request: { input: { goalRef: GoalRef; basedOn: PlanRevisionRef | null; draft: PlanRevisionDraft;
      reason: unknown }; meta: { requestId: string; expected: readonly VersionPin[] } },
  ): Promise<WriteResult<PlanProposal>> {
    if (ctx?.signal?.aborted) return rejected('cancelled', 'plan proposal was cancelled before admission');
    const owned = ownJsonInput(request, 'proposePlan request');
    if (owned.status === 'invalid') return rejected('invalid', owned.reason);
    const body = owned.value as unknown as { input?: unknown; meta?: unknown } | undefined;
    const rawInput = body?.input;
    const rawMeta = body?.meta;
    if (!isRecord(rawInput) || !isRecord(rawMeta)) return rejected('invalid', 'proposePlan requires an input and meta object');
    const rawGoalRef = rawInput['goalRef'];
    if (!isRecord(rawGoalRef) || !nonEmpty(rawGoalRef['projectId'])) return rejected('invalid', 'proposePlan requires a full GoalRef');
    const goalRef = goalRefFromUnknown(rawGoalRef, rawGoalRef['projectId']);
    if (goalRef === null) return rejected('invalid', 'proposePlan requires a full GoalRef in this project');
    const basedOnRaw = rawInput['basedOn'];
    const basedOn = basedOnRaw === null ? null : planRevisionRefFromUnknown(basedOnRaw, goalRef.projectId);
    if (basedOnRaw !== null && basedOn === null) return rejected('invalid', 'basedOn must be null or a PlanRevisionRef in this project');
    const draftRaw = rawInput['draft'];
    if (!isRecord(draftRaw) || !nonEmpty(draftRaw['planId']) || !nonEmpty(draftRaw['goalId'])) {
      return rejected('invalid', 'proposePlan requires a draft with planId and goalId');
    }
    const draft = draftRaw as unknown as PlanRevisionDraft;
    const reasonRaw = rawInput['reason'];
    if (!isRecord(reasonRaw) || !nonEmpty(reasonRaw['text']) || !Array.isArray(reasonRaw['sources'])) {
      return rejected('invalid', 'proposePlan requires a reason with text and sources');
    }
    const requestId = rawMeta['requestId'];
    if (!nonEmpty(requestId)) return rejected('invalid', 'proposePlan requires meta.requestId');
    if (draft.goalId !== goalRef.goalId) return rejected('invalid', 'the draft goalId does not match the GoalRef');

    const workspaceId = ctx.workspaceId;
    if (!nonEmpty(workspaceId)) return forbidden('proposePlan requires a workspace-bound context');
    // W2 Agent branch is recognized first and never falls through to the Host-only binding.
    if (isWorkRunCaller(ctx)) {
      const ownedContext = ownCallContext(ctx);
      if (ownedContext.status === 'invalid') return rejected('invalid', ownedContext.reason);
      return proposePlanAsAgent(deps, records, ownedContext.value, {
        goalRef, basedOn, draft, reason: reasonRaw, requestId, expected: rawMeta['expected'], workspaceId,
      });
    }
    const bound = boundWriteActor(ctx, goalRef.projectId, workspaceId);
    if (bound.status !== 'ok') return rejected(bound.code, bound.reason);
    if (bound.aborted) return rejected('cancelled', 'plan proposal was cancelled before admission');

    const identity = { projectId: goalRef.projectId, actor: bound.actor, idempotencyKey: requestId };
    const identityKey = PLAN_PROPOSE_IDENTITY_PREFIX + commandIdentityKey(identity);
    const proposalId = planProposalIdFor({ projectId: goalRef.projectId, workspaceId, goalId: goalRef.goalId, requestId });
    const ref: PlanProposalRef = { aggregateType: 'PlanProposal', projectId: goalRef.projectId, workspaceId, proposalId };
    const fingerprint = proposeFingerprint({ projectId: goalRef.projectId, workspaceId, goalRef, basedOn, draft, reason: reasonRaw });

    return commitHostPlanProposal({
      goalRef, workspaceId, actor: bound.actor, identityKey, fingerprint, proposalId, ref,
      basedOn, draft, reason: reasonRaw, requestId, expected: rawMeta['expected'], extraGuards: [],
    });
  }

  async function applyPlanChange(
    ctx: CoreCallContext,
    request: { input: { proposalRef: PlanProposalRef; expectedProposalRevision: number;
      decisionRefs: readonly VersionPin[] }; meta: { requestId: string; expected: readonly VersionPin[] } },
  ): Promise<WriteResult<import('../../../contracts/plan.js').PlanRevisionSnapshot>> {
    if (ctx?.signal?.aborted) return rejected('cancelled', 'plan adoption was cancelled before admission');
    // The model-origin body read below is new I/O: its material identity is owned
    // by this pre-await snapshot, never recovered later from the mutable caller.
    const capturedContext = ownCallContext(ctx);
    const owned = ownJsonInput(request, 'applyPlanChange request');
    if (owned.status === 'invalid') return rejected('invalid', owned.reason);
    const body = owned.value as unknown as { input?: unknown; meta?: unknown } | undefined;
    const rawInput = body?.input;
    const rawMeta = body?.meta;
    if (!isRecord(rawInput) || !isRecord(rawMeta)) return rejected('invalid', 'applyPlanChange requires an input and meta object');
    const proposalRef = planProposalRefFromUnknown(rawInput['proposalRef']);
    if (proposalRef === null) return rejected('invalid', 'applyPlanChange requires a full PlanProposalRef');
    const expectedProposalRevision = rawInput['expectedProposalRevision'];
    if (typeof expectedProposalRevision !== 'number' || !Number.isSafeInteger(expectedProposalRevision) || expectedProposalRevision < 1) {
      return rejected('invalid', 'expectedProposalRevision must be a positive integer');
    }
    const decisionRefs = rawInput['decisionRefs'];
    if (!Array.isArray(decisionRefs)) return rejected('invalid', 'decisionRefs must be an array');
    for (const entry of decisionRefs as unknown[]) {
      if (!isRecord(entry) || !isRecord(entry['ref']) || typeof entry['revision'] !== 'number'
        || !Number.isSafeInteger(entry['revision']) || entry['revision'] < 0) {
        return rejected('invalid', 'every decisionRef must be a versioned ref');
      }
    }
    const requestId = rawMeta['requestId'];
    if (!nonEmpty(requestId)) return rejected('invalid', 'applyPlanChange requires meta.requestId');
    // W2 Agent branch is recognized first and never falls through to the Host-only binding.
    if (isWorkRunCaller(ctx)) {
      const ownedContext = ownCallContext(ctx);
      if (ownedContext.status === 'invalid') return rejected('invalid', ownedContext.reason);
      return applyPlanChangeAsAgent(deps, records, ownedContext.value, {
        proposalRef, expectedProposalRevision, decisionRefs: rawInput['decisionRefs'],
        requestId, expected: rawMeta['expected'],
      });
    }
    const bound = boundWriteActor(ctx, proposalRef.projectId, proposalRef.workspaceId);
    if (bound.status !== 'ok') return rejected(bound.code, bound.reason);
    if (bound.aborted) return rejected('cancelled', 'plan adoption was cancelled before admission');

    const identity = { projectId: proposalRef.projectId, actor: bound.actor, idempotencyKey: requestId };
    const identityKey = PLAN_APPLY_IDENTITY_PREFIX + commandIdentityKey(identity);
    const fingerprint = applyFingerprint({ projectId: proposalRef.projectId, workspaceId: proposalRef.workspaceId,
      proposalRef, expectedProposalRevision, decisionRefs: rawInput['decisionRefs'] });

    const prePins = normalizeCallerPlanPins({ projectId: proposalRef.projectId, workspaceId: proposalRef.workspaceId }, rawMeta['expected']);
    if (prePins.status === 'invalid') return rejected('invalid', prePins.reason);

    const early = await records.lookupCommit({ identityKey, fingerprint });
    if (early.status === 'ready') {
      const restored = await restoreAcceptedPlan(records, early.value, { identityKey,
        projectId: proposalRef.projectId, workspaceId: proposalRef.workspaceId,
        idempotencyKey: requestId, actor: bound.actor });
      if (restored.status !== 'restored') return rejected(restored.code, restored.reason);
      return { status: 'committed', value: restored.value, replayed: true, cursor: early.value.cursor };
    }
    if (early.code === 'idempotency_conflict') return rejected('idempotency_conflict', early.reason);
    if (early.code !== 'not_found') return rejected('unavailable', `${early.code}: ${early.reason}`);

    const recheck = async (): Promise<WriteResult<import('../../../contracts/plan.js').PlanRevisionSnapshot> | null> => {
      // Concurrency seam: after a lookup miss a same-identity peer may commit
      // before our post-lookup read, so the normal validation sees an accepted
      // proposal or an advanced Goal. Re-query the EXACT receipt once; a
      // matching body restores the original adoption, a different body is an
      // idempotency conflict, and a genuine miss still returns the rejection.
      const receipt = await records.lookupCommit({ identityKey, fingerprint });
      if (receipt.status === 'ready') {
        const restored = await restoreAcceptedPlan(records, receipt.value, { identityKey,
          projectId: proposalRef.projectId, workspaceId: proposalRef.workspaceId,
          idempotencyKey: requestId, actor: bound.actor });
        if (restored.status === 'restored') {
          return { status: 'committed', value: restored.value, replayed: true, cursor: receipt.value.cursor };
        }
        return rejected(restored.code, restored.reason);
      }
      if (receipt.code === 'idempotency_conflict') return rejected('idempotency_conflict', receipt.reason);
      return null;
    };

    const evaluate = async (): Promise<WriteResult<import('../../../contracts/plan.js').PlanRevisionSnapshot>> => {
      const proposalRead = await readProposal(records, proposalRef);
      if (proposalRead.status !== 'ready') return proposalRead;
      const proposal = proposalRead.proposal;
      if (proposal.kind !== 'candidate_v2') return rejected('unsupported', 'a legacy v1 patch proposal cannot be adopted by this slice');
      if (proposal.status !== 'candidate') return rejected('invalid', `proposal ${proposalRef.proposalId} is not a pending candidate`);
      if (proposal.revision !== expectedProposalRevision) {
        return { status: 'rejected', code: 'revision_conflict', reason: 'the proposal revision changed',
          current: [{ ref: proposalRef, revision: proposal.revision }] };
      }
      const goalRef = proposal.goalRef;
      const scoped = await validateProposalScope(records, proposalRef, goalRef, rawMeta['expected']);
      if (scoped.status !== 'ready') return scoped;
      const scope = scoped.scope;

      if (proposal.basedOn !== null) {
        return applyFutureRevision({
          records, proposal, proposalRef, goalRef, goalScope: scope, sourceRef: proposal.basedOn,
          decisionRefs: decisionRefs as readonly VersionPin[],
          identity, identityKey, fingerprint, requestId,
          extraGuards: [], actor: bound.actor, preCommitSignal: null,
          eventId: deps.eventId, now: deps.now,
        });
      }

      if ((decisionRefs as unknown[]).length > 0) return rejected('invalid', 'an initial plan adoption does not accept decision references');
      if (scope.goal.activePlanRevision !== null) {
        return { status: 'rejected', code: 'revision_conflict',
          reason: 'the goal already has an active plan; an initial adoption cannot replace it',
          current: [{ ref: scope.goal.activePlanRevision, revision: 1 }] };
      }
      let originGuards: RecordGuard[] = [];
      if (proposal.draft.origin !== undefined) {
        const verified = await verifyModelCoordinationDraft(capturedContext, proposal);
        if ('rejection' in verified) return verified.rejection;
        originGuards = verified.guards;
      }

      const governance = await resolveGovernance(records, proposalRef.projectId);
      if (governance.status !== 'resolved') return governance;
      const initialIssues = validatePlanDraft(proposal.draft, governance.policyContent);
      if (initialIssues.length > 0) return planAdmissionRejection('the initial plan is not admissible', initialIssues);
      const initialAssignmentReasons = validatePlanAssignments(proposal.draft);
      if (initialAssignmentReasons.length > 0) return rejected('incomplete', `the initial plan is not admissible: ${initialAssignmentReasons.join('; ')}`);
      const initialPhaseReasons = planPhaseGuardReasons(proposal.draft.tasks);
      if (initialPhaseReasons.length > 0) return rejected('incomplete', `the initial plan is not admissible: ${initialPhaseReasons.join('; ')}`);

      const priorGuards: RecordGuard[] = [
        ...originGuards,
        { refKey: scope.projectKey, expectedRevision: scope.projectRevision },
        { refKey: scope.workspaceKey, expectedRevision: scope.workspaceRevision },
        { refKey: refKeyOf(goalRef), expectedRevision: scope.goal.revision },
        { refKey: planProposalRefKey(proposalRef), expectedRevision: proposal.revision },
      ];
      // The proposal read is the FIRST read of this window: it is the horizon.
      const horizon = proposalRead.readThrough ?? scope.readThrough;
      if (horizon === null) return rejected('incomplete', 'the ledger has no readable watermark for the plan adoption');
      const acceptedAt = deps.now();
      const derived = deriveCommandIds(identity, 'plan-apply');
      const compiled = compileInitialPlanAdoption({
        goal: scope.goal,
        proposal,
        draft: proposal.draft,
        governance: governance.governance,
        priorGuards,
        ledgerHorizon: horizon,
        identityKey,
        fingerprint,
        eventId: deps.eventId(),
        occurredAt: acceptedAt,
        commandId: derived.commandId,
        correlationId: derived.correlationId,
        idempotencyKey: requestId,
        actor: bound.actor,
      });
      const committed = await records.commit(compiled.prepared);
      if (committed.status !== 'committed') return mapCommitFailure(committed);
      if (!committed.replayed) return { status: 'committed', value: compiled.snapshot, replayed: false, cursor: committed.cursor };
      const restored = await restoreAcceptedPlan(records, committed, { identityKey,
        projectId: proposalRef.projectId, workspaceId: proposalRef.workspaceId,
        idempotencyKey: requestId, actor: bound.actor });
      if (restored.status !== 'restored') return rejected(restored.code, restored.reason);
      return { status: 'committed', value: restored.value, replayed: true, cursor: committed.cursor };
    };

    const outcome = await evaluate();
    if (outcome.status === 'rejected') {
      const restored = await recheck();
      if (restored !== null) return restored;
    }
    return outcome;
  }

  /**
   * R5b.4 §11.2 the ONE thin initial-plan consumer.
   *
   * It isolates the original request/ctx before the first await, reads the
   * formal Answer/Job/Run/body and the QueryRun's frozen prepared manifest through
   * the SAME records/materials/initialPlanning.bodies instances, normalizes the
   * answer with the unique module, and then reuses the existing `proposePlan`
   * commit/receipt (which checks the original receipt before any current-fact
   * gate). A `needs_decision` answer writes no candidate and returns only its
   * explicit questions.
   */
  async function proposeInitialPlanFromAnswer(
    ctx: CoreCallContext,
    request: { input: { answerRef: QueryJobAnswerRef; reason: PlanChangeReason };
      meta: { requestId: string; expected: readonly VersionPin[] } },
  ): Promise<InitialPlanProposalResult> {
    if (ctx?.signal?.aborted) return rejected('cancelled', 'the initial plan proposal was cancelled before admission');
    const ownedRequest = ownJsonInput(request, 'proposeInitialPlanFromAnswer request');
    if (ownedRequest.status === 'invalid') return rejected('invalid', ownedRequest.reason);
    const ownedContext = ownCallContext(ctx);
    if (ownedContext.status === 'invalid') return rejected('invalid', ownedContext.reason);
    const body = ownedRequest.value as unknown as { input?: unknown; meta?: unknown } | undefined;
    const rawInput = body?.input;
    const rawMeta = body?.meta;
    if (!isRecord(rawInput) || !isRecord(rawMeta)) {
      return rejected('invalid', 'proposeInitialPlanFromAnswer requires an input and meta object');
    }
    const rawAnswerRef = rawInput['answerRef'];
    if (!isRecord(rawAnswerRef) || rawAnswerRef['aggregateType'] !== 'QueryJobAnswer'
      || !nonEmpty(rawAnswerRef['projectId']) || !nonEmpty(rawAnswerRef['workspaceId'])
      || !nonEmpty(rawAnswerRef['queryJobId']) || !nonEmpty(rawAnswerRef['answerId'])) {
      return rejected('invalid', 'proposeInitialPlanFromAnswer requires a complete QueryJobAnswerRef');
    }
    const answerRef = rawAnswerRef as unknown as QueryJobAnswerRef;
    const rawReason = rawInput['reason'];
    if (!isRecord(rawReason) || !nonEmpty(rawReason['text']) || !Array.isArray(rawReason['sources'])) {
      return rejected('invalid', 'proposeInitialPlanFromAnswer requires a reason with text and sources');
    }
    const requestId = rawMeta['requestId'];
    if (!nonEmpty(requestId)) return rejected('invalid', 'proposeInitialPlanFromAnswer requires meta.requestId');
    const expectedRaw = rawMeta['expected'];
    if (expectedRaw !== undefined && !Array.isArray(expectedRaw)) {
      return rejected('invalid', 'meta.expected must be an array of version pins');
    }
    const expected = expectedRaw ?? [];
    // The original Host/workspace binding is fixed before any answer is read.
    const workspaceId = ownedContext.value.workspaceId;
    if (!nonEmpty(workspaceId)) {
      return forbidden('proposeInitialPlanFromAnswer requires the bound workspace context');
    }
    const bound = boundWriteActor(ownedContext.value, answerRef.projectId, answerRef.workspaceId);
    if (bound.status !== 'ok') return rejected(bound.code, bound.reason);
    if (bound.aborted) return rejected('cancelled', 'the initial plan proposal was cancelled before admission');
    const identity = { projectId: answerRef.projectId, actor: bound.actor, idempotencyKey: requestId };
    const identityKey = PLAN_PROPOSE_IDENTITY_PREFIX + commandIdentityKey(identity);
    const proposalId = initialPlanProposalIdFor({ projectId: answerRef.projectId, workspaceId, requestId });
    const ref: PlanProposalRef = { aggregateType: 'PlanProposal', projectId: answerRef.projectId,
      workspaceId, proposalId };
    const fingerprint = initialProposeFingerprint({ projectId: answerRef.projectId, workspaceId,
      actor: bound.actor, answerRef, reason: rawReason, requestId, expected });

    // R5b.4 §11.2: the original receipt is restored FIRST, before the answer body
    // or any current Goal/scope fact is required; a repeat never refreshes pins.
    const early = await records.lookupCommit({ identityKey, fingerprint });
    if (early.status === 'ready') {
      const restored = await restoreProposal(records, early.value, { identityKey,
        projectId: answerRef.projectId, workspaceId, proposalId, idempotencyKey: requestId, actor: bound.actor });
      if (restored.status !== 'restored') return rejected(restored.code, restored.reason);
      return { status: 'committed', value: restored.proposal, replayed: true, cursor: early.value.cursor };
    }
    if (early.code === 'idempotency_conflict') return rejected('idempotency_conflict', early.reason);
    if (early.code !== 'not_found') return rejected('unavailable', `${early.code}: ${early.reason}`);

    if (deps.materials === undefined || deps.initialPlanning === undefined) {
      return rejected('unsupported', 'the initial-plan answer consumption requires the injected materials and prepared-body stores');
    }
    const factsRead = await readInitialPlanAnswerFacts(ownedContext.value, answerRef);
    if (factsRead.status !== 'ready') {
      return asWriteRejection(factsRead, 'the initial-plan answer facts are not readable');
    }
    const facts = factsRead.value;
    const parsed = parseInitialPlanningResponseV2(facts.answerText);
    if (parsed.status === 'rejected') return parsed;
    const normalized = normalizeInitialPlanningResponseV2(parsed.response, facts);
    if (normalized.status === 'rejected') return normalized;
    if (normalized.status === 'needs_decision') {
      return { status: 'needs_decision', answerRef: { ...facts.answerRef },
        summary: normalized.summary, questions: normalized.questions };
    }
    const goalRef: GoalRef = { aggregateType: 'Goal', projectId: facts.job.job.intent.projectId,
      goalId: facts.job.job.intent.goalId as string };
    // The Answer/Job/Run revisions actually read join the SAME candidate commit CAS.
    const originGuards: RecordGuard[] = [
      { refKey: canonicalJson(facts.answerRef as unknown as JsonValue), expectedRevision: 1 },
      { refKey: canonicalJson(facts.job.ref as unknown as JsonValue), expectedRevision: facts.job.revision },
      { refKey: canonicalJson(facts.run.ref as unknown as JsonValue), expectedRevision: facts.run.revision },
    ];
    return commitHostPlanProposal({ goalRef, workspaceId, actor: bound.actor, identityKey, fingerprint,
      proposalId, ref, basedOn: null, draft: normalized.draft, reason: rawReason, requestId,
      expected, extraGuards: originGuards });
  }

  async function queryGoal(ctx: CoreCallContext, ref: GoalRef): Promise<ReadResult<GoalDetail>> {
    if (ctx?.signal?.aborted) return rejected('cancelled', 'queryGoal was cancelled');
    if (!isRecord(ref) || ref.aggregateType !== 'Goal' || !nonEmpty(ref.projectId) || !nonEmpty(ref.goalId)) {
      return rejected('invalid', 'queryGoal requires a full GoalRef');
    }
    const authority = authorizeReadContext(ctx, ref.projectId);
    if (authority.status !== 'ok') return authority;
    const read = await readGoal(records, ref);
    if (read.status !== 'ready') return asReadResult(read);
    const scopeError = authorizeGoal(authority.principal, read.goal);
    if (scopeError !== null) return scopeError;
    // `findPendingProposal` decodes the Goal in the same canonical batch as the
    // candidates and verifies the revision/active pointer this call read. It
    // returns that consistent Goal, so pendingPlan is never spliced onto a
    // fresher Goal than the one it was selected against.
    const pending = await findPendingProposal(records, ref, { revision: read.goal.revision,
      activePlanRevision: read.goal.activePlanRevision });
    if (pending.status !== 'ready') return asReadResult(pending);
    return { status: 'ready', value: { goal: pending.goal, pendingPlan: pending.proposal } };
  }

  async function readPlanProposal(ctx: CoreCallContext, ref: PlanProposalRef): Promise<ReadResult<PlanProposal>> {
    if (ctx?.signal?.aborted) return rejected('cancelled', 'readPlanProposal was cancelled');
    const validated = planProposalRefFromUnknown(ref);
    if (validated === null) return rejected('invalid', 'readPlanProposal requires a full PlanProposalRef');
    const authority = authorizeReadContext(ctx, validated.projectId);
    if (authority.status !== 'ok') return authority;
    const read = await readProposal(records, validated);
    if (read.status !== 'ready') return asReadResult(read);
    if (read.proposal.kind === 'candidate_v2') {
      const scopeError = authorizeProposal(authority.principal, read.proposal);
      if (scopeError !== null) return scopeError;
    } else if (authority.principal.kind === 'work_run') {
      if (read.proposal.goalRef.goalId !== authority.principal.runRef.goalId) return forbidden('the work run is not scoped to this proposal goal');
    } else if (authority.principal.kind === 'query_run') {
      if (read.proposal.ref.workspaceId !== authority.principal.queryRunRef.workspaceId) return forbidden('the query run is not scoped to this proposal workspace');
    } else if (authority.principal.workspaceId !== null && authority.principal.workspaceId !== read.proposal.ref.workspaceId) {
      return forbidden('the host context is scoped to another workspace');
    }
    return { status: 'ready', value: read.proposal };
  }

  async function queryTaskGraph(
    ctx: CoreCallContext,
    input: { goalRef: GoalRef; planRef?: PlanRevisionRef; atLeastCursor?: CommitCursor },
  ): Promise<ReadResult<TaskGraph>> {
    if (ctx?.signal?.aborted) return rejected('cancelled', 'queryTaskGraph was cancelled');
    if (!isRecord(input) || !isRecord(input.goalRef) || !nonEmpty(input.goalRef['projectId'])) {
      return rejected('invalid', 'queryTaskGraph requires a full GoalRef');
    }
    const goalRef = goalRefFromUnknown(input.goalRef, input.goalRef['projectId']);
    if (goalRef === null) return rejected('invalid', 'queryTaskGraph requires a full GoalRef');
    const authority = authorizeReadContext(ctx, goalRef.projectId);
    if (authority.status !== 'ok') return authority;
    const requested = input.planRef;
    let activePlan: PlanRevisionSnapshot;
    let windowWatermark: CommitCursor | null;
    let verifyActivePlan = false;
    if (requested === undefined) {
      // The active-plan window reads Goal then Plan and re-checks the pointer
      // when a newer commit was observed between the two reads.
      const window = await readGoalPlanWindow(records, goalRef);
      if (window.status !== 'ready') return asReadResult(window);
      const scopeError = authorizeGoal(authority.principal, window.goal);
      if (scopeError !== null) return scopeError;
      if (window.plan === null) return { status: 'not_found' };
      activePlan = window.plan;
      windowWatermark = window.readThrough;
      verifyActivePlan = true;
    } else {
      // An explicit PlanRef is an immutable historical/current read: the Goal is
      // only used for existence and scope, never to re-point the plan.
      if (requested.projectId !== goalRef.projectId) return forbidden('the plan belongs to another project');
      const goalRead = await readGoal(records, goalRef);
      if (goalRead.status !== 'ready') return asReadResult(goalRead);
      const scopeError = authorizeGoal(authority.principal, goalRead.goal);
      if (scopeError !== null) return scopeError;
      const planRead = await readPlan(records, requested);
      if (planRead.status !== 'ready') return asReadResult(planRead);
      activePlan = planRead.plan;
      windowWatermark = laterCursor(goalRead.readThrough, planRead.readThrough);
    }
    if (activePlan.goalRef.goalId !== goalRef.goalId) return { status: 'not_found' };
    const facts = await readCanonicalTaskFacts(records, goalRef, activePlan);
    if (facts.status !== 'ready') return asReadResult(facts);
    let watermark = facts.value.readThrough;
    if (verifyActivePlan && !sameCursor(windowWatermark, watermark)) {
      const confirmed = await confirmActivePlan(records, goalRef, activePlan.ref);
      if (confirmed.status !== 'ready') return asReadResult(confirmed);
      watermark = confirmed.readThrough ?? watermark;
    }
    // R3e.3: one precise GoalPhase point read after the authorization/Goal
    // existence checks. It is a lightweight immutable-snapshot projection: it
    // opens no material and reruns no completion permission/policy/evidence fold.
    const goalPhaseRef: GoalPhaseRef = { aggregateType: 'GoalPhase',
      projectId: goalRef.projectId, goalId: goalRef.goalId };
    const phaseRead = await readGoalPhase(records, goalPhaseRef);
    if (phaseRead.status !== 'ready') return asReadResult(phaseRead);
    if (!sameCursor(watermark, phaseRead.readThrough)) {
      if (verifyActivePlan) {
        const confirmed = await confirmActivePlan(records, goalRef, activePlan.ref);
        if (confirmed.status !== 'ready') return asReadResult(confirmed);
        watermark = confirmed.readThrough ?? watermark;
      }
      watermark = laterCursor(watermark, phaseRead.readThrough) ?? watermark;
    }
    if (input.atLeastCursor !== undefined) {
      const comparison = compareWatermark(watermark, input.atLeastCursor);
      if (comparison.status === 'not_ready') return comparison;
    }
    const phases = phasesOf(facts.value);
    const index = buildTaskRowIndex(activePlan);
    // The task graph always contains every task of the accepted Plan; Run /
    // Lease / Reduction only update each task's state.
    const tasks: TaskRow[] = [];
    for (const task of activePlan.tasks) {
      const row = taskRow(activePlan, goalRef.goalId, facts.value, phases, index, task.taskId);
      if (row !== null) tasks.push(row);
    }
    // A historical Plan never claims another Plan's completion: the selected
    // Plan ref is compared in full.
    const completion: GoalCompletionView = phaseRead.snapshot === null
      ? { status: 'not_recorded' }
      : { status: 'recorded', snapshot: phaseRead.snapshot,
        selectedPlanMatches: planRevisionRefKey(phaseRead.snapshot.planRef) === planRevisionRefKey(activePlan.ref) };
    return { status: 'ready', value: { plan: activePlan, tasks, sourceCursor: watermark,
      planning: goalPlanningView(activePlan, phases), completion } };
  }

  async function queryReadyTasks(
    ctx: CoreCallContext,
    input: { goalRef: GoalRef; roleIds?: string[]; includeBlocked: boolean; page: PlanPageRequest },
  ): Promise<ReadResult<TaskPage>> {
    if (ctx?.signal?.aborted) return rejected('cancelled', 'queryReadyTasks was cancelled');
    if (!isRecord(input) || !isRecord(input.goalRef) || !nonEmpty(input.goalRef['projectId'])) {
      return rejected('invalid', 'queryReadyTasks requires a full GoalRef');
    }
    const goalRef = goalRefFromUnknown(input.goalRef, input.goalRef['projectId']);
    if (goalRef === null) return rejected('invalid', 'queryReadyTasks requires a full GoalRef');
    if (typeof input.includeBlocked !== 'boolean') return rejected('invalid', 'includeBlocked must be a boolean');
    const page = input.page;
    if (!isRecord(page) || typeof page.limit !== 'number' || !Number.isInteger(page.limit)
      || page.limit < 1 || page.limit > MAX_READY_PAGE) {
      return rejected('invalid', `page.limit must be an integer between 1 and ${MAX_READY_PAGE}`);
    }
    const authority = authorizeReadContext(ctx, goalRef.projectId);
    if (authority.status !== 'ok') return authority;
    const window = await readGoalPlanWindow(records, goalRef);
    if (window.status !== 'ready') return asReadResult(window);
    const scopeError = authorizeGoal(authority.principal, window.goal);
    if (scopeError !== null) return scopeError;
    if (window.goal.activePlanRevision === null || window.plan === null) return { status: 'not_found' };
    const plan = window.plan;
    const facts = await readCanonicalTaskFacts(records, goalRef, plan);
    if (facts.status !== 'ready') return asReadResult(facts);
    let watermark = facts.value.readThrough;
    if (!sameCursor(window.readThrough, watermark)) {
      const confirmed = await confirmActivePlan(records, goalRef, plan.ref);
      if (confirmed.status !== 'ready') return asReadResult(confirmed);
      watermark = confirmed.readThrough ?? watermark;
    }
    if (page.atLeastCursor !== undefined) {
      const comparison = compareWatermark(watermark, page.atLeastCursor);
      if (comparison.status === 'not_ready') return comparison;
    }
    const workspaceId = window.goal.workspaceRef.workspaceId;
    const roleIds = input.roleIds ?? [];
    const roleFilter = new Set(roleIds);
    let after: string | null = null;
    if (page.cursor !== undefined) {
      const decoded = decodeReadyCursor(page.cursor);
      if (decoded.status !== 'ok') return rejected('invalid', decoded.reason);
      const cursor = decoded.cursor;
      if (cursor.principalKey !== authority.principal.key || cursor.projectId !== goalRef.projectId
        || cursor.workspaceId !== workspaceId || cursor.goalId !== goalRef.goalId
        || cursor.planRefKey !== planRevisionRefKey(plan.ref) || cursor.includeBlocked !== input.includeBlocked
        || !sameRoleFilter(cursor.roleIds, roleIds)) {
        return rejected('revision_conflict', 'the page cursor belongs to another principal, scope or filter');
      }
      if (cursor.waterline !== String(watermark)) {
        return { status: 'not_ready', observed: { kind: 'platform', cursor: watermark },
          required: cursor.waterline === null ? { kind: 'platform', cursor: makeCommitCursor(1) }
            : { kind: 'platform', cursor: cursor.waterline as CommitCursor } };
      }
      after = cursor.after;
    }
    const phases = phasesOf(facts.value);
    const index = buildTaskRowIndex(plan);
    const items: ReadyTask[] = [];
    let started = after === null;
    for (const task of plan.tasks) {
      if (!started) {
        if (task.taskId === after) started = true;
        continue;
      }
      if (task.taskKind !== 'work') continue;
      if (roleFilter.size > 0) {
        const assignment = (plan.assignments ?? []).find((entry) => entry.taskId === task.taskId);
        if (assignment === undefined || !roleFilter.has(assignment.role)) continue;
      }
      // Candidacy shares `evaluateEligibility`; there is no separate
      // predecessor-completion filter here.
      const row = taskRow(plan, goalRef.goalId, facts.value, phases, index, task.taskId);
      if (row === null) continue;
      if (!row.eligibility.eligible && !input.includeBlocked) continue;
      items.push({ task: row, planRef: plan.ref,
        expected: [{ ref: goalRef, revision: window.goal.revision }, { ref: plan.ref, revision: 1 }] });
    }
    const pageItems = items.slice(0, page.limit);
    const nextCursor = items.length > page.limit
      ? encodeReadyCursor({ v: 1, principalKey: authority.principal.key, projectId: goalRef.projectId,
        workspaceId, goalId: goalRef.goalId, planRefKey: planRevisionRefKey(plan.ref),
        includeBlocked: input.includeBlocked, roleIds: [...roleIds],
        after: pageItems[pageItems.length - 1]!.task.ref.taskId, waterline: String(watermark) })
      : null;
    return { status: 'ready', value: { items: pageItems, nextCursor, sourceCursor: watermark } };
  }

  async function readTaskInput(
    ctx: CoreCallContext,
    input: { goalRef: GoalRef; planRef: PlanRevisionRef; taskId: string; requirementId: string },
  ): Promise<ReadResult<import('../../../contracts/artifact.js').ArtifactRecord>> {
    if (ctx?.signal?.aborted) return rejected('cancelled', 'task input read was cancelled');
    const ownedInput = ownJsonInput(input, 'readTaskInput input');
    if (ownedInput.status === 'invalid') return rejected('invalid', ownedInput.reason);
    const body = ownedInput.value as unknown;
    if (!isRecord(body)) return rejected('invalid', 'readTaskInput requires an input object');
    // Identity/scope/signal are fixed here, synchronously, before any await.
    const ownedContext = ownCallContext(ctx);
    if (ownedContext.status === 'invalid') return rejected('invalid', ownedContext.reason);
    const bound = ownedContext.value;
    const rawGoalRef = body['goalRef'];
    if (!isRecord(rawGoalRef)) return rejected('invalid', 'readTaskInput requires a full GoalRef');
    const goalProjectId = rawGoalRef['projectId'];
    if (!nonEmpty(goalProjectId)) return rejected('invalid', 'readTaskInput requires a full GoalRef');
    const goalRef = goalRefFromUnknown(rawGoalRef, goalProjectId);
    if (goalRef === null) return rejected('invalid', 'readTaskInput requires a full GoalRef in this project');
    const rawPlanRef = body['planRef'];
    if (!isRecord(rawPlanRef)) return rejected('invalid', 'readTaskInput requires a full PlanRevisionRef');
    const planProjectId = rawPlanRef['projectId'];
    const planId = rawPlanRef['planId'];
    if (rawPlanRef['aggregateType'] !== 'PlanRevision' || !nonEmpty(planProjectId)
      || planProjectId !== goalRef.projectId || !nonEmpty(planId)) {
      return rejected('invalid', 'readTaskInput requires a full PlanRevisionRef in this project');
    }
    const planRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: goalRef.projectId, planId };
    const taskId = body['taskId'];
    const requirementId = body['requirementId'];
    if (!nonEmpty(taskId) || !nonEmpty(requirementId)) {
      return rejected('invalid', 'readTaskInput requires taskId and requirementId');
    }
    const authority = authorizeReadContext(bound, goalRef.projectId);
    if (authority.status !== 'ok') return authority;
    const goalRead = await readGoal(records, goalRef);
    if (bound.signal.aborted) return rejected('cancelled', 'task input read was cancelled');
    if (goalRead.status !== 'ready') return asReadResult(goalRead);
    const scopeError = authorizeGoal(authority.principal, goalRead.goal);
    if (scopeError !== null) return scopeError;
    const planRead = await readPlan(records, planRef);
    if (bound.signal.aborted) return rejected('cancelled', 'task input read was cancelled');
    if (planRead.status !== 'ready') return asReadResult(planRead);
    const plan = planRead.plan;
    // An explicit PlanRevision is an immutable pin: it must be the accepted
    // plan of the requested Goal. An unrelated Goal with the same local
    // requirementId is never an acceptable selection source.
    if (plan.ref.projectId !== goalRef.projectId || plan.goalRef.goalId !== goalRef.goalId) {
      return { status: 'not_found' };
    }
    const requirement = (plan.schemaVersion === 2 ? (plan.inputRequirements ?? []) : [])
      .find((candidate) => candidate.requirementId === requirementId
        && candidate.consumerTaskId === taskId);
    if (requirement === undefined) return { status: 'not_found' };
    if (deps.materials === undefined) {
      return rejected('unsupported', 'exact task input reading requires injected materials');
    }
    // The single material call uses the synchronously captured identity and the
    // ORIGINAL AbortSignal, never the live caller objects.
    return deps.materials.openArtifact(bound, { ref: requirement.artifactRef, usage: 'current' });
  }

  return { queryGoal, readPlanProposal, proposePlan, applyPlanChange, proposeInitialPlanFromAnswer,
    queryTaskGraph, queryReadyTasks, readTaskInput };
}

// --------------------------------------------------------------------------
// W2 delegated Agent admission seam (recognition only in this skeleton)
// --------------------------------------------------------------------------

/** True only for the formal work_run caller; Host/query-run keep the legacy path. */
function isWorkRunCaller(ctx: CoreCallContext): boolean {
  const principal = (ctx as unknown as { principal?: unknown } | null | undefined)?.principal;
  return isRecord(principal) && principal['kind'] === 'work_run';
}

/** Translate a non-ready admission read into the one write rejection shape. */
function asWriteRejection<T>(result: ReadResult<T>, fallback: string): Rejection {
  if (result.status === 'rejected') return rejected(result.code, result.reason);
  if (result.status === 'not_found') return rejected('not_found', fallback);
  return rejected('incomplete', fallback);
}

type GoalScopeFacts = Extract<Awaited<ReturnType<typeof readGoalScope>>, { status: 'ready' }>;

/**
 * The scope half shared by every plan-adoption caller: the caller pins must
 * describe the real proposal Goal, and the Goal/Project/Workspace revisions
 * actually read here become the local CAS basis. Both the Host and the Agent
 * path use this one implementation.
 */
async function validateProposalScope(
  records: GoalRecordTransactionPort & RecordLookupPort,
  proposalRef: PlanProposalRef,
  goalRef: GoalRef,
  expected: unknown,
): Promise<{ status: 'ready'; scope: GoalScopeFacts } | (Rejection & { current?: VersionPin[] })> {
  const pins = normalizeCallerPlanPins({ projectId: proposalRef.projectId, workspaceId: proposalRef.workspaceId,
    goalId: goalRef.goalId }, expected);
  if (pins.status === 'invalid') return rejected('invalid', pins.reason);
  const scope = await readGoalScope(records, goalRef);
  if (scope.status !== 'ready') return scope;
  if (scope.goal.workspaceRef.workspaceId !== proposalRef.workspaceId) {
    return forbidden('the goal does not belong to the proposal workspace');
  }
  const comparison = compareCallerPlanPins({ projectId: proposalRef.projectId, workspaceId: proposalRef.workspaceId,
    goalId: goalRef.goalId }, pins.pins, { projectRevision: scope.projectRevision,
    workspaceRevision: scope.workspaceRevision, goalRevision: scope.goal.revision });
  if (comparison.status === 'conflict') {
    return { status: 'rejected', code: 'revision_conflict',
      reason: 'the supplied version pins do not match the versions read in this call', current: comparison.current };
  }
  return { status: 'ready', scope };
}

/**
 * The ONE future-adoption orchestration shared by the Host and Agent apply
 * paths. It reads the real source, enforces the W1 future-only rules with the
 * existing validators, merges the caller's admission guards with the exact
 * local CAS guards, and performs the single `compileFuturePlanAdoption` commit.
 * Only the actor, command identity/fingerprint and admission guards differ; the
 * Host initial path and both propose paths are untouched.
 */
async function applyFutureRevision(input: {
  records: GoalRecordTransactionPort & RecordLookupPort;
  proposal: Extract<PlanProposal, { kind: 'candidate_v2' }>;
  proposalRef: PlanProposalRef;
  goalRef: GoalRef;
  goalScope: GoalScopeFacts;
  sourceRef: PlanRevisionRef;
  decisionRefs: readonly VersionPin[];
  identity: { projectId: string; actor: ActorRef; idempotencyKey: string };
  identityKey: string;
  fingerprint: string;
  requestId: string;
  extraGuards: readonly RecordGuard[];
  actor: ActorRef;
  preCommitSignal: AbortSignal | null;
  eventId: () => string;
  now: () => string;
}): Promise<WriteResult<PlanRevisionSnapshot>> {
  const { records, proposal, proposalRef, goalRef, goalScope, decisionRefs, actor } = input;
  if (proposal.draft.schemaVersion !== 2) {
    if ((decisionRefs as unknown[]).length === 0) {
      return rejected('incomplete', 'a plan change requires an accepted UserDecision; this slice does not accept raw full drafts');
    }
    return rejected('unsupported', 'authorized plan-change delta compilation is not implemented in this slice');
  }
  // W1 future-only revision. A non-empty decisionRefs is not a universal
  // authorization for this narrow branch.
  if ((decisionRefs as unknown[]).length > 0) {
    return rejected('unsupported', 'a W1 future-only revision does not accept decision references');
  }
  const sourceRead = await readPlan(records, input.sourceRef);
  if (sourceRead.status !== 'ready') return sourceRead;
  const source = sourceRead.plan;
  if (source.ref.projectId !== proposalRef.projectId || source.goalRef.goalId !== goalRef.goalId) {
    return rejected('not_found', 'the source plan does not belong to the proposal goal');
  }
  const active = goalScope.goal.activePlanRevision;
  if (active === null || planRevisionRefKey(active) !== planRevisionRefKey(source.ref)) {
    return { status: 'rejected', code: 'revision_conflict',
      reason: 'the source plan is not the Goal current active plan',
      current: [{ ref: source.ref, revision: source.revision }] };
  }
  if (proposal.draft.goalId !== goalRef.goalId) {
    return rejected('invalid', 'the draft goalId does not match the proposal goal');
  }
  if (proposal.draft.planRevision !== source.planRevision + 1) {
    return rejected('revision_conflict', 'the target planRevision must be exactly source+1');
  }
  if (proposal.draft.planId === source.planId) {
    return rejected('invalid', 'the target planId must be a new, unused reference');
  }
  const targetRef: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: proposalRef.projectId, planId: proposal.draft.planId };
  const targetRead = await readPlan(records, targetRef);
  if (targetRead.status === 'ready') {
    return { status: 'rejected', code: 'revision_conflict', reason: 'the target plan already exists',
      current: [{ ref: targetRef, revision: targetRead.plan.revision }] };
  }
  if (targetRead.status !== 'rejected' || targetRead.code !== 'not_found') return targetRead;

  // The intent/role/gate future-only rules run before the generic completeness
  // gate so an omitted source intent is `invalid`, not masked by `incomplete`.
  const deltaResult = deriveFuturePlanDelta(source, proposal.draft);
  if (deltaResult.status !== 'supported') return rejected('unsupported', deltaResult.reason);
  const delta = deltaResult.delta;
  const coverage = validateFutureObligationCoverage({ source, target: proposal.draft, delta });
  if (coverage.status === 'unsupported') return rejected('unsupported', coverage.reason);
  if (coverage.status === 'rejected') {
    return rejected('invalid',
      `the future plan is not admissible: ${coverage.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
  }

  // Only a genuinely NEW obligationId reads the SOURCE PLAN's exact pinned
  // policy (ref + digest); its local record guard joins this one commit. No new
  // obligation means NO policy read: existing commitments are protected
  // structurally. Propose keeps its opportunistic current-policy diagnosis.
  const sourceObligationIds = new Set(source.obligations.map((obligation) => obligation.obligationId));
  const hasNewObligation = proposal.draft.obligations
    .some((obligation) => !sourceObligationIds.has(obligation.obligationId));
  let pinnedPolicyContent: CompletionPolicyContentV1 | null = null;
  let pinnedPolicyGuards: readonly RecordGuard[] = [];
  if (hasNewObligation) {
    const pinned = await readPinnedCompletionPolicy(records, source.effectiveCompletionPolicy);
    if (pinned.status !== 'resolved') return rejected(pinned.code, pinned.reason);
    pinnedPolicyContent = pinned.policyContent;
    pinnedPolicyGuards = pinned.guards;
  }
  const issues = validatePlanDraft(proposal.draft, pinnedPolicyContent);
  if (issues.length > 0) return planAdmissionRejection('the future plan is not admissible', issues);
  const assignmentReasons = validatePlanAssignments(proposal.draft);
  if (assignmentReasons.length > 0) return rejected('incomplete', `the future plan is not admissible: ${assignmentReasons.join('; ')}`);
  const phaseReasons = planPhaseGuardReasons(proposal.draft.tasks);
  if (phaseReasons.length > 0) return rejected('incomplete', `the future plan is not admissible: ${phaseReasons.join('; ')}`);

  const touchedTaskIds = [...delta.changedTaskIds, ...delta.addedTaskIds];
  const futureFacts = await readFutureChangeTaskFacts(records, goalRef, source, touchedTaskIds);
  if (futureFacts.status !== 'ready') return futureFacts;

  const merged = mergePlanGuards([
    ...input.extraGuards,
    ...pinnedPolicyGuards,
    { refKey: goalScope.projectKey, expectedRevision: goalScope.projectRevision },
    { refKey: goalScope.workspaceKey, expectedRevision: goalScope.workspaceRevision },
    { refKey: refKeyOf(goalRef), expectedRevision: goalScope.goal.revision },
    { refKey: planProposalRefKey(proposalRef), expectedRevision: proposal.revision },
    { refKey: planRevisionRefKey(source.ref), expectedRevision: source.revision },
    ...futureFacts.value.guards,
  ]);
  if (!merged.ok) return merged.rejection;
  if (input.preCommitSignal !== null && input.preCommitSignal.aborted) {
    return rejected('cancelled', 'the plan adoption was cancelled before commit');
  }
  const derived = deriveCommandIds(input.identity, 'plan-apply');
  const compiled = compileFuturePlanAdoption({
    goal: goalScope.goal,
    source,
    candidate: proposal,
    target: proposal.draft,
    changedTaskIds: delta.changedTaskIds,
    addedTaskIds: delta.addedTaskIds,
    priorGuards: merged.guards,
    identityKey: input.identityKey,
    fingerprint: input.fingerprint,
    eventId: input.eventId(),
    occurredAt: input.now(),
    commandId: derived.commandId,
    correlationId: derived.correlationId,
    idempotencyKey: input.requestId,
    actor,
  });
  if (compiled.status !== 'compiled') return rejected('unsupported', compiled.reason);
  const committed = await records.commit(compiled.value.prepared);
  if (committed.status !== 'committed') return mapCommitFailure(committed);
  if (!committed.replayed) {
    return { status: 'committed', value: compiled.value.snapshot, replayed: false, cursor: committed.cursor };
  }
  const restored = await restoreAcceptedPlan(records, committed, { identityKey: input.identityKey,
    projectId: proposalRef.projectId, workspaceId: proposalRef.workspaceId,
    idempotencyKey: input.requestId, actor });
  if (restored.status !== 'restored') return rejected(restored.code, restored.reason);
  return { status: 'committed', value: restored.value, replayed: true, cursor: committed.cursor };
}

/** Canonicalize the caller's full expected pins for the Agent fingerprint. */
function orderedPlanPins(expected: unknown): Array<{ ref: unknown; revision: number }> {
  const entries: Array<{ ref: unknown; revision: number }> = [];
  if (Array.isArray(expected)) {
    for (const entry of expected as unknown[]) {
      if (isRecord(entry)) entries.push({ ref: entry['ref'], revision: entry['revision'] as number });
    }
  }
  entries.sort((a, b) => {
    const left = canonicalJson(a.ref as JsonValue);
    const right = canonicalJson(b.ref as JsonValue);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return entries;
}
function agentCommandFingerprint(commandType: string, payload: Record<string, unknown>): string {
  return sha256Hex(canonicalJson({ schemaVersion: 1, commandType, agent: true, ...payload } as unknown as JsonValue));
}
function agentProposalIdFor(input: { operation: PlanWriteOperation; projectId: string; workspaceId: string;
  goalRef: GoalRef; actor: AgentPlanWriter['actor']; sessionRef: SessionRef; requestId: string }): string {
  return PLAN_PROPOSAL_ID_PREFIX + sha256Hex(canonicalJson(input as unknown as JsonValue)).slice(0, 32);
}
function mergePlanGuards(guards: readonly RecordGuard[]):
  { ok: true; guards: RecordGuard[] } | { ok: false; rejection: Rejection } {
  const merged = mergeGuards(guards);
  if (!merged.ok) return { ok: false, rejection: rejected(merged.rejection.code, merged.rejection.reason) };
  return { ok: true, guards: merged.guards };
}

/** Exact Agent-proposal receipt re-read for the concurrent-commit window. */
async function recheckAgentProposal(
  records: GoalRecordTransactionPort & RecordLookupPort,
  expected: { identityKey: string; fingerprint: string; projectId: string; workspaceId: string;
    proposalId: string; idempotencyKey: string; actor: ActorRef },
): Promise<WriteResult<PlanProposal> | null> {
  const receipt = await records.lookupCommit({ identityKey: expected.identityKey, fingerprint: expected.fingerprint });
  if (receipt.status === 'ready') {
    const restored = await restoreProposal(records, receipt.value, expected);
    if (restored.status !== 'restored') return rejected(restored.code, restored.reason);
    return { status: 'committed', value: restored.proposal, replayed: true, cursor: receipt.value.cursor };
  }
  if (receipt.code === 'idempotency_conflict') return rejected('idempotency_conflict', receipt.reason);
  return null;
}

/** Exact Agent-Plan receipt re-read for the concurrent-commit window. */
async function recheckAgentApply(
  records: GoalRecordTransactionPort & RecordLookupPort,
  expected: { identityKey: string; fingerprint: string; projectId: string; workspaceId: string;
    idempotencyKey: string; actor: ActorRef },
): Promise<WriteResult<PlanRevisionSnapshot> | null> {
  const receipt = await records.lookupCommit({ identityKey: expected.identityKey, fingerprint: expected.fingerprint });
  if (receipt.status === 'ready') {
    const restored = await restoreAcceptedPlan(records, receipt.value, expected);
    if (restored.status !== 'restored') return rejected(restored.code, restored.reason);
    return { status: 'committed', value: restored.value, replayed: true, cursor: receipt.value.cursor };
  }
  if (receipt.code === 'idempotency_conflict') return rejected('idempotency_conflict', receipt.reason);
  return null;
}

/**
 * W2 Agent proposal path. Order is fixed: stable identify -> original
 * identity/fingerprint receipt lookup -> fresh authorize -> the SAME W1
 * validation/compile/commit. The Host path above is untouched. A fresh failure
 * re-reads the same-identity receipt so a concurrent winner that committed
 * before a later revoke is replayed instead of re-acted.
 */
async function proposePlanAsAgent(
  deps: PlanServiceDependencies,
  records: GoalRecordTransactionPort & RecordLookupPort,
  ctx: CoreCallContext,
  input: { goalRef: GoalRef; basedOn: PlanRevisionRef | null; draft: PlanRevisionDraft;
    reason: unknown; requestId: string; expected: unknown; workspaceId: string },
): Promise<WriteResult<PlanProposal>> {
  const delegated = deps.delegatedWrites;
  if (delegated === undefined) {
    return forbidden('plan writes require the W2 delegatedWrites dependency for a work-run caller');
  }
  const scope = { projectId: input.goalRef.projectId, workspaceId: input.workspaceId };
  const identified = await identifyPlanWriter(delegated, ctx, scope);
  if (identified.status !== 'ready') return asWriteRejection(identified, 'the Agent plan writer could not be identified');
  const writer = identified.value;
  if (!sameRef(writer.goalRef, input.goalRef)) return forbidden('the Agent Run is not scoped to this goal');
  if (writer.workspaceId !== input.workspaceId) return forbidden('the Agent Run is not scoped to this workspace');

  const pins = normalizeCallerPlanPins({ projectId: scope.projectId, workspaceId: scope.workspaceId,
    goalId: input.goalRef.goalId }, input.expected);
  if (pins.status === 'invalid') return rejected('invalid', pins.reason);
  const expected = orderedPlanPins(input.expected);
  const identity = { projectId: scope.projectId, actor: writer.actor, idempotencyKey: input.requestId };
  const identityKey = PLAN_PROPOSE_IDENTITY_PREFIX + commandIdentityKey(identity);
  const proposalId = agentProposalIdFor({ operation: 'propose_future_plan', projectId: scope.projectId,
    workspaceId: input.workspaceId, goalRef: input.goalRef, actor: writer.actor,
    sessionRef: writer.sessionRef, requestId: input.requestId });
  const ref: PlanProposalRef = { aggregateType: 'PlanProposal', projectId: scope.projectId,
    workspaceId: input.workspaceId, proposalId };
  const fingerprint = agentCommandFingerprint('PlanProposeAgent', {
    projectId: scope.projectId, workspaceId: input.workspaceId, goalRef: input.goalRef,
    basedOn: input.basedOn, draft: input.draft, reason: input.reason, expected });
  const receiptExpected = { identityKey, fingerprint, projectId: scope.projectId,
    workspaceId: input.workspaceId, proposalId, idempotencyKey: input.requestId, actor: writer.actor };

  const early = await records.lookupCommit({ identityKey, fingerprint });
  if (early.status === 'ready') {
    const restored = await restoreProposal(records, early.value, receiptExpected);
    if (restored.status !== 'restored') return rejected(restored.code, restored.reason);
    return { status: 'committed', value: restored.proposal, replayed: true, cursor: early.value.cursor };
  }
  if (early.code === 'idempotency_conflict') return rejected('idempotency_conflict', early.reason);
  if (early.code !== 'not_found') return rejected('unavailable', `${early.code}: ${early.reason}`);

  const authorized = await authorizePlanWrite(delegated, ctx, { writer, operation: 'propose_future_plan' });
  if (authorized.status !== 'ready') {
    const concurrent = await recheckAgentProposal(records, receiptExpected);
    if (concurrent !== null) return concurrent;
    return asWriteRejection(authorized, 'the Agent plan write is not authorized');
  }
  const admission = authorized.value;

  const evaluate = async (): Promise<WriteResult<PlanProposal>> => {
    const goalScope = await readGoalScope(records, input.goalRef);
    if (goalScope.status !== 'ready') return goalScope;
    if (goalScope.goal.workspaceRef.workspaceId !== input.workspaceId) {
      return forbidden('the goal does not belong to the requested workspace');
    }
    const comparison = compareCallerPlanPins({ projectId: scope.projectId, workspaceId: input.workspaceId,
      goalId: input.goalRef.goalId }, pins.pins, { projectRevision: goalScope.projectRevision,
      workspaceRevision: goalScope.workspaceRevision, goalRevision: goalScope.goal.revision });
    if (comparison.status === 'conflict') {
      return { status: 'rejected', code: 'revision_conflict',
        reason: 'the supplied version pins do not match the versions read in this call', current: comparison.current };
    }
    // Agent scope: a proposal is a future revision of a REAL accepted source
    // that is still the Goal active plan. The proposal keeps its diagnostic
    // issues; the full execution rules stay in apply.
    if (input.draft.schemaVersion !== 2) {
      return rejected('unsupported', 'an Agent proposal requires a schemaVersion 2 future draft');
    }
    if (input.basedOn === null) {
      return forbidden('an Agent proposal must be based on an accepted source plan');
    }
    const sourceRead = await readPlan(records, input.basedOn);
    if (sourceRead.status !== 'ready') return sourceRead;
    const source = sourceRead.plan;
    if (source.ref.projectId !== scope.projectId || source.goalRef.goalId !== input.goalRef.goalId) {
      return rejected('not_found', 'the source plan does not belong to the proposal goal');
    }
    const active = goalScope.goal.activePlanRevision;
    if (active === null || planRevisionRefKey(active) !== planRevisionRefKey(source.ref)) {
      return { status: 'rejected', code: 'revision_conflict',
        reason: 'the source plan is not the Goal current active plan',
        current: [{ ref: source.ref, revision: source.revision }] };
    }
    const policyRead = await tryPolicyContent(records, input.goalRef.projectId);
    const issues = validatePlanDraft(input.draft, policyRead.policy);
    const candidate: Extract<PlanProposal, { kind: 'candidate_v2' }> = {
      kind: 'candidate_v2', ref, revision: 1, schemaVersion: 2, goalRef: input.goalRef,
      basedOn: input.basedOn, draft: input.draft, reason: input.reason as unknown as PlanChangeReason,
      status: 'candidate', issues, submittedBy: admission.provenance };
    const derived = deriveCommandIds(identity, 'plan-propose-agent');
    const event: PlanProposalRecordedEvent = {
      eventId: deps.eventId(), eventType: 'PlanProposalRecorded', schemaVersion: 2,
      projectId: scope.projectId, workspaceId: input.workspaceId, aggregateType: 'PlanProposal',
      aggregateId: proposalId, aggregateRevision: 1, causationId: derived.commandId,
      correlationId: derived.correlationId, idempotencyKey: input.requestId, actor: writer.actor,
      occurredAt: deps.now(), payload: { proposal: candidate } };
    const merged = mergePlanGuards([
      ...admission.guards,
      { refKey: goalScope.projectKey, expectedRevision: goalScope.projectRevision },
      { refKey: goalScope.workspaceKey, expectedRevision: goalScope.workspaceRevision },
      { refKey: refKeyOf(input.goalRef), expectedRevision: goalScope.goal.revision },
      { refKey: planRevisionRefKey(source.ref), expectedRevision: source.revision },
      { refKey: planProposalRefKey(ref), expectedRevision: null },
    ]);
    if (!merged.ok) return merged.rejection;
    if (ctx.signal.aborted) return rejected('cancelled', 'the Agent plan proposal was cancelled before commit');
    const committed = await records.commit({ identityKey, fingerprint, guards: merged.guards,
      records: [encodePlanProposal(candidate)], claims: [], indexGuards: [], indexChanges: [],
      events: [encodePlanProposalRecordedEvent(event)] });
    if (committed.status !== 'committed') return mapCommitFailure(committed);
    if (!committed.replayed) return { status: 'committed', value: candidate, replayed: false, cursor: committed.cursor };
    const restored = await restoreProposal(records, committed, receiptExpected);
    if (restored.status !== 'restored') return rejected(restored.code, restored.reason);
    return { status: 'committed', value: restored.proposal, replayed: true, cursor: committed.cursor };
  };

  const outcome = await evaluate();
  if (outcome.status === 'rejected') {
    const concurrent = await recheckAgentProposal(records, receiptExpected);
    if (concurrent !== null) return concurrent;
  }
  return outcome;
}

/**
 * W2 Agent apply path. The original command author is recovered from the
 * receipt/event identity, never inferred from the current candidate. The
 * candidate must carry this exact Run/Session/Role source; the same W1 future
 * compile/commit runs with the Agent actor and the admitted local guards.
 */
async function applyPlanChangeAsAgent(
  deps: PlanServiceDependencies,
  records: GoalRecordTransactionPort & RecordLookupPort,
  ctx: CoreCallContext,
  input: { proposalRef: PlanProposalRef; expectedProposalRevision: number; decisionRefs: unknown;
    requestId: string; expected: unknown },
): Promise<WriteResult<PlanRevisionSnapshot>> {
  const delegated = deps.delegatedWrites;
  if (delegated === undefined) {
    return forbidden('plan writes require the W2 delegatedWrites dependency for a work-run caller');
  }
  const scope = { projectId: input.proposalRef.projectId, workspaceId: input.proposalRef.workspaceId };
  const identified = await identifyPlanWriter(delegated, ctx, scope);
  if (identified.status !== 'ready') return asWriteRejection(identified, 'the Agent plan writer could not be identified');
  const writer = identified.value;
  if ((input.decisionRefs as unknown[]).length > 0) {
    return forbidden('an Agent future-plan apply does not accept decision references');
  }
  const pins = normalizeCallerPlanPins(scope, input.expected);
  if (pins.status === 'invalid') return rejected('invalid', pins.reason);
  const expected = orderedPlanPins(input.expected);
  const identity = { projectId: scope.projectId, actor: writer.actor, idempotencyKey: input.requestId };
  const identityKey = PLAN_APPLY_IDENTITY_PREFIX + commandIdentityKey(identity);
  const fingerprint = agentCommandFingerprint('PlanApplyAgent', {
    projectId: scope.projectId, workspaceId: scope.workspaceId, proposalRef: input.proposalRef,
    expectedProposalRevision: input.expectedProposalRevision, decisionRefs: input.decisionRefs, expected });
  const receiptExpected = { identityKey, fingerprint, projectId: scope.projectId,
    workspaceId: scope.workspaceId, idempotencyKey: input.requestId, actor: writer.actor };

  const early = await records.lookupCommit({ identityKey, fingerprint });
  if (early.status === 'ready') {
    const restored = await restoreAcceptedPlan(records, early.value, receiptExpected);
    if (restored.status !== 'restored') return rejected(restored.code, restored.reason);
    return { status: 'committed', value: restored.value, replayed: true, cursor: early.value.cursor };
  }
  if (early.code === 'idempotency_conflict') return rejected('idempotency_conflict', early.reason);
  if (early.code !== 'not_found') return rejected('unavailable', `${early.code}: ${early.reason}`);

  const authorized = await authorizePlanWrite(delegated, ctx, { writer, operation: 'apply_future_plan' });
  if (authorized.status !== 'ready') {
    const concurrent = await recheckAgentApply(records, receiptExpected);
    if (concurrent !== null) return concurrent;
    return asWriteRejection(authorized, 'the Agent plan write is not authorized');
  }
  const admission = authorized.value;

  const evaluate = async (): Promise<WriteResult<PlanRevisionSnapshot>> => {
    const proposalRead = await readProposal(records, input.proposalRef);
    if (proposalRead.status !== 'ready') return proposalRead;
    const proposal = proposalRead.proposal;
    if (proposal.kind !== 'candidate_v2') return rejected('unsupported', 'a legacy v1 patch proposal cannot be adopted by an Agent');
    if (proposal.status !== 'candidate') return rejected('invalid', `proposal ${input.proposalRef.proposalId} is not a pending candidate`);
    if (proposal.revision !== input.expectedProposalRevision) {
      return { status: 'rejected', code: 'revision_conflict', reason: 'the proposal revision changed',
        current: [{ ref: input.proposalRef, revision: proposal.revision }] };
    }
    const submittedBy = proposal.submittedBy;
    if (submittedBy === undefined) {
      return forbidden('a candidate without an Agent submission source cannot be adopted by an Agent');
    }
    if (!sameRef(submittedBy.runRef, writer.runRef) || !sameRef(submittedBy.sessionRef, writer.sessionRef)
      || !sameRef(submittedBy.roleBinding, writer.roleBinding)) {
      return forbidden('the candidate was submitted by another Agent Run');
    }
    const goalRef = proposal.goalRef;
    if (goalRef.projectId !== scope.projectId || goalRef.goalId !== writer.goalRef.goalId) {
      return forbidden('the candidate goal is not the Agent Run goal');
    }
    if (proposal.basedOn === null) return forbidden('an Agent apply requires a future revision with a source plan');
    const scoped = await validateProposalScope(records, input.proposalRef, goalRef, input.expected);
    if (scoped.status !== 'ready') return scoped;
    return applyFutureRevision({
      records, proposal, proposalRef: input.proposalRef, goalRef, goalScope: scoped.scope,
      sourceRef: proposal.basedOn,
      decisionRefs: input.decisionRefs as readonly VersionPin[],
      identity, identityKey, fingerprint, requestId: input.requestId,
      extraGuards: admission.guards, actor: writer.actor, preCommitSignal: ctx.signal,
      eventId: deps.eventId, now: deps.now,
    });
  };

  const outcome = await evaluate();
  if (outcome.status === 'rejected') {
    const concurrent = await recheckAgentApply(records, receiptExpected);
    if (concurrent !== null) return concurrent;
  }
  return outcome;
}

// --------------------------------------------------------------------------
// Write entry binding (Host only)
// --------------------------------------------------------------------------

function boundWriteActor(
  ctx: CoreCallContext,
  projectId: string,
  workspaceId: string,
): { status: 'ok'; actor: ActorRef; aborted: boolean } | { status: 'rejected'; code: CoreError; reason: string } {
  const bound = ctx as unknown as {
    projectId?: unknown; workspaceId?: unknown;
    principal?: { kind?: unknown; actor?: unknown }; signal?: AbortSignal;
  } | null | undefined;
  if (bound === null || bound === undefined) return { status: 'rejected', code: 'forbidden', reason: 'a bound call context is required' };
  if (bound.projectId !== projectId || bound.workspaceId !== workspaceId) {
    return { status: 'rejected', code: 'forbidden', reason: 'the call context does not match the requested workspace scope' };
  }
  if (bound.principal?.kind !== 'host') {
    return { status: 'rejected', code: 'forbidden', reason: 'plan writes require a trusted Host call context in this batch' };
  }
  return { status: 'ok', actor: cloneActorRef(bound.principal.actor as ActorRef), aborted: bound.signal?.aborted === true };
}
