/** Consistent ControlEngine test double (used by HumanCollaboration tests). */
import type { CommandReceipt, CreateGoalCommand } from "../command-event.js";
import { makeCommitCursor } from "../ledger.js";
import type {
  WorkspaceBootstrapCommand,
  WorkspaceBootstrapReceipt,
} from "../bootstrap.js";
import type {
  GovernanceActivateCommand,
  GovernanceActivateReceipt,
  GovernanceInstallCommand,
  GovernanceInstallReceipt,
} from "../governance.js";
import type { ApplyPlanRevisionCommand, PlanRevisionReceipt } from "../plan.js";
import type {
  DispatchClaimCommand,
  DispatchClaimReceipt,
  DispatchReadinessQuery,
  DispatchReadinessResult,
  DispatchStartCommand,
  DispatchStartReceipt,
  RunFactCommand,
  RunFactReceipt,
} from "../dispatch.js";
import type { SubmitEvidenceCommand, SubmitEvidenceReceipt } from "../evidence.js";
import type { ReduceTaskCommand, ReduceTaskReceipt } from "../reduction.js";
import type { ReduceGoalCommand, ReduceGoalReceipt } from "../goal-phase.js";
import type { ClaimReplacementCommand, ClaimReplacementReceipt, RecordHandoffCommand, RecordHandoffReceipt } from "../handoff.js";
import type {
  AcquireReadLeaseReceipt,
  AcquireWorkspaceReadLeaseCommand,
  AcquireWorkspaceWriteLeaseCommand,
  AcquireWriteLeaseReceipt,
  ReleaseLeaseReceipt,
  ReleaseWorkspaceLeaseCommand,
} from "../workspace-lease.js";
import type { RecordIntegrationResultCommand, RecordIntegrationResultReceipt } from "../integration.js";
import type { RecordPatchCommand, RecordPatchReceipt } from "../patch.js";
import type {
  BindWorkContextCommand,
  BindWorkContextReceipt,
  LinkWorkRunCommand,
  LinkWorkRunReceipt,
  RecordContinuationCommand,
  RecordContinuationReceipt,
  RecordExecutionNoteCommand,
  RecordExecutionNoteReceipt,
} from "../context-continuity.js";
import type { ControlEngine } from "../modules.js";

export function committedReceiptFor(command: CreateGoalCommand): CommandReceipt {
  return {
    status: "committed",
    commandId: command.commandId,
    replayed: false,
    aggregateRevision: 1,
    eventIds: ["evt-for-test"],
    commitCursor: makeCommitCursor(1),
  };
}

export function rejectedReceiptFor(
  command: CreateGoalCommand,
  code: "invalid" | "not_found" | "revision_conflict" | "idempotency_conflict" | "unavailable",
): CommandReceipt {
  return { status: "rejected", commandId: command.commandId, code };
}


export type SubmitBehavior = (
  command: CreateGoalCommand,
) => Promise<CommandReceipt> | CommandReceipt;
export type BootstrapBehavior = (
  command: WorkspaceBootstrapCommand,
) => Promise<WorkspaceBootstrapReceipt> | WorkspaceBootstrapReceipt;
export type InstallBehavior = (
  command: GovernanceInstallCommand,
) => Promise<GovernanceInstallReceipt> | GovernanceInstallReceipt;
export type ActivateBehavior = (
  command: GovernanceActivateCommand,
) => Promise<GovernanceActivateReceipt> | GovernanceActivateReceipt;
export type ApplyPlanBehavior = (
  command: ApplyPlanRevisionCommand,
) => Promise<PlanRevisionReceipt> | PlanRevisionReceipt;
export type DispatchReadinessBehavior = (
  query: DispatchReadinessQuery,
) => Promise<DispatchReadinessResult> | DispatchReadinessResult;
export type ClaimTaskBehavior = (
  command: DispatchClaimCommand,
) => Promise<DispatchClaimReceipt> | DispatchClaimReceipt;
export type StartRunBehavior = (
  command: DispatchStartCommand,
) => Promise<DispatchStartReceipt> | DispatchStartReceipt;
export type RunFactBehavior = (
  command: RunFactCommand,
) => Promise<RunFactReceipt> | RunFactReceipt;
export type SubmitEvidenceBehavior = (
  command: SubmitEvidenceCommand,
) => Promise<SubmitEvidenceReceipt> | SubmitEvidenceReceipt;
export type ReduceTaskBehavior = (
  command: ReduceTaskCommand,
) => Promise<ReduceTaskReceipt> | ReduceTaskReceipt;
export type RecordHandoffBehavior = (command: RecordHandoffCommand) => RecordHandoffReceipt | Promise<RecordHandoffReceipt>;
export type ClaimReplacementBehavior = (command: ClaimReplacementCommand) => ClaimReplacementReceipt | Promise<ClaimReplacementReceipt>;
export type AcquireReadLeaseBehavior = (command: AcquireWorkspaceReadLeaseCommand) => AcquireReadLeaseReceipt | Promise<AcquireReadLeaseReceipt>;
export type AcquireWriteLeaseBehavior = (command: AcquireWorkspaceWriteLeaseCommand) => AcquireWriteLeaseReceipt | Promise<AcquireWriteLeaseReceipt>;
export type ReleaseLeaseBehavior = (command: ReleaseWorkspaceLeaseCommand) => ReleaseLeaseReceipt | Promise<ReleaseLeaseReceipt>;
export type RecordIntegrationResultBehavior = (command: RecordIntegrationResultCommand) => RecordIntegrationResultReceipt | Promise<RecordIntegrationResultReceipt>;
export type RecordPatchBehavior = (command: RecordPatchCommand) => RecordPatchReceipt | Promise<RecordPatchReceipt>;
export type BindWorkContextBehavior = (command: BindWorkContextCommand) => BindWorkContextReceipt | Promise<BindWorkContextReceipt>;
export type LinkWorkRunBehavior = (command: LinkWorkRunCommand) => LinkWorkRunReceipt | Promise<LinkWorkRunReceipt>;
export type RecordExecutionNoteBehavior = (command: RecordExecutionNoteCommand) => RecordExecutionNoteReceipt | Promise<RecordExecutionNoteReceipt>;
export type RecordContinuationBehavior = (command: RecordContinuationCommand) => RecordContinuationReceipt | Promise<RecordContinuationReceipt>;
export type RecordArchitectureInspectionBehavior = (command: import("../architecture-inspection.js").RecordArchitectureInspectionCommand) => import("../architecture-inspection.js").RecordArchitectureInspectionReceipt | Promise<import("../architecture-inspection.js").RecordArchitectureInspectionReceipt>;
export type RecordArchitectureFindingBehavior = (command: import("../architecture-inspection.js").RecordArchitectureFindingCommand) => import("../architecture-inspection.js").RecordArchitectureFindingReceipt | Promise<import("../architecture-inspection.js").RecordArchitectureFindingReceipt>;
export type RecordArchitectureDecisionBriefBehavior = (command: import("../architecture-inspection.js").RecordArchitectureDecisionBriefCommand) => import("../architecture-inspection.js").RecordArchitectureDecisionBriefReceipt | Promise<import("../architecture-inspection.js").RecordArchitectureDecisionBriefReceipt>;
export type RecordCandidateBaselineProposalBehavior = (command: import("../architecture-inspection.js").RecordCandidateBaselineProposalCommand) => import("../architecture-inspection.js").RecordCandidateBaselineProposalReceipt | Promise<import("../architecture-inspection.js").RecordCandidateBaselineProposalReceipt>;

export type ReduceGoalBehavior = (
  command: ReduceGoalCommand,
) => Promise<ReduceGoalReceipt> | ReduceGoalReceipt;

export class ScriptedControlEngine implements ControlEngine {
  readonly submitCalls: CreateGoalCommand[] = [];
  readonly bootstrapCalls: WorkspaceBootstrapCommand[] = [];
  readonly installCalls: GovernanceInstallCommand[] = [];
  readonly activateCalls: GovernanceActivateCommand[] = [];
  readonly applyPlanCalls: ApplyPlanRevisionCommand[] = [];
  readonly dispatchReadinessCalls: DispatchReadinessQuery[] = [];
  readonly claimTaskCalls: DispatchClaimCommand[] = [];
  readonly startRunCalls: DispatchStartCommand[] = [];
  readonly runFactCalls: RunFactCommand[] = [];
  readonly submitEvidenceCalls: SubmitEvidenceCommand[] = [];
  readonly reduceTaskCalls: ReduceTaskCommand[] = [];
  readonly reduceGoalCalls: ReduceGoalCommand[] = [];
  readonly recordHandoffCalls: RecordHandoffCommand[] = [];
  readonly claimReplacementCalls: ClaimReplacementCommand[] = [];

  constructor(
    private readonly options: {
      submit?: SubmitBehavior;
      bootstrap?: BootstrapBehavior;
      install?: InstallBehavior;
      activate?: ActivateBehavior;
      applyPlan?: ApplyPlanBehavior;
      dispatchReadiness?: DispatchReadinessBehavior;
      claimTask?: ClaimTaskBehavior;
      startRun?: StartRunBehavior;
      runFact?: RunFactBehavior;
      submitEvidence?: SubmitEvidenceBehavior;
      reduceTask?: ReduceTaskBehavior;
      reduceGoal?: ReduceGoalBehavior;
      recordHandoff?: RecordHandoffBehavior;
      claimReplacement?: ClaimReplacementBehavior;
      acquireWorkspaceReadLease?: AcquireReadLeaseBehavior;
      acquireWorkspaceWriteLease?: AcquireWriteLeaseBehavior;
      releaseWorkspaceLease?: ReleaseLeaseBehavior;
      recordIntegrationResult?: RecordIntegrationResultBehavior;
      recordPatch?: RecordPatchBehavior;
      bindWorkContext?: BindWorkContextBehavior;
      linkWorkRun?: LinkWorkRunBehavior;
      recordExecutionNote?: RecordExecutionNoteBehavior;
      recordContinuation?: RecordContinuationBehavior;
      recordArchitectureInspection?: RecordArchitectureInspectionBehavior;
      recordArchitectureFinding?: RecordArchitectureFindingBehavior;
      recordArchitectureDecisionBrief?: RecordArchitectureDecisionBriefBehavior;
      recordCandidateBaselineProposal?: RecordCandidateBaselineProposalBehavior;
      defaultSubmit?: CommandReceipt;
      defaultBootstrap?: WorkspaceBootstrapReceipt;
      defaultInstall?: GovernanceInstallReceipt;
      defaultActivate?: GovernanceActivateReceipt;
      defaultApplyPlan?: PlanRevisionReceipt;
    } = {},
  ) {}

  async submit(command: CreateGoalCommand): Promise<CommandReceipt> {
    this.submitCalls.push(command);
    if (this.options.submit) return this.options.submit(command);
    return this.options.defaultSubmit ?? committedReceiptFor(command);
  }

  async bootstrap(command: WorkspaceBootstrapCommand): Promise<WorkspaceBootstrapReceipt> {
    this.bootstrapCalls.push(command);
    if (this.options.bootstrap) return this.options.bootstrap(command);
    if (this.options.defaultBootstrap) return this.options.defaultBootstrap;
    throw new Error("ScriptedControlEngine: no bootstrap behavior configured");
  }

  async install(command: GovernanceInstallCommand): Promise<GovernanceInstallReceipt> {
    this.installCalls.push(command);
    if (this.options.install) return this.options.install(command);
    if (this.options.defaultInstall) return this.options.defaultInstall;
    throw new Error("ScriptedControlEngine: no install behavior configured");
  }

  async activate(command: GovernanceActivateCommand): Promise<GovernanceActivateReceipt> {
    this.activateCalls.push(command);
    if (this.options.activate) return this.options.activate(command);
    if (this.options.defaultActivate) return this.options.defaultActivate;
    throw new Error("ScriptedControlEngine: no activate behavior configured");
  }

  async applyPlan(command: ApplyPlanRevisionCommand): Promise<PlanRevisionReceipt> {
    this.applyPlanCalls.push(command);
    if (this.options.applyPlan) return this.options.applyPlan(command);
    if (this.options.defaultApplyPlan) return this.options.defaultApplyPlan;
    throw new Error("ScriptedControlEngine: no applyPlan behavior configured");
  }

  async dispatchReadiness(query: DispatchReadinessQuery): Promise<DispatchReadinessResult> {
    this.dispatchReadinessCalls.push(query);
    if (this.options.dispatchReadiness) return this.options.dispatchReadiness(query);
    throw new Error("ScriptedControlEngine: no dispatchReadiness behavior configured");
  }

  async claimTask(command: DispatchClaimCommand): Promise<DispatchClaimReceipt> {
    this.claimTaskCalls.push(command);
    if (this.options.claimTask) return this.options.claimTask(command);
    throw new Error("ScriptedControlEngine: no claimTask behavior configured");
  }

  async startRun(command: DispatchStartCommand): Promise<DispatchStartReceipt> {
    this.startRunCalls.push(command);
    if (this.options.startRun) return this.options.startRun(command);
    throw new Error("ScriptedControlEngine: no startRun behavior configured");
  }

  async runFact(command: RunFactCommand): Promise<RunFactReceipt> {
    this.runFactCalls.push(command);
    if (this.options.runFact) return this.options.runFact(command);
    throw new Error("ScriptedControlEngine: no runFact behavior configured");
  }

  async submitEvidence(command: SubmitEvidenceCommand): Promise<SubmitEvidenceReceipt> {
    this.submitEvidenceCalls.push(command);
    if (this.options.submitEvidence) return this.options.submitEvidence(command);
    throw new Error("ScriptedControlEngine: no submitEvidence behavior configured");
  }

  async reduceTask(command: ReduceTaskCommand): Promise<ReduceTaskReceipt> {
    this.reduceTaskCalls.push(command);
    if (this.options.reduceTask) return this.options.reduceTask(command);
    throw new Error("ScriptedControlEngine: no reduceTask behavior configured");
  }

  async reduceGoal(command: ReduceGoalCommand): Promise<ReduceGoalReceipt> {
    this.reduceGoalCalls.push(command);
    if (this.options.reduceGoal) return this.options.reduceGoal(command);
    throw new Error("ScriptedControlEngine: no reduceGoal behavior configured");
  }

  async recordHandoff(command: RecordHandoffCommand): Promise<RecordHandoffReceipt> {
    this.recordHandoffCalls.push(command);
    if (this.options.recordHandoff) return this.options.recordHandoff(command);
    throw new Error("ScriptedControlEngine: no recordHandoff behavior configured");
  }

  async claimReplacement(command: ClaimReplacementCommand): Promise<ClaimReplacementReceipt> {
    this.claimReplacementCalls.push(command);
    if (this.options.claimReplacement) return this.options.claimReplacement(command);
    throw new Error("ScriptedControlEngine: no claimReplacement behavior configured");
  }

  // P1-07 (scripted double: records calls; behaviors configured per test)      //

  readonly acquireWorkspaceReadLeaseCalls: AcquireWorkspaceReadLeaseCommand[] = [];
  readonly acquireWorkspaceWriteLeaseCalls: AcquireWorkspaceWriteLeaseCommand[] = [];
  readonly releaseWorkspaceLeaseCalls: ReleaseWorkspaceLeaseCommand[] = [];
  readonly recordIntegrationResultCalls: RecordIntegrationResultCommand[] = [];
  readonly recordPatchCalls: RecordPatchCommand[] = [];

  async acquireWorkspaceReadLease(command: AcquireWorkspaceReadLeaseCommand): Promise<AcquireReadLeaseReceipt> {
    this.acquireWorkspaceReadLeaseCalls.push(command);
    if (this.options.acquireWorkspaceReadLease) return this.options.acquireWorkspaceReadLease(command);
    throw new Error("ScriptedControlEngine: no acquireWorkspaceReadLease behavior configured");
  }

  async acquireWorkspaceWriteLease(command: AcquireWorkspaceWriteLeaseCommand): Promise<AcquireWriteLeaseReceipt> {
    this.acquireWorkspaceWriteLeaseCalls.push(command);
    if (this.options.acquireWorkspaceWriteLease) return this.options.acquireWorkspaceWriteLease(command);
    throw new Error("ScriptedControlEngine: no acquireWorkspaceWriteLease behavior configured");
  }

  async releaseWorkspaceLease(command: ReleaseWorkspaceLeaseCommand): Promise<ReleaseLeaseReceipt> {
    this.releaseWorkspaceLeaseCalls.push(command);
    if (this.options.releaseWorkspaceLease) return this.options.releaseWorkspaceLease(command);
    throw new Error("ScriptedControlEngine: no releaseWorkspaceLease behavior configured");
  }

  async recordIntegrationResult(command: RecordIntegrationResultCommand): Promise<RecordIntegrationResultReceipt> {
    this.recordIntegrationResultCalls.push(command);
    if (this.options.recordIntegrationResult) return this.options.recordIntegrationResult(command);
    throw new Error("ScriptedControlEngine: no recordIntegrationResult behavior configured");
  }

  async recordPatch(command: RecordPatchCommand): Promise<RecordPatchReceipt> {
    this.recordPatchCalls.push(command);
    if (this.options.recordPatch) return this.options.recordPatch(command);
    throw new Error("ScriptedControlEngine: no recordPatch behavior configured");
  }

  // P1-16 (scripted double: records calls; behaviors configured per test)      //

  readonly bindWorkContextCalls: BindWorkContextCommand[] = [];
  readonly linkWorkRunCalls: LinkWorkRunCommand[] = [];
  readonly recordExecutionNoteCalls: RecordExecutionNoteCommand[] = [];
  readonly recordContinuationCalls: RecordContinuationCommand[] = [];

  async bindWorkContext(command: BindWorkContextCommand): Promise<BindWorkContextReceipt> {
    this.bindWorkContextCalls.push(command);
    if (this.options.bindWorkContext) return this.options.bindWorkContext(command);
    throw new Error("ScriptedControlEngine: no bindWorkContext behavior configured");
  }

  async linkWorkRun(command: LinkWorkRunCommand): Promise<LinkWorkRunReceipt> {
    this.linkWorkRunCalls.push(command);
    if (this.options.linkWorkRun) return this.options.linkWorkRun(command);
    throw new Error("ScriptedControlEngine: no linkWorkRun behavior configured");
  }

  async recordExecutionNote(command: RecordExecutionNoteCommand): Promise<RecordExecutionNoteReceipt> {
    this.recordExecutionNoteCalls.push(command);
    if (this.options.recordExecutionNote) return this.options.recordExecutionNote(command);
    throw new Error("ScriptedControlEngine: no recordExecutionNote behavior configured");
  }

  async recordContinuation(command: RecordContinuationCommand): Promise<RecordContinuationReceipt> {
    this.recordContinuationCalls.push(command);
    if (this.options.recordContinuation) return this.options.recordContinuation(command);
    throw new Error("ScriptedControlEngine: no recordContinuation behavior configured");
  }

  readonly recordArchitectureInspectionCalls: import("../architecture-inspection.js").RecordArchitectureInspectionCommand[] = [];
  readonly recordArchitectureFindingCalls: import("../architecture-inspection.js").RecordArchitectureFindingCommand[] = [];
  readonly recordArchitectureDecisionBriefCalls: import("../architecture-inspection.js").RecordArchitectureDecisionBriefCommand[] = [];
  readonly recordCandidateBaselineProposalCalls: import("../architecture-inspection.js").RecordCandidateBaselineProposalCommand[] = [];

  async recordArchitectureInspection(command: import("../architecture-inspection.js").RecordArchitectureInspectionCommand): Promise<import("../architecture-inspection.js").RecordArchitectureInspectionReceipt> {
    this.recordArchitectureInspectionCalls.push(command);
    if (this.options.recordArchitectureInspection) return this.options.recordArchitectureInspection(command);
    throw new Error("ScriptedControlEngine: no recordArchitectureInspection behavior configured");
  }

  async recordArchitectureFinding(command: import("../architecture-inspection.js").RecordArchitectureFindingCommand): Promise<import("../architecture-inspection.js").RecordArchitectureFindingReceipt> {
    this.recordArchitectureFindingCalls.push(command);
    if (this.options.recordArchitectureFinding) return this.options.recordArchitectureFinding(command);
    throw new Error("ScriptedControlEngine: no recordArchitectureFinding behavior configured");
  }

  async recordArchitectureDecisionBrief(command: import("../architecture-inspection.js").RecordArchitectureDecisionBriefCommand): Promise<import("../architecture-inspection.js").RecordArchitectureDecisionBriefReceipt> {
    this.recordArchitectureDecisionBriefCalls.push(command);
    if (this.options.recordArchitectureDecisionBrief) return this.options.recordArchitectureDecisionBrief(command);
    throw new Error("ScriptedControlEngine: no recordArchitectureDecisionBrief behavior configured");
  }

  async recordCandidateBaselineProposal(command: import("../architecture-inspection.js").RecordCandidateBaselineProposalCommand): Promise<import("../architecture-inspection.js").RecordCandidateBaselineProposalReceipt> {
    this.recordCandidateBaselineProposalCalls.push(command);
    if (this.options.recordCandidateBaselineProposal) return this.options.recordCandidateBaselineProposal(command);
    throw new Error("ScriptedControlEngine: no recordCandidateBaselineProposal behavior configured");
  }
}