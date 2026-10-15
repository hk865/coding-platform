/**
 * RL-22: the settlement state machine `settleExecution`
 * (spec §5.2 RL-22, §0.3 L4/L7).
 *
 * Builds: hand-written states and event sequences; no process, timer or
 * cgroup. Every expected state/action is written out from the spec row.
 * Rows: RL-22 cases (a)–(v): (u)/(u') are MF4's exit-before-release cases and
 * (v) is the 5(c)-2 host_oom_kill-while-starting case.
 * Entry: the built Kernel module `dist/sandbox/process/process-sandbox.js` (RE0).
 */
import { describe, expect, it } from "vitest";
import {
  settleExecution,
  type SettlementAction,
  type SettlementEvent,
  type SettlementState,
  type StartupFailure,
} from "../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js";

const INITIAL: SettlementState = {
  phase: "starting",
  hasPid: false,
  keeperPid: null,
  stopReason: null,
  startupFailure: null,
  bwrapExited: false,
  finalize: "none",
  observationComplete: false,
  keeperClosed: false,
  streamsClosed: false,
  escalationPending: false,
};

const state = (overrides: Partial<SettlementState> = {}): SettlementState => ({ ...INITIAL, ...overrides });
/** A released execution with a spawned child and a recorded keeper pid. */
const released = (overrides: Partial<SettlementState> = {}): SettlementState =>
  state({ hasPid: true, keeperPid: 4242, phase: "released", ...overrides });

const KILL_GROUP: SettlementAction = { kind: "kill_group" };
const CLOSE: SettlementAction = { kind: "close_keeper" };
const SIGTERM: SettlementAction = { kind: "signal_bwrap", signal: "SIGTERM" };
const SIGKILL: SettlementAction = { kind: "signal_bwrap", signal: "SIGKILL" };
const ESCALATE: SettlementAction = { kind: "start_escalation" };
const CLEAR_ESCALATION: SettlementAction = { kind: "clear_escalation" };
const WAIT_QUIESCENCE: SettlementAction = { kind: "wait_quiescence" };
const READ_FINAL: SettlementAction = { kind: "read_final" };
const RECHECK_PROCS: SettlementAction = { kind: "recheck_procs" };
const FINISH_RESULT: SettlementAction = { kind: "finish", outcome: { kind: "result" } };
const FINISH_NOT_STARTED: SettlementAction = { kind: "finish", outcome: { kind: "not_started_cancelled" } };
const finishLaunch = (reason: StartupFailure | "spawn_failed"): SettlementAction =>
  ({ kind: "finish", outcome: { kind: "launch_failed", reason } });

const advance = (
  current: SettlementState,
  event: SettlementEvent,
): { readonly state: SettlementState; readonly actions: readonly SettlementAction[] } =>
  settleExecution(current, event);

describe("RL-22 settleExecution", () => {
  it("RL-22 (a) a pre-release cancel kills the group, closes fd 5 and settles as not-started cancelled", () => {
    const spawned = advance(INITIAL, { kind: "spawned" });
    expect(spawned.state).toEqual(state({ hasPid: true }));
    const keeper = advance(spawned.state, { kind: "keeper_recorded", pid: 4242 });
    expect(keeper.state).toEqual(state({ hasPid: true, keeperPid: 4242 }));

    const stopped = advance(keeper.state, { kind: "stop", reason: "cancel" });
    expect(stopped.state).toEqual(state({ hasPid: true, keeperPid: 4242, stopReason: "cancel", keeperClosed: true }));
    expect(stopped.actions).toEqual([KILL_GROUP, CLOSE]);

    expect(advance(stopped.state, { kind: "release" }).actions).toEqual([]);
    expect(advance(stopped.state, { kind: "bwrap_exited" }).actions).toEqual([]);
    const exited = advance(stopped.state, { kind: "bwrap_exited" });
    const closed = advance(exited.state, { kind: "streams_closed" });
    expect(closed.state).toEqual(state({
      hasPid: true, keeperPid: 4242, stopReason: "cancel", keeperClosed: true,
      bwrapExited: true, streamsClosed: true, phase: "settled",
    }));
    expect(closed.actions).toEqual([FINISH_NOT_STARTED]);
    expect(advance(closed.state, { kind: "release" }).actions).toEqual([]);
  });

  it("RL-22 (b) cancel wins over a racing release; release then cancel signals bwrap and escalates", () => {
    const spawned = advance(INITIAL, { kind: "spawned" });
    // Same moment, cancel first, then release: release must do nothing.
    const stopped = advance(spawned.state, { kind: "stop", reason: "cancel" });
    expect(stopped.actions).toEqual([KILL_GROUP, CLOSE]);
    expect(advance(stopped.state, { kind: "release" }).actions).toEqual([]);

    // Release first, then cancel.
    const releasedState = advance(spawned.state, { kind: "release" });
    expect(releasedState.state).toEqual(state({ hasPid: true, phase: "released" }));
    const after = advance(releasedState.state, { kind: "stop", reason: "cancel" });
    expect(after.state).toEqual(state({ hasPid: true, phase: "released", stopReason: "cancel", escalationPending: true }));
    expect(after.actions).toEqual([SIGTERM, ESCALATE]);
  });

  it("RL-22 (c) a running timeout escalates, finalizes and settles with observationComplete", () => {
    const releasedState = advance(released(), { kind: "release" });
    const stopped = advance(releasedState.state, { kind: "stop", reason: "timeout" });
    expect(stopped.state).toEqual(released({ stopReason: "timeout", escalationPending: true }));
    expect(stopped.actions).toEqual([SIGTERM, ESCALATE]);

    const escalated = advance(stopped.state, { kind: "escalation_due" });
    expect(escalated.state).toEqual(released({ stopReason: "timeout", escalationPending: false }));
    expect(escalated.actions).toEqual([SIGKILL]);

    const exited = advance(escalated.state, { kind: "bwrap_exited" });
    expect(exited.state).toEqual(released({ stopReason: "timeout", bwrapExited: true, finalize: "waiting_quiescence" }));
    expect(exited.actions).toEqual([CLEAR_ESCALATION, WAIT_QUIESCENCE]);

    const quiescent = advance(exited.state, { kind: "quiescent" });
    expect(quiescent.state).toEqual(released({ stopReason: "timeout", bwrapExited: true, finalize: "reading" }));
    expect(quiescent.actions).toEqual([READ_FINAL]);

    const read = advance(quiescent.state, { kind: "final_read_done", ok: true });
    expect(read.state).toEqual(released({ stopReason: "timeout", bwrapExited: true, finalize: "rechecking" }));
    expect(read.actions).toEqual([RECHECK_PROCS]);

    const rechecked = advance(read.state, { kind: "recheck_done", unchanged: true });
    expect(rechecked.state).toEqual(released({
      stopReason: "timeout", bwrapExited: true, finalize: "done", observationComplete: true, keeperClosed: true,
    }));
    expect(rechecked.actions).toEqual([CLOSE]);

    const closed = advance(rechecked.state, { kind: "streams_closed" });
    expect(closed.state).toEqual(released({
      stopReason: "timeout", bwrapExited: true, finalize: "done", observationComplete: true, keeperClosed: true,
      streamsClosed: true, phase: "settled",
    }));
    expect(closed.actions).toEqual([FINISH_RESULT]);
  });

  it("RL-22 (d) a timeout after bwrap exit records the reason without any signal", () => {
    const exited = advance(released(), { kind: "bwrap_exited" });
    const stopped = advance(exited.state, { kind: "stop", reason: "timeout" });
    expect(stopped.state).toEqual(released({ bwrapExited: true, finalize: "waiting_quiescence", stopReason: "timeout" }));
    expect(stopped.actions).toEqual([]);
  });

  it("RL-22 (e) a cancel before and after bwrap exit behaves like (c) and (d)", () => {
    const stopped = advance(released(), { kind: "stop", reason: "cancel" });
    expect(stopped.state).toEqual(released({ stopReason: "cancel", escalationPending: true }));
    expect(stopped.actions).toEqual([SIGTERM, ESCALATE]);

    const exited = advance(released(), { kind: "bwrap_exited" });
    const late = advance(exited.state, { kind: "stop", reason: "cancel" });
    expect(late.state).toEqual(released({ bwrapExited: true, finalize: "waiting_quiescence", stopReason: "cancel" }));
    expect(late.actions).toEqual([]);
  });

  it("RL-22 (f) the first stop reason wins and only one SIGTERM is sent", () => {
    const stopped = advance(released(), { kind: "stop", reason: "timeout" });
    const later = advance(stopped.state, { kind: "stop", reason: "cancel" });
    expect(later.state).toEqual(released({ stopReason: "timeout", escalationPending: true }));
    expect(later.actions).toEqual([]);
    expect(stopped.actions.filter(action => action.kind === "signal_bwrap")).toHaveLength(1);
  });

  it("RL-22 (g) host OOM during the SIGTERM escalation upgrades immediately, reason unchanged", () => {
    const stopped = advance(released(), { kind: "stop", reason: "timeout" });
    const oom = advance(stopped.state, { kind: "stop", reason: "host_oom_kill" });
    expect(oom.state).toEqual(released({ stopReason: "timeout", escalationPending: false }));
    expect(oom.actions).toEqual([SIGKILL]);
  });

  it("RL-22 (h) an escalation that comes due after bwrap exit does nothing", () => {
    const exited = advance(released(), { kind: "bwrap_exited" });
    const due = advance(exited.state, { kind: "escalation_due" });
    expect(due.state).toEqual(released({ bwrapExited: true, finalize: "waiting_quiescence" }));
    expect(due.actions).toEqual([]);
  });

  it("RL-22 (i) duplicated bwrap_exited/quiescent/final_read_done steps run once", () => {
    const exited = advance(released(), { kind: "bwrap_exited" });
    const exitedAgain = advance(exited.state, { kind: "bwrap_exited" });
    expect(exitedAgain.state).toEqual(released({ bwrapExited: true, finalize: "waiting_quiescence" }));
    expect(exitedAgain.actions).toEqual([]);

    const quiescent = advance(exited.state, { kind: "quiescent" });
    expect(quiescent.actions).toEqual([READ_FINAL]);
    expect(advance(quiescent.state, { kind: "quiescent" }).actions).toEqual([]);

    const read = advance(quiescent.state, { kind: "final_read_done", ok: true });
    expect(read.actions).toEqual([RECHECK_PROCS]);
    expect(advance(read.state, { kind: "final_read_done", ok: true }).actions).toEqual([]);

    const rechecked = advance(read.state, { kind: "recheck_done", unchanged: true });
    expect(rechecked.actions).toEqual([CLOSE]);
    expect(advance(rechecked.state, { kind: "recheck_done", unchanged: true }).actions).toEqual([]);
  });

  it("RL-22 (j) streams that close before bwrap exit finish only after finalize and fd 5 close", () => {
    const streams = advance(released(), { kind: "streams_closed" });
    expect(streams.state).toEqual(released({ streamsClosed: true }));
    expect(streams.actions).toEqual([]);

    const exited = advance(streams.state, { kind: "bwrap_exited" });
    expect(exited.actions).toEqual([CLEAR_ESCALATION, WAIT_QUIESCENCE]);
    const quiescent = advance(exited.state, { kind: "quiescent" });
    const read = advance(quiescent.state, { kind: "final_read_done", ok: true });
    const rechecked = advance(read.state, { kind: "recheck_done", unchanged: true });
    expect(rechecked.actions).toEqual([CLOSE, FINISH_RESULT]);
    expect(rechecked.state).toEqual(released({
      streamsClosed: true, bwrapExited: true, finalize: "done", observationComplete: true,
      keeperClosed: true, phase: "settled",
    }));
  });

  it("RL-22 (k) nothing happens after settlement", () => {
    const x = advance(released(), { kind: "bwrap_exited" });
    const q = advance(x.state, { kind: "quiescent" });
    const r = advance(q.state, { kind: "final_read_done", ok: true });
    const c = advance(r.state, { kind: "recheck_done", unchanged: true });
    const settled = advance(c.state, { kind: "streams_closed" });
    expect(settled.state.phase).toBe("settled");
    const events: readonly SettlementEvent[] = [
      { kind: "release" }, { kind: "stop", reason: "cancel" }, { kind: "bwrap_exited" },
      { kind: "escalation_due" }, { kind: "streams_closed" }, { kind: "spawn_failed" },
      { kind: "startup_failed", reason: "ready_timeout" },
    ];
    for (const event of events) {
      const after = advance(settled.state, event);
      expect(after.state).toEqual(settled.state);
      expect(after.actions).toEqual([]);
    }
  });

  it("RL-22 (l) a quiescence timeout does not read, closes fd 5 and is incomplete", () => {
    const exited = advance(released(), { kind: "bwrap_exited" });
    const failed = advance(exited.state, { kind: "quiescence_failed", reason: "timeout" });
    expect(failed.state).toEqual(released({
      bwrapExited: true, finalize: "done", observationComplete: false, keeperClosed: true,
    }));
    expect(failed.actions).toEqual([CLOSE]);
    expect(failed.actions.some(action => action.kind === "read_final")).toBe(false);
  });

  it("RL-22 (m) quiescence_failed keeper_not_identified ends like (l)", () => {
    // The three production shapes (wrong pid, recorded pid gone, cmdline
    // mismatch) all reduce to this one event at the settleExecution seam;
    // they are told apart in waitQuiescence and covered by review, not tests.
    const expected = released({
      bwrapExited: true, finalize: "done", observationComplete: false, keeperClosed: true,
    });
    const failed = advance(advance(released(), { kind: "bwrap_exited" }).state,
      { kind: "quiescence_failed", reason: "keeper_not_identified" });
    expect(failed.state).toEqual(expected);
    expect(failed.actions).toEqual([CLOSE]);
  });

  it("RL-22 (n) a failed final read and a changed recheck both close fd 5 and are incomplete", () => {
    const exited = advance(released(), { kind: "bwrap_exited" });
    const quiescent = advance(exited.state, { kind: "quiescent" });
    const readFailed = advance(quiescent.state, { kind: "final_read_done", ok: false });
    expect(readFailed.state).toEqual(released({
      bwrapExited: true, finalize: "done", observationComplete: false, keeperClosed: true,
    }));
    expect(readFailed.actions).toEqual([CLOSE]);

    const readOk = advance(quiescent.state, { kind: "final_read_done", ok: true });
    const changed = advance(readOk.state, { kind: "recheck_done", unchanged: false });
    expect(changed.state).toEqual(released({
      bwrapExited: true, finalize: "done", observationComplete: false, keeperClosed: true,
    }));
    expect(changed.actions).toEqual([CLOSE]);
  });

  it("RL-22 (o) spawn_failed closes fd 5 and finishes immediately without waiting for exit", () => {
    const failed = advance(state(), { kind: "spawn_failed" });
    expect(failed.state).toEqual(state({ startupFailure: "spawn_failed", keeperClosed: true, phase: "settled" }));
    expect(failed.actions).toEqual([CLOSE, finishLaunch("spawn_failed")]);
    expect(advance(failed.state, { kind: "bwrap_exited" }).actions).toEqual([]);
  });

  it("RL-22 (p) launcher_exited closes fd 5, then finishes after exit and close", () => {
    const spawned = advance(state(), { kind: "spawned" });
    const failed = advance(spawned.state, { kind: "startup_failed", reason: "launcher_exited" });
    expect(failed.state).toEqual(state({ hasPid: true, startupFailure: "launcher_exited", keeperClosed: true }));
    expect(failed.actions).toEqual([CLOSE]);
    const exited = advance(failed.state, { kind: "bwrap_exited" });
    expect(exited.actions).toEqual([]);
    const closed = advance(exited.state, { kind: "streams_closed" });
    expect(closed.state).toEqual(state({
      hasPid: true, startupFailure: "launcher_exited", keeperClosed: true,
      bwrapExited: true, streamsClosed: true, phase: "settled",
    }));
    expect(closed.actions).toEqual([finishLaunch("launcher_exited")]);
  });

  it("RL-22 (q) ready_timeout kills the group, closes fd 5 and finishes after exit/close", () => {
    const spawned = advance(state(), { kind: "spawned" });
    const failed = advance(spawned.state, { kind: "startup_failed", reason: "ready_timeout" });
    expect(failed.state).toEqual(state({ hasPid: true, startupFailure: "ready_timeout", keeperClosed: true }));
    expect(failed.actions).toEqual([KILL_GROUP, CLOSE]);
    const exited = advance(failed.state, { kind: "bwrap_exited" });
    const closed = advance(exited.state, { kind: "streams_closed" });
    expect(closed.actions).toEqual([finishLaunch("ready_timeout")]);
  });

  it("RL-22 (r) a pre-release timeout is deadline_before_start, never timedOut", () => {
    const spawned = advance(state(), { kind: "spawned" });
    const failed = advance(spawned.state, { kind: "stop", reason: "timeout" });
    expect(failed.state).toEqual(state({ hasPid: true, startupFailure: "deadline_before_start", keeperClosed: true }));
    expect(failed.actions).toEqual([KILL_GROUP, CLOSE]);
    const exited = advance(failed.state, { kind: "bwrap_exited" });
    const closed = advance(exited.state, { kind: "streams_closed" });
    expect(closed.actions).toEqual([finishLaunch("deadline_before_start")]);
    expect(closed.state.stopReason).toBeNull();
  });

  it("RL-22 (s) the other startup failures kill the group and close fd 5", () => {
    const reasons: readonly StartupFailure[] = [
      "identity_mismatch", "keeper_not_identified", "limits_not_effective", "baseline_unreadable",
    ];
    for (const reason of reasons) {
      const spawned = advance(state(), { kind: "spawned" });
      const failed = advance(spawned.state, { kind: "startup_failed", reason });
      expect(failed.actions).toEqual([KILL_GROUP, CLOSE]);
      expect(failed.state).toEqual(state({ hasPid: true, startupFailure: reason, keeperClosed: true }));
    }
  });

  it("RL-22 (t) release and stop after a startup failure change nothing", () => {
    const spawned = advance(state(), { kind: "spawned" });
    const failed = advance(spawned.state, { kind: "startup_failed", reason: "ready_timeout" });
    const released1 = advance(failed.state, { kind: "release" });
    expect(released1.state).toEqual(failed.state);
    expect(released1.actions).toEqual([]);
    const stopped = advance(failed.state, { kind: "stop", reason: "cancel" });
    expect(stopped.state).toEqual(failed.state);
    expect(stopped.actions).toEqual([]);
  });

  it("RL-22 (v) host_oom_kill while starting is ignored", () => {
    // The finding 5(c)-2 case: OOM acceptance only applies after release (L8),
    // so a stop while starting does not become deadline_before_start.
    const starting = advance(INITIAL, { kind: "spawned" }).state;
    const oom = advance(starting, { kind: "stop", reason: "host_oom_kill" });
    expect(oom.state).toEqual(starting);
    expect(oom.actions).toEqual([]);
    // Timeout and cancel while starting are unchanged.
    const timeout = advance(starting, { kind: "stop", reason: "timeout" });
    expect(timeout.state).toEqual(state({ hasPid: true, startupFailure: "deadline_before_start", keeperClosed: true }));
    expect(timeout.actions).toEqual([KILL_GROUP, CLOSE]);
    // The ignored OOM does not block a later release.
    const releasedState = advance(oom.state, { kind: "release" });
    expect(releasedState.state).toEqual(state({ hasPid: true, phase: "released" }));
    expect(releasedState.actions).toEqual([]);
  });

  it("RL-22 (u) an exit after r but before release is launcher_exited and closes fd 5", () => {
    const spawned = advance(INITIAL, { kind: "spawned" });
    const keeper = advance(spawned.state, { kind: "keeper_recorded", pid: 4242 });
    const exited = advance(keeper.state, { kind: "bwrap_exited" });
    expect(exited.state).toEqual(state({
      hasPid: true, keeperPid: 4242, startupFailure: "launcher_exited",
      bwrapExited: true, keeperClosed: true,
    }));
    expect(exited.actions).toEqual([CLOSE]);
    // A refused release writes nothing.
    const releasedAfter = advance(exited.state, { kind: "release" });
    expect(releasedAfter.state).toEqual(exited.state);
    expect(releasedAfter.actions).toEqual([]);
    const closed = advance(exited.state, { kind: "streams_closed" });
    expect(closed.state).toEqual(state({
      hasPid: true, keeperPid: 4242, startupFailure: "launcher_exited",
      bwrapExited: true, keeperClosed: true, streamsClosed: true, phase: "settled",
    }));
    expect(closed.actions).toEqual([finishLaunch("launcher_exited")]);
  });

  it("RL-22 (u') a scope killed from outside with no stop is launcher_exited, never not_started_cancelled", () => {
    const spawned = advance(INITIAL, { kind: "spawned" });
    const keeper = advance(spawned.state, { kind: "keeper_recorded", pid: 4242 });
    const streams = advance(keeper.state, { kind: "streams_closed" });
    const exited = advance(streams.state, { kind: "bwrap_exited" });
    expect(exited.state).toEqual(state({
      hasPid: true, keeperPid: 4242, startupFailure: "launcher_exited",
      bwrapExited: true, keeperClosed: true, streamsClosed: true, phase: "settled",
    }));
    expect(exited.actions).toEqual([CLOSE, finishLaunch("launcher_exited")]);
  });
});
