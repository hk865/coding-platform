import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { totalmem } from 'node:os';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import type { ResourceCapSource } from '../../vendor/coding-agent/dist/public-api.js';
import { MIB, defaultResourceCapSettings } from '../contracts/resource-caps.js';
import { createInMemoryRecordBackend } from '../core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../core/record-store/sqlite-record-store.js';
import { RawArtifactBodyStore } from '../core/record-store/body-store.js';
import { createSqliteRawArtifactStore } from '../core/record-store/sqlite-body-store.js';
import { createGoalService } from '../core/work-graph/tasks/task-service.js';
import type { GoalTaskPort, GraphWrite } from '../core/work-graph/model/task-contracts.js';
import { COMPLETION_RECORD_SCHEMAS } from '../core/work-graph/tasks/completion-record-codecs.js';
import { createMaterialRecordReaders, materialRecordSchemas } from '../core/work-graph/materials/record-readers.js';
import { createMaterialService } from '../core/work-graph/materials/material-service.js';
import type { MaterialPort } from '../core/work-graph/model/material-contracts.js';
import { createWorkspaceAccessFactory, type WorkspaceHostBindings } from '../core/workspace/access.js';
import { createWorkspaceTools, DEFAULT_WORKSPACE_LIMITS } from '../core/workspace/workspace-tools.js';
import { createAgentRuntime } from '../core/agent-runtime/runtime.js';
import { createPlatformPromptPackSource, type PromptPackSourcePort } from '../contracts/prompts/prompt-pack.js';
import type { RuntimeExecutionPort } from '../core/agent-runtime/ports.js';
import { createExecutionEntryService, readManifestFromEnvelope } from '../core/work-graph/tasks/execution-entry-service.js';
import { createModelCallService, createModelRequestReadPort } from '../core/work-graph/tasks/model-call-service.js';
import { createSessionMailbox, createMessageWriteOwner } from '../core/work-graph/communication/mailbox-service.js';
import { createDecisionMessageService } from '../core/work-graph/communication/decision-service.js';
import { createDecisionSourceFacts } from '../core/work-graph/communication/decision-source-facts.js';
import { createGoalSettingsService } from '../core/work-graph/tasks/goal-settings-service.js';
import { decisionActionPolicy } from '../core/work-graph/state/decision-policy.js';
import { readGoalSettings as readEffectiveGoalSettings, decodeGoalSnapshot } from '../core/work-graph/persistence/record-codecs.js';
import { createGoalExecutedFilesReader } from '../core/work-graph/tasks/goal-executed-files-reader.js';
import {
  createActivityReadModel, type ActivityReadPort,
} from '../core/work-graph/views/activity-read-model.js';
import { createTrackReadModel, type TrackReadPort } from '../core/work-graph/views/track-read-model.js';
import { createTaskStateTimeline, type TaskTimelineReadPort } from '../core/work-graph/views/task-state-timeline.js';
import { createGoalDecisionCauseReader } from '../core/work-graph/tasks/goal-decision-reader.js';
import { createPlanningQuestionReader } from '../core/work-graph/tasks/planning-question-reader.js';
import { createDecisionSettingsService } from '../core/work-graph/configuration/decision-settings-service.js';
import { createMessageDutiesFactsAdapter } from '../core/work-graph/configuration/message-duties-adapter.js';
import { createUndeliveredReplyNoticeSource } from '../core/work-graph/views/undelivered-reply-notices.js';
import { platformRoleProfile } from '../core/agent-runtime/role-profiles.js';
import {
  createCommandRerunRequestCardSource, createDecisionReadModel, createGoalCauseCardSource,
  createNoteReviewCardSource, createPlanningQuestionCardSource, createUnknownCallReviewCardSource,
} from '../core/work-graph/views/decision-read-model.js';
import { createGoalConflictAssembler } from '../core/work-graph/views/goal-conflicts.js';
import { createAutomaticReworkNoticeSource } from '../core/work-graph/views/automatic-rework-notices.js';
import { createNoteReviewNoticeSource } from '../core/work-graph/views/note-review-notices.js';
import { createNoticePositionComparator } from '../core/work-graph/views/notice-position.js';
import { createNoticeDisplayToken } from '../core/work-graph/views/notice-display-token.js';
import type {
  DecisionMessagePort, DecisionReadPort, GoalSettingsPort, NoteDecisionSourcePort,
  RequestCandidatePort, WorkspaceDecisionSettingsPort,
} from '../core/work-graph/model/decision-contracts.js';
import type { SessionMailboxPort } from '../core/work-graph/model/communication-contracts.js';
import { SESSION_MESSAGE_RECORD_SCHEMAS } from '../core/work-graph/sessions/message-record-codecs.js';
import { createSourceAuthorityReader } from '../core/work-graph/source-authority-reader.js';
import { createWorkflow } from '../business/workflow/workflow.js';
import { createCommandRerunRequestApplicationAdapter } from '../business/workflow/decision-actions.js';
import type { DecisionApplicationAdapter } from '../business/workflow/decision-actions.js';
import { createSessionDutyResolver } from './session-duty.js';
import { DEFAULT_SESSION_ARCHIVE_POLICY } from '../business/workflow/ports.js';
import type {
  SessionArchivePolicyV1, SessionDutyResolver, WorkflowDependencies, WorkflowHostConfiguration, WorkflowPort,
} from '../business/workflow/ports.js';
// The request commands and the one line-creation entry the composition wires
// over its own records/Session/role owners.
import { createRequestIntake, type RequestIntakePort } from '../business/workflow/request-intake.js';
import {
  createAlwaysAdmitCapacity, createLineCreation, type LineCapacityPort,
} from '../business/workflow/line-creation.js';
import { createRequestFacts } from '../core/work-graph/tasks/request-facts.js';
import {
  createRequestRoundService, type RequestFactsReader, type RequestRoundPort,
} from '../core/work-graph/tasks/request-service.js';
import { createProjectSecretaryScope, createSecretarySelection } from '../core/work-graph/tasks/secretary-selection.js';
import type { SecretaryProfilePort } from '../core/work-graph/model/request-contracts.js';

import { createEvidenceService } from '../core/work-graph/evidence/evidence-service.js';
import type { AutomaticReverifyPolicyV1 } from '../core/work-graph/evidence/evidence-service.js';
import { EVIDENCE_RECORD_SCHEMAS } from '../core/work-graph/persistence/evidence-record-codecs.js';
import { NOTE_RECORD_SCHEMAS } from '../core/work-graph/persistence/note-record-codecs.js';
import { createNoteService } from '../core/work-graph/notes/note-service.js';
import type { NoteRunFactResolver, NoteService } from '../core/work-graph/notes/note-service.js';
import { createNoteReadModel, readAllRecords, type NoteListReadPort, type NoteMemoryMaterialReadPort } from '../core/work-graph/notes/note-read-model.js';
import { createVersionLists } from '../core/work-graph/notes/note-version-lists.js';
import { createScribeScope } from '../core/work-graph/notes/scribe-scope.js';
import { createNoteCheck } from '../core/work-graph/views/note-views.js';
import { createNoteMemoryMaterial } from '../core/work-graph/notes/note-memory-material.js';
import { createNoteScribeTodos } from '../core/work-graph/notes/note-scribe-todos.js';
import { createNoteDecisionSource } from '../core/work-graph/notes/note-decision-source.js';
import type { ContextExtensionsDependencies } from '../core/work-graph/views/context-extensions.js';
import type { NoteCheckPort, NoteHeadCheckPort, NoteMemoryReadPort, NoteReadPort,
  NoteScopeReadPort, NoteScribeTodoPort, NoteWritePort } from '../core/work-graph/model/note-contracts.js';
import type { SourceProvider } from '../core/workspace/ports.js';
import { decodeRun } from '../core/work-graph/materials/run-snapshot-decoder.js';
import type { EvidencePort } from '../core/work-graph/model/evidence-contracts.js';
import { VerificationWorkspaceReader } from '../core/workspace/verification-workspace-reader.js';
import { createRegisteredCheckRunner, type RegisteredCheckRunner } from '../core/agent-runtime/check-execution.js';
import type { TrustedCheckConfiguration } from '../contracts/verification.js';

import { createExecutionHistoryService } from '../core/work-graph/tasks/execution-history-service.js';
import { EXECUTION_HISTORY_RECORD_SCHEMAS } from '../core/work-graph/persistence/execution-history-codecs.js';
import { EXECUTION_ENTRY_RECORD_SCHEMAS } from '../core/work-graph/persistence/execution-entry-codecs.js';
import { MODEL_REQUEST_RECORD_SCHEMAS } from '../core/work-graph/tasks/model-request-codecs.js';
import { createRunControlService } from '../core/work-graph/tasks/control-service.js';
import type { RunControlPort } from '../core/work-graph/tasks/control-contracts.js';
import { CONTROL_RECORD_SCHEMAS } from '../core/work-graph/persistence/control-record-codecs.js';
import type { ExecutionHistoryWritePort } from '../core/work-graph/model/execution-history-contracts.js';
import { createGraphExecutionHistoryReader } from '../core/agent-runtime/graph-execution-history.js';
import { createRunStateReader } from '../core/work-graph/tasks/run-state-service.js';
import type { ExecutionReadPort } from '../core/work-graph/model/execution-read-contracts.js';
import { createExecutionHistoryReader } from '../core/agent-runtime/observation-recovery.js';
import { createTaskClaimService } from '../core/work-graph/tasks/claim-service.js';
import { createTaskRequeueService } from '../core/work-graph/tasks/requeue-service.js';
import { TASK_CLAIM_RECORD_SCHEMAS, decodeDispatchOutboxEntry, dispatchOutboxRefKey } from '../core/work-graph/tasks/claim-record-codecs.js';
import type { TaskClaimPort } from '../core/work-graph/model/claim-contracts.js';
import type { RoleConfigurationPort } from '../core/work-graph/model/configuration-contracts.js';
import { createPlanService, createRequestCandidateService } from '../core/work-graph/tasks/plan-service.js';
import type { PlanServiceDependencies } from '../core/work-graph/tasks/plan-service.js';
import { PLAN_RECORD_SCHEMAS } from '../core/work-graph/persistence/plan-record-codecs.js';
import { DECISION_RECORD_SCHEMAS } from '../core/work-graph/persistence/decision-record-codecs.js';
import { PLAN_STATE_RECORD_SCHEMAS, PLAN_GOVERNANCE_RECORD_SCHEMAS, GOAL_BY_WORKSPACE_INDEX, createSessionResponsibilityBasisReader, createNoteRunTaskResolver, readCanonicalTaskFacts, readGoalPlanWindow, readTaskClosure, type TaskClosureV1 } from '../core/work-graph/tasks/plan-readers.js';
import { createSessionDirectory } from '../core/work-graph/sessions/session-directory.js';
import type { SessionDirectoryPort } from '../core/work-graph/model/session-contracts.js';
import { SESSION_RECORD_SCHEMAS, decodeSessionRecord, plainSessionRefToAggregate, sessionAggregateRefKey } from '../core/work-graph/sessions/session-record-codecs.js';
import { createSessionLifecycleService } from '../core/work-graph/sessions/session-lifecycle.js';
import type { SessionLifecyclePort } from '../core/work-graph/sessions/lifecycle-contracts.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS } from '../core/work-graph/sessions/lifecycle-record-codecs.js';
// Slice 1 (spec §3.3, §4.4): the Session-facts, responsibility and anomaly owners
// constructed by this composition root and injected through the narrow ports.
import { createSessionFactsService } from '../core/work-graph/tasks/session-facts.js';
import { createSessionResponsibilityService } from '../core/work-graph/sessions/session-responsibility-service.js';
import { createSessionAnomalyService } from '../core/work-graph/tasks/session-anomaly-service.js';
import { createUnknownCallReviewService } from '../core/work-graph/tasks/unknown-call-review-service.js';
import { UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS } from '../core/work-graph/tasks/unknown-call-review-codecs.js';
import { readUnappliedAnswers } from '../core/work-graph/tasks/unknown-call-review-answers.js';
import { createCommandRerunRequestService } from '../core/work-graph/tasks/command-rerun-request-service.js';
import { COMMAND_RERUN_REQUEST_RECORD_SCHEMAS } from '../core/work-graph/tasks/command-rerun-request-codecs.js';
import { createCommandRecognizer } from '../core/work-graph/tasks/command-recognition.js';
import { readKernelCommandFacts } from '../core/agent-runtime/context-assembler.js';
import { readTaskReviews } from '../core/work-graph/tasks/task-review-reader.js';
import { captureWorkspaceChange, type WorkspaceChangeCaptureResult } from '../core/workspace/workspace-change-capture.js';
import { readWorkspaceBaselineFromBundle } from '../core/workspace/workspace-baseline-artifact.js';
import { WORKSPACE_DENIED_PREFIXES } from '../core/workspace/denied-prefixes.js';
import { createToolCommitLookup } from './tool-commit-lookup.js';
import type {
  WorkspaceBaselineV1, WorkspaceCaptureV1,
} from '../contracts/unknown-call-review.js';
import { SLICE1_LOOKUP_INDEXES } from '../core/work-graph/model/session-facts-contracts.js';
import { createKernelStoreRegistry } from '../core/agent-runtime/kernel-store-locator.js';
import { createSessionHistoryCursorOwner, createSessionOperations } from '../core/agent-runtime/session-operations.js';
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { CommitCursor } from '../contracts/command-event.js';
import type { DecisionApplicationReceiptV1 } from '../contracts/core/session-message.js';
import type { SessionRef } from '../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../contracts/core/results.js';
import type { VersionPin } from '../contracts/core/identity.js';
import type { GoalRef } from '../contracts/ledger.js';
import type { RoleConfigurationRef } from '../contracts/core/identity.js';
import { isReviewRoundPurpose, reviewRoundAdmissionProblem } from '../contracts/review-admission.js';
import type { PlatformDutyV1 } from '../contracts/platform-duty.js';
import { canonicalJson, type JsonValue } from '../contracts/fingerprint.js';
import type { RuntimeCapabilities } from '../core/agent-runtime/contracts.js';
import type {
  ContinuationWorkspaceSource, ReadonlyCommandAccessInput, RuntimeExecutionDependencies, RuntimeHostBindings,
} from '../core/agent-runtime/execution-contracts.js';
import type {
  AuthorizeConfiguration, ExecutionEntryDependencies, ExecutionEntryPort,
} from '../core/work-graph/model/execution-entry-contracts.js';
import { createRoleConfigurationService } from '../core/work-graph/configuration/role-memory-service.js';
import { ROLE_RECORD_SCHEMAS } from '../core/work-graph/configuration/role-record-codecs.js';
import { createProjectBootstrapServices } from '../core/work-graph/configuration/project-bootstrap-service.js';
import { createQueryExecution } from '../core/work-graph/queries/query-execution.js';
import { SESSION_ANOMALY_RECORD_SCHEMAS } from '../core/work-graph/tasks/session-anomaly-codecs.js';
import { projectQueryConfiguration } from '../core/agent-runtime/query-preparation.js';
import { createTaskContextInputService } from '../core/work-graph/tasks/context-input-service.js';
import { createGraphContextReader } from '../core/work-graph/views/graph-context-reader.js';
import { createContextExtensionsReader } from '../core/work-graph/views/context-extensions.js';
import type { GraphContextReadPort } from '../core/work-graph/model/graph-context-contracts.js';
import type { TaskContextInputPort } from '../core/work-graph/model/context-input-contracts.js';
import { createQueryJobService } from '../core/work-graph/queries/query-job-service.js';
import type {
  CompletionPolicyConfigurationPort, ProjectRegistrationPort,
} from '../core/work-graph/configuration/project-bootstrap-contracts.js';
import { PROJECT_BOOTSTRAP_RECORD_SCHEMAS } from '../core/work-graph/configuration/project-bootstrap-record-codecs.js';
import type { AuthorizeQueryConfiguration, QueryJobPort } from '../core/work-graph/queries/contracts.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../core/work-graph/queries/query-record-codecs.js';
import { createObservedArchitecture } from '../core/work-graph/architecture/architecture-service.js';
import { OBSERVED_ARCHITECTURE_RECORD_SCHEMAS } from '../core/work-graph/architecture/architecture-record-codecs.js';
import { createArchitectureCatalogService } from '../core/work-graph/architecture/catalog-service.js';
import type { ArchitectureCatalogPort } from '../core/work-graph/architecture/catalog-contracts.js';
import { ARCHITECTURE_CATALOG_SCHEMAS } from '../core/work-graph/architecture/catalog-record-codecs.js';
import { observeRecordCommits, type RecordCommitObserver } from './commit-observer.js';
import type { HostInstanceFacts } from '../core/work-graph/model/execution-entry-contracts.js';
import { createRunReconcileService } from '../core/work-graph/tasks/run-reconcile-service.js';
import type { RunReconcileService } from '../core/work-graph/tasks/run-reconcile-contracts.js';
import { createRunActivityService } from '../core/work-graph/tasks/run-activity-service.js';
import { createReconcileCandidateReader } from '../core/work-graph/tasks/reconcile-reads.js';
import { createSessionHealthService } from '../core/work-graph/sessions/session-health.js';
import {
  readAttestationFacts, readReviewDraftAtEntry, reconcileQueryRunAtStartup, reconcileRunAtStartup,
  reconcileRunControlsAtStartup,
} from '../core/agent-runtime/run-reconcile.js';
import { readUnknownCallReviewDraft } from '../core/agent-runtime/unknown-call-draft.js';
import type { SessionMappingProbe } from '../core/agent-runtime/session-operations.js';
import type { TaskExecutionRecord } from '../core/work-graph/model/execution-read-contracts.js';
import type { QueryExecutionRecord } from '../core/work-graph/queries/contracts.js';
import type { RunRef, RunSnapshot, SourceRefV1 } from '../contracts/dispatch.js';
import type { QueryRunRef } from '../contracts/query-job.js';
import type { WriteResult } from '../contracts/core/results.js';
import {
  DEFAULT_TASK_AUTOMATION_POLICY, MAX_AUTO_REWORK_LIMIT, type TaskAutomationPolicyV1,
} from '../contracts/task-requeue.js';
// Slice 2C (spec §6): the line/detail read owners, the pin write owner and the
// Host-assembled conversation, plus the persisted line-pin event schema.
import {
  createWorkLineReader, type WorkLineReaderDeps,
} from '../core/work-graph/views/work-line-reader.js';
import { createNodeDetailReader } from '../core/work-graph/views/node-detail-reader.js';
import { createLineSettingsService } from '../core/work-graph/configuration/line-settings-service.js';
import { LINE_SETTINGS_RECORD_SCHEMAS } from '../core/work-graph/persistence/line-settings-codecs.js';
import type {
  NodeDetailReadPort, WorkLineReadPort, WorkLineSettingsPort,
} from '../core/work-graph/model/work-line-contracts.js';
import { createWorkLineConversation } from './work-line-conversation.js';
import { createArchitectureReminderFactsReader } from './architecture-reminder-facts.js';

export type TargetPlatformOptions = {
  storage: { kind: 'memory' } | { kind: 'sqlite'; directory: string };
  workspace: WorkspaceHostBindings;
  now?: () => string;
  /** Trusted source route; defaults to TypeScript at tsconfig.json. No language inference.
   * `configPath: null` captures with no project configuration. */
  architectureSource?: { provider: 'typescript'; configPath: string | null };
  /** 8A file-graph caps. Test injection only, like `resultMaxBytes`; production
   * leaves this absent and `createWorkspaceTools` uses its own defaults
   * (20,000 files / 100,000 edges). `chunkBytes` is passed through to the
   * observed-architecture chunk writer (A-12's small chunk size). */
  fileGraph?: { maxNodes: number; maxEdges: number; chunkBytes?: number };
  /** §11.2 trusted test injection for the one observation light scan: a fault hook
   * and the raw-reference cap. Passed through; never model input. */
  lightScan?: { fault?: (event: { phase: 'language' } | { phase: 'file'; path: string }) => void; maxRawReferences?: number };
  /**
   * L8 (interface §7): after a NON-REPLAYED successful catalog adoption, revision
   * or a PASS finalized check, the composition notifies the Host so its one serial
   * auto-capture driver can accept a new request. Called inside try/catch; the
   * caller's result is unchanged.
   */
  onArchitectureCaptureTrigger?: (event: {
    kind: 'catalog_adopted' | 'catalog_revised' | 'check_passed';
    projectId: string;
  }) => void;
  /** Trusted startup configuration; never taken from a model tool request. */
  kernelStores?: Parameters<typeof createKernelStoreRegistry>[0];
  /** Trusted Host execution binding. Its model/tool/template grant is the only
   * production execution route; a caller cannot supply a client, root, hook,
   * permission or database here. When absent, execution stays explicitly
   * unsupported while Session creation/history keep their accepted behavior. */
  runtime?: RuntimeHostBindings;
  /** The Host's disk-backed pack source. When present the
   * preparation reads person's packs through it; absent keeps the platform
   * source (a Host without a settings directory). */
  promptPacks?: PromptPackSourcePort;
  /**
   * L13: the Host's live resource-cap source handed to the Runtime and the
   * registered-check runner. Absent uses the machine-memory default (a test
   * that builds the platform directly). It adds no platform member.
   */
  resourceCaps?: ResourceCapSource;
  /** Trusted per-workspace source policy, consumed by the existing source factories. */
  sourcePolicyFor?: RuntimeExecutionDependencies['sourcePolicyFor'];
  /**
   * L13/8D trusted analyzer resources: the Python analyzers archive directory, the
   * system interpreter for both analyzers and the installed libclang. Production
   * passes nothing and keeps the indexes' defaults; it is forwarded to the capture
   * providers and the exploration tools and adds no public platform member.
   */
  sourceAnalyzers?: RuntimeExecutionDependencies['sourceAnalyzers'];
  /** Optional frozen trusted checks configuration. Without it the platform has
   * no registered check and the fresh evidence/check entry stays unsupported;
   * existing history reads keep working. Never defaulted to full access. */
  checks?: TrustedCheckConfiguration;
  /** Optional trusted Workflow advancement policy (R5c.1). It selects the exact
   * Session role/RoleBinding/TaskBudget per workspace; it grants no model, tool
   * or file capability and is snapshotted as pure data. Without it only the
   * Workflow's fresh selection is unsupported; every other port is unchanged. */
  workflow?: WorkflowHostConfiguration;
  /** Optional Host change observer (task E). It sees the head once and then
   * every non-replayed RecordStore commit; it never receives record bodies and
   * cannot change a receipt. */
  commitObserver?: RecordCommitObserver;
  /**
   * A.2 step 5.6 (D-18, L-10): this Host instance and whether it holds the
   * instance lease. The start-up reconcile, the attestations and every
   * R-source write are admitted only under `owned`; absent, they answer `busy`.
   */
  hostInstance?: HostInstanceFacts;
  /**
   * Slice 1 (spec §2.8, §3.3): the trusted archive timing policy. It is Host
   * startup data, not a project setting; absent reads as
   * `DEFAULT_SESSION_ARCHIVE_POLICY` (one day / 100 per page).
   */
  sessionArchivePolicy?: SessionArchivePolicyV1;
  /**
   * Slice 1 (spec §2.8, L4) with wiring 1 I-1 (§2.4, L5): the trusted duty
   * resolver. Absent resolves from the Session's own fixed role facts (the
   * pinned RoleSpec's `platformDuty` or the exact platform legacy template),
   * and falls back to `WorkflowHostConfiguration.bindings[].sessionRole` only
   * when both are absent; the resolver is a trusted Host callback, never a
   * model input or a stored Session field.
   */
  sessionDutyResolver?: SessionDutyResolver;
  /**
   * The Host's `SecretaryProfilePort` over its LIVE query
   * profile list. A direct platform that supplies none gets a port that answers
   * null from both methods, so a request command answers
   * `unavailable no_secretary_binding` instead of crashing; the composition
   * never invents a profile.
   */
  secretaryProfiles?: SecretaryProfilePort;
  /**
   * The secretary open cap. Unset keeps `createAlwaysAdmitCapacity`: no
   * reservation cap exists without it. A positive
   * integer counts the workspace's live secretary Sessions (lifecycle `active`,
   * duty `secretary`) and refuses a new line at the cap.
   */
  secretaryOpenCap?: number;
  /**
   * Slice 5 §3.2/§2.6: the exact configured operator of this Host. It is the
   * Host's real start actor (a human or system actor, never a platform
   * automation actor), injected here and never taken from HTTP JSON. Without it
   * the new user write entries answer `unsupported`.
   */
  operatorActor?: { kind: 'human' | 'system'; id: string };
  /**
   * Slice 4A: the soft note limits are injectable constants (spec §2, DESIGN
   * §9.3). Production never passes this; a test shrinks them to exercise the
   * quota path without writing hundreds of notes.
   *
   * Slice 4B round 2 (R16): the same option also carries the check and
   * read-model limits, because one call spreads it into the note service, the
   * note check and the read model. It is the only way a test can reach the
   * limits of the production `platform.notes` holder.
   */
  noteLimits?: {
    anchorQuota?: number; goalQuota?: number; symbolHitsMax?: number; basisFileMaxBytes?: number;
    readFilesMax?: number; readFactsMax?: number; symbolRecheckMax?: number;
    textSearchCandidateMax?: number; textSearchMaxTerms?: number; resultMaxBytes?: number;
  };
  /**
   * Slice 4C-2 D-03: the injectable note id generator (`createNoteService`'s
   * `newId`). Production never passes it (the default is `randomUUID`); a test
   * pins literal note identities so a reminder request id is a fixed expected
   * value instead of being recomputed from write results.
   */
  noteNewId?: () => string;
};

/** The composition-owned service identity. It is used only to execute trusted
 * platform material reads and mailbox body storage; it never replaces the real
 * command actor/sender. */
const SYSTEM_ACTOR = Object.freeze({ kind: 'system' as const, id: 'platform-composition-host' });

function sameJson(left: unknown, right: unknown): boolean {
  try { return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue); } catch { return false; }
}

/** Slice 4C-2 U6: the four note-card options the notes owner accepts. */
type NoteOptionId = 'accept' | 'reject' | 'supersede' | 'coexist';
const NOTE_OPTION_IDS: readonly NoteOptionId[] = ['accept', 'reject', 'supersede', 'coexist'];
function isNoteOptionId(value: string): value is NoteOptionId {
  return (NOTE_OPTION_IDS as readonly string[]).includes(value);
}

/**
 * Slice 4C-2 U6: parse the note pin back out of a `note_review` source key. The
 * card source key is the canonical `{kind:'note_review', note: VersionPin}`; a
 * key that names no NoteHead is not an applicable card.
 */
function parseNoteReviewKey(key: string): { noteId: string; revision: number } | null {
  let parsed: unknown;
  try { parsed = JSON.parse(key); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const identity = parsed as { kind?: unknown; note?: unknown };
  if (identity.kind !== 'note_review' || typeof identity.note !== 'object' || identity.note === null) return null;
  const pin = identity.note as { ref?: { aggregateType?: unknown; noteId?: unknown }; revision?: unknown };
  if (typeof pin.ref !== 'object' || pin.ref === null || pin.ref.aggregateType !== 'NoteHead'
    || typeof pin.ref.noteId !== 'string' || pin.ref.noteId.length === 0
    || typeof pin.revision !== 'number' || !Number.isSafeInteger(pin.revision)) return null;
  return { noteId: pin.ref.noteId, revision: pin.revision };
}

/**
 * Slice 1 (spec §2.8, T6): validate the trusted Host archive timing policy.
 * Both values must be positive safe integers and the page size must be 1..100;
 * an absent policy is the frozen default. A malformed policy is a startup
 * configuration error, never a silently clamped default.
 */
function sessionArchivePolicyOf(policy: SessionArchivePolicyV1 | undefined): SessionArchivePolicyV1 {
  if (policy === undefined) return { ...DEFAULT_SESSION_ARCHIVE_POLICY };
  const { executorArchiveAfterMs, maintenancePageSize } = policy;
  if (policy.schemaVersion !== 1
    || !Number.isSafeInteger(executorArchiveAfterMs) || executorArchiveAfterMs <= 0
    || !Number.isSafeInteger(maintenancePageSize) || maintenancePageSize < 1 || maintenancePageSize > 100) {
    throw new Error('the Session archive policy is malformed: positive safe integers and a maintenance page size of 1..100 are required');
  }
  return { schemaVersion: 1, executorArchiveAfterMs, maintenancePageSize };
}

/**
 * The workspace-level Runtime capability report (STATE-MACHINES-SPEC §7.7, D-15).
 * Every item carries its own reason, and a supported item's reason states the
 * boundary of that support. It is a declaration only: no server behaviour is
 * gated on it, and a single Run's actual result is still its ControlIntent
 * status and observation (MVP-BEHAVIOR B08). A.2 step 5.2 reports
 * `continueHistory` (lead decision LA-1: a continuation is a new Run), and
 * `safePointPause` and `cancel` (D-7) as supported; step 5.7 reports
 * `recoverRun` as supported: the start-up reconciliation only, never a fresh
 * resume of the original Turn (D-17, C4, LA-6). D-15 asks for the report as
 * it is: each reason states only what holds today, and the §7.7 target
 * boundaries are added by the substep that builds them (5.4 added the requeue
 * continuation brief, C3; 5.6 added the new Session after an open Kernel Turn,
 * the restart rebuild, the paused-interrupted end, the RUN-14 live-handle
 * guard, the paused stop, the restart stop and C7; 5.8 added the automatic
 * requeue of an interruption and the start-up re-drive of a Goal whose required
 * Task has the automation verdict requeue or claim_requeued; 5.9 added reverify
 * to that re-drive). The `recoverRun` reason always says what the Host setting
 * `automation.resumeOnStartup` off does (the reconciliation still runs, no
 * driver starts after it; LA-6). `resumeOnStartup` is that setting as
 * installed now: when it is off, the reason also says that this Host has it
 * off, a fact on a Host with or without the instance lease (5.7). Built fresh
 * per read, so a caller cannot change a later report.
 */
function workspaceRuntimeCapabilities(
  adapterId: string, kernelSessionApiVersion: RuntimeCapabilities['kernelSessionApiVersion'], resumeOnStartup: boolean,
): RuntimeCapabilities {
  return {
    adapterId, kernelSessionApiVersion,
    createSession: { supported: true, reason: 'durable creation and Kernel mapping are configured' },
    readHistory: { supported: true, reason: 'original Kernel history reader is configured' },
    continueHistory: { supported: true, reason: 'a continuation is a new Run, never a resume of the original Turn. '
      + 'A Run created by a requeue starts with a continuation brief of the previous Run\'s durable facts and is '
      + 'labelled a continuation, not a resumed execution. '
      + 'When the previous Turn has a Kernel terminal, a new Run in the same Session continues its history, '
      + 'including the successor Run after a yielded wait. When the previous Turn has no Kernel terminal (for '
      + 'example a Run interrupted by a Host restart, including one paused then, a Run stopped at restart by a '
      + 'queued cancel, or one a person attested while its Kernel Turn was still open), the Kernel refuses a new '
      + 'Turn in that Session and the original Session is unavailable (kernel_turn_open, its history stays '
      + 'readable) until the platform closes the dangling Turn. For a Work line the platform closes it as '
      + 'interrupted: the Session maintenance does so after a clean interruption, a stop by a queued cancel or a '
      + 'person\'s attestation, and the Workflow does so when a person, or the Goal, continues a '
      + 'paused-interrupted Run. The closure never resumes the interrupted Turn and never invents a result for an '
      + 'unfinished tool call; the Session becomes available again and the continuation is a new Run in the same '
      + 'Session, whose model history holds the completed Turns before the interrupted one, while what the '
      + 'interrupted Turn had accepted reaches it only through the continuation brief. When the closure is not '
      + 'possible (only the legacy Kernel reader, another Kernel adapter, a Kernel that cannot close a Turn, an '
      + 'unreadable Kernel store, or another Run at the Kernel head), and for a Query line, whose open Turn is not '
      + 'closed, the continuation is a new Run in a new Session that continues the original Session\'s last '
      + 'completed history (same Kernel adapter only; otherwise the brief alone). After a Host restart a waiting '
      + 'continuation is rebuilt only when its Turn has exactly one waiting message; otherwise its outcome is '
      + 'recorded as unknown (continuation_unrebuildable), keeping its Session and Lease until a person attests it' },
    recoverRun: { supported: true, reason: 'start-up reconciliation only, never a fresh resume of the original '
      + 'Turn: a Host that starts holding the instance lease reads each open Run\'s Kernel history before any '
      + 'execution driver starts, and books what it proves. A Kernel terminal is recorded as the Run ended; a Run '
      + 'that never entered the Kernel keeps its claim (an entry it began is revoked) and the same claim drives it '
      + 'again; a clean interruption (no tool call in flight) ends crashed with the failure class interrupted, '
      + 'which the automation requeues automatically, without counting it toward the automatic rework limit, '
      + 'and which a person can requeue too; a queued cancel with a clean Kernel Turn ends the Run cancelled; a '
      + 'Run paused when its Host stopped (its pause applied or still requested) ends paused-interrupted, which '
      + 'is not a failure and releases its Session and Lease: only a person continues it, or, when the pause came '
      + 'from the Goal, resuming the Goal continues it; an end it cannot prove is recorded as unknown, keeping its '
      + 'Session and Lease until a person attests it (an attestation also needs the instance lease), and a probe '
      + 'that proves nothing leaves the Run as recorded for the next start. The continuation of an interrupted Run '
      + 'is a new Run with a continuation brief: for a Work line, after the platform closes its dangling Kernel '
      + 'Turn as interrupted, in the same Session; when that closure is not possible, in a new Session that '
      + 'continues the original Session\'s last completed history (see continueHistory). After the reconciliation '
      + 'the Host starts the existing collaboration driver for each '
      + 'active Goal with work to advance automatically: a required active Task whose automation verdict is '
      + 'requeue, reverify or claim_requeued, or a Run that never entered and is not paused or cancelled, whose '
      + 'same claim is then driven again; this start-up re-drive follows the Host setting automation.resumeOnStartup (on by '
      + 'default), every step it takes is judged by the Workflow and the owners, a paused-interrupted Run is still '
      + 'continued only by a person, and there is no periodic scheduler. When that setting is off, the '
      + 'reconciliation still runs but no driver starts after it, and the automation continues only at '
      + 'workflow/advance, workflow/driver-start or an operator\'s action. A Host that does not hold the instance '
      + 'lease neither reconciles nor starts an execution driver; plain reads and owner writes are served as usual'
      + (resumeOnStartup ? '' : '. This Host has automation.resumeOnStartup turned off') },
    safePointPause: { supported: true, reason: 'an entered Work Run pauses through its live handle at the next '
      + 'safe point (before a model call or between tool groups), and a resume re-enters the original Turn only '
      + 'while this Host process still holds the live handle; a Run that has not entered the Kernel is paused and '
      + 'resumed by the platform at once. A Run paused when its Host stopped ends paused-interrupted after the '
      + 'restart, which is not a failure: only a person continues it (a new continuation Run, in the same '
      + 'Session once the platform has closed the dangling Kernel Turn, otherwise in a new Session), never '
      + 'automatically, or, when the pause came from the Goal, resuming the Goal continues it. '
      + 'A Query cannot be paused' },
    cancel: { supported: true, reason: 'an entered Run is cancelled through its live handle, and the cancel stays '
      + 'a pending stop request until the Run\'s stop is proved; a Run that has not entered the Kernel is '
      + 'cancelled by the platform at once. A cancel of an entered Run already paused at a safe point is applied '
      + 'by the platform on the exit proof of its live handle (the Kernel call exited and every resource closed). '
      + 'At a Host restart a queued cancel of a Run with a clean Kernel Turn (no tool call in flight) stops it, '
      + 'whether or not the Kernel paused it. A paused-interrupted Run has already ended and cannot be cancelled; '
      + 'change the Task disposition instead. A cancel of a yielded wait only fences its continuation. A Query '
      + 'cannot be cancelled: a control on a Query Run is refused as invalid and there is no QueryJob close, so a '
      + 'running Query ends only with its own terminal' },
    nativeCompact: { supported: false, reason: 'native Kernel compaction is not implemented' },
    scopedWorkspaceWrites: { supported: false, reason: 'the Host checks only that the prepared writeScope is '
      + 'within its grant; whether the Kernel enforces sub-path writes is not verified' },
  };
}

/**
 * The trusted Host projection consumed by the WorkGraph entry/model-call lanes.
 *
 * It consumes the exact Role resolution the WorkGraph admission recheck already
 * made, then calls the SAME `options.runtime.resolveConfiguration` binding the Runtime
 * driver uses. The prepared manifest permissions are only accepted after the
 * current Host tools/writeScope/shell grant and the Role ceiling allow them; the
 * whole Host template is taken from the current configuration (never rebuilt
 * from fixture constants). The returned value must still satisfy WorkGraph's
 * exact configuration/permissions/template agreement check.
 */
function createAuthorizeConfiguration(host: RuntimeHostBindings): AuthorizeConfiguration {
  return async (ctx, input) => {
    const resolution = input.roleResolution;
    if (resolution.status === 'inadmissible') {
      return { status: 'rejected', code: 'forbidden', reason: 'the current Role binding is inadmissible' };
    }
    const configured = await host.resolveConfiguration(ctx, {
      runRef: input.run.ref,
      role: input.sessionRole,
      // Isolate the reused entry resolution so handing it to the Host cannot
      // couple the admission's already-checked facts to a Host mutation.
      roleResolution: structuredClone(resolution),
    });
    if (configured.status !== 'ready') return configured;
    const current = configured.value;
    if (current.configurationRevision !== input.configurationRevision) {
      return { status: 'rejected', code: 'forbidden', reason: 'the current Host configuration revision disagrees with the prepared revision' };
    }
    // The accepted Run envelope, when present, is the formal permission source;
    // the caller-supplied manifest permissions must still match it exactly.
    const permissions = input.run.envelope?.permissions ?? input.permissions;
    if (!sameJson(permissions, input.permissions)) {
      return { status: 'rejected', code: 'forbidden', reason: 'the accepted Run permissions disagree with the prepared manifest permissions' };
    }
    const policyRevisionMatches = permissions.policyRevision === input.run.roleBinding.policyRevision;
    if (isReviewRoundPurpose(input.run.purpose)) {
      // R4/L13: a review-purpose Run is admitted by its fixed tool set and
      // empty write scope with Host layer 1 still holding; the Role's tool
      // ceiling is skipped (the Role was resolved with empty declared
      // permissions by the entry lane).
      const admissionProblem = reviewRoundAdmissionProblem({
        purpose: input.run.purpose,
        tools: permissions.tools,
        writeScope: permissions.writeScope,
        hostTools: current.tools,
        readonlyCommandAccess: current.readonlyCommandAccess ?? null,
        roleValid: true,
      });
      if (!policyRevisionMatches || admissionProblem !== null) {
        return { status: 'rejected', code: 'forbidden', reason: `the review round permissions are not admitted: ${admissionProblem ?? 'policy_revision_mismatch'}` };
      }
    } else {
      const ceiling = resolution.status === 'resolved' ? resolution.spec.permissions : null;
      if (!policyRevisionMatches
        || !permissions.tools.every(tool => current.tools.includes(tool) && (ceiling === null || ceiling.tools.includes(tool)))
        || !permissions.writeScope.every(path => current.writeScope.includes(path))
        || (ceiling?.writeScope === 'none' && permissions.writeScope.length !== 0)
        || (permissions.tools.includes('shell') && (current.shellWorkspaceAccess !== 'all_except_denied'
          || permissions.writeScope.length !== 1 || permissions.writeScope[0] !== '.'))) {
        return { status: 'rejected', code: 'forbidden', reason: 'the prepared permissions are not allowed by the current Host and Role ceilings' };
      }
    }
    let hostTemplate: typeof input.hostTemplate;
    if (resolution.status === 'resolved') {
      if (input.sessionRole.kind !== 'role_spec') {
        return { status: 'rejected', code: 'forbidden', reason: 'a resolved Role requires a role_spec Session role' };
      }
      hostTemplate = null;
    } else {
      if (input.sessionRole.kind !== 'legacy_template' || current.hostTemplate === null) {
        return { status: 'rejected', code: 'unsupported', reason: 'an absent Role requires an explicit versioned Host legacy template' };
      }
      if (input.sessionRole.templateId !== current.hostTemplate.templateId
        || input.sessionRole.templateRevision !== current.hostTemplate.revision) {
        return { status: 'rejected', code: 'forbidden', reason: 'the Session legacy template disagrees with the current Host template' };
      }
      hostTemplate = current.hostTemplate;
    }
    if (!sameJson(hostTemplate, input.hostTemplate)) {
      return { status: 'rejected', code: 'forbidden', reason: 'the current Host template disagrees with the prepared manifest template' };
    }
    return { status: 'ready', value: {
      configurationRevision: current.configurationRevision,
      permissions: structuredClone(permissions),
      hostTemplate: hostTemplate === null ? null : structuredClone(hostTemplate),
    } };
  };
}

/**
 * R5b.2 trusted Query Host projection. It reuses the SAME
 * `resolveQueryConfiguration` binding the Runtime Query branch uses, returns the
 * exact trusted configuration revision/tools/budget/template, and applies the
 * Query read-only ceiling (zero write scope). It never echoes a manifest
 * declaration and is never a constant `true`.
 */
function createAuthorizeQueryConfiguration(host: RuntimeHostBindings): AuthorizeQueryConfiguration {
  return async (ctx, input) => {
    if (host.resolveQueryConfiguration === undefined) {
      return { status: 'rejected', code: 'unsupported', reason: 'the trusted Query Host configuration binding is not configured' };
    }
    const executionState = input.run.run.executionState;
    if (executionState === undefined) {
      return { status: 'rejected', code: 'incomplete', reason: 'the QueryRun has no persisted execution state to authorize' };
    }
    const execution = input.job.job.intent.execution;
    const configured = await host.resolveQueryConfiguration(ctx, {
      queryRunRef: input.run.ref,
      sessionRef: executionState.sessionRef,
      role: input.sessionRole,
      roleResolution: input.roleResolution,
    });
    if (configured.status !== 'ready') return configured;
    // The Query ceiling is the intersection of the real Host grant, the stable
    // Role ceiling and the read-only Query ceiling. It never echoes a manifest
    // declaration and never widens the Host grant.
    return { status: 'ready', value: projectQueryConfiguration({
      host: configured.value, requested: execution.runtimeBudget, roleResolution: input.roleResolution,
    }) };
  };
}

/**
 * The Host's `secretaryOpenCap` adapter. It counts the workspace's LIVE
 * secretary Sessions — lifecycle `active` and the trusted duty resolver says
 * `secretary` — at admission time and refuses a fresh line at the cap. A replay
 * never reaches this port (`createLineCreation` looks the operation up first);
 * in-flight creations are not counted, because the directory cannot enumerate
 * creation operations. Any read failure is `unavailable`, never an admitted line.
 */
export function createSecretaryOpenCapCapacity(deps: {
  limit: number;
  sessions: Pick<SessionDirectoryPort, 'findSessions'>;
  duty: SessionDutyResolver;
}): LineCapacityPort {
  return {
    async admit(ctx, input) {
      // The option caps secretary lines only; a line of another duty is admitted.
      if (input.duty !== 'secretary') return { status: 'admitted' };
      if (!Number.isSafeInteger(deps.limit) || deps.limit < 1) {
        return { status: 'unavailable', reason: 'the secretary open cap is not a positive integer' };
      }
      const workspace = { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' };
      let used = 0;
      let cursor: string | null = null;
      do {
        const page = await deps.sessions.findSessions(ctx, {
          workspace, includeArchived: false, page: { limit: 200, ...(cursor === null ? {} : { cursor }) },
        });
        if (page.status !== 'ready') {
          return { status: 'unavailable', reason: page.status === 'rejected'
            ? `the secretary line count could not be read: ${page.reason}`
            : 'the secretary line count is not available' };
        }
        for (const card of page.value.items) {
          if (card.record.lifecycle !== 'active') continue;
          const duty = await deps.duty(card.record.role, ctx);
          if (duty.status === 'ready' && duty.value === 'secretary') used += 1;
        }
        cursor = page.value.nextCursor;
      } while (cursor !== null);
      return used >= deps.limit ? { status: 'full', limit: deps.limit, used } : { status: 'admitted' };
    },
  };
}

/** Trusted local composition root. Old Ledger/Index/Vault instances cannot be
 * supplied. No business bootstrap/claim API is invented by the storage factory. */
export async function createTargetPlatform(options: TargetPlatformOptions) {
  const now = options.now ?? (() => new Date().toISOString());
  // A cap is a positive integer or absent. A malformed value
  // fails the platform build instead of silently admitting every line.
  if (options.secretaryOpenCap !== undefined
    && (!Number.isSafeInteger(options.secretaryOpenCap) || options.secretaryOpenCap < 1)) {
    throw new Error('secretaryOpenCap must be a positive integer when present');
  }
  // Slice 1 (spec §2.8): the validated archive policy this Host runs with.
  const archivePolicy = sessionArchivePolicyOf(options.sessionArchivePolicy);
  const hostInstance: HostInstanceFacts | undefined = options.hostInstance === undefined ? undefined
    : { hostInstanceId: options.hostInstance.hostInstanceId, lease: options.hostInstance.lease,
      ...(options.hostInstance.takeover === undefined ? {} : { takeover: options.hostInstance.takeover }) };
  // C8 (A.2 step 5.6): the Host-installed automatic-rework policy; the defaults (3 / true) until the
  // Host installs its settings (`registerAutomationPolicy`). Read live by the requeue owner and the read model.
  let automationPolicy: TaskAutomationPolicyV1 = { ...DEFAULT_TASK_AUTOMATION_POLICY };
  const currentAutomationPolicy = (): TaskAutomationPolicyV1 => ({ ...automationPolicy });
  // L13: the ONE platform-root resource-cap source. A directly built platform
  // with no Host source uses the machine-memory default; the Host's holder is
  // passed through unchanged and read live by the Kernel on every command.
  const resourceCaps: ResourceCapSource = options.resourceCaps ?? (() => {
    const defaults = defaultResourceCapSettings(totalmem());
    const fixed = { memoryMaxBytes: defaults.memoryMaxMiB * MIB, tasksMax: defaults.tasksMax };
    return { current: () => fixed };
  })();
  const materialsSchema = materialRecordSchemas();
  const schemas = {
    records: [...materialsSchema.records, ...PLAN_RECORD_SCHEMAS.records, ...PLAN_STATE_RECORD_SCHEMAS.records,
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.records, ...SESSION_RECORD_SCHEMAS.records, ...SESSION_LIFECYCLE_RECORD_SCHEMAS.records,
      ...ROLE_RECORD_SCHEMAS.records, ...OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.records,
      ...ARCHITECTURE_CATALOG_SCHEMAS.records, ...TASK_CLAIM_RECORD_SCHEMAS.records,
      ...EXECUTION_ENTRY_RECORD_SCHEMAS.records, ...MODEL_REQUEST_RECORD_SCHEMAS.records,
      ...SESSION_MESSAGE_RECORD_SCHEMAS.records, ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.records,
      ...CONTROL_RECORD_SCHEMAS.records, ...EVIDENCE_RECORD_SCHEMAS.records, ...QUERY_JOB_RECORD_SCHEMAS.records,
      ...SESSION_ANOMALY_RECORD_SCHEMAS.records,
      ...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.records,
      ...COMMAND_RERUN_REQUEST_RECORD_SCHEMAS.records,
      ...COMPLETION_RECORD_SCHEMAS.records, ...DECISION_RECORD_SCHEMAS.records, ...LINE_SETTINGS_RECORD_SCHEMAS.records,
      ...NOTE_RECORD_SCHEMAS.records],
    events: [...materialsSchema.events, ...PLAN_RECORD_SCHEMAS.events, ...PLAN_STATE_RECORD_SCHEMAS.events,
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.events, ...SESSION_RECORD_SCHEMAS.events, ...SESSION_LIFECYCLE_RECORD_SCHEMAS.events,
      ...ROLE_RECORD_SCHEMAS.events, ...OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.events, ...ARCHITECTURE_CATALOG_SCHEMAS.events,
      ...TASK_CLAIM_RECORD_SCHEMAS.events, ...EXECUTION_HISTORY_RECORD_SCHEMAS.events,
      ...EXECUTION_ENTRY_RECORD_SCHEMAS.events, ...MODEL_REQUEST_RECORD_SCHEMAS.events,
      ...SESSION_MESSAGE_RECORD_SCHEMAS.events,
      ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events, ...CONTROL_RECORD_SCHEMAS.events, ...EVIDENCE_RECORD_SCHEMAS.events, ...QUERY_JOB_RECORD_SCHEMAS.events,
      ...SESSION_ANOMALY_RECORD_SCHEMAS.events,
      ...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.events,
      ...COMMAND_RERUN_REQUEST_RECORD_SCHEMAS.events,
      ...COMPLETION_RECORD_SCHEMAS.events, ...DECISION_RECORD_SCHEMAS.events, ...LINE_SETTINGS_RECORD_SCHEMAS.events,
      ...NOTE_RECORD_SCHEMAS.events],
    lookups: [...materialsSchema.lookups ?? [], ...PLAN_RECORD_SCHEMAS.lookups ?? [], ...PLAN_STATE_RECORD_SCHEMAS.lookups ?? [],
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.lookups ?? [], ...SESSION_RECORD_SCHEMAS.lookups ?? [],
      ...SESSION_LIFECYCLE_RECORD_SCHEMAS.lookups ?? [], ...ROLE_RECORD_SCHEMAS.lookups ?? [],
      ...OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.lookups ?? [], ...ARCHITECTURE_CATALOG_SCHEMAS.lookups ?? [],
      ...TASK_CLAIM_RECORD_SCHEMAS.lookups ?? [], ...EXECUTION_ENTRY_RECORD_SCHEMAS.lookups ?? [],
      ...MODEL_REQUEST_RECORD_SCHEMAS.lookups ?? [], ...SESSION_MESSAGE_RECORD_SCHEMAS.lookups ?? [],
      ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.lookups ?? [], ...CONTROL_RECORD_SCHEMAS.lookups ?? [], ...EVIDENCE_RECORD_SCHEMAS.lookups ?? [], ...QUERY_JOB_RECORD_SCHEMAS.lookups ?? [],
      ...SESSION_ANOMALY_RECORD_SCHEMAS.lookups ?? [],
      ...UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS.lookups ?? [],
      ...COMMAND_RERUN_REQUEST_RECORD_SCHEMAS.lookups ?? [],
      ...COMPLETION_RECORD_SCHEMAS.lookups ?? [], ...DECISION_RECORD_SCHEMAS.lookups ?? [],
      ...LINE_SETTINGS_RECORD_SCHEMAS.lookups ?? [], ...NOTE_RECORD_SCHEMAS.lookups ?? []],
  };
  // Slice 1 (spec §2.8): every one of the six new indexes must be part of the
  // real record-store schema set this Host opens. The declared
  // `SLICE1_LOOKUP_INDEXES` table and the codec-owned bundles stay in sync.
  const registeredLookupNames = new Set(schemas.lookups.map((lookup) => lookup.name));
  for (const index of SLICE1_LOOKUP_INDEXES) {
    if (!registeredLookupNames.has(index.name)) {
      throw new Error(`the Slice 1 lookup index ${index.name} is not registered in the record-store schema set`);
    }
  }
  if (options.storage.kind === 'sqlite') mkdirSync(options.storage.directory, { recursive: true });
  const rawBackend = options.storage.kind === 'memory'
    ? createInMemoryRecordBackend({ schemas })
    : createSqliteRecordBackend({ schemas, path: join(options.storage.directory, 'ledger.sqlite') });
  let closeBodies: (() => Promise<void>) | undefined;
  try {
    // Task E: the optional Host observer sees every commit of the ONE records
    // object below; without it this is the original backend unchanged.
    const backend = await observeRecordCommits(rawBackend, options.commitObserver);
    const bodies = options.storage.kind === 'memory' ? new RawArtifactBodyStore()
      : createSqliteRawArtifactStore(join(options.storage.directory, 'artifacts.sqlite'));
    if ('close' in bodies) closeBodies = () => bodies.close();
    // The one Workspace access factory, shared by the workspace tools and the
    // observed architecture below. The material source provider is kept but not
    // constructed (decision 34): slice 3 of the orchestration design may need it.
    const access = createWorkspaceAccessFactory(options.workspace);
    const reads = createMaterialRecordReaders(backend.records);
    // C2 §3.1: build the unique execution reader and the optional trusted Host
    // authorization BEFORE the single Plan service, so the W2 delegated writes
    // and the C1 mailbox admission share exactly this instance and this callback.
    // The control service reads a not-entered stop and a yielded-wait Lease
    // through the same reader (§6 RUN-09, RD-8).
    const executionReader = createRunStateReader({ records: backend.records, bodies });
    // R4.1: the raw control service shares the ONE records/authority pair; the
    // public port is wrapped below so close drains an in-flight control call.
    const rawControls = createRunControlService({ records: backend.records, authority: reads.authority,
      reads: executionReader, now, eventId: randomUUID });
    const rawMaterials = createMaterialService({ bodies, authority: reads.authority, now });
    const rawGoals = createGoalService({ records: backend.records, now, eventId: randomUUID }).tasks;
    const workspace = createWorkspaceTools({ access,
      now, limits: DEFAULT_WORKSPACE_LIMITS,
      ...(options.fileGraph === undefined ? {} : { fileGraph: options.fileGraph }),
      ...(options.lightScan === undefined ? {} : { lightScan: options.lightScan }),
      ...(options.sourceAnalyzers === undefined ? {} : { sourceAnalyzers: options.sourceAnalyzers }),
      deniedPrefixes: WORKSPACE_DENIED_PREFIXES });
    const roleService = createRoleConfigurationService({ records: backend.records, now, eventId: randomUUID });
    const bootstrap = createProjectBootstrapServices({ records: backend.records, now, eventId: randomUUID });
    // Slice 5 §3.2: the configured operator is the Host's real start actor. The
    // production Host injects `operatorActor` from its trusted start snapshot,
    // never from HTTP JSON or a model tool argument. The checks-executor
    // fallback remains for independent compositions (the frozen scenario
    // harness builds one with only `checks`, so removing it would make the
    // frozen SC01/SC02 answer `unsupported`); see UNSPECIFIED.
    const operatorActor = options.operatorActor ?? options.checks?.executor;
    const authorizeConfiguration = options.runtime === undefined
      ? undefined : createAuthorizeConfiguration(options.runtime);
    // Slice 1 (spec §0.2 L1, §3.3): the ONE `SessionFactsPort` instance. It is
    // injected into the Session directory, the lifecycle service, the anomaly
    // owner and the Workflow, and `sessions`/`queries` never import `tasks`.
    const sessionFacts = createSessionFactsService({ records: backend.records });
    const responsibilityBasis = createSessionResponsibilityBasisReader(backend.records);
    const sessionResponsibility = createSessionResponsibilityService({
      records: backend.records, lookups: backend.records,
      // The trusted Task basis stays in `tasks` and arrives through the narrow port.
      basis: responsibilityBasis, now,
    });
    const sessionAnomalies = createSessionAnomalyService({
      records: backend.records, lookups: backend.records, sessionFacts, now,
    });
    // K3 (§2 L7, L14/L15/L16): the UnknownCallReview owner. The read-only half
    // is group 2; group 3 adds the review-round write, settlement (which reads
    // the round's Run and, for D6, the writing round's prepared manifest) and
    // the two list indexes.
    let boundDecisionMessagesForReview: DecisionMessagePort | null = null;
    const unknownCallReviews = createUnknownCallReviewService({
      records: backend.records, lookups: backend.records, reads: executionReader,
      readReviewDisplays: async (ctx, input) => {
        const read = await executionReader.readExecution(ctx, input.roundRunRef);
        if (read.status === 'not_found') return { status: 'not_found' };
        if (read.status === 'not_ready') return { status: 'not_ready', observed: read.observed, required: read.required };
        if (read.status === 'rejected') return read;
        const envelope = read.value.run.envelope;
        if (envelope === null) return { status: 'not_found' };
        const manifest = await readManifestFromEnvelope({ bodies },
          envelope as unknown as Record<string, unknown>, input.roundRunRef);
        if (!manifest.ok) return manifest.rejection;
        const items = manifest.value.manifest.unknownCallReview?.items ?? [];
        return { status: 'ready', value: new Map(items.map(item => [item.alias, item.display])) };
      },
      // K3 D3/L21 (ruling 2): the hold guard pins the SAME canonical Task
      // projection the claim service guards with: `readGoalPlanWindow` then
      // `readCanonicalTaskFacts`, never a second reader.
      taskProjection: async (_ctx, task) => {
        const goalRef = { aggregateType: 'Goal' as const, projectId: task.projectId, goalId: task.goalId };
        const window = await readGoalPlanWindow(backend.records, goalRef);
        if (window.status !== 'ready') return window;
        if (window.plan === null) {
          return { status: 'rejected', code: 'not_found', reason: 'the Goal has no active Plan' };
        }
        return readCanonicalTaskFacts(backend.records, goalRef, window.plan, task.taskId);
      },
      // K3 L19: the disposition's 附言 is the saved answer body text; the SAME
      // decision-message owner reads it (no second body reader).
      readAnswerText: async (ctx, { source }) => {
        if (boundDecisionMessagesForReview === null) {
          return { status: 'rejected', code: 'unavailable', reason: 'the decision messages are not bound yet' };
        }
        const read = await boundDecisionMessagesForReview.readDecisionAnswer(ctx, { source });
        if (read.status !== 'ready') return read;
        return { status: 'ready', value: read.value.body === null ? null : read.value.body.text };
      },
      // K3 L19a: the disposition's blocked commands read the original Turn's
      // command/cwd through the SAME K L9 window the continuation brief uses,
      // and `package.json` script expansion through the ONE workspace read port.
      readKernelCommandFacts: (ctx, input) => readKernelCommandFacts({ kernelStores, kernel }, ctx, input),
      readWorkspace: { readWorkspace: workspace.tools.readWorkspace },
      now, eventId: randomUUID,
    });
    // K3 L19a (spec §3.2b): the CommandRerunRequest owner. The ONE recognizer is
    // shared by the owner, the card source and the Runtime's shell hook/request
    // tool; `listTaskReviews` pages the UCR owner's own task filter to the end.
    const commandRecognizer = createCommandRecognizer({
      readWorkspace: { readWorkspace: workspace.tools.readWorkspace } });
    const commandRerunRequests = createCommandRerunRequestService({
      records: backend.records, lookups: backend.records,
      listTaskReviews: async (ctx, { goalRef, taskId }) => {
        if (ctx.workspaceId === undefined) {
          return { status: 'rejected', code: 'unavailable', reason: 'the bound workspace is not available' };
        }
        return readTaskReviews(ctx, unknownCallReviews,
          { goalRef, taskId, workspace: { projectId: goalRef.projectId, workspaceId: ctx.workspaceId } });
      },
      // Rework 1 item 4: `closed` is derived ONCE from the SAME canonical Task
      // facts every other reader uses (satisfied, cancelled, superseded).
      readTaskClosure: async (_ctx, task) => readTaskClosure(backend.records,
        { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId }, task.taskId),
      recognize: commandRecognizer,
      now, eventId: randomUUID,
    });
    const sessionDirectory = createSessionDirectory({ records: backend.records, lookups: backend.records });
    // Wiring 2 I-2 (§2.1, L1/L3): the formal duties adapter reads the Session's
    // own fixed role. The legacy half is the exact five platform templates and
    // their versions, injected here so `configuration/` never imports Runtime.
    const platformDuties: readonly PlatformDutyV1[] = ['executor', 'secretary', 'adviser', 'scribe', 'reviewer'];
    const legacyDuty = (role: Extract<RoleConfigurationRef, { kind: 'legacy_template' }>): PlatformDutyV1 | undefined =>
      platformDuties.find(duty => {
        const template = platformRoleProfile(duty).template;
        return role.templateId === template.templateId && role.templateRevision === template.templateRevision;
      });
    const messageDuties = createMessageDutiesFactsAdapter({ roles: roleService, sessions: sessionDirectory, legacyDuty });
    // The public mailbox is real even without a model Host binding; internal
    // calls use the raw service so an in-flight operation is never rejected by
    // the public tracked wrapper after close has already begun. It is built
    // BEFORE the Query jobs so a consultation submit can use its read-only
    // message seam; no second mailbox/service instance exists. The same
    // dependency bag builds the slice-5 `MessageWriteOwnerPort` so the message
    // body/persist helpers have exactly one owner.
    const mailboxDependencies = { records: backend.records, sessions: sessionDirectory,
      executions: executionReader, roles: roleService, materials: rawMaterials,
      systemActor: SYSTEM_ACTOR, now, newId: randomUUID, duties: messageDuties,
      ...(authorizeConfiguration === undefined ? {} : { runtimeAdmission: { bodies, authorizeConfiguration } }) };
    const mailbox = createSessionMailbox(mailboxDependencies);
    const messageWrites = createMessageWriteOwner(mailboxDependencies);
    // R5b.2: the ONE internal Query writer shares this records/roles/bodies
    // instance. It is injected into the QueryJob claim/read adapter and the
    // Runtime thin path, never published as a public terminal port. Without a
    // trusted Runtime Host binding there is no Query Host projection, so the new
    // Query methods stay unsupported while pending submit/read is unchanged.
    const queryExecution = options.runtime === undefined ? undefined : createQueryExecution({
      records: backend.records, roles: roleService, bodies,
      authorizeConfiguration: createAuthorizeQueryConfiguration(options.runtime),
      now, eventId: randomUUID, sessionFacts,
      ...(hostInstance === undefined ? {} : { hostInstance }),
    });
    const queryJobs = createQueryJobService({
      records: backend.records, now, eventId: randomUUID,
      ...(queryExecution === undefined ? {} : { execution: queryExecution }),
      consultations: { readMessage: mailbox.readMessage.bind(mailbox), readMessageBody: mailbox.readMessageBody.bind(mailbox) },
    });
    const catalog = createArchitectureCatalogService({ records: backend.records });
    // L8 (book ruling 6): the SAME catalog instance resolves an omitted capture
    // `mappings`, so the automatic/manual capture and the reminder read share
    // one active-catalog decision.
    const observed = createObservedArchitecture({ records: backend.records, bodies, access, workspace: workspace.tools,
      catalog,
      source: options.architectureSource ?? { provider: 'typescript', configPath: 'tsconfig.json' },
      ...(options.fileGraph?.chunkBytes === undefined ? {} : { fileGraph: { chunkBytes: options.fileGraph.chunkBytes } }) });
    // L8 (interface §7): the ONE writer of reminder facts. The assembler gets this
    // reader through the Runtime dependencies; it shares `catalog` and `observed`.
    const architectureReminders = createArchitectureReminderFactsReader({ catalog, observed });
    // R6 cold-start: the live per-workspace trusted checks configuration the
    // Host registers after an explicit user approval. It is read by a FRESH
    // round only; an already-open round keeps the configuration it froze. The
    // legacy static `options.checks` remains a compatible same-scope fallback.
    // A.2 step 5.9 (LA-4): the read model judges a configuration-dependent
    // reverify refusal stale against the same current revision.
    const registeredCheckConfigurations = new Map<string, TrustedCheckConfiguration>();
    const checkScopeKey = (scope: { projectId: string; workspaceId: string }): string =>
      `${scope.projectId}\u0000${scope.workspaceId}`;
    const currentCheckConfiguration = (scope: { projectId: string; workspaceId: string }): TrustedCheckConfiguration | undefined =>
      registeredCheckConfigurations.get(checkScopeKey(scope))
        ?? (options.checks !== undefined
          && options.checks.workspace.projectId === scope.projectId
          && options.checks.workspace.workspaceId === scope.workspaceId
          ? options.checks : undefined);
    const planDependencies: PlanServiceDependencies = { records: backend.records, materials: rawMaterials, now, eventId: randomUUID,
      automationPolicy: currentAutomationPolicy, configurationFor: currentCheckConfiguration,
      // Slice 5 §3.2: the SAME resolved operator the settings/message owners use,
      // so plan adoption/abandon compare the exact configured Host actor.
      ...(operatorActor === undefined ? {} : { operatorActor }),
      // R5b.4: the SAME raw body store already owned by the composition root.
      initialPlanning: { bodies },
      ...(authorizeConfiguration === undefined ? {} : {
        delegatedWrites: { reads: executionReader, roles: roleService, bodies, authorizeConfiguration },
      }) };
    const planService = createPlanService(planDependencies);
    // Slice 5 §3.3: the request-candidate owner shares the SAME Plan dependency
    // bag, so no second plan service/store is created.
    const requestCandidates = createRequestCandidateService(planDependencies);
    // Slice 5 §3.3/§4: the ONE settings/decision-message/read owner set. Each
    // uses the SAME records/materials/mailbox instances as every other owner;
    // the message body/persist facade is the mailbox's single write owner.
    // Slice 4C-2 U6: the note-card decision port is built only after the note
    // service (whose `applyNoteDecision` it delegates to), but the early message
    // sources must already carry the SAME port. This holder forwards to the
    // later-bound implementation, so the message service needs no second
    // source-facts owner and the file order is unchanged.
    let boundNoteDecisionSource: NoteDecisionSourcePort | null = null;
    const noteDecisionSourcePort: Pick<NoteDecisionSourcePort, 'readNoteDecisions' | 'readNoteDecision'> = {
      readNoteDecisions: (ctx, input) => boundNoteDecisionSource === null
        ? Promise.resolve({ status: 'rejected' as const, code: 'unavailable' as const,
          reason: 'the note-decision source is not bound yet' })
        : boundNoteDecisionSource.readNoteDecisions(ctx, input),
      readNoteDecision: (ctx, input) => boundNoteDecisionSource === null
        ? Promise.resolve({ status: 'rejected' as const, code: 'unavailable' as const,
          reason: 'the note-decision source is not bound yet' })
        : boundNoteDecisionSource.readNoteDecision(ctx, input),
    };
    const decisionSources = createDecisionSourceFacts({ records: backend.records, plans: planService,
      noteDecisions: noteDecisionSourcePort, unknownCallReviews, workspace: { readWorkspace: workspace.tools.readWorkspace },
      // K3 L19a: the SAME CRR owner, original-Run execution read and Kernel
      // command reader (the K L9 window) the card source uses.
      commandRerunRequests, commandRerunExecutions: executionReader,
      readKernelCommandFacts: (ctx, input) => readKernelCommandFacts({ kernelStores, kernel }, ctx, input) });
    // §4.5: the formal identity/fingerprint of a settings commit are persisted
    // verbatim in its event body, so the finite coordinator can hand the real
    // `DecisionApplicationReceiptV1` to `recordDecisionApplication` from the
    // commit cursor alone (no owner-private identity algorithm is duplicated).
    const applicationReceipt = async (_ctx: CoreCallContext, cursor: CommitCursor):
      Promise<DecisionApplicationReceiptV1 | null> => {
      let located: Awaited<ReturnType<typeof backend.records.eventAt>>;
      try { located = await backend.records.eventAt(cursor); } catch { return null; }
      if (located.status !== 'ready') return null;
      try {
        const parsed = JSON.parse(located.value.event.json) as { identityKey?: unknown; fingerprint?: unknown };
        if (typeof parsed.identityKey !== 'string' || parsed.identityKey.length === 0
          || typeof parsed.fingerprint !== 'string' || parsed.fingerprint.length === 0) return null;
        return { identityKey: parsed.identityKey, fingerprint: parsed.fingerprint, cursor };
      } catch { return null; }
    };
    const rawGoalSettings = createGoalSettingsService({ records: backend.records, now, newId: randomUUID,
      ...(operatorActor === undefined ? {} : { operatorActor }) });
    const rawDecisionMessages: DecisionMessagePort = {
      ...createDecisionMessageService({ records: backend.records, now, newId: randomUUID,
        ...(operatorActor === undefined ? {} : { operatorActor }),
        messages: mailbox, materials: rawMaterials, messageWrites, sources: decisionSources }),
      sendUserMessage: mailbox.sendUserMessage.bind(mailbox),
    };
    boundDecisionMessagesForReview = rawDecisionMessages;
    // §2.8/§4.1: the single in-process display-token key and the one notice
    // position comparator. The key is never persisted and never enters `state`.
    const noticeDisplayKey = randomBytes(32);
    const displayTokens = createNoticeDisplayToken(noticeDisplayKey);
    const noticePositions = createNoticePositionComparator();
    const rawWorkspaceDecisionSettings = createDecisionSettingsService({ records: backend.records, now, newId: randomUUID,
      displayTokens, positions: noticePositions, ...(operatorActor === undefined ? {} : { operatorActor }) });
    // Slice 2B L13: the production composition uses the REAL executed-files
    // reader, the same `backend.records` the rest of the platform owns.
    const goalExecutedFiles = createGoalExecutedFilesReader({ records: backend.records });
    const goalConflicts = createGoalConflictAssembler({ records: backend.records, catalog, executedFiles: goalExecutedFiles });
    // §4.2: the card sources available in this slice. Both readers are built
    // once from the SAME records/Plan-service dependency bag the Plan owner
    // uses, and the two card-source adapters wrap them into the read model's
    // `DecisionCardSourcePort` seam. The remaining card kinds have no adapter
    // factory yet and are reported `not_available` by the read model; the
    // automatic-rework projector is the one notice source built here.
    const goalDecisionCauseReader = createGoalDecisionCauseReader({ records: backend.records, plans: planService });
    const planningQuestionReader = createPlanningQuestionReader({ records: backend.records, plans: planService });
    const goalCauseCards = createGoalCauseCardSource(goalDecisionCauseReader);
    const planningQuestionCards = createPlanningQuestionCardSource(planningQuestionReader);
    const automaticReworkNotices = createAutomaticReworkNoticeSource({ records: backend.records });
    // Wiring 2 I-5 (§2.3, L7): the ONE undelivered-reply projector. It reads the
    // SAME directory and mailbox the rest of the platform owns and never commits.
    const undeliveredReplyNotices = createUndeliveredReplyNoticeSource({
      records: backend.records, sessions: sessionDirectory, messages: mailbox });
    // Slice 4C-2 U7/U9: the note_review card and notice sources. Both are built
    // over the SAME records/note-decision holder the rest of the platform owns.
    const noteReviewCards = createNoteReviewCardSource({ records: backend.records,
      noteDecisions: noteDecisionSourcePort });
    // K3 L18: the review-card source over the SAME records/owner the rest of
    // the platform owns. It is a derived card source; no card table is created.
    const unknownCallReviewCards = createUnknownCallReviewCardSource({
      records: backend.records, reviews: unknownCallReviews, workspace: { readWorkspace: workspace.tools.readWorkspace } });
    // K3 L19a: the `command_rerun_request` card source over the SAME CRR owner,
    // review owner, execution reader and Kernel command reader. Derived; no card
    // table is created.
    const commandRerunRequestCards = createCommandRerunRequestCardSource({
      records: backend.records, requests: commandRerunRequests, reviews: unknownCallReviews,
      executions: executionReader,
      readKernelCommandFacts: (ctx, input) => readKernelCommandFacts({ kernelStores, kernel }, ctx, input) });
    const noteReviewNotices = createNoteReviewNoticeSource({ records: backend.records });
    const rawDecisionReads = createDecisionReadModel({
      records: backend.records,
      cardSources: [goalCauseCards, planningQuestionCards, noteReviewCards, unknownCallReviewCards,
        commandRerunRequestCards],
      noticeSources: [automaticReworkNotices, undeliveredReplyNotices, noteReviewNotices],
      conflicts: goalConflicts,
      positions: noticePositions,
      displayTokens,
    });
    const claimService = createTaskClaimService({ records: backend.records, roles: roleService,
      bodies, now, newId: randomUUID });
    // The ONE verification workspace reader: the evidence owner captures rounds
    // with it and the requeue owner takes its digest-only source (LA-5).
    const verificationWorkspaceReader = new VerificationWorkspaceReader();
    // K3 L6: the same reader plus the read-only byte reads the continuation
    // note's file diffs need (baseline blob by id, current file by path).
    const continuationWorkspaceSource: ContinuationWorkspaceSource = {
      captureDigest: (root) => verificationWorkspaceReader.captureDigest(root),
      capture: (root) => verificationWorkspaceReader.capture(root),
      readBaselineBlob: (root, blobId) => workspace.readContinuationBaselineBlob(root, blobId),
      readCurrentFile: (root, path) => workspace.readContinuationCurrentFile(root, path),
    };
    // A.2 step 5.4 (D-3, C1): the requeue owner shares the records, the WG11
    // reader, the material service, the mailbox (a new input message is read
    // under its reader rules, ND-9) and the delegated-write admission.
    const requeueService = createTaskRequeueService({ records: backend.records, reads: executionReader,
      workspaceHost: options.workspace, source: verificationWorkspaceReader, materials: rawMaterials,
      messages: { readMessage: mailbox.readMessage.bind(mailbox) },
      // Slice 5 §3.2/§4.4: the SAME Goal-settings owner the platform publishes,
      // so an automatic requeue consults the current effective autonomy.
      goalSettings: rawGoalSettings,
      ...(authorizeConfiguration === undefined ? {} : {
        delegatedWrites: { reads: executionReader, roles: roleService, bodies, authorizeConfiguration },
      }),
      automationPolicy: currentAutomationPolicy,
      now, eventId: randomUUID });
    const sessionLifecycle = createSessionLifecycleService({ records: backend.records, lookups: backend.records,
      sessionFacts });
    const kernelStores = await createKernelStoreRegistry(options.kernelStores ?? { entries: [] });
    // Internal calls retain the raw directory. The outer Runtime operation is
    // drained once as a whole, so close cannot reject its later registration.
    const sessionOperations = createSessionOperations({ sessions: sessionDirectory, kernelStores });
    const executionHistory = createExecutionHistoryReader({ history: sessionOperations });
    const historyWriter = createExecutionHistoryService({ records: backend.records, now, eventId: randomUUID });
    const graphHistory = createGraphExecutionHistoryReader({ executions: executionReader, history: executionHistory });
    const sourceAuthority = createSourceAuthorityReader({ authority: reads.authority, records: backend.records });
    // R3e.1: the ONE trusted verification/evidence service and its thin Host
    // check runner share the existing records/material/execution instances. The
    // frozen checks configuration is optional; without it fresh open/begin stay
    // unsupported while existing history reads/receipts keep their behavior.
    // A.2 step 5.9 (VR-14): the successor-round owner reads the same automation
    // policy as the requeue owner (VD-13 cap), a new input message through the
    // mailbox (ND-9), and admits an Agent through the same delegated-write
    // admission (no production Role grants `reverify_round` yet, GAP-46).
    // Slice 5 §3.2/S5-AU-03: the SAME autonomy table the Workflow and requeue
    // owner use, over the effective Goal settings (the record-codecs default
    // reader the Goal-settings owner also applies), so an automatic reverify
    // under `every_step` returns `needs_decision` and writes nothing.
    const automaticReverifyPolicy: AutomaticReverifyPolicyV1 = ({ goal, actorClass, countedNext, cap }) => {
      const verdict = decisionActionPolicy({ autonomy: readEffectiveGoalSettings(goal).autonomy,
        action: 'auto_reverify', actorClass, countedNext, cap });
      return verdict === 'needs_decision' ? 'needs_decision' : 'automatic_notice';
    };
    /** L8: the ONE trigger notification. A Host callback that throws cannot change
     * the operation's result (it is already committed and returned below). */
    const fireArchitectureCaptureTrigger = (
      kind: 'catalog_adopted' | 'catalog_revised' | 'check_passed', projectId: string,
    ): void => {
      try { options.onArchitectureCaptureTrigger?.({ kind, projectId }); } catch { /* the caller's result is unchanged */ }
    };
    const evidenceOwner = createEvidenceService({
      records: backend.records, materials: rawMaterials, executions: executionReader,
      workspaceHost: options.workspace, source: verificationWorkspaceReader,
      ...(options.checks === undefined ? {} : { configuration: options.checks }),
      configurationFor: currentCheckConfiguration,
      ...(hostInstance === undefined ? {} : { hostInstance }),
      automationPolicy: currentAutomationPolicy,
      automaticReverifyPolicy,
      messages: { readMessage: mailbox.readMessage.bind(mailbox) },
      ...(authorizeConfiguration === undefined ? {} : {
        delegatedWrites: { reads: executionReader, roles: roleService, bodies, authorizeConfiguration },
      }),
      now, newId: randomUUID,
    });
    // L8 (book ruling 1): wrap the ONE Evidence instance's `finalizeChecks` where it
    // is built, so the public evidence port and the Workflow's rawEvidence both use
    // the same wrapped method and a PASS is notified exactly once.
    const rawEvidence: typeof evidenceOwner = {
      ...evidenceOwner,
      finalizeChecks: async (ctx, request) => {
        // Fix the notification scope BEFORE the await: a later ctx mutation must
        // not retarget the trigger.
        const projectId = ctx.projectId;
        const result = await evidenceOwner.finalizeChecks(ctx, request);
        if (result.status === 'committed' && !result.replayed && result.value.outcome === 'PASS') {
          fireArchitectureCaptureTrigger('check_passed', projectId);
        }
        return result;
      },
    };
    const rawCheckRunner = createRegisteredCheckRunner({ evidence: rawEvidence,
      workspaceHost: options.workspace, kernel, resourceCaps, now });
    // A.2 step 5.6 (S8, A8): the reconcile owners share the ONE records/reader pair; the Runtime
    // classifier reads the Kernel through the same history owner the observer uses.
    const runReconcile: RunReconcileService = createRunReconcileService({ records: backend.records, reads: executionReader,
      ...(hostInstance === undefined ? {} : { hostInstance }), now, eventId: randomUUID });
    // Slice 2B §2/P1: the WorkGraph RunActivity write and backfill candidate
    // reader. The end commits write the record through their own `records`
    // dependency; this owner is what the Workflow backfill and the activity
    // reads share (a single writer/reader pair, §0.4).
    const runActivity = createRunActivityService({ records: backend.records, now, eventId: randomUUID });
    // Slice 2B §2/L9–L12/L15: the ONE activity owner (calendar + per-Run views +
    // track bars) and the task-state timeline owner. Both read the SAME store the
    // end commits and the backfill write through, and reach the route layer as
    // the non-enumerable `activity`/`timeline` groups.
    const activityReads: ActivityReadPort = createActivityReadModel({ records: backend.records, now });
    const activity: ActivityReadPort & Pick<TrackReadPort, 'readTrackBars'> = {
      ...activityReads,
      ...createTrackReadModel({ records: backend.records, now }),
    };
    const timeline: TaskTimelineReadPort = createTaskStateTimeline({ records: backend.records });
    const sessionHealth = createSessionHealthService({ records: backend.records,
      ...(hostInstance === undefined ? {} : { hostInstance }), now, eventId: randomUUID });
    const reconcileCandidates = createReconcileCandidateReader({ records: backend.records });
    const historyOwner = createSessionHistoryCursorOwner({ kernelStores });
    // Slice 3: the two read-only owners. They are constructed once and the SAME
    // instances reach the Runtime, the graph routes and (through the Runtime's
    // assembler) the attention scanner.
    const taskInputsOwner = createTaskContextInputService({
      records: backend.records,
      materials: rawMaterials,
      bodies,
      hostActor: SYSTEM_ACTOR,
    });
    // Slice 4C-2 U8: the memory-material seam is filled after the note read
    // model is built below; the extensions reader keeps this ONE deps object and
    // reads `memoryMaterial` live, so there is still exactly one assembly owner.
    const contextExtensionsDeps: ContextExtensionsDependencies = { anomalies: sessionAnomalies,
      hostActor: SYSTEM_ACTOR, goalSettings: rawGoalSettings, decisions: rawDecisionReads };
    const graphContextOwner = createGraphContextReader({
      records: backend.records,
      goals: planService,
      plans: planService,
      architecture: catalog,
      sessions: sessionDirectory,
      executions: executionReader,
      inputs: taskInputsOwner,
      hostActor: SYSTEM_ACTOR,
      // Wiring 1 I-3 (§2.5, L7): the anomaly projection is installed ONLY here,
      // on the graph-context reader. The provider rebinds the caller's ctx to
      // this same project/workspace as the Host actor; it is never exported to a
      // model, an HTTP route or another module.
      extensions: createContextExtensionsReader(contextExtensionsDeps),
    });
    // A Session operation spans both stores. Drain the complete operation before
    // closing the platform Store, not merely its short Kernel callback.
    let isClosing = false;
    const pending = new Set<Promise<unknown>>();
    function trackedCall<T>(call: () => Promise<T>, whenClosed: () => T): Promise<T> {
      if (isClosing) return Promise.resolve(whenClosed());
      // Start synchronously so each port snapshots inputs before its first await.
      const result = call();
      pending.add(result);
      void result.then(() => pending.delete(result), () => pending.delete(result));
      return result;
    }
    /** L8 (book ruling 2; interface §10): Host detached work joins the SAME drain
     * set. Unlike `trackedCall` it NEVER refuses after close began: the Host starts
     * the driver before close and the driver aborts its running capture first. */
    function trackDetached<T>(work: Promise<T>): Promise<T> {
      pending.add(work);
      void work.then(() => pending.delete(work), () => pending.delete(work));
      return work;
    }
    const unavailable = (): CoreRejection => ({ status: 'rejected', code: 'unavailable', reason: 'platform is closing' });
    // Slice 3 C6: the SAME two read-only owners reach the Runtime, the graph
    // routes and the attention scanner, each with every read drained through the
    // one trackedCall/close path. The raw owners are never handed out.
    const graphContext: GraphContextReadPort = {
      readContextFacts: (...args) => trackedCall(() => graphContextOwner.readContextFacts(...args), unavailable),
      lookGraph: (...args) => trackedCall(() => graphContextOwner.lookGraph(...args), unavailable),
      findGraph: (...args) => trackedCall(() => graphContextOwner.findGraph(...args), unavailable),
      readAttentionFacts: (...args) => trackedCall(() => graphContextOwner.readAttentionFacts(...args), unavailable),
    };
    const taskInputs: TaskContextInputPort = {
      readTaskInputs: (...args) => trackedCall(() => taskInputsOwner.readTaskInputs(...args), unavailable),
      readTaskInputPage: (...args) => trackedCall(() => taskInputsOwner.readTaskInputPage(...args), unavailable),
    };
    let resultWriter: Pick<ExecutionEntryPort, 'recordRunResult'> | undefined;
    // Slice 4C: the notes are built AFTER the runtime dependencies object, so
    // the Runtime receives this stable holder and the note tools read its
    // fields at Run start time. No notes block is moved.
    const noteToolDeps: NonNullable<RuntimeExecutionDependencies['notes']> = {};
    let runtime = createAgentRuntime();
    if (options.runtime !== undefined) {
      const host = options.runtime;
      // The hoisted optional instance is guaranteed present by `options.runtime`.
      const entryAuthorizeConfiguration = authorizeConfiguration as AuthorizeConfiguration;
      const entryDependencies: ExecutionEntryDependencies = {
        records: backend.records, reads: executionReader, roles: roleService,
        bodies, authorizeConfiguration: entryAuthorizeConfiguration,
        ...(hostInstance === undefined ? {} : { hostInstance }),
        now, eventId: randomUUID, newId: randomUUID,
      };
      const entry = createExecutionEntryService(entryDependencies);
      resultWriter = entry;
      const modelRequests = createModelCallService(entryDependencies);
      const dependencies: RuntimeExecutionDependencies & {
        readTaskClosure: (ctx: CoreCallContext, task: { projectId: string; goalId: string; taskId: string }) => Promise<import('../contracts/core/results.js').ReadResult<TaskClosureV1>>;
      } = {
        claims: claimService, executions: executionReader, entry, historyWriter, modelRequests,
        // Ruling 30: the Work permit read over the SAME record backend. The pack
        // source is the Host's disk-backed one when a settings directory is
        // configured, the generated platform pack otherwise.
        modelRequestReads: createModelRequestReadPort(entryDependencies),
        promptPacks: options.promptPacks ?? createPlatformPromptPackSource(),
        roles: roleService, plans: planService, messages: mailbox, sessions: sessionDirectory,
        // Slice 5 §4.6: the SAME user-decision owner the platform publishes, so
        // the three user tools call the real owners and never fail closed.
        decisionMessages: rawDecisionMessages,
        // Slice 5 §4.5/T-R2-1: the SAME receipt reader the Workflow receives, so
        // an acknowledged Agent plan adoption returns the formal receipt the
        // Agent needs for `record_decision_application`.
        applicationReceipt,
        materials: rawMaterials, bodies, activity: executionHistory, graphHistory, sessionOperations,
        // R4.3a: the SAME raw control service `platform.controls` wraps. The
        // Runtime gets the internal observation writer intersection while the
        // public surface still publishes only submit/read.
        controls: rawControls,
        kernelStores, workspaceHost: options.workspace, sourceAuthority: () => sourceAuthority,
        ...(options.sourcePolicyFor === undefined ? {} : { sourcePolicyFor: options.sourcePolicyFor }),
        ...(options.sourceAnalyzers === undefined ? {} : { sourceAnalyzers: options.sourceAnalyzers }),
        ...(queryExecution === undefined ? {} : { queryExecution }),
        // C3: the continuation brief's checkpoint uses the SAME workspace reader as the evidence owner.
        workspaceSource: continuationWorkspaceSource,
        // A.2 step 5.6: the in-process ends without a Kernel terminal (RUN-16, RUN-23).
        runReconcile,
        // K slice M1/M3/L5: the dangling-Turn closure's health owner and this
        // Host instance's lease. The Runtime calls the same SES-13 owner as
        // start-up step 1, under the Host call identity, and never writes health itself.
        turnClosure: { recordSessionHealth: (...args) => sessionHealth.recordSessionHealth(...args),
          lease: hostInstance === undefined ? null : hostInstance.lease },
        graphContext, taskInputs,
        // L8 (book ruling 12): the one reminder read the context assembler takes
        // before the model. It shares `catalog` and `observed`.
        architectureReminders,
        // Rework 1 item 4: `prepare` reads the ONE canonical Task closure before
        // building the binding and the continuation's blocked lines.
        readTaskClosure: async (_ctx, task) => readTaskClosure(backend.records,
          { aggregateType: 'Goal', projectId: task.projectId, goalId: task.goalId }, task.taskId),
        notes: noteToolDeps,
        // K3 L14/L13/U5: the SAME review owner the routes/Workflow publish, and
        // the Host's workspace-level read-only facts for `reviewCapability`.
        unknownCallReviews,
        // K3 L19a: the SAME CRR owner and the ONE recognizer the composition's
        // card source and shell hook use; the request tool and the shell hook
        // read them at Run start (no second parser or reader).
        commandRerunRequests, commandRecognizer,
        ...(host.readonlyCommandAccess === undefined ? {}
          : { readonlyCommandAccess: (input: ReadonlyCommandAccessInput) => host.readonlyCommandAccess!(input) }),
        host, kernel, resourceCaps, now, newId: randomUUID,
      };
      runtime = createAgentRuntime(dependencies);
    }
    // The completion methods are published on the SAME Goal service and drained
    // through the one trackedCall/close path; no second service or store exists.
    const goals: GoalTaskPort = {
      createGoal: (...args) => trackedCall(() => rawGoals.createGoal(...args), unavailable),
      completeTask: (...args) => trackedCall(() => rawGoals.completeTask(...args), unavailable),
      completeGoal: (...args) => trackedCall(() => rawGoals.completeGoal(...args), unavailable),
      setGoalControl: (...args) => trackedCall(() => rawGoals.setGoalControl(...args), unavailable),
    };
    function sessionCall<T>(call: () => Promise<T>): Promise<T | CoreRejection> {
      return trackedCall<T | CoreRejection>(call, unavailable);
    }
    const sessions: SessionDirectoryPort & Omit<SessionLifecyclePort, 'finishSessionArchive'> = {
      admitSessionCreation: (...args) => trackedCall(() => sessionDirectory.admitSessionCreation(...args), unavailable),
      recordSessionCreated: (...args) => trackedCall(() => sessionDirectory.recordSessionCreated(...args), unavailable),
      getSessionOperation: (...args) => trackedCall(() => sessionDirectory.getSessionOperation(...args), unavailable),
      readSession: (...args) => trackedCall(() => sessionDirectory.readSession(...args), unavailable),
      findSessions: (...args) => trackedCall(() => sessionDirectory.findSessions(...args), unavailable),
      linkSessionWork: (...args) => trackedCall(() => sessionLifecycle.linkSessionWork(...args), unavailable),
      archiveSession: (...args) => trackedCall(() => sessionLifecycle.archiveSession(...args), unavailable),
      reactivateSession: (...args) => trackedCall(() => sessionLifecycle.reactivateSession(...args), unavailable),
      // Slice 1 (spec §3.3): the archive request/receipt/step entries. The
      // low-level public `sessions/archive` signature/return is unchanged.
      requestSessionArchive: (...args) => trackedCall(() => sessionLifecycle.requestSessionArchive(...args), unavailable),
      readSessionArchiveRequestReceipt: (...args) => trackedCall(() => sessionLifecycle.readSessionArchiveRequestReceipt(...args), unavailable),
      releaseSessionArchiveRequest: (...args) => trackedCall(() => sessionLifecycle.releaseSessionArchiveRequest(...args), unavailable),
    };
    const executions: ExecutionReadPort & ExecutionHistoryWritePort
      & Required<Pick<ExecutionReadPort, 'listExecutions'>> = {
      recordExecutionHistory: (...args) => trackedCall(() => historyWriter.recordExecutionHistory(...args), unavailable),
      readExecution: (...args) => trackedCall(() => executionReader.readExecution(...args), unavailable),
      // MVP UI connection: the bounded execution list is assembled here so the
      // route table never sees a missing method. The reader implementation is
      // still an explicit stage-one gap.
      listExecutions: (...args) => trackedCall(() => executionReader.listExecutions!(...args), unavailable),
    };
    const claims: TaskClaimPort = {
      claimTask: (...args) => trackedCall(() => claimService.claimTask(...args), unavailable),
      requeueTask: (...args) => trackedCall(() => requeueService.requeueTask(...args), unavailable),
      // K3 L21 D9 (ruling 4): the record-keyed replay read of the derived
      // release-hold requeue, from the same owner instance and never a write.
      readTaskRequeueByIdentity: (...args) => trackedCall(
        () => requeueService.readTaskRequeueByIdentity(...args), unavailable),
    };
    const roles: RoleConfigurationPort = {
      installRoleSpec: (ctx, command) => trackedCall(() => roleService.installRoleSpec(ctx, command),
        () => ({ status: 'rejected', code: 'unavailable', commandId: command.commandId })),
      activateRoleSpec: (ctx, command) => trackedCall(() => roleService.activateRoleSpec(ctx, command),
        () => ({ status: 'rejected', code: 'unavailable', commandId: command.commandId })),
      readRoleSpec: (...args) => trackedCall(() => roleService.readRoleSpec(...args), unavailable),
      resolveRoleBinding: (...args) => trackedCall(() => roleService.resolveRoleBinding(...args), unavailable),
    };
    // The initialization writers share the same physical backend as Goal/Plan
    // and are drained before close like every other WorkGraph port.
    const projects: ProjectRegistrationPort = {
      createProject: (...args) => trackedCall(() => bootstrap.projects.createProject(...args), unavailable),
      registerWorkspace: (...args) => trackedCall(() => bootstrap.projects.registerWorkspace(...args), unavailable),
      readWorkspaceRegistration: (...args) => trackedCall(() => bootstrap.projects.readWorkspaceRegistration(...args), unavailable),
      // MVP UI connection: the narrow Project-only read is assembled here so a
      // real composition never leaves it absent. The reader implementation is
      // still an explicit stage-one gap.
      readProject: (...args) => trackedCall(() => bootstrap.projects.readProject!(...args), unavailable),
    };
    const completionPolicies: CompletionPolicyConfigurationPort = {
      installCompletionPolicy: (...args) => trackedCall(() => bootstrap.completionPolicies.installCompletionPolicy(...args), unavailable),
      activateCompletionPolicy: (...args) => trackedCall(() => bootstrap.completionPolicies.activateCompletionPolicy(...args), unavailable),
      // R6 cold-start: the independent current-policy read published as the
      // original `completion-policies/read` core route. The real owner always
      // publishes it; the optional cast keeps a narrow double compiling.
      readCurrentCompletionPolicy: (...args) =>
        trackedCall(() => bootstrap.completionPolicies.readCurrentCompletionPolicy!(...args), unavailable),
    };
    // R5b.1: the public pending QueryJob port depends only on the shared store;
    // it is real even without a Runtime Host binding and both operations are
    // drained before the ledger closes and reject once close has begun.
    const queries: QueryJobPort = {
      submitQueryJob: (...args) => trackedCall(() => queryJobs.submitQueryJob(...args), unavailable),
      readQueryJob: (...args) => trackedCall(() => queryJobs.readQueryJob(...args), unavailable),
      claimQuery: (...args) => trackedCall(() => queryJobs.claimQuery(...args), unavailable),
      readQueryAnswer: (...args) => trackedCall(() => queryJobs.readQueryAnswer(...args), unavailable),
    };
    const architecture: typeof observed & ArchitectureCatalogPort = {
      captureSourceChanges: (...args) => trackedCall(() => observed.captureSourceChanges(...args), unavailable),
      // L8 request record and the one public observation state (book rulings 3, 8, 12).
      requestAutoCapture: (...args) => trackedCall(() => observed.requestAutoCapture(...args), unavailable),
      failAutoCapture: (...args) => trackedCall(() => observed.failAutoCapture(...args), unavailable),
      readAutoCapture: (...args) => trackedCall(() => observed.readAutoCapture(...args), unavailable),
      observationState: (...args) => trackedCall(() => observed.observationState(...args), unavailable),
      readReminderFacts: (...args) => trackedCall(() => observed.readReminderFacts(...args), unavailable),
      queryArchitecture: (...args) => trackedCall(() => observed.queryArchitecture(...args), unavailable),
      compareArchitecture: (...args) => trackedCall(() => observed.compareArchitecture(...args), unavailable),
      queryImpact: (...args) => trackedCall(() => observed.queryImpact(...args), unavailable),
      listFiles: (...args) => trackedCall(() => observed.listFiles(...args), unavailable),
      neighbors: (...args) => trackedCall(() => observed.neighbors(...args), unavailable),
      impact: (...args) => trackedCall(() => observed.impact(...args), unavailable),
      compareFormalObserved: (...args) => trackedCall(() => observed.compareFormalObserved(...args), unavailable),
      // L8 (interface §7): fire only after a NON-REPLAYED successful adoption or
      // revision; the callback's own failure never changes the returned result.
      adoptInitialArchitecture: (...args) => trackedCall(async () => {
        // Fix the notification scope BEFORE the await: a later ctx mutation must
        // not retarget the trigger.
        const projectId = args[0].projectId;
        const result = await catalog.adoptInitialArchitecture(...args);
        if (result.status === 'committed' && !result.replayed) {
          fireArchitectureCaptureTrigger('catalog_adopted', projectId);
        }
        return result;
      }, unavailable),
      reviseArchitectureCatalog: (...args) => trackedCall(async () => {
        // Fix the notification scope BEFORE the await (same rule as adoption).
        const projectId = args[0].projectId;
        const result = await catalog.reviseArchitectureCatalog(...args);
        if (result.status === 'committed' && !result.replayed) {
          fireArchitectureCaptureTrigger('catalog_revised', projectId);
        }
        return result;
      }, unavailable),
      readArchitectureRevision: (...args) => trackedCall(() => catalog.readArchitectureRevision(...args), unavailable),
    };
    // Drain these Plan calls before closing the stores (initial planning also reads
    // the answer body), preserving the service's synchronous input snapshot.
    const plans: typeof planService = {
      ...planService,
      proposeInitialPlanFromAnswer: (...args) =>
        trackedCall(() => planService.proposeInitialPlanFromAnswer(...args), unavailable),
      queryGoalDisplay: (...args) => trackedCall(() => planService.queryGoalDisplay(...args), unavailable),
      queryGoalLiveRuns: (...args) => trackedCall(() => planService.queryGoalLiveRuns(...args), unavailable),
    };
    // The public material chain spans the ledger and the bodies, so the
    // whole outer call is drained before any owned store closes. The in-flight
    // service keeps the raw materials instance, never these wrappers.
    const materials: MaterialPort = {
      storeArtifact: (...args) => trackedCall(() => rawMaterials.storeArtifact(...args), unavailable),
      openArtifact: (...args) => trackedCall(() => rawMaterials.openArtifact(...args), unavailable),
    };
    const messages: Omit<SessionMailboxPort, 'ackMessage'> & Required<Pick<SessionMailboxPort, 'readOutbox'>> = {
      sendMessage: (...args) => trackedCall(() => mailbox.sendMessage(...args), unavailable),
      readMessage: (...args) => trackedCall(() => mailbox.readMessage(...args), unavailable),
      readMessageBody: (...args) => trackedCall(() => mailbox.readMessageBody(...args), unavailable),
      readInbox: (...args) => trackedCall(() => mailbox.readInbox(...args), unavailable),
      readOutbox: (...args) => trackedCall(() => mailbox.readOutbox(...args), unavailable),
      respondMessage: (...args) => trackedCall(() => mailbox.respondMessage(...args), unavailable),
      // Slice 1 (spec §4.4): the read-only undelivered-reply source page.
      readUndeliveredReplies: (...args) => trackedCall(() => mailbox.readUndeliveredReplies!(...args), unavailable),
      // Wiring 2 I-5 (§2.3, L7, F13): the SAME mailbox owner records a real
      // execution's acceptance of a saved reply, so an accepted reply leaves the
      // notice set. No other mailbox method is published here.
      recordInputAccepted: (...args) => trackedCall(() => mailbox.recordInputAccepted!(...args), unavailable),
    };
    // Slice 5 §4.5 platform ports: the same trackedCall drain convention as every
    // other owner, so an in-flight decision write is accounted for before close.
    const goalSettings: Omit<GoalSettingsPort, 'resolveGoalConflict'> = {
      readGoalSettings: (...args) => trackedCall(() => rawGoalSettings.readGoalSettings(...args), unavailable),
      setGoalSettings: (...args) => trackedCall(() => rawGoalSettings.setGoalSettings(...args), unavailable),
      reorderGoals: (...args) => trackedCall(() => rawGoalSettings.reorderGoals(...args), unavailable),
    };
    const workspaceDecisionSettings: WorkspaceDecisionSettingsPort = {
      markNoticesSeen: (...args) => trackedCall(() => rawWorkspaceDecisionSettings.markNoticesSeen(...args), unavailable),
    };
    const decisionMessages: DecisionMessagePort = {
      sendUserMessage: (...args) => trackedCall(() => rawDecisionMessages.sendUserMessage(...args), unavailable),
      answerDecision: (...args) => trackedCall(() => rawDecisionMessages.answerDecision(...args), unavailable),
      readDecisionAnswer: (...args) => trackedCall(() => rawDecisionMessages.readDecisionAnswer(...args), unavailable),
      recordDecisionApplication: (...args) => trackedCall(() => rawDecisionMessages.recordDecisionApplication(...args), unavailable),
    };
    const decisions: DecisionReadPort = {
      queryDecisionQueue: (...args) => trackedCall(() => rawDecisionReads.queryDecisionQueue(...args), unavailable),
      readDecisionCard: (...args) => trackedCall(() => rawDecisionReads.readDecisionCard(...args), unavailable),
      queryGoalConflicts: (...args) => trackedCall(() => rawDecisionReads.queryGoalConflicts(...args), unavailable),
    };
    const requestCandidatePort: RequestCandidatePort = {
      readRequestCandidate: (...args) => trackedCall(() => requestCandidates.readRequestCandidate(...args), unavailable),
      abandonPlanProposal: (...args) => trackedCall(() => requestCandidates.abandonPlanProposal(...args), unavailable),
    };
    // The public control port is real even without a Runtime Host binding: the
    // raw service depends only on the store and exact Run reads. Both operations
    // are drained before the ledger closes and reject once close has begun.
    const controls: RunControlPort = {
      submitControl: (...args) => trackedCall(() => rawControls.submitControl(...args), unavailable),
      readControl: (...args) => trackedCall(() => rawControls.readControl(...args), unavailable),
    };
    // The public evidence/check ports drain the whole outer call before any
    // owned store closes; the raw services keep their original instances.
    const evidence: EvidencePort = {
      openVerification: (...args) => trackedCall(() => rawEvidence.openVerification(...args), unavailable),
      readVerification: (...args) => trackedCall(() => rawEvidence.readVerification(...args), unavailable),
      // The chain-head reads delegate to the raw Evidence owner's formal
      // RecordStore candidate lookups; no second store, table or manager.
      queryOriginalVerification: (...args) => trackedCall(() => rawEvidence.queryOriginalVerification!(...args), unavailable),
      queryRoundChainHead: (...args) => trackedCall(() => rawEvidence.queryRoundChainHead!(...args), unavailable),
      beginCheck: (...args) => trackedCall(() => rawEvidence.beginCheck(...args), unavailable),
      recordCheckResult: (...args) => trackedCall(() => rawEvidence.recordCheckResult(...args), unavailable),
      finalizeChecks: (...args) => trackedCall(() => rawEvidence.finalizeChecks(...args), unavailable),
      // A.2 step 5.9 (VR-14): the successor round or its policy refusal (`verification/reverify`).
      reverifyRound: (...args) => trackedCall(() => rawEvidence.reverifyRound!(...args), unavailable),
    };
    const checks: RegisteredCheckRunner = {
      runRegisteredCheck: (...args) => trackedCall(() => rawCheckRunner.runRegisteredCheck(...args), unavailable),
    };
    const runtimePort = {
      ...runtime.port,
      async capabilities(...args: Parameters<RuntimeExecutionPort['capabilities']>): Promise<ReadResult<RuntimeCapabilities>> {
        const [ctx, scope] = args;
        if (isClosing) return { status: 'rejected', code: 'unavailable', reason: 'platform is closing' };
        if (ctx.signal.aborted) return { status: 'rejected', code: 'cancelled', reason: 'capability read cancelled' };
        if (ctx.principal.kind !== 'host' || ctx.projectId !== scope.projectId || ctx.workspaceId !== scope.workspaceId)
          return { status: 'rejected', code: 'forbidden', reason: 'capability scope is not bound by the Host' };
        const registered = kernelStores.forWorkspace(scope);
        if (!registered) return { status: 'rejected', code: 'unsupported', reason: 'workspace has no configured Kernel Store' };
        return { status: 'ready', value: workspaceRuntimeCapabilities(registered.adapterId, kernel.kernelSessionApiVersion,
          currentAutomationPolicy().resumeOnStartup) };
      },
      createSession(...args: Parameters<typeof sessionOperations.createSession>) {
        return sessionCall(() => sessionOperations.createSession(...args));
      },
      readTaskExecutionHistory(...args: Parameters<typeof graphHistory.readTaskExecutionHistory>) {
        return sessionCall(() => graphHistory.readTaskExecutionHistory(...args));
      },
      readExecutionHistory(...args: Parameters<typeof executionHistory.readExecutionHistory>) {
        return sessionCall(() => executionHistory.readExecutionHistory(...args));
      },
      readSessionHistory(...args: Parameters<typeof sessionOperations.readSessionHistory>) {
        return sessionCall(() => sessionOperations.readSessionHistory(...args));
      },
      prepareExecution(...args: Parameters<typeof runtime.port.prepareExecution>) {
        return sessionCall(() => runtime.port.prepareExecution(...args));
      },
      startRun(...args: Parameters<typeof runtime.port.startRun>) {
        return sessionCall(() => runtime.port.startRun(...args));
      },
      observeRun(...args: Parameters<typeof runtime.port.observeRun>) {
        return sessionCall(() => runtime.port.observeRun(...args));
      },
      // Slice 3 C6: the assembler-backed attention graph read reaches the Host
      // scanner on the SAME trackedCall/close path as every other Runtime read.
      readAttentionGraph(...args: Parameters<NonNullable<typeof runtime.port.readAttentionGraph>>) {
        const read = runtime.port.readAttentionGraph;
        if (read === undefined) {
          return Promise.resolve<CoreRejection>({ status: 'rejected', code: 'unsupported',
            reason: 'the attention graph read needs the trusted Runtime binding' });
        }
        return sessionCall(() => read(...args));
      },
      // C3 `executions/brief`: drained like every other Runtime read.
      readContinuationBrief(...args: Parameters<NonNullable<typeof runtime.port.readContinuationBrief>>) {
        const read = runtime.port.readContinuationBrief;
        if (read === undefined) {
          return Promise.resolve<CoreRejection>({ status: 'rejected', code: 'unsupported',
            reason: 'the continuation brief read needs the trusted Runtime binding' });
        }
        return sessionCall(() => read(...args));
      },
      // R4.3a: local control delivery runs on the SAME trackedCall/close path as
      // execution; no public close API or background recovery is added.
      deliverControl(...args: Parameters<NonNullable<typeof runtime.port.deliverControl>>) {
        return sessionCall(() => runtime.port.deliverControl!(...args));
      },
      prepareQuery(...args: Parameters<NonNullable<typeof runtime.port.prepareQuery>>) {
        return sessionCall(() => runtime.port.prepareQuery!(...args));
      },
      startQuery(...args: Parameters<NonNullable<typeof runtime.port.startQuery>>) {
        return sessionCall(() => runtime.port.startQuery!(...args));
      },
      observeQuery(...args: Parameters<NonNullable<typeof runtime.port.observeQuery>>) {
        return sessionCall(() => runtime.port.observeQuery!(...args));
      },
    };
    // R5c.1: the raw Runtime surface is the SAME `runtime.port` plus the
    // existing Session operations; no second Runtime/Store/Kernel is created.
    // The Workflow gets raw owners (never the public tracked wrappers) because
    // the whole public advanceWork call is drained as one tracked unit below.
    const rawRuntime = {
      ...runtime.port,
      createSession: (...args: Parameters<typeof sessionOperations.createSession>) =>
        sessionOperations.createSession(...args),
    };
    const workflowConfiguration = options.workflow === undefined
      ? undefined : structuredClone(options.workflow);
    // Slice 2C L7: the WorkGraph line read resolves a Session's duty through
    // this narrow port, and the Workflow uses the SAME resolver instance (the
    // composition root injects one result, never a second resolver). Slice 4A P5:
    // the notes service shares this instance too.
    const sessionDutyResolver: SessionDutyResolver = options.sessionDutyResolver ?? createSessionDutyResolver({
      readRoleSpec: roleService.readRoleSpec.bind(roleService),
      configuration: workflowConfiguration,
    });
    // Slice 4A P2: the ONE note writer and the minimal read model, over the same
    // records/plan/workspace/execution ports the rest of WorkGraph uses.
    // Slice 4A: a work_run caller's Run→Session facts. `notes` may not import
    // `materials`, so the composition root resolves the Run, its claim outbox and
    // the Session with the WorkGraph decoders (no Host capability is granted).
    const noteRunFacts: NoteRunFactResolver = async (_ctx, runRef) => {
      const runKey = canonicalJson(runRef as unknown as JsonValue);
      const runRead = await backend.records.readMany([runKey]);
      if (runRead.status !== 'ready') return { status: 'rejected', code: 'unavailable', reason: runRead.reason };
      const runRecord = runRead.value.records.find(record => record.refKey === runKey);
      if (runRecord === undefined) return { status: 'not_found' };
      const decodedRun = decodeRun(runRecord);
      if (!decodedRun.ok) return { status: 'rejected', code: 'unavailable', reason: 'the caller Run is damaged' };
      const run = decodedRun.value;
      const outboxKey = dispatchOutboxRefKey({ aggregateType: 'DispatchOutboxEntry', projectId: run.task.projectId,
        goalId: run.task.goalId, taskId: run.task.taskId, attemptId: run.attemptId });
      const outboxRead = await backend.records.readMany([outboxKey]);
      if (outboxRead.status !== 'ready') return { status: 'rejected', code: 'unavailable', reason: outboxRead.reason };
      const outboxRecord = outboxRead.value.records.find(record => record.refKey === outboxKey);
      if (outboxRecord === undefined) return { status: 'rejected', code: 'unavailable', reason: 'the caller Run has no claim-linked Session' };
      const decodedOutbox = decodeDispatchOutboxEntry(outboxRecord);
      if (decodedOutbox.status !== 'decoded') {
        return { status: 'rejected', code: 'unavailable', reason: `the claim outbox is damaged: ${decodedOutbox.reason}` };
      }
      const claimSession = decodedOutbox.value.claim.sessionRef;
      const sessionRef = { projectId: claimSession.projectId, sessionId: claimSession.sessionId };
      const sessionKey = sessionAggregateRefKey(plainSessionRefToAggregate(sessionRef));
      const sessionRead = await backend.records.readMany([sessionKey]);
      if (sessionRead.status !== 'ready') return { status: 'rejected', code: 'unavailable', reason: sessionRead.reason };
      const sessionRecord = sessionRead.value.records.find(record => record.refKey === sessionKey);
      if (sessionRecord === undefined) return { status: 'rejected', code: 'unavailable', reason: 'the caller Session is missing' };
      const decodedSession = decodeSessionRecord(sessionRecord);
      if (decodedSession.status !== 'decoded') {
        return { status: 'rejected', code: 'unavailable', reason: `the caller Session is damaged: ${decodedSession.reason}` };
      }
      return { status: 'ready', value: { goalId: run.task.goalId, sessionRef, role: decodedSession.value.role,
        planRef: run.planRef } };
    };
    // Slice 4A P1/P6: the derived scribe-scope facts (open responsible module
    // links, the SAME duty resolver the Workflow gets, and the active catalog's
    // containment) and the L7 per-scope current count.
    const scribeScope = createScribeScope({ records: backend.records, sessions: sessionDirectory,
      architecture: catalog, duties: sessionDutyResolver });
    // Slice 4A P10: the note module never sees a trusted workspace revision; this
    // wrapper resolves it through the same access factory the workspace tools use.
    const noteWorkspace = {
      readWorkspace: workspace.tools.readWorkspace,
      querySource: workspace.tools.querySource,
      // Item 14/L14: the symbol capture is best-effort released after use; the
      // note module never sees the trusted workspace revision.
      releaseCapture: workspace.tools.releaseCapture,
      capture: async (callCtx: CoreCallContext, request: { provider: SourceProvider }) => {
        const workspaceRef = { aggregateType: 'Workspace' as const, projectId: callCtx.projectId,
          workspaceId: callCtx.workspaceId ?? '' };
        const opened = await access.open(callCtx, workspaceRef);
        if (opened.status !== 'ready') return opened;
        const revision = opened.value.workspaceRevision;
        await opened.value.release();
        return workspace.tools.captureSourceChanges(callCtx, { workspace: workspaceRef,
          workspaceRevision: revision, provider: request.provider });
      },
    };
    const noteWrite: NoteService = createNoteService({
      records: backend.records,
      plans: planService,
      runFacts: noteRunFacts,
      duties: sessionDutyResolver,
      workspace: noteWorkspace,
      workspaceMaxFileBytes: DEFAULT_WORKSPACE_LIMITS.maxFileBytes,
      architecture: catalog,
      scopes: scribeScope,
      now, eventId: randomUUID, newId: options.noteNewId ?? randomUUID,
      ...(options.noteLimits === undefined ? {} : options.noteLimits),
    });
    // Slice 4B L22/P8: `views` owns the one derivation implementation and the
    // composition root injects it into the read model (`notes` never imports
    // `views`). The version lists live in `notes/note-version-lists.ts`.
    const noteCheck: NoteHeadCheckPort = createNoteCheck({ records: backend.records, plans: planService,
      architecture: catalog, workspace: noteWorkspace, artifacts: bodies,
      ...(options.noteLimits === undefined ? {} : { limits: options.noteLimits }) });
    // Slice 4C-2 U6: bind the holder created beside the early message sources.
    // Rework item 6: the source now takes the note service's batched
    // `userReasonFacts` (ONE per-call fact read shared with the disposition
    // guard) instead of re-running the full `checkNotes`.
    const noteDecisionSource = createNoteDecisionSource({ records: backend.records,
      userReasonFacts: noteWrite.userReasonFacts, apply: noteWrite.applyNoteDecision });
    boundNoteDecisionSource = noteDecisionSource;
    /**
     * Slice 4C-2 U6: the `note_review` application adapter. The answer commit is
     * step ①; this adapter turns it into the notes owner's card-mode command.
     * `commandId` is derived from the answer message ref alone, so a retried
     * `resolveDecision` reaches the SAME owner identity and replays the original
     * `NoteDispositionChanged` receipt instead of writing a second disposition.
     */
    const noteApplication: DecisionApplicationAdapter = {
      async apply(ctx, { answerRef, source, selection }) {
        if (selection.kind !== 'option' || !isNoteOptionId(selection.optionId)) {
          return { status: 'ready', value: { action: { status: 'rejected', code: 'invalid',
            reason: 'a note_review decision requires one of the card options' }, receipt: null } };
        }
        const identity = parseNoteReviewKey(source.key);
        if (identity === null) {
          return { status: 'ready', value: { action: { status: 'rejected', code: 'invalid',
            reason: 'the note_review source key is not a NoteHead pin' }, receipt: null } };
        }
        // Verifier §1: the answer commit (step ①) has happened, so the saved
        // body is the ONLY source of the condition text (8C's re-apply reads
        // only the saved answer). A failed body read must leave the card
        // "answered, pending application": it is NEVER "no condition written".
        const answerRead = await rawDecisionMessages.readDecisionAnswer(ctx, { source });
        if (answerRead.status !== 'ready' || answerRead.value.body === null) {
          return { status: 'ready', value: { action: { status: 'rejected', code: 'unavailable',
            reason: answerRead.status === 'rejected'
              ? answerRead.reason : 'the saved answer body is not readable' }, receipt: null } };
        }
        const text = answerRead.value.body.text;
        const pointerPin = source.pins.find(pin =>
          (pin.ref as { aggregateType?: unknown }).aggregateType === 'CurrentPointer');
        const result = await noteDecisionSource.applyNoteDecision(ctx, {
          commandId: `note-review:${canonicalJson(answerRef as unknown as JsonValue)}`,
          cardId: source.key,
          optionId: selection.optionId,
          pin: { noteId: identity.noteId, version: identity.revision },
          expectedPointerRevision: pointerPin === undefined ? null : pointerPin.revision,
          answerMessageRef: answerRef,
          conditions: text.length === 0 ? null : text,
        });
        if (result.status === 'done') {
          return { status: 'ready', value: { action: result, receipt: result.receipt } };
        }
        if (result.code === 'revision_conflict') {
          // Verifier §2 / lead ruling 2: the owner's pin-move result is the
          // CoreRejection `source_stale` at this boundary (its `NoteErrorCode`
          // does not change).
          return { status: 'ready', value: { action: { status: 'rejected', code: 'source_stale',
            reason: 'source_stale' }, receipt: null } };
        }
        return { status: 'ready', value: { action: result, receipt: null } };
      },
    };
    const noteReads: NoteReadPort & NoteMemoryReadPort & NoteListReadPort & NoteMemoryMaterialReadPort = createNoteReadModel({ records: backend.records,
      plans: planService, architecture: catalog, workspace: noteWorkspace, check: noteCheck,
      // Slice 4C C2.2: the concrete narrow Run resolver (one readMany) resolves a
      // work Run's own task and bound plan from the trusted principal.
      runTask: createNoteRunTaskResolver(backend.records),
      ...(options.noteLimits === undefined ? {} : options.noteLimits) });
    // Slice 4C-2 U8 (§11.4/L20): the ONE memory-material read reaches the
    // extensions reader through the SAME deps object created above; the caller
    // still picks the parts. §11.5: the narrow update-due and scribe to-do
    // ports read over the SAME record store and the SAME check.
    const noteMemoryMaterial = createNoteMemoryMaterial(noteReads);
    contextExtensionsDeps.memoryMaterial = noteMemoryMaterial;
    const noteScribeTodos = createNoteScribeTodos({ records: backend.records,
      userReasonFacts: noteWrite.userReasonFacts });
    // Slice 4C L13/L14: fill the stable holder the Runtime already received. The
    // tools read these fields at Run start time, after this point.
    noteToolDeps.memory = noteReads;
    noteToolDeps.write = noteWrite;
    noteToolDeps.check = noteCheck;
    const noteVersions = createVersionLists({ records: backend.records });
    // The ONE owner group 4C's routes bind. Each operation is selected through
    // the port (a real production read of the surface) before the group is built.
    const writeNote = noteWrite.writeNote;
    const reviewNote = noteWrite.reviewNote;
    const withdrawNote = noteWrite.withdrawNote;
    const readNote = noteReads.readNote;
    const listByAnchor = noteReads.listByAnchor;
    const memoryLookup = noteReads.memoryLookup;
    const memoryNeighbors = noteReads.memoryNeighbors;
    const memoryHistory = noteReads.memoryHistory;
    const memoryConflicts = noteReads.memoryConflicts;
    const memoryFind = noteReads.memoryFind;
    const memoryStale = noteReads.memoryStale;
    // Slice 4C C1.4: the route-facing `notes/list` read (the same read model).
    const listNotes = noteReads.listNotes;
    const { listPlanVersions, listCatalogVersions } = noteVersions;
    const countCurrentNotes = scribeScope.countCurrentNotes;
    // Slice 4B R16/L22: the second `checkNotes` call site (the write envelope and
    // 4C's routes bind it). Exposed now so NE3 tests run through the real holder.
    const checkNotes = noteCheck.checkNotes;
    // Slice 4C-2 §11.5: the scribe reminder's two narrow Host reads. The goal
    // ids are one paged walk of the Goal-by-workspace index; the recipient is
    // the smallest-sessionId active scribe (the 7D resolver replaces this).
    const goalIdsForWorkspace = async (ctx: CoreCallContext): Promise<ReadResult<string[]>> => {
      const page = await readAllRecords(backend.records, GOAL_BY_WORKSPACE_INDEX, [ctx.projectId, ctx.workspaceId ?? '']);
      if (!page.ok) return { status: 'rejected', code: page.code, reason: page.reason };
      const goalIds: string[] = [];
      for (const record of page.value) {
        const decoded = decodeGoalSnapshot(record);
        if (decoded.status !== 'decoded') {
          return { status: 'rejected', code: 'unavailable', reason: 'a goal record is damaged' };
        }
        goalIds.push(decoded.value.ref.goalId);
      }
      return { status: 'ready', value: goalIds };
    };
    const resolveScribeRecipient = async (ctx: CoreCallContext): Promise<ReadResult<SessionRef | null>> => {
      const workspace = { projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? '' };
      const scribes: SessionRef[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await sessionDirectory.findSessions(ctx, { workspace, includeArchived: false,
          page: { limit: 200, ...(cursor === undefined ? {} : { cursor }) } });
        if (page.status !== 'ready') return page;
        for (const card of page.value.items) {
          if (card.record.lifecycle !== 'active') continue;
          const duty = await sessionDutyResolver(card.record.role, ctx);
          if (duty.status === 'ready' && duty.value === 'scribe') scribes.push(card.record.ref);
        }
        if (page.value.nextCursor === null) break;
        cursor = page.value.nextCursor;
      }
      if (scribes.length === 0) return { status: 'ready', value: null };
      scribes.sort((left, right) => left.sessionId < right.sessionId ? -1 : left.sessionId > right.sessionId ? 1 : 0);
      return { status: 'ready', value: scribes[0]! };
    };
    const notes: NoteWritePort & NoteReadPort & NoteMemoryReadPort & NoteScopeReadPort & NoteCheckPort
      & NoteListReadPort & typeof noteVersions & {
        readScribeTodos: NoteScribeTodoPort['readScribeTodos'];
        readLedgerCursor: NoteScribeTodoPort['readLedgerCursor'];
        goalIdsForWorkspace: (ctx: CoreCallContext) => Promise<ReadResult<string[]>>;
        resolveScribeRecipient: (ctx: CoreCallContext) => Promise<ReadResult<SessionRef | null>>;
      } = {
        writeNote, reviewNote, withdrawNote, readNote, listByAnchor, countCurrentNotes, checkNotes,
        // K3 L4: the read-only committed-receipt lookup stays on the note owner group
        // so the owner lookup is reachable through the same public `notes` surface.
        ...(noteWrite.lookupToolCommit === undefined ? {} : { lookupToolCommit: noteWrite.lookupToolCommit }),
        memoryLookup, memoryNeighbors, memoryHistory, memoryConflicts, memoryFind, memoryStale, listNotes,
        listPlanVersions, listCatalogVersions,
        readScribeTodos: noteScribeTodos.readScribeTodos,
        readLedgerCursor: noteScribeTodos.readLedgerCursor,
        goalIdsForWorkspace,
        resolveScribeRecipient,
      };
    // Slice 1 (spec §3.3): the responsibility port's three public writes. Every
    // member is read here so the public `closeTerminalResponsibility` write (a
    // task's terminal relationship close) is part of the production assembly.
    const closeTerminalResponsibility = sessionResponsibility.closeTerminalResponsibility.bind(sessionResponsibility);
    const responsibilities: typeof sessionResponsibility = {
      transferSessionResponsibility: sessionResponsibility.transferSessionResponsibility.bind(sessionResponsibility),
      disposeArchiveResponsibility: sessionResponsibility.disposeArchiveResponsibility.bind(sessionResponsibility),
      closeTerminalResponsibility,
    };
    const workflowDependencies: WorkflowDependencies = {
      tasks: rawGoals, plans: planService, sessions: sessionDirectory,
      claims: { ...claimService, requeueTask: requeueService.requeueTask,
        readTaskRequeue: requeueService.readTaskRequeue,
        readTaskRequeueByIdentity: requeueService.readTaskRequeueByIdentity },
      executions: executionReader, runtime: rawRuntime, evidence: rawEvidence, checks: rawCheckRunner,
      sourceAuthority,
      // Slice 1 (spec §3.3): the new optional narrow ports. The SAME
      // `sessionFacts` instance reaches the Workflow; `controls` and the two
      // attestations bind this Host's existing wrappers; the archive policy and
      // duty resolver are trusted Host data (default one day; with no injected
      // resolver the duty resolver reads the Session's own role facts first, see
      // below). The archive/maintenance services are
      // built by `createWorkflow` from these ports.
      sessionLifecycle,
      sessionFacts,
      responsibilities,
      sessionAnomalies,
      controls: rawControls,
      attestUnknownRun: resolveUnknownRun,
      attestUnknownQueryRun: resolveUnknownQueryRun,
      archivePolicy,
      // Slice 1 (L-g): every new Workflow archive/maintenance time comes from
      // this injected clock, the SAME one the rest of the platform runs on.
      now,
      // Slice 1 E2: the trusted terminal-time basis the owner already uses.
      responsibilityBasis,
      // The trusted Host callback, when installed, always wins. Otherwise the
      // resolver reads the Session's own fixed role facts and, only when neither
      // the pinned RoleSpec nor the legacy platform template names a duty, falls
      // back to the ordinary Work bindings' `sessionRole` (I-1, L5). Slice 2C
      // L7: the hoisted instance is the SAME one the line read receives.
      sessionDuty: sessionDutyResolver,
      ...(workflowConfiguration === undefined ? {} : { configuration: workflowConfiguration }),
      // Slice 1 (spec §4.1): the full mailbox owns `disposeArchiveWait`; without
      // it an ordinary transferred-wait archive answers unsupported. It is the
      // SAME mailbox instance the Runtime and routes use, never a second copy.
      messages: mailbox,
      // Slice 1 (spec §4.2): the exact close-event reader maintenance uses to
      // derive an executor's `finishedAt` from the terminal responsibility close.
      // The RecordStore's own result is translated to the Workflow's read shape;
      // a damaged (`corrupt`) or unique-slot failure is an explicit `unavailable`.
      records: {
        async eventAt(cursor) {
          const at = await backend.records.eventAt(cursor);
          if (at.status === 'ready') return { status: 'ready', value: { cursor: at.value.cursor, event: at.value.event } };
          const code: CoreRejection['code'] = at.code === 'corrupt' || at.code === 'unique_conflict'
            ? 'unavailable' : at.code;
          return { status: 'rejected', code, reason: at.reason };
        },
      },
      // The explicit-consultation consumer reuses the SAME mailbox/Query/Project
      // owners. The mailbox half is read-only plus the ONE Host-only answer
      // association; it is never a second mailbox or a new service.
      consultations: {
        messages: { readMessage: mailbox.readMessage.bind(mailbox), readMessageBody: mailbox.readMessageBody.bind(mailbox),
          respondFromQueryAnswer: mailbox.respondFromQueryAnswer.bind(mailbox),
          recordConsultationDerivation: mailbox.recordConsultationDerivation!.bind(mailbox) },
        queries: queryJobs,
        projects: bootstrap.projects,
      },
      // Slice 5 §3.3/§4.5: the SAME settings/message/read owners. They are
      // optional on the Workflow port so an old composition still starts; this
      // composition always supplies them.
      goalSettings: rawGoalSettings,
      decisionMessages: rawDecisionMessages,
      decisionReads: rawDecisionReads,
      decisionDuties: messageDuties,
      goalExecutedFiles,
      applicationReceipt,
      // Slice 4C-2 U6: the note_review step ② adapter for the finite decision
      // coordinator; `goal_conflict` keeps its built-in chain. K3 L19 adds the
      // ONE `unknown_call_review` row: the owner's answer-derived disposition.
      decisionApplications: {
        note_review: noteApplication,
        unknown_call_review: {
          async apply(ctx, { answerRef, source, selection, requestId, expected }) {
            const result = await unknownCallReviews.applyDisposition(ctx, {
              input: { source, selection, decisionMessageRef: answerRef },
              meta: { requestId, expected },
            });
            return { status: 'ready', value: { action: result, receipt: null } };
          },
        },
        // K3 L19a (ruling 4): the `command_rerun_request` answer application
        // beside B1's row, over the SAME CRR owner.
        command_rerun_request: createCommandRerunRequestApplicationAdapter(commandRerunRequests),
      },
      // Slice 2B P12: the WorkGraph RunActivity owner the Workflow backfill scans
      // and writes through (the SAME instance the activity reads and the end
      // commits use, §0.4).
      runActivity,
      // K3 L7/L11/L12/L16: the SAME UnknownCallReview owner the routes and
      // Runtime publish; the Workflow reads the selected Run's record and
      // performs `settle_review` through it.
      unknownCallReviews,
    };
    const rawWorkflow = createWorkflow(workflowDependencies);
    /**
     * Slice 1 E8 (§3.4 S:620): the composite archive and the bounded maintenance
     * step run only on the Host that holds the instance lease; an internal
     * recovery still verifies the CURRENT Host's lease, so a recovery on a Host
     * that lost the lease is refused before any step. This is the same admission
     * `resolveUnknownRun`/`resolveUnknownQueryRun` apply, with the archive's own
     * wording.
     */
    const archiveLeaseAdmission = (): CoreRejection | null =>
      hostInstance === undefined || hostInstance.lease === 'owned' ? null : {
        status: 'rejected', code: 'busy',
        reason: 'this Host does not hold the Host instance lease; only that Host archives or maintains Sessions (L-1)',
      };
    // The public advancement port drains the complete call before any owned
    // store closes; the in-flight raw workflow keeps the raw owner instances.
    const workflow: WorkflowPort & Required<Pick<WorkflowPort,
      'consumeConsultation' | 'archiveLine' | 'continueArchiveLine' | 'maintainSessions'>> = {
      handleGoalInput: (...args) => trackedCall(() => rawWorkflow.handleGoalInput(...args), unavailable),
      advanceWork: (...args) => trackedCall(() => rawWorkflow.advanceWork(...args), unavailable),
      consumeConsultation: (...args) => trackedCall(() => rawWorkflow.consumeConsultation(...args), unavailable),
      // Slice 1 (spec §4.1, §4.2): the composite archive action, its recovery
      // entry and the bounded maintenance step, published by the Workflow. Each
      // is admitted by the Host instance lease before the composition runs.
      archiveLine: (...args) => trackedCall(async () => archiveLeaseAdmission()
        ?? await rawWorkflow.archiveLine!(...args), unavailable),
      continueArchiveLine: (...args) => trackedCall(async () => archiveLeaseAdmission()
        ?? await rawWorkflow.continueArchiveLine!(...args), unavailable),
      maintainSessions: (...args) => trackedCall(async () => archiveLeaseAdmission()
        ?? await rawWorkflow.maintainSessions!(...args), unavailable),
      // Slice 5 §4.5: the finite decision coordinator and the read-only advance
      // ordering safe point are drained like every other Workflow call.
      resolveDecision: (...args) => trackedCall(() => rawWorkflow.resolveDecision(...args), unavailable),
      orderGoalAdvances: (...args) => trackedCall(() => rawWorkflow.orderGoalAdvances(...args), unavailable),
      // Slice 2B L8/P12: the two backfill operations are drained like every other
      // Workflow call. `createWorkflow` always publishes them (the composition
      // installs `runActivity`), so the non-null assertion is sound here.
      backfillRecentActivity: (...args) => trackedCall(() => rawWorkflow.backfillRecentActivity!(...args), unavailable),
      backfillActivityRange: (...args) => trackedCall(() => rawWorkflow.backfillActivityRange!(...args), unavailable),
    };
    // A.2 step 5.6 (§12.1): the start-up reconcile's internal seam. Only the Host
    // that holds the instance lease calls it, before any execution driver starts;
    // every write is judged by its owner machine (R events need `owned`).
    const classifierMessages = mailbox;
    /** K3 L5: the immutable artifact content type of a full workspace change capture. */
    const WORKSPACE_CHANGE_CAPTURE_CONTENT_TYPE = 'application/vnd.platform.workspace-change-capture+json';
    // K3 (Q2/L4): the owners' published committed-call lookups, dispatched by
    // tool name. A row-4 name no owner publishes stays `lookup_not_published`.
    const toolCommitLookup = createToolCommitLookup([
      mailbox.lookupToolCommit, rawDecisionMessages.lookupToolCommit, planService.lookupToolCommit,
      noteWrite.lookupToolCommit, commandRerunRequests.lookupToolCommit,
    ]);
    // K3 (Q3/L5): the classifier's and the attestation entry's workspace capture.
    // It reads the prepared manifest at `bundleRef`, takes its run-start
    // baseline (absent/unavailable compares with the current HEAD), runs the
    // new traversal over the Host's root with the platform's denied prefixes,
    // and stores the full capture as an immutable Artifact.
    const captureWorkspace = async (
      ctx: CoreCallContext, input: { workspaceId: string; bundleRef: import('../contracts/artifact.js').ArtifactRef },
    ): Promise<WorkspaceCaptureV1> => {
      const unavailable = (
        runBaselineKnown: boolean, reason: 'not_git' | 'unstable' | 'too_many_changes' | 'read_failed' | 'not_configured',
        detail: string,
      ): WorkspaceCaptureV1 => ({ status: 'unavailable', runBaselineKnown, reason,
        detail: detail.length > 500 ? detail.slice(0, 500) : detail });
      let root: string;
      try {
        const resolved = await options.workspace.resolveRoot({ aggregateType: 'Workspace', projectId: ctx.projectId,
          workspaceId: input.workspaceId });
        if (resolved.status !== 'ready') {
          return unavailable(false, 'read_failed', `the workspace root could not be resolved: ${resolved.reason}`);
        }
        root = resolved.value.root;
      } catch (error) {
        return unavailable(false, 'read_failed', `the workspace root could not be resolved: ${String(error)}`);
      }
      let baseline: WorkspaceBaselineV1 | null = null;
      let runRef: RunRef | null = null;
      let sourceRefs: SourceRefV1[] = [];
      // Item 10: one read/decode/degrade of the prepared bundle's baseline,
      // shared with the context assembler (`readWorkspaceBaselineFromBundle`).
      const bundle = await readWorkspaceBaselineFromBundle(bodies, input.bundleRef);
      if (bundle !== null) {
        const manifest = bundle.manifest as { claim?: { runRef?: RunRef }; sourceRefs?: unknown };
        if (manifest.claim?.runRef !== undefined) runRef = manifest.claim.runRef;
        // K3 L4 (RUN-25): the capture Artifact reuses the prepared manifest's
        // run-start source pin (`plan-revision` + `workspace`), exactly the list
        // `execution-preparation.ts` stores the manifest and baseline with.
        if (Array.isArray(manifest.sourceRefs) && manifest.sourceRefs.length > 0) {
          sourceRefs = manifest.sourceRefs as SourceRefV1[];
        }
        baseline = bundle.baseline;
      }
      let captured: WorkspaceChangeCaptureResult;
      try {
        captured = await captureWorkspaceChange({ root, deniedPrefixes: WORKSPACE_DENIED_PREFIXES, baseline });
      } catch (error) {
        return unavailable(baseline !== null, 'read_failed', `the workspace capture failed: ${String(error)}`);
      }
      if (captured.status !== 'captured') {
        return unavailable(captured.baselineKnown, captured.reason, captured.detail);
      }
      if (runRef === null) return unavailable(baseline !== null, 'read_failed', 'the prepared manifest names no owning Run');
      // K3 L4: never store an empty `sourceRefs`; the body codec refuses it and
      // the capture would answer `unavailable` instead of the RUN-25 evidence.
      if (sourceRefs.length === 0) {
        return unavailable(baseline !== null, 'read_failed', 'the prepared manifest names no usable sourceRefs');
      }
      let storedCapture;
      try {
        storedCapture = await bodies.put({
          body: JSON.stringify(captured.capture), contentType: WORKSPACE_CHANGE_CAPTURE_CONTENT_TYPE, sourceRefs,
          origin: { kind: 'run', owner: runRef }, requestedAt: now(),
        });
      } catch (error) {
        return unavailable(captured.baselineKnown, 'read_failed', `storing the workspace capture failed: ${String(error)}`);
      }
      if (storedCapture.status !== 'ready') {
        return unavailable(captured.baselineKnown, 'read_failed', `storing the workspace capture failed: ${storedCapture.reason}`);
      }
      return { status: 'captured', runBaselineKnown: captured.baselineKnown, baseCommit: captured.capture.baseCommit,
        headNow: captured.capture.headNow, captureRef: storedCapture.value.ref, changedCount: captured.capture.changed.length,
        sample: captured.sample, notVisible: captured.capture.notVisible,
        notVisibleOmitted: captured.capture.notVisibleOmitted };
    };
    const reconcile = {
      candidates: reconcileCandidates,
      // K3 L28 step 2b/6b: the SAME `UnknownCallReview` owner the routes and the
      // Workflow read. B1 adds the UR7b answer list and the saved-answer read;
      // `listReviews` stays.
      reviews: {
        listReviews: unknownCallReviews.listReviews.bind(unknownCallReviews),
        listUnappliedAnswers: unknownCallReviews.listUnappliedAnswers.bind(unknownCallReviews),
        // K3 L19a (ruling 4/answer 7): the CRR answers through the SAME
        // `k3-decision-answer-by-source-goal` reader, so 6b(c) kind 4 lists both
        // kinds and the Workflow drives each by its own source ref.
        readCommandRerunRequestAnswers: (ctx: CoreCallContext, { goalRef }: { goalRef: GoalRef }) =>
          readUnappliedAnswers({ records: backend.records }, ctx, { kind: 'command_rerun_request', goalRef }),
        readDecisionAnswer: rawDecisionMessages.readDecisionAnswer.bind(rawDecisionMessages),
      },
      probe: (session: Parameters<typeof historyOwner.probe>[0]['session'], signal: AbortSignal): Promise<SessionMappingProbe> =>
        trackedCall(() => historyOwner.probe({ session, signal }),
          () => ({ verdict: 'cancelled' as const, activeRunId: null, reason: 'platform is closing' })),
      recordSessionHealth: (...args: Parameters<typeof sessionHealth.recordSessionHealth>) =>
        trackedCall(() => sessionHealth.recordSessionHealth(...args), unavailable),
      reconcileRun: (ctx: CoreCallContext, input: { record: TaskExecutionRecord; hostInstanceId: string;
        takeover?: import('../contracts/unknown-call-review.js').HostTakeoverProofV1 | null;
        probe: SessionMappingProbe }) =>
        trackedCall(async () => {
          if (resultWriter === undefined) {
            return { runRef: input.record.run.ref, row: 'W-*', status: 'left' as const,
              reason: 'this Host has no trusted Runtime binding to read the Kernel' };
          }
          return reconcileRunAtStartup({ owner: historyOwner, messages: classifierMessages, controls: rawControls,
            entry: resultWriter, reconcile: runReconcile, now, newId: randomUUID,
            ...(runtime.port.turnClosureSupport === undefined
              ? {} : { turnClosureSupport: runtime.port.turnClosureSupport.bind(runtime.port) }),
            captureWorkspace, lookupToolCommit: toolCommitLookup }, ctx, input);
        }, () => ({ runRef: input.record.run.ref, row: 'W-*', status: 'failed' as const, reason: 'platform is closing' })),
      reconcileQuery: (ctx: CoreCallContext, input: { record: QueryExecutionRecord; hostInstanceId: string; probe: SessionMappingProbe }) =>
        trackedCall(async () => {
          const observeQuery = runtime.port.observeQuery;
          if (queryExecution === undefined || observeQuery === undefined) {
            return { queryRunRef: input.record.run.ref, row: 'Q-*', status: 'left' as const,
              reason: 'this Host has no trusted Query binding' };
          }
          return reconcileQueryRunAtStartup({ owner: historyOwner, messages: classifierMessages, queries: queryExecution,
            observeQuery: (callCtx, request) => observeQuery(callCtx, request) }, ctx, input);
        }, () => ({ queryRunRef: input.record.run.ref, row: 'Q-*', status: 'failed' as const, reason: 'platform is closing' })),
      readQueryExecution: (ctx: CoreCallContext, ref: QueryRunRef) => trackedCall(() => queryExecution === undefined
        ? Promise.resolve<CoreRejection>({ status: 'rejected', code: 'unsupported', reason: 'no trusted Query binding' })
        : queryExecution.readQueryExecution(ctx, ref), unavailable),
      reconcileControls: (ctx: CoreCallContext, input: { record: TaskExecutionRecord; hostInstanceId: string; queuedSteers: boolean }) =>
        trackedCall(() => reconcileRunControlsAtStartup({ owner: historyOwner, reconcile: runReconcile }, ctx, input),
          () => ({ runRef: input.record.run.ref, row: 'W-*', status: 'failed' as const, reason: 'platform is closing' })),
      interruptCheck: (...args: Parameters<NonNullable<typeof rawEvidence.interruptCheck>>) =>
        trackedCall(() => rawEvidence.interruptCheck!(...args), unavailable),
      // Slice 1 (spec §4.2, K5): the start-up reconcile's step 6c runs at most
      // one Workflow maintenance page after the Goal fan-out and before the
      // re-drive selection. It starts no Kernel Turn, check or model call.
      maintainSessions: (...args: Parameters<NonNullable<WorkflowPort['maintainSessions']>>) =>
        trackedCall(() => rawWorkflow.maintainSessions!(...args), unavailable),
    };
    /**
     * RUN-22 / QRR-06 (contract (d), L-1): the operator attests an unknown end
     * through this Host. The Host entry first admits the request without any
     * write (this Host's lease, a reason, an unknown target at the pinned
     * revision; L-1 "busy，不改任何事实"), then reads the Kernel facts (an open
     * Turn, the input confirmation, which may record the mailbox acceptance),
     * and the owner judges the attestation. A request the owner already
     * committed under its identity gets the original receipt before the pin
     * and the state are compared (原回执回放, §12.10 step 4): the attestation
     * itself moved both. The same identity with other content gets
     * `idempotency_conflict` there (§1.2).
     */
    function attestationAdmission(request: GraphWrite<unknown> | undefined, ref: object, revision: number, unknown: boolean,
      what: string): CoreRejection | null {
      if (hostInstance === undefined || hostInstance.lease !== 'owned') {
        return { status: 'rejected', code: 'busy', reason: 'this Host does not hold the Host instance lease; only that Host attests (L-1)' };
      }
      const reason = (request?.input as { reason?: unknown } | undefined)?.reason;
      if (typeof reason !== 'string' || reason.trim().length === 0) {
        return { status: 'rejected', code: 'invalid', reason: 'the attestation needs a reason' };
      }
      const expected = request?.meta?.expected;
      if (!Array.isArray(expected) || expected.length !== 1 || !sameJson(expected[0]?.ref, ref)) {
        return { status: 'rejected', code: 'invalid', reason: `meta.expected must be exactly the ${what} pin` };
      }
      if (expected[0]?.revision !== revision) {
        return { status: 'rejected', code: 'revision_conflict', reason: `the ${what} changed since the caller read it`,
          current: [{ ref: ref as VersionPin['ref'], revision }] };
      }
      if (!unknown) return { status: 'rejected', code: 'busy', reason: `the ${what} has no unknown outcome to attest` };
      return null;
    }
    async function resolveUnknownRun(ctx: CoreCallContext, request: GraphWrite<{ runRef: RunRef; reason: string }>,
    ): Promise<WriteResult<RunSnapshot>> {
      const input = request?.input as { runRef?: RunRef; reason?: unknown } | undefined;
      if (input === undefined || input === null || typeof input.runRef !== 'object' || input.runRef === null
        || typeof input.reason !== 'string') {
        return { status: 'rejected', code: 'invalid', reason: 'resolve-unknown requires the runRef and a reason' };
      }
      const runRef = input.runRef;
      if (hostInstance === undefined || hostInstance.lease !== 'owned') {
        return { status: 'rejected', code: 'busy', reason: 'this Host does not hold the Host instance lease; only that Host attests (L-1)' };
      }
      const replayed = await runReconcile.replayResolveUnknownRun(ctx, { input: { runRef, reason: input.reason }, meta: request.meta });
      if (replayed !== null) return replayed;
      const read = await executionReader.readExecution(ctx, runRef);
      if (read.status !== 'ready') {
        return read.status === 'rejected' ? read : { status: 'rejected', code: 'not_found', reason: 'the Run is not readable' };
      }
      const record = read.value;
      const admitted = attestationAdmission(request, runRef, record.run.revision,
        record.run.status === 'ended' && record.run.outcome === 'outcome_unknown', 'Run');
      if (admitted !== null) return admitted;
      const auth = record.run.executionAuthorization;
      if (auth === undefined) throw new Error('an unknown-outcome Run has no execution authorization');
      const kernel = auth.kernel;
      const facts = kernel === null
        ? { ok: true as const, kernelTurnOpen: false, inputsConfirmed: null,
            draft: await readUnknownCallReviewDraft({ lookupToolCommit: toolCommitLookup, captureWorkspace }, ctx, { record,
              kernel: { adapterId: '', kernelSessionId: '', runId: '', turnId: '' }, turnFound: false,
              kernelReadable: false, kernelUnreadableAtStop: false, unresolved: [] }) }
        : await readReviewDraftAtEntry({ owner: historyOwner, messages: classifierMessages,
          lookupToolCommit: toolCommitLookup, captureWorkspace }, ctx, { record, kernel,
          startPosition: record.run.executionHistory?.startPosition ?? null });
      if (!facts.ok) return facts.rejection;
      return runReconcile.resolveUnknownRun(ctx, { input: { runRef, reason: input.reason, kernelTurnOpen: facts.kernelTurnOpen,
        inputsConfirmed: facts.inputsConfirmed, review: facts.draft }, meta: request.meta });
    }
    async function resolveUnknownQueryRun(ctx: CoreCallContext, request: GraphWrite<{ queryRunRef: QueryRunRef; reason: string }>,
    ): Promise<WriteResult<QueryExecutionRecord>> {
      if (queryExecution === undefined || queryExecution.resolveUnknownQueryRun === undefined) {
        return { status: 'rejected', code: 'unsupported', reason: 'this Host has no trusted Query binding' };
      }
      const input = request?.input as { queryRunRef?: QueryRunRef; reason?: unknown } | undefined;
      if (input === undefined || input === null || typeof input.queryRunRef !== 'object' || input.queryRunRef === null
        || typeof input.reason !== 'string') {
        return { status: 'rejected', code: 'invalid', reason: 'resolve-unknown requires the queryRunRef and a reason' };
      }
      const queryRunRef = input.queryRunRef;
      if (hostInstance === undefined || hostInstance.lease !== 'owned') {
        return { status: 'rejected', code: 'busy', reason: 'this Host does not hold the Host instance lease; only that Host attests (L-1)' };
      }
      const replayed = await queryExecution.replayResolveUnknownQueryRun?.(ctx,
        { input: { queryRunRef, reason: input.reason }, meta: request.meta }) ?? null;
      if (replayed !== null) return replayed;
      const read = await queryExecution.readQueryExecution(ctx, queryRunRef);
      if (read.status !== 'ready') {
        return read.status === 'rejected' ? read : { status: 'rejected', code: 'not_found', reason: 'the QueryRun is not readable' };
      }
      const state = read.value.run.run.executionState;
      const admitted = attestationAdmission(request, queryRunRef, read.value.run.revision, state?.phase === 'unknown', 'QueryRun');
      if (admitted !== null) return admitted;
      const kernel = state?.entry?.kernel ?? null;
      const facts = kernel === null || state === undefined ? { ok: true as const, kernelTurnOpen: false, inputsConfirmed: null }
        : await readAttestationFacts({ owner: historyOwner, messages: classifierMessages }, ctx, { session: read.value.session,
          executionRef: queryRunRef, kernel, startPosition: state.history?.startPosition ?? null });
      if (!facts.ok) return facts.rejection;
      return queryExecution.resolveUnknownQueryRun(ctx, { input: { queryRunRef, reason: input.reason,
        kernelTurnOpen: facts.kernelTurnOpen, inputsConfirmed: facts.inputsConfirmed }, meta: request.meta });
    }
    // Slice 2C (spec §2, L1b, L13, L15): the ONE line read model, the ONE
    // node-detail read model, the pin write owner and the Host conversation
    // composition. The two `*For` factories build the nested anchor/undelivered
    // readers from the per-line counting wrapper the reader passes in (P12), so
    // their inner reads are counted by the line's history budget. The
    // executed-files port stays today's stub until 2B replaces it (L15); it is
    // the SAME instance the Goal-conflict assembler reads.
    const workLineDeps: WorkLineReaderDeps = {
      records: backend.records,
      dutyFor: (role, callCtx) => sessionDutyResolver(role, callCtx),
      undeliveredRepliesFor: (lineRecords) => {
        const lineMailbox = createSessionMailbox({ ...mailboxDependencies, records: lineRecords });
        return lineMailbox.readUndeliveredReplies?.bind(lineMailbox);
      },
      sessionAnomaliesFor: (lineRecords) => createSessionAnomalyService({
        records: lineRecords, lookups: lineRecords, sessionFacts, now,
      }),
      plans: planService,
      // L8/§3.4: the SAME decision read model the public `decisions` port and
      // the Workflow's `decisionReads` use, so a `waiting_answer` card lands on
      // its line. No second queue implementation exists.
      decisions: rawDecisionReads,
    };
    const workLines: WorkLineReadPort = createWorkLineReader(workLineDeps);
    const nodeDetail: NodeDetailReadPort = createNodeDetailReader({
      records: backend.records,
      plans: planService,
      catalog,
      anomalies: sessionAnomalies,
      executedFiles: goalExecutedFiles,
      line: workLineDeps,
      notes: listNotes,
    });
    const lineSettings: WorkLineSettingsPort = createLineSettingsService({
      records: backend.records,
      sessionRead: sessionDirectory.readSession.bind(sessionDirectory),
      now,
      ...(operatorActor === undefined ? {} : { operatorActor }),
    });
    const workLineConversation = createWorkLineConversation({
      lines: workLines,
      readSessionHistory: (...args) => runtimePort.readSessionHistory(...args),
    });
    // The request commands and the drain over the SAME records, Session owners
    // and trusted duty resolver the platform already publishes. A direct
    // platform that supplies no profile port gets the explicit null answer, never
    // an invented profile.
    const defaultSecretaryProfiles: SecretaryProfilePort = {
      forSession: () => null,
      forNewLine: async () => ({ status: 'ready', value: null }),
    };
    const rawSecretaryProfiles: SecretaryProfilePort = options.secretaryProfiles ?? defaultSecretaryProfiles;
    const rawRequestFacts = createRequestFacts({ records: backend.records });
    const requestSelection = createSecretarySelection({
      records: backend.records,
      sessionFacts,
      profiles: rawSecretaryProfiles,
      scope: createProjectSecretaryScope(),
      duty: sessionDutyResolver,
    });
    const requestCapacity: LineCapacityPort = options.secretaryOpenCap === undefined
      ? createAlwaysAdmitCapacity()
      : createSecretaryOpenCapCapacity({ limit: options.secretaryOpenCap, sessions: sessionDirectory, duty: sessionDutyResolver });
    const requestLineCreation = createLineCreation({
      sessions: sessionOperations, operations: sessionDirectory, capacity: requestCapacity,
    });
    const rawRequestRounds = createRequestRoundService({
      records: backend.records, facts: rawRequestFacts, sessionFacts, duty: sessionDutyResolver,
      profiles: rawSecretaryProfiles, now, operationId: randomUUID,
    });
    const rawRequestIntake = createRequestIntake({
      rounds: rawRequestRounds, facts: rawRequestFacts, selection: requestSelection,
      lineCreation: requestLineCreation, profiles: rawSecretaryProfiles, sessionFacts,
      // No Host driver consumes the request wake yet; the platform drops it.
      wake: () => undefined,
    });
    // The published request owners drain through the same `trackedCall` set as
    // every other owner: `close()` waits for an in-flight request.
    const requestClosed = () =>
      ({ status: 'rejected' as const, code: 'unavailable' as const, reason: 'platform is closing' });
    // `forSession` is a synchronous lookup in the configured list and holds
    // nothing open; `forNewLine` reads the duty resolver, so `close()` waits
    // for it like any other owner call.
    const secretaryProfiles: SecretaryProfilePort = {
      forSession: (input) => rawSecretaryProfiles.forSession(input),
      forNewLine: (ctx, input) => trackedCall(() => rawSecretaryProfiles.forNewLine(ctx, input), requestClosed),
    };
    const requestFacts: RequestFactsReader = {
      readRequest: (ctx, input) => trackedCall(() => rawRequestFacts.readRequest(ctx, input), requestClosed),
      ownerOf: (ctx, input) => trackedCall(() => rawRequestFacts.ownerOf(ctx, input), requestClosed),
      effectiveGoalOf: (ctx, input) => trackedCall(() => rawRequestFacts.effectiveGoalOf(ctx, input), requestClosed),
      readFacts: (ctx, input) => trackedCall(() => rawRequestFacts.readFacts(ctx, input), requestClosed),
    };
    const requestRounds: RequestRoundPort = {
      precheck: (ctx, command) => trackedCall(() => rawRequestRounds.precheck(ctx, command), requestClosed),
      append: (ctx, input) => trackedCall(() => rawRequestRounds.append(ctx, input), requestClosed),
      unassigned: (ctx, scope, input) => trackedCall(() => rawRequestRounds.unassigned(ctx, scope, input), requestClosed),
    };
    const requestIntake: RequestIntakePort = {
      submitRequest: (ctx, input) => trackedCall(() => rawRequestIntake.submitRequest(ctx, input), requestClosed),
      route: (ctx, input) => trackedCall(() => rawRequestIntake.route(ctx, input), requestClosed),
      selectIdea: (ctx, input) => trackedCall(() => rawRequestIntake.selectIdea(ctx, input), requestClosed),
      drainUnassigned: (ctx, scope, input) =>
        trackedCall(() => rawRequestIntake.drainUnassigned(ctx, scope, input), requestClosed),
    };
    let closing: Promise<void> | undefined;
    const platform = {
      goals, plans, claims, executions, sessions, materials, messages, controls, evidence, checks, roles, architecture, projects, completionPolicies,
      queries,
      // K3 (§2 L7): the read-only UnknownCallReview owner, published for the
      // `unknown-call-reviews/read` route (group 3/4 extend it with writes).
      unknownCallReviews,
      // Slice 1 (spec §4.4): the new owner groups the route layer binds. They are
      // the same instances injected into `sessions`, `queries` and the Workflow.
      sessionFacts, responsibilities, sessionAnomalies,
      runActivity, activity, timeline,
      // Slice 4A P2: the note write/read owner; 4C's routes bind to it. It stays
      // non-enumerable like the other internal owner groups.
      notes,
      workspace: workspace.tools, runtime: runtimePort, workflow, kernelStores,
      // Slice 3: the same owner instances the Runtime received; the graph routes
      // read through `graphContext` and a caller could reuse `taskInputs`.
      graphContext, taskInputs,
      // Slice 5 §4.5 platform ports consumed by the frozen route table.
      goalSettings, workspaceDecisionSettings, decisionMessages, decisions, requestCandidates: requestCandidatePort,
      // Slice 2C (spec §2, L13): the line/detail read owners, the pin write
      // owner and the Host conversation. They are internal (non-enumerable).
      workLines, nodeDetail, lineSettings, workLineConversation,
      // The request command owner, its round/facts readers and the Host profile
      // port; internal like the other owner groups.
      requestIntake, requestRounds, requestFacts, secretaryProfiles,
      reconcile,
      /** RUN-22 (U): the operator's attestation through the Host entry; drained like every write. */
      resolveUnknownRun: (...args: Parameters<typeof resolveUnknownRun>) => trackedCall(() => resolveUnknownRun(...args), unavailable),
      /** QRR-06 (U): the same for a QueryRun. */
      resolveUnknownQueryRun: (...args: Parameters<typeof resolveUnknownQueryRun>) =>
        trackedCall(() => resolveUnknownQueryRun(...args), unavailable),
      /** C8 (A.2 step 5.6): the automatic-rework policy this Host installed from its settings (defaults 3 / true). */
      automationPolicy: currentAutomationPolicy,
      /**
       * C8 (A.2 step 5.6, §12.10 step 5): install the Host setting
       * `automation`; read live by the requeue owner, the read model and the
       * start-up re-drive (`resumeOnStartup`). A malformed policy is refused.
       */
      registerAutomationPolicy(policy: TaskAutomationPolicyV1): void {
        if (policy.schemaVersion !== 1 || !Number.isSafeInteger(policy.autoReworkLimit) || policy.autoReworkLimit < 0
          || policy.autoReworkLimit > MAX_AUTO_REWORK_LIMIT || typeof policy.resumeOnStartup !== 'boolean') {
          throw new Error('the automation policy is malformed');
        }
        automationPolicy = { schemaVersion: 1, autoReworkLimit: policy.autoReworkLimit, resumeOnStartup: policy.resumeOnStartup };
      },
      /**
       * Extend the trusted Workflow configuration with one newly opened
       * workspace binding. The existing Workflow reads `deps.configuration`
       * live, so the binding takes effect without a restart; a binding for the
       * exact workspace is upserted and never duplicated or widened.
       */
      /**
       * R6 cold-start narrow seam: register the CURRENT Host-approved trusted
       * checks configuration for exactly one workspace. It only replaces the
       * registration map keyed by that workspace scope; a fresh round opened
       * afterwards resolves it, while every already-open round keeps its own
       * frozen configuration. It grants no model/tool permission of its own.
       */
      registerCheckConfiguration(input: { configuration: TrustedCheckConfiguration }): void {
        registeredCheckConfigurations.set(checkScopeKey(input.configuration.workspace), structuredClone(input.configuration));
      },
      registerWorkflowBinding(input: { consumerId: string; binding: WorkflowHostConfiguration['bindings'][number] }): void {
        const current = workflowDependencies.configuration;
        if (current === undefined) {
          workflowDependencies.configuration = { consumerId: input.consumerId, bindings: [structuredClone(input.binding)] };
          return;
        }
        const bindings = current.bindings as WorkflowHostConfiguration['bindings'][number][];
        const index = bindings.findIndex(existing => existing.workspace.projectId === input.binding.workspace.projectId
          && existing.workspace.workspaceId === input.binding.workspace.workspaceId);
        if (index >= 0) bindings[index] = structuredClone(input.binding);
        else bindings.push(structuredClone(input.binding));
      },
      /** L8: the Host's detached-work seam for the one auto-capture driver. The
       * promise joins the close drain; the Host installs it before close. */
      trackDetached,
      close(): Promise<void> {
        isClosing = true;
        closing ??= (async () => {
          await Promise.allSettled([...pending]);
          try { await workspace.close(); }
          finally {
            try { await closeBodies?.(); }
            finally { await backend.close(); }
          }
        })();
        return closing;
      },
    };
    // Slice 1 R4 (spec §4.4): the route layer reads these three owner groups by
    // property (`platform.sessionFacts`, ...), but the spec does not add them to
    // the public composition surface. They stay reachable and are the SAME
    // instances injected into `sessions`, `queries` and the Workflow, but are
    // not part of the enumerable public keys the frozen composition test checks.
    // Slice 3 (spec §4.6: create-platform adds `graphContext` and `taskInputs` as
    // internal owners) follows the same rule (integration fix).
    // Slice 5 (rebase, lead): the five decision ports the route table reads are
    // internal owners by the same rule; the frozen public key list stays exact.
    for (const key of ['sessionFacts', 'responsibilities', 'sessionAnomalies', 'graphContext', 'taskInputs',
      'goalSettings', 'workspaceDecisionSettings', 'decisionMessages', 'decisions', 'requestCandidates',
      'runActivity', 'activity', 'timeline',
      'workLines', 'workLineConversation', 'nodeDetail', 'lineSettings', 'notes', 'trackDetached',
      'requestIntake', 'requestRounds', 'requestFacts', 'secretaryProfiles'] as const) {
      Object.defineProperty(platform, key, { enumerable: false });
    }
    return platform;
  } catch (error) {
    // Close every owned resource while preserving the initialization error.
    try { await closeBodies?.(); } catch { /* keep original error */ }
    try { await rawBackend.close(); } catch { /* keep original error */ }
    throw error;
  }
}
