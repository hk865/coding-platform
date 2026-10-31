/**
 * Whether a module overlap gate is satisfied: a release wins even when a start cursor is missing, a note must be
 * accepted or reviewed, be a convention or decision, anchor on the gate's module (module or interface) and come
 * after every running start; otherwise the gate is not satisfied, and a missing cursor without a release is not
 * computable. Pure A5: note versions are built here as the caller's input; no store, platform, Host, Workflow or
 * Runtime is imported.
 */
import { describe, expect, it } from 'vitest';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import type { NoteVersionSnapshot } from '../../src/contracts/note.js';
import type { ModuleOverlapGateV1 } from '../../src/core/work-graph/persistence/module-overlap-gate-codecs.js';
import type { OverlapGateStatusV1 } from '../../src/core/work-graph/tasks/overlap-gates.js';
import { overlapGateSatisfied } from '../../src/core/work-graph/tasks/overlap-gates.js';
import { S7C_GATE_SENT, S7C_GATE_UNSENT } from '../helpers/S7C-n-overlap-fixture.js';

const BASE_NOTE: NoteVersionSnapshot = {
  ref: { aggregateType: 'NoteVersion', projectId: 'p1', noteId: 'n1', version: 1 },
  noteId: 'n1',
  version: 1,
  state: 'accepted',
  goalId: 'g1',
  kind: 'convention',
  topic: 'the module boundary',
  topicKey: 'module-boundary',
  conclusion: 'm1 owns its boundary',
  body: 'the boundary belongs to m1',
  anchor: { kind: 'module', moduleId: 'm1' },
  extraAnchors: [],
  facts: [],
  basis: { planRevision: 3, catalogRevision: null, files: [] },
  structural: false,
  replaces: [],
  contradicts: [],
  coexistWith: [],
  source: { kind: 'user', principalId: 'u1' },
  reviewReasons: [],
  noticeClass: null,
  change: {
    kind: 'write',
    by: { kind: 'user', principalId: 'u1' },
    reason: null,
    decisionMessageRef: null,
  },
  at: '2026-10-27T20:00:00Z',
  since: makeCommitCursor(21),
};

const note = (since: number, over: Partial<NoteVersionSnapshot> = {}): NoteVersionSnapshot =>
  ({ ...BASE_NOTE, since: makeCommitCursor(since), ...over });

const BOTH_STARTED: ModuleOverlapGateV1 = {
  ...S7C_GATE_UNSENT,
  running: [
    { ...S7C_GATE_UNSENT.running[0]!, startCursor: makeCommitCursor(10) },
    { ...S7C_GATE_UNSENT.running[1]!, startCursor: makeCommitCursor(20) },
  ],
};

const ONLY_FIRST_STARTED: ModuleOverlapGateV1 = { ...S7C_GATE_UNSENT, running: [BOTH_STARTED.running[0]!] };

describe('overlapGateSatisfied', () => {
  it.each<[string, ModuleOverlapGateV1, readonly NoteVersionSnapshot[], OverlapGateStatusV1]>([
    ['a release with a null start cursor', S7C_GATE_SENT, [], { status: 'satisfied', by: 'release' }],
    ['a note after both starts', BOTH_STARTED, [note(21)], { status: 'satisfied', by: 'note' }],
    ['a note between the two starts', BOTH_STARTED, [note(15)], { status: 'not_satisfied' }],
    ['a note before the only start', ONLY_FIRST_STARTED, [note(5)], { status: 'not_satisfied' }],
    ['an interface anchor on the gate module', BOTH_STARTED,
      [note(21, { anchor: { kind: 'interface', moduleId: 'm1', interfaceId: 'if1' } })],
      { status: 'satisfied', by: 'note' }],
    ['an anchor on another module', BOTH_STARTED,
      [note(21, { anchor: { kind: 'module', moduleId: 'm2' } })], { status: 'not_satisfied' }],
    ['a staged convention note', BOTH_STARTED, [note(21, { state: 'staged' })], { status: 'not_satisfied' }],
    ['an accepted pitfall note', BOTH_STARTED, [note(21, { kind: 'pitfall' })], { status: 'not_satisfied' }],
    ['no release and a null start cursor', S7C_GATE_UNSENT, [],
      { status: 'not_computable', reason: 'start_cursor' }],
  ])('%s', (_label, gate, notes, expected) => {
    expect(overlapGateSatisfied(gate, notes)).toEqual(expected);
  });
});
