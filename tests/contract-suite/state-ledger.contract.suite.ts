/**
 * Shared StateLedger contract suite (P1-00).
 * EVERY StateLedger adapter must pass this suite; lane A wires it to
 * InMemoryLedger. The suite drives the ledger through its public interface
 * only and uses the shared fixtures/builders — it duplicates no engine logic.
 */
import { describe, expect, it } from "vitest";
import type { LedgerCommit, LedgerCommitReceipt, StateLedger } from "../../src/contracts/ledger.js";
import { seqOfCommitCursor } from "../../src/contracts/ledger.js";
import type { CommitCursor } from "../../src/contracts/command-event.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1, buildBootstrapLedgerCommit } from "../../src/contracts/fixtures/bootstrap-fixture-v1.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import {
  MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1,
  buildCreateGoalCommand,
  buildGoalCreateLedgerCommit,
} from "../../src/contracts/fixtures/goal-fixtures.js";
import { FIXED_ISO_2026_09_05 } from "../../src/contracts/testing/sequences.js";

export interface StateLedgerContractContext {
  /** fresh empty ledger per call */
  create: () => Promise<StateLedger>;
  /** ledger with a fault-injection trigger (crash mid-commit) */
  createWithFault?: () => Promise<{ ledger: StateLedger; triggerFault: () => void }>;
}

const OCCURRED = FIXED_ISO_2026_09_05;

function bootstrapCommand(commandId: string, idempotencyKey?: string) {
  const deps: { commandId: string; correlationId: string; submittedAt: string; idempotencyKey?: string } = {
    commandId,
    correlationId: `corr-${commandId}`,
    submittedAt: OCCURRED,
  };
  if (idempotencyKey !== undefined) deps.idempotencyKey = idempotencyKey;
  return buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, deps);
}

function bootstrapBatch(commandId: string, idempotencyKey?: string) {
  const command = bootstrapCommand(commandId, idempotencyKey);
  const eventIds = ["evt-1-1", "evt-1-2", "evt-1-3", "evt-1-4"];
  return { command, batch: buildBootstrapLedgerCommit(command, { eventIds, occurredAt: OCCURRED }) };
}

function goalCommand(commandId: string, projectScope: 0 | 1) {
  const scope = MULTI_SCOPE_CREATE_GOAL_FIXTURE_V1.scopes[projectScope]!;
  return buildCreateGoalCommand(scope, {
    commandId,
    correlationId: `corr-${commandId}`,
    submittedAt: OCCURRED,
  });
}

function goalBatch(commandId: string, projectScope: 0 | 1, index: number) {
  const command = goalCommand(commandId, projectScope);
  const batch = buildGoalCreateLedgerCommit(command, {
    eventId: `evt-g-${index}`,
    occurredAt: OCCURRED,
    projectRevision: 1,
    workspaceRevision: 1,
  });
  return { command, batch };
}

function goalRefOf(projectId: string, goalId: string) {
  return { aggregateType: "Goal" as const, projectId, goalId };
}

function workspaceRefOf(projectId: string, workspaceId: string) {
  return { aggregateType: "Workspace" as const, projectId, workspaceId };
}

function zeroWrite(
  receipt: LedgerCommitReceipt,
  code: string,
  booting: { events: { eventId: string }[] },
) {
  expect(receipt.status).toBe("rejected");
  if (receipt.status === "rejected") expect(receipt.code).toBe(code);
  return booting.events.map((e) => e.eventId);
}

async function eventIdsAfter(ledger: StateLedger, cursor: CommitCursor | null): Promise<string[]> {
  const page = await ledger.events({ afterCursor: cursor, limit: 1000 });
  return page.events.map((p) => p.event.eventId);
}

export function defineStateLedgerContractSuite(ctx: StateLedgerContractContext) {
  describe("StateLedger contract suite", () => {
    it("empty ledger: loads not_found, empty event page", async () => {
      const ledger = await ctx.create();
      expect(await ledger.load({ aggregateType: "Project", projectId: "proj-alpha" })).toMatchObject({
        status: "not_found",
      });
      const page = await ledger.events({ afterCursor: null, limit: 1000 });
      expect(page.throughCursor).toBeNull();
      expect(page.afterCursor).toBeNull();
      expect(page.events).toEqual([]);
      expect(page.hasMore).toBe(false);
    });

    it("bootstrap on empty ledger commits atomically and is auditable", async () => {
      const ledger = await ctx.create();
      const { batch } = bootstrapBatch("cmd-boot-1");
      const receipt = await ledger.commit(batch);
      expect(receipt.status).toBe("committed");
      if (receipt.status !== "committed") return;
      expect(receipt.replayed).toBe(false);
      expect(receipt.eventIds).toEqual(batch.events.map((e) => e.eventId));
      expect(receipt.aggregateRevisions.map((v) => v.revision).every((r) => r === 1)).toBe(true);
      expect(await ledger.load({ aggregateType: "Project", projectId: "proj-alpha" })).toMatchObject({
        status: "found",
        snapshot: { ref: { projectId: "proj-alpha" }, revision: 1 },
      });
      expect(await ledger.load(workspaceRefOf("proj-alpha", "ws-shared"))).toMatchObject({
        status: "found",
        snapshot: { revision: 1 },
      });
      const manifestRef = batch.snapshots.at(-1)?.ref;
      if (manifestRef?.aggregateType !== "BootstrapManifest") throw new Error("manifest snapshot missing");
      const manifestId = manifestRef.manifestId;
      expect(
        await ledger.load({ aggregateType: "BootstrapManifest", manifestId }),
      ).toMatchObject({
        status: "found",
        snapshot: { sourceDigest: batch.events[0]?.payload.sourceDigest, bootstrapRevision: 1 },
      });
      const page = await ledger.events({ afterCursor: null, limit: 1000 });
      expect(page.events.length).toBe(batch.events.length);
      expect(page.events.map((p) => p.event.eventId)).toEqual(
        batch.events.map((e) => e.eventId),
      );
      expect(page.throughCursor).toBe(page.events.at(-1)?.cursor ?? null);
      expect(seqOfCommitCursor(page.throughCursor!)).toBe(batch.events.length);
    });

    it("bootstrap replay: same identity+fingerprint -> replayed, no extra events", async () => {
      const ledger = await ctx.create();
      const { batch } = bootstrapBatch("cmd-boot-2");
      const first = await ledger.commit(batch);
      const second = await ledger.commit(batch);
      if (first.status !== "committed" || second.status !== "committed") return;
      expect(first.status).toBe("committed");
      expect(second.replayed).toBe(true);
      expect(second.eventIds).toEqual(first.eventIds);
      expect(second.commitCursor).toBe(first.commitCursor);
      expect(await eventIdsAfter(ledger, null)).toEqual(batch.events.map((e) => e.eventId));
    });

    it("bootstrap on non-empty ledger (different identity) -> not_empty, zero write", async () => {
      const ledger = await ctx.create();
      const first = bootstrapBatch("cmd-boot-3");
      expect((await ledger.commit(first.batch)).status).toBe("committed");
      const other = bootstrapBatch("cmd-boot-3", "another-idempotency-key");
      const receipt = await ledger.commit(other.batch);
      expect(await eventIdsAfter(ledger, null)).toEqual(
        first.batch.events.map((e) => e.eventId),
      );
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("not_empty");
    });

    it("bootstrap same identity, different fingerprint -> idempotency_conflict", async () => {
      const ledger = await ctx.create();
      const { batch } = bootstrapBatch("cmd-boot-4");
      expect((await ledger.commit(batch)).status).toBe("committed");
      const other = buildBootstrapLedgerCommit(
        buildBootstrapCommand(
          { schemaVersion: 1, entries: [{ projectId: "proj-alpha", workspaceId: "ws-A" }] },
          {
            commandId: "cmd-boot-4b",
            correlationId: "corr-x",
            submittedAt: OCCURRED,
            idempotencyKey: batch.identity.idempotencyKey,
          },
        ),
        { eventIds: ["evt-x"], occurredAt: OCCURRED },
      );
      const receipt = await ledger.commit(other);
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("idempotency_conflict");
    });

    it("goal-create on bootstrapped ledger commits Goal snapshot + event (revision 1)", async () => {
      const ledger = await ctx.create();
      const boot = bootstrapBatch("cmd-boot-5");
      expect((await ledger.commit(boot.batch)).status).toBe("committed");
      const { command, batch } = goalBatch("cmd-goal-1", 0, 1);
      const receipt = await ledger.commit(batch);
      expect(receipt.status).toBe("committed");
      if (receipt.status !== "committed") return;
      expect(receipt.eventIds).toEqual(["evt-g-1"]);
      const loaded = await ledger.load(goalRefOf(command.identity.projectId, command.aggregateId));
      expect(loaded.status).toBe("found");
      if (loaded.status === "found") {
        expect(loaded.snapshot).toMatchObject({
          revision: 1,
          objective: command.payload.objective.trim(),
        });
      }
      expect(
        await ledger.load({ aggregateType: "Goal", projectId: "proj-beta", goalId: "goal-1" }),
      ).toMatchObject({ status: "not_found" });
    });

    it("goal-create CAS conflict -> revision_conflict with currentVersions, zero write", async () => {
      const ledger = await ctx.create();
      const boot = bootstrapBatch("cmd-boot-6");
      await ledger.commit(boot.batch);
      const { batch } = goalBatch("cmd-goal-2", 0, 2);
      const stale = {
        ...batch,
        expectedVersions: [
          { ref: { aggregateType: "Project" as const, projectId: "proj-alpha" }, revision: 0 },
          ...batch.expectedVersions.slice(1),
        ],
      };
      const receipt = await ledger.commit(stale);
      expect(await eventIdsAfter(ledger, null)).toEqual(
        boot.batch.events.map((e) => e.eventId),
      );
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") {
        expect(receipt.code).toBe("revision_conflict");
        expect(receipt.currentVersions?.map((v) => v.revision)).toEqual([1]);
      }
    });

    it("invalid_commit: event/snapshot misalignment -> zero write", async () => {
      const ledger = await ctx.create();
      const boot = bootstrapBatch("cmd-boot-7");
      await ledger.commit(boot.batch);
      const { batch } = goalBatch("cmd-goal-3", 0, 3);
      const misaligned = {
        ...batch,
        snapshots: [
          {
            ...batch.snapshots[0]!,
            ref: { aggregateType: "Goal" as const, projectId: "proj-beta", goalId: "goal-1" },
          },
        ],
      };
      const receipt = await ledger.commit(misaligned as unknown as LedgerCommit);
      expect(await eventIdsAfter(ledger, null)).toEqual(
        boot.batch.events.map((e) => e.eventId),
      );
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("invalid_commit");
    });

    it("unknown event schema version -> invalid_commit, zero write", async () => {
      const ledger = await ctx.create();
      const { batch } = goalBatch("cmd-goal-4", 0, 4);
      const bad = { ...batch, events: [{ ...batch.events[0]!, schemaVersion: 2 }] };
      const receipt = await ledger.commit(bad as unknown as LedgerCommit);
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("invalid_commit");
      expect(await eventIdsAfter(ledger, null)).toEqual([]);
    });

    it("goal-create idempotent replay: same eventIds/revisions/cursor, no second event", async () => {
      const ledger = await ctx.create();
      const boot = bootstrapBatch("cmd-boot-8");
      await ledger.commit(boot.batch);
      const { batch } = goalBatch("cmd-goal-5", 0, 5);
      const first = await ledger.commit(batch);
      const second = await ledger.commit(batch);
      expect(first.status).toBe("committed");
      expect(second.status).toBe("committed");
      if (first.status !== "committed" || second.status !== "committed") return;
      expect(second.replayed).toBe(true);
      expect(second.eventIds).toEqual(first.eventIds);
      expect(second.commitCursor).toBe(first.commitCursor);
      expect(second.aggregateRevisions).toEqual(first.aggregateRevisions);
      const ids = await eventIdsAfter(ledger, null);
      expect(ids.filter((_, i) => i >= boot.batch.events.length)).toEqual(["evt-g-5"]);
    });

    it("goal-create same identity different fingerprint -> idempotency_conflict", async () => {
      const ledger = await ctx.create();
      const boot = bootstrapBatch("cmd-boot-9");
      await ledger.commit(boot.batch);
      const { batch } = goalBatch("cmd-goal-6", 0, 6);
      const different = {
        ...batch,
        events: [
          {
            ...batch.events[0]!,
            payload: { ...batch.events[0]!.payload, objective: "changed" },
          },
        ],
        snapshots: [{ ...batch.snapshots[0]!, objective: "changed" }],
      };
      const receipt = await ledger.commit(different);
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("idempotency_conflict");
    });

    it("revision guard: re-create against existing Goal is revision_conflict", async () => {
      const ledger = await ctx.create();
      const boot = bootstrapBatch("cmd-boot-10");
      await ledger.commit(boot.batch);
      const { batch } = goalBatch("cmd-goal-7", 0, 7);
      expect((await ledger.commit(batch)).status).toBe("committed");
      const command = goalCommand("cmd-goal-7", 0);
      // same scope/command content, NEW idempotency key -> new identity, stale expected 0
      const again = buildGoalCreateLedgerCommit(command, {
        eventId: "evt-g-7b",
        occurredAt: OCCURRED,
        projectRevision: 1,
        workspaceRevision: 1,
      });
      const receipt = await ledger.commit(again);
      expect(receipt.status).toBe("rejected");
      if (receipt.status === "rejected") expect(receipt.code).toBe("revision_conflict");
    });

    it("EventPage: stable ordered paging, no skip, no duplicates", async () => {
      const ledger = await ctx.create();
      const boot = bootstrapBatch("cmd-boot-11");
      await ledger.commit(boot.batch);
      const g1 = goalBatch("cmd-goal-8", 0, 8);
      const g2 = goalBatch("cmd-goal-9", 1, 9);
      await ledger.commit(g1.batch);
      await ledger.commit(g2.batch);
      const seen: string[] = [];
      let after: CommitCursor | null = null;
      let guard = 0;
      for (;;) {
        guard += 1;
        expect(guard).toBeLessThan(50);
        const page = await ledger.events({ afterCursor: after, limit: 2 });
        expect(page.events.length).toBeLessThanOrEqual(2);
        if (page.events.length > 0) {
          expect(page.throughCursor).toBe(page.events.at(-1)?.cursor ?? null);
        } else {
          expect(page.throughCursor).toBe(after);
        }
        seen.push(...page.events.map((p) => p.event.eventId));
        after = page.throughCursor;
        if (page.events.length < 2) break;
      }
      expect(seen).toEqual([
        ...boot.batch.events.map((e) => e.eventId),
        ...g1.batch.events.map((e) => e.eventId),
        ...g2.batch.events.map((e) => e.eventId),
      ]);
    });

    it("cross-project isolation: same local workspaceId/goalId stay independent", async () => {
      const ledger = await ctx.create();
      const boot = bootstrapBatch("cmd-boot-12");
      await ledger.commit(boot.batch);
      const gAlpha = goalBatch("cmd-goal-10", 0, 10);
      const gBeta = goalBatch("cmd-goal-11", 1, 11);
      await ledger.commit(gAlpha.batch);
      await ledger.commit(gBeta.batch);
      const alpha = await ledger.load(goalRefOf("proj-alpha", "goal-1"));
      const beta = await ledger.load(goalRefOf("proj-beta", "goal-1"));
      expect(alpha.status).toBe("found");
      expect(beta.status).toBe("found");
      if (alpha.status === "found" && beta.status === "found") {
        expect(alpha.snapshot).not.toEqual(beta.snapshot);
        expect(alpha.snapshot).toMatchObject({ ref: { projectId: "proj-alpha" } });
        expect(beta.snapshot).toMatchObject({ ref: { projectId: "proj-beta" } });
      }
    });

    it("crash mid-commit leaves no partial state (fault injection)", async () => {
      if (!ctx.createWithFault) return;
      const { ledger, triggerFault } = await ctx.createWithFault();
      const boot = bootstrapBatch("cmd-boot-13");
      triggerFault();
      await expect(ledger.commit(boot.batch)).rejects.toThrow();
      expect(await eventIdsAfter(ledger, null)).toEqual([]);
      expect(await ledger.load({ aggregateType: "Project", projectId: "proj-alpha" })).toMatchObject({
        status: "not_found",
      });
    });
  });
}