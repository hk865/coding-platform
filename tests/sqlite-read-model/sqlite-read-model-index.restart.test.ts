/**
 * P1-01 lane B — file-backed restart/rebuild proof for SqliteReadModelIndex.
 *
 * Proves the "db is rebuildable from persistent EventPage(s)" semantics with
 * three independent facts:
 *  (a) a FRESH file rebuilt by replaying the same EventPage stream reproduces
 *      the incremental projection field-for-field (both scopes);
 *  (b) reopening the SAME file and continuing to advance reproduces the
 *      one-shot full replay;
 *  (c) persisted dedupe: re-advancing an already-applied page after reopen is
 *      idempotent (no re-report, no base advance).
 *
 * The EventPage stream is assembled purely from the shared P1-00 contract
 * fixtures (deterministic ids/cursors) — it does NOT depend on a real ledger.
 * Uses a temp dir via node:fs/promises mkdtemp + rm.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSqliteReadModelIndex } from "../../src/sqlite-read-model/sqlite-read-model-index.js";
import type { ReadModelIndex } from "../../src/contracts/goal-view.js";
import type { CommitCursor } from "../../src/contracts/command-event.js";
import type { DomainEvent } from "../../src/contracts/events.js";
import type { EventPage, PositionedEvent } from "../../src/contracts/ledger.js";
import { makeCommitCursor } from "../../src/contracts/ledger.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { bootstrapEventsFor } from "../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import {
  MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1,
  buildCreateGoalCommand,
  goalCreatedEventFor,
} from "../../src/contracts/fixtures/goal-fixtures.js";
import { FIXED_ISO_2026_09_05 } from "../../src/contracts/testing/sequences.js";

const OCCURRED = FIXED_ISO_2026_09_05;

/** Deterministic GoalCreated PositionedEvent for one of the two shared scopes. */
function goalEventAt(seq: number, scope: 0 | 1, index: number): PositionedEvent {
  const scopeData = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[scope]!;
  const command = buildCreateGoalCommand(scopeData, {
    commandId: "cmd-rm-" + index,
    correlationId: "corr-rm-" + index,
    submittedAt: OCCURRED,
  });
  return {
    cursor: makeCommitCursor(seq),
    event: goalCreatedEventFor(command, { eventId: "rm-evt-" + index, occurredAt: OCCURRED }),
  };
}

/** Deterministic bootstrap EventPage (cursors seqFrom..seqFrom+ids.length-1). */
function bootstrapPage(seqFrom: number, eventIds: string[]): EventPage {
  const command = buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
    commandId: "cmd-rm-boot",
    correlationId: "corr-rm-boot",
    submittedAt: OCCURRED,
  });
  const { events } = bootstrapEventsFor(command, { eventIds, occurredAt: OCCURRED });
  const positioned = events.map((event, i) => ({
    cursor: makeCommitCursor(seqFrom + i),
    event,
  }));
  return {
    afterCursor: null,
    throughCursor: positioned.at(-1)?.cursor ?? null,
    events: positioned,
    hasMore: false,
  };
}

function pageOf(positioned: PositionedEvent[]): EventPage {
  return {
    afterCursor: null,
    throughCursor: positioned.at(-1)?.cursor ?? null,
    events: positioned,
    hasMore: false,
  };
}

function queryFor(scope: 0 | 1, atLeastCursor: CommitCursor) {
  const data = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[scope]!;
  return {
    projectId: data.projectId,
    workspaceId: data.workspaceId,
    goalId: data.goalId,
    atLeastCursor,
  };
}

async function advanceAll(index: ReadModelIndex, pages: EventPage[]): Promise<void> {
  for (const page of pages) await index.advance(page);
}

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "p1-01-rm-"));
}

/** The deterministic 3-page stream: bootstrap (c1-4), alpha goal (c5), beta goal (c6). */
function buildPages(prefix: string): EventPage[] {
  return [
    bootstrapPage(1, [prefix + "-bt-1", prefix + "-bt-2", prefix + "-bt-3", prefix + "-bt-4"]),
    pageOf([goalEventAt(5, 0, 1)]),
    pageOf([goalEventAt(6, 1, 2)]),
  ];
}

describe("SqliteReadModelIndex — file-backed restart/rebuild", () => {
  it("fresh rebuild from the same EventPages equals the incremental projection", async () => {
    const dir = await makeTempDir();
    try {
      const incPath = join(dir, "inc.sqlite");
      const rebPath = join(dir, "reb.sqlite");
      const pages = buildPages("A");

      // Incremental to file "inc", with a mid-way reopen (close() + fresh instance).
      let inc = createSqliteReadModelIndex({ path: incPath });
      await inc.advance(pages[0]!);
      await inc.advance(pages[1]!);
      await inc.close();
      inc = createSqliteReadModelIndex({ path: incPath }); // reopen same file
      await inc.advance(pages[2]!);
      const incAlpha = await inc.goal(queryFor(0, makeCommitCursor(6)));
      const incBeta = await inc.goal(queryFor(1, makeCommitCursor(6)));
      await inc.close();

      // Fresh file rebuilt by replaying the SAME EventPage stream in one session.
      const reb = createSqliteReadModelIndex({ path: rebPath });
      await advanceAll(reb, pages);
      const rebAlpha = await reb.goal(queryFor(0, makeCommitCursor(6)));
      const rebBeta = await reb.goal(queryFor(1, makeCommitCursor(6)));
      await reb.close();

      expect(incAlpha).toEqual(rebAlpha);
      expect(incBeta).toEqual(rebBeta);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reopening the same file and continuing equals a one-shot full replay", async () => {
    const dir = await makeTempDir();
    try {
      const incPath = join(dir, "inc.sqlite");
      const onePath = join(dir, "one.sqlite");
      const pages = buildPages("B");

      // Incremental: page0 in one instance, close, reopen, then page1 + page2.
      let inc = createSqliteReadModelIndex({ path: incPath });
      await inc.advance(pages[0]!);
      await inc.close();
      inc = createSqliteReadModelIndex({ path: incPath });
      await inc.advance(pages[1]!);
      await inc.advance(pages[2]!);
      const incAlpha = await inc.goal(queryFor(0, makeCommitCursor(6)));
      const incBeta = await inc.goal(queryFor(1, makeCommitCursor(6)));
      await inc.close();

      // One-shot: full replay from a fresh file, never closed mid-way.
      const one = createSqliteReadModelIndex({ path: onePath });
      await advanceAll(one, pages);
      const oneAlpha = await one.goal(queryFor(0, makeCommitCursor(6)));
      const oneBeta = await one.goal(queryFor(1, makeCommitCursor(6)));
      await one.close();

      expect(incAlpha).toEqual(oneAlpha);
      expect(incBeta).toEqual(oneBeta);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("partial rebuild of a prefix equals the incremental prefix", async () => {
    const dir = await makeTempDir();
    try {
      const incPath = join(dir, "inc.sqlite");
      const rebPath = join(dir, "reb.sqlite");
      const pages = buildPages("C");
      const prefix = pages.slice(0, 2); // bootstrap + alpha goal

      const inc = createSqliteReadModelIndex({ path: incPath });
      await advanceAll(inc, prefix);
      const incAlpha = await inc.goal(queryFor(0, makeCommitCursor(5)));
      await inc.close();

      const reb = createSqliteReadModelIndex({ path: rebPath });
      await advanceAll(reb, prefix);
      const rebAlpha = await reb.goal(queryFor(0, makeCommitCursor(5)));
      await reb.close();

      expect(incAlpha).toEqual(rebAlpha);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("persisted dedupe: re-advancing an applied page after reopen is idempotent", async () => {
    const dir = await makeTempDir();
    try {
      const dupPath = join(dir, "dup.sqlite");
      const page = pageOf([goalEventAt(2, 0, 7)]);

      let idx = createSqliteReadModelIndex({ path: dupPath });
      const first = await idx.advance(page);
      expect(first.appliedEventIds).toEqual(["rm-evt-7"]);
      await idx.close();

      idx = createSqliteReadModelIndex({ path: dupPath });
      const second = await idx.advance(page);
      expect(second.appliedEventIds).toEqual([]);

      // The row is still present and the page base was not re-advanced.
      const view = await idx.goal({
        projectId: "proj-alpha",
        workspaceId: "ws-shared",
        goalId: "goal-1",
        atLeastCursor: makeCommitCursor(2),
      });
      expect(view.status).toBe("ready");
      await idx.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rebuilt view reflects a same-key update identically (upsert == rebuild)", async () => {
    const dir = await makeTempDir();
    try {
      const incPath = join(dir, "upd-inc.sqlite");
      const rebPath = join(dir, "upd-reb.sqlite");

      // First GoalCreated@1 at c5 (fixture objective), then a later GoalCreated@1
      // at c6 touching the SAME (projectId, workspaceId, goalId) with a new
      // objective — an UPDATE to the same full-scope row.
      const initial = goalEventAt(5, 0, 8);
      const updatedCommand = buildCreateGoalCommand(
        MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[0]!,
        { commandId: "cmd-rm-upd", correlationId: "corr-rm-upd", submittedAt: OCCURRED },
      );
      updatedCommand.payload.objective = "updated objective for the same goal";
      const updated: PositionedEvent = {
        cursor: makeCommitCursor(6),
        event: goalCreatedEventFor(updatedCommand, { eventId: "rm-evt-9", occurredAt: OCCURRED }),
      };
      const pages = [pageOf([initial]), pageOf([updated])];

      const inc = createSqliteReadModelIndex({ path: incPath });
      await advanceAll(inc, pages);
      const incView = await inc.goal({
        projectId: "proj-alpha",
        workspaceId: "ws-shared",
        goalId: "goal-1",
        atLeastCursor: makeCommitCursor(6),
      });
      await inc.close();

      const reb = createSqliteReadModelIndex({ path: rebPath });
      await advanceAll(reb, pages);
      const rebView = await reb.goal({
        projectId: "proj-alpha",
        workspaceId: "ws-shared",
        goalId: "goal-1",
        atLeastCursor: makeCommitCursor(6),
      });
      await reb.close();

      expect(incView).toEqual(rebView);
      expect(incView.status).toBe("ready");
      if (incView.status === "ready") {
        // The later event rewrote the row: objective + sourceCursor reflect it.
        expect(incView.goal.objective).toBe("updated objective for the same goal");
        expect(incView.goal.sourceCursor).toBe(makeCommitCursor(6));
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
