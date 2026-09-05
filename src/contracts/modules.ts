/**
 * Module interfaces for P1-00 participants.
 * Authority: modules/control/control-engine.md, modules/interaction/human-collaboration.md.
 * P1-00 extension: ControlEngine.bootstrap (versioned addition; submit shape unchanged).
 */
import type {
  ActorRef,
  CommandReceipt,
  CommitCursor,
  CreateGoalCommand,
} from "./command-event.js";
import type { WorkspaceBootstrapCommand, WorkspaceBootstrapReceipt } from "./bootstrap.js";
import type { GoalViewQuery, GoalViewResult } from "./goal-view.js";

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
}

export interface HumanCollaboration {
  createGoal(request: CreateGoalRequest): Promise<CreateGoalResult>;
  goalView(query: GoalViewQuery): Promise<GoalViewResult>;
}
