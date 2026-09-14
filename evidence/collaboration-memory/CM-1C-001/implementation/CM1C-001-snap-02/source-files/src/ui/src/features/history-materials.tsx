import { Alert, Button, Group, Paper, Select, Stack, Text, TextInput } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import type { ViewProps } from '../workbench/view-props';
import type { HistoryView } from '../api/types';
import { RawDetails } from '../components/states';
import { mutationError } from '../api/hooks';

export function HistoryMaterialsView({ api, goalScope, data, store }: ViewProps) {
  const key = goalScope ? JSON.stringify(goalScope) : '', current = useRef(key); current.current = key;
  const [view, setView] = useState<HistoryView | null>(null), [materialId, setMaterial] = useState<string | null>(null), [runId, setRun] = useState<string | null>(null);
  const [purpose, setPurpose] = useState('读取相关历史解释'), [message, setMessage] = useState(''), [body, setBody] = useState<unknown>(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    setView(null); setMaterial(null); setRun(null); setBody(null); setMessage('');
    if (!goalScope) return;
    void api.historyView(goalScope).then(value => { if (current.current === key) setView(value); }).catch(error => { if (current.current === key) setMessage(mutationError(error).message); });
  }, [key, api]);
  const perform = async (operation: 'grant' | 'revoke' | 'read', grantId?: string) => {
    if (!goalScope || busy) return;
    setBusy(true); setMessage('');
    try {
      if (operation === 'read') {
        const result = await api.historyRead(goalScope, grantId!); if (current.current === key) setBody(result);
      } else {
        const payload = operation === 'grant' ? { materialId, runId, purpose, allowHistoricalRead: true } : { grantId, reason: purpose };
        const kind = operation === 'grant' ? 'history-grant' : 'history-revoke';
        const { requestId } = await store.beginRequest(goalScope, kind, payload);
        try {
          if (operation === 'grant') await api.historyGrant(goalScope, { ...payload, requestId });
          else await api.historyRevoke(goalScope, { ...payload, requestId });
          store.settleRequest(goalScope, kind, requestId);
        } catch (error) { if (!mutationError(error).unknown) store.settleRequest(goalScope, kind, requestId); throw error; }
        const updated = await api.historyView(goalScope);
        if (current.current === key) { setView(updated); setMessage(operation === 'grant' ? '精确历史授权已记录；原 owner 和来源保留。' : '授权已撤销，后续读取立即复核。'); }
      }
    } catch (error) { if (current.current === key) setMessage(mutationError(error).message); }
    finally { setBusy(false); }
  };
  const selected = view?.materials.find(item => item.id === materialId);
  return <Paper withBorder p="xs" data-testid="history-materials"><Stack gap="xs">
    <Text size="sm" fw={600}>历史材料精确授权</Text>
    <Text size="xs" c="dimmed">{view?.coverage ?? '先选择目标，读取可选来源。'} 历史解释不继承旧完成或旧权限。</Text>
    <Select label="来源报告" data-testid="history-source" value={materialId} onChange={setMaterial} searchable data={(view?.materials ?? []).map(item => ({ value: item.id, label: item.workspaceId + ' / ' + item.owner.goalId + ' / ' + item.label }))} />
    {selected ? <><Text size="xs" style={{ overflowWrap: 'anywhere' }}>原运行：{selected.owner.runId} · 摘要：{selected.artifactRef.digest}</Text><Text size="xs">{selected.workspaceId === goalScope?.workspaceId ? '同工作区历史读取' : '跨 Workspace 显式授权；仅对下方目标 Run 生效。'}</Text></> : null}
    <Select label="目标运行" data-testid="history-target" value={runId} onChange={setRun} data={(data?.liveRuns ?? []).map(run => ({ value: run.spec.runId, label: run.spec.runId }))} />
    <TextInput label="授权或撤销原因" value={purpose} onChange={event => setPurpose(event.currentTarget.value)} />
    <Button data-testid="grant-history" disabled={!selected || !runId || !purpose.trim()} loading={busy} onClick={() => void perform('grant')}>授权所选原报告供目标运行读取</Button>
    {message ? <Alert data-testid="history-message">{message}</Alert> : null}
    {(view?.grants.status === 'ready' ? view.grants.grants : []).map(row => <Paper key={row.ref.grantId} withBorder p="xs"><Stack gap={4}>
      <Text size="xs">{row.grant.purpose} · {row.grant.reader.runId} · {row.revocation ? '已撤销' : '已记录，读取时复核版本'}</Text>
      <Group><Button size="xs" disabled={busy || !!row.revocation} onClick={() => void perform('read', row.ref.grantId)}>查看授权读取结果</Button><Button size="xs" color="red" disabled={busy || !!row.revocation || !purpose.trim()} onClick={() => void perform('revoke', row.ref.grantId)}>撤销</Button><RawDetails label="授权来源与版本" value={row} /></Group>
    </Stack></Paper>)}
    {body ? <RawDetails label="历史读取结果（含原 owner 与正文）" value={body} /> : null}
  </Stack></Paper>;
}
