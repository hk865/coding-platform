/**
 * PC-2 ruling 14, PC-18 (pure half): the ONE history rule. All expected values
 * are hand-written tables; the function is called directly with constructed
 * input (a pure function).
 */
import { describe, expect, it } from 'vitest';
import { sessionHistoryDecision, takesSessionHistoryOf } from '../../src/core/agent-runtime/context-history-facts.js';

const boundary = (cursor: string | null, position: number) => ({ cursor, position });

describe('PC-18 the one mode rule (takesSessionHistoryOf)', () => {
  it('PC-18 Work takes a non-null basis position or any completed cursor', () => {
    const work = (sessionBasis: { sourceKernelSessionId: string; throughPosition: number | null } | undefined,
      hasCompletedCursor: boolean) => takesSessionHistoryOf({ callKind: 'work', sessionBasis, hasCompletedCursor });
    expect(work(undefined, false)).toBe(false);
    expect(work(undefined, true)).toBe(true);
    expect(work({ sourceKernelSessionId: 'kernel-a', throughPosition: 4 }, false)).toBe(true);
    expect(work({ sourceKernelSessionId: 'kernel-a', throughPosition: null }, false)).toBe(false);
    // Basis and cursor together: either one alone is enough, so both rows are true.
    expect(work({ sourceKernelSessionId: 'kernel-a', throughPosition: 4 }, true)).toBe(true);
    expect(work({ sourceKernelSessionId: 'kernel-a', throughPosition: null }, true)).toBe(true);
  });

  it('PC-18 a Query follows its basis when present and the cursor only without one', () => {
    const query = (sessionBasis: { sourceKernelSessionId: string; throughPosition: number | null } | undefined,
      hasCompletedCursor: boolean) => takesSessionHistoryOf({ callKind: 'query', sessionBasis, hasCompletedCursor });
    expect(query(undefined, false)).toBe(false);
    expect(query(undefined, true)).toBe(true);
    expect(query({ sourceKernelSessionId: 'kernel-q', throughPosition: 5 }, false)).toBe(true);
    expect(query({ sourceKernelSessionId: 'kernel-q', throughPosition: 5 }, true)).toBe(true);
    expect(query({ sourceKernelSessionId: 'kernel-q', throughPosition: null }, false)).toBe(false);
    // A formal basis ignores the stored cursor: a Query with a null basis stays current.
    expect(query({ sourceKernelSessionId: 'kernel-q', throughPosition: null }, true)).toBe(false);
  });
});

describe('PC-18 the one Session history decision', () => {
  it('PC-18 a new Session takes no history', () => {
    expect(sessionHistoryDecision({ callKind: 'work', sessionBasis: undefined,
      completedBoundary: boundary(null, 0) }))
      .toEqual({ mode: 'current_turn', takesSessionHistory: false });
  });

  it('PC-18 an LA-1 seed with a non-null position and no cursor takes the source Session prefix', () => {
    expect(sessionHistoryDecision({ callKind: 'work',
      sessionBasis: { sourceKernelSessionId: 'kernel-a', throughPosition: 4 },
      completedBoundary: boundary(null, 0) }))
      .toEqual({ mode: 'session_history', takesSessionHistory: true,
        throughPosition: 4, sourceSessionId: 'kernel-a' });
  });

  it('PC-18 same-Session reuse follows the completed cursor, never the seed', () => {
    expect(sessionHistoryDecision({ callKind: 'work',
      sessionBasis: { sourceKernelSessionId: 'kernel-a', throughPosition: 4 },
      completedBoundary: boundary('cursor-7', 7) }))
      .toEqual({ mode: 'session_history', takesSessionHistory: true,
        throughPosition: 7, sourceSessionId: null });
  });

  it('PC-18 Work with no seed and a cursor follows the real completed boundary', () => {
    expect(sessionHistoryDecision({ callKind: 'work', sessionBasis: undefined,
      completedBoundary: boundary('cursor-3', 3) }))
      .toEqual({ mode: 'session_history', takesSessionHistory: true,
        throughPosition: 3, sourceSessionId: null });
  });

  it('PC-18 a Query with a formal basis uses it and reads no boundary', () => {
    expect(sessionHistoryDecision({ callKind: 'query',
      sessionBasis: { sourceKernelSessionId: 'kernel-q', throughPosition: 5 } }))
      .toEqual({ mode: 'session_history', takesSessionHistory: true,
        throughPosition: 5, sourceSessionId: 'kernel-q' });
    expect(sessionHistoryDecision({ callKind: 'query',
      sessionBasis: { sourceKernelSessionId: 'kernel-q', throughPosition: null } }))
      .toEqual({ mode: 'current_turn', takesSessionHistory: false });
  });

  it('PC-18 a Query without a basis follows the real completed boundary', () => {
    expect(sessionHistoryDecision({ callKind: 'query', sessionBasis: undefined,
      completedBoundary: boundary(null, 0) }))
      .toEqual({ mode: 'current_turn', takesSessionHistory: false });
    expect(sessionHistoryDecision({ callKind: 'query', sessionBasis: undefined,
      completedBoundary: boundary('cursor-9', 9) }))
      .toEqual({ mode: 'session_history', takesSessionHistory: true,
        throughPosition: 9, sourceSessionId: null });
  });
});
