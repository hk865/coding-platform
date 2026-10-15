/**
 * Slice 2C rows 2C-07 and 2C-19 (LE3; spec §5.2, L9, §2).
 *
 * Rows 2C-07 and the service-level half of 2C-19 run against the real
 * `WorkLineSettingsPort` (`configuration/line-settings-service.ts`) over a real
 * RecordStore on both backends. The assertions read the value the write returned
 * (or the code/reason of the refusal), never the record store, and every
 * expected code, count, order and `pinnedAt` is a literal hand-computed from the
 * spec's L9 table.
 *
 * The `lines/list` order assertions of 2C-19 use the real `WorkLineReadPort`
 * (group L's `views/work-line-reader.ts`); they are added in the second half of
 * this file once that reader is present.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { makeCommitCursor, type WorkspaceSnapshot } from '../../src/contracts/ledger.js';
import type { NoticePositionV1 } from '../../src/contracts/goal-decisions.js';
import type { SessionRef, VersionPin } from '../../src/contracts/core/identity.js';
import type { WriteResult } from '../../src/contracts/core/results.js';
import { createDecisionSettingsService } from '../../src/core/work-graph/configuration/decision-settings-service.js';
import { createNoticeDisplayToken } from '../../src/core/work-graph/views/notice-display-token.js';
import { createNoticePositionComparator } from '../../src/core/work-graph/views/notice-position.js';
import { acceptPin, createPlainSessions, openPinsFixture, pinRequest,
  type S2CPinsFixture } from '../helpers/S2C-P-pins-fixture.js';

const fixtures: S2CPinsFixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });
const open = async (kind: 'memory' | 'sqlite') => {
  const fixture = await openPinsFixture(kind);
  fixtures.push(fixture);
  return fixture;
};
const committed = (result: WriteResult<WorkspaceSnapshot>): WorkspaceSnapshot => {
  if (result.status !== 'committed') throw new Error(`expected committed, got ${JSON.stringify(result)}`);
  return result.value;
};
const rejected = (result: WriteResult<WorkspaceSnapshot>): { code: string; reason: string } => {
  if (result.status !== 'rejected') throw new Error(`expected a refusal, got ${JSON.stringify(result)}`);
  return { code: result.code, reason: result.reason };
};
const pinnedOf = (snapshot: WorkspaceSnapshot) => snapshot.lineSettings?.pinned ?? [];
const at = (clock: string) => clock;

/** A ready notice mark service plus a display token covering one member item. */
function noticeHarness(f: S2CPinsFixture, now: () => string) {
  const displayTokens = createNoticeDisplayToken(new Uint8Array(32));
  const service = createDecisionSettingsService({
    records: f.base.records, now, newId: () => 's2c-p-notice-id',
    displayTokens, positions: createNoticePositionComparator(), operatorActor: f.operator,
  });
  const position: NoticePositionV1 = { kind: 'commit', cursor: makeCommitCursor(1), itemKey: 'n1' };
  const displayToken = displayTokens.issue({
    schemaVersion: 1, workspace: f.scope, operator: f.operator, goalRef: null,
    categories: ['member_notice'], sourceCursor: makeCommitCursor(1), queryCursor: null,
    returnedKeys: ['n1'], seenThrough: { member_notice: position },
  });
  return {
    mark: (requestId: string, revision: number) => service.markNoticesSeen(f.operatorCtx, {
      input: { workspace: f.scope, displayToken, seenThrough: { member_notice: position } },
      meta: { requestId, expected: [f.workspacePin(revision)] as VersionPin[] },
    }),
  };
}

describe.each(['memory', 'sqlite'] as const)('S2C pins (%s)', kind => {
  it('2C-07 an agent identity adding a copy is forbidden and changes nothing', async () => {
    const f = await open(kind);
    const copy = await f.createCopySession('agent-copy');
    const plain = await f.createSession('agent-plain');
    const before = f.revision();
    expect(rejected(await f.pins.setLinePins(f.agentCtx,
      pinRequest(f, { add: [copy], remove: [], requestId: 'agent-copy-pin' }))))
      .toMatchObject({ code: 'forbidden' });
    // The refused request did not move the Workspace: a valid operator pin still
    // commits against the SAME tracked revision.
    const accepted = acceptPin(f, await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [plain], remove: [], requestId: 'operator-copy-pin' })));
    expect(accepted.revision).toBe(before + 1);
  });

  it('2C-07 a copy outranks capacity, and capacity outranks a stale version', async () => {
    const f = await open(kind);
    const sessions = await createPlainSessions(f, 100, 'cap');
    const copy = await f.createCopySession('cap-copy');
    const extra = await f.createSession('cap-extra');
    const base = f.revision();
    f.setClock(at('2026-10-14T00:00:00.000Z'));
    acceptPin(f, await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: sessions, remove: [], requestId: 'cap-fill' })));
    // 100 current plus the copy: final set 101, but the copy is invalid first.
    expect(rejected(await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [copy], remove: [], requestId: 'copy-over-cap' }))))
      .toMatchObject({ code: 'invalid' });
    // 100 current plus a valid addition with a stale Workspace version: capacity.
    expect(rejected(await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [extra], remove: [], requestId: 'cap-stale', revision: base }))))
      .toMatchObject({ code: 'capacity' });
    // Nothing changed: the third request is still capacity-free at the real version.
    expect(rejected(await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [extra], remove: [], requestId: 'cap-stale-2', revision: base }))))
      .toMatchObject({ code: 'capacity' });
  });

  it('2C-07 a stale version alone is revision_conflict', async () => {
    const f = await open(kind);
    const session = await f.createSession('stale-one');
    const before = f.revision();
    expect(rejected(await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [session], remove: [], requestId: 'stale-only', revision: before - 1 }))))
      .toMatchObject({ code: 'revision_conflict' });
    // The stale request changed nothing.
    const accepted = acceptPin(f, await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [session], remove: [], requestId: 'stale-recover' })));
    expect(accepted.revision).toBe(before + 1);
  });

  it('2C-07 a Session both added and removed, or repeated, is invalid', async () => {
    const f = await open(kind);
    const first = await f.createSession('overlap-first');
    const second = await f.createSession('overlap-second');
    const before = f.revision();
    expect(rejected(await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [first], remove: [first], requestId: 'overlap' }))))
      .toMatchObject({ code: 'invalid' });
    expect(rejected(await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [first, second, first], remove: [], requestId: 'duplicate-add' }))))
      .toMatchObject({ code: 'invalid' });
    const accepted = acceptPin(f, await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [first, second], remove: [], requestId: 'overlap-recover' })));
    expect(accepted.revision).toBe(before + 1);
    expect(pinnedOf(accepted).map(item => item.sessionRef.sessionId)).toEqual([first.sessionId, second.sessionId]);
  });

  it('2C-07 a no-change request is accepted, keeps version and pinnedAt, and replays', async () => {
    const f = await open(kind);
    const session = await f.createSession('nochange');
    const absent = await f.createSession('absent');
    const base = f.revision();
    f.setClock(at('2026-10-14T01:00:00.000Z'));
    const first = acceptPin(f, await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [session], remove: [], requestId: 'nochange-first' })));
    expect(first.revision).toBe(base + 1);
    expect(pinnedOf(first)).toEqual([{ sessionRef: session, pinnedAt: '2026-10-14T01:00:00.000Z' }]);

    // Add an already-pinned Session and remove one that is absent: no state change.
    const noChange = committed(await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [session], remove: [absent], requestId: 'nochange-second' })));
    expect(noChange.revision).toBe(base + 1);
    expect(pinnedOf(noChange)).toEqual([{ sessionRef: session, pinnedAt: '2026-10-14T01:00:00.000Z' }]);

    // The same requestId replays the original accepted value.
    const replay = await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [session], remove: [absent], requestId: 'nochange-second' }));
    if (replay.status !== 'committed') throw new Error(`expected replay, got ${JSON.stringify(replay)}`);
    expect(replay.replayed).toBe(true);
    expect(replay.value).toEqual(noChange);
    expect(f.revision()).toBe(base + 1);
  });

  it('2C-19 a missing Session and a copy are invalid, and change nothing', async () => {
    const f = await open(kind);
    const copy = await f.createCopySession('invalid-copy');
    const missing: SessionRef = { projectId: f.scope.projectId, sessionId: 's2c-p-missing-session' };
    const partner = await f.createSession('invalid-partner');
    const before = f.revision();
    expect(rejected(await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [missing], remove: [], requestId: 'missing-session' }))))
      .toMatchObject({ code: 'invalid' });
    expect(rejected(await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [copy], remove: [], requestId: 'copy-session' }))))
      .toMatchObject({ code: 'invalid' });
    const accepted = acceptPin(f, await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [partner], remove: [], requestId: 'invalid-recover' })));
    expect(accepted.revision).toBe(before + 1);
  });

  it('2C-19 the 101st pin is capacity; a full table removes one and adds one', async () => {
    const f = await open(kind);
    const sessions = await createPlainSessions(f, 100, 'full');
    const extra = await f.createSession('full-extra');
    f.setClock(at('2026-10-14T02:00:00.000Z'));
    const filled = acceptPin(f, await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: sessions, remove: [], requestId: 'full-fill' })));
    expect(pinnedOf(filled)).toHaveLength(100);
    const filledRevision = filled.revision;
    expect(rejected(await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [extra], remove: [], requestId: 'full-101' }))))
      .toMatchObject({ code: 'capacity' });

    // At 100, a single request removing one and adding one is accepted.
    f.setClock(at('2026-10-14T03:00:00.000Z'));
    const swapped = acceptPin(f, await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [extra], remove: [sessions[0]!], requestId: 'full-swap' })));
    expect(swapped.revision).toBe(filledRevision + 1);
    const pinned = pinnedOf(swapped);
    expect(pinned).toHaveLength(100);
    expect(pinned.some(item => item.sessionRef.sessionId === sessions[0]!.sessionId)).toBe(false);
    for (const session of sessions.slice(1)) {
      expect(pinned.find(item => item.sessionRef.sessionId === session.sessionId))
        .toEqual({ sessionRef: session, pinnedAt: '2026-10-14T02:00:00.000Z' });
    }
    expect(pinned.find(item => item.sessionRef.sessionId === extra.sessionId))
      .toEqual({ sessionRef: extra, pinnedAt: '2026-10-14T03:00:00.000Z' });
  });

  it('2C-19 a replay returns the original receipt across later writes', async () => {
    const f = await open(kind);
    const first = await f.createSession('replay-first');
    const second = await f.createSession('replay-second');
    let clock = '2026-10-14T04:00:00.000Z';
    const notices = noticeHarness(f, () => clock);
    f.setClock(clock);
    const pinned = acceptPin(f, await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [first], remove: [], requestId: 'replay-pin-1' })));
    clock = '2026-10-14T05:00:00.000Z';
    const notice = committed(await notices.mark('replay-notice', pinned.revision));
    expect(notice.decisionSettings?.noticeSeen).toBeDefined();
    expect(pinnedOf(notice)).toEqual([{ sessionRef: first, pinnedAt: '2026-10-14T04:00:00.000Z' }]);
    f.note(notice.revision);
    clock = '2026-10-14T06:00:00.000Z';
    f.setClock(clock);
    const later = acceptPin(f, await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [second], remove: [], requestId: 'replay-pin-2' })));
    expect(later.revision).toBe(notice.revision + 1);

    // The replayed mark returns the value written at the mark, not the current one.
    const replay = await notices.mark('replay-notice', pinned.revision);
    if (replay.status !== 'committed') throw new Error(`expected replay, got ${JSON.stringify(replay)}`);
    expect(replay.replayed).toBe(true);
    expect(replay.value).toEqual(notice);
    expect(pinnedOf(replay.value)).toEqual([{ sessionRef: first, pinnedAt: '2026-10-14T04:00:00.000Z' }]);
    expect(replay.value.decisionSettings?.noticeSeen).toEqual(notice.decisionSettings?.noticeSeen);
  });

  it('2C-19 a pin first and a notice mark after keep each field', async () => {
    const f = await open(kind);
    const session = await f.createSession('keep-pin-first-session');
    let clock = '2026-10-14T07:00:00.000Z';
    const notices = noticeHarness(f, () => clock);
    f.setClock(clock);
    const pinned = acceptPin(f, await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [session], remove: [], requestId: 'keep-pin-first' })));
    clock = '2026-10-14T08:00:00.000Z';
    const marked = committed(await notices.mark('keep-notice-after', pinned.revision));
    expect(pinnedOf(marked)).toEqual([{ sessionRef: session, pinnedAt: '2026-10-14T07:00:00.000Z' }]);
    expect(marked.decisionSettings?.noticeSeen).toBeDefined();
  });

  it('2C-19 a notice mark first and a pin after keep decisionSettings', async () => {
    const f = await open(kind);
    const session = await f.createSession('keep-mark-first-session');
    let clock = '2026-10-14T09:00:00.000Z';
    const notices = noticeHarness(f, () => clock);
    const marked = committed(await notices.mark('keep-notice-first', f.revision()));
    expect(marked.decisionSettings?.noticeSeen).toBeDefined();
    clock = '2026-10-14T10:00:00.000Z';
    f.setClock(clock);
    const afterPin = acceptPin(f, await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [session], remove: [], requestId: 'keep-pin-after', revision: marked.revision })));
    expect(afterPin.decisionSettings?.noticeSeen).toEqual(marked.decisionSettings?.noticeSeen);
    expect(pinnedOf(afterPin)).toEqual([{ sessionRef: session, pinnedAt: '2026-10-14T10:00:00.000Z' }]);
  });

  // ------------------------------------------------------------------------
  // The `lines/list` half of 2C-19 (group L's real WorkLineReadPort).
  // ------------------------------------------------------------------------

  const rows = async (f: S2CPinsFixture) => {
    const list = await f.reader.listWorkLines(f.operatorCtx, { workspace: f.scope });
    if (list.status !== 'ready') throw new Error(`lines/list failed: ${JSON.stringify(list)}`);
    return list.value.rows;
  };
  const rowFor = (list: readonly { key: SessionRef }[], ref: SessionRef) =>
    list.find(row => row.key.projectId === ref.projectId && row.key.sessionId === ref.sessionId);

  it('2C-19 a pinned line comes first in lines/list', async () => {
    const f = await open(kind);
    const pinnedSession = await f.createSession('list-pinned');
    const other = await f.createSession('list-other');
    f.setClock(at('2026-10-14T11:00:00.000Z'));
    acceptPin(f, await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [pinnedSession], remove: [], requestId: 'list-pin-first' })));

    const list = await rows(f);
    expect(pinnedSession.sessionId === list[0]!.key.sessionId).toBe(true);
    expect(list[0]).toMatchObject({ pinned: true, pinnedBy: [pinnedSession] });
    expect(rowFor(list, other)).toMatchObject({ pinned: false, pinnedBy: [] });
  });

  it('2C-19 a pinned line stays pinned after it is continued and the head changes', async () => {
    const f = await open(kind);
    const original = await f.createSession('continued-original');
    f.setClock(at('2026-10-14T12:00:00.000Z'));
    acceptPin(f, await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [original], remove: [], requestId: 'continued-pin' })));
    const successor = await f.createContinuation('continued-successor', original);

    const list = await rows(f);
    expect(rowFor(list, original)).toBeUndefined();
    expect(rowFor(list, successor)).toMatchObject({ pinned: true, pinnedBy: [original] });
  });

  it('2C-19 two forked lines sharing a pinned predecessor are both pinned, and both unpin', async () => {
    const f = await open(kind);
    const predecessor = await f.createSession('fork-predecessor');
    f.setClock(at('2026-10-14T13:00:00.000Z'));
    acceptPin(f, await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [predecessor], remove: [], requestId: 'fork-pin' })));
    const left = await f.createContinuation('fork-left', predecessor);
    const right = await f.createContinuation('fork-right', predecessor);

    const before = await rows(f);
    expect(rowFor(before, left)).toMatchObject({ pinned: true, pinnedBy: [predecessor] });
    expect(rowFor(before, right)).toMatchObject({ pinned: true, pinnedBy: [predecessor] });

    acceptPin(f, await f.pins.setLinePins(f.operatorCtx,
      pinRequest(f, { add: [], remove: [predecessor], requestId: 'fork-unpin' })));
    const after = await rows(f);
    expect(rowFor(after, left)).toMatchObject({ pinned: false, pinnedBy: [] });
    expect(rowFor(after, right)).toMatchObject({ pinned: false, pinnedBy: [] });
  });
});
