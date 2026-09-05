/**
 * Wires the shared Goal View / ReadModelIndex contract suite (P1-00) onto the
 * lane-C ReadModelIndexImpl. Driven purely through advance(page) + goal(query).
 */
import { describe } from "vitest";
import { createReadModelIndex } from "../../src/read-model/read-model-index.js";
import { defineGoalViewContractSuite } from "../contract-suite/goal-view.contract.suite.js";

describe("ReadModelIndexImpl — GoalView contract suite", () => {
  defineGoalViewContractSuite({
    create: () => Promise.resolve(createReadModelIndex()),
  });
});
