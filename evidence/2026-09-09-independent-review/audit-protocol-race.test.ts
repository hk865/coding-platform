import { expect, it } from 'vitest';
import { InMemoryLedger } from '../../src/ledger/in-memory-ledger.js';
import { ReadModelIndexImpl } from '../../src/read-model/read-model-index.js';
import { ControlPolicyExplanation } from '../../src/control/policy-explanation.js';
import { buildReduceTaskCommand } from '../../src/contracts/commands/evidence.js';
import { buildReduceGoalCommand } from '../../src/contracts/commands/goal-phase.js';
import { DISPATCH_PLAN_REVISION_FIXTURE_V1 as draft } from '../../src/contracts/fixtures/dispatch-fixtures.js';
import { reviewFixture, scope, cmd } from '../../tests/control/reviewer-work-fixture.js';
import { loadLivePlan } from '../../src/control/dispatch-facts.js';

it('rejects the same Task reduction interleaving before writing satisfied state', async () => {
  const ledger = new InMemoryLedger(), h = await reviewFixture(ledger, { reviewers: 1 });
  expect(await h.control.submitEvidence(h.submit({ ...h.toolEvidence, evidenceId: 'legacy-review-pass', kind: 'verdict', coverage: h.coverage }))).toMatchObject({ status: 'committed' });
  const commit = ledger.commit.bind(ledger); let adopted = false;
  ledger.commit = async batch => {
    if (!adopted && batch.commitKind === 'verification-result') {
      adopted = true;
      expect(await h.ports.lifecycle.createWork(h.create)).toMatchObject({ status: 'accepted' });
      console.log('audit task commit expected refs', batch.expectedVersions.map(v => v.ref.aggregateType));
    }
    return commit(batch);
  };
  const receipt = await h.control.reduceTask(buildReduceTaskCommand({ ...cmd('race-task'), ...scope, expectedRevision: 0 }));
  console.log('audit task after protocol adoption', receipt);
  expect(adopted).toBe(true);
  expect(receipt).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  expect(await ledger.load({ aggregateType: 'TaskReduction', projectId: scope.projectId, goalId: scope.goalId, taskId: scope.taskId })).toMatchObject({ status: 'not_found' });
  expect(await h.control.reduceTask(buildReduceTaskCommand({ ...cmd('fresh-task'), ...scope, expectedRevision: 0 }))).toMatchObject({ status: 'committed', phase: 'blocked' });
  expect((await loadLivePlan(ledger, h.plan)).tasks.find(t => t.taskId === scope.taskId)?.phase).toBe('blocked');
});

it('rejects the same Goal completion interleaving and projects only the fresh noncompleted reduction', async () => {
  const saved = structuredClone(draft);
  const ledger = new InMemoryLedger();
  let h: Awaited<ReturnType<typeof reviewFixture>>;
  try {
    draft.tasks = draft.tasks.filter(t => [scope.taskId, 'gate-dispatch'].includes(t.taskId));
    draft.obligations = draft.obligations.filter(o => ['obl-run', 'obl-gate'].includes(o.obligationId));
    draft.taskHierarchy.parentOf = [{ parentTaskId: 'gate-dispatch', childTaskId: scope.taskId }];
    draft.executionDag.dependsOn = [];
    h = await reviewFixture(ledger, { reviewers: 1 });
  } finally { Object.assign(draft, saved); }
  expect(await h.control.submitEvidence(h.submit({ ...h.toolEvidence, evidenceId: 'legacy-review-pass', kind: 'verdict', coverage: h.coverage }))).toMatchObject({ status: 'committed' });
  expect(await h.control.submitEvidence(h.submit({ ...h.toolEvidence, evidenceId: 'legacy-gate-pass', kind: 'verdict', subject: { projectId: scope.projectId, goalId: scope.goalId, taskId: 'gate-dispatch' }, coverage: [{ obligationId: 'obl-gate', requirementId: 'vr-gate' }] }))).toMatchObject({ status: 'committed' });
  for (const taskId of [scope.taskId, 'gate-dispatch']) expect(await h.control.reduceTask(buildReduceTaskCommand({ ...cmd('reduce-' + taskId), ...scope, taskId, expectedRevision: 0 }))).toMatchObject({ status: 'committed', phase: 'satisfied' });
  const commit = ledger.commit.bind(ledger);
  let adopted = false;
  ledger.commit = async batch => {
    if (!adopted && batch.commitKind === 'goal-reduction') {
      adopted = true;
      expect(await h.ports.lifecycle.createWork(h.create)).toMatchObject({ status: 'accepted' });
      // Model has not run and the new protocol has no ReviewResult.
      console.log('audit goal commit expected refs', batch.expectedVersions.map(v => v.ref.aggregateType));
    }
    return commit(batch);
  };
  const receipt = await h.control.reduceGoal(buildReduceGoalCommand({ ...cmd('race-goal'), ...scope, expectedRevision: 0 }));
  console.log('audit goal after protocol adoption', receipt);
  expect(adopted).toBe(true);
  expect(receipt).toMatchObject({ status: 'rejected', code: 'revision_conflict' });
  expect(await ledger.load({ aggregateType: 'GoalPhase', projectId: scope.projectId, goalId: scope.goalId })).toMatchObject({ status: 'not_found' });
  const fresh = await h.control.reduceGoal(buildReduceGoalCommand({ ...cmd('fresh-goal'), ...scope, expectedRevision: 0 }));
  expect(fresh.status).toBe('committed');
  if (fresh.status === 'committed') expect(fresh.phase).not.toBe('COMPLETED');
  const read = new ReadModelIndexImpl(new ControlPolicyExplanation());
  let cursor = null as import('../../src/contracts/command-event.js').CommitCursor | null;
  for (;;) { const page = await ledger.events({ afterCursor: cursor, limit: 100 }); await read.advance(page); cursor = page.throughCursor; if (!page.hasMore) break; }
  const status = await read.goalStatus(scope);
  console.log('audit projected goal after protocol adoption', status);
  expect(status.status).toBe('ready');
  if (status.status === 'ready') expect(status.goal.phase).not.toBe('COMPLETED');
});
