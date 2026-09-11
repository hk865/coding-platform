import { afterEach, describe, expect, it } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { createPersistentSqliteHarness, type PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import {
  prepareP107Scenario, runP107Task, toP1_07Harness,
  P107_PROJECT, P107_WORKSPACE, P107_GOAL, P107_SCHEMA, P107_TASK_WRITER_B,
  P107_ROLE_BINDING_WRITER_V1, P107_BUDGET_WRITER_V1,
  P107_DECLARED_WRITE_PERMISSIONS_V1, P107_WRITE_SCOPE,
  buildP107AcquireReadLeaseCommand, buildP107AcquireWriteLeaseCommand, buildP107ReleaseLeaseCommand,
  taskAttemptRefFor,
} from "../contract-suite/p1-07-harness.js";
import type { P1_07HarnessLike } from "../contract-suite/p1-07-harness.js";
import { ConfiguredWorkspaceCapabilityPolicy, type WorkspaceCapabilitySupport } from "../../src/control/control-engine/policies/workspace-capability.js";
import type { WorkspaceCapabilityPort } from "../../src/contracts/workspace-capability.js";
import type { ConflictScopeV1 } from "../../src/contracts/workspace-lease.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

// Capability admission retains its asynchronous wire. Release both requests
// together so the test exercises concurrent lease decisions in either order.
function simultaneousCapabilities(): WorkspaceCapabilityPort {
  const policy = new ConfiguredWorkspaceCapabilityPolicy({ workspaceRead: true, workspaceWrite: true, maxWriteScope: null });
  let arrived = 0;
  let release!: () => void;
  const bothReady = new Promise<void>((resolve) => { release = resolve; });
  return { capabilitiesFor: async (envelope) => {
    const result = await policy.capabilitiesFor(envelope);
    if (++arrived === 2) release();
    await bothReady;
    return result;
  } };
}

async function setup(adapter: "memory" | "sqlite", workspaceCapability?: WorkspaceCapabilityPort) {
  const options = { deps: { clock: () => P107_SCHEMA }, ...(workspaceCapability ? { workspaceCapability } : {}) };
  const raw = adapter === "memory"
    ? createInMemoryHarness(options)
    : await createPersistentSqliteHarness(options);
  if (adapter === "sqlite") cleanup.push(() => (raw as PersistentSqliteHarness).cleanup());
  const h = toP1_07Harness(raw as unknown as P1_07HarnessLike);
  await prepareP107Scenario(h);
  const runRef = await runP107Task(h, {
    taskId: P107_TASK_WRITER_B, runId: "run-lease-regression", attemptId: "attempt-lease-regression",
    roleBinding: P107_ROLE_BINDING_WRITER_V1,
    declaredPermissions: P107_DECLARED_WRITE_PERMISSIONS_V1, budget: P107_BUDGET_WRITER_V1,
  });
  const scope: ConflictScopeV1 = {
    schemaVersion: 1, projectId: P107_PROJECT, workspaceId: P107_WORKSPACE,
    kind: "path", id: P107_WRITE_SCOPE, revision: null,
  };
  const holder = {
    runRef, attemptRef: taskAttemptRefFor(P107_PROJECT, P107_GOAL, P107_TASK_WRITER_B, "attempt-lease-regression"),
    roleBinding: P107_ROLE_BINDING_WRITER_V1,
  };
  const read = buildP107AcquireReadLeaseCommand({
    commandId: "cmd-lease-read", projectId: P107_PROJECT, leaseId: "lease-read", scope, holder,
  });
  const write = buildP107AcquireWriteLeaseCommand({
    commandId: "cmd-lease-write", projectId: P107_PROJECT, leaseId: "lease-write", scope, holder,
    declaredWriteScope: [P107_WRITE_SCOPE],
  });
  return { h, raw, read, write };
}

for (const adapter of ["memory", "sqlite"] as const) {
  describe(`workspace lease regression — ${adapter}`, () => {
    for (const [reason, support] of [
      ["capability_unsupported", null],
      ["capability_readonly", { workspaceRead: true, workspaceWrite: false, maxWriteScope: null }],
      ["scope_exceeds_capability", { workspaceRead: true, workspaceWrite: true, maxWriteScope: {
        schemaVersion: 1, projectId: P107_PROJECT, workspaceId: P107_WORKSPACE,
        kind: "path", id: P107_WRITE_SCOPE + "/only", revision: null,
      } }],
    ] as const satisfies ReadonlyArray<readonly [string, WorkspaceCapabilitySupport | null]>) {
      it(`configured support rejects a write lease with ${reason} and appends no events`, async () => {
        const { h, read, write } = await setup(adapter, new ConfiguredWorkspaceCapabilityPolicy(support));
        const before = await h.ledger.events({ afterCursor: null, limit: 1000 });
        expect(await h.acquireWorkspaceWriteLease(write)).toMatchObject({ status: "rejected", code: reason });
        if (support === null) expect(await h.acquireWorkspaceReadLease(read)).toMatchObject({ status: "rejected", code: reason });
        expect(await h.ledger.events({ afterCursor: null, limit: 1000 })).toEqual(before);
      });
    }

    it("retries the same write command with the original committed receipt", async () => {
      const { h, write } = await setup(adapter);
      const first = await h.acquireWorkspaceWriteLease(write);
      expect(first.status).toBe("committed");
      const before = await h.ledger.events({ afterCursor: null, limit: 1000 });
      expect(await h.acquireWorkspaceWriteLease(write)).toEqual({ ...first, replayed: true });
      expect(await h.ledger.events({ afterCursor: null, limit: 1000 })).toEqual(before);
    });

    it("replays a concurrent duplicate even when its capability response arrives after the first commit", async () => {
      const policy = new ConfiguredWorkspaceCapabilityPolicy({ workspaceRead: true, workspaceWrite: true, maxWriteScope: null });
      let calls = 0;
      let releaseSecond!: () => void;
      let secondArrived!: () => void;
      const secondWaiting = new Promise<void>((resolve) => { secondArrived = resolve; });
      const delayedResponse = new Promise<void>((resolve) => { releaseSecond = resolve; });
      const { h, write } = await setup(adapter, { capabilitiesFor: async (envelope) => {
        if (++calls === 2) { secondArrived(); await delayedResponse; }
        return policy.capabilitiesFor(envelope);
      } });
      const firstRequest = h.acquireWorkspaceWriteLease(write);
      const duplicateRequest = h.acquireWorkspaceWriteLease(write);
      await secondWaiting;
      const first = await firstRequest;
      releaseSecond();
      expect(first.status).toBe("committed");
      expect(await duplicateRequest).toEqual({ ...first, replayed: true });
    });

    it("does not accept a changed command or another identity as a replay", async () => {
      const { h, write } = await setup(adapter);
      expect((await h.acquireWorkspaceWriteLease(write)).status).toBe("committed");
      const before = await h.ledger.events({ afterCursor: null, limit: 1000 });
      const changed = { ...write, payload: { ...write.payload, expiresAt: "2026-09-06T13:00:00.000Z" } };
      expect(await h.acquireWorkspaceWriteLease(changed)).toMatchObject({ status: "rejected", code: "idempotency_conflict" });
      const other = { ...write, identity: { ...write.identity, idempotencyKey: "other-identity" } };
      expect(await h.acquireWorkspaceWriteLease(other)).toMatchObject({ status: "rejected", code: "revision_conflict" });
      expect(await h.ledger.events({ afterCursor: null, limit: 1000 })).toEqual(before);
    });

    it("replays a released lease without disturbing a newer active lease", async () => {
      const { h, write } = await setup(adapter);
      const first = await h.acquireWorkspaceWriteLease(write);
      expect(first.status).toBe("committed");
      expect((await h.releaseWorkspaceLease(buildP107ReleaseLeaseCommand({
        commandId: "release-write", projectId: P107_PROJECT, leaseId: write.aggregateId,
        kind: "write", holderRunRef: write.payload.holder.runRef,
      }))).status).toBe("committed");
      const next = buildP107AcquireWriteLeaseCommand({
        commandId: "next-write", projectId: P107_PROJECT, leaseId: "next-lease",
        holder: write.payload.holder, scope: write.payload.scope, declaredWriteScope: [P107_WRITE_SCOPE],
      });
      expect((await h.acquireWorkspaceWriteLease(next)).status).toBe("committed");
      const before = await h.ledger.events({ afterCursor: null, limit: 1000 });
      expect(await h.acquireWorkspaceWriteLease(write)).toEqual({ ...first, replayed: true });
      expect(await h.ledger.events({ afterCursor: null, limit: 1000 })).toEqual(before);
      expect(await h.acquireWorkspaceReadLease(buildP107AcquireReadLeaseCommand({
        commandId: "read-after-replay", projectId: P107_PROJECT, leaseId: "read-after-replay",
        holder: write.payload.holder, scope: write.payload.scope,
      }))).toMatchObject({ status: "rejected", code: "read_lease_conflict" });
    });

    for (const readFirst of [true, false]) {
      it(`concurrent overlapping read and write requests cannot both acquire a lease (read first: ${readFirst})`, async () => {
        const { h, read, write } = await setup(adapter, simultaneousCapabilities());
        const requestRead = () => h.acquireWorkspaceReadLease(read);
        const requestWrite = () => h.acquireWorkspaceWriteLease(write);
        const receipts = await Promise.all(readFirst ? [requestRead(), requestWrite()] : [requestWrite(), requestRead()]);
        expect(receipts.filter((receipt) => receipt.status === "committed")).toHaveLength(1);
        expect(receipts.filter((receipt) => receipt.status === "rejected")).toHaveLength(1);
      });
    }
  });
}

it("SQLite replay survives close and reopen with the same receipt and no appended events", async () => {
  const { h, raw, write } = await setup("sqlite");
  const first = await h.acquireWorkspaceWriteLease(write);
  expect(first.status).toBe("committed");
  const before = await h.ledger.events({ afterCursor: null, limit: 1000 });
  const persistent = raw as PersistentSqliteHarness;
  await persistent.close();
  const reopened = await persistent.reopen();
  cleanup.push(() => reopened.close());
  expect(await reopened.acquireWorkspaceWriteLease(write)).toEqual({ ...first, replayed: true });
  expect(await reopened.ledger.events({ afterCursor: null, limit: 1000 })).toEqual(before);
});

it("separate SQLite connections cannot grant overlapping read and write leases", async () => {
  const workspaceCapability = simultaneousCapabilities();
  const { h, raw, read, write } = await setup("sqlite", workspaceCapability);
  let sequence = 0;
  const second = await createPersistentSqliteHarness({
    dir: (raw as PersistentSqliteHarness).dir,
    deps: { clock: () => P107_SCHEMA, eventId: () => `second-client-${++sequence}` }, workspaceCapability,
  });
  cleanup.push(() => second.close());
  const receipts = await Promise.all([h.acquireWorkspaceReadLease(read), second.acquireWorkspaceWriteLease(write)]);
  expect(receipts.filter((receipt) => receipt.status === "committed")).toHaveLength(1);
  expect(receipts.filter((receipt) => receipt.status === "rejected")).toHaveLength(1);
});
