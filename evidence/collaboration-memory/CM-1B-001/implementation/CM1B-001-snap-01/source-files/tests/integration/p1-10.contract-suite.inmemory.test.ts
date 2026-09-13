/** P1-10 contract-suite wiring — InMemory (probe-gated). */
import { describe } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { defineLifecycleControlContractSuite } from "../contract-suite/lifecycle-control.contract.suite.js";
import { toP1_10Harness, type P1_10HarnessLike } from "../contract-suite/p1-10-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { isP110Ready } from "../restart/p1-10-restart-fixtures.js";

const READY = await isP110Ready();

const factory = async () => {
  const h = createInMemoryHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
  return toP1_10Harness(h as unknown as P1_10HarnessLike);
};

describe.skipIf(!READY)("P1-10 contract suite — InMemory", () => {
  defineLifecycleControlContractSuite(factory);
});
