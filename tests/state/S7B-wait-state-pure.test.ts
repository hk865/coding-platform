/**
 * M-wait-state: `waitStateOf`'s precedence table as one pure `it.each` (A5, S2).
 * Expected values are hand-written from E-SR4.2's frozen rule: consumed, then
 * `withdrawnAt`, then `waitCancelledAt`, then responded-with-response, then
 * `expiredAt`, else open. No row combines `withdrawnAt` with `consumed`: only
 * database tampering can produce that shape (S-4).
 */
import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { SourceRefV1 } from '../../src/contracts/dispatch.js';
import {
  waitStateOf,
  type MessageQueryAnswerSenderRecord,
  type MessageResponseRecord,
  type WaitFactsV1,
  type WaitMessageFactsV1,
  type WaitStateV1,
} from '../../src/core/work-graph/state/message-machine.js';

const PROJECT = 'P';
const WORKSPACE = 'W';
const AT = '2026-10-25T00:00:00.000Z';
const SOURCE: SourceRefV1 = { kind: 'workspace', refId: WORKSPACE, revision: '1' };
const BODY: ArtifactRef = { kind: 'artifact', contentType: 'text/plain', digest: 'd', sizeBytes: 1, source: SOURCE };
const ANSWER_SENDER: MessageQueryAnswerSenderRecord = {
  kind: 'query_run',
  sessionRef: { projectId: PROJECT, sessionId: 'S' },
  queryRunRef: { aggregateType: 'QueryRun', projectId: PROJECT, workspaceId: WORKSPACE, queryJobId: 'q', runId: 'r' },
  answerRef: { aggregateType: 'QueryJobAnswer', projectId: PROJECT, workspaceId: WORKSPACE, queryJobId: 'q', answerId: 'a' },
  generation: 1,
};
const RESPONSE: MessageResponseRecord = { sender: ANSWER_SENDER, bodyRef: BODY, sourceRef: SOURCE, respondedAt: AT };

const message = (over: Partial<WaitMessageFactsV1>): WaitMessageFactsV1 => ({
  status: 'pending', response: null, expiredAt: null, withdrawnAt: null, waitCancelledAt: null, ...over,
});

type Row = [
  label: string,
  message: Partial<WaitMessageFactsV1>,
  facts: WaitFactsV1,
  expected: WaitStateV1,
];

describe('waitStateOf', () => {
  it.each<Row>([
    ['pending with nothing set', {}, { consumed: false }, { state: 'open', reason: null }],
    ['read with nothing set', { status: 'read' }, { consumed: false }, { state: 'open', reason: null }],
    ['responded with a response', { status: 'responded', response: RESPONSE }, { consumed: false },
      { state: 'answered', reason: null }],
    ['only expiredAt', { expiredAt: AT }, { consumed: false }, { state: 'expired', reason: null }],
    ['responded with expiredAt: answered beats expired',
      { status: 'responded', response: RESPONSE, expiredAt: AT }, { consumed: false },
      { state: 'answered', reason: null }],
    ['consumed with a response', { status: 'responded', response: RESPONSE }, { consumed: true },
      { state: 'consumed', reason: null }],
    ['consumed with expiredAt', { expiredAt: AT }, { consumed: true }, { state: 'consumed', reason: null }],
    ['withdrawnAt', { withdrawnAt: AT }, { consumed: false }, { state: 'withdrawn', reason: 'withdrawn' }],
    ['waitCancelledAt', { waitCancelledAt: AT }, { consumed: false },
      { state: 'withdrawn', reason: 'wait_cancelled' }],
  ])('%s', (_label, over, facts, expected) => {
    expect(waitStateOf(message(over), facts)).toEqual(expected);
  });
});
