/**
 * Slice 2C row 2C-10 (LE3): one executor line walked through every step.
 *
 * Every fact is built through the real public services (Goals/Plans, Sessions,
 * responsibility links, claims, entry, Run results, controls and observations,
 * the real Evidence owner and Task completion). At every step the `lines/read`
 * row must equal the `lines/list` row over ALL `LineRowV1` fields, and while
 * the line still owns the task the `graph/hover` `owners` `LineBriefV1` must
 * equal the list row's `key`, `duty`, `name` and `status` fields.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { ArchitectureCatalogPort } from '../../src/core/work-graph/architecture/catalog-contracts.js';
import type { SessionAnomalyPort } from '../../src/core/work-graph/tasks/session-anomaly-service.js';
import type { NodeDetailReadPort } from '../../src/core/work-graph/model/work-line-contracts.js';
import { createNodeDetailReader } from '../../src/core/work-graph/views/node-detail-reader.js';
import type { LineRowV1 } from '../../src/contracts/work-line.js';
import { openLineFixture, rowOf, type LineFixture } from '../helpers/S2C-L-line-support.js';
import { completedEvent } from '../helpers/S2C-L-runs-support.js';

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  return result.value;
}

function taskTarget(task: TaskTriple) {
  return { kind: 'task' as const, ref: task };
}

const catalogStub: ArchitectureCatalogPort = {
  async adoptInitialArchitecture() { return { status: 'rejected', code: 'unsupported', reason: '2C-10 does not adopt an architecture' }; },
  async reviseArchitectureCatalog() { return { status: 'rejected', code: 'unsupported', reason: '2C-10 does not revise an architecture' }; },
  async readArchitectureRevision() { return { status: 'rejected', code: 'not_found', reason: '2C-10 has no architecture catalog' }; },
};

const anomaliesStub: SessionAnomalyPort = {
  async recordSessionAnomaly() { return { status: 'rejected', code: 'unsupported', reason: '2C-10 stub' }; },
  async listSessionAnomalies() { return { status: 'ready', value: { items: [], nextCursor: null, sourceCursor: 'c0000000000' as CommitCursor } }; },
  async readTaskArchiveState() { return { status: 'rejected', code: 'not_found', reason: '2C-10 stub' }; },
};

const executedFilesStub = {
  async readGoalExecutedFiles() {
    return { status: 'ready' as const, value: { availability: 'not_available' as const, files: [],
      possiblyIncomplete: true, guards: [], sourceCursor: null } };
  },
};

function nodeReaderOf(f: LineFixture): NodeDetailReadPort {
  return createNodeDetailReader({ records: f.records, plans: f.base.plans, catalog: catalogStub,
    anomalies: anomaliesStub, executedFiles: executedFilesStub, line: f.deps });
}

describe.each(['memory', 'sqlite'] as const)('2C-10 one executor line walked (%s)', (kind) => {
  const open: LineFixture[] = [];
  afterEach(async () => { for (const fixture of open.splice(0)) await fixture.close(); });
  async function lineFixture(): Promise<LineFixture> {
    const fixture = await openLineFixture(kind);
    open.push(fixture);
    return fixture;
  }

  it('2C-10 the read row, the list row and the hover brief agree through the whole lifecycle', async () => {
    const f = await lineFixture();
    await f.checks.installPolicy();
    const goal = await f.checks.addCheckableGoal('g10', [{ taskId: 'w', title: 'W task' }]);
    const task = goal.tasks['w']!;
    const head = (await f.createSession('s10')).ref;
    await f.link(head, taskTarget(task), 'responsible', true);
    const node = nodeReaderOf(f);

    const listRow = async (): Promise<LineRowV1> => {
      const row = rowOf(ready(await f.reader.listWorkLines(f.ctx, { workspace: f.base.scope })).rows, head);
      if (row === undefined) throw new Error('the walked line is not in the list');
      return row;
    };
    const detailRow = async (): Promise<LineRowV1> => {
      const detail = ready(await f.reader.readWorkLine(f.ctx, { workspace: f.base.scope, key: head }));
      if (detail.kind !== 'line') throw new Error(`expected a line detail, got ${detail.kind}`);
      return detail.row;
    };
    const agree = async (expectedOwn: string, ownedTask: TaskTriple | null): Promise<LineRowV1> => {
      const fromList = await listRow();
      const fromRead = await detailRow();
      expect(fromRead.status.own).toBe(expectedOwn);
      expect(fromRead).toEqual(fromList);
      if (ownedTask !== null) {
        const hover = ready(await node.readGraphHover(f.ctx, { goalRef: { aggregateType: 'Goal',
          projectId: ownedTask.projectId, goalId: ownedTask.goalId } }));
        const hoverTask = hover.tasks.find((entry) => entry.task.taskId === ownedTask.taskId);
        const owner = hoverTask?.owners.find((brief) => brief.key.projectId === head.projectId
          && brief.key.sessionId === head.sessionId);
        expect(owner).toEqual({ key: fromList.key, duty: fromList.duty, name: fromList.name, status: fromList.status });
      } else {
        const hover = ready(await node.readGraphHover(f.ctx, { goalRef: goal.goalRef }));
        const hoverTask = hover.tasks.find((entry) => entry.task.taskId === task.taskId);
        expect(hoverTask?.owners.some((brief) => brief.key.sessionId === head.sessionId)).toBe(false);
      }
      return fromList;
    };

    // 1. claim -> starting (counts as working through L24).
    const claim = await f.claim('w', head, goal);
    const starting = await agree('starting', task);
    expect(starting.status.bucket).toBe('working');

    // 2. enter -> working.
    await f.runs.enter(claim.claim);
    await agree('working', task);

    // 3. a queued pause -> still working with the stop_pending marker.
    const pauseRef = await f.runs.submitPause(claim.claim);
    const stopping = await agree('working', task);
    expect(stopping.status.markers.map((marker) => marker.kind)).toContain('stop_pending');

    // 4. the safe point observes the pause -> paused (you paused it).
    await f.runs.observePause(claim.claim, pauseRef);
    const paused = await agree('paused', task);
    expect(paused.status.ownReason.code).toBe('paused_by_you');

    // 5. resume -> working.
    const resumed = await f.runs.submitResult(claim.claim, 'resume');
    expect(resumed.status).toBe('committed');
    await agree('working', task);

    // 6. the Run completes -> standby, waiting for the formal check.
    await f.runs.recordResult(claim.claim, completedEvent(claim.claim, 'walk'));
    const waitingCheck = await agree('standby', task);
    expect(waitingCheck.status.ownReason.code).toBe('awaiting_check');

    // 7. the formal check opens and begins -> checking.
    const round = await f.checks.openRound(claim.runRef, task, goal.planRef);
    await agree('checking', task);
    const begun = await f.checks.beginFirstCheck(round);
    expect(begun.ticket.checkId).toBe(f.checks.checkId);
    await agree('checking', task);

    // 8. the check passes, the round finalizes and the Task is satisfied -> done (DE1).
    await f.checks.recordPass(round.ref, begun.ticket.checkId, begun.ticket.invocationId);
    const finalized = await f.checks.finalize(round.ref);
    expect(finalized.outcome).toBe('PASS');
    await f.checks.completeTask(goal.planRef, task, round.ref);
    const done = await agree('done', task);
    expect(done.status.doneEvidence).toBe('complete');

    // 9. the terminal responsibility close (maintenance's step) keeps it done (DE2).
    await f.closeTerminal(head, taskTarget(task));
    const doneAfterClose = await agree('done', null);
    expect(doneAfterClose.status.doneEvidence).toBe('complete');

    // 10. a new task is dispatched and claimed -> working again.
    const nextGoal = await f.checks.addCheckableGoal('g10-next', [{ taskId: 'w2', title: 'W2 task' }]);
    const nextTask = nextGoal.tasks['w2']!;
    await f.link(head, taskTarget(nextTask), 'responsible', true);
    const nextClaim = await f.claim('w2', head, nextGoal);
    await agree('starting', nextTask);
    await f.runs.enter(nextClaim.claim);
    await agree('working', nextTask);
  });
});
