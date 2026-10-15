/**
 * Slice 2C row 2C-18 / L12 (LE3): the conversation source and the Host page.
 *
 * `readWorkLineConversationSource` returns the chain oldest-first with each
 * Session's Kernel identity and whether its original history is readable. The
 * Host composition (`createWorkLineConversation`) then reads the original
 * history one segment at a time through the injected Runtime reader. The
 * Runtime here is a scripted in-memory reader (the only external boundary).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { SessionHistoryEntry } from '../../src/core/agent-runtime/session-operations.js';
import type { RuntimeExecutionPort } from '../../src/core/agent-runtime/ports.js';
import { createWorkLineConversation } from '../../src/composition/work-line-conversation.js';
import { openLineFixture, type LineFixture } from '../helpers/S2C-L-line-support.js';

function ready<T>(result: ReadResult<T>): T {
  if (result.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  return result.value;
}

function entry(session: SessionRef, cursor: string, recordedAt: string): SessionHistoryEntry {
  return { recordId: cursor, cursor, recordedAt, kind: 'agent_event',
    source: { adapterId: 'r4c-claim-kernel', kernelSessionId: `kernel-${session.sessionId}`, position: 1 },
    body: { encoding: 'kernel_session_record_json', text: cursor } };
}

function scriptedRuntime(histories: Record<string, SessionHistoryEntry[]>): RuntimeExecutionPort['readSessionHistory'] {
  return async (_ctx: CoreCallContext, request) => {
    const all = histories[request.sessionRef.sessionId] ?? [];
    const after = request.afterCursor;
    const start = after === null ? 0 : all.findIndex((item) => item.cursor === after) + 1;
    const slice = all.slice(start, start + request.limit);
    const last = slice[slice.length - 1];
    const beyond = start + slice.length < all.length;
    return { status: 'ready', value: { items: slice, nextCursor: beyond && last !== undefined ? last.cursor : null,
      basis: { kind: 'session', ref: request.sessionRef, cursor: (last?.cursor ?? 'c0') as CommitCursor } } };
  };
}

describe.each(['memory', 'sqlite'] as const)('2C-18 line conversation (%s)', (kind) => {
  const open: LineFixture[] = [];
  afterEach(async () => { for (const fixture of open.splice(0)) await fixture.close(); });
  async function lineFixture(): Promise<LineFixture> {
    const fixture = await openLineFixture(kind);
    open.push(fixture);
    return fixture;
  }

  it('2C-18 the conversation source gives the chain oldest-first and the Host pages it', async () => {
    const f = await lineFixture();
    const task = f.base.tasks['first']!;
    const p = (await f.createSession('conv-p')).ref;
    const h = (await f.createSession('conv-h', { provenance:
      { schemaVersion: 1, kind: 'continuation', from: p, reason: 'interrupted', task } })).ref;

    const source = ready(await f.reader.readWorkLineConversationSource(f.ctx, { workspace: f.base.scope, key: h }));
    expect(source.segments.map((segment) => segment.session)).toEqual([p, h]);
    expect(source.segments[0]?.kernel.adapterId).toBe('r4c-claim-kernel');
    expect(source.segments[0]?.kernel.kernelSessionId).toBe('kernel-conv-p');
    expect(source.segments.every((segment) => segment.history === 'readable')).toBe(true);

    const histories = {
      [p.sessionId]: [entry(p, 'h1', '2026-01-01T01:00:00.000Z'), entry(p, 'h2', '2026-01-01T02:00:00.000Z'),
        entry(p, 'h3', '2026-01-01T03:00:00.000Z')],
      [h.sessionId]: [entry(h, 'h4', '2026-01-01T04:00:00.000Z'), entry(h, 'h5', '2026-01-01T05:00:00.000Z'),
        entry(h, 'h6', '2026-01-01T04:30:00.000Z'), entry(h, 'h7', '2026-01-01T07:00:00.000Z')],
    };
    const conversation = createWorkLineConversation({ lines: f.reader, readSessionHistory: scriptedRuntime(histories) });
    const pageAt = async (limit: number, cursor?: string) =>
      ready(await conversation.readWorkLinePage(f.ctx, { workspace: f.base.scope, key: h,
        section: 'conversation', page: { limit, ...(cursor === undefined ? {} : { cursor }) } }));
    const describeItems = (page: Awaited<ReturnType<typeof pageAt>>) => {
      if (page.section !== 'conversation') throw new Error('expected the conversation section');
      return page.items.map((item) => item.kind === 'segment'
        ? `segment:${item.segment.session.sessionId}` : `history:${item.entry.cursor}`);
    };

    // limit 1: page 1 is only P's header (`header_only` state), page 2 is h1.
    const first = await pageAt(1);
    expect(describeItems(first)).toEqual([`segment:${p.sessionId}`]);
    const second = await pageAt(1, first.nextCursor!);
    expect(describeItems(second)).toEqual(['history:h1']);

    // limit 4: a page that stops at P's last entry carries H's `before_header` boundary.
    const boundary = await pageAt(4);
    expect(describeItems(boundary)).toEqual([`segment:${p.sessionId}`, 'history:h1', 'history:h2', 'history:h3']);
    const across = await pageAt(4, boundary.nextCursor!);
    expect(describeItems(across)).toEqual([`segment:${h.sessionId}`, 'history:h4', 'history:h5', 'history:h6']);
    const last = await pageAt(4, across.nextCursor!);
    expect(describeItems(last)).toEqual(['history:h7']);
    expect(last.nextCursor).toBeNull();
  });

  it('2C-18 (review item 11) a single-Session line reports the head watermark, never a fabricated zero', async () => {
    const f = await lineFixture();
    // Review item 7b: the expected watermark comes from the public setup receipt
    // (the registration commit cursor), not a database verification read.
    const created = await f.createSession('conv4-h');
    const h = created.ref;
    const horizon = created.cursor;
    expect(horizon).not.toBeNull();

    const source = ready(await f.reader.readWorkLineConversationSource(f.ctx, { workspace: f.base.scope, key: h }));
    expect(source.sourceCursor).toBe(horizon);
    expect(source.sourceCursor).not.toBe('c0000000000');

    // The empty messages / participation / copies sections use the same watermark.
    for (const section of ['messages', 'participation', 'copies'] as const) {
      const page = ready(await f.reader.readWorkLinePage(f.ctx, { workspace: f.base.scope, key: h,
        section, page: { limit: 10 } }));
      expect(page.sourceCursor).toBe(horizon);
    }
  });

  it('2C-18 a new chain segment makes an old conversation cursor source_stale', async () => {
    const f = await lineFixture();
    const task = f.base.tasks['first']!;
    const p = (await f.createSession('conv2-p')).ref;
    const h = (await f.createSession('conv2-h', { provenance:
      { schemaVersion: 1, kind: 'continuation', from: p, reason: 'interrupted', task } })).ref;
    const conversation = createWorkLineConversation({ lines: f.reader,
      readSessionHistory: scriptedRuntime({ [p.sessionId]: [entry(p, 'a1', '2026-01-01T01:00:00.000Z')],
        [h.sessionId]: [entry(h, 'b1', '2026-01-01T02:00:00.000Z')] }) });
    const first = ready(await conversation.readWorkLinePage(f.ctx, { workspace: f.base.scope, key: h,
      section: 'conversation', page: { limit: 1 } }));

    await f.createSession('conv2-h2', { provenance:
      { schemaVersion: 1, kind: 'continuation', from: h, reason: 'interrupted', task } });
    const stale = await conversation.readWorkLinePage(f.ctx, { workspace: f.base.scope, key: h,
      section: 'conversation', page: { limit: 1, cursor: first.nextCursor! } });
    expect(stale.status).toBe('rejected');
    if (stale.status !== 'rejected') throw new Error('expected a rejection');
    expect(stale.code).toBe('source_stale');
  });

  it('2C-18 the conversation cursor binds the resolved head, so a predecessor key pages the same line', async () => {
    const f = await lineFixture();
    const task = f.base.tasks['first']!;
    const p = (await f.createSession('conv3-p')).ref;
    const h = (await f.createSession('conv3-h', { provenance:
      { schemaVersion: 1, kind: 'continuation', from: p, reason: 'interrupted', task } })).ref;
    const conversation = createWorkLineConversation({ lines: f.reader,
      readSessionHistory: scriptedRuntime({ [p.sessionId]: [entry(p, 'x1', '2026-01-01T01:00:00.000Z')],
        [h.sessionId]: [entry(h, 'y1', '2026-01-01T02:00:00.000Z')] }) });
    const first = ready(await conversation.readWorkLinePage(f.ctx, { workspace: f.base.scope, key: p,
      section: 'conversation', page: { limit: 1 } }));
    if (first.section !== 'conversation') throw new Error('expected the conversation section');
    // The second page is read through the HEAD key; the cursor must still match.
    const second = ready(await conversation.readWorkLinePage(f.ctx, { workspace: f.base.scope, key: h,
      section: 'conversation', page: { limit: 1, cursor: first.nextCursor! } }));
    if (second.section !== 'conversation') throw new Error('expected the conversation section');
    expect(second.items.map((item) => item.kind === 'segment'
      ? `segment:${item.segment.session.sessionId}` : `history:${item.entry.cursor}`)).toEqual(['history:x1']);
  });
});
