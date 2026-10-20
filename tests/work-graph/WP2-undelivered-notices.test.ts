/**
 * Wiring package 2 §5.2 M04–M11 (entry E4, module source) and the module-side
 * F09–F12 rows. Every read goes through the public `DecisionNoticeSourcePort`
 * (or the real queue); no database or record-store side channel is inspected.
 * Upstream substitutes are used only to inject a failure/empty-page shape.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { SourceRefV1 } from '../../src/contracts/dispatch.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import type { SessionMailboxPort, SessionMessage, UndeliveredReplyV1 } from '../../src/core/work-graph/model/communication-contracts.js';
import type { NoticeItemV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import type { SessionDirectoryPort, SessionPageRequest } from '../../src/core/work-graph/model/session-contracts.js';
import { encodeSessionMessageRecord, sessionMessageRefKey } from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { encodeSessionRecord, sessionAggregateRefKey, SESSION_BY_WORKSPACE_LOOKUP } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createUndeliveredReplyNoticeSource } from '../../src/core/work-graph/views/undelivered-reply-notices.js';
import {
  openWP2NoticesFixture, ready, type NoticeSourceFactory, type WP2NoticesFixture,
} from '../helpers/WP2-notices-fixture.js';

type NoticeDeps = {
  records: Parameters<typeof createUndeliveredReplyNoticeSource>[0]['records'];
  sessions: Pick<SessionDirectoryPort, 'findSessions'>;
  messages: Pick<SessionMailboxPort, 'readUndeliveredReplies' | 'readMessage'>;
};

const factory: NoticeSourceFactory = (deps) => createUndeliveredReplyNoticeSource(deps);
const opened: WP2NoticesFixture[] = [];
afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });

async function open(kind: 'memory' | 'sqlite' = 'memory', source: NoticeSourceFactory = factory) {
  const f = await openWP2NoticesFixture(kind, source);
  opened.push(f);
  return f;
}

/** Enter S, send a wait inquiry to D, yield and let D enter. */
async function waitingLine(f: WP2NoticesFixture) {
  await f.f.enter();
  const message = await f.send();
  await f.f.yieldWait(message);
  await f.f.enter(f.f.b2.secondClaim);
  return message;
}

/** A real already-unavailable source with a saved reply (spec F09 "先 R 后 P"). */
async function unavailableWithReply(f: WP2NoticesFixture) {
  const message = await waitingLine(f);
  await f.f.retire();
  const replied = await f.f.respond(message);
  return { message, replied };
}

function withMessages(deps: NoticeDeps, messages: NoticeDeps['messages']) {
  return createUndeliveredReplyNoticeSource({ ...deps, messages });
}

/**
 * The frozen `WP2-notices-fixture.ts` `query()` puts its manifest and answer
 * bodies with `sourceRefs: []`, which the record-store body codec refuses
 * (`put sourceRefs must be a non-empty array`). This test-side boundary shim
 * substitutes the workspace source so the real Query-recovery owners can run;
 * it changes no production behavior.
 */
function acceptEmptySourceRefs(f: WP2NoticesFixture, source: SourceRefV1): void {
  const store = f.f.b2.bodies as unknown as { put(input: Record<string, unknown>): Promise<unknown> };
  const original = store.put.bind(store);
  store.put = (input) => original({ ...input,
    sourceRefs: Array.isArray(input['sourceRefs']) && input['sourceRefs'].length > 0
      ? input['sourceRefs'] : [source] });
}

function firstPage(page: SessionPageRequest): SessionPageRequest {
  return { limit: page.limit, ...(page.atLeastCursor === undefined ? {} : { atLeastCursor: page.atLeastCursor }) };
}

/**
 * §5.2/§5.3.3: the independent commit observation. The fixture's own commit
 * observer records every committed batch with the real last-event cursor, so a
 * position expected value comes from the log, never from the record under test.
 */
function observedCursor(f: WP2NoticesFixture, from: number, label: string): CommitCursor {
  const added = f.f.batches.slice(from);
  expect(added, label).toHaveLength(1);
  return added[0]!.cursor as CommitCursor;
}

/** The current ledger horizon as the last observed committed batch cursor. */
function observedWindow(f: WP2NoticesFixture): CommitCursor {
  const last = f.f.batches.at(-1);
  if (last === undefined) throw new Error('the fixture observed no committed batch');
  return last.cursor as CommitCursor;
}

/** A hand-written spec continuation envelope, never built with product code. */
function rawSourceCursor(workspace: { projectId: string; workspaceId: string }, last: unknown): string {
  return Buffer.from(JSON.stringify({ v: 1, workspace, goalRef: null, after: null, last }), 'utf8').toString('base64url');
}

/**
 * The pre-package flat continuation shape (top-level `projectId`/`workspaceId`).
 * The current decoder REJECTS it: `decodeSourceCursor` requires the exact spec
 * key set `{v, workspace, goalRef, after, last}`. The malformed/zero cases built
 * with `rawSourceCursor` below exercise the commit-position probe instead.
 */
function legacySourceCursor(workspace: { projectId: string; workspaceId: string }, last: unknown): string {
  return Buffer.from(JSON.stringify({ v: 1, projectId: workspace.projectId, workspaceId: workspace.workspaceId,
    goalRef: null, after: null, last }), 'utf8').toString('base64url');
}

describe('WP2 undelivered-reply notices', () => {
  it('F09 a reply saved after the Session became unavailable appears once', async () => {
    const f = await open();
    const { replied } = await unavailableWithReply(f);
    const page = (await f.page());
    expect(page.notices).toHaveLength(1);
    expect(page.notices[0]!.category).toBe('undelivered_reply');
    expect(page.notices[0]!.summary).toBe(`未送达回复 · Session ${f.f.S.sessionId}`);
    const position = page.notices[0]!.position;
    expect(position.kind).toBe('commit');
    if (position.kind !== 'commit') throw new Error('expected a commit position');
    // R (retire) is before P (reply), so max(R,P) is the reply command's cursor.
    expect(String(position.cursor)).toBe(String(replied.cursor));
  });

  it('F09 a derived Query Answer on an already-unavailable Session still becomes a notice at its reply position', async () => {
    const f = await open();
    acceptEmptySourceRefs(f, { kind: 'workspace', refId: f.scope.workspaceId, revision: '1' });
    const target = await f.f.continuation();
    await f.f.enter();
    const message = await f.f.send(f.f.b2.claim, target);
    await f.f.yieldWait(message);
    await f.f.retire(); // R first
    const q = await f.query(target, message);
    const answered = await q.answer(); // P later, response sender is derived query_run
    if (answered.result.status !== 'committed') throw new Error(JSON.stringify(answered.result));
    const page = (await f.page());
    expect(page.notices).toHaveLength(1);
    const position = page.notices[0]!.position;
    expect(position.kind).toBe('commit');
    if (position.kind !== 'commit') throw new Error('expected a commit position');
    // R (retire) is before P (answer), so max(R,P) is the reply command's cursor.
    expect(String(position.cursor)).toBe(String(answered.result.cursor));
  });

  it('F10 a reply saved before the Session became unavailable becomes unseen when it later does', async () => {
    const f = await open();
    const message = await waitingLine(f);
    const replied = await f.f.respond(message); // P first
    expect((await f.page()).notices).toEqual([]);
    const beforeRetire = f.f.batches.length;
    await f.health('missing'); // R later
    const retiredAt = observedCursor(f, beforeRetire, 'the health commit');
    const after = (await f.page());
    expect(after.notices).toHaveLength(1);
    const position = after.notices[0]!.position;
    expect(position.kind).toBe('commit');
    if (position.kind !== 'commit') throw new Error('expected a commit position');
    // The later position is the health commit's own cursor, observed on the
    // commit log, never read back from the returned Session record.
    expect(String(position.cursor)).toBe(String(retiredAt));
    expect(String(position.cursor)).not.toBe(String(replied.cursor));
  });

  it('F12 SES-13 recovery removes the notice and a later re-entry produces a new unseen one', async () => {
    const f = await open();
    const message = await waitingLine(f);
    const beforeFirst = f.f.batches.length;
    await f.health('missing');
    const firstEntryAt = observedCursor(f, beforeFirst, 'the first entry commit');
    const replied = await f.f.respond(message);
    const first = (await f.page()).notices[0]!;
    await f.mark(await f.page());
    expect((await f.page()).notices).toEqual([]);
    await f.health('ready'); // SES-13 recovery
    expect((await f.page()).notices).toEqual([]);
    const beforeSecond = f.f.batches.length;
    await f.health('missing'); // re-entry writes a new R
    const secondEntryAt = observedCursor(f, beforeSecond, 'the second entry commit');
    const again = (await f.page()).notices;
    expect(again).toHaveLength(1);
    const firstCursor = first.position.kind === 'commit' ? String(first.position.cursor) : '';
    const newCursor = again[0]!.position.kind === 'commit' ? String(again[0]!.position.cursor) : '';
    // Before recovery max(R1,P)=P; after re-entry the new position is the second
    // entry's health-commit cursor, observed on the commit log.
    expect(firstCursor).toBe(String(replied.cursor));
    expect(newCursor).toBe(String(secondEntryAt));
    expect(newCursor).not.toBe(String(firstEntryAt));
  });

  it('M04 the same message+reply pair is deduplicated when its metadata agrees and refused when it conflicts', async () => {
    let mode: 'off' | 'duplicate' | 'conflict' = 'off';
    const f = await open('memory', (deps) => createUndeliveredReplyNoticeSource({
      records: deps.records,
      sessions: deps.sessions,
      messages: {
        readMessage: (ctx, ref) => deps.messages.readMessage(ctx, ref),
        readUndeliveredReplies: async (ctx, input) => {
          const result = await deps.messages.readUndeliveredReplies!(ctx, input);
          if (result.status !== 'ready' || input.page.cursor !== undefined || result.value.items.length === 0) return result;
          const first = result.value.items[0]!;
          if (mode === 'off') return result;
          if (mode === 'duplicate') return { status: 'ready', value: { ...result.value, items: [first, { ...first }] } };
          return { status: 'ready', value: { ...result.value,
            items: [first, { ...first, respondedAt: '1999-01-01T00:00:00.000Z' }] } };
        },
      },
    }));
    await unavailableWithReply(f);
    mode = 'duplicate';
    expect((await f.page()).notices).toHaveLength(1);
    mode = 'conflict';
    const conflict = await f.notices().source.readPage(f.ctx, { workspace: f.scope, page: { limit: 100 } });
    expect(conflict.status).toBe('rejected');
    if (conflict.status !== 'rejected') throw new Error('a conflicting pair must fail');
    expect(conflict.code).toBe('unavailable');
    expect(String(conflict.reason)).toContain('undelivered_reply_identity_conflict:');
  });

  it('M05 a damaged position is refused', async () => {
    const f = await open();
    await unavailableWithReply(f);
    const base = f.f.base;
    const deps: NoticeDeps = { records: f.records, sessions: f.f.sessions, messages: f.f.mailbox };

    const damaged = await withMessages(deps, {
      readMessage: (ctx, ref) => deps.messages.readMessage(ctx, ref),
      readUndeliveredReplies: async (ctx, input) => {
        const result = await deps.messages.readUndeliveredReplies!(ctx, input);
        if (result.status !== 'ready') return result;
        return { status: 'ready', value: { ...result.value,
          items: result.value.items.map((item) => ({ ...item, unavailableSince: 'c0000000001' as never })) } };
      },
    }).readPage(f.ctx, { workspace: base.scope, page: { limit: 100 } });
    expect(damaged.status).toBe('rejected');
    if (damaged.status !== 'rejected') throw new Error('a damaged position must fail');
    expect(String(damaged.reason)).toContain('undelivered_reply_source_mismatch:');
  });

  it('M05 the source checks Host identity, cancellation and the explicit Goal before reading', async () => {
    const f = await open();
    const source = f.notices().source;
    const workCtx = { ...f.ctx,
      principal: { kind: 'work_run', runRef: f.f.b2.claim.runRef, roleBinding: f.f.base.roleBinding } } as CoreCallContext;
    const notHost = await source.readPage(workCtx, { workspace: f.scope, page: { limit: 100 } });
    expect(notHost.status).toBe('rejected');
    if (notHost.status !== 'rejected') throw new Error('a non-Host read must fail');
    expect(notHost.code).toBe('forbidden');

    const controller = new AbortController();
    controller.abort();
    const cancelled = await source.readPage({ ...f.ctx, signal: controller.signal } as CoreCallContext,
      { workspace: f.scope, page: { limit: 100 } });
    expect(cancelled.status).toBe('rejected');
    if (cancelled.status !== 'rejected') throw new Error('a cancelled read must fail');
    expect(cancelled.code).toBe('cancelled');

    const foreignProject = await source.readPage(f.ctx, { workspace: f.scope,
      goalRef: { aggregateType: 'Goal', projectId: 'another-project', goalId: 'g-1' }, page: { limit: 100 } });
    expect(foreignProject.status).toBe('rejected');
    if (foreignProject.status !== 'rejected') throw new Error('a foreign-project Goal must fail');
    expect(foreignProject.code).toBe('forbidden');

    const absent = await source.readPage(f.ctx, { workspace: f.scope,
      goalRef: { aggregateType: 'Goal', projectId: f.scope.projectId, goalId: 'no-such-goal' }, page: { limit: 100 } });
    expect(absent.status).toBe('not_found');
  });

  it('M05 a zero or malformed platform cursor is never a stored position: the Session and SessionMessage records refuse it', async () => {
    for (const kind of ['memory', 'sqlite'] as const) {
      const f = await open(kind);
      const { message } = await unavailableWithReply(f);
      const first = ready(await f.notices().source.readPage(f.ctx, { workspace: f.scope, page: { limit: 100 } }));
      expect(first.items).toHaveLength(1);
      const position = first.items[0]!.position;
      expect(position.kind).toBe('commit');
      if (position.kind !== 'commit') throw new Error('a commit position is required');

      // A hand-built next revision through the real store port; the production
      // schemas must refuse the zero cursor AND a malformed token before any commit.
      const badPositions = ['c0000000000', 'not-a-cursor'] as CommitCursor[];
      const session = (await f.f.session(f.f.S)).record;
      const current = ready(await f.f.mailbox.readMessage(f.ctx, message.ref));
      for (const bad of badPositions) {
        const sessionWrite = await f.f.base.commitRaw(
          [encodeSessionRecord({ ...session, revision: session.revision + 1, unavailableSince: bad })],
          [{ refKey: sessionAggregateRefKey(session.ref), expectedRevision: session.revision }]);
        expect(sessionWrite).toMatchObject({ status: 'rejected', code: 'invalid' });
        expect(String((sessionWrite as { reason?: string }).reason)).toContain('unavailableSince');

        const messageWrite = await f.f.base.commitRaw(
          [encodeSessionMessageRecord({ ...current, revision: current.revision + 1, responseSince: bad })],
          [{ refKey: sessionMessageRefKey(current.ref), expectedRevision: current.revision }]);
        expect(messageWrite).toMatchObject({ status: 'rejected', code: 'invalid' });
        expect(String((messageWrite as { reason?: string }).reason)).toContain('responseSince');
      }

      // Nothing was written: the same single notice at the same real position.
      const again = ready(await f.notices().source.readPage(f.ctx, { workspace: f.scope, page: { limit: 100 } }));
      expect(again.items).toHaveLength(1);
      expect(again.items[0]!.position).toEqual(position);
    }
  });

  it('M06 an empty directory or reply page still follows its cursor to the later named tail item', async () => {
    const walking: NoticeSourceFactory = (deps) => createUndeliveredReplyNoticeSource({
      records: deps.records,
      sessions: {
        findSessions: async (ctx, input) => {
          if (input.page.cursor === 'dir-empty-page-1') {
            return deps.sessions.findSessions(ctx, { ...input, page: firstPage(input.page) });
          }
          const real = await deps.sessions.findSessions(ctx, input);
          if (real.status !== 'ready' || input.page.cursor !== undefined || real.value.items.length === 0) return real;
          return { status: 'ready', value: { ...real.value, items: [], nextCursor: 'dir-empty-page-1' } };
        },
      },
      messages: {
        readMessage: (ctx, ref) => deps.messages.readMessage(ctx, ref),
        readUndeliveredReplies: async (ctx, input) => {
          if (input.page.cursor === 'reply-empty-page-1') {
            return deps.messages.readUndeliveredReplies!(ctx, { ...input, page: firstPage(input.page) });
          }
          const real = await deps.messages.readUndeliveredReplies!(ctx, input);
          if (real.status !== 'ready' || input.page.cursor !== undefined || real.value.items.length === 0) return real;
          return { status: 'ready', value: { ...real.value, items: [], nextCursor: 'reply-empty-page-1' } };
        },
      },
    });
    const f = await open('memory', walking);
    const { message, replied } = await unavailableWithReply(f);
    const page = (await f.page());
    // The empty directory page and the empty reply page are both followed by
    // cursor to the ONE named tail item (R before P, so max is the reply cursor).
    // The identity is the creating commands' own message/response pair, never a
    // message readback or the product `noticeKey`.
    expect(page.notices).toHaveLength(1);
    const item = page.notices[0]!;
    expect(item.objects).toEqual([{ kind: 'aggregate',
      pin: { ref: message.ref, revision: replied.value.revision }, label: '原消息' }]);
    expect(item.position.kind).toBe('commit');
    if (item.position.kind !== 'commit') throw new Error('a commit position is required');
    expect(String(item.position.cursor)).toBe(String(replied.cursor));
  });

  it('M08 same-position items page by the complete key in the handwritten order and an incompatible cursor is refused', async () => {
    const f = await open();
    await f.f.enter();
    const first = await f.send();
    const second = await f.send();
    await f.f.yieldWait(first);
    await f.f.enter(f.f.b2.secondClaim);
    // Both replies are saved BEFORE retirement, so both share the later R position.
    const firstReply = await f.f.respond(first);
    const secondReply = await f.f.respond(second);
    const beforeRetire = f.f.batches.length;
    await f.f.retire();
    const retiredAt = observedCursor(f, beforeRetire, 'the retire commit');

    // Handwritten order: both replies are saved BEFORE retirement, so both share
    // the later R position and the source orders them by the complete item key.
    // That key begins with the message identity; these two created messages order
    // as `second` then `first`. The pinned refs/revisions come from the creating
    // commands, and nothing is read back from the source.
    const source = f.notices().source;
    const pageOne = ready(await source.readPage(f.ctx, { workspace: f.scope, page: { limit: 1 } }));
    expect(pageOne.items.map(item => item.objects[0])).toEqual([
      { kind: 'aggregate', pin: { ref: secondReply.value.ref, revision: secondReply.value.revision }, label: '原消息' },
    ]);
    expect(pageOne.nextCursor).not.toBeNull();
    if (pageOne.items[0]!.position.kind !== 'commit') throw new Error('commit position required');
    expect(String(pageOne.items[0]!.position.cursor)).toBe(String(retiredAt));

    const pageTwo = ready(await source.readPage(f.ctx, { workspace: f.scope, page: { limit: 1, cursor: pageOne.nextCursor! } }));
    expect(pageTwo.items.map(item => item.objects[0])).toEqual([
      { kind: 'aggregate', pin: { ref: firstReply.value.ref, revision: firstReply.value.revision }, label: '原消息' },
    ]);
    if (pageTwo.items[0]!.position.kind !== 'commit') throw new Error('commit position required');
    expect(String(pageTwo.items[0]!.position.cursor)).toBe(String(retiredAt));
    expect(pageTwo.nextCursor).toBeNull();

    const other = { aggregateType: 'Goal' as const, projectId: f.f.base.goalRef.projectId, goalId: 'another' };
    const incompatible = await source.readPage(f.ctx, { workspace: f.scope, goalRef: other, page: { limit: 1, cursor: pageOne.nextCursor! } });
    expect(incompatible.status).toBe('rejected');
    if (incompatible.status !== 'rejected') throw new Error('an incompatible cursor must fail');
    expect(incompatible.code).toBe('invalid');

    const badLimit = await source.readPage(f.ctx, { workspace: f.scope, page: { limit: 201 } });
    expect(badLimit.status).toBe('rejected');
    if (badLimit.status !== 'rejected') throw new Error('an illegal limit must fail');
    expect(badLimit.code).toBe('invalid');
  });

  it('M08 a malformed continuation cursor is invalid, never an empty success, unavailable or a restart from page 1', async () => {
    const malformed = [
      ['garbage', { kind: 'commit', cursor: 'garbage', itemKey: 'undelivered_reply:x' }],
      ['zero', { kind: 'commit', cursor: 'c0000000000', itemKey: 'undelivered_reply:x' }],
      ['unknown', { kind: 'unknown', itemKey: 'undelivered_reply:x' }],
    ] as const;

    // (1) Empty source: a malformed position inside the VALID envelope must still
    // be invalid, not ready/[]; a malformed envelope would fail for another reason.
    const empty = await open();
    for (const [label, last] of malformed) {
      const page = await empty.notices().source.readPage(empty.ctx, { workspace: empty.scope,
        page: { limit: 100, cursor: rawSourceCursor(empty.scope, last) } });
      expect(page.status, label).toBe('rejected');
      if (page.status !== 'rejected') throw new Error(`${label} must be invalid on an empty source`);
      expect(page.code, label).toBe('invalid');
    }

    // (2..4) The existing two-replies-before-retire history, then bad tokens in
    // both the pre-package flat shape and the spec `workspace` envelope.
    const f = await open();
    await f.f.enter();
    const first = await f.send();
    const second = await f.send();
    await f.f.yieldWait(first);
    await f.f.enter(f.f.b2.secondClaim);
    await f.f.respond(first);
    await f.f.respond(second);
    await f.f.retire();
    const source = f.notices().source;
    for (const [label, last] of malformed) {
      for (const token of [legacySourceCursor(f.scope, last), rawSourceCursor(f.scope, last)]) {
        const page = await source.readPage(f.ctx, { workspace: f.scope, page: { limit: 100, cursor: token } });
        expect(page.status, label).toBe('rejected');
        if (page.status !== 'rejected') throw new Error(`${label} must be invalid`);
        expect(page.code, label).toBe('invalid');
      }
    }
    // (5) A token that is not a cursor at all stays invalid.
    const raw = await source.readPage(f.ctx, { workspace: f.scope, page: { limit: 100, cursor: 'not-a-cursor' } });
    expect(raw.status).toBe('rejected');
    if (raw.status !== 'rejected') throw new Error('a non-cursor must be invalid');
    expect(raw.code).toBe('invalid');
  });

  it('M11 an installed-but-empty source is available, a missing one is not_available, freshness is not_ready, and a read failure is not empty', async () => {
    const f = await open();
    const absent = createUndeliveredReplyNoticeSource({ records: f.records, sessions: f.f.sessions,
      messages: { readMessage: f.f.mailbox.readMessage } });
    const absentPage = ready(await absent.readPage(f.ctx, { workspace: f.scope, page: { limit: 100 } }));
    expect(absentPage.availability).toBe('not_available');
    expect(absentPage.items).toEqual([]);

    const empty = ready(await f.notices().source.readPage(f.ctx, { workspace: f.scope, page: { limit: 100 } }));
    expect(empty.availability).toBe('available');
    expect(empty.items).toEqual([]);

    // Installed but the observed horizon is behind the caller's minimum water
    // level: freshness is not enough and must not read as an empty success.
    const stale = await f.notices().source.readPage(f.ctx, { workspace: f.scope,
      page: { limit: 100, atLeastCursor: makeCommitCursor(1_000_000) } });
    expect(stale.status).toBe('not_ready');

    await unavailableWithReply(f);
    const failing = createUndeliveredReplyNoticeSource({ records: f.records, sessions: f.f.sessions,
      messages: {
        readUndeliveredReplies: async () => ({ status: 'rejected', code: 'unavailable', reason: 'injected read failure' }),
        readMessage: (ctx: CoreCallContext, ref) => f.f.mailbox.readMessage(ctx, ref),
      } });
    const failure = await failing.readPage(f.ctx, { workspace: f.scope, page: { limit: 100 } });
    expect(failure.status).toBe('rejected');
    if (failure.status !== 'rejected') throw new Error('expected a rejection');
    expect(failure.code).toBe('unavailable');
  });

  it('M11 a throw from the explicit-Goal read is an undelivered_reply_read_failed rejection, never a reason-less result or a rejected promise', async () => {
    const f = await open();
    const wrapped = (thrown: unknown): NoticeDeps['records'] => ({
      readMany: async (keys: readonly string[]) => keys.length > 0
        ? (() => { throw thrown; })()
        : f.records.readMany(keys),
      lookup: f.records.lookup,
    });
    for (const thrown of [new Error('injected goal read throw'), null, 'boom']) {
      const source = createUndeliveredReplyNoticeSource({ records: wrapped(thrown),
        sessions: f.f.sessions, messages: f.f.mailbox });
      const page = await source.readPage(f.ctx, { workspace: f.scope, goalRef: f.f.base.goalRef, page: { limit: 100 } });
      expect(page.status).toBe('rejected');
      if (page.status !== 'rejected') throw new Error('a thrown Goal read must be rejected');
      expect(page.code).toBe('unavailable');
      expect(typeof page.reason).toBe('string');
      expect(page.reason.startsWith('undelivered_reply_read_failed:')).toBe(true);
      if (thrown instanceof Error) expect(page.reason).toContain('injected goal read throw');
    }
  });

  // Lead (2A §5.3, frozen): wiring 2's temporary 50-page/5,000-item bound is
  // removed (2A §0.4); 5,001 real replies are all paged, nothing is refused.
  it('M07 5000 real undelivered replies are all read and 5001 are all read too (no capacity bound)', async () => {
    // A real unavailable line with `count` saved replies: real messages, one
    // wait yield, the real health commit, then one real response per message.
    const replyLine = async (count: number) => {
      const fixture = await open();
      await fixture.f.enter();
      const messages: SessionMessage[] = [];
      for (let index = 0; index < count; index += 1) messages.push(await fixture.send());
      await fixture.f.yieldWait(messages[0]!);
      await fixture.f.enter(fixture.f.b2.secondClaim);
      await fixture.f.retire();
      const replies = [];
      for (const message of messages) replies.push(await fixture.f.respond(message));
      return { fixture, messages, replies };
    };

    // Exactly 5000 real replies on one real unavailable line: page the public
    // source with its outer 200-item limit and verify every item and the named
    // tail (the last created reply).
    const exact = await replyLine(5_000);
    const exactSource = exact.fixture.notices().source;
    const all: NoticeItemV1[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = ready(await exactSource.readPage(exact.fixture.ctx, { workspace: exact.fixture.scope,
        page: cursor === undefined ? { limit: 200 } : { limit: 200, cursor } }));
      all.push(...page.items);
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(all).toHaveLength(5_000);
    expect(all.map(item => item.objects[0])).toEqual(exact.messages.map((message, index) => ({
      kind: 'aggregate', pin: { ref: message.ref, revision: exact.replies[index]!.value.revision }, label: '原消息' })));
    expect(all.map(item => {
      if (item.position.kind !== 'commit') throw new Error('a commit position is required');
      return String(item.position.cursor);
    })).toEqual(exact.replies.map(reply => String(reply.cursor)));
    expect(all.at(-1)!.objects[0]).toEqual({ kind: 'aggregate',
      pin: { ref: exact.messages.at(-1)!.ref, revision: exact.replies.at(-1)!.value.revision }, label: '原消息' });

    // One more real reply (5,001 on one line, past wiring 2's old bound): paging
    // the public source still returns every item, in reply order, once each.
    const over = await replyLine(5_001);
    const overSource = over.fixture.notices().source;
    const overAll: NoticeItemV1[] = [];
    let overCursor: string | undefined;
    for (;;) {
      const page = ready(await overSource.readPage(over.fixture.ctx, { workspace: over.fixture.scope,
        page: overCursor === undefined ? { limit: 200 } : { limit: 200, cursor: overCursor } }));
      overAll.push(...page.items);
      if (page.nextCursor === null) break;
      overCursor = page.nextCursor;
    }
    expect(overAll).toHaveLength(5_001);
    expect(overAll.map(item => item.objects[0])).toEqual(over.messages.map((message, index) => ({
      kind: 'aggregate', pin: { ref: message.ref, revision: over.replies[index]!.value.revision }, label: '原消息' })));
    expect(overAll.map(item => {
      if (item.position.kind !== 'commit') throw new Error('a commit position is required');
      return String(item.position.cursor);
    })).toEqual(over.replies.map(reply => String(reply.cursor)));
  }, 300_000);

  it('M09 a changed window is retried as a whole and recovers; a stable mismatch fails', async () => {
    const f = await open();
    await unavailableWithReply(f);
    const deps: NoticeDeps = { records: f.records, sessions: f.f.sessions, messages: f.f.mailbox };
    const window = observedWindow(f);
    const stale = makeCommitCursor(1);
    let stable = false;
    let firstRead = true;
    const source = withMessages(deps, {
      readMessage: (ctx, ref) => deps.messages.readMessage(ctx, ref),
      readUndeliveredReplies: async (ctx, input) => {
        const real = await deps.messages.readUndeliveredReplies!(ctx, input);
        if (real.status !== 'ready') return real;
        // The first attempt in an unstable run reports the stale window; a later
        // attempt reports the real one. A ready result therefore proves the whole
        // window was retried, without asserting a call count.
        const readWindow = stable ? stale : (firstRead ? stale : window);
        firstRead = false;
        return { status: 'ready', value: { ...real.value, sourceCursor: readWindow } };
      },
    });
    const recovered = ready(await source.readPage(f.ctx, { workspace: f.scope, page: { limit: 100 } }));
    expect(recovered.items).toHaveLength(1);

    // A window that never stabilizes is reported as a whole-window failure.
    stable = true;
    firstRead = true;
    const never = await source.readPage(f.ctx, { workspace: f.scope, page: { limit: 100 } });
    expect(never.status).toBe('rejected');
    if (never.status !== 'rejected') throw new Error('a stable mismatch must fail');
    expect(never.code).toBe('unavailable');
    expect(String(never.reason)).toContain('undelivered_reply_window_changed:');
  });

  it('M09 a message-level mismatch first rechecks the window and retries before reporting damage', async () => {
    const f = await open();
    await unavailableWithReply(f);
    const deps: NoticeDeps = { records: f.records, sessions: f.f.sessions, messages: f.f.mailbox };
    let first = true;
    const source = createUndeliveredReplyNoticeSource({
      records: deps.records,
      sessions: deps.sessions,
      messages: {
        readUndeliveredReplies: (ctx, input) => deps.messages.readUndeliveredReplies!(ctx, input),
        readMessage: async (ctx, ref) => {
          if (!first) return deps.messages.readMessage(ctx, ref);
          first = false;
          // A real unrelated commit moves the ledger window while the source is
          // re-reading the message; the mismatch must retry, not be reported as
          // stable damage.
          await f.f.continuation();
          const real = await deps.messages.readMessage(ctx, ref);
          if (real.status !== 'ready' || real.value.response === null) return real;
          return { ...real, value: { ...real.value,
            response: { ...real.value.response, bodyRef: { ...real.value.response.bodyRef, digest: 'sha256:moved-window' } } } };
        },
      },
    });
    const page = ready(await source.readPage(f.ctx, { workspace: f.scope, page: { limit: 100 } }));
    // The public outcome proves the mismatch was retried rather than reported:
    // the first message read was the moved-window damage; a stable read follows.
    expect(page.items).toHaveLength(1);
  });

  it('M10 a later directory page that goes source_stale discards the whole accumulated window', async () => {
    const f = await open();
    await unavailableWithReply(f);
    const deps: NoticeDeps = { records: f.records, sessions: f.f.sessions, messages: f.f.mailbox };
    let firstPages = 0;
    const source = createUndeliveredReplyNoticeSource({
      records: {
        readMany: keys => deps.records.readMany(keys),
        lookup: async (request) => {
          if (request.index !== SESSION_BY_WORKSPACE_LOOKUP) return deps.records.lookup(request);
          if (request.after === 'later-directory-page') {
            // The later page was read at a moved ledger window. A retained
            // accumulated window would still surface the attempt-1 line.
            return { status: 'ready', value: { records: [], next: null, readThrough: makeCommitCursor(1) } };
          }
          firstPages += 1;
          const real = await deps.records.lookup(request);
          if (real.status !== 'ready') return real;
          // Attempt 1: its FIRST page carries the real unavailable line and a
          // next page; that next page reports the moved window. Attempt 2: an
          // EMPTY directory. A retained accumulated window would still surface the
          // attempt-1 line; the empty result proves the whole window was dropped.
          return firstPages === 1
            ? { ...real, value: { ...real.value, next: 'later-directory-page' } }
            : { status: 'ready', value: { ...real.value, records: [], next: null } };
        },
      },
      sessions: deps.sessions,
      messages: deps.messages,
    });
    const recovered = ready(await source.readPage(f.ctx, { workspace: f.scope, page: { limit: 100 } }));
    expect(recovered.items).toEqual([]);
  });

  it('M10 a window that stabilizes on attempt four recovers, and one that stabilizes only after four fails', async () => {
    const f = await open();
    await unavailableWithReply(f);
    const deps: NoticeDeps = { records: f.records, sessions: f.f.sessions, messages: f.f.mailbox };
    // Each window attempt starts on the first directory page; attempts before
    // `stableOn` send the reader to a later page that reports the moved window.
    const scripted = (stableOn: number) => {
      let attempt = 0;
      return createUndeliveredReplyNoticeSource({
        records: {
          readMany: keys => deps.records.readMany(keys),
          lookup: async (request) => {
            if (request.index !== SESSION_BY_WORKSPACE_LOOKUP) return deps.records.lookup(request);
            if (request.after === 'later-directory-page') {
              return { status: 'ready', value: { records: [], next: null, readThrough: makeCommitCursor(1) } };
            }
            attempt += 1;
            const real = await deps.records.lookup(request);
            if (real.status !== 'ready') return real;
            return attempt < stableOn
              ? { ...real, value: { ...real.value, next: 'later-directory-page' } }
              : real;
          },
        },
        sessions: deps.sessions,
        messages: deps.messages,
      });
    };

    // The fourth attempt is inside the four-attempt budget: the stable window
    // surfaces the real reply as a public success.
    const recovered = ready(await scripted(4).readPage(f.ctx, { workspace: f.scope, page: { limit: 100 } }));
    expect(recovered.items).toHaveLength(1);

    // Stabilizing only on the fifth attempt is after the budget: the whole read
    // is refused with the spec prefix, never an empty success.
    const never = await scripted(5).readPage(f.ctx, { workspace: f.scope, page: { limit: 100 } });
    expect(never.status).toBe('rejected');
    if (never.status !== 'rejected') throw new Error('a window that stabilizes after four attempts must fail');
    expect(never.code).toBe('unavailable');
    expect(String(never.reason)).toContain('undelivered_reply_window_changed:');
  });

  it('M04 a duplicate message+reply pair whose entry or reply position differs is refused even when the later position is equal', async () => {
    const f = await open('memory', (deps) => {
      let calls = 0;
      return createUndeliveredReplyNoticeSource({
        records: {
          readMany: keys => deps.records.readMany(keys),
          lookup: async (request) => {
            const real = await deps.records.lookup(request);
            if (real.status !== 'ready' || request.index !== SESSION_BY_WORKSPACE_LOOKUP || request.after !== undefined) {
              return real;
            }
            const target = real.value.records.find((record) =>
              (JSON.parse(record.json) as { health?: unknown }).health === 'unavailable');
            if (target === undefined) return real;
            // The same source Session appears once more with an EARLIER but
            // different valid entry position, so both project to the same later P.
            const body = JSON.parse(target.json) as Record<string, unknown>;
            body['unavailableSince'] = makeCommitCursor(1);
            const copy = { ...target, json: JSON.stringify(body) };
            return { ...real, value: { ...real.value, records: [...real.value.records, copy] } };
          },
        },
        sessions: deps.sessions,
        messages: {
          readMessage: (ctx, ref) => deps.messages.readMessage(ctx, ref),
          readUndeliveredReplies: async (ctx, input) => {
            const result = await deps.messages.readUndeliveredReplies!(ctx, input);
            if (result.status !== 'ready' || result.value.items.length === 0) return result;
            if (calls++ === 0) return result;
            // The second (copied) card's DTO carries its own earlier entry position.
            return { status: 'ready', value: { ...result.value,
              items: result.value.items.map((item) => ({ ...item, unavailableSince: makeCommitCursor(1) })) } };
          },
        },
      });
    });
    await unavailableWithReply(f);
    const page = await f.notices().source.readPage(f.ctx, { workspace: f.scope, page: { limit: 100 } });
    expect(page.status).toBe('rejected');
    if (page.status !== 'rejected') throw new Error('a differing-position duplicate must fail');
    expect(page.code).toBe('unavailable');
    expect(String(page.reason)).toContain('undelivered_reply_identity_conflict:');
  });

  it('M09 a stable DTO that omits R/P the Session record and message still carry is refused', async () => {
    const f = await open();
    await unavailableWithReply(f);
    const deps: NoticeDeps = { records: f.records, sessions: f.f.sessions, messages: f.f.mailbox };
    // Only the upstream DTO is inconsistent: the directory Session record and
    // the re-read message keep their real bound positions.
    const source = withMessages(deps, {
      readMessage: (ctx, ref) => deps.messages.readMessage(ctx, ref),
      readUndeliveredReplies: async (ctx, input) => {
        const result = await deps.messages.readUndeliveredReplies!(ctx, input);
        if (result.status !== 'ready') return result;
        return { status: 'ready', value: { ...result.value,
          items: result.value.items.map(({ unavailableSince: _u, responseSince: _r, ...rest }) =>
            rest as unknown as UndeliveredReplyV1) } };
      },
    });
    const page = await source.readPage(f.ctx, { workspace: f.scope, page: { limit: 100 } });
    expect(page.status).toBe('rejected');
    if (page.status !== 'rejected') throw new Error('a DTO that drops stored positions must fail');
    expect(page.code).toBe('unavailable');
    expect(String(page.reason).startsWith('undelivered_reply_source_mismatch:')).toBe(true);
  });

  it('M09 a DTO that names another source Session is refused, never silently collapsed by the directory identity', async () => {
    const f = await open();
    await unavailableWithReply(f);
    const deps: NoticeDeps = { records: f.records, sessions: f.f.sessions, messages: f.f.mailbox };
    // Only the upstream DTO disagrees: the directory record, the re-read message
    // and every other DTO field keep their real values, so the source identity
    // is the one thing that can be wrong. A signature built from the directory
    // alone would let this item through unchanged.
    const source = withMessages(deps, {
      readMessage: (ctx, ref) => deps.messages.readMessage(ctx, ref),
      readUndeliveredReplies: async (ctx, input) => {
        const result = await deps.messages.readUndeliveredReplies!(ctx, input);
        if (result.status !== 'ready') return result;
        return { status: 'ready', value: { ...result.value,
          items: result.value.items.map((item) => ({ ...item,
            sourceSessionRef: { ...item.sourceSessionRef, sessionId: `${item.sourceSessionRef.sessionId}-other` } })) } };
      },
    });
    const page = await source.readPage(f.ctx, { workspace: f.scope, page: { limit: 100 } });
    expect(page.status).toBe('rejected');
    if (page.status !== 'rejected') throw new Error('a DTO that names another source Session must fail');
    expect(page.code).toBe('unavailable');
    expect(String(page.reason).startsWith('undelivered_reply_source_mismatch:')).toBe(true);
  });

  it('P3/W225 a Work reconcile that retires the Session persists the entry bound to the commit cursor', async () => {
    const f = await open();
    await f.f.enter();
    const receipt = await f.workUnavailable();
    expect(receipt.status).toBe('committed');
    if (receipt.status !== 'committed') throw new Error(JSON.stringify(receipt));
    const retired = await f.f.session(f.f.S);
    expect(retired.record.health).toBe('unavailable');
    // The cursor of the reconcile commit itself is the independent expected value.
    expect(retired.record.unavailableSince).toBe(receipt.cursor);
  });

  it('P4/W226 a Query recovery returns the Session bound to its commit cursor on the first result and the replay', async () => {
    const f = await open();
    acceptEmptySourceRefs(f, { kind: 'workspace', refId: f.scope.workspaceId, revision: '1' });
    // A fresh available line: the fixture's default S is already occupied.
    const target = await f.f.continuation();
    const q = await f.query(target);
    const reconcile = q.owner.reconcileQueryRun;
    if (reconcile === undefined) throw new Error('the Query recovery port is absent');
    const runPin = await f.f.pin(q.queryRunRef);
    const write = (requestId: string) => reconcile.call(q.owner, f.ctx, { input: {
      queryRunRef: q.queryRunRef, hostInstanceId: 'wp2-host', probe: 'ready', inputsConfirmed: true,
      result: { kind: 'interrupted_clean' as const, kernelStatus: 'running' as const, history: q.history } },
      meta: { requestId, expected: [runPin] } });
    const first = await write('p4-query-recovery');
    expect(first.status).toBe('committed');
    if (first.status !== 'committed') throw new Error(JSON.stringify(first));
    expect(first.replayed).toBe(false);
    expect(first.value.session.unavailableSince).toBe(first.cursor);

    const replay = await write('p4-query-recovery');
    expect(replay.status).toBe('committed');
    if (replay.status !== 'committed') throw new Error(JSON.stringify(replay));
    expect(replay.replayed).toBe(true);
    expect(replay.value.session.unavailableSince).toBe(first.cursor);
  });
});
