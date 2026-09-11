import { Button, Group, Paper, Select, Stack, Text, TextInput } from '@mantine/core';

/** Editable strings are UI drafts; the Verification service validates/fixes configuration identity. */
export type CheckDraft = {
  key: string;
  checkId: string;
  kind: 'static' | 'dynamic';
  command: string;
  cwd: string;
  seconds: string;
};

export function newCheckDraft(index: number): CheckDraft {
  return { key: crypto.randomUUID(), checkId: `check-${index}`, kind: 'dynamic', command: '', cwd: '.', seconds: '120' };
}

export function VerificationCheckEditor({ checks, onChange, disabled }: {
  checks: CheckDraft[];
  onChange: (checks: CheckDraft[]) => void;
  disabled: boolean;
}) {
  const update = (key: string, patch: Partial<CheckDraft>) => onChange(checks.map(check => check.key === key ? { ...check, ...patch } : check));
  return <Stack gap="xs" data-testid="round-check-config">
    {checks.map((check, index) => <Paper withBorder p="xs" key={check.key}>
      <Stack gap={4}>
        <Group justify="space-between">
          <Text size="xs" fw={600}>检查 {index + 1}</Text>
          <Button size="compact-xs" variant="subtle" color="red" disabled={disabled} onClick={() => onChange(checks.filter(value => value.key !== check.key))} aria-label={`删除检查 ${index + 1}`}>删除</Button>
        </Group>
        <Group gap="xs" grow>
          <TextInput size="xs" label="检查标识" value={check.checkId} disabled={disabled} onChange={event => update(check.key, { checkId: event.currentTarget.value })} data-testid={`round-check-id-${index}`} />
          <Select size="xs" label="类型" value={check.kind} disabled={disabled} data={[{ value: 'dynamic', label: '行为测试' }, { value: 'static', label: '静态检查' }]} onChange={value => { if (value === 'static' || value === 'dynamic') update(check.key, { kind: value }); }} data-testid={`round-check-kind-${index}`} />
        </Group>
        <TextInput size="xs" label="检查命令" placeholder="填写此项目实际使用的检查命令" value={check.command} disabled={disabled} onChange={event => update(check.key, { command: event.currentTarget.value })} data-testid={`round-check-command-${index}`} />
        <Group gap="xs" grow>
          <TextInput size="xs" label="项目内执行目录" value={check.cwd} disabled={disabled} onChange={event => update(check.key, { cwd: event.currentTarget.value })} data-testid={`round-check-cwd-${index}`} />
          <TextInput size="xs" label="单次超时（秒）" type="number" min={1} max={600} value={check.seconds} disabled={disabled} onChange={event => update(check.key, { seconds: event.currentTarget.value })} data-testid={`round-check-timeout-${index}`} />
        </Group>
      </Stack>
    </Paper>)}
    <Button size="xs" variant="light" disabled={disabled} onClick={() => {
      let index = checks.length + 1;
      while (checks.some(check => check.checkId === `check-${index}`)) index++;
      onChange([...checks, newCheckDraft(index)]);
    }} data-testid="round-add-check">添加检查</Button>
    {!checks.length ? <Text size="xs" c="dimmed">尚未配置检查。添加此任务实际需要的检查命令。</Text> : null}
  </Stack>;
}
