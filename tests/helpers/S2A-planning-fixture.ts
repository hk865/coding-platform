/**
 * Group Q (slice 2A) planning-question fixture.
 *
 * Builds real answered `initial_coordination` QueryJobs for Goal D through the
 * public Query owners: `submitQueryJob` -> `claimQuery` -> `bindPreparedQuery`
 * -> `beginQueryEntry` -> `recordQueryObservation` (entered, then answered).
 * No record is written directly.
 */
import type { WriteResult } from '../../src/contracts/core/results.js';
import type { QueryJobAnswerRef, QueryJobAnswerV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { QueryEntryIdentity } from '../../src/core/work-graph/queries/contracts.js';
import { createQueryExecution } from '../../src/core/work-graph/queries/query-execution.js';
import { createQueryJobService } from '../../src/core/work-graph/queries/query-job-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { T, WORKSPACE, WORKSPACE_SCOPE, type S5DecisionFixture } from './S5-decision-fixture.js';
import { ready, pin } from './S5-queue-support.js';
import { preparationHost, prepareQueryForReal } from './task-claim-fixture.js';

/** The planning Goal D the queue's cause cards are scoped to. */
export const PLANNING_GOAL_REF = { aggregateType: 'Goal' as const, projectId: 'P', goalId: 'D' };

const answerTextFor = (suffix: string): string => JSON.stringify({
  schemaVersion: 2, kind: 'needs_decision', summary: `An acceptance choice remains for ${suffix}.`,
  questions: [`Should acceptance prioritize latency or throughput for ${suffix}?`] });

/**
 * Build `count` real answered planning QueryJobs on Goal D (creating the Goal
 * and one reusable Session once). Returns the formal answer refs in build order.
 */
export async function buildPlanningQuestions(
  f: S5DecisionFixture, count: number,
): Promise<{ answerRefs: QueryJobAnswerRef[] }> {
  const goals = createGoalService({ records: f.records, now: f.now, eventId: f.newId }).tasks;
  const goal = mustWrite(await goals.createGoal(f.ctx, { input: { goalId: PLANNING_GOAL_REF.goalId,
    workspace: WORKSPACE_SCOPE, objective: 'Choose the acceptance tradeoff before planning D' },
    meta: { requestId: 's2a-planning-goal', expected: [await pin(f.records, { aggregateType: 'Project', projectId: 'P' }),
      await pin(f.records, WORKSPACE)] } }));
  const roles = createRoleConfigurationService({ records: f.records, now: f.now, eventId: f.newId });
  const roleBinding = f.runRB.roleBinding;
  const budget = { contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
    maxRequests: 4, maxToolCalls: 8, timeoutMs: null, perResponseTokens: 512 };
  const host = { configurationRevision: 's2a-planning-host-1', permissions: { tools: ['read'], writeScope: [] as [] },
    hostTemplate: { templateId: 'builder', revision: '1', digest: sha256Hex('S2A planning instructions') }, budget };
  const execution = createQueryExecution({ records: f.records, roles, bodies: f.bodies,
    authorizeConfiguration: async () => ({ status: 'ready' as const, value: host }), now: f.now, eventId: f.newId });
  const jobs = createQueryJobService({ records: f.records, execution, now: f.now, eventId: f.newId });
  const session = await f.createS5Session('s2a-planning');
  const answerRefs: QueryJobAnswerRef[] = [];
  for (let index = 0; index < count; index += 1) {
    // M3: zero-pad so the creation order equals the source's refKey index
    // order; the byte-last id is then the last built answer too.
    const suffix = String(index).padStart(5, '0');
    const answerText = answerTextFor(suffix);
    const jobRef: QueryJobRef = { ...WORKSPACE_SCOPE, aggregateType: 'QueryJob', queryJobId: `S2A-PQ-${suffix}` };
    const runRef: QueryRunRef = { ...WORKSPACE_SCOPE, aggregateType: 'QueryRun', queryJobId: jobRef.queryJobId, runId: `S2A-PQ-run-${suffix}` };
    mustWrite(await jobs.submitQueryJob(f.ctx, { input: { queryJobId: jobRef.queryJobId, runId: runRef.runId,
      intent: { schemaVersion: 1, intentId: jobRef.queryJobId, ...WORKSPACE_SCOPE, goalId: PLANNING_GOAL_REF.goalId,
        question: `Which acceptance tradeoff should plan ${suffix} use?`, focusTaskRefs: [],
        budget: { maxTokens: null, deadline: null }, multiTurn: { maxRounds: 1 }, correlationId: `S2A-PQ-${suffix}`,
        execution: { kind: 'initial_coordination', roleBinding, runtimeBudget: budget } } },
      meta: { requestId: `S2A-PQ-submit-${suffix}`, expected: [await pin(f.records, { aggregateType: 'Project', projectId: 'P' }),
        await pin(f.records, WORKSPACE), { ref: PLANNING_GOAL_REF, revision: goal.revision },
        { ref: jobRef, revision: 0 }, { ref: runRef, revision: 0 }] } }));
    let record = mustWrite(await jobs.claimQuery(f.ctx, { input: { queryRunRef: runRef, sessionRef: session },
      meta: { requestId: `S2A-PQ-claim-${suffix}`, expected: [await pin(f.records, jobRef), await pin(f.records, runRef),
        await pin(f.records, plainSessionRefToAggregate(session))] } }));
    const state = record.run.run.executionState;
    if (state === undefined) throw new Error('planning claim has no usable role');
    const facts = ready(await execution.readPreparationFacts(f.ctx, runRef));
    const prepared = (await prepareQueryForReal(f, {
      bodies: f.bodies, queryRunRef: runRef, queryExecution: execution, now: f.now,
      requestId: `S2A-PQ-prepare-${suffix}`,
      host: preparationHost({ configurationRevision: host.configurationRevision, permissions: host.permissions,
        hostTemplate: host.hostTemplate, budget }),
    })).prepared;
    record = ready(await execution.readQueryExecution(f.ctx, runRef));
    const kernel = { adapterId: record.session.kernel.adapterId, kernelSessionId: record.session.kernel.kernelSessionId,
      runId: `S2A-PQ-kernel-${suffix}`, turnId: `S2A-PQ-turn-${suffix}` };
    const ticket = mustWrite(await execution.beginQueryEntry(f.ctx, { input: { prepared, consumerId: `S2A-PQ-consumer-${suffix}`, kernel },
      meta: { requestId: `S2A-PQ-begin-${suffix}`, expected: [{ ref: jobRef, revision: record.job.revision }, { ref: runRef, revision: record.run.revision },
        { ref: record.session.ref, revision: record.session.revision }] } }));
    const entry: QueryEntryIdentity = { queryRunRef: runRef, sessionRef: ticket.sessionRef,
      sessionGeneration: ticket.sessionGeneration, entryGeneration: 1, consumerId: ticket.consumerId, kernel: ticket.kernel };
    record = mustWrite(await execution.recordQueryObservation(f.ctx, { input: { entry,
      history: { schemaVersion: 1, sessionRef: ticket.sessionRef, kernel: ticket.kernel, startPosition: 1, observedThroughPosition: 2, endPosition: null },
      source: { position: 2, cursor: `S2A-PQ-entered-${suffix}` }, observation: { kind: 'entered', occurredAt: T } },
      meta: { requestId: `S2A-PQ-entered-${suffix}`, expected: [await pin(f.records, runRef)] } }));
    const answerBody = ready(await f.bodies.put({ body: answerText, contentType: 'text/plain; charset=utf-8',
      sourceRefs: [{ kind: 'workspace', refId: 'W', revision: String(facts.workspace.revision) }],
      origin: { kind: 'run', owner: runRef }, requestedAt: T }));
    const answer: QueryJobAnswerV1 = { schemaVersion: 1, answerId: `S2A-PQ-answer-${suffix}`, queryJobRef: jobRef,
      runRef, roundIndex: 0, answer: answerText, sources: [], followsAnswerRef: null, stale: false,
      staleReason: null, answeredAt: T, bodyRef: answerBody.ref };
    record = mustWrite(await execution.recordQueryObservation(f.ctx, { input: { entry,
      history: { schemaVersion: 1, sessionRef: ticket.sessionRef, kernel: ticket.kernel, startPosition: 1, observedThroughPosition: 3, endPosition: 3 },
      source: { position: 3, cursor: `S2A-PQ-answered-${suffix}` },
      observation: { kind: 'terminal', occurredAt: T, outcome: 'answered', answer, reason: null } },
      meta: { requestId: `S2A-PQ-answered-${suffix}`, expected: [{ ref: runRef, revision: record.run.revision }] } }));
    if (record.answer === null) throw new Error('missing formal planning answer');
    answerRefs.push(record.answer.ref);
  }
  return { answerRefs };
}

function mustWrite<V>(result: WriteResult<V>): V {
  if (result.status !== 'committed') throw new Error(`planning setup write: ${JSON.stringify(result)}`);
  return result.value;
}
