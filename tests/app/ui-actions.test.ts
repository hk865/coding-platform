/**
 * Workbench action tables — `src/ui/views/shell/actions.ts` and the area tables it dispatches to.
 *
 * The UI split turned the entry's single `handleAction` switch (131 case labels) into one table per
 * area behind a small dispatcher, keeping every case body as it was. These cases pin what the split
 * must not change: the same set of action names, each owned by exactly one table; an own-property
 * lookup, so an inherited name such as `toString` is never an action; and the old order of work: the
 * selected scope is read before the lookup (so any action throws while nothing is selected), and an
 * unknown name is otherwise a no-op that renders nothing.
 * Pure Node test: no DOM, no network, no Host. No action handler runs.
 */
import { describe, expect, it } from 'vitest';
import type { ScopeState } from '../../src/ui/state/scope-state.js';
import { scopes, setSelectedKey, store } from '../../src/ui/state/workbench.js';
import type { WorkbenchAction } from '../../src/ui/state/workbench.js';
import { actionTables, handleAction, lookup } from '../../src/ui/views/shell/actions.js';

// The case labels of `handleAction` in src/ui/main.ts at 215d7ed (before the split), sorted.
const BASELINE_ACTIONS = [
  'activate-policy', 'activate-tab', 'add-path-reference', 'add-selection-reference', 'adopt-architecture',
  'adopt-architecture-draft', 'adopt-initial-plan', 'apply-plan', 'archive-session', 'capture-observed',
  'capture-source', 'clear-composer', 'close-context', 'close-tab', 'collapse-branches', 'compare-files',
  'compare-path', 'consult-message', 'context-detail', 'context-pin', 'control-cancel', 'control-pause',
  'control-resume', 'control-steer', 'copy-code', 'create-goal', 'create-project', 'create-session',
  'directory-more', 'expand-active-paths', 'expand-aux', 'find-sessions', 'install-policy', 'load-executions',
  'load-next-executions', 'load-text-diff', 'next-center-history', 'next-execution-history', 'next-history-tab',
  'next-inbox', 'next-related-sessions', 'next-session-history', 'next-session-tab', 'next-sessions',
  'open-architecture-graph', 'open-claim-session', 'open-directory', 'open-directory-input',
  'open-execution-history', 'open-file', 'open-goal-model-settings', 'open-module-detail', 'open-page',
  'open-session-tab', 'open-setup-tab', 'open-task-detail', 'open-task-graph', 'process-consultation',
  'propose-plan', 'query-next', 'query-observed', 'query-paths', 'query-task-tab', 'query-tasks',
  'reactivate-session', 'read-architecture', 'read-architecture-tab', 'read-center-history',
  'read-collaboration-message', 'read-execution-history', 'read-execution-record', 'read-file', 'read-goal',
  'read-history-tab', 'read-inbox', 'read-message', 'read-message-body', 'read-path', 'read-proposal',
  'read-runtime-capabilities', 'read-session', 'read-session-history', 'read-session-operation',
  'read-session-tab', 'rebuild-conflict', 'refresh-directory', 'refresh-execution', 'refresh-members',
  'refresh-session', 'refresh-source-tree', 'register-workspace', 'replay', 'resume-original-investigation',
  'retry', 'retry-member-send', 'review-plan-candidate', 'run-continue', 'run-investigation', 'run-new-goal',
  'run-planning', 'save-file', 'select-collaboration-task', 'select-main-conversation', 'select-node',
  'select-query-profile', 'select-scope', 'select-session', 'send-main-message', 'send-member-message',
  'send-message', 'set-center-mode', 'set-graph-edges', 'set-graph-mode', 'set-grouping', 'start-command',
  'start-goal-investigation', 'stop-command', 'stop-execution', 'toggle-archived', 'toggle-aux', 'toggle-branch',
  'toggle-center-identity', 'toggle-center-menu', 'toggle-code-wrap', 'toggle-history-fold', 'toggle-nav',
  'toggle-pin', 'toggle-pin-selected', 'toggle-project', 'toggle-theme', 'view-latest',
] as const;

const element = {} as Parameters<typeof handleAction>[1];

describe('workbench action tables', () => {
  it('cover exactly the baseline action names', () => {
    expect(new Set(BASELINE_ACTIONS).size).toBe(131);
    const names = Object.values(actionTables()).flatMap(table => Object.keys(table));
    expect([...names].sort()).toEqual([...BASELINE_ACTIONS].sort());
  });

  it('give every name exactly one owning table', () => {
    const tables = actionTables();
    expect(Object.keys(tables)).toEqual(['shell', 'conversation', 'sessions', 'execution', 'setup', 'files', 'graphs', 'terminal']);
    const owners = new Map<string, string[]>();
    for (const [area, table] of Object.entries(tables))
      for (const name of Object.keys(table)) owners.set(name, [...(owners.get(name) ?? []), area]);
    expect([...owners].filter(([, areas]) => areas.length !== 1)).toEqual([]);
    for (const name of BASELINE_ACTIONS) expect(typeof lookup(name), name).toBe('function');
  });

  it('never resolve an inherited or unknown name', () => {
    for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf', '', 'noop', 'no-such-action'])
      expect(lookup(name), name).toBeUndefined();
  });

  it('read the selected scope before the lookup, like the old switch', async () => {
    expect(store.get('selectedKey')).toBe('');
    await expect(handleAction('no-such-action', element)).rejects.toThrow('the workbench has no selected scope');
    await expect(handleAction('toggle-nav', element)).rejects.toThrow('the workbench has no selected scope');
  });

  it('treat an unknown or inherited name as a no-op once a scope is selected', async () => {
    const seen: WorkbenchAction[] = [];
    const off = store.listen(action => seen.push(action));
    scopes().set('scope-a', { key: 'scope-a' } as ScopeState);
    setSelectedKey('scope-a');
    try {
      await expect(handleAction('no-such-action', element)).resolves.toBeUndefined();
      await expect(handleAction('toString', element)).resolves.toBeUndefined();
      await expect(handleAction('constructor', element)).resolves.toBeUndefined();
      expect(seen).toEqual([]);
    } finally {
      off();
      setSelectedKey('');
      scopes().delete('scope-a');
    }
  });
});
