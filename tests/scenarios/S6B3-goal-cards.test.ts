/**
 * G-01 (acceptance, memory): a no-goal request's goal cards become Goals through the public routes. The single-owner
 * rows prove each rule (confirm rows 29, 30, 32 and 33, the pure tables); this scenario strings them into what the
 * person sees: two cards confirmed at once, the screening each card carries, and the history under the first Goal.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GoalConfirmDraftReceiptV1 } from '../../src/contracts/goal-card.js';
import type { GoalScreeningV1, QueryJobRef } from '../../src/contracts/query-job.js';
import type { RequestReadV1 } from '../../src/core/work-graph/views/main-surface-read-model.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_POLICY_CONTENT, s6aInitialCatalog } from '../helpers/S6A-memory-fixture.js';
import { activatePolicy } from '../helpers/S8B-catalog-steps.js';
import {
  callS6B3LateRoute, holdS6B3ConfirmGate, holdS6B3DraftAnswer, holdS6B3RequestAnswer, openS6B3World, postValue,
  releaseS6B3DraftAnswer, type S6B3World,
} from '../helpers/S6B3-fixture.js';

// Step 9's confirm gate is the commit barrier, so the file owns its two backend mocks.
vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

type Receipt = { status: 'committed'; value: GoalConfirmDraftReceiptV1 };

async function confirm(world: S6B3World, round: QueryJobRef, index: number): Promise<Receipt> {
  const reply = await callS6B3LateRoute(world, 'goals/confirm-draft', '6b3-w3',
    plain(world.mainScope, { commandId: `g01-${round.queryJobId}-${String(index)}`, round, index }));
  expect(reply).toMatchObject({ status: 'committed' });
  return reply as Receipt;
}

describe('G-01: a request\'s goal cards become Goals (memory)', () => {
  it('confirms two cards at once into two Goals with their screenings, and a semantic card keeps its screening too', async () => {
    const world = await openS6B3World({ backend: 'memory' });
    try {
      const scope = world.mainScope;
      const screening: GoalScreeningV1 = { modules: [{ projectId: scope.projectId, moduleId: 'g01-reader' }],
        size: 'unknown', conflictsWith: [], dependsOn: [], urgency: 'high', suggestedPosition: null, note: 'G-01 card' };
      const held = await holdS6B3DraftAnswer(world, { scope, label: 'g01', drafts: 2, screening });
      const answer = await releaseS6B3DraftAnswer(world, held);
      expect(answer.drafts.map(draft => [draft.index, draft.screening, draft.confirmedGoalRef]))
        .toEqual([[0, screening, null], [1, null, null]]);

      // Card 1 is confirmed while card 0's commit is held; card 0 then commits on the moved request tail.
      let second: Receipt | undefined;
      const gate = holdS6B3ConfirmGate(world, async () => { second = await confirm(world, held.round, 1); });
      const pending = confirm(world, held.round, 0);
      await gate;
      const first = (await pending).value;
      const later = (second as Receipt).value;
      expect([first.goal.revision, later.goal.revision]).toEqual([1, 1]);
      expect([first.binding.screening, later.binding.screening]).toEqual([screening, null]);
      const view = await postValue<RequestReadV1>(world, 'requests/read',
        plain(world.mainScope, { requestRoot: held.request.requestRoot }), 'ready', 'requests/read');
      expect(view.rounds.find(round => round.ref.queryJobId === held.round.queryJobId)?.goalCardDrafts
        .map(draft => draft.confirmedGoalRef)).toEqual([first.goal.ref, later.goal.ref]);
      expect(view.rounds.filter(round => round.kind === 'routing').map(round => round.ref))
        .toEqual([later.attributionRound, first.attributionRound]);
      expect(view.effectiveGoalId).toBe(first.goal.ref.goalId);
      // The pre-goal history shows under the Goal created first (card 1's), not under card 0's.
      const under = async (goalId: string) => (await postValue<{ requests: { requestRoot: QueryJobRef }[] }>(world,
        'main/read', plain(world.mainScope, { goalId, cursor: null }), 'ready', 'main/read')).requests.some(entry =>
        entry.requestRoot.queryJobId === held.request.requestRoot.queryJobId);
      expect([await under(later.goal.ref.goalId), await under(first.goal.ref.goalId)]).toEqual([true, false]);

      // With the governance installed, a no-goal request runs semantic_query; its screened card keeps the screening.
      const workspace = s6aCardsWorkspace(world.host, scope);
      const registration = await postValue<{ project: { revision: number }; workspace: { revision: number } }>(world,
        'workspaces/registration', plain(world.mainScope, scope), 'ready', 'workspaces/registration');
      expect(await workspace.post('architecture/adopt-initial', graphWrite(scope, { baselineId: 'g01-baseline',
        description: 'G-01 governance', constraints: [], catalog: s6aInitialCatalog(scope.projectId) }, 'g01-architecture', [
        { ref: { aggregateType: 'Project', projectId: scope.projectId }, revision: registration.project.revision },
        { ref: { aggregateType: 'Workspace', ...scope }, revision: registration.workspace.revision }])))
        .toMatchObject({ status: 'committed' });
      await world.host.settleDetached();
      await activatePolicy(world.host.platform, workspace.humanContext(), S6A_POLICY_CONTENT, 'g01-policy');
      const semantic = await holdS6B3RequestAnswer(world, { scope, label: 'g01-semantic', goalId: null,
        executionKind: 'semantic_query', reply: () => ({ kind: 'text', text: JSON.stringify({ schemaVersion: 1,
          body: 'G-01 semantic answer', ideas: [], goalCardDrafts: [{ objective: 'G-01 semantic card',
            completion: ['G-01 semantic criterion'], autonomy: 'every_step', screening }] }) }) });
      expect((await releaseS6B3DraftAnswer(world, semantic)).drafts.map(draft => draft.screening)).toEqual([screening]);
      expect((await confirm(world, semantic.round, 0)).value.binding.screening).toEqual(screening);
    } finally {
      await world.close();
    }
  });
});
