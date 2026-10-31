import { expect, it } from 'vitest';
import type { GoalCopyConfirmInputV1, GoalCopyConfirmResultV1, GoalCopyDraftResultV1 } from '../../src/contracts/goal-card.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan } from '../helpers/S6B1-fixture.js';
import { committed, openS7AWorkWorld, ready, runS7ASameSessionAgain } from '../helpers/S7A-fixture.js';
import { createCancelledS7A2Goal, sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { inboxOf } from '../helpers/S7B-F-support.js';
import { readS7BMessage } from '../helpers/S7B-fixture.js';

it('(copy-forward) the ticked interventions are forwarded once to the original line (memory)', async () => {
  const { world, line } = await openS7AWorkWorld({ backend: 'memory' });
  try {
    const main = s6aCardsWorkspace(world, S6A_SCOPE);
    const source = await createCancelledS7A2Goal(world);
    const a = await sendS7A2PersonMessage(world, { label: 's7b3-a', recipient: line.ref, goal: source.goal.ref });
    world.clock.advance(1000);
    const b = await sendS7A2PersonMessage(world, { label: 's7b3-b', recipient: line.ref, goal: source.goal.ref });
    await runS7ASameSessionAgain(world, line);
    const draft = ready<GoalCopyDraftResultV1>(await world.post('goals/copy-draft', plain(S6A_SCOPE, { goalRef: source.goal.ref })), 'the copy draft');
    expect((draft.interventions.available ? draft.interventions.candidates : []).map(candidate => candidate.messageRef)).toEqual([a.ref, b.ref]);
    const input: GoalCopyConfirmInputV1 = { commandId: 's7b3-copy-forward', sourceGoalRef: draft.source.goal,
      expectedSourceRevision: draft.source.revision, selectedInterventions: [a.ref, b.ref] };
    const born = committed<GoalCopyConfirmResultV1>(await world.post('goals/copy-confirm', plain(S6A_SCOPE, input)), 'the copy');
    await adoptS6BPlan(main, born.goal.ref, { label: 's7b3-copy', taskIds: ['s7b3-copy-1', 's7b3-copy-2'], role: S6A_WORK_ROLE.templateId });
    const select = { schemaVersion: 1 as const, goalRef: born.goal.ref, flowId: 's7b3-copy-forward-first', sessionHint: null, kind: 'select_work' as const };
    expect(await world.dispatch('workflow/advance', world.systemContext(), plain(S6A_SCOPE, select))).toMatchObject({ status: 'ready' });
    const before = await inboxOf(world, line.ref);
    const copies = [a, b].map(old => before.find(message => message.originalRef?.messageId === old.ref.messageId) ?? null);
    const pointers = [await readS7BMessage(world, a.ref), await readS7BMessage(world, b.ref)]
      .map(message => message.transferredTo);
    expect(await world.dispatch('workflow/advance', world.systemContext(),
      plain(S6A_SCOPE, { ...select, flowId: 's7b3-copy-forward-repeat' }))).toMatchObject({ status: 'ready' });
    const after = await inboxOf(world, line.ref);
    expect({
      forwarded: copies.map(copy => copy === null ? null : [copy.recipient, copy.goalRef, copy.taskRef, copy.originalRef]),
      pointers,
      same: after.map(message => message.ref),
      forwards: after.filter(message => message.originalRef !== null).length,
    }, 'S7B3-DEFERRED: the Workflow copy-forwarding seam is not wired (7B-3 G/L)').toEqual({
      forwarded: [[line.ref, born.goal.ref, null, a.ref], [line.ref, born.goal.ref, null, b.ref]],
      pointers: copies.map(copy => copy?.ref ?? null),
      same: before.map(message => message.ref),
      forwards: 2,
    });
  } finally {
    await world.close();
  }
});
