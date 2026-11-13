/**
 * Row C-state (pure, A5): the admission truth table of `admitNoteWrite`. Each case changes one fact
 * of the agent `link` base; the whole admission object is the expected value. A link is never
 * staged, only a repair is; the user's write never waits on a reason; structural only counts for
 * `understanding`. The old kinds keep their outcomes.
 */
import { describe, expect, it } from 'vitest';
import type { NoteWriteAdmissionV1, NoteWriteFactsV1 } from '../../src/core/work-graph/state/note-machine.js';
import { admitNoteWrite } from '../../src/core/work-graph/state/note-machine.js';

const LINK: NoteWriteFactsV1 = {
  kind: 'link',
  structural: false,
  contradicts: [],
  userNoteReplaced: false,
  anchorFull: false,
  goalFull: false,
  isUser: false,
  structuralAutoApproved: false,
};

type Case = { name: string; facts: NoteWriteFactsV1; expected: NoteWriteAdmissionV1 };

const CASES: readonly Case[] = [
  {
    name: 'an agent link at an empty anchor and goal is accepted',
    facts: LINK,
    expected: { status: 'accepted', state: 'accepted', reviewReasons: [], overQuota: false, confirmedByUser: false },
  },
  {
    name: 'a link contradicting a current note is pending for contradiction',
    facts: { ...LINK, contradicts: ['n1'] },
    expected: { status: 'pending_review', state: 'pending_review', reviewReasons: ['contradiction'], overQuota: false,
      confirmedByUser: false },
  },
  {
    name: 'a link that replaces the user note is pending for the user note replacement',
    facts: { ...LINK, userNoteReplaced: true },
    expected: { status: 'pending_review', state: 'pending_review', reviewReasons: ['user_note_replaced'],
      overQuota: false, confirmedByUser: false },
  },
  {
    name: 'a full anchor makes a link pending but is not over quota while pending',
    facts: { ...LINK, anchorFull: true },
    expected: { status: 'pending_review', state: 'pending_review', reviewReasons: ['quota_full'], overQuota: false,
      confirmedByUser: false },
  },
  {
    name: 'a full goal makes a link pending and over quota',
    facts: { ...LINK, goalFull: true },
    expected: { status: 'pending_review', state: 'pending_review', reviewReasons: ['quota_full'], overQuota: true,
      confirmedByUser: false },
  },
  {
    name: 'structural on a link is ignored, since structural belongs to understanding',
    facts: { ...LINK, structural: true },
    expected: { status: 'accepted', state: 'accepted', reviewReasons: [], overQuota: false, confirmedByUser: false },
  },
  {
    name: 'the user write is accepted without reasons even when every flag is set',
    facts: { ...LINK, isUser: true, contradicts: ['n1'], anchorFull: true, goalFull: true, userNoteReplaced: true },
    expected: { status: 'accepted', state: 'accepted', reviewReasons: [], overQuota: true, confirmedByUser: true },
  },
  {
    name: 'a repair is always staged, and over quota only by the goal',
    facts: { ...LINK, kind: 'repair', goalFull: true },
    expected: { status: 'staged', state: 'staged', reviewReasons: [], overQuota: true, confirmedByUser: false },
  },
  {
    name: 'a structural understanding is pending for structural',
    facts: { ...LINK, kind: 'understanding', structural: true },
    expected: { status: 'pending_review', state: 'pending_review', reviewReasons: ['structural'], overQuota: false,
      confirmedByUser: false },
  },
  {
    name: 'the old pitfall kind with every flag false is accepted',
    facts: { ...LINK, kind: 'pitfall' },
    expected: { status: 'accepted', state: 'accepted', reviewReasons: [], overQuota: false, confirmedByUser: false },
  },
];

describe('admitNoteWrite: the 8E link truth table', () => {
  it.each(CASES)('$name', ({ facts, expected }) => {
    const admission = admitNoteWrite(facts);
    expect(admission).toEqual(expected);
    if (facts.kind === 'link') expect(admission.status).not.toBe('staged');
  });
});
