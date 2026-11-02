import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bootBoardPage } from '../../../src/ui/boot.js';
import { PLATFORM_TOKEN_META_NAME } from '../../../src/ui/host-client.js';
import { FakeElement, installFakeDom, restoreFakeDom } from './dom.js';

/** One request the page makes after its own source text; the caller answers it
 * at the Host origin or with the controlled replies of a failure row. */
export type PageFetch = (url: string, init: RequestInit | undefined, realFetch: typeof fetch) => Promise<Response>;

export type BootedPage = { root: FakeElement; restore(): Promise<void>; pageFetches(): number };

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const WORKING_BOARDS = `${ROOT}src/ui/boards`;
const FROZEN_BOARDS = `${ROOT}docs/ui-reference/workbench-2026-10`;
const TOKEN_META = new RegExp(`<meta\\b[^>]*\\bname\\s*=\\s*["']${PLATFORM_TOKEN_META_NAME}["'][^>]*>`, 'i');

/** The Host serves the token in the page's own meta, so a page fetched again on
 * reconnect carries the token current at that moment. */
function withToken(source: string, token: string | null): string {
  if (token === null || TOKEN_META.test(source)) return source;
  return source.replace(/<\/head>/i, `<meta name="${PLATFORM_TOKEN_META_NAME}" content="${token}">\n</head>`);
}

/**
 * Boot one board page the way the Host serves it: the working copy (or the
 * frozen board) as the page text, the token in the meta, and every other
 * request through `request`. A `token` function is read again for every served
 * page, so a Host restart can hand the page a new token. `restore()` destroys
 * the page: it aborts in-flight requests, ignores later ones and clears the
 * page's timers, so a fake page cannot outlive its row.
 */
/** E3-3 ruling 5: the page reconnects every 2 s. */
const PAGE_RECONNECT_MS = 2_000;

export async function bootPage(options: {
  name: string; search?: string; token: string | null | (() => string | null);
  request: PageFetch; url?: string; source?: string;
}): Promise<BootedPage> {
  const url = options.url ?? `http://host/workbench/${options.name}.dc.html`;
  const working = `${WORKING_BOARDS}/${options.name}.dc.html`;
  const source = options.source ?? readFileSync(existsSync(working) ? working : `${FROZEN_BOARDS}/${options.name}.dc.html`, 'utf8');
  const tokenNow = (): string | null => typeof options.token === 'function' ? options.token() : options.token;
  const initialToken = tokenNow();
  const dom = installFakeDom();
  const page = dom as unknown as {
    title: string; readyState: string; head: FakeElement; addEventListener(): void;
    querySelector(selector: string): FakeElement | null;
  };
  const root = new FakeElement('x-dc');
  const meta = new FakeElement('meta');
  if (initialToken !== null) meta.setAttribute('content', initialToken);
  page.title = options.name;
  page.readyState = 'loading';
  page.head = new FakeElement('head');
  page.addEventListener = () => {};
  page.querySelector = (selector) => selector === 'x-dc' ? root
    : selector === `meta[name="${PLATFORM_TOKEN_META_NAME}"]` && initialToken !== null ? meta : null;
  const createElement = dom.createElement;
  dom.createElement = (tag) => {
    const element = createElement(tag);
    if (tag === 'template') Object.defineProperty(element, 'content', { get: () => createElement('#fragment') });
    return element;
  };
  const savedFetch = globalThis.fetch;
  const savedLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const savedSetTimeout = globalThis.setTimeout;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const abort = new AbortController();
  let destroyed = false;
  let pageFetches = 0;
  /* only the page's reconnect timer: the Host shares this process and its heartbeat keeps running */
  globalThis.setTimeout = ((handler: () => void, delay?: number) => {
    if (delay !== PAGE_RECONNECT_MS) return savedSetTimeout(handler, delay);
    const handle = savedSetTimeout(() => { timers.delete(handle); handler(); }, delay);
    timers.add(handle);
    return handle;
  }) as typeof setTimeout;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    if (destroyed) return new Promise<Response>(() => {});
    const requested = String(input);
    if (requested === url) {
      pageFetches += 1;
      return { text: async () => withToken(source, tokenNow()) } as unknown as Response;
    }
    return options.request(requested, { ...init, signal: abort.signal }, savedFetch);
  }) as typeof fetch;
  Object.defineProperty(globalThis, 'location', {
    value: {
      href: url, search: options.search ?? '',
      reload: (): void => { throw new Error('E33: the page must not reload'); },
    },
    configurable: true,
  });
  const restore = async (): Promise<void> => {
    if (destroyed) return;
    destroyed = true;
    abort.abort();
    globalThis.fetch = savedFetch;
    if (savedLocation) Object.defineProperty(globalThis, 'location', savedLocation);
    else delete (globalThis as { location?: unknown }).location;
    restoreFakeDom();
    /* let the aborted stream reach its end callback before the timer is cleared;
       a MessageChannel turn is a real task, so fake timers do not hold it */
    for (let turn = 0; turn < 2; turn += 1) {
      await new Promise<void>((resolve) => {
        const { port1, port2 } = new MessageChannel();
        port1.onmessage = () => { port1.close(); port2.close(); resolve(); };
        port2.postMessage(null);
      });
    }
    for (const handle of timers) clearTimeout(handle);
    timers.clear();
    globalThis.setTimeout = savedSetTimeout;
  };
  try { await bootBoardPage(); } catch (error) { await restore(); throw error; }
  return { root, restore, pageFetches: () => pageFetches };
}

/** Depth-first element lookup over the fake DOM `BoardView.mount` built. */
export function findElement(root: FakeElement, predicate: (element: FakeElement) => boolean): FakeElement | undefined {
  if (predicate(root)) return root;
  for (const child of root.childNodes) {
    if (!(child instanceof FakeElement)) continue;
    const found = findElement(child, predicate);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function findButton(root: FakeElement, text: string): FakeElement | undefined {
  return findElement(root, (element) => element.tagName.toLowerCase() === 'button' && element.textContent.includes(text));
}

export function findClass(root: FakeElement, name: string): FakeElement | undefined {
  return findElement(root, (element) => (element.getAttribute('class') ?? '').split(/\s+/).includes(name));
}
