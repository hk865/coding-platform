/** P1-17 contract-suite wiring — SQLite (probe-gated). */
import { describe } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { defineCompletedWorkContractSuite } from "../contract-suite/completed-work.contract.suite.js";
import { toP1_17Harness, type P1_17HarnessLike } from "../contract-suite/p1-17-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { isP117Ready } from "../restart/p1-17-restart-fixtures.js";

const READY = await isP117Ready();

const factory = async () => {
  const h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
  return toP1_17Harness(h as unknown as P1_17HarnessLike);
};

describe.skipIf(!READY)("P1-17 contract suite — SQLite", () => {
  defineCompletedWorkContractSuite(factory);
});
