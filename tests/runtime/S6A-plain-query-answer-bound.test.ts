/**
 * A plain Query's final answer text after the secretary answer check (slice-6
 * spec L7, R-11; the formal 16 KiB answer bound). The check reads only request
 * rounds: a plain Query keeps closing `gap` when its turn gives no answer text
 * or a text over 16 KiB, and keeps its answer text verbatim even when that text
 * looks like a secretary answer.
 *
 * Every row runs on the SE2 world (tests/helpers/S6A-host-fixture.ts), memory
 * and SQLite: the reply is scripted on the Session's own queue, a plain Query is
 * submitted and claimed on that line and then prepared and started through the
 * Host's public routes (the base world's `occupy` and `finishQuery`), and the
 * result is read through `queries/read` and `queries/answer`. The expected
 * values are counted by hand.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { QueryJobAnswerSnapshot } from '../../src/contracts/query-job.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import { openS6AHostWorld, type S6AHostWorld, type S6AReply } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

function ready<T>(body: unknown): T {
  const result = body as ReadResult<T>;
  if (result.status !== 'ready') throw new Error(`the read was not ready: ${JSON.stringify(body)}`);
  return result.value;
}

/** One plain Query on a fresh secretary line, answered by the one scripted reply; its Job, Run and answer read back. */
async function answerPlainQuery(backend: 'memory' | 'sqlite', reply: S6AReply) {
  const world = await openS6AHostWorld({ backend });
  worlds.push(world);
  const session = await world.createSecretary('plain');
  await world.scripted.script(session, [reply]);
  const refs = await world.occupy(session);
  await world.finishQuery(refs);
  // The Session's own queue served the turn.
  expect(await world.scripted.pending(session)).toBe(0);
  const record = ready<QueryJobRecord>((await world.post('queries/read', { scope: S6A_SCOPE, input: refs.queryJobRef })).body);
  const answerRef = record.job.job.answerRefs[0];
  const answer = answerRef === undefined ? null
    : ready<QueryJobAnswerSnapshot>((await world.post('queries/answer', { scope: S6A_SCOPE, input: answerRef })).body);
  return { record, answer };
}

describe.each(['memory', 'sqlite'] as const)('a plain Query is not a request round (%s)', (backend) => {
  it('a turn with no answer text closes the plain Query gap', async () => {
    // A whitespace-only final text: the Kernel completes the turn and no answer
    // text is left (an empty-string reply fails the Kernel turn itself).
    const { record, answer } = await answerPlainQuery(backend, { kind: 'text', text: '   ' });
    expect(answer).toBeNull();
    expect(record.job.job.answerRefs).toEqual([]);
    expect(record.run.run.status).toBe('closed');
    expect(record.run.run.outcome).toBe('gap');
    expect(record.job.job.closeReason?.code).toBe('gap');
    expect(record.job.job.closeReason?.detail).toBeNull();
  });

  it('a final text of 16 KiB + 1 bytes closes the plain Query gap', async () => {
    // 16,384 + 1 = 16,385 ASCII bytes: one byte over the formal answer bound.
    const { record, answer } = await answerPlainQuery(backend, { kind: 'text', text: 'a'.repeat(16_385) });
    expect(answer).toBeNull();
    expect(record.job.job.answerRefs).toEqual([]);
    expect(record.run.run.status).toBe('closed');
    expect(record.run.run.outcome).toBe('gap');
    expect(record.job.job.closeReason?.code).toBe('gap');
    expect(record.job.job.closeReason?.detail).toBeNull();
  });

  it('a plain answer that looks like a secretary answer is kept verbatim, with no ideas and no drafts', async () => {
    const text = '{"schemaVersion":1,"body":"only the body","ideas":[{"title":"A","detail":"a"},{"title":"B","detail":"b"}],"goalCardDrafts":[]}';
    const { record, answer } = await answerPlainQuery(backend, { kind: 'text', text });
    expect(record.run.run.status).toBe('answered');
    expect(record.job.job.closeReason).toBeNull();
    expect(answer?.answer.answer).toBe(text);
    expect(answer?.answer.ideas).toEqual([]);
    expect(answer?.answer.goalCardDrafts).toEqual([]);
  });
});
