import { describe, expect, it } from "vitest";
import { InMemoryLedger } from "../../src/ledger/in-memory-ledger.js";
import type { CommitCursor } from "../../src/contracts/command-event.js";
import { seqOfCommitCursor } from "../../src/contracts/ledger.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1, buildBootstrapLedgerCommit } from "../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import {
  MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1,
  buildCreateGoalCommand,
  buildGoalCreateLedgerCommit,
} from "../../src/contracts/fixtures/goal-fixtures.js";
import { FIXED_ISO_2026_09_05 } from "../../src/contracts/testing/sequences.js";

const OCCURRED = FIXED_ISO_2026_09_05;
const FIXTURE = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1;

function bootBatch(commandId: string) {
  const command = buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
    commandId,
    correlationId: "corr-" + commandId,
    submittedAt: OCCURRED,
  });
  const batch = buildBootstrapLedgerCommit(command, {
    eventIds: ["evt-b-1", "evt-b-2", "evt-b-3", "evt-b-4"],
    occurredAt: OCCURRED,
  });
  return { command, batch };
}

function goalBatch(commandId: string, scopeIdx: 0 | 1, sequence: number) {
  const scope = FIXTURE.scopes[scopeIdx]!;
  const command = buildCreateGoalCommand(scope, {
    commandId,
    correlationId: "corr-" + commandId,
    submittedAt: OCCURRED,
  });
  const batch = buildGoalCreateLedgerCommit(command, {
    eventId: "evt-g-" + sequence,
    occurredAt: OCCURRED,
    projectRevision: 1,
    workspaceRevision: 1,
  });
  return { command, batch };
}

async function committed(ledger: InMemoryLedger, batch: ReturnType<typeof goalBatch>["batch"] | ReturnType<typeof bootBatch>["batch"]) {
  const receipt = await ledger.commit(batch);
  if (receipt.status !== "committed") throw new Error("expected committed");
  return receipt;
}

describe("InMemoryLedger boundary semantics", () => {
  it("commitCursor is globally monotonic across commits, not per-aggregate", async () => {
    const ledger = new InMemoryLedger();
    const boot = bootBatch("cmd-boot-x");
    const r1 = await committed(ledger, boot.batch);
    const goal = goalBatch("cmd-goal-x", 0, 1);
    const r2 = await committed(ledger, goal.batch);
    expect(seqOfCommitCursor(r1.commitCursor)).toBe(4); // 4 boot events
    expect(seqOfCommitCursor(r2.commitCursor)).toBe(5); // exactly one more
  });

  it("paging from a cursor returns only strictly-following events in order", async () => {
    const ledger = new InMemoryLedger();
    await committed(ledger, bootBatch("cmd-boot-p").batch);
    await committed(ledger, goalBatch("cmd-g-p1", 0, 1).batch);
    await committed(ledger, goalBatch("cmd-g-p2", 1, 2).batch);

    const after = (await ledger.events({ afterCursor: null, limit: 1 })).throughCursor;
    expect(after).not.toBeNull();
    const page = await ledger.events({ afterCursor: after, limit: 1000 });
    // no re-emission of the cursor we already advanced past
    expect(page.events.map((p) => p.event.eventId)).toEqual(["evt-b-2", "evt-b-3", "evt-b-4", "evt-g-1", "evt-g-2"]);
  });

  it("deep paging over many events never skips or duplicates", async () => {
    const ledger = new InMemoryLedger();
    await committed(ledger, bootBatch("cmd-boot-d").batch);
    const scope = FIXTURE.scopes[0]!;
    const expected: string[] = [];
    for (let i = 1; i <= 6; i += 1) {
      // distinct goalId + distinct idempotency key -> distinct identity, so each
      // is a fresh create (never a re-create revision conflict)
      const command = buildCreateGoalCommand(
        { ...scope, goalId: "goal-" + i },
        {
          commandId: "cmd-g-d" + i,
          correlationId: "corr-d" + i,
          submittedAt: OCCURRED,
          idempotencyKey: "idem-d" + i,
        },
      );
      const batch = buildGoalCreateLedgerCommit(command, {
        eventId: "evt-g-" + i,
        occurredAt: OCCURRED,
        projectRevision: 1,
        workspaceRevision: 1,
      });
      await committed(ledger, batch);
      expected.push("evt-g-" + i);
    }
    const allIds = ["evt-b-1", "evt-b-2", "evt-b-3", "evt-b-4", ...expected];

    let after: CommitCursor | null = null;
    const seen: string[] = [];
    let guard = 0;
    for (;;) {
      guard += 1;
      expect(guard).toBeLessThan(50);
      const page = await ledger.events({ afterCursor: after, limit: 3 });
      seen.push(...page.events.map((p) => p.event.eventId));
      if (page.events.length > 0) {
        expect(page.throughCursor).toBe(page.events.at(-1)?.cursor ?? null);
      } else {
        expect(page.throughCursor).toBe(after);
      }
      after = page.throughCursor;
      if (!page.hasMore) break;
    }
    expect(seen).toEqual(allIds);
  });

  it("load does NOT match a ref by local workspaceId/goalId alone", async () => {
    const ledger = new InMemoryLedger();
    await committed(ledger, bootBatch("cmd-boot-l").batch);
    await committed(ledger, goalBatch("cmd-g-l", 0, 1).batch);
    // same local goalId/workspaceId but wrong project (proj-beta was never
    // bootstrapped with ws-shared for beta in this ledger before goal; still must miss)
    expect(
      await ledger.load({ aggregateType: "Goal", projectId: "proj-beta", goalId: "goal-1" }),
    ).toMatchObject({ status: "not_found" });
    // workspace ref under a project with a workspace that was never bootstrapped
    expect(
      await ledger.load({ aggregateType: "Workspace", projectId: "proj-beta", workspaceId: "ws-unknown" }),
    ).toMatchObject({ status: "not_found" });
  });

  it("idempotent replay of an earlier goal-create is stable across later commits", async () => {
    const ledger = new InMemoryLedger();
    await committed(ledger, bootBatch("cmd-boot-r").batch);
    const first = goalBatch("cmd-g-r1", 0, 1);
    const second = goalBatch("cmd-g-r2", 1, 2);
    const t1 = await committed(ledger, first.batch);
    const t2 = await committed(ledger, second.batch);

    const replayed = await ledger.commit(first.batch);
    expect(replayed.status).toBe("committed");
    if (replayed.status === "committed") {
      expect(replayed.replayed).toBe(true);
      expect(replayed.eventIds).toEqual(t1.eventIds);
      expect(replayed.commitCursor).toBe(t1.commitCursor);
      expect(replayed.aggregateRevisions).toEqual(t1.aggregateRevisions);
    }
    // no duplicate event was written
    expect((await ledger.events({ afterCursor: null, limit: 1000 })).events.length).toBe(6);
    void t2;
  });

  it("load returns the exact not_found ref it was asked for", async () => {
    const ledger = new InMemoryLedger();
    const ref = { aggregateType: "Goal" as const, projectId: "proj-zzz", goalId: "g" };
    expect(await ledger.load(ref)).toEqual({ status: "not_found", ref });
  });

  it("bootstrap same identity, different fingerprint -> idempotency_conflict, zero write", async () => {
    const ledger = new InMemoryLedger();
    const first = bootBatch("cmd-boot-c1");
    expect((await ledger.commit(first.batch)).status).toBe("committed");
    const other = buildBootstrapCommand(
      { schemaVersion: 1, entries: [{ projectId: "proj-alpha", workspaceId: "ws-A" }] },
      {
        commandId: "cmd-boot-c2",
        correlationId: "corr-c2",
        submittedAt: OCCURRED,
        idempotencyKey: first.command.identity.idempotencyKey,
      },
    );
    const otherBatch = buildBootstrapLedgerCommit(other, {
      eventIds: ["evt-x1", "evt-x2"],
      occurredAt: OCCURRED,
    });
    const receipt = await ledger.commit(otherBatch);
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("idempotency_conflict");
    expect((await ledger.events({ afterCursor: null, limit: 1000 })).events.length).toBe(4);
  });

  it("bootstrap replay is stable across a retry with a different commandId", async () => {
    const ledger = new InMemoryLedger();
    const first = bootBatch("cmd-boot-r1");
    const t1 = await committed(ledger, first.batch);
    const retried = bootBatch("cmd-boot-r2");
    const t2 = await ledger.commit(retried.batch);
    expect(t2.status).toBe("committed");
    if (t2.status === "committed") {
      expect(t2.replayed).toBe(true);
      expect(t2.eventIds).toEqual(t1.eventIds);
      expect(t2.commitCursor).toBe(t1.commitCursor);
    }
    expect((await ledger.events({ afterCursor: null, limit: 1000 })).events.length).toBe(4);
  });
});
