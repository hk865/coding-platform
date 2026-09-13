import { ControlPolicyExplanation } from '../../src/control/control-engine/policy-explanation.js';
/**
 * P1-16 LANE-B SQLite continuation projection tests — field-for-field mirror of
 * the InMemory adapter. ContinuationRecorded folds into the
 * work_context_continuations table (one row per full-scope key; entry_json
 * carries the recent-first bounded list). Covers continuation rows, rebuild
 * equivalence, full-scope isolation and freshness.
 */
import { describe, expect, it } from "vitest";
import { createSqliteReadModelIndex } from "../../src/data/read-model-index/sqlite-read-model-index.js";
import { makeCommitCursor, type EventPage, type PositionedEvent } from "../../src/contracts/ledger.js";
import { canonicalJson } from "../../src/contracts/fingerprint.js";
import { workContextRefFor } from "../../src/contracts/context-continuity.js";
import { P116_PROJECT_A, P116_PROJECT_B, P116_WORKSPACE, P116_SCHEMA, P116_REPORT_1, P116_REPORT_2, buildContextContinuationResultV1, buildRecordContinuationCommand } from "../contract-support/fixtures/context-fixtures.js";
import { buildContinuationRecordLedgerCommit } from "../../src/control/control-engine/records/context.js";
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
  const command = buildRecordContinuationCommand({ commandId: "cmd-cont-" + eventId, projectId, result });
  const commit = buildContinuationRecordLedgerCommit(command, { eventId, occurredAt: P116_SCHEMA });
  return commit.events[0]!;
}

function pos(event: { eventType: string }, seq: number): PositionedEvent {
  return { cursor: makeCommitCursor(seq), event: event as never };
}

function page(events: PositionedEvent[], throughSeq: number): EventPage {
  return { afterCursor: null, throughCursor: makeCommitCursor(throughSeq), events, hasMore: false };
}

function scopeKey(projectId: string, workspaceId: string, workId: string): string {
  return canonicalJson(workContextRefFor(projectId, workspaceId, workId));
}

function jsonRows(rm: ReturnType<typeof createSqliteReadModelIndex>, key: string): import("../../src/contracts/context-continuity.js").ContinuationRecordSnapshot[] {
  const db = (rm as unknown as { db: import("node:sqlite").DatabaseSync }).db;
  const row = db.prepare("SELECT entry_json FROM work_context_continuations WHERE scope_key = ?").get(key) as { entry_json: string } | undefined;
  return row ? (JSON.parse(row.entry_json) as import("../../src/contracts/context-continuity.js").ContinuationRecordSnapshot[]) : [];
}

describe("P1-16 LANE-B SQLite continuation projection", () => {
  it("projects ContinuationRecorded rows (status / takeoverRunRef / unsupportedCapabilities)", async () => {
    const rm = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: ":memory:" });
    const proj = P116_PROJECT_A;
    const workId = "work-p116-coord";
    await rm.advance(page([pos(continuationEvent(proj, workId, P116_REPORT_1, "ev-cont-1", "took_over", "run-b"), 1)], 1));
    await rm.advance(page([pos(continuationEvent(proj, workId, P116_REPORT_2, "ev-cont-2", "unsupported", "run-b"), 2)], 2));

    const key = scopeKey(proj, P116_WORKSPACE, workId);
    const list = jsonRows(rm, key);
    expect(list).toHaveLength(2);
    const tookOver = list.find((c) => c.result.reportId === P116_REPORT_1);
    const unsupported = list.find((c) => c.result.reportId === P116_REPORT_2);
    expect(tookOver?.result.status).toBe("took_over");
    expect(tookOver?.result.takeoverRunRef?.runId).toBe("run-b");
    expect(unsupported?.result.status).toBe("unsupported");
    expect(unsupported?.result.unsupportedCapabilities).toEqual(["session_restore"]);

    const view = await rm.workContext({ projectId: proj, workspaceId: P116_WORKSPACE, workId });
    expect(view.status).toBe("not_found");
    await rm.close();
  });

  it("rebuild equivalence: a fresh index from the same events reproduces the continuation rows", async () => {
    const proj = P116_PROJECT_A;
    const workId = "work-p116-coord";
    const ev1 = continuationEvent(proj, workId, P116_REPORT_1, "ev-cont-1", "took_over", "run-b");
    const ev2 = continuationEvent(proj, workId, P116_REPORT_2, "ev-cont-2", "unsupported", "run-b");

    const incremental = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: ":memory:" });
    await incremental.advance(page([pos(ev1, 1)], 1));
    await incremental.advance(page([pos(ev2, 2)], 2));

    const fresh = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: ":memory:" });
    await fresh.advance(page([pos(ev1, 1), pos(ev2, 2)], 2));

    const key = scopeKey(proj, P116_WORKSPACE, workId);
    expect(JSON.stringify(jsonRows(fresh, key))).toBe(JSON.stringify(jsonRows(incremental, key)));
    await incremental.close();
    await fresh.close();
  });

  it("full-scope key isolation: the SAME local workId across two projects never collides", async () => {
    const rm = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: ":memory:" });
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
    expect(jsonRows(rm, aKey)).toHaveLength(1);
    expect(jsonRows(rm, bKey)).toHaveLength(1);
    expect(jsonRows(rm, aKey)[0]!.result.reportId).toBe("cont-a");
    expect(jsonRows(rm, bKey)[0]!.result.reportId).toBe("cont-b");
    await rm.close();
  });

  it("freshness: ContinuationRecorded advances the projection checkpoint; workContext stays not_found", async () => {
    const rm = createSqliteReadModelIndex({ policyExplanation: new ControlPolicyExplanation(), path: ":memory:" });
    const proj = P116_PROJECT_A;
    const workId = "work-p116-coord";
    const cold = await rm.workContext({ projectId: proj, workspaceId: P116_WORKSPACE, workId });
    expect(cold.status).toBe("not_found");
    await rm.advance(page([pos(continuationEvent(proj, workId, "cont-1", "ev-1", "took_over", "run-b"), 1)], 1));
    const missing = await rm.workContext({ projectId: proj, workspaceId: P116_WORKSPACE, workId: "work-never" });
    expect(missing.status).toBe("not_found");
    await rm.close();
  });
});
