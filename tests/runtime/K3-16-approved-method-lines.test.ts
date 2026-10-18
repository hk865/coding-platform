/**
 * K3 row K3-16 (L20): `approvedMethodLinesZh`, the ONE pure function that both
 * the owner's byte-budget measurement and the continuation renderer use.
 *
 * L20: "命令和 cwd 里的 `\r\n`、`\n` 都换成 `\n` 加两个空格" — both the command
 * and the rendered cwd indent every newline with two spaces (like `clip`), and
 * the 5,120-byte budget counts those cwd indentation bytes too.
 *
 * The expected strings and bytes below are written literally from L20's line
 * format; they never call a second renderer.
 */
import { describe, expect, it } from 'vitest';
import { approvedMethodLinesZh } from '../../src/contracts/continuation-brief.js';

describe('K3-16 approvedMethodLinesZh (L20)', () => {
  it('K3-16 a newline in cwd is indented with two spaces exactly like a command newline', () => {
    const lines = approvedMethodLinesZh([{ alias: 1, command: 'echo ok', cwd: 'a\nb' }]);
    // L20's literal line: `- 方案 #<alias>，目录 <cwd ?? '.'>：\n  <command>`,
    // where cwd's `\n` becomes `\n  ` too.
    expect(lines).toEqual(['- 方案 #1，目录 a\n  b：\n  echo ok']);
  });

  it('K3-16 the 5,120-byte budget at the boundary counts the cwd indentation bytes', () => {
    // L20's line format, hand-computed in UTF-8 bytes:
    //   `- 方案 #<alias>，目录 ` = 2 (`- `) + 6 (`方案`) + 1 (space) + 2 (`#n`)
    //     + 3 (`，`) + 6 (`目录`) + 1 (space) = 21 bytes
    //   then the rendered cwd, `：` = 3, `\n  ` = 3, then the command.
    //
    // Method #1: alias 1, cwd "a\nb" renders as `a` + `\n  ` + `b` = 1+3+1 = 5
    //   bytes (the indentation is counted, not 3), command 'a' x 4,000 = 4,000:
    //   line = 21 + 5 + 3 + 3 + 4,000 = 4,032.
    // Method #2: alias 2, cwd null renders as `.` = 1 byte, command 'b' x 1,059:
    //   line = 21 + 1 + 3 + 3 + 1,059 = 1,087.
    // The two methods are joined with one `\n` = 1 byte.
    // Total = 4,032 + 1 + 1,087 = 5,120 bytes (exactly the owner's limit).
    const atLimit = [
      { alias: 1, command: 'a'.repeat(4_000), cwd: 'a\nb' },
      { alias: 2, command: 'b'.repeat(1_059), cwd: null },
    ];
    expect(Buffer.byteLength(approvedMethodLinesZh(atLimit).join('\n'), 'utf8')).toBe(5_120);

    // One extra command byte: 'b' x 1,060 makes method #2 1,088 and the total
    // 4,032 + 1 + 1,088 = 5,121 bytes, over the limit.
    const oneMore = [
      { alias: 1, command: 'a'.repeat(4_000), cwd: 'a\nb' },
      { alias: 2, command: 'b'.repeat(1_060), cwd: null },
    ];
    expect(Buffer.byteLength(approvedMethodLinesZh(oneMore).join('\n'), 'utf8')).toBe(5_121);
  });
});
