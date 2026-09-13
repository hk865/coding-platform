/**
 * Lane C tests — ReviewContextCompiler (bounded ReviewPacket, body-first,
 * deterministic rejections with zero writes). Uses the shared harness +
 * scenario helpers (read-only use of contract-suite).
 */
import { describe, expect, it } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { toP1_04Harness, prepareP104Scenario, runP104ClaimedRun, P104_GOAL, P104_TASKS, SCHEMA, type P1_04TestHarness } from "../contract-suite/p1-04-harness.js";
import type { ReviewContextRequestV1 } from "../../src/contracts/review-context.js";
import { REVIEW_PACKET_MAX_BYTES, REVIEW_PACKET_MAX_MATERIALS } from "../../src/contracts/review-context.js";

const REVIEW = P104_TASKS.review;

async function setup(): Promise<{ h: P1_04TestHarness; projectId: string; goalId: string; runRef: import("../../src/contracts/dispatch.js").RunRef }> {
  const h = toP1_04Harness(createInMemoryHarness({ deps: {} }));
  const sc = await prepareP104Scenario(h);
  const run = await runP104ClaimedRun(h, { projectId: sc.alpha.projectId, taskId: REVIEW, runId: "run-c-t", attemptId: "att-c-t" });
  return { h, projectId: sc.alpha.projectId, goalId: sc.alpha.goalId, runRef: run.runRef };
}

function requestFor(deps: { projectId: string; goalId: string; runRef: import("../../src/contracts/dispatch.js").RunRef }, partial: Partial<ReviewContextRequestV1> = {}): ReviewContextRequestV1 {
  return {
    schemaVersion: 1,
    requestId: "req-c-1",
    projectId: deps.projectId,
    workspaceId: "ws-shared",
    goalId: deps.goalId,
    taskId: REVIEW,
    planRef: { aggregateType: "PlanRevision", projectId: deps.projectId, planId: "plan-evidence-mvp" },
    runRef: deps.runRef,
    attemptRef: { aggregateType: "TaskAttempt", projectId: deps.projectId, goalId: deps.goalId, taskId: REVIEW, attemptId: "att-c-t" },
    roleBinding: {
      schemaVersion: 1, bindingId: "binding-review-v1", templateId: "template-reviewer",
      templateRevision: "2026-09-05", bindingVersion: 1, policyRevision: "auth-policy-runtime-v1",
    },
    declaredPermissions: { tools: ["read", "write"], writeScope: ["src/contracts"] },
    scope: { tools: ["read"], writeScope: ["src/contracts"] },
    workspaceSnapshot: { workspaceId: "ws-shared", revision: 1 },
    changeScope: { diffClass: "code-change", changedFiles: ["src/a.ts"], writeSummary: "change" },
    semanticChange: "semantic",
    risks: [{ level: "low", description: "local" }],
    contractPoints: [{ refId: "contract-1", point: "语义变化与义务覆盖一致性" }],
    budget: { tokenBudget: 10_000, deadline: "2026-09-06T00:00:00.000Z" },
    submittedAt: SCHEMA,
    ...partial,
  };
}

describe("ReviewContextCompiler (Lane C)", () => {
  it("ready: bounded ReviewPacket + body-first bundle readable by the owning run", async () => {
    const s = await setup();
    const before = await s.h.ledger.events({ afterCursor: null, limit: 500 });
    const result = await s.h.assembleReview(requestFor(s));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.packet.total.noFullTranscript).toBe(true);
    expect(result.packet.total.materialCount).toBeGreaterThanOrEqual(1);
    expect(result.packet.total.materialCount).toBeLessThanOrEqual(REVIEW_PACKET_MAX_MATERIALS);
    expect(result.packet.rubric.obligations.length).toBeGreaterThanOrEqual(1);
    expect(result.packet.pinnedCompletionPolicy.digest.length).toBe(64);
    expect(result.packet.planRevision).toBe(1);
    expect(result.bundleRef.digest.length).toBe(64);
    expect(result.manifest.selectedRefs.length).toBeGreaterThanOrEqual(1);
    expect(result.manifest.gaps).toEqual([]);
    const opened = await (s.h as unknown as { vault: import("../../src/contracts/artifact.js").ArtifactPort }).vault.open(result.bundleRef, { requesterRunRef: s.runRef });
    expect(opened.status).toBe("ready");
    if (opened.status === "ready") {
      const body = JSON.parse(opened.record.body) as { packetId: string; note: string };
      expect(body.packetId).toBe(result.packet.packetId);
      expect(body.note).toContain("no full transcript");
    }
    const after = await s.h.ledger.events({ afterCursor: null, limit: 500 });
    expect(after.events.length).toBe(before.events.length); // vault-only write; no domain events
  });

  it("rejections zero-write: forbidden/stale-workspace/not-semantic/budget/out-of-scope", async () => {
    const s = await setup();
    const before = await s.h.ledger.events({ afterCursor: null, limit: 500 });
    const cases: [Partial<ReviewContextRequestV1>, string][] = [
      [{ scope: { tools: ["pwn"], writeScope: [] } }, "forbidden_tool_or_scope"],
      [{ workspaceSnapshot: { workspaceId: "ws-shared", revision: 2 } }, "stale_workspace_snapshot"],
      [{ semanticChange: "none" }, "not_semantic_change"],
      [{ budget: { tokenBudget: 10_000, deadline: "2020-01-01T00:00:00.000Z" } }, "budget_exhausted"],
      [{ planRef: { aggregateType: "PlanRevision", projectId: s.projectId, planId: "plan-not-current" } }, "out_of_scope"],
    ];
    for (const [partial, code] of cases) {
      const result = await s.h.assembleReview(requestFor(s, partial));
      expect(result.status, "expected rejected " + code).toBe("rejected");
      if (result.status === "rejected") expect(result.code).toBe(code);
    }
    const after = await s.h.ledger.events({ afterCursor: null, limit: 500 });
    expect(after.events.length).toBe(before.events.length);
  });

  it("exceeds_size_cap: oversized contract points fail deterministically, zero-write", async () => {
    const s = await setup();
    const before = await s.h.ledger.events({ afterCursor: null, limit: 500 });
    const flood = Array.from({ length: 400 }, (_, i) => ({ refId: "cp-" + i, point: "x".repeat(120) }));
    const result = await s.h.assembleReview(requestFor(s, { contractPoints: flood }));
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.code).toBe("exceeds_size_cap");
    const after = await s.h.ledger.events({ afterCursor: null, limit: 500 });
    expect(after.events.length).toBe(before.events.length);
  }, 20_000);

  it("needs_material: unknown goal, and full byte cap constant sanity", async () => {
    const s = await setup();
    const unknownGoal = await s.h.assembleReview(requestFor(s, { goalId: "goal-unknown" }));
    expect(unknownGoal.status).toBe("needs_material");
    expect(REVIEW_PACKET_MAX_BYTES).toBe(32 * 1024);
  });
});
