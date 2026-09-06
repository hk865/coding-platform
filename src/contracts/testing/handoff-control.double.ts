/**
 * P1-06 shared test double: FakeHandoffControlPort — deterministic pause/stop
 * state machine + public snapshot/report for the WorkerRuntime control face.
 * Used by the contract suite; the REAL adapter (FakeHandoffControlRuntimeAdapter)
 * is lane B's implementation.
 */
import type {
  HandoffControlCommandResultV1,
  HandoffControlCommandV1,
  HandoffControlPort,
  HandoffControlStateV1,
  HandoffSnapshotQueryV1,
  HandoffSnapshotResultV1,
  PublicRuntimeReportV1,
} from "../handoff-control.js";
import type { RunRef } from "../dispatch.js";

type FakeControlState = {
  state: HandoffControlStateV1;
  lastEventSeq: number;
  terminalOutcome: PublicRuntimeReportV1["terminalOutcome"];
};

export class FakeHandoffControlPort implements HandoffControlPort {
  private readonly states = new Map<string, FakeControlState>();

  constructor(initial: { runRef: RunRef; lastEventSeq?: number; terminalOutcome?: PublicRuntimeReportV1["terminalOutcome"] }[] = []) {
    for (const entry of initial) {
      this.seed(entry.runRef, entry.lastEventSeq ?? 0, entry.terminalOutcome ?? null);
    }
  }

  seed(runRef: RunRef, lastEventSeq = 0, terminalOutcome: PublicRuntimeReportV1["terminalOutcome"] = null): void {
    const key = runKey(runRef);
    this.states.set(key, {
      state: {
        schemaVersion: 1,
        runRef: { ...runRef },
        status: terminalOutcome === null ? "running" : "stopped",
        pausedSince: null,
        stoppedSince: terminalOutcome === null ? null : runRef.runId + "-ended",
        lastReason: null,
        reportRef: null,
        noHiddenContextRead: true,
      },
      lastEventSeq,
      terminalOutcome,
    });
  }

  async control(command: HandoffControlCommandV1): Promise<HandoffControlCommandResultV1> {
    const issues: string[] = [];
    if (command.schemaVersion !== 1) issues.push("schemaVersion must be 1");
    if (command.kind !== "pause" && command.kind !== "stop") issues.push("kind must be pause|stop");
    if (typeof command.reason !== "string" || command.reason.length === 0) issues.push("reason required");
    if (issues.length > 0) return { status: "rejected", code: "invalid", issues };
    const context = this.states.get("single");
    if (context === undefined) {
      return { status: "rejected", code: "run_not_found", issues: ["no run context seeded"] };
    }
    if (context.state.status === "stopped") {
      return { status: "rejected", code: "already_stopped", issues: ["run already stopped"] };
    }
    const now = command.submittedAt;
    const next: HandoffControlStateV1 = {
      ...context.state,
      status: command.kind === "pause" ? "paused" : "stopped",
      pausedSince: command.kind === "pause" ? now : context.state.pausedSince,
      stoppedSince: command.kind === "stop" ? now : context.state.stoppedSince,
      lastReason: command.reason,
      noHiddenContextRead: true,
    };
    this.states.set("single", { ...context, state: next });
    return { status: "accepted", state: next };
  }

  async snapshot(query: HandoffSnapshotQueryV1): Promise<HandoffSnapshotResultV1> {
    if (query.schemaVersion !== 1) {
      return { status: "rejected", code: "invalid", issues: ["schemaVersion must be 1"] };
    }
    const context = this.states.get(runKey(query.runRef)) ?? this.states.get("single");
    if (context === undefined) {
      return { status: "unsupported", reason: "no snapshot state for run " + query.runRef.runId };
    }
    return {
      status: "ready",
      state: { ...context.state, noHiddenContextRead: true },
      report: {
        schemaVersion: 1,
        runRef: { ...context.state.runRef },
        status: context.state.status,
        lastEventSeq: context.lastEventSeq,
        terminalOutcome: context.terminalOutcome,
        summary: "public report: " + context.lastEventSeq + " facts, " + context.state.status,
        reportRef: null,
        noHiddenContextRead: true,
      },
    };
  }
}

function runKey(runRef: RunRef): string {
  return runRef.projectId + "\u0000" + runRef.goalId + "\u0000" + runRef.runId;
}
