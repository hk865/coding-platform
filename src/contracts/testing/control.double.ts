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
export type SubmitControlBehavior = (command: import("../control-intent.js").SubmitControlCommand) => import("../control-intent.js").SubmitControlReceipt | Promise<import("../control-intent.js").SubmitControlReceipt>;
export type RecordSafePointAckBehavior = (command: import("../control-intent.js").RecordSafePointAckCommand) => import("../control-intent.js").RecordSafePointAckReceipt | Promise<import("../control-intent.js").RecordSafePointAckReceipt>;
export type SubmitQueryJobBehavior = (command: import("../query-job.js").SubmitQueryJobCommand) => import("../query-job.js").SubmitQueryJobReceipt | Promise<import("../query-job.js").SubmitQueryJobReceipt>;
export type RecordQueryAnswerBehavior = (command: import("../query-job.js").RecordQueryAnswerCommand) => import("../query-job.js").RecordQueryAnswerReceipt | Promise<import("../query-job.js").RecordQueryAnswerReceipt>;
export type CloseQueryJobBehavior = (command: import("../query-job.js").CloseQueryJobCommand) => import("../query-job.js").CloseQueryJobReceipt | Promise<import("../query-job.js").CloseQueryJobReceipt>;
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
      submitControl?: SubmitControlBehavior;
      recordSafePointAck?: RecordSafePointAckBehavior;
      submitQueryJob?: SubmitQueryJobBehavior;
      recordQueryAnswer?: RecordQueryAnswerBehavior;
      closeQueryJob?: CloseQueryJobBehavior;
      recordArchitectureInspection?: RecordArchitectureInspectionBehavior;
      recordArchitectureFinding?: RecordArchitectureFindingBehavior;
      recordArchitectureDecisionBrief?: RecordArchitectureDecisionBriefBehavior;
      recordCandidateBaselineProposal?: RecordCandidateBaselineProposalBehavior;
      recordPlanChangeProposal?: (command: import("../goal-change.js").RecordPlanChangeProposalCommand) => import("../goal-change.js").RecordPlanChangeProposalReceipt | Promise<import("../goal-change.js").RecordPlanChangeProposalReceipt>;
      recordUserDecision?: (command: import("../goal-change.js").RecordUserDecisionCommand) => import("../goal-change.js").RecordUserDecisionReceipt | Promise<import("../goal-change.js").RecordUserDecisionReceipt>;
      applyPlanChange?: (command: import("../goal-change.js").ApplyPlanChangeCommand) => import("../goal-change.js").ApplyPlanChangeReceipt | Promise<import("../goal-change.js").ApplyPlanChangeReceipt>;
      installArchitectureEvolutionPolicy?: (command: import("../architecture-evolution-policy.js").InstallArchitectureEvolutionPolicyRevisionCommand) => import("../architecture-evolution-policy.js").ArchitectureEvolutionPolicyInstallReceipt | Promise<import("../architecture-evolution-policy.js").ArchitectureEvolutionPolicyInstallReceipt>;
      activateArchitectureEvolutionPolicy?: (command: import("../architecture-evolution-policy.js").ActivateProjectArchitectureEvolutionPolicyCommand) => import("../architecture-evolution-policy.js").ArchitectureEvolutionPolicyActivateReceipt | Promise<import("../architecture-evolution-policy.js").ArchitectureEvolutionPolicyActivateReceipt>;
      submitRemediationPlanPatch?: (command: import("../remediation.js").SubmitRemediationPlanPatchCommand) => import("../remediation.js").SubmitRemediationPlanPatchReceipt | Promise<import("../remediation.js").SubmitRemediationPlanPatchReceipt>;
      createRemediationTask?: (command: import("../remediation.js").CreateRemediationTaskCommand) => import("../remediation.js").CreateRemediationTaskReceipt | Promise<import("../remediation.js").CreateRemediationTaskReceipt>;
      advanceRemediationTask?: (command: import("../remediation.js").AdvanceRemediationTaskCommand) => import("../remediation.js").AdvanceRemediationTaskReceipt | Promise<import("../remediation.js").AdvanceRemediationTaskReceipt>;
      materializeCandidateBaseline?: (command: import("../baseline-evolution.js").MaterializeCandidateBaselineCommand) => import("../baseline-evolution.js").MaterializeCandidateBaselineReceipt | Promise<import("../baseline-evolution.js").MaterializeCandidateBaselineReceipt>;
      recordArchitectureChangeDecision?: (command: import("../baseline-evolution.js").RecordArchitectureChangeDecisionCommand) => import("../baseline-evolution.js").RecordArchitectureChangeDecisionReceipt | Promise<import("../baseline-evolution.js").RecordArchitectureChangeDecisionReceipt>;
      recordMigrationGate?: (command: import("../baseline-evolution.js").RecordMigrationGateCommand) => import("../baseline-evolution.js").RecordMigrationGateReceipt | Promise<import("../baseline-evolution.js").RecordMigrationGateReceipt>;
      recordBaselineActivation?: (command: import("../baseline-evolution.js").RecordBaselineActivationCommand) => import("../baseline-evolution.js").RecordBaselineActivationReceipt | Promise<import("../baseline-evolution.js").RecordBaselineActivationReceipt>;
      recordInitialDesignProposal?: (command: import("../human-role-collaboration.js").RecordInitialDesignProposalCommand) => import("../human-role-collaboration.js").RecordInitialDesignProposalReceipt | Promise<import("../human-role-collaboration.js").RecordInitialDesignProposalReceipt>;
      recordInitialDesignDecision?: (command: import("../human-role-collaboration.js").RecordInitialDesignDecisionCommand) => import("../human-role-collaboration.js").RecordInitialDesignDecisionReceipt | Promise<import("../human-role-collaboration.js").RecordInitialDesignDecisionReceipt>;
      installCoordinationPolicy?: (command: import("../human-role-collaboration.js").InstallCoordinationPolicyCommand) => import("../human-role-collaboration.js").InstallCoordinationPolicyReceipt | Promise<import("../human-role-collaboration.js").InstallCoordinationPolicyReceipt>;
      activateCoordinationPolicy?: (command: import("../human-role-collaboration.js").ActivateCoordinationPolicyCommand) => import("../human-role-collaboration.js").ActivateCoordinationPolicyReceipt | Promise<import("../human-role-collaboration.js").ActivateCoordinationPolicyReceipt>;
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
  readonly submitControlCalls: import("../control-intent.js").SubmitControlCommand[] = [];
  readonly recordSafePointAckCalls: import("../control-intent.js").RecordSafePointAckCommand[] = [];

  async submitControl(command: import("../control-intent.js").SubmitControlCommand): Promise<import("../control-intent.js").SubmitControlReceipt> {
    this.submitControlCalls.push(command);
    if (this.options.submitControl) return this.options.submitControl(command);
    throw new Error("ScriptedControlEngine: no submitControl behavior configured");
  }

  async recordSafePointAck(command: import("../control-intent.js").RecordSafePointAckCommand): Promise<import("../control-intent.js").RecordSafePointAckReceipt> {
    this.recordSafePointAckCalls.push(command);
    if (this.options.recordSafePointAck) return this.options.recordSafePointAck(command);
    throw new Error("ScriptedControlEngine: no recordSafePointAck behavior configured");
  }

  readonly submitQueryJobCalls: import("../query-job.js").SubmitQueryJobCommand[] = [];
  readonly recordQueryAnswerCalls: import("../query-job.js").RecordQueryAnswerCommand[] = [];
  readonly closeQueryJobCalls: import("../query-job.js").CloseQueryJobCommand[] = [];

  async submitQueryJob(command: import("../query-job.js").SubmitQueryJobCommand): Promise<import("../query-job.js").SubmitQueryJobReceipt> {
    this.submitQueryJobCalls.push(command);
    if (this.options.submitQueryJob) return this.options.submitQueryJob(command);
    throw new Error("ScriptedControlEngine: no submitQueryJob behavior configured");
  }

  async recordQueryAnswer(command: import("../query-job.js").RecordQueryAnswerCommand): Promise<import("../query-job.js").RecordQueryAnswerReceipt> {
    this.recordQueryAnswerCalls.push(command);
    if (this.options.recordQueryAnswer) return this.options.recordQueryAnswer(command);
    throw new Error("ScriptedControlEngine: no recordQueryAnswer behavior configured");
  }

  async closeQueryJob(command: import("../query-job.js").CloseQueryJobCommand): Promise<import("../query-job.js").CloseQueryJobReceipt> {
    this.closeQueryJobCalls.push(command);
    if (this.options.closeQueryJob) return this.options.closeQueryJob(command);
    throw new Error("ScriptedControlEngine: no closeQueryJob behavior configured");
  }

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

  // P1-11 (scripted double: records calls; behaviors configured per test)      //

  readonly recordPlanChangeProposalCalls: import("../goal-change.js").RecordPlanChangeProposalCommand[] = [];
  readonly recordUserDecisionCalls: import("../goal-change.js").RecordUserDecisionCommand[] = [];
  readonly applyPlanChangeCalls: import("../goal-change.js").ApplyPlanChangeCommand[] = [];

  async recordPlanChangeProposal(command: import("../goal-change.js").RecordPlanChangeProposalCommand): Promise<import("../goal-change.js").RecordPlanChangeProposalReceipt> {
    this.recordPlanChangeProposalCalls.push(command);
    if (this.options.recordPlanChangeProposal) return this.options.recordPlanChangeProposal(command);
    throw new Error("ScriptedControlEngine: no recordPlanChangeProposal behavior configured");
  }

  async recordUserDecision(command: import("../goal-change.js").RecordUserDecisionCommand): Promise<import("../goal-change.js").RecordUserDecisionReceipt> {
    this.recordUserDecisionCalls.push(command);
    if (this.options.recordUserDecision) return this.options.recordUserDecision(command);
    throw new Error("ScriptedControlEngine: no recordUserDecision behavior configured");
  }

  async applyPlanChange(command: import("../goal-change.js").ApplyPlanChangeCommand): Promise<import("../goal-change.js").ApplyPlanChangeReceipt> {
    this.applyPlanChangeCalls.push(command);
    if (this.options.applyPlanChange) return this.options.applyPlanChange(command);
    throw new Error("ScriptedControlEngine: no applyPlanChange behavior configured");
  }

  // P1-13 (scripted double: records calls; behaviors configured per test)      //

  readonly installArchitectureEvolutionPolicyCalls: import("../architecture-evolution-policy.js").InstallArchitectureEvolutionPolicyRevisionCommand[] = [];
  readonly activateArchitectureEvolutionPolicyCalls: import("../architecture-evolution-policy.js").ActivateProjectArchitectureEvolutionPolicyCommand[] = [];
  readonly submitRemediationPlanPatchCalls: import("../remediation.js").SubmitRemediationPlanPatchCommand[] = [];
  readonly createRemediationTaskCalls: import("../remediation.js").CreateRemediationTaskCommand[] = [];
  readonly advanceRemediationTaskCalls: import("../remediation.js").AdvanceRemediationTaskCommand[] = [];

  async installArchitectureEvolutionPolicy(command: import("../architecture-evolution-policy.js").InstallArchitectureEvolutionPolicyRevisionCommand): Promise<import("../architecture-evolution-policy.js").ArchitectureEvolutionPolicyInstallReceipt> {
    this.installArchitectureEvolutionPolicyCalls.push(command);
    if (this.options.installArchitectureEvolutionPolicy) return this.options.installArchitectureEvolutionPolicy(command);
    throw new Error("ScriptedControlEngine: no installArchitectureEvolutionPolicy behavior configured");
  }

  async activateArchitectureEvolutionPolicy(command: import("../architecture-evolution-policy.js").ActivateProjectArchitectureEvolutionPolicyCommand): Promise<import("../architecture-evolution-policy.js").ArchitectureEvolutionPolicyActivateReceipt> {
    this.activateArchitectureEvolutionPolicyCalls.push(command);
    if (this.options.activateArchitectureEvolutionPolicy) return this.options.activateArchitectureEvolutionPolicy(command);
    throw new Error("ScriptedControlEngine: no activateArchitectureEvolutionPolicy behavior configured");
  }

  async submitRemediationPlanPatch(command: import("../remediation.js").SubmitRemediationPlanPatchCommand): Promise<import("../remediation.js").SubmitRemediationPlanPatchReceipt> {
    this.submitRemediationPlanPatchCalls.push(command);
    if (this.options.submitRemediationPlanPatch) return this.options.submitRemediationPlanPatch(command);
    throw new Error("ScriptedControlEngine: no submitRemediationPlanPatch behavior configured");
  }

  async createRemediationTask(command: import("../remediation.js").CreateRemediationTaskCommand): Promise<import("../remediation.js").CreateRemediationTaskReceipt> {
    this.createRemediationTaskCalls.push(command);
    if (this.options.createRemediationTask) return this.options.createRemediationTask(command);
    throw new Error("ScriptedControlEngine: no createRemediationTask behavior configured");
  }

  async advanceRemediationTask(command: import("../remediation.js").AdvanceRemediationTaskCommand): Promise<import("../remediation.js").AdvanceRemediationTaskReceipt> {
    this.advanceRemediationTaskCalls.push(command);
    if (this.options.advanceRemediationTask) return this.options.advanceRemediationTask(command);
    throw new Error("ScriptedControlEngine: no advanceRemediationTask behavior configured");
  }

  // P1-14 (scripted double: records calls; behaviors configured per test)      //

  readonly materializeCandidateBaselineCalls: import("../baseline-evolution.js").MaterializeCandidateBaselineCommand[] = [];
  readonly recordArchitectureChangeDecisionCalls: import("../baseline-evolution.js").RecordArchitectureChangeDecisionCommand[] = [];
  readonly recordMigrationGateCalls: import("../baseline-evolution.js").RecordMigrationGateCommand[] = [];
  readonly recordBaselineActivationCalls: import("../baseline-evolution.js").RecordBaselineActivationCommand[] = [];

  async materializeCandidateBaseline(command: import("../baseline-evolution.js").MaterializeCandidateBaselineCommand): Promise<import("../baseline-evolution.js").MaterializeCandidateBaselineReceipt> {
    this.materializeCandidateBaselineCalls.push(command);
    if (this.options.materializeCandidateBaseline) return this.options.materializeCandidateBaseline(command);
    throw new Error("ScriptedControlEngine: no materializeCandidateBaseline behavior configured");
  }
  async recordArchitectureChangeDecision(command: import("../baseline-evolution.js").RecordArchitectureChangeDecisionCommand): Promise<import("../baseline-evolution.js").RecordArchitectureChangeDecisionReceipt> {
    this.recordArchitectureChangeDecisionCalls.push(command);
    if (this.options.recordArchitectureChangeDecision) return this.options.recordArchitectureChangeDecision(command);
    throw new Error("ScriptedControlEngine: no recordArchitectureChangeDecision behavior configured");
  }
  async recordMigrationGate(command: import("../baseline-evolution.js").RecordMigrationGateCommand): Promise<import("../baseline-evolution.js").RecordMigrationGateReceipt> {
    this.recordMigrationGateCalls.push(command);
    if (this.options.recordMigrationGate) return this.options.recordMigrationGate(command);
    throw new Error("ScriptedControlEngine: no recordMigrationGate behavior configured");
  }
  async recordBaselineActivation(command: import("../baseline-evolution.js").RecordBaselineActivationCommand): Promise<import("../baseline-evolution.js").RecordBaselineActivationReceipt> {
    this.recordBaselineActivationCalls.push(command);
    if (this.options.recordBaselineActivation) return this.options.recordBaselineActivation(command);
    throw new Error("ScriptedControlEngine: no recordBaselineActivation behavior configured");
  }

  // P1-15 (scripted double: records calls; behaviors configured per test)      //

  readonly recordInitialDesignProposalCalls: import("../human-role-collaboration.js").RecordInitialDesignProposalCommand[] = [];
  readonly recordInitialDesignDecisionCalls: import("../human-role-collaboration.js").RecordInitialDesignDecisionCommand[] = [];
  readonly installCoordinationPolicyCalls: import("../human-role-collaboration.js").InstallCoordinationPolicyCommand[] = [];
  readonly activateCoordinationPolicyCalls: import("../human-role-collaboration.js").ActivateCoordinationPolicyCommand[] = [];

  async recordInitialDesignProposal(command: import("../human-role-collaboration.js").RecordInitialDesignProposalCommand): Promise<import("../human-role-collaboration.js").RecordInitialDesignProposalReceipt> {
    this.recordInitialDesignProposalCalls.push(command);
    if (this.options.recordInitialDesignProposal) return this.options.recordInitialDesignProposal(command);
    throw new Error("ScriptedControlEngine: no recordInitialDesignProposal behavior configured");
  }
  async recordInitialDesignDecision(command: import("../human-role-collaboration.js").RecordInitialDesignDecisionCommand): Promise<import("../human-role-collaboration.js").RecordInitialDesignDecisionReceipt> {
    this.recordInitialDesignDecisionCalls.push(command);
    if (this.options.recordInitialDesignDecision) return this.options.recordInitialDesignDecision(command);
    throw new Error("ScriptedControlEngine: no recordInitialDesignDecision behavior configured");
  }
  async installCoordinationPolicy(command: import("../human-role-collaboration.js").InstallCoordinationPolicyCommand): Promise<import("../human-role-collaboration.js").InstallCoordinationPolicyReceipt> {
    this.installCoordinationPolicyCalls.push(command);
    if (this.options.installCoordinationPolicy) return this.options.installCoordinationPolicy(command);
    throw new Error("ScriptedControlEngine: no installCoordinationPolicy behavior configured");
  }
  async activateCoordinationPolicy(command: import("../human-role-collaboration.js").ActivateCoordinationPolicyCommand): Promise<import("../human-role-collaboration.js").ActivateCoordinationPolicyReceipt> {
    this.activateCoordinationPolicyCalls.push(command);
    if (this.options.activateCoordinationPolicy) return this.options.activateCoordinationPolicy(command);
    throw new Error("ScriptedControlEngine: no activateCoordinationPolicy behavior configured");
  }
}