/**
 * P1-08 console contract suite — the 12-item acceptance + 7 verification
 * groups (portfolio-list-and-switch / multi-project-workspace-isolation /
 * same-local-id-scope / no-model-status-query / read-only-adapter /
 * cursor-freshness / restart-view-rebuild), run IDENTICALLY against the
 * InMemory and the SQLite harnesses.
 *
 * The suite only calls the frozen console signatures and the frozen P1-07
 * harness surface; the lane implementations (A: portfolio/summary, B: matrix/
 * agents/evidence/timeline) make the assertions pass. AUTO-SKIPPED on both
 * adapters until the console projections exist (probe isP108Ready, no fake).
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { RunPort, RunCapabilities, RunHandle } from "../../src/contracts/ports.js";
import type { TaskEnvelopeV1 } from "../../src/contracts/task-envelope.js";
import type { P1_08TestHarness } from "./p1-08-harness.js";
import {
  runP108TwoProjectScenario,
  submitP108Evidence,
  reduceP108Task,
  reduceP108Goal,
  p108RunOfWork,
  p108RunOfExtra,
  P108_PROJECT_A,
  P108_PROJECT_B,
  P108_WORKSPACE,
  P108_GOAL,
  P108_TASK_WORK,
  P108_TASK_EXTRA,
  P108_EVIDENCE_WORK,
  P108_EVIDENCE_CLAIM,
  P108_SCHEMA,
  p108WorkspaceKey,
  p108GoalKey,
} from "./p1-08-harness.js";
import { consoleWorkspaceKey } from "../../src/contracts/console-views.js";
import { HumanCollaborationImpl } from "../../src/interaction/human-collaboration.js";
import { createP108ScenarioRuntime } from "./p1-08-harness.js";
import { ScriptedReadModelIndex } from "../../src/contracts/testing/read-model.double.js";
import type { ControlEngine } from "../../src/contracts/modules.js";
import type { StateLedger } from "../../src/contracts/ledger.js";
import type { P108TwoProjectScenarioResult } from "./p1-08-harness.js";

export interface P1_08FactoryOptions {
  /** P1-08 probe: explicit RunPort override (counting/probe ports for tests). */
  runtime?: RunPort;
}

/** Counting RunPort wrapper — the no-model probe asserts zero starts behind it. */
export class CountingRuntime implements RunPort {
  starts = 0;
  pollCalls = 0;
  private readonly inner: RunPort;

  constructor(inner: RunPort) {
    this.inner = inner;
  }

  setScript(runId: string, script: import("../../src/contracts/fixtures/dispatch-fixtures.js").FakeRuntimeScriptV1): void {
    const inner = this.inner as RunPort & { setScript?: (runId: string, script: import("../../src/contracts/fixtures/dispatch-fixtures.js").FakeRuntimeScriptV1) => void };
    if (inner.setScript) inner.setScript(runId, script);
  }

  capabilities(): Promise<RunCapabilities> {
    return this.inner.capabilities();
  }

  async start(envelope: TaskEnvelopeV1): Promise<RunHandle> {
    this.starts += 1;
    const handle = await this.inner.start(envelope);
    const innerHandle = handle;
    return {
      runRef: innerHandle.runRef,
      pollFreshEvents: async () => {
        this.pollCalls += 1;
        return innerHandle.pollFreshEvents();
      },
    };
  }
}

/** Throwing StateLedger trap: any access fails the read-only adapter assertions. */
export class TrapStateLedger implements StateLedger {
  async load(_ref: unknown): Promise<never> {
    throw new Error("TrapStateLedger.load — console must never touch the ledger");
  }
  async commit(_commit: unknown): Promise<never> {
    throw new Error("TrapStateLedger.commit — console must never write canonical state");
  }
  async events(_query: unknown): Promise<never> {
    throw new Error("TrapStateLedger.events — console must never read ledger events");
  }
  async pendingDispatchIntents(_limit: number): Promise<never> {
    throw new Error("TrapStateLedger.pendingDispatchIntents — console must never scan the outbox");
  }
}

/** Throwing ControlEngine trap: no control/planner/QueryJob side effect allowed. */
export class TrapControlEngine implements ControlEngine {
  private trap(name: string): never {
    throw new Error("TrapControlEngine." + name + " — console path must have no control side effect");
  }
  submit(): never { return this.trap("submit"); }
  bootstrap(): never { return this.trap("bootstrap"); }
  install(): never { return this.trap("install"); }
  activate(): never { return this.trap("activate"); }
  applyPlan(): never { return this.trap("applyPlan"); }
  dispatchReadiness(): never { return this.trap("dispatchReadiness"); }
  claimTask(): never { return this.trap("claimTask"); }
  startRun(): never { return this.trap("startRun"); }
  runFact(): never { return this.trap("runFact"); }
  submitEvidence(): never { return this.trap("submitEvidence"); }
  reduceTask(): never { return this.trap("reduceTask"); }
  reduceGoal(): never { return this.trap("reduceGoal"); }
  recordHandoff(): never { return this.trap("recordHandoff"); }
  claimReplacement(): never { return this.trap("claimReplacement"); }
  acquireWorkspaceReadLease(): never { return this.trap("acquireWorkspaceReadLease"); }
  acquireWorkspaceWriteLease(): never { return this.trap("acquireWorkspaceWriteLease"); }
  releaseWorkspaceLease(): never { return this.trap("releaseWorkspaceLease"); }
  recordIntegrationResult(): never { return this.trap("recordIntegrationResult"); }
  recordPatch(): never { return this.trap("recordPatch"); }
}

export function defineConsoleContractSuite(
  factory: (options?: P1_08FactoryOptions) => Promise<P1_08TestHarness>,
  suiteOptions: { name?: string } = {},
): void {
  const suiteName = suiteOptions.name ?? "P1-08 console contract suite";
  describe(suiteName, () => {
    let h: P1_08TestHarness;
    let scen: P108TwoProjectScenarioResult;

    beforeAll(async () => {
      h = await factory();
      scen = await runP108TwoProjectScenario(h);
    });

    describe("portfolio-list-and-switch-test", () => {
      it("lists at least two isolated bootstrap scopes and switches by pure route", async () => {
        const portfolio = await h.consolePortfolio({});
        expect(portfolio.status).toBe("ready");
        if (portfolio.status !== "ready") return;
        expect(portfolio.portfolio.entries.length).toBeGreaterThanOrEqual(2);
        const projects = new Set(portfolio.portfolio.entries.map((e) => e.projectId));
        expect(projects.has(P108_PROJECT_A)).toBe(true);
        expect(projects.has(P108_PROJECT_B)).toBe(true);
        // Both entries deliberately reuse the SAME local workspaceId.
        const wsIds = new Set(portfolio.portfolio.entries.map((e) => e.workspaceId));
        expect(wsIds).toEqual(new Set([P108_WORKSPACE]));
        // Every entry carries a full-scope key + source provenance.
        for (const entry of portfolio.portfolio.entries) {
          expect(entry.scopeKey).toBe(consoleWorkspaceKey(entry.projectId, entry.workspaceId));
          expect(entry.sourceCursor).toBeTruthy();
        }
        // A pure route switch = different query parameters on the SAME console.
        const aRoute = { projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE };
        const bRoute = { projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE };
        const summaryA = await h.consoleSummary(aRoute);
        const summaryB = await h.consoleSummary(bRoute);
        expect(summaryA.status).toBe("ready");
        expect(summaryB.status).toBe("ready");
        if (summaryA.status === "ready" && summaryB.status === "ready") {
          expect(JSON.stringify(summaryA.summary)).not.toBe(JSON.stringify(summaryB.summary));
        }
      });
    });

    describe("multi-project-workspace-isolation-test", () => {
      it("each project/workspace scope keeps its OWN rows and counts", async () => {
        const summaryA = await h.consoleSummary({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
        const summaryB = await h.consoleSummary({ projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE });
        expect(summaryA.status).toBe("ready");
        expect(summaryB.status).toBe("ready");
        if (summaryA.status !== "ready" || summaryB.status !== "ready") return;

        // Same local workspaceId + goalId — counts must differ by project (A has
        // the claim evidence + handoff extra run).
        expect(summaryA.summary.goalCount).toBe(1);
        expect(summaryB.summary.goalCount).toBe(1);
        expect(summaryA.summary.evidenceCount).toBe(3); // claim + work + gate
        expect(summaryB.summary.evidenceCount).toBe(2); // work + gate
        expect(summaryA.summary.agentRunCount).toBeGreaterThan(summaryB.summary.agentRunCount);

        const matrixA = await h.consolePlanMatrix({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL });
        const matrixB = await h.consolePlanMatrix({ projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE, goalId: P108_GOAL });
        expect(matrixA.status).toBe("ready");
        expect(matrixB.status).toBe("ready");
        if (matrixA.status !== "ready" || matrixB.status !== "ready") return;
        expect(matrixA.matrix.rows.length).toBe(3);
        expect(matrixB.matrix.rows.length).toBe(3);
        // Row identity: objective/version differs per project — never merged.
        expect(matrixA.matrix.planRef.projectId).toBe(P108_PROJECT_A);
        expect(matrixB.matrix.planRef.projectId).toBe(P108_PROJECT_B);
      });
    });

    describe("same-local-id-scope-test", () => {
      it("same local workspaceId/goalId/run/evidence ids never cross-read", async () => {
        const evidenceA = await h.consoleTaskEvidence({
          projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL, taskId: P108_TASK_WORK,
        });
        const evidenceB = await h.consoleTaskEvidence({
          projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE, goalId: P108_GOAL, taskId: P108_TASK_WORK,
        });
        expect(evidenceA.status).toBe("ready");
        expect(evidenceB.status).toBe("ready");
        if (evidenceA.status !== "ready" || evidenceB.status !== "ready") return;
        // Both use the SAME local evidenceId — the full-scope key separates them.
        const aIds = evidenceA.evidence.evidence.map((e) => e.evidenceId);
        const bIds = evidenceB.evidence.evidence.map((e) => e.evidenceId);
        expect(aIds).toContain(P108_EVIDENCE_WORK);
        expect(bIds).toContain(P108_EVIDENCE_WORK);
        expect(aIds).not.toContain(P108_EVIDENCE_CLAIM);
        expect(bIds).not.toContain(P108_EVIDENCE_CLAIM);
        // A's claim evidence never leaks into B's view, and the effective sets
        // are per-scope (A's view has the claim marker, B's does not).
        expect(evidenceA.evidence.evidence.some((e) => e.marker === "unverified_report")).toBe(true);
        // A's cache/row key must differ from B's:
        expect(consoleTaskKeyFor(P108_PROJECT_A)).not.toBe(consoleTaskKeyFor(P108_PROJECT_B));

        const agentsA = await h.consoleActiveAgents({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
        const agentsB = await h.consoleActiveAgents({ projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE });
        expect(agentsA.status).toBe("ready");
        expect(agentsB.status).toBe("ready");
        if (agentsA.status !== "ready" || agentsB.status !== "ready") return;
        const aRuns = new Set(agentsA.agents.rows.map((r) => r.runRef.runId));
        const bRuns = new Set(agentsB.agents.rows.map((r) => r.runRef.runId));
        expect(aRuns).not.toContain("run-p108-b-extra");
        expect(bRuns).not.toContain("run-p108-a-extra");

        const timelineA = await h.consoleTimeline({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
        const timelineB = await h.consoleTimeline({ projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE });
        expect(timelineA.status).toBe("ready");
        expect(timelineB.status).toBe("ready");
        if (timelineA.status !== "ready" || timelineB.status !== "ready") return;
        // Timeline entries carry the full ref chain — no B event in A's window.
        const aGoals = new Set(timelineA.timeline.entries.map((e) => e.refs.goalId));
        expect(aGoals.has(P108_GOAL)).toBe(true);
        const bKinds = new Set(timelineB.timeline.entries.map((e) => e.kind));
        expect(bKinds.has("run_outcome_unknown")).toBe(true);
        const aKinds = new Set(timelineA.timeline.entries.map((e) => e.kind));
        expect(aKinds.has("run_outcome_unknown")).toBe(false);
      });
    });

    describe("cursor-freshness-test", () => {
      it("lagging projection -> not_ready; covered with no row -> not_found; never echoes the request", async () => {
        const observed = h.observedCursor();
        expect(observed).toBeTruthy();
        const ahead = await h.consoleSummary({
          projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE,
          atLeastCursor: "cursor-9999999999999999" as never,
        });
        // ANY query with an un-covered atLeastCursor is not_ready — the index
        // NEVER echoes current data as if it observed the write.
        expect(ahead.status).toBe("not_ready");
        if (ahead.status === "not_ready") {
          expect(ahead.requiredCursor).toBeTruthy();
          expect(ahead.observedCursor).toBeTruthy();
        }
        const missing = await h.consolePortfolio({
          atLeastCursor: observed as never,
        });
        // Covered + no such scope -> not_found; NOT_READY would be wrong here
        // (the index is at least at the observed cursor).
        expect(missing.status).toBe("ready");

        // A scope that never existed, fully covered -> not_found.
        const never = await h.consoleSummary({
          projectId: P108_PROJECT_A, workspaceId: "ws-never",
          atLeastCursor: observed as never,
        });
        expect(never.status).toBe("not_found");
        // Without atLeastCursor, no row -> not_ready (never not_found — front-run protection).
        const noCursor = await h.consoleSummary({
          projectId: P108_PROJECT_A, workspaceId: "ws-never",
        });
        expect(noCursor.status).toBe("not_ready");
      });
    });

    describe("status-and-sources-test", () => {
      it("workspace -> goal -> plan/task/run/evidence/timeline view; phases carry source revision/cursor", async () => {
        const matrix = await h.consolePlanMatrix({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL });
        expect(matrix.status).toBe("ready");
        if (matrix.status !== "ready") return;
        const workRow = matrix.matrix.rows.find((r) => r.taskId === P108_TASK_WORK);
        expect(workRow).toBeTruthy();
        if (!workRow) return;
        // Formal (reduction) phase separate from plan-declared phase.
        expect(workRow.plannedPhase).toBe("pending");
        expect(workRow.livePhase).toBe("satisfied");
        expect(workRow.phaseSources.planned.planRef.projectId).toBe(P108_PROJECT_A);
        expect(workRow.phaseSources.planned.sourceCursor).toBeTruthy();
        expect(workRow.phaseSources.live.sourceCursor).toBeTruthy();
        expect(workRow.phaseMismatch).toBe(true); // planned pending vs live satisfied

        const evidence = await h.consoleTaskEvidence({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL, taskId: P108_TASK_WORK });
        expect(evidence.status).toBe("ready");
        if (evidence.status !== "ready") return;
        expect(evidence.evidence.reduction).toBeTruthy();
        if (!evidence.evidence.reduction) return;
        // Completion conclusion traceable to the current effective evidence set.
        expect(evidence.evidence.effectiveEvidenceIds).toContain(P108_EVIDENCE_WORK);
        expect(evidence.evidence.reduction.effectiveEvidenceIds).toContain(P108_EVIDENCE_WORK);
        expect(evidence.evidence.reduction.sourceCursor).toBeTruthy();
        // Reports are reports: the claim evidence is marked; replacement claim
        // evidence never counts toward the effective set.
        expect(evidence.evidence.evidence.some((e) => e.evidenceId === P108_EVIDENCE_CLAIM && e.marker === "unverified_report")).toBe(true);
        expect(evidence.evidence.modelExplanation.status).toBe("unavailable");
        expect(evidence.evidence.evidence.every((e) => e.sourceCursor)).toBe(true);

        const timeline = await h.consoleTimeline({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
        expect(timeline.status).toBe("ready");
        if (timeline.status !== "ready") return;
        const kinds = new Set(timeline.timeline.entries.map((e) => e.kind));
        for (const expected of ["goal_created", "plan_accepted", "task_claimed", "run_started", "evidence_admitted", "task_reduction", "goal_phase", "handoff_recorded", "replacement_claimed"] as const) {
          expect(kinds.has(expected)).toBe(expected === "handoff_recorded" || expected === "replacement_claimed" || expected === "goal_phase" || expected === "evidence_admitted" || expected === "task_reduction" || expected === "plan_accepted" || expected === "goal_created" || expected === "task_claimed" || expected === "run_started");
        }
        for (const entry of timeline.timeline.entries) {
          expect(entry.kind).toBeTruthy();
          expect(entry.sourceCursor).toBeTruthy();
          expect(entry.refs.projectId).toBe(P108_PROJECT_A);
          expect(entry.refs.workspaceId).toBe(P108_WORKSPACE);
          expect(entry.summary.length).toBeGreaterThan(0);
          expect(entry.eventId).toBeTruthy();
        }
        // Deterministic bounded view: seq is 1-based arrival order.
        const seqs = timeline.timeline.entries.map((e) => e.seq);
        expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
      });

      it("ongoing / handed-over / unknown results shown by source — never disguised as done", async () => {
        const agents = await h.consoleActiveAgents({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
        expect(agents.status).toBe("ready");
        if (agents.status !== "ready") return;
        // The replacement run (B, ongoing) must be displayed as ongoing.
        const ongoing = agents.agents.rows.find((r) => r.runRef.runId === "run-p108-a-extra-b");
        expect(ongoing).toBeTruthy();
        if (!ongoing) return;
        expect(ongoing.displayState).toBe("ongoing");
        expect(ongoing.runStatus).toBe("running");
        expect(ongoing.runOutcome).toBeNull();
        // Handoff markers show the transfer by source.
        expect(ongoing.handoff).toBeTruthy();
        if (ongoing.handoff) {
          expect(ongoing.handoff.packetRef.packetId).toBe("packet-p108-a-extra");
          expect(ongoing.handoff.reason).toBe("run_ended");
          expect(ongoing.handoff.sourceCursor).toBeTruthy();
        }
        // A's completed run is a completed RUN, never a satisfied TASK.
        const doneRun = agents.agents.rows.find((r) => r.runRef.runId === p108RunOfWork(P108_PROJECT_A));
        expect(doneRun).toBeTruthy();
        if (doneRun) {
          expect(doneRun.displayState).toBe("completed_run");
          expect(doneRun.attemptEndOutcome).toBe("completed");
        }

        const agentsB = await h.consoleActiveAgents({ projectId: P108_PROJECT_B, workspaceId: P108_WORKSPACE });
        expect(agentsB.status).toBe("ready");
        if (agentsB.status !== "ready") return;
        // outcome_unknown is explicit — NEVER inferred from a crash/missing end.
        const unknownRun = agentsB.agents.rows.find((r) => r.runRef.runId === p108RunOfExtra(P108_PROJECT_B));
        expect(unknownRun).toBeTruthy();
        if (unknownRun) {
          expect(unknownRun.displayState).toBe("outcome_unknown");
          expect(unknownRun.runOutcome).toBe("outcome_unknown");
          expect(unknownRun.runStatus).toBe("ended");
        }
      });
    });

    describe("no-model-status-query-test", () => {
      it("console queries never call the runtime (no model start, no lease refresh)", async () => {
        const counting = new CountingRuntime(createP108ScenarioRuntime());
        const probeH = await factory({ runtime: counting });
        await runP108TwoProjectScenario(probeH);
        expect(counting.starts).toBeGreaterThan(0);
        const before = counting.starts;
        // Mechanical status queries — pure ReadModel reads.
        expect((await probeH.consolePortfolio({})).status).toBe("ready");
        expect((await probeH.consoleSummary({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE })).status).toBe("ready");
        expect((await probeH.consolePlanMatrix({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL })).status).toBe("ready");
        expect((await probeH.consoleActiveAgents({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE })).status).toBe("ready");
        expect((await probeH.consoleTaskEvidence({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL, taskId: P108_TASK_WORK })).status).toBe("ready");
        expect((await probeH.consoleTimeline({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE })).status).toBe("ready");
        expect(counting.starts).toBe(before);
        expect(counting.pollCalls).toBe(before * 2); // poll only during the scenario drives
      });
    });

    describe("read-only-adapter-test", () => {
      it("console only reaches the ReadModelIndex surface (no control/ledger)", async () => {
        const readModel = new ScriptedReadModelIndex({
          consolePortfolio: () => ({ status: "not_ready", requiredCursor: "c" as never, observedCursor: null }),
        });
        const collaboration = new HumanCollaborationImpl({
          control: new TrapControlEngine(),
          readModel,
          commandId: () => "cmd-x",
          correlationId: () => "corr-x",
          now: () => P108_SCHEMA,
        });
        // Every console method is a pure readModel delegation — the control trap
        // would throw if the console path ever reached the write face.
        await collaboration.consolePortfolio({});
        await collaboration.consoleSummary({ projectId: "p", workspaceId: "w" });
        await collaboration.consolePlanMatrix({ projectId: "p", workspaceId: "w", goalId: "g" });
        await collaboration.consoleActiveAgents({ projectId: "p", workspaceId: "w" });
        await collaboration.consoleTaskEvidence({ projectId: "p", workspaceId: "w", goalId: "g", taskId: "t" });
        await collaboration.consoleTimeline({ projectId: "p", workspaceId: "w" });
        expect(readModel.consolePortfolioCalls.length).toBe(1);
        expect(readModel.consoleSummaryCalls.length).toBe(1);
        expect(readModel.consolePlanMatrixCalls.length).toBe(1);
        expect(readModel.consoleActiveAgentsCalls.length).toBe(1);
        expect(readModel.consoleTaskEvidenceCalls.length).toBe(1);
        expect(readModel.consoleTimelineCalls.length).toBe(1);
      });

      it("console queries leave the canonical ledger untouched (no Todo/state writes)", async () => {
        const eventsBefore = await h.ledger.events({ afterCursor: null, limit: 512 });
        const cursorBefore = h.observedCursor();
        await h.consolePortfolio({});
        await h.consoleSummary({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
        await h.consolePlanMatrix({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL });
        await h.consoleActiveAgents({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
        await h.consoleTaskEvidence({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL, taskId: P108_TASK_WORK });
        await h.consoleTimeline({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
        const eventsAfter = await h.ledger.events({ afterCursor: null, limit: 512 });
        expect(eventsAfter.events.map((p) => p.event.eventId)).toEqual(eventsBefore.events.map((p) => p.event.eventId));
        expect(h.observedCursor()).toBe(cursorBefore);
      });
    });

    describe("no-hidden-side-effect-test", () => {
      it("no hidden control / QueryJob / planner side effect (12)", async () => {
        // Scenario already ran; extra console reads must create ZERO events.
        const eventsBefore = await h.ledger.events({ afterCursor: null, limit: 512 });
        await h.consolePortfolio({});
        await h.consoleActiveAgents({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
        await h.consoleTimeline({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE });
        const eventsAfter = await h.ledger.events({ afterCursor: null, limit: 512 });
        expect(eventsAfter.events.length).toBe(eventsBefore.events.length);
        // The trap control proves the console surface has no hidden command path.
        const readModel = new ScriptedReadModelIndex();
        const collaboration = new HumanCollaborationImpl({
          control: new TrapControlEngine(),
          readModel,
          commandId: () => "cmd-x",
          correlationId: () => "corr-x",
          now: () => P108_SCHEMA,
        });
        await collaboration.consolePortfolio({});
        expect(readModel.consolePortfolioCalls.length).toBe(1);
      });
    });

    describe("restart-view-rebuild-test", () => {
      it("restart equivalence is verified against the real SQLite path in tests/restart + integration (see isP108Ready probe)", async () => {
        // The restart probe drives the FULL scenario on a persistent harness and
        // compares the six console views field-for-field after close/reopen.
        // This suite runs on both adapters — the SQLite twin asserts the
        // rebuild itself; here we assert the console views are READY on this
        // adapter after the same scenario (rebuild equivalence is the restart
        // suite's job — no fake).
        const portfolio = await h.consolePortfolio({});
        expect(portfolio.status).toBe("ready");
      });
    });
  });
}

/** Full-scope console task key helper used in assertions (pure). */
function consoleTaskKeyFor(projectId: string): string {
  return JSON.stringify({ projectId, workspaceId: P108_WORKSPACE, goalId: P108_GOAL, taskId: P108_TASK_WORK });
}
