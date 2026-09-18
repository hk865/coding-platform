import { useEffect, useState } from 'react';
import { Text } from '@mantine/core';
import type { QueryJobAnswerV1 } from '../../../contracts/query-job.js';
import type { Api } from '../api/client';
import type { GoalScope } from '../api/types';

type Citation = { meaning?: { scope?: unknown; observedAt?: string; object?: string; coverage?: string }; marker: string; pointer: string; inputDigest: string; version: string; assertion?: { kind: string; expected: string } };
function citations(answer: QueryJobAnswerV1): Citation[] {
  return answer.sources.filter(s => s.kind === 'query_fact').flatMap(source => {
    try {
      const value = JSON.parse(source.refKey);
      return /^F[0-9]+$/.test(value.marker) && /^\/(material|maintainedPreferences)(\/|$)/.test(value.pointer) &&
        /^[a-f0-9]{64}$/.test(value.inputDigest) && typeof source.version === 'string' && value.inputDigest === source.version
        ? [{ ...(value.meaning && typeof value.meaning === 'object' ? { meaning: value.meaning } : {}), marker: value.marker, pointer: value.pointer, inputDigest: value.inputDigest, version: source.version,
          ...(value.check === 'structured-state-only' && typeof value.assertion?.kind === 'string' && typeof value.assertion?.expected === 'string'
            ? { assertion: { kind: value.assertion.kind, expected: value.assertion.expected } } : {}) }] : [];
    } catch { return []; }
  });
}
function atPointer(input: unknown, pointer: string) {
  let value = input;
  for (const part of pointer.slice(1).split('/')) {
    if (/~(?![01])/.test(part)) throw Error('引用位置无效');
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key)) throw Error('引用位置无效');
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) throw Error('原记录中没有该引用位置');
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
/** Display the persisted input, never reconstruct facts from the answer text. */
export function QueryFactSources({ api, scope, answer, summary = false }: { api: Api; scope: GoalScope; answer: QueryJobAnswerV1; summary?: boolean }) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [state, setState] = useState<{ identity: string; rows?: Array<{ citation: Citation; value: unknown; scope: unknown; observedAt: string | null }>; error?: string } | null>(null);
  const identity = JSON.stringify([scope, answer.runRef, answer.answerId, answer.sources]);
  useEffect(() => { setOpen(false); setFocused(null); setState(null); }, [identity]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setState(null);
    void (async () => {
      try {
        const result = await api.queryRuns(scope, { signal: controller.signal });
        const run = result.runs.find(row => row.runRef.projectId === scope.projectId && row.runRef.workspaceId === scope.workspaceId &&
          row.runRef.queryJobId === answer.runRef.queryJobId && row.runRef.runId === answer.runRef.runId);
        if (!run) throw Error('对应的持久输入不可用');
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(run.input)))].map(b => b.toString(16).padStart(2, '0')).join('');
        const input = JSON.parse(run.input);
        const rows = citations(answer).map(citation => {
          if (digest !== run.inputDigest || digest !== citation.inputDigest) throw Error('引用与持久输入版本不一致');
          return { citation, value: atPointer(input, citation.pointer), scope: citation.meaning?.scope ?? null, observedAt: citation.meaning?.observedAt ?? input.material?.capturedAt ?? null };
        });
        if (!controller.signal.aborted) setState({ identity, rows });
      } catch (error) { if (!controller.signal.aborted) setState({ identity, error: error instanceof Error ? error.message : '事实引用读取失败' }); }
    })();
    return () => controller.abort();
  }, [api, identity, open]);
  const known = new Set(citations(answer).map(c => c.marker));
  const body = answer.answer.split(/(\[F[1-9][0-9]*\])/g).map((part, i) => known.has(part.slice(1, -1))
    ? <button type="button" key={i} aria-label={'查看引用 ' + part.slice(1, -1)} onClick={() => { setFocused(part.slice(1, -1)); setOpen(true); }} style={{ color: 'var(--mantine-color-blue-6)', background: 'none', border: 0, cursor: 'pointer', padding: '0 2px' }}>{part}</button> : part);
  if (!known.size) return <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{answer.answer}</Text>;
  const current = state?.identity === identity ? state : null;
  return <>{summary ? <Text size="xs" c="dimmed">秘书摘要 · 点击引用查看原材料</Text> : null}<Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{body}</Text><details open={open} onToggle={event => setOpen(event.currentTarget.open)} data-testid="query-fact-sources">
    <summary onClick={() => setFocused(null)}>查看事实引用（{citations(answer).map(c => `[${c.marker}]`).join(' ')}）</summary>
    <Text size="xs" c={answer.stale ? 'orange' : 'dimmed'}>{answer.stale ? '来源已变化，以下是回答时的历史记录。' : '以下是回答时捕获的记录；引用存在不代表结论一定成立，也不证明当前源码已验收。'}</Text>
    {open && !current ? <Text size="xs">正在读取持久事实…</Text> : null}
    {current?.error ? <Text size="xs" c="red">{current.error}</Text> : null}
    {focused && open ? <button type="button" onClick={() => setFocused(null)}>查看全部引用</button> : null}
    {current?.rows?.filter(row => !focused || row.citation.marker === focused).map(row => <div key={row.citation.marker}><Text size="xs">[{row.citation.marker}] {row.citation.pointer}</Text>
      <Text size="xs">来源范围：{row.scope === null ? '该引用未提供范围标签，请查看原记录' : JSON.stringify(row.scope)} · 捕获时间：{row.observedAt ?? '旧记录未提供'}</Text>
      {row.citation.meaning?.object ? <Text size="xs">来源对象：{row.citation.meaning.object} · 覆盖范围：{row.citation.meaning.coverage}</Text> : null}
      {row.citation.assertion ? <Text size="xs" data-testid="query-fact-assertion">记录的状态核对：{row.citation.assertion.kind} = {row.citation.assertion.expected}；仅核对结构化状态，不证明整段解释。</Text> : null}
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(row.value, null, 2)}</pre><Text size="xs" c="dimmed">输入版本：{row.citation.version}</Text></div>)}
  </details></>;
}
