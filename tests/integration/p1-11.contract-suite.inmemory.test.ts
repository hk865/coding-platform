/** P1-11 contract-suite wiring — InMemory (probe-gated). */
import { describe } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { defineGoalChangeContractSuite } from "../contract-suite/goal-change.contract.suite.js";
import { toP1_11Harness, type P1_11HarnessLike } from "../contract-suite/p1-11-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { isP111Ready } from "../restart/p1-11-restart-fixtures.js";

const READY = await isP111Ready();

const factory = async () => {
  const h = createInMemoryHarness({ deps: {}, runtime: createP108ScenarioRuntime() });
  return toP1_11Harness(h as unknown as P1_11HarnessLike);
};

describe.skipIf(!READY)("P1-11 contract suite — InMemory", () => {
  defineGoalChangeContractSuite(factory);
});
