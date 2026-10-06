import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import { createInMemoryRecordBackend } from '../core/record-store/in-memory-record-store.js';
import { createSqliteRecordBackend } from '../core/record-store/sqlite-record-store.js';
import { RawArtifactBodyStore } from '../core/record-store/body-store.js';
import { createSqliteRawArtifactStore } from '../core/record-store/sqlite-body-store.js';
import { createGoalService } from '../core/work-graph/tasks/task-service.js';
import type { GoalTaskPort, GraphWrite } from '../core/work-graph/tasks/contracts.js';
import { COMPLETION_RECORD_SCHEMAS } from '../core/work-graph/tasks/completion-record-codecs.js';
import { createMaterialRecordReaders, materialRecordSchemas } from '../core/work-graph/materials/record-readers.js';
import { createMaterialAccessResolver } from '../core/work-graph/materials/applicability.js';
import { createMaterialService } from '../core/work-graph/materials/material-service.js';
import { createMaterialGrantService } from '../core/work-graph/materials/grant-service.js';
import { createMaterialReadFactsService } from '../core/work-graph/materials/material-facts-service.js';
import type { MaterialGrantPort } from '../core/work-graph/materials/grant-contracts.js';
import type { MaterialPort } from '../core/work-graph/materials/contracts.js';
import { MATERIAL_GRANT_EVENT_SCHEMAS } from '../core/work-graph/materials/grant-record-codecs.js';
import { createWorkspaceAccessFactory, type WorkspaceHostBindings } from '../core/workspace/access.js';
import { createMaterialSourceProvider } from '../core/workspace/material-source-provider.js';
import { createWorkspaceTools, DEFAULT_WORKSPACE_LIMITS } from '../core/workspace/workspace-tools.js';
import { createAgentRuntime } from '../core/agent-runtime/runtime.js';
import { createExecutionEntryService } from '../core/work-graph/tasks/execution-entry-service.js';
import { createTaskCarriedUnchanged } from '../core/work-graph/tasks/entry-plan-reader.js';
import { createModelCallService } from '../core/work-graph/tasks/model-call-service.js';
import { createSessionMailbox } from '../core/work-graph/communication/mailbox-service.js';
import type { SessionMailboxPort } from '../core/work-graph/communication/contracts.js';
import { SESSION_MESSAGE_RECORD_SCHEMAS } from '../core/work-graph/communication/message-record-codecs.js';
import { createSourceAuthorityReader } from '../core/work-graph/source-authority-reader.js';
import { createWorkflow } from '../business/workflow/workflow.js';
import type { WorkflowDependencies, WorkflowHostConfiguration, WorkflowPort } from '../business/workflow/ports.js';

import { createEvidenceService } from '../core/work-graph/evidence/evidence-service.js';
import { EVIDENCE_RECORD_SCHEMAS } from '../core/work-graph/evidence/evidence-record-codecs.js';
import type { EvidencePort } from '../core/work-graph/evidence/contracts.js';
import { VerificationWorkspaceReader } from '../core/workspace/verification-workspace-reader.js';
import { createRegisteredCheckRunner, type RegisteredCheckRunner } from '../core/agent-runtime/check-execution.js';
import type { TrustedCheckConfiguration } from '../contracts/verification.js';

import { createExecutionHistoryService } from '../core/work-graph/tasks/execution-history-service.js';
import { EXECUTION_HISTORY_RECORD_SCHEMAS } from '../core/work-graph/persistence/execution-history-codecs.js';
import { EXECUTION_ENTRY_RECORD_SCHEMAS } from '../core/work-graph/persistence/execution-entry-codecs.js';
import { MODEL_REQUEST_RECORD_SCHEMAS } from '../core/work-graph/persistence/model-request-codecs.js';
import { createRunControlService } from '../core/work-graph/tasks/control-service.js';
import type { RunControlPort } from '../core/work-graph/tasks/control-contracts.js';
import { CONTROL_RECORD_SCHEMAS } from '../core/work-graph/persistence/control-record-codecs.js';
import type { ExecutionHistoryWritePort } from '../core/work-graph/tasks/execution-history-contracts.js';
import { createGraphExecutionHistoryReader } from '../core/agent-runtime/graph-execution-history.js';
import { createRunStateReader } from '../core/work-graph/tasks/run-state-service.js';
import type { ExecutionReadPort } from '../core/work-graph/tasks/execution-read-contracts.js';
import { createExecutionHistoryReader } from '../core/agent-runtime/observation-recovery.js';
import { createTaskClaimService } from '../core/work-graph/tasks/claim-service.js';
import { createTaskRequeueService } from '../core/work-graph/tasks/requeue-service.js';
import { TASK_CLAIM_RECORD_SCHEMAS } from '../core/work-graph/tasks/claim-record-codecs.js';
import type { TaskClaimPort } from '../core/work-graph/tasks/claim-contracts.js';
import type { RoleConfigurationPort } from '../core/work-graph/configuration/contracts.js';
import { createPlanService } from '../core/work-graph/tasks/plan-service.js';
import { PLAN_RECORD_SCHEMAS } from '../core/work-graph/tasks/plan-record-codecs.js';
import { PLAN_STATE_RECORD_SCHEMAS, PLAN_GOVERNANCE_RECORD_SCHEMAS } from '../core/work-graph/tasks/plan-readers.js';
import { createSessionDirectory } from '../core/work-graph/sessions/session-directory.js';
import type { SessionDirectoryPort } from '../core/work-graph/sessions/contracts.js';
import { SESSION_RECORD_SCHEMAS } from '../core/work-graph/sessions/session-record-codecs.js';
import { createSessionLifecycleService } from '../core/work-graph/sessions/session-lifecycle.js';
import type { SessionLifecyclePort } from '../core/work-graph/sessions/lifecycle-contracts.js';
import { SESSION_LIFECYCLE_RECORD_SCHEMAS } from '../core/work-graph/sessions/lifecycle-record-codecs.js';
import { createKernelStoreRegistry } from '../core/agent-runtime/kernel-store-locator.js';
import { createSessionHistoryCursorOwner, createSessionOperations } from '../core/agent-runtime/session-operations.js';
import type { CoreCallContext } from '../contracts/core/call-context.js';
import type { SessionRef } from '../contracts/core/identity.js';
import type { CoreRejection, ReadResult } from '../contracts/core/results.js';
import type { VersionPin } from '../contracts/core/identity.js';
import { canonicalJson, type JsonValue } from '../contracts/fingerprint.js';
import type { MaterialSourceScope } from '../contracts/material-access.js';
import type { RuntimeCapabilities } from '../core/agent-runtime/contracts.js';
import type { RuntimeExecutionDependencies, RuntimeHostBindings } from '../core/agent-runtime/execution-contracts.js';
import type {
  AuthorizeConfiguration, ExecutionEntryDependencies, ExecutionEntryPort,
} from '../core/work-graph/tasks/execution-entry-contracts.js';
import { createRoleConfigurationService } from '../core/work-graph/configuration/role-memory-service.js';
import { ROLE_RECORD_SCHEMAS } from '../core/work-graph/configuration/role-record-codecs.js';
import { createProjectBootstrapServices } from '../core/work-graph/configuration/project-bootstrap-service.js';
import { createQueryExecution } from '../core/work-graph/queries/query-execution.js';
import { projectQueryConfiguration } from '../core/agent-runtime/query-preparation.js';
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
import type { HostInstanceFacts } from '../core/work-graph/tasks/execution-entry-contracts.js';
import { createRunReconcileService } from '../core/work-graph/tasks/run-reconcile-service.js';
import type { RunReconcilePort } from '../core/work-graph/tasks/run-reconcile-contracts.js';
import { createReconcileCandidateReader } from '../core/work-graph/tasks/reconcile-reads.js';
import { createSessionHealthService } from '../core/work-graph/sessions/session-health.js';
import {
  readAttestationFacts, reconcileQueryRunAtStartup, reconcileRunAtStartup, reconcileRunControlsAtStartup,
} from '../core/agent-runtime/run-reconcile.js';
import type { SessionMappingProbe } from '../core/agent-runtime/session-operations.js';
import type { TaskExecutionRecord } from '../core/work-graph/tasks/execution-read-contracts.js';
import type { QueryExecutionRecord } from '../core/work-graph/queries/contracts.js';
import type { RunRef, RunSnapshot } from '../contracts/dispatch.js';
import type { QueryRunRef } from '../contracts/query-job.js';
import type { WriteResult } from '../contracts/core/results.js';
import {
  DEFAULT_TASK_AUTOMATION_POLICY, MAX_AUTO_REWORK_LIMIT, type TaskAutomationPolicyV1,
} from '../contracts/task-requeue.js';

export type TargetPlatformOptions = {
  storage: { kind: 'memory' } | { kind: 'sqlite'; directory: string };
  workspace: WorkspaceHostBindings;
  now?: () => string;
  /** Trusted source route; defaults to TypeScript at tsconfig.json. No language inference. */
  architectureSource?: { provider: 'typescript'; configPath: string };
  /** Trusted startup configuration; never taken from a model tool request. */
  kernelStores?: Parameters<typeof createKernelStoreRegistry>[0];
  /** Trusted Host execution binding. Its model/tool/template grant is the only
   * production execution route; a caller cannot supply a client, root, hook,
   * permission or database here. When absent, execution stays explicitly
   * unsupported while Session creation/history keep their accepted behavior. */
  runtime?: RuntimeHostBindings;
  /** Trusted per-workspace source policy, consumed by the existing source factories. */
  sourcePolicyFor?: RuntimeExecutionDependencies['sourcePolicyFor'];
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
};

/** The composition-owned service identity. It is used only to execute trusted
 * platform material reads and mailbox body storage; it never replaces the real
 * command actor/sender. */
const SYSTEM_ACTOR = Object.freeze({ kind: 'system' as const, id: 'platform-composition-host' });

function contextForScope(scope: MaterialSourceScope, signal: AbortSignal): CoreCallContext {
  return {
    projectId: scope.projectId,
    workspaceId: scope.workspaceId,
    principal: { kind: 'host', actor: { ...SYSTEM_ACTOR } },
    materialReader: { kind: 'host', projectId: scope.projectId, workspaceId: scope.workspaceId, actor: { ...SYSTEM_ACTOR } },
    signal,
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  try { return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue); } catch { return false; }
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
 * Task has the automation verdict requeue or claim_requeued; 5.9 adds reverify
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
      + 'Turn in that Session: the original Session becomes unavailable (kernel_turn_open, its history stays '
      + 'readable) and the continuation is a new Run in a new Session that continues the original Session\'s last '
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
      + 'is a new Run with a continuation brief, in a new Session that continues the original Session\'s last '
      + 'completed history. After the reconciliation the Host starts the existing collaboration driver for each '
      + 'active Goal with work to advance automatically: a required active Task whose automation verdict is '
      + 'requeue or claim_requeued, or a Run that never entered and is not paused or cancelled, whose same claim '
      + 'is then driven again; this start-up re-drive follows the Host setting automation.resumeOnStartup (on by '
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
      + 'restart, which is not a failure: only a person continues it (a new continuation Run in a new '
      + 'Session), never automatically, or, when the pause came from the Goal, resuming the Goal continues it. '
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
    const ceiling = resolution.status === 'resolved' ? resolution.spec.permissions : null;
    if (permissions.policyRevision !== input.run.roleBinding.policyRevision
      || !permissions.tools.every(tool => current.tools.includes(tool) && (ceiling === null || ceiling.tools.includes(tool)))
      || !permissions.writeScope.every(path => current.writeScope.includes(path))
      || (ceiling?.writeScope === 'none' && permissions.writeScope.length !== 0)
      || (permissions.tools.includes('shell') && (current.shellWorkspaceAccess !== 'all_except_denied'
        || permissions.writeScope.length !== 1 || permissions.writeScope[0] !== '.'))) {
      return { status: 'rejected', code: 'forbidden', reason: 'the prepared permissions are not allowed by the current Host and Role ceilings' };
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
    if (execution === undefined) {
      return { status: 'rejected', code: 'unsupported', reason: 'the QueryJob has no explicit read-only execution binding' };
    }
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

/** Trusted local composition root. Old Ledger/Index/Vault instances cannot be
 * supplied. No business bootstrap/claim API is invented by the storage factory. */
export async function createTargetPlatform(options: TargetPlatformOptions) {
  const now = options.now ?? (() => new Date().toISOString());
  const hostInstance: HostInstanceFacts | undefined = options.hostInstance === undefined ? undefined
    : { hostInstanceId: options.hostInstance.hostInstanceId, lease: options.hostInstance.lease };
  // C8 (A.2 step 5.6): the Host-installed automatic-rework policy; the defaults (3 / true) until the
  // Host installs its settings (`registerAutomationPolicy`). Read live by the requeue owner and the read model.
  let automationPolicy: TaskAutomationPolicyV1 = { ...DEFAULT_TASK_AUTOMATION_POLICY };
  const currentAutomationPolicy = (): TaskAutomationPolicyV1 => ({ ...automationPolicy });
  const materialsSchema = materialRecordSchemas();
  const schemas = {
    records: [...materialsSchema.records, ...PLAN_RECORD_SCHEMAS.records, ...PLAN_STATE_RECORD_SCHEMAS.records,
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.records, ...SESSION_RECORD_SCHEMAS.records, ...SESSION_LIFECYCLE_RECORD_SCHEMAS.records,
      ...ROLE_RECORD_SCHEMAS.records, ...OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.records,
      ...ARCHITECTURE_CATALOG_SCHEMAS.records, ...TASK_CLAIM_RECORD_SCHEMAS.records,
      ...EXECUTION_ENTRY_RECORD_SCHEMAS.records, ...MODEL_REQUEST_RECORD_SCHEMAS.records,
      ...SESSION_MESSAGE_RECORD_SCHEMAS.records, ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.records,
      ...CONTROL_RECORD_SCHEMAS.records, ...EVIDENCE_RECORD_SCHEMAS.records, ...QUERY_JOB_RECORD_SCHEMAS.records,
      ...COMPLETION_RECORD_SCHEMAS.records],
    events: [...materialsSchema.events, ...PLAN_RECORD_SCHEMAS.events, ...PLAN_STATE_RECORD_SCHEMAS.events,
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.events, ...SESSION_RECORD_SCHEMAS.events, ...SESSION_LIFECYCLE_RECORD_SCHEMAS.events,
      ...ROLE_RECORD_SCHEMAS.events, ...OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.events, ...ARCHITECTURE_CATALOG_SCHEMAS.events,
      ...TASK_CLAIM_RECORD_SCHEMAS.events, ...EXECUTION_HISTORY_RECORD_SCHEMAS.events,
      ...EXECUTION_ENTRY_RECORD_SCHEMAS.events, ...MODEL_REQUEST_RECORD_SCHEMAS.events,
      ...SESSION_MESSAGE_RECORD_SCHEMAS.events, ...MATERIAL_GRANT_EVENT_SCHEMAS,
      ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.events, ...CONTROL_RECORD_SCHEMAS.events, ...EVIDENCE_RECORD_SCHEMAS.events, ...QUERY_JOB_RECORD_SCHEMAS.events,
      ...COMPLETION_RECORD_SCHEMAS.events],
    lookups: [...materialsSchema.lookups ?? [], ...PLAN_RECORD_SCHEMAS.lookups ?? [], ...PLAN_STATE_RECORD_SCHEMAS.lookups ?? [],
      ...PLAN_GOVERNANCE_RECORD_SCHEMAS.lookups ?? [], ...SESSION_RECORD_SCHEMAS.lookups ?? [],
      ...SESSION_LIFECYCLE_RECORD_SCHEMAS.lookups ?? [], ...ROLE_RECORD_SCHEMAS.lookups ?? [],
      ...OBSERVED_ARCHITECTURE_RECORD_SCHEMAS.lookups ?? [], ...ARCHITECTURE_CATALOG_SCHEMAS.lookups ?? [],
      ...TASK_CLAIM_RECORD_SCHEMAS.lookups ?? [], ...EXECUTION_ENTRY_RECORD_SCHEMAS.lookups ?? [],
      ...MODEL_REQUEST_RECORD_SCHEMAS.lookups ?? [], ...SESSION_MESSAGE_RECORD_SCHEMAS.lookups ?? [],
      ...PROJECT_BOOTSTRAP_RECORD_SCHEMAS.lookups ?? [], ...CONTROL_RECORD_SCHEMAS.lookups ?? [], ...EVIDENCE_RECORD_SCHEMAS.lookups ?? [], ...QUERY_JOB_RECORD_SCHEMAS.lookups ?? [],
      ...COMPLETION_RECORD_SCHEMAS.lookups ?? []],
  };
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
    // The one Workspace source capability is constructed early so the material
    // reader/writer and the grant writer share the exact same trusted provider.
    const access = createWorkspaceAccessFactory(options.workspace);
    const source = createMaterialSourceProvider({ access, contextForScope });
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
    // LA-2 (A.2 step 5.4b): ONE `tasks/` predicate tells the grant writer, the
    // read-side resolver and the M2 facts below whether the Goal's active Plan
    // carries a reader Run's Task unchanged from its claim Plan (materials never
    // reads a PlanRevision itself; W3 uses the same rule).
    const isTaskCarriedUnchanged = createTaskCarriedUnchanged(backend.records);
    const grants = createMaterialAccessResolver(reads.authority, reads.index, source, isTaskCarriedUnchanged);
    const rawMaterials = createMaterialService({ bodies, authority: reads.authority, grants, now });
    const grantService = createMaterialGrantService({ records: backend.records, authority: reads.authority,
      materials: rawMaterials, source, isTaskCarriedUnchanged, now, eventId: randomUUID });
    const rawGoals = createGoalService({ records: backend.records, now, eventId: randomUUID }).tasks;
    const workspace = createWorkspaceTools({ access,
      now, limits: DEFAULT_WORKSPACE_LIMITS });
    const roleService = createRoleConfigurationService({ records: backend.records, now, eventId: randomUUID });
    const bootstrap = createProjectBootstrapServices({ records: backend.records, now, eventId: randomUUID });
    const authorizeConfiguration = options.runtime === undefined
      ? undefined : createAuthorizeConfiguration(options.runtime);
    const sessionDirectory = createSessionDirectory({ records: backend.records, lookups: backend.records });
    // The public mailbox is real even without a model Host binding; internal
    // calls use the raw service so an in-flight operation is never rejected by
    // the public tracked wrapper after close has already begun. It is built
    // BEFORE the Query jobs so a consultation submit can use its read-only
    // message seam; no second mailbox/service instance exists.
    const mailbox = createSessionMailbox({ records: backend.records, sessions: sessionDirectory,
      executions: executionReader, roles: roleService, materials: rawMaterials,
      systemActor: SYSTEM_ACTOR, now, newId: randomUUID,
      ...(authorizeConfiguration === undefined ? {} : { runtimeAdmission: { bodies, authorizeConfiguration } }) });
    // R5b.2: the ONE internal Query writer shares this records/roles/bodies
    // instance. It is injected into the QueryJob claim/read adapter and the
    // Runtime thin path, never published as a public terminal port. Without a
    // trusted Runtime Host binding there is no Query Host projection, so the new
    // Query methods stay unsupported while pending submit/read is unchanged.
    const queryExecution = options.runtime === undefined ? undefined : createQueryExecution({
      records: backend.records, roles: roleService, bodies,
      authorizeConfiguration: createAuthorizeQueryConfiguration(options.runtime),
      now, eventId: randomUUID, ...(hostInstance === undefined ? {} : { hostInstance }),
    });
    const queryJobs = createQueryJobService({
      records: backend.records, now, eventId: randomUUID,
      ...(queryExecution === undefined ? {} : { execution: queryExecution }),
      consultations: { readMessage: mailbox.readMessage.bind(mailbox), readMessageBody: mailbox.readMessageBody.bind(mailbox) },
    });
    const observed = createObservedArchitecture({ records: backend.records, bodies, access, workspace: workspace.tools,
      source: options.architectureSource ?? { provider: 'typescript', configPath: 'tsconfig.json' } });
    const catalog = createArchitectureCatalogService({ records: backend.records });
    const planService = createPlanService({ records: backend.records, materials: rawMaterials, now, eventId: randomUUID,
      automationPolicy: currentAutomationPolicy,
      // R5b.4: the SAME raw body store already owned by the composition root.
      initialPlanning: { bodies },
      ...(authorizeConfiguration === undefined ? {} : {
        delegatedWrites: { reads: executionReader, roles: roleService, bodies, authorizeConfiguration },
      }) });
    const claimService = createTaskClaimService({ records: backend.records, roles: roleService,
      now, newId: randomUUID });
    // The ONE verification workspace reader: the evidence owner captures rounds
    // with it and the requeue owner takes its digest-only source (LA-5).
    const verificationWorkspaceReader = new VerificationWorkspaceReader();
    // A.2 step 5.4 (D-3, C1): the requeue owner shares the records, the WG11
    // reader, the material service, the mailbox (a new input message is read
    // under its reader rules, ND-9) and the delegated-write admission.
    const requeueService = createTaskRequeueService({ records: backend.records, reads: executionReader,
      workspaceHost: options.workspace, source: verificationWorkspaceReader, materials: rawMaterials,
      messages: { readMessage: mailbox.readMessage.bind(mailbox) },
      ...(authorizeConfiguration === undefined ? {} : {
        delegatedWrites: { reads: executionReader, roles: roleService, bodies, authorizeConfiguration },
      }),
      automationPolicy: currentAutomationPolicy,
      now, eventId: randomUUID });
    const sessionLifecycle = createSessionLifecycleService({ records: backend.records, lookups: backend.records });
    const kernelStores = await createKernelStoreRegistry(options.kernelStores ?? { entries: [] });
    // Internal calls retain the raw directory. The outer Runtime operation is
    // drained once as a whole, so close cannot reject its later registration.
    const sessionOperations = createSessionOperations({ sessions: sessionDirectory, kernelStores });
    const executionHistory = createExecutionHistoryReader({ history: sessionOperations });
    const historyWriter = createExecutionHistoryService({ records: backend.records, now, eventId: randomUUID });
    const graphHistory = createGraphExecutionHistoryReader({ executions: executionReader, history: executionHistory });
    const sourceAuthority = createSourceAuthorityReader({ authority: reads.authority, records: backend.records });
    // C2 §3.1: the SAME reads/source/bodies feed the M2 material read-facts seam
    // consumed by the B2 entry and model barriers. It is a fresh per-call
    // observer, not a second persistent material service.
    const materialFacts = createMaterialReadFactsService({ authority: reads.authority, index: reads.index,
      bodies, sourceApplicability: source, isTaskCarriedUnchanged, now });
    // R3e.1: the ONE trusted verification/evidence service and its thin Host
    // check runner share the existing records/material/execution instances. The
    // frozen checks configuration is optional; without it fresh open/begin stay
    // unsupported while existing history reads/receipts keep their behavior.
    // R6 cold-start: the live per-workspace trusted checks configuration the
    // Host registers after an explicit user approval. It is read by a FRESH
    // round only; an already-open round keeps the configuration it froze. The
    // legacy static `options.checks` remains a compatible same-scope fallback.
    const registeredCheckConfigurations = new Map<string, TrustedCheckConfiguration>();
    const checkScopeKey = (scope: { projectId: string; workspaceId: string }): string =>
      `${scope.projectId}\u0000${scope.workspaceId}`;
    const rawEvidence = createEvidenceService({
      records: backend.records, materials: rawMaterials, materialFacts, executions: executionReader,
      workspaceHost: options.workspace, source: verificationWorkspaceReader,
      ...(options.checks === undefined ? {} : { configuration: options.checks }),
      configurationFor: (scope) => registeredCheckConfigurations.get(checkScopeKey(scope))
        ?? (options.checks !== undefined
          && options.checks.workspace.projectId === scope.projectId
          && options.checks.workspace.workspaceId === scope.workspaceId
          ? options.checks : undefined),
      ...(hostInstance === undefined ? {} : { hostInstance }),
      now, newId: randomUUID,
    });
    const rawCheckRunner = createRegisteredCheckRunner({ evidence: rawEvidence,
      workspaceHost: options.workspace, kernel, now });
    // A.2 step 5.6 (S8, A8): the reconcile owners share the ONE records/reader pair; the Runtime
    // classifier reads the Kernel through the same history owner the observer uses.
    const runReconcile: RunReconcilePort = createRunReconcileService({ records: backend.records, reads: executionReader,
      ...(hostInstance === undefined ? {} : { hostInstance }), now, eventId: randomUUID });
    const sessionHealth = createSessionHealthService({ records: backend.records,
      ...(hostInstance === undefined ? {} : { hostInstance }), now, eventId: randomUUID });
    const reconcileCandidates = createReconcileCandidateReader({ records: backend.records });
    const historyOwner = createSessionHistoryCursorOwner({ kernelStores });
    let resultWriter: Pick<ExecutionEntryPort, 'recordRunResult'> | undefined;
    let runtime = createAgentRuntime();
    if (options.runtime !== undefined) {
      const host = options.runtime;
      // The hoisted optional instance is guaranteed present by `options.runtime`.
      const entryAuthorizeConfiguration = authorizeConfiguration as AuthorizeConfiguration;
      const entryDependencies: ExecutionEntryDependencies = {
        records: backend.records, reads: executionReader, roles: roleService, plans: planService,
        materials: rawMaterials, materialFacts, bodies, authorizeConfiguration: entryAuthorizeConfiguration,
        ...(hostInstance === undefined ? {} : { hostInstance }),
        now, eventId: randomUUID, newId: randomUUID,
      };
      const entry = createExecutionEntryService(entryDependencies);
      resultWriter = entry;
      const modelRequests = createModelCallService(entryDependencies);
      const dependencies: RuntimeExecutionDependencies = {
        claims: claimService, executions: executionReader, entry, historyWriter, modelRequests,
        roles: roleService, plans: planService, messages: mailbox, sessions: sessionDirectory,
        materials: rawMaterials, bodies, activity: executionHistory, graphHistory, sessionOperations,
        // R4.3a: the SAME raw control service `platform.controls` wraps. The
        // Runtime gets the internal observation writer intersection while the
        // public surface still publishes only submit/read.
        controls: rawControls,
        kernelStores, workspaceHost: options.workspace, sourceAuthority: () => sourceAuthority,
        ...(options.sourcePolicyFor === undefined ? {} : { sourcePolicyFor: options.sourcePolicyFor }),
        ...(queryExecution === undefined ? {} : { queryExecution }),
        // C3: the continuation brief's checkpoint uses the SAME workspace reader as the evidence owner.
        workspaceSource: verificationWorkspaceReader,
        // A.2 step 5.6: the in-process ends without a Kernel terminal (RUN-16, RUN-23).
        runReconcile,
        host, kernel, now, newId: randomUUID,
      };
      runtime = createAgentRuntime(dependencies);
    }
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
    const unavailable = (): CoreRejection => ({ status: 'rejected', code: 'unavailable', reason: 'platform is closing' });
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
    const sessions: SessionDirectoryPort & SessionLifecyclePort = {
      admitSessionCreation: (...args) => trackedCall(() => sessionDirectory.admitSessionCreation(...args), unavailable),
      recordSessionCreated: (...args) => trackedCall(() => sessionDirectory.recordSessionCreated(...args), unavailable),
      getSessionOperation: (...args) => trackedCall(() => sessionDirectory.getSessionOperation(...args), unavailable),
      readSession: (...args) => trackedCall(() => sessionDirectory.readSession(...args), unavailable),
      findSessions: (...args) => trackedCall(() => sessionDirectory.findSessions(...args), unavailable),
      linkSessionWork: (...args) => trackedCall(() => sessionLifecycle.linkSessionWork(...args), unavailable),
      archiveSession: (...args) => trackedCall(() => sessionLifecycle.archiveSession(...args), unavailable),
      reactivateSession: (...args) => trackedCall(() => sessionLifecycle.reactivateSession(...args), unavailable),
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
      readTaskClaim: (...args) => trackedCall(() => claimService.readTaskClaim(...args), unavailable),
      requeueTask: (...args) => trackedCall(() => requeueService.requeueTask(...args), unavailable),
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
      queryArchitecture: (...args) => trackedCall(() => observed.queryArchitecture(...args), unavailable),
      compareArchitecture: (...args) => trackedCall(() => observed.compareArchitecture(...args), unavailable),
      queryImpact: (...args) => trackedCall(() => observed.queryImpact(...args), unavailable),
      adoptInitialArchitecture: (...args) => trackedCall(() => catalog.adoptInitialArchitecture(...args), unavailable),
      reviseArchitectureCatalog: (...args) => trackedCall(() => catalog.reviseArchitectureCatalog(...args), unavailable),
      readArchitectureRevision: (...args) => trackedCall(() => catalog.readArchitectureRevision(...args), unavailable),
    };
    // Explicit task-input reads span the ledger and material store. Drain them
    // before closing either store, preserving the service's synchronous input snapshot.
    const plans: typeof planService = {
      ...planService,
      readTaskInput: (...args) => trackedCall(() => planService.readTaskInput(...args), unavailable),
      proposeInitialPlanFromAnswer: (...args) =>
        trackedCall(() => planService.proposeInitialPlanFromAnswer(...args), unavailable),
      queryGoalDisplay: (...args) => trackedCall(() => planService.queryGoalDisplay(...args), unavailable),
      queryGoalLiveRuns: (...args) => trackedCall(() => planService.queryGoalLiveRuns(...args), unavailable),
    };
    // The public material chain spans the ledger, bodies and source I/O, so the
    // whole outer call is drained before any owned store closes. The in-flight
    // service keeps the raw materials/grant instances, never these wrappers.
    const materials: MaterialPort & MaterialGrantPort = {
      storeArtifact: (...args) => trackedCall(() => rawMaterials.storeArtifact(...args), unavailable),
      openArtifact: (...args) => trackedCall(() => rawMaterials.openArtifact(...args), unavailable),
      grantMaterialAccess: (...args) => trackedCall(() => grantService.grantMaterialAccess(...args), unavailable),
      revokeMaterialAccess: (...args) => trackedCall(() => grantService.revokeMaterialAccess(...args), unavailable),
    };
    const messages: SessionMailboxPort & Required<Pick<SessionMailboxPort, 'readOutbox'>> = {
      sendMessage: (...args) => trackedCall(() => mailbox.sendMessage(...args), unavailable),
      readMessage: (...args) => trackedCall(() => mailbox.readMessage(...args), unavailable),
      readMessageBody: (...args) => trackedCall(() => mailbox.readMessageBody(...args), unavailable),
      readInbox: (...args) => trackedCall(() => mailbox.readInbox(...args), unavailable),
      readOutbox: (...args) => trackedCall(() => mailbox.readOutbox(...args), unavailable),
      ackMessage: (...args) => trackedCall(() => mailbox.ackMessage(...args), unavailable),
      respondMessage: (...args) => trackedCall(() => mailbox.respondMessage(...args), unavailable),
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
      submitEvidence: (...args) => trackedCall(() => rawEvidence.submitEvidence(...args), unavailable),
      finalizeChecks: (...args) => trackedCall(() => rawEvidence.finalizeChecks(...args), unavailable),
    };
    const checks: RegisteredCheckRunner = {
      runRegisteredCheck: (...args) => trackedCall(() => rawCheckRunner.runRegisteredCheck(...args), unavailable),
    };
    const runtimePort = {
      ...runtime.port,
      async capabilities(...args: Parameters<typeof runtime.port.capabilities>): Promise<ReadResult<RuntimeCapabilities>> {
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
      async readCompletedBoundary(ctx: CoreCallContext, request: { sessionRef: SessionRef }): Promise<ReadResult<{ cursor: string | null; position: number }>> {
        if (isClosing) return { status: 'rejected', code: 'unavailable', reason: 'platform is closing' };
        if (ctx.principal.kind !== 'host') return { status: 'rejected', code: 'forbidden', reason: 'the completed boundary read requires the Host principal' };
        if (request.sessionRef.projectId !== ctx.projectId) return { status: 'rejected', code: 'forbidden', reason: 'the Session belongs to another project' };
        const read = await sessionDirectory.readSession(ctx, request.sessionRef);
        if (read.status !== 'ready') return read;
        const owner = createSessionHistoryCursorOwner({ kernelStores });
        const boundary = await owner.completedBoundary({ session: read.value.record, signal: ctx.signal });
        if (boundary.status !== 'resolved') {
          return { status: 'rejected', code: boundary.code, reason: boundary.reason };
        }
        return { status: 'ready', value: { cursor: boundary.cursor, position: boundary.position } };
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
      readSessionHistory: (...args: Parameters<typeof sessionOperations.readSessionHistory>) =>
        sessionOperations.readSessionHistory(...args),
      readTaskExecutionHistory: (...args: Parameters<typeof graphHistory.readTaskExecutionHistory>) =>
        graphHistory.readTaskExecutionHistory(...args),
      readExecutionHistory: (...args: Parameters<typeof executionHistory.readExecutionHistory>) =>
        executionHistory.readExecutionHistory(...args),
    };
    const workflowConfiguration = options.workflow === undefined
      ? undefined : structuredClone(options.workflow);
    const workflowDependencies: WorkflowDependencies = {
      tasks: rawGoals, plans: planService, sessions: sessionDirectory,
      claims: { ...claimService, requeueTask: requeueService.requeueTask },
      executions: executionReader, runtime: rawRuntime, evidence: rawEvidence, checks: rawCheckRunner,
      sourceAuthority,
      ...(workflowConfiguration === undefined ? {} : { configuration: workflowConfiguration }),
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
    };
    const rawWorkflow = createWorkflow(workflowDependencies);
    // The public advancement port drains the complete call before any owned
    // store closes; the in-flight raw workflow keeps the raw owner instances.
    const workflow: WorkflowPort & Required<Pick<WorkflowPort, 'consumeConsultation'>> = {
      handleGoalInput: (...args) => trackedCall(() => rawWorkflow.handleGoalInput(...args), unavailable),
      advanceWork: (...args) => trackedCall(() => rawWorkflow.advanceWork(...args), unavailable),
      consumeConsultation: (...args) => trackedCall(() => rawWorkflow.consumeConsultation(...args), unavailable),
    };
    // A.2 step 5.6 (§12.1): the start-up reconcile's internal seam. Only the Host
    // that holds the instance lease calls it, before any execution driver starts;
    // every write is judged by its owner machine (R events need `owned`).
    const classifierMessages = mailbox;
    const reconcile = {
      candidates: reconcileCandidates,
      probe: (session: Parameters<typeof historyOwner.probe>[0]['session'], signal: AbortSignal): Promise<SessionMappingProbe> =>
        trackedCall(() => historyOwner.probe({ session, signal }),
          () => ({ verdict: 'cancelled' as const, activeRunId: null, reason: 'platform is closing' })),
      recordSessionHealth: (...args: Parameters<typeof sessionHealth.recordSessionHealth>) =>
        trackedCall(() => sessionHealth.recordSessionHealth(...args), unavailable),
      reconcileRun: (ctx: CoreCallContext, input: { record: TaskExecutionRecord; hostInstanceId: string; probe: SessionMappingProbe }) =>
        trackedCall(async () => {
          if (resultWriter === undefined) {
            return { runRef: input.record.run.ref, row: 'W-*', status: 'left' as const,
              reason: 'this Host has no trusted Runtime binding to read the Kernel' };
          }
          return reconcileRunAtStartup({ owner: historyOwner, messages: classifierMessages, controls: rawControls,
            entry: resultWriter, reconcile: runReconcile, now, newId: randomUUID }, ctx, input);
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
    };
    /**
     * RUN-22 / QRR-06 (contract (d), L-1): the operator attests an unknown end
     * through this Host. The Host entry first admits the request without any
     * write (this Host's lease, a reason, an unknown target at the pinned
     * revision; L-1 "busy，不改任何事实"), then reads the Kernel facts (an open
     * Turn, the input confirmation, which may record the mailbox acceptance),
     * and the owner judges the attestation.
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
      const read = await executionReader.readExecution(ctx, runRef);
      if (read.status !== 'ready') {
        return read.status === 'rejected' ? read : { status: 'rejected', code: 'not_found', reason: 'the Run is not readable' };
      }
      const record = read.value;
      const admitted = attestationAdmission(request, runRef, record.run.revision,
        record.run.status === 'ended' && record.run.outcome === 'outcome_unknown', 'Run');
      if (admitted !== null) return admitted;
      const auth = record.run.executionAuthorization;
      const kernel = auth !== undefined && 'schemaVersion' in auth && auth.schemaVersion === 2 ? auth.kernel : null;
      const facts = kernel === null ? { ok: true as const, kernelTurnOpen: false, inputsConfirmed: null }
        : await readAttestationFacts({ owner: historyOwner, messages: classifierMessages }, ctx, { session: record.session,
          executionRef: record.run.ref, kernel, startPosition: record.run.executionHistory?.startPosition ?? null });
      if (!facts.ok) return facts.rejection;
      return runReconcile.resolveUnknownRun(ctx, { input: { runRef, reason: input.reason, kernelTurnOpen: facts.kernelTurnOpen,
        inputsConfirmed: facts.inputsConfirmed }, meta: request.meta });
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
    let closing: Promise<void> | undefined;
    return {
      goals, plans, claims, executions, sessions, materials, messages, controls, evidence, checks, roles, architecture, projects, completionPolicies,
      queries,
      workspace: workspace.tools, runtime: runtimePort, workflow, kernelStores,
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
  } catch (error) {
    // Close every owned resource while preserving the initialization error.
    try { await closeBodies?.(); } catch { /* keep original error */ }
    try { await rawBackend.close(); } catch { /* keep original error */ }
    throw error;
  }
}
