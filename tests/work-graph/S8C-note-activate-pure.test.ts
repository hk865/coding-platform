/**
 * 8C G1 N1 — `S4-NOTE-09`: the pure `activate`
 * transition. A staged repair becomes accepted at the next head version with
 * its body and digest unchanged; the staging run is cleared, the note is not
 * user-confirmed, and a second activation is refused. The store CAS and the
 * public acceptance read are G3's; this row observes only the state return.
 */
import { describe, expect, it } from 'vitest';
import type { NoteBodyV1, NoteHeadSnapshot, RepairPayloadV1 } from '../../src/contracts/note.js';
import { repairBindingDigest } from '../../src/core/work-graph/architecture/repair-ops.js';
import { noteBodyOf, transitionNote } from '../../src/core/work-graph/state/note-machine.js';

const PAYLOAD: RepairPayloadV1 = {
  pin: {
    catalogRef: { aggregateType: 'ArchitectureCatalog', projectId: 'p1', baselineId: 'b1', revision: 3 },
    baseline: { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: 'p1', baselineId: 'b1',
      revision: 3 }, digest: 'a'.repeat(64) },
  },
  ops: [{ op: 'set_responsibility', moduleId: 'M', text: 'the repaired responsibility' }],
  responsibilityMoves: [],
  structural: false,
};

function stagedRepair(): NoteHeadSnapshot {
  return {
    ref: { aggregateType: 'NoteHead', projectId: 'p1', noteId: 'n1' },
    noteId: 'n1', version: 4, state: 'staged', goalId: 'g1',
    source: { kind: 'agent', sessionRef: { projectId: 'p1', sessionId: 's1' },
      runRef: { aggregateType: 'Run', projectId: 'p1', goalId: 'g1', runId: 'r1' },
      queryRunRef: null, duty: 'executor' },
    stagedRunKey: 'g1/r1',
    reviewReasons: [], confirmedByUser: false,
    anchorKey0: 'module:M', anchorKey1: null, anchorKey2: null, anchorKey3: null, anchorKey4: null,
    createdAt: '2026-11-02T00:00:00.000Z', since: 'c1' as never,
    kind: 'repair', topic: 'repair M', topicKey: 'repair m', conclusion: 'repair M',
    body: 'repair the module responsibility', anchor: { kind: 'module', moduleId: 'M' },
    extraAnchors: [], facts: [],
    basis: { planRevision: null, catalogRevision: 3, files: [] },
    structural: false, replaces: [], contradicts: [], coexistWith: [],
    repair: PAYLOAD,
  };
}

describe('S8C N1 S4-NOTE-09 activate', () => {
  it('N1: a staged repair activates to the next version and refuses a second activation', () => {
    const head = stagedRepair();
    const beforeBody: NoteBodyV1 = noteBodyOf(head);
    const beforeDigest = repairBindingDigest(beforeBody);

    const activated = transitionNote(head, { kind: 'activate' });
    expect(activated.ok).toBe(true);
    if (!activated.ok) return;
    expect(activated.effects).toEqual([]);
    expect(activated.next).toMatchObject({ noteId: 'n1', version: 5, state: 'accepted',
      stagedRunKey: null, confirmedByUser: false });

    const afterBody = noteBodyOf(activated.next);
    expect(afterBody).toEqual(beforeBody);
    expect(repairBindingDigest(afterBody)).toBe(beforeDigest);

    const second = transitionNote(activated.next as unknown as NoteHeadSnapshot, { kind: 'activate' });
    expect(second).toMatchObject({ ok: false, code: 'invalid' });
  });
});
