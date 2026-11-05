import { describe, expect, it } from 'vitest';
import { gitLines, lineDelta, lineEditCounts } from '../../src/contracts/line-delta.js';

/** E37-L1–L3 (spec §4.3, §5): git's line split, the fewest added/deleted lines with
 * the Myers cap, and `lineDelta` unchanged. Pure (A5); every literal is hand-counted. */
/* Two sides with no common line: the fewest edits delete all and add all. */
const rewrite = (p: string, n: number): string[] => Array.from({ length: n }, (_, i) => p + i + '\n');

describe('E37-L line counts', () => {
  /* Named mutation: split on '\n' (the 'a\n' row gets two items). */
  it.each([
    ['', []], ['a', ['a']], ['a\n', ['a\n']], ['a\nb', ['a\n', 'b']], ['\n', ['\n']], ['a\n\nb\n', ['a\n', '\n', 'b\n']],
  ])('E37-L1 gitLines(%j) is %j (spec §4.3)', (text, lines) => {
    expect(gitLines(text)).toEqual(lines);
  });

  /* Named mutations: the cap also stops the LCS branch (the "LCS ignores the cap" row turns);
     the cap compared with >= (the "exactly at the cap" row turns). */
  it.each([
    ['a new file', [], ['a\n', 'b\n'], undefined, { added: 2, deleted: 0 }],
    ['all deleted', ['a\n', 'b\n', 'c\n'], [], undefined, { added: 0, deleted: 3 }],
    ['a newline added to the last line (a and a\\n differ)', ['a'], ['a\n'], undefined, { added: 1, deleted: 1 }],
    ['one line changed (LCS 1)', ['a\n', 'b\n'], ['a\n', 'c\n'], undefined, { added: 1, deleted: 1 }],
    ['over the cap (360,000 cells, Myers, distance 1,200 > 1,000)', rewrite('a', 600), rewrite('b', 600), 1000, null],
    ['exactly at the cap (1,200 is not over 1,200)', rewrite('a', 600), rewrite('b', 600), 1200, { added: 600, deleted: 600 }],
    ['no cap', rewrite('a', 600), rewrite('b', 600), undefined, { added: 600, deleted: 600 }],
    ['LCS ignores the cap (160,000 cells)', rewrite('a', 400), rewrite('b', 400), 10, { added: 400, deleted: 400 }],
    ['one side empty ignores the cap', [], rewrite('a', 3000), 10, { added: 3000, deleted: 0 }],
  ])('E37-L2 lineEditCounts: %s (spec §4.3)', (_, before, after, maxDistance, counts) => {
    expect(lineEditCounts(before, after, maxDistance)).toEqual(counts);
  });

  /* Named mutation: lineDelta switches to gitLines (added becomes 1). */
  it('E37-L3 lineDelta still splits on \\n: a\\n is two lines (spec §5, line-delta.ts:13-16)', () => {
    expect(lineDelta(null, 'a\n')).toEqual({ added: 2, deleted: 0, totalLines: 2 });
  });
});
