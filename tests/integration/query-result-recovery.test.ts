import { expect, it } from 'vitest';
import { createInMemoryHarness } from '../../src/harness/in-memory-harness.js';
import { createPersistentPlatform } from '../../src/composition/persistent-platform.js';
import { QueryJobDriveEngineImpl } from '../../src/control/dispatch-engine/query-drive.js';
import { prepareP108Scenario, P108_PROJECT_A, P108_WORKSPACE, P108_GOAL, P108_TASK_WORK } from '../contract-suite/p1-08-harness.js';
import type { QueryExecutionBindingV1, ReadOnlyQueryPort, ReadOnlyQueryResultV1, QueryRunSnapshot } from '../../src/contracts/query-job.js';
import { queryJobRefFor, queryRunRefFor } from '../../src/contracts/query-job.js';
import { canonicalJson, sha256Hex } from '../../src/contracts/fingerprint.js';

for (const backend of ['memory', 'sqlite'] as const) it(`${backend}: lost query answer commit recovers the exact round without another runtime call`, async () => {
  let persistent = backend === 'sqlite' ? await createPersistentPlatform() : undefined;
  let h = persistent ?? createInMemoryHarness();
  const at = '2026-09-07T00:00:00.000Z';
  let observedAt = at;
  let calls = 0, loseCommit = true;
  let saved: { request: QueryExecutionBindingV1['request']; result: ReadOnlyQueryResultV1 } | undefined;
  const runtime: ReadOnlyQueryPort = {
    capabilities: () => ({ supported: true, readOnly: true, maxQuestionBytes: 4096, maxAnswerBytes: 16384 }),
    startQuery: async request => {
      calls++;
      const result: ReadOnlyQueryResultV1 = { schemaVersion: 1, runRef: request.runRef, outcome: 'answered', answer: 'Preserved answer', sources: [], message: null, endedAt: at };
      saved = structuredClone({ request, result });
      return result;
    },
    inspectQuery: async request => saved && canonicalJson(request) === canonicalJson(saved.request)
      ? { status: 'result', result: saved.result } : { status: 'unavailable', message: 'No matching durable result' },
  };
  const driver = () => new QueryJobDriveEngineImpl({ ledger: h.ledger, vault: h.vault, context: h.queryContext, runtime, now: () => observedAt,
    control: { startQueryJob: command => h.control.startQueryJob(command), closeQueryJob: command => h.closeQueryJob(command),
      grantMaterialAccess: command => h.grantMaterialAccess(command), recordQueryAnswer: command => {
        if (loseCommit) { loseCommit = false; throw Error('Injected ledger outage after runtime result'); }
        return h.recordQueryAnswer(command);
      } } });
  try {
    await prepareP108Scenario(h);
    const jobRef = queryJobRefFor(P108_PROJECT_A, P108_WORKSPACE, 'recover-result');
    const runRef = queryRunRefFor(P108_PROJECT_A, P108_WORKSPACE, 'recover-result', 'recover-run');
    expect(await h.submitQueryJob({ schemaVersion: 1, commandType: 'SubmitQueryJob', commandId: 'recover', identity: { projectId: P108_PROJECT_A, actor: { kind: 'human', id: 'operator' }, idempotencyKey: 'recover' }, aggregateId: jobRef.queryJobId, expectedRevision: 0, correlationId: 'recover', submittedAt: at,
      payload: { runId: runRef.runId, intent: { schemaVersion: 1, intentId: 'recover', projectId: P108_PROJECT_A, workspaceId: P108_WORKSPACE, goalId: P108_GOAL, question: 'Inspect current work', focusTaskRefs: [{ aggregateType: 'Task', projectId: P108_PROJECT_A, goalId: P108_GOAL, taskId: P108_TASK_WORK }], budget: { maxTokens: 1000, deadline: '2026-09-07T00:00:01.000Z' }, multiTurn: { maxRounds: 1 }, correlationId: 'recover' } } })).toMatchObject({ status: 'committed' });
    expect(await driver().driveQuery({ reason: 'first' })).toMatchObject({ started: 1, answered: 0, failures: [{ code: 'outcome_unknown' }] });
    const started = await h.ledger.load(runRef);
    expect(started.status).toBe('found');
    if (started.status !== 'found') throw Error('Run missing');
    expect((started.snapshot as QueryRunSnapshot).run.execution).toMatchObject({ roundIndex: 1, request: saved!.request });
    const binding = (started.snapshot as QueryRunSnapshot).run.execution!;
    const key = 'query-start-' + sha256Hex(canonicalJson(jobRef)) + '-1';
    for (const execution of [
      { ...binding, roundIndex: 2 },
      { ...binding, request: { ...binding.request, budget: { maxTokens: 1001 } } },
      { ...binding, selectedSources: [] },
      { ...binding, request: { ...binding.request, runRef: { ...runRef, projectId: 'other' } } },
    ]) {
      expect(await h.control.startQueryJob({ schemaVersion: 1, commandType: 'StartQueryJob', commandId: key,
        identity: { projectId: P108_PROJECT_A, actor: { kind: 'system', id: 'query-dispatch' }, idempotencyKey: key },
        aggregateId: jobRef.queryJobId, expectedRevision: 1, correlationId: 'recover', submittedAt: at,
        payload: { jobRef, runRef, execution } })).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    }
    expect(await h.ledger.load(runRef)).toEqual(started);

    if (persistent) { await persistent.close(); persistent = await persistent.reopen(); h = persistent; }
    observedAt = '2026-09-07T00:00:02.000Z'; // The saved result arrived before the deadline; recovery occurs later.
    expect(await driver().driveQuery({ reason: 'restart' })).toMatchObject({ started: 0, answered: 1, failures: [] });
    expect(await driver().driveQuery({ reason: 'repeat' })).toMatchObject({ started: 0, answered: 0 });
    expect(calls).toBe(1);
    await h.advanceProjection();
    expect(await h.queryJobView(jobRef)).toMatchObject({ status: 'ready', currentAnswer: { answer: 'Preserved answer', roundIndex: 1 } });
  } finally { await persistent?.cleanup(); }
});
