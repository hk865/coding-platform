/**
 * Orchestration slice 5 shared decision fixture (SPEC §5.1, §5.3; taskbook
 * F75, part 1).
 *
 * It opens ONE real RecordStore (memory or SQLite) through the accepted B2
 * execution fixture and seeds a complete, possible slice-5 world in the frozen
 * `P/W` scope:
 *   - Project/Workspace (revision 3 through the public bootstrap + line-pin
 *     owners, no seeded `decisionSettings`), Goals A/B/C at
 *     revision 7 with settings/order and accepted Plan pointers PA1/PB1/PC1;
 *   - the immutable Plan snapshots (revision 1, planRevision 1);
 *   - real Session S (and a second Session) plus a REAL claimed → entered
 *     running Run RA owned by S, and a claimed-but-not-entered Run RB;
 *   - two real root QueryJobs Q1/Q2 on Goal B and their candidate proposals
 *     U1/U2 (with the request-head unique claim);
 *   - a pending DecisionMessage and one answered decision message, each with a
 *     real stored body, plus all five slice-5 lookup indexes.
 *
 * Repair contracts for downstream groups (2026-10-08, round 2):
 *   - source keys contain natural identities only; the real `sendUserMessage`
 *     captures Goal B@7 plus the message's object pins, with only the Goal B
 *     base, and derives the message id from the request id. Answer requests add
 *     the current message pin to those source pins, once each;
 *   - `messages.answered` is sent pending@1, then answered responded@2 in a
 *     second commit using SessionMessageResponded with the Host operator actor.
 *     Its response preserves the captured object versions and Goal bases;
 *   - A1/B1 both plan module M; C1 plans only N. Each plan has a Goal gate;
 *   - U1 targets NEW PB2@planRevision2 and U2 NEW PB2-Q2@planRevision2,
 *     preserving PB1 definitions and adding one future work task;
 *   - initial Plan adoption now has real P-scope governance/digests and saved
 *     accepted proposal history. Snapshot imports are pre-adoption checkpoints;
 *   - the sending Session uses production's formal `platform-adviser` template,
 *     so the real duties adapter yields the adviser decision duty; `duties` is
 *     the per-open trusted fact for the independent stub adapters;
 *   - createS5Session/settleRunRA use P/W owners. Helpers and observations
 *     continue to use the active ledger/body file after SQLite reopen;
 *   - GoalPhase, verification and catalog schemas are registered for real
 *     downstream owner setup; no missing-schema fallback is required;
 *   - counts are call diagnostics, NOT evidence of zero writes. storeSnapshot
 *     reads records/events/claim owners; allocationCounts counts newId/now/put.
 *   - seedQueryJob remains a pending root submit, NOT a planning-question
 *     source. DQ01 must additionally prepare/enter/answer a real Query through
 *     QueryExecutionPort, with its frozen manifest and Query-owned answer body.
 *
 * The default setup reaches the real catalog adoption, message-mailbox and
 * decision owners over the real RecordStore; the claim / execution-entry /
 * session / query-job owners and the accepted fixtures stay real too. The
 * lookups are the real registered indexes, so a matching seed is proven by the
 * Store, not by a mock.
 */
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { artifactBodyDigest } from '../../src/contracts/artifact.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ModuleRef, RoleConfigurationRef, SessionRef, VersionPin, WorkspaceScope } from '../../src/contracts/core/identity.js';
import type { ActorRef, CommitCursor } from '../../src/contracts/command-event.js';
import type { SessionMessageRef, DecisionMessageMetadataV1 } from '../../src/contracts/core/session-message.js';
import { decisionSourceKey, type DecisionOptionV1, type DecisionSourceV1, type DecisionSourceIdentityV1 } from '../../src/contracts/goal-decisions.js';
import type { TaskClaim } from '../../src/contracts/core/task-claim.js';
import type { RunSnapshot, RoleBindingRefV1, TaskBudgetV1 } from '../../src/contracts/dispatch.js';
import { DEFAULT_RUNTIME_BUDGET } from '../../src/contracts/runtime-budget.js';
import type { GoalRef, GoalSnapshot, ProjectRef, WorkspaceRef, WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import { makeCommitCursor, seqOfCommitCursor } from '../../src/contracts/ledger.js';
import type { PlanRevisionDraft, PlanRevisionRef, PlanRevisionSnapshot, RuntimeTask } from '../../src/contracts/plan.js';
import type { QueryJobIntentV1, QueryJobRef } from '../../src/contracts/query-job.js';
import type { GoalDecisionBasisV1, GoalSettingsV1 } from '../../src/contracts/goal-decisions.js';
import type { PlatformDutyV1 } from '../../src/contracts/platform-duty.js';
import { WORKFLOW_AUTOMATION_ACTOR } from '../../src/contracts/task-requeue.js';
import { SESSION_MAILBOX_TOOL_NAMES, USER_DECISION_TOOL_NAMES } from '../../src/core/agent-runtime/communication-tools.js';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';
import type { EncodedDomainEvent, EncodedRecord, RecordBackendSchemas, RecordGuard, StoreCommitReceipt, UniqueClaimChange } from '../../src/core/record-store/ports.js';
import type { OrderedLookupRequest, RecordOrderedLookupPort } from '../../src/core/record-store/lookup-ports.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import { RawArtifactBodyStore } from '../../src/core/record-store/body-store.js';
import { createSqliteRawArtifactStore } from '../../src/core/record-store/sqlite-body-store.js';
import { encodeGoalSnapshot } from '../../src/core/work-graph/persistence/record-codecs.js';
import { PLAN_RECORD_SCHEMAS, encodePlanProposal, encodePlanRevisionSnapshot } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import type { PlanProposal } from '../../src/core/work-graph/model/plan-contracts.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS } from '../../src/core/work-graph/sessions/lifecycle-record-codecs.js';
import { createQueryJobService } from '../../src/core/work-graph/queries/query-job-service.js';
import type { SubmitQueryJobInput } from '../../src/core/work-graph/queries/contracts.js';
import {
  SESSION_MESSAGE_RECORD_SCHEMAS,
  S5_USER_MESSAGE_BY_GOAL, S5_MESSAGE_BY_WORKSPACE_STATUS, S5_DECISION_ANSWER_BY_SOURCE,
} from '../../src/core/work-graph/sessions/message-record-codecs.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { DECISION_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/decision-record-codecs.js';
import { S5_PLAN_PROPOSAL_BY_REQUEST } from '../../src/core/work-graph/persistence/plan-record-codecs.js';
import { S5_QUERY_JOB_BY_GOAL } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { createSessionDirectory, kernelSessionClaimKey } from '../../src/core/work-graph/sessions/session-directory.js';
import { SESSION_RECORD_SCHEMAS, decodeSessionRecord, plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { ROLE_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/role-record-codecs.js';
import { materialRecordSchemas } from '../../src/core/work-graph/materials/record-readers.js';
import { PLAN_GOVERNANCE_RECORD_SCHEMAS, PLAN_STATE_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/plan-readers.js';
import { TASK_CLAIM_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/claim-record-codecs.js';
import { MODEL_REQUEST_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/model-request-codecs.js';
import { COMPLETION_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/completion-record-codecs.js';
import { UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/unknown-call-review-codecs.js';
import { COMMAND_RERUN_REQUEST_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/command-rerun-request-codecs.js';
import { SESSION_ANOMALY_RECORD_SCHEMAS } from '../../src/core/work-graph/tasks/session-anomaly-codecs.js';
import { CONTROL_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/control-record-codecs.js';
import { EVIDENCE_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/evidence-record-codecs.js';
import { RUN_ACTIVITY_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/run-activity-codecs.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../../src/core/work-graph/configuration/project-bootstrap-record-codecs.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../../src/core/work-graph/architecture/catalog-record-codecs.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createProjectBootstrapServices } from '../../src/core/work-graph/configuration/project-bootstrap-service.js';
import { createMessageDutiesFactsAdapter } from '../../src/core/work-graph/configuration/message-duties-adapter.js';
import { platformRoleProfile } from '../../src/core/agent-runtime/role-profiles.js';
import { createMessageWriteOwner, createSessionMailbox } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createDecisionMessageService } from '../../src/core/work-graph/communication/decision-service.js';
import { createDecisionSourceFacts } from '../../src/core/work-graph/communication/decision-source-facts.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import type { SessionMailboxDependencies } from '../../src/core/work-graph/model/communication-contracts.js';
import { workContext } from './S5-user-message-support.js';
import { createTaskClaimService } from '../../src/core/work-graph/tasks/claim-service.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createGoalSettingsService } from '../../src/core/work-graph/tasks/goal-settings-service.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createLineSettingsService } from '../../src/core/work-graph/configuration/line-settings-service.js';
import { LINE_SETTINGS_RECORD_SCHEMAS } from '../../src/core/work-graph/persistence/line-settings-codecs.js';
import { setGoalControlFromHost } from '../../src/core/work-graph/tasks/goal-control.js';
import type { ClaimTaskInput } from '../../src/core/work-graph/model/claim-contracts.js';
import type { GraphWrite } from '../../src/core/work-graph/model/task-contracts.js';
import type { SessionDirectoryPort } from '../../src/core/work-graph/model/session-contracts.js';
import type { PreparedTaskExecution } from '../../src/contracts/core/prepared-execution.js';
import type {
  AuthorizeConfiguration, ExecutionEntryPort, KernelExecutionBinding, TaskEntryPermit,
  TaskResultObservation,
} from '../../src/core/work-graph/model/execution-entry-contracts.js';
import { createExecutionEntryService } from '../../src/core/work-graph/tasks/execution-entry-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createKernelStoreRegistry } from '../../src/core/agent-runtime/kernel-store-locator.js';
import { createSessionOperations } from '../../src/core/agent-runtime/session-operations.js';
import type { RuntimeExecutionDependencies } from '../../src/core/agent-runtime/execution-contracts.js';
import { createB2ExecutionFixture, type B2ExecutionFixture, type B2Records } from './B2-execution-fixture.js';
import { preparationHost, prepareTaskForReal } from './task-claim-fixture.js';
import { createS2BRuntimeSteps, type S2BRunHandle, type S2BRuntimeSteps } from './S2B-runtime-steps-fixture.js';

// ---------------------------------------------------------------------------
// Frozen fixture values (SPEC §5.1 lines 926-928)
// ---------------------------------------------------------------------------

export type S5FixtureKind = 'memory' | 'sqlite';

export const T = '2026-10-08T00:00:00.000Z';
export const GOAL_REVISION = 7;
export const MESSAGE_REVISION = 1;
export const WORKSPACE_REVISION = 3;

export const PROJECT_ID = 'P';
export const WORKSPACE_ID = 'W';
export const OPERATOR: Readonly<{ kind: 'human'; id: 'operator' }> = Object.freeze({ kind: 'human', id: 'operator' });
export const AUTOMATION = WORKFLOW_AUTOMATION_ACTOR;

export const PROJECT: ProjectRef = { aggregateType: 'Project', projectId: PROJECT_ID };
export const WORKSPACE: WorkspaceRef = { aggregateType: 'Workspace', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID };
export const WORKSPACE_SCOPE: WorkspaceScope = { projectId: PROJECT_ID, workspaceId: WORKSPACE_ID };

export const GOAL_A: GoalRef = { aggregateType: 'Goal', projectId: PROJECT_ID, goalId: 'A' };
export const GOAL_B: GoalRef = { aggregateType: 'Goal', projectId: PROJECT_ID, goalId: 'B' };
export const GOAL_C: GoalRef = { aggregateType: 'Goal', projectId: PROJECT_ID, goalId: 'C' };
export const GOAL_ORDER: Readonly<{ A: number; B: number; C: number }> = Object.freeze({ A: 0, B: 1, C: 2 });

export const PLAN_A1: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: PROJECT_ID, planId: 'PA1' };
export const PLAN_B1: PlanRevisionRef = { aggregateType: 'PlanRevision', projectId: PROJECT_ID, planId: 'PB1' };
export const PLAN_A2: PlanRevisionRef = { ...PLAN_A1, planId: 'PA2' };
export const PLAN_B2: PlanRevisionRef = { ...PLAN_B1, planId: 'PB2' };
export const PLAN_B2_Q2: PlanRevisionRef = { ...PLAN_B1, planId: 'PB2-Q2' };
export const PLAN_C1: PlanRevisionRef = { ...PLAN_B1, planId: 'PC1' };

export const MODULE_M: ModuleRef = { projectId: PROJECT_ID, moduleId: 'M' };
export const MODULE_N: ModuleRef = { projectId: PROJECT_ID, moduleId: 'N' };
/** The catalog paths the frozen fixture maps M/N to (SPEC §5.1 line 928). */
export const MODULE_PATHS: Readonly<Record<'M' | 'N', readonly string[]>> = Object.freeze({ M: ['src/m/'], N: ['src/n/'] });
export const FILE_M = 'src/m/a.ts';

export const REQUEST_Q1: QueryJobRef = { aggregateType: 'QueryJob', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, queryJobId: 'Q1' };
export const REQUEST_Q2: QueryJobRef = { aggregateType: 'QueryJob', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, queryJobId: 'Q2' };

const CANDIDATE_U1_REQUEST = 's5-propose-q1';
const CANDIDATE_U2_REQUEST = 's5-propose-q2';
export const CANDIDATE_U1 = candidateRefFor(CANDIDATE_U1_REQUEST);
export const CANDIDATE_U2 = candidateRefFor(CANDIDATE_U2_REQUEST);

/** Per-open trusted duty fact for the independent stub adapters; the fixture's own send uses the real adapter. */
export const DUTIES: readonly PlatformDutyV1[] = Object.freeze(['executor']);

// The real registered index names, re-exported for the service-case files.
export { S5_MESSAGE_BY_WORKSPACE_STATUS } from '../../src/core/work-graph/sessions/message-record-codecs.js';

// ---------------------------------------------------------------------------
// Fixture shape
// ---------------------------------------------------------------------------

export type S5Records = B2Records;
/** Slice 2A P8: the observed fixture port also carries the separate ordered lookup. */
export type S5OrderedRecords = S5Records & RecordOrderedLookupPort;

/**
 * Slice 2A P8: the real backend implements the separate ordered port; these
 * forwarding doubles only add the method the new notice sources read through.
 * The delegate is the real store the fixture wraps. The method is checked and
 * forwarded for real: a bare type assertion must never make a missing
 * `lookupOrdered` look present.
 */
function orderedLookupOf(target: S5Records): RecordOrderedLookupPort {
  const port = target as unknown as Partial<RecordOrderedLookupPort>;
  if (typeof port.lookupOrdered !== 'function') {
    throw new Error('the S5 records port does not implement the ordered lookup');
  }
  return { lookupOrdered: request => port.lookupOrdered!(request) };
}

/**
 * The same records with the real ordered lookup forwarded through it. Owners
 * that pass their records to an ordered reader (executed files, notices) use
 * this port instead of casting the bare `S5Records` type.
 */
export function asS5OrderedRecords(records: S5Records): S5OrderedRecords {
  return { ...records, lookupOrdered: request => orderedLookupOf(records).lookupOrdered(request) };
}

/** Physical call diagnostics; use storeSnapshot(), not these, for "0 writes". */
export type S5RecordCounts = {
  commits: number;
  lookupCommits: number;
  eventAt: number;
  lookups: number;
};

type S5AllocationCounts = { newId: number; now: number; bodyPut: number };

/** Copy allocationCounts before the command; setup has already allocated. */
export function createS5Allocations(prefix = 's5-id') {
  const allocationCounts: S5AllocationCounts = { newId: 0, now: 0, bodyPut: 0 };
  return {
    allocationCounts,
    newId: () => `${prefix}-${++allocationCounts.newId}`,
    now: () => { allocationCounts.now += 1; return T; },
    observeBodies(store: RawArtifactStorePort): RawArtifactStorePort {
      return {
        read: ref => store.read(ref),
        put: input => { allocationCounts.bodyPut += 1; return store.put(input); },
      };
    },
  };
}

export type S5StoreSnapshot = {
  records: { refKey: string; revision: number }[];
  recordCount: number;
  eventCount: number;
  lastCursor: CommitCursor | null;
  claims: { claimKey: string; owner: string }[];
  claimCount: number;
  /** SQLite exposes its receipt table; the memory port has no receipt enumeration. */
  receiptCount?: number;
};

/**
 * Wraps a records port so a test can compare the store a service REALLY writes
 * through before and after its call. `commit`/`lookupCommit`/`eventAt`/`lookup`
 * are counted; every other method is forwarded unchanged. The returned
 * `records` is the port the services under test must be built over.
 */
export function observeRecords(
  records: S5Records,
  counts: S5RecordCounts = { commits: 0, lookupCommits: 0, eventAt: 0, lookups: 0 },
): { records: S5OrderedRecords; counts: S5RecordCounts } {
  // Slice 2A P8: the observed port forwards the ordered lookup too, unchanged.
  const wrapped: S5OrderedRecords = {
    readMany: refKeys => records.readMany(refKeys),
    lookupCommit: input => { counts.lookupCommits += 1; return records.lookupCommit(input); },
    commit: input => { counts.commits += 1; return records.commit(input); },
    eventAt: cursor => { counts.eventAt += 1; return records.eventAt(cursor); },
    lookup: request => { counts.lookups += 1; return records.lookup(request); },
    lookupOrdered: (request: OrderedLookupRequest) => orderedLookupOf(records).lookupOrdered(request),
  };
  return { records: wrapped, counts };
}

/** Per-open trusted facts (SPEC §5.1 line 926): the tests configure these per row. */
export type S5DecisionFixtureOptions = {
  duties?: readonly PlatformDutyV1[];
  operatorActor?: Extract<ActorRef, { kind: 'human' | 'system' }>;
  /** `modules` publicly adopts M/N before Plan adoption; the default publicly adopts an empty module catalog. */
  catalog?: 'baseline' | 'modules';
  /** SS11/SS12/SS15: B@5, real PB1 adoption@6, then a real pause@7 after the first claim and its entry. */
  pausedB?: boolean;
  /** The requirement kind of the seeded policy and of the initial Plan verification requirements. */
  requirementKind?: 'test' | 'static';
  /** Trusted tools the Host authorizes for the entry preparation, in addition to the S5 defaults. */
  preEntryTools?: readonly string[];
  /**
   * W2b-21, the real Session/Run path. `true`: Sessions S and second come from the
   * production `createSessionOperations(...).createSession` (`createRealS5Session`),
   * and Run RA is entered by the shared real Runtime (`S2B-runtime-steps-fixture.ts`:
   * real prepare, `runtime.port.startRun`, the scripted model held at its gate, so
   * RA stays running/entered); `enterClaim`/`settleRun` start and finish Runs through
   * that Runtime. Absent or `false` (the default): the handwritten path, unchanged.
   */
  realRuntime?: boolean;
};

export type S5Base = {
  /** The frozen P/W scope. */
  scope: WorkspaceScope;
  projectRef: ProjectRef;
  workspaceRef: WorkspaceRef;
  /** The ledger directory (TaskClaimFixture directory; kept across reopen). */
  directory: string;
};

type S5GoalSeed = {
  ref: GoalRef;
  snapshot: GoalSnapshot;
  order: number;
  autonomy: GoalSettingsV1['autonomy'];
};

export type S5QuerySeed = { ref: QueryJobRef; intent: QueryJobIntentV1 };

export type S5ReopenedFixture = {
  records: S5OrderedRecords;
  bodies: RawArtifactStorePort;
  counts: S5RecordCounts;
  allocationCounts: S5AllocationCounts;
  newId(): string;
  now(): string;
  storeSnapshot(): Promise<S5StoreSnapshot>;
  lookupRefs(index: string, values: readonly (string | number | boolean | null)[], limit?: number): Promise<string[]>;
  close(): Promise<void>;
};

export type S5DecisionFixture = {
  kind: S5FixtureKind;
  /** The real B2 execution fixture whose ledger this fixture seeds. */
  b2: B2ExecutionFixture;
  /** The shared real records port (the observed one; see `counts`). */
  records: S5OrderedRecords;
  /** Physical calls seen through `records` (services under test are built over it). */
  counts: S5RecordCounts;
  allocationCounts: S5AllocationCounts;
  newId(): string;
  now(): string;
  storeSnapshot(): Promise<S5StoreSnapshot>;
  bodies: RawArtifactStorePort;
  base: S5Base;
  ctx: CoreCallContext;
  workspace: WorkspaceSnapshot;
  goals: { A: S5GoalSeed; B: S5GoalSeed; C: S5GoalSeed };
  plans: { A1: PlanRevisionSnapshot; B1: PlanRevisionSnapshot; C1: PlanRevisionSnapshot };
  sessionS: SessionRef;
  sessionSecond: SessionRef;
  claimRA: TaskClaim;
  runRA: RunSnapshot;
  claimRB: TaskClaim;
  runRB: RunSnapshot;
  duties: readonly PlatformDutyV1[];
  /** The trusted operator actor the fixture's trusted host facts carry. */
  operatorActor: Extract<ActorRef, { kind: 'human' | 'system' }>;
  requests: { Q1: S5QuerySeed; Q2: S5QuerySeed };
  candidates: { U1: PlanProposal; U2: PlanProposal };
  messages: { decision: SessionMessage; answered: SessionMessage };

  // Seed helpers (all write through real codecs/commits, never raw SQL).
  seedCommit(recordsToWrite: readonly EncodedRecord[],
    options?: { guards?: readonly RecordGuard[]; events?: readonly EncodedDomainEvent[]; claims?: readonly UniqueClaimChange[] }): Promise<StoreCommitReceipt>;
  seedGoalSnapshot(snapshot: GoalSnapshot): Promise<StoreCommitReceipt>;
  seedPlanRevisionSnapshot(snapshot: PlanRevisionSnapshot): Promise<StoreCommitReceipt>;
  seedCandidateProposal(proposal: PlanProposal): Promise<StoreCommitReceipt>;
  claimRun(input: { requestId: string; goalRef: GoalRef; planRef: PlanRevisionRef; taskId: string; sessionRef: SessionRef;
    roleBinding?: RoleBindingRefV1; budget?: TaskBudgetV1;
    /** K3 TASK-03r: the review-round claim facts, passed through to `ClaimTaskInput.review`. */
    review?: NonNullable<ClaimTaskInput['review']> }): Promise<TaskClaim>;
  enterClaim(claim: TaskClaim): Promise<RunSnapshot>;
  createS5Session(name: string, role?: RoleConfigurationRef): Promise<SessionRef>;
  /**
   * W2b-21: a Session created by the production Session operation owner
   * (`createSessionOperations(...).createSession`): it admits the Session, creates
   * the Kernel Session in the pinned store and registers the mapping itself. The
   * admission request id is the handwritten path's (`admit-<name>`), so the planned
   * Session ref is the same; the Kernel identity is the one the platform issues.
   */
  createRealS5Session(name: string, role?: RoleConfigurationRef): Promise<SessionRef>;
  settleRun(claim: TaskClaim): Promise<RunSnapshot>;
  settleRunRA(): Promise<RunSnapshot>;
  seedQueryJob(input: { requestId: string; queryJobId: string; runId: string; intent: QueryJobIntentV1 }): Promise<S5QuerySeed>;

  // Lookup helpers: the real registered indexes prove the seed matched.
  lookupRefs(index: string, values: readonly (string | number | boolean | null)[], limit?: number): Promise<string[]>;
  messagesByWorkspaceStatus(status: SessionMessage['status']): Promise<string[]>;
  planProposalsByRequest(queryJobId: string): Promise<string[]>;
  userMessagesByGoal(goalId: string): Promise<string[]>;
  decisionAnswersBySource(kind: DecisionSourceV1['kind'], key: string): Promise<string[]>;
  queryJobsByGoal(goalId: string): Promise<string[]>;

  /** SQLite only: close and reopen the SAME ledger file (and body file). */
  reopen(): Promise<S5ReopenedFixture>;
  close(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Small pure builders
// ---------------------------------------------------------------------------

/** Identity and captured CAS facts are separate: never hash a DecisionSource. */
function sourceOf(identity: DecisionSourceIdentityV1, goalRef: GoalRef,
  pins: readonly VersionPin[], goalBases?: readonly GoalDecisionBasisV1[]): DecisionSourceV1 {
  return { kind: identity.kind, key: decisionSourceKey(identity), goalRef: structuredClone(goalRef),
    pins: pins.map(pin => structuredClone(pin)),
    ...(goalBases === undefined ? {} : { goalBases: goalBases.map(basis => structuredClone(basis)) }) };
}

/** pins capture source objects only; the current message pin belongs in answer meta.expected. */
export function messageSourceOf(messageRef: SessionMessageRef, pins: readonly VersionPin[],
  goalBases?: readonly GoalDecisionBasisV1[], goalRef: GoalRef = GOAL_B): DecisionSourceV1 {
  return sourceOf({ kind: 'message', messageRef }, goalRef, pins, goalBases);
}

export function conflictSourceOf(pair: Extract<DecisionSourceIdentityV1, { kind: 'goal_conflict' }>['pair'],
  pins: readonly VersionPin[], goalBases?: readonly GoalDecisionBasisV1[], goalRef: GoalRef = pair[1].goalRef): DecisionSourceV1 {
  return sourceOf({ kind: 'goal_conflict', pair }, goalRef, pins, goalBases);
}

export function goalBasisOf(goal: GoalSnapshot): GoalDecisionBasisV1 {
  return { goalRef: structuredClone(goal.ref), workspaceRef: structuredClone(goal.workspaceRef),
    objective: goal.objective, activePlanRef: structuredClone(goal.activePlanRevision),
    settings: structuredClone(goal.settings ?? goalSettings(0)) };
}

function goalSettings(order: number, autonomy: GoalSettingsV1['autonomy'] = 'after_plan_confirmation'): GoalSettingsV1 {
  return { schemaVersion: 1, autonomy, order, waitForGoalRef: null, parallelRisks: [] };
}

function workTask(taskId: string, title: string, scope: RuntimeTask['scope']): RuntimeTask {
  return { taskId, title, requirementLevel: 'required', taskKind: 'work', disposition: 'active', phase: 'pending', scope };
}

function planDraft(planId: string, goalId: string, stages: PlanRevisionDraft['stages'], tasks: RuntimeTask[],
  requirementKind: 'test' | 'static' = 'test'): PlanRevisionDraft {
  const gate: RuntimeTask = { taskId: `${goalId.toLowerCase()}-gate`, title: `Goal ${goalId} gate`,
    requirementLevel: 'required', taskKind: 'gate', disposition: 'active', phase: 'pending', scope: { kind: 'goal' } };
  const allTasks = [...tasks, gate];
  return {
    schemaVersion: 2, planId, planRevision: 1, goalId, stages, tasks: allTasks,
    assignments: tasks.map(task => ({ taskId: task.taskId, role: 'builder', instruction: `Execute ${task.taskId}` })),
    obligations: [{ obligationId: `${planId}-obligation`, title: `Deliver ${planId}`, requirementLevel: 'required',
      taskIds: allTasks.map(task => task.taskId),
      verificationRequirements: [{ requirementId: `${planId}-check`, requirementLevel: 'required', kind: requirementKind,
        description: requirementKind === 'static' ? 'Registered static checks pass' : 'Tests pass' }] }],
    taskHierarchy: { parentOf: [] },
    executionDag: { dependsOn: [] },
  };
}

/** No changed/traced Task, no removed Task/gate/assignment, no new obligation. */
function futureDraft(source: PlanRevisionDraft, target: PlanRevisionRef, taskId: string): PlanRevisionDraft {
  const draft = structuredClone(source);
  const task = workTask(taskId, `Future work for ${target.planId}`,
    { kind: 'module', stageId: 'stage-b', moduleRef: MODULE_M.moduleId });
  return { ...draft, schemaVersion: 2, planId: target.planId, planRevision: source.planRevision + 1,
    tasks: [...draft.tasks, task],
    assignments: [...(draft.assignments ?? []), { taskId, role: 'builder', instruction: `Execute ${taskId}` }],
    obligations: draft.obligations.map(obligation => ({ ...obligation, taskIds: [...obligation.taskIds, taskId] })) };
}

/** The public `plans.proposePlan` derives a proposalId from its meta.requestId;
 * construct the matching ref so test literals do not keep the old hand-made `U1`/`U2`. */
function candidateRefFor(requestId: string): PlanProposal['ref'] {
  return { aggregateType: 'PlanProposal', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
    proposalId: `plan-proposal-${sha256Hex(canonicalJson({ projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
      goalId: GOAL_B.goalId, requestId })).slice(0, 32)}` };
}

// ---------------------------------------------------------------------------
// Open
// ---------------------------------------------------------------------------

const additionalSchemas: RecordBackendSchemas[] = [QUERY_JOB_RECORD_SCHEMAS, SESSION_MESSAGE_RECORD_SCHEMAS,
  DECISION_RECORD_SCHEMAS, COMPLETION_RECORD_SCHEMAS, EVIDENCE_RECORD_SCHEMAS, ARCHITECTURE_CATALOG_SCHEMAS,
  LINE_SETTINGS_RECORD_SCHEMAS,
  UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS,
  COMMAND_RERUN_REQUEST_RECORD_SCHEMAS,
  SESSION_ANOMALY_RECORD_SCHEMAS,
  SESSION_LIFECYCLE_RECORD_SCHEMAS,
  RUN_ACTIVITY_RECORD_SCHEMAS,
  { records: [], events: PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events },
  CONTROL_RECORD_SCHEMAS];

// These test-only indexes enumerate every registered aggregate on the SAME
// physical store, including rows created later by a tested owner. No fixed ref
// list can hide a stray newly allocated record. The B2 schema sets are read here
// only to build indexes; B2 remains responsible for registering their codecs.
const snapshotTypes = [...new Set([
  materialRecordSchemas(), PLAN_RECORD_SCHEMAS, PLAN_STATE_RECORD_SCHEMAS, PLAN_GOVERNANCE_RECORD_SCHEMAS,
  SESSION_RECORD_SCHEMAS, ROLE_RECORD_SCHEMAS, TASK_CLAIM_RECORD_SCHEMAS, MODEL_REQUEST_RECORD_SCHEMAS,
  ...additionalSchemas,
].flatMap(schemas => schemas.records.map(schema => schema.aggregateType)))].sort();
const snapshotIndex = (aggregateType: string) => `s5-fixture-all-${aggregateType}`;

export async function openS5DecisionFixture(kind: S5FixtureKind = 'memory',
  fixtureOptions: S5DecisionFixtureOptions = {}): Promise<S5DecisionFixture> {
  const operatorActor: Extract<ActorRef, { kind: 'human' | 'system' }> = fixtureOptions.operatorActor ?? OPERATOR;
  const fixtureDuties: readonly PlatformDutyV1[] = fixtureOptions.duties ?? DUTIES;
  const catalogKind = fixtureOptions.catalog ?? 'baseline';
  const pausedB = fixtureOptions.pausedB ?? false;
  const requirementKind = fixtureOptions.requirementKind ?? 'test';
  const preEntryTools = fixtureOptions.preEntryTools ?? [];
  const realRuntime = fixtureOptions.realRuntime ?? false;
  const b2 = await createB2ExecutionFixture(kind, {
    records: additionalSchemas.flatMap(schemas => [...schemas.records]),
    events: additionalSchemas.flatMap(schemas => [...schemas.events]),
    lookups: [...additionalSchemas.flatMap(schemas => [...(schemas.lookups ?? [])]),
      ...snapshotTypes.map(aggregateType => ({ name: snapshotIndex(aggregateType), aggregateType, paths: ['ref.aggregateType'] }))],
  });
  const directory = b2.base.directory;
  const base: S5Base = { scope: WORKSPACE_SCOPE, projectRef: PROJECT, workspaceRef: WORKSPACE, directory };

  let activeRecords: S5Records = b2.base.records;
  const counts: S5RecordCounts = { commits: 0, lookupCommits: 0, eventAt: 0, lookups: 0 };
  // Remember every attempted slot, including failed/released/newly allocated
  // slots. Owners below and test-built owners all use this stable forwarding
  // port. The values are NOT inferred from successful calls: snapshot reads
  // their actual owners from the backend.
  const knownClaimKeys = new Set<string>();
  const forwarded: S5OrderedRecords = {
    readMany: keys => activeRecords.readMany(keys),
    lookupCommit: input => activeRecords.lookupCommit(input),
    eventAt: cursor => activeRecords.eventAt(cursor),
    lookup: request => activeRecords.lookup(request),
    lookupOrdered: (request: OrderedLookupRequest) => orderedLookupOf(activeRecords).lookupOrdered(request),
    commit: input => {
      for (const claim of input.claims) knownClaimKeys.add(claim.claimKey);
      return activeRecords.commit(input);
    },
  };
  const observed = observeRecords(forwarded, counts);
  const records = observed.records;
  const allocations = createS5Allocations();
  const { allocationCounts, newId, now } = allocations;
  const bodyPath = join(directory, 'artifacts.sqlite');
  let bodies: RawArtifactStorePort;
  let closeBodies: () => Promise<void>;
  if (kind === 'sqlite') {
    const store = createSqliteRawArtifactStore(bodyPath);
    bodies = allocations.observeBodies(store);
    closeBodies = () => store.close();
  } else {
    bodies = allocations.observeBodies(new RawArtifactBodyStore());
    closeBodies = async () => undefined;
  }

  const ctx: CoreCallContext = {
    projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
    principal: { kind: 'host', actor: { ...operatorActor } },
    materialReader: { kind: 'host', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, actor: { ...operatorActor } },
    signal: new AbortController().signal,
  };

  let seedSeq = 0;
  let eventSeq = 0;
  const eventId = () => `s5-event-${++eventSeq}`;

  async function seedCommit(recordsToWrite: readonly EncodedRecord[],
    options: { guards?: readonly RecordGuard[]; events?: readonly EncodedDomainEvent[]; claims?: readonly UniqueClaimChange[] } = {}): Promise<StoreCommitReceipt> {
    const sequence = ++seedSeq;
    const explicit = new Set((options.guards ?? []).map(guard => guard.refKey));
    const guards: RecordGuard[] = [...(options.guards ?? []),
      ...recordsToWrite.filter(record => !explicit.has(record.refKey)).map(record => ({ refKey: record.refKey, expectedRevision: null }))];
    // The Store requires at least one event per commit (the receipt cursor). A
    // trusted scope-seed event is the same benign carrier the accepted fixtures use.
    const events: EncodedDomainEvent[] = options.events !== undefined && options.events.length > 0
      ? [...options.events]
      : [{ eventId: `s5-seed-event-${sequence}`, eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: T,
          json: JSON.stringify({ eventId: `s5-seed-event-${sequence}`, eventType: 'TrustedScopeSeeded', schemaVersion: 1,
            occurredAt: T, records: recordsToWrite }) }];
    const result = await records.commit({
      identityKey: `s5-seed-${sequence}`, fingerprint: `s5-seed-fingerprint-${sequence}`,
      guards, records: [...recordsToWrite], claims: [...(options.claims ?? [])],
      indexGuards: [], indexChanges: [], events,
    });
    if (result.status !== 'committed') throw new Error(`S5 fixture seed commit failed: ${JSON.stringify(result)}`);
    return result;
  }

  // ---- Project + Workspace through the public bootstrap owners -------------
  // Project@1 is exactly what createProject writes. Workspace@3 is its public
  // registration (@1) plus a real Session added and then removed through the
  // public setLinePins owner (@2 add, @3 remove), which writes only
  // lineSettings. No public step persists an empty decisionSettings.noticeSeen
  // (notice-settings-machine.ts:56-62), so the row carries only real writes.
  // The public seed chain uses its own id sequence so the fixture's main
  // `newId`/`eventId` counters start exactly where they did when the goals were
  // seeded by hand. Importers/pure byte-count rows depend on those later ids.
  let publicSeedSeq = 0;
  const seedEventId = (): string => `s5-public-seed-event-${++publicSeedSeq}`;
  const seedNewId = (): string => `s5-public-seed-id-${++publicSeedSeq}`;
  const bootstrapSeed = createProjectBootstrapServices({ records, now, eventId: seedEventId });
  const createdProject = await bootstrapSeed.projects.createProject(ctx, {
    input: { projectId: PROJECT_ID },
    meta: { requestId: 's5-create-project', expected: [{ ref: PROJECT, revision: 0 }] },
  });
  if (createdProject.status !== 'committed') throw new Error(`S5 createProject failed: ${JSON.stringify(createdProject)}`);
  const projectRevision = createdProject.value.revision;
  const registeredWorkspace = await bootstrapSeed.projects.registerWorkspace(ctx, {
    input: { workspace: WORKSPACE_SCOPE },
    meta: { requestId: 's5-register-workspace', expected: [
      { ref: PROJECT, revision: projectRevision },
      { ref: WORKSPACE, revision: 0 },
    ] },
  });
  if (registeredWorkspace.status !== 'committed') {
    throw new Error(`S5 registerWorkspace failed: ${JSON.stringify(registeredWorkspace)}`);
  }

  // ---- real Sessions S / second --------------------------------------------
  const sessionsPort: SessionDirectoryPort = createSessionDirectory({ records, lookups: records });
  const kernelStores = await createKernelStoreRegistry({ entries: [{
    adapterId: 's5-kernel', storeKey: 's5-kernel-store', workspace: WORKSPACE_SCOPE, databasePath: join(directory, 's5-kernel.sqlite'),
  }] });
  const sessionRole: RoleConfigurationRef = { kind: 'legacy_template', templateId: 'builder', templateRevision: '1' };
  // TP-101: the decision-request sender needs one of the production's formal
  // `secretary`/`adviser`/`scribe` templates; `platform-adviser` is the exact
  // template production's `legacyDuty` matcher maps to `adviser`.
  const sendingSessionRole: RoleConfigurationRef = { kind: 'legacy_template',
    templateId: 'platform-adviser', templateRevision: 's3.1' };
  // SessionDirectory has no injected clock (it calls new Date internally).
  // Keep its real owner facts; all injectable fixture clocks and observations
  // are T. Tests requiring exact Session creation instants need a Date clock
  // seam in their own setup, not a forged SessionRecord here.
  async function createS5Session(requestId: string, role: RoleConfigurationRef = sessionRole): Promise<SessionRef> {
    const admitted = await sessionsPort.admitSessionCreation(ctx, { meta: { requestId: `admit-${requestId}`, expected: [] },
      input: { workspace: WORKSPACE_SCOPE, kernelStore: { adapterId: 's5-kernel', storeKey: 's5-kernel-store' }, role,
        recommendedRefs: [], initialLinks: [] } });
    if (admitted.status !== 'committed') throw new Error(`S5 session admission failed: ${JSON.stringify(admitted)}`);
    const kernelSessionId = `s5-kernel-session-${requestId}`;
    await kernelStores.withStore('s5-kernel', store => store.create(
      { sessionId: kernelSessionId, recordId: `s5-kernel-record-${requestId}`, createdAt: T }, { signal: ctx.signal }));
    const registered = await sessionsPort.recordSessionCreated(ctx, { meta: { requestId: `register-${requestId}`, expected: [] },
      input: { operationRef: admitted.value.ref, sessionRef: admitted.value.action.plannedSessionRef,
        adapterId: 's5-kernel', kernelSessionId, historyCursor: null, observedAt: T } });
    if (registered.status !== 'committed') throw new Error(`S5 session registration failed: ${JSON.stringify(registered)}`);
    return { projectId: registered.value.ref.projectId, sessionId: registered.value.ref.sessionId };
  }
  // W2b-21: the real Session path (see `createRealS5Session` on the fixture type).
  async function createRealS5Session(requestId: string, role: RoleConfigurationRef = sessionRole): Promise<SessionRef> {
    const created = await createSessionOperations({ sessions: sessionsPort, kernelStores }).createSession(ctx, {
      workspace: WORKSPACE_SCOPE, role, recommendedRefs: [], initialLinks: [],
      meta: { requestId: `admit-${requestId}`, expected: [] },
    });
    if (created.status !== 'completed') throw new Error(`S5 real Session creation failed: ${JSON.stringify(created)}`);
    return { projectId: created.value.ref.projectId, sessionId: created.value.ref.sessionId };
  }
  const sessionS = realRuntime ? await createRealS5Session('session-s', sendingSessionRole)
    : await createS5Session('session-s', sendingSessionRole);
  const sessionSecond = realRuntime ? await createRealS5Session('session-second') : await createS5Session('session-second');

  // ---- Workspace@3 through the public line-pin owner ------------------------
  // setLinePins adds the real Session S (@2) and then removes the same Session
  // (@3); state/line-pin-machine.ts:109/:117 writes only lineSettings, so the
  // final empty pin table is exactly the recorded public state.
  const lineSettings = createLineSettingsService({ records, sessionRead: sessionsPort.readSession.bind(sessionsPort),
    now, operatorActor });
  const pinned = await lineSettings.setLinePins(ctx, {
    input: { workspace: WORKSPACE_SCOPE, add: [sessionS], remove: [] },
    meta: { requestId: 's5-pin-session-s', expected: [{ ref: WORKSPACE, revision: registeredWorkspace.value.revision }] },
  });
  if (pinned.status !== 'committed') throw new Error(`S5 setLinePins add failed: ${JSON.stringify(pinned)}`);
  const unpinned = await lineSettings.setLinePins(ctx, {
    input: { workspace: WORKSPACE_SCOPE, add: [], remove: [sessionS] },
    meta: { requestId: 's5-unpin-session-s', expected: [{ ref: WORKSPACE, revision: pinned.value.revision }] },
  });
  if (unpinned.status !== 'committed') throw new Error(`S5 setLinePins remove failed: ${JSON.stringify(unpinned)}`);
  const workspace: WorkspaceSnapshot = unpinned.value;

  // Trusted installation checkpoint: the public bootstrap owners write the
  // governance rows, so the initial Plan owner resolves REAL matching facts.
  const bootstrap = createProjectBootstrapServices({ records, now, eventId });
  const policyRef = { aggregateType: 'CompletionPolicyRevision', projectId: PROJECT_ID,
    policyId: 's5-policy', revision: 1 } as const;
  const installed = await bootstrap.completionPolicies.installCompletionPolicy(ctx, {
    input: { policyId: 's5-policy', contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: [requirementKind],
        minimumRequiredRequirementsPerObligation: 1 } },
    meta: { requestId: 's5-install-policy', expected: [{ ref: PROJECT, revision: 1 },
      { ref: policyRef, revision: 0 }] },
  });
  if (installed.status !== 'committed') throw new Error(`S5 policy install failed: ${JSON.stringify(installed)}`);
  const activated = await bootstrap.completionPolicies.activateCompletionPolicy(ctx, {
    input: { target: { ref: installed.value.ref, digest: installed.value.contentDigest } },
    meta: { requestId: 's5-activate-policy', expected: [{ ref: PROJECT, revision: 1 },
      { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId: PROJECT_ID }, revision: 0 }] },
  });
  if (activated.status !== 'committed') throw new Error(`S5 policy activation failed: ${JSON.stringify(activated)}`);
  const catalog = await createArchitectureCatalogService({ records }).adoptInitialArchitecture(ctx, {
    input: { baselineId: 's5-baseline', description: 'S5 architecture baseline', constraints: [],
      catalog: { requireDag: true, dependencies: [], modules: catalogKind === 'modules' ? [
        { ref: MODULE_M, name: 'M', responsibility: 'Module M work', paths: [...MODULE_PATHS.M], interfaces: [] },
        { ref: MODULE_N, name: 'N', responsibility: 'Module N work', paths: [...MODULE_PATHS.N], interfaces: [] },
      ] : [] } },
    meta: { requestId: 's5-adopt-catalog', expected: [
      { ref: PROJECT, revision: 1 }, { ref: WORKSPACE, revision: WORKSPACE_REVISION },
    ] },
  });
  if (catalog.status !== 'committed') throw new Error(`S5 catalog adoption failed: ${JSON.stringify(catalog)}`);

  // ---- three Goals through the public create/reorder/settings owners -------
  // createGoal writes Goal@1. The public reorder A, B, C leaves A@1 (its order
  // was already index 0), B@2 and C@2. The public setGoalSettings owner then
  // increments one revision per real settings change: the old raw checkpoint was
  // pre-adoption@6, so A needs 5 writes (1+5), B/C need 4 (2+4). pausedB stops
  // B one write earlier at @5; the existing propose/apply leaves it @6 and the
  // later real pause is the @7 write.
  const goalService = createGoalService({ records, now, eventId: seedEventId });
  const goalSettingsService = createGoalSettingsService({ records, now, newId: seedNewId, operatorActor });
  async function createGoal(goalRef: GoalRef): Promise<GoalSnapshot> {
    const created = await goalService.tasks.createGoal(ctx, { input: {
      goalId: goalRef.goalId, workspace: WORKSPACE_SCOPE, objective: `Deliver Goal ${goalRef.goalId}`,
    }, meta: { requestId: `s5-create-goal-${goalRef.goalId.toLowerCase()}`, expected: [
      { ref: PROJECT, revision: projectRevision },
      { ref: WORKSPACE, revision: workspace.revision },
    ] } });
    if (created.status !== 'committed') throw new Error(`S5 Goal creation ${goalRef.goalId} failed: ${JSON.stringify(created)}`);
    return created.value;
  }
  const createdA = await createGoal(GOAL_A);
  const createdB = await createGoal(GOAL_B);
  const createdC = await createGoal(GOAL_C);
  const reordered = await goalSettingsService.reorderGoals(ctx, {
    input: { workspace: WORKSPACE_SCOPE, goalOrder: [GOAL_A, GOAL_B, GOAL_C] },
    meta: { requestId: 's5-reorder-a-b-c', expected: [
      { ref: GOAL_A, revision: createdA.revision },
      { ref: GOAL_B, revision: createdB.revision },
      { ref: GOAL_C, revision: createdC.revision },
    ] },
  });
  if (reordered.status !== 'committed') throw new Error(`S5 Goal reorder failed: ${JSON.stringify(reordered)}`);
  const orderedRevisions = new Map(reordered.value.goals.map(goal => [goal.ref.goalId, goal.revision]));
  const settingsWrites: Record<string, number> = { A: 5, B: pausedB ? 3 : 4, C: 4 };
  const preAdoption = new Map<string, number>();
  for (const goalRef of [GOAL_A, GOAL_B, GOAL_C]) {
    const goalId = goalRef.goalId;
    let revision = orderedRevisions.get(goalId);
    if (revision === undefined) throw new Error(`S5 Goal reorder did not return Goal ${goalId}`);
    const writes = settingsWrites[goalId];
    if (writes === undefined) throw new Error(`S5 Goal settings plan is missing Goal ${goalId}`);
    for (let index = 0; index < writes; index += 1) {
      const changed = await goalSettingsService.setGoalSettings(ctx, {
        input: { goalRef, autonomy: 'after_plan_confirmation', waitForGoalRef: null },
        meta: { requestId: `s5-settings-${goalId.toLowerCase()}-${String(index + 1)}`, expected: [{ ref: goalRef, revision }] },
      });
      if (changed.status !== 'committed') {
        throw new Error(`S5 Goal settings ${goalId}@${String(revision)} failed: ${JSON.stringify(changed)}`);
      }
      revision = changed.value.revision;
    }
    preAdoption.set(goalId, revision);
  }
  const preAdoptionRevision = (goalRef: GoalRef): number => {
    const revision = preAdoption.get(goalRef.goalId);
    if (revision === undefined) throw new Error(`S5 pre-adoption revision is missing Goal ${goalRef.goalId}`);
    return revision;
  };

  // ---- Accepted Plan pointers PA1/PB1/PC1 (revision 1, planRevision 1) ------
  const planADraft = planDraft('PA1', GOAL_A.goalId, [{ stageId: 'stage-a', title: 'Module M stage' }],
    [workTask('a-work', 'Plan module M work', { kind: 'module', stageId: 'stage-a', moduleRef: MODULE_M.moduleId })], requirementKind);
  const planBDraft = planDraft('PB1', GOAL_B.goalId, [{ stageId: 'stage-b', title: 'Module M stage' }],
    [workTask('b-work', 'Goal B first work', { kind: 'module', stageId: 'stage-b', moduleRef: MODULE_M.moduleId }),
      workTask('b-work-2', 'Goal B second work', { kind: 'goal' })], requirementKind);
  // The decision-request sender's Run is assigned production's formal
  // `platform-adviser` template, the one the real duties matcher maps to adviser.
  if (planBDraft.assignments !== undefined) {
    planBDraft.assignments = planBDraft.assignments.map(assignment => assignment.taskId === 'b-work'
      ? { ...assignment, role: 'platform-adviser' } : assignment);
  }
  const planCDraft = planDraft('PC1', GOAL_C.goalId, [{ stageId: 'stage-c', title: 'Module N stage' }],
    [workTask('c-work', 'Plan module N work', { kind: 'module', stageId: 'stage-c', moduleRef: MODULE_N.moduleId })], requirementKind);
  const plans = createPlanService({ records, now, eventId });
  async function adoptInitial(goalRef: GoalRef, draft: PlanRevisionDraft): Promise<PlanRevisionSnapshot> {
    const proposed = await plans.proposePlan(ctx, { input: { goalRef, basedOn: null, draft,
      reason: { text: `Initial ${draft.planId}`, sources: [] } },
      meta: { requestId: `s5-propose-${draft.planId}`, expected: [{ ref: goalRef, revision: preAdoptionRevision(goalRef) }] } });
    if (proposed.status !== 'committed' || proposed.value.issues.length !== 0) {
      throw new Error(`S5 initial proposal failed: ${JSON.stringify(proposed)}`);
    }
    const accepted = await plans.applyPlanChange(ctx, { input: { proposalRef: proposed.value.ref,
      expectedProposalRevision: proposed.value.revision, decisionRefs: [] },
      meta: { requestId: `s5-adopt-${draft.planId}`, expected: [{ ref: goalRef, revision: preAdoptionRevision(goalRef) }] } });
    if (accepted.status !== 'committed') throw new Error(`S5 initial adoption failed: ${JSON.stringify(accepted)}`);
    return accepted.value;
  }
  async function readGoalSnapshot(ref: GoalRef): Promise<GoalSnapshot> {
    const read = await goalSettingsService.readGoalSettings(ctx, { goalRef: ref });
    if (read.status !== 'ready') throw new Error(`S5 Goal read failed: ${JSON.stringify(read)}`);
    return read.value.goal;
  }
  const planA1 = await adoptInitial(GOAL_A, planADraft);
  const planB1 = await adoptInitial(GOAL_B, planBDraft);
  const planC1 = await adoptInitial(GOAL_C, planCDraft);
  const goalA = await readGoalSnapshot(GOAL_A);
  let goalB = await readGoalSnapshot(GOAL_B);
  const goalC = await readGoalSnapshot(GOAL_C);

  // ---- real claim + execution entry: running Run RA, claimed Run RB ---------
  const reads = createRunStateReader({ records });
  const roles = createRoleConfigurationService({ records, now, eventId });
  const claimService = createTaskClaimService({ records, roles, now, newId });
  const roleBinding: RoleBindingRefV1 = { schemaVersion: 1, bindingId: 's5-binding', templateId: 'builder',
    templateRevision: '1', bindingVersion: 1, policyRevision: 'legacy-template' };
  /** The sending Session's formal template, matching the binding its Run is claimed with. */
  const sendingRoleBinding: RoleBindingRefV1 = { ...roleBinding, bindingId: 's5-binding-s',
    templateId: sendingSessionRole.templateId, templateRevision: sendingSessionRole.templateRevision };
  const budget: TaskBudgetV1 = { tokenBudget: 100000, deadline: null };
  const s5Host = {
    configurationRevision: 's5-host-config-1',
    permissions: { policyRevision: 'legacy-template',
      tools: ['read', ...preEntryTools, ...SESSION_MAILBOX_TOOL_NAMES, ...USER_DECISION_TOOL_NAMES] as string[], writeScope: [] as string[] },
    hostTemplate: { templateId: 'builder', revision: '1', digest: artifactBodyDigest('s5 trusted builder template') },
  };
  const authorizeConfiguration: AuthorizeConfiguration = async (callCtx, input) => {
    if (callCtx.projectId !== PROJECT_ID || callCtx.workspaceId !== WORKSPACE_ID
      || input.configurationRevision !== s5Host.configurationRevision
      || ![sessionRole, sendingSessionRole].some(role => canonicalJson(input.sessionRole) === canonicalJson(role))) {
      return { status: 'rejected', code: 'forbidden', reason: 'the S5 fixture Host binding does not authorize this configuration' };
    }
    return { status: 'ready', value: { configurationRevision: s5Host.configurationRevision,
      permissions: structuredClone(input.permissions), hostTemplate: structuredClone(input.hostTemplate) } };
  };
  const entry: ExecutionEntryPort = createExecutionEntryService({ records, reads, roles,
    bodies: { read: ref => bodies.read(ref) }, authorizeConfiguration, now, eventId, newId });

  async function claimRun(input: { requestId: string; goalRef: GoalRef; planRef: PlanRevisionRef; taskId: string; sessionRef: SessionRef;
    roleBinding?: RoleBindingRefV1; budget?: TaskBudgetV1;
    /** K3 TASK-03r: the review-round claim facts, passed through to `ClaimTaskInput.review`. */
    review?: NonNullable<ClaimTaskInput['review']> }): Promise<TaskClaim> {
    const goal = await readGoalSnapshot(input.goalRef);
    const card = await sessionsPort.readSession(ctx, input.sessionRef);
    if (card.status !== 'ready') throw new Error(`S5 claim session read failed: ${JSON.stringify(card)}`);
    const request: GraphWrite<ClaimTaskInput> = { input: {
      goalRef: input.goalRef, planRef: input.planRef, taskId: input.taskId, sessionRef: input.sessionRef,
      roleBinding: input.roleBinding ?? roleBinding, budget: input.budget ?? budget,
      ...(input.review === undefined ? {} : { review: input.review }),
    }, meta: { requestId: input.requestId, expected: [
      { ref: input.goalRef, revision: goal.revision },
      { ref: WORKSPACE, revision: WORKSPACE_REVISION },
      { ref: plainSessionRefToAggregate(input.sessionRef), revision: card.value.record.revision },
    ] } };
    const claimed = await claimService.claimTask(ctx, request);
    if (claimed.status !== 'committed') throw new Error(`S5 claim failed: ${JSON.stringify(claimed)}`);
    return claimed.value;
  }

  async function readExecution(claim: TaskClaim) {
    const read = await reads.readExecution(ctx, claim.runRef);
    if (read.status !== 'ready') throw new Error(`S5 run read failed: ${JSON.stringify(read)}`);
    return read.value;
  }

  async function runPin(claim: TaskClaim): Promise<VersionPin> {
    const current = await readExecution(claim);
    return { ref: claim.runRef, revision: current.run.revision };
  }

  async function buildPrepared(claim: TaskClaim): Promise<{ prepared: PreparedTaskExecution; permit: TaskEntryPermit }> {
    const card = await sessionsPort.readSession(ctx, claim.sessionRef);
    if (card.status !== 'ready') throw new Error(`S5 prepare session read failed: ${JSON.stringify(card)}`);
    const sessionRole = card.value.record.role;
    const hostTemplate = sessionRole.kind === 'legacy_template' && sessionRole.templateId !== 'builder'
      ? { templateId: sessionRole.templateId, revision: sessionRole.templateRevision,
        digest: artifactBodyDigest(`s5 trusted ${sessionRole.templateId} template`) }
      : s5Host.hostTemplate;
    const real = await prepareTaskForReal({ records, ctx }, {
      bodies, runRef: claim.runRef, now, requestId: `s5-prepare-${claim.runRef.runId}`,
      host: preparationHost({ configurationRevision: s5Host.configurationRevision,
        permissions: s5Host.permissions, hostTemplate }),
    });
    return { prepared: real.prepared,
      permit: { claim, consumerId: 's5-runtime', entryGeneration: 1, authorizationRevision: 1,
        inputDigest: real.prepared.inputBinding.inputDigest } };
  }

  async function enterClaim(claim: TaskClaim): Promise<RunSnapshot> {
    const target = await readExecution(claim);
    const kernel: KernelExecutionBinding = { adapterId: target.session.kernel.adapterId,
      kernelSessionId: target.session.kernel.kernelSessionId, runId: 's5-kernel-run', turnId: 's5-kernel-turn' };
    const { prepared, permit } = await buildPrepared(claim);
    const authorized = await entry.authorizeRuntimeEntry(ctx, { input: { prepared, consumerId: permit.consumerId },
      meta: { requestId: `s5-authorize-${claim.task.taskId}`, expected: [await runPin(claim)] } });
    if (authorized.status !== 'committed') throw new Error(`S5 authorize failed: ${JSON.stringify(authorized)}`);
    const begun = await entry.beginRuntimeEntry(ctx, { input: { permit: authorized.value, kernel },
      meta: { requestId: `s5-begin-${claim.task.taskId}`, expected: [await runPin(claim)] } });
    if (begun.status !== 'committed') throw new Error(`S5 begin failed: ${JSON.stringify(begun)}`);
    const entered = await entry.recordExecutionEntered(ctx, { input: {
      permit: { ...authorized.value, authorizationRevision: begun.value.authorization.revision },
      enteredAt: T, kernelSource: { ...kernel, position: 3 },
      history: { kernel, startPosition: 2, observedThroughPosition: 3, endPosition: null },
    }, meta: { requestId: `s5-entered-${claim.task.taskId}`, expected: [await runPin(claim)] } });
    if (entered.status !== 'committed') throw new Error(`S5 entered failed: ${JSON.stringify(entered)}`);
    return entered.value;
  }

  async function settleRun(claim: TaskClaim): Promise<RunSnapshot> {
    const current = await readExecution(claim);
    const authorization = current.run.executionAuthorization;
    const history = current.run.executionHistory;
    if (current.run.status !== 'running' || authorization === undefined || !('schemaVersion' in authorization) || authorization.schemaVersion !== 2
      || authorization.phase !== 'entered' || history === undefined || history === null) {
      throw new Error('S5 settleRun requires an entered running Run with its saved authorization/history');
    }
    const position = history.observedThroughPosition + 1;
    const source = { ...history.kernel, position };
    const input: TaskResultObservation = {
      claim, entry: { consumerId: authorization.consumerId, entryGeneration: authorization.generation },
      event: { schemaVersion: 1, eventType: 'run_completed', eventId: `s5-runtime-completed-${claim.runRef.runId}`,
        runRef: claim.runRef, sequence: current.run.lastEventSeq + 1, occurredAt: T,
        payload: { kind: 'completed', exitCode: 0 } },
      kernelSource: source,
      completedHistoryBoundary: { source, cursor: `s5-completed-${claim.runRef.runId}-${position}` },
      history: { kernel: history.kernel, startPosition: history.startPosition,
        observedThroughPosition: position, endPosition: position },
    };
    const settled = await entry.recordRunResult(ctx, { input, meta: {
      requestId: `s5-settle-${claim.runRef.runId}`, expected: [{ ref: claim.runRef, revision: current.run.revision }] } });
    if (settled.status !== 'committed') throw new Error(`S5 Run settlement failed: ${JSON.stringify(settled)}`);
    const after = await readExecution(claim);
    if (after.run.status !== 'ended' || after.run.outcome !== 'completed'
      || after.session.occupancy !== null || after.outbox.status !== 'settled' || after.attempt.status !== 'ended') {
      throw new Error('S5 Run settlement did not release its Session/Attempt/outbox');
    }
    return settled.value;
  }

  // ---- W2b-21: the real Runtime path (`realRuntime` only) -------------------
  // One shared real Runtime per trusted Host template: the production preparation
  // requires the Host template to match the Session role
  // (`execution-preparation.ts:384`), exactly as `buildPrepared` chooses it. The
  // grant is the S5 Host's own revision and permissions. The Runtime's mailbox is
  // the shared steps' real one; its user-decision dependency forwards to this
  // fixture's real mailbox (`sendUserMessage`) and decision owner (the other
  // two), both built below; the held model calls no tool.
  const runtimeSteps = new Map<string, S2BRuntimeSteps>();
  const runtimeHandles = new Map<string, S2BRunHandle>();
  let runtimeSeq = 0;
  const runtimeDecisions: NonNullable<RuntimeExecutionDependencies['decisionMessages']> = {
    sendUserMessage: (...args) => messageMailbox.sendUserMessage(...args),
    recordDecisionApplication: (...args) => messageDecisions.recordDecisionApplication(...args),
    readDecisionAnswer: (...args) => messageDecisions.readDecisionAnswer(...args),
  };
  function hostTemplateFor(role: RoleConfigurationRef): typeof s5Host.hostTemplate {
    return role.kind === 'legacy_template' && role.templateId !== 'builder'
      ? { templateId: role.templateId, revision: role.templateRevision,
        digest: artifactBodyDigest(`s5 trusted ${role.templateId} template`) }
      : s5Host.hostTemplate;
  }
  async function runtimeStepsFor(claim: TaskClaim): Promise<S2BRuntimeSteps> {
    const card = await sessionsPort.readSession(ctx, claim.sessionRef);
    if (card.status !== 'ready') throw new Error(`S5 real Runtime session read failed: ${JSON.stringify(card)}`);
    const hostTemplate = hostTemplateFor(card.value.record.role);
    const existing = runtimeSteps.get(hostTemplate.templateId);
    if (existing !== undefined) return existing;
    const steps = await createS2BRuntimeSteps({
      base: { ...b2.base, records }, bodies, ctx, directory, scope: WORKSPACE_SCOPE, now, setClock: () => undefined,
      eventId: () => `s5-runtime-event-${String(++runtimeSeq)}`, newId: () => `s5-runtime-id-${String(++runtimeSeq)}`,
      consumerId: 's5-runtime', withMailbox: true, decisionMessages: runtimeDecisions, kernelStores,
      workspaceRevision: workspace.revision,
      host: { configurationRevision: s5Host.configurationRevision, permissions: s5Host.permissions, hostTemplate },
    });
    runtimeSteps.set(hostTemplate.templateId, steps);
    return steps;
  }
  /** Real entry: the shared Runtime prepares and starts the Run; its model is held, so it stays entered. */
  async function enterThroughRuntime(claim: TaskClaim): Promise<RunSnapshot> {
    const steps = await runtimeStepsFor(claim);
    const handle = await steps.start(claim, { at: T, tools: s5Host.permissions.tools,
      replies: [{ kind: 'text', text: `S5 real Runtime: ${claim.task.taskId} finished` }] });
    runtimeHandles.set(claim.runRef.runId, handle);
    let entered = false;
    const early = handle.settled.then(() => {
      if (!entered) throw new Error('S5 real Runtime: the Run settled before it entered');
    }, (error: unknown) => { if (!entered) throw error; });
    early.catch(() => undefined);
    await Promise.race([handle.entered.then(() => { entered = true; }), early]);
    return (await readExecution(claim)).run;
  }
  /** Real end: the held model's own final reply; the Runtime records the completed result. */
  async function settleThroughRuntime(claim: TaskClaim): Promise<RunSnapshot> {
    const handle = runtimeHandles.get(claim.runRef.runId);
    if (handle === undefined) throw new Error('S5 real Runtime: this Run was not entered through the real Runtime');
    await (await runtimeStepsFor(claim)).finish(handle, T, 'completed');
    runtimeHandles.delete(claim.runRef.runId);
    const after = await readExecution(claim);
    if (after.run.status !== 'ended' || after.run.outcome !== 'completed'
      || after.session.occupancy !== null || after.outbox.status !== 'settled' || after.attempt.status !== 'ended') {
      throw new Error('S5 real Runtime settlement did not release its Session/Attempt/outbox');
    }
    return after.run;
  }

  const claimRA = await claimRun({ requestId: 's5-claim-ra', goalRef: GOAL_B, planRef: PLAN_B1, taskId: 'b-work', sessionRef: sessionS,
    roleBinding: sendingRoleBinding });
  const runRA = realRuntime ? await enterThroughRuntime(claimRA) : await enterClaim(claimRA);
  const claimRB = await claimRun({ requestId: 's5-claim-rb', goalRef: GOAL_B, planRef: PLAN_B1, taskId: 'b-work-2', sessionRef: sessionSecond });
  const runRB = (await readExecution(claimRB)).run;
  if (pausedB) {
    const paused = await setGoalControlFromHost({ records, now, eventId }, ctx, {
      input: { goalRef: GOAL_B, control: 'pause', reason: null },
      meta: { requestId: 's5-pause-at-seven', expected: [
        { ref: GOAL_B, revision: 6 },
        { ref: { aggregateType: 'GoalPhase', projectId: PROJECT_ID, goalId: GOAL_B.goalId }, revision: 0 },
      ] },
    });
    if (paused.status !== 'committed' || paused.value.revision !== 7 || paused.value.desiredState !== 'paused'
      || paused.value.desiredStateRevision !== 7) {
      throw new Error(`S5 paused Goal setup failed: ${JSON.stringify(paused)}`);
    }
    goalB = await readGoalSnapshot(GOAL_B);
  }

  // ---- two real root QueryJobs Q1/Q2 on Goal B -----------------------------
  const queryJobs = createQueryJobService({ records, now, eventId });
  function queryIntent(queryJobId: string, question: string): QueryJobIntentV1 {
    return { schemaVersion: 1, intentId: queryJobId, projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
      goalId: GOAL_B.goalId, question, focusTaskRefs: [], budget: { maxTokens: null, deadline: null },
      multiTurn: { maxRounds: 1 }, correlationId: `s5-${queryJobId}`,
      execution: { kind: 'semantic_query', roleBinding, runtimeBudget: DEFAULT_RUNTIME_BUDGET } };
  }
  async function seedQueryJob(input: { requestId: string; queryJobId: string; runId: string; intent: QueryJobIntentV1 }): Promise<S5QuerySeed> {
    const ref: QueryJobRef = { aggregateType: 'QueryJob', projectId: PROJECT_ID, workspaceId: WORKSPACE_ID, queryJobId: input.queryJobId };
    const runRef = { aggregateType: 'QueryRun' as const, projectId: PROJECT_ID, workspaceId: WORKSPACE_ID,
      queryJobId: input.queryJobId, runId: input.runId };
    const submit: GraphWrite<SubmitQueryJobInput> = { input: { queryJobId: input.queryJobId, runId: input.runId, intent: input.intent },
      meta: { requestId: input.requestId, expected: [
        { ref: PROJECT, revision: 1 }, { ref: WORKSPACE, revision: WORKSPACE_REVISION }, { ref: GOAL_B, revision: GOAL_REVISION },
        { ref, revision: 0 }, { ref: runRef, revision: 0 },
      ] } };
    const committed = await queryJobs.submitQueryJob(ctx, submit);
    if (committed.status !== 'committed') throw new Error(`S5 query submit failed: ${JSON.stringify(committed)}`);
    return { ref, intent: input.intent };
  }
  const Q1 = await seedQueryJob({ requestId: 's5-submit-q1', queryJobId: 'Q1', runId: 'Q1-run', intent: queryIntent('Q1', 'What is the first question?') });
  const Q2 = await seedQueryJob({ requestId: 's5-submit-q2', queryJobId: 'Q2', runId: 'Q2-run', intent: queryIntent('Q2', 'What is the second question?') });

  // ---- candidate proposals U1/U2 with the unique request-head claim --------
  async function proposeCandidate(requestRef: QueryJobRef, draft: PlanRevisionDraft,
    requestId: string): Promise<PlanProposal> {
    const proposed = await plans.proposePlan(ctx, { input: { goalRef: GOAL_B, basedOn: PLAN_B1, draft, requestRef,
      reason: { text: `S5 candidate for ${requestId}`, sources: [] } },
      meta: { requestId, expected: [{ ref: GOAL_B, revision: GOAL_REVISION }] } });
    if (proposed.status !== 'committed' || proposed.value.issues.length !== 0) {
      throw new Error(`S5 candidate proposal failed: ${JSON.stringify(proposed)}`);
    }
    return proposed.value;
  }
  const U1 = await proposeCandidate(Q1.ref, futureDraft(planBDraft, PLAN_B2, 'b-u1-future'), CANDIDATE_U1_REQUEST);
  const U2 = await proposeCandidate(Q2.ref, futureDraft(planBDraft, PLAN_B2_Q2, 'b-u2-future'), CANDIDATE_U2_REQUEST);
  if (canonicalJson(U1.ref) !== canonicalJson(CANDIDATE_U1) || canonicalJson(U2.ref) !== canonicalJson(CANDIDATE_U2)) {
    throw new Error('S5 candidate proposal identity does not match the shared candidate refs');
  }

  // ---- DecisionMessage + answered decision message through the real owner -----
  // TP-101: the sending Session's formal `platform-adviser` template is the
  // production five-template match; the fixture adds no template mapping.
  const platformDuties: readonly PlatformDutyV1[] = ['executor', 'secretary', 'adviser', 'scribe', 'reviewer'];
  const legacyDuty = (role: Extract<RoleConfigurationRef, { kind: 'legacy_template' }>): PlatformDutyV1 | undefined =>
    platformDuties.find(duty => {
      const template = platformRoleProfile(duty).template;
      return role.templateId === template.templateId && role.templateRevision === template.templateRevision;
    });
  const messageMaterials = createMaterialService({ bodies, authority: createMaterialRecordReaders(records).authority, now });
  const messageDeps: SessionMailboxDependencies = {
    records, sessions: sessionsPort, executions: reads, roles, materials: messageMaterials,
    systemActor: { ...operatorActor }, now, newId,
    duties: createMessageDutiesFactsAdapter({ roles, sessions: sessionsPort, legacyDuty }),
    runtimeAdmission: { bodies, authorizeConfiguration },
  };
  const messageMailbox = createSessionMailbox(messageDeps);
  const messageDecisions = createDecisionMessageService({
    records, now, newId, operatorActor: { ...operatorActor }, messages: messageMailbox,
    materials: messageMaterials, messageWrites: createMessageWriteOwner(messageDeps),
    sources: createDecisionSourceFacts({ records }),
  });

  const options: DecisionOptionV1[] = [
    { id: 'accept', label: 'Accept', effect: 'apply' },
    { id: 'reject', label: 'Reject', effect: 'reject' },
  ];
  const objects: DecisionMessageMetadataV1['objects'] = [
    { kind: 'aggregate', pin: { ref: PLAN_B1, revision: 1 }, label: 'Plan B1' },
    { kind: 'file', workspace: WORKSPACE_SCOPE, path: FILE_M, digest: null, label: 'File M' },
  ];
  const messageContext = workContext({ base } as S5DecisionFixture, runRA);
  async function sendDecisionRequest(text: string, requestId: string): Promise<SessionMessage> {
    const sent = await messageMailbox.sendUserMessage(messageContext, {
      input: { goalRef: GOAL_B, intent: 'decision_request', text, needsReply: true, waitAfterSend: true, options, objects },
      meta: { requestId, expected: [{ ref: GOAL_B, revision: GOAL_REVISION }] },
    });
    if (sent.status !== 'committed' || sent.value.decision === undefined) {
      throw new Error(`S5 decision message send failed: ${JSON.stringify(sent)}`);
    }
    return sent.value;
  }
  const decisionMessage = await sendDecisionRequest('The operator must choose how Goal B proceeds.', 's5-decision-send');
  const sentAnsweredMessage = await sendDecisionRequest(
    'The operator must choose how to update Goal B or adopt candidate U1.', 's5-answered-send');
  const answeredCard = sentAnsweredMessage.decision;
  if (answeredCard === undefined) throw new Error('S5 answered message has no decision metadata');
  const answered = await messageDecisions.answerDecision(ctx, {
    input: { source: answeredCard.source, selection: { kind: 'option', optionId: 'accept' }, text: '', annotations: [] },
    meta: { requestId: 's5-answered-answer', expected: [
      { ref: sentAnsweredMessage.ref, revision: sentAnsweredMessage.revision }, ...answeredCard.source.pins] },
  });
  if (answered.status !== 'committed') throw new Error(`S5 answered decision failed: ${JSON.stringify(answered)}`);
  const answeredMessage = answered.value;

  // ---- lookup helpers over the (possibly reopened) active records ----------
  async function lookupRefs(index: string, values: readonly (string | number | boolean | null)[], limit = 50): Promise<string[]> {
    const page = await activeRecords.lookup({ index, values, limit });
    if (page.status !== 'ready') throw new Error(`S5 lookup ${index} failed: ${JSON.stringify(page)}`);
    return page.value.records.map(record => record.refKey);
  }

  /**
   * No backend exposes an unrestricted public enumeration. Records use the
   * registered per-aggregate indexes above (all pages); events use eventAt up
   * to the real readMany([]) watermark. SQLite additionally exposes the actual
   * claim/receipt tables via a READ-ONLY connection.
   *
   * Memory has neither claim enumeration nor receipt enumeration. Its slot
   * vocabulary is every attempted claim through the fixture's shared records
   * port, plus B2's pre-existing Session mapping slots, discovered from the
   * actual Session records. Each owner is read using Store's unique-conflict
   * result, NOT inferred from a call counter or an expected owner. The probe
   * also has ledgerHorizon:null: even if its sentinel were an actual owner, the
   * nonempty ledger rejects it before any write/receipt/event. These probes use
   * the underlying port so observation does not change diagnostic counters.
   * Build all tested owners over f.records; foreign B2 owners are not P/W
   * fixture writers. Receipt count is omitted on memory, never guessed.
   */
  async function storeSnapshot(): Promise<S5StoreSnapshot> {
    const before = await activeRecords.readMany([]);
    if (before.status !== 'ready') throw new Error(`S5 snapshot watermark failed: ${JSON.stringify(before)}`);
    const lastCursor = before.value.readThrough;
    if (lastCursor === null) throw new Error('S5 snapshot requires its seeded, nonempty ledger');
    const stored: EncodedRecord[] = [];
    for (const aggregateType of snapshotTypes) {
      let after: string | undefined;
      do {
        const page = await activeRecords.lookup({ index: snapshotIndex(aggregateType), values: [aggregateType],
          limit: 200, ...(after === undefined ? {} : { after }) });
        if (page.status !== 'ready') throw new Error(`S5 snapshot lookup failed: ${JSON.stringify(page)}`);
        stored.push(...page.value.records);
        after = page.value.next ?? undefined;
      } while (after !== undefined);
    }
    // The inherited B2 setup only creates Session-mapping unique slots; Work
    // claim exclusion lives in TaskLease records, not unique claims.
    for (const record of stored.filter(record => record.schemaId === 'SessionRecord@1')) {
      const decoded = decodeSessionRecord(record);
      if (decoded.status !== 'decoded') throw new Error(`S5 snapshot Session decode failed: ${decoded.reason}`);
      knownClaimKeys.add(kernelSessionClaimKey(decoded.value.kernel.adapterId, decoded.value.kernel.kernelSessionId));
    }
    let eventCount = 0;
    for (let seq = 1; seq <= seqOfCommitCursor(lastCursor); seq += 1) {
      const event = await activeRecords.eventAt(makeCommitCursor(seq));
      if (event.status !== 'ready') throw new Error(`S5 snapshot event ${seq} failed: ${JSON.stringify(event)}`);
      eventCount += 1;
    }
    const claims: S5StoreSnapshot['claims'] = [];
    let receiptCount: number | undefined;
    if (kind === 'sqlite') {
      const db = new DatabaseSync(b2.base.ledgerPath, { readOnly: true });
      try {
        for (const row of db.prepare('SELECT claim_key, owner_key FROM identity_claims ORDER BY claim_key').all()) {
          if (typeof row.claim_key !== 'string' || typeof row.owner_key !== 'string') throw new Error('S5 corrupt claim row');
          claims.push({ claimKey: row.claim_key, owner: row.owner_key });
        }
        const count = db.prepare('SELECT COUNT(*) AS count FROM idempotency').get();
        if (count === undefined || typeof count.count !== 'number') throw new Error('S5 receipt count unavailable');
        receiptCount = count.count;
      } finally {
        db.close();
      }
    } else {
      const sentinel = 's5-snapshot-owner-probe';
      for (const claimKey of [...knownClaimKeys].sort()) {
        const event = { eventId: 's5-snapshot-probe-event', eventType: 'TrustedScopeSeeded', schemaVersion: 1, occurredAt: T };
        const probed = await activeRecords.commit({
          identityKey: `s5-snapshot-probe:${claimKey}`, fingerprint: 's5-snapshot-probe',
          guards: [], records: [], claims: [{ claimKey, expectedOwner: sentinel, nextOwner: sentinel }],
          events: [{ ...event, json: JSON.stringify(event) }], indexGuards: [], indexChanges: [], ledgerHorizon: null,
        });
        if (probed.status !== 'rejected') throw new Error('S5 snapshot probe must never commit');
        if (probed.code === 'unique_conflict') {
          const actual = probed.current.find(entry => entry.claimKey === claimKey);
          if (actual === undefined) throw new Error('S5 snapshot probe omitted its claim');
          if (actual.owner !== null) claims.push({ claimKey, owner: actual.owner });
        } else if (probed.code === 'revision_conflict' && probed.current.length === 0) {
          // All slot guards matched; only the deliberately empty horizon lost.
          claims.push({ claimKey, owner: sentinel });
        } else {
          throw new Error(`S5 snapshot claim probe failed: ${JSON.stringify(probed)}`);
        }
      }
    }
    const after = await activeRecords.readMany([]);
    if (after.status !== 'ready' || after.value.readThrough !== lastCursor) {
      throw new Error('S5 storeSnapshot requires a quiescent store; finish concurrent operations first');
    }
    const versions = stored.map(({ refKey, revision }) => ({ refKey, revision }))
      .sort((left, right) => left.refKey < right.refKey ? -1 : left.refKey > right.refKey ? 1 : 0);
    return { records: versions, recordCount: versions.length, eventCount, lastCursor,
      claims, claimCount: claims.length, ...(receiptCount === undefined ? {} : { receiptCount }) };
  }

  let secondary: Awaited<ReturnType<B2ExecutionFixture['base']['reopenService']>> | undefined;

  const fixture: S5DecisionFixture = {
    kind, b2, records, counts, bodies, base, ctx, workspace, allocationCounts, newId, now, storeSnapshot,
    goals: { A: { ref: GOAL_A, snapshot: goalA, order: GOAL_ORDER.A, autonomy: goalA.settings!.autonomy },
      B: { ref: GOAL_B, snapshot: goalB, order: GOAL_ORDER.B, autonomy: goalB.settings!.autonomy },
      C: { ref: GOAL_C, snapshot: goalC, order: GOAL_ORDER.C, autonomy: goalC.settings!.autonomy } },
    plans: { A1: planA1, B1: planB1, C1: planC1 },
    sessionS, sessionSecond, claimRA, runRA, claimRB, runRB, duties: fixtureDuties, operatorActor,
    requests: { Q1, Q2 }, candidates: { U1, U2 }, messages: { decision: decisionMessage, answered: answeredMessage },
    seedCommit, seedGoalSnapshot: snapshot => seedCommit([encodeGoalSnapshot(snapshot)]),
    seedPlanRevisionSnapshot: snapshot => seedCommit([encodePlanRevisionSnapshot(snapshot)]),
    seedCandidateProposal: proposal => seedCommit([encodePlanProposal(proposal)]),
    claimRun, enterClaim: realRuntime ? enterThroughRuntime : enterClaim, createS5Session, createRealS5Session,
    settleRun: realRuntime ? settleThroughRuntime : settleRun,
    settleRunRA: () => (realRuntime ? settleThroughRuntime : settleRun)(claimRA), seedQueryJob, lookupRefs,
    messagesByWorkspaceStatus: status => lookupRefs(S5_MESSAGE_BY_WORKSPACE_STATUS, [PROJECT_ID, WORKSPACE_ID, status]),
    planProposalsByRequest: queryJobId => lookupRefs(S5_PLAN_PROPOSAL_BY_REQUEST, [PROJECT_ID, WORKSPACE_ID, GOAL_B.goalId, queryJobId]),
    userMessagesByGoal: goalId => lookupRefs(S5_USER_MESSAGE_BY_GOAL, [PROJECT_ID, WORKSPACE_ID, 'user', goalId]),
    decisionAnswersBySource: (sourceKind, key) => lookupRefs(S5_DECISION_ANSWER_BY_SOURCE, [PROJECT_ID, WORKSPACE_ID, sourceKind, key]),
    queryJobsByGoal: goalId => lookupRefs(S5_QUERY_JOB_BY_GOAL, [PROJECT_ID, WORKSPACE_ID, goalId]),
    async reopen(): Promise<S5ReopenedFixture> {
      if (kind !== 'sqlite') throw new Error('S5 fixture reopen is only meaningful for the SQLite backend');
      await b2.base.closeBackend();
      await secondary?.close();
      await closeBodies();
      secondary = await b2.base.reopenService();
      const opened = secondary;
      activeRecords = opened.records;
      const store = createSqliteRawArtifactStore(bodyPath);
      bodies = allocations.observeBodies(store);
      closeBodies = () => store.close();
      fixture.bodies = bodies;
      return {
        records, bodies, counts, allocationCounts, newId, now, storeSnapshot,
        lookupRefs: async (index, values, limit = 50) => {
          const page = await activeRecords.lookup({ index, values, limit });
          if (page.status !== 'ready') throw new Error(`S5 lookup ${index} failed: ${JSON.stringify(page)}`);
          return page.value.records.map(record => record.refKey);
        },
        close: async () => { await store.close(); await opened.close(); },
      };
    },
    async close() {
      for (const steps of runtimeSteps.values()) await steps.close().catch(() => undefined);
      await secondary?.close().catch(() => undefined);
      await closeBodies().catch(() => undefined);
      await b2.close();
    },
  };
  return fixture;
}
