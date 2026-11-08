import { expect } from 'vitest';
import { bootPage, findClass, findElement, type BootedPage, type PageFetch } from './boot-page.js';
import { FakeElement } from './dom.js';
import type { S6ARequestWorld } from '../../helpers/S6A-request-fixture.js';

/**
 * E3W page base: the one boot wrapper for the Main and TaskMap rows. It boots
 * the real page through `bootPage`, forwards every non-stream request to the
 * real Host (only the change stream may be controlled, E33-page-stream's
 * pattern), and reads the page through the fake DOM only.
 */

export type RecordedCall = {
  route: string;
  url: string;
  input: unknown;
  body: unknown;
  token: string;
};

export type PageLog = {
  calls: RecordedCall[];
  changes: number;
  changesTokens: string[];
  openings: ReadableStreamDefaultController<Uint8Array>[];
  /** Set to hold the next change-stream request before it answers. */
  changesGate: Promise<void> | null;
  /** Releases a gated change-stream request (no-op when it is not held). */
  releaseChanges(): void;
};

export type ChangeMode = 'stream' | 'controlled' | '429' | '429-once';

export const CORE = '/api/real/core/';

export function newPageLog(): PageLog {
  let release: () => void = () => undefined;
  const log: PageLog = {
    calls: [], changes: 0, changesTokens: [], openings: [], changesGate: null,
    releaseChanges(): void {
      log.changesGate = null;
      release();
    },
  };
  return log;
}

/** Hold the first change-stream request until `releaseChanges`; boundary 1 of N16 needs it. */
export function gateChanges(log: PageLog): void {
  log.changesGate = new Promise<void>((resolve) => {
    const previous = log.releaseChanges;
    log.releaseChanges = (): void => { previous(); resolve(); };
  });
}

export function routeOf(url: string): string {
  const at = url.indexOf(CORE);
  return at < 0 ? url : url.slice(at + CORE.length);
}

function tokenOf(init: RequestInit | undefined): string {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.['x-platform-token'] ?? '';
}

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  const raw = typeof init?.body === 'string' ? init.body : '{}';
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** The forwarded Host origin is read on every call, so a reopen's new address is used. */
export function forwardPage(world: S6ARequestWorld, log: PageLog, mode: ChangeMode = 'stream'): PageFetch {
  return async (url, init, realFetch) => {
    const route = routeOf(url);
    if (route === 'changes') {
      log.changes += 1;
      log.changesTokens.push(tokenOf(init));
      if (log.changesGate !== null) await log.changesGate;
      if (mode === '429' || (mode === '429-once' && log.changes === 1)) return new Response('{}', { status: 429 });
      if (mode === 'controlled' || mode === '429-once') {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) { log.openings.push(controller); },
        }), { status: 200 });
      }
    }
    const body = bodyOf(init);
    const writeInput = body['request'] as { input?: unknown } | undefined;
    /* Only core-route calls are page reads. `world.reopen` reads the new Host's
     * page through this same global fetch (no token header); it is not a page
     * read and must not enter the log. An absolute URL is already the target
     * (the reopened Host), so it must not resolve against a closed `world.base`. */
    if (route !== 'changes' && url.includes(CORE)) {
      log.calls.push({ route, url, input: body['input'] ?? writeInput?.input ?? null, body, token: tokenOf(init) });
    }
    const target = /^https?:/i.test(url) ? url : new URL(url, world.base).href;
    return realFetch(target, init);
  };
}

export async function bootE3N(world: S6ARequestWorld, name: 'Main' | 'TaskMap', options: {
  search?: string; mode?: ChangeMode; token?: string | (() => string | null); source?: string;
  gate?: boolean;
} = {}): Promise<{ page: BootedPage; log: PageLog }> {
  const log = newPageLog();
  if (options.gate === true) gateChanges(log);
  const page = await bootPage({
    name,
    ...(options.search === undefined ? {} : { search: options.search }),
    token: options.token ?? (() => world.token),
    request: forwardPage(world, log, options.mode ?? 'stream'),
    ...(options.source === undefined ? {} : { source: options.source }),
  });
  const restore = page.restore;
  page.restore = async (): Promise<void> => {
    /* Do not close the controlled openings here: the page's abort signal ends
       them inside `restore`'s own turn window, where a reconnect scheduled by
       `onEnd` is still tracked and cleared. Closing them first schedules the
       same timer outside that window, after `restore` has returned. */
    await restore();
  };
  return { page, log };
}

export function countRoute(log: PageLog, route: string): number {
  return log.calls.filter((call) => call.route === route).length;
}

export function routesSince(log: PageLog, from: number): string[] {
  return log.calls.slice(from).map((call) => call.route);
}

export async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * The S6A world fakes `Date` alone (`holdFakeDate`), so `until`'s Date-based
 * deadline never advances. This bounded wait runs on the test runner's clock
 * and fails on its own assertion when the condition does not hold in time.
 */
export async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  await expect.poll(predicate, { timeout: timeoutMs, interval: 25 }).toBe(true);
}

/* ---------------------------------------------------------------- DOM reads */

export function descendants(element: FakeElement): FakeElement[] {
  const found: FakeElement[] = [];
  const walk = (current: FakeElement): void => {
    for (const child of current.childNodes) {
      if (child instanceof FakeElement) { found.push(child); walk(child); }
    }
  };
  walk(element);
  return found;
}

export function hasClass(element: FakeElement, name: string): boolean {
  return (element.getAttribute('class') ?? '').split(/\s+/).includes(name);
}

export function textOf(element: FakeElement | undefined): string {
  return (element?.textContent ?? '').trim();
}

/** The board's one top-bar `why` node: Main's `.gb-why`, TaskMap's `.tm-goal .why`. */
export function whyText(root: FakeElement, board: 'Main' | 'TaskMap'): string {
  return textOf(findClass(root, board === 'Main' ? 'gb-why' : 'why'));
}

/** The rail's Goal rows, in document order: `button.row` carrying `.row-ord`. */
export function goalRows(root: FakeElement): FakeElement[] {
  const rail = findClass(root, 'rail');
  if (rail === undefined) return [];
  return descendants(rail).filter((element) => element.tagName.toLowerCase() === 'button'
    && hasClass(element, 'row') && findClass(element, 'row-ord') !== undefined);
}

export function goalRowNamed(root: FakeElement, name: string): FakeElement | undefined {
  return goalRows(root).find((row) => textOf(findClass(row, 'row-name')) === name);
}

/** The working-line rows in the rail, excluding the 已归档 expansion's rows. */
export function lineRows(root: FakeElement): FakeElement[] {
  const rail = findClass(root, 'rail');
  if (rail === undefined) return [];
  const archived = findClass(rail, 'rail-archived');
  const hidden = archived === undefined ? new Set<FakeElement>() : new Set([archived, ...descendants(archived)]);
  return descendants(rail).filter((element) => hasClass(element, 'lv-rw') && !hidden.has(element));
}

export function lineRowNamed(root: FakeElement, name: string): FakeElement | undefined {
  const holder = lineRows(root).find((row) => {
    const named = findClass(row, 'row-name');
    return textOf(named ?? row) === name;
  });
  /* The row a click/hover reaches is the native button inside `.lv-rw` (the
   * prototype's own element), not its holder. */
  if (holder === undefined) return undefined;
  return descendants(holder).find((element) => element.tagName.toLowerCase() === 'button') ?? holder;
}

/** The main conversation's head title; empty while a line view replaces the head. */
export function mainHeadTitle(root: FakeElement): string {
  if (findClass(root, 'lv-headbar') !== undefined) return '';
  return textOf(findClass(root, 'head-title'));
}

export function lineHeadTitle(root: FakeElement): string {
  const head = findClass(root, 'lv-headbar');
  return textOf(head === undefined ? undefined : findClass(head, 'head-title'));
}

export function separator(root: FakeElement, label: string): FakeElement {
  const found = findElement(root, (element) => element.getAttribute('role') === 'separator'
    && element.getAttribute('aria-label') === label);
  if (found === undefined) throw new Error(`no separator named ${label}`);
  return found;
}
