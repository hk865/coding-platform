/**
 * The one line diff over real text, shared by the attention observer and the
 * Run activity tally. The task map's uncommitted read (E3-7) counts git lines
 * with the same algorithm.
 *
 * It lives in `contracts` because both `app` and `core` read it and `core` may
 * not import `app` (decision 90-8, D-18). A same-size replacement, a rollback
 * and a tombstone are all real changes; a repeated identical pair is not.
 */

const MAX_LCS_CELLS = 250_000;

/** The lines of one text; the empty text and a missing file both have none. */
export function contentLines(content: string | null): string[] {
  if (content === null || content === '') return [];
  return content.split('\n');
}

/** The lines of one text the way git counts them (E3-7): each line runs to its `\n`, and a last
 * line without one is a line of its own, so `a` and `a\n` differ and the empty text has none. */
export function gitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/**
 * The fewest added and deleted lines between two line lists: the longest common subsequence up
 * to MAX_LCS_CELLS, Myers beyond. `maxDistance` bounds only the Myers search: once the edit
 * distance passes it the answer is `null`, never a guess (E3-7). Without it the answer is never null.
 */
export function lineEditCounts(
  before: readonly string[], after: readonly string[], maxDistance = Number.POSITIVE_INFINITY,
): { added: number; deleted: number } | null {
  if (before.length === 0) return { added: after.length, deleted: 0 };
  if (after.length === 0) return { added: 0, deleted: before.length };
  if (before.length * after.length <= MAX_LCS_CELLS) {
    // Longest common subsequence length, one row at a time.
    let previousRow = new Int32Array(after.length + 1);
    let currentRow = new Int32Array(after.length + 1);
    for (let i = 1; i <= before.length; i += 1) {
      for (let j = 1; j <= after.length; j += 1) {
        currentRow[j] = before[i - 1] === after[j - 1]
          ? previousRow[j - 1]! + 1
          : Math.max(previousRow[j]!, currentRow[j - 1]!);
      }
      const swap = previousRow;
      previousRow = currentRow;
      currentRow = swap;
      currentRow.fill(0);
    }
    const common = previousRow[after.length]!;
    return { added: after.length - common, deleted: before.length - common };
  }
  // Myers edit distance preserves line order without allocating the N×M table.
  // A rearrangement is a real delete/insert sequence, never a made-up counter.
  const frontier = new Map<number, number>([[1, 0]]);
  for (let distance = 0; distance <= before.length + after.length; distance += 1) {
    if (distance > maxDistance) return null;
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const left = frontier.get(diagonal - 1) ?? -1;
      const right = frontier.get(diagonal + 1) ?? -1;
      let x = diagonal === -distance || (diagonal !== distance && left < right) ? right : left + 1;
      let y = x - diagonal;
      while (x < before.length && y < after.length && before[x] === after[y]) { x += 1; y += 1; }
      frontier.set(diagonal, x);
      if (x >= before.length && y >= after.length) {
        const added = (distance + after.length - before.length) / 2;
        return { added, deleted: distance - added };
      }
    }
  }
  throw new Error('line diff did not reach the content boundary');
}

/** A real line diff between two texts; no counter arithmetic. */
export function lineDelta(
  previous: string | null,
  current: string | null,
): { added: number; deleted: number; totalLines: number } {
  const after = contentLines(current);
  // Unbounded, so never null.
  const counts = lineEditCounts(contentLines(previous), after)!;
  return { added: counts.added, deleted: counts.deleted, totalLines: after.length };
}
