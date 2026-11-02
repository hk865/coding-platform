import { describe, expect, it } from 'vitest';
import { BOARD_NAMES, loadBoard } from './helpers/board-files.js';
import { collectEventBindings, serializeTree } from './helpers/render.js';
import { BoardView } from '../../src/ui/runtime.js';

/**
 * E31-4: every event attribute in the rendered tree resolves to a function from
 * `renderVals()`. Calling a handler that merges state re-renders the view
 * without a manual render: the render count grows and the new tree shows the
 * merged state. The theme handler is behind Phone's menu, so Phone uses its
 * goal-menu opener.
 */
const SET_STATE_HANDLER = {
  ArchOverview: { path: 'toggleTheme', state: { theme: 'light' }, marker: '切换到深色' },
  Chain: { path: 'toggleTheme', state: { theme: 'light' }, marker: '切换到深色' },
  Decide: { path: 'toggleTheme', state: { theme: 'light' }, marker: '切换到深色' },
  Done: { path: 'toggleTheme', state: { theme: 'light' }, marker: '切换到深色' },
  Goals: { path: 'toggleTheme', state: { theme: 'light' }, marker: '切换到深色' },
  Main: { path: 'toggleTheme', state: { theme: 'light' }, marker: '切换到深色' },
  Member: { path: 'toggleTheme', state: { theme: 'light' }, marker: '切换到深色' },
  Phone: { path: 'toggleGoals', state: { menu: 'goals' }, marker: 'coding-platform 的目标，按顺序' },
  Plan: { path: 'toggleTheme', state: { theme: 'light' }, marker: '切换到深色' },
  TaskMap: { path: 'toggleTheme', state: { theme: 'light' }, marker: '切换到深色' },
} as const;

describe('E31-4 event bindings', () => {
  it.each(BOARD_NAMES)('%s binds functions and a setState handler re-renders', (name) => {
    const view = new BoardView(loadBoard(name));
    view.render();
    const events = collectEventBindings(view.tree);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((binding) => typeof binding.handler === 'function')).toBe(true);
    const target = SET_STATE_HANDLER[name];
    const toggle = events.find((binding) => binding.path === target.path);
    expect(toggle).toBeDefined();
    expect(serializeTree(view.tree)).not.toContain(target.marker);
    const renders = view.renderCount;
    expect(() => toggle?.handler({ preventDefault() {}, stopPropagation() {} })).not.toThrow();
    expect(view.renderCount).toBe(renders + 1);
    expect(view.instance.state).toMatchObject(target.state);
    const html = serializeTree(view.tree);
    expect(html).toContain(target.marker);
    expect(html).not.toContain('{{');
  });
});
