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
}