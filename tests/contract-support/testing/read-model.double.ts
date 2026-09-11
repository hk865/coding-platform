/** Consistent ReadModelIndex test double (used by HumanCollaboration tests). */
import type { EventPage } from "../../../src/contracts/ledger.js";
import type {
  GoalViewQuery,
  GoalViewResult,
  ProjectionReceipt,
  ReadModelIndex,
} from "../../../src/contracts/goal-view.js";
import type {
  PlanGraphViewQuery,
  PlanGraphViewResult,
  TaskDetailViewQuery,
  TaskDetailViewResult,
} from "../../../src/contracts/plan-view.js";
import type {
  ActiveAgentQuery,
  ActiveAgentViewResult,
} from "../../../src/contracts/active-agent.js";
import type {
  GoalStatusQuery,
  GoalStatusViewResult,
  GoalTimelineQuery,
  GoalTimelineViewResult,
} from "../../../src/contracts/goal-phase-view.js";
import type { HandoffProvenanceViewQuery, HandoffProvenanceViewResult } from "../../../src/contracts/handoff-view.js";
import type { WorkspaceLeaseViewQuery, WorkspaceLeaseViewResult, IntegrationConflictViewQuery, IntegrationConflictViewResult, WorkspacePatchViewQuery, WorkspacePatchViewResult } from "../../../src/contracts/workspace-views.js";

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
  query: import("../../../src/contracts/context-continuity.js").WorkContextViewQuery,
) => Promise<import("../../../src/contracts/context-continuity.js").WorkContextViewResult> | import("../../../src/contracts/context-continuity.js").WorkContextViewResult;
export type QueryJobViewBehavior = (
  query: import("../../../src/contracts/query-job.js").QueryJobViewQuery,
) => Promise<import("../../../src/contracts/query-job.js").QueryJobViewResult> | import("../../../src/contracts/query-job.js").QueryJobViewResult;
export type ControlTimelineViewBehavior = (
  query: import("../../../src/contracts/control-intent.js").ControlTimelineViewQuery,
) => Promise<import("../../../src/contracts/control-intent.js").ControlTimelineViewResult> | import("../../../src/contracts/control-intent.js").ControlTimelineViewResult;
export type CompletedWorkViewBehavior = (
  query: import("../../../src/contracts/completed-work-context.js").CompletedWorkViewQuery,
) => Promise<import("../../../src/contracts/completed-work-context.js").CompletedWorkViewResult> | import("../../../src/contracts/completed-work-context.js").CompletedWorkViewResult;
export type ArchitectureInspectionViewBehavior = (
  query: import("../../../src/contracts/architecture-inspection.js").ArchitectureInspectionViewQuery,
) => Promise<import("../../../src/contracts/architecture-inspection.js").ArchitectureInspectionViewResult> | import("../../../src/contracts/architecture-inspection.js").ArchitectureInspectionViewResult;

export class ScriptedReadModelIndex implements ReadModelIndex {
  readonly advanceCalls: EventPage[] = [];
  readonly consolePortfolioCalls: import("../../../src/contracts/console-views.js").PortfolioViewQuery[] = [];
  readonly consoleSummaryCalls: import("../../../src/contracts/console-views.js").WorkspaceSummaryViewQuery[] = [];
  readonly consolePlanMatrixCalls: import("../../../src/contracts/console-views.js").PlanMatrixViewQuery[] = [];
  readonly consoleActiveAgentsCalls: import("../../../src/contracts/console-views.js").ActiveAgentsViewQuery[] = [];
  readonly consoleTaskEvidenceCalls: import("../../../src/contracts/console-views.js").TaskEvidenceViewQuery[] = [];
  readonly consoleTimelineCalls: import("../../../src/contracts/console-views.js").TimelineViewQuery[] = [];
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
  readonly workContextCalls: import("../../../src/contracts/context-continuity.js").WorkContextViewQuery[] = [];
  readonly architectureInspectionViewCalls: import("../../../src/contracts/architecture-inspection.js").ArchitectureInspectionViewQuery[] = [];
  readonly completedWorkViewCalls: import("../../../src/contracts/completed-work-context.js").CompletedWorkViewQuery[] = [];
  readonly controlTimelineViewCalls: import("../../../src/contracts/control-intent.js").ControlTimelineViewQuery[] = [];
  readonly queryJobViewCalls: import("../../../src/contracts/query-job.js").QueryJobViewQuery[] = [];
  readonly planChangeViewCalls: import("../../../src/contracts/goal-change.js").PlanChangeViewQuery[] = [];
  readonly baselineChangeViewCalls: import("../../../src/contracts/baseline-evolution.js").BaselineChangeViewQuery[] = [];
  readonly unifiedStatusViewCalls: import("../../../src/contracts/human-role-collaboration.js").UnifiedStatusViewQuery[] = [];
  readonly materialAccessGrantsCalls: import("../../../src/contracts/material-access.js").MaterialAccessGrantViewQuery[] = [];

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
      queryJobView?: QueryJobViewBehavior;
      planChangeView?: (query: import("../../../src/contracts/goal-change.js").PlanChangeViewQuery) => Promise<import("../../../src/contracts/goal-change.js").PlanChangeViewResult> | import("../../../src/contracts/goal-change.js").PlanChangeViewResult;
      baselineChangeView?: (query: import("../../../src/contracts/baseline-evolution.js").BaselineChangeViewQuery) => Promise<import("../../../src/contracts/baseline-evolution.js").BaselineChangeViewResult> | import("../../../src/contracts/baseline-evolution.js").BaselineChangeViewResult;
      unifiedStatusView?: (query: import("../../../src/contracts/human-role-collaboration.js").UnifiedStatusViewQuery) => Promise<import("../../../src/contracts/human-role-collaboration.js").UnifiedStatusViewResult> | import("../../../src/contracts/human-role-collaboration.js").UnifiedStatusViewResult;
      materialAccessGrants?: (query: import("../../../src/contracts/material-access.js").MaterialAccessGrantViewQuery) => Promise<import("../../../src/contracts/material-access.js").MaterialAccessGrantViewResult> | import("../../../src/contracts/material-access.js").MaterialAccessGrantViewResult;
      consolePortfolio?: import("../../../src/contracts/console-views.js").PortfolioViewResult extends never ? never : (query: import("../../../src/contracts/console-views.js").PortfolioViewQuery) => Promise<import("../../../src/contracts/console-views.js").PortfolioViewResult> | import("../../../src/contracts/console-views.js").PortfolioViewResult;
      consoleSummary?: (query: import("../../../src/contracts/console-views.js").WorkspaceSummaryViewQuery) => Promise<import("../../../src/contracts/console-views.js").WorkspaceSummaryViewResult> | import("../../../src/contracts/console-views.js").WorkspaceSummaryViewResult;
      consolePlanMatrix?: (query: import("../../../src/contracts/console-views.js").PlanMatrixViewQuery) => Promise<import("../../../src/contracts/console-views.js").PlanMatrixViewResult> | import("../../../src/contracts/console-views.js").PlanMatrixViewResult;
      consoleActiveAgents?: (query: import("../../../src/contracts/console-views.js").ActiveAgentsViewQuery) => Promise<import("../../../src/contracts/console-views.js").ActiveAgentsViewResult> | import("../../../src/contracts/console-views.js").ActiveAgentsViewResult;
      consoleTaskEvidence?: (query: import("../../../src/contracts/console-views.js").TaskEvidenceViewQuery) => Promise<import("../../../src/contracts/console-views.js").TaskEvidenceViewResult> | import("../../../src/contracts/console-views.js").TaskEvidenceViewResult;
      consoleTimeline?: (query: import("../../../src/contracts/console-views.js").TimelineViewQuery) => Promise<import("../../../src/contracts/console-views.js").TimelineViewResult> | import("../../../src/contracts/console-views.js").TimelineViewResult;
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
    return { status: "not_found", observedCursor: (null as unknown) as import("../../../src/contracts/command-event.js").CommitCursor };
  }

  // P1-07 views (scripted)                                                     //

  async workspaceLeaseView(query: WorkspaceLeaseViewQuery): Promise<WorkspaceLeaseViewResult> {
    this.workspaceLeaseViewCalls.push(query);
    if (this.options.workspaceLeaseView) return this.options.workspaceLeaseView(query);
    return { status: "not_found", observedCursor: (null as unknown) as import("../../../src/contracts/command-event.js").CommitCursor };
  }

  async integrationConflicts(query: IntegrationConflictViewQuery): Promise<IntegrationConflictViewResult> {
    this.integrationConflictsCalls.push(query);
    if (this.options.integrationConflicts) return this.options.integrationConflicts(query);
    return { status: "not_found", observedCursor: (null as unknown) as import("../../../src/contracts/command-event.js").CommitCursor };
  }

  async workspacePatches(query: WorkspacePatchViewQuery): Promise<WorkspacePatchViewResult> {
    this.workspacePatchesCalls.push(query);
    if (this.options.workspacePatches) return this.options.workspacePatches(query);
    return { status: "not_found", observedCursor: (null as unknown) as import("../../../src/contracts/command-event.js").CommitCursor };
  }

  // P1-16 work context view (scripted)                                       //

  async workContext(query: import("../../../src/contracts/context-continuity.js").WorkContextViewQuery): Promise<import("../../../src/contracts/context-continuity.js").WorkContextViewResult> {
    this.workContextCalls.push(query);
    if (this.options.workContext) return this.options.workContext(query);
    return { status: "not_found", projectId: query.projectId, workspaceId: query.workspaceId, workId: query.workId };
  }

  // P1-18 material-access grants (scripted)                                  //

  async materialAccessGrants(query: import("../../../src/contracts/material-access.js").MaterialAccessGrantViewQuery): Promise<import("../../../src/contracts/material-access.js").MaterialAccessGrantViewResult> {
    this.materialAccessGrantsCalls.push(query);
    if (this.options.materialAccessGrants) return this.options.materialAccessGrants(query);
    return { status: "not_ready", observedCursor: null };
  }

  async materialAccessCandidates(_query: import("../../../src/contracts/material-access.js").MaterialAccessGrantLookup): Promise<import("../../../src/contracts/material-access.js").MaterialAccessGrantViewResult> {
    return { status: "not_ready", observedCursor: null };
  }

  async architectureInspectionView(query: import("../../../src/contracts/architecture-inspection.js").ArchitectureInspectionViewQuery): Promise<import("../../../src/contracts/architecture-inspection.js").ArchitectureInspectionViewResult> {
    this.architectureInspectionViewCalls.push(query);
    if (this.options.architectureInspectionView) return this.options.architectureInspectionView(query);
    return { status: "not_found", projectId: query.projectId, workspaceId: query.workspaceId };
  }

  async completedWorkView(query: import("../../../src/contracts/completed-work-context.js").CompletedWorkViewQuery): Promise<import("../../../src/contracts/completed-work-context.js").CompletedWorkViewResult> {
    this.completedWorkViewCalls.push(query);
    if (this.options.completedWorkView) return this.options.completedWorkView(query);
    return { status: "not_found", projectId: query.projectId, workspaceId: query.workspaceId };
  }

  async controlTimelineView(query: import("../../../src/contracts/control-intent.js").ControlTimelineViewQuery): Promise<import("../../../src/contracts/control-intent.js").ControlTimelineViewResult> {
    this.controlTimelineViewCalls.push(query);
    if (this.options.controlTimelineView) return this.options.controlTimelineView(query);
    return { status: "not_found", projectId: query.projectId, workspaceId: query.workspaceId };
  }

  async queryJobView(query: import("../../../src/contracts/query-job.js").QueryJobViewQuery): Promise<import("../../../src/contracts/query-job.js").QueryJobViewResult> {
    this.queryJobViewCalls.push(query);
    if (this.options.queryJobView) return this.options.queryJobView(query);
    return { status: "not_found", projectId: query.projectId, workspaceId: query.workspaceId, queryJobId: query.queryJobId };
  }

  async planChangeView(query: import("../../../src/contracts/goal-change.js").PlanChangeViewQuery): Promise<import("../../../src/contracts/goal-change.js").PlanChangeViewResult> {
    this.planChangeViewCalls.push(query);
    if (this.options.planChangeView) return this.options.planChangeView(query);
    return { status: "not_found" };
  }

  async baselineChangeView(query: import("../../../src/contracts/baseline-evolution.js").BaselineChangeViewQuery): Promise<import("../../../src/contracts/baseline-evolution.js").BaselineChangeViewResult> {
    this.baselineChangeViewCalls.push(query);
    if (this.options.baselineChangeView) return this.options.baselineChangeView(query);
    return { status: "not_found" };
  }

  async unifiedStatusView(query: import("../../../src/contracts/human-role-collaboration.js").UnifiedStatusViewQuery): Promise<import("../../../src/contracts/human-role-collaboration.js").UnifiedStatusViewResult> {
    this.unifiedStatusViewCalls.push(query);
    if (this.options.unifiedStatusView) return this.options.unifiedStatusView(query);
    return { status: "not_found" };
  }

  // P1-08 console views (scripted)                                           //

  async consolePortfolio(query: import("../../../src/contracts/console-views.js").PortfolioViewQuery): Promise<import("../../../src/contracts/console-views.js").PortfolioViewResult> {
    this.consolePortfolioCalls.push(query);
    if (this.options.consolePortfolio) return this.options.consolePortfolio(query);
    return { status: "not_found", observedCursor: (null as unknown) as import("../../../src/contracts/command-event.js").CommitCursor };
  }

  async consoleSummary(query: import("../../../src/contracts/console-views.js").WorkspaceSummaryViewQuery): Promise<import("../../../src/contracts/console-views.js").WorkspaceSummaryViewResult> {
    this.consoleSummaryCalls.push(query);
    if (this.options.consoleSummary) return this.options.consoleSummary(query);
    return { status: "not_found", observedCursor: (null as unknown) as import("../../../src/contracts/command-event.js").CommitCursor };
  }

  async consolePlanMatrix(query: import("../../../src/contracts/console-views.js").PlanMatrixViewQuery): Promise<import("../../../src/contracts/console-views.js").PlanMatrixViewResult> {
    this.consolePlanMatrixCalls.push(query);
    if (this.options.consolePlanMatrix) return this.options.consolePlanMatrix(query);
    return { status: "not_found", observedCursor: (null as unknown) as import("../../../src/contracts/command-event.js").CommitCursor };
  }

  async consoleActiveAgents(query: import("../../../src/contracts/console-views.js").ActiveAgentsViewQuery): Promise<import("../../../src/contracts/console-views.js").ActiveAgentsViewResult> {
    this.consoleActiveAgentsCalls.push(query);
    if (this.options.consoleActiveAgents) return this.options.consoleActiveAgents(query);
    return { status: "not_found", observedCursor: (null as unknown) as import("../../../src/contracts/command-event.js").CommitCursor };
  }

  async consoleTaskEvidence(query: import("../../../src/contracts/console-views.js").TaskEvidenceViewQuery): Promise<import("../../../src/contracts/console-views.js").TaskEvidenceViewResult> {
    this.consoleTaskEvidenceCalls.push(query);
    if (this.options.consoleTaskEvidence) return this.options.consoleTaskEvidence(query);
    return { status: "not_found", observedCursor: (null as unknown) as import("../../../src/contracts/command-event.js").CommitCursor };
  }

  async consoleTimeline(query: import("../../../src/contracts/console-views.js").TimelineViewQuery): Promise<import("../../../src/contracts/console-views.js").TimelineViewResult> {
    this.consoleTimelineCalls.push(query);
    if (this.options.consoleTimeline) return this.options.consoleTimeline(query);
    return { status: "not_found", observedCursor: (null as unknown) as import("../../../src/contracts/command-event.js").CommitCursor };
  }
}
