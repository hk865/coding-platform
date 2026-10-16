/**
 * Slice 4C RW-5 / §11.6 R4 / L23: the one shared stage-continuity function.
 * Expected values are hand-computed from the spec; no database or record store
 * is read. `note-views.ts:559-569` is the loop this function freezes.
 */
import { describe, expect, it } from 'vitest';
import { stageContinuityOf } from '../../src/core/work-graph/notes/note-continuity.js';

describe('S4C RW-5 stage continuity', () => {
  it('RW-5 S@p1, absent in p2, back in p3 → retired', () => {
    const stagesByRevision = new Map<number, readonly string[]>([[1, ['s']], [2, []], [3, ['s']]]);
    expect(stageContinuityOf({ stageId: 's', anchorRevision: 1, currentRevision: 3, stagesByRevision }))
      .toEqual({ status: 'retired', reason: 'stage_not_in_current_plan' });
  });

  it('RW-5 present in every revision 1..3 → continuous', () => {
    const stagesByRevision = new Map<number, readonly string[]>([
      [1, ['s', 'other']], [2, ['s']], [3, ['other', 's']],
    ]);
    expect(stageContinuityOf({ stageId: 's', anchorRevision: 1, currentRevision: 3, stagesByRevision }))
      .toEqual({ status: 'continuous' });
  });

  it('RW-5 a missing revision in the window → unchecked', () => {
    const stagesByRevision = new Map<number, readonly string[]>([[1, ['s']], [3, ['s']]]);
    expect(stageContinuityOf({ stageId: 's', anchorRevision: 1, currentRevision: 3, stagesByRevision }))
      .toEqual({ status: 'unchecked' });
  });

  it('RW-5 anchorRevision > currentRevision → unchecked', () => {
    const stagesByRevision = new Map<number, readonly string[]>([[2, ['s']]]);
    expect(stageContinuityOf({ stageId: 's', anchorRevision: 3, currentRevision: 2, stagesByRevision }))
      .toEqual({ status: 'unchecked' });
  });

  it('RW-5 currentRevision null → unchecked', () => {
    const stagesByRevision = new Map<number, readonly string[]>([[1, ['s']]]);
    expect(stageContinuityOf({ stageId: 's', anchorRevision: 1, currentRevision: null, stagesByRevision }))
      .toEqual({ status: 'unchecked' });
  });
});
