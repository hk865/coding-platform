/**
 * Wires the shared Goal View / ReadModelIndex contract suite (P1-00) onto the
 * P1-01 lane-B SqliteReadModelIndex adapter. Driven purely through
 * advance(page) + goal(query); each case gets a fresh ":memory:" instance.
 * Mirrors tests/read-model/read-model-index.contract.test.ts.
 */
import { describe } from "vitest";
import { createSqliteReadModelIndex } from "../../src/sqlite-read-model/sqlite-read-model-index.js";
import { defineGoalViewContractSuite } from "../contract-suite/goal-view.contract.suite.js";

describe("SqliteReadModelIndex — GoalView contract suite", () => {
  defineGoalViewContractSuite({
    create: () => Promise.resolve(createSqliteReadModelIndex({ path: ":memory:" })),
  });
});
