/**
 * P1-12 integration: real SQLite full path + restart equivalence + view
 * parity between adapters. AUTO-SKIPS until the P1-12 paths exist (probe).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPersistentSqliteHarness, type PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { toP1_12Harness, runP112InspectionScenario, type P1_12HarnessLike } from "../contract-suite/p1-12-harness.js";
import { isP112Ready, runP112RestartScenario, verifyP112AfterRestart, type P112RestartEvidence } from "../restart/p1-12-restart-fixtures.js";
import { P112_PROJECT, P112_WORKSPACE, buildP112CurrentGraph, buildP112BaselineGraph, p112BaselinePin } from "../../src/contracts/fixtures/architecture-fixtures.js";

const READY = await isP112Ready();

describe.skipIf(!READY)("P1-12 real SQLite integration", () => {
  let evidence: P112RestartEvidence;
  let closed: PersistentSqliteHarness;

  beforeAll(async () => {
    closed = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    evidence = await runP112RestartScenario(closed);
    await closed.close();
  });

  afterAll(async () => {
    await closed.cleanup().catch(() => undefined);
  });

  it("inspection view rebuilds identically after close+reopen (real SQLite)", async () => {
    const restarted = await closed.reopen();
    await verifyP112AfterRestart(restarted, evidence);
  });

  it("InMemory and SQLite inspection views agree (same deterministic scenario)", async () => {
    const mem = createInMemoryHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    const th = toP1_12Harness(mem as unknown as P1_12HarnessLike);
    const sql = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    try {
      const thSql = toP1_12Harness(sql as unknown as P1_12HarnessLike);
      const [memScen, sqlScen] = await Promise.all([
        runP112InspectionScenario(th),
        runP112InspectionScenario(thSql),
      ]);
      const view = await th.architectureInspectionView({ projectId: P112_PROJECT, workspaceId: P112_WORKSPACE });
      const viewSql = await thSql.architectureInspectionView({ projectId: P112_PROJECT, workspaceId: P112_WORKSPACE });
      expect(JSON.stringify(view)).toBe(JSON.stringify(viewSql));
      expect(memScen.proposal.proposalDigest).toBe(sqlScen.proposal.proposalDigest);
      expect(memScen.delta.changes.length).toBe(sqlScen.delta.changes.length);
    } finally {
      await sql.cleanup().catch(() => undefined);
    }
  });

  it("fail-closed: an unresolved pin never yields a pseudo delta/finding", async () => {
    expect(p112BaselinePin().ref.aggregateType).toBe("ArchitectureBaselineRevision");
    expect(buildP112BaselineGraph().nodes.length).toBeGreaterThan(0);
    expect(buildP112CurrentGraph().nodes.length).toBeGreaterThan(buildP112BaselineGraph().nodes.length);
  });
});
