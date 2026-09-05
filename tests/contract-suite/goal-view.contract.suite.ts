/**
 * Shared ReadModelIndex / Goal View contract suite (P1-00).
 * Every ReadModelIndex adapter must pass this suite; lane C wires it to its
 * implementation. Driven strictly through advance(page) + goal(query).
 */
import { describe, expect, it } from "vitest";
import type {
  GoalViewQuery,
  ProjectionReceipt,
  ReadModelIndex,
} from "../../src/contracts/goal-view.js";
import { ProjectionStallError } from "../../src/contracts/goal-view.js";
import type { CommitCursor } from "../../src/contracts/command-event.js";
import type { DomainEvent } from "../../src/contracts/events.js";
import type { EventPage } from "../../src/contracts/ledger.js";
import { makeCommitCursor } from "../../src/contracts/ledger.js";
import {
  MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1,
  buildCreateGoalCommand,
  goalCreatedEventFor,
} from "../../src/contracts/fixtures/goal-fixtures.js";
import { bootstrapEventsFor } from "../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import { FIXED_ISO_2026_09_05 } from "../../src/contracts/testing/sequences.js";

export interface GoalViewContractContext {
  /** fresh empty index per call */
  create: () => Promise<ReadModelIndex>;
}

const OCCURRED = FIXED_ISO_2026_09_05;

function commandFor(scope: 0 | 1, index: number) {
  const scopeData = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[scope]!;
  return buildCreateGoalCommand(scopeData, {
    commandId: `cmd-gview-${index}`,
    correlationId: `corr-gview-${index}`,
    submittedAt: OCCURRED,
  });
}

function goalEventAt(seq: number, scope: 0 | 1, index: number) {
  const command = commandFor(scope, index);
  const firstScope = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[scope]!;
  return {
    command,
    scope: firstScope,
    positioned: {
      cursor: makeCommitCursor(seq),
      event: goalCreatedEventFor(command, { eventId: `gv-evt-${index}`, occurredAt: OCCURRED }),
    },
  };
}

function bootstrapPage(seqFrom: number, eventIds: string[]): EventPage {
  const command = buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
    commandId: "cmd-gview-boot",
    correlationId: "corr-gview-boot",
    submittedAt: OCCURRED,
  });
  const { events } = bootstrapEventsFor(command, { eventIds, occurredAt: OCCURRED });
  const positioned = events.map((event, i) => ({ cursor: makeCommitCursor(seqFrom + i), event }));
  return {
    afterCursor: null,
    throughCursor: positioned.at(-1)?.cursor ?? null,
    events: positioned,
    hasMore: false,
  };
}

function pageOf(
  positioned: Array<{ cursor: CommitCursor; event: DomainEvent }>,
  afterCursor: CommitCursor | null = null,
): EventPage {
  return {
    afterCursor,
    throughCursor: positioned.at(-1)?.cursor ?? null,
    events: [...positioned],
    hasMore: false,
  };
}

function queryFor(
  scope: 0 | 1,
  atLeastCursor?: CommitCursor,
): GoalViewQuery {
  const data = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[scope]!;
  const base = {
    projectId: data.projectId,
    workspaceId: data.workspaceId,
    goalId: data.goalId,
  };
  return atLeastCursor === undefined ? base : { ...base, atLeastCursor };
}

async function advanceAll(index: ReadModelIndex, pages: EventPage[]): Promise<ProjectionReceipt> {
  let receipt: ProjectionReceipt | null = null;
  for (const page of pages) receipt = await index.advance(page);
  return receipt!;
}

export function defineGoalViewContractSuite(ctx: GoalViewContractContext) {
  describe("ReadModelIndex Goal View contract suite", () => {
    it("first projection: GoalCreated -> ready with normalized fields", async () => {
      const index = await ctx.create();
      const { positioned, scope } = goalEventAt(2, 0, 1);
      await index.advance(pageOf([positioned]));
      const result = await index.goal(queryFor(0, positioned.cursor));
      expect(result.status).toBe("ready");
      if (result.status !== "ready") return;
      expect(result.goal).toMatchObject({
        goalId: scope.goalId,
        projectId: scope.projectId,
        workspaceId: scope.workspaceId,
        desiredState: "active",
        activePlanRevision: null,
        aggregateRevision: 1,
        sourceCursor: positioned.cursor,
      });
      expect(result.goal.objective).toBe(scope.objective.trim());
      expect(result.observedCursor).toBe(positioned.cursor);
    });

    it("cursor behind atLeastCursor -> not_ready, even when the row exists", async () => {
      const index = await ctx.create();
      const ev = goalEventAt(5, 0, 2);
      await index.advance(pageOf([ev.positioned]));
      const later = makeCommitCursor(6);
      const result = await index.goal(queryFor(0, later));
      expect(result.status).toBe("not_ready");
      if (result.status === "not_ready") {
        expect(result.requiredCursor).toBe(later);
        expect(result.observedCursor).toBe(ev.positioned.cursor);
      }
    });

    it("exactly covered -> ready; still missing goal -> not_found", async () => {
      const index = await ctx.create();
      const ev = goalEventAt(2, 0, 3);
      await index.advance(pageOf([ev.positioned]));
      expect((await index.goal(queryFor(0, ev.positioned.cursor))).status).toBe("ready");
      const other = {
        ...queryFor(0, ev.positioned.cursor),
        goalId: "goal-does-not-exist",
      };
      const result = await index.goal(other);
      expect(result.status).toBe("not_found");
      if (result.status === "not_found") expect(result.observedCursor).toBe(ev.positioned.cursor);
    });

    it("no atLeastCursor and no row -> not_ready, not not_found", async () => {
      const index = await ctx.create();
      const ev = goalEventAt(3, 0, 4);
      await index.advance(pageOf([ev.positioned]));
      const result = await index.goal(queryFor(0));
      expect(result.status).toBe("not_ready");
      if (result.status === "not_ready") expect(result.observedCursor).toBe(ev.positioned.cursor);
    });

    it("duplicate EventPage advance is idempotent, appliedEventIds not repeated", async () => {
      const index = await ctx.create();
      const ev = goalEventAt(4, 0, 5);
      const page = pageOf([ev.positioned]);
      const first = await index.advance(page);
      expect(first.appliedEventIds).toEqual([ev.positioned.event.eventId]);
      const second = await index.advance(page);
      expect(second.appliedEventIds).toEqual([]);
      const result = await index.goal(queryFor(0, ev.positioned.cursor));
      expect(result.status).toBe("ready");
    });

    it("cursor gap stalls: no partial apply, typed error", async () => {
      const index = await ctx.create();
      const a = goalEventAt(2, 0, 6);
      const gap = goalEventAt(4, 0, 7); // cursor 3 missing
      await index.advance(pageOf([a.positioned]));
      await expect(index.advance(pageOf([gap.positioned]))).rejects.toThrow(ProjectionStallError);
      await expect(index.advance(pageOf([gap.positioned]))).rejects.toMatchObject({
        reason: "cursor_gap",
      });
      expect((await index.goal({ ...queryFor(0), atLeastCursor: a.positioned.cursor })).status).toBe(
        "ready",
      );
    });

    it("out-of-order within a page stalls", async () => {
      const index = await ctx.create();
      const a = goalEventAt(2, 0, 8);
      const b = goalEventAt(3, 0, 9);
      await expect(index.advance(pageOf([b.positioned, a.positioned]))).rejects.toMatchObject({
        reason: "out_of_order",
      });
    });

    it("unknown event schema version stalls", async () => {
      const index = await ctx.create();
      const ev = goalEventAt(2, 0, 10);
      const bad = {
        ...ev.positioned,
        event: { ...ev.positioned.event, schemaVersion: 2 } as unknown as DomainEvent,
      };
      await expect(index.advance(pageOf([bad]))).rejects.toThrow(ProjectionStallError);
      await expect(index.advance(pageOf([bad]))).rejects.toMatchObject({
        reason: "unknown_schema_version",
      });
    });

    it("known non-goal events (bootstrap) advance cursor without views", async () => {
      const index = await ctx.create();
      const boot = bootstrapPage(1, ["bt-1", "bt-2", "bt-3", "bt-4"]);
      const g = goalEventAt(5, 0, 11);
      await index.advance(pageOf([...boot.events, g.positioned]));
      const result = await index.goal(queryFor(0, makeCommitCursor(5)));
      expect(result.status).toBe("ready");
      if (result.status === "ready") expect(result.goal.sourceCursor).toBe(makeCommitCursor(5));
    });

    it("cross-scope isolation: same local workspaceId/goalId under different projects", async () => {
      const index = await ctx.create();
      const a = goalEventAt(1, 0, 12);
      const b = goalEventAt(2, 1, 13);
      await index.advance(pageOf([a.positioned]));
      await index.advance(pageOf([b.positioned]));
      const ra = await index.goal(queryFor(0, makeCommitCursor(2)));
      const rb = await index.goal(queryFor(1, makeCommitCursor(2)));
      expect(ra.status).toBe("ready");
      expect(rb.status).toBe("ready");
      if (ra.status === "ready" && rb.status === "ready") {
        expect(ra.goal.objective).not.toBe(rb.goal.objective);
        expect(ra.goal.projectId).toBe("proj-alpha");
        expect(rb.goal.projectId).toBe("proj-beta");
      }
      const crossA = await index.goal({ ...queryFor(0, makeCommitCursor(2)), goalId: "goal-1" });
      // alpha query for alpha goal id but at beta cursor coverage: still its own row or not_found
      expect(crossA.status).toBe("ready");
      const crossB = await index.goal({
        projectId: "proj-alpha",
        workspaceId: (b.scope as { workspaceId: string }).workspaceId,
        goalId: (b.scope as { goalId: string }).goalId,
        atLeastCursor: makeCommitCursor(2),
      });
      // beta's row keyed under (proj-beta, ...) — alpha query must NOT hit it
      expect(crossB.status).toBe("not_found");
    });

    it("rebuild from empty index equals incremental projection", async () => {
      const total = await ctx.create();
      const a = goalEventAt(1, 0, 14);
      const b = goalEventAt(2, 1, 15);
      const pages = [pageOf([a.positioned]), pageOf([b.positioned])];
      const fresh = await ctx.create();
      await advanceAll(fresh, pages);
      await advanceAll(total, pages.slice(0, 1));
      const partial = await total.goal(queryFor(0, makeCommitCursor(2)));
      expect(partial.status).toBe("not_ready");
      await total.advance(pages[1]!);
      const rebuilt = await fresh.goal(queryFor(0, makeCommitCursor(2)));
      const incremental = await total.goal(queryFor(0, makeCommitCursor(2)));
      expect(rebuilt).toEqual(incremental);
    });
  });
}
