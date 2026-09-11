/**
 * Lane B tests — FakeHandoffControlRuntimeAdapter (pause/stop one-way state
 * machine + public snapshot/report; never hidden context, noHiddenContextRead).
 * The adapter composes a RunPort, but the RunPort surface has no snapshot/event
 * registry accessor, so runs are fed in via noteRun() (progress injected/observed
 * by the "轻量同步" the frozen wiring allows). The report exposes ONLY public
 * facts — never a transcript / bundle body.
 */
import { describe, expect, it } from "vitest";
import { FakeHandoffControlRuntimeAdapter } from "../../src/execution/worker-runtime/handoff-control-adapter.js";
import { createFakeRuntimeAdapter } from "../../src/execution/worker-runtime/fake-runtime-adapter.js";
import { FAKE_RUNTIME_SCRIPT_COMPLETED_V1 } from "../../src/fixtures/dispatch-fixtures.js";
import { runRefFor } from "../../src/contracts/dispatch.js";
import type { RunRef } from "../../src/contracts/dispatch.js";
import type { HandoffControlCommandV1 } from "../../src/contracts/handoff-control.js";

const PROJECT = "proj-ctrl";
const GOAL = "goal-ctrl";

const runA: RunRef = runRefFor(PROJECT, GOAL, "run-a");
const runB: RunRef = runRefFor(PROJECT, GOAL, "run-b");
const runC: RunRef = runRefFor(PROJECT, GOAL, "run-c");

function adapter() {
  return new FakeHandoffControlRuntimeAdapter(createFakeRuntimeAdapter(FAKE_RUNTIME_SCRIPT_COMPLETED_V1));
}

function cmd(kind: HandoffControlCommandV1["kind"], reason = "safe point", submittedAt = "2026-09-05T12:00:00.000Z"): HandoffControlCommandV1 {
  return { schemaVersion: 1, kind, reason, correlationId: "corr-" + kind, submittedAt };
}

describe("FakeHandoffControlRuntimeAdapter (Lane B)", () => {
  it("pause -> accepted/paused (noHiddenContextRead true, pausedSince set)", async () => {
    const c = adapter();
    c.noteRun(runA, { lastEventSeq: 4, terminalOutcome: null });
    const res = await c.control(cmd("pause", "checkpoint"));
    expect(res.status).toBe("accepted");
    if (res.status === "accepted") {
      expect(res.state.status).toBe("paused");
      expect(res.state.noHiddenContextRead).toBe(true);
      expect(res.state.pausedSince).toBe("2026-09-05T12:00:00.000Z");
      expect(res.state.stoppedSince).toBeNull();
      expect(res.state.lastReason).toBe("checkpoint");
      expect(res.state.reportRef).toBeNull();
    }
  });

  it("stop -> accepted/stopped; a second stop -> already_stopped", async () => {
    const c = adapter();
    c.noteRun(runA);
    const stop = await c.control(cmd("stop", "handoff complete", "2026-09-05T13:00:00.000Z"));
    expect(stop.status).toBe("accepted");
    if (stop.status === "accepted") {
      expect(stop.state.status).toBe("stopped");
      expect(stop.state.stoppedSince).toBe("2026-09-05T13:00:00.000Z");
      expect(stop.state.noHiddenContextRead).toBe(true);
    }
    const again = await c.control(cmd("stop", "again"));
    expect(again.status).toBe("rejected");
    if (again.status === "rejected") expect(again.code).toBe("already_stopped");
  });

  it("pause then stop is allowed (one-way running -> paused -> stopped)", async () => {
    const c = adapter();
    c.noteRun(runB);
    const paused = await c.control(cmd("pause", "safe point"));
    expect(paused.status).toBe("accepted");
    const stopped = await c.control(cmd("stop", "handoff complete"));
    expect(stopped.status).toBe("accepted");
    if (stopped.status === "accepted") {
      expect(stopped.state.status).toBe("stopped");
      expect(stopped.state.pausedSince).toBe("2026-09-05T12:00:00.000Z"); // preserved from pause
      expect(stopped.state.stoppedSince).toBe("2026-09-05T12:00:00.000Z");
    }
  });

  it("invalid commands -> rejected invalid (schemaVersion / kind / empty reason)", async () => {
    const c = adapter();
    c.noteRun(runA);
    const badNum = { schemaVersion: 2, kind: "pause", reason: "r", correlationId: "c", submittedAt: "t" } as unknown as HandoffControlCommandV1;
    const bad = await c.control(badNum);
    expect(bad.status).toBe("rejected");
    if (bad.status === "rejected") expect(bad.code).toBe("invalid");
    const badKind = { schemaVersion: 1, kind: "cancel", reason: "r", correlationId: "c", submittedAt: "t" } as never;
    const r1 = await c.control(badKind);
    expect(r1.status).toBe("rejected");
    if (r1.status === "rejected") expect(r1.code).toBe("invalid");
    const emptyReason = { schemaVersion: 1, kind: "pause", reason: "", correlationId: "c", submittedAt: "t" } as never;
    const r2 = await c.control(emptyReason);
    expect(r2.status).toBe("rejected");
    if (r2.status === "rejected") expect(r2.code).toBe("invalid");
  });

  it("no known run -> rejected run_not_found", async () => {
    const c = adapter();
    const res = await c.control(cmd("pause"));
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.code).toBe("run_not_found");
  });

  it("snapshot: ready for a known run; public report with noHiddenContextRead and no transcript", async () => {
    const c = adapter();
    c.noteRun(runB, { lastEventSeq: 7, terminalOutcome: "completed" });
    const snap = await c.snapshot({ schemaVersion: 1, runRef: runB });
    expect(snap.status).toBe("ready");
    if (snap.status === "ready") {
      expect(snap.state.noHiddenContextRead).toBe(true);
      expect(snap.state.status).toBe("running");
      expect(snap.report.noHiddenContextRead).toBe(true);
      expect(snap.report.runRef.runId).toBe("run-b");
      expect(snap.report.lastEventSeq).toBe(7);
      expect(snap.report.terminalOutcome).toBe("completed");
      expect(snap.report.reportRef).toBeNull();
      expect(snap.report.summary).toContain("run-b");
      expect(snap.report.summary).toContain("7 facts");
      // The public report never exposes hidden context.
      expect(JSON.stringify(snap.report)).not.toContain("transcript");
      expect(JSON.stringify(snap.state)).not.toContain("transcript");
    }
  });

  it("snapshot: unknown run -> unsupported (does not fabricate state)", async () => {
    const c = adapter();
    c.noteRun(runA);
    const snap = await c.snapshot({ schemaVersion: 1, runRef: runC });
    expect(snap.status).toBe("unsupported");
    expect(JSON.stringify(snap)).not.toContain("transcript");
  });

  it("snapshot: invalid schemaVersion -> rejected invalid", async () => {
    const c = adapter();
    c.noteRun(runA);
    const snap = await c.snapshot({ schemaVersion: 2, runRef: runA } as never);
    expect(snap.status).toBe("rejected");
    if (snap.status === "rejected") expect(snap.code).toBe("invalid");
  });

  it("run selection: single known run is used; with two, the most recently started/noted wins", async () => {
    // Single known run.
    const single = adapter();
    single.noteRun(runA);
    const p = await single.control(cmd("pause"));
    expect(p.status).toBe("accepted");
    if (p.status === "accepted") expect(p.state.runRef.runId).toBe("run-a");

    // Two runs: note the most recent last and expect it to be targeted.
    const multi = adapter();
    multi.noteRun(runA);
    multi.noteRun(runB);
    const stop = await multi.control(cmd("stop"));
    expect(stop.status).toBe("accepted");
    if (stop.status === "accepted") expect(stop.state.runRef.runId).toBe("run-b");
  });

  it("never exposes hidden context: all returned shapes carry noHiddenContextRead true", async () => {
    const c = adapter();
    c.noteRun(runA, { lastEventSeq: 3, terminalOutcome: "crashed" });
    const snap = await c.snapshot({ schemaVersion: 1, runRef: runA });
    expect(snap.status).toBe("ready");
    if (snap.status === "ready") {
      expect(snap.state.noHiddenContextRead).toBe(true);
      expect(snap.report.noHiddenContextRead).toBe(true);
    }
    const stop = await c.control(cmd("stop"));
    expect(stop.status).toBe("accepted");
    if (stop.status === "accepted") expect(stop.state.noHiddenContextRead).toBe(true);
  });
});
