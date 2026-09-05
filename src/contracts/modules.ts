/**
 * Module interfaces for P1-00 participants.
 * Authority: modules/control/control-engine.md, modules/interaction/human-collaboration.md.
 * P1-00 extension: ControlEngine.bootstrap (versioned addition; submit shape unchanged).
 * P1-02 extension: ControlEngine.install / activate / applyPlan (versioned
 * additions; submit & bootstrap shapes unchanged). Governance and Plan
 * command types come from ./governance.js and ./plan.js.
 */
import type {
  ActorRef,
  CommandReceipt,
  CommitCursor,
  CreateGoalCommand,
} from "./command-event.js";
import type { WorkspaceBootstrapCommand, WorkspaceBootstrapReceipt } from "./bootstrap.js";
import type { GoalViewQuery, GoalViewResult } from "./goal-view.js";
import type {
  GovernanceActivateCommand,
  GovernanceActivateReceipt,
  GovernanceInstallCommand,
  GovernanceInstallReceipt,
} from "./governance.js";
import type { ApplyPlanRevisionCommand, PlanRevisionReceipt } from "./plan.js";

export type CreateGoalRequest = {
  projectId: string;
  workspaceId: string;
  goalId: string;
  objective: string;
  actor: ActorRef;
  idempotencyKey: string;
};

export type UserFacingRejectionCode =
  | "invalid_request"
  | "scope_not_found"
  | "conflict"
  | "temporarily_unavailable";

export type CreateGoalResult =
  | { status: "persisted"; goalId: string; commitCursor: CommitCursor }
  | { status: "rejected"; code: UserFacingRejectionCode };

export interface ControlEngine {
  /** Goal create slice: unchanged shape. */
  submit(command: CreateGoalCommand): Promise<CommandReceipt>;
  /** P1-00 bootstrap extension: versioned addition to the interface. */
  bootstrap(command: WorkspaceBootstrapCommand): Promise<WorkspaceBootstrapReceipt>;
  /** P1-02: install an immutable governance revision (policy or baseline). */
  install(command: GovernanceInstallCommand): Promise<GovernanceInstallReceipt>;
  /** P1-02: CAS-activate an installed revision as the Project's per-kind active ref. */
  activate(command: GovernanceActivateCommand): Promise<GovernanceActivateReceipt>;
  /** P1-02: accept a hand-authored PlanRevision for an existing Goal. */
  applyPlan(command: ApplyPlanRevisionCommand): Promise<PlanRevisionReceipt>;
}

export interface HumanCollaboration {
  createGoal(request: CreateGoalRequest): Promise<CreateGoalResult>;
  goalView(query: GoalViewQuery): Promise<GoalViewResult>;
}
