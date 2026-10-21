/**
 * Wiring package 2 §5.2 M07 scale case: the temporary 50-page/5,000-item bound
 * is removed (2A §0.4); 5,001 real replies are all paged, nothing is refused.
 * The daily file keeps the same behaviour with 4 and 5 replies.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { NoticeItemV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { createUndeliveredReplyNoticeSource } from '../../src/core/work-graph/views/undelivered-reply-notices.js';
import { openWP2NoticesFixture, ready, type NoticeSourceFactory, type WP2NoticesFixture } from '../helpers/WP2-notices-fixture.js';

const factory: NoticeSourceFactory = (deps) => createUndeliveredReplyNoticeSource(deps);
const opened: WP2NoticesFixture[] = [];
afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });

async function open(kind: 'memory' | 'sqlite' = 'memory', source: NoticeSourceFactory = factory) {
  const f = await openWP2NoticesFixture(kind, source);
  opened.push(f);
  return f;
}

describe('WP2 undelivered-reply notices', () => {
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
});
