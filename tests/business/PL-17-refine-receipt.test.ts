/**
 * PL-17 (receipt): once the refinement round is committed, the next selection
 * sees the same gap and must wait on the complete merge basis instead of
 * selecting the same `send_system_round` again (book-pl-frozen `:808`; the
 * already-committed receipt is skipped without a self-wake guard).
 */
import { afterEach, expect, it } from 'vitest';
import { advanceUntil } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { checkConfiguration, ready, sessionOf } from '../helpers/S7A-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { readBody } from '../helpers/IV-host-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { createPLAdviserLine } from '../helpers/PL-consumption-fixture.js';
import {
  adoptPLTwoStageSkeleton, holdPLTaskRequest, openPLWorkflowWorld, satisfyPLTask, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

type Advance = {
  state: string;
  receipt: unknown;
  next: { kind: string; operation?: { kind: string } } | null;
  waitBasis?: { reasons: string[]; recordKinds: string[] };
};

it('PL-17: a committed refine receipt waits instead of selecting the same send', async () => {
  const workflow = opened = await openPLWorkflowWorld({ label: 'pl-17-receipt',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  const skeleton = await adoptPLTwoStageSkeleton(workflow.main, workflow.goal, {
    label: 'pl-17-receipt', stageOneTaskIds: ['pl-a', 'pl-b'],
  });
  const line = await sessionOf(workflow.world, await createS6BLine(workflow.main, {
    label: 'pl-17-receipt-line', role: S6A_WORK_ROLE,
    tasks: skeleton.tasks.filter(task => ['pl-a', 'pl-b'].includes(task.taskId)),
  }));
  const adviser = await createPLAdviserLine(workflow.world, 'pl-17-receipt-adviser');
  await satisfyPLTask(workflow.world, workflow.goal, 'pl-a', line, 'pl17r');
  const held = await holdPLTaskRequest(workflow.world, workflow.goal, 'pl-b', line, 'pl17r');
  try {
    // The first pass selects the one refinement send; performing it commits the round.
    const send = await advanceUntil(workflow.world.ag2b, { schemaVersion: 1, goalRef: workflow.goal,
      flowId: 'pl-17-receipt-refine', sessionHint: null, kind: 'select_work' }, 'send_system_round');
    if (send.kind !== 'perform' || send.operation.kind !== 'send_system_round') {
      throw new Error(`PL-17 receipt: the selection did not reach the refine send: ${JSON.stringify(send)}`);
    }
    const sent = ready<Advance>(await workflow.world.post('workflow/advance', plain(S6A_SCOPE, send)),
      'the refine send');
    expect(sent.receipt, JSON.stringify(sent)).toBeDefined();
    const next = sent.next;
    expect(next?.kind).toBe('select_work');
    if (next === null) throw new Error('PL-17 receipt: the committed send selected no follow-up');

    // The next selection sees the same gap and the committed receipt: it waits.
    const after = ready<Advance>(await workflow.world.post('workflow/advance', plain(S6A_SCOPE, next)),
      'the selection after the refine');
    expect(after.state, JSON.stringify(after)).toBe('waiting');
    expect(after.next).toBeNull();
    expect(after.waitBasis?.reasons).toContain('plan_only:pl-stage-2');
    expect(after.waitBasis?.recordKinds).toContain('SessionMessage');

    // The committed round is not sent a second time.
    const rounds = (await listed(workflow.world, 'inbox', adviser)).filter(message =>
      message.sender.kind === 'host' && message.sender.actor.kind === 'system');
    const texts = await Promise.all(rounds.map(async message =>
      (await readBody(workflow.world, message.ref, 'message')).split('\n')[0] ?? ''));
    expect(texts.filter(text => text.startsWith(`refine:${workflow.goal.goalId}:pl-stage-2:`)))
      .toHaveLength(1);
  } finally {
    await held.release();
  }
});
