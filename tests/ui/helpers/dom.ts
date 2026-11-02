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
  private _value = '';
  constructor(readonly tagName: string) {}
  get value(): string { return this._value; }
  set value(next: string) { this._value = next; this.valueWrites += 1; }
  get firstChild(): FakeElement | FakeText | null { return this.childNodes[0] ?? null; }
  get textContent(): string { return this.childNodes.map((child) => child.textContent).join(''); }
  appendChild<T extends FakeElement | FakeText>(child: T): T { this.childNodes.push(child); return child; }
  append(...children: Array<FakeElement | FakeText>): void { for (const child of children) this.childNodes.push(child); }
  insertBefore<T extends FakeElement | FakeText>(next: T, before: FakeElement | FakeText | null): T {
    const index = before === null ? this.childNodes.length : this.childNodes.indexOf(before);
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, next);
    return next;
  }
  replaceChild(next: FakeElement | FakeText, old: FakeElement | FakeText): void {
    const index = this.childNodes.indexOf(old);
    if (index >= 0) this.childNodes[index] = next;
  }
  removeChild(child: FakeElement | FakeText): void {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
  }
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
}

export type FakeDocument = {
  createElement(tag: string): FakeElement;
  createElementNS(namespace: string, tag: string): FakeElement;
  createTextNode(text: string): FakeText;
  createDocumentFragment(): FakeElement;
};

let previous: unknown;
let installed = false;

export function installFakeDom(): FakeDocument {
  const document: FakeDocument = {
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
