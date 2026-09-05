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

export class ScriptedReadModelIndex implements ReadModelIndex {
  readonly advanceCalls: EventPage[] = [];
  readonly goalCalls: GoalViewQuery[] = [];
  readonly planGraphCalls: PlanGraphViewQuery[] = [];
  readonly taskDetailCalls: TaskDetailViewQuery[] = [];

  constructor(
    private readonly options: {
      advance?: AdvanceBehavior;
      goal?: GoalBehavior;
      planGraph?: PlanGraphBehavior;
      taskDetail?: TaskDetailBehavior;
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
}
