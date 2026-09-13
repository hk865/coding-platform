/**
 * P1-02 contract-suite wiring — SQLite adapter (REAL modules: SqliteStateLedger +
 * ControlEngineImpl + SqliteReadModelIndex; no fakes). The SAME suite
 * definitions as the InMemory wiring — identical fixtures and assertions.
 */
import { defineGovernanceContractSuite } from "../contract-suite/governance.contract.suite.js";
import { definePlanContractSuite } from "../contract-suite/plan.contract.suite.js";
import type { P1_02TestHarness, P1_02HarnessFactory } from "../contract-suite/p1-02-harness.js";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";

const createHarness: P1_02HarnessFactory = async (): Promise<P1_02TestHarness> => {
  const h = await createPersistentSqliteHarness({ deps: {} });
  return {
    ledger: h.ledger,
    readModel: h.readModel,
    bootstrap: h.bootstrap,
    submit: (c) => h.control.submit(c),
    install: h.install,
    activate: h.activate,
    applyPlan: h.applyPlan,
    advanceProjection: h.advanceProjection,
    observedCursor: h.observedCursor,
    planGraph: h.planGraph,
    taskDetail: h.taskDetail,
    close: () => h.cleanup(),
  };
};

defineGovernanceContractSuite(createHarness);
definePlanContractSuite(createHarness);
