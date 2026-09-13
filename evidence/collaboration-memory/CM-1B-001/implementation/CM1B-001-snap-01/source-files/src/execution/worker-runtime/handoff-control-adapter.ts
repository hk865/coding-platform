/**
 * P1-06 WorkerRuntime.HandoffControlPort adapter (replayable fake runtime).
 *
 * ENTRY FILE (shared baseline - exported signature FROZEN; lane B fills the
 * implementation). See IMPLEMENTATION-HANDOFF "P1-06 契约与存储语义" item 4:
 *   - MINIMAL control face over the fake runtime: pause/stop per safe point
 *     (NO cancel — P1-10), public snapshot/report ONLY (never hidden context,
 *     noHiddenContextRead: true);
 *   - review/verification semantic runs still go through the formal dispatch
 *     path (P1-03 RunPort); this adapter is the control/snapshot face.
 *
 * FROZEN semantics:
 *   - control({kind:"pause"|"stop", reason, ...}) — the command carries NO
 *     runRef, so it acts on the run referenced "most recently" (the single known
 *     run if exactly one exists, otherwise the most recently started/noted run);
 *     no known run -> rejected{code:"run_not_found"}. Invalid
 *     schemaVersion/kind/empty reason -> rejected{code:"invalid"}. The state
 *     machine is one-way running -> paused -> stopped (a stop after a stop ->
 *     rejected{code:"already_stopped"}; a pause followed by a stop is allowed).
 *   - snapshot({schemaVersion, runRef}) — KNOWN run (started/noted or
 *     control'ed) -> ready{state, report{... noHiddenContextRead:true}};
 *     unknown run -> unsupported{reason}. The report exposes ONLY public facts
 *     (lastEventSeq, terminalOutcome, summary) — never a transcript / manifest
 *     body. When the real runtime sequence cannot be observed through RunPort,
 *     lastEventSeq is the injected/observed event count (never the bundle body).
 *
 * The adapter composes a RunPort (constructor arg, per the frozen wiring
 * `new FakeHandoffControlRuntimeAdapter(runtime)`) and maintains per-runRef
 * control state. Progress is fed to it via noteRun() (the "轻量同步" the frozen
 * wiring allows — the RunPort surface has no snapshot/registry accessor). The
 * adapter NEVER opens or exposes a product bundle / transcript.
 */
import type { RunPort } from "../../contracts/ports.js";
import type { RunOutcome, RunRef } from "../../contracts/dispatch.js";
import type {
  HandoffControlCommandResultV1,
  HandoffControlCommandV1,
  HandoffControlPort,
  HandoffControlStateV1,
  HandoffSnapshotQueryV1,
  HandoffSnapshotResultV1,
  PublicRuntimeReportV1,
} from "../../contracts/handoff-control.js";

type RunControlContext = {
  state: HandoffControlStateV1;
  lastEventSeq: number;
  terminalOutcome: RunOutcome | null;
  /** Monotonic reference order — the most recently started/noted run wins. */
  order: number;
};

export type FakeHandoffControlRunNote = {
  /** Injected/observed runtime event sequence (public fact, never the bundle). */
  lastEventSeq?: number;
  terminalOutcome?: RunOutcome | null;
  status?: "running" | "paused" | "stopped";
  pausedSince?: string | null;
  stoppedSince?: string | null;
  lastReason?: string | null;
};

export class FakeHandoffControlRuntimeAdapter implements HandoffControlPort {
  private readonly runtime: RunPort;
  private readonly runs = new Map<string, RunControlContext>();
  private counter = 0;

  constructor(runtime: RunPort) {
    this.runtime = runtime;
  }

  /**
   * Record an observed / injected run (B's replacement lifecycle). This is the
   * "轻量同步" hook: the command carries no runRef, and the RunPort surface has
   * no snapshot accessor, so control/snapshot read progress injected here.
   */
  noteRun(runRef: RunRef, note: FakeHandoffControlRunNote = {}): HandoffControlStateV1 {
    const key = runKey(runRef);
    const order = ++this.counter;
    const state: HandoffControlStateV1 = {
      schemaVersion: 1,
      runRef: { ...runRef },
      status: note.status ?? "running",
      pausedSince: note.pausedSince ?? null,
      stoppedSince: note.stoppedSince ?? null,
      lastReason: note.lastReason ?? null,
      reportRef: null,
      noHiddenContextRead: true,
    };
    this.runs.set(key, {
      state,
      lastEventSeq: note.lastEventSeq ?? 0,
      terminalOutcome: note.terminalOutcome ?? null,
      order,
    });
    return { ...state };
  }

  async control(command: HandoffControlCommandV1): Promise<HandoffControlCommandResultV1> {
    const issues: string[] = [];
    if (command.schemaVersion !== 1) issues.push("schemaVersion must be 1");
    if (command.kind !== "pause" && command.kind !== "stop") issues.push("kind must be pause|stop");
    if (typeof command.reason !== "string" || command.reason.length === 0) {
      issues.push("reason must be a non-empty string");
    }
    if (issues.length > 0) return { status: "rejected", code: "invalid", issues };

    const target = this.selectRun();
    if (target === undefined) {
      return {
        status: "rejected",
        code: "run_not_found",
        issues: ["no known run to pause/stop (no run started or noted)"],
      };
    }
    const key = runKey(target.state.runRef);
    const context = this.runs.get(key)!;
    if (context.state.status === "stopped") {
      return {
        status: "rejected",
        code: "already_stopped",
        issues: ["run already stopped"],
      };
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
    this.runs.set(key, { ...context, state: next, order: ++this.counter });
    return { status: "accepted", state: next };
  }

  async snapshot(query: HandoffSnapshotQueryV1): Promise<HandoffSnapshotResultV1> {
    if (query.schemaVersion !== 1) {
      return { status: "rejected", code: "invalid", issues: ["schemaVersion must be 1"] };
    }
    const context = this.runs.get(runKey(query.runRef));
    if (context === undefined) {
      return {
        status: "unsupported",
        reason: "no snapshot state for run " + query.runRef.runId,
      };
    }
    return {
      status: "ready",
      state: { ...context.state, noHiddenContextRead: true },
      report: buildReport(context),
    };
  }

  private selectRun(): RunControlContext | undefined {
    const values = [...this.runs.values()];
    if (values.length === 0) return undefined;
    if (values.length === 1) return values[0]!;
    // Single known run -> it; otherwise the MOST RECENTLY started/noted run.
    return values.sort((a, b) => b.order - a.order)[0];
  }
}

function buildReport(context: RunControlContext): PublicRuntimeReportV1 {
  const status = context.state.status;
  return {
    schemaVersion: 1,
    runRef: { ...context.state.runRef },
    status,
    lastEventSeq: context.lastEventSeq,
    terminalOutcome: context.terminalOutcome,
    summary: `run ${context.state.runRef.runId}: ${status}, ${context.lastEventSeq} facts`,
    reportRef: null,
    noHiddenContextRead: true,
  };
}

function runKey(runRef: RunRef): string {
  return runRef.projectId + "\u0000" + runRef.goalId + "\u0000" + runRef.runId;
}
