import { expect, it } from 'vitest';
import { unconfiguredRuntimeCapabilities } from '../../src/execution/worker-runtime/unconfigured-capabilities.js';
import type { ControlIntentV1 } from '../../src/contracts/control-intent.js';

it('declares no optional safe-point/continuation/handoff effects until real adapters are configured', async () => {
  const ports = unconfiguredRuntimeCapabilities(() => '2026-09-09T00:00:00.000Z');
  expect(ports.lifecycleControl.capabilities({ runRef: null })).toEqual({ safePointDelivery: false, pause: false, cancel: false, steer: false, maxSteerPayloadBytes: 0 });
  await expect(ports.lifecycleControl.apply({} as ControlIntentV1, null)).rejects.toThrow('no intent was applied');
  expect(await ports.handoffControl.control({ schemaVersion: 1, kind: 'pause', reason: 'test', correlationId: 'handoff', submittedAt: '2026-09-09T00:00:00.000Z' })).toMatchObject({ status: 'rejected', code: 'forbidden' });
  const runRef = { aggregateType: 'Run' as const, projectId: 'project', goalId: 'goal', runId: 'run' };
  expect(await ports.handoffControl.snapshot({ schemaVersion: 1, runRef })).toMatchObject({ status: 'unsupported' });
  const workContextRef = { aggregateType: 'WorkContextBinding' as const, projectId: 'project', workspaceId: 'workspace', workId: 'work' };
  expect(await ports.contextContinuation.capabilities({ workContextRef, runRef })).toEqual({ status: 'unsupported' });
  expect(await ports.contextContinuation.checkContinuation({ schemaVersion: 1, workContextRef, requestedByRunRef: runRef,
    originalRunRef: null, workspaceRevision: 1, planRevision: null })).toMatchObject({ observed: 'unsupported', requestedByRunRef: runRef, originalRunRef: null });
});
