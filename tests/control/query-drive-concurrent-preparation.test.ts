import { expect, it } from 'vitest';
import { QueryJobDriveEngineImpl } from '../../src/control/dispatch-engine/query-drive.js';
import { QueryContextCompilerImpl } from '../../src/data/context-compiler/query-context-compiler.js';
import type { QueryJobSnapshot, ReadOnlyQueryPort } from '../../src/contracts/query-job.js';
import { queryJobRefFor } from '../../src/contracts/query-job.js';
import { planningAt, planningScenario, planningScope } from './planning-fixture.js';

it('coalesces preparation for one Query while another Query progresses through the same driver', async () => {
  const s = await planningScenario();
  expect(await s.compiler.requestInitial(s.request)).toMatchObject({ status: 'accepted' });
  const firstId = 'real-query-initial-work';
  const loaded = await s.h.ledger.load(queryJobRefFor(planningScope.projectId, planningScope.workspaceId, firstId));
  if (loaded.status !== 'found') throw Error('Missing initial Query');
  const job = (loaded.snapshot as QueryJobSnapshot).job;
  const otherId = 'independent-query';
  expect(await s.h.submitQueryJob({ schemaVersion: 1, commandType: 'SubmitQueryJob', commandId: otherId,
    identity: { projectId: planningScope.projectId, actor: { kind: 'human', id: 'operator' }, idempotencyKey: otherId },
    aggregateId: otherId, expectedRevision: 0, correlationId: otherId, submittedAt: planningAt,
    payload: { runId: 'other-query-run', intent: { ...job.intent, intentId: otherId, question: 'An independent read-only question.' } } })).toMatchObject({ status: 'committed' });
  const context = new QueryContextCompilerImpl({ ledger: s.h.ledger, vault: s.h.vault, now: () => planningAt });
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const preparations = new Map<string, number>(), calls = new Map<string, number>();
  const runtime: ReadOnlyQueryPort = {
    capabilities: () => ({ supported: true, readOnly: true, maxQuestionBytes: 4096, maxAnswerBytes: 16384 }),
    startQuery: async request => {
      const id = request.runRef.queryJobId; calls.set(id, (calls.get(id) ?? 0) + 1);
      return { schemaVersion: 1, runRef: request.runRef, outcome: 'answered', answer: 'A bounded deterministic response.', sources: [], message: null, endedAt: planningAt };
    },
  };
  const driver = new QueryJobDriveEngineImpl({ ledger: s.h.ledger, control: s.h.control, vault: s.h.vault, runtime, now: () => planningAt,
    context: { assembleQueryContext: async request => {
      const id = request.queryJobRef.queryJobId, count = (preparations.get(id) ?? 0) + 1; preparations.set(id, count);
      if (id === firstId && count === 1) { entered.resolve(); await release.promise; }
      return context.assembleQueryContext(request);
    } } });
  const first = driver.driveQuery({ reason: 'human' });
  await entered.promise;
  try {
    const concurrent = await driver.driveQuery({ reason: 'periodic' });
    expect(concurrent.failures).toEqual([]);
    expect(calls.get(otherId)).toBe(1);
    expect(preparations.get(firstId)).toBe(1);
    expect(calls.has(firstId)).toBe(false);
  } finally { release.resolve(); await first; }
  expect(calls.get(firstId)).toBe(1);
  expect(preparations.get(firstId)).toBe(2); // prepare and final source recheck remain distinct.
  expect((await driver.driveQuery({ reason: 'repeat' })).started).toBe(0);
  expect(calls.get(firstId)).toBe(1);
});
