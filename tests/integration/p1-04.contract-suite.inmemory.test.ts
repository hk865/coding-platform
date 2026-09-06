/**
 * P1-04 contract-suite wiring — InMemory implementation (real modules; no
 * fakes beyond the documented deterministic check providers).
 */
import { describe } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { defineEvidenceContractSuite } from "../contract-suite/evidence.contract.suite.js";
import { defineVerificationContractSuite } from "../contract-suite/verification.contract.suite.js";
import { toP1_04Harness, type P1_04HarnessFactory } from "../contract-suite/p1-04-harness.js";

const factory: P1_04HarnessFactory = async () => {
  const h = createInMemoryHarness({ deps: {} });
  return toP1_04Harness(h);
};

describe("P1-04 contract suite — InMemory", () => {
  defineEvidenceContractSuite(factory);
  defineVerificationContractSuite(factory);
});
