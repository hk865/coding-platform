import { describe, expect, it } from 'vitest';
import { consultationQueryRefs } from '../../src/contracts/query-job.js';
import type { SessionMessageRef } from '../../src/contracts/core/session-message.js';
import { consultationQueryRefsForUi } from '../../src/ui/boot.js';

/**
 * The browser copy in `src/ui/boot.ts` and the contract in
 * `src/contracts/query-job.ts` must derive the same consultation identity.
 */
const REFS: Array<[string, SessionMessageRef]> = [
  /* Named mutation: the browser hash omits projectId or workspaceId. */
  ['ASCII-only ref', {
    aggregateType: 'SessionMessage', projectId: 'ag2b-collab-project', workspaceId: 'ag2b-collab-workspace',
    messageId: 'session-message-9c5585a96ff349229ee6f0d0ab32edcccd806c1bfb53eea717db9cf2b3669403',
  }],
  /* Named mutation: the browser hashes UTF-16 code units instead of UTF-8 bytes. */
  ['CJK text', {
    aggregateType: 'SessionMessage', projectId: '项目-协作', workspaceId: '工作区-主线',
    messageId: '会话消息-咨询-2026-10-27',
  }],
  /* Named mutation: an empty string is treated as an absent field. */
  ['empty-ish field', {
    aggregateType: 'SessionMessage', projectId: '', workspaceId: 'ag2b-collab-workspace', messageId: '',
  }],
  /* Named mutation: the browser canonicalizer serializes keys in insertion order. */
  ['different key order', {
    messageId: 'session-message-9c5585a96ff349229ee6f0d0ab32edcccd806c1bfb53eea717db9cf2b3669403',
    workspaceId: 'ag2b-collab-workspace', aggregateType: 'SessionMessage', projectId: 'ag2b-collab-project',
  }],
];

describe('E3M-6 the browser consultation identity equals the contract identity', () => {
  it.each(REFS)('%s', async (_label, messageRef) => {
    const contract = consultationQueryRefs(messageRef);
    const browser = await consultationQueryRefsForUi(messageRef);
    expect(browser.queryJobRef).toEqual(contract.queryJobRef);
    expect(browser.queryJobRef.queryJobId).toBe(contract.queryJobRef.queryJobId);
  });
});
