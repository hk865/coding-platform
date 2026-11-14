/**
 * KLS-3b (test writer, decision 117): row 3B-16 of the start rulings draft v2 §3, the lead's ruling 甲 on `firstCommit`
 * (next1113c "KLS-3b 草稿按 KLS-3a 实际代码重对" §9 1) as a pure table (A5). The probe of a checkout carries `shallow`
 * and all its `roots` (draft §10 (d): `CheckoutProbe.shallow`, `CheckoutProbe.roots`); only a checkout that is not
 * shallow and has one root is recognised as another clone by its first commit. Otherwise only the same common git
 * directory (`repoKey`) makes it the same repository, and an unrecognised one stays a new workspace (seen and
 * explained, never merged by mistake). The join compares an existing line with the probed checkout, so each case is
 * `sameCheckout(line, checkoutIdentityOf(probe))` with hand-written values.
 *
 * Red today (a2b618dd): the probe has no `shallow` or `roots`, `checkoutIdentityOf` keeps the first commit whatever
 * they say, and `sameCheckout` accepts the shallow clone and the two-root clone by that commit (the two `false` cases
 * fail). Green when KLS-3b applies ruling 甲 where the probed identity is made.
 */
import { describe, expect, it } from 'vitest';
import { sameCheckout, type CheckoutIdentity } from '../../src/contracts/line.js';
import { checkoutIdentityOf, type CheckoutProbe } from '../../src/core/workspace/workspace-change-capture.js';

const ROOT = '1'.repeat(40);
const OTHER_ROOT = '2'.repeat(40);
/** The workspace's existing line: the original repository, one root. */
const LINE: CheckoutIdentity = { repoKey: '/repo/.git', folder: '/repo', branch: 'main', firstCommit: ROOT };
type GitProbe = Extract<CheckoutProbe, { kind: 'git' }>;
/** Another clone of it (its own common git directory) whose history is complete and has one root. */
const CLONE: GitProbe = { kind: 'git', objectFormat: 'sha1', repoKey: '/clone/.git', folder: '/clone', branch: 'main',
  shallow: false, roots: [ROOT] };

describe('KLS-3b 3B-16 ruling 甲: a first commit names the repository only for a complete, single-root checkout', () => {
  it.each<[string, Partial<GitProbe>, boolean]>([
    ['a complete single-root clone is the same repository by its first commit', {}, true],
    ['a shallow clone whose boundary is the same commit is not', { shallow: true }, false],
    ['a complete clone of a two-root history is not', { roots: [ROOT, OTHER_ROOT] }, false],
    ['a shallow checkout of the same common git directory is', { repoKey: '/repo/.git', folder: '/repo-wt', shallow: true }, true],
    ['a two-root checkout of the same common git directory is',
      { repoKey: '/repo/.git', folder: '/repo-wt', roots: [ROOT, OTHER_ROOT] }, true],
  ])('%s', (_case, probe, expected) => {
    expect(sameCheckout(LINE, checkoutIdentityOf({ ...CLONE, ...probe }))).toBe(expected);
  });
});
