/**
 * S4C2-2 (spec §11.4/§11.6, D-15, ruling U-8): the pure
 * `pendingUnderstandingOverridden(pending, current)` predicate in
 * `state/note-machine.ts`. True iff the pending note is an `understanding` in
 * `pending_review`, the current head is non-null and `accepted`/`reviewed` on
 * the same primary anchor, and `current.createdAt > pending.createdAt`.
 */
import { describe, expect, it } from 'vitest';
import type { CommitCursor } from '../../src/contracts/command-event.js';
import type { NoteHeadSnapshot } from '../../src/contracts/note.js';
import { pendingUnderstandingOverridden } from '../../src/core/work-graph/state/note-machine.js';

const EARLY = '2026-10-01T00:00:00.000Z';
const LATE = '2026-10-02T00:00:00.000Z';

const BASE: NoteHeadSnapshot = {
  ref: { aggregateType: 'NoteHead', projectId: 's4c2', noteId: 'n1' },
  noteId: 'n1',
  version: 1,
  state: 'pending_review',
  goalId: 'g1',
  source: { kind: 'platform' },
  stagedRunKey: null,
  reviewReasons: [],
  confirmedByUser: false,
  anchorKey0: 'goal:g1',
  anchorKey1: null,
  anchorKey2: null,
  anchorKey3: null,
  anchorKey4: null,
  createdAt: EARLY,
  since: 'c1' as CommitCursor,
  kind: 'understanding',
  topic: 'understanding',
  topicKey: 'understanding',
  conclusion: 'current',
  body: '',
  anchor: { kind: 'goal', goalId: 'g1' },
  extraAnchors: [],
  facts: [],
  basis: { planRevision: null, catalogRevision: null, files: [] },
  structural: false,
  replaces: [],
  contradicts: [],
  coexistWith: [],
};

/** Build a head by overriding only the four fields these cases observe. */
function head(overrides: {
  kind?: NoteHeadSnapshot['kind'];
  state?: NoteHeadSnapshot['state'];
  anchorKey0?: string;
  createdAt?: string;
} = {}): NoteHeadSnapshot {
  return {
    ...BASE,
    kind: overrides.kind ?? BASE.kind,
    state: overrides.state ?? BASE.state,
    anchorKey0: overrides.anchorKey0 ?? BASE.anchorKey0,
    createdAt: overrides.createdAt ?? BASE.createdAt,
  };
}

describe('S4C2-2 pendingUnderstandingOverridden (spec §11.4/§11.6, D-15, U-8)', () => {
  it('S4C2-2a: a non-understanding pending note is never overridden', () => {
    expect(pendingUnderstandingOverridden(head({ kind: 'pitfall' }), head({ state: 'accepted', createdAt: LATE })))
      .toBe(false);
  });

  it('S4C2-2b: a pending note that is not in pending_review is never overridden', () => {
    expect(pendingUnderstandingOverridden(head({ state: 'accepted' }), head({ state: 'accepted', createdAt: LATE })))
      .toBe(false);
  });

  it('S4C2-2c: with no current head nothing is overridden', () => {
    expect(pendingUnderstandingOverridden(head(), null)).toBe(false);
  });

  it('S4C2-2d: a current head that is not accepted or reviewed never overrides', () => {
    expect(pendingUnderstandingOverridden(head(), head({ state: 'pending_review', createdAt: LATE }))).toBe(false);
    expect(pendingUnderstandingOverridden(head(), head({ state: 'staged', createdAt: LATE }))).toBe(false);
  });

  it('S4C2-2e: a current head on another primary anchor never overrides', () => {
    expect(pendingUnderstandingOverridden(head(), head({ state: 'accepted', anchorKey0: 'goal:g2', createdAt: LATE })))
      .toBe(false);
  });

  it('S4C2-2f: only a current head created strictly after the pending one overrides it', () => {
    expect(pendingUnderstandingOverridden(head({ createdAt: LATE }), head({ state: 'accepted', createdAt: EARLY })))
      .toBe(false);
    expect(pendingUnderstandingOverridden(head({ createdAt: EARLY }), head({ state: 'accepted', createdAt: EARLY })))
      .toBe(false);
    expect(pendingUnderstandingOverridden(head({ createdAt: EARLY }), head({ state: 'accepted', createdAt: LATE })))
      .toBe(true);
    expect(pendingUnderstandingOverridden(head({ createdAt: EARLY }), head({ state: 'reviewed', createdAt: LATE })))
      .toBe(true);
  });
});
