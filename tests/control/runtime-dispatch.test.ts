import { expect, it, vi } from 'vitest';
import { RuntimeDispatch } from '../../src/control/dispatch-engine/runtime-dispatch.js';
import type { RunFactCommand, RunFactReceipt, RunRef, RunSnapshot, RuntimeEventV1 } from '../../src/contracts/dispatch.js';
import type { StateLedger } from '../../src/contracts/ledger.js';
import type { PreparedRunFact } from '../../src/contracts/runtime-preparation.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';

const scope = { projectId: 'project', workspaceId: 'workspace' };
const ref: RunRef = { aggregateType: 'Run', projectId: scope.projectId, goalId: 'goal', runId: 'run' };
const at = '2026-09-09T00:00:00.000Z';
function scenario(status: PreparedRunFact['status'] = 'completed') {
  // Only these canonical fields are read by recovery. The complete shape and
  // admission remain covered by the SQLite application restart tests.
  const snapshot = { ref, revision: 4, status: 'running', lastEventSeq: 1, envelope: {} } as RunSnapshot;
  const event = (sequence: number): RuntimeEventV1 => ({ schemaVersion: 1, eventId: 'event-' + sequence, runRef: ref, sequence, occurredAt: at,
    eventType: 'run_completed', payload: { kind: 'completed', exitCode: 0 } });
  const record: PreparedRunFact = { status, spec: { ...scope, goalId: ref.goalId, runId: ref.runId, taskId: 'task', root: '/workspace', instruction: 'work',
    budget: { contextWindowTokens: 100000, inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null, perResponseTokens: 8192 } }, events: [event(1),event(2),event(3)] };
  const load = vi.fn<StateLedger['load']>().mockResolvedValue({ status: 'found', snapshot });
  const runFact = vi.fn<(command: RunFactCommand) => Promise<RunFactReceipt>>().mockImplementation(async command => ({
    status: 'committed', commandId: command.commandId, replayed: false, runRef: ref, runRevision: command.expectedRevision + 1,
    applied: { kind: 'outcome_unknown' }, terminal: true, eventIds: ['fact'], commitCursor: makeCommitCursor(1),
  }));
  const drive = vi.fn().mockResolvedValue({ scanned: 0, started: 0, completed: 0, pendingRemaining: 0, failures: [] });
  const markUnknown = vi.fn().mockResolvedValue(undefined);
  const dispatch = new RuntimeDispatch({ ledger: { load }, control: { runFact }, outbox: { drive }, runtime: { all: () => [record], markUnknown }, now: () => at });
  return { dispatch, snapshot, record, runFact, load, drive, markUnknown };
}

it('recovery filters exact project/workspace and never dispatches external work', async () => {
  const s = scenario('prepared');
  expect(await s.dispatch.recover([{ ...scope, workspaceId: 'other' }])).toEqual({ recorded: 0, rejected: [] });
  expect(s.load).not.toHaveBeenCalled();
  expect(await s.dispatch.recover([scope])).toEqual({ recorded: 1, rejected: [] });
  expect(s.runFact.mock.calls[0]![0]).toMatchObject({ expectedRevision: 4, payload: { fact: { kind: 'outcome_unknown', runRef: ref } } });
  expect(s.drive).not.toHaveBeenCalled();
});

it('stops recovery on a rejected canonical fact without skipping to a later sequence', async () => {
  const s = scenario();
  s.runFact.mockImplementation(async command => ({ status: 'rejected', commandId: command.commandId, code: 'revision_conflict' }));
  expect(await s.dispatch.recover([scope])).toMatchObject({ recorded: 0, rejected: [{ runRef: ref, receipt: { status: 'rejected' } }] });
  expect(s.runFact).toHaveBeenCalledTimes(1);
  expect(s.runFact.mock.calls[0]![0]).toMatchObject({ expectedRevision: 4, payload: { fact: { event: { sequence: 2 } } } });
  expect(s.drive).not.toHaveBeenCalled();
});

it('leaves canonical ended runs intact and stops after an accepted terminal event', async () => {
  const s = scenario();
  expect(await s.dispatch.recover([scope])).toEqual({ recorded: 1, rejected: [] });
  expect(s.runFact).toHaveBeenCalledTimes(1);
  s.snapshot.status = 'ended';
  expect(await s.dispatch.recover([scope])).toEqual({ recorded: 0, rejected: [] });
  expect(s.runFact).toHaveBeenCalledTimes(1);
});

it('serializes outbox drives and still allows the next request after a failure', async () => {
  const s = scenario();
  let release!: () => void;
  s.drive.mockImplementationOnce(() => new Promise((_, reject) => { release = () => reject(Error('offline')); }));
  const first = s.dispatch.drive({ reason: 'first', runRef: ref });
  const observed = expect(first).rejects.toThrow('offline');
  const second = s.dispatch.drive({ reason: 'second', runRef: ref });
  await Promise.resolve();
  expect(s.drive).toHaveBeenCalledTimes(1);
  release(); await observed; await second;
  expect(s.drive).toHaveBeenCalledTimes(2);
});
