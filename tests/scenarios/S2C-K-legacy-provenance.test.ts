/**
 * Slice 2C row 2C-26 (LE4): the executions section lists only indexed executions.
 *
 * Entry LE4 (spec §5.1, row 2C-26): the scenario runs on the real
 * `openHostScenario` framework. A predecessor Session P is created through the
 * public `sessions/create` route, claims the seeded Work Task, and its
 * claimed-but-not-entered Run is cancelled through the public control owner;
 * the Task is then requeued publicly and a continuation Session C is created
 * with `{kind:'continuation', from:P}` provenance, from which the Task is
 * claimed again. A Query is submitted through the public Query owner and left
 * unclaimed; without a Session binding it is not indexed, so C's `executions`
 * section stays `indexed` and lists the dispatch-recorded Work claim of both
 * segments without the Query.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { TaskBudgetV1, TaskTriple } from '../../src/contracts/dispatch.js';
import type { QueryJobIntentV1, QueryJobRef, QueryRunRef } from '../../src/contracts/query-job.js';
import type { TaskRequeueRef } from '../../src/contracts/task-requeue.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import {
  AG2B_GOAL_REF, AG2B_PROJECT_REF, AG2B_QUERY_ROLE_BINDING, AG2B_RUNTIME_BUDGET, AG2B_SCOPE,
  AG2B_WORK_ROLE, AG2B_WORK_ROLE_BINDING, AG2B_WORKSPACE_REF, plain,
} from '../helpers/AG2b-collaboration-fixture.js';
import { lineSection, ready } from '../helpers/S2C-K-scenario-support.js';
import { cleanupScenarios, hostCtx, openHostScenario } from './harness.js';

/** The one seeded work Task both segments claim. */
const TASK_ID = 'implement-a';
const HOST_BUDGET: TaskBudgetV1 = { tokenBudget: 1_000_000, deadline: null };

afterEach(cleanupScenarios);

describe('2C-26 executions section (LE4)', () => {
  it('2C-26 the executions section stays indexed', async () => {
    const h = await openHostScenario({ workIds: [TASK_ID] });
    const platform = await h.direct();
    const ctx = hostCtx();

    async function createSession(requestId: string, provenance?: unknown): Promise<SessionRef> {
      const created = await h.post<{ status: string; value: { ref: { projectId: string; sessionId: string } } }>(
        'sessions/create', plain(AG2B_SCOPE, { workspace: AG2B_SCOPE, role: AG2B_WORK_ROLE,
          recommendedRefs: [], initialLinks: [],
          ...(provenance === undefined ? {} : { provenance }),
          meta: { requestId, expected: [] } }));
      expect(created.status).toBe('completed');
      return { projectId: created.value.ref.projectId, sessionId: created.value.ref.sessionId };
    }

    async function claimIn(session: SessionRef, requestId: string,
      requeue?: { ref: TaskRequeueRef; budget: TaskBudgetV1 | null }) {
      const card = await platform.sessions.readSession(ctx, session);
      if (card.status !== 'ready') throw new Error(`the Session must be readable: ${JSON.stringify(card)}`);
      const goal = await platform.plans.queryGoal(ctx, AG2B_GOAL_REF);
      if (goal.status !== 'ready') throw new Error(`the Goal must be readable: ${JSON.stringify(goal)}`);
      const planRef = goal.value.goal.activePlanRevision;
      if (planRef === null) throw new Error('the seeded Goal has no accepted Plan');
      const registration = await platform.projects.readWorkspaceRegistration(ctx, AG2B_SCOPE);
      if (registration.status !== 'ready') {
        throw new Error(`the Workspace must be readable: ${JSON.stringify(registration)}`);
      }
      const claim = await platform.claims.claimTask(ctx, {
        input: { goalRef: AG2B_GOAL_REF, planRef, taskId: TASK_ID, sessionRef: session,
          roleBinding: AG2B_WORK_ROLE_BINDING, budget: requeue?.budget ?? HOST_BUDGET,
          ...(requeue === undefined ? {} : { requeueRef: requeue.ref }) },
        meta: { requestId, expected: [
          { ref: AG2B_GOAL_REF, revision: goal.value.goal.revision },
          { ref: AG2B_WORKSPACE_REF, revision: registration.value.workspace.revision },
          { ref: plainSessionRefToAggregate(session), revision: card.value.record.revision },
        ] },
      });
      if (claim.status !== 'committed') throw new Error(`the claim did not commit: ${JSON.stringify(claim)}`);
      return claim.value;
    }

    // P: the predecessor segment. Its claim is real; the Run is cancelled before entry.
    const P = await createSession('s2c26-p');
    const pCard = await platform.sessions.readSession(ctx, P);
    if (pCard.status !== 'ready') throw new Error(`the predecessor Session must be readable: ${JSON.stringify(pCard)}`);
    expect(pCard.value.record.provenance).toEqual({ schemaVersion: 1, kind: 'new' });
    const pClaim = await claimIn(P, 's2c26-p-claim');
    const pRun = await platform.executions.readExecution(ctx, pClaim.runRef);
    if (pRun.status !== 'ready') throw new Error(`the predecessor Run must be readable: ${JSON.stringify(pRun)}`);
    const cancelled = await platform.controls.submitControl(ctx, {
      input: { runRef: pClaim.runRef, kind: 'cancel', reason: 'interrupt the predecessor segment' },
      meta: { requestId: 's2c26-p-cancel', expected: [{ ref: pClaim.runRef, revision: pRun.value.run.revision }] },
    });
    if (cancelled.status !== 'committed') throw new Error(`the cancel did not commit: ${JSON.stringify(cancelled)}`);

    // The public requeue of the Task, pinned to the Goal and the ended Run.
    const afterCancel = await platform.executions.readExecution(ctx, pClaim.runRef);
    if (afterCancel.status !== 'ready') throw new Error(`the cancelled Run must be readable: ${JSON.stringify(afterCancel)}`);
    const goalAtRequeue = await platform.plans.queryGoal(ctx, AG2B_GOAL_REF);
    if (goalAtRequeue.status !== 'ready') throw new Error(`the Goal must be readable: ${JSON.stringify(goalAtRequeue)}`);
    const requeued = await platform.claims.requeueTask!(ctx, {
      input: { taskRef: { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId: TASK_ID },
        afterRunRef: pClaim.runRef, reason: 'the predecessor segment was interrupted' },
      meta: { requestId: 's2c26-requeue', expected: [
        { ref: AG2B_GOAL_REF, revision: goalAtRequeue.value.goal.revision },
        { ref: pClaim.runRef, revision: afterCancel.value.run.revision },
      ] },
    });
    if (requeued.status !== 'committed' || requeued.value.kind !== 'requeued') {
      throw new Error(`the requeue did not commit a requeued outcome: ${JSON.stringify(requeued)}`);
    }

    // C: the continuation segment, created publicly from P and claimed from the requeue.
    const task: TaskTriple = { projectId: AG2B_SCOPE.projectId, goalId: AG2B_GOAL_REF.goalId, taskId: TASK_ID };
    const C = await createSession('s2c26-c', { schemaVersion: 1, kind: 'continuation', from: P,
      reason: 'interrupted', task });
    const cCard = await platform.sessions.readSession(ctx, C);
    if (cCard.status !== 'ready') throw new Error(`the continuation Session must be readable: ${JSON.stringify(cCard)}`);
    expect(cCard.value.record.provenance).toEqual({ schemaVersion: 1, kind: 'continuation', from: P,
      reason: 'interrupted', task });
    await claimIn(C, 's2c26-c-claim', { ref: requeued.value.requeue.ref, budget: requeued.value.requeue.budget });

    // A Query submitted through the public owner and left unclaimed.
    const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', ...AG2B_SCOPE, queryJobId: 's2c26-query-job' };
    const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', ...AG2B_SCOPE,
      queryJobId: queryJobRef.queryJobId, runId: 's2c26-query-run' };
    const goalAtSubmit = await platform.plans.queryGoal(ctx, AG2B_GOAL_REF);
    if (goalAtSubmit.status !== 'ready') throw new Error(`the Goal must be readable: ${JSON.stringify(goalAtSubmit)}`);
    const registrationAtSubmit = await platform.projects.readWorkspaceRegistration(ctx, AG2B_SCOPE);
    if (registrationAtSubmit.status !== 'ready') {
      throw new Error(`the Workspace must be readable: ${JSON.stringify(registrationAtSubmit)}`);
    }
    const intent: QueryJobIntentV1 = { schemaVersion: 1, intentId: queryJobRef.queryJobId, ...AG2B_SCOPE,
      goalId: AG2B_GOAL_REF.goalId, question: 'What does the current Session need to finish?',
      focusTaskRefs: [], budget: { maxTokens: 4096, deadline: null }, multiTurn: { maxRounds: 1 },
      correlationId: 's2c26-query-correlation',
      execution: { kind: 'semantic_query', roleBinding: AG2B_QUERY_ROLE_BINDING, runtimeBudget: AG2B_RUNTIME_BUDGET } };
    const submitted = await platform.queries.submitQueryJob(ctx, {
      input: { queryJobId: queryJobRef.queryJobId, runId: queryRunRef.runId, intent },
      meta: { requestId: 's2c26-query-submit', expected: [
        { ref: AG2B_PROJECT_REF, revision: registrationAtSubmit.value.project.revision },
        { ref: AG2B_WORKSPACE_REF, revision: registrationAtSubmit.value.workspace.revision },
        { ref: AG2B_GOAL_REF, revision: goalAtSubmit.value.goal.revision },
        { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 },
      ] },
    });
    if (submitted.status !== 'committed') {
      throw new Error(`the Query submit did not commit: ${JSON.stringify(submitted)}`);
    }
    const pair = await platform.queries.readQueryJob(ctx, queryJobRef);
    if (pair.status !== 'ready') throw new Error(`the QueryJob must be readable: ${JSON.stringify(pair)}`);
    expect(pair.value.run.run.status).toBe('pending');
    expect(pair.value.run.run.executionState).toBeUndefined();

    // C's executions list: one indexed Work claim per segment; the pending Query is not.
    const page = ready(await lineSection(h, C, 'executions', { limit: 100 }), 'lines/page executions');
    if (page.section !== 'executions') throw new Error('expected the executions section');
    expect(page.scope).toBe('indexed');
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({ kind: 'execution', task: { taskId: TASK_ID } });
    expect(page.items.every((item) => item.kind === 'execution')).toBe(true);
    expect(page.items.map((item) => item.kind === 'execution' ? item.task.taskId : item.queryRunRef.runId))
      .toEqual([TASK_ID, TASK_ID]);
    expect(page.items.some((item) => item.kind === 'query')).toBe(false);
  }, 240_000);
});
