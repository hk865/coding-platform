/**
 * The write executor's failure table, replay contract and retries.
 *
 * What this file builds and through which public calls: the test-local `Exchange@1` / `ExchangeCommitted` format
 * is registered through `open(kind, { schemas: exchangeSchemas })` on the real memory and SQLite backends; every
 * prior record is written by `executeWriteCommand` itself; only that public result, the store wrapper call counts
 * and the command's own read/decide/build call counts (A3, delegating unchanged) are asserted.
 */
import { afterEach, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { GoalRecordTransactionPort, StoreFailure } from '../../src/core/record-store/ports.js';
import { executeWriteCommand, type CommandRejection } from '../../src/core/work-graph/persistence/command-executor.js';
import { open } from '../helpers/S4B-text-search-support.js';
import {
  changeEvent, changeLookupReceipt, changeReceipt, committed, event, exchangeCommand, exchangeSchemas, fragment, keyOf, pin, script, seedCommand,
  type CommandOptions, type ExchangeCommand, type Point, type Step,
} from '../helpers/write-command-fixture.js';

const both = ['memory', 'sqlite'] as const;
const at = ['lookupCommit', 'commit', 'eventAt'] as const;
const temp: string[] = [];
afterEach(async () => { for (const dir of temp.splice(0)) await rm(dir, { recursive: true, force: true }); });
const openStore = async (kind: 'memory' | 'sqlite', path?: string) => {
  const opened = await open(kind, { schemas: exchangeSchemas, ...(path === undefined ? {} : { path }) });
  if (opened.dir !== undefined) temp.push(opened.dir);
  return opened;
};
const withStore = async (kind: 'memory' | 'sqlite', body: (records: GoalRecordTransactionPort) => Promise<void>) => {
  const { backend } = await openStore(kind);
  try { await body(backend.records); } finally { await backend.close(); }
};
// Hand-written expectations. The identity is the book's recipe for `exchangeCommand()`, its canonical JSON typed out.
const identity = `exchange.commit:${createHash('sha256').update('{"commandId":"c1","operation":"exchange.commit","principal":{"id":"test","kind":"system"},"projectId":"p1","schemaVersion":1,"workspaceId":null}').digest('hex')}`;
const ok = (replayed: boolean) => ({ status: 'committed', value: { id: 'x1', revision: 1, cursor: expect.any(String) }, replayed, cursor: expect.any(String) });
const no = (code: string, reason: string) => ({ status: 'rejected', code, reason });
const strict = (text: string) => no('unavailable', `strict replay: ${text}`);
const exhausted = (store: StoreFailure, current?: object) => ({ ...no('busy', 'the write did not settle after 3 retries'), ...(current === undefined ? {} : { current }), cause: { store } });
type Plain = Exclude<StoreFailure['code'], 'revision_conflict' | 'unique_conflict'>;
const failure = (code: Plain, reason = `the store said ${code}`): StoreFailure => ({ status: 'rejected', code, reason });
const revision = (current: { refKey: string; revision: number | null }[]): StoreFailure => ({ status: 'rejected', code: 'revision_conflict', reason: 'record version changed', current });
const unique = (current: { claimKey: string; owner: string | null }[]): StoreFailure => ({ status: 'rejected', code: 'unique_conflict', reason: 'unique claim owner changed', current });
const x1At2 = revision([{ refKey: keyOf('x1'), revision: 2 }]), slotTaken = unique([{ claimKey: 'slot', owner: 'other' }]);
const claim = (owner: string) => ({ claimKey: 'slot', expectedOwner: null, nextOwner: owner });
const slotSeed = (records: GoalRecordTransactionPort) => committed(records, seedCommand({ build: () => fragment({ claims: [claim('other')] }) }));
const slotBuild = () => fragment({ revision: 2, expected: 1, claims: [claim('mine')] });
const missed: Step = { fail: failure('not_found', 'forced miss') };
const thrown: Step = { throws: new Error('commit exploded') };
const U = { unknownCommit: true } as const;
type Counts = Partial<Record<Point | 'read' | 'decide' | 'build', number>>;
type RunRow = { command?: CommandOptions; seed?: boolean | ((records: GoalRecordTransactionPort) => Promise<unknown>); points?: Partial<Record<Point, readonly Step[]>> };
type Case = [string, RunRow, object, Counts?];
let calls = {} as Record<keyof Counts, () => number>;
async function run(row: RunRow): Promise<unknown> {
  let result: unknown;
  await withStore('memory', async (records) => {
    if (typeof row.seed === 'function') await row.seed(records); else if (row.seed === true) await committed(records, exchangeCommand());
    let port = records; const n = { read: 0, decide: 0, build: 0 }; const points: Partial<Record<Point, () => number>> = {};
    for (const point of at) { const wrapped = script(port, point, row.points?.[point]); points[point] = wrapped.calls; port = wrapped.records; }
    calls = { ...(points as Record<Point, () => number>), read: () => n.read, decide: () => n.decide, build: () => n.build };
    const command = exchangeCommand(row.command);
    const counted: ExchangeCommand = { ...command, read: () => { n.read += 1; return command.read(); },
      decide: (facts) => { n.decide += 1; return command.decide(facts); }, build: (decision, keys) => { n.build += 1; return command.build(decision, keys); } };
    result = await executeWriteCommand(port, counted);
  });
  return result;
}
async function check(row: RunRow, expected: object, counts: Counts = {}): Promise<void> {
  expect(await run(row)).toEqual(expected);
  expect(Object.fromEntries(Object.keys(counts).map((key) => [key, calls[key as keyof Counts]()]))).toEqual(counts);
}
const each = (title: string, cases: readonly Case[]) => it.each(cases)(title, (_name: string, row: RunRow, expected: object, counts?: Counts) => check(row, expected, counts));

// Storage rows: receipt replay, CAS, unique claims and the SQLite reopen.
const storage: Record<string, (records: GoalRecordTransactionPort) => Promise<void>> = {
  'fresh then replay': async (records) => {
    const command = exchangeCommand(); const first = await committed(records, command);
    expect(first).toEqual(ok(false)); expect(await executeWriteCommand(records, command)).toEqual({ ...first, replayed: true });
  },
  'another fingerprint': async (records) => {
    await committed(records, exchangeCommand());
    expect(await executeWriteCommand(records, exchangeCommand({ fingerprintInput: { id: 'other' } }))).toEqual(no('idempotency_conflict', `identity ${identity} was committed with a different fingerprint`));
  },
  'lost answer': async (records) => {
    const port = script(records, 'commit', [{ realThenThrows: new Error('lost') }]).records;
    expect(await executeWriteCommand(port, exchangeCommand())).toEqual(ok(true));
  },
  'cas conflict': async (records) => {
    await committed(records, seedCommand({ build: () => fragment({ revision: 2 }) }));
    expect(await executeWriteCommand(records, exchangeCommand({ build: () => fragment({ expected: 1 }) }))).toEqual({ ...no('revision_conflict', 'record version changed'), current: [pin('x1', 2)], cause: { store: x1At2 } });
  },
  'unique conflict': async (records) => {
    await slotSeed(records);
    expect(await executeWriteCommand(records, exchangeCommand({ build: slotBuild }))).toEqual({ ...no('busy', 'unique claim owner changed'), cause: { store: slotTaken } });
  },
};
it.each(both.flatMap((kind) => Object.keys(storage).map((name) => [kind, name] as const)))('storage %s: %s', async (kind, name) => { await withStore(kind, storage[name]!); });
it('sqlite reopen: a found receipt replays after close and reopen', async () => {
  const opened = await openStore('sqlite'); const first = await committed(opened.backend.records, exchangeCommand());
  await opened.backend.close(); const reopened = await openStore('sqlite', opened.path);
  try { expect(await executeWriteCommand(reopened.backend.records, exchangeCommand())).toEqual({ ...first, replayed: true }); } finally { await reopened.backend.close(); }
});

// The receipt lookup and every re-check classify a lookup the same way: conflict, or a plain unavailable with R.
const rechecks: readonly [string, Step, object][] = [
  ['conflict', { fail: failure('idempotency_conflict', 'another fingerprint') }, no('idempotency_conflict', 'another fingerprint')],
  ['invalid', { fail: failure('invalid', 'a damaged receipt') }, no('unavailable', 'a damaged receipt')],
  ['unavailable', { fail: failure('unavailable', 'the store is offline') }, no('unavailable', 'unavailable: the store is offline')],
  ['throw', { throws: new Error('lookup exploded') }, no('unavailable', 'the idempotency lookup failed: lookup exploded')],
];
each('lookup %s', rechecks.map(([name, step, expected]): Case => [name, { points: { lookupCommit: [step] } }, expected, { read: 0, commit: 0 }]));

// Read, decide, build and guard failures; nothing is committed.
each('read %s', [
  ['rejection', { command: { read: async () => ({ status: 'rejected', code: 'source_stale', reason: 'the source moved', current: [pin('x1', 3)] }) } }, { ...no('source_stale', 'the source moved'), current: [pin('x1', 3)] }, { decide: 0, commit: 0 }],
  ['throw', { command: { read: async () => { throw new Error('read exploded'); } } }, no('unavailable', 'the facts read failed: read exploded'), { decide: 0, commit: 0 }],
]);
const refusal = { refuse: { code: 'no-change', reason: 'the exchange is unchanged' } };
each('decide %s', [
  ['refusal missing', { command: { decide: () => refusal } }, { status: 'refused', refusal: refusal.refuse }, { lookupCommit: 2, build: 0, commit: 0 }],
  ['refusal found', { seed: true, points: { lookupCommit: [missed] }, command: { decide: () => refusal } }, ok(true), { build: 0, commit: 0 }],
  ...rechecks.map(([name, step, expected]): Case => [`re-check ${name}`, { command: { decide: () => refusal }, points: { lookupCommit: ['real', step] } }, expected, { build: 0, commit: 0 }]),
]);
const buildRejection: CommandRejection = { status: 'rejected', code: 'invalid', reason: 'the fragment was refused', current: [pin('x1', 4)], cause: { store: failure('corrupt', 'fragment source damaged') } };
each('build %s', [
  ['rejection', { command: { build: () => buildRejection } }, buildRejection, { commit: 0 }],
  ['throw', { command: { build: () => { throw new Error('build exploded'); } } }, no('unavailable', 'the commit fragment could not be prepared: build exploded'), { commit: 0 }],
  ['guards with an empty refKey', { command: { build: () => fragment({ guards: [{ refKey: '', expectedRevision: null }] }) } }, no('invalid', 'a record guard has an empty refKey'), { commit: 0 }],
  ['guards with two revisions of one refKey', { command: { build: () => fragment({ guards: [{ refKey: keyOf('x1'), expectedRevision: null }, { refKey: keyOf('x1'), expectedRevision: 2 }] }) } }, no('revision_conflict', `conflicting guards for ${keyOf('x1')}`), { commit: 0 }],
]);

// A decide exception and a malformed fragment are programming errors: thrown, nothing committed.
const throwsCases: readonly [string, CommandOptions, string][] = [
  ['decide', { decide: () => { throw new Error('decide exploded'); } }, 'decide exploded'],
  ['no event', { build: () => fragment({ events: [] }) }, 'the commit fragment has no event'],
  ['wrong type', { build: () => fragment({ events: [event('x1', { eventType: 'OtherCommitted' })] }) }, 'the last event type is not ExchangeCommitted'],
  ['wrong version', { build: () => fragment({ events: [event('x1', { schemaVersion: 2 })] }) }, 'the last event version is not 1'],
];
it.each(throwsCases)('%s throws before commit', async (_name, command, text) => {
  await expect(run({ command })).rejects.toEqual(new Error(text)); expect(calls.commit()).toBe(0);
});
each('pre-commit decode %s', [
  ['invalid', { command: { decode: () => ({ status: 'invalid', reason: 'the event body is damaged' }) } }, no('unavailable', 'the last event does not decode: the event body is damaged'), { commit: 0 }],
  ['throw', { command: { decode: () => { throw new Error('decoder exploded'); } } }, no('unavailable', 'the last event does not decode: decoder exploded'), { commit: 0 }],
]);

// A returned commit failure is re-checked first; only a missing receipt keeps the store failure (S), never retried.
const plain: readonly [Plain, string][] = [['invalid', 'invalid'], ['not_found', 'not_found'], ['idempotency_conflict', 'idempotency_conflict'], ['unsupported', 'unsupported'], ['corrupt', 'unavailable'], ['unavailable', 'unavailable']];
each('commit %s', [
  ...plain.map(([store, code]): Case => [store, { points: { commit: [{ fail: failure(store) }] } }, { ...no(code, `the store said ${store}`), cause: { store: failure(store) } }, { lookupCommit: 2, commit: 1 }]),
  ['re-check found before a retry', { points: { commit: [{ patch: () => x1At2 }] }, command: { retryable: { guard: () => true } } }, ok(true), { read: 1, commit: 1 }],
  ...rechecks.map(([name, step, expected]): Case => [`re-check ${name}`, { points: { commit: [{ fail: failure('invalid') }], lookupCommit: ['real', step] } }, expected, { commit: 1 }]),
]);
each('conflict %s', [
  ['every guard true', { points: { commit: [{ fail: x1At2 }] }, command: { retryable: { guard: () => true } } }, ok(false), { read: 2, decide: 2, build: 2, commit: 2 }],
  ['mixed current and false guard', { points: { commit: [{ fail: revision([{ refKey: keyOf('x1'), revision: 2 }, { refKey: 'not-json', revision: 3 }]) }] }, command: { retryable: { guard: (refKey) => refKey === keyOf('x1') } } }, { ...no('revision_conflict', 'record version changed'), current: [pin('x1', 2)], cause: { store: revision([{ refKey: keyOf('x1'), revision: 2 }, { refKey: 'not-json', revision: 3 }]) } }, { commit: 1 }],
  ['a current that projects to no pin', { points: { commit: [{ fail: revision([{ refKey: 'not-json', revision: 3 }, { refKey: keyOf('x1'), revision: null }]) }] } }, { ...no('revision_conflict', 'record version changed'), cause: { store: revision([{ refKey: 'not-json', revision: 3 }, { refKey: keyOf('x1'), revision: null }]) } }, { commit: 1 }],
  ['empty current, guards true', { points: { commit: [{ fail: revision([]) }] }, command: { retryable: { guard: () => true } } }, { ...no('revision_conflict', 'record version changed'), cause: { store: revision([]) } }, { commit: 1 }],
  ['empty current, horizon carried and opted in', { points: { commit: [{ fail: revision([]) }] }, command: { build: () => fragment({ ledgerHorizon: null }), retryable: { horizon: true } } }, ok(false), { read: 2, decide: 2, build: 2, commit: 2 }],
  ['empty current, horizon carried, not opted in', { points: { commit: [{ fail: revision([]) }] }, command: { build: () => fragment({ ledgerHorizon: null }), retryable: { guard: () => true } } }, { ...no('revision_conflict', 'record version changed'), cause: { store: revision([]) } }, { commit: 1 }],
  ['empty current, opted in, no horizon carried', { points: { commit: [{ fail: revision([]) }] }, command: { retryable: { horizon: true } } }, { ...no('revision_conflict', 'record version changed'), cause: { store: revision([]) } }, { commit: 1 }],
  ['every claim true', { points: { commit: [{ fail: slotTaken }] }, command: { build: () => fragment({ claims: [claim('mine')] }), retryable: { claim: () => true } } }, ok(false), { read: 2, decide: 2, build: 2, commit: 2 }],
  ['one claim true, one false', { points: { commit: [{ fail: unique([{ claimKey: 'slot', owner: 'other' }, { claimKey: 'slot-2', owner: 'other' }]) }] }, command: { build: () => fragment({ claims: [claim('mine')] }), retryable: { claim: (key) => key === 'slot' } } }, { ...no('busy', 'unique claim owner changed'), cause: { store: unique([{ claimKey: 'slot', owner: 'other' }, { claimKey: 'slot-2', owner: 'other' }]) } }, { commit: 1 }],
  ['a false claim', { points: { commit: [{ fail: slotTaken }] }, command: { build: () => fragment({ claims: [claim('mine')] }), retryable: { claim: () => false } } }, { ...no('busy', 'unique claim owner changed'), cause: { store: slotTaken } }, { commit: 1 }],
  ['an empty unique current', { points: { commit: [{ fail: unique([]) }] }, command: { build: () => fragment({ claims: [claim('mine')] }), retryable: { claim: () => true } } }, { ...no('busy', 'unique claim owner changed'), cause: { store: unique([]) } }, { commit: 1 }],
  ['four real revision conflicts', { seed: (records) => committed(records, seedCommand({ build: () => fragment({ revision: 2 }) })), command: { build: () => fragment({ expected: 1 }), retryable: { guard: () => true } } }, exhausted(x1At2, [pin('x1', 2)]), { read: 4, decide: 4, build: 4, commit: 4 }],
  ['four real unique conflicts', { seed: slotSeed, command: { build: slotBuild, retryable: { claim: () => true } } }, exhausted(slotTaken), { read: 4, decide: 4, build: 4, commit: 4 }],
  ['a revision conflict, then three real unique conflicts', { seed: slotSeed, points: { commit: [{ fail: x1At2 }] }, command: { build: slotBuild, retryable: { guard: () => true, claim: () => true } } }, exhausted(slotTaken, [pin('x1', 2)]), { read: 4, decide: 4, build: 4, commit: 4 }],
]);
// A thrown commit is an unknown outcome (U) unless the re-check finds it or conflicts; it is never retried.
each('commit throws with a %s re-check', [
  ['missing', { points: { commit: [thrown] } }, { ...no('unavailable', 'the commit outcome is unknown and the receipt was not found'), cause: U }, { lookupCommit: 2, commit: 1 }],
  ...rechecks.map(([name, step, expected]): Case => [name, { points: { commit: [thrown], lookupCommit: ['real', step] } }, name === 'conflict' ? expected : { ...expected, cause: U }, { commit: 1 }]),
]);

// Strict replay of a found or store-replayed receipt (eight checks, then eventAt), and the fresh receipt's checks.
each('strict replay %s', [
  ['store-replayed commit', { seed: true, points: { lookupCommit: [missed] } }, ok(true), { commit: 1, eventAt: 1 }],
  ['empty event ids', { seed: true, points: { lookupCommit: [changeLookupReceipt({ eventIds: [] })] } }, strict('the receipt has no event ids'), { eventAt: 0, commit: 0 }],
  ['identity mismatch', { seed: true, points: { lookupCommit: [changeLookupReceipt({ identityKey: 'someone-else' })] } }, strict('the receipt identity does not match'), { eventAt: 0, commit: 0 }],
  ['wrong event cursor', { seed: true, points: { eventAt: [changeEvent({}, 'other-cursor' as CommitCursor)] } }, strict('the event cursor does not match the receipt cursor'), { commit: 0 }],
  ['wrong event id', { seed: true, points: { eventAt: [changeEvent({ eventId: 'other-event' })] } }, strict("the event is not the receipt's last event"), { commit: 0 }],
  ['wrong event type', { seed: true, points: { eventAt: [changeEvent({ eventType: 'OtherCommitted' })] } }, strict('the event type is not ExchangeCommitted'), { commit: 0 }],
  ['wrong version', { seed: true, points: { eventAt: [changeEvent({ schemaVersion: 2 })] } }, strict('the event version is not 1'), { commit: 0 }],
  ['decode invalid', { seed: true, command: { decode: () => ({ status: 'invalid', reason: 'the event body is damaged' }) } }, strict('the event does not decode: the event body is damaged'), { commit: 0 }],
  ['decode throw', { seed: true, command: { decode: () => { throw new Error('decoder exploded'); } } }, strict('the event does not decode: decoder exploded'), { commit: 0 }],
  ['validate', { seed: true, command: { validate: () => 'the receipt is not proved' } }, strict('the result does not validate: the receipt is not proved'), { commit: 0 }],
  ['eventAt failure', { seed: true, points: { eventAt: [{ fail: failure('not_found', 'no event') }] } }, strict('the original event could not be read: not_found: no event'), { commit: 0 }],
  ['eventAt throw', { seed: true, points: { eventAt: [{ throws: new Error('event log unreadable') }] } }, strict('the original event could not be read: event log unreadable'), { commit: 0 }],
  ['fresh commit empty event ids', { points: { commit: [changeReceipt({ eventIds: [] })] } }, strict('the receipt has no event ids'), { commit: 1, eventAt: 0 }],
  ['fresh commit identity mismatch', { points: { commit: [changeReceipt({ identityKey: 'someone-else' })] } }, strict('the receipt identity does not match'), { commit: 1, eventAt: 0 }],
  ['fresh commit not the last event', { points: { commit: [changeReceipt({ eventIds: ['other-event'] })] } }, strict("the event is not the receipt's last event"), { commit: 1, eventAt: 0 }],
  ['fresh commit validate', { command: { validate: () => 'the receipt is not proved' } }, strict('the result does not validate: the receipt is not proved'), { commit: 1, eventAt: 0 }],
]);
it('copies the command metadata before the first await', async () => {
  await withStore('memory', async (records) => {
    await committed(records, exchangeCommand()); const replay = exchangeCommand();
    const pending = executeWriteCommand(records, replay);
    replay.operation = 'mutated'; replay.commandId = 'mutated'; replay.fingerprintInput = { id: 'mutated' }; replay.principal = { kind: 'system', id: 'mutated' }; replay.scope = { projectId: 'mutated', workspaceId: null };
    expect(await pending).toEqual(ok(true));
  });
});
