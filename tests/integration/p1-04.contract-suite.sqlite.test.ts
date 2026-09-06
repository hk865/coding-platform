/**
 * P1-04 contract-suite wiring — SQLite adapter (REAL modules: SqliteStateLedger
 * + SqliteReadModelIndex + ControlEngineImpl + ArtifactVault +
 * ContextCompilerImpl + FakeRuntimeAdapter + DispatchEngineImpl +
 * VerificationEngine(Impl) + ReviewContextCompiler(Impl); no fakes beyond the
 * documented deterministic check providers and the SQLite storage adapter).
 */
import { describe } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { defineEvidenceContractSuite } from "../contract-suite/evidence.contract.suite.js";
import { defineVerificationContractSuite } from "../contract-suite/verification.contract.suite.js";
import { toP1_04Harness, type P1_04HarnessFactory } from "../contract-suite/p1-04-harness.js";

const factory: P1_04HarnessFactory = async () => {
  const h = await createPersistentSqliteHarness({ deps: {} });
  return toP1_04Harness(h);
};

describe("P1-04 contract suite — SQLite", () => {
  defineEvidenceContractSuite(factory);
  defineVerificationContractSuite(factory);
});
