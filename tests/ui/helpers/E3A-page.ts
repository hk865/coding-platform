import { findClass, findElement, type BootedPage } from './boot-page.js';
import { FakeElement } from './dom.js';
import { descendants, hasClass, textOf } from './E3N-page.js';

/**
 * The ArchOverview DOM reads the E3ARCH rows share. They read the mounted fake
 * DOM only (the frozen prototype's own classes), never the board's state.
 */

export function has(element: FakeElement, name: string): boolean {
  return hasClass(element, name);
}

export function buttons(root: FakeElement): FakeElement[] {
  return descendants(root).filter((element) => element.tagName.toLowerCase() === 'button');
}

/** The current layer's title: the prototype's `button.ov-top` (the spec's `ov-head` is the node head). */
export function layerTitle(root: FakeElement): FakeElement | undefined {
  return findElement(root, (element) => element.tagName.toLowerCase() === 'button' && has(element, 'ov-top'))
    ?? findElement(root, (element) => element.tagName.toLowerCase() === 'button' && has(element, 'ov-head'));
}

export function crumbButtons(root: FakeElement): FakeElement[] {
  const nav = findClass(root, 'ov-crumbs');
  return nav === undefined ? [] : descendants(nav).filter((element) => element.tagName.toLowerCase() === 'button');
}

export function crumbLabels(root: FakeElement): string[] {
  return crumbButtons(root).map((button) => button.getAttribute('aria-label') ?? '');
}

export function currentCrumb(root: FakeElement): string {
  const labels = crumbLabels(root);
  return labels[labels.length - 1] ?? '';
}

export function searchInput(root: FakeElement): FakeElement | undefined {
  return findElement(root, (element) => element.tagName.toLowerCase() === 'input'
    && element.getAttribute('type') === 'search');
}

export function searchNote(root: FakeElement): string {
  const search = findClass(root, 'ov-search');
  return textOf(search === undefined ? undefined : findClass(search, 'note'));
}

export function resultRows(root: FakeElement): FakeElement[] {
  const list = findClass(root, 'qlist');
  if (list === undefined) return [];
  return descendants(list).filter((element) => element.tagName.toLowerCase() === 'button' && has(element, 'qrow'));
}

export function detail(root: FakeElement): FakeElement | undefined {
  return findClass(root, 'detail');
}

export function detailText(root: FakeElement): string {
  return textOf(detail(root));
}

export function intro(root: FakeElement): FakeElement | undefined {
  return findClass(root, 'ov-intro');
}

/** A button whose visible text, tooltip or aria-label names `path`. */
export function nodeNamed(root: FakeElement, path: string): FakeElement | undefined {
  const base = path.split('/').pop() ?? path;
  return findElement(root, (element) => element.tagName.toLowerCase() === 'button'
    && [element.textContent, element.getAttribute('aria-label') ?? '', element.getAttribute('title') ?? '']
      .some((text) => text.includes(path) || text.includes(base)));
}

/** The `.ov-node`/file-tree row that carries `path`, and the status square inside it. */
export function nodeRow(root: FakeElement, path: string): FakeElement | undefined {
  const base = path.split('/').pop() ?? path;
  return findElement(root, (element) => (has(element, 'ov-node') || has(element, 'tr') || has(element, 'ov-crow'))
    && [element.textContent, element.getAttribute('aria-label') ?? ''].some((text) => text.includes(path) || text.includes(base)));
}

export function statusClasses(element: FakeElement): string[] {
  const found = findElement(element, (child) => (child.getAttribute('class') ?? '').split(/\s+/).some((name) => /^s-/.test(name)));
  return found === undefined ? [] : (found.getAttribute('class') ?? '').split(/\s+/).filter((name) => /^s-/.test(name));
}

/** The prototype's unchanged-files fold row (`tr.ln.fold`), not the root row. */
export function foldRow(root: FakeElement): FakeElement | undefined {
  const tree = findClass(root, 'ov-ftree');
  if (tree === undefined) return undefined;
  const row = findElement(tree, (element) => (element.getAttribute('class') ?? '').split(/\s+/).includes('fold'));
  return row === undefined ? undefined : findElement(row, (element) => element.tagName.toLowerCase() === 'button');
}

export function pageText(page: BootedPage): string {
  return page.root.textContent;
}


/** The `.d-items` that follows the relation label `label` in `.d-rel`. */
export function relationGroup(root: FakeElement, label: string): FakeElement | undefined {
  const rel = findClass(root, 'd-rel');
  if (rel === undefined) return undefined;
  let matched = false;
  for (const child of rel.childNodes) {
    if (!(child instanceof FakeElement)) continue;
    if (has(child, 'k')) { matched = textOf(child) === label; continue; }
    if (matched && has(child, 'd-items')) return child;
  }
  return undefined;
}

/** Every `.d-item` (button or span) inside one relation group. */
export function relationItems(group: FakeElement): FakeElement[] {
  return descendants(group).filter((element) => has(element, 'd-item'));
}
