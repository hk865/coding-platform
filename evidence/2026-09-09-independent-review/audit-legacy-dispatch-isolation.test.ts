import { expect, it } from 'vitest';
import { InMemoryLedger } from '../../src/ledger/in-memory-ledger.js';
import { HandoffDriveEngineImpl } from '../../src/control/handoff-drive.js';
import { WorkspaceDriveEngineImpl } from '../../src/control/workspace-drive.js';
import { reviewFixture, scope, at } from '../../tests/control/reviewer-work-fixture.js';

it('keeps Reviewer Work out of both legacy handoff and parallel dispatch, including their pending counts', async () => {
  const ledger = new InMemoryLedger(), h = await reviewFixture(ledger, { reviewers: 1 });
  expect(await h.ports.lifecycle.createWork(h.create)).toMatchObject({ status: 'accepted' });
  const original = await ledger.pendingDispatchIntents(1);
  expect(original[0]!.intent.work?.kind).toBe('review');
  const calls: string[] = [];
  const runtime = { capabilities: async () => ({ replayable: false, supportsSnapshot: false, maxEnvelopeBytes: 65536 }), start: async () => { calls.push('runtime'); throw Error('Reviewer cannot execute through legacy dispatch'); } };
  const handoff = new HandoffDriveEngineImpl({ ledger, control: h.control, runtime, handoffContext: { assemble: async () => { calls.push('handoff-context'); return { status: 'needs_material', gaps: [] }; } }, now: () => at });
  const parallel = new WorkspaceDriveEngineImpl({ ledger, control: h.control, runtime, contextCompiler: { assemble: async () => { calls.push('ordinary-context'); return { status: 'needs_material', gaps: [] }; } }, now: () => at });
  const actual = { handoff: await handoff.driveHandoff({ reason: 'audit', maxIntents: 1 }), parallel: await parallel.driveParallel({ schemaVersion: 1, ...scope, reason: 'audit', maxIntents: 1 } as never), calls };
  console.log('audit legacy dispatch isolation', actual);
  expect(actual).toMatchObject({ handoff: { scanned: 0, started: 0, pendingRemaining: 0, failures: [] }, parallel: { scanned: 0, started: 0, pendingRemaining: 0, failures: [] }, calls: [] });
  expect(await ledger.pendingDispatchIntents(1)).toEqual(original);
});
