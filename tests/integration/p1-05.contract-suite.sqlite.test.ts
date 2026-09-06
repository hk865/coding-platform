/**
 * P1-05 contract-suite wiring — InMemory implementation (real modules).
 */
import { describe } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { defineGoalReductionContractSuite } from "../contract-suite/goal-phase.contract.suite.js";
import { toP1_05Harness, type P1_05HarnessFactory } from "../contract-suite/p1-05-harness.js";

const factory: P1_05HarnessFactory = async () => {
  const h = createInMemoryHarness({ deps: {} });
  return toP1_05Harness(h as never);
};

describe("P1-05 contract suite — SQLite", () => {
  defineGoalReductionContractSuite(factory);
});
