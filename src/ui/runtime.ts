import type { Board } from './board.js';
import {
  renderBoardTemplate, type EventBinding, type RefBinding, type VNode,
} from './render.js';

export type BoardProps = Record<string, unknown>;
export type BoardState = Record<string, unknown>;

/**
 * The base class the frozen boards extend. It owns the canvas-facing surface
 * the boards use: `props`, `state`, shallow `setState`, and the update hook.
 */
export class DCLogic {
  props: BoardProps;
  state: BoardState = {};
  /** The mounted view installs this so a board's `setState` re-renders. */
  _onState: (() => void) | null = null;
  constructor(props: BoardProps = {}) { this.props = props; }
  setState(patch: BoardState): void {
    this.state = Object.assign({}, this.state, patch);
    this._onState?.();
  }
  componentDidUpdate(_prev: BoardProps): void {}
  renderVals(): BoardState { return {}; }
}

export type BoardComponent = DCLogic;
type BoardConstructor = new (props: BoardProps) => BoardComponent;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * One board instance plus its last render. The render tree is a plain object
 * graph, so tests can inspect it without a DOM; `mount` attaches the same tree
 * to a browser root and wires events and refs.
 */
export class BoardView {
  readonly board: Board;
  readonly instance: BoardComponent;
  /** How many times this view has evaluated the template (logic-only or mounted). */
  renderCount = 0;
  tree: VNode[] = [];
  private root: Element | null = null;

  constructor(board: Board, props: BoardProps = board.defaults) {
    this.board = board;
    const Component = compile(board.logic);
    this.instance = new Component({ ...props });
    this.instance._onState = () => {
      const prev = { ...this.instance.props };
      this.render();
      this.commit(prev);
    };
  }

  render(): VNode[] {
    this.renderCount += 1;
    this.tree = renderBoardTemplate(this.board.template.nodes, this.instance.renderVals());
    return this.tree;
  }

  /**
   * §1.1.4: `componentDidUpdate(prev)` compares props only, so it receives the
   * previous props after the commit: the DOM is patched and refs have run, then
   * the hook sees the new tree. A `setState` inside it commits again through
   * the ordinary path; the boards compare props, so it stops.
   */
  updateProps(next: BoardProps): void {
    const prev = { ...this.instance.props };
    this.instance.props = { ...next };
    this.render();
    this.commit(prev);
  }

  mount(root: Element): void {
    this.root = root;
    this.render();
    while (root.firstChild !== null) root.removeChild(root.firstChild);
    this.commitDom();
  }

  private commit(prev: BoardProps): void {
    this.commitDom();
    this.instance.componentDidUpdate(prev);
  }

  private commitDom(): void {
    if (this.root === null || typeof document === 'undefined') return;
    const refs: RefTarget[] = [];
    patchChildren(this.root, this.tree, false, refs);
    for (const { binding, element } of refs) binding.handler(element);
  }
}

function compile(logic: string): BoardConstructor {
  const factory = new Function('DCLogic', `${logic}\n; return Component;`) as
    (base: typeof DCLogic) => BoardConstructor;
  return factory(DCLogic);
}

type VAttribute = string | EventBinding | RefBinding;
type VAttributes = Array<{ name: string; value: VAttribute }>;
type RefTarget = { binding: RefBinding; element: Element };
type EventEntry = { handler: EventBinding['handler']; listener: EventListener };

/** One listener per element and event name; the dispatch reads the handler of the latest render. */
const handlersOf = new WeakMap<Element, Map<string, EventEntry>>();

/** A board's `onChange` on a text field fires per keystroke; native `change` waits for blur. */
function domEventName(attribute: string, tag: string, type: string): string {
  const name = attribute.slice(2).toLowerCase();
  if (name === 'doubleclick') return 'dblclick';
  if (name === 'change' && (tag === 'textarea' || (tag === 'input' && type !== 'checkbox' && type !== 'radio'))) return 'input';
  return name;
}

function canPatch(current: Node, node: VNode): boolean {
  if (node.kind === 'text') return current.nodeType === 3;
  return current.nodeType === 1 && (current as Element).tagName.toLowerCase() === node.tag.toLowerCase();
}

/** Write the string attributes, event handlers and refs of one node; the first render and every patch share this. */
function writeAttributes(element: Element, attrs: VAttributes, refs: RefTarget[]): void {
  const tag = element.tagName.toLowerCase();
  const strings = new Map<string, string>();
  for (const attr of attrs) if (typeof attr.value === 'string') strings.set(attr.name, attr.value);
  const events = new Map<string, EventBinding>();
  for (const attr of attrs) {
    if (typeof attr.value === 'string') continue;
    if (attr.value.kind === 'event') events.set(domEventName(attr.name, tag, strings.get('type') ?? ''), attr.value);
    else refs.push({ binding: attr.value, element });
  }

  const names = new Set(strings.keys());
  names.delete('value');
  for (const name of element.getAttributeNames()) if (!names.has(name)) element.removeAttribute(name);
  for (const [name, value] of strings) {
    if (name === 'value') {
      const field = element as HTMLInputElement;
      if (field.value !== value) field.value = value;
    } else if (name === 'checked') {
      (element as HTMLInputElement).checked = writeBooleanAttribute(element, name, value);
    } else if (name === 'disabled') {
      writeBooleanAttribute(element, name, value);
    } else {
      element.setAttribute(name, value);
    }
  }

  const table = handlersOf.get(element) ?? new Map<string, EventEntry>();
  handlersOf.set(element, table);
  for (const name of [...table.keys()]) {
    if (events.has(name)) continue;
    const entry = table.get(name)!;
    element.removeEventListener(name, entry.listener);
    table.delete(name);
  }
  for (const [name, binding] of events) {
    const existing = table.get(name);
    if (existing !== undefined) { existing.handler = binding.handler; continue; }
    const entry: EventEntry = { handler: binding.handler, listener: (event) => entry.handler(event) };
    table.set(name, entry);
    element.addEventListener(name, entry.listener);
  }
}

/** Boolean attributes: only `true` is present; `false` and the empty string remove it. */
function writeBooleanAttribute(element: Element, name: string, value: string): boolean {
  const on = value !== '' && value !== 'false';
  if (on) element.setAttribute(name, '');
  else element.removeAttribute(name);
  return on;
}

/** Each DOM child remembers the template key that produced it. */
const keyOf = new WeakMap<Node, string>();

function toDom(node: VNode, svg: boolean, refs: RefTarget[]): Node {
  const created = node.kind === 'text'
    ? document.createTextNode(node.text)
    : createElement(node, svg, refs);
  keyOf.set(created, node.key);
  return created;
}

function createElement(node: VNode & { kind: 'element' }, svg: boolean, refs: RefTarget[]): Element {
  const inSvg = svg || node.tag === 'svg';
  const element = inSvg ? document.createElementNS(SVG_NS, node.tag) : document.createElement(node.tag);
  writeAttributes(element, node.attrs, refs);
  for (const child of node.children) element.append(toDom(child, inSvg, refs));
  return element;
}

function patchNode(current: Node, node: VNode, svg: boolean, refs: RefTarget[]): void {
  if (node.kind === 'text') {
    if (current.textContent !== node.text) current.textContent = node.text;
    return;
  }
  const element = current as Element;
  writeAttributes(element, node.attrs, refs);
  patchChildren(element, node.children, svg || node.tag === 'svg', refs);
}

function patchChildren(parent: Node, nodes: VNode[], svg: boolean, refs: RefTarget[]): void {
  const wanted = new Map(nodes.map((node) => [node.key, node]));
  for (const child of [...parent.childNodes]) {
    const node = wanted.get(keyOf.get(child) ?? '');
    if (node === undefined || !canPatch(child, node)) parent.removeChild(child);
  }
  nodes.forEach((node, index) => {
    const current = parent.childNodes[index];
    if (current !== undefined && keyOf.get(current) === node.key) patchNode(current, node, svg, refs);
    else parent.insertBefore(toDom(node, svg, refs), current ?? null);
  });
}
