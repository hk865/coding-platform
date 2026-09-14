/**
 * P1-13 lane C: the Writer chain over a REAL SQLite file, plus restart
 * (close -> reopen) field-by-field consistency for task / patch / evidence.
 *
 * The chain is the SAME one exercised by the InMemory lane-C test; here the
 * durable state lives only in the SQLite ledger file, so after close() + a
 * fresh instance on the SAME file the remediation task, the accepted
 * remediation plan patch, and the verification evidence must be byte-identical
 * (JSON.stringify), proving the writer chain state survives a process restart.
 */
import { describe, it, expect, afterAll } from "vitest";
import { createPersistentSqliteHarness, type PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { runP113WriterChain, type P113WriterHarness } from "../control/p1-13-writer-chain-fixture.js";
import { P113_PROJECT } from "../../src/fixtures/architecture-evolution-policy-fixtures.js";
import { P113_WORKSPACE, P113_PATCH } from "../contract-support/fixtures/remediation-fixtures.js";
import { remediationTaskRefFor } from "../../src/contracts/remediation.js";
import { remediationPlanPatchRefFor } from "../../src/contracts/remediation.js";
import { evidenceRefFor } from "../../src/contracts/evidence.js";
import { workspaceWriteLeaseRefFor } from "../../src/contracts/workspace-lease.js";
import { canonicalJson } from "../../src/contracts/fingerprint.js";

describe("P1-13 writer chain — real SQLite (close/reopen field consistency)", () => {
  let h: PersistentSqliteHarness;
  let snapshots: {
    task: string;
    patch: string;
    evidence: string;
    lease: string;
    workspace: string;
    finding: string;
  };

  afterAll(async () => {
    await h.cleanup().catch(() => undefined);
  });

  it("task / patch / evidence survive close+reopen byte-identically", async () => {
    h = await createPersistentSqliteHarness({ deps: {} });
    const r = await runP113WriterChain(h as unknown as P113WriterHarness);

    const taskRef = remediationTaskRefFor(P113_PROJECT, P113_WORKSPACE, "task-p113-1");
    const patchRef = remediationPlanPatchRefFor(P113_PROJECT, P113_WORKSPACE, P113_PATCH);
    const evRef = evidenceRefFor(P113_PROJECT, "p113-evidence-writer");

    const taskBefore = await h.ledger.load(taskRef);
    const patchBefore = await h.ledger.load(patchRef);
    const evBefore = await h.ledger.load(evRef);
    const wsBefore = await h.ledger.load({ aggregateType: "Workspace" as const, projectId: P113_PROJECT, workspaceId: P113_WORKSPACE });
    const findingBefore = await h.ledger.load({ aggregateType: "ArchitectureFinding" as const, projectId: P113_PROJECT, workspaceId: P113_WORKSPACE, findingId: r.finding.findingId });

    expect(taskBefore.status).toBe("found");
    expect(patchBefore.status).toBe("found");
    expect(evBefore.status).toBe("found");

    snapshots = {
      task: JSON.stringify((taskBefore as { snapshot: unknown }).snapshot),
      patch: JSON.stringify((patchBefore as { snapshot: unknown }).snapshot),
      evidence: JSON.stringify((evBefore as { snapshot: unknown }).snapshot),
      lease: JSON.stringify((await h.ledger.load(workspaceWriteLeaseRefFor(P113_PROJECT, "lease-p113-writer")) as { snapshot: unknown }).snapshot),
      workspace: JSON.stringify((wsBefore as { snapshot: unknown }).snapshot),
      finding: JSON.stringify((findingBefore as { snapshot: unknown }).snapshot),
    };

    // The resolved task carries the PASS result at the post-fix revision.
    const resolvedTask = (taskBefore as { snapshot: { task: { status: string; result: { verified: boolean; outcome: string } | null } } }).snapshot.task;
    expect(resolvedTask.status).toBe("resolved");
    expect(resolvedTask.result?.verified).toBe(true);
    expect(resolvedTask.result?.outcome).toBe("PASS");

    await h.close();

    // Restart on the SAME ledger file: fresh instance, no in-process state.
    const h2 = await h.reopen();
    const taskAfter = await h2.ledger.load(taskRef);
    const patchAfter = await h2.ledger.load(patchRef);
    const evAfter = await h2.ledger.load(evRef);
    const wsAfter = await h2.ledger.load({ aggregateType: "Workspace" as const, projectId: P113_PROJECT, workspaceId: P113_WORKSPACE });
    const findingAfter = await h2.ledger.load({ aggregateType: "ArchitectureFinding" as const, projectId: P113_PROJECT, workspaceId: P113_WORKSPACE, findingId: r.finding.findingId });

    expect(taskAfter.status).toBe("found");
    expect(patchAfter.status).toBe("found");
    expect(evAfter.status).toBe("found");

    // Field-by-field identity (JSON.stringify).
    expect(JSON.stringify((taskAfter as { snapshot: unknown }).snapshot)).toBe(snapshots.task);
    expect(JSON.stringify((patchAfter as { snapshot: unknown }).snapshot)).toBe(snapshots.patch);
    expect(JSON.stringify((evAfter as { snapshot: unknown }).snapshot)).toBe(snapshots.evidence);
    expect(JSON.stringify((wsAfter as { snapshot: unknown }).snapshot)).toBe(snapshots.workspace);
    expect(JSON.stringify((findingAfter as { snapshot: unknown }).snapshot)).toBe(snapshots.finding);

    // The lease was released via the patch-record atomic commit and persists.
    const leaseAfter = await h2.ledger.load(workspaceWriteLeaseRefFor(P113_PROJECT, "lease-p113-writer"));
    const leaseSnapAfter = (leaseAfter as { snapshot: { lease: { status: string } } }).snapshot;
    expect(leaseSnapAfter.lease.status).toBe("released");

    await h2.cleanup().catch(() => undefined);
  });
});
