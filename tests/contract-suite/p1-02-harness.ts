/**
 * Shared P1-02 contract-suite harness contract: the suites drive the FULL
 * real path (ControlEngine + StateLedger + ReadModelIndex) so they pass
 * against the InMemory implementation AND the SQLite implementation with the
 * SAME fixtures and assertions (no per-adapter tuning).
 */
import type { WorkspaceBootstrapCommand, WorkspaceBootstrapReceipt } from "../../src/contracts/bootstrap.js";
import type { CommitCursor } from "../../src/contracts/command-event.js";
import type { ProjectionReceipt, ReadModelIndex } from "../../src/contracts/goal-view.js";
import type { StateLedger } from "../../src/contracts/ledger.js";
import type {
  GovernanceActivateCommand,
  GovernanceActivateReceipt,
  GovernanceInstallCommand,
  GovernanceInstallReceipt,
} from "../../src/contracts/governance.js";
import type { ApplyPlanRevisionCommand, PlanRevisionReceipt } from "../../src/contracts/plan.js";
import type {
  PlanGraphViewQuery,
  PlanGraphViewResult,
  TaskDetailViewQuery,
  TaskDetailViewResult,
} from "../../src/contracts/plan-view.js";
import type { CreateGoalCommand, CommandReceipt } from "../../src/contracts/command-event.js";

export interface P1_02TestHarness {
  readonly ledger: StateLedger;
  readonly readModel: ReadModelIndex;
  bootstrap(command: WorkspaceBootstrapCommand): Promise<WorkspaceBootstrapReceipt>;
  submit(command: CreateGoalCommand): Promise<CommandReceipt>;
  install(command: GovernanceInstallCommand): Promise<GovernanceInstallReceipt>;
  activate(command: GovernanceActivateCommand): Promise<GovernanceActivateReceipt>;
  applyPlan(command: ApplyPlanRevisionCommand): Promise<PlanRevisionReceipt>;
  advanceProjection(): Promise<ProjectionReceipt>;
  observedCursor(): CommitCursor | null;
  planGraph(query: PlanGraphViewQuery): Promise<PlanGraphViewResult>;
  taskDetail(query: TaskDetailViewQuery): Promise<TaskDetailViewResult>;
  close?(): Promise<void>;
}

export type P1_02HarnessFactory = () => Promise<P1_02TestHarness>;

/** Build an install command from the shared fixture (convenience for suites). */
export function freshCommandId(prefix: string): string {
  return prefix + "-" + Math.random().toString(36).slice(2, 10);
}

export function freshCorrelationId(): string {
  return "corr-" + Math.random().toString(36).slice(2, 10);
}