/**
 * MVP UI connection — bounded execution list seam.
 *
 * Stage one freezes `ExecutionReadPort.listExecutions(ctx,{goalRef,taskId?,page})`
 * and its `executions/list` route. The page bound (1–100) and the exact
 * scope/Goal check are real here; the indexed page read reuses the existing
 * `r3c-run-by-goal` / `r4c-run-by-task` candidates plus the canonical Run
 * reader and is the expected FIRST RED until stage two implements it.
 */
import { describe, expect, it } from 'vitest';
import { createTaskClaimFixture } from '../../helpers/task-claim-fixture.js';
import { CORE_ROUTE_SPECS } from '../../../src/app/core-routes.js';
import { createRunStateReader } from '../../../src/core/work-graph/tasks/run-state-service.js';
import { createInMemoryRecordBackend } from '../../../src/core/record-store/in-memory-record-store.js';
import type { CoreCallContext } from '../../../src/contracts/core/call-context.js';
import type { GoalRef } from '../../../src/contracts/ledger.js';

const scope = { projectId: 'mvp-list-project', workspaceId: 'mvp-list-workspace' };
const goalRef: GoalRef = { aggregateType: 'Goal', projectId: scope.projectId, goalId: 'mvp-list-goal' };
const actor = { kind: 'human' as const, id: 'mvp-list-operator' };
const context = (): CoreCallContext => ({
  projectId: scope.projectId,
  workspaceId: scope.workspaceId,
  principal: { kind: 'host', actor: { ...actor } },
  materialReader: { kind: 'host', projectId: scope.projectId, workspaceId: scope.workspaceId, actor: { ...actor } },
  signal: new AbortController().signal,
});

function realReader() {
  // A REAL RecordStore backend (not a test double); the skeleton never reads it.
  const backend = createInMemoryRecordBackend({ schemas: { records: [], events: [], lookups: [] } });
  return { reader: createRunStateReader({ records: backend.records }), backend };
}

describe('MVP executions/list route contract (stage-one green)', () => {
  it('publishes the bounded list route as one plain explicit binding', () => {
    expect(CORE_ROUTE_SPECS['executions/list']).toEqual({
      kind: 'plain', binding: 'listExecutions', owner: 'executions.listExecutions',
    });
  });

  it('is assembled on the real reader and rejects a page limit outside 1–100 before any index read', async () => {
    const { reader, backend } = realReader();
    expect(typeof reader.listExecutions).toBe('function');
    const zero = await reader.listExecutions!(context(),
      { goalRef, page: { afterCursor: null, limit: 0 } });
    expect(zero).toMatchObject({ status: 'rejected', code: 'invalid' });
    const tooLarge = await reader.listExecutions!(context(),
      { goalRef, page: { afterCursor: null, limit: 101 } });
    expect(tooLarge).toMatchObject({ status: 'rejected', code: 'invalid' });
    await backend.close();
  });
});

describe('MVP executions/list real index read (expected red until stage two)', () => {
  it('pages real claimed Runs and keeps cursor scope and claim identities intact', async () => {
    const fixture = await createTaskClaimFixture('memory');
    try {
      const first = await fixture.service.claimTask(fixture.ctx, await fixture.buildRequest());
      const second = await fixture.service.claimTask(fixture.ctx, await fixture.buildRequest({
        input: { taskId: fixture.tasks.second.taskId, sessionRef: fixture.sessions.second },
      }));
      expect(first.status).toBe('committed');
      expect(second.status).toBe('committed');
      if (first.status !== 'committed' || second.status !== 'committed') throw new Error('formal claims failed');
      const reader = createRunStateReader({ records: fixture.records });
      const request = { goalRef: fixture.goalRef, page: { afterCursor: null, limit: 1 } };
      const page1 = await reader.listExecutions!(fixture.ctx, request);
      expect(page1.status).toBe('ready');
      if (page1.status !== 'ready') throw new Error('first execution page not ready');
      expect(page1.value.items).toHaveLength(1);
      expect(typeof page1.value.nextCursor).toBe('string');
      if (page1.value.nextCursor === null) throw new Error('second real Run was not paginated');
      const page2 = await reader.listExecutions!(fixture.ctx, {
        ...request, page: { afterCursor: page1.value.nextCursor, limit: 1 },
      });
      expect(page2.status).toBe('ready');
      if (page2.status !== 'ready') throw new Error('second execution page not ready');
      expect(page2.value.items).toHaveLength(1);
      expect(page2.value.nextCursor).toBeNull();
      const items = [...page1.value.items, ...page2.value.items];
      expect(new Set(items.map(item => item.run.ref.runId)).size).toBe(2);
      for (const claim of [first.value, second.value]) {
        const item = items.find(candidate => candidate.run.ref.runId === claim.runRef.runId);
        expect(item?.run.ref).toEqual(claim.runRef);
        expect(item?.run.task).toEqual(claim.task);
        expect(item?.attempt.ref).toEqual(claim.attemptRef);
        expect(item?.outbox.claim).toEqual(claim);
        expect(item?.session.ref).toEqual({ aggregateType: 'Session', ...claim.sessionRef });
      }
      const next = { ...request, page: { afterCursor: page1.value.nextCursor, limit: 1 } };
      const changedGoal = await reader.listExecutions!(fixture.ctx, {
        ...next, goalRef: { ...fixture.goalRef, goalId: 'another-goal' },
      });
      expect(changedGoal.status).toBe('rejected');
      const changedTask = await reader.listExecutions!(fixture.ctx, {
        ...next, taskId: fixture.tasks.first.taskId,
      });
      expect(changedTask.status).toBe('rejected');
      const otherWorkspace = 'another-workspace';
      const changedScope = await reader.listExecutions!({
        ...fixture.ctx, workspaceId: otherWorkspace,
        materialReader: { kind: 'host', projectId: fixture.scope.projectId, workspaceId: otherWorkspace, actor },
      }, next);
      expect(changedScope.status).toBe('rejected');
    } finally {
      await fixture.close();
    }
  });
});
