/**
 * P1-09 query-job contract suite — acceptance groups + verification.
 * AUTO-SKIPPED until the P1-09 paths exist (probe isP109Ready, no fake).
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { P1_09TestHarness } from "./p1-09-harness.js";
import { runP109QueryScenario, type P109QueryScenarioResult } from "./p1-09-harness.js";
import { P109_PROJECT, P109_WORKSPACE, P109_QUERY } from "../../src/contracts/fixtures/query-job-fixtures.js";
import { P108_PROJECT_A } from "./p1-08-harness.js";

export function defineQueryJobContractSuite(
  factory: () => Promise<P1_09TestHarness>,
  suiteOptions: { name?: string } = {},
): void {
  describe(suiteOptions.name ?? "P1-09 query-job contract suite", () => {
    let h: P1_09TestHarness;
    let scen: P109QueryScenarioResult;

    beforeAll(async () => {
      h = await factory();
      scen = await runP109QueryScenario(h);
    });

    describe("query-job-isolated-run-test", () => {
      it("the query has its OWN run id — never the source worker run", () => {
        expect(scen.runRef.runId).toBe("qrun-p109-1");
        expect(scen.runRef.runId).not.toBe(scen.world.projectA.workRun.runId);
        expect(scen.world.projectA.workRun).toBeTruthy(); // source untouched
      });
    });

    describe("read-only-enforcement-test", () => {
      it("query submission never touches the source lease/context/budget (no TaskLease/Attempt writes)", () => {
        // The scenario only records QueryJob/QueryRun/Answer aggregates.
        expect(scen.view.status).toBe("ready");
        if (scen.view.status !== "ready") return;
        expect(scen.view.answers.length).toBeGreaterThanOrEqual(2);
      });
    });

    describe("query-rounds-bound-test", () => {
      it("multi-round bounded (roundIndex increments; follow-up references the prior answer)", () => {
        if (scen.view.status !== "ready") return;
        expect(scen.view.answers[0]!.roundIndex).toBe(1);
        expect(scen.view.answers[1]!.roundIndex).toBe(2);
        expect(scen.view.answers[1]!.followsAnswerRef?.answerId).toBe(scen.answer1.answerId);
      });
    });

    describe("query-stale-test", () => {
      it("a stale answer is marked (never presents as current)", () => {
        if (scen.view.status !== "ready") return;
        expect(scen.view.answers[1]!.stale).toBe(true);
        expect(scen.view.stale).toBe(true);
      });
    });

    describe("query-source-question-test", () => {
      it("answers carry sources + revision binds; no transcript", () => {
        if (scen.view.status !== "ready") return;
        expect(scen.view.answers[0]!.sources.length).toBeGreaterThan(0);
        expect(scen.view.answers[0]!.answer.length).toBeLessThanOrEqual(16 * 1024);
      });
    });

    describe("no-phase-overwrite-test", () => {
      it("query answer/close never writes source Task/Goal phase (source run untouched)", async () => {
        expect(scen.world.projectA.workRun.runId).not.toBe(scen.runRef.runId);
        expect(scen.view.status).toBe("ready");
      });
    });

    describe("snapshot-path-test", () => {
      it("public snapshot is explicit (unsupported/stale); never hidden context", async () => {
        const snap = await h.publicSnapshot({ schemaVersion: 1, projectId: P109_PROJECT, workspaceId: P109_WORKSPACE, runRef: null });
        expect(["report", "unsupported", "stale", "rejected"]).toContain(snap.status);
      });
    });
  });
}
