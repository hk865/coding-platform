/**
 * P1-08 LANE-A SQLite projection tests — consolePortfolio + consoleSummary
 * (dual-adapter mirror of tests/read-model/p1-08-portfolio-summary.test.ts).
 *
 * The SAME two-project isolation scenario is run against the real SQLite read
 * model (persistent harness). The LANE-A adapter projects into the frozen
 * console_portfolio (entry_json) / console_summary (view_json) tables + the
 * internal per-task / per-goal phase tables. Every assertion must match the
 * InMemory reference field-for-field; the views are event projections — advance
 * the projection before reading.
 */
import { describe, expect, it } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import {
  createP108ScenarioRuntime,
  runP108TwoProjectScenario,
  toP1_08Harness,
  P108_PROJECT_A,
  P108_PROJECT_B,
  P108_WORKSPACE,
} from "../contract-suite/p1-08-harness.js";
import type { P1_08TestHarness } from "../contract-suite/p1-08-harness.js";
import { consoleWorkspaceKey } from "../../src/contracts/console-views.js";
import { makeCommitCursor } from "../../src/contracts/ledger.js";

/** Create a fresh persistent SQLite harness, run the scenario, advance, then hand
 * the view harness to fn and always clean up (close + remove temp files). */
async function withHarness(fn: (th: P1_08TestHarness) => Promise<void>): Promise<void> {
  const h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
  const th = toP1_08Harness(h as never);
  try {
    await runP108TwoProjectScenario(th);
    await th.advanceProjection();
    await fn(th);
  } finally {
    await h.cleanup().catch(() => undefined);
  }
}

describe("P1-08 LANE-A SQLite portfolio + workspace summary projection", () => {
  it("consolePortfolio lists both isolated bootstrapped scopes in scope-key order", async () => {
    await withHarness(async (th) => {
      const p = await th.consolePortfolio({});
      expect(p.status).toBe("ready");
      if (p.status !== "ready") return;

      expect(p.portfolio.entries).toHaveLength(2);
      const projectIds = p.portfolio.entries.map((e) => e.projectId);
      expect(new Set(projectIds)).toEqual(new Set([P108_PROJECT_A, P108_PROJECT_B]));
      for (const entry of p.portfolio.entries) {
        expect(entry.workspaceId).toBe(P108_WORKSPACE);
        expect(entry.projectRevision).toBe(1);
        expect(entry.workspaceRevision).toBe(1);
        expect(entry.scopeKey).toBe(consoleWorkspaceKey(entry.projectId, entry.workspaceId));
        expect(entry.sourceDigest).toBeTruthy();
        expect(entry.bootstrappedAt).toBeTruthy();
        expect(entry.sourceCursor).toBeTruthy();
      }
      expect(p.portfolio.entries[0]!.projectId).toBe(P108_PROJECT_A);
      expect(p.portfolio.entries[1]!.projectId).toBe(P108_PROJECT_B);
      expect(p.portfolio.sourceCursor).toBeTruthy();
    });
  });

  it("consoleSummary aggregates counters per project; local ids never cross-read", async () => {
    await withHarness(async (th) => {
      const a = await th.consoleSummary({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
      const b = await th.consoleSummary({ projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE });
      expect(a.status).toBe("ready");
      expect(b.status).toBe("ready");
      if (a.status !== "ready" || b.status !== "ready") return;

      expect(a.summary.goalCount).toBe(1);
      expect(a.summary.taskCount).toBe(3);
      expect(a.summary.planRevisionCount).toBe(1);
      expect(a.summary.agentRunCount).toBe(3); // claims + replacement run (integrator ruling)
      expect(a.summary.evidenceCount).toBe(3);
      expect(a.summary.taskReductionCount).toBe(3);
      expect(a.summary.goalPhaseCount).toBe(1);
      expect(a.summary.sourceDigest).toBeTruthy();
      expect(a.summary.bootstrappedAt).toBeTruthy();
      expect(a.summary.sourceCursor).toBeTruthy();

      expect(b.summary.goalCount).toBe(1);
      expect(b.summary.taskCount).toBe(3);
      expect(b.summary.planRevisionCount).toBe(1);
      expect(b.summary.agentRunCount).toBe(2);
      expect(b.summary.evidenceCount).toBe(2);
      expect(b.summary.taskReductionCount).toBe(3);
      expect(b.summary.goalPhaseCount).toBe(1);

      expect(JSON.stringify(a.summary)).not.toBe(JSON.stringify(b.summary));
      expect(a.summary.projectId).toBe(P108_PROJECT_A);
      expect(b.summary.projectId).toBe(P108_PROJECT_B);
      expect(consoleWorkspaceKey(P108_PROJECT_A, P108_WORKSPACE)).not.toBe(
        consoleWorkspaceKey(P108_PROJECT_B, P108_WORKSPACE),
      );
    });
  });

  it("phaseCounts track the LATEST reduction phase per task and the latest goal phase", async () => {
    await withHarness(async (th) => {
      const a = await th.consoleSummary({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
      const b = await th.consoleSummary({ projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE });
      expect(a.status).toBe("ready");
      expect(b.status).toBe("ready");
      if (a.status !== "ready" || b.status !== "ready") return;

      expect(a.summary.phaseCounts.taskReduction.satisfied).toBe(2);
      expect(a.summary.phaseCounts.taskReduction.verifying).toBe(1);
      expect(Object.keys(a.summary.phaseCounts.taskReduction).length).toBeGreaterThan(0);
      expect(a.summary.phaseCounts.goalPhase.COMPLETED).toBe(1);

      expect(b.summary.phaseCounts.goalPhase.NEEDS_DECISION).toBe(1);
      expect(b.summary.phaseCounts.goalPhase.COMPLETED).toBeUndefined();
      expect(Object.keys(b.summary.phaseCounts.taskReduction).length).toBeGreaterThan(0);

      expect(a.summary.phaseCounts).toBeDefined();
      expect(b.summary.phaseCounts).toBeDefined();
    });
  });

  it("freshness: covered+no row -> not_found; uncovered -> not_ready; no cursor+no row -> not_ready", async () => {
    await withHarness(async (th) => {
      const observed = th.observedCursor();
      expect(observed).toBeTruthy();

      const never = await th.consoleSummary({
        projectId: P108_PROJECT_A,
        workspaceId: "ws-never",
        atLeastCursor: observed as never,
      });
      expect(never.status).toBe("not_found");

      const noCursor = await th.consoleSummary({ projectId: P108_PROJECT_A, workspaceId: "ws-never" });
      expect(noCursor.status).toBe("not_ready");

      const ahead = await th.consoleSummary({
        projectId: P108_PROJECT_A,
        workspaceId: P108_WORKSPACE,
        atLeastCursor: makeCommitCursor(999999999),
      });
      expect(ahead.status).toBe("not_ready");
      if (ahead.status === "not_ready") {
        expect(ahead.requiredCursor).toBeTruthy();
        expect(ahead.observedCursor).toBeTruthy();
      }
    });
  });

  it("portfolio freshness mirrors summary (covered ready; uncovered not_ready)", async () => {
    await withHarness(async (th) => {
      const ready = await th.consolePortfolio({});
      expect(ready.status).toBe("ready");

      const observed = th.observedCursor();
      expect(observed).toBeTruthy();
      const covered = await th.consolePortfolio({ atLeastCursor: observed as never });
      expect(covered.status).toBe("ready");

      const ahead = await th.consolePortfolio({ atLeastCursor: makeCommitCursor(999999999) });
      expect(ahead.status).toBe("not_ready");
    });
  });
});
