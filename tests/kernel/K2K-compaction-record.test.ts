/**
 * Slice K2 KE1: the public Kernel compaction record seam.
 *
 * Entry: the public functions `appendCompactionRecord` / `readTurnBounds`; preconditions
 * are built and results read only through the public `SqliteStores.create/append/get/read`
 * surface (slice-K2-SPEC §4 KE1, rows K2K-01, K2K-02, K2K-08).
 *
 * Hand-counted positions of every session here: session.created = 1; each completed
 * Turn k is turn.started, run.started, model.request_started,
 * assistant.message_completed, run.completed, so T1 = 6 and T2 = 11 (its
 * assistant.message_completed is 10); a compaction record after T2 is 12.
 */
import { afterEach, describe, expect, it } from "vitest";

import { appendCompactionRecord, readTurnBounds } from "../../vendor/coding-agent/dist/public-api.js";
import {
  K_AT_LATER,
  K_SIGNAL,
  KernelSessionFixture,
  openTempKernelStore,
  readAllRecords,
  type TempKernelStore,
} from "../helpers/K-session-support.js";

const opened: TempKernelStore[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((item) => item.cleanup()));
});

async function completedTurn(f: KernelSessionFixture, k: number): Promise<void> {
  const turnId = `${f.sessionId}-turn-${String(k)}`;
  await f.startTurn({ runId: `${f.sessionId}-run-${String(k)}`, turnId, input: `input ${String(k)}` });
  await f.event("run.started", {});
  await f.event("model.request_started", { requestId: `${turnId}-req`, retryOfRequestId: null });
  await f.event("assistant.message_completed", {
    requestId: `${turnId}-req`,
    message: { schemaVersion: 1, messageId: `msg-${turnId}-a`, role: "assistant", content: "done" },
    toolCalls: [],
  });
  await f.event("run.completed", { finalMessageId: `msg-${turnId}-a` });
}

/** A session `s1` with two completed Turns (T1 = 6, T2 = 11). */
async function twoTurns(): Promise<{ temp: TempKernelStore; f: KernelSessionFixture }> {
  const temp = await openTempKernelStore("k2k-record-");
  opened.push(temp);
  const f = await KernelSessionFixture.create(temp.store, "s1");
  await completedTurn(f, 1);
  await completedTurn(f, 2);
  return { temp, f };
}

const STUBS_T1 = { throughPosition: 6, readBack: { "s1-run-1": "RB-1" } };

describe("K2 appendCompactionRecord and the Turn range (KE1, Kernel SQLite)", () => {
  it("K2K-01 appends after two completed Turns at the next position with revision + 1, keeps every earlier record and stores the hand-written payload under context-compacted:s1:<T2>", async () => {
    const { temp } = await twoTurns();
    const before = await readAllRecords(temp.store, "s1");
    const header = await temp.store.get("s1", { signal: K_SIGNAL });

    const result = await appendCompactionRecord(temp.store, {
      sessionId: "s1", expectedRevision: header.revision, at: K_AT_LATER,
      basedOnPosition: 11, outcome: "compacted", stubs: STUBS_T1, summary: null, failure: null,
    });

    expect(result).toEqual({ status: "appended", position: 12, revision: header.revision + 1 });
    const after = await readAllRecords(temp.store, "s1");
    expect(after).toHaveLength(12);
    expect(after.slice(0, 11)).toEqual(before);
    expect(after[11]).toMatchObject({
      recordId: "context-compacted:s1:11",
      position: 12,
      recordType: "context.compacted",
      recordedAt: K_AT_LATER,
      payload: {
        basedOnPosition: 11,
        outcome: "compacted",
        stubs: { throughPosition: 6, readBack: { "s1-run-1": "RB-1" } },
        summary: null,
        failure: null,
      },
    });
  });

  describe("rejects: K2K-02 every row of the append table above row 5 writes nothing", () => {
    type Case = {
      readonly name: string;
      readonly sessionId?: string;
      readonly revisionDelta?: number;
      readonly basedOnPosition: number;
      readonly outcome?: "compacted" | "failed";
      readonly stubs?: { throughPosition: number; readBack: Record<string, string> } | null;
      readonly failure?: { reason: string } | null;
      readonly arrange?: (f: KernelSessionFixture, store: TempKernelStore["store"]) => Promise<void>;
      readonly expected: (revision: number) => unknown;
    };
    const cases: readonly Case[] = [
      { name: "row 1: the Session does not exist", sessionId: "s1-missing", basedOnPosition: 11,
        expected: () => ({ status: "unreadable", reason: expect.any(String) }) },
      { name: "row 2: expectedRevision is one behind", revisionDelta: -1, basedOnPosition: 11,
        expected: (revision) => ({ status: "conflict", currentRevision: revision }) },
      { name: "row 3(a): T3 is still open", basedOnPosition: 13,
        arrange: async (f) => {
          await f.startTurn({ runId: "s1-run-3", turnId: "s1-turn-3", input: "input 3" });
          await f.event("run.started", {});
        },
        expected: () => ({ status: "not_idle", reason: "本轮未结束，未执行" }) },
      { name: "row 3(b): basedOnPosition is T1 while the tail is T2", basedOnPosition: 6,
        expected: () => ({ status: "not_idle", reason: "压缩只接在已完成轮次的终止事件后面" }) },
      { name: "row 3(c): the tail is an existing compaction record", basedOnPosition: 12,
        arrange: async (_f, store) => {
          const head = await store.get("s1", { signal: K_SIGNAL });
          await appendCompactionRecord(store, {
            sessionId: "s1", expectedRevision: head.revision, at: K_AT_LATER,
            basedOnPosition: 11, outcome: "compacted", stubs: STUBS_T1, summary: null, failure: null,
          });
        },
        expected: () => ({ status: "not_idle", reason: "压缩只接在已完成轮次的终止事件后面" }) },
      { name: "row 4(a): stubs.throughPosition is a non-terminal event of T2", basedOnPosition: 11,
        stubs: { throughPosition: 10, readBack: { "s1-run-1": "RB-1", "s1-run-2": "RB-2" } },
        expected: () => ({ status: "invalid", reason: expect.any(String) }) },
      { name: "row 4(b): readBack misses the runId of T2", basedOnPosition: 11,
        stubs: { throughPosition: 11, readBack: { "s1-run-1": "RB-1" } },
        expected: () => ({ status: "invalid", reason: expect.any(String) }) },
      { name: "row 4(c): a failed outcome carries stubs", basedOnPosition: 11, outcome: "failed",
        failure: { reason: "summary_unsupported" },
        expected: () => ({ status: "invalid", reason: expect.any(String) }) },
    ];

    it.each(cases)("K2K-02 $name", async (c) => {
      const { temp, f } = await twoTurns();
      await c.arrange?.(f, temp.store);
      const before = await readAllRecords(temp.store, "s1");
      const header = await temp.store.get("s1", { signal: K_SIGNAL });

      const result = await appendCompactionRecord(temp.store, {
        sessionId: c.sessionId ?? "s1",
        expectedRevision: header.revision + (c.revisionDelta ?? 0),
        at: K_AT_LATER,
        basedOnPosition: c.basedOnPosition,
        outcome: c.outcome ?? "compacted",
        stubs: c.stubs === undefined ? STUBS_T1 : c.stubs,
        summary: null,
        failure: c.failure ?? null,
      });

      expect(result).toEqual(c.expected(header.revision));
      expect(await readAllRecords(temp.store, "s1")).toHaveLength(before.length);
      expect((await temp.store.get("s1", { signal: K_SIGNAL })).revision).toBe(header.revision);
      if (c.sessionId !== undefined) {
        await expect(temp.store.get(c.sessionId, { signal: K_SIGNAL })).rejects.toMatchObject({ code: "not_found" });
      }
    });
  });

  it("K2K-08 readTurnBounds ends the Turn before a compaction record at its terminal event (T2), not at the record (T2 + 1)", async () => {
    const { temp } = await twoTurns();
    const header = await temp.store.get("s1", { signal: K_SIGNAL });
    await appendCompactionRecord(temp.store, {
      sessionId: "s1", expectedRevision: header.revision, at: K_AT_LATER,
      basedOnPosition: 11, outcome: "compacted", stubs: STUBS_T1, summary: null, failure: null,
    });

    expect(await readTurnBounds(temp.store, { sessionId: "s1", kernelRunId: "s1-run-2" })).toEqual({
      status: "found", startPosition: 7, endPosition: 11, terminalStatus: "completed",
    });
  });
});
