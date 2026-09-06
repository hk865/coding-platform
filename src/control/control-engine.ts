/**
 * ControlEngine (Lane B, P1-00) — Goal-create slice + Workspace bootstrap.
 *
 * Authority:
 *   - dev_docs/modules/control/control-engine.md   (transition authority, guard order)
 *   - dev_docs/interfaces/command-event.md          (command/receipt/event & fingerprint)
 *   - dev_docs/interfaces/state-ledger.md           (snapshot/atomic-commit/event page)
 *   - IMPLEMENTATION-HANDOFF.md bootstrap semantics:
 *       bootstrap is only-if-empty; idempotency is decided INSIDE ledger.commit,
 *       this engine never check-then-commits emptiness.
 *
 * Design notes (see handoff report):
 *   - submit runs engine-level guards only where a distinct rejection code is
 *     required (validation -> invalid, Project/Workspace load -> not_found).
 *     Goal existence, idempotent replay and commit-time revision conflicts are
 *     decided by StateLedger.commit CAS + idempotency, then mapped here. This is
 *     deliberate: short-circuiting on "goal already exists" would break idempotent
 *     replay (same identity+fingerprint must return committed, replayed=true),
 *     which the shared contracts require.
 *   - bootstrap never guards emptiness itself; it hands the commit to the ledger
 *     which atomically enforces "only-if-empty" OR idempotent replay.
 */
import type {
  CommandReceipt,
  CreateGoalCommand,
  GoalCreatedEvent,
} from "../contracts/command-event.js";
import { commandFingerprint, normalizeObjective } from "../contracts/command-event.js";
import type {
  BootstrapManifestSnapshot,
  ProjectBootstrappedEventV1,
  WorkspaceBootstrapCommand,
  WorkspaceBootstrapManifest,
  WorkspaceBootstrapReceipt,
  WorkspaceBootstrappedEventV1,
} from "../contracts/bootstrap.js";
import { bootstrapFingerprint, manifestFromSnapshot } from "../contracts/bootstrap.js";
import type {
  AggregateRef,
  BootstrapLedgerCommitV1,
  GoalCreateLedgerCommitV1,
  GoalRef,
  GoalSnapshot,
  LedgerCommitReceipt,
  ProjectRef,
  ProjectSnapshot,
  SnapshotResult,
  StateLedger,
  VersionedRef,
  WorkspaceRef,
  WorkspaceSnapshot,
} from "../contracts/ledger.js";
import { canonicalJson } from "../contracts/fingerprint.js";
import {
  validateCreateGoalCommand,
  validateWorkspaceBootstrapCommand,
} from "../contracts/validation.js";
import type { ControlEngine } from "../contracts/modules.js";
import type {
  GovernanceActivateCommand,
  GovernanceActivateReceipt,
  GovernanceInstallCommand,
  GovernanceInstallReceipt,
} from "../contracts/governance.js";
import type { ApplyPlanRevisionCommand, PlanRevisionReceipt } from "../contracts/plan.js";
import type {
  DispatchClaimCommand,
  DispatchClaimReceipt,
  DispatchReadinessQuery,
  DispatchReadinessResult,
  DispatchStartCommand,
  DispatchStartReceipt,
  RunFactCommand,
  RunFactReceipt,
} from "../contracts/dispatch.js";
import { installGovernanceRevision } from "./governance-install.js";
import { activateGovernance } from "./governance-activate.js";
import { applyPlanRevision } from "./plan-acceptance.js";
import { evaluateDispatchReadiness } from "./readiness.js";
import { claimTask } from "./claim.js";
import { startRun } from "./start-run.js";
import { runFact } from "./run-facts.js";
import { submitEvidence } from "./evidence-intake.js";
import { reduceTask } from "./task-reducer.js";
import { recordHandoff } from "./handoff.js";
import { claimReplacement } from "./replacement-claim.js";
import { reduceGoal } from "./goal-reducer.js";
import { WorkspaceLeaseEngineImpl } from "./workspace-lease.js";
import { WorkRecordEngineImpl } from "./work-record.js";
import { ArchitectureInspectionEngineImpl } from "./architecture-inspection.js";
import { ControlIntentEngineImpl } from "./control-intent.js";
import { QueryJobEngineImpl } from "./query-job.js";
import { GoalChangeEngineImpl } from "./goal-change.js";
import { ArchitectureEvolutionPolicyEngineImpl } from "./architecture-evolution-policy.js";
import { RemediationEngineImpl } from "./remediation.js";
import type { ApplyPlanChangeCommand, ApplyPlanChangeReceipt, RecordPlanChangeProposalCommand, RecordPlanChangeProposalReceipt, RecordUserDecisionCommand, RecordUserDecisionReceipt } from "../contracts/goal-change.js";
import type { CloseQueryJobCommand, CloseQueryJobReceipt, RecordQueryAnswerCommand, RecordQueryAnswerReceipt, SubmitQueryJobCommand, SubmitQueryJobReceipt } from "../contracts/query-job.js";
import type { RecordSafePointAckCommand, RecordSafePointAckReceipt, SubmitControlCommand, SubmitControlReceipt } from "../contracts/control-intent.js";
import type { RecordArchitectureInspectionCommand, RecordArchitectureInspectionReceipt, RecordArchitectureFindingCommand, RecordArchitectureFindingReceipt, RecordArchitectureDecisionBriefCommand, RecordArchitectureDecisionBriefReceipt, RecordCandidateBaselineProposalCommand, RecordCandidateBaselineProposalReceipt } from "../contracts/architecture-inspection.js";
import { recordIntegrationResult } from "./integration-join.js";
import { recordPatch } from "./patch-record.js";
import type { WorkspaceCapabilityPort } from "../contracts/workspace-capability.js";
import type {
  AcquireReadLeaseReceipt,
  AcquireWorkspaceReadLeaseCommand,
  AcquireWorkspaceWriteLeaseCommand,
  AcquireWriteLeaseReceipt,
  ReleaseLeaseReceipt,
  ReleaseWorkspaceLeaseCommand,
} from "../contracts/workspace-lease.js";
import type { RecordIntegrationResultCommand, RecordIntegrationResultReceipt } from "../contracts/integration.js";
import type { RecordPatchCommand, RecordPatchReceipt } from "../contracts/patch.js";
import type {
  BindWorkContextCommand,
  BindWorkContextReceipt,
  LinkWorkRunCommand,
  LinkWorkRunReceipt,
  RecordContinuationCommand,
  RecordContinuationReceipt,
  RecordExecutionNoteCommand,
  RecordExecutionNoteReceipt,
} from "../contracts/context-continuity.js";

export type ControlEngineDeps = {
  ledger: StateLedger;
  now: () => string;
  eventId: () => string;
  /** P1-07: WorkerRuntime.WorkspaceCapabilityPort (default = unsupported until wired). */
  workspaceCapability?: WorkspaceCapabilityPort;
};

type BootstrapSnapshotUnion = ProjectSnapshot | WorkspaceSnapshot | BootstrapManifestSnapshot;
type BootstrapEventUnion = ProjectBootstrappedEventV1 | WorkspaceBootstrappedEventV1;

export class ControlEngineImpl implements ControlEngine {
  private readonly deps: ControlEngineDeps;
  private readonly workspaceLease: WorkspaceLeaseEngineImpl;
  private readonly workRecord: WorkRecordEngineImpl;
  private readonly architectureInspection: ArchitectureInspectionEngineImpl;
  private readonly controlIntent: ControlIntentEngineImpl;
  private readonly queryJob: QueryJobEngineImpl;
  private readonly goalChange: GoalChangeEngineImpl;
  private readonly evolutionPolicy: ArchitectureEvolutionPolicyEngineImpl;
  private readonly remediation: RemediationEngineImpl;

  constructor(deps: ControlEngineDeps) {
    this.deps = deps;
    this.workspaceLease = new WorkspaceLeaseEngineImpl(deps);
    this.workRecord = new WorkRecordEngineImpl(deps);
    this.architectureInspection = new ArchitectureInspectionEngineImpl(deps);
    this.controlIntent = new ControlIntentEngineImpl(deps);
    this.queryJob = new QueryJobEngineImpl(deps);
    this.goalChange = new GoalChangeEngineImpl(deps);
    this.evolutionPolicy = new ArchitectureEvolutionPolicyEngineImpl(deps);
    this.remediation = new RemediationEngineImpl(deps);
  }

  // --------------------------------------------------------------------- //
  // CreateGoal                                                                //
  // --------------------------------------------------------------------- //

  async submit(command: CreateGoalCommand): Promise<CommandReceipt> {
    const issues = validateCreateGoalCommand(command);
    if (issues.length > 0) {
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }

    // Scope guards — every ref is a full aggregate ref; a workspace exists only
    // under its parent project, so a foreign workspaceId simply loads not_found.
    const projectRef: ProjectRef = {
      aggregateType: "Project",
      projectId: command.identity.projectId,
    };
    const project = await this.deps.ledger.load(projectRef);
    if (project.status === "not_found") {
      return { status: "rejected", commandId: command.commandId, code: "not_found" };
    }
    const projectRevision: number = project.snapshot.revision;

    const workspaceRef: WorkspaceRef = {
      aggregateType: "Workspace",
      projectId: command.identity.projectId,
      workspaceId: command.payload.workspaceId,
    };
    const workspace = await this.deps.ledger.load(workspaceRef);
    if (workspace.status === "not_found") {
      return { status: "rejected", commandId: command.commandId, code: "not_found" };
    }
    const workspaceRevision: number = workspace.snapshot.revision;

    // Goal existence is NOT short-circuited here. Loading it still uses the full
    // Goal ref (never a bare local goalId); its currentRevision is kept as a
    // fallback for the revision_conflict mapping. The ledger decides between an
    // idempotent replay (committed, replayed) and a genuine re-create conflict
    // (revision_conflict) atomically via expected goal@0 CAS + idempotency.
    const goalRef: GoalRef = {
      aggregateType: "Goal",
      projectId: command.identity.projectId,
      goalId: command.aggregateId,
    };
    const goal: SnapshotResult = await this.deps.ledger.load(goalRef);
    const loadedGoalRevision: number | undefined =
      goal.status === "found" ? goal.snapshot.revision : undefined;

    // Deterministic fold.
    const eventId = this.deps.eventId();
    const occurredAt = this.deps.now();
    const event = buildGoalCreatedEvent(command, eventId, occurredAt);
    const snapshot = buildGoalSnapshot(command);

    const batch: GoalCreateLedgerCommitV1 = {
      commitKind: "goal-create",
      schemaVersion: 1,
      identity: { ...command.identity },
      fingerprint: commandFingerprint(command),
      expectedVersions: [
        { ref: projectRef, revision: projectRevision },
        { ref: workspaceRef, revision: workspaceRevision },
        { ref: goalRef, revision: 0 },
      ],
      events: [event],
      snapshots: [snapshot],
      outboxIntents: [],
    };

    const receipt = await this.deps.ledger.commit(batch);
    return this.mapGoalCreateReceipt(receipt, command, loadedGoalRevision);
  }

  // --------------------------------------------------------------------- //
  // Workspace bootstrap                                                       //
  // --------------------------------------------------------------------- //

  async bootstrap(command: WorkspaceBootstrapCommand): Promise<WorkspaceBootstrapReceipt> {
    const issues = validateWorkspaceBootstrapCommand(command);
    if (issues.length > 0) {
      const hasDigestMismatch = issues.some((i) => i.code === "digest_mismatch");
      const hasStructural = issues.some((i) => i.code !== "digest_mismatch");
      // A pure content-digest mismatch is the specific error; any structural
      // problem (missing fields, unknown schemaVersion, invalid command type,
      // empty/incomplete/duplicate entries) is a generic invalid command.
      if (hasDigestMismatch && !hasStructural) {
        return { status: "rejected", commandId: command.commandId, code: "digest_mismatch" };
      }
      return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }

    const occurredAt = this.deps.now();
    const { events, snapshots, manifestSnapshot } = this.buildBootstrapArtifacts(command, occurredAt);

    const batch: BootstrapLedgerCommitV1 = {
      commitKind: "bootstrap",
      schemaVersion: 1,
      identity: { ...command.identity },
      fingerprint: bootstrapFingerprint(command),
      expectedVersions: [],
      events,
      snapshots,
      outboxIntents: [],
    };

    const receipt = await this.deps.ledger.commit(batch);
    return this.mapBootstrapReceipt(receipt, command, manifestSnapshot);
  }

  // --------------------------------------------------------------------- //
  // P1-02 governance + plan (delegating handlers; semantics see handoff)     //
  // --------------------------------------------------------------------- //

  install(command: GovernanceInstallCommand): Promise<GovernanceInstallReceipt> {
    return installGovernanceRevision(this.deps, command);
  }

  activate(command: GovernanceActivateCommand): Promise<GovernanceActivateReceipt> {
    return activateGovernance(this.deps, command);
  }

  applyPlan(command: ApplyPlanRevisionCommand): Promise<PlanRevisionReceipt> {
    return applyPlanRevision(this.deps, command);
  }

  // --------------------------------------------------------------------- //
  // P1-03 dispatch / run entries (delegating handlers)                     //
  // --------------------------------------------------------------------- //

  dispatchReadiness(query: DispatchReadinessQuery): Promise<DispatchReadinessResult> {
    return evaluateDispatchReadiness(this.deps, query);
  }

  claimTask(command: DispatchClaimCommand): Promise<DispatchClaimReceipt> {
    return claimTask(this.deps, command);
  }

  startRun(command: DispatchStartCommand): Promise<DispatchStartReceipt> {
    return startRun(this.deps, command);
  }

  runFact(command: RunFactCommand): Promise<RunFactReceipt> {
    return runFact(this.deps, command);
  }

  submitEvidence(command: import("../contracts/evidence.js").SubmitEvidenceCommand): Promise<import("../contracts/evidence.js").SubmitEvidenceReceipt> {
    return submitEvidence(this.deps, command);
  }

  reduceTask(command: import("../contracts/reduction.js").ReduceTaskCommand): Promise<import("../contracts/reduction.js").ReduceTaskReceipt> {
    return reduceTask(this.deps, command);
  }

  recordHandoff(command: import("../contracts/handoff.js").RecordHandoffCommand): Promise<import("../contracts/handoff.js").RecordHandoffReceipt> {
    return recordHandoff(this.deps, command);
  }

  claimReplacement(command: import("../contracts/handoff.js").ClaimReplacementCommand): Promise<import("../contracts/handoff.js").ClaimReplacementReceipt> {
    return claimReplacement(this.deps, command);
  }

  /** P1-05: deterministic Goal phase reduction (never Task phase). */
  reduceGoal(command: import("../contracts/goal-phase.js").ReduceGoalCommand): Promise<import("../contracts/goal-phase.js").ReduceGoalReceipt> {
    return reduceGoal(this.deps, command);
  }

  // --------------------------------------------------------------------- //
  // P1-07 workspace lease / integration / patch (delegating handlers)      //
  // --------------------------------------------------------------------- //

  acquireWorkspaceReadLease(command: AcquireWorkspaceReadLeaseCommand): Promise<AcquireReadLeaseReceipt> {
    return this.workspaceLease.acquireReadLease(command);
  }

  acquireWorkspaceWriteLease(command: AcquireWorkspaceWriteLeaseCommand): Promise<AcquireWriteLeaseReceipt> {
    return this.workspaceLease.acquireWriteLease(command);
  }

  releaseWorkspaceLease(command: ReleaseWorkspaceLeaseCommand): Promise<ReleaseLeaseReceipt> {
    return this.workspaceLease.releaseLease(command);
  }

  recordIntegrationResult(command: RecordIntegrationResultCommand): Promise<RecordIntegrationResultReceipt> {
    return recordIntegrationResult(this.deps, command);
  }

  recordPatch(command: RecordPatchCommand): Promise<RecordPatchReceipt> {
    return recordPatch(this.deps, command);
  }

  bindWorkContext(command: BindWorkContextCommand): Promise<BindWorkContextReceipt> {
    return this.workRecord.bindWorkContext(command);
  }

  linkWorkRun(command: LinkWorkRunCommand): Promise<LinkWorkRunReceipt> {
    return this.workRecord.linkWorkRun(command);
  }

  recordExecutionNote(command: RecordExecutionNoteCommand): Promise<RecordExecutionNoteReceipt> {
    return this.workRecord.recordExecutionNote(command);
  }

  recordContinuation(command: RecordContinuationCommand): Promise<RecordContinuationReceipt> {
    return this.workRecord.recordContinuation(command);
  }

  recordArchitectureInspection(command: RecordArchitectureInspectionCommand): Promise<RecordArchitectureInspectionReceipt> {
    return this.architectureInspection.recordArchitectureInspection(command);
  }

  recordArchitectureFinding(command: RecordArchitectureFindingCommand): Promise<RecordArchitectureFindingReceipt> {
    return this.architectureInspection.recordArchitectureFinding(command);
  }

  recordArchitectureDecisionBrief(command: RecordArchitectureDecisionBriefCommand): Promise<RecordArchitectureDecisionBriefReceipt> {
    return this.architectureInspection.recordArchitectureDecisionBrief(command);
  }

  recordCandidateBaselineProposal(command: RecordCandidateBaselineProposalCommand): Promise<RecordCandidateBaselineProposalReceipt> {
    return this.architectureInspection.recordCandidateBaselineProposal(command);
  }

  submitControl(command: SubmitControlCommand): Promise<SubmitControlReceipt> {
    return this.controlIntent.submit(command);
  }

  recordSafePointAck(command: RecordSafePointAckCommand): Promise<RecordSafePointAckReceipt> {
    return this.controlIntent.recordSafePointAck(command);
  }

  submitQueryJob(command: SubmitQueryJobCommand): Promise<SubmitQueryJobReceipt> {
    return this.queryJob.submit(command);
  }

  recordQueryAnswer(command: RecordQueryAnswerCommand): Promise<RecordQueryAnswerReceipt> {
    return this.queryJob.answer(command);
  }

  closeQueryJob(command: CloseQueryJobCommand): Promise<CloseQueryJobReceipt> {
    return this.queryJob.close(command);
  }

  recordPlanChangeProposal(command: RecordPlanChangeProposalCommand): Promise<RecordPlanChangeProposalReceipt> {
    return this.goalChange.recordPlanChangeProposal(command);
  }

  recordUserDecision(command: RecordUserDecisionCommand): Promise<RecordUserDecisionReceipt> {
    return this.goalChange.recordUserDecision(command);
  }

  applyPlanChange(command: ApplyPlanChangeCommand): Promise<ApplyPlanChangeReceipt> {
    return this.goalChange.applyPlanChange(command);
  }

  installArchitectureEvolutionPolicy(command: import("../contracts/architecture-evolution-policy.js").InstallArchitectureEvolutionPolicyRevisionCommand): Promise<import("../contracts/architecture-evolution-policy.js").ArchitectureEvolutionPolicyInstallReceipt> {
    return this.evolutionPolicy.install(command);
  }

  activateArchitectureEvolutionPolicy(command: import("../contracts/architecture-evolution-policy.js").ActivateProjectArchitectureEvolutionPolicyCommand): Promise<import("../contracts/architecture-evolution-policy.js").ArchitectureEvolutionPolicyActivateReceipt> {
    return this.evolutionPolicy.activate(command);
  }

  submitRemediationPlanPatch(command: import("../contracts/remediation.js").SubmitRemediationPlanPatchCommand): Promise<import("../contracts/remediation.js").SubmitRemediationPlanPatchReceipt> {
    return this.remediation.submitPlanPatch(command);
  }

  createRemediationTask(command: import("../contracts/remediation.js").CreateRemediationTaskCommand): Promise<import("../contracts/remediation.js").CreateRemediationTaskReceipt> {
    return this.remediation.createTask(command);
  }

  advanceRemediationTask(command: import("../contracts/remediation.js").AdvanceRemediationTaskCommand): Promise<import("../contracts/remediation.js").AdvanceRemediationTaskReceipt> {
    return this.remediation.advanceTask(command);
  }

  // --------------------------------------------------------------------- //
  // Mapping helper: CreateGoal receipt                                        //
  // --------------------------------------------------------------------- //

  private mapGoalCreateReceipt(
    receipt: LedgerCommitReceipt,
    command: CreateGoalCommand,
    loadedGoalRevision: number | undefined,
  ): CommandReceipt {
    if (receipt.status === "committed") {
      return {
        status: "committed",
        commandId: command.commandId,
        replayed: receipt.replayed,
        aggregateRevision: 1,
        eventIds: receipt.eventIds,
        commitCursor: receipt.commitCursor,
      };
    }

    switch (receipt.code) {
      case "invalid_commit":
        return { status: "rejected", commandId: command.commandId, code: "invalid" };
      case "revision_conflict":
        return this.goalRevisionConflict(receipt.currentVersions, command, loadedGoalRevision);
      case "idempotency_conflict":
        return { status: "rejected", commandId: command.commandId, code: "idempotency_conflict" };
      case "unavailable":
        return { status: "rejected", commandId: command.commandId, code: "unavailable" };
      case "not_empty":
        // Not reachable for a goal-create commit (expectedVersions non-empty);
        // treat as a malformed commit rather than inventing a rejection code.
        return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }
  }

  private goalRevisionConflict(
    currentVersions: VersionedRef[] | undefined,
    command: CreateGoalCommand,
    loadedGoalRevision: number | undefined,
  ): CommandReceipt {
    if (currentVersions) {
      const goalEntry = currentVersions.find(
        (v) =>
          v.ref.aggregateType === "Goal" &&
          v.ref.projectId === command.identity.projectId &&
          v.ref.goalId === command.aggregateId,
      );
      if (goalEntry) {
        return {
          status: "rejected",
          commandId: command.commandId,
          code: "revision_conflict",
          currentRevision: goalEntry.revision,
        };
      }
    }
    if (loadedGoalRevision !== undefined) {
      return {
        status: "rejected",
        commandId: command.commandId,
        code: "revision_conflict",
        currentRevision: loadedGoalRevision,
      };
    }
    // CAS race on a reference aggregate (e.g. a concurrently-changed Project or
    // Workspace): no Goal revision is known, so surface the first conflicting
    // revision to help a caller retry with a fresh expected version.
    const firstConflicting = currentVersions?.[0];
    if (firstConflicting) {
      return {
        status: "rejected",
        commandId: command.commandId,
        code: "revision_conflict",
        currentRevision: firstConflicting.revision,
      };
    }
    return { status: "rejected", commandId: command.commandId, code: "revision_conflict" };
  }

  // --------------------------------------------------------------------- //
  // Mapping helper: bootstrap receipt                                        //
  // --------------------------------------------------------------------- //

  private async mapBootstrapReceipt(
    receipt: LedgerCommitReceipt,
    command: WorkspaceBootstrapCommand,
    manifestSnapshot: BootstrapManifestSnapshot,
  ): Promise<WorkspaceBootstrapReceipt> {
    if (receipt.status === "committed") {
      const manifest = receipt.replayed
        ? await this.loadManifestForReplay(command, manifestSnapshot)
        : manifestFromSnapshot(manifestSnapshot);
      return {
        status: "committed",
        commandId: command.commandId,
        replayed: receipt.replayed,
        manifest,
        aggregateRevisions: receipt.aggregateRevisions,
        eventIds: receipt.eventIds,
        commitCursor: receipt.commitCursor,
      };
    }

    switch (receipt.code) {
      case "invalid_commit":
        return { status: "rejected", commandId: command.commandId, code: "invalid" };
      case "idempotency_conflict":
        return { status: "rejected", commandId: command.commandId, code: "idempotency_conflict" };
      case "not_empty":
        return { status: "rejected", commandId: command.commandId, code: "not_empty" };
      case "unavailable":
        return { status: "rejected", commandId: command.commandId, code: "unavailable" };
      case "revision_conflict":
        // Bootstrap commits carry no expected versions; a revision_conflict is
        // unexpected and maps to invalid (absent from the bootstrap receipt union).
        return { status: "rejected", commandId: command.commandId, code: "invalid" };
    }
  }

  private async loadManifestForReplay(
    command: WorkspaceBootstrapCommand,
    fallback: BootstrapManifestSnapshot,
  ): Promise<WorkspaceBootstrapManifest> {
    const manifestRef = {
      aggregateType: "BootstrapManifest" as const,
      manifestId: command.payload.sourceDigest,
    };
    const loaded = await this.deps.ledger.load(manifestRef);
    if (loaded.status === "found" && loaded.snapshot.ref.aggregateType === "BootstrapManifest") {
      return manifestFromSnapshot(loaded.snapshot as BootstrapManifestSnapshot);
    }
    // A replayed commit implies the manifest was persisted; fall back to the
    // locally-projected (deterministic) snapshot so the receipt stays well-formed.
    return manifestFromSnapshot(fallback);
  }

  // --------------------------------------------------------------------- //
  // Deterministic bootstrap fold                                             //
  // --------------------------------------------------------------------- //

  private buildBootstrapArtifacts(command: WorkspaceBootstrapCommand, occurredAt: string): {
    events: BootstrapEventUnion[];
    snapshots: BootstrapSnapshotUnion[];
    manifestSnapshot: BootstrapManifestSnapshot;
  } {
    const entries = command.payload.entries;

    // Per-project (first occurrence, in order) then per-entry audit events.
    const uniqueProjects = new Map<string, number>();
    entries.forEach((entry, index) => {
      if (!uniqueProjects.has(entry.projectId)) uniqueProjects.set(entry.projectId, index);
    });

    const events: BootstrapEventUnion[] = [];

    for (const projectId of uniqueProjects.keys()) {
      events.push({
        eventId: this.deps.eventId(),
        eventType: "ProjectBootstrapped",
        schemaVersion: 1,
        projectId,
        aggregateType: "Project",
        aggregateId: projectId,
        aggregateRevision: 1,
        causationId: command.commandId,
        correlationId: command.correlationId,
        idempotencyKey: command.identity.idempotencyKey,
        actor: { ...command.identity.actor },
        occurredAt,
        payload: { sourceDigest: command.payload.sourceDigest },
      });
    }
    for (const entry of entries) {
      events.push({
        eventId: this.deps.eventId(),
        eventType: "WorkspaceBootstrapped",
        schemaVersion: 1,
        projectId: entry.projectId,
        workspaceId: entry.workspaceId,
        aggregateType: "Workspace",
        aggregateId: entry.workspaceId,
        aggregateRevision: 1,
        causationId: command.commandId,
        correlationId: command.correlationId,
        idempotencyKey: command.identity.idempotencyKey,
        actor: { ...command.identity.actor },
        occurredAt,
        payload: { sourceDigest: command.payload.sourceDigest },
      });
    }

    // One Project + Workspace snapshot per distinct (full) scope, then manifest.
    const seenProjects = new Set<string>();
    const seenWorkspaces = new Set<string>();
    const snapshots: BootstrapSnapshotUnion[] = [];
    for (const entry of entries) {
      const projectRef: ProjectRef = { aggregateType: "Project", projectId: entry.projectId };
      if (!seenProjects.has(entry.projectId)) {
        seenProjects.add(entry.projectId);
        snapshots.push({ ref: projectRef, revision: 1 });
      }
      const workspaceRef: WorkspaceRef = {
        aggregateType: "Workspace",
        projectId: entry.projectId,
        workspaceId: entry.workspaceId,
      };
      const wkey = canonicalJson(workspaceRef);
      if (!seenWorkspaces.has(wkey)) {
        seenWorkspaces.add(wkey);
        snapshots.push({ ref: workspaceRef, revision: 1 });
      }
    }
    const manifestEntries = entries.map((entry) => ({
      projectId: entry.projectId,
      workspaceId: entry.workspaceId,
      projectRevision: 1 as const,
      workspaceRevision: 1 as const,
    }));
    const manifestSnapshot: BootstrapManifestSnapshot = {
      ref: { aggregateType: "BootstrapManifest", manifestId: command.payload.sourceDigest },
      revision: 1,
      schemaVersion: 1,
      sourceDigest: command.payload.sourceDigest,
      bootstrapRevision: 1,
      entries: manifestEntries,
    };
    snapshots.push(manifestSnapshot);

    return { events, snapshots, manifestSnapshot };
  }
}

// --------------------------------------------------------------------- //
// Deterministic fold primitives (replicate the contract-fixture builders)  //
// --------------------------------------------------------------------- //

function buildGoalCreatedEvent(
  command: CreateGoalCommand,
  eventId: string,
  occurredAt: string,
): GoalCreatedEvent {
  return {
    eventId,
    eventType: "GoalCreated",
    schemaVersion: 1,
    projectId: command.identity.projectId,
    workspaceId: command.payload.workspaceId,
    aggregateType: "Goal",
    aggregateId: command.aggregateId,
    aggregateRevision: 1,
    causationId: command.commandId,
    correlationId: command.correlationId,
    idempotencyKey: command.identity.idempotencyKey,
    actor: { ...command.identity.actor },
    occurredAt,
    payload: {
      objective: normalizeObjective(command.payload.objective),
      desiredState: "active",
      activePlanRevision: null,
    },
  };
}

function buildGoalSnapshot(command: CreateGoalCommand): GoalSnapshot {
  const workspaceRef: WorkspaceRef = {
    aggregateType: "Workspace",
    projectId: command.identity.projectId,
    workspaceId: command.payload.workspaceId,
  };
  const goalRef: GoalRef = {
    aggregateType: "Goal",
    projectId: command.identity.projectId,
    goalId: command.aggregateId,
  };
  return {
    ref: goalRef,
    workspaceRef,
    objective: normalizeObjective(command.payload.objective),
    desiredState: "active",
    activePlanRevision: null,
    revision: 1,
  };
}

export function createControlEngine(deps: ControlEngineDeps): ControlEngineImpl {
  return new ControlEngineImpl(deps);
}
