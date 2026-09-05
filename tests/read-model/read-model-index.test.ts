/**
 * Lane-C supplemental ReadModelIndex tests, on top of the shared contract
 * suite. Focus: multi-page cursor gaps, out-of-order, dedupe, normalization,
 * freshness, and full-scope isolation using the shared local ids fixture.
 * Published strictly per goal-view.md (view fields come from Events; freshness
 * is judged by observedCursor; the full (projectId, workspaceId, goalId) triple
 * is the query key).
 */
import { describe, expect, it } from "vitest";
import { createReadModelIndex } from "../../src/read-model/read-model-index.js";
import type { CommitCursor } from "../../src/contracts/command-event.js";
import type { DomainEvent } from "../../src/contracts/events.js";
import type { EventPage } from "../../src/contracts/ledger.js";
import { makeCommitCursor } from "../../src/contracts/ledger.js";
import {
  MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1,
  buildCreateGoalCommand,
  goalCreatedEventFor,
} from "../../src/contracts/fixtures/goal-fixtures.js";
import { FIXED_ISO_2026_09_05 } from "../../src/contracts/testing/sequences.js";

const FIXTURE = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1;
const ALPHA = FIXTURE.scopes[0]!;
const BETA = FIXTURE.scopes[1]!;

interface Positioned {
  cursor: CommitCursor;
  event: DomainEvent;
}

function goalEventAt(seq: number, scope: 0 | 1, idx: number): {
  scopeData: (typeof FIXTURE)["scopes"][number];
  positioned: Positioned;
} {
  const scopeData = FIXTURE.scopes[scope]!;
  const command = buildCreateGoalCommand(scopeData, {
    commandId: "cmd-" + idx,
    correlationId: "corr-" + idx,
    submittedAt: FIXED_ISO_2026_09_05,
  });
  return {
    scopeData,
    positioned: {
      cursor: makeCommitCursor(seq),
      event: goalCreatedEventFor(command, {
        eventId: "evt-" + idx,
        occurredAt: FIXED_ISO_2026_09_05,
      }),
    },
  };
}

function pageOf(
  positioned: Positioned[],
  afterCursor: CommitCursor | null = null,
): EventPage {
  return {
    afterCursor,
    throughCursor: positioned.at(-1)?.cursor ?? null,
    events: [...positioned],
    hasMore: false,
  };
}

function alphaQuery(atLeastCursor?: CommitCursor) {
  const base = {
    projectId: ALPHA.projectId,
    workspaceId: ALPHA.workspaceId,
    goalId: ALPHA.goalId,
  };
  return atLeastCursor === undefined ? base : { ...base, atLeastCursor };
}

function betaQuery(atLeastCursor?: CommitCursor) {
  const base = {
    projectId: BETA.projectId,
    workspaceId: BETA.workspaceId,
    goalId: BETA.goalId,
  };
  return atLeastCursor === undefined ? base : { ...base, atLeastCursor };
}

describe("ReadModelIndexImpl (lane C), supplemental", () => {
  it("normalizes objective from the Event (NFC + whitespace trim)", async () => {
    const index = createReadModelIndex();
    const a = goalEventAt(1, 0, 1);
    await index.advance(pageOf([a.positioned]));
    const result = await index.goal(alphaQuery(makeCommitCursor(1)));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.goal.objective).toBe(ALPHA.objective.trim());
    expect(result.goal.activePlanRevision).toBeNull();
    expect(result.goal.aggregateRevision).toBe(1);
    expect(result.goal.sourceCursor).toBe(makeCommitCursor(1));
  });

  it("cursor gap across pages stalls without partial application", async () => {
    const index = createReadModelIndex();
    const a = goalEventAt(1, 0, 2); // alpha @1
    const gap = goalEventAt(3, 1, 3); // beta @3, cursor 2 missing
    await index.advance(pageOf([a.positioned]));
    await expect(index.advance(pageOf([gap.positioned]))).rejects.toMatchObject({
      reason: "cursor_gap",
    });
    // alpha applied before the stall is still visible.
    expect((await index.goal(alphaQuery(makeCommitCursor(1)))).status).toBe("ready");
    // beta must NOT have been applied (covered but absent -> not_found).
    expect((await index.goal(betaQuery(makeCommitCursor(1)))).status).toBe("not_found");
  });

  it("out-of-order within a page stalls and applies nothing", async () => {
    const index = createReadModelIndex();
    const b = goalEventAt(3, 0, 4);
    const a = goalEventAt(2, 0, 5);
    await expect(index.advance(pageOf([b.positioned, a.positioned]))).rejects.toMatchObject({
      reason: "out_of_order",
    });
    // observedCursor is still null -> not_ready (not covered, no row).
    expect((await index.goal(alphaQuery(makeCommitCursor(3)))).status).toBe("not_ready");
  });

  it("unknown schema version stalls", async () => {
    const index = createReadModelIndex();
    const a = goalEventAt(2, 0, 6);
    const bad = {
      ...a.positioned,
      event: { ...a.positioned.event, schemaVersion: 2 } as unknown as DomainEvent,
    };
    await expect(index.advance(pageOf([bad]))).rejects.toMatchObject({
      reason: "unknown_schema_version",
    });
  });

  it("re-applying the same page is idempotent and not re-reported", async () => {
    const index = createReadModelIndex();
    const a = goalEventAt(2, 0, 7);
    const page = pageOf([a.positioned]);
    const first = await index.advance(page);
    expect(first.appliedEventIds).toEqual([a.positioned.event.eventId]);
    const second = await index.advance(page);
    expect(second.appliedEventIds).toEqual([]);
    expect((await index.goal(alphaQuery(makeCommitCursor(2)))).status).toBe("ready");
  });

  it("not_ready until observedCursor covers atLeastCursor, then ready", async () => {
    const index = createReadModelIndex();
    const a = goalEventAt(2, 0, 8);
    await index.advance(pageOf([a.positioned]));
    const behind = await index.goal(alphaQuery(makeCommitCursor(5)));
    expect(behind.status).toBe("not_ready");
    if (behind.status !== "not_ready") return;
    expect(behind.requiredCursor).toBe(makeCommitCursor(5));
    expect(behind.observedCursor).toBe(makeCommitCursor(2));
    // Row exists but is still reported not_ready until covered.
    const at = await index.goal(alphaQuery(makeCommitCursor(2)));
    expect(at.status).toBe("ready");
  });

  it("without atLeastCursor: row -> ready, no row -> not_ready (never not_found)", async () => {
    const index = createReadModelIndex();
    const a = goalEventAt(1, 0, 9);
    await index.advance(pageOf([a.positioned]));
    const hasRow = await index.goal(alphaQuery());
    expect(hasRow.status).toBe("ready");
    const noRow = await index.goal({
      projectId: "proj-gamma",
      workspaceId: "ws-shared",
      goalId: "goal-1",
    });
    expect(noRow.status).toBe("not_ready");
    if (noRow.status !== "not_ready") return;
    expect(noRow.observedCursor).toBe(makeCommitCursor(1));
  });

  it("keeps shared local workspaceId/goalId isolated by projectId", async () => {
    const index = createReadModelIndex();
    const a = goalEventAt(1, 0, 10);
    const b = goalEventAt(2, 1, 11);
    await index.advance(pageOf([a.positioned]));
    await index.advance(pageOf([b.positioned]));
    const ra = await index.goal(alphaQuery(makeCommitCursor(2)));
    const rb = await index.goal(betaQuery(makeCommitCursor(2)));
    expect(ra.status).toBe("ready");
    expect(rb.status).toBe("ready");
    if (ra.status === "ready" && rb.status === "ready") {
      expect(ra.goal.projectId).toBe("proj-alpha");
      expect(rb.goal.projectId).toBe("proj-beta");
      expect(ra.goal.objective).not.toBe(rb.goal.objective);
    }
    // A genuinely-absent scope key must not hit either row.
    const absent = await index.goal({
      projectId: "proj-gamma",
      workspaceId: "ws-shared",
      goalId: "goal-1",
      atLeastCursor: makeCommitCursor(2),
    });
    expect(absent.status).toBe("not_found");
  });

  it("known non-goal events advance the cursor without projecting views", async () => {
    const index = createReadModelIndex();
    // Feed bootstrap-like known events then a goal.
    const boot: Positioned[] = [1, 2, 3, 4].map((seq) => ({
      cursor: makeCommitCursor(seq),
      event: {
        eventId: "boot-" + seq,
        eventType: "WorkspaceBootstrapped" as const,
        schemaVersion: 1 as const,
        projectId: "proj-alpha",
        workspaceId: "ws-shared",
        aggregateType: "Workspace" as const,
        aggregateId: "ws-shared",
        aggregateRevision: 1 as const,
        causationId: "cmd-boot",
        correlationId: "corr-boot",
        idempotencyKey: "bootstrap-key",
        actor: { kind: "system" as const, id: "workspace-bootstrap" },
        occurredAt: FIXED_ISO_2026_09_05,
        payload: { sourceDigest: "digest" },
      },
    }));
    const g = goalEventAt(5, 0, 12);
    await index.advance(pageOf([...boot, g.positioned]));
    const result = await index.goal(alphaQuery(makeCommitCursor(5)));
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.goal.sourceCursor).toBe(makeCommitCursor(5));
  });
});
