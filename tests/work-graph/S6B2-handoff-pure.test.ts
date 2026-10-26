/**
 * Row 23's pure rule, moved out of the Host scene (AH-24): the brief is ready only after the guarded archive
 * committed and the routing set read to a close, with every root routed or explicitly skipped.
 */
import { describe, expect, it } from 'vitest';
import { SessionRefShape } from '../../src/contracts/data-format-refs.js';
import { checkShape } from '../../src/contracts/validation/data-format.js';
import { briefReady, type BriefReadyFacts } from '../../src/core/work-graph/state/session-handoff.js';

const routed = { receipt: 'c0000000001', skipped: null } as const;
const skipped = { receipt: null, skipped: 'owner_changed' } as const;
const waiting = { receipt: null, skipped: null } as const;

describe('row 23: briefReady needs the guarded archive and the complete routing set', () => {
  it.each<[string, BriefReadyFacts, boolean]>([
    ['the archive is pending or partial', { archiveCommitted: false,
      routing: { closed: true, roots: [routed] } }, false],
    ['the routing set was never read', { archiveCommitted: true, routing: null }, false],
    ['the routing set is still open', { archiveCommitted: true,
      routing: { closed: false, roots: [routed] } }, false],
    ['a root still waits for its routing command', { archiveCommitted: true,
      routing: { closed: true, roots: [waiting] } }, false],
    ['a routed and an owner-changed root complete the set', { archiveCommitted: true,
      routing: { closed: true, roots: [routed, skipped] } }, true],
    ['an empty complete set is complete once the archive committed', { archiveCommitted: true,
      routing: { closed: true, roots: [] } }, true],
  ])('answers %s', (_name, facts, expected) => {
    expect(briefReady(facts)).toBe(expected);
  });
});

describe('row 23: the brief read input at the JSON boundary', () => {
  it.each([
    ['no session', {}],
    ['an empty session', { session: {} }],
    ['a session without an id', { session: { projectId: 'p1' } }],
  ])('refuses %s', (_name, body) => {
    const raw = JSON.parse(JSON.stringify(body)) as { session?: unknown };
    expect(checkShape(SessionRefShape, raw.session, 'stored')).toContain('SessionRef');
  });
});
