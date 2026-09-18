import { useEffect, useRef, useState } from 'react';
import { Button, Group, Select, Stack, Text } from '@mantine/core';
import type { QueryJobAnswerV1 } from '../../../contracts/query-job.js';
import type { QueryAnswerAuditVerdict } from '../../../contracts/query-answer-audit.js';
import type { GoalScope } from '../api/types';
import type { Api } from '../api/client';

const labels: Record<QueryAnswerAuditVerdict, string> = { supported: '依据充分', citation_insufficient: '引用不足', conflict: '存在冲突', unverifiable: '无法确认' };
type View = Awaited<ReturnType<Api['answerReviewView']>>;
export function QueryAnswerReview({ api, scope, answer, onRevision }: { api: Api; scope: GoalScope; answer: QueryJobAnswerV1; onRevision: (text: string) => void }) {
  const [open, setOpen] = useState(false), [view, setView] = useState<View | null>(null);
  const [selection, setSelection] = useState<string | null>('all'), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const identity = JSON.stringify([scope, answer.answerId, answer.runRef]);
  const liveIdentity = useRef(identity); liveIdentity.current = identity;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const target = { ...scope, queryJobId: answer.runRef.queryJobId, answerId: answer.answerId };
  useEffect(() => { setOpen(false); setView(null); setSelection('all'); setBusy(false); setError(null); }, [identity]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const next = await api.answerReviewView(target, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setView(next); setError(null);
        if (next.reviews.some(review => review.status === 'running')) timer = setTimeout(() => { void read(); }, 2000);
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '复核记录读取失败'); }
    };
    void read(); return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [api, identity, open, refresh]);
  const start = async () => {
    const isCurrent = () => mounted.current && liveIdentity.current === identity;
    setBusy(true); setError(null);
    try { await api.answerReviewStart({ ...target, requestId: crypto.randomUUID(), blocks: selection === 'all' ? null : [Number(selection)] }); if (isCurrent()) setRefresh(value => value + 1); }
    catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : '无法启动复核'); }
    finally { if (isCurrent()) setBusy(false); }
  };
  const active = view?.reviews.find(review => review.status === 'running');
  return <Stack gap="xs" data-testid="query-answer-review">
    <Button size="xs" variant="subtle" onClick={() => setOpen(value => !value)}>{open ? '收起独立复核' : '按需复核回答'}</Button>
    {open ? <>
      <Text size="xs" c="dimmed">用户发起后才调用模型，原回答保持不变。检查平台事实与引用；不运行代码、不裁定任务完成，也不保证解释绝对正确。</Text>
      {!view && !error ? <Text size="xs">正在读取复核记录…</Text> : null}
      {view && !view.reviews.length ? <Text size="xs">未进行独立复核</Text> : null}
      {view?.message ? <Text size="xs" c="orange">{view.message}</Text> : null}
      {view ? <Group align="end">
        <Select label="复核范围" value={selection} onChange={setSelection} allowDeselect={false} data={[{ value: 'all', label: '整答' }, ...view.blocks.map(block => ({ value: String(block.index), label: `第 ${block.index + 1} 段：${block.text.slice(0, 48)}` }))]} style={{ flex: 1 }} />
        <Button size="xs" loading={busy} disabled={!view.available || !!active || !selection || answer.stale} onClick={() => { void start(); }}>{selection === 'all' ? '复核整答' : '复核这段'}</Button>
      </Group> : null}
      {active ? <Group><Text size="xs">正在复核，原回答仍可阅读。</Text><Button size="xs" variant="light" onClick={() => {
        void api.answerReviewCancel({ ...target, requestId: active.request.requestId, blocks: active.request.blocks }).then(() => { if (mounted.current && liveIdentity.current === identity) setRefresh(value => value + 1); }).catch(cause => { if (mounted.current && liveIdentity.current === identity) setError(String(cause)); });
      }}>取消复核</Button></Group> : null}
      {view?.reviews.map(review => <Stack key={review.request.requestId} gap={4}>
        <Text size="xs">{review.request.blocks === null ? '整答复核' : `第 ${review.request.blocks.map(index => index + 1).join('、')} 段复核`} · {review.startedAt}</Text>
        {review.status !== 'completed' ? <Text size="xs">{{ running: '复核中', failed: '复核失败，不能确认', cancelled: '复核已取消', outcome_unknown: '复核中断，结果未知', stale: '来源已变化，旧复核不再适用' }[review.status]}{review.message ? '：' + review.message : ''}</Text> : null}
        {review.assessment?.blocks.map(block => <div key={block.index}><Text size="sm">第 {block.index + 1} 段：{labels[block.verdict]}（模型评估）</Text>
          {block.claims.map((claim, index) => <Text size="xs" key={index}>“{claim.quote}” — {labels[claim.verdict]}：{claim.reason} {claim.markers.map(marker => `[${marker}]`).join(' ')}</Text>)}</div>)}
        {review.status === 'completed' && review.assessment?.blocks.some(block => block.verdict !== 'supported') ? <Button size="xs" variant="light" disabled={busy || answer.stale || !view.available} onClick={() => { void (async () => {
          const isCurrent = () => mounted.current && liveIdentity.current === identity;
          setBusy(true); setError(null);
          try {
          const currentView = await api.answerReviewView(target);
          if (!isCurrent()) return;
          setView(currentView);
          const currentReview = currentView.reviews.find(item => item.request.requestId === review.request.requestId);
          if (!currentView.available || currentReview?.status !== 'completed' || !currentReview.assessment) throw Error('来源或复核状态已变化，请重新查看材料。');
          const findings = currentReview.assessment.blocks.filter(block => block.verdict !== 'supported');
          onRevision(`以下是用户发起的独立复核意见，仅为待核材料，不是权威结论。请读取当前相关事实，检查这些意见并重新回答；推断和建议请分开说明。原回答保留，不自动再次复核。\n回答标识：${answer.answerId}\n复核时间：${review.startedAt}\n` + findings.map(block => `第 ${block.index + 1} 段：${labels[block.verdict]}\n` + block.claims.map(claim => `原文：${claim.quote}\n复核意见：${labels[claim.verdict]}：${claim.reason} ${claim.markers.map(marker => `[${marker}]`).join(' ')}（引用编号属于原回答，须重新查证）`).join('\n')).join('\n'));
          } catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : '无法读取当前复核材料'); }
          finally { if (isCurrent()) setBusy(false); }
        })(); }}>将复核意见填入提问</Button> : null}
      </Stack>)}
      {error ? <Text size="xs" c="red">{error}</Text> : null}
    </> : null}
  </Stack>;
}
