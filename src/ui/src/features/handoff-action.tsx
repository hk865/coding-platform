import { Button, Modal, Stack, Text, Textarea } from '@mantine/core';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateScope, mutationError } from '../api/hooks';
import type { ViewProps } from '../workbench/view-props';

export function HandoffAction({ api, store, goalScope, sourceRunId }: Pick<ViewProps, 'api' | 'store' | 'goalScope'> & { sourceRunId: string }) {
  const [open, setOpen] = useState(false), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const client = useQueryClient();
  const submit = async () => {
    if (!goalScope || busy || !reason.trim()) return;
    setBusy(true); setError('');
    try {
      const operation = 'handoff';
      const request = await store.beginRequest(goalScope, operation, [sourceRunId, reason.trim()]);
      try { await api.handoff(goalScope, { requestId: request.requestId, sourceRunId, reason: reason.trim() }); store.settleRequest(goalScope, operation, request.requestId); }
      catch (error) { if (!mutationError(error).unknown) store.settleRequest(goalScope, operation, request.requestId); throw error; }
      invalidateScope(client, goalScope); setOpen(false);
      store.notify('info', '换手已登记；新运行按当前任务资格和权限继续。');
    } catch (error) { setError(mutationError(error).message); }
    finally { setBusy(false); }
  };
  return <><Button variant="subtle" onClick={() => setOpen(true)}>交接继续</Button>
    <Modal opened={open} onClose={() => { if (!busy) setOpen(false); }} title="交接给新运行" centered>
      <Stack gap="sm"><Text size="sm">沿用当前任务、权限和验收要求；交接记录保留来源及未解决事项。</Text>
        <Textarea label="继续原因与未解决事项" value={reason} onChange={event => setReason(event.currentTarget.value)} maxLength={1024} autosize minRows={3} />
        {error ? <Text c="red" size="sm">{error}</Text> : null}
        <Button loading={busy} disabled={!reason.trim()} onClick={() => void submit()}>登记换手并继续</Button>
      </Stack>
    </Modal></>;
}
