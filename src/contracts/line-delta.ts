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

/** 编辑距离超过这个数就停止 Myers 搜索：未提交读（`files/uncommitted`）不给加减行，Diff 页不给逐行。 */
export const LINE_DIFF_MAX_DISTANCE = 1000;

/** P3 Diff：两份行列表之间改动最少的逐行脚本，每行一个记号（' ' 保留、'-' 删、'+' 加），按顺序；
 *  每一段连续的改动里删的行在前、加的行在后（git 的写法）：照 lineEditCounts 的前沿规则，删的行自然排在加的行前面，不另重排。
 *  头尾相同的行直接保留，不搜；两边中间都不空时，乘积不超过 MAX_LCS_CELLS 就用 LCS 回走（不受 maxDistance 限制），
 *  超过才用 Myers 搜，编辑距离超过 maxDistance 就回 null。 */
export function lineEditScript(
  before: readonly string[], after: readonly string[], maxDistance: number,
): Array<' ' | '-' | '+'> | null {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  const a = before.slice(prefix, before.length - suffix);
  const b = after.slice(prefix, after.length - suffix);
  const script: Array<' ' | '-' | '+'> = [];
  for (let index = 0; index < prefix; index += 1) script.push(' ');
  const middle: Array<' ' | '-' | '+'> = [];
  if (a.length === 0) {
    for (let index = 0; index < b.length; index += 1) middle.push('+');
  } else if (b.length === 0) {
    for (let index = 0; index < a.length; index += 1) middle.push('-');
  } else if (before.length * after.length <= MAX_LCS_CELLS) {
    /* 小文件：整张 LCS 表回走，不受 maxDistance 限制。平局走加，倒过来看就是删的行在前。 */
    const columns = b.length + 1;
    const table = new Int32Array((a.length + 1) * columns);
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        table[i * columns + j] = a[i - 1] === b[j - 1]
          ? table[(i - 1) * columns + j - 1]! + 1
          : Math.max(table[(i - 1) * columns + j]!, table[i * columns + j - 1]!);
      }
    }
    let i = a.length;
    let j = b.length;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        middle.push(' '); i -= 1; j -= 1;
      } else if (table[(i - 1) * columns + j]! > table[i * columns + j - 1]!) {
        middle.push('-'); i -= 1;
      } else {
        middle.push('+'); j -= 1;
      }
    }
    while (i > 0) { middle.push('-'); i -= 1; }
    while (j > 0) { middle.push('+'); j -= 1; }
    middle.reverse();
  } else {
    /* 前沿照 lineEditCounts 的规则（平局走删除）；每一轮存下 [-d, d] 这一段，好倒着走回脚本。 */
    const trace: Array<Map<number, number>> = [];
    const frontier = new Map<number, number>([[1, 0]]);
    const limit = Math.min(maxDistance, a.length + b.length);
    let found = -1;
    for (let distance = 0; distance <= limit; distance += 1) {
      trace.push(new Map(frontier));
      for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
        const left = frontier.get(diagonal - 1) ?? -1;
        const right = frontier.get(diagonal + 1) ?? -1;
        let x = diagonal === -distance || (diagonal !== distance && left < right) ? right : left + 1;
        let y = x - diagonal;
        while (x < a.length && y < b.length && a[x] === b[y]) { x += 1; y += 1; }
        frontier.set(diagonal, x);
        if (x >= a.length && y >= b.length) { found = distance; break; }
      }
      if (found >= 0) break;
    }
    if (found < 0) return null;
    let x = a.length;
    let y = b.length;
    for (let distance = found; distance >= 0; distance -= 1) {
      const saved = trace[distance]!;
      const diagonal = x - y;
      const left = saved.get(diagonal - 1) ?? -1;
      const right = saved.get(diagonal + 1) ?? -1;
      const previous = diagonal === -distance || (diagonal !== distance && left < right) ? diagonal + 1 : diagonal - 1;
      const previousX = saved.get(previous) ?? 0;
      const previousY = previousX - previous;
      while (x > previousX && y > previousY) { middle.push(' '); x -= 1; y -= 1; }
      if (distance > 0) {
        if (x === previousX) { middle.push('+'); y -= 1; } else { middle.push('-'); x -= 1; }
      }
    }
    middle.reverse();
  }
  script.push(...middle);
  for (let index = 0; index < suffix; index += 1) script.push(' ');
  return script;
}
