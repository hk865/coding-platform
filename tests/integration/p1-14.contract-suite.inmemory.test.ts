/** P1-14 contract-suite wiring — InMemory (probe-gated). */
import { describe } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { defineBaselineEvolutionContractSuite } from "../contract-suite/baseline-evolution.contract.suite.js";
import type { P114HarnessLike } from "../contract-suite/p1-14-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { isP114Ready } from "../restart/p1-14-restart-fixtures.js";

const READY = await isP114Ready();
const factory = async () => {
  const h = createInMemoryHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
  return h as unknown as P114HarnessLike;
};
describe.skipIf(!READY)("P1-14 contract suite — InMemory", () => {
  defineBaselineEvolutionContractSuite(factory);
});
