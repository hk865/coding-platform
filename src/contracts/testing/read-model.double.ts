/** Consistent ReadModelIndex test double (used by HumanCollaboration tests). */
import type { EventPage } from "../ledger.js";
import type {
  GoalViewQuery,
  GoalViewResult,
  ProjectionReceipt,
  ReadModelIndex,
} from "../goal-view.js";
import type {
  PlanGraphViewQuery,
  PlanGraphViewResult,
  TaskDetailViewQuery,
  TaskDetailViewResult,
} from "../plan-view.js";
import type {
  ActiveAgentQuery,
  ActiveAgentViewResult,
} from "../active-agent.js";
import type {
  GoalStatusQuery,
  GoalStatusViewResult,
  GoalTimelineQuery,
  GoalTimelineViewResult,
} from "../goal-phase-view.js";
import type { HandoffProvenanceViewQuery, HandoffProvenanceViewResult } from "../handoff-view.js";
import type { WorkspaceLeaseViewQuery, WorkspaceLeaseViewResult, IntegrationConflictViewQuery, IntegrationConflictViewResult, WorkspacePatchViewQuery, WorkspacePatchViewResult } from "../workspace-views.js";

export type AdvanceBehavior = (
  page: EventPage,
) => Promise<ProjectionReceipt> | ProjectionReceipt;
export type GoalBehavior = (
  query: GoalViewQuery,
) => Promise<GoalViewResult> | GoalViewResult;
export type PlanGraphBehavior = (
  query: PlanGraphViewQuery,
) => Promise<PlanGraphViewResult> | PlanGraphViewResult;
export type TaskDetailBehavior = (
  query: TaskDetailViewQuery,
) => Promise<TaskDetailViewResult> | TaskDetailViewResult;
export type ActiveAgentBehavior = (
  query: ActiveAgentQuery,
) => Promise<ActiveAgentViewResult> | ActiveAgentViewResult;
export type GoalStatusBehavior = (
  query: GoalStatusQuery,
) => Promise<GoalStatusViewResult> | GoalStatusViewResult;
export type GoalTimelineBehavior = (
  query: GoalTimelineQuery,
) => Promise<GoalTimelineViewResult> | GoalTimelineViewResult;
export type HandoffProvenanceBehavior = (
  query: HandoffProvenanceViewQuery,
) => Promise<HandoffProvenanceViewResult> | HandoffProvenanceViewResult;
export type WorkspaceLeaseViewBehavior = (
  query: WorkspaceLeaseViewQuery,
) => Promise<WorkspaceLeaseViewResult> | WorkspaceLeaseViewResult;
export type IntegrationConflictViewBehavior = (
  query: IntegrationConflictViewQuery,
) => Promise<IntegrationConflictViewResult> | IntegrationConflictViewResult;
export type WorkspacePatchViewBehavior = (
  query: WorkspacePatchViewQuery,
) => Promise<WorkspacePatchViewResult> | WorkspacePatchViewResult;
export type WorkContextBehavior = (
  query: import("../context-continuity.js").WorkContextViewQuery,
) => Promise<import("../context-continuity.js").WorkContextViewResult> | import("../context-continuity.js").WorkContextViewResult;
export type ControlTimelineViewBehavior = (
  query: import("../control-intent.js").ControlTimelineViewQuery,
) => Promise<import("../control-intent.js").ControlTimelineViewResult> | import("../control-intent.js").ControlTimelineViewResult;
export type CompletedWorkViewBehavior = (
  query: import("../completed-work-context.js").CompletedWorkViewQuery,
) => Promise<import("../completed-work-context.js").CompletedWorkViewResult> | import("../completed-work-context.js").CompletedWorkViewResult;
export type ArchitectureInspectionViewBehavior = (
  query: import("../architecture-inspection.js").ArchitectureInspectionViewQuery,
) => Promise<import("../architecture-inspection.js").ArchitectureInspectionViewResult> | import("../architecture-inspection.js").ArchitectureInspectionViewResult;

export class ScriptedReadModelIndex implements ReadModelIndex {
  readonly advanceCalls: EventPage[] = [];
  readonly consolePortfolioCalls: import("../console-views.js").PortfolioViewQuery[] = [];
  readonly consoleSummaryCalls: import("../console-views.js").WorkspaceSummaryViewQuery[] = [];
  readonly consolePlanMatrixCalls: import("../console-views.js").PlanMatrixViewQuery[] = [];
  readonly consoleActiveAgentsCalls: import("../console-views.js").ActiveAgentsViewQuery[] = [];
  readonly consoleTaskEvidenceCalls: import("../console-views.js").TaskEvidenceViewQuery[] = [];
  readonly consoleTimelineCalls: import("../console-views.js").TimelineViewQuery[] = [];
  readonly goalCalls: GoalViewQuery[] = [];
  readonly planGraphCalls: PlanGraphViewQuery[] = [];
  readonly taskDetailCalls: TaskDetailViewQuery[] = [];
  readonly activeAgentCalls: ActiveAgentQuery[] = [];
  readonly goalStatusCalls: GoalStatusQuery[] = [];
  readonly goalTimelineCalls: GoalTimelineQuery[] = [];
  readonly handoffProvenanceCalls: HandoffProvenanceViewQuery[] = [];
  readonly workspaceLeaseViewCalls: WorkspaceLeaseViewQuery[] = [];
  readonly integrationConflictsCalls: IntegrationConflictViewQuery[] = [];
  readonly workspacePatchesCalls: WorkspacePatchViewQuery[] = [];
  readonly workContextCalls: import("../context-continuity.js").WorkContextViewQuery[] = [];
  readonly architectureInspectionViewCalls: import("../architecture-inspection.js").ArchitectureInspectionViewQuery[] = [];
  readonly completedWorkViewCalls: import("../completed-work-context.js").CompletedWorkViewQuery[] = [];
  readonly controlTimelineViewCalls: import("../control-intent.js").ControlTimelineViewQuery[] = [];

  constructor(
    private readonly options: {
      advance?: AdvanceBehavior;
      goal?: GoalBehavior;
      planGraph?: PlanGraphBehavior;
      taskDetail?: TaskDetailBehavior;
      activeAgent?: ActiveAgentBehavior;
      goalStatus?: GoalStatusBehavior;
      goalTimeline?: GoalTimelineBehavior;
      handoffProvenance?: HandoffProvenanceBehavior;
      workspaceLeaseView?: WorkspaceLeaseViewBehavior;
      integrationConflicts?: IntegrationConflictViewBehavior;
      workspacePatches?: WorkspacePatchViewBehavior;
      workContext?: WorkContextBehavior;
      architectureInspectionView?: ArchitectureInspectionViewBehavior;
      completedWorkView?: CompletedWorkViewBehavior;
      controlTimelineView?: ControlTimelineViewBehavior;
      consolePortfolio?: import("../console-views.js").PortfolioViewResult extends never ? never : (query: import("../console-views.js").PortfolioViewQuery) => Promise<import("../console-views.js").PortfolioViewResult> | import("../console-views.js").PortfolioViewResult;
      consoleSummary?: (query: import("../console-views.js").WorkspaceSummaryViewQuery) => Promise<import("../console-views.js").WorkspaceSummaryViewResult> | import("../console-views.js").WorkspaceSummaryViewResult;
      consolePlanMatrix?: (query: import("../console-views.js").PlanMatrixViewQuery) => Promise<import("../console-views.js").PlanMatrixViewResult> | import("../console-views.js").PlanMatrixViewResult;
      consoleActiveAgents?: (query: import("../console-views.js").ActiveAgentsViewQuery) => Promise<import("../console-views.js").ActiveAgentsViewResult> | import("../console-views.js").ActiveAgentsViewResult;
      consoleTaskEvidence?: (query: import("../console-views.js").TaskEvidenceViewQuery) => Promise<import("../console-views.js").TaskEvidenceViewResult> | import("../console-views.js").TaskEvidenceViewResult;
      consoleTimeline?: (query: import("../console-views.js").TimelineViewQuery) => Promise<import("../console-views.js").TimelineViewResult> | import("../console-views.js").TimelineViewResult;
    } = {},
  ) {}

  async advance(page: EventPage): Promise<ProjectionReceipt> {
    this.advanceCalls.push(page);
    if (this.options.advance) return this.options.advance(page);
    return {
      throughCursor: page.throughCursor,
      appliedEventIds: page.events.map((p) => p.event.eventId),
    };
  }

  async goal(query: GoalViewQuery): Promise<GoalViewResult> {
    this.goalCalls.push(query);
    if (this.options.goal) return this.options.goal(query);
    return { status: "not_found", observedCursor: null };
  }

  async planGraph(query: PlanGraphViewQuery): Promise<PlanGraphViewResult> {
    this.planGraphCalls.push(query);
    if (this.options.planGraph) return this.options.planGraph(query);
    return { status: "not_found", observedCursor: null };
  }

  async taskDetail(query: TaskDetailViewQuery): Promise<TaskDetailViewResult> {
    this.taskDetailCalls.push(query);
    if (this.options.taskDetail) return this.options.taskDetail(query);
    return { status: "not_found", observedCursor: null };
  }

  async activeAgent(query: ActiveAgentQuery): Promise<ActiveAgentViewResult> {
    this.activeAgentCalls.push(query);
    if (this.options.activeAgent) return this.options.activeAgent(query);
    return { status: "not_found", observedCursor: null };
  }

  async goalStatus(query: GoalStatusQuery): Promise<GoalStatusViewResult> {
    this.goalStatusCalls.push(query);
    if (this.options.goalStatus) return this.options.goalStatus(query);
    return { status: "not_found", observedCursor: null };
  }

  async goalTimeline(query: GoalTimelineQuery): Promise<GoalTimelineViewResult> {
    this.goalTimelineCalls.push(query);
    if (this.options.goalTimeline) return this.options.goalTimeline(query);
    return { status: "not_found", observedCursor: null };
  }

  async handoffProvenance(query: HandoffProvenanceViewQuery): Promise<HandoffProvenanceViewResult> {
    this.handoffProvenanceCalls.push(query);
    if (this.options.handoffProvenance) return this.options.handoffProvenance(query);
    return { status: "not_found", observedCursor: (null as unknown) as import("../command-event.js").CommitCursor };
  }

  // P1-07 views (scripted)                                                     //

  async workspaceLeaseView(query: WorkspaceLeaseViewQuery): Promise<WorkspaceLeaseViewResult> {
    this.workspaceLeaseViewCalls.push(query);
    if (this.options.workspaceLeaseView) return this.options.workspaceLeaseView(query);
    return { status: "not_found", observedCursor: (null as unknown) as import("../command-event.js").CommitCursor };
  }

  async integrationConflicts(query: IntegrationConflictViewQuery): Promise<IntegrationConflictViewResult> {
    this.integrationConflictsCalls.push(query);
    if (this.options.integrationConflicts) return this.options.integrationConflicts(query);
    return { status: "not_found", observedCursor: (null as unknown) as import("../command-event.js").CommitCursor };
  }

  async workspacePatches(query: WorkspacePatchViewQuery): Promise<WorkspacePatchViewResult> {
    this.workspacePatchesCalls.push(query);
    if (this.options.workspacePatches) return this.options.workspacePatches(query);
    return { status: "not_found", observedCursor: (null as unknown) as import("../command-event.js").CommitCursor };
  }

  // P1-16 work context view (scripted)                                       //

  async workContext(query: import("../context-continuity.js").WorkContextViewQuery): Promise<import("../context-continuity.js").WorkContextViewResult> {
    this.workContextCalls.push(query);
    if (this.options.workContext) return this.options.workContext(query);
    return { status: "not_found", projectId: query.projectId, workspaceId: query.workspaceId, workId: query.workId };
  }

  async architectureInspectionView(query: import("../architecture-inspection.js").ArchitectureInspectionViewQuery): Promise<import("../architecture-inspection.js").ArchitectureInspectionViewResult> {
    this.architectureInspectionViewCalls.push(query);
    if (this.options.architectureInspectionView) return this.options.architectureInspectionView(query);
    return { status: "not_found", projectId: query.projectId, workspaceId: query.workspaceId };
  }

  async completedWorkView(query: import("../completed-work-context.js").CompletedWorkViewQuery): Promise<import("../completed-work-context.js").CompletedWorkViewResult> {
    this.completedWorkViewCalls.push(query);
    if (this.options.completedWorkView) return this.options.completedWorkView(query);
    return { status: "not_found", projectId: query.projectId, workspaceId: query.workspaceId };
  }

  async controlTimelineView(query: import("../control-intent.js").ControlTimelineViewQuery): Promise<import("../control-intent.js").ControlTimelineViewResult> {
    this.controlTimelineViewCalls.push(query);
    if (this.options.controlTimelineView) return this.options.controlTimelineView(query);
    return { status: "not_found", projectId: query.projectId, workspaceId: query.workspaceId };
  }

  // P1-08 console views (scripted)                                           //

  async consolePortfolio(query: import("../console-views.js").PortfolioViewQuery): Promise<import("../console-views.js").PortfolioViewResult> {
    this.consolePortfolioCalls.push(query);
    if (this.options.consolePortfolio) return this.options.consolePortfolio(query);
    return { status: "not_found", observedCursor: (null as unknown) as import("../command-event.js").CommitCursor };
  }

  async consoleSummary(query: import("../console-views.js").WorkspaceSummaryViewQuery): Promise<import("../console-views.js").WorkspaceSummaryViewResult> {
    this.consoleSummaryCalls.push(query);
    if (this.options.consoleSummary) return this.options.consoleSummary(query);
    return { status: "not_found", observedCursor: (null as unknown) as import("../command-event.js").CommitCursor };
  }

  async consolePlanMatrix(query: import("../console-views.js").PlanMatrixViewQuery): Promise<import("../console-views.js").PlanMatrixViewResult> {
    this.consolePlanMatrixCalls.push(query);
    if (this.options.consolePlanMatrix) return this.options.consolePlanMatrix(query);
    return { status: "not_found", observedCursor: (null as unknown) as import("../command-event.js").CommitCursor };
  }

  async consoleActiveAgents(query: import("../console-views.js").ActiveAgentsViewQuery): Promise<import("../console-views.js").ActiveAgentsViewResult> {
    this.consoleActiveAgentsCalls.push(query);
    if (this.options.consoleActiveAgents) return this.options.consoleActiveAgents(query);
    return { status: "not_found", observedCursor: (null as unknown) as import("../command-event.js").CommitCursor };
  }

  async consoleTaskEvidence(query: import("../console-views.js").TaskEvidenceViewQuery): Promise<import("../console-views.js").TaskEvidenceViewResult> {
    this.consoleTaskEvidenceCalls.push(query);
    if (this.options.consoleTaskEvidence) return this.options.consoleTaskEvidence(query);
    return { status: "not_found", observedCursor: (null as unknown) as import("../command-event.js").CommitCursor };
  }

  async consoleTimeline(query: import("../console-views.js").TimelineViewQuery): Promise<import("../console-views.js").TimelineViewResult> {
    this.consoleTimelineCalls.push(query);
    if (this.options.consoleTimeline) return this.options.consoleTimeline(query);
    return { status: "not_found", observedCursor: (null as unknown) as import("../command-event.js").CommitCursor };
  }
}
