/**
 * Shared P1-17 contract-suite harness: completed-work selection scenario over
 * the P1-16 work world + helpers, used by both adapter suites and the restart
 * path. The helper surface is FROZEN by the shared baseline; the lane fills
 * completedWorkView + assembleCompletedWorkContext.
 */
import { expect } from "vitest";
import type { P1_16HarnessLike, P1_16TestHarness } from "./p1-16-harness.js";
import { runP116ContinuityScenario, type P116ContinuityScenarioResult } from "./p1-16-harness.js";
import type { CompletedWorkContextPort, CompletedWorkContextRequestV1, CompletedWorkContextResultV1, CompletedWorkViewQuery, CompletedWorkViewResult } from "../../src/contracts/completed-work-context.js";
import { buildP117Request } from "../../src/contracts/fixtures/completed-work-fixtures.js";
import { P117_PROJECT, P117_WORKSPACE } from "../../src/contracts/fixtures/completed-work-fixtures.js";
import { P108_PROJECT_A, P108_PROJECT_B, P108_TASK_WORK } from "./p1-08-harness.js";

export interface P1_17TestHarness extends P1_16TestHarness {
  completedWork: CompletedWorkContextPort;
  completedWorkView(query: CompletedWorkViewQuery): Promise<CompletedWorkViewResult>;
  assembleCompletedWorkContext(request: CompletedWorkContextRequestV1): Promise<CompletedWorkContextResultV1>;
}

export type P1_17HarnessLike = P1_16HarnessLike & {
  completedWork: CompletedWorkContextPort;
  completedWorkView: (query: CompletedWorkViewQuery) => Promise<CompletedWorkViewResult>;
  assembleCompletedWorkContext: (request: CompletedWorkContextRequestV1) => Promise<CompletedWorkContextResultV1>;
};

export function toP1_17Harness(h: P1_17HarnessLike): P1_17TestHarness {
  return h as unknown as P1_17TestHarness;
}

export type P117SelectionScenarioResult = {
  world: P116ContinuityScenarioResult;
  selection: CompletedWorkContextResultV1;
  view: CompletedWorkViewResult;
};

export async function runP117SelectionScenario(h: P1_17HarnessLike): Promise<P117SelectionScenarioResult> {
  const world = await runP116ContinuityScenario(h);
  const selection = await h.assembleCompletedWorkContext(buildP117Request());
  const view = await h.completedWorkView({ projectId: P108_PROJECT_A, workspaceId: P117_WORKSPACE });
  return { world, selection, view };
}
