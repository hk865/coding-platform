/**
 * HumanCollaborationImpl — Goal create slice (Lane C, P1-00).
 * Authority: dev_docs/modules/interaction/human-collaboration.md +
 * dev_docs/interfaces/command-event.md + goal-view.md.
 *
 * Hidden implementation: CreateGoal command construction (schemaVersion 1,
 * expectedRevision 0, identity derived from the request), correlation
 * propagation, idempotency-key reuse, and the fixed Control->user rejection
 * mapping:
 *   invalid -> invalid_request
 *   not_found -> scope_not_found
 *   revision_conflict | idempotency_conflict -> conflict
 *   unavailable -> temporarily_unavailable
 *
 * Only a committed CommandReceipt maps to CreateGoalResult.persisted. Business
 * validation is delegated to Control; unexpected exceptions propagate rather
 * than being masked as a user-facing rejection.
 */
import type { CommandReceipt, CreateGoalCommand } from "../contracts/command-event.js";
import type {
  GoalViewQuery,
  GoalViewResult,
  ReadModelIndex,
} from "../contracts/goal-view.js";
import type {
  ControlEngine,
  CreateGoalRequest,
  CreateGoalResult,
  HumanCollaboration,
  UserFacingRejectionCode,
} from "../contracts/modules.js";

export interface HumanCollaborationDeps {
  control: ControlEngine;
  readModel: ReadModelIndex;
  commandId: () => string;
  correlationId: () => string;
  now: () => string;
}

export class HumanCollaborationImpl implements HumanCollaboration {
  constructor(private readonly deps: HumanCollaborationDeps) {}

  async createGoal(request: CreateGoalRequest): Promise<CreateGoalResult> {
    const command: CreateGoalCommand = {
      commandId: this.deps.commandId(),
      commandType: "CreateGoal",
      schemaVersion: 1,
      identity: {
        projectId: request.projectId,
        actor: { ...request.actor },
        idempotencyKey: request.idempotencyKey,
      },
      // goalId is a Project-local id; the full scope lives in identity.projectId.
      aggregateId: request.goalId,
      expectedRevision: 0,
      correlationId: this.deps.correlationId(),
      submittedAt: this.deps.now(),
      payload: {
        workspaceId: request.workspaceId,
        objective: request.objective,
      },
    };

    // Business validation is delegated to Control. Only committed maps to
    // persisted; a thrown exception is an unexpected internal error and
    // propagates (never a user-facing rejection).
    const receipt = await this.deps.control.submit(command);
    return this.mapToResult(receipt, request.goalId);
  }

  async goalView(query: GoalViewQuery): Promise<GoalViewResult> {
    return this.deps.readModel.goal(query);
  }

  // ------------------------------------------------------------------ //
  // P1-08 console query group (READ-ONLY face).                         //
  // Each method delegates exclusively to the ReadModelIndex — the       //
  // HumanCollaboration console path has NO access to the runtime/       //
  // control write face, never starts a model, never refreshes a lease   //
  // and never writes canonical state (ticket acceptance 6/8/9/12).      //
  // ------------------------------------------------------------------ //

  async consolePortfolio(query: import("../contracts/console-views.js").PortfolioViewQuery): Promise<import("../contracts/console-views.js").PortfolioViewResult> {
    return this.deps.readModel.consolePortfolio(query);
  }

  async consoleSummary(query: import("../contracts/console-views.js").WorkspaceSummaryViewQuery): Promise<import("../contracts/console-views.js").WorkspaceSummaryViewResult> {
    return this.deps.readModel.consoleSummary(query);
  }

  async consolePlanMatrix(query: import("../contracts/console-views.js").PlanMatrixViewQuery): Promise<import("../contracts/console-views.js").PlanMatrixViewResult> {
    return this.deps.readModel.consolePlanMatrix(query);
  }

  async consoleActiveAgents(query: import("../contracts/console-views.js").ActiveAgentsViewQuery): Promise<import("../contracts/console-views.js").ActiveAgentsViewResult> {
    return this.deps.readModel.consoleActiveAgents(query);
  }

  async consoleTaskEvidence(query: import("../contracts/console-views.js").TaskEvidenceViewQuery): Promise<import("../contracts/console-views.js").TaskEvidenceViewResult> {
    return this.deps.readModel.consoleTaskEvidence(query);
  }

  async consoleTimeline(query: import("../contracts/console-views.js").TimelineViewQuery): Promise<import("../contracts/console-views.js").TimelineViewResult> {
    return this.deps.readModel.consoleTimeline(query);
  }

  private mapToResult(receipt: CommandReceipt, goalId: string): CreateGoalResult {
    if (receipt.status === "committed") {
      return { status: "persisted", goalId, commitCursor: receipt.commitCursor };
    }
    return { status: "rejected", code: this.mapRejection(receipt.code) };
  }

  private mapRejection(
    code: "invalid" | "not_found" | "revision_conflict" | "idempotency_conflict" | "unavailable",
  ): UserFacingRejectionCode {
    switch (code) {
      case "invalid":
        return "invalid_request";
      case "not_found":
        return "scope_not_found";
      case "revision_conflict":
      case "idempotency_conflict":
        return "conflict";
      case "unavailable":
        return "temporarily_unavailable";
    }
  }
}

/** Factory matching the fixed lane-C entry point. */
export function createHumanCollaboration(
  deps: HumanCollaborationDeps,
): HumanCollaboration {
  return new HumanCollaborationImpl(deps);
}
