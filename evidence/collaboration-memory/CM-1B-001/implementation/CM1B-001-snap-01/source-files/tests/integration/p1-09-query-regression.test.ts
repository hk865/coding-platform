import { describe, it, expect } from "vitest";
import { createInMemoryHarness } from "../../src/harness/in-memory-harness.js";
import { createPersistentSqliteHarness } from "../../src/harness/persistent-harness.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import type { SubmitQueryJobCommand } from "../../src/contracts/query-job.js";

function submit(projectId: string, workspaceId: string, queryId: string): SubmitQueryJobCommand {
  return { schemaVersion: 1, commandType: "SubmitQueryJob", commandId: `${projectId}-${queryId}`, identity: { projectId, actor: { kind: "human", id: "user" }, idempotencyKey: queryId }, aggregateId: queryId, expectedRevision: 0, correlationId: queryId, submittedAt: "2026-09-07T00:00:00.000Z", payload: { runId: `run-${queryId}`, intent: { schemaVersion: 1, intentId: `intent-${queryId}`, projectId, workspaceId, goalId: null, question: "What is happening?", focusTaskRefs: [], budget: { maxTokens: 1000, deadline: null }, multiTurn: { maxRounds: 1 }, correlationId: queryId } } };
}

for (const adapter of ["memory", "sqlite"] as const) {
  describe(`query public regressions (${adapter})`, () => {
    it("preserves arbitrary query and scope identities, including after restart", async () => {
      const original = adapter === "memory" ? createInMemoryHarness() : await createPersistentSqliteHarness();
      let h: typeof original | import("../../src/harness/persistent-harness.js").PersistentSqliteHarness = original;
      try {
        await h.bootstrap(buildBootstrapCommand({ schemaVersion: 1, entries: [{ projectId: "custom-alpha", workspaceId: "custom-workspace" }, { projectId: "custom-beta", workspaceId: "custom-workspace" }] }, { commandId: "boot", correlationId: "boot", submittedAt: "2026-09-07T00:00:00.000Z" }));
        for (const project of ["custom-alpha", "custom-beta"]) {
          for (const id of ["query-one", "query-two"]) {
            expect((await h.submitQueryJob(submit(project, "custom-workspace", id))).status).toBe("committed");
          }
        }
        if (adapter === "sqlite") { const persistent = h as import("../../src/harness/persistent-harness.js").PersistentSqliteHarness; await persistent.close(); h = await persistent.reopen(); }
        await h.advanceProjection();
        for (const project of ["custom-alpha", "custom-beta"]) {
          for (const id of ["query-one", "query-two"]) {
            const view = await h.queryJobView({ projectId: project, workspaceId: "custom-workspace", queryJobId: id });
            expect(view.status).toBe("ready");
            if (view.status !== "ready") throw new Error("query missing");
            expect(view.job).toMatchObject({ projectId: project, workspaceId: "custom-workspace", queryJobId: id, submittedAt: "2026-09-07T00:00:00.000Z" });
            expect(view.job.runRef).toMatchObject({ projectId: project, workspaceId: "custom-workspace", queryJobId: id, runId: `run-${id}` });
          }
        }
      } finally { if ("cleanup" in h) await h.cleanup(); }
    });
  });
}

import { prepareP108Scenario, P108_PROJECT_A, P108_PROJECT_B, P108_WORKSPACE, P108_GOAL, P108_TASK_WORK } from "../contract-suite/p1-08-harness.js";
import { ROLE_BINDING_FIXTURE_V1 } from "../../src/fixtures/dispatch-fixtures.js";
import { queryJobRefFor, queryRunRefFor, type QueryContextRequestV1 } from "../../src/contracts/query-job.js";
function contextRequest(): QueryContextRequestV1 {
  return { schemaVersion: 1, requestId: "context-test", queryJobRef: queryJobRefFor(P108_PROJECT_A, P108_WORKSPACE, "question"), runRef: queryRunRefFor(P108_PROJECT_A, P108_WORKSPACE, "question", "query-run"), goalId: P108_GOAL, question: "What is happening?", focusTaskRefs: [{ aggregateType: "Task", projectId: P108_PROJECT_A, goalId: P108_GOAL, taskId: P108_TASK_WORK }], requestedByRunRef: null, roleBindingRef: ROLE_BINDING_FIXTURE_V1, declaredPermissions: { tools: ["read"], writeScope: [] }, budget: { maxBundleBytes: 65536 } };
}
it("default query context resolves current task sources and enforces actual byte budget and scope", async () => {
  const h = createInMemoryHarness();
  await prepareP108Scenario(h);
  const request = contextRequest();
  const ready = await h.queryContext.assembleQueryContext(request);
  expect(ready.status).toBe("ready");
  if (ready.status !== "ready") throw new Error("context missing");
  expect(ready.manifest.selectedSources[0]?.refKey).toContain(P108_PROJECT_A);
  expect(ready.manifest.totalBytes).toBeLessThanOrEqual(request.budget.maxBundleBytes);
  expect(await h.queryContext.assembleQueryContext({ ...request, budget: { maxBundleBytes: 1 } })).toMatchObject({ status: "needs_material", gaps: [{ code: "budget_exhausted" }] });
  expect(await h.queryContext.assembleQueryContext({ ...request, focusTaskRefs: [{ ...request.focusTaskRefs[0]!, projectId: P108_PROJECT_B }] })).toMatchObject({ status: "rejected", code: "forbidden_tool_or_scope" });
  expect(await h.queryContext.assembleQueryContext({ ...request, focusTaskRefs: [{ ...request.focusTaskRefs[0]!, taskId: "missing" }] })).toMatchObject({ status: "needs_material", gaps: [{ code: "focus_not_found" }] });
});

import type { QueryJobDrivePort, ReadOnlyQueryPort } from "../../src/contracts/query-job.js";
it("drives a persisted query through the read-only runtime once under competing dispatchers", async () => {
  let calls = 0;
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const runtime: ReadOnlyQueryPort = {
    capabilities: () => ({ supported: true, maxQuestionBytes: 4096, maxAnswerBytes: 16384, readOnly: true }),
    async startQuery(request) {
      calls++;
      const context = await h.vault.open(request.bundleRef, { requesterRunRef: request.runRef });
      expect(context.status).toBe("ready");
      if (context.status !== "ready") throw new Error("query runtime cannot read its context");
      expect(JSON.parse(context.record.body).focus[0].task.taskId).toBe(P108_TASK_WORK);
      await blocked; return { schemaVersion: 1, runRef: request.runRef, outcome: "answered", answer: "Runtime supplied answer", sources: [], message: null, endedAt: "2026-09-07T00:00:01.000Z" }; },
  };
  const h = createInMemoryHarness({ readOnlyQuery: runtime });
  await prepareP108Scenario(h);
  const command = submit(P108_PROJECT_A, P108_WORKSPACE, "driven-query");
  command.payload.intent.focusTaskRefs = contextRequest().focusTaskRefs;
  expect((await h.submitQueryJob(command)).status).toBe("committed");
  const driver: QueryJobDrivePort = h;
  const first = driver.driveQuery({ reason: "test" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = driver.driveQuery({ reason: "competing" });
  release();
  const result = await first;
  await second;
  expect(calls).toBe(1);
  expect(result).toMatchObject({ started: 1, answered: 1, failures: [] });
  await h.advanceProjection();
  const view = await h.queryJobView({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, queryJobId: "driven-query" });
  expect(view.status).toBe("ready");
  if (view.status !== "ready") throw new Error("query missing");
  expect(view.currentAnswer?.answer).toBe("Runtime supplied answer");
  expect(view.currentAnswer?.sources[0]?.refKey).toContain(P108_PROJECT_A);
  expect((await driver.driveQuery({ reason: "repeat" })).started).toBe(0);
});

import { claimP108Task } from "../contract-suite/p1-08-harness.js";
import type { StartQueryJobCommand, CloseQueryJobCommand } from "../../src/contracts/query-job.js";
it("resumes pending SQLite queries without modifying their source Worker, and does not replay claimed runs", async () => {
  let h = await createPersistentSqliteHarness();
  try {
    await prepareP108Scenario(h);
    const source = await claimP108Task(h, P108_PROJECT_A, P108_TASK_WORK, "uninterrupted-source");
    const before = await h.ledger.load(source);
    const command = submit(P108_PROJECT_A, P108_WORKSPACE, "restart-query");
    command.payload.intent.focusTaskRefs = contextRequest().focusTaskRefs;
    await h.submitQueryJob(command);
    await h.close(); h = await h.reopen();
    expect(await h.driveQuery({ reason: "restart" })).toMatchObject({ started: 1, answered: 1, failures: [] });
    expect(await h.ledger.load(source)).toEqual(before);
    const stranded = submit(P108_PROJECT_A, P108_WORKSPACE, "stranded-query");
    stranded.payload.intent.focusTaskRefs = contextRequest().focusTaskRefs;
    await h.submitQueryJob(stranded);
    const jobRef = queryJobRefFor(P108_PROJECT_A, P108_WORKSPACE, "stranded-query");
    const runRef = queryRunRefFor(P108_PROJECT_A, P108_WORKSPACE, "stranded-query", "run-stranded-query");
    const start: StartQueryJobCommand = { schemaVersion: 1, commandType: "StartQueryJob", commandId: "start-stranded", identity: { projectId: P108_PROJECT_A, actor: { kind: "system", id: "query-dispatch" }, idempotencyKey: "start-stranded" }, aggregateId: "stranded-query", expectedRevision: 1, correlationId: "stranded", submittedAt: "2026-09-07T00:00:00.000Z", payload: { jobRef, runRef } };
    const started = await h.control.startQueryJob(start);
    expect(started.status).toBe("committed");
    await h.close(); h = await h.reopen();
    expect(await h.control.startQueryJob({ ...start, commandId: "retry", correlationId: "retry", submittedAt: "2026-09-07T00:01:00.000Z" })).toMatchObject({ status: "committed", replayed: true, revision: 2 });
    expect(await h.driveQuery({ reason: "recovery" })).toMatchObject({ started: 0, failures: [{ code: "outcome_unknown" }] });
    const close: CloseQueryJobCommand = { schemaVersion: 1, commandType: "CloseQueryJob", commandId: "close-stranded", identity: { projectId: P108_PROJECT_A, actor: { kind: "system", id: "query-dispatch" }, idempotencyKey: "close-stranded" }, aggregateId: "stranded-query", expectedRevision: 1, correlationId: "stranded", submittedAt: "2026-09-07T00:02:00.000Z", payload: { jobRef, runRef, reason: { code: "timeout", message: "deadline elapsed" } } };
    expect(await h.closeQueryJob(close)).toMatchObject({ status: "rejected", code: "revision_conflict" });
    close.expectedRevision = 2;
    expect(await h.closeQueryJob(close)).toMatchObject({ status: "committed", replayed: false, revision: 3 });
    expect(await h.closeQueryJob({ ...close, commandId: "retry-close" })).toMatchObject({ status: "committed", replayed: true, revision: 3 });
  } finally { await h.cleanup(); }
});
it("bounds driven follow-up rounds, includes prior answers, and replays a lost answer receipt", async () => {
  const h = createInMemoryHarness();
  await prepareP108Scenario(h);
  const command = submit(P108_PROJECT_A, P108_WORKSPACE, "follow-up-query");
  command.payload.intent.focusTaskRefs = contextRequest().focusTaskRefs;
  command.payload.intent.multiTurn.maxRounds = 2;
  await h.submitQueryJob(command);
  expect(await h.driveQuery({ reason: "first" })).toMatchObject({ answered: 1 });
  const req = { ...contextRequest(), queryJobRef: queryJobRefFor(P108_PROJECT_A, P108_WORKSPACE, "follow-up-query"), runRef: queryRunRefFor(P108_PROJECT_A, P108_WORKSPACE, "follow-up-query", "run-follow-up-query") };
  const context = await h.queryContext.assembleQueryContext(req);
  expect(context.status).toBe("ready");
  if (context.status !== "ready") throw new Error("context missing");
  const opened = await h.vault.open(context.bundleRef, { requesterRunRef: req.runRef });
  expect(opened.status).toBe("ready");
  if (opened.status !== "ready") throw new Error("body missing");
  expect(JSON.parse(opened.record.body).previousAnswers).toHaveLength(1);
  expect(await h.driveQuery({ reason: "follow-up" })).toMatchObject({ answered: 1 });
  expect(await h.driveQuery({ reason: "beyond-limit" })).toMatchObject({ started: 0 });
  await h.advanceProjection();
  const view = await h.queryJobView({ projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, queryJobId: "follow-up-query" });
  if (view.status !== "ready") throw new Error("query missing");
  expect(view.answers).toHaveLength(2);
  expect(view.answers[1]?.followsAnswerRef?.answerId).toBe(view.answers[0]?.answerId);
  const answer = view.answers[1]!;
  expect(await h.recordQueryAnswer({ schemaVersion: 1, commandType: "RecordQueryAnswer", commandId: "lost-receipt-retry", identity: { projectId: P108_PROJECT_A, actor: { kind: "system", id: "query-dispatch" }, idempotencyKey: answer.answerId }, aggregateId: "follow-up-query", expectedRevision: 4, correlationId: "retry", submittedAt: "2026-09-07T00:00:00.000Z", payload: { answer } })).toMatchObject({ status: "committed", replayed: true, revision: 5 });
});
it("never allocates more than the query's total token budget across rounds", async () => {
  const budgets: number[] = [];
  const runtime: ReadOnlyQueryPort = {
    capabilities: () => ({ supported: true, maxQuestionBytes: 4096, maxAnswerBytes: 16384, readOnly: true }),
    async startQuery(request) { budgets.push(request.budget.maxTokens); return { schemaVersion: 1, runRef: request.runRef, outcome: "answered", answer: "Answer", sources: [], message: null, endedAt: "2026-09-07T00:00:00.000Z" }; },
  };
  const h = createInMemoryHarness({ readOnlyQuery: runtime });
  await prepareP108Scenario(h);
  const command = submit(P108_PROJECT_A, P108_WORKSPACE, "tiny-budget");
  command.payload.intent.focusTaskRefs = contextRequest().focusTaskRefs;
  command.payload.intent.budget.maxTokens = 1;
  command.payload.intent.multiTurn.maxRounds = 4;
  await h.submitQueryJob(command);
  expect(await h.driveQuery({ reason: "first" })).toMatchObject({ answered: 1 });
  expect(await h.driveQuery({ reason: "exhausted" })).toMatchObject({ started: 0, closed: 1 });
  expect(budgets).toEqual([1]);
});
