/** P1-15 contract-suite wiring — real SQLite (probe-gated). */
import { describe } from "vitest";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { defineHumanRoleCollaborationContractSuite } from "../contract-suite/human-role-collaboration.contract.suite.js";
import type { P115HarnessLike } from "../contract-suite/p1-15-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { isP115Ready } from "../restart/p1-15-restart-fixtures.js";
const READY = await isP115Ready();
const factory = async () => { const h = await createPersistentSqliteHarness({ deps: {}, runtime: createP108ScenarioRuntime() }); return h as unknown as P115HarnessLike; };
describe.skipIf(!READY)("P1-15 contract suite — SQLite", () => { defineHumanRoleCollaborationContractSuite(factory); });