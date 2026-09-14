import type { DispatchDriveFailure, DispatchSideFactFailure } from '../../src/contracts/ports.js';
import { dispatchOutboxRefFor } from '../../src/contracts/dispatch.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
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
// ------------------------------------------------------------------------ //
// CM-1A-001 第 4 步 B（缺陷 A）：旁路事实失败不得改写已结束 Run 的终态    //
// ------------------------------------------------------------------------ //

const outboxRef = dispatchOutboxRefFor(scope.projectId, ref.goalId, 'task', 'attempt');

function driveScenario(runStatus: RunSnapshot['status'], failures: DispatchDriveFailure[], sideFactFailures?: DispatchSideFactFailure[]) {
  const snapshot = { ref, revision: 4, status: runStatus, lastEventSeq: 1, envelope: {} } as RunSnapshot;
  const record: PreparedRunFact = { status: 'completed', spec: { ...scope, goalId: ref.goalId, runId: ref.runId, taskId: 'task', root: '/workspace', instruction: 'work',
    budget: { contextWindowTokens: 100000, inputTokens: null, outputTokens: null, maxRequests: null, maxToolCalls: null, timeoutMs: null, perResponseTokens: 8192 } }, events: [] };
  const outbox = { ref: outboxRef, revision: 2, schemaVersion: 1, status: 'started', intent: { runRef: ref }, pendingAt: at, startedAt: at, doneAt: null };
  const load = vi.fn<StateLedger['load']>().mockImplementation(async target => (canonicalJson(target as never) === canonicalJson(outboxRef as never)
    ? { status: 'found', snapshot: outbox as never } : { status: 'found', snapshot }));
  const runFact = vi.fn<(command: RunFactCommand) => Promise<RunFactReceipt>>().mockImplementation(async command => ({
    status: 'committed', commandId: command.commandId, replayed: false, runRef: ref, runRevision: command.expectedRevision + 1,
    applied: { kind: 'outcome_unknown' }, terminal: true, eventIds: ['fact'], commitCursor: makeCommitCursor(1),
  }));
  const drive = vi.fn().mockResolvedValue({ scanned: 1, started: 1, completed: 1, pendingRemaining: 0, failures, ...(sideFactFailures === undefined ? {} : { sideFactFailures }) });
  const markUnknown = vi.fn().mockResolvedValue(undefined);
  const dispatch = new RuntimeDispatch({ ledger: { load }, control: { runFact }, outbox: { drive }, runtime: { all: () => [record], markUnknown }, now: () => at });
  return { dispatch, markUnknown, runFact };
}

it('派发失败不改写**已经结束**的 Run：既不 markUnknown 也不写 unknown 事实', async () => {
  const s = driveScenario('ended', [{ intentId: 'i', outboxRef, code: 'rejected', message: '证据未落账' }]);
  await s.dispatch.drive({ reason: 'ended-run', runRef: ref });
  expect(s.markUnknown).not.toHaveBeenCalled();
  expect(s.runFact).not.toHaveBeenCalled();
});

it('旁路事实失败（许可／证据）走独立出口：已结束的 Run 终态不变', async () => {
  const s = driveScenario('ended', [], [{ intentId: 'i', runId: ref.runId, code: 'evidence_not_recorded', message: '调用证据未落账' }]);
  await s.dispatch.drive({ reason: 'side-fact', runRef: ref });
  expect(s.markUnknown).not.toHaveBeenCalled();
  expect(s.runFact).not.toHaveBeenCalled();
});

it('未结束的 Run 仍按既有语义对账：markUnknown + outcome_unknown 事实', async () => {
  const s = driveScenario('running', [{ intentId: 'i', outboxRef, code: 'rejected', message: '派发失败' }]);
  await s.dispatch.drive({ reason: 'running-run', runRef: ref });
  expect(s.markUnknown).toHaveBeenCalledWith(ref);
  expect(s.runFact).toHaveBeenCalledTimes(1);
  expect(s.runFact.mock.calls[0]![0]).toMatchObject({ payload: { fact: { kind: 'outcome_unknown', runRef: ref } } });
});
