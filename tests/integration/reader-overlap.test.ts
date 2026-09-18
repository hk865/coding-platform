import { expect, it, vi } from 'vitest';
import { ExecutionSlots } from '../../src/control/dispatch-engine/execution/execution-slots.js';
import type { DispatchIntentV1 } from '../../src/contracts/dispatch.js';
import { ROLE_BINDING_FIXTURE_V1, BUDGET_FIXTURE_V1 } from '../../src/fixtures/dispatch-fixtures.js';
import { waitForReaderOverlap } from './reader-overlap.js';

function latch() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
it('proves two readers overlap after a coordinator releases a shared default slot, without imposing a 20s admission promise', async () => {
  vi.useFakeTimers();
  const slots = new ExecutionSlots(), coordinator = latch(), enteredA = latch(), overlap = latch();
  const errors: string[] = [], entering: string[] = [];
  const intent = (id: string): DispatchIntentV1 => ({ schemaVersion: 1, intentId: id, projectId: 'p', workspaceId: 'w', goalId: 'g', taskId: id,
    planRef: { aggregateType: 'PlanRevision', projectId: 'p', planId: 'plan' },
    attemptRef: { aggregateType: 'TaskAttempt', projectId: 'p', goalId: 'g', taskId: id, attemptId: id },
    runRef: { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: id }, roleBinding: ROLE_BINDING_FIXTURE_V1,
    workspaceSnapshot: { workspaceId: 'w', revision: 1 }, declaredPermissions: { tools: ['read'], writeScope: [] },
    budget: BUDGET_FIXTURE_V1, requestedAt: '2026-09-16T00:00:00.000Z', correlationId: id });
  const c = slots.run(intent('coordinator'), () => coordinator.promise);
  const reader = (id: string) => slots.run(intent(id), async () => {
    entering.push(id); if (id === 'a') enteredA.release(); if (entering.length === 2) overlap.release();
    try { await waitForReaderOverlap(overlap.promise); } catch (error) { errors.push(String(error)); }
  });
  const a = reader('a'), b = reader('b');
  try {
    await enteredA.promise;
    await vi.advanceTimersByTimeAsync(23000);
    expect(errors).toEqual([]);
    expect(entering).toEqual(['a']);
    coordinator.release();
    await Promise.all([c, a, b]);
    expect(entering).toEqual(['a', 'b']);
    expect(errors).toEqual([]);
  } finally { coordinator.release(); overlap.release(); await Promise.allSettled([c, a, b]); vi.useRealTimers(); }
});

it('does not count cancellation or an absent second reader as successful overlap', async () => {
  const controller = new AbortController();
  const pending = waitForReaderOverlap(new Promise<void>(() => {}), controller.signal);
  const rejected = expect(pending).rejects.toThrow('cancelled before both providers entered');
  controller.abort(); await rejected;
  await expect(waitForReaderOverlap(Promise.resolve(), controller.signal)).rejects.toThrow('cancelled');
});
