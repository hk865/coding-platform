/** P1-15 contract-suite wiring — InMemory (probe-gated). */
import { describe } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { defineHumanRoleCollaborationContractSuite } from "../contract-suite/human-role-collaboration.contract.suite.js";
import type { P115HarnessLike } from "../contract-suite/p1-15-harness.js";
import { createP108ScenarioRuntime } from "../contract-suite/p1-08-harness.js";
import { isP115Ready } from "../restart/p1-15-restart-fixtures.js";
const READY = await isP115Ready();
const factory = async () => { const h = createInMemoryHarness({ deps: {}, runtime: createP108ScenarioRuntime() }); return h as unknown as P115HarnessLike; };
describe.skipIf(!READY)("P1-15 contract suite — InMemory", () => { defineHumanRoleCollaborationContractSuite(factory); });