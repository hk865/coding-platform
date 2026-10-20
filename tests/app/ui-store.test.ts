/**
 * Workbench store — the minimal `createStore` of `src/ui/state/store.ts`.
 *
 * The store replaces the entry's module-level mutable bindings without changing
 * when anything runs, so these cases pin the semantics the UI split relies on:
 * slices are read and replaced by reference, every notification is synchronous
 * and unbatched, a nested dispatch is delivered depth-first, a notification
 * iterates over a snapshot, and a listener's exception reaches the caller.
 * The page's instance (`src/ui/state/workbench.ts`) starts from the entry's
 * original initial values, turns renderAll/renderScopeIfSelected into
 * synchronous `render` intents and keeps ONE request sequence.
 * Pure Node test: no DOM, no network, no Host.
 */
import { describe, expect, it, vi } from 'vitest';
import type { BootstrapResponse, BootstrapWorkspace } from '../../src/app/core-http-types.js';
import type { ScopeState } from '../../src/ui/state/scope-state.js';
import { createStore } from '../../src/ui/state/store.js';
import {
  bootstrap,
  createWorkbenchStore,
  freshRequestId,
  mergeBootstrap,
  nextRequestSeq,
  renderAll,
  renderMemory,
  renderScopeIfSelected,
  scopes,
  store,
  view,
} from '../../src/ui/state/workbench.js';
import type { WorkbenchAction } from '../../src/ui/state/workbench.js';

type Slices = { count: number; label: string; items: Map<string, number> };
type Action = { readonly type: 'render'; readonly scopeKey: string | null } | { readonly type: 'other' };

const initialSlices = (): Slices => ({ count: 0, label: 'a', items: new Map() });

describe('createStore slices', () => {
  it('reads the initial slices and replaces one slice without touching the initial object', () => {
    const initial = initialSlices();
    const store = createStore<Slices, Action>(initial);
    expect(store.get('count')).toBe(0);
    expect(store.get('items')).toBe(initial.items);
    store.set('count', 5);
    expect(store.get('count')).toBe(5);
    expect(store.get('label')).toBe('a');
    expect(initial.count).toBe(0);
  });

  it('keeps container slices by reference so their owner can mutate them in place', () => {
    const store = createStore<Slices, Action>(initialSlices());
    store.get('items').set('k', 1);
    expect(store.get('items').get('k')).toBe(1);
  });

  it('calls only that slice\'s subscribers, synchronously, on every set (no equality check)', () => {
    const store = createStore<Slices, Action>(initialSlices());
    const seen: string[] = [];
    store.subscribe('count', value => seen.push(`count:${value}`));
    store.subscribe('label', value => seen.push(`label:${value}`));
    store.set('count', 1);
    expect(seen).toEqual(['count:1']);
    store.set('count', 1);
    expect(seen).toEqual(['count:1', 'count:1']);
    store.set('label', 'b');
    expect(seen).toEqual(['count:1', 'count:1', 'label:b']);
  });

  it('stops calling a subscriber after its unsubscribe, which is idempotent', () => {
    const store = createStore<Slices, Action>(initialSlices());
    const seen: number[] = [];
    const off = store.subscribe('count', value => seen.push(value));
    store.set('count', 1);
    off();
    off();
    store.set('count', 2);
    expect(seen).toEqual([1]);
  });

  it('treats the same function registered twice as two registrations', () => {
    const store = createStore<Slices, Action>(initialSlices());
    const seen: number[] = [];
    const listener = (value: number): void => { seen.push(value); };
    const first = store.subscribe('count', listener);
    store.subscribe('count', listener);
    store.set('count', 1);
    first();
    store.set('count', 2);
    expect(seen).toEqual([1, 1, 2]);
  });
});

describe('createStore dispatch', () => {
  it('delivers an action to every listener in registration order before returning', () => {
    const store = createStore<Slices, Action>(initialSlices());
    const seen: string[] = [];
    store.listen(action => seen.push(`first:${action.type}`));
    store.listen(action => seen.push(`second:${action.type}`));
    store.dispatch({ type: 'render', scopeKey: null });
    seen.push('returned');
    expect(seen).toEqual(['first:render', 'second:render', 'returned']);
  });

  it('delivers a nested dispatch depth-first, like a nested direct call', () => {
    const store = createStore<Slices, Action>(initialSlices());
    const seen: string[] = [];
    store.listen(action => {
      seen.push(`a:${action.type}`);
      if (action.type === 'render') store.dispatch({ type: 'other' });
    });
    store.listen(action => seen.push(`b:${action.type}`));
    store.dispatch({ type: 'render', scopeKey: 'scope' });
    expect(seen).toEqual(['a:render', 'a:other', 'b:other', 'b:render']);
  });

  it('iterates over a snapshot: an added listener waits for the next action, a removed one still runs once', () => {
    const store = createStore<Slices, Action>(initialSlices());
    const seen: string[] = [];
    let offSecond = (): void => undefined;
    store.listen(() => {
      seen.push('first');
      offSecond();
      store.listen(() => seen.push('added'));
    });
    offSecond = store.listen(() => seen.push('second'));
    store.dispatch({ type: 'other' });
    expect(seen).toEqual(['first', 'second']);
    seen.length = 0;
    store.dispatch({ type: 'other' });
    expect(seen).toEqual(['first', 'added']);
  });

  it('stops delivering to a listener after its unsubscribe', () => {
    const store = createStore<Slices, Action>(initialSlices());
    const seen: string[] = [];
    const off = store.listen(action => seen.push(action.type));
    store.dispatch({ type: 'other' });
    off();
    store.dispatch({ type: 'other' });
    expect(seen).toEqual(['other']);
  });

  it('propagates a listener exception to the caller of dispatch and set', () => {
    const store = createStore<Slices, Action>(initialSlices());
    const seen: string[] = [];
    store.listen(() => { throw new Error('listener failed'); });
    store.listen(() => seen.push('later'));
    expect(() => store.dispatch({ type: 'other' })).toThrow('listener failed');
    expect(seen).toEqual([]);
    store.subscribe('count', () => { throw new Error('subscriber failed'); });
    expect(() => store.set('count', 1)).toThrow('subscriber failed');
    expect(store.get('count')).toBe(1);
  });
});

describe('workbench store instance', () => {
  it('starts from the entry\'s original initial values, with fresh containers for every store', () => {
    const first = createWorkbenchStore();
    expect(first.get('view')).toStrictEqual({
      leftWidth: 180, rightWidth: 300, savedRightWidth: 300, auxVisible: false, auxExpanded: false,
      navVisible: true, centerMode: 'chat', centerMenuOpen: false, centerIdentityOpen: false,
      graphModes: new Map(), graphEdges: new Map(), detailOpen: new Map(), contextNode: null,
      expandedProjects: new Set(), theme: 'system',
    });
    expect(first.get('renderMemory')).toStrictEqual({
      tabDisplay: new Map(), renderedTabKey: null, centerDisplay: new Map(), renderedCenterKey: null,
      conversationScroll: null, stickToBottom: false,
    });
    expect(first.get('selectedKey')).toBe('');
    expect(first.get('bootstrap')).toBeNull();
    expect(first.get('requestSeq')).toBe(0);
    expect(first.get('scopes')).toStrictEqual(new Map());
    expect(first.get('diffText')).toStrictEqual(new Map());
    expect(first.get('splitDrag')).toBeNull();
    const second = createWorkbenchStore();
    expect(second.get('view')).not.toBe(first.get('view'));
    expect(second.get('view').graphModes).not.toBe(first.get('view').graphModes);
    expect(second.get('view').expandedProjects).not.toBe(first.get('view').expandedProjects);
    expect(second.get('renderMemory').tabDisplay).not.toBe(first.get('renderMemory').tabDisplay);
    expect(second.get('scopes')).not.toBe(first.get('scopes'));
    expect(second.get('diffText')).not.toBe(first.get('diffText'));
  });

  it('aliases the page store\'s stable containers', () => {
    expect(view).toBe(store.get('view'));
    expect(renderMemory).toBe(store.get('renderMemory'));
    expect(scopes()).toBe(store.get('scopes'));
  });

  it('turns renderScopeIfSelected and renderAll into synchronous render intents', () => {
    const seen: WorkbenchAction[] = [];
    const off = store.listen(action => seen.push(action));
    try {
      renderScopeIfSelected({ key: 'scope-a' } as ScopeState);
      expect(seen).toEqual([{ type: 'render', scopeKey: 'scope-a' }]);
      renderAll();
      expect(seen).toEqual([{ type: 'render', scopeKey: 'scope-a' }, { type: 'render', scopeKey: null }]);
    } finally {
      off();
    }
  });

  it('keeps the request id format and ONE sequence shared with nextRequestSeq', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-04T00:00:00.000Z'));
      const now = Date.now().toString(36);
      store.set('requestSeq', 35);
      expect(freshRequestId('sessions/history')).toBe(`r6-sessions-history-${now}-10`);
      expect(nextRequestSeq()).toBe(37);
      expect(freshRequestId('a/b')).toBe(`r6-a-b-${now}-12`);
      expect(store.get('requestSeq')).toBe(38);
    } finally {
      vi.useRealTimers();
    }
  });

  it('merges a bootstrap without replacing an existing scope and without a render of its own', () => {
    const workspace = (workspaceId: string, name: string): BootstrapWorkspace =>
      ({ scope: { projectId: 'p', workspaceId }, name, workspaceRevision: 1 } as BootstrapWorkspace);
    const created: string[] = [];
    const create = (config: BootstrapWorkspace): ScopeState => {
      created.push(config.name);
      return { key: JSON.stringify([config.scope.projectId, config.scope.workspaceId]), config } as unknown as ScopeState;
    };
    const seen: WorkbenchAction[] = [];
    const off = store.listen(action => seen.push(action));
    try {
      const firstBootstrap = { workspaces: [workspace('w1', 'one')] } as unknown as BootstrapResponse;
      mergeBootstrap(firstBootstrap, create);
      expect(bootstrap()).toBe(firstBootstrap);
      const kept = scopes().get(JSON.stringify(['p', 'w1']));
      const renamed = workspace('w1', 'one renamed');
      const secondBootstrap = { workspaces: [renamed, workspace('w2', 'two')] } as unknown as BootstrapResponse;
      mergeBootstrap(secondBootstrap, create);
      expect(bootstrap()).toBe(secondBootstrap);
      expect(created).toEqual(['one', 'two']);
      expect(scopes().get(JSON.stringify(['p', 'w1']))).toBe(kept);
      expect(kept?.config).toBe(renamed);
      expect([...scopes().keys()]).toEqual([JSON.stringify(['p', 'w1']), JSON.stringify(['p', 'w2'])]);
      expect(seen).toEqual([]);
    } finally {
      off();
    }
  });
});
