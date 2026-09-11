import { Badge, Box, Button, Group, Select, Stack, Text } from '@mantine/core';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../api/client';
import { useTerminals } from '../api/hooks';
import { useAppStore } from '../state/app-store';
import type { ViewProps } from '../workbench/view-props';

/**
 * Restricted project shell. The session lives on the server: collapsing the
 * bottom tool area or switching tabs never kills it, and only the explicit
 * "结束会话" action or Ctrl+C affects the process.
 */
export function TerminalView({ api, scope }: ViewProps) {
  const store = useAppStore();
  const host = useRef<HTMLDivElement | null>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const cursor = useRef(0);
  const generation = useRef(0);
  const polling = useRef(false);
  const inputQueue = useRef<Promise<unknown>>(Promise.resolve());
  const sessionRef = useRef('');
  const [sessionId, setSessionId] = useState('');
  const [status, setStatus] = useState('受限 Bash · 项目内读写 · 系统工具只读 · 网络关闭');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionsQuery = useTerminals(api, scope, true);
  sessionRef.current = sessionId;

  const fit = useCallback(() => {
    const node = host.current, instance = terminal.current, addon = fitAddon.current;
    if (!node || !instance || !addon) return;
    if (node.clientWidth < 40 || node.clientHeight < 40) return;
    try { addon.fit(); } catch { return; }
    if (sessionRef.current) void api.terminalResize(scope!, { sessionId: sessionRef.current, cols: Math.max(10, instance.cols), rows: Math.max(2, instance.rows) }).catch(() => {});
  }, [api, scope]);

  useEffect(() => {
    if (!host.current || terminal.current) return;
    const instance = new Terminal({ cursorBlink: true, fontSize: 12, scrollback: 3000, fontFamily: '"Cascadia Mono", Consolas, monospace', theme: { background: '#101418', foreground: '#d7dee6' } });
    const addon = new FitAddon();
    instance.loadAddon(addon);
    instance.open(host.current);
    instance.textarea?.setAttribute('aria-label', '终端输入');
    instance.onData(data => {
      const id = sessionRef.current;
      if (!id || !scope) return;
      for (let start = 0; start < data.length; start += 4096) {
        const fragment = data.slice(start, start + 4096);
        const requestId = crypto.randomUUID();
        inputQueue.current = inputQueue.current.then(() => api.terminalInput(scope, { sessionId: id, data: fragment, requestId })).catch(failure => setError(errorMessage(failure)));
      }
    });
    terminal.current = instance;
    fitAddon.current = addon;
    const observer = new ResizeObserver(() => fit());
    observer.observe(host.current);
    return () => { observer.disconnect(); instance.dispose(); terminal.current = null; fitAddon.current = null; };
  }, [api, scope, fit]);

  const poll = useCallback(async () => {
    const id = sessionRef.current;
    if (!id || !scope || polling.current) return;
    const version = generation.current;
    polling.current = true;
    try {
      const output = await api.terminalOutput(scope, id, cursor.current);
      if (version !== generation.current || id !== sessionRef.current) return;
      const instance = terminal.current;
      if (!instance) return;
      if (output.truncated) { instance.reset(); instance.write('\r\n[仅保留最近的终端输出]\r\n'); }
      for (const chunk of output.chunks) {
        if (version !== generation.current || id !== sessionRef.current) return;
        if (chunk.cols && chunk.rows && (instance.cols !== chunk.cols || instance.rows !== chunk.rows)) instance.resize(chunk.cols, chunk.rows);
        if (chunk.data) instance.write(chunk.data);
      }
      cursor.current = output.through;
      setStatus(output.status === 'exited' ? '会话已退出，退出码 ' + output.exitCode + '。可以新建终端。' : '受限 Bash · 项目内读写 · 系统工具只读 · 网络关闭');
    } catch (failure) { if (version === generation.current) setStatus('读取终端输出失败：' + errorMessage(failure)); }
    finally { polling.current = false; }
  }, [api, scope]);

  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) void poll(); }, 300);
    return () => window.clearInterval(timer);
  }, [poll]);

  const choose = (id: string) => {
    if (id === sessionId) return;
    store.setTerminalSession(scope, id);
    setSessionId(id); cursor.current = 0; generation.current += 1; polling.current = false;
    terminal.current?.reset();
    window.setTimeout(() => { void poll(); fit(); }, 0);
  };

  useEffect(() => {
    if (!sessionsQuery.data) return;
    const list = sessionsQuery.data.sessions;
    if (sessionId && list.some(session => session.id === sessionId)) return;
    // Prefer the session this scope used before (survives a page reload); otherwise the newest one.
    const remembered = store.getTerminalSession(scope);
    const next = list.find(session => session.id === remembered)?.id ?? list.at(-1)?.id ?? '';
    if (next !== sessionId) choose(next);
  }, [sessionsQuery.data, sessionId]);

  const create = async () => {
    if (!scope || busy) return;
    setBusy(true); setError(null);
    try {
      const created = await api.createTerminal(scope, { requestId: crypto.randomUUID(), cols: Math.max(10, terminal.current?.cols ?? 80), rows: Math.max(2, terminal.current?.rows ?? 24) });
      await sessionsQuery.refetch();
      choose(created.id);
      terminal.current?.focus();
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  };

  const close = async () => {
    if (!scope || !sessionId || busy) return;
    setBusy(true); setError(null);
    try { await api.terminalClose(scope, sessionId); await poll(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  };

  const current = sessionsQuery.data?.sessions.find(session => session.id === sessionId);

  return (
    <Stack gap={0} h="100%" style={{ minHeight: 0 }} data-testid="terminal-view">
      <Group px="sm" py={4} className="panel-head" gap="xs" wrap="nowrap">
        <Select
          size="xs" w={220} value={sessionId} onChange={value => choose(value ?? '')} aria-label="终端会话" data-testid="terminal-session" data-session-id={sessionId}
          data={(sessionsQuery.data?.sessions ?? []).map((session, index) => ({ value: session.id, label: 'Bash ' + (index + 1) + (session.status === 'exited' ? ' · 已退出' : '') }))}
          placeholder="无终端会话" disabled={!sessionsQuery.data?.sessions.length}
        />
        <Button size="xs" onClick={() => void create()} loading={busy} data-testid="terminal-new">新建终端</Button>
        <Button size="xs" variant="light" onClick={() => { const id = sessionRef.current; if (id && scope) { const requestId = crypto.randomUUID(); void api.terminalInput(scope, { sessionId: id, data: '\u0003', requestId }).catch(failure => setError(errorMessage(failure))); } }} disabled={!sessionId || current?.status !== 'running'} data-testid="terminal-interrupt">Ctrl+C 中断</Button>
        <Button size="xs" variant="subtle" color="red" onClick={() => void close()} disabled={!sessionId} data-testid="terminal-close">结束会话</Button>
        <Badge variant="light" color="gray">折叠面板不会终止会话</Badge>
      </Group>
      <Box ref={host} className="terminal-host" data-testid="terminal-host" />
      <Group px="sm" py={2} className="panel-foot" gap="xs" wrap="nowrap">
        <Text size="xs" c="dimmed" data-testid="terminal-status">{status}</Text>
        {current ? <Text size="xs" c="dimmed">启动目录 {current.cwd}</Text> : null}
        {error ? <Text size="xs" c="red">{error}</Text> : null}
      </Group>
    </Stack>
  );
}

