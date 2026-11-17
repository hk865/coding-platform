/**
 * G8B-1a 施工方补测（lead 11-17 18:2x 裁定 5）：进程输出超过收集上限、被截断时，改动前事实的末尾一段前面标明
 * “（输出超过上限，这里只是前段的末尾）”，整段仍不超过 500 字节；没截断的照旧只是末尾。改前红在没有这句标注。
 */
import { describe, expect, it } from 'vitest';
import { checkBaselineOf } from '../../src/contracts/check-review.js';
import type { CheckProcessObservation, RegisteredCommandCheck } from '../../src/contracts/verification.js';

const check: RegisteredCommandCheck = { checkId: 'c', kind: 'static', command: 'false', cwd: '.', timeoutMs: 1000, taskIds: ['t'] };
const MARK = '（输出超过上限，这里只是前段的末尾）';
const run = (stdout: string, truncated: boolean): CheckProcessObservation => ({
  kind: 'executed', startedAt: 's', finishedAt: 'f', exitCode: 1, signal: null, timedOut: false, cancelled: false,
  stdout: { text: stdout, totalBytes: stdout.length * (truncated ? 2 : 1), truncated },
  stderr: { text: 'err', totalBytes: 3, truncated: false },
  effects: { workspaceRevision: null, changedPaths: [] }, sandboxProfileVersion: 'v',
});

describe('G8B1a: the baseline tail of a truncated output says so', () => {
  it('a truncated stream starts with the mark and stays within 500 bytes', () => {
    const baseline = checkBaselineOf(check, 'now', run('x'.repeat(2000), true));
    expect(baseline.stdoutTail.startsWith(MARK)).toBe(true);
    expect(Buffer.byteLength(baseline.stdoutTail, 'utf8')).toBeLessThanOrEqual(500);
    expect(baseline.stdoutTail.endsWith('x'.repeat(100))).toBe(true);
    expect(baseline.stderrTail).toBe('err');
  });

  it('an untruncated stream is only its tail', () => {
    expect(checkBaselineOf(check, 'now', run('y'.repeat(2000), false)).stdoutTail).toBe('y'.repeat(500));
  });
});
