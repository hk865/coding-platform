/**
 * R3c Plan task service — the WorkGraph owner of Goal plan adoption and task reads.
 *
 * This file only coordinates: it binds the caller, delegates canonical reads and
 * task facts to `plan-readers.ts`, pure admission to `plan-validation.ts` and the
 * one atomic fold to `plan-commit-compiler.ts`. It starts no transaction of its
 * own and never re-implements those rules.
 *
 * Every lifecycle write (Host/answer proposal, Agent proposal, initial and
 * future adoption) is decided by the state machines
 * (STATE-MACHINES-SPEC §3 `state/plan-machine.ts`, §2 GOAL-02/03
 * `state/goal-machine.ts`): receipt lookup first; after each read the owner asks
 * `planProposalProblem` with the facts read so far, so a refusal stops the
 * reads where it always stopped; `transitionPlanProposal` then gives the
 * candidate / accepted proposal (§14.1) and the CAS guards of the one commit,
 * and `transitionGoal` the moved Goal pointer.
 *
 * A v2 candidate carries a full draft, not the legacy restricted delta/target
 * digest; the initial and future-only adoption paths judge that same draft.
 */
import type { AdoptedArchitecture, ArchitectureCatalogPinV1 } from '../../../contracts/architecture-catalog.js';
import type { ActorRef, CommitCursor } from '../../../contracts/command-event.js';
import { commandIdentityKey } from '../../../contracts/command-event.js';
import type { CoreCallContext, CorePrincipal } from '../../../contracts/core/call-context.js';
import type { SessionRef, VersionPin } from '../../../contracts/core/identity.js';
import type { SessionMessageRef } from '../../../contracts/core/session-message.js';
import { isRecord, nonEmpty } from '../../../contracts/validation/common.js';
import type {
  DecisionActionV1,
  DecisionChangeProofV1,
  DecisionSourceV1,
  GoalControlRebaseV1,
} from '../../../contracts/goal-decisions.js';
import type { CoreError, CoreRejection, ReadResult, ReadStamp, WriteResult } from '../../../contracts/core/results.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { RunRef, RunSnapshot } from '../../../contracts/dispatch.js';
import { canonicalJson, sameJson, sha256Hex, type JsonValue } from '../../../contracts/fingerprint.js';
import { messageOf } from '../../../contracts/error-message.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import { makeCommitCursor, seqOfCommitCursor } from '../../../contracts/ledger.js';
import type { CompletionPolicyContentV1 } from '../../../contracts/governance.js';
import type { Phase, PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot,
  RuntimeTask, TaskInputRequirementV2, TaskRelationV2 } from '../../../contracts/plan.js';
import {
  DEFAULT_TASK_AUTOMATION_POLICY, isAutomationActor, reworkActorClassOf, type ReworkActorClass,
  type TaskAutomationPolicyV1,
} from '../../../contracts/task-requeue.js';
import type { ControlIntentSnapshotV1 } from '../../../contracts/control-intent.js';
import type { GoalDesiredState } from '../../../contracts/ledger.js';
import type { TrustedCheckConfiguration } from '../../../contracts/verification.js';
import type { ToolCommitLookupInput, ToolCommitLookupResult } from '../../../contracts/unknown-call-review.js';
import {
  agentActorOf, toolCommitLookupResult, toolCommitLookupUnknownTool, toolCommitRequestId,
} from '../model/tool-commit-arguments.js';
import {
  automationVerdict, buildTaskFailureFacts,
  type GateFailureInputV1, type WorkFailureInputV1,
} from '../state/task-failure.js';
import { gateCoveredTaskIds, gateFixInProgress } from '../state/decision-policy.js';
import type { GoalPhaseRef } from '../../../contracts/goal-phase.js';
import type {
  QueryJobAnswerRef,
  QueryJobRef,
  QueryRunRef,
} from '../../../contracts/query-job.js';
import type { RecordLookupPort } from '../../record-store/lookup-ports.js';
import type { RawArtifactStorePort } from '../../record-store/body-ports.js';
import type { MaterialPort } from '../model/material-contracts.js';
import type {
  GoalRecordTransactionPort,
  RecordGuard,
  StoreCommitReceipt,
  StoreFailure,
  UniqueClaimChange,
} from '../../record-store/ports.js';
import { catalogPinOf, readCurrentCatalogWindow, readRevisionByRef } from '../architecture/catalog-service.js';
import { cloneActorRef } from '../persistence/record-codecs.js';
import { goalRefFor, projectRefFor, workspaceRefFor } from '../persistence/commit-compiler.js';
import { evaluateEligibility } from './eligibility.js';
import type {
  GoalCompletionView,
  GoalDetail,
  GoalDisplayQuery,
  GoalDisplayRead,
  GoalLiveRunsRead, GoalResumeContinuationsRead,
  GoalResumePendingRunV1,
  GoalPlanningDiagnostic,
  GoalPlanningView,
  PlanChangeReason,
  PlanPageRequest,
  InitialPlanProposalResult,
  PlanProposal,
  PlanProposalRef,
  PlanServicePort,
  ProposedPlanRequestV1,
  ReadyTask,
  TaskGraph,
  TaskPage,
  TaskPlanningDiagnostic,
  TaskRow,
} from '../model/plan-contracts.js';
import type { RequestCandidatePort } from '../model/decision-contracts.js';
import type { GraphWrite } from '../model/task-contracts.js';
import {
  compileFuturePlanAdoption, compileInitialPlanAdoption, type PlanAcceptanceDecisionProofV1,
  type PlanAdoptionCommit, type PlanRequestSlotChangeV1, type PlanRevisionWrite,
} from './plan-commit-compiler.js';
import {
  normalizeInitialPlanningResponseV2,
  parseInitialPlanningResponseV2,
} from './initial-plan.js';
import { createInitialPlanAnswerReader } from './initial-plan-answer.js';
import {
  decodePlanProposalRecordedEvent,
  decodePlanRevisionAcceptedEvent,
  encodePlanProposal,
  encodePlanProposalRecordedEvent,
  planProposalRefKey,
  planRevisionRefKey,
  type NoticeOriginWireV1,
  type PlanProposalRecordedEvent,
} from '../persistence/plan-record-codecs.js';
import { decodeSessionMessageRecord, sessionMessageRefKey } from '../sessions/message-record-codecs.js';
import {
  confirmActivePlan,
  findPendingProposal,
  readCanonicalTaskFacts,
  readGoal,
  readGoalPlanWindow,
  readGoalPhase,
  readDispositionChangeTaskFacts,
  readFutureChangeTaskFacts,
  readGoalScope,
  laterCursor,
  readPinnedCompletionPolicy,
  readPlan,
  readPointerIntents,
  readProposal,
  readProposalOrigin,
  readRequestCandidateHead,
  candidateRequestRef,
  resolveGovernance,
  sameCursor,
  taskRecordRefKey,
  tryPolicyContent,
  type CanonicalTaskFacts,
  type CanonicalTaskState,
  type DispositionChangeTaskFacts,
} from './plan-readers.js';
import { asWriteRejection, mapStoreReadFailure, type Owned, type Rejection } from './plan-result-helpers.js';
import {
  deriveFuturePlanDelta,
  planPhaseGuardReasons,
  type FuturePlanDelta,
  unknownModuleRejection,
  unknownModuleTasksOf,
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
import { mergeGuards } from './execution-entry-service.js';
import {
  GOAL_FAN_OUT_ACTOR, findGoalResumeContinuations, goalFanOutRequestId, goalStateOf, reduceGoalDisplay, transitionGoal,
  type GoalDisplayTaskFactsV1, type GoalRunControlCapabilityV1, type GoalRunStopInputV1,
} from '../state/goal-machine.js';
import { notEnteredEntryPhase } from '../state/control-intent-machine.js';
import { runControlNodeOf } from '../state/run-machine.js';
import { controlIntentRefFor } from './control-service.js';
import {
  derivePlanProposalReadVerdict, derivePlanRevisionStatus, draftHasModuleTask, parallelCarrierFactTaskIds, planProposalProblem,
  planRevisionTargetOf, transitionPlanProposal,
  type CandidatePlanProposal, type FutureAdoptionFacts, type FuturePlanDeltaVerdict, type InitialAdoptionFacts,
  type PlanCarrierViewV1, type PlanCommitGuard, type PlanProposalEffect, type PlanProposalEvent,
  type PlanProposalGuardContext, type PlanProposalReadFacts, type PlanProposalTransition,
  type PlanRequestCandidateFacts, type PlannedDispositionChangeV1, type PlanSourceFacts, type TracedTaskFactsV1,
} from '../state/plan-machine.js';
import { goalDecisionBasisMatches } from '../state/goal-settings-machine.js';
import { decisionActionPolicy } from '../state/decision-policy.js';
import { createCandidateRequestFactsReader } from './request-facts.js';
import { taskMachineStateOf, transitionTask, type TaskPhaseFacts } from '../state/task-machine.js';
import type { Rejected as MachineRefusal } from '../state/transition.js';

export type PlanServiceDependencies = { records: GoalRecordTransactionPort & RecordLookupPort;
  materials?: Pick<MaterialPort, 'openArtifact'>;
  /** R5b.4 §11.4: the SAME raw body store the composition root already holds.
   * It only reads the QueryRun's own prepared manifest body. Absence makes only
   * the new model-origin consumption explicitly unavailable; every old Plan
   * path keeps its exact I/O. */
  initialPlanning?: { bodies: Pick<RawArtifactStorePort, 'read'> };
  /** W2: optional delegated Agent admission. Absent keeps the original Host-only behavior. */
  delegatedWrites?: PlanDelegatedWriteDependencies;
  /**
   * C8: the automatic-rework policy the failure facts report (`cap`); absent is
   * `DEFAULT_TASK_AUTOMATION_POLICY` (Host settings wire it in step 5.6).
   */
  automationPolicy?(): TaskAutomationPolicyV1;
  /**
   * LA-4 (A.2 step 5.9): the current trusted check configuration of a
   * workspace (the evidence owner's `configurationFor`); a reverify refusal
   * that stored a configuration revision is stale once it differs. Absent (or
   * no configuration) reads as an unknown revision, which never makes one stale.
   */
  configurationFor?(scope: { projectId: string; workspaceId: string }): Pick<TrustedCheckConfiguration, 'configurationRevision'> | undefined;
  /**
   * Slice 5 §3.2: the exact configured operator a request-candidate
   * adoption/abandon is compared against. Absent leaves the frozen fixtures
   * (whose trusted Host context binds the operator) working; a configured value
   * must match the trusted Host actor exactly and never be a platform
   * automation actor.
   */
  operatorActor?: Extract<ActorRef, { kind: 'human' | 'system' }>;
  now(): string; eventId(): string };

const PLAN_PROPOSE_IDENTITY_PREFIX = 'plan-propose:';
const PLAN_APPLY_IDENTITY_PREFIX = 'plan-apply:';
const PLAN_ABANDON_IDENTITY_PREFIX = 'plan-abandon:';
const PLAN_PROPOSAL_ID_PREFIX = 'plan-proposal-';
const MAX_READY_PAGE = 200;

// --------------------------------------------------------------------------
// Input isolation and small value helpers
// --------------------------------------------------------------------------

function ownJsonInput<T>(value: T, what: string): Owned<T> {
  try {
    const cloned = structuredClone(value);
    return { status: 'owned', value: JSON.parse(JSON.stringify(cloned)) as T };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: 'invalid', reason: `${what} cannot be isolated from the caller: ${detail}` };
  }
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
function forbidden(reason: string): Rejection {
  return rejected('forbidden', reason);
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
function sessionMessageRefFromUnknown(value: unknown): SessionMessageRef | null {
  if (!isRecord(value)) return null;
  if (value['aggregateType'] !== 'SessionMessage' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['workspaceId']) || !nonEmpty(value['messageId'])) return null;
  return { aggregateType: 'SessionMessage', projectId: value['projectId'],
    workspaceId: value['workspaceId'], messageId: value['messageId'] };
}
const DECISION_SOURCE_KINDS: readonly DecisionSourceV1['kind'][] = ['message', 'goal_cause', 'candidate', 'note_review',
  'planning_question', 'goal_conflict', 'message_release'];
function decisionSourceFromUnknown(value: unknown): DecisionSourceV1 | null {
  if (!isRecord(value)) return null;
  if (typeof value['kind'] !== 'string'
    || !(DECISION_SOURCE_KINDS as readonly string[]).includes(value['kind'])) return null;
  if (!nonEmpty(value['key'])) return null;
  // §3.7 item 5: only a goal subject is accepted here; a project or missing
  // subject is the caller's existing `null` refusal.
  const subject = value['subject'];
  if (!isRecord(subject) || subject['kind'] !== 'goal') return null;
  const goalRef = subject['goalRef'];
  if (!isRecord(goalRef) || goalRef['aggregateType'] !== 'Goal' || !nonEmpty(goalRef['projectId'])
    || !nonEmpty(goalRef['goalId'])) return null;
  if (!Array.isArray(value['pins'])) return null;
  for (const pin of value['pins'] as unknown[]) {
    if (!isRecord(pin) || !isRecord(pin['ref']) || typeof pin['revision'] !== 'number'
      || !Number.isSafeInteger(pin['revision']) || pin['revision'] < 0) return null;
  }
  return value as unknown as DecisionSourceV1;
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
  requestRef?: QueryJobRef | null;
  replaces?: { proposalRef: PlanProposalRef; revision: number } | null;
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
  acknowledgementRef?: SessionMessageRef | null;
  decisionSource?: DecisionSourceV1 | null;
}): string {
  // Slice 5 (lead, LB3): attribution enters the fingerprint only when present, so
  // a request without it keeps the pre-slice canonical payload byte-identical.
  const { acknowledgementRef, decisionSource, ...base } = input;
  return sha256Hex(canonicalJson({ schemaVersion: 1, commandType: 'PlanApply', ...base,
    ...(acknowledgementRef === undefined || acknowledgementRef === null ? {} : { acknowledgementRef }),
    ...(decisionSource === undefined || decisionSource === null ? {} : { decisionSource }),
  } as unknown as JsonValue));
}

/**
 * Slice 5 §2.8 D8: the `PlanRevisionAccepted` attribution/proof. The
 * acknowledgement ref is attribution, never authorization. Every modified
 * aggregate that `source.pins` captured is checked against its captured
 * version; the Goal alone may rebase when its newer revision keeps an exactly
 * matching content basis and the Goal is active. Without a `decisionSource`
 * the proof carries `capturedPins: []` and `basisRebases: []`, and still names
 * every change (#21, lead).
 */
function planAcceptanceProof(input: {
  acknowledgementRef: SessionMessageRef;
  decisionSource: DecisionSourceV1 | null;
  candidate: CandidatePlanProposal;
  goal: GoalSnapshot;
  afterProposalRevision: number;
}): { proof: DecisionChangeProofV1 } | Rejection {
  const { acknowledgementRef, decisionSource, candidate, goal } = input;
  const capturedPins = decisionSource === null ? [] : decisionSource.pins;
  const changes: { before: VersionPin; after: VersionPin }[] = [];
  const basisRebases: GoalControlRebaseV1[] = [];
  // D8: `changes` is the exact before/after of EVERY changed aggregate, so the
  // adoption always records the proposal and the moved Goal. Only an aggregate
  // the answer captured is CHECKED against its captured version; a modified
  // aggregate without a captured pin is recorded as-is and not re-checked.
  const proposalKey = planProposalRefKey(candidate.ref);
  const proposalPin = capturedPins.find((pin) => refKeyOf(pin.ref) === proposalKey);
  if (proposalPin !== undefined && proposalPin.revision !== candidate.revision) {
    return rejected('revision_conflict', 'the candidate revision changed since the answer captured it');
  }
  changes.push({ before: { ref: candidate.ref, revision: candidate.revision },
    after: { ref: candidate.ref, revision: input.afterProposalRevision } });
  const goalKey = refKeyOf(goal.ref);
  const goalPin = capturedPins.find((pin) => refKeyOf(pin.ref) === goalKey);
  const before = { ref: goal.ref, revision: goal.revision };
  const after = { ref: goal.ref, revision: goal.revision + 1 };
  if (goalPin !== undefined && goalPin.revision !== goal.revision) {
    const basis = (decisionSource?.goalBases ?? []).find((candidateBasis) =>
      refKeyOf(candidateBasis.goalRef) === goalKey);
    if (goalPin.revision > goal.revision || basis === undefined || !goalDecisionBasisMatches(basis, goal)
      || goal.desiredState !== 'active') {
      return rejected('revision_conflict', 'the Goal content changed since the answer captured it');
    }
    basisRebases.push({ captured: goalPin, actualBefore: before, basis });
  }
  changes.push({ before, after });
  // D8: adoption also CREATES the target PlanRevision (before = the §2.1
  // absence pin revision 0, after = revision 1); the proof must name every
  // changed aggregate, not only the proposal and the Goal.
  const target = planRevisionTargetOf(candidate.ref, candidate.draft);
  changes.push({ before: { ref: target, revision: 0 }, after: { ref: target, revision: 1 } });
  return { proof: { acknowledgementRef, capturedPins, changes, basisRebases } };
}

/**
 * Slice 5 §2.8/T-R2-1: the Agent branch reads the formal answer the
 * acknowledgement names and uses its SAVED `response.decision.source` as the
 * decision basis. The source is never taken from model/caller JSON. This is new
 * business I/O, so it runs only after the original receipt replay; a missing
 * answer is `not_found` and a damaged/unreadable one is returned as its store
 * rejection. The caller has already refused another Workspace before any
 * foreign read.
 */
async function readAcknowledgedAnswerSource(
  records: GoalRecordTransactionPort & RecordLookupPort,
  acknowledgementRef: SessionMessageRef,
): Promise<{ status: 'ready'; source: DecisionSourceV1 } | Rejection> {
  const key = sessionMessageRefKey(acknowledgementRef);
  let read: Awaited<ReturnType<typeof records.readMany>>;
  try { read = await records.readMany([key]); }
  catch (error) { return rejected('unavailable', `the acknowledged answer read failed: ${messageOf(error)}`); }
  if (read.status !== 'ready') return mapStoreReadFailure(read, 'the acknowledged answer is not readable');
  const record = read.value.records.find((candidate) => candidate.refKey === key);
  if (record === undefined) {
    return read.value.missing.includes(key)
      ? rejected('not_found', 'the acknowledged answer does not exist')
      : rejected('unavailable', 'the acknowledged answer read was not reported');
  }
  const decoded = decodeSessionMessageRecord(record);
  if (decoded.status !== 'decoded') {
    return rejected('unavailable', `the acknowledged answer is damaged: ${decoded.reason}`);
  }
  const message = decoded.value;
  if (message.ref.projectId !== acknowledgementRef.projectId
    || message.ref.workspaceId !== acknowledgementRef.workspaceId
    || message.ref.messageId !== acknowledgementRef.messageId) {
    return rejected('unavailable', 'the stored acknowledged answer does not match the requested identity');
  }
  const response = message.response;
  if (response === null || !('decision' in response)) {
    return rejected('not_found', 'the acknowledged message does not carry a user decision answer');
  }
  return { status: 'ready', source: response.decision.source };
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
  observed: GoalScopeFacts,
): { status: 'ok' } | { status: 'conflict'; current: VersionPin[] } {
  const current: VersionPin[] = [];
  if (pins.project !== undefined && pins.project !== observed.projectRevision) {
    current.push({ ref: projectRefFor(scope.projectId), revision: observed.projectRevision });
  }
  if (pins.workspace !== undefined && pins.workspace !== observed.workspaceRevision) {
    current.push({ ref: workspaceRefFor(scope.projectId, scope.workspaceId), revision: observed.workspaceRevision });
  }
  if (pins.goal !== undefined && (pins.goal === null ? null : pins.goal) !== observed.goal.revision) {
    current.push({ ref: goalRefFor(scope.projectId, scope.goalId), revision: observed.goal.revision });
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
  // A PLAN-01 proposal writes one event; a PLAN-02 replacement writes the
  // replaced head's event first and the candidate's last, so the commit cursor
  // (and this replay) always names the candidate.
  if (receipt.eventIds.length < 1 || !nonEmpty(receipt.eventIds[receipt.eventIds.length - 1])) {
    return rejected('unavailable', 'a proposal receipt must reference at least one event');
  }
  const lastEventId = receipt.eventIds[receipt.eventIds.length - 1]!;
  const located = await records.eventAt(receipt.cursor);
  if (located.status !== 'ready') return mapStoreReadFailure(located, 'the original proposal event is unavailable');
  if (String(located.value.cursor) !== String(receipt.cursor)) return rejected('unavailable', 'eventAt returned a different cursor');
  const decoded = decodePlanProposalRecordedEvent(located.value.event);
  if (decoded.status !== 'decoded') return rejected('unavailable', `the original proposal event is corrupt: ${decoded.reason}`);
  const event = decoded.value;
  if (event.eventId !== lastEventId) return rejected('unavailable', 'the receipt points at another event');
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

/**
 * Slice 5 §3.1 line 520: a lost request-slot unique claim is the NEW operation's
 * conflict and maps to `revision_conflict`; the old Store mapping rules for
 * everything else are unchanged.
 */
function mapRequestSlotCommitFailure(receipt: StoreFailure, hasSlot: boolean): Rejection & { current?: VersionPin[] } {
  if (hasSlot && receipt.code === 'unique_conflict') return rejected('revision_conflict', receipt.reason);
  return mapCommitFailure(receipt);
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
/** What the failure facts read beside the canonical task facts (§4.1 失败事实读模型). */
type TaskRowRework = {
  goalDesiredState: GoalDesiredState;
  policy: TaskAutomationPolicyV1;
  /** The pointer ControlIntent per selected Run id, read after the fact window. */
  pointers: ReadonlyMap<string, ControlIntentSnapshotV1>;
  /** LA-4: the Goal workspace's current check configuration revision (`configurationFor`); null when unknown. */
  configurationRevision: string | null;
};

/**
 * C1 `TaskRow.failure` / `TaskRow.rework` (`buildTaskFailureFacts`) from the
 * same canonical read. `automation.verdict` is the TD-9 judgement
 * (`automationVerdict`) over the same facts and the live automation policy:
 * the AV table for a work Task (A.2 step 5.8; the successor-round rows
 * AV-7a..AV-7d since 5.9), the GV table for a gate (5.9, C5). The latest
 * reverify refusal of the chain head (VR-14) is read in the same window and
 * judged stale against the Goal's ended Runs and the current check
 * configuration revision (LA-4).
 */
function taskFailureRead(plan: PlanRevisionSnapshot, definition: RuntimeTask, state: CanonicalTaskState,
  facts: CanonicalTaskFacts, rework: TaskRowRework, goalId: string): { failure: TaskRow['failure']; rework: TaskRow['rework'] } {
  const input = definition.taskKind === 'gate'
    ? gateFailureInput(plan, definition, state, facts, rework, goalId)
    : workFailureInput(definition, state, facts, rework, goalId);
  const built = buildTaskFailureFacts(input, rework.policy, automationVerdict(input, rework.policy).verdict);
  return { failure: built.failure ?? undefined, rework: built.rework ?? undefined };
}

/** §4.1 failure facts input of a work Task: the selected Run, its chain head and its rework records. */
function workFailureInput(definition: RuntimeTask, state: CanonicalTaskState, facts: CanonicalTaskFacts,
  rework: TaskRowRework, goalId: string): WorkFailureInputV1 {
  const runs = facts.runsByTaskId.get(definition.taskId) ?? [];
  const execution = state.execution;
  const selectedRun = execution === null ? null : runs.find((run) => sameJson(run.ref, execution)) ?? null;
  const chain = facts.chainsByTaskId.get(definition.taskId) ?? { kind: 'none' };
  return {
    subjectKind: 'work',
    task: { projectId: facts.goalRef.projectId, goalId, taskId: definition.taskId },
    disposition: definition.disposition,
    satisfied: state.reductionRevision !== null,
    goalDesiredState: rework.goalDesiredState,
    reverifyRefusal: chain.kind === 'head' ? facts.reverifyRefusalsByRoundId.get(chain.head.ref.roundId) ?? null : null,
    goalEndedRuns: facts.goalEndedRuns ?? 0,
    configurationRevision: rework.configurationRevision,
    // The Kernel `run.failed` text is AgentRuntime's; the read model reads the persisted payloads only.
    kernelRunFailedError: null,
    selectedRun,
    originUnresolvable: selectedRun === null && state.reductionRevision === null && state.effectivePhase === 'blocked',
    pointerIntent: selectedRun === null ? null : rework.pointers.get(selectedRun.ref.runId) ?? null,
    chain,
    runs,
    requeues: facts.requeuesByTaskId.get(definition.taskId) ?? [],
    requeueRefusal: selectedRun === null ? null : facts.requeueRefusalsByRunId.get(selectedRun.ref.runId) ?? null,
    // L7/L22: the selected Task's full review records make AV-2b / AV-4c
    // fire; the selected Run's key being present but unreadable (or its record
    // undecodable) is the fail-closed `reviewUnreadable` the Task row projects.
    reviews: facts.reviewsByTaskId.get(definition.taskId) ?? [],
    reviewUnreadable: selectedRun !== null && state.unknownCallReview?.status === 'unreadable',
  };
}

/**
 * §4.1 failure facts input of a gate (P20, §9 VD-15, GV table): its own chain
 * head, the producer Run the chain is anchored on (`head.subjectRunRef`, among
 * the Runs this window read; null when not read), and GV-5: a required, active
 * work Task inside the gate's scope (goal/stage/module) is not satisfied yet.
 */
function gateFailureInput(plan: PlanRevisionSnapshot, definition: RuntimeTask, state: CanonicalTaskState,
  facts: CanonicalTaskFacts, rework: TaskRowRework, goalId: string): GateFailureInputV1 {
  const chain = facts.chainsByTaskId.get(definition.taskId) ?? { kind: 'none' };
  const head = chain.kind === 'head' ? chain.head : null;
  const anchorRun = head === null ? null
    : [...facts.runsByTaskId.values()].flat().find((run) => sameJson(run.ref, head.subjectRunRef)) ?? null;
  // GV-5 from the ONE shared `gateFixInProgress` (coverage + covered Tasks'
  // requirement/disposition/effective phase); the §4.2 reader uses the same.
  const fixInProgress = gateFixInProgress(plan.tasks, definition,
    (taskId) => facts.byTaskId.get(taskId)?.effectivePhase);
  return {
    subjectKind: 'gate',
    task: { projectId: facts.goalRef.projectId, goalId, taskId: definition.taskId },
    disposition: definition.disposition,
    satisfied: state.reductionRevision !== null,
    goalDesiredState: rework.goalDesiredState,
    reverifyRefusal: head === null ? null : facts.reverifyRefusalsByRoundId.get(head.ref.roundId) ?? null,
    goalEndedRuns: facts.goalEndedRuns ?? 0,
    configurationRevision: rework.configurationRevision,
    kernelRunFailedError: null,
    chain,
    anchorRun,
    fixInProgress,
  };
}

/**
 * The read-model inputs after the fact window: the pointer intents of the
 * selected Runs, and the current check configuration revision of the Goal's
 * workspace (LA-4).
 */
async function taskRowReworkOf(records: GoalRecordTransactionPort, facts: CanonicalTaskFacts,
  goal: Pick<GoalSnapshot, 'desiredState' | 'workspaceRef'>, policy: TaskAutomationPolicyV1,
  configurationFor: PlanServiceDependencies['configurationFor']): Promise<TaskRowRework | Rejection> {
  const selected = [...facts.byTaskId.values()].flatMap((state) => {
    const execution = state.execution;
    if (execution === null) return [];
    const run = (facts.runsByTaskId.get(state.taskId) ?? []).find((candidate) => sameJson(candidate.ref, execution));
    return run === undefined ? [] : [run];
  });
  const pointers = await readPointerIntents(records, selected);
  if (pointers.status !== 'ready') return pointers;
  const configuration = configurationFor?.({ projectId: goal.workspaceRef.projectId, workspaceId: goal.workspaceRef.workspaceId });
  return { goalDesiredState: goal.desiredState, policy, pointers: pointers.intents,
    configurationRevision: configuration?.configurationRevision ?? null };
}

function taskRow(plan: PlanRevisionSnapshot, goalId: string,
  facts: CanonicalTaskFacts, phases: ReadonlyMap<string, Phase>, index: TaskRowIndex, taskId: string,
  rework: TaskRowRework): TaskRow | null {
  const definition = plan.tasks.find((candidate) => candidate.taskId === taskId);
  const state = facts.byTaskId.get(taskId);
  if (definition === undefined || state === undefined) return null;
  // D-9 (§2.6): the Goal's stored desired state, so a paused Goal shows no Task as eligible.
  const eligibility = evaluateEligibility({ plan, goalDesiredState: rework.goalDesiredState, taskId,
    effectivePhases: phases, lease: state.lease });
  const failure = taskFailureRead(plan, definition, state, facts, rework, goalId);
  const coveringRequeueRef = state.requeueRef;
  const requeueBudget = coveringRequeueRef === null ? null
    : (facts.requeuesByTaskId.get(taskId) ?? []).find((requeue) => sameJson(requeue.ref, coveringRequeueRef))?.budget ?? null;
  // C7 (TD-4): the latest disposition change as the read Plan records it; no history walk.
  const dispositionChange = plan.dispositionRecord?.entries.find((entry) => entry.taskId === taskId);
  return {
    ref: { projectId: plan.ref.projectId, goalId, taskId },
    definition,
    effectivePhase: state.effectivePhase,
    // TD-1: the projection reason, present when the projected row has one.
    ...(state.phaseCause === null ? {} : { phaseCause: state.phaseCause }),
    // P4 (D-3): the TaskRequeue a claim of this Task must name.
    ...(state.requeueRef === null ? {} : { requeueRef: state.requeueRef }),
    // TASK-03: the budget that TaskRequeue pins for the claim.
    ...(requeueBudget === null ? {} : { requeueBudget: { ...requeueBudget } }),
    // C1: the structured failure facts and the requeue history (read-only).
    ...(failure.failure === undefined ? {} : { failure: failure.failure }),
    ...(failure.rework === undefined ? {} : { rework: failure.rework }),
    disposition: definition.disposition,
    ...(dispositionChange === undefined ? {} : { dispositionChange }),
    currentAttempt: state.currentAttempt,
    execution: state.execution,
    // L7: the selected Run's review record, or its fail-closed `unreadable`.
    ...(state.unknownCallReview === null ? {} : { unknownCallReview: state.unknownCallReview }),
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
  /** Slice 5 §2.6: the transitional request-facts seam, built over the same records instance. */
  const requestFactsReader = createCandidateRequestFactsReader({ records });
  /** The initial-plan answer facts/read-back seam, built over the records instance read above and the same deps. */
  const initialPlanAnswerReader = createInitialPlanAnswerReader(deps, records);
  const readInitialPlanAnswerFacts = initialPlanAnswerReader.readInitialPlanAnswerFacts;
  /** C8 policy of the failure facts, read fresh on every graph read (a settings change applies at once). */
  const automationPolicy = (): TaskAutomationPolicyV1 => deps.automationPolicy?.() ?? DEFAULT_TASK_AUTOMATION_POLICY;

  /**
   * R5b.4 §11.2 the ONE Host candidate commit/receipt step shared by the direct
   * Host propose and the new answer-derived entry. The caller supplies the full
   * identity/fingerprint/proposal ref (already bound to the trusted actor/scope);
   * this step only does the original receipt lookup/restore, the pinned-scope CAS,
   * the bounded draft admission and the single `PlanProposalRecorded` commit.
   * PLAN-01 (`host`) / PLAN-03 (`initial_answer`) of the plan machine judge the
   * scope and write the candidate@1 (§14.1). `extraGuards` joins the same local
   * CAS as PLAN-03's `answer_facts` (the Answer/Job/Run revisions the new entry
   * actually read); it never becomes a second commit algorithm.
   */
  async function commitHostPlanProposal(input: {
    ctx: CoreCallContext;
    writer: 'host' | 'initial_answer';
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
    /** Slice 5 §2.4: the first user-initiated request this candidate belongs to. */
    requestRef: QueryJobRef | null;
    /** Slice 5 §2.4: the current request head this candidate replaces, or null. */
    replaces: { proposalRef: PlanProposalRef; revision: number } | null;
  }): Promise<WriteResult<PlanProposal>> {
    const { goalRef, workspaceId, requestRef, replaces } = input;
    const ctx = input.ctx;
    const pins = normalizeCallerPlanPins({ projectId: goalRef.projectId, workspaceId, goalId: goalRef.goalId }, input.expected);
    if (pins.status === 'invalid') return rejected('invalid', pins.reason);

    const receiptExpected = { identityKey: input.identityKey, projectId: goalRef.projectId, workspaceId,
      proposalId: input.proposalId, idempotencyKey: input.requestId, actor: input.actor };
    const early = await records.lookupCommit({ identityKey: input.identityKey, fingerprint: input.fingerprint });
    if (early.status === 'ready') {
      const restored = await restoreProposal(records, early.value, receiptExpected);
      if (restored.status !== 'restored') return rejected(restored.code, restored.reason);
      return { status: 'committed', value: restored.proposal, replayed: true, cursor: early.value.cursor };
    }
    if (early.code === 'idempotency_conflict') return rejected('idempotency_conflict', early.reason);
    if (early.code !== 'not_found') return rejected('unavailable', `${early.code}: ${early.reason}`);

    const scoped = await readPlanScope(records, goalRef, workspaceId, pins.pins);
    if (scoped.status !== 'ready') return scoped;

    // Slice 5 §2.4/§2.6: the request seam proves the real same-Goal root and
    // reads the current per-request head. It runs after the scope read and
    // before the draft admission; a missing/foreign/not-user root is refused
    // without guessing.
    let requestFacts: PlanRequestCandidateFacts | null = null;
    let requestGuards: readonly RecordGuard[] = [];
    let oldHead: CandidatePlanProposal | null = null;
    // Slice 5 §2.5/T-R2-2: a replacement copies the replaced chain's wire-only
    // creation origin; it never rebinds. `undefined` means the old record
    // carried no `since` (a legacy/pre-slice chain), so the successor keeps none.
    let replacedOrigin: NoticeOriginWireV1 | undefined;
    if (requestRef !== null) {
      const factsRead = await requestFactsReader.readCandidateRequestFacts(ctx, { requestRef, goalRef });
      if (factsRead.status !== 'ready') return asWriteRejection(factsRead, 'the request facts are unavailable');
      if (!factsRead.value.root) return rejected('invalid', 'the requestRef root does not belong to this Goal');
      if (!factsRead.value.initiatedByOperator) {
        return rejected('unsupported', 'the requestRef is not a user-initiated first-round QueryJob');
      }
      requestGuards = factsRead.value.guards;
      const headRead = await readRequestCandidateHead(records, { goalRef, requestRef });
      if (headRead.status !== 'ready') return asWriteRejection(headRead, 'the request head is unavailable');
      const head = headRead.head;
      if (replaces === null) {
        requestFacts = requestCandidateFacts({ requestRootSameGoal: true, replacesIsNull: true,
          slotExpectedOwnerIsNull: head === null });
      } else {
        const oldRead = await readProposal(records, replaces.proposalRef);
        if (oldRead.status !== 'ready') return asWriteRejection(oldRead, 'the replaced head is unavailable');
        if (oldRead.proposal.kind !== 'candidate_v2') return rejected('unsupported', 'a legacy v1 proposal cannot be replaced');
        oldHead = oldRead.proposal;
        const oldOrigin = await readProposalOrigin(records, replaces.proposalRef);
        if (oldOrigin.status !== 'ready') return asWriteRejection(oldOrigin, 'the replaced head origin is unavailable');
        replacedOrigin = oldOrigin.origin;
        const headMatches = head !== null && planProposalRefKey(head.ref) === planProposalRefKey(replaces.proposalRef);
        const headRevisionMatches = head !== null && head.revision === replaces.revision;
        requestFacts = requestCandidateFacts({ requestRootSameGoal: true, replacesIsNull: false,
          headMatches, headRevisionMatches, requestGoalMatches: true,
          replacesComplete: headMatches && headRevisionMatches });
      }
    } else if (replaces !== null) {
      return rejected('invalid', 'a replacement candidate requires the request it replaces');
    }

    const policyRead = await tryPolicyContent(records, goalRef.projectId);
    const issues = validatePlanDraft(input.draft, policyRead.policy);
    let candidate: PlanProposal;
    let replacedRecord: CandidatePlanProposal | null = null;
    let requestSlotEffect: Extract<PlanProposalEffect, { kind: 'request_slot' }> | null = null;
    let commitGuards: readonly RecordGuard[] = [];

    if (replaces !== null) {
      // S5-PLAN-02: the replacement transition over the real old head. The old
      // head's complete next record and the slot move are separate effects.
      // L10: the machine judges the head before the module fact read here.
      const catalog = await proposeCatalogFacts(records, goalRef.projectId, input.draft);
      const event = { type: 'proposal_replaced' as const, writer: input.writer, ref: input.ref, goalRef,
        basedOn: input.basedOn, draft: input.draft, reason: input.reason as unknown as PlanChangeReason,
        issues, catalogPin: catalog.catalogPin, submittedBy: null, expectedHeadRevision: replaces.revision,
        requestedBy: input.actor, at: deps.now(), head: { proposalRef: replaces.proposalRef, revision: replaces.revision },
        replaces, requestRef: requestRef! };
      const guardCtx: PlanProposalGuardContext = { ...scoped.facts, agentAdmission: null, source: null,
        modules: catalog.modules, initial: null, future: null, requestCandidate: requestFacts };
      const decided = transitionPlanProposal(oldHead, event, guardCtx);
      if (!decided.ok) return refusalOf(decided);
      const commit = planCommitOf(decided, { scope: scoped.scope, actor: input.actor, answerFacts: input.extraGuards });
      if (commit.status !== 'ready') return commit;
      candidate = commit.proposal;
      replacedRecord = commit.replaced;
      requestSlotEffect = commit.requestSlot;
      commitGuards = commit.guards;
    } else {
      // PLAN-01/03 judge the scope before the policy read. The proposal is not
      // read: its absence is the commit's CAS ∅ guard (state ∅).
      const recorded = { type: 'proposal_recorded' as const, writer: input.writer, ref: input.ref, goalRef,
        basedOn: input.basedOn, draft: input.draft, reason: input.reason as unknown as PlanChangeReason, submittedBy: null,
        ...(requestRef === null ? {} : { requestRef }) };
      // L10: the early ask has no module fact yet, so it stops before it; the catalog is read only after it holds.
      const readFacts = { ...scoped.facts, agentAdmission: null, source: null, initial: null,
        future: null, requestCandidate: requestFacts };
      const refused = planProposalProblem(null, recorded, readFacts);
      if (refused?.ok === false) return refusalOf(refused, pinsCurrent(refused, scoped.comparison));
      const catalog = await proposeCatalogFacts(records, goalRef.projectId, input.draft);
      const guardCtx: PlanProposalGuardContext = { ...readFacts, modules: catalog.modules };
      const decided = transitionPlanProposal(null, { ...recorded, issues, catalogPin: catalog.catalogPin }, guardCtx);
      if (!decided.ok) return refusalOf(decided);
      const commit = planCommitOf(decided, { scope: scoped.scope, actor: input.actor, answerFacts: input.extraGuards });
      if (commit.status !== 'ready') return commit;
      candidate = commit.proposal;
      requestSlotEffect = commit.requestSlot;
      commitGuards = commit.guards;
    }

    const identity = { projectId: goalRef.projectId, actor: input.actor, idempotencyKey: input.requestId };
    const derived = deriveCommandIds(identity, 'plan-propose');
    const eventFor = (proposal: PlanProposal): PlanProposalRecordedEvent => ({
      eventId: deps.eventId(), eventType: 'PlanProposalRecorded', schemaVersion: 2,
      projectId: goalRef.projectId, workspaceId, aggregateType: 'PlanProposal', aggregateId: proposal.ref.proposalId,
      aggregateRevision: proposal.revision, causationId: derived.commandId, correlationId: derived.correlationId,
      idempotencyKey: input.requestId, actor: input.actor, occurredAt: deps.now(), payload: { proposal },
    });
    // The replaced record's event goes FIRST and the candidate LAST, so the
    // commit cursor's event is always the candidate: replay needs no scan.
    const encodedEvents = (replacedRecord === null ? [] : [encodePlanProposalRecordedEvent(eventFor(replacedRecord))])
      .concat([encodePlanProposalRecordedEvent(eventFor(candidate))]);
    // Slice 5 §2.5/T-R2-2: a NEW chain's first candidate binds its creation
    // commit cursor to the wire `since`; a replacement copies the old chain's
    // preserved origin into both the rewritten old head and the new candidate.
    const replacing = replacedRecord !== null;
    const encodedRecords = (replacedRecord === null ? [] : [encodePlanProposal(replacedRecord, replacedOrigin)])
      .concat([encodePlanProposal(candidate, replacing ? replacedOrigin : { since: null })]);
    const cursorBindings = replacing ? [] : [{ refKey: planProposalRefKey(candidate.ref), field: 'since' as const }];
    const merged = mergeGuards([...commitGuards, ...requestGuards]);
    if (!merged.ok) return merged.rejection;
    const claims: UniqueClaimChange[] = requestSlotEffect === null ? [] : [requestSlotClaim(requestSlotEffect)];
    // The FIRST read of the window is the horizon: any fact added after it must
    // conflict, even if a later optional read observed a newer head.
    const horizon = scoped.scope.readThrough;
    if (horizon === null) return rejected('incomplete', 'the ledger has no readable watermark for the proposal');
    const committed = await records.commit({ identityKey: input.identityKey, fingerprint: input.fingerprint,
      guards: merged.guards, records: encodedRecords, claims, indexGuards: [], indexChanges: [],
      events: encodedEvents, ledgerHorizon: horizon,
      ...(cursorBindings.length === 0 ? {} : { commitCursorBindings: cursorBindings }) });
    if (committed.status !== 'committed') return mapRequestSlotCommitFailure(committed, claims.length > 0);
    if (!committed.replayed) return { status: 'committed', value: candidate, replayed: false, cursor: committed.cursor };
    const restored = await restoreProposal(records, committed, receiptExpected);
    if (restored.status !== 'restored') return rejected(restored.code, restored.reason);
    return { status: 'committed', value: restored.proposal, replayed: true, cursor: committed.cursor };
  }


  async function proposePlan(
    ctx: CoreCallContext,
    request: GraphWrite<ProposedPlanRequestV1>,
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
    // Slice 5 §2.4: the optional request association and the replaced head. A
    // requestRef is a complete QueryJobRef in this project/workspace; replaces
    // names the current head ref plus its revision.
    const requestRefRaw = rawInput['requestRef'];
    let requestRef: QueryJobRef | null = null;
    if (requestRefRaw !== undefined && requestRefRaw !== null) {
      if (!isRecord(requestRefRaw) || requestRefRaw['aggregateType'] !== 'QueryJob'
        || requestRefRaw['projectId'] !== goalRef.projectId || requestRefRaw['workspaceId'] !== workspaceId
        || !nonEmpty(requestRefRaw['queryJobId'])) {
        return rejected('invalid', 'proposePlan requestRef must be a complete QueryJobRef in this project/workspace');
      }
      requestRef = requestRefRaw as unknown as QueryJobRef;
    }
    const replacesRaw = rawInput['replaces'];
    let replaces: { proposalRef: PlanProposalRef; revision: number } | null = null;
    if (replacesRaw !== undefined && replacesRaw !== null) {
      if (!isRecord(replacesRaw) || typeof replacesRaw['revision'] !== 'number'
        || !Number.isSafeInteger(replacesRaw['revision']) || replacesRaw['revision'] < 1) {
        return rejected('invalid', 'proposePlan replaces must name a proposal revision');
      }
      const replacedRef = planProposalRefFromUnknown(replacesRaw['proposalRef']);
      if (replacedRef === null || replacedRef.workspaceId !== workspaceId) {
        return rejected('invalid', 'proposePlan replaces must name a PlanProposalRef in this workspace');
      }
      replaces = { proposalRef: replacedRef, revision: replacesRaw['revision'] };
    }
    // W2 Agent branch is recognized first and never falls through to the Host-only binding.
    if (isWorkRunCaller(ctx)) {
      const ownedContext = ownCallContext(ctx);
      if (ownedContext.status === 'invalid') return rejected('invalid', ownedContext.reason);
      return proposePlanAsAgent(deps, records, ownedContext.value, {
        goalRef, basedOn, draft, reason: reasonRaw, requestId, expected: rawMeta['expected'], workspaceId,
        requestRef, replaces,
      });
    }
    const bound = boundWriteActor(ctx, goalRef.projectId, workspaceId);
    if (bound.status !== 'ok') return rejected(bound.code, bound.reason);
    if (bound.aborted) return rejected('cancelled', 'plan proposal was cancelled before admission');

    const identity = { projectId: goalRef.projectId, actor: bound.actor, idempotencyKey: requestId };
    const identityKey = PLAN_PROPOSE_IDENTITY_PREFIX + commandIdentityKey(identity);
    const proposalId = planProposalIdFor({ projectId: goalRef.projectId, workspaceId, goalId: goalRef.goalId, requestId });
    const ref: PlanProposalRef = { aggregateType: 'PlanProposal', projectId: goalRef.projectId, workspaceId, proposalId };
    const fingerprint = proposeFingerprint({ projectId: goalRef.projectId, workspaceId, goalRef, basedOn, draft, reason: reasonRaw,
      requestRef, replaces });

    return commitHostPlanProposal({
      ctx, writer: 'host', goalRef, workspaceId, actor: bound.actor, identityKey, fingerprint, proposalId, ref,
      basedOn, draft, reason: reasonRaw, requestId, expected: rawMeta['expected'], extraGuards: [],
      requestRef, replaces,
    });
  }

  async function applyPlanChange(
    ctx: CoreCallContext,
    request: GraphWrite<{ proposalRef: PlanProposalRef; expectedProposalRevision: number;
      decisionRefs: readonly VersionPin[]; acknowledgementRef?: SessionMessageRef;
      /** [lead S5-T3-D8] proof data only (never authorization); see PlanTaskPort.applyPlanChange. */
      decisionSource?: DecisionSourceV1 }>,
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
    // Slice 5 §2.8 D8: attribution and proof data only, never authorization.
    const acknowledgementRef = sessionMessageRefFromUnknown(rawInput['acknowledgementRef']);
    if (rawInput['acknowledgementRef'] !== undefined && rawInput['acknowledgementRef'] !== null
      && acknowledgementRef === null) {
      return rejected('invalid', 'acknowledgementRef must be a complete SessionMessageRef');
    }
    // §8.2 scope row (lead, accept review NEW-3): the attributed answer must be in the adopting proposal's own
    // Workspace; an answer of another Workspace is never attribution for this change.
    if (acknowledgementRef !== null && (acknowledgementRef.projectId !== proposalRef.projectId
      || acknowledgementRef.workspaceId !== proposalRef.workspaceId)) {
      return rejected('forbidden', 'acknowledgementRef names an answer in another workspace');
    }
    const decisionSource = decisionSourceFromUnknown(rawInput['decisionSource']);
    if (rawInput['decisionSource'] !== undefined && rawInput['decisionSource'] !== null && decisionSource === null) {
      return rejected('invalid', 'decisionSource must be a DecisionSourceV1 shape');
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
        // Slice 5 §2.8 D8/T-R2-1: the Agent branch receives attribution only.
        // It reads the formal answer itself and never accepts a caller-supplied
        // `decisionSource` (the parsed Host `decisionSource` below is unused here).
        acknowledgementRef,
      });
    }
    const bound = boundWriteActor(ctx, proposalRef.projectId, proposalRef.workspaceId);
    if (bound.status !== 'ok') return rejected(bound.code, bound.reason);
    if (bound.aborted) return rejected('cancelled', 'plan adoption was cancelled before admission');

    const identity = { projectId: proposalRef.projectId, actor: bound.actor, idempotencyKey: requestId };
    const identityKey = PLAN_APPLY_IDENTITY_PREFIX + commandIdentityKey(identity);
    const fingerprint = applyFingerprint({ projectId: proposalRef.projectId, workspaceId: proposalRef.workspaceId,
      proposalRef, expectedProposalRevision, decisionRefs: rawInput['decisionRefs'], acknowledgementRef, decisionSource });

    const prePins = normalizeCallerPlanPins({ projectId: proposalRef.projectId, workspaceId: proposalRef.workspaceId }, rawMeta['expected']);
    if (prePins.status === 'invalid') return rejected('invalid', prePins.reason);

    const receiptExpected = { identityKey, fingerprint, projectId: proposalRef.projectId,
      workspaceId: proposalRef.workspaceId, idempotencyKey: requestId, actor: bound.actor };
    const early = await records.lookupCommit({ identityKey, fingerprint });
    if (early.status === 'ready') {
      const restored = await restoreAcceptedPlan(records, early.value, receiptExpected);
      if (restored.status !== 'restored') return rejected(restored.code, restored.reason);
      return { status: 'committed', value: restored.value, replayed: true, cursor: early.value.cursor };
    }
    if (early.code === 'idempotency_conflict') return rejected('idempotency_conflict', early.reason);
    if (early.code !== 'not_found') return rejected('unavailable', `${early.code}: ${early.reason}`);

    const evaluate = async (): Promise<WriteResult<PlanRevisionSnapshot>> => {
      const adoption: AcceptedPlanEvent = { type: 'proposal_accepted', adopter: 'host', proposalRef,
        expectedProposalRevision, decisionRefs: decisionRefs as readonly VersionPin[], agentWriter: null };
      // PLAN-04/05: the proposal kind, status and revision, then the scope and decisionRefs and the pointer
      // (initial) or the draft schema and decisionRefs (future), before the next read.
      const read = await readAdoption(records, adoption, null, rawMeta['expected']);
      if (read.status !== 'ready') return read;
      const { candidate, scope, adoptionScope } = read;
      // Slice 5 §2.8 D8: attribution/proof data only, computed from the answer
      // source captured by the trusted caller; never a new authorization.
      let decisionProof: PlanAcceptanceDecisionProofV1 | null = null;
      if (acknowledgementRef !== null) {
        const proof = planAcceptanceProof({ acknowledgementRef, decisionSource, candidate, goal: scope.goal,
          afterProposalRevision: candidate.revision + 1 });
        if ('status' in proof) return proof;
        decisionProof = { acknowledgementRef, decisionApplication: proof.proof };
      }
      if (candidate.basedOn !== null) {
        // The Host principal as `boundWriteActor` bound it (its actor is the principal's own).
        return applyFutureRevision({ records, read, adoption, receipt: receiptExpected,
          principal: { kind: 'host', actor: bound.actor as Extract<CorePrincipal, { kind: 'host' }>['actor'] },
          operatorActor: deps.operatorActor,
          extraGuards: [], preCommitSignal: null, eventId: deps.eventId, now: deps.now, decisionProof });
      }

      // S5-PLAN-03: a request-associated initial candidate releases its slot in
      // the same commit; an independent candidate keeps the old accepted path.
      const requestRef = candidateRequestRef(candidate);
      let requestFacts: PlanRequestCandidateFacts | null = null;
      let adoptedEvent: PlanProposalEvent = adoption;
      if (requestRef !== null) {
        const headRead = await readRequestCandidateHead(records, { goalRef: candidate.goalRef, requestRef });
        if (headRead.status !== 'ready') return asWriteRejection(headRead, 'the request head is unavailable');
        const slotOwnerMatches = headRead.head !== null
          && planProposalRefKey(headRead.head.ref) === planProposalRefKey(candidate.ref);
        // S5-PLAN-03/D2: null/null is the valid initial relationship (the
        // legitimate first plan); a non-null candidate `basedOn` must equal the
        // Goal's active pointer, and a one-sided null is never a match.
        const basedOnIsActivePointer = candidate.basedOn === null
          ? scope.goal.activePlanRevision === null
          : scope.goal.activePlanRevision !== null
            && refKeyOf(candidate.basedOn) === refKeyOf(scope.goal.activePlanRevision);
        // Slice 5 §3.1 S5-PLAN-03/§3.2: the first plan is user-only and the
        // adopting action's autonomy verdict is not hardcoded. `bound` is the
        // trusted Host operator; an Agent never reaches here (W2 branch above).
        const operatorMatches = hostOperatorMatches(deps.operatorActor, bound.actor, true);
        const adopterClass = reworkActorClassOf(null, bound.actor) ?? 'human';
        requestFacts = requestCandidateFacts({ replacesIsNull: true, basedOnIsActivePointer,
          firstPlanUserOnly: operatorMatches, slotOwnerMatches, operatorMatches,
          goalNotCancelled: scope.goal.desiredState !== 'cancelled',
          adoptionPolicy: operatorMatches ? null : adoptionPolicyOf(scope.goal, 'adopt_first_plan', adopterClass) });
        adoptedEvent = { ...adoption, type: 'proposal_adopted', requestRef };
      }

      let originGuards: RecordGuard[] = [];
      let origin: 'ok' | CoreRejection = 'ok';
      if (candidate.draft.origin !== undefined) {
        const verified = await initialPlanAnswerReader.verifyModelCoordinationDraft(capturedContext, candidate);
        if ('rejection' in verified) origin = verified.rejection;
        else originGuards = verified.guards;
      }
      const ask = adoptionAsk<InitialAdoptionFacts>(candidate, adoption, (initial) => ({ ...adoptionScope, initial }));
      let refused = ask({ origin });
      if (refused !== null) return refusalOf(refused);

      const governanceRead = await resolveGovernance(records, proposalRef.projectId);
      const governance = governanceRead.status === 'resolved' ? 'ok' : governanceRead;
      refused = ask({ governance });
      if (refused !== null) return refusalOf(refused);
      // PLAN-04 refused an unresolved governance above.
      const resolved = governanceRead.status === 'resolved' ? governanceRead : null;
      // L10: a module-scoped task is checked against the catalog governance selected, whatever the candidate's pin.
      // Governance's guards already hold the pointer and the baseline, and the catalog row is create-only.
      let modules: 'ok' | CoreRejection = 'ok';
      if (draftHasModuleTask(candidate.draft)) {
        const selected = await readRevisionByRef(records, resolved!.governance.architectureBaseline.ref);
        if (selected.status === 'ready') modules = moduleFactOf(candidate.draft, selected.value.catalog.catalog);
        else if (selected.status === 'not_found') {
          modules = rejected('unavailable', 'the governance architecture baseline has no catalog row');
        } else modules = asWriteRejection(selected, 'the governance architecture catalog is unavailable');
      }
      refused = ask({ modules });
      if (refused !== null) return refusalOf(refused);
      // The draft validators run one after the other, each only once the one before it holds.
      const draftIssues = validatePlanDraft(candidate.draft, resolved!.policyContent);
      refused = ask({ draftIssues });
      if (refused !== null) return refusalOf(refused);
      const assignmentReasons = validatePlanAssignments(candidate.draft);
      refused = ask({ assignmentReasons });
      if (refused !== null) return refusalOf(refused);
      const phaseReasons = planPhaseGuardReasons(candidate.draft.tasks);

      // PLAN-04 + GOAL-02: the accepted candidate, the moved Goal and the guards of the one commit.
      const decided = transitionPlanProposal(candidate, adoptedEvent, { ...adoptionScope, source: null, modules: null,
        initial: { origin, governance, modules, draftIssues, assignmentReasons, phaseReasons }, future: null,
        requestCandidate: requestFacts });
      if (!decided.ok) return refusalOf(decided);
      const commit = planCommitOf(decided, { scope, actor: bound.actor,
        originSources: originGuards, governance: resolved!.governance.guards });
      if (commit.status !== 'ready') return commit;
      const requestSlot: PlanRequestSlotChangeV1 | null = commit.requestSlot === null ? null
        : { requestRef, claim: requestSlotClaim(commit.requestSlot) };
      if (read.horizon === null) return rejected('incomplete', 'the ledger has no readable watermark for the plan adoption');
      const acceptedAt = deps.now();
      const derived = deriveCommandIds(identity, 'plan-apply');
      const compiled = compileInitialPlanAdoption({
        commit: adoptionCommitOf(commit),
        governance: resolved!.governance,
        ledgerHorizon: read.horizon,
        identityKey,
        fingerprint,
        eventId: deps.eventId(),
        occurredAt: acceptedAt,
        commandId: derived.commandId,
        correlationId: derived.correlationId,
        idempotencyKey: requestId,
        actor: bound.actor,
        requestSlot,
        decisionProof,
        origin: read.origin,
      });
      const committed = await records.commit(compiled.prepared);
      if (committed.status !== 'committed') return mapRequestSlotCommitFailure(committed, compiled.prepared.claims.length > 0);
      if (!committed.replayed) return { status: 'committed', value: compiled.snapshot, replayed: false, cursor: committed.cursor };
      const restored = await restoreAcceptedPlan(records, committed, receiptExpected);
      if (restored.status !== 'restored') return rejected(restored.code, restored.reason);
      return { status: 'committed', value: restored.value, replayed: true, cursor: committed.cursor };
    };

    const outcome = await evaluate();
    if (outcome.status === 'rejected') {
      // Concurrency seam: after a lookup miss a same-identity peer may commit
      // before our post-lookup read, so the normal validation sees an accepted
      // proposal or an advanced Goal. Re-query the EXACT receipt once; a
      // matching body restores the original adoption, a different body is an
      // idempotency conflict, and a genuine miss still returns the rejection.
      const restored = await recheckApply(records, receiptExpected);
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
    return commitHostPlanProposal({ ctx, writer: 'initial_answer', goalRef, workspaceId, actor: bound.actor, identityKey, fingerprint,
      proposalId, ref, basedOn: null, draft: normalized.draft, reason: rawReason, requestId,
      expected, extraGuards: originGuards, requestRef: null, replaces: null });
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
    const scopeError = authorizeProposal(authority.principal, read.proposal);
    if (scopeError !== null) return scopeError;
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
    let goalFacts: Pick<GoalSnapshot, 'desiredState' | 'workspaceRef'>;
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
      goalFacts = window.goal;
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
      goalFacts = goalRead.goal;
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
    const rework = await taskRowReworkOf(records, facts.value, goalFacts, automationPolicy(), deps.configurationFor);
    if ('status' in rework) return asReadResult(rework);
    // The task graph always contains every task of the accepted Plan; Run /
    // Lease / Reduction only update each task's state.
    const tasks: TaskRow[] = [];
    for (const task of activePlan.tasks) {
      const row = taskRow(activePlan, goalRef.goalId, facts.value, phases, index, task.taskId, rework);
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
    const rework = await taskRowReworkOf(records, facts.value, window.goal, automationPolicy(), deps.configurationFor);
    if ('status' in rework) return asReadResult(rework);
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
      const row = taskRow(plan, goalRef.goalId, facts.value, phases, index, task.taskId, rework);
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

  /**
   * A.2 step 5.5 (§2.1 展示读取 `readGoalDisplayFacts`, GOAL-17..30): one read
   * window of the Goal and its active Plan (`readGoalPlanWindow`), the pending
   * candidate (`findPendingProposal`), the canonical task facts and the
   * GoalPhase, confirmed against the active Plan as `queryTaskGraph` does; the
   * Task rows come from the SAME `taskRow` (projection, eligibility,
   * `buildTaskFailureFacts`), so the Task view and the Goal display read one
   * verdict. The pointer intents are read after the window (their status only
   * moves forward, D-8). `runStops` cover each Task's selected Run and every
   * `starting|running` Run while the Goal is not active.
   */
  async function queryGoalDisplay(ctx: CoreCallContext, input: GoalDisplayQuery): Promise<ReadResult<GoalDisplayRead>> {
    if (ctx?.signal?.aborted) return rejected('cancelled', 'queryGoalDisplay was cancelled');
    if (!isRecord(input) || !isRecord(input.goalRef) || !nonEmpty(input.goalRef['projectId'])) {
      return rejected('invalid', 'queryGoalDisplay requires a full GoalRef');
    }
    const goalRef = goalRefFromUnknown(input.goalRef, input.goalRef['projectId']);
    if (goalRef === null) return rejected('invalid', 'queryGoalDisplay requires a full GoalRef');
    const capabilities = entryCapabilitiesOf(input.entryControlCapabilities);
    if (capabilities === null) {
      return rejected('invalid', 'entryControlCapabilities must give pause and cancel as supported, or unsupported with a reason');
    }
    const authority = authorizeReadContext(ctx, goalRef.projectId);
    if (authority.status !== 'ok') return authority;
    const window = await readGoalPlanWindow(records, goalRef);
    if (window.status !== 'ready') return asReadResult(window);
    const scopeError = authorizeGoal(authority.principal, window.goal);
    if (scopeError !== null) return scopeError;
    const pending = await findPendingProposal(records, goalRef, { revision: window.goal.revision,
      activePlanRevision: window.goal.activePlanRevision });
    if (pending.status !== 'ready') return asReadResult(pending);
    const goal = pending.goal;
    const plan = window.plan;
    const pendingProposal = pending.proposal === null ? null
      : { ref: pending.proposal.ref, basedOn: pending.proposal.basedOn };
    const phaseRef: GoalPhaseRef = { aggregateType: 'GoalPhase', projectId: goalRef.projectId, goalId: goalRef.goalId };
    if (plan === null) {
      const phaseRead = await readGoalPhase(records, phaseRef);
      if (phaseRead.status !== 'ready') return asReadResult(phaseRead);
      const display = reduceGoalDisplay({ desiredState: goal.desiredState, activePlanRef: null,
        completion: phaseRead.snapshot === null ? { status: 'not_recorded' } : { status: 'recorded', selectedPlanMatches: false },
        partialAcceptance: null, pendingProposal, tasks: [], runsByTaskId: new Map(), runStopInputs: [] });
      return { status: 'ready', value: { goal, display, liveRuns: [], resumePending: [],
        sourceCursor: laterCursor(pending.readThrough, phaseRead.readThrough) } };
    }
    const facts = await readCanonicalTaskFacts(records, goalRef, plan);
    if (facts.status !== 'ready') return asReadResult(facts);
    let watermark: CommitCursor | null = facts.value.readThrough;
    if (!sameCursor(window.readThrough, watermark)) {
      const confirmed = await confirmActivePlan(records, goalRef, plan.ref);
      if (confirmed.status !== 'ready') return asReadResult(confirmed);
      watermark = confirmed.readThrough ?? watermark;
    }
    const phaseRead = await readGoalPhase(records, phaseRef);
    if (phaseRead.status !== 'ready') return asReadResult(phaseRead);
    watermark = laterCursor(watermark, phaseRead.readThrough);
    const phases = phasesOf(facts.value);
    const index = buildTaskRowIndex(plan);
    const rework = await taskRowReworkOf(records, facts.value, goal, automationPolicy(), deps.configurationFor);
    if ('status' in rework) return asReadResult(rework);
    const tasks: GoalDisplayTaskFactsV1[] = [];
    for (const task of plan.tasks) {
      const row = taskRow(plan, goalRef.goalId, facts.value, phases, index, task.taskId, rework);
      if (row === null) continue;
      tasks.push({ taskId: task.taskId, taskKind: task.taskKind, requirementLevel: task.requirementLevel,
        disposition: task.disposition, phase: row.effectivePhase, phaseCause: row.phaseCause ?? null,
        dispatchable: row.eligibility.eligible, failure: row.failure ?? null,
        reworkEntries: row.rework?.entries ?? [], coveredTaskIds: gateCoverage(plan, task) });
    }
    // The Runs of the active Plan's Tasks in plan order: the live ones are the fan-out set (§2.3).
    const planRuns = plan.tasks.flatMap((task) => facts.value.runsByTaskId.get(task.taskId) ?? []);
    const liveRuns = liveRunsOf(plan, facts.value);
    let resumePending: GoalResumePendingRunV1[] = [];
    if (goal.desiredState === 'active' && liveRuns.length > 0) {
      // A resumed Goal whose fan-out pause has not landed yet (or whose resume is still queued) keeps the Run visible.
      const intents = await readPointerIntents(records, liveRuns);
      if (intents.status !== 'ready') return asReadResult(intents);
      resumePending = liveRuns.flatMap((run) => {
        const intent = intents.intents.get(run.ref.runId);
        if (intent === undefined || !requestedByGoalFanOut(intent)) return [];
        if (intent.kind !== 'pause' && !(intent.kind === 'resume' && intent.status === 'queued')) return [];
        return [{ runRef: run.ref, intentRef: intent.ref, intentKind: intent.kind, status: intent.status }];
      });
    }
    let runStopInputs: GoalRunStopInputV1[] = [];
    if (goal.desiredState !== 'active') {
      const control = goal.desiredState === 'paused' ? 'pause' : 'cancel';
      const capability = capabilities[control];
      const selected = new Set([...facts.value.byTaskId.values()].flatMap((state) =>
        state.execution === null ? [] : [canonicalJson(state.execution as unknown as JsonValue)]));
      const shown = planRuns.filter((run) => run.status !== 'ended' || selected.has(canonicalJson(run.ref as unknown as JsonValue)));
      const intents = await readPointerIntents(records, shown);
      if (intents.status !== 'ready') return asReadResult(intents);
      const scope = { projectId: goalRef.projectId, workspaceId: goal.workspaceRef.workspaceId };
      runStopInputs = shown.map((run) => ({ run, pointedIntent: intents.intents.get(run.ref.runId) ?? null,
        fanOutIntentRef: controlIntentRefFor(GOAL_FAN_OUT_ACTOR, scope,
          goalFanOutRequestId(goalRef, goal.desiredStateRevision, run.ref, control)),
        // D-7: the platform pauses or cancels a Run that never entered itself.
        capability: notEnteredEntryPhase(runControlNodeOf(run)) !== null ? { status: 'supported' as const } : capability }));
    }
    const display = reduceGoalDisplay({ desiredState: goal.desiredState, activePlanRef: plan.ref,
      completion: phaseRead.snapshot === null ? { status: 'not_recorded' } : { status: 'recorded',
        selectedPlanMatches: planRevisionRefKey(phaseRead.snapshot.planRef) === planRevisionRefKey(plan.ref) },
      partialAcceptance: null, pendingProposal, tasks, runsByTaskId: facts.value.runsByTaskId, runStopInputs });
    return { status: 'ready', value: { goal, display, liveRuns: liveRuns.map((run) => run.ref), resumePending,
      sourceCursor: watermark } };
  }

  /**
   * A.2 step 5.5 (§2.3 受影响集合): the G7 fan-out set. One read window of the
   * Goal and its active Plan, then `readCanonicalTaskFacts(...).runsByTaskId`
   * filtered to `starting|running`, confirmed against the active Plan as
   * `queryTaskGraph` does. The fan-out driver reads only this: a damaged
   * display-only fact (the pending candidate, the GoalPhase, the failure
   * facts) never keeps a committed Goal control from reaching its Runs.
   */
  async function queryGoalLiveRuns(ctx: CoreCallContext, input: { goalRef: GoalRef }): Promise<ReadResult<GoalLiveRunsRead>> {
    if (ctx?.signal?.aborted) return rejected('cancelled', 'queryGoalLiveRuns was cancelled');
    if (!isRecord(input) || !isRecord(input.goalRef) || !nonEmpty(input.goalRef['projectId'])) {
      return rejected('invalid', 'queryGoalLiveRuns requires a full GoalRef');
    }
    const goalRef = goalRefFromUnknown(input.goalRef, input.goalRef['projectId']);
    if (goalRef === null) return rejected('invalid', 'queryGoalLiveRuns requires a full GoalRef');
    const authority = authorizeReadContext(ctx, goalRef.projectId);
    if (authority.status !== 'ok') return authority;
    const window = await readGoalPlanWindow(records, goalRef);
    if (window.status !== 'ready') return asReadResult(window);
    const scopeError = authorizeGoal(authority.principal, window.goal);
    if (scopeError !== null) return scopeError;
    if (window.plan === null) return { status: 'ready', value: { goal: window.goal, liveRuns: [], sourceCursor: window.readThrough } };
    const facts = await readCanonicalTaskFacts(records, goalRef, window.plan);
    if (facts.status !== 'ready') return asReadResult(facts);
    let goal = window.goal;
    let watermark: CommitCursor | null = facts.value.readThrough;
    if (!sameCursor(window.readThrough, watermark)) {
      const confirmed = await confirmActivePlan(records, goalRef, window.plan.ref);
      if (confirmed.status !== 'ready') return asReadResult(confirmed);
      goal = confirmed.goal;
      watermark = confirmed.readThrough ?? watermark;
    }
    return { status: 'ready', value: { goal, liveRuns: liveRunsOf(window.plan, facts.value).map((run) => run.ref),
      sourceCursor: watermark } };
  }

  /**
   * GOAL-29 (§2.3, C4; A.2 step 5.6): the selection `findGoalResumeContinuations`
   * makes over the active Plan's work Tasks: the selected Run, its pointer
   * intent and whether a TaskRequeue covers it, read in one fact window.
   */
  async function queryGoalResumeContinuations(
    ctx: CoreCallContext, input: { goalRef: GoalRef },
  ): Promise<ReadResult<GoalResumeContinuationsRead>> {
    if (ctx?.signal?.aborted) return rejected('cancelled', 'queryGoalResumeContinuations was cancelled');
    if (!isRecord(input) || !isRecord(input.goalRef) || !nonEmpty(input.goalRef['projectId'])) {
      return rejected('invalid', 'queryGoalResumeContinuations requires a full GoalRef');
    }
    const goalRef = goalRefFromUnknown(input.goalRef, input.goalRef['projectId']);
    if (goalRef === null) return rejected('invalid', 'queryGoalResumeContinuations requires a full GoalRef');
    const authority = authorizeReadContext(ctx, goalRef.projectId);
    if (authority.status !== 'ok') return authority;
    const window = await readGoalPlanWindow(records, goalRef);
    if (window.status !== 'ready') return asReadResult(window);
    const scopeError = authorizeGoal(authority.principal, window.goal);
    if (scopeError !== null) return scopeError;
    const goal = window.goal;
    if (window.plan === null || goal.desiredState !== 'active') return { status: 'ready', value: { goal, continuations: [] } };
    const plan = window.plan;
    const facts = await readCanonicalTaskFacts(records, goalRef, plan);
    if (facts.status !== 'ready') return asReadResult(facts);
    const selected = plan.tasks.flatMap((task) => {
      const state = facts.value.byTaskId.get(task.taskId);
      const runs = facts.value.runsByTaskId.get(task.taskId) ?? [];
      const run = state?.execution === null || state === undefined ? null
        : runs.find((candidate) => sameJson(candidate.ref, state.execution)) ?? null;
      return [{ task, state, run }];
    });
    const intents = await readPointerIntents(records, selected.flatMap((entry) => entry.run === null ? [] : [entry.run]));
    if (intents.status !== 'ready') return asReadResult(intents);
    const scope = { projectId: goalRef.projectId, workspaceId: goal.workspaceRef.workspaceId };
    const continuations = findGoalResumeContinuations({
      goal, fanOutIntentRefFor: (requestId) => controlIntentRefFor(GOAL_FAN_OUT_ACTOR, scope, requestId),
      tasks: selected.map(({ task, state, run }) => ({ taskId: task.taskId, taskKind: task.taskKind, selectedRun: run,
        pointerIntent: run === null ? null : intents.intents.get(run.ref.runId) ?? null, covered: state?.requeueRef != null })),
    });
    return { status: 'ready', value: { goal, continuations: continuations.map((continuation) => ({ ...continuation,
      afterRunRevision: selected.find((entry) => entry.run !== null && sameJson(entry.run.ref, continuation.afterRunRef))?.run?.revision ?? 0 })) } };
  }

  /**
   * L4: the read-only committed-receipt lookup the `propose_future_plan`
   * owner publishes. It reuses `proposePlanAsAgent`'s Agent identity (the
   * formal session-derived actor) and its fingerprint, rebuilding the request
   * from the Kernel-recorded arguments alone; it never writes and never reads
   * any business fact beyond the idempotency row.
   */
  async function lookupToolCommit(ctx: CoreCallContext, input: ToolCommitLookupInput): Promise<ToolCommitLookupResult> {
    void ctx;
    if (input.toolName !== 'propose_future_plan') return toolCommitLookupUnknownTool(input.toolName);
    const raw = input.arguments;
    if (!isRecord(raw) || !isRecord(raw['draft']) || !isRecord(raw['reason'])) {
      return { status: 'undetermined', reason: 'invalid_arguments' };
    }
    const origin = input.origin;
    const goalRef = goalRefFromUnknown({
      aggregateType: 'Goal', projectId: origin.runRef.projectId, goalId: origin.runRef.goalId,
    }, origin.runRef.projectId);
    if (goalRef === null) return { status: 'undetermined', reason: 'invalid_origin' };
    const requestId = toolCommitRequestId(input);
    const actor = agentActorOf(origin.sessionRef, origin.runRef);
    const expectedPins = orderedPlanPins(raw['expected']);
    const identityKey = PLAN_PROPOSE_IDENTITY_PREFIX + commandIdentityKey({
      projectId: origin.runRef.projectId, actor, idempotencyKey: requestId,
    });
    const fingerprint = agentCommandFingerprint('PlanProposeAgent', {
      projectId: origin.runRef.projectId, workspaceId: origin.workspaceId, goalRef,
      basedOn: raw['basedOn'], draft: raw['draft'], reason: raw['reason'], expected: expectedPins,
      requestRef: null, replaces: null,
    });
    let lookup: Awaited<ReturnType<GoalRecordTransactionPort['lookupCommit']>>;
    try {
      lookup = await records.lookupCommit({ identityKey, fingerprint });
    } catch {
      return { status: 'undetermined', reason: 'the plan receipt lookup failed' };
    }
    return toolCommitLookupResult(lookup);
  }

  return { queryGoal, readPlanProposal, proposePlan, applyPlanChange, proposeInitialPlanFromAnswer,
    readInitialPlanAnswerFacts,
    queryTaskGraph, queryReadyTasks, queryGoalDisplay, queryGoalLiveRuns, queryGoalResumeContinuations,
    lookupToolCommit };
}

/**
 * Slice 5 §3.3 RequestCandidatePort (F30): the per-request candidate head read
 * and the abandon write. It is a named factory that uses the SAME Plan owner
 * dependencies, so the request-slot commit compiles without a second plan
 * service; the factory never throws.
 */
export function createRequestCandidateService(deps: PlanServiceDependencies): RequestCandidatePort {
  const { records } = deps;
  /** Slice 5 §2.6: the same transitional request-facts seam the plan service uses. */
  const requestFactsReader = createCandidateRequestFactsReader({ records });

  return {
    async readRequestCandidate(ctx: CoreCallContext, input: { goalRef: GoalRef; requestRef: QueryJobRef }) {
      if (input.goalRef.projectId !== ctx.projectId) return forbidden('the Goal belongs to another project');
      // Rule 1/RC10: another workspace is refused BEFORE any foreign record read.
      if (input.requestRef.projectId !== ctx.projectId || input.requestRef.workspaceId !== ctx.workspaceId) {
        return forbidden('the request belongs to another project or workspace');
      }
      const goalRead = await readGoal(records, input.goalRef);
      if (goalRead.status !== 'ready') return asReadResult(goalRead);
      if (goalRead.goal.workspaceRef.workspaceId !== ctx.workspaceId) {
        return forbidden('the Goal belongs to another workspace');
      }
      // §3.1/§3.3 request facts: a same-workspace request that does not exist is
      // `not_found`, never a `{head:null,status:'closed'}` result.
      const factsRead = await requestFactsReader.readCandidateRequestFacts(ctx,
        { requestRef: input.requestRef, goalRef: input.goalRef });
      if (factsRead.status !== 'ready') {
        if (factsRead.status === 'not_found') return { status: 'not_found' };
        if (factsRead.status === 'rejected') return { status: 'rejected', code: factsRead.code, reason: factsRead.reason };
        return rejected('incomplete', 'the request facts are unavailable');
      }
      if (!factsRead.value.root) return { status: 'not_found' };
      const headRead = await readRequestCandidateHead(records, { goalRef: input.goalRef, requestRef: input.requestRef });
      if (headRead.status !== 'ready') return asReadResult(headRead);
      const head = headRead.head;
      if (head === null) {
        return { status: 'ready', value: { head: null, status: 'closed', closedReason: null } };
      }
      const verdict = derivePlanProposalReadVerdict(head, goalRead.goal.activePlanRevision, goalRead.goal.desiredState);
      return { status: 'ready', value: { head, status: verdict.status, closedReason: verdict.closedReason } };
    },

    async abandonPlanProposal(ctx: CoreCallContext, request: GraphWrite<{ proposalRef: PlanProposalRef }>) {
      if (ctx?.signal?.aborted) return rejected('cancelled', 'the plan proposal abandonment was cancelled before admission');
      const owned = ownJsonInput(request, 'abandonPlanProposal request');
      if (owned.status === 'invalid') return rejected('invalid', owned.reason);
      const body = owned.value as unknown as { input?: unknown; meta?: unknown } | undefined;
      const rawInput = body?.input;
      const rawMeta = body?.meta;
      if (!isRecord(rawInput) || !isRecord(rawMeta)) {
        return rejected('invalid', 'abandonPlanProposal requires an input and meta object');
      }
      const proposalRef = planProposalRefFromUnknown(rawInput['proposalRef']);
      if (proposalRef === null) return rejected('invalid', 'abandonPlanProposal requires a full PlanProposalRef');
      const requestId = rawMeta['requestId'];
      if (!nonEmpty(requestId)) return rejected('invalid', 'abandonPlanProposal requires meta.requestId');
      const expectedProposalRevision = proposalRevisionPinOf(rawMeta['expected'], proposalRef);
      if (expectedProposalRevision === null) {
        return rejected('invalid', 'abandonPlanProposal requires the proposal pin in meta.expected');
      }
      const bound = boundWriteActor(ctx, proposalRef.projectId, proposalRef.workspaceId);
      if (bound.status !== 'ok') return rejected(bound.code, bound.reason);
      if (bound.aborted) return rejected('cancelled', 'the plan proposal abandonment was cancelled before admission');
      const actor = bound.actor;

      const pins = normalizeCallerPlanPins({ projectId: proposalRef.projectId, workspaceId: proposalRef.workspaceId },
        rawMeta['expected']);
      if (pins.status === 'invalid') return rejected('invalid', pins.reason);

      const identity = { projectId: proposalRef.projectId, actor, idempotencyKey: requestId };
      const identityKey = PLAN_ABANDON_IDENTITY_PREFIX + commandIdentityKey(identity);
      const fingerprint = sha256Hex(canonicalJson({ schemaVersion: 1, commandType: 'PlanAbandon',
        projectId: proposalRef.projectId, workspaceId: proposalRef.workspaceId, proposalRef,
        expectedProposalRevision, expected: orderedPlanPins(rawMeta['expected']) } as unknown as JsonValue));
      const receiptExpected = { identityKey, fingerprint, projectId: proposalRef.projectId,
        workspaceId: proposalRef.workspaceId, proposalId: proposalRef.proposalId, idempotencyKey: requestId, actor };

      const early = await records.lookupCommit({ identityKey, fingerprint });
      if (early.status === 'ready') {
        const restored = await restoreProposal(records, early.value, receiptExpected);
        if (restored.status !== 'restored') return rejected(restored.code, restored.reason);
        return { status: 'committed', value: restored.proposal, replayed: true, cursor: early.value.cursor };
      }
      if (early.code === 'idempotency_conflict') return rejected('idempotency_conflict', early.reason);
      if (early.code !== 'not_found') return rejected('unavailable', `${early.code}: ${early.reason}`);

      const proposalRead = await readProposal(records, proposalRef);
      if (proposalRead.status !== 'ready') return asWriteRejection(proposalRead, 'the proposal is unavailable');
      if (proposalRead.proposal.kind !== 'candidate_v2') {
        return rejected('unsupported', 'a legacy v1 proposal cannot be abandoned by a request candidate');
      }
      const proposal = proposalRead.proposal;
      // Slice 5 §2.5/T-R2-2: an abandon rewrites the same proposal; it copies
      // the preserved creation origin and never rebinds.
      const proposalOrigin = await readProposalOrigin(records, proposalRef);
      if (proposalOrigin.status !== 'ready') return asWriteRejection(proposalOrigin, 'the proposal origin is unavailable');
      const requestRef = candidateRequestRef(proposal);
      const scoped = await readPlanScope(records, proposal.goalRef, proposalRef.workspaceId, pins.pins);
      if (scoped.status !== 'ready') return scoped;
      // §3.3 line 625: `abandon` pins exactly the proposal and the Goal.
      if (!Array.isArray(rawMeta['expected']) || rawMeta['expected'].length !== 2
        || pins.pins.goal === undefined || pins.pins.goal === null) {
        return rejected('invalid', 'abandonPlanProposal requires exactly the proposal and Goal pins in meta.expected');
      }
      const suppliedGoalPin = (rawMeta['expected'] as unknown[]).find((entry) =>
        isRecord(entry) && isRecord(entry['ref']) && entry['ref']['aggregateType'] === 'Goal'
        && refKeyOf(entry['ref']) === refKeyOf(proposal.goalRef));
      if (suppliedGoalPin === undefined) {
        return rejected('invalid', 'abandonPlanProposal requires the proposal Goal pin in meta.expected');
      }
      // §3.3 line 625 + "source.pins 用于 CAS": the supplied accepted Goal pin is
      // the CAS basis, so a value that disagrees with the Goal read in this call
      // is `revision_conflict` and writes nothing (a malformed/absent pin is the
      // `invalid` above).
      if (pins.pins.goal !== scoped.scope.goal.revision) {
        return { status: 'rejected', code: 'revision_conflict', reason: 'the Goal changed since it was read',
          current: [{ ref: proposal.goalRef, revision: scoped.scope.goal.revision }] };
      }

      let requestGuards: readonly RecordGuard[] = [];
      if (requestRef !== null) {
        const factsRead = await requestFactsReader.readCandidateRequestFacts(ctx, { requestRef, goalRef: proposal.goalRef });
        if (factsRead.status !== 'ready') return asWriteRejection(factsRead, 'the request facts are unavailable');
        if (!factsRead.value.root) return rejected('invalid', 'the requestRef root does not belong to this Goal');
        requestGuards = factsRead.value.guards;
      }
      const goalNotCancelled = scoped.scope.goal.desiredState !== 'cancelled';
      const headPinMatches = proposal.revision === expectedProposalRevision;
      // Slice 5 §3.1 S5-PLAN-04/§3.2: only the configured operator may abandon a
      // request candidate; the fact is never hardcoded (`boundWriteActor` above
      // already bound the trusted Host actor).
      const operatorMatches = hostOperatorMatches(deps.operatorActor, actor, true);
      const guardCtx: PlanProposalGuardContext = { ...scoped.facts, agentAdmission: null, source: null, modules: null,
        initial: null, future: null, requestCandidate: requestCandidateFacts({ operatorMatches, headPinMatches,
          goalNotCancelled, replacesIsNull: true }) };
      const decided = transitionPlanProposal(proposal, { type: 'proposal_abandoned', proposalRef,
        requestedBy: actor, at: deps.now(), expectedProposalRevision, requestRef }, guardCtx);
      if (!decided.ok) return refusalOf(decided);
      const commit = planCommitOf(decided, { scope: scoped.scope, actor });
      if (commit.status !== 'ready') return commit;
      const abandoned = commit.proposal;
      const derived = deriveCommandIds(identity, 'plan-abandon');
      const event: PlanProposalRecordedEvent = {
        eventId: deps.eventId(), eventType: 'PlanProposalRecorded', schemaVersion: 2,
        projectId: proposalRef.projectId, workspaceId: proposalRef.workspaceId, aggregateType: 'PlanProposal',
        aggregateId: proposalRef.proposalId, aggregateRevision: abandoned.revision,
        causationId: derived.commandId, correlationId: derived.correlationId, idempotencyKey: requestId,
        actor, occurredAt: deps.now(), payload: { proposal: abandoned },
      };
      const merged = mergeGuards([...commit.guards, ...requestGuards]);
      if (!merged.ok) return merged.rejection;
      const claims: UniqueClaimChange[] = commit.requestSlot === null ? [] : [requestSlotClaim(commit.requestSlot)];
      const committed = await records.commit({ identityKey, fingerprint, guards: merged.guards,
        records: [encodePlanProposal(abandoned, proposalOrigin.origin)], claims, indexGuards: [], indexChanges: [],
        events: [encodePlanProposalRecordedEvent(event)] });
      if (committed.status !== 'committed') return mapRequestSlotCommitFailure(committed, claims.length > 0);
      if (!committed.replayed) return { status: 'committed', value: abandoned, replayed: false, cursor: committed.cursor };
      const restored = await restoreProposal(records, committed, receiptExpected);
      if (restored.status !== 'restored') return rejected(restored.code, restored.reason);
      return { status: 'committed', value: restored.proposal, replayed: true, cursor: committed.cursor };
    },
  };
}

/** The caller's `meta.expected` pin of one PlanProposal ref, or null when absent/malformed. */
function proposalRevisionPinOf(expected: unknown, proposalRef: PlanProposalRef): number | null {
  if (!Array.isArray(expected)) return null;
  const key = planProposalRefKey(proposalRef);
  for (const entry of expected as unknown[]) {
    if (!isRecord(entry) || refKeyOf(entry['ref']) !== key) continue;
    const revision = entry['revision'];
    if (typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 1) return revision;
    return null;
  }
  return null;
}

/** §2.3 受影响集合: the `starting|running` Runs of the active Plan's Tasks, in plan task order. */
function liveRunsOf(plan: PlanRevisionSnapshot, facts: CanonicalTaskFacts): RunSnapshot[] {
  return plan.tasks.flatMap((task) => facts.runsByTaskId.get(task.taskId) ?? [])
    .filter((run) => run.status === 'starting' || run.status === 'running');
}

/** The intent was submitted by the Host G7 fan-out (`GOAL_FAN_OUT_ACTOR`, §2.3 身份). */
function requestedByGoalFanOut(intent: ControlIntentSnapshotV1): boolean {
  return intent.requestedBy.kind === GOAL_FAN_OUT_ACTOR.kind && intent.requestedBy.id === GOAL_FAN_OUT_ACTOR.id;
}

/** The `entryControlCapabilities` input; absent is both supported, a malformed value null. */
function entryCapabilitiesOf(value: unknown): { pause: GoalRunControlCapabilityV1; cancel: GoalRunControlCapabilityV1 } | null {
  if (value === undefined) return { pause: { status: 'supported' }, cancel: { status: 'supported' } };
  if (!isRecord(value) || Object.keys(value).length !== 2) return null;
  const pause = entryCapabilityOf(value['pause']);
  const cancel = entryCapabilityOf(value['cancel']);
  return pause === null || cancel === null ? null : { pause, cancel };
}

/** One capability of `entryControlCapabilities`; a malformed value is null. */
function entryCapabilityOf(value: unknown): GoalRunControlCapabilityV1 | null {
  if (!isRecord(value)) return null;
  if (value['status'] === 'supported' && Object.keys(value).length === 1) return { status: 'supported' };
  if (value['status'] === 'unsupported' && nonEmpty(value['reason']) && Object.keys(value).length === 2) {
    return { status: 'unsupported', reason: value['reason'] };
  }
  return null;
}

/** GOAL-27 `awaiting_gate`: the work Tasks inside a gate's scope (goal: every one; stage: its stage; module: its module).
 * Delegates to the ONE `gateCoveredTaskIds` so the read model and GV-5 never diverge. */
function gateCoverage(plan: PlanRevisionSnapshot, gate: RuntimeTask): string[] {
  return gateCoveredTaskIds(plan.tasks, gate);
}

// --------------------------------------------------------------------------
// Delegated Agent admission seam
// --------------------------------------------------------------------------

/** True only for the formal work_run caller; Host/query-run keep the legacy path. */
function isWorkRunCaller(ctx: CoreCallContext): boolean {
  const principal = (ctx as unknown as { principal?: unknown } | null | undefined)?.principal;
  return isRecord(principal) && principal['kind'] === 'work_run';
}

type GoalScopeFacts = Extract<Awaited<ReturnType<typeof readGoalScope>>, { status: 'ready' }>;
type PinComparison = ReturnType<typeof compareCallerPlanPins>;

// --------------------------------------------------------------------------
// The plan machine (STATE-MACHINES-SPEC §3 PLAN-01..05, §2 GOAL-02/03)
// --------------------------------------------------------------------------

type AcceptedPlanEvent = Extract<PlanProposalEvent, { type: 'proposal_accepted' }>;
type MachineRefusalOf = Extract<MachineRefusal, { ok: false }>;
/** The scope facts of an adoption (and the Agent's fresh admission), read before its source or facts. */
type PlanAdoptionScope = Pick<PlanProposalGuardContext, 'goal' | 'goalInWorkspace' | 'pinsAgree' | 'agentAdmission'>;

/** A plan-machine refusal keeps its CoreError and text (§1.2); `current` is the versions today's refusal reported. */
function refusalOf(refused: MachineRefusalOf, current?: VersionPin[]): CoreRejection {
  return current === undefined ? rejected(refused.code, refused.detail)
    : { status: 'rejected', code: refused.code, reason: refused.detail, current };
}

/** The pin refusal (`stale` while the caller pins disagree) reports the versions read, as today. */
function pinsCurrent(refused: MachineRefusalOf, comparison: PinComparison): VersionPin[] | undefined {
  return refused.reason === 'stale' && comparison.status === 'conflict' ? comparison.current : undefined;
}

/**
 * The Goal scope one plan write reads (`readGoalScope`; its revisions become
 * the local CAS basis) and what the plan machine judges of it: the Goal, its
 * workspace and the caller pins.
 */
async function readPlanScope(
  records: GoalRecordTransactionPort,
  goalRef: GoalRef,
  workspaceId: string,
  pins: PlanPins,
): Promise<{ status: 'ready'; scope: GoalScopeFacts; comparison: PinComparison;
  facts: Pick<PlanProposalGuardContext, 'goal' | 'goalInWorkspace' | 'pinsAgree'> } | Rejection> {
  const scope = await readGoalScope(records, goalRef);
  if (scope.status !== 'ready') return scope;
  const comparison = compareCallerPlanPins({ projectId: goalRef.projectId, workspaceId, goalId: goalRef.goalId }, pins, scope);
  return { status: 'ready', scope, comparison, facts: {
    goal: { activePlanRevision: scope.goal.activePlanRevision, desiredState: scope.goal.desiredState },
    goalInWorkspace: scope.goal.workspaceRef.workspaceId === workspaceId,
    pinsAgree: comparison.status === 'ok',
  } };
}

function planSourceFactsOf(plan: PlanRevisionSnapshot): PlanSourceFacts {
  return { ref: plan.ref, goalRef: plan.goalRef, planId: plan.planId, planRevision: plan.planRevision };
}

/** L10: a draft's module fact against one catalog — `'ok'`, or the one `unknown_module` refusal. */
function moduleFactOf(draft: PlanRevisionDraft, catalog: AdoptedArchitecture): 'ok' | CoreRejection {
  const unknown = unknownModuleTasksOf(draft, catalog);
  return unknown.length === 0 ? 'ok' : unknownModuleRejection(unknown);
}

/**
 * L10: the one catalog read of a propose, after every other refusal point. An active catalog gives the candidate's
 * pin and the module fact; none defers the check to adoption (`null` pin); a refused read is the fact itself and pins
 * nothing, never read as "no catalog".
 */
async function proposeCatalogFacts(records: GoalRecordTransactionPort, projectId: string, draft: PlanRevisionDraft):
  Promise<{ catalogPin: ArchitectureCatalogPinV1 | null; modules: 'ok' | CoreRejection }> {
  const window = await readCurrentCatalogWindow(records, projectId);
  if (window.status === 'not_found') return { catalogPin: null, modules: 'ok' };
  if (window.status !== 'ready') return { catalogPin: null, modules: rejected(window.code, window.reason) };
  return { catalogPin: catalogPinOf(window), modules: moduleFactOf(draft, window.catalog.catalog) };
}

/** What a plan commit's effects name beyond the machine's own records: the scope read, the adopter, the guards read. */
type PlanCommitSources = {
  scope: GoalScopeFacts;
  /** The adopter (§1.3) of a `move_goal_pointer`; GOAL-02/03 do not read it. */
  actor: ActorRef;
  answerFacts?: readonly RecordGuard[];
  agentAdmission?: readonly RecordGuard[];
  originSources?: readonly RecordGuard[];
  governance?: readonly RecordGuard[];
  pinnedPolicy?: readonly RecordGuard[];
  /** L10: the active catalog window's guards a future adoption with a module-scoped task read. */
  catalog?: readonly RecordGuard[];
  /** C7: what the Task machine reads for each `change_task_disposition`, and the guards of the facts read. */
  disposition?: AdoptionDispositionFacts;
};

/**
 * C7 (TASK-18/19, guard 9): the facts a future adoption read for its
 * disposition changes and its carriers. `tasks` holds, per Task whose
 * disposition changes, its source definition, its projection input and its
 * facts (an untraced changed Task: the empty facts the untraced rule proved);
 * `taskGuards` / `carrierGuards` the record guards of each Task read by
 * `readDispositionChangeTaskFacts` for TASK-19 and guard 9.
 */
type AdoptionDispositionFacts = {
  goalDesiredState: GoalDesiredState;
  affectedTaskIds: readonly string[] | undefined;
  adopterClass: ReworkActorClass;
  tasks: ReadonlyMap<string, { definition: RuntimeTask; phase: TaskPhaseFacts; facts: TracedTaskFactsV1 }>;
  taskGuards: ReadonlyMap<string, readonly RecordGuard[]>;
  carrierGuards: ReadonlyMap<string, readonly RecordGuard[]>;
};

/** One plan commit as the state machines named it: a proposal (PLAN-01..03) moves no Goal and writes no Plan. */
type PlanCommit = Omit<PlanAdoptionCommit, 'nextGoal' | 'plan'> & {
  nextGoal: GoalSnapshot | null; plan: PlanRevisionWrite | null;
  /** S5-PLAN-02: the replaced old head's complete next record, written in the same commit. */
  replaced: CandidatePlanProposal | null;
  /** S5-PLAN-01..04: the request-slot unique claim change, compiled into the same commit. */
  requestSlot: Extract<PlanProposalEffect, { kind: 'request_slot' }> | null;
};

/**
 * The one commit a plan transition names, read off its effects (§3.3 effects
 * column): `write_proposal` is the machine's `next` (§14.1); `move_goal_pointer`
 * is GOAL-02/03 of the Goal machine, whose `nextGoalPointer` writes the moved
 * Goal; `change_task_disposition` (C7) is TASK-18/19 of the Task machine, whose
 * `record_disposition_change` is the compiler's `dispositionRecord` entry;
 * `write_plan_revision` is the new Plan the compiler builds; each `guard` is a
 * record guard of what this call read, in the machine's order. The events
 * (`append_event`) are built by the owner and the compiler.
 */
function planCommitOf(
  decided: Extract<PlanProposalTransition, { ok: true }>,
  sources: PlanCommitSources,
): ({ status: 'ready' } & PlanCommit) | CoreRejection {
  const proposal = decided.next;
  if (proposal === null || proposal.kind !== 'candidate_v2') throw new Error('a plan transition must write the candidate');
  let nextGoal: GoalSnapshot | null = null;
  let plan: PlanRevisionWrite | null = null;
  let replaced: CandidatePlanProposal | null = null;
  let requestSlot: Extract<PlanProposalEffect, { kind: 'request_slot' }> | null = null;
  const guards: RecordGuard[] = [];
  const dispositionChanges: PlannedDispositionChangeV1[] = [];
  for (const effect of decided.effects) {
    switch (effect.kind) {
      case 'write_proposal':
      case 'append_event':
        break;
      case 'write_plan_revision':
        plan = effect;
        break;
      case 'move_goal_pointer': {
        const moved = transitionGoal(goalStateOf(sources.scope.goal, null),
          { type: 'plan_adopted', basedOn: effect.from, target: effect.to },
          // Read only by goal_created / goal_completed; PLAN-04/05 judged the scope.
          { callerClass: reworkActorClassOf(null, sources.actor), scopePinsAgree: true, goalInWorkspace: true, completion: null });
        if (!moved.ok) return refusalOf(moved);
        if (moved.next.goal === null) throw new Error('plan_adopted must write the Goal');
        nextGoal = moved.next.goal;
        break;
      }
      case 'change_task_disposition': {
        const recorded = taskDispositionChange(effect.change, sources);
        if (typeof recorded !== 'boolean') return recorded;
        if (recorded) dispositionChanges.push(effect.change);
        break;
      }
      case 'guard':
        // S5-PLAN-02: the machine names both the old head's pin and the new
        // candidate's ∅ with one `proposal` guard target; the replaced record is
        // the non-null one. Every other guard names `next`.
        if (effect.guard.target === 'proposal' && effect.guard.expectedRevision !== null && replaced !== null) {
          guards.push({ refKey: planProposalRefKey(replaced.ref), expectedRevision: effect.guard.expectedRevision });
        } else {
          guards.push(...recordGuardsOf(effect.guard, proposal, sources));
        }
        break;
      // [lead S5-T3-D2] Slice 5 request-slot effects: the replaced old head and
      // the unique claim change, both compiled into this same commit.
      case 'write_replaced_proposal':
        replaced = effect.record;
        break;
      case 'request_slot':
        requestSlot = effect;
        break;
      default: {
        const unknown: never = effect;
        throw new Error(`unknown plan commit effect ${JSON.stringify(unknown)}`);
      }
    }
  }
  return { status: 'ready', proposal, nextGoal, plan, dispositionChanges, guards, replaced, requestSlot };
}

/**
 * C7: TASK-18 (untraced) / TASK-19 (traced) of the Task machine for one
 * `change_task_disposition` effect, over the facts the adoption read: `true`
 * when the Task machine records the change (`record_disposition_change`), its
 * refusal otherwise (the plan machine judged the same guards first).
 */
function taskDispositionChange(change: PlannedDispositionChangeV1, sources: PlanCommitSources): CoreRejection | boolean {
  const read = sources.disposition;
  if (read === undefined) throw new Error('the plan commit read no disposition-change facts');
  const task = read.tasks.get(change.taskId);
  if (task === undefined) throw new Error(`the disposition-change facts of task ${change.taskId} were not read`);
  const changed = transitionTask(taskMachineStateOf(task.definition, task.phase),
    { kind: 'disposition_changed', to: change.to, replacedByTaskId: change.replacedByTaskId, actorClass: read.adopterClass },
    { taskId: change.taskId, claim: null, completion: null, disposition: { facts: task.facts,
      goalDesiredState: read.goalDesiredState, affectedTaskIds: read.affectedTaskIds,
      replacedByTaskId: task.definition.replacedByTaskId ?? null } });
  if (!changed.ok) return refusalOf(changed);
  return changed.effects.some((effect) => effect.kind === 'record_disposition_change');
}

/** PLAN-04/05 name GOAL-02/03's pointer move and PLAN-08's new Plan; an adoption without them is a broken machine. */
function adoptionCommitOf(commit: PlanCommit): PlanAdoptionCommit {
  const { proposal, nextGoal, plan, dispositionChanges, guards } = commit;
  if (nextGoal === null || plan === null) throw new Error('a plan adoption moves the Goal pointer and writes its PlanRevision');
  return { proposal, nextGoal, plan, dispositionChanges, guards };
}

/** Slice 5 §2.4: a complete `PlanRequestCandidateFacts` with every unused fact neutral. */
function requestCandidateFacts(overrides: Partial<PlanRequestCandidateFacts>): PlanRequestCandidateFacts {
  return {
    requestRootSameGoal: true, replacesIsNull: true, slotExpectedOwnerIsNull: false,
    headMatches: false, headRevisionMatches: false, requestGoalMatches: true, replacesComplete: false,
    firstPlanUserOnly: true, slotOwnerMatches: false, basedOnIsActivePointer: false,
    operatorMatches: false, headPinMatches: false, goalNotCancelled: true,
    storedTerminalStatus: false, goalCancelled: false, basedOnDerivesStale: false,
    adoptionPolicy: null, ...overrides,
  };
}

/**
 * Slice 5 §3.2: the configured operator is never `actor.kind === 'human'`. A
 * request-candidate adoption/abandon compares the trusted Host actor with the
 * exact configured `operatorActor` when one is injected and excludes
 * `PLATFORM_AUTOMATION_ACTORS`; an Agent or query-run caller is never the
 * operator. An unconfigured composition treats the bound trusted Host actor as
 * that operator (the frozen fixtures bind it in `ctx`).
 */
function hostOperatorMatches(
  configured: PlanServiceDependencies['operatorActor'], actor: ActorRef, hostPrincipal: boolean,
): boolean {
  if (!hostPrincipal || isAutomationActor(actor)) return false;
  if (configured === undefined) return true;
  return configured.kind === actor.kind && configured.id === actor.id;
}

/**
 * Slice 5 §3.1 S5-PLAN-03/§3.2: the `decisionActionPolicy` verdict for this
 * adopting action and adopter (`adopt_first_plan` for a first plan,
 * `refine_future` for a future revision). `null` is reserved for the explicit
 * configured-operator adoption, which §3.2 never asks again.
 */
function adoptionPolicyOf(
  goal: GoalSnapshot, action: DecisionActionV1, actorClass: ReworkActorClass,
): PlanRequestCandidateFacts['adoptionPolicy'] {
  return decisionActionPolicy({
    autonomy: goal.settings.autonomy,
    action, actorClass, countedNext: null, cap: 0,
  });
}

/**
 * Slice 5 §2.4/T01: the ONE unique claim change of a request slot. Key =
 * `s5-request-candidate:` + canonicalJson({goalRef, requestRef}); owner = the
 * full proposal ref key. It adds no second claim protocol.
 */
function requestSlotClaim(effect: Extract<PlanProposalEffect, { kind: 'request_slot' }>): UniqueClaimChange {
  return {
    claimKey: `s5-request-candidate:${canonicalJson({ goalRef: effect.goalRef, requestRef: effect.requestRef } as unknown as JsonValue)}`,
    expectedOwner: effect.expectedOwner === null ? null : planProposalRefKey(effect.expectedOwner),
    nextOwner: effect.nextOwner === null ? null : planProposalRefKey(effect.nextOwner),
  };
}

/** One `guard` effect as the record guards of the record it names, at the version read in this call. */
function recordGuardsOf(guard: PlanCommitGuard, proposal: PlanCommit['proposal'], sources: PlanCommitSources): readonly RecordGuard[] {
  const named = (list: readonly RecordGuard[] | undefined): readonly RecordGuard[] => {
    if (list === undefined) throw new Error(`the plan commit read no ${guard.target} guards`);
    return list;
  };
  const { scope } = sources;
  switch (guard.target) {
    case 'answer_facts': return named(sources.answerFacts);
    case 'agent_admission': return named(sources.agentAdmission);
    case 'origin_sources': return named(sources.originSources);
    case 'governance': return named(sources.governance);
    case 'pinned_policy': return named(sources.pinnedPolicy);
    case 'catalog': return named(sources.catalog);
    case 'project': return [{ refKey: scope.projectKey, expectedRevision: scope.projectRevision }];
    case 'workspace': return [{ refKey: scope.workspaceKey, expectedRevision: scope.workspaceRevision }];
    case 'goal': return [{ refKey: refKeyOf(scope.goal.ref), expectedRevision: scope.goal.revision }];
    case 'proposal': return [{ refKey: planProposalRefKey(proposal.ref), expectedRevision: guard.expectedRevision }];
    case 'plan_revision': return [{ refKey: planRevisionRefKey(guard.ref), expectedRevision: guard.expectedRevision }];
    case 'task_record_absent':
      return [{ refKey: taskRecordRefKey(guard.record, scope.goal.ref, guard.taskId), expectedRevision: null }];
    case 'task_facts':
    case 'carrier_facts': {
      const read = sources.disposition;
      const list = (guard.target === 'task_facts' ? read?.taskGuards : read?.carrierGuards)?.get(guard.taskId);
      if (list === undefined) throw new Error(`the plan commit read no ${guard.target} guards of task ${guard.taskId}`);
      return list;
    }
    default: {
      const unknown: never = guard;
      throw new Error(`unknown plan commit guard ${JSON.stringify(unknown)}`);
    }
  }
}

/** What an adoption reads before its own facts: the candidate (the machine state) and its scope (the context). */
type AdoptionRead = {
  candidate: PlanCommit['proposal'];
  scope: GoalScopeFacts;
  adoptionScope: PlanAdoptionScope;
  /**
   * Slice 5 §2.5/T-R2-2: the accepted proposal's preserved creation origin, so
   * the adopt write copies `since` instead of dropping/rebinding it.
   */
  origin: NoticeOriginWireV1;
  /** The proposal read is the FIRST read of the window: the commit horizon. */
  horizon: CommitCursor | null;
};

/**
 * PLAN-04/05 up to the adopter's own reads, one implementation for the Host
 * and the Agent: read the proposal and ask (kind, status, revision; the Agent's
 * submission source), then read the real proposal Goal's scope with the
 * caller pins and ask again (workspace, pins; the initial pointer, or the
 * future draft schema and decisionRefs). A stale refusal reports what it read.
 */
async function readAdoption(
  records: GoalRecordTransactionPort & RecordLookupPort,
  adoption: AcceptedPlanEvent,
  agentAdmission: 'ok' | null,
  expected: unknown,
): Promise<({ status: 'ready' } & AdoptionRead) | CoreRejection> {
  const proposalRef = adoption.proposalRef;
  const proposalRead = await readProposal(records, proposalRef);
  if (proposalRead.status !== 'ready') return proposalRead;
  const proposal = proposalRead.proposal;
  let refused = planProposalProblem(proposal, adoption, { agentAdmission });
  if (refused?.ok === false) {
    return refusalOf(refused, refused.reason === 'stale' ? [{ ref: proposalRef, revision: proposal.revision }] : undefined);
  }
  // Slice 5 §2.5/T-R2-2: the accepted write copies this preserved origin.
  const originRead = await readProposalOrigin(records, proposalRef);
  if (originRead.status !== 'ready') return originRead;
  const pins = normalizeCallerPlanPins({ projectId: proposalRef.projectId, workspaceId: proposalRef.workspaceId,
    goalId: proposal.goalRef.goalId }, expected);
  if (pins.status === 'invalid') return rejected('invalid', pins.reason);
  const scoped = await readPlanScope(records, proposal.goalRef, proposalRef.workspaceId, pins.pins);
  if (scoped.status !== 'ready') return scoped;
  const adoptionScope: PlanAdoptionScope = { ...scoped.facts, agentAdmission };
  refused = planProposalProblem(proposal, adoption, adoptionScope);
  if (refused?.ok === false) {
    // A stale refusal is the pins' (they come first) or the initial pointer's; each reports what it read.
    const active = scoped.scope.goal.activePlanRevision;
    return refusalOf(refused, pinsCurrent(refused, scoped.comparison)
      ?? (refused.reason === 'stale' && active !== null ? [{ ref: active, revision: 1 }] : undefined));
  }
  return { status: 'ready', candidate: proposal, scope: scoped.scope, adoptionScope, origin: originRead.origin,
    horizon: proposalRead.readThrough ?? scoped.scope.readThrough };
}

/** PLAN-04/05 over the adoption facts read so far: each read joins them and the machine is asked again. */
function adoptionAsk<F extends object>(candidate: PlanCommit['proposal'], adoption: AcceptedPlanEvent,
  contextOf: (facts: Partial<F>) => PlanProposalReadFacts): (read: Partial<F>) => MachineRefusalOf | null {
  const facts: Partial<F> = {};
  return (read) => {
    const refused = planProposalProblem(candidate, adoption, contextOf(Object.assign(facts, read)));
    return refused?.ok === false ? refused : null;
  };
}

/** The original plan-apply command (Host or Agent): its receipt identity also names its commit and event. */
type ApplyReceipt = { identityKey: string; fingerprint: string; projectId: string; workspaceId: string;
  idempotencyKey: string; actor: ActorRef };

/**
 * The ONE future-adoption orchestration shared by the Host and Agent apply
 * paths (PLAN-05 + GOAL-03). The caller has read the proposal and the scope
 * (`readAdoption`); this reads the real source, the target, the pinned policy
 * and the touched Task facts, asking the plan machine after each read with the
 * existing validators' verdicts, merges the caller's admission guards with the
 * exact local CAS guards the machine names, and performs the single
 * `compileFuturePlanAdoption` commit. Only the original command (`receipt`:
 * actor, identity, fingerprint) and the admission guards differ; the Host
 * initial path and both propose paths are separate.
 */
async function applyFutureRevision(input: {
  records: GoalRecordTransactionPort & RecordLookupPort;
  /** Judged by the caller already (scope; draft schema and decisionRefs). */
  read: AdoptionRead;
  adoption: AcceptedPlanEvent;
  receipt: ApplyReceipt;
  /** The caller's principal (Host or work Run), for the adopter's rework class (C7). */
  principal: CorePrincipal;
  /** Slice 5 §3.2: the exact configured operator, or absent (the trusted Host actor). */
  operatorActor?: PlanServiceDependencies['operatorActor'];
  /** The Agent's fresh admission guards (`agent_admission`); none for the Host. */
  extraGuards: readonly RecordGuard[];
  preCommitSignal: AbortSignal | null;
  eventId: () => string;
  now: () => string;
  /** Slice 5 §2.8 D8: the accepted event's acknowledgement attribution/proof, or null. */
  decisionProof?: PlanAcceptanceDecisionProofV1 | null;
}): Promise<WriteResult<PlanRevisionSnapshot>> {
  const { records, adoption, receipt } = input;
  const { actor } = receipt;
  const { candidate: proposal, scope: goalScope, adoptionScope } = input.read;
  const proposalRef = adoption.proposalRef;
  // The Host branched on basedOn; PLAN-05 refused an Agent candidate without one.
  const sourceRead = await readPlan(records, proposal.basedOn!);
  if (sourceRead.status !== 'ready') return sourceRead;
  const source = sourceRead.plan;
  const sourceFacts = planSourceFactsOf(source);
  // PLAN-05 over the facts read so far: the scope, the source, then each `future` fact as it is read.
  const ask = adoptionAsk<FutureAdoptionFacts>(proposal, adoption, (future) => ({ ...adoptionScope, source: sourceFacts, future }));
  let refused = ask({});
  if (refused !== null) {
    // A stale source refusal is "not the active plan" (PLAN-09: the source reads as superseded), which
    // reports the source (today's `current`), or "not source+1".
    const superseded = derivePlanRevisionStatus(source.ref, goalScope.goal.activePlanRevision) === 'superseded';
    return refusalOf(refused, refused.reason === 'stale' && superseded
      ? [{ ref: source.ref, revision: source.revision }] : undefined);
  }
  const targetRef = planRevisionTargetOf(proposalRef, proposal.draft);
  const targetRead = await readPlan(records, targetRef);
  if (targetRead.status !== 'ready' && targetRead.code !== 'not_found') return targetRead;
  const targetExists = targetRead.status === 'ready';
  refused = ask({ targetExists });
  if (refused !== null) {
    return refusalOf(refused, targetRead.status === 'ready' ? [{ ref: targetRef, revision: targetRead.plan.revision }] : undefined);
  }

  // The intent/role/gate future-only rules run before the generic completeness
  // gate so an omitted source intent is `invalid`, not masked by `incomplete`.
  const deltaResult = deriveFuturePlanDelta(source, proposal.draft);
  const delta: FuturePlanDeltaVerdict = deltaResult.status === 'supported'
    ? { status: 'supported', changedTaskIds: deltaResult.delta.changedTaskIds, addedTaskIds: deltaResult.delta.addedTaskIds,
      dispositionOnlyTaskIds: deltaResult.delta.dispositionOnlyTaskIds, dispositionChanges: deltaResult.delta.dispositionChanges,
      carrierRemovals: deltaResult.delta.carrierRemovals }
    : deltaResult;
  refused = ask({ delta });
  if (refused !== null) return refusalOf(refused);
  // PLAN-05 refused an unsupported delta above.
  const supported = deltaResult.status === 'supported' ? deltaResult.delta : null;
  const coverage = validateFutureObligationCoverage({ source, target: proposal.draft, delta: supported! });
  refused = ask({ coverage });
  if (refused !== null) return refusalOf(refused);

  // Only a genuinely NEW obligationId reads the SOURCE PLAN's exact pinned
  // policy (ref + digest); its local record guard joins this one commit. No new
  // obligation means NO policy read: existing commitments are protected
  // structurally. Propose keeps its opportunistic current-policy diagnosis.
  const sourceObligationIds = new Set(source.obligations.map((obligation) => obligation.obligationId));
  const hasNewObligation = proposal.draft.obligations
    .some((obligation) => !sourceObligationIds.has(obligation.obligationId));
  let pinnedPolicy: FutureAdoptionFacts['pinnedPolicy'] = 'not_needed';
  let pinnedPolicyContent: CompletionPolicyContentV1 | null = null;
  let pinnedPolicyGuards: readonly RecordGuard[] = [];
  if (hasNewObligation) {
    const pinned = await readPinnedCompletionPolicy(records, source.effectiveCompletionPolicy);
    if (pinned.status === 'resolved') {
      pinnedPolicy = 'ok';
      pinnedPolicyContent = pinned.policyContent;
      pinnedPolicyGuards = pinned.guards;
    } else {
      pinnedPolicy = rejected(pinned.code, pinned.reason);
    }
  }
  refused = ask({ pinnedPolicy });
  if (refused !== null) return refusalOf(refused);
  // L10: every module-scoped task of the new draft, future intents included, against the catalog active now; the
  // window's guards join the commit, so a pointer that moves before it commits is a revision conflict.
  let modules: 'ok' | CoreRejection = 'ok';
  let catalogGuards: readonly RecordGuard[] | undefined;
  if (draftHasModuleTask(proposal.draft)) {
    const window = await readCurrentCatalogWindow(records, proposal.goalRef.projectId);
    if (window.status === 'ready') {
      modules = moduleFactOf(proposal.draft, window.catalog.catalog);
      catalogGuards = window.guards;
    } else if (window.status === 'not_found') {
      modules = rejected('incomplete', 'the project has no active architecture catalog');
    } else modules = rejected(window.code, window.reason);
  }
  refused = ask({ modules });
  if (refused !== null) return refusalOf(refused);
  // The draft validators run one after the other, each only once the one before it holds.
  const draftIssues = validatePlanDraft(proposal.draft, pinnedPolicyContent);
  refused = ask({ draftIssues });
  if (refused !== null) return refusalOf(refused);
  const assignmentReasons = validatePlanAssignments(proposal.draft);
  refused = ask({ assignmentReasons });
  if (refused !== null) return refusalOf(refused);
  const phaseReasons = planPhaseGuardReasons(proposal.draft.tasks);
  refused = ask({ phaseReasons });
  if (refused !== null) return refusalOf(refused);

  const touchedTaskIds = [...supported!.changedTaskIds, ...supported!.addedTaskIds];
  const futureFacts = await readFutureChangeTaskFacts(records, proposal.goalRef, source, touchedTaskIds);
  if (futureFacts.status !== 'ready') return futureFacts;
  // The untraced rule judges the changed and added Tasks before any disposition-only read.
  refused = ask({ touchedTaskFacts: futureFacts.value.tasks });
  if (refused !== null) return refusalOf(refused);
  // C7 (TASK-19): the disposition-only Tasks' facts, judged with the adopter's class (§1 `reworkActorClassOf`:
  // an Agent apply is `agent`, a Host automation actor `system`, any other Host actor `human`; an actor
  // that is not the principal's own has none).
  const adopterClass = reworkActorClassOf(input.principal, actor);
  if (adopterClass === null) return rejected('forbidden', 'the plan adopter has no rework actor class');
  const dispositionRead = await readDispositionChangeTaskFacts(records, proposal.goalRef, source, supported!.dispositionOnlyTaskIds);
  if (dispositionRead.status !== 'ready') return dispositionRead;
  const dispositionTaskFacts = dispositionRead.tasks.map((entry) => entry.facts);
  refused = ask({ adopterClass, dispositionTaskFacts });
  if (refused !== null) return refusalOf(refused);
  // Guard 9 (LA-3): an `agent`/`system` adopter reads the existing active work carriers of each source
  // obligation that gains a new one; an operator adoption reads none.
  const sourceCarriers: PlanCarrierViewV1 = { tasks: source.tasks, obligations: source.obligations };
  let carrierRead: DispositionChangeTaskFacts[] = [];
  if (adopterClass !== 'human') {
    const carrierIds = parallelCarrierFactTaskIds({ source: sourceCarriers,
      target: { tasks: proposal.draft.tasks, obligations: proposal.draft.obligations } });
    const read = await readDispositionChangeTaskFacts(records, proposal.goalRef, source, carrierIds);
    if (read.status !== 'ready') return read;
    carrierRead = read.tasks;
  }
  const carrierFacts = carrierRead.map((entry) => entry.facts);
  // Slice 5 §2.4/§3.1 S5-PLAN-03 and §3.2 S5-AU-03: the request-slot ownership
  // and the `refine_future` autonomy verdict are judged for EVERY future
  // candidate, request-associated or not; a person's explicit adoption keeps
  // its existing rights (`adoptionPolicy` is asked only of a non-operator).
  const requestRef = candidateRequestRef(proposal);
  let requestSlot: PlanRequestSlotChangeV1 | null = null;
  let slotOwnerMatches = true;
  if (requestRef !== null) {
    const headRead = await readRequestCandidateHead(records, { goalRef: proposal.goalRef, requestRef });
    if (headRead.status !== 'ready') return asWriteRejection(headRead, 'the request head is unavailable');
    slotOwnerMatches = headRead.head !== null
      && planProposalRefKey(headRead.head.ref) === planProposalRefKey(proposal.ref);
  }
  const basedOnIsActivePointer = proposal.basedOn === null
    ? goalScope.goal.activePlanRevision === null
    : goalScope.goal.activePlanRevision !== null
      && refKeyOf(proposal.basedOn) === refKeyOf(goalScope.goal.activePlanRevision);
  const operatorMatches = hostOperatorMatches(input.operatorActor, actor, input.principal.kind === 'host');
  const requestFacts: PlanRequestCandidateFacts = requestCandidateFacts({ replacesIsNull: true, basedOnIsActivePointer,
    firstPlanUserOnly: true, slotOwnerMatches, operatorMatches,
    goalNotCancelled: goalScope.goal.desiredState !== 'cancelled',
    adoptionPolicy: adopterClass !== 'human' && !operatorMatches
      ? adoptionPolicyOf(goalScope.goal, 'refine_future', adopterClass) : null });
  const adoptedEvent: PlanProposalEvent = { ...adoption, type: 'proposal_adopted', requestRef };
  // PLAN-05 (the untraced rule, TASK-19 and guard 9 judge the facts just read) + GOAL-03: the
  // accepted candidate, the moved Goal and the guards of the one commit.
  const decided = transitionPlanProposal(proposal, adoptedEvent, { ...adoptionScope, source: sourceFacts, modules: null,
    initial: null, requestCandidate: requestFacts,
    future: { targetExists, delta, coverage, pinnedPolicy, modules, draftIssues, assignmentReasons, phaseReasons,
      touchedTaskFacts: futureFacts.value.tasks, adopterClass, dispositionTaskFacts, sourceCarriers, carrierFacts } });
  if (!decided.ok) return refusalOf(decided);
  const commit = planCommitOf(decided, { scope: goalScope, actor,
    agentAdmission: input.extraGuards, pinnedPolicy: pinnedPolicyGuards,
    ...(catalogGuards === undefined ? {} : { catalog: catalogGuards }),
    disposition: adoptionDispositionFacts({ source, delta: supported!, read: dispositionRead.tasks, carriers: carrierRead,
      goalDesiredState: goalScope.goal.desiredState, affectedTaskIds: proposal.reason.affectedTaskIds, adopterClass }) });
  if (commit.status !== 'ready') return commit;
  if (commit.requestSlot !== null) requestSlot = { requestRef, claim: requestSlotClaim(commit.requestSlot) };
  // mergeGuards keeps first occurrences in order, so the target Plan ∅ guard stays last.
  const merged = mergeGuards(commit.guards);
  if (!merged.ok) return merged.rejection;
  if (input.preCommitSignal !== null && input.preCommitSignal.aborted) {
    return rejected('cancelled', 'the plan adoption was cancelled before commit');
  }
  const derived = deriveCommandIds({ projectId: receipt.projectId, actor, idempotencyKey: receipt.idempotencyKey }, 'plan-apply');
  const compiled = compileFuturePlanAdoption({
    commit: { ...adoptionCommitOf(commit), guards: merged.guards },
    source,
    identityKey: receipt.identityKey,
    fingerprint: receipt.fingerprint,
    eventId: input.eventId(),
    occurredAt: input.now(),
    commandId: derived.commandId,
    correlationId: derived.correlationId,
    idempotencyKey: receipt.idempotencyKey,
    actor,
    requestSlot,
    decisionProof: input.decisionProof ?? null,
    origin: input.read.origin,
  });
  if (compiled.status !== 'compiled') return rejected('unsupported', compiled.reason);
  const committed = await records.commit(compiled.value.prepared);
  if (committed.status !== 'committed') return mapRequestSlotCommitFailure(committed, compiled.value.prepared.claims.length > 0);
  if (!committed.replayed) {
    return { status: 'committed', value: compiled.value.snapshot, replayed: false, cursor: committed.cursor };
  }
  const restored = await restoreAcceptedPlan(records, committed, receipt);
  if (restored.status !== 'restored') return rejected(restored.code, restored.reason);
  return { status: 'committed', value: restored.value, replayed: true, cursor: committed.cursor };
}

/**
 * C7: what `planCommitOf` gives the Task machine for each disposition change
 * (TASK-18/19), and the record guards of the Tasks read for TASK-19 and guard 9.
 * A changed Task whose disposition changes passed the untraced rule: it has no
 * Run, Lease or Reduction, so its facts are empty and it projects pending (P16).
 */
function adoptionDispositionFacts(input: {
  source: PlanRevisionSnapshot;
  delta: FuturePlanDelta;
  read: readonly DispositionChangeTaskFacts[];
  carriers: readonly DispositionChangeTaskFacts[];
  goalDesiredState: GoalDesiredState;
  affectedTaskIds: readonly string[] | undefined;
  adopterClass: ReworkActorClass;
}): AdoptionDispositionFacts {
  const sourceTaskById = new Map(input.source.tasks.map((task) => [task.taskId, task]));
  const readById = new Map(input.read.map((entry) => [entry.facts.taskId, entry]));
  const tasks = new Map<string, { definition: RuntimeTask; phase: TaskPhaseFacts; facts: TracedTaskFactsV1 }>();
  for (const change of input.delta.dispositionChanges) {
    const definition = sourceTaskById.get(change.taskId);
    if (definition === undefined) throw new Error(`a disposition change names task ${change.taskId}, which is not in the source plan`);
    const entry = readById.get(change.taskId);
    tasks.set(change.taskId, entry !== undefined ? { definition, phase: entry.phase, facts: entry.facts } : {
      definition,
      phase: { taskKind: definition.taskKind, applicableReduction: null, selectedRun: null, originUnresolvable: false,
        round: { kind: 'none' }, coveringRequeue: null },
      facts: { taskId: change.taskId, runs: [], lease: null, reduction: null, selectedRun: null, pointerIntent: null },
    });
  }
  return { goalDesiredState: input.goalDesiredState, affectedTaskIds: input.affectedTaskIds, adopterClass: input.adopterClass,
    tasks, taskGuards: new Map(input.read.map((entry) => [entry.facts.taskId, entry.guards])),
    carrierGuards: new Map(input.carriers.map((entry) => [entry.facts.taskId, entry.guards])) };
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

/** Exact plan-apply receipt re-read (Host and Agent) for the concurrent-commit window. */
async function recheckApply(
  records: GoalRecordTransactionPort & RecordLookupPort,
  expected: ApplyReceipt,
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
 * validation/compile/commit. PLAN-02 of the plan machine judges the admission,
 * the scope and the source after each read and writes the candidate@1. A fresh
 * failure re-reads the same-identity receipt so a concurrent winner that
 * committed before a later revoke is replayed instead of re-acted.
 */
async function proposePlanAsAgent(
  deps: PlanServiceDependencies,
  records: GoalRecordTransactionPort & RecordLookupPort,
  ctx: CoreCallContext,
  input: { goalRef: GoalRef; basedOn: PlanRevisionRef | null; draft: PlanRevisionDraft;
    reason: unknown; requestId: string; expected: unknown; workspaceId: string;
    /** Slice 5 §2.4: the first user-initiated request this candidate belongs to. */
    requestRef: QueryJobRef | null;
    /** Slice 5 §2.4: the current request head this candidate replaces, or null. */
    replaces: { proposalRef: PlanProposalRef; revision: number } | null },
): Promise<WriteResult<PlanProposal>> {
  const delegated = deps.delegatedWrites;
  if (delegated === undefined) {
    return forbidden('plan writes require the W2 delegatedWrites dependency for a work-run caller');
  }
  const scope = { projectId: input.goalRef.projectId, workspaceId: input.workspaceId };
  const identified = await identifyPlanWriter(delegated, ctx, scope);
  if (identified.status !== 'ready') return asWriteRejection(identified, 'the Agent plan writer could not be identified');
  const writer = identified.value;
  if (!sameJson(writer.goalRef, input.goalRef)) return forbidden('the Agent Run is not scoped to this goal');
  if (writer.workspaceId !== input.workspaceId) return forbidden('the Agent Run is not scoped to this workspace');
  const requestFactsReader = createCandidateRequestFactsReader({ records });

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
  // Slice 5 §2.4: the Agent path fingerprints the request association and the
  // replaced head exactly as the Host path does.
  const fingerprint = agentCommandFingerprint('PlanProposeAgent', {
    projectId: scope.projectId, workspaceId: input.workspaceId, goalRef: input.goalRef,
    basedOn: input.basedOn, draft: input.draft, reason: input.reason, expected,
    requestRef: input.requestRef, replaces: input.replaces });
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
  const freshAdmission = authorized.status === 'ready' ? authorized.value : null;
  // The recorded-shaped event judges exactly the writer facts a replacement
  // shares with a first record; the replacement transition re-checks them.
  const admissionRecorded = { type: 'proposal_recorded' as const, writer: 'agent' as const, ref, goalRef: input.goalRef,
    basedOn: input.basedOn, draft: input.draft, reason: input.reason as unknown as PlanChangeReason,
    submittedBy: freshAdmission === null ? null : freshAdmission.provenance };
  // PLAN-02: the fresh admission first; a refused write re-reads the same-identity receipt.
  const refusedAdmission = planProposalProblem(null, admissionRecorded, { agentAdmission: freshAdmission === null
    ? asWriteRejection(authorized, 'the Agent plan write is not authorized') : 'ok' });
  if (refusedAdmission?.ok === false) {
    const concurrent = await recheckAgentProposal(records, receiptExpected);
    if (concurrent !== null) return concurrent;
    return refusalOf(refusedAdmission);
  }
  // PLAN-02 refused a write without the fresh admission above.
  const admission = freshAdmission!;

  const evaluate = async (): Promise<WriteResult<PlanProposal>> => {
    const scoped = await readPlanScope(records, input.goalRef, input.workspaceId, pins.pins);
    if (scoped.status !== 'ready') return scoped;
    // Slice 5 §2.4/§2.6: the request seam and the current per-request head run
    // after the scope read and before the draft admission; both records of a
    // replacement and the slot claim are compiled into the ONE commit below.
    let requestFacts: PlanRequestCandidateFacts | null = null;
    let requestGuards: readonly RecordGuard[] = [];
    let oldHead: CandidatePlanProposal | null = null;
    // Slice 5 §2.5/T-R2-2: a replacement copies the replaced chain's wire-only
    // creation origin; `undefined` keeps a legacy chain without `since`.
    let replacedOrigin: NoticeOriginWireV1 | undefined;
    if (input.requestRef !== null) {
      const factsRead = await requestFactsReader.readCandidateRequestFacts(ctx, { requestRef: input.requestRef, goalRef: input.goalRef });
      if (factsRead.status !== 'ready') return asWriteRejection(factsRead, 'the request facts are unavailable');
      if (!factsRead.value.root) return rejected('invalid', 'the requestRef root does not belong to this Goal');
      if (!factsRead.value.initiatedByOperator) {
        return rejected('unsupported', 'the requestRef is not a user-initiated first-round QueryJob');
      }
      requestGuards = factsRead.value.guards;
      const headRead = await readRequestCandidateHead(records, { goalRef: input.goalRef, requestRef: input.requestRef });
      if (headRead.status !== 'ready') return asWriteRejection(headRead, 'the request head is unavailable');
      const head = headRead.head;
      if (input.replaces === null) {
        requestFacts = requestCandidateFacts({ requestRootSameGoal: true, replacesIsNull: true,
          slotExpectedOwnerIsNull: head === null });
      } else {
        const oldRead = await readProposal(records, input.replaces.proposalRef);
        if (oldRead.status !== 'ready') return asWriteRejection(oldRead, 'the replaced head is unavailable');
        if (oldRead.proposal.kind !== 'candidate_v2') return rejected('unsupported', 'a legacy v1 proposal cannot be replaced');
        oldHead = oldRead.proposal;
        const oldOrigin = await readProposalOrigin(records, input.replaces.proposalRef);
        if (oldOrigin.status !== 'ready') return asWriteRejection(oldOrigin, 'the replaced head origin is unavailable');
        replacedOrigin = oldOrigin.origin;
        const headMatches = head !== null && planProposalRefKey(head.ref) === planProposalRefKey(input.replaces.proposalRef);
        const headRevisionMatches = head !== null && head.revision === input.replaces.revision;
        requestFacts = requestCandidateFacts({ requestRootSameGoal: true, replacesIsNull: false,
          headMatches, headRevisionMatches, requestGoalMatches: true, replacesComplete: headMatches && headRevisionMatches });
      }
    } else if (input.replaces !== null) {
      return rejected('invalid', 'a replacement candidate requires the request it replaces');
    }
    // Agent scope: a proposal is a future revision of a REAL accepted source
    // that is still the Goal active plan. The proposal keeps its diagnostic
    // issues; the full execution rules stay in apply. PLAN-02 judges the scope,
    // the draft schema and basedOn before the source read, then the source.
    const recorded = { type: 'proposal_recorded' as const, writer: 'agent' as const, ref, goalRef: input.goalRef,
      basedOn: input.basedOn, draft: input.draft, reason: input.reason as unknown as PlanChangeReason,
      submittedBy: admission.provenance };
    // N4 (lead): a replacement is an Agent future revision too; the scoped
    // check (scope, schema, basedOn) runs before the source read for both.
    {
      const refused = planProposalProblem(null, recorded, { ...scoped.facts, agentAdmission: 'ok' });
      if (refused?.ok === false) return refusalOf(refused, pinsCurrent(refused, scoped.comparison));
    }
    // PLAN-02 refused a proposal without basedOn above.
    const sourceRead = await readPlan(records, input.basedOn!);
    if (sourceRead.status !== 'ready') return sourceRead;
    const source = sourceRead.plan;
    const readFacts = { ...scoped.facts, agentAdmission: 'ok' as const, source: planSourceFactsOf(source),
      initial: null, future: null, requestCandidate: requestFacts };
    if (input.replaces === null) {
      const refused = planProposalProblem(null, recorded, readFacts);
      // The stale source refusal is "not the active plan": it reports the source, as today.
      if (refused?.ok === false) {
        return refusalOf(refused, refused.reason === 'stale' ? [{ ref: source.ref, revision: source.revision }] : undefined);
      }
    }
    const policyRead = await tryPolicyContent(records, input.goalRef.projectId);
    const issues = validatePlanDraft(input.draft, policyRead.policy);
    // L10: the catalog is read once every other refusal point has passed; a replacement's head is judged first.
    const catalog = await proposeCatalogFacts(records, input.goalRef.projectId, input.draft);
    const ctxFacts: PlanProposalGuardContext = { ...readFacts, modules: catalog.modules };
    const decided = oldHead === null
      ? transitionPlanProposal(null, { ...recorded, issues, catalogPin: catalog.catalogPin,
        ...(input.requestRef === null ? {} : { requestRef: input.requestRef }) }, ctxFacts)
      : transitionPlanProposal(oldHead, { type: 'proposal_replaced' as const, writer: 'agent' as const, ref,
        goalRef: input.goalRef, basedOn: input.basedOn, draft: input.draft,
        reason: input.reason as unknown as PlanChangeReason, issues, catalogPin: catalog.catalogPin,
        submittedBy: admission.provenance,
        expectedHeadRevision: input.replaces!.revision, requestedBy: writer.actor, at: deps.now(),
        head: { proposalRef: input.replaces!.proposalRef, revision: input.replaces!.revision },
        replaces: input.replaces!, requestRef: input.requestRef! }, ctxFacts);
    if (!decided.ok) return refusalOf(decided);
    const commit = planCommitOf(decided, { scope: scoped.scope, actor: writer.actor, agentAdmission: admission.guards });
    if (commit.status !== 'ready') return commit;
    const candidate = commit.proposal;
    const derived = deriveCommandIds(identity, 'plan-propose-agent');
    const eventFor = (proposal: PlanProposal): PlanProposalRecordedEvent => ({
      eventId: deps.eventId(), eventType: 'PlanProposalRecorded', schemaVersion: 2,
      projectId: scope.projectId, workspaceId: input.workspaceId, aggregateType: 'PlanProposal',
      aggregateId: proposal.ref.proposalId, aggregateRevision: proposal.revision, causationId: derived.commandId,
      correlationId: derived.correlationId, idempotencyKey: input.requestId, actor: writer.actor,
      occurredAt: deps.now(), payload: { proposal } });
    // The replaced record's event goes FIRST and the candidate LAST, exactly as
    // the Host path orders them; the commit cursor's event is always the candidate.
    const encodedEvents = (commit.replaced === null ? [] : [encodePlanProposalRecordedEvent(eventFor(commit.replaced))])
      .concat([encodePlanProposalRecordedEvent(eventFor(candidate))]);
    // Slice 5 §2.5/T-R2-2: a NEW chain's first candidate binds its creation
    // commit cursor to `since`; a replacement copies the old chain's origin.
    const replacing = commit.replaced !== null;
    const encodedRecords = (commit.replaced === null ? [] : [encodePlanProposal(commit.replaced, replacedOrigin)])
      .concat([encodePlanProposal(candidate, replacing ? replacedOrigin : { since: null })]);
    const cursorBindings = replacing ? [] : [{ refKey: planProposalRefKey(candidate.ref), field: 'since' as const }];
    const merged = mergeGuards([...commit.guards, ...requestGuards]);
    if (!merged.ok) return merged.rejection;
    const claims: UniqueClaimChange[] = commit.requestSlot === null ? [] : [requestSlotClaim(commit.requestSlot)];
    if (ctx.signal.aborted) return rejected('cancelled', 'the Agent plan proposal was cancelled before commit');
    const committed = await records.commit({ identityKey, fingerprint, guards: merged.guards,
      records: encodedRecords, claims, indexGuards: [], indexChanges: [], events: encodedEvents,
      ...(cursorBindings.length === 0 ? {} : { commitCursorBindings: cursorBindings }) });
    if (committed.status !== 'committed') return mapRequestSlotCommitFailure(committed, claims.length > 0);
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
 * candidate must carry this exact Run/Session/Role source (PLAN-05, Agent
 * adopter); the same W1 future compile/commit runs with the Agent actor and
 * the admitted local guards.
 */
async function applyPlanChangeAsAgent(
  deps: PlanServiceDependencies,
  records: GoalRecordTransactionPort & RecordLookupPort,
  ctx: CoreCallContext,
  input: { proposalRef: PlanProposalRef; expectedProposalRevision: number; decisionRefs: unknown;
    requestId: string; expected: unknown;
    /** Slice 5 §2.8 D8: the answer attribution passed through by `applyPlanChange`; proof data only. */
    acknowledgementRef: SessionMessageRef | null },
): Promise<WriteResult<PlanRevisionSnapshot>> {
  const delegated = deps.delegatedWrites;
  if (delegated === undefined) {
    return forbidden('plan writes require the W2 delegatedWrites dependency for a work-run caller');
  }
  const scope = { projectId: input.proposalRef.projectId, workspaceId: input.proposalRef.workspaceId };
  const identified = await identifyPlanWriter(delegated, ctx, scope);
  if (identified.status !== 'ready') return asWriteRejection(identified, 'the Agent plan writer could not be identified');
  const writer = identified.value;
  const adoption: AcceptedPlanEvent = { type: 'proposal_accepted', adopter: 'agent', proposalRef: input.proposalRef,
    expectedProposalRevision: input.expectedProposalRevision, decisionRefs: input.decisionRefs as readonly VersionPin[],
    agentWriter: { runRef: writer.runRef, sessionRef: writer.sessionRef, roleBinding: writer.roleBinding, goalRef: writer.goalRef } };
  // PLAN-05 (Agent): decisionRefs before any other check or read.
  const refusedDecisions = planProposalProblem(undefined, adoption, {});
  if (refusedDecisions?.ok === false) return refusalOf(refusedDecisions);
  const pins = normalizeCallerPlanPins(scope, input.expected);
  if (pins.status === 'invalid') return rejected('invalid', pins.reason);
  const expected = orderedPlanPins(input.expected);
  const identity = { projectId: scope.projectId, actor: writer.actor, idempotencyKey: input.requestId };
  const identityKey = PLAN_APPLY_IDENTITY_PREFIX + commandIdentityKey(identity);
  const fingerprint = agentCommandFingerprint('PlanApplyAgent', {
    projectId: scope.projectId, workspaceId: scope.workspaceId, proposalRef: input.proposalRef,
    expectedProposalRevision: input.expectedProposalRevision, decisionRefs: input.decisionRefs, expected,
    // §2.8 D8/T-R2-1: only a present answer changes the Agent command identity;
    // an Agent apply without attribution keeps its byte-identical fingerprint.
    // The answer's decision source is NOT part of the fingerprint: it is read
    // from the formal answer after the original receipt replay, so a retry can
    // restore the first receipt even when the answer read is unavailable.
    ...(input.acknowledgementRef === null ? {} : { acknowledgementRef: input.acknowledgementRef }),
  });
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
  const freshAdmission = authorized.status === 'ready' ? authorized.value : null;
  // PLAN-05 (Agent): the fresh admission before the proposal read; a refused write re-reads the receipt.
  const refusedAdmission = planProposalProblem(undefined, adoption, { agentAdmission: freshAdmission === null
    ? asWriteRejection(authorized, 'the Agent plan write is not authorized') : 'ok' });
  if (refusedAdmission?.ok === false) {
    const concurrent = await recheckApply(records, receiptExpected);
    if (concurrent !== null) return concurrent;
    return refusalOf(refusedAdmission);
  }
  // PLAN-05 refused an Agent write without the fresh admission above.
  const admission = freshAdmission!;

  const evaluate = async (): Promise<WriteResult<PlanRevisionSnapshot>> => {
    // PLAN-05 (Agent): kind, status, revision and the submission source, then the scope, the draft schema
    // and decisionRefs, before the source read.
    const read = await readAdoption(records, adoption, 'ok', input.expected);
    if (read.status !== 'ready') return read;
    // Slice 5 §2.8 D8: the same acceptance proof the Host branch builds, but the
    // Agent branch reads the formal answer itself and uses its SAVED
    // `response.decision.source` as the basis. It is attribution data only; the
    // Agent's fresh admission above remains the sole authorization.
    let decisionProof: PlanAcceptanceDecisionProofV1 | null = null;
    if (input.acknowledgementRef !== null) {
      // §8.2 line 1366: this is the first new business read, so it happens only
      // after the original receipt replay above.
      const derived = await readAcknowledgedAnswerSource(records, input.acknowledgementRef);
      if (derived.status !== 'ready') return derived;
      const proof = planAcceptanceProof({ acknowledgementRef: input.acknowledgementRef,
        decisionSource: derived.source, candidate: read.candidate, goal: read.scope.goal,
        afterProposalRevision: read.candidate.revision + 1 });
      if ('status' in proof) return proof;
      decisionProof = { acknowledgementRef: input.acknowledgementRef, decisionApplication: proof.proof };
    }
    return applyFutureRevision({ records, read, adoption, receipt: receiptExpected, principal: ctx.principal,
      operatorActor: deps.operatorActor,
      extraGuards: admission.guards, preCommitSignal: ctx.signal, eventId: deps.eventId, now: deps.now,
      decisionProof });
  };

  const outcome = await evaluate();
  if (outcome.status === 'rejected') {
    const concurrent = await recheckApply(records, receiptExpected);
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
