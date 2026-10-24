/**
 * `ask`'s pure input rules (slice-6 spec L6: the card question and the
 * regeneration of a stale candidate): the text the follow-up round stores and
 * the shape check every `ask` passes before anything is read. Called with
 * hand-built commands; the expected texts and reasons are written out here.
 *
 * The stored text: a question is stored as given; a regeneration stores
 * `请按当前事实重新出这个候选计划。`, then a blank line and the person's words
 * when there are any. The shared Query text rule (non-empty, at most 16 KiB of
 * UTF-8) applies to that stored text. The card refs: 1 to 20 well-formed
 * VersionedRefs of the caller's project, no ref named twice.
 *
 * Before a round is added the card objects are read once: an object type the
 * store keeps no records of is refused `invalid` naming the type (asking again
 * cannot help); a failed read is `unavailable`.
 */
import { describe, expect, it } from 'vitest';
import type { VersionedRef } from '../../src/contracts/ledger.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import {
  askInputText, cardRefsReadRefusal, publicCommandProblem, type RequestPublicCommandV1,
} from '../../src/core/work-graph/tasks/request-service.js';

const PROJECT = 's6a-ask-pure-project';
const ROUND: QueryJobRef = { aggregateType: 'QueryJob', projectId: PROJECT, workspaceId: 's6a-ask-pure-ws', queryJobId: 'round-1' };

function goalPin(goalId: string, revision = 1): VersionedRef {
  return { ref: { aggregateType: 'Goal', projectId: PROJECT, goalId }, revision };
}

function ask(over: Partial<Extract<RequestPublicCommandV1, { kind: 'ask' }>> = {}): RequestPublicCommandV1 {
  return { kind: 'ask', commandId: 'ask-1', round: ROUND, cardRefs: [goalPin('g1')], regenerate: false,
    text: 'why this step?', ...over };
}

/** 48 UTF-8 bytes: sixteen three-byte characters. */
const REGENERATE = '请按当前事实重新出这个候选计划。';

describe('ask: the stored input text', () => {
  it('a question stores the words exactly as given, untrimmed', () => {
    expect(askInputText({ regenerate: false, text: '  why this step?  ' })).toBe('  why this step?  ');
  });

  it('a regeneration with no words stores the regeneration request alone', () => {
    expect(askInputText({ regenerate: true, text: '' })).toBe('请按当前事实重新出这个候选计划。');
  });

  it('a regeneration with words stores the request, a blank line and the words', () => {
    expect(askInputText({ regenerate: true, text: '先看第二步' })).toBe('请按当前事实重新出这个候选计划。\n\n先看第二步');
  });
});

describe('ask: accepted shapes', () => {
  it('accepts one card ref and a question', () => {
    expect(publicCommandProblem(ask(), PROJECT)).toBeNull();
  });

  it('accepts twenty different card refs', () => {
    const refs = Array.from({ length: 20 }, (_, index) => goalPin(`g${index + 1}`));
    expect(publicCommandProblem(ask({ cardRefs: refs }), PROJECT)).toBeNull();
  });

  it('accepts a regeneration with no words: the stored text is not empty', () => {
    expect(publicCommandProblem(ask({ regenerate: true, text: '' }), PROJECT)).toBeNull();
  });

  it('accepts a regeneration whose stored text is exactly 16 KiB (48 + 2 + 16,334 bytes)', () => {
    expect(Buffer.byteLength(REGENERATE, 'utf8')).toBe(48);
    expect(publicCommandProblem(ask({ regenerate: true, text: 'a'.repeat(16334) }), PROJECT)).toBeNull();
  });

  it('accepts a 16,335-byte question: without a regeneration nothing is added', () => {
    expect(publicCommandProblem(ask({ text: 'a'.repeat(16335) }), PROJECT)).toBeNull();
  });
});

describe('rejects: ask shapes', () => {
  it('rejects an empty question that is not a regeneration', () => {
    expect(publicCommandProblem(ask({ text: '' }), PROJECT)).toBe('text must be non-empty');
  });

  it('rejects a regeneration whose stored text is one byte over 16 KiB', () => {
    expect(publicCommandProblem(ask({ regenerate: true, text: 'a'.repeat(16335) }), PROJECT))
      .toBe('text must be at most 16 KiB of UTF-8');
  });

  it('rejects an ask with no card ref', () => {
    expect(publicCommandProblem(ask({ cardRefs: [] }), PROJECT)).toBe('cardRefs must name 1 to 20 refs');
  });

  it('rejects twenty-one card refs', () => {
    const refs = Array.from({ length: 21 }, (_, index) => goalPin(`g${index + 1}`));
    expect(publicCommandProblem(ask({ cardRefs: refs }), PROJECT)).toBe('cardRefs must name 1 to 20 refs');
  });

  it('rejects the same ref named twice, even at another revision', () => {
    expect(publicCommandProblem(ask({ cardRefs: [goalPin('g1', 1), goalPin('g2'), goalPin('g1', 2)] }), PROJECT))
      .toBe('cardRefs[2] names the same object as an earlier ref');
  });

  it('rejects a ref of another project', () => {
    const foreign: VersionedRef = { ref: { aggregateType: 'Goal', projectId: 's6a-other-project', goalId: 'g1' }, revision: 1 };
    expect(publicCommandProblem(ask({ cardRefs: [goalPin('g1'), foreign] }), PROJECT))
      .toBe('cardRefs[1].ref must name an object of this project');
  });

  it('rejects a revision below 1', () => {
    expect(publicCommandProblem(ask({ cardRefs: [goalPin('g1', 0)] }), PROJECT))
      .toBe('cardRefs[0].revision must be a positive safe integer');
  });

  it('rejects cardRefs that is not an array', () => {
    expect(publicCommandProblem(ask({ cardRefs: null as unknown as VersionedRef[] }), PROJECT))
      .toBe('cardRefs must be an array');
  });

  it('rejects a regenerate flag that is not a boolean', () => {
    expect(publicCommandProblem(ask({ regenerate: 'yes' as unknown as boolean }), PROJECT))
      .toBe('regenerate must be a boolean');
  });

  it('rejects words that are not a string, even for a regeneration', () => {
    expect(publicCommandProblem(ask({ regenerate: true, text: undefined as unknown as string }), PROJECT))
      .toBe('text must be a string');
  });
});

describe('ask: the card objects read before a round is added', () => {
  it('a read the store answered lets the ask through', () => {
    expect(cardRefsReadRefusal({ status: 'ready' })).toBeNull();
  });
});

describe('rejects: card objects the store cannot read', () => {
  it('rejects a ref of an object type the store keeps no records of, naming the type', () => {
    expect(cardRefsReadRefusal({ status: 'rejected', code: 'unsupported',
      reason: 'no record schema registered for aggregateType Task' })).toEqual({ status: 'rejected', code: 'invalid',
      reason: 'a card ref is not a stored object: no record schema registered for aggregateType Task' });
  });

  it('answers any other failed read as unavailable', () => {
    expect(cardRefsReadRefusal({ status: 'rejected', code: 'unavailable', reason: 'database is locked' })).toEqual({
      status: 'rejected', code: 'unavailable', reason: 'the card objects read failed: unavailable: database is locked' });
  });
});
