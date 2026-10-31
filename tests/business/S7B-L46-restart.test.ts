/**
 * G-L46-restart (book-7b.md:804, §5 :1230; P-21): the same choice after a same-directory restart. SQLite only
 * (tests/RULES.md:193-:195); a block is rebuilt from the Task/Run/card facts, never stored on the handle (the named
 * mutation stores it, empty after reopen, and the same A/C wait / B/D proceed assertions fail).
 */
import { afterEach, expect, it } from 'vitest';
import type { WorkflowAdvanceResult } from '../../src/business/workflow/contracts.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { ready } from '../helpers/S7A-fixture.js';
import {
  applyL46Card, openS7BL46World, readL46Card, selectedL46Task,
} from '../helpers/S7B-L46-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });
type AdvanceValue = Extract<WorkflowAdvanceResult, { status: 'ready' }>['value'];

it('a same-directory restart rebuilds the block: the same A/C wait, the same named-A source and card, B/D proceed',
  async () => {
    const { world, goalRef, tasks, run } = await openS7BL46World({ backend: 'sqlite' });
    worlds.push(world);
    const card = await readL46Card(world, goalRef);
    const before = ready<AdvanceValue>(await world.post('workflow/advance', plain(S6A_SCOPE, {
      schemaVersion: 1, goalRef, flowId: 'l46-restart-before-a', sessionHint: null, kind: 'select_work',
      taskId: tasks.A.taskId,
    })), 'the L46 advance l46-restart-before-a');
    expect(before).toMatchObject({ state: 'waiting', reason: 'automation_confirmation_required:system_requeue' });
    expect(before.decisionCause?.source.key).toBe(card.source.key);
    const source = before.decisionCause?.source;

    await world.crash();

    // The same named A gate: a rebuilt `automationConfirmation` from the same failure facts, not a stored block.
    const after = ready<AdvanceValue>(await world.post('workflow/advance', plain(S6A_SCOPE, {
      schemaVersion: 1, goalRef, flowId: 'l46-restart-after-a', sessionHint: null, kind: 'select_work',
      taskId: tasks.A.taskId,
    })), 'the L46 advance l46-restart-after-a');
    expect(after).toMatchObject({ state: 'waiting', receipt: null, next: null,
      reason: 'automation_confirmation_required:system_requeue' });
    expect(after.decisionCause?.source.key).toBe(before.decisionCause?.source.key);

    // The same card and the same dependent wait, with the block's own source.
    const reread = await readL46Card(world, goalRef);
    expect(reread).toMatchObject({ cardKey: card.cardKey, source: { key: card.source.key }, state: 'waiting_answer' });
    const c = ready<AdvanceValue>(await world.post('workflow/advance', plain(S6A_SCOPE, {
      schemaVersion: 1, goalRef, flowId: 'l46-restart-after-c', sessionHint: null, kind: 'select_work',
      taskId: tasks.C.taskId,
    })), 'the L46 advance l46-restart-after-c');
    expect(c).toMatchObject({ state: 'waiting', reason: 'l46_dependency_blocked: the Task s7b3-c waits on s7b3-a',
      source });

    // B and D still proceed: B is the goal-scope selection, D is not blocked by A.
    const b = ready<AdvanceValue>(await world.post('workflow/advance', plain(S6A_SCOPE, {
      schemaVersion: 1, goalRef, flowId: 'l46-restart-after-goal', sessionHint: null, kind: 'select_work',
    })), 'the L46 advance l46-restart-after-goal');
    expect(b.state).toBe('advance');
    expect(selectedL46Task(b.next)).toBe('s7b3-b');
    const d = ready<AdvanceValue>(await world.post('workflow/advance', plain(S6A_SCOPE, {
      schemaVersion: 1, goalRef, flowId: 'l46-restart-after-d', sessionHint: null, kind: 'select_work',
      taskId: tasks.D.taskId,
    })), 'the L46 advance l46-restart-after-d');
    expect(d.state).toBe('advance');
    expect(selectedL46Task(d.next)).toBe('s7b3-d');

    await applyL46Card(world, { goalRef, label: 'restart-applied', apply: { taskRef: tasks.A, run } });
    const applied = ready<AdvanceValue>(await world.post('workflow/advance', plain(S6A_SCOPE, {
      schemaVersion: 1, goalRef, flowId: 'l46-restart-applied-a', sessionHint: null, kind: 'select_work',
      taskId: tasks.A.taskId,
    })), 'the L46 advance l46-restart-applied-a');
    expect(applied.state).toBe('advance');
    expect(selectedL46Task(applied.next)).toBe('s7b3-a');
  }, 120_000);
