/** P1-13 contract-suite wiring — real SQLite (probe-gated). */
import { describe } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { defineArchitectureEvolutionContractSuite } from "../contract-suite/architecture-evolution.contract.suite.js";
import { toP1_13Harness, type P1_13HarnessLike } from "../contract-suite/p1-13-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { isP113Ready } from "../restart/p1-13-restart-fixtures.js";

const READY = await isP113Ready();

const factory = async () => {
  const h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
  return toP1_13Harness(h as unknown as P1_13HarnessLike);
};

describe.skipIf(!READY)("P1-13 contract suite — SQLite", () => {
  defineArchitectureEvolutionContractSuite(factory);
});
