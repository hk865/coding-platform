/**
 * K3 group 4 session B3, binding item 9 / rework 1: the blocked section's
 * entries are taken away one at a time, measured WITH the omission note.
 *
 * The renderer is a pure function, so every brief here is constructed input
 * (the shared `baseBrief` fixture plus literal padding and literal blocked
 * entries); no store, no state machine, no owner. All expected byte totals are
 * hand arithmetic from the literal strings, never `byteLength(render(...))`:
 *
 *   base brief                        1,504 bytes (31 lines: 1,474 + 30 joins)
 *   padding steer line `sN`          40 + x bytes, plus 1 join per line
 *   `### 被拦的命令`                 19 bytes, plus 1 join
 *   the empty section line            0 bytes, plus 1 join
 *   blocked command line             45 + digits(alias) + 160 = 206 / 207 bytes
 *   count line (`另有 1 条…`)         79 bytes, plus 1 join
 *   note `其余 1 行`                  67 bytes, plus 1 join
 *   note `其余 15/16 行`              68 bytes, plus 1 join
 *
 * The 160-byte declared form is one form, so no `等 N 种写法` suffix. With 17
 * entries the 16 rendered lines are aliases 1–16: 9 × 206 + 7 × 207 = 3,303.
 * The count line exists only with all 16 lines; the count line is never counted
 * in the note, and a command line removed with the last line takes the section's
 * empty line and heading with it.
 */
import { describe, expect, it } from 'vitest';
import {
  continuationBriefDigest, renderContinuationBriefZh, type ContinuationBriefV1,
} from '../../src/contracts/continuation-brief.js';
import { baseBrief } from '../helpers/K3-continuation-pure-fixture.js';

const HEADING = '### 被拦的命令';
const NOTE_1 = '……（接续说明超过 16384 字节，其余 1 行已省略）';
const NOTE_16 = '……（接续说明超过 16384 字节，其余 16 行已省略）';
const FORM = 'a'.repeat(160);

/**
 * 17 blocked commands, each rendered as `- #<alias>@<run8>：被拦；注明过的写法：`
 * (45 + alias digits bytes) plus the 160-byte form: aliases 1–9 are 206 bytes,
 * aliases 10–16 are 207 bytes.
 */
function blockedEntries() {
  return Array.from({ length: 17 }, (_, index) => ({
    alias: index + 1,
    reviewRunId: `r${String(index + 1).padStart(7, '0')}`,
    requestState: null,
    declaredForms: [FORM],
  }));
}

/**
 * `n` unaccepted steers `s1..sn` with `xs` bytes of text each: every line is
 * `- 没有被 Kernel 接受的引导 sN：` (40 bytes) plus the text, and every line
 * adds one `\n` join. The padded brief is therefore `1,504 + Σ(41 + x)` bytes.
 */
function padded(xs: readonly number[]): ContinuationBriefV1 {
  const brief = baseBrief();
  brief.previous.unacceptedSteers = xs.map((x, index) => ({
    intentRef: {
      aggregateType: 'ControlIntent' as const, projectId: 'k3r-project', workspaceId: 'W',
      intentId: `s${String(index + 1)}`,
    },
    text: { text: 'p'.repeat(x), truncated: false },
  }));
  return brief;
}

function render(brief: ContinuationBriefV1): string {
  return renderContinuationBriefZh(brief, continuationBriefDigest(brief));
}

function commandLines(text: string): string[] {
  return text.split('\n').filter(line => line.startsWith('- #'));
}

describe('K3-15 (二) / B3 item 9: the blocked section is measured with its own note', () => {
  it('drops only the count line when the 16 command lines fit exactly at 16,384', () => {
    // Padding 11,540 = 41 × 3 + (4,000 + 4,000 + 3,417); padded brief 13,044.
    // The 16-line section is 18 lines (empty 0 + heading 19 + 3,303 + 18 joins)
    // = 3,340, so the brief is 13,044 + 3,340 = 16,384 exactly.
    // The count line plus its join is 80 bytes more (16,464), so only the count
    // line is removed: all 16 command lines stay and no command line is counted.
    const brief: ContinuationBriefV1 = {
      ...padded([4_000, 4_000, 3_417]),
      blockedCommands: blockedEntries(),
    };
    const text = render(brief);
    expect(Buffer.byteLength(text, 'utf8')).toBe(16_384);
    expect(text).toContain(HEADING);
    expect(commandLines(text)).toHaveLength(16);
    expect(text.split('\n')).toContain(`- #16@r0000016：被拦；注明过的写法：${FORM}`);
    expect(text).not.toContain('- 另有 1 条被拦的命令');
    // Nothing else was omitted, so today's note is absent (a note of 0 is never added).
    expect(text).not.toContain('已省略');
  });

  it('keeps 15 command lines and counts exactly the one command line it removed', () => {
    // Padding 11,600 = 41 × 3 + (4,000 + 4,000 + 3,477); padded brief 13,104.
    // 16 lines without the count line: 13,104 + 3,340 = 16,444 > 16,384.
    // 15 lines are 17 lines (empty 0 + heading 19 + 3,096 + 17 joins) = 3,132;
    // with the 1-line note (67 + 1 join): 13,104 + 3,132 + 68 = 16,304.
    const brief: ContinuationBriefV1 = {
      ...padded([4_000, 4_000, 3_477]),
      blockedCommands: blockedEntries(),
    };
    const text = render(brief);
    expect(Buffer.byteLength(text, 'utf8')).toBe(16_304);
    expect(commandLines(text)).toHaveLength(15);
    expect(text).not.toContain('- #16@r0000016');
    expect(text).not.toContain('- 另有 1 条被拦的命令');
    expect(text).toContain(NOTE_1);
  });

  it('removes the whole section and counts all 16 command lines on a shortened body', () => {
    // Padding 16,164 = 41 × 4 + 4 × 4,000; the full body is 17,668 bytes, so
    // even the section gone it is over. At the 1,000-unit cap each 4,000-byte
    // steer text becomes 1,000 bytes + the 18-byte `…（已截断）` marker, so the
    // body is 1,504 + 4 × (41 + 1,018) = 5,740 and the 16-line note adds 69:
    // 5,809 bytes.
    const brief: ContinuationBriefV1 = {
      ...padded([4_000, 4_000, 4_000, 4_000]),
      blockedCommands: blockedEntries(),
    };
    const text = render(brief);
    expect(Buffer.byteLength(text, 'utf8')).toBe(5_809);
    expect(text).not.toContain(HEADING);
    expect(text).not.toContain(`\n\n${HEADING}`);
    expect(text).toContain(NOTE_16);
    expect(text.split('\n').filter(line => line.startsWith('- #'))).toHaveLength(0);
  });

  it('drops the whole section first and leaves the other optional body at full length', () => {
    // Padding 14,700 = 41 × 4 + (4,000 + 4,000 + 4,000 + 2,536); padded brief
    // 16,204. The section with one command line plus the 15-line note is
    // 16,204 + (empty 0 + heading 19 + line 206 + 3 joins = 228) + 69 = 16,501
    // > 16,384; with the whole section
    // gone the brief is 16,204 + (68 + 1 join for the 16-line note) = 16,273,
    // so every body text stays at its full 4,000 bytes (no `已截断`).
    const brief: ContinuationBriefV1 = {
      ...padded([4_000, 4_000, 4_000, 2_536]),
      blockedCommands: blockedEntries(),
    };
    const text = render(brief);
    expect(Buffer.byteLength(text, 'utf8')).toBe(16_273);
    expect(text).not.toContain(HEADING);
    expect(text).toContain(NOTE_16);
    expect(text).toContain(`- 没有被 Kernel 接受的引导 s1：${'p'.repeat(4_000)}`);
    expect(text).not.toContain('已截断');
  });
});
