/**
 * P1-03 contract-suite wiring — SQLite adapter (REAL modules: SqliteStateLedger
 * + SqliteReadModelIndex + ControlEngineImpl + ArtifactVault +
 * ContextCompilerImpl + FakeRuntimeAdapter + DispatchEngineImpl; no fakes).
 */
import { defineDispatchContractSuite } from "../contract-suite/dispatch.contract.suite.js";
import { defineRunContractSuite } from "../contract-suite/run.contract.suite.js";
import type { P1_03TestHarness, P1_03HarnessFactory } from "../contract-suite/p1-03-harness.js";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";

const createHarness: P1_03HarnessFactory = async (): Promise<P1_03TestHarness> => {
  const h = await createPersistentSqliteHarness({ deps: {} });
  return {
    ledger: h.ledger,
    readModel: h.readModel,
    runtime: h.runtime,
    bootstrap: h.bootstrap,
    submit: (c) => h.control.submit(c),
    install: h.install,
    activate: h.activate,
    applyPlan: h.applyPlan,
    dispatchReadiness: h.dispatchReadiness,
    claimTask: h.claimTask,
    startRun: h.startRun,
    runFact: h.runFact,
    drive: h.drive,
    advanceProjection: h.advanceProjection,
    observedCursor: h.observedCursor,
    planGraph: h.planGraph,
    taskDetail: h.taskDetail,
    activeAgent: h.activeAgent,
    close: () => h.cleanup(),
  };
};

defineDispatchContractSuite(createHarness);
defineRunContractSuite(createHarness);
