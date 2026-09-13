import { describe, expect, it } from 'vitest';
import { InMemoryLedger } from '../../src/data/state-ledger/in-memory-ledger.js';
import { SqliteStateLedger } from '../../src/data/state-ledger/sqlite-ledger.js';
import { ReadModelIndexImpl } from '../../src/data/read-model-index/read-model-index.js';
import { SqliteReadModelIndex } from '../../src/data/read-model-index/sqlite-read-model-index.js';
import { ControlPolicyExplanation } from '../../src/control/control-engine/policy-explanation.js';
import { buildReduceTaskCommand } from '../../src/contracts/commands/evidence.js';
import { buildReduceGoalCommand } from '../../src/contracts/commands/goal-phase.js';
import { taskReductionRefFor } from '../../src/contracts/reduction.js';
import { goalPhaseRefFor } from '../../src/contracts/goal-phase.js';
import { reviewFixture, scope, cmd } from './reviewer-work-fixture.js';
import type { EventPage } from '../../src/contracts/ledger.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';

for (const storage of ['memory', 'sqlite'] as const) describe('review protocol adoption CAS ' + storage, () => {
  const ledgerFor = () => storage === 'memory' ? new InMemoryLedger() : new SqliteStateLedger({ path: ':memory:' });
  it('rejects a Task computation if the previously absent protocol is adopted before its commit', async () => {
    const ledger = ledgerFor();
    const h = await reviewFixture(ledger, { reviewers: 1 });
    expect(await h.control.submitEvidence(h.submit({
      ...h.toolEvidence, evidenceId: 'legacy-pass', kind: 'verdict', coverage: h.coverage,
    }))).toMatchObject({ status: 'committed' });
    const commit = ledger.commit.bind(ledger);
    let adopted = false;
    ledger.commit = async batch => {
      if (!adopted && batch.commitKind === 'verification-result') {
        adopted = true;
        expect(batch.expectedVersions.some(v => v.ref.aggregateType === 'TaskReviewProtocol' && v.revision === 0)).toBe(true);
        expect(await h.ports.lifecycle.createWork(h.create)).toMatchObject({ status: 'accepted' });
      }
      return commit(batch);
    };
    expect(await h.control.reduceTask(buildReduceTaskCommand({
      ...cmd('racing-task'), ...scope, expectedRevision: 0,
    }))).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(adopted).toBe(true);
    expect(await ledger.load(taskReductionRefFor(scope.projectId, scope.goalId, scope.taskId))).toMatchObject({ status: 'not_found' });
    expect(await h.control.reduceTask(buildReduceTaskCommand({
      ...cmd('fresh-task'), ...scope, expectedRevision: 0,
    }))).toMatchObject({ status: 'committed', phase: 'blocked' });
    if ('close' in ledger) await ledger.close();
  });
  it('rejects an otherwise COMPLETED Goal computation when first adoption occurs immediately before commit', async () => {
    const ledger = ledgerFor();
    const h = await reviewFixture(ledger, { reviewers: 1, minimalGoal: true });
    expect(await h.control.submitEvidence(h.submit({
      ...h.toolEvidence, evidenceId: 'legacy-pass', kind: 'verdict', coverage: h.coverage,
    }))).toMatchObject({ status: 'committed' });
    expect(await h.control.submitEvidence(h.submit({
      ...h.toolEvidence, evidenceId: 'legacy-gate-pass', kind: 'verdict',
      subject: { projectId: scope.projectId, goalId: scope.goalId, taskId: 'gate-dispatch' },
      coverage: [{ obligationId: 'obl-gate', requirementId: 'vr-gate' }],
    }))).toMatchObject({ status: 'committed' });
    for (const taskId of [scope.taskId, 'gate-dispatch']) {
      expect(await h.control.reduceTask(buildReduceTaskCommand({
        ...cmd('legacy-reduce-' + taskId), ...scope, taskId, expectedRevision: 0,
      }))).toMatchObject({ status: 'committed', phase: 'satisfied' });
    }
    const commit = ledger.commit.bind(ledger);
    let adopted = false;
    ledger.commit = async batch => {
      if (!adopted && batch.commitKind === 'goal-reduction') {
        adopted = true;
        expect(batch.snapshots[0].phase).toBe('COMPLETED');
        expect(batch.expectedVersions.some(v => v.ref.aggregateType === 'TaskReviewProtocol' && v.revision === 0)).toBe(true);
        expect(await h.ports.lifecycle.createWork(h.create)).toMatchObject({ status: 'accepted' });
      }
      return commit(batch);
    };
    expect(await h.control.reduceGoal(buildReduceGoalCommand({
      ...cmd('racing-goal'), ...scope, expectedRevision: 0,
    }))).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
    expect(adopted).toBe(true);
    expect(await ledger.load(goalPhaseRefFor(scope.projectId, scope.goalId))).toMatchObject({ status: 'not_found' });
    const fresh = await h.control.reduceGoal(buildReduceGoalCommand({ ...cmd('fresh-goal'), ...scope, expectedRevision: 0 }));
    expect(fresh.status).toBe('committed');
    if (fresh.status === 'committed') expect(fresh.phase).not.toBe('COMPLETED');
    for (const read of [
      new ReadModelIndexImpl(new ControlPolicyExplanation()),
      new SqliteReadModelIndex({ path: ':memory:', policyExplanation: new ControlPolicyExplanation() }),
    ]) {
      let cursor: CommitCursor | null = null;
      for (;;) {
        const page: EventPage = await ledger.events({ afterCursor: cursor, limit: 64 });
        await read.advance(page);
        cursor = page.throughCursor;
        if (!page.hasMore) break;
      }
      const status = await read.goalStatus(scope);
      expect(status.status).toBe('ready');
      if (status.status === 'ready') expect(status.goal.phase).not.toBe('COMPLETED');
      if ('close' in read) await read.close();
    }
    if ('close' in ledger) await ledger.close();
  });
});
