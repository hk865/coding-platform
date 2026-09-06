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
import type {
  DispatchClaimCommand,
  DispatchClaimReceipt,
  DispatchReadinessQuery,
  DispatchReadinessResult,
  DispatchStartCommand,
  DispatchStartReceipt,
  RunFactCommand,
  RunFactReceipt,
} from "./dispatch.js";
import type { SubmitEvidenceCommand, SubmitEvidenceReceipt } from "./evidence.js";
import type { ReduceTaskCommand, ReduceTaskReceipt } from "./reduction.js";
import type { ReduceGoalCommand, ReduceGoalReceipt } from "./goal-phase.js";
import type {
  ClaimReplacementCommand,
  ClaimReplacementReceipt,
  RecordHandoffCommand,
  RecordHandoffReceipt,
} from "./handoff.js";

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
  /** P1-03: read-only eligibility evaluation (zero writes). */
  dispatchReadiness(query: DispatchReadinessQuery): Promise<DispatchReadinessResult>;
  /** P1-03: unique claim — durable outbox intent + lease + attempt + run (atomic). */
  claimTask(command: DispatchClaimCommand): Promise<DispatchClaimReceipt>;
  /** P1-03: record the bounded envelope and mark the outbox intent started (CAS). */
  startRun(command: DispatchStartCommand): Promise<DispatchStartReceipt>;
  /** P1-03: ingest one runtime fact — no regress, crash != outcome_unknown. */
  runFact(command: RunFactCommand): Promise<RunFactReceipt>;
  /** P1-04: admit ONE immutable evidence record + binding anchor (atomic; full idempotency). */
  submitEvidence(command: SubmitEvidenceCommand): Promise<SubmitEvidenceReceipt>;
  /** P1-04: deterministic Task/Gate reduction — the ONLY writer of the canonical
   * TaskReduction phase (never Goal phase — P1-05). */
  reduceTask(command: ReduceTaskCommand): Promise<ReduceTaskReceipt>;
  /** P1-05: deterministic Goal phase reduction — the ONLY writer of the canonical
   * GoalPhase (never a Task phase; P1-06+ mechanisms are NOT implemented here). */
  reduceGoal(command: ReduceGoalCommand): Promise<ReduceGoalReceipt>;
  /** P1-06: register a bounded HandoffPacket (body-first; immutable aggregate). */
  recordHandoff(command: RecordHandoffCommand): Promise<RecordHandoffReceipt>;
  /** P1-06: replacement claim — B's NEW attempt/run lifecycle for the SAME Task
   * (lease CAS; only after A ended or A's lease expired; no Goal/phase writes). */
  claimReplacement(command: ClaimReplacementCommand): Promise<ClaimReplacementReceipt>;
}

export interface HumanCollaboration {
  createGoal(request: CreateGoalRequest): Promise<CreateGoalResult>;
  goalView(query: GoalViewQuery): Promise<GoalViewResult>;
}