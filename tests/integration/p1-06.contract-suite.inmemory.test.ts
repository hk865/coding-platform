/**
 * P1-06 contract-suite wiring — InMemory implementation (real modules; no
 * fakes beyond the documented deterministic doubles). AUTO-SKIPS until the
 * P1-06 handlers/projections are implemented (probe, no fake).
 */
import { describe } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { defineHandoffContractSuite } from "../contract-suite/handoff.contract.suite.js";
import { toP1_06Harness, type P1_06HarnessLike } from "../contract-suite/p1-06-harness.js";
import { isP106Ready } from "../restart/p1-06-restart-fixtures.js";

const READY = await isP106Ready();

const factory = async () => {
  const h = createInMemoryHarness({ deps: {} });
  return toP1_06Harness(h as unknown as P1_06HarnessLike);
};

describe.skipIf(!READY)("P1-06 contract suite — InMemory", () => {
  defineHandoffContractSuite(factory as never);
});
