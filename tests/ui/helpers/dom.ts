/** A deliberately small DOM for `BoardView.mount` tests: no jsdom, no layout, only the calls the runtime makes. */
export type FakeListener = (event: unknown) => unknown;

export class FakeText {
  readonly nodeType = 3;
  private _text: string;
  constructor(text: string) { this._text = text; }
  get textContent(): string { return this._text; }
  set textContent(value: string) { this._text = value; }
}

export class FakeElement {
  readonly nodeType = 1;
  readonly childNodes: Array<FakeElement | FakeText> = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, FakeListener[]>();
  valueWrites = 0;
  checked = false;
  parent: FakeElement | null = null;
  /** Every `scrollIntoView` call on this element, in order (the anchor row reads it). */
  readonly scrollCalls: unknown[] = [];
  private _value = '';
  constructor(readonly tagName: string) {}
  get value(): string { return this._value; }
  set value(next: string) { this._value = next; this.valueWrites += 1; }
  get firstChild(): FakeElement | FakeText | null { return this.childNodes[0] ?? null; }
  get textContent(): string { return this.childNodes.map((child) => child.textContent).join(''); }
  appendChild<T extends FakeElement | FakeText>(child: T): T { if (child instanceof FakeElement) child.parent = this; this.childNodes.push(child); return child; }
  append(...children: Array<FakeElement | FakeText>): void { for (const child of children) this.appendChild(child); }
  insertBefore<T extends FakeElement | FakeText>(next: T, before: FakeElement | FakeText | null): T {
    const index = before === null ? this.childNodes.length : this.childNodes.indexOf(before);
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, next);
    if (next instanceof FakeElement) next.parent = this;
    return next;
  }
  replaceChild(next: FakeElement | FakeText, old: FakeElement | FakeText): void {
    const index = this.childNodes.indexOf(old);
    if (index >= 0) this.childNodes[index] = next;
  }
  removeChild(child: FakeElement | FakeText): void {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) { this.childNodes.splice(index, 1); if (child instanceof FakeElement) child.parent = null; }
  }
  get isConnected(): boolean { let node: FakeElement = this; while (node.parent !== null) node = node.parent; return node.tagName.toLowerCase() === 'x-dc'; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  getAttributeNames(): string[] { return [...this.attributes.keys()]; }
  addEventListener(name: string, listener: FakeListener): void {
    const list = this.listeners.get(name) ?? [];
    list.push(listener);
    this.listeners.set(name, list);
  }
  removeEventListener(name: string, listener: FakeListener): void {
    const list = this.listeners.get(name);
    if (list) this.listeners.set(name, list.filter((entry) => entry !== listener));
  }
  dispatch(name: string, init: Record<string, unknown> = {}): void {
    for (const listener of [...(this.listeners.get(name) ?? [])]) {
      listener({ type: name, target: this, preventDefault() {}, stopPropagation() {}, ...init });
    }
  }
  get disabled(): boolean { return this.attributes.has('disabled'); }
  scrollIntoView(options?: unknown): void { this.scrollCalls.push(options); }
  focus(): void {
    if (this.disabled) return;
    if (typeof document !== 'undefined') (document as unknown as FakeDocument).activeElement = this;
  }
  blur(): void {
    const document = (globalThis as unknown as { document?: FakeDocument }).document;
    if (document !== undefined && document.activeElement === this) document.activeElement = null;
  }
}

export type FakeDocument = {
  activeElement: FakeElement | null;
  /** The mounted page root; `getElementById` walks it, as the browser walks the document. */
  documentElement: FakeElement | null;
  getElementById(id: string): FakeElement | null;
  createElement(tag: string): FakeElement;
  createElementNS(namespace: string, tag: string): FakeElement;
  createTextNode(text: string): FakeText;
  createDocumentFragment(): FakeElement;
};

let previous: unknown;
let installed = false;

export function installFakeDom(): FakeDocument {
  const document: FakeDocument = {
    activeElement: null,
    documentElement: null,
    getElementById(id: string): FakeElement | null {
      const walk = (element: FakeElement): FakeElement | null => {
        if (element.getAttribute('id') === id) return element;
        for (const child of element.childNodes) {
          if (child instanceof FakeElement) {
            const found = walk(child);
            if (found !== null) return found;
          }
        }
        return null;
      };
      return document.documentElement === null ? null : walk(document.documentElement);
    },
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_namespace, tag) => new FakeElement(tag),
    createTextNode: (text) => new FakeText(text),
    createDocumentFragment: () => new FakeElement('#fragment'),
  };
  if (!installed) previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = document;
  installed = true;
  return document;
}

export function restoreFakeDom(): void {
  if (!installed) return;
  (globalThis as { document?: unknown }).document = previous;
  installed = false;
}
