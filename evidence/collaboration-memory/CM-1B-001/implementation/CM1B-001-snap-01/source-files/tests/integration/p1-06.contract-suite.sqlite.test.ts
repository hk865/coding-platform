/**
 * P1-06 contract-suite wiring — SQLite implementation (real adapters; no
 * fakes beyond the documented deterministic doubles). AUTO-SKIPS until the
 * P1-06 handlers/projections are implemented (probe, no fake).
 */
import { describe } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { defineHandoffContractSuite } from "../contract-suite/handoff.contract.suite.js";
import { toP1_06Harness, type P1_06HarnessLike } from "../contract-suite/p1-06-harness.js";
import { isP106Ready } from "../restart/p1-06-restart-fixtures.js";

const READY = await isP106Ready();

const factory = async () => {
  const h = await createPersistentSqliteHarness({ deps: {} });
  return toP1_06Harness(h as unknown as P1_06HarnessLike);
};

describe.skipIf(!READY)("P1-06 contract suite — SQLite", () => {
  defineHandoffContractSuite(factory as never);
});
