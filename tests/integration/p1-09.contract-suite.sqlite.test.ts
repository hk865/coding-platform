/** P1-09 contract-suite wiring — SQLite (probe-gated). */
import { describe } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { defineQueryJobContractSuite } from "../contract-suite/query-job.contract.suite.js";
import { toP1_09Harness, type P1_09HarnessLike } from "../contract-suite/p1-09-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { isP109Ready } from "../restart/p1-09-restart-fixtures.js";

const READY = await isP109Ready();

const factory = async () => {
  const h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
  return toP1_09Harness(h as unknown as P1_09HarnessLike);
};

describe.skipIf(!READY)("P1-09 contract suite — SQLite", () => {
  defineQueryJobContractSuite(factory);
});
