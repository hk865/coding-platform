import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { RoleConfigurationRef, WorkspaceScope } from '../../contracts/core/identity.js';
import type { CoreRejection } from '../../contracts/core/results.js';
import type { RoleBindingRefV1, TaskBudgetV1 } from '../../contracts/dispatch.js';
import type { GoalTaskPort } from '../../core/work-graph/tasks/contracts.js';
import type { PlanTaskPort } from '../../core/work-graph/tasks/plan-contracts.js';
import type { SessionDirectoryPort } from '../../core/work-graph/sessions/contracts.js';
import type { TaskClaimPort } from '../../core/work-graph/tasks/claim-contracts.js';
import type { ExecutionReadPort } from '../../core/work-graph/tasks/execution-read-contracts.js';
import type { EvidencePort } from '../../core/work-graph/evidence/contracts.js';
import type { RuntimeExecutionPort } from '../../core/agent-runtime/ports.js';
import type { RegisteredCheckRunner } from '../../core/agent-runtime/check-execution.js';
import type { SourceSnapshotReads } from '../../core/work-graph/source-authority-ports.js';
import type { SessionMailboxPort } from '../../core/work-graph/communication/contracts.js';
import type { ProjectRegistrationPort } from '../../core/work-graph/configuration/project-bootstrap-contracts.js';
import type { QueryJobPort } from '../../core/work-graph/queries/contracts.js';
import type { ConsultationInput, ConsultationResult, InitialPlanningGoalInput, InitialPlanningGoalInputResult,
  N0GoalInput, WorkflowAdvanceInput, WorkflowAdvanceResult } from './contracts.js';

/**
 * Trusted Host advancement policy. It is pure data snapshotted by the
 * composition root; it grants no model/tool/file capability. A missing binding
 * makes only fresh Session/execution selection fail as unsupported and never
 * changes the other platform ports.
 */
export type WorkflowHostConfiguration = {
  consumerId: string;
  bindings: readonly {
    workspace: WorkspaceScope;
    sessionRole: RoleConfigurationRef;
    roleBinding: RoleBindingRefV1;
    budget: TaskBudgetV1;
  }[];
};

/**
 * The exact owners the Workflow composes. It reads and calls only these ports;
 * it owns no Store, no second database and no model loop. `sourceAuthority` is
 * the already-assembled exact Workspace revision reader used to build the real
 * claim pins.
 */
export type WorkflowDependencies = {
  tasks: GoalTaskPort;
  plans: PlanTaskPort;
  sessions: SessionDirectoryPort;
  claims: TaskClaimPort;
  executions: ExecutionReadPort;
  runtime: RuntimeExecutionPort;
  evidence: EvidencePort;
  checks: RegisteredCheckRunner;
  sourceAuthority: SourceSnapshotReads;
  configuration?: WorkflowHostConfiguration;
  /**
   * Optional explicit-consultation consumer dependencies. They reuse the SAME
   * mailbox/Query/Project owners; without them `consumeConsultation` is
   * explicitly unsupported and every other Workflow behavior is unchanged.
   */
  consultations?: ConsultationConsumerDependencies;
};

/**
 * The exact owners the explicit-consultation consumer composes. The mailbox
 * half is read-only except for the ONE Host-only `respondFromQueryAnswer`
 * association; the Query half is the accepted pending/claim/answer port.
 */
export type ConsultationConsumerDependencies = {
  messages: Pick<SessionMailboxPort, 'readMessage' | 'readMessageBody'>
    & Required<Pick<SessionMailboxPort, 'respondFromQueryAnswer' | 'recordConsultationDerivation'>>;
  queries: QueryJobPort;
  projects: ProjectRegistrationPort;
};

/**
 * `handleGoalInput` keeps its N0 shape/unsupported behaviour and adds the two
 * narrow R5b.4 initial-planning inputs. `advanceWork` is the finite R5c.1
 * advancement entry; each `perform` calls at most one owner.
 */
export interface WorkflowPort {
  handleGoalInput(ctx: CoreCallContext, input: N0GoalInput | InitialPlanningGoalInput): Promise<InitialPlanningGoalInputResult>;
  advanceWork(ctx: CoreCallContext, input: WorkflowAdvanceInput): Promise<WorkflowAdvanceResult>;
  /**
   * Explicitly process ONE received message: reuse the saved deterministic
   * Query/Answer first, otherwise run the finite submit/claim/prepare/start
   * chain and attach the formal Answer to the original message. No polling,
   * scheduler or background loop; absence keeps every existing Workflow
   * behavior and the type-compatible fixtures.
   */
  consumeConsultation?(ctx: CoreCallContext, input: ConsultationInput): Promise<ConsultationResult>;
}

/** Compatibility aliases pointing at the one narrow new surface. */
export type N0WorkflowPort = WorkflowPort;
export type N0WorkflowDependencies = WorkflowDependencies;
