/**
 * K3-15 (二) / B3 item 6, F-039: the no-blocked-command brief renders the
 * complete pre-K3 text, byte for byte.
 *
 * The old scenario row compared two renders of the same record with each other
 * (output self-comparison). This pure row calls the exported
 * `renderContinuationBriefZh` directly and compares the WHOLE rendered brief to
 * the fixed old text: header marker, every section and the ending. The input is
 * an aggregate value the assembler derives (A5: a renderer called with built
 * input); no store, platform, Host, Workflow, Runtime or stub port is imported.
 */
import { describe, expect, it } from 'vitest';
import { continuationBriefDigest, renderContinuationBriefZh } from '../../src/contracts/continuation-brief.js';
import { baseBrief } from '../helpers/K3-continuation-pure-fixture.js';

describe('K3-15 (二) F-039: a brief without blocked commands keeps the complete old bytes', () => {
  it('renders the fixed pre-B3 text, including the marker and the ending', () => {
    const brief = baseBrief();
    const digest: string = continuationBriefDigest(brief);
    // The digest the note test computed from the same brief, pinned as a literal.
    expect(digest).toBe('a3a9706587bb68975b7a35962c82aa4c961ef75116ff189d11a7ce3e0580a9d6');
    const text: string = renderContinuationBriefZh(brief, digest);
    expect(text).toBe(
  [
  '## 接续说明',
  '[continuation-brief v1 sha256:a3a9706587bb68975b7a35962c82aa4c961ef75116ff189d11a7ce3e0580a9d6]',
  '这是任务 k3r-task 的接续执行（返工）：第 1 次重新入队，失败类别：检查未通过，发起方：系统自动，自动返工 1/3。',
  '接续方式：在同一 Session session-1 中继续，但上一次执行的 Turn 不在模型历史中。',
  '',
  '### 上一次执行',
  '- 执行 run-1（Session session-1）依据执行记录以 completed 结束。',
  '- 结束时间：2026-10-07T10:05:00.000Z。',
  '',
  '### 停在哪里',
  '- 执行记录无法读取，停在哪里无法确定。',
  '- 原因：the Kernel store is not registered',
  '',
  '### 工具调用',
  '- 执行记录无法读取，工具调用无法确定。',
  '',
  '### 重新入队',
  '- 原因（系统自动）：auto-rework:check_failed#1',
  '- 没有新输入。',
  '',
  '### 工作区',
  '- 上一次执行经工具改动的文件：无法确定。',
  '- 上一次执行结束（2026-10-07T10:05:00.000Z）到“重新入队”之间：无法从持久记录确定是否有改动。',
  '- 重新入队 → 本次执行开始前：源码摘要相同',
  '- 工作区不是 git 仓库，未提交的改动无法列出。',
  '',
  '### 继续之前',
  '- “结果未知”的工具调用可能已经产生副作用，重做之前先核实当前状态。',
  '- “没有执行”的工具调用没有产生结果，需要时重新发起。',
  '- 本说明只陈述持久记录中的事实；写明“无法确定”的地方不代表没有变化。',
].join('\n')
    );
    // The explicit null spelling behaves exactly like the absent field.
    expect(renderContinuationBriefZh({ ...brief, unknownCallReview: null }, digest)).toBe(text);
    expect(text).not.toContain('平台拦下原命令；要再跑先请求并得到允许。');
    expect(text).not.toContain('### 被拦的命令');
  });
});
