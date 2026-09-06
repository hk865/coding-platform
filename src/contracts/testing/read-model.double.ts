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

export class ScriptedReadModelIndex implements ReadModelIndex {
  readonly advanceCalls: EventPage[] = [];
  readonly goalCalls: GoalViewQuery[] = [];
  readonly planGraphCalls: PlanGraphViewQuery[] = [];
  readonly taskDetailCalls: TaskDetailViewQuery[] = [];
  readonly activeAgentCalls: ActiveAgentQuery[] = [];
  readonly goalStatusCalls: GoalStatusQuery[] = [];
  readonly goalTimelineCalls: GoalTimelineQuery[] = [];

  constructor(
    private readonly options: {
      advance?: AdvanceBehavior;
      goal?: GoalBehavior;
      planGraph?: PlanGraphBehavior;
      taskDetail?: TaskDetailBehavior;
      activeAgent?: ActiveAgentBehavior;
      goalStatus?: GoalStatusBehavior;
      goalTimeline?: GoalTimelineBehavior;
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
}
