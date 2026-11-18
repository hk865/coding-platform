/**
 * P1“Run 步骤读”的纯表：`buildRunSteps`（冻结稿第四节 T1–T15，开头更正 2 补的 summary 断言）。
 *
 * 输入全部来自 `tests/helpers/S2B-kernel-records-fixture.ts` 的 `KernelTurnRecords`：每条事件过 Kernel 真实的
 * `agentEventSchema`，再经真实 reducer 重放，和 `S2B-tally.test.ts` 同一种做法（RULES A5）。带正文、思考的回复和带命令输出的
 * 结果用它公开的 `event()` 和结果构造写，夹具一行不改（Q4）。期望值照冻结稿手算：位置从 `turn.started` 的 1 起、每条事件加 1；
 * “汉”一个 3 字节；截断标记“（输出超过上限，这里只是前段的末尾）”18 个字、54 字节。
 *
 * 今天红在哪：`src/core/agent-runtime/run-steps.ts` 还不存在，整个文件在导入时失败，每一行都红。
 * T10 说的“Turn 结束（run.completed）”造不出来：Kernel 的转移表只在没有待结算调用时才收 `run.completed`
 * （`agent-events.js` 的 `ready_to_complete`），所以这一行用 `run.cancelled` 关 Turn，同样是 Turn 已结束、调用没结果。
 */
import { describe, expect, it } from 'vitest';
import { buildRunSteps } from '../../src/core/agent-runtime/run-steps.js';
import type { RunStepsReadV1 } from '../../src/contracts/run-steps.js';
import {
  KernelTurnRecords, cancelledResult, editCreateCall, editReplaceCall, effects, failedResult, kernelToolCall, readCall,
  shellCall, successResult, type KernelToolCall, type KernelToolResult,
} from '../helpers/S2B-kernel-records-fixture.js';

type Steps = Extract<RunStepsReadV1, { kind: 'steps' }>;

/** 夹具的默认时钟，`turn.started` 记在这一刻。 */
const T0 = '2026-10-14T10:00:00.000Z';
const at = (second: number): string => `2026-10-14T10:00:${String(second).padStart(2, '0')}.000Z`;

/** 读整个窗；默认 Run 已结束、从头读一页 50 步。 */
function read(b: KernelTurnRecords, options: { runEnded?: boolean; after?: number | null; limit?: number } = {}): Steps {
  const answer = buildRunSteps({ decoded: b.records(), kernel: b.kernel, window: b.window(),
    runEnded: options.runEnded ?? true, after: options.after ?? null, limit: options.limit ?? 50 });
  if (answer.kind !== 'steps') throw new Error(`P1S：应读成 steps，实际 ${JSON.stringify(answer)}`);
  return answer;
}

/** 一次模型回复：开请求，再写 `assistant.message_completed`（可带正文和思考）。 */
function reply(b: KernelTurnRecords, calls: readonly KernelToolCall[],
  message: { content?: string; reasoningContent?: string } = {}): KernelTurnRecords {
  const requestId = `req-${String(b.position())}`;
  b.modelRequestStarted(requestId);
  return b.event({ type: 'assistant.message_completed', payload: { requestId, toolCalls: calls,
    message: { schemaVersion: 1, messageId: `m-${String(b.position())}`, role: 'assistant', content: message.content ?? '',
      ...(message.reasoningContent === undefined ? {} : { reasoningContent: message.reasoningContent }) } } });
}

/** 一条回复里只有这一次调用：位置 1 turn.started、2 run.started、3 请求、4 回复、5 tool.started，结果（有的话）在 6。 */
function oneCall(call: KernelToolCall, finish: (b: KernelTurnRecords) => void = () => undefined): KernelTurnRecords {
  const b = new KernelTurnRecords();
  reply(b.runStarted(), [call]).toolStarted(call);
  finish(b);
  return b;
}
const ok = (callId: string) => (b: KernelTurnRecords): void => { b.toolCompleted(callId, successResult(callId)); };

/** 命令跑过之后的输出，形状照 `shell-tool.js:126-146`；`readonly` 换成 `readonly-command-tool.ts:371-384` 多的那几项。 */
function commandOutput(stdout: string, options: { exitCode?: number; kernelTruncated?: boolean; readonly?: boolean } = {}): unknown[] {
  const own = options.readonly === true
    ? { timedOut: false, externalChangedPaths: [], externalChangedPathsOmitted: 0 }
    : { sandboxProfileVersion: 'p1s-sandbox' };
  return [{ kind: 'text', text: stdout }, { kind: 'json', value: { exitCode: options.exitCode ?? 0, signal: null,
    stdout: { totalBytes: options.kernelTruncated === true ? 40_000 : stdout.length, truncated: options.kernelTruncated === true },
    stderr: { text: '', totalBytes: 0, truncated: false }, ...own,
    timings: { snapshotBeforeMs: 1, executionMs: 3, snapshotAfterMs: 1 } } }];
}
/** 真的跑了、退出 0 的命令结果；没写文件的命令 effects 是 possible、路径为空（S2B-be1s 的 `ls`）。 */
const ran = (callId: string, output: unknown[]): KernelToolResult =>
  successResult(callId, { output, effects: { sideEffect: 'possible', workspaceRevision: 'rev-2' } });
const EXITED_3: KernelToolResult = { schemaVersion: 1, callId: 'c1', status: 'error', output: commandOutput('', { exitCode: 3 }),
  effects: effects({ sideEffect: 'possible' }), error: { code: 'execution_failed', message: 'shell 退出码 3', retryable: true } };
/** 执行前被拒：只有一段文字，没有 JSON（`shell-tool.js:181-190`）。 */
const REFUSED: KernelToolResult = { ...failedResult('c1', { code: 'sandbox_unavailable', message: '进程沙盒不可用' }),
  output: [{ kind: 'text', text: '进程沙盒不可用' }] };
const bounded = (text: string, truncated = false) => ({ text, truncated });

describe('P1S buildRunSteps 纯表', () => {
  it('T1 回复带思考和一次 read：第 1 步 think（回复的位置 4）、第 2 步 read（tool.started 的位置 5）；summary 的起止时间', () => {
    const b = new KernelTurnRecords();
    reply(b.runStarted(), [readCall('c1', 'src/a.ts')], { reasoningContent: '先看入口' })
      .toolStarted(readCall('c1', 'src/a.ts'), at(5)).toolCompleted('c1', successResult('c1'), at(9));
    const answer = read(b);
    expect(answer.steps).toEqual([
      { kind: 'think', position: 4, at: T0, text: bounded('先看入口') },
      { kind: 'read', position: 5, callId: 'c1', tool: 'read', status: 'done', startedAt: at(5), endedAt: at(9),
        error: null, path: 'src/a.ts' },
    ]);
    expect(answer.summary).toEqual({ startedAt: T0, lastAt: at(9), live: false, reads: 1,
      changedFiles: { definite: 0, possible: 0, possiblyIncomplete: false }, commands: 0 });
  });

  it.each([
    ['思考只有空白', '  \n'],
    ['没有思考', undefined],
  ])('T2 %s：没有 think 步，回答正文“答案在这”不进任何一步', (_name, reasoningContent) => {
    const b = new KernelTurnRecords();
    const extra = reasoningContent === undefined ? {} : { reasoningContent };
    reply(b.runStarted(), [readCall('c1', 'src/a.ts')], extra).toolStarted(readCall('c1', 'src/a.ts'));
    reply(b.toolCompleted('c1', successResult('c1')), [], { content: '答案在这', ...extra });
    const answer = read(b);
    expect(answer.steps.map(step => step.kind)).toEqual(['read']);
    expect(JSON.stringify(answer.steps)).not.toContain('答案在这');
  });

  it('T3 read src/a.ts 成功两次、src/b.ts 失败一次：三个 read 步，summary.reads 是不同的成功路径数 1', () => {
    const calls = [readCall('c1', 'src/a.ts'), readCall('c2', 'src/a.ts'), readCall('c3', 'src/b.ts')];
    const b = reply(new KernelTurnRecords().runStarted(), calls);
    b.toolStarted(calls[0]!).toolCompleted('c1', successResult('c1')).toolStarted(calls[1]!).toolCompleted('c2', successResult('c2'))
      .toolStarted(calls[2]!).toolFailed('c3', 'execution', failedResult('c3', { code: 'execution_failed' }));
    const answer = read(b);
    expect(answer.steps).toMatchObject([{ kind: 'read', status: 'done' }, { kind: 'read', status: 'done' },
      { kind: 'read', status: 'failed', path: 'src/b.ts' }]);
    expect(answer.summary.reads).toBe(1);
  });

  it('T4 edit create notes.md "a\\nb" 成功 confirmed 是 +2 −0；失败的 edit replace 没有行数；改动文件 1 个', () => {
    const create = editCreateCall('e1', 'notes.md', 'a\nb');
    const replace = editReplaceCall('e2', 'x.md', 'old', 'new');
    const b = reply(new KernelTurnRecords().runStarted(), [create, replace]);
    b.toolStarted(create).toolCompleted('e1', successResult('e1',
      { effects: { sideEffect: 'confirmed', changedPaths: ['notes.md'], workspaceRevision: 'rev-2' } }))
      .toolStarted(replace).toolFailed('e2', 'execution', failedResult('e2', { code: 'execution_failed' }));
    const answer = read(b);
    expect(answer.steps).toMatchObject([
      { kind: 'edit', status: 'done', path: 'notes.md', lines: { added: 2, deleted: 0 } },
      { kind: 'edit', status: 'failed', path: 'x.md', lines: null },
    ]);
    expect(answer.summary.changedFiles).toEqual({ definite: 1, possible: 0, possiblyIncomplete: false });
  });

  it('T5 shell echo hi 跑完：done、退出 0、stdout hi\\n、stderr 空；跑过命令，改动文件记不完整', () => {
    const answer = read(oneCall(shellCall('c1', 'echo hi'), b => { b.toolCompleted('c1', ran('c1', commandOutput('hi\n'))); }));
    expect(answer.steps).toEqual([{ kind: 'command', position: 5, callId: 'c1', tool: 'shell', status: 'done', startedAt: T0,
      endedAt: T0, error: null, command: bounded('echo hi'), exitCode: 0, stdout: bounded('hi\n'), stderr: bounded('') }]);
    expect(answer.summary).toMatchObject({ commands: 1, changedFiles: { possiblyIncomplete: true } });
  });

  it('T6 run_readonly_command 同样的输出（多 timedOut、externalChangedPaths）读成同形的 command 步', () => {
    const call = kernelToolCall('c1', 'run_readonly_command', { command: 'echo hi' });
    const answer = read(oneCall(call, b => { b.toolCompleted('c1', ran('c1', commandOutput('hi\n', { readonly: true }))); }));
    expect(answer.steps).toEqual([{ kind: 'command', position: 5, callId: 'c1', tool: 'run_readonly_command', status: 'done',
      startedAt: T0, endedAt: T0, error: null, command: bounded('echo hi'), exitCode: 0, stdout: bounded('hi\n'),
      stderr: bounded('') }]);
  });

  it.each([
    ['T7 退出 3（带 JSON）', EXITED_3, { status: 'failed', exitCode: 3, stdout: bounded(''), stderr: bounded(''),
      error: { code: 'execution_failed', message: bounded('shell 退出码 3') } }],
    ['T8 执行前被拒（只有文字）', REFUSED, { status: 'failed', exitCode: null, stdout: null, stderr: null,
      error: { code: 'sandbox_unavailable', message: bounded('进程沙盒不可用') } }],
  ])('%s：命令失败照实读；开始过的命令都算一次（Q7）', (_name, result, expected) => {
    const answer = read(oneCall(shellCall('c1', 'make'), b => { b.toolFailed('c1', 'execution', result); }));
    expect(answer.steps).toMatchObject([{ kind: 'command', ...expected }]);
    expect(answer.summary.commands).toBe(1);
  });

  it('T9 没结果、Turn 没结束、Run 没结束：running、endedAt null；live 为真，runningFrom 是它的位置 5', () => {
    const answer = read(oneCall(readCall('c1', 'src/a.ts')), { runEnded: false });
    expect(answer.steps).toMatchObject([{ kind: 'read', status: 'running', endedAt: null }]);
    expect(answer.summary.live).toBe(true);
    expect(answer.runningFrom).toBe(5);
  });

  it.each([
    ['Turn 已结束（run.cancelled），Run 没结束', (b: KernelTurnRecords) => { b.runCancelled(); }, false],
    ['Turn 没关上，Run 已结束（Host 崩了）', () => undefined, true],
  ])('T10 没结果、%s：unknown，不说还在跑', (_name, finish, runEnded) => {
    const answer = read(oneCall(readCall('c1', 'src/a.ts'), finish), { runEnded });
    expect(answer.steps).toMatchObject([{ kind: 'read', status: 'unknown' }]);
    expect(answer.summary.live).toBe(false);
    expect(answer.runningFrom).toBeNull();
  });

  it.each([
    ['tool.outcome_unknown', (b: KernelTurnRecords) => { b.toolOutcomeUnknown('c1', { toolName: 'read', effectClass: 'read_only' }); },
      { status: 'unknown', error: null }],
    ['tool.cancelled', (b: KernelTurnRecords) => { b.toolCancelled('c1', cancelledResult('c1')); },
      { status: 'cancelled', error: null }],
    ['结果 error、码 outcome_unknown', (b: KernelTurnRecords) => {
      b.toolFailed('c1', 'execution', failedResult('c1', { code: 'outcome_unknown' }));
    }, { status: 'unknown', error: { code: 'outcome_unknown', message: bounded('outcome_unknown') } }],
  ])('T11 状态表：%s', (_name, finish, expected) => {
    expect(read(oneCall(readCall('c1', 'src/a.ts'), finish)).steps).toMatchObject([{ kind: 'read', ...expected }]);
  });

  const MESSAGE = { aggregateType: 'SessionMessage', projectId: 'p', workspaceId: 'w', messageId: 'msg-1' };
  it.each([
    ['send_session_message', { recipient: { projectId: 'p', sessionId: 's-sec' }, intent: 'notify', text: '做完了' },
      { kind: 'session', sessionRef: { projectId: 'p', sessionId: 's-sec' } }, '做完了'],
    ['send_user_message', { text: '请看一下' }, { kind: 'person' }, '请看一下'],
    ['respond_session_message', { messageRef: MESSAGE, text: '收到' }, { kind: 'reply', messageRef: MESSAGE }, '收到'],
  ])('T12 %s 读成 message 步，to 分三种', (tool, args, to, text) => {
    const answer = read(oneCall(kernelToolCall('c1', tool, args), ok('c1')));
    expect(answer.steps).toMatchObject([{ kind: 'message', tool, status: 'done', to, text: bounded(text) }]);
  });

  it.each([
    ['look_graph {}', {}, null],
    ['参数带 path', { mode: 'path', path: 'docs/x.md' }, bounded('docs/x.md')],
  ])('T13 别的工具读成 tool 步：%s', (_name, args, target) => {
    const answer = read(oneCall(kernelToolCall('c1', 'look_graph', args), ok('c1')));
    expect(answer.steps).toMatchObject([{ kind: 'tool', tool: 'look_graph', target }]);
  });

  it.each([
    ['思考 6,000 个“汉”（18,000 字节）从头取 5,333 个（15,999 字节）', () => reply(new KernelTurnRecords().runStarted(), [],
      { reasoningContent: '汉'.repeat(6000) }), { kind: 'think', text: bounded('汉'.repeat(5333), true) }],
    ['消息 3,000 个“汉”从头取 1,333 个（3,999 字节）', () => oneCall(kernelToolCall('c1', 'send_user_message',
      { text: '汉'.repeat(3000) }), ok('c1')), { kind: 'message', text: bounded('汉'.repeat(1333), true) }],
    ['stdout 3,000 个 x 取末尾 2,000 个', () => oneCall(shellCall('c1', 'seq'), b => {
      b.toolCompleted('c1', ran('c1', commandOutput('x'.repeat(3000))));
    }), { kind: 'command', stdout: bounded('x'.repeat(2000), true) }],
    ['Kernel 标了 stdout.truncated 的 hi\\n 前面带标记', () => oneCall(shellCall('c1', 'seq'), b => {
      b.toolCompleted('c1', ran('c1', commandOutput('hi\n', { kernelTruncated: true })));
    }), { kind: 'command', stdout: bounded('（输出超过上限，这里只是前段的末尾）hi\n', true) }],
  ])('T14 截断：%s', (_name, build, expected) => {
    expect(read(build()).steps).toMatchObject([expected]);
  });

  // 五个 read 在一条回复里：tool.started 在 5、7、9、11、13，结果在各自的下一位。
  const calls = ['a', 'b', 'c', 'd', 'e'].map((name, index) => readCall(`c${String(index + 1)}`, `src/${name}.ts`));
  const five = (): KernelTurnRecords => {
    const b = reply(new KernelTurnRecords().runStarted(), calls);
    for (const call of calls) b.toolStarted(call).toolCompleted(call.callId, successResult(call.callId));
    return b;
  };
  it.each([
    [null, [5, 7], 7],
    [7, [9, 11], 11],
    [11, [13], null],
    [13, [], null],
  ])('T15 分页：after %s、limit 2 → 位置 %j，next %s；每页 summary 都是整个 Turn 的', (after, positions, next) => {
    const answer = read(five(), { after, limit: 2 });
    expect(answer.steps.map(step => step.position)).toEqual(positions);
    expect(answer.next).toBe(next);
    expect(answer.runningFrom).toBeNull();
    expect(answer.summary).toEqual({ startedAt: T0, lastAt: T0, live: false, reads: 5,
      changedFiles: { definite: 0, possible: 0, possiblyIncomplete: false }, commands: 0 });
  });
});
