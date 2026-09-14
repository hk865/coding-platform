/**
 * P1-16 integration: real SQLite full path (work-record commands -> ledger ->
 * projection -> work-context views, plus the restart equivalence) and the
 * real-kernel continuation evidence block.
 * AUTO-SKIPS the contract-suite parts until the lanes land (probe, no fake).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createPersistentSqliteHarness, type PersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { toP1_16Harness, type P1_16HarnessLike } from "../contract-suite/p1-16-harness.js";
import { isP116Ready, runP116RestartScenario, verifyP116AfterRestart, type P116RestartEvidence } from "../restart/p1-16-restart-fixtures.js";
import { P116_WORKSPACE, P116_WORK } from "../contract-support/fixtures/context-fixtures.js";
import { P108_PROJECT_A } from "../contract-suite/p1-08-harness.js";

const READY = await isP116Ready();

describe.skipIf(!READY)("P1-16 real SQLite integration", () => {
  let evidence: P116RestartEvidence;
  let closed: PersistentSqliteHarness;

  beforeAll(async () => {
    closed = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    evidence = await runP116RestartScenario(closed);
    await closed.close();
  });

  afterAll(async () => {
    await closed.cleanup().catch(() => undefined);
  });

  it("work-context rows rebuild identically after close+reopen (real SQLite)", async () => {
    const restarted = await closed.reopen();
    await verifyP116AfterRestart(restarted, evidence);
  });

  it("InMemory and SQLite work-context views agree (same scenario, same expectations)", async () => {
    const mem = createInMemoryHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    const th = toP1_16Harness(mem as unknown as P1_16HarnessLike);
    await createP108ScenarioRuntime; // keep import live
    const sql = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
    try {
      const thSql = toP1_16Harness(sql as unknown as P1_16HarnessLike);
      const [memScen, sqlScen] = await Promise.all([
        (async () => { const r = await import("../contract-suite/p1-16-harness.js"); return r.runP116ContinuityScenario(th); })(),
        (async () => { const r = await import("../contract-suite/p1-16-harness.js"); return r.runP116ContinuityScenario(thSql); })(),
      ]);
      const w1a = await th.workContextView({ projectId: P108_PROJECT_A, workspaceId: P116_WORKSPACE, workId: P116_WORK });
      const w1aSql = await thSql.workContextView({ projectId: P108_PROJECT_A, workspaceId: P116_WORKSPACE, workId: P116_WORK });
      expect(JSON.stringify(w1a)).toBe(JSON.stringify(w1aSql));
      expect(memScen.works.aCoord.note1.noteId).toBe(sqlScen.works.aCoord.note1.noteId);
    } finally {
      await sql.cleanup().catch(() => undefined);
    }
  });

  it("real-kernel continuity evidence is a SEPARATE gated test (see p1-16.real-kernel.continuity.test.ts)", () => {
    // Placeholder documenting the verification split — the actual evidence run
    // needs a real coding-agent adapter + provider credentials and is executed
    // once by the integrator; Fake contract tests never substitute for it.
    expect(READY).toBe(true);
  });
});
