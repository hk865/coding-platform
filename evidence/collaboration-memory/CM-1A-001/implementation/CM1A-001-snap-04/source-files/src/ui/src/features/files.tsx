import { ActionIcon, Badge, Box, Button, Group, Stack, Text, Textarea, Tooltip } from '@mantine/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Api } from '../api/client';
import { queryKeys, useDirectory, usePreview } from '../api/hooks';
import type { Scope } from '../api/types';
import type { AppStore } from '../state/app-store';
import { EmptyState, ErrorState, FieldRow, LoadingState, StaleNotice } from '../components/states';
import { fileLineLabel } from '../format';
import { referenceState } from '../state/drafts';
import type { ViewProps } from '../workbench/view-props';

const MAX_RENDERED_LINES = 4000;

export function FilesView({ api, scope, store }: ViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));
  const [folder, setFolder] = useState('');

  const toggle = (path: string) => {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
    setFolder(path);
  };

  const renderLevel = (path: string, depth: number): React.ReactNode => (
    <DirectoryLevel key={path || 'root'} api={api} scope={scope} path={path} depth={depth} expanded={expanded} toggle={toggle} store={store} />
  );

  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <Group justify="space-between" px="sm" py={6} className="panel-head">
        <Stack gap={0}>
          <Text size="sm" fw={600}>项目文件</Text>
          <Text size="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>{folder || '项目根目录'} · 只读预览</Text>
        </Stack>
        <ActionIcon aria-label="回到根目录" onClick={() => { setExpanded(new Set([''])); setFolder(''); }}>⌂</ActionIcon>
      </Group>
      <Box className="panel-body" style={{ minHeight: 0, overflow: 'auto' }}>
        {renderLevel('', 0)}
      </Box>
    </Stack>
  );
}

type LevelProps = { api: Api; scope: Scope | null; path: string; depth: number; expanded: Set<string>; toggle: (path: string) => void; store: AppStore };

function DirectoryLevel({ api, scope, path, depth, expanded, toggle, store }: LevelProps) {
  const open = expanded.has(path) || path === '';
  const query = useDirectory(api, scope, path, open);
  if (!open) return null;
  if (query.isLoading) return <Box pl={12 + depth * 12}><LoadingState label="正在读取目录…" /></Box>;
  if (query.error) return <Box pl={12 + depth * 12}><ErrorState message={(query.error as Error).message} /></Box>;
  const listing = query.data;
  if (!listing) return null;
  if (!listing.entries.length) return <Box pl={12 + depth * 12}><Text size="xs" c="dimmed">此文件夹为空</Text></Box>;
  return (
    <Stack gap={0} role="tree" aria-label={path || '项目根目录'}>
      {listing.entries.map(entry => (
        <Box key={entry.path} role="treeitem" aria-expanded={entry.kind === 'directory' ? expanded.has(entry.path) : undefined}>
          <Group gap={4} wrap="nowrap" className="file-row" style={{ paddingLeft: 8 + depth * 12 }} onClick={() => { if (entry.kind === 'directory') toggle(entry.path); else store.openFile(entry.path); }} data-path={entry.path} data-kind={entry.kind}>
            <Text size="xs" w={12} c="dimmed">{entry.kind === 'directory' ? (expanded.has(entry.path) ? '▾' : '▸') : entry.kind === 'link' ? '↗' : '·'}</Text>
            <Text size="xs" truncate style={{ fontFamily: entry.kind === 'file' ? 'var(--mantine-font-family-monospace)' : undefined }}>{entry.name}</Text>
          </Group>
          {entry.kind === 'directory' && expanded.has(entry.path) ? <DirectoryLevel api={api} scope={scope} path={entry.path} depth={depth + 1} expanded={expanded} toggle={toggle} store={store} /> : null}
        </Box>
      ))}
      {listing.truncated ? <Text size="xs" c="dimmed" pl={12 + depth * 12}>目录较大，仅显示前 500 项。</Text> : null}
    </Stack>
  );
}

function CodeLines({ content, selection, onSelect, focusLine }: { content: string; selection: { start: number; end: number } | null; onSelect: (lines: { start: number; end: number } | null) => void; focusLine?: number | undefined }) {
  const lines = useMemo(() => content.split('\n'), [content]);
  const host = useRef<HTMLDivElement | null>(null);
  const anchor = useRef<number | null>(null);

  useEffect(() => {
    if (!focusLine || !host.current) return;
    const node = host.current.querySelector('[data-line="' + focusLine + '"]');
    if (node instanceof HTMLElement) node.scrollIntoView({ block: 'center' });
  }, [focusLine, content]);

  const click = (line: number, shift: boolean) => {
    if (shift && anchor.current !== null) {
      const start = Math.min(anchor.current, line), end = Math.max(anchor.current, line);
      onSelect({ start, end });
    } else { anchor.current = line; onSelect({ start: line, end: line }); }
  };

  const rendered = lines.length > MAX_RENDERED_LINES ? lines.slice(0, MAX_RENDERED_LINES) : lines;
  return (
    <Box ref={host} className="code-lines" data-testid="file-content">
      {rendered.map((text, index) => {
        const line = index + 1;
        const selected = selection ? line >= selection.start && line <= selection.end : false;
        return (
          <div
            key={line}
            className={'code-line' + (selected ? ' selected' : '') + (focusLine === line ? ' focused' : '')}
            data-line={line}
            onClick={event => click(line, event.shiftKey)}
          >
            <span className="code-gutter" aria-hidden="true">{line}</span>
            <span className="code-text">{text || ' '}</span>
          </div>
        );
      })}
      {lines.length > MAX_RENDERED_LINES ? <Text size="xs" c="dimmed" p="xs">文件较大，仅显示前 {MAX_RENDERED_LINES} 行；可在终端中查看完整内容。</Text> : null}
    </Box>
  );
}

export function FileView({ api, scope, goalScope, store, tab }: ViewProps) {
  const path = tab?.payload.path ?? null;
  const query = usePreview(api, scope, path);
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(tab?.payload.lines ?? null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => { setSelection(tab?.payload.lines ?? null); setMessage(null); }, [path, tab?.payload.lines?.start, tab?.payload.lines?.end]);
  useEffect(() => { if (query.error) store.invalidateTab(tab?.id ?? '', (query.error as Error).message); }, [query.error]);

  if (!path) return <EmptyState title="未选择文件" description="在“文件”视图中选择文件后在这里预览。" />;
  if (query.isLoading) return <LoadingState label="正在读取文件…" />;
  if (query.error) return <ErrorState message={(query.error as Error).message} />;
  const file = query.data;
  if (!file) return null;
  if (file.kind !== 'text') {
    const reason = file.kind === 'too_large' ? '文件超过 256 KB，请使用终端查看。' : file.kind === 'directory' ? '这是一个目录。' : '二进制或不支持编码的文件，无法预览。';
    return <EmptyState title={file.path} description={reason} />;
  }

  const draft = store.draft(goalScope);
  const existing = draft.references.find(reference => reference.path === file.path);
  const stale = existing ? referenceState(existing, file.sha256) === 'stale' : false;

  const add = () => {
    if (!goalScope) { setMessage('请先选择目标，再把文件加入任务草稿。'); return; }
    const result = store.addReference(goalScope, { path: file.path, sha256: file.sha256, ...(selection ? { lines: selection } : {}) });
    setMessage(result.message);
  };

  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }}>
      <Group justify="space-between" px="sm" py={6} className="panel-head" wrap="nowrap">
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text size="sm" fw={600} truncate>{file.path}</Text>
          <Text size="xs" c="dimmed">{file.size} 字节 · 只读预览 · SHA-256 {file.sha256.slice(0, 12)}…</Text>
        </Stack>
        <Group gap={4} wrap="nowrap">
          <Tooltip label="重新读取磁盘上的当前内容"><Button size="xs" variant="light" onClick={() => { if (scope && path) void queryClient.invalidateQueries({ queryKey: queryKeys.preview(scope, path) }); }} data-testid="reload-file">重新读取</Button></Tooltip>
          <Tooltip label={selection ? '引用 ' + file.path + fileLineLabel(selection) : '先点击行号选择片段'}>
            <Button size="xs" onClick={add} disabled={!selection || !goalScope} data-testid="add-reference">添加到对话</Button>
          </Tooltip>
        </Group>
      </Group>
      {message ? <Text size="xs" c="dimmed" px="sm" pb={4} data-testid="reference-message">{message}</Text> : null}
      {stale ? (
        <StaleNotice message={'已引用的版本与当前文件不一致（' + file.path + '）。'} action={<Button size="xs" variant="light" onClick={() => { if (goalScope) store.addReference(goalScope, { path: file.path, sha256: file.sha256, ...(selection ? { lines: selection } : {}) }); }}>更新为当前版本</Button>} />
      ) : null}
      <Box className="panel-body" style={{ minHeight: 0, overflow: 'auto' }}>
        <CodeLines content={file.content} selection={selection} onSelect={setSelection} focusLine={tab?.payload.lines?.start} />
      </Box>
      <Group px="sm" py={4} className="panel-foot" gap="xs">
        <Text size="xs" c="dimmed">{selection ? '已选 ' + fileLineLabel(selection).replace(':', '第 ') + ' 行' : '点击行号选择；Shift 点击选择范围'}</Text>
        {selection ? <Button size="xs" variant="subtle" onClick={() => setSelection(null)}>清除选择</Button> : null}
      </Group>
    </Stack>
  );
}

export function FileReferenceList({ references, onRemove }: { references: { path: string; sha256: string; lines?: { start: number; end: number } }[]; onRemove: (path: string) => void }) {
  if (!references.length) return null;
  return (
    <Stack gap={2}>
      {references.map(reference => (
        <Group key={reference.path} gap="xs" wrap="nowrap">
          <Badge variant="light" color="gray">引用</Badge>
          <Text size="xs" style={{ fontFamily: 'var(--mantine-font-family-monospace)' }}>{reference.path}{fileLineLabel(reference.lines)}</Text>
          <Text size="xs" c="dimmed">SHA-256 {reference.sha256.slice(0, 12)}</Text>
          <ActionIcon size="xs" aria-label={'移除 ' + reference.path} onClick={() => onRemove(reference.path)}>×</ActionIcon>
        </Group>
      ))}
    </Stack>
  );
}

export function FileFacts({ file }: { file: { path: string; size?: number; sha256?: string } }) {
  return (
    <Stack gap={0}>
      <FieldRow label="路径" mono>{file.path}</FieldRow>
      {file.size !== undefined ? <FieldRow label="大小">{file.size} 字节</FieldRow> : null}
      {file.sha256 ? <FieldRow label="版本" mono>{file.sha256}</FieldRow> : null}
    </Stack>
  );
}

export function ReferenceEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <Textarea value={value} onChange={event => onChange(event.currentTarget.value)} autosize minRows={2} aria-label="材料说明" />;
}

