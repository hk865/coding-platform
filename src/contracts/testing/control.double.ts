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

export class ScriptedControlEngine implements ControlEngine {
  readonly submitCalls: CreateGoalCommand[] = [];
  readonly bootstrapCalls: WorkspaceBootstrapCommand[] = [];
  readonly installCalls: GovernanceInstallCommand[] = [];
  readonly activateCalls: GovernanceActivateCommand[] = [];
  readonly applyPlanCalls: ApplyPlanRevisionCommand[] = [];

  constructor(
    private readonly options: {
      submit?: SubmitBehavior;
      bootstrap?: BootstrapBehavior;
      install?: InstallBehavior;
      activate?: ActivateBehavior;
      applyPlan?: ApplyPlanBehavior;
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
}