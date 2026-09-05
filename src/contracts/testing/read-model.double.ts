/** Consistent ReadModelIndex test double (used by HumanCollaboration tests). */
import type { EventPage } from "../ledger.js";
import type {
  GoalViewQuery,
  GoalViewResult,
  ProjectionReceipt,
  ReadModelIndex,
} from "../goal-view.js";

export type AdvanceBehavior = (
  page: EventPage,
) => Promise<ProjectionReceipt> | ProjectionReceipt;
export type GoalBehavior = (
  query: GoalViewQuery,
) => Promise<GoalViewResult> | GoalViewResult;

export class ScriptedReadModelIndex implements ReadModelIndex {
  readonly advanceCalls: EventPage[] = [];
  readonly goalCalls: GoalViewQuery[] = [];

  constructor(
    private readonly options: {
      advance?: AdvanceBehavior;
      goal?: GoalBehavior;
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
}
