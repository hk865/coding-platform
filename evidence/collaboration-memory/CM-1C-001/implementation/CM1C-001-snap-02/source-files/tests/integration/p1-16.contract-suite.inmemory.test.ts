/**
 * P1-16 contract-suite wiring — InMemory implementation (real modules; no
 * fakes beyond the documented deterministic doubles). AUTO-SKIPS until the
 * P1-16 work-record/projection/assembly paths are implemented (probe, no fake).
 */
import { describe } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { defineContextContinuityContractSuite, type P1_16FactoryOptions } from "../contract-suite/context.continuity.contract.suite.js";
import { toP1_16Harness, type P1_16HarnessLike } from "../contract-suite/p1-16-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { isP116Ready } from "../restart/p1-16-restart-fixtures.js";

const READY = await isP116Ready();

const factory = async (options?: P1_16FactoryOptions) => {
  const h = createInMemoryHarness({
    deps: {},
    runtime: options?.runtime ?? createP108ScenarioRuntime(),
  });
  return toP1_16Harness(h as unknown as P1_16HarnessLike);
};

describe.skipIf(!READY)("P1-16 contract suite — InMemory", () => {
  defineContextContinuityContractSuite(factory);
});
