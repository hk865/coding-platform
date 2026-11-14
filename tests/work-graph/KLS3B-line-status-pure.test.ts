/**
 * KLS-3b (test writer, decision 117): row 3B-10 of the start rulings draft v2 §3, the line-end decision as a pure table
 * (A5). `nextLineStatus(line, facts)` (§2.2) is the one judgement of a line's end: only an open line moves; a removed
 * workspace, a missing folder or a missing branch ends it `removed` (121-90); the base line never merges into itself
 * (design rule 19); an empty repository, a line still at its fork point, a HEAD that is not an ancestor of the base,
 * a tree that is not clean (design rule 11), or a fact git could not answer (null), leaves it as it is; all of them
 * together are `merged`. Each case starts from the facts of a merged line and changes one, so deleting the check it names turns
 * that case into `merged` (F11).
 *
 * Red today (a2b618dd): `state/line-machine.ts` exports `newLineRecord` only, so `nextLineStatus` is not a function and
 * every case throws. Green when KLS-3b adds the decision.
 */
import { describe, expect, it } from 'vitest';
import type { LineSnapshot } from '../../src/contracts/line.js';
import { nextLineStatus, type LineStatusFacts } from '../../src/core/work-graph/state/line-machine.js';

const FORK = 'f'.repeat(40);
const LATER = 'b'.repeat(40);
const OPEN: LineSnapshot = {
  ref: { aggregateType: 'Line', projectId: 'kls3b-p', workspaceId: 'kls3b-ws', lineRef: '["kls3b-ws","/repo-wt"]' },
  revision: 1, repoKey: '/repo/.git', folder: '/repo-wt', branch: 'wt', firstCommit: 'a'.repeat(40), forkPoint: FORK,
  status: 'open', createdAt: '2026-11-14T00:00:00.000Z', closedAt: null,
};
/** A line that moved past its fork point, is an ancestor of the base HEAD and has a clean tree. */
const MERGED: LineStatusFacts = { isBaseLine: false, workspaceRemoved: false, folderExists: true, branchExists: true,
  head: LATER, forkPoint: FORK, ancestorOfBase: true, worktreeClean: true };
const CLOSED_AT = '2026-11-14T01:00:00.000Z';

describe('KLS-3b 3B-10 nextLineStatus', () => {
  it.each<[string, Partial<LineSnapshot>, Partial<LineStatusFacts>, 'merged' | 'removed' | null]>([
    ['all merge facts hold', {}, {}, 'merged'],
    ['the base line never merges into itself (design rule 19)', {}, { isBaseLine: true }, null],
    ['a line still at its fork point is not merged', {}, { head: FORK }, null],
    ['a tree with uncommitted code or knowledge keeps it open (design rule 11)', {}, { worktreeClean: false }, null],
    ['a clean state git could not read keeps it open', {}, { worktreeClean: null }, null],
    ['a HEAD that is not an ancestor of the base keeps it open', {}, { ancestorOfBase: false }, null],
    ['an ancestry git could not read keeps it open', {}, { ancestorOfBase: null }, null],
    ['an empty repository (no HEAD) keeps it open', {}, { head: null }, null],
    ['a line with no fork point keeps it open', {}, { forkPoint: null }, null],
    ['a removed workspace ends its line (121-90)', {}, { workspaceRemoved: true }, 'removed'],
    ['a missing folder ends the line', {}, { folderExists: false }, 'removed'],
    ['a missing branch ends the line', {}, { branchExists: false }, 'removed'],
    ['the base line of a removed workspace ends too', {}, { isBaseLine: true, workspaceRemoved: true }, 'removed'],
    ['a merged line does not move again', { status: 'merged', closedAt: CLOSED_AT }, { workspaceRemoved: true }, null],
    ['a removed line does not move again', { status: 'removed', closedAt: CLOSED_AT }, {}, null],
  ])('%s', (_case, line, facts, expected) => {
    expect(nextLineStatus({ ...OPEN, ...line }, { ...MERGED, ...facts })).toBe(expected);
  });
});
