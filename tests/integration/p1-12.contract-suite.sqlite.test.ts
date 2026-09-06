/**
 * P1-12 contract-suite wiring — SQLite implementation. AUTO-SKIPS until the
 * P1-12 paths are implemented (probe, no fake).
 */
import { describe } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { defineArchitectureInspectionContractSuite } from "../contract-suite/architecture.contract.suite.js";
import { toP1_12Harness, type P1_12HarnessLike } from "../contract-suite/p1-12-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { isP112Ready } from "../restart/p1-12-restart-fixtures.js";

const READY = await isP112Ready();

const factory = async () => {
  const h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
  return toP1_12Harness(h as unknown as P1_12HarnessLike);
};

describe.skipIf(!READY)("P1-12 contract suite — SQLite", () => {
  defineArchitectureInspectionContractSuite(factory);
});
