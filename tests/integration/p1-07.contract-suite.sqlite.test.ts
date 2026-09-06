/**
 * P1-07 contract-suite wiring — SQLite implementation (real adapters; no
 * fakes beyond the documented deterministic doubles). AUTO-SKIPS until the
 * P1-07 handlers/projections are implemented (probe, no fake).
 */
import { describe } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { defineWorkspaceContractSuite, type P1_07FactoryOptions } from "../contract-suite/workspace.contract.suite.js";
import { toP1_07Harness, type P1_07HarnessLike } from "../contract-suite/p1-07-harness.js";
import { isP107Ready } from "../restart/p1-07-restart-fixtures.js";

const READY = await isP107Ready();

const factory = async (options?: P1_07FactoryOptions) => {
  const h = await createPersistentSqliteHarness({
    deps: {},
    ...(options?.workspaceCapability === undefined ? {} : { workspaceCapability: options.workspaceCapability }),
    ...(options?.runtime === undefined ? {} : { runtime: options.runtime }),
  });
  return toP1_07Harness(h as unknown as P1_07HarnessLike);
};

describe.skipIf(!READY)("P1-07 contract suite — SQLite", () => {
  defineWorkspaceContractSuite(factory);
});
