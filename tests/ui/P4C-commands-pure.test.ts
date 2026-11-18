import { describe, expect, it } from 'vitest';
import { auxCommandViewOf, type AuxCommandHandle } from '../../src/ui/adapters/aux-panel.js';

/**
 * P4 命令页 R3（冻结稿 11-18）：`auxCommandViewOf` 是唯一把命令句柄（或 `'gone'` / `null`）变成这一行
 * phase、word、dot 和输出的表。字面量都照 R3 表抄；三个用时是裁定手算的例子（41000 → 41 秒，400 → 0 秒，
 * 125000 → 2 分 5 秒）。每格比整个视图，错误格的 word 写全，原始 reason 抄进去就红。
 * 具名改坏：删掉 timedOut 那一支，或挪到 `exitCode === null` 之后（timedOut 格红）；错误行把 `error.reason`
 * 抄进 word（四个码的格红）；先拼 stderr 再拼 stdout（输出格红）；`outputTruncated` 不加那一行（截断格红）。
 */

/** 一个已结束的句柄，只改这一格点名的字段。 */
const settled = (patch: Partial<AuxCommandHandle>): AuxCommandHandle => ({
  state: 'settled', stdout: '', stderr: '', outputTruncated: false, exitCode: 0,
  signal: null, timedOut: false, cancelled: false, error: null, executionMs: null, ...patch,
});
const ERROR_WORDS = {
  sandbox_unavailable: '命令沙箱不可用', launch_failed: '没能启动', invalid_arguments: '目录或参数不对', command_failed: '命令执行失败',
};

type Case = {
  name: string; input: AuxCommandHandle | 'gone' | null; phase: string; word: string; dot: string;
  out?: string; outLines?: number;
};

const CASES: Case[] = [
  // R3 表，从上往下第一条成立的为准。
  { name: 'null（没跑过）', input: null, phase: 'idle', word: '未运行', dot: 'dot s-idle' },
  { name: "'gone'（Host 重启过）", input: 'gone', phase: 'idle', word: 'Host 重启过，这次运行的记录没有了', dot: 'dot s-idle' },
  { name: 'running', input: settled({ state: 'running', exitCode: null }),
    phase: 'running', word: '运行中 · 输出在结束后显示', dot: 'dot s-running' },
  { name: 'stopping', input: settled({ state: 'stopping', exitCode: null }), phase: 'stopping', word: '正在停止', dot: 'dot s-running' },
  ...Object.entries(ERROR_WORDS).map(([code, text]) => ({ name: `settled · ${code}`,
    input: settled({ error: { code, reason: 'synthetic EACCES detail' } }), phase: 'ended', word: '没跑起来：' + text, dot: 'dot s-failed' })),
  { name: 'settled · cancelled', input: settled({ cancelled: true }), phase: 'ended', word: '已取消，输出保留', dot: 'dot s-cancelled' },
  { name: 'settled · timedOut，用时 41 秒', input: settled({ timedOut: true, exitCode: null, executionMs: 41_000 }),
    phase: 'ended', word: '超时停下 · 用时 41 秒', dot: 'dot s-failed' },
  { name: 'settled · 退出码 3，用时 0 秒', input: settled({ exitCode: 3, executionMs: 400 }),
    phase: 'ended', word: '已结束 · 退出码 3 · 用时 0 秒', dot: 'dot s-failed' },
  { name: 'settled · 被信号停下，用时 2 分 5 秒', input: settled({ exitCode: null, signal: 'SIGTERM', executionMs: 125_000 }),
    phase: 'ended', word: '已结束 · 被信号 SIGTERM 停下 · 用时 2 分 5 秒', dot: 'dot s-failed' },
  // 退出码 0、没有用时；输出是 stdout、stderr 各去掉末尾一个换行，按这个顺序连起来。
  { name: 'settled · 退出码 0，没有用时，stdout 在 stderr 前', input: settled({ stdout: 'a\n', stderr: 'b\n' }),
    phase: 'ended', word: '已结束 · 退出码 0', dot: 'dot s-satisfied', out: 'a\nb', outLines: 2 },
  { name: 'settled · 输出截断多一行', input: settled({ stdout: 'a\n', stderr: 'b\n', outputTruncated: true }),
    phase: 'ended', word: '已结束 · 退出码 0', dot: 'dot s-satisfied', out: 'a\nb\n（输出超过上限，只保留了一部分）', outLines: 3 },
];

describe('P4C R3 auxCommandViewOf', () => {
  it.each(CASES)('$name', ({ input, phase, word, dot, out = '', outLines = 0 }) => {
    expect(auxCommandViewOf(input)).toEqual({ phase, word, dot, out, outLines });
  });
});
