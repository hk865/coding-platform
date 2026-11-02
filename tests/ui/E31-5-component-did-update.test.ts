import { describe, expect, it } from 'vitest';
import { BOARD_NAMES, loadBoard } from './helpers/board-files.js';
import { serializeTree } from './helpers/render.js';
import { FakeElement, installFakeDom, restoreFakeDom } from './helpers/dom.js';
import { BoardView } from '../../src/ui/runtime.js';

/**
 * §1.1.4: `componentDidUpdate` compares only `data-props` keys, so its argument
 * is the previous props. Every commit (`setState` and `updateProps`) renders,
 * patches the DOM and runs refs first, then calls the hook.
 */
const NEXT_PROPS = {
  ArchOverview: { theme: 'light' },
  Chain: { theme: 'light', moment: '第 2 轮检查通过后' },
  Decide: { theme: 'light', queue: '与主画面相同' },
  Done: { theme: 'light' },
  Goals: { theme: 'light' },
  Main: { theme: 'light', scale: '600 个任务' },
  Member: { theme: 'light', start: '直接干预' },
  Phone: { theme: 'light', screen: '待决' },
  Plan: { theme: 'light', start: '方案第 2 版' },
  TaskMap: { theme: 'light', scale: '600 个任务' },
} as const;

describe('E31-5 componentDidUpdate gets the previous props', () => {
  it.each(BOARD_NAMES)('%s updates from previous props', (name) => {
    const view = new BoardView(loadBoard(name));
    view.render();
    const previous = { ...view.instance.props };
    const seen: Array<Record<string, unknown>> = [];
    const update = view.instance.componentDidUpdate.bind(view.instance);
    view.instance.componentDidUpdate = (prev: Record<string, unknown>) => { seen.push(prev); update(prev); };
    expect(() => view.updateProps(NEXT_PROPS[name])).not.toThrow();
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen[0]).toEqual(previous);
    for (const extra of seen.slice(1)) expect(extra).toEqual({ ...view.instance.props });
    expect(serializeTree(view.tree)).not.toContain('{{');
  });

  it('setState commits and runs refs before componentDidUpdate, so revealSel sees the new element', () => {
    const dom = installFakeDom();
    try {
      const view = new BoardView(loadBoard('TaskMap'));
      const root = dom.createElement('div');
      view.mount(root as unknown as Element);

      const instance = view.instance as typeof view.instance & {
        revealSel(): void; _selEl: FakeElement | null;
      };
      let seen: FakeElement | null = null;
      const reveal = instance.revealSel.bind(instance);
      instance.revealSel = () => {
        seen = instance._selEl;
        reveal();
      };

      instance.setState({ sel: 'T28' });

      expect(seen).not.toBeNull();
      expect((seen as unknown as FakeElement).textContent.trim()).toBe('SSE 推送');
    } finally {
      restoreFakeDom();
    }
  });

  it('updateProps renders and commits before componentDidUpdate; a theme setState commits once more and stops', () => {
    const dom = installFakeDom();
    try {
      const view = new BoardView(loadBoard('Goals'));
      const root = dom.createElement('div');
      view.mount(root as unknown as Element);
      const domClass = () => {
        const element = root.childNodes.find((child): child is FakeElement => child instanceof FakeElement);
        return element?.getAttribute('class') ?? '';
      };
      const calls: Array<{ prev: Record<string, unknown>; html: string; renders: number; dom: string }> = [];
      const update = view.instance.componentDidUpdate.bind(view.instance);
      view.instance.componentDidUpdate = (prev: Record<string, unknown>) => {
        calls.push({
          prev: { ...prev }, html: serializeTree(view.tree), renders: view.renderCount, dom: domClass(),
        });
        update(prev);
      };

      const before = view.renderCount;
      view.updateProps({ ...view.instance.props, theme: 'light' });
      expect(calls).toHaveLength(1);
      expect(calls[0]!.prev.theme).toBe('dark');
      expect(calls[0]!.renders).toBe(before + 1);
      expect(calls[0]!.html).toContain('t-light');
      expect(calls[0]!.dom).toContain('t-light');

      view.instance.setState({ theme: 'dark' });
      calls.length = 0;
      const beforeSecond = view.renderCount;
      view.updateProps({ ...view.instance.props, theme: 'dark' });
      expect(calls).toHaveLength(2);
      expect(calls[0]!.prev.theme).toBe('light');
      expect(calls[1]!.prev.theme).toBe('dark');
      expect(calls[1]!.renders).toBe(beforeSecond + 2);
    } finally {
      restoreFakeDom();
    }
  });
});
