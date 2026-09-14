import { describe, expect, it } from 'vitest';
import { PendingStore, pendingScopeKey, readPending } from '../../src/ui/src/state/pending';
import { adaptCheckReport, checkVerdict } from '../../src/ui/src/features/check-report';
import type { CheckReportsResponse } from '../../src/ui/src/api/types';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

const scope = { projectId: 'p', workspaceId: 'w', goalId: 'g' };
const other = { projectId: 'p', workspaceId: 'w', goalId: 'g2' };

describe('logical request identity', () => {
  it('reuses the id only while the same payload has no formal receipt', async () => {
    const storage = new MemoryStorage();
    const store = new PendingStore(storage);
    const first = await store.begin(scope, 'real-task', { instruction: 'a', budget: null });
    expect(first.replayed).toBe(false);
    const retry = await store.begin(scope, 'real-task', { instruction: 'a', budget: null });
    expect(retry).toMatchObject({ requestId: first.requestId, replayed: true });
    await expect(store.begin(scope, 'real-task', { instruction: 'b', budget: null })).rejects.toThrow('旧请求结果仍未确定');
    const reloaded = new PendingStore(storage);
    expect(reloaded.peek(scope, 'real-task')?.requestId).toBe(first.requestId);
    expect((await reloaded.begin(scope, 'real-task', { instruction: 'a', budget: null })).requestId).toBe(first.requestId);
    reloaded.settle(scope, 'real-task', first.requestId);
    expect((await reloaded.begin(scope, 'real-task', { instruction: 'b', budget: null })).requestId).not.toBe(first.requestId);
  });

  it('ends the logical request on a formal receipt, so the next identical action is new', async () => {
    const store = new PendingStore(new MemoryStorage());
    const first = await store.begin(scope, 'command-check', { command: 'x' });
    expect(store.settle(scope, 'command-check', first.requestId)).toBe(true);
    expect(store.peek(scope, 'command-check')).toBeNull();
    const again = await store.begin(scope, 'command-check', { command: 'x' });
    expect(again.requestId).not.toBe(first.requestId);
    // Settling a stale id must not delete a newer pending request.
    const newer = again;
    expect(store.settle(scope, 'command-check', first.requestId)).toBe(false);
    expect(store.peek(scope, 'command-check')?.requestId).toBe(newer.requestId);
  });

  it('survives a reload and keeps scopes apart without storing payload text', async () => {
    const storage = new MemoryStorage();
    const store = new PendingStore(storage);
    const claim = await store.begin(scope, 'real-task', { instruction: 'secret instruction', references: [{ path: 'a.ts', sha256: 'f'.repeat(64) }] });
    const raw = storage.getItem('agent-platform.workbench.pending.v1') ?? '';
    expect(raw).toContain(claim.requestId);
    expect(raw).not.toContain('secret instruction');
    expect(raw).not.toContain('a.ts');
    const reloaded = new PendingStore(storage);
    expect(reloaded.peek(scope, 'real-task')).toMatchObject({ requestId: claim.requestId });
    expect(reloaded.peek(other, 'real-task')).toBeNull();
    expect(Object.keys(readPending(storage))).toEqual([pendingScopeKey(scope)]);
  });

  it('keeps a scope without a goal separate from goal-scoped requests', async () => {
    const store = new PendingStore(new MemoryStorage());
    const creation = await store.begin({ projectId: 'p', workspaceId: 'w', goalId: '' }, 'goal', { objective: 'o' });
    expect(store.peek(scope, 'goal')).toBeNull();
    expect(store.peek({ projectId: 'p', workspaceId: 'w', goalId: '' }, 'goal')?.requestId).toBe(creation.requestId);
  });
});

describe('command-check report adaptation', () => {
  const response: CheckReportsResponse = {
    requestId: 'check-1', status: 'finished', command: 'python3 -m unittest', kind: 'dynamic', timeoutMs: 60000,
    startedAt: '2026-09-08T10:00:00.000Z', finishedAt: '2026-09-08T10:00:02.000Z',
    observations: [{ checkId: 'command-dynamic', kind: 'dynamic', result: 'FAIL', summary: 'dynamic command-dynamic: tool_check (FAIL)', artifactRef: { digest: 'a'.repeat(64) } }],
    reports: [{
      schemaVersion: 1, observationId: 'check-abc', owner: { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'r' },
      context: { projectId: 'p', goalId: 'g', taskId: 't', planRef: { aggregateType: 'PlanRevision', projectId: 'p', planId: 'plan-1' }, workspaceRevision: 7, changeScope: { diffClass: 'code-change', changedFiles: [], writeSummary: '' } },
      sourceDigest: 'b'.repeat(64), definition: { checkId: 'command-dynamic', kind: 'dynamic', command: 'python3 -m unittest', cwd: '.', timeoutMs: 60000 },
      startedAt: '2026-09-08T10:00:00.000Z', endedAt: '2026-09-08T10:00:02.000Z', category: 'tool_check', result: 'FAIL',
      execution: { exitCode: 1, signal: null, timedOut: false, cancelled: false, stdout: { text: 'FAIL: test_add', totalBytes: 14, truncated: false }, stderr: { text: 'traceback', totalBytes: 9, truncated: false }, sandboxProfileVersion: 'bwrap-1', timings: { executionMs: 12 } },
    }],
  };

  it('reads the command, classification, verdict and output from the persisted report', () => {
    const view = adaptCheckReport(response);
    expect(view).toMatchObject({ requestId: 'check-1', lifecycle: '检查结束', command: 'python3 -m unittest', kind: 'dynamic', timeoutMs: 60000 });
    expect(view.observations[0]).toMatchObject({ checkId: 'command-dynamic', result: 'FAIL（失败）', reportSaved: true });
    expect(view.reports[0]).toMatchObject({
      command: 'python3 -m unittest', category: '工具检查', result: 'FAIL（失败）', exitCode: 1, timedOut: false,
      stdout: 'FAIL: test_add', stderr: 'traceback', workspaceRevision: 7, planRef: 'plan-1', sandboxProfileVersion: 'bwrap-1', missing: [],
    });
    expect(view.reportsMissing).toBe(false);
    // The record lifecycle is separate from the check verdict.
    expect(checkVerdict({ result: { status: 'ready', observations: [{ result: 'FAIL' }] } })).toBe('FAIL（失败）');
    expect(checkVerdict({ result: { status: 'rejected' } })).toBe('被拒绝');
    expect(checkVerdict({ result: null })).toBe('尚无报告');
  });

  it('marks missing fields instead of inventing them for older records', () => {
    const legacy: CheckReportsResponse = { requestId: 'old', status: 'finished', command: null, kind: null, timeoutMs: null, startedAt: null, finishedAt: null,
      observations: [{ checkId: 'command-dynamic', kind: 'dynamic', result: 'PASS', summary: 's', artifactRef: null }], reports: [] };
    const view = adaptCheckReport(legacy);
    expect(view.command).toBeNull();
    expect(view.reports).toEqual([]);
    expect(view.reportsMissing).toBe(true);
    expect(view.observations[0]?.reportSaved).toBe(false);
  });
});
