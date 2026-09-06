/**
 * P1-08 LANE-A InMemory projection tests — consolePortfolio + consoleSummary
 * (dual-adapter reference: Portfolio + WorkspaceSummary; read-only console face).
 *
 * Shared two-project isolation scenario (tests/contract-suite/p1-08-harness.ts):
 *   - BOTH projects reuse the SAME local workspaceId ("ws-shared") and goalId
 *     ("goal-p108-1") — every console scope key is the canonicalJson of the
 *     COMPLETE ref, so a cross-project read is a hard assertion failure;
 *   - Project A: work + extra completed + handoff/replacement, gate satisfied,
 *     goal COMPLETED;
 *   - Project B: work satisfied + extra outcome_unknown, gate satisfied, goal
 *     NEEDS_DECISION (unreconciled side effect).
 *
 * Count semantics (frozen contract): ONLY the listed counter events count;
 * replacement claim is a ReplacementClaimed (NOT a TaskClaimed), so it does NOT
 * increment agentRunCount. Views are event projections — advance before reading.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import {
  createP108ScenarioRuntime,
  runP108TwoProjectScenario,
  toP1_08Harness,
  P108_PROJECT_A,
  P108_PROJECT_B,
  P108_WORKSPACE,
} from "../contract-suite/p1-08-harness.js";
import { consoleWorkspaceKey } from "../../src/contracts/console-views.js";
import { makeCommitCursor } from "../../src/contracts/ledger.js";

/** Run the two-project scenario on a fresh InMemory harness and return the view harness. */
async function runScenario() {
  const h = createInMemoryHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
  const th = toP1_08Harness(h as never);
  await runP108TwoProjectScenario(th);
  // Views are event projections — make the fresh projection explicitly ready.
  await th.advanceProjection();
  return th;
}

describe("P1-08 LANE-A InMemory portfolio + workspace summary projection", () => {
  it("consolePortfolio lists both isolated bootstrapped scopes in scope-key order", async () => {
    const th = await runScenario();
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
    // Deterministic order: scope-key (canonicalJson) sorted — alpha before beta.
    expect(p.portfolio.entries[0]!.projectId).toBe(P108_PROJECT_A);
    expect(p.portfolio.entries[1]!.projectId).toBe(P108_PROJECT_B);
    expect(p.portfolio.sourceCursor).toBeTruthy();
  });

  it("consoleSummary aggregates counters per project; local ids never cross-read", async () => {
    const th = await runScenario();
    const a = await th.consoleSummary({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
    const b = await th.consoleSummary({ projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE });
    expect(a.status).toBe("ready");
    expect(b.status).toBe("ready");
    if (a.status !== "ready" || b.status !== "ready") return;

    // Project A counts.
    expect(a.summary.goalCount).toBe(1);
    expect(a.summary.taskCount).toBe(3);
    expect(a.summary.planRevisionCount).toBe(1);
    expect(a.summary.agentRunCount).toBe(2); // work + extra claims; replacement is ReplacementClaimed (not a TaskClaimed)
    expect(a.summary.evidenceCount).toBe(3); // claim + work + gate
    expect(a.summary.taskReductionCount).toBe(3); // work + extra + gate
    expect(a.summary.goalPhaseCount).toBe(1);
    expect(a.summary.sourceDigest).toBeTruthy();
    expect(a.summary.bootstrappedAt).toBeTruthy();
    expect(a.summary.sourceCursor).toBeTruthy();

    // Project B counts (same local ids, fully isolated).
    expect(b.summary.goalCount).toBe(1);
    expect(b.summary.taskCount).toBe(3);
    expect(b.summary.planRevisionCount).toBe(1);
    expect(b.summary.agentRunCount).toBe(2); // work + extra
    expect(b.summary.evidenceCount).toBe(2); // work + gate (no claim evidence)
    expect(b.summary.taskReductionCount).toBe(3);
    expect(b.summary.goalPhaseCount).toBe(1);

    // Isolation: the two summaries differ and never merge across projects.
    expect(JSON.stringify(a.summary)).not.toBe(JSON.stringify(b.summary));
    expect(a.summary.projectId).toBe(P108_PROJECT_A);
    expect(b.summary.projectId).toBe(P108_PROJECT_B);
    expect(consoleWorkspaceKey(P108_PROJECT_A, P108_WORKSPACE)).not.toBe(
      consoleWorkspaceKey(P108_PROJECT_B, P108_WORKSPACE),
    );
  });

  it("phaseCounts track the LATEST reduction phase per task and the latest goal phase", async () => {
    const th = await runScenario();
    const a = await th.consoleSummary({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
    const b = await th.consoleSummary({ projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE });
    expect(a.status).toBe("ready");
    expect(b.status).toBe("ready");
    if (a.status !== "ready" || b.status !== "ready") return;

    // A: work + gate satisfied, extra still verifying (replacement ongoing).
    expect(a.summary.phaseCounts.taskReduction.satisfied).toBe(2);
    expect(a.summary.phaseCounts.taskReduction.verifying).toBe(1);
    expect(Object.keys(a.summary.phaseCounts.taskReduction).length).toBeGreaterThan(0);
    // A: goal COMPLETED exactly once.
    expect(a.summary.phaseCounts.goalPhase.COMPLETED).toBe(1);

    // B: goal NOT completed (NEEDS_DECISION) — never disguised as COMPLETED.
    expect(b.summary.phaseCounts.goalPhase.NEEDS_DECISION).toBe(1);
    expect(b.summary.phaseCounts.goalPhase.COMPLETED).toBeUndefined();
    expect(Object.keys(b.summary.phaseCounts.taskReduction).length).toBeGreaterThan(0);

    // phaseCounts are display-only projection facts (never reducer behaviour).
    expect(a.summary.phaseCounts).toBeDefined();
    expect(b.summary.phaseCounts).toBeDefined();
  });

  it("freshness: covered+no row -> not_found; uncovered -> not_ready; no cursor+no row -> not_ready", async () => {
    const th = await runScenario();
    const observed = th.observedCursor();
    expect(observed).toBeTruthy();

    // Covered + a scope that never bootstrapped -> not_found.
    const never = await th.consoleSummary({
      projectId: P108_PROJECT_A,
      workspaceId: "ws-never",
      atLeastCursor: observed as never,
    });
    expect(never.status).toBe("not_found");

    // No atLeastCursor + no row -> not_ready (never not_found — front-run protection).
    const noCursor = await th.consoleSummary({ projectId: P108_PROJECT_A, workspaceId: "ws-never" });
    expect(noCursor.status).toBe("not_ready");

    // Uncovered atLeastCursor -> not_ready (never echoes current data as if it observed the write).
    const ahead = await th.consoleSummary({
      projectId: P108_PROJECT_A,
      workspaceId: P108_WORKSPACE,
      atLeastCursor: makeCommitCursor(999_999_999),
    });
    expect(ahead.status).toBe("not_ready");
    if (ahead.status === "not_ready") {
      expect(ahead.requiredCursor).toBeTruthy();
      expect(ahead.observedCursor).toBeTruthy();
    }
  });

  it("portfolio freshness mirrors summary (covered ready; uncovered not_ready)", async () => {
    const th = await runScenario();
    const ready = await th.consolePortfolio({});
    expect(ready.status).toBe("ready");

    const observed = th.observedCursor();
    expect(observed).toBeTruthy();
    const covered = await th.consolePortfolio({ atLeastCursor: observed as never });
    expect(covered.status).toBe("ready");

    const ahead = await th.consolePortfolio({ atLeastCursor: makeCommitCursor(999_999_999) });
    expect(ahead.status).toBe("not_ready");
  });
});
