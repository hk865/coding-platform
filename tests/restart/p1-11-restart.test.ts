/** P1-11 restart equivalence (probe-gated). */
import { describe, it, beforeAll, afterAll } from "vitest";
import { createPersistentPlatform, type PersistentPlatform } from "../../src/composition/persistent-platform.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { isP111Ready, runP111RestartScenario, verifyP111AfterRestart, type P111RestartEvidence } from "./p1-11-restart-fixtures.js";

const READY = await isP111Ready();

describe.skipIf(!READY)("P1-11 restart equivalence (SQLite)", () => {
  let h: PersistentPlatform;
  let evidence: P111RestartEvidence;

  beforeAll(async () => {
    h = await createPersistentPlatform({ deps: {}, runtime: createP108ScenarioRuntime() });
    evidence = await runP111RestartScenario(h);
    await h.close();
  });

  it("reopens with the same plan-change view, cursor and goal revision", async () => {
    const restarted = await h.reopen();
    await verifyP111AfterRestart(restarted, evidence);
  });

  afterAll(async () => {
    await h.cleanup().catch(() => undefined);
  });
});
