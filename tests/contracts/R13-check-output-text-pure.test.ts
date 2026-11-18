/**
 * R13 冻结稿第五节 C3、C4，纯函数（RULES A5）；期望值是规格的字和手算的字节数。
 * - C3 偏差正文 `deviationText`（PL §7.1.1 第五项，冻结稿 A5）：不给输出时和今天一字不差；第五项至多 8 KiB，放不下的
 *   那一条和其后的都不列、末尾写省略句；围栏的反引号比命令里最长的一串多一个。
 * - C4 返工输入（冻结稿 A4，L2，S1）：stderr 空时换 stdout 末尾；报告读不到写原因、不出提示行；命令照原样，第二行行首
 *   不加空格（不经 `clip`）；结构校验放过合规的 `checks.outputs`，多一个键时不放过。
 */
import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { FailingCheckOutputV1 } from '../../src/contracts/check-output.js';
import {
  continuationBriefShapeProblem, renderContinuationBriefZh, type ContinuationBriefV1,
} from '../../src/contracts/continuation-brief.js';
import { deviationText, type DeviationV1 } from '../../src/contracts/plan-deviation.js';
import type { VerificationRoundRef } from '../../src/contracts/verification.js';
import { baseBrief } from '../helpers/K3-continuation-pure-fixture.js';
import { R13_HINT, fencedAfter } from '../helpers/R13-verbatim.js';

const STOP: DeviationV1 = { kind: 'stop', goalRef: { aggregateType: 'Goal', projectId: 'p', goalId: 'g' },
  taskRef: { projectId: 'p', goalId: 'g', taskId: 't' }, planRevision: 2, runRef: null, stopReason: 'no_new_basis',
  usage: null, lines: null, estimatedLines: null, changedFiles: null, minTokenBudgetExclusive: null };

/** 一条没过的检查：命令和两路末尾由行给；出处是 Host 启动配置，taskIds all，退出码 1。 */
function output(checkId: string, command: string, stderrTail: string, stdoutTail = ''): FailingCheckOutputV1 {
  return { checkId, kind: 'static', command: { text: command, truncated: false }, taskIds: 'all', origin: { kind: 'startup' },
    observed: { checkId, checkDigest: 'c'.repeat(64), ranAt: '2026-11-18T00:00:00.000Z', outcome: 'failed', exitCode: 1,
      stdoutTail, stderrTail }, unreadable: null };
}

describe('C3：偏差正文的第五项', () => {
  it('(a) 不给输出：正文是今天的五行', () => {
    const today = ['departure for task t at plan revision 2 (stop)', 'usage: unknown', 'changed files: unknown; lines: unknown',
      'taskbook: plan revision 2, task t', 'stop cause: no_new_basis'].join('\n');
    expect(deviationText(STOP, null)).toBe(today);
    expect(deviationText(STOP, null, [])).toBe(today);
  });

  it('(b) 每条 3,000～3,200 字节：两条加标题不到 6,600 放得下，三条至少 9,000 超过 8,192，只列 c1、c2', () => {
    const big = (checkId: string) => output(checkId, 'x'.repeat(1000), 'e'.repeat(2000));
    const lines = deviationText(STOP, null, [big('c1'), big('c2'), big('c3')]).split('\n');
    const head = (checkId: string) => `- ${checkId} (static; taskIds: all; installed by: Host start-up configuration): exit 1`;
    expect(lines).toContain('failing checks (command and output verbatim, not JSON):');
    expect(['c1', 'c2', 'c3'].map(checkId => lines.includes(head(checkId)))).toEqual([true, true, false]);
    expect(lines.at(-1)).toBe('1 more failing checks not listed (see the round card)');
  });

  it('(d) 贴边：两条加省略句共 8,211 字节，超过 8,192，只列 c1，省略句写 2 条', () => {
    // 手算：每条是概要行 78、`  command:` 10、四行围栏各 5、命令 2,000、`  stderr tail:` 14、stderr 1,920，加 8 个换行，
    // 共 4,050 字节；标题 55，省略句 53。两条：55 + 2 × (1 + 4,050) = 8,157，再加 1 + 53 = 8,211，超过 8,192；
    // 只列 c1：55 + 1 + 4,050 + 1 + 53 = 4,160。
    const edge = (checkId: string) => output(checkId, 'x'.repeat(2000), 'e'.repeat(1920));
    const text = deviationText(STOP, null, [edge('c1'), edge('c2'), edge('c3')]);
    const block = text.slice(text.indexOf('failing checks (command and output verbatim, not JSON):'));
    const lines = block.split('\n');
    const head = (checkId: string) => `- ${checkId} (static; taskIds: all; installed by: Host start-up configuration): exit 1`;
    expect(['c1', 'c2', 'c3'].map(checkId => lines.includes(head(checkId)))).toEqual([true, false, false]);
    expect(lines.at(-1)).toBe('2 more failing checks not listed (see the round card)');
    expect(Buffer.byteLength(block, 'utf8')).toBe(4160);
  });

  it('(c) 命令里有一串三个反引号：围栏是四个，命令行照原样', () => {
    const command = "echo '```'";
    const lines = deviationText(STOP, null, [output('c1', command, 'x\n')]).split('\n');
    const at = lines.indexOf('  command:');
    expect(at, 'the command label').toBeGreaterThan(0);
    expect(lines.slice(at + 1, at + 4)).toEqual(['  ````', command, '  ````']);
  });
});

const ROUND: VerificationRoundRef = { aggregateType: 'VerificationRound', projectId: 'k3r-project', workspaceId: 'W',
  goalId: 'k3r-goal', taskId: 'k3r-task', runId: 'run-1', roundId: 'round-1' };
const REPORT: ArtifactRef = { kind: 'artifact', contentType: 'application/json', digest: 'd'.repeat(64), sizeBytes: 10,
  source: { kind: 'workspace', refId: 'W', revision: '3' } };

/** K3 纯夹具的接续说明，加上一轮：检查 c4 跑完没过、有报告，带一条输出。 */
function briefWith(entry: FailingCheckOutputV1): ContinuationBriefV1 {
  return { ...baseBrief(), checks: { roundRef: ROUND, roundOrdinal: 1, gapCodes: [], outputs: [entry],
    failing: [{ checkId: 'c4', phase: 'finished', outcome: 'FAIL', cause: null, reportRef: REPORT }] } };
}
const render = (entry: FailingCheckOutputV1): string => renderContinuationBriefZh(briefWith(entry), 'f'.repeat(64));

describe('C4：返工输入里的检查输出', () => {
  it('(a) stderr 是空的：换 stdout 末尾，接在 c4 那一行之后，末尾有提示行；结构校验放过', () => {
    const brief = briefWith(output('c4', 'echo c4', '', 'ok\n'));
    expect(continuationBriefShapeProblem(brief)).toBeNull();
    const text = renderContinuationBriefZh(brief, 'f'.repeat(64));
    expect(fencedAfter(text, 'stderr 是空的；stdout 末尾：')).toBe('ok');
    const lines = text.split('\n');
    expect(lines.findIndex(line => line.startsWith('  - c4：阶段 finished')))
      .toBeLessThan(lines.findIndex(line => line.endsWith('stderr 是空的；stdout 末尾：')));
    expect(lines).toContain(R13_HINT);
  });

  it('(b) 报告读不到：写原因，不出提示行', () => {
    const text = render({ ...output('c4', 'echo c4', ''), observed: null, unreadable: 'x' });
    expect(text).toContain('报告读不到：x');
    expect(text).not.toContain('上面的检查输出和你读到的文件对不上时');
  });

  it('(c) 命令两行：照原样，第二行行首不加空格', () => {
    expect(fencedAfter(render(output('c4', 'echo one\necho two', 'boom\n')), '命令原文（照原样，不是 JSON）：'))
      .toBe('echo one\necho two');
  });

  describe('rejects: 结构校验', () => {
    it('一条输出多一个键', () => {
      const extra = { ...output('c4', 'echo c4', 'boom\n'), extra: 1 } as unknown as FailingCheckOutputV1;
      expect(continuationBriefShapeProblem(briefWith(extra))).not.toBeNull();
    });
  });
});
