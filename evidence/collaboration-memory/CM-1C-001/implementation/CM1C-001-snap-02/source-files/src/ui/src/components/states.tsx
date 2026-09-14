import { Alert, Badge, Box, Center, Group, Loader, Paper, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';

export type DataStatus = 'loading' | 'empty' | 'ready' | 'error' | 'stale' | 'unavailable';

export function LoadingState({ label = '正在读取…' }: { label?: string }) {
  return <Center p="md" role="status" aria-live="polite"><Group gap="xs"><Loader size="xs" /><Text size="xs" c="dimmed">{label}</Text></Group></Center>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <Stack gap={6} p="md" align="flex-start" data-state="empty">
      <Text size="sm" fw={600}>{title}</Text>
      {description ? <Text size="xs" c="dimmed">{description}</Text> : null}
      {action}
    </Stack>
  );
}

export function ErrorState({ title = '读取失败', message, action }: { title?: string; message: string; action?: ReactNode }) {
  return (
    <Alert color="red" variant="light" title={title} role="alert" data-state="error" m="xs">
      <Stack gap="xs">
        <Text size="xs">{message}</Text>
        {action}
      </Stack>
    </Alert>
  );
}

/** Capability the backend does not provide yet: state the gap, never fake content. */
export function UnavailableState({ title, reason, dependencies }: { title: string; reason: string; dependencies: string[] }) {
  return (
    <Box p="md" data-state="unavailable">
      <Stack gap="xs">
        <Group gap="xs"><Badge color="gray" variant="light">后端未支持</Badge><Text size="sm" fw={600}>{title}</Text></Group>
        <Text size="xs" c="dimmed">{reason}</Text>
        <Text size="xs" fw={500}>缺少的依赖</Text>
        <Stack gap={2}>{dependencies.map(item => <Text key={item} size="xs" c="dimmed">· {item}</Text>)}</Stack>
      </Stack>
    </Box>
  );
}

export function StaleNotice({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <Alert color="yellow" variant="light" data-state="stale" m="xs" role="status">
      <Group justify="space-between" gap="xs" wrap="nowrap">
        <Text size="xs">{message}</Text>
        {action}
      </Group>
    </Alert>
  );
}

export function Panel({ title, description, actions, children, scroll = true }: { title: string; description?: string; actions?: ReactNode; children: ReactNode; scroll?: boolean }) {
  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <Group justify="space-between" wrap="nowrap" px="sm" py={6} className="panel-head">
        <Stack gap={0}>
          <Text size="sm" fw={600}>{title}</Text>
          {description ? <Text size="xs" c="dimmed">{description}</Text> : null}
        </Stack>
        {actions ? <Group gap={4} wrap="nowrap">{actions}</Group> : null}
      </Group>
      <Box className="panel-body" style={{ minHeight: 0, overflowY: scroll ? 'auto' : 'hidden' }}>{children}</Box>
    </Stack>
  );
}

export function FieldRow({ label, children, mono = false }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <Group gap="xs" align="flex-start" wrap="nowrap" py={2}>
      <Text size="xs" c="dimmed" w={92} style={{ flexShrink: 0 }}>{label}</Text>
      <Text size="xs" style={{ fontFamily: mono ? 'var(--mantine-font-family-monospace)' : undefined, wordBreak: 'break-all' }}>{children}</Text>
    </Group>
  );
}

export function RawDetails({ value, label = '查看原始记录' }: { value: unknown; label?: string }) {
  return (
    <details className="raw-details">
      <summary>{label}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export function PaperSection({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <Paper withBorder p="sm" radius="sm" className="section-paper">
      <Group justify="space-between" mb={6} wrap="nowrap">
        <Text size="xs" fw={600}>{title}</Text>
        {actions}
      </Group>
      {children}
    </Paper>
  );
}
