/**
 * P1-08 contract-suite wiring — InMemory implementation (real modules; no
 * fakes beyond the documented deterministic doubles). AUTO-SKIPS until the
 * P1-08 console projections are implemented (probe, no fake).
 */
import { describe } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { defineConsoleContractSuite, type P1_08FactoryOptions } from "../contract-suite/console.contract.suite.js";
import { toP1_08Harness, type P1_08HarnessLike } from "../contract-suite/p1-08-harness.js";
import { isP108Ready } from "../restart/p1-08-restart-fixtures.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";

const READY = await isP108Ready();

const factory = async (options?: P1_08FactoryOptions) => {
  const h = createInMemoryHarness({
    deps: {},
    runtime: options?.runtime ?? createP108ScenarioRuntime(),
  });
  return toP1_08Harness(h as unknown as P1_08HarnessLike);
};

describe.skipIf(!READY)("P1-08 contract suite — InMemory", () => {
  defineConsoleContractSuite(factory);
});
