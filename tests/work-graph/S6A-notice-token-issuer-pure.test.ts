/**
 * The notice display token's issuer (the decision queue or the main read): a
 * token verifies only when its signed payload names one of the two, so a goal
 * filter is accepted on the main read's token and refused on the queue's.
 *
 * A5: a pure file. The codec is built from a fixed key; every payload is a
 * hand-built literal, signed here only to present the codec with each shape.
 */
import { describe, expect, it } from 'vitest';
import type { NoticeDisplayTokenPayloadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { createNoticeDisplayToken } from '../../src/core/work-graph/views/notice-display-token.js';

const codec = createNoticeDisplayToken(new Uint8Array(32).fill(7));

function payload(issuer: unknown): NoticeDisplayTokenPayloadV1 {
  return {
    schemaVersion: 1, workspace: { projectId: 'p1', workspaceId: 'w1' }, operator: { kind: 'human', id: 'operator-1' },
    issuer, goalRef: { aggregateType: 'Goal', projectId: 'p1', goalId: 'g1' }, categories: ['automatic_rework'],
    sourceCursor: 'c0000000009', queryCursor: null, returnedKeys: ['n1'],
    seenThrough: { automatic_rework: { kind: 'commit', cursor: 'c0000000009', itemKey: 'n1' } },
  } as NoticeDisplayTokenPayloadV1;
}

describe('the display token issuer', () => {
  it('a queue token and a main token verify as issued', () => {
    expect(codec.verify(codec.issue(payload('queue')))).toEqual(payload('queue'));
    expect(codec.verify(codec.issue(payload('main')))).toEqual(payload('main'));
  });

  describe('rejects: the display token issuer', () => {
    it('a token without an issuer does not verify', () => {
      const { issuer: _dropped, ...withoutIssuer } = payload('main');
      expect(codec.verify(codec.issue(withoutIssuer as NoticeDisplayTokenPayloadV1))).toBeNull();
    });

    it('a token whose issuer is neither the queue nor the main read does not verify', () => {
      expect(codec.verify(codec.issue(payload('ask')))).toBeNull();
    });
  });
});
