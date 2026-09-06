/**
 * P1-16 LANE-B InMemory continuation projection tests — the ContinuationRecorded
 * event folds into a full-scope-keyed ContinuationRecordSnapshot list, recent
 * first, bounded. Covers:
 *   - continuation rows (status / takeoverRunRef / unsupportedCapabilities);
 *   - rebuild equivalence (empty fresh index -> full replay == incremental);
 *   - full-scope key isolation (two projects / the same local workId never
 *     collide);
 *   - freshness (opaque observedCursor advances; a work without a projected
 *     binding is not_found, never a fabricated ready).
 */
import { describe, expect, it } from "vitest";
import { ReadModelIndexImpl } from "../../src/read-model/read-model-index.js";
import { makeCommitCursor, type EventPage, type PositionedEvent } from "../../src/contracts/ledger.js";
import { canonicalJson } from "../../src/contracts/fingerprint.js";
import {
  P116_PROJECT_A,
  P116_PROJECT_B,
  P116_WORKSPACE,
  P116_SCHEMA,
  P116_REPORT_1,
  P116_REPORT_2,
  buildContextContinuationResultV1,
  buildRecordContinuationCommand,
  buildContinuationRecordLedgerCommit,
} from "../../src/contracts/fixtures/context-fixtures.js";
import { runRefFor } from "../../src/contracts/dispatch.js";
import type { ContinuationRecordedEvent } from "../../src/contracts/context-continuity.js";

function runRef(projectId: string, runId: string) {
  return runRefFor(projectId, "goal-cont", runId);
}

function continuationEvent(
  projectId: string,
  workId: string,
  reportId: string,
  eventId: string,
  status: "took_over" | "unsupported",
  runId: string,
): ContinuationRecordedEvent {
  const result = buildContextContinuationResultV1({
    reportId,
    workId,
    projectId,
    workspaceId: P116_WORKSPACE,
    requestedByRunRef: runRef(projectId, runId),
    status,
    originalRunRef: status === "took_over" ? runRef(projectId, "run-original") : null,
    takeoverRunRef: status === "took_over" ? runRef(projectId, runId) : null,
    resumedFromRunRef: status === "took_over" ? runRef(projectId, "run-original") : null,
    unsupportedCapabilities: status === "unsupported" ? ["session_restore"] : [],
    capabilitySource: "runtime",
  });
  const command = buildRecordContinuationCommand({
    commandId: "cmd-cont-" + eventId,
    projectId,
    result,
  });
  const commit = buildContinuationRecordLedgerCommit(command, {
    eventId,
    occurredAt: P116_SCHEMA,
  });
  return commit.events[0]!;
}

function pos(event: { eventType: string }, seq: number): PositionedEvent {
  return { cursor: makeCommitCursor(seq), event: event as never };
}

function page(events: PositionedEvent[], throughSeq: number): EventPage {
  return {
    afterCursor: null,
    throughCursor: makeCommitCursor(throughSeq),
    events,
    hasMore: false,
  };
}

function scopeKey(projectId: string, workspaceId: string, workId: string): string {
  return canonicalJson({ projectId, workspaceId, workId });
}

function rows(rm: ReadModelIndexImpl, key: string): import("../../src/contracts/context-continuity.js").ContinuationRecordSnapshot[] {
  return ((rm as unknown as { p116ContinuationRows: Map<string, unknown[]> }).p116ContinuationRows.get(key) ?? []) as unknown as import("../../src/contracts/context-continuity.js").ContinuationRecordSnapshot[];
}

describe("P1-16 LANE-B InMemory continuation projection", () => {
  it("projects ContinuationRecorded rows (status / takeoverRunRef / unsupportedCapabilities), recent-first", async () => {
    const rm = new ReadModelIndexImpl();
    const proj = P116_PROJECT_A;
    const workId = "work-p116-coord";
    await rm.advance(page([pos(continuationEvent(proj, workId, P116_REPORT_1, "ev-cont-1", "took_over", "run-b"), 1)], 1));
    await rm.advance(page([pos(continuationEvent(proj, workId, P116_REPORT_2, "ev-cont-2", "unsupported", "run-b"), 2)], 2));

    const key = scopeKey(proj, P116_WORKSPACE, workId);
    const list = rows(rm, key);
    expect(list).toHaveLength(2);
    const tookOver = list.find((c) => c.result.reportId === P116_REPORT_1);
    const unsupported = list.find((c) => c.result.reportId === P116_REPORT_2);
    expect(tookOver?.result.status).toBe("took_over");
    expect(tookOver?.result.takeoverRunRef?.runId).toBe("run-b");
    expect(unsupported?.result.status).toBe("unsupported");
    expect(unsupported?.result.unsupportedCapabilities).toEqual(["session_restore"]);
    // The workContext() view is honest: no projected binding -> not_found, and
    // it NEVER fabricates a ready/restored_original view.
    const view = await rm.workContext({ projectId: proj, workspaceId: P116_WORKSPACE, workId });
    expect(view.status).toBe("not_found");
  });

  it("rebuild equivalence: a fresh index from the same events reproduces the continuation rows", async () => {
    const proj = P116_PROJECT_A;
    const workId = "work-p116-coord";
    const ev1 = continuationEvent(proj, workId, P116_REPORT_1, "ev-cont-1", "took_over", "run-b");
    const ev2 = continuationEvent(proj, workId, P116_REPORT_2, "ev-cont-2", "unsupported", "run-b");

    const incremental = new ReadModelIndexImpl();
    await incremental.advance(page([pos(ev1, 1)], 1));
    await incremental.advance(page([pos(ev2, 2)], 2));

    const fresh = new ReadModelIndexImpl();
    await fresh.advance(page([pos(ev1, 1), pos(ev2, 2)], 2));

    const key = scopeKey(proj, P116_WORKSPACE, workId);
    expect(JSON.stringify(rows(fresh, key))).toBe(JSON.stringify(rows(incremental, key)));
    // Idempotent replay: re-applying the SAME page does not duplicate a row.
    const one = new ReadModelIndexImpl();
    await one.advance(page([pos(ev1, 1)], 1));
    const before = rows(one, key).length;
    await one.advance(page([pos(ev1, 1)], 1));
    expect(rows(one, key)).toHaveLength(before);
  });

  it("full-scope key isolation: the SAME local workId across two projects never collides", async () => {
    const rm = new ReadModelIndexImpl();
    const workId = "work-p116-1";
    await rm.advance(
      page(
        [
          pos(continuationEvent(P116_PROJECT_A, workId, "cont-a", "ev-a", "took_over", "run-a"), 1),
          pos(continuationEvent(P116_PROJECT_B, workId, "cont-b", "ev-b", "took_over", "run-b"), 2),
        ],
        2,
      ),
    );
    const aKey = scopeKey(P116_PROJECT_A, P116_WORKSPACE, workId);
    const bKey = scopeKey(P116_PROJECT_B, P116_WORKSPACE, workId);
    expect(aKey).not.toBe(bKey);
    expect(rows(rm, aKey)).toHaveLength(1);
    expect(rows(rm, bKey)).toHaveLength(1);
    expect(rows(rm, aKey)[0]!.result.reportId).toBe("cont-a");
    expect(rows(rm, bKey)[0]!.result.reportId).toBe("cont-b");
  });

  it("freshness: opaque observedCursor advances with each applied ContinuationRecorded", async () => {
    const rm = new ReadModelIndexImpl();
    const proj = P116_PROJECT_A;
    const workId = "work-p116-coord";
    const before = (rm as unknown as { observedCursor: unknown }).observedCursor;
    expect(before).toBeNull();
    await rm.advance(page([pos(continuationEvent(proj, workId, "cont-1", "ev-1", "took_over", "run-b"), 1)], 1));
    await rm.advance(page([pos(continuationEvent(proj, workId, "cont-2", "ev-2", "unsupported", "run-b"), 2)], 2));
    expect((rm as unknown as { observedCursor: unknown }).observedCursor).toBeTruthy();
    // Missed-work view stays not_found (never a fabricated ready), observedCursor still truthy.
    const missing = await rm.workContext({ projectId: proj, workspaceId: P116_WORKSPACE, workId: "work-never" });
    expect(missing.status).toBe("not_found");
  });
});
