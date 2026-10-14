/**
 * Group K KE1: the public Kernel closure seam.
 *
 * Entry: the public function `closeOpenTurn` / `readTurnBounds`, with preconditions
 * built and results observed only through the public `SqliteStores.get/read/append`
 * surface (spec §5.1 KE1, §5.2 KA-01..KA-03).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  agentEventSchema,
  closeOpenTurn,
  readTurnBounds,
  RecoveryCoordinator,
  SqliteStores,
  type RunState,
} from "../../vendor/coding-agent/dist/public-api.js";
import {
  K_AT,
  K_AT_LATER,
  KernelSessionFixture,
  openTempKernelStore,
  readAllRecords,
  type TempKernelStore,
} from "../helpers/K-session-support.js";

const opened: TempKernelStore[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((item) => item.cleanup()));
});

describe("K Kernel closeOpenTurn (KE1)", () => {
  it("KA-01 closes an open Turn by appending run.interrupted at the next position, clears both active ids, bumps the revision and leaves every earlier record identical", async () => {
    const temp = await openTempKernelStore("k-ka01-");
    opened.push(temp);
    const fixture = await KernelSessionFixture.create(temp.store, "ka01-session");
    await fixture.startTurn({ runId: "ka01-run", turnId: "ka01-turn", input: "ka01 input" });
    await fixture.event("run.started", {});
    await fixture.event("model.request_started", { requestId: "ka01-req", retryOfRequestId: null });

    const before = await readAllRecords(temp.store, fixture.sessionId);
    const headerBefore = await temp.store.get(fixture.sessionId, { signal: new AbortController().signal });

    const result = await closeOpenTurn(temp.store, {
      sessionId: fixture.sessionId,
      kernelRunId: "ka01-run",
      expectedRevision: headerBefore.revision,
      at: K_AT_LATER,
    });

    expect(result).toEqual({
      status: "closed",
      revision: headerBefore.revision + 1,
      position: before.length + 1,
    });

    const after = await readAllRecords(temp.store, fixture.sessionId);
    expect(after).toHaveLength(before.length + 1);
    // Record id, position and checksum of every earlier record are untouched.
    expect(after.slice(0, before.length)).toEqual(before);

    const appended = after.at(-1)!;
    expect(appended.position).toBe(before.length + 1);
    expect(appended.recordType).toBe("agent.event");
    if (appended.recordType !== "agent.event") throw new Error("unreachable");
    expect(appended.recordedAt).toBe(K_AT_LATER);
    expect(appended.payload.event.type).toBe("run.interrupted");
    expect(appended.payload.event.meta.runId).toBe("ka01-run");
    expect(appended.payload.event.meta.turnId).toBe("ka01-turn");
    // Two earlier events carried sequences 1 and 2; the closure is sequence 3.
    expect(appended.payload.event.meta.sequence).toBe(3);
    // Last elapsed of the Turn (2 events x 10ms), never going backwards.
    expect(appended.payload.event.meta.elapsedMs).toBe(20);
    expect(appended.payload.event.payload).toEqual({
      reason: "platform_closed",
      requestedBy: "app",
    });

    const headerAfter = await temp.store.get(fixture.sessionId, { signal: new AbortController().signal });
    expect(headerAfter.revision).toBe(headerBefore.revision + 1);
    expect(headerAfter.activeRunId).toBeNull();
    expect(headerAfter.activeTurnId).toBeNull();
  });

  it("KA-02 returns the table's row 1-4 and 6 results without writing, replays already_closed to the original position, and answers readTurnBounds for open, closed, other-terminal and unknown Turns", async () => {
    const signal = new AbortController().signal;
    const temp = await openTempKernelStore("k-ka02-");
    opened.push(temp);
    const store = temp.store;

    async function completedTurn(sessionId: string, runId: string, turnId: string): Promise<KernelSessionFixture> {
      const f = await KernelSessionFixture.create(store, sessionId);
      await f.startTurn({ runId, turnId, input: `${turnId} input` });
      await f.event("run.started", {});
      await f.event("model.request_started", { requestId: `${turnId}-req`, retryOfRequestId: null });
      await f.event("assistant.message_completed", {
        requestId: `${turnId}-req`,
        message: { schemaVersion: 1, messageId: `msg-${turnId}-assistant`, role: "assistant", content: "done" },
        toolCalls: [],
      });
      await f.event("run.completed", { finalMessageId: `msg-${turnId}-assistant` });
      return f;
    }

    // Row 1: the store cannot read the Session (it does not exist) -> unreadable.
    const missing = await closeOpenTurn(store, {
      sessionId: "ka02-missing",
      kernelRunId: "ka02-missing-run",
      expectedRevision: 1,
      at: K_AT_LATER,
    });
    expect(missing.status).toBe("unreadable");
    if (missing.status !== "unreadable") throw new Error("unreachable");
    expect(typeof missing.reason).toBe("string");

    // Row 2: Session exists but no Turn with that runId -> not_found.
    const noTurn = await KernelSessionFixture.create(store, "ka02-no-turn");
    await noTurn.startTurn({ runId: "ka02-other-run", turnId: "ka02-other-turn", input: "other" });
    await noTurn.event("run.started", {});
    const noTurnBefore = await readAllRecords(store, noTurn.sessionId);
    const noTurnHeader = await store.get(noTurn.sessionId, { signal });
    expect(await closeOpenTurn(store, {
      sessionId: noTurn.sessionId,
      kernelRunId: "ka02-absent-run",
      expectedRevision: noTurnHeader.revision,
      at: K_AT_LATER,
    })).toEqual({ status: "not_found" });
    expect(await readAllRecords(store, noTurn.sessionId)).toEqual(noTurnBefore);
    expect((await store.get(noTurn.sessionId, { signal })).revision).toBe(noTurnHeader.revision);

    // Row 3: already interrupted -> already_closed at the original record position.
    const closable = await KernelSessionFixture.create(store, "ka02-closed");
    await closable.startTurn({ runId: "ka02-closed-run", turnId: "ka02-closed-turn", input: "close me" });
    await closable.event("run.started", {});
    // Hand-counted from the fixture: session.created=1, turn.started=2,
    // run.started=3, so the closure lands at position 4 and revision 4.
    const firstClose = await closeOpenTurn(store, {
      sessionId: closable.sessionId,
      kernelRunId: "ka02-closed-run",
      expectedRevision: 3,
      at: K_AT_LATER,
    });
    expect(firstClose).toEqual({ status: "closed", revision: 4, position: 4 });
    const closedBeforeSecond = await readAllRecords(store, closable.sessionId);
    const secondClose = await closeOpenTurn(store, {
      sessionId: closable.sessionId,
      kernelRunId: "ka02-closed-run",
      expectedRevision: 3,
      at: K_AT_LATER,
    });
    expect(secondClose).toEqual({ status: "already_closed", revision: 4, position: 4 });
    expect(await readAllRecords(store, closable.sessionId)).toEqual(closedBeforeSecond);
    expect((await store.get(closable.sessionId, { signal })).revision).toBe(4);

    // Row 4: another terminal status -> already_terminal, no write.
    const completed = await completedTurn("ka02-completed", "ka02-completed-run", "ka02-completed-turn");
    const completedBefore = await readAllRecords(store, completed.sessionId);
    const completedHeader = await store.get(completed.sessionId, { signal });
    expect(await closeOpenTurn(store, {
      sessionId: completed.sessionId,
      kernelRunId: "ka02-completed-run",
      expectedRevision: completedHeader.revision,
      at: K_AT_LATER,
    })).toEqual({ status: "already_terminal", terminalStatus: "completed" });
    expect(await readAllRecords(store, completed.sessionId)).toEqual(completedBefore);
    expect((await store.get(completed.sessionId, { signal })).revision).toBe(completedHeader.revision);

    // Row 6: the expected revision differs from the head -> conflict with the current revision, no write.
    const stale = await KernelSessionFixture.create(store, "ka02-stale");
    await stale.startTurn({ runId: "ka02-stale-run", turnId: "ka02-stale-turn", input: "stale" });
    await stale.event("run.started", {});
    const staleBefore = await readAllRecords(store, stale.sessionId);
    // Hand-counted: create=1, turn.started=2, run.started=3.
    expect(await closeOpenTurn(store, {
      sessionId: stale.sessionId,
      kernelRunId: "ka02-stale-run",
      expectedRevision: 2,
      at: K_AT_LATER,
    })).toEqual({ status: "conflict", currentRevision: 3 });
    expect(await readAllRecords(store, stale.sessionId)).toEqual(staleBefore);
    expect((await store.get(stale.sessionId, { signal })).revision).toBe(3);

    // readTurnBounds: open, closed, other terminal and unknown. Positions are
    // hand-counted from each fixture: session.created=1, turn.started=2, and the
    // terminal event is the last record of that Turn.
    const openTurn = await KernelSessionFixture.create(store, "ka02-bounds-open");
    await openTurn.startTurn({ runId: "ka02-open-run", turnId: "ka02-open-turn", input: "open" });
    await openTurn.event("run.started", {});
    expect(await readTurnBounds(store, { sessionId: openTurn.sessionId, kernelRunId: "ka02-open-run" })).toEqual({
      status: "found",
      startPosition: 2,
      endPosition: null,
      terminalStatus: null,
    });

    expect(await readTurnBounds(store, { sessionId: closable.sessionId, kernelRunId: "ka02-closed-run" })).toEqual({
      status: "found",
      startPosition: 2,
      endPosition: 4,
      terminalStatus: "interrupted",
    });

    expect(await readTurnBounds(store, { sessionId: completed.sessionId, kernelRunId: "ka02-completed-run" })).toEqual({
      status: "found",
      startPosition: 2,
      endPosition: 6,
      terminalStatus: "completed",
    });

    expect(await readTurnBounds(store, { sessionId: completed.sessionId, kernelRunId: "ka02-unknown-run" })).toEqual({
      status: "not_found",
    });
  });

  it("KA-02 cuts a non-last Turn's bounds at the next turn.started, so a later open Turn cannot redefine its start, end or terminal status", async () => {
    const temp = await openTempKernelStore("k-ka02-multi-");
    opened.push(temp);
    const store = temp.store;
    const fixture = await KernelSessionFixture.create(store, "ka02-multi");
    await fixture.startTurn({ runId: "ka02-multi-A", turnId: "ka02-multi-A-turn", input: "A input" });
    await fixture.event("run.started", {});
    await fixture.event("model.request_started", { requestId: "ka02-multi-A-req", retryOfRequestId: null });
    await fixture.event("assistant.message_completed", {
      requestId: "ka02-multi-A-req",
      message: { schemaVersion: 1, messageId: "msg-ka02-multi-A", role: "assistant", content: "answer-A" },
      toolCalls: [],
    });
    await fixture.event("run.completed", { finalMessageId: "msg-ka02-multi-A" });
    // Hand-counted positions: create=1, A turn.started=2, run.started=3,
    // model.request_started=4, assistant.message_completed=5, run.completed=6,
    // B turn.started=7, run.started=8. Turn A is cut at 6, before B starts.
    await fixture.startTurn({ runId: "ka02-multi-B", turnId: "ka02-multi-B-turn", input: "B input" });
    await fixture.event("run.started", {});

    expect(await readTurnBounds(store, { sessionId: "ka02-multi", kernelRunId: "ka02-multi-A" })).toEqual({
      status: "found",
      startPosition: 2,
      endPosition: 6,
      terminalStatus: "completed",
    });
  });

  it("KA-03 closes created, running (awaiting model, and a tool batch with a pending and a started call) and paused Turns; the pending call becomes abandoned and the started one outcome_unknown with no invented result; other terminals stay already_terminal", async () => {
    const signal = new AbortController().signal;
    const temp = await openTempKernelStore("k-ka03-");
    opened.push(temp);
    const store = temp.store;

    async function recoverState(sessionId: string): Promise<RunState> {
      const result = await new RecoveryCoordinator({ sessions: store }).recover(sessionId, { signal });
      return result.state;
    }
    async function close(sessionId: string, runId: string): Promise<Awaited<ReturnType<typeof closeOpenTurn>>> {
      const header = await store.get(sessionId, { signal });
      return closeOpenTurn(store, { sessionId, kernelRunId: runId, expectedRevision: header.revision, at: K_AT_LATER });
    }

    // created: turn.started committed, run.started not yet.
    const created = await KernelSessionFixture.create(store, "ka03-created");
    await created.startTurn({ runId: "ka03-created-run", turnId: "ka03-created-turn", input: "created" });
    expect(await close(created.sessionId, "ka03-created-run")).toMatchObject({ status: "closed" });
    expect((await recoverState(created.sessionId)).status).toBe("interrupted");

    // running while awaiting the model.
    const awaiting = await KernelSessionFixture.create(store, "ka03-awaiting");
    await awaiting.startTurn({ runId: "ka03-awaiting-run", turnId: "ka03-awaiting-turn", input: "awaiting" });
    await awaiting.event("run.started", {});
    await awaiting.event("model.request_started", { requestId: "ka03-awaiting-req", retryOfRequestId: null });
    expect(await close(awaiting.sessionId, "ka03-awaiting-run")).toMatchObject({ status: "closed" });
    const awaitingState = await recoverState(awaiting.sessionId);
    expect(awaitingState.status).toBe("interrupted");
    expect(awaitingState.activeModelRequest).toBeNull();

    // running inside a tool batch: one call never started, one started.
    const tools = await KernelSessionFixture.create(store, "ka03-tools");
    await tools.startTurn({ runId: "ka03-tools-run", turnId: "ka03-tools-turn", input: "tools" });
    await tools.event("run.started", {});
    await tools.event("model.request_started", { requestId: "ka03-tools-req", retryOfRequestId: null });
    await tools.event("assistant.message_completed", {
      requestId: "ka03-tools-req",
      message: { schemaVersion: 1, messageId: "msg-ka03-tools", role: "assistant", content: "calling" },
      toolCalls: [
        { schemaVersion: 1, callId: "ka03-call-pending", name: "read", arguments: {} },
        { schemaVersion: 1, callId: "ka03-call-started", name: "read", arguments: {} },
      ],
    });
    await tools.event("tool.started", {
      call: { schemaVersion: 1, callId: "ka03-call-started", name: "read", arguments: {} },
    });
    expect(await close(tools.sessionId, "ka03-tools-run")).toMatchObject({ status: "closed" });
    const toolsState = await recoverState(tools.sessionId);
    expect(toolsState.status).toBe("interrupted");
    const calls = toolsState.toolBatch?.calls ?? [];
    expect(calls.find((call) => call.requestedCall.callId === "ka03-call-pending")).toMatchObject({
      status: "abandoned",
      result: null,
    });
    expect(calls.find((call) => call.requestedCall.callId === "ka03-call-started")).toMatchObject({
      status: "outcome_unknown",
      result: null,
    });

    // re-closing an already interrupted Turn.
    expect(await close(tools.sessionId, "ka03-tools-run")).toMatchObject({ status: "already_closed" });

    // paused.
    const paused = await KernelSessionFixture.create(store, "ka03-paused");
    await paused.startTurn({ runId: "ka03-paused-run", turnId: "ka03-paused-turn", input: "paused" });
    await paused.event("run.started", {});
    await paused.event("run.paused", {
      pause: { reason: "operator_requested", requestedBy: "app", pausedAt: K_AT, pendingToolCallId: null },
    });
    expect(await close(paused.sessionId, "ka03-paused-run")).toMatchObject({ status: "closed" });
    expect((await recoverState(paused.sessionId)).status).toBe("interrupted");

    // Every other terminal status reports already_terminal.
    const otherTerminals: ReadonlyArray<{
      readonly name: string;
      readonly status: string;
      readonly emit: (fixture: KernelSessionFixture) => Promise<void>;
    }> = [
      {
        name: "completed",
        status: "completed",
        emit: async (f) => {
          await f.event("run.started", {});
          await f.event("model.request_started", { requestId: "req", retryOfRequestId: null });
          await f.event("assistant.message_completed", {
            requestId: "req",
            message: { schemaVersion: 1, messageId: "msg-completed", role: "assistant", content: "done" },
            toolCalls: [],
          });
          await f.event("run.completed", { finalMessageId: "msg-completed" });
        },
      },
      {
        name: "failed",
        status: "failed",
        emit: async (f) => {
          await f.event("run.started", {});
          await f.event("run.failed", {
            failure: { category: "internal", code: "ka03", message: "ka03 failure", retryable: false, operationId: null },
          });
        },
      },
      {
        name: "cancelled",
        status: "cancelled",
        emit: async (f) => {
          await f.event("run.started", {});
          await f.event("run.cancelled", { reason: "caller_requested" });
        },
      },
      {
        name: "limit_exceeded",
        status: "limit_exceeded",
        emit: async (f) => {
          await f.event("run.started", {});
          await f.event("run.limit_exceeded", { limit: "model_requests", observed: 1, allowed: 0 });
        },
      },
      {
        name: "yielded",
        status: "yielded",
        emit: async (f) => {
          await f.event("run.started", {});
          await f.event("run.yielded", {
            yield: { reason: "reply_required", requestedBy: "runtime", yieldedAt: K_AT, pendingToolCallId: null },
          });
        },
      },
    ];
    for (const terminal of otherTerminals) {
      const f = await KernelSessionFixture.create(store, `ka03-${terminal.name}`);
      await f.startTurn({ runId: `ka03-${terminal.name}-run`, turnId: `ka03-${terminal.name}-turn`, input: terminal.name });
      await terminal.emit(f);
      expect(await close(f.sessionId, `ka03-${terminal.name}-run`)).toEqual({
        status: "already_terminal",
        terminalStatus: terminal.status,
      });
    }
  });

  it("D3 reconciles a same-closure append collision - two callers close one open Turn, the second commits first - as already_closed at the closure position with the revision read after the bounds, never unreadable", async () => {
    const signal = new AbortController().signal;
    const temp = await openTempKernelStore("k-d3-close-");
    opened.push(temp);
    const store = temp.store;
    const fixture = await KernelSessionFixture.create(store, "d3-close-session");
    await fixture.startTurn({ runId: "d3-close-run", turnId: "d3-close-turn", input: "d3 close" });
    await fixture.event("run.started", {});
    // Hand-counted: session.created=1, turn.started=2, run.started=3, so the
    // closure lands at position 4 and bumps the revision from 3 to 4.
    const openRevision = 3;

    // A second connection is the competing caller. It commits its closure from
    // inside this caller's append, so this caller already read the open Turn and
    // now hits the deterministic record id with a different recordedAt.
    const competitor = await SqliteStores.open(temp.databasePath);
    const originalAppend = store.append.bind(store);
    let injected = false;
    const appendSpy = vi.spyOn(store, "append").mockImplementation(async (...args) => {
      if (!injected) {
        injected = true;
        const winner = await closeOpenTurn(competitor, {
          sessionId: fixture.sessionId,
          kernelRunId: "d3-close-run",
          expectedRevision: openRevision,
          at: K_AT,
        });
        if (winner.status !== "closed") throw new Error(`D3 competitor: ${winner.status}`);
      }
      return originalAppend(...args);
    });
    try {
      const result = await closeOpenTurn(store, {
        sessionId: fixture.sessionId,
        kernelRunId: "d3-close-run",
        expectedRevision: openRevision,
        at: K_AT_LATER,
      });
      expect(result).toEqual({ status: "already_closed", revision: 4, position: 4 });
    } finally {
      appendSpy.mockRestore();
      await competitor.close();
    }
  });

  it("D3 returns a retryable conflict, never unreadable, when the append collision is a concurrent revision change that did not close this Turn", async () => {
    const signal = new AbortController().signal;
    const temp = await openTempKernelStore("k-d3-conflict-");
    opened.push(temp);
    const store = temp.store;
    const fixture = await KernelSessionFixture.create(store, "d3-conflict-session");
    await fixture.startTurn({ runId: "d3-conflict-run", turnId: "d3-conflict-turn", input: "d3 conflict" });
    await fixture.event("run.started", {});
    const openRevision = 3;

    const competitor = await SqliteStores.open(temp.databasePath);
    const state = fixture.state;
    // A valid event that keeps the Turn open and only moves the revision.
    const other = agentEventSchema.parse({
      type: "model.request_started",
      meta: {
        schemaVersion: 1,
        eventId: "evt-d3-conflict-2",
        runId: state.runId,
        turnId: state.turn.turnId,
        sequence: state.lastEventSequence + 1,
        occurredAt: K_AT,
        elapsedMs: 20,
      },
      payload: { requestId: "d3-conflict-req", retryOfRequestId: null },
    });
    const originalAppend = store.append.bind(store);
    let injected = false;
    const appendSpy = vi.spyOn(store, "append").mockImplementation(async (...args) => {
      if (!injected) {
        injected = true;
        await competitor.append(
          fixture.sessionId,
          openRevision,
          [
            {
              recordId: `agent-event:${other.meta.eventId}`,
              recordType: "agent.event",
              schemaVersion: 1,
              recordedAt: K_AT,
              payload: { event: other },
            },
          ],
          { signal },
        );
      }
      return originalAppend(...args);
    });
    try {
      const result = await closeOpenTurn(store, {
        sessionId: fixture.sessionId,
        kernelRunId: "d3-conflict-run",
        expectedRevision: openRevision,
        at: K_AT_LATER,
      });
      expect(result).toEqual({ status: "conflict", currentRevision: openRevision + 1 });
    } finally {
      appendSpy.mockRestore();
      await competitor.close();
    }
  });
});
