/** Independent acceptance of the real composition: graph locator -> raw Kernel page.
 * Fixture seeds real accepted facts; no successful service return is fabricated. */
import { join } from 'node:path';
import { expect, it } from 'vitest';
import * as kernel from '../../vendor/coding-agent/dist/public-api.js';
import { createTargetPlatform } from '../../src/composition/create-platform.js';
import { createTaskClaimFixture, CLAIM_FIXTURE_AT } from '../helpers/task-claim-fixture.js';

it('persists a Run interval and reads that exact original interval after a platform restart', async () => {
  const fixture = await createTaskClaimFixture('sqlite');
  const claimed = await fixture.service.claimTask(fixture.ctx, await fixture.buildRequest());
  expect(claimed.status).toBe('committed');
  if (claimed.status !== 'committed') throw Error('real claim failed');
  const session = await fixture.sessionsPort.readSession(fixture.ctx, claimed.value.sessionRef);
  if (session.status !== 'ready') throw Error('real Session missing');
  const mapping = session.value.record.kernel;
  if (!mapping) throw Error('mapped Kernel Session missing');
  const databasePath = join(fixture.directory, 'kernel.sqlite');
  const store = await kernel.SqliteStores.open(databasePath);
  const call = { signal: fixture.ctx.signal };
  const config = { modelConfigId: 'composition-history', limits: kernel.UNLIMITED_RUN_LIMITS,
    enabledToolSchemaDigest: 'a'.repeat(64), policyVersion: '1', sandboxProfileVersion: '1', baseConfigDigest: 'b'.repeat(64) };
  try {
    // A prior unrelated Turn precedes the target Turn in the same real Session.
    for (const suffix of ['previous', 'target']) {
      const runId = `kernel-${suffix}`, turnId = `turn-${suffix}`;
      const run = kernel.runSchema.parse({ schemaVersion: 1, runId,
        turn: { turnId, userMessage: { schemaVersion: 1, messageId: `message-${suffix}`, role: 'user', content: suffix } },
        createdAt: CLAIM_FIXTURE_AT });
      const meta = (sequence: number) => ({ schemaVersion: 1 as const, eventId: `${suffix}-${sequence}`, runId, turnId,
        sequence, occurredAt: CLAIM_FIXTURE_AT, elapsedMs: 0 });
      const drafts: kernel.SessionRecordDraft[] = [{ recordId: `${suffix}-turn`, schemaVersion: 1,
        recordedAt: CLAIM_FIXTURE_AT, recordType: 'turn.started', payload: { run, config,
          workspace: { identity: fixture.scope.workspaceId, revision: '1', reference: 'workspace://fixture' } } },
        ...[kernel.agentEventSchema.parse({ type: 'run.started', meta: meta(1), payload: {} }),
          kernel.agentEventSchema.parse({ type: 'run.cancelled', meta: meta(2), payload: { reason: 'caller_requested' } })]
          .map(event => ({ recordId: event.meta.eventId, schemaVersion: 1 as const,
            recordedAt: CLAIM_FIXTURE_AT, recordType: 'agent.event' as const, payload: { event } }))];
      const header = await store.get(mapping.kernelSessionId, call);
      await store.append(mapping.kernelSessionId, header.revision, drafts, call);
    }
  } finally { await store.close(); }
  await fixture.closeBackend();
  const options = { storage: { kind: 'sqlite' as const, directory: fixture.directory },
    workspace: { async resolveRoot() { return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'history needs no source mount' }; },
      async authorize() { return { status: 'rejected' as const, code: 'forbidden' as const, reason: 'no source grant' }; } },
    kernelStores: { entries: [{ adapterId: mapping.adapterId, storeKey: 'r4c-claim-kernel-store',
      workspace: fixture.scope, databasePath }] }, now: () => CLAIM_FIXTURE_AT };
  let platform = await createTargetPlatform(options);
  try {
    const missing = await platform.runtime.readTaskExecutionHistory(fixture.ctx,
      { runRef: claimed.value.runRef, afterCursor: null, limit: 2 });
    expect(missing).toMatchObject({ status: 'rejected', code: 'unsupported' });
    const execution = await platform.executions.readExecution(fixture.ctx, claimed.value.runRef);
    if (execution.status !== 'ready') throw Error('composed execution read failed');
    const request = { meta: { requestId: 'history-composed-once', expected: [
      { ref: claimed.value.runRef, revision: execution.value.run.revision }] }, input: {
      runRef: claimed.value.runRef, kernel: { ...mapping, runId: 'kernel-target', turnId: 'turn-target' },
      startPosition: 5, observedThroughPosition: 7, endPosition: 7 } };
    const pending = platform.executions.recordExecutionHistory(fixture.ctx, request);
    const closing = platform.close();
    expect(await pending).toMatchObject({ status: 'committed', replayed: false });
    await closing;
    expect(await platform.executions.recordExecutionHistory(fixture.ctx, request))
      .toMatchObject({ status: 'rejected', code: 'unavailable' });
    platform = await createTargetPlatform(options);
    expect(await platform.executions.recordExecutionHistory(fixture.ctx, request))
      .toMatchObject({ status: 'committed', replayed: true });
    const page = await platform.runtime.readTaskExecutionHistory(fixture.ctx,
      { runRef: claimed.value.runRef, afterCursor: null, limit: 2 });
    expect(page).toMatchObject({ status: 'ready', value: { scannedCount: 2, executionIdentity: { runId: 'kernel-target', turnId: 'turn-target' } } });
    if (page.status !== 'ready') throw Error('composed graph read failed');
    expect(page.value.items.map(item => item.source.position)).toEqual([5, 6]);
    expect(page.value.nextCursor).not.toBeNull();
    const pendingRead = platform.runtime.readTaskExecutionHistory(fixture.ctx,
      { runRef: claimed.value.runRef, afterCursor: page.value.nextCursor, limit: 2 });
    const closeReads = platform.close();
    const tail = await pendingRead;
    expect(tail).toMatchObject({ status: 'ready', value: { scannedCount: 1, nextCursor: null } });
    if (tail.status === 'ready') expect(tail.value.items.map(item => item.source.position)).toEqual([7]);
    await closeReads;
    expect(await platform.runtime.readTaskExecutionHistory(fixture.ctx,
      { runRef: claimed.value.runRef, afterCursor: null, limit: 2 }))
      .toMatchObject({ status: 'rejected', code: 'unavailable' });
  } finally { await platform.close(); await fixture.close(); }
});
