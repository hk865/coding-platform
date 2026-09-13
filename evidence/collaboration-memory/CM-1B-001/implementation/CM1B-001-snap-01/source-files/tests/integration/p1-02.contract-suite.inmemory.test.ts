/**
 * P1-02 contract-suite wiring — InMemory adapter (REAL modules: InMemoryLedger +
 * ControlEngineImpl + ReadModelIndexImpl; no fakes). The SAME suite definitions
 * run against the SQLite wiring (p1-02.contract-suite.sqlite.test.ts) with
 * identical fixtures and assertions — no per-adapter tuning.
 */
import { defineGovernanceContractSuite } from "../contract-suite/governance.contract.suite.js";
import { definePlanContractSuite } from "../contract-suite/plan.contract.suite.js";
import type { P1_02TestHarness, P1_02HarnessFactory } from "../contract-suite/p1-02-harness.js";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";

const createHarness: P1_02HarnessFactory = async (): Promise<P1_02TestHarness> => {
  const h = createInMemoryHarness({});
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
  };
};

defineGovernanceContractSuite(createHarness);
definePlanContractSuite(createHarness);
