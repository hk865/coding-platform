import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BOARD_NAMES, BOARDS_DIR, loadBoard, type BoardName } from './helpers/board-files.js';
import { parseBoardParts } from '../../src/ui/board.js';
import {
  FakeElement, FakeText, installFakeDom, restoreFakeDom, type FakeDocument,
} from './helpers/dom.js';
import { BoardView } from '../../src/ui/runtime.js';
import type { VNode } from '../../src/ui/render.js';

/**
 * E31-6: the mounted DOM commit. The browser dispatches native event names
 * (`click`, not `onClick`; `input` for a text field's per-keystroke change), and
 * a `setState` patches the existing elements in place: same element object,
 * one listener per event, no stale attributes, and `value`/`checked` written as
 * properties.
 */
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const NATIVE_EVENTS = new Set([
  'click', 'dblclick', 'focus', 'blur', 'mouseenter', 'mouseleave', 'contextmenu',
  'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'keydown', 'wheel',
  'select', 'input', 'change',
]);

let dom: FakeDocument;

beforeAll(() => { dom = installFakeDom(); });
afterAll(() => { restoreFakeDom(); });

function mount(name: BoardName): { view: BoardView; root: FakeElement } {
  const view = new BoardView(loadBoard(name));
  const root = dom.createElement('div');
  view.mount(root as unknown as Element);
  return { view, root };
}

function allElements(root: FakeElement): FakeElement[] {
  const found: FakeElement[] = [];
  const walk = (node: FakeElement): void => {
    found.push(node);
    for (const child of node.childNodes) if (child instanceof FakeElement) walk(child);
  };
  walk(root);
  return found;
}

function find(root: FakeElement, predicate: (element: FakeElement) => boolean): FakeElement | undefined {
  return allElements(root).find(predicate);
}

const isCheckbox = (element: FakeElement): boolean =>
  element.tagName.toLowerCase() === 'input' && element.getAttribute('type') === 'checkbox';

/** Mount Done and open the card's 部分接受 form; its checkbox is the checked control in the boards. */
function openDonePicks(): { view: BoardView; root: FakeElement; checkbox: FakeElement } {
  const { view, root } = mount('Done');
  const partial = find(root, (element) => element.textContent.trim() === '部分接受' && element.listeners.has('click'));
  expect(partial).toBeDefined();
  partial!.dispatch('click');
  const checkbox = find(root, isCheckbox);
  expect(checkbox).toBeDefined();
  return { view, root, checkbox: checkbox! };
}

function expectDomMatches(element: FakeElement, nodes: VNode[]): void {
  expect(element.childNodes.length).toBe(nodes.length);
  nodes.forEach((node, index) => {
    const child = element.childNodes[index]!;
    if (node.kind === 'text') {
      expect(child).toBeInstanceOf(FakeText);
      expect(child.textContent).toBe(node.text);
      return;
    }
    expect(child).toBeInstanceOf(FakeElement);
    const actual = child as FakeElement;
    expect(actual.tagName.toLowerCase()).toBe(node.tag.toLowerCase());
    // `value` and `checked` are properties, not attributes.
    const expected = node.attrs
      .filter((attr): attr is { name: string; value: string } =>
        typeof attr.value === 'string' && attr.name !== 'value' && attr.name !== 'checked')
      .map((attr) => attr.name).sort();
    expect([...actual.attributes.keys()].sort()).toEqual(expected);
    expectDomMatches(actual, node.children);
  });
}

function snapshot(nodes: VNode[]): VNode[] {
  return nodes.map((node) => node.kind === 'text'
    ? { kind: 'text', key: node.key, text: node.text }
    : {
      kind: 'element',
      key: node.key,
      tag: node.tag,
      attrs: node.attrs.filter((attr) => typeof attr.value === 'string')
        .map((attr) => ({ name: attr.name, value: attr.value as string })),
      children: snapshot(node.children),
    });
}

function removedAttributes(before: VNode[], after: VNode[], removed: string[] = []): string[] {
  before.forEach((oldNode, index) => {
    const newNode = after[index];
    if (!newNode || oldNode.kind !== newNode.kind) return;
    if (oldNode.kind === 'element' && newNode.kind === 'element' && oldNode.tag === newNode.tag) {
      const names = new Set(newNode.attrs.filter((attr) => typeof attr.value === 'string').map((attr) => attr.name));
      for (const attr of oldNode.attrs) {
        if (typeof attr.value === 'string' && !names.has(attr.name)) removed.push(`${oldNode.tag}.${attr.name}`);
      }
      removedAttributes(oldNode.children, newNode.children, removed);
    }
  });
  return removed;
}

describe('E31-6 DOM commit', () => {
  it('a: mounts every board under its native DOM event names', () => {
    const done = openDonePicks();
    const roots = [...BOARD_NAMES.map((name) => mount(name).root), done.root];
    const names = new Set<string>();
    for (const root of roots) {
      for (const element of allElements(root)) for (const name of element.listeners.keys()) names.add(name);
    }
    expect(names.size).toBeGreaterThan(0);
    for (const name of names) {
      expect(name.startsWith('on')).toBe(false);
      expect(NATIVE_EVENTS.has(name)).toBe(true);
    }

    const main = mount('Main');
    const composer = find(main.root, (element) => element.getAttribute('id') === 'composer-input')!;
    expect(composer.listeners.has('input')).toBe(true);
    expect(composer.listeners.has('change')).toBe(false);
    expect(names.has('dblclick')).toBe(true);
    expect(done.checkbox.listeners.has('change')).toBe(true);
    expect([...done.checkbox.listeners.keys()]).not.toContain('onChange');
    expect(typeof done.checkbox.checked).toBe('boolean');
  });

  it('b: typing patches the same composer element and its value', () => {
    const { view, root } = mount('Main');
    const composer = find(root, (element) => element.getAttribute('id') === 'composer-input')!;
    composer.value = '新的草稿';
    composer.valueWrites = 0;
    composer.dispatch('input');
    expect(find(root, (element) => element.getAttribute('id') === 'composer-input')).toBe(composer);
    expect(composer.value).toBe('新的草稿');
    expect(composer.valueWrites).toBe(0);
    expect(view.instance.state.draft).toBe('新的草稿');

    view.instance.setState({ draft: '第二轮' });
    expect(find(root, (element) => element.getAttribute('id') === 'composer-input')).toBe(composer);
    expect(composer.value).toBe('第二轮');
    expect(composer.valueWrites).toBe(1);
  });

  it('c: ten setStates keep one change listener and dispatch the latest handler', () => {
    const { view, root, checkbox } = openDonePicks();
    const renders = view.renderCount;
    expect(checkbox.listeners.get('change')).toHaveLength(1);
    for (let round = 0; round < 10; round += 1) {
      checkbox.dispatch('change');
      expect(find(root, isCheckbox)).toBe(checkbox);
      expect(checkbox.listeners.get('change')).toHaveLength(1);
    }
    expect(view.renderCount).toBe(renders + 10);
    expect(Object.values(view.instance.state.keep as Record<string, unknown>)).toEqual([true]);
  });

  it('d: a sc-if flip removes extra nodes and stale attributes', () => {
    const { view, root } = mount('ArchOverview');
    const search = find(root, (element) =>
      element.tagName.toLowerCase() === 'input' && element.getAttribute('type') === 'search')!;
    search.value = 'zzz';
    search.dispatch('input');
    const typed = snapshot(view.tree);
    search.dispatch('keydown', { key: 'Escape' });
    expect(removedAttributes(typed, view.tree).length).toBeGreaterThan(0);
    expect(view.tree.length).toBeGreaterThan(0);
    expectDomMatches(root, view.tree);
  });

  it('e: checked false and empty string are both unchecked', () => {
    const { checkbox } = openDonePicks();
    expect(checkbox.checked).toBe(true);
    checkbox.dispatch('change');
    expect(checkbox.checked).toBe(false);

    // The frozen boards only render boolean `checked` values; the empty string
    // is the template's missing-value spelling, so the shared writer is checked
    // on a one-field board at the same public mount entry.
    const view = new BoardView(parseBoardParts({
      name: 'checked-empty',
      helmetHtml: '',
      templateHtml: '<input type="checkbox" checked="{{on}}" onChange="{{toggle}}" />',
      logic: `class Component extends DCLogic {
        constructor(...args) { super(...args); this.state = { on: '' }; }
        renderVals() { return { on: this.state.on, toggle: () => this.setState({ on: '' }) }; }
      }`,
      propsJson: '{}',
    }));
    const root = dom.createElement('div');
    view.mount(root as unknown as Element);
    const empty = find(root, isCheckbox)!;
    expect(empty.checked).toBe(false);
    view.instance.setState({ on: 'true' });
    expect(empty.checked).toBe(true);
    view.instance.setState({ on: 'false' });
    expect(empty.checked).toBe(false);
  });

  it('f: boot reads the fetched page, never the lowercased x-dc markup', async () => {
    /* The served page is the working copy once one exists (E3-NAV §4.3). */
    const working = `${ROOT}src/ui/boards/Main.dc.html`;
    const source = readFileSync(existsSync(working) ? working : `${BOARDS_DIR}/Main.dc.html`, 'utf8');
    const templateHtml = source.slice(source.indexOf('<x-dc>') + '<x-dc>'.length, source.indexOf('</x-dc>'));
    const scriptStart = source.indexOf('data-dc-script');
    const tagStart = source.lastIndexOf('<script', scriptStart);
    const tagEnd = source.indexOf('>', scriptStart);
    const openTag = source.slice(tagStart, tagEnd + 1);
    const propsJson = /\bdata-props\s*=\s*(["'])([\s\S]*?)\1/.exec(openTag)![2]!;
    const logic = source.slice(tagEnd + 1, source.indexOf('</script>', tagEnd + 1));

    const root = new FakeElement('x-dc');
    Object.defineProperty(root, 'innerHTML', { get: () => templateHtml.toLowerCase() });
    const script = new FakeElement('script');
    Object.defineProperty(script, 'textContent', { value: logic });
    script.setAttribute('data-props', propsJson);

    const page = dom as unknown as {
      title: string; readyState: string; head: FakeElement; addEventListener(): void;
      querySelector(selector: string): FakeElement | null;
    };
    page.title = '工作台 · 主对话';
    page.readyState = 'loading';
    page.head = new FakeElement('head');
    page.addEventListener = () => {};
    page.querySelector = (selector) => (selector === 'x-dc' ? root : selector.includes('data-dc-script') ? script : null);

    const createElement = dom.createElement;
    dom.createElement = (tag) => {
      const element = createElement(tag);
      if (tag === 'template') {
        Object.defineProperty(element, 'content', { get: () => new FakeElement('#fragment') });
        Object.defineProperty(element, 'innerHTML', { set: () => {} });
      }
      return element;
    };

    const savedFetch = globalThis.fetch;
    const savedLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    globalThis.fetch = (async () => ({ text: async () => source })) as unknown as typeof fetch;
    Object.defineProperty(globalThis, 'location', {
      value: { href: 'http://host/workbench/Main.dc.html' }, configurable: true,
    });
    try {
      const { bootBoardPage } = await import('../../src/ui/boot.js');
      await bootBoardPage();
    } finally {
      globalThis.fetch = savedFetch;
      if (savedLocation) Object.defineProperty(globalThis, 'location', savedLocation);
      else delete (globalThis as { location?: unknown }).location;
    }

    const elements = allElements(root);
    expect(elements.some((element) => element.listeners.has('click'))).toBe(true);
    expect(elements.every((element) =>
      [...element.attributes.keys()].every((name) => !name.toLowerCase().startsWith('on')))).toBe(true);
  });

  it('g: disabled is a boolean attribute; aria=false is a string', () => {
    const { root } = mount('Decide');
    const requeue = find(root, (element) =>
      element.tagName.toLowerCase() === 'button' && element.textContent.trim() === '重新入队' && element.listeners.has('click'));
    expect(requeue).toBeDefined();
    requeue!.dispatch('click');

    const confirm = find(root, (element) =>
      element.tagName.toLowerCase() === 'button' && element.textContent.trim() === '确认重新入队' && element.listeners.has('click'));
    expect(confirm).toBeDefined();
    expect(confirm!.getAttribute('disabled')).not.toBeNull();

    const reason = find(root, (element) => element.getAttribute('id') === 'dc-reason');
    expect(reason).toBeDefined();
    reason!.value = '先修格式';
    reason!.dispatch('input');

    expect(confirm!.getAttribute('disabled')).toBeNull();
    expect(allElements(root).some((element) => element.getAttribute('aria-selected') === 'false')).toBe(true);

    const view = new BoardView(parseBoardParts({
      name: 'disabled-empty',
      helmetHtml: '',
      templateHtml: '<button disabled="{{off}}">go</button>',
      logic: `class Component extends DCLogic {
        constructor(...args) { super(...args); this.state = { off: '' }; }
        renderVals() { return { off: this.state.off }; }
      }`,
      propsJson: '{}',
    }));
    const emptyRoot = dom.createElement('div');
    view.mount(emptyRoot as unknown as Element);
    const button = find(emptyRoot, (element) => element.tagName.toLowerCase() === 'button')!;
    expect(button.getAttribute('disabled')).toBeNull();
    view.instance.setState({ off: 'false' });
    expect(button.getAttribute('disabled')).toBeNull();
    view.instance.setState({ off: 'true' });
    expect(button.getAttribute('disabled')).not.toBeNull();
  });

  it('h: a sc-if insert keeps the focused node and the scroll box', () => {
    const { root } = mount('TaskMap');
    const focused = find(root, (element) =>
      element.tagName.toLowerCase() === 'button' && element.textContent.trim() === 'SSE 推送')!;
    expect(focused).toBeDefined();
    focused.dispatch('focus');

    const afterFocus = find(root, (element) =>
      element.tagName.toLowerCase() === 'button' && element.textContent.trim() === 'SSE 推送');
    expect(afterFocus).toBe(focused);

    const scroller = find(root, (element) => (element.getAttribute('class') ?? '').split(/\s+/).includes('dg-scroll'))!;
    const legend = find(root, (element) =>
      element.tagName.toLowerCase() === 'button' && element.textContent.trim() === '图例')!;
    legend.dispatch('click');

    const afterLegend = find(root, (element) => (element.getAttribute('class') ?? '').split(/\s+/).includes('dg-scroll'));
    expect(afterLegend).toBe(scroller);
  });
});
