
import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStateLedger } from "../../src/sqlite-ledger/sqlite-ledger.js";
import {
  WORKSPACE_BOOTSTRAP_FIXTURE_V1,
  buildBootstrapLedgerCommit,
} from "../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import {
  MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1,
  buildCreateGoalCommand,
  buildGoalCreateLedgerCommit,
} from "../../src/contracts/fixtures/goal-fixtures.js";
import { FIXED_ISO_2026_09_05 } from "../../src/contracts/testing/sequences.js";
import { seqOfCommitCursor } from "../../src/contracts/ledger.js";
import type { CommitCursor } from "../../src/contracts/command-event.js";
import type { LedgerCommitReceipt } from "../../src/contracts/ledger.js";

const OCCURRED = FIXED_ISO_2026_09_05;

function makeBootstrapBatch() {
  const command = buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
    commandId: "cmd-boot-r",
    correlationId: "corr-boot-r",
    submittedAt: OCCURRED,
  });
  const batch = buildBootstrapLedgerCommit(command, {
    eventIds: ["evt-r-b1", "evt-r-b2", "evt-r-b3", "evt-r-b4"],
    occurredAt: OCCURRED,
  });
  return { command, batch };
}

function makeGoalBatch(
  scopeIndex: 0 | 1,
  deps: { commandId: string; correlationId: string; eventId: string },
) {
  const scope = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[scopeIndex]!;
  const command = buildCreateGoalCommand(scope, {
    commandId: deps.commandId,
    correlationId: deps.correlationId,
    submittedAt: OCCURRED,
  });
  const batch = buildGoalCreateLedgerCommit(command, {
    eventId: deps.eventId,
    occurredAt: OCCURRED,
    projectRevision: 1,
    workspaceRevision: 1,
  });
  return { command, batch };
}

function committed(receipt: LedgerCommitReceipt) {
  if (receipt.status !== "committed") {
    throw new Error("expected committed receipt, got status " + receipt.status);
  }
  return receipt;
}

/**
 * Restart semantics (IMPLEMENTATION-HANDOFF "P1-01 contract and storage
 * semantics"): state lives ONLY in the SQLite file. Restart = close() on the
 * old instance (which then rejects) then a brand-new instance on the same file
 * path. Bootstrap + goal-create committed, closed, reopened: canonical snapshot
 * loads unchanged, EventPage is identical, the global cursor continues
 * monotonically (max+1, never wraps), and the idempotency record survives so a
 * replay still returns the original outcome.
 */
describe("SqliteStateLedger restart semantics", () => {
  it("close then reopen on same path preserves snapshot/events/cursor/idempotency; closed instance rejects", async () => {
    const dir = await mkdtemp(join(tmpdir(), "p1-01-lane-a-"));
    const path = join(dir, "ledger.sqlite");
    try {
      const boot = makeBootstrapBatch();
      const alpha = makeGoalBatch(0, {
        commandId: "cmd-goal-r",
        correlationId: "corr-goal-r",
        eventId: "evt-r-g1",
      });

      // --- first connection: bootstrap + goal-create ---
      const ledger = new SqliteStateLedger({ path });
      committed(await ledger.commit(boot.batch));
      const alphaReceipt = committed(await ledger.commit(alpha.batch));

      const preLoad = await ledger.load(alpha.batch.snapshots[0]!.ref);
      expect(preLoad.status).toBe("found");
      const prePage = await ledger.events({ afterCursor: null, limit: 1000 });
      const preEventIds = prePage.events.map((p) => p.event.eventId);
      const preLastSeq = seqOfCommitCursor(prePage.throughCursor!);

      // idempotency is observable before close
      const replayBeforeClose = committed(await ledger.commit(alpha.batch));
      expect(replayBeforeClose.replayed).toBe(true);
      expect(replayBeforeClose.eventIds).toEqual(alpha.batch.events.map((e) => e.eventId));
      expect(replayBeforeClose.commitCursor).toBe(alphaReceipt.commitCursor);

      await ledger.close();

      // closed instance refuses further use
      await expect(ledger.load(alpha.batch.snapshots[0]!.ref)).rejects.toThrow(/closed/);
      await expect(ledger.commit(alpha.batch)).rejects.toThrow(/closed/);
      await expect(ledger.events({ afterCursor: null, limit: 1 })).rejects.toThrow(/closed/);

      // --- second instance on the SAME file path ---
      const reopened = new SqliteStateLedger({ path });
      expect(reopened.dbPath).toBe(path);

      // canonical snapshot loads from the persisted snapshot table
      const postLoad = await reopened.load(alpha.batch.snapshots[0]!.ref);
      expect(postLoad.status).toBe("found");
      if (postLoad.status === "found" && preLoad.status === "found") {
        expect(postLoad.snapshot).toEqual(preLoad.snapshot);
        expect(postLoad.snapshot).toEqual(alpha.batch.snapshots[0]!);
      }

      // EventPage identical and continuous
      const postPage = await reopened.events({ afterCursor: null, limit: 1000 });
      expect(postPage.events.map((p) => p.event.eventId)).toEqual(preEventIds);
      expect(seqOfCommitCursor(postPage.throughCursor!)).toBe(preLastSeq);

      // idempotency record survived restart: replay returns original outcome
      const replayAfterReopen = committed(await reopened.commit(alpha.batch));
      expect(replayAfterReopen.replayed).toBe(true);
      expect(replayAfterReopen.eventIds).toEqual(alpha.batch.events.map((e) => e.eventId));
      expect(replayAfterReopen.commitCursor).toBe(alphaReceipt.commitCursor);
      // replay must NOT append a second event
      const afterReplay = await reopened.events({ afterCursor: null, limit: 1000 });
      expect(afterReplay.events.length).toBe(preEventIds.length);

      // global cursor continues monotonically (max+1) and never wraps
      const beta = makeGoalBatch(1, {
        commandId: "cmd-goal-b",
        correlationId: "corr-goal-b",
        eventId: "evt-r-g2",
      });
      const betaReceipt = committed(await reopened.commit(beta.batch));
      expect(seqOfCommitCursor(betaReceipt.commitCursor)).toBeGreaterThan(preLastSeq);

      // windowed pagination reproduces the same ids (no skip, no duplicate)
      const pagedIds: string[] = [];
      let after: CommitCursor | null = null;
      let guard = 0;
      for (;;) {
        guard += 1;
        expect(guard).toBeLessThan(50);
        const page = await reopened.events({ afterCursor: after, limit: 2 });
        pagedIds.push(...page.events.map((p) => p.event.eventId));
        after = page.throughCursor;
        if (!page.hasMore) break;
      }
      const finalPage = await reopened.events({ afterCursor: null, limit: 1000 });
      expect(pagedIds).toEqual(finalPage.events.map((p) => p.event.eventId));
      expect(pagedIds.at(-1)).toBe("evt-r-g2");

      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
