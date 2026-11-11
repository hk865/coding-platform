import { expect } from 'vitest';
import { bootPage, findAllClass, findClass, findElement, type BootedPage, type PageFetch } from './boot-page.js';
import { FakeElement } from './dom.js';
import type { S6ARequestWorld } from '../../helpers/S6A-request-fixture.js';

/** The Host a page talks to: an S6A world, or a Host scenario's `h.host` (read on every call). */
export type E3NTarget = Pick<S6ARequestWorld, 'base' | 'token'>;

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
  /** The Host's answer body once it arrived (`undefined` while the call is open). */
  reply: unknown;
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
  /** The answers of `requests/submit`, in call order (G21/G22 read `status` and `requestRoot`). */
  submits: unknown[];
  /** The answers of `decisions/answer`, in call order (G13/G14/G16 read the `committed` receipt). */
  answers: unknown[];
};

export type ChangeMode = 'stream' | 'controlled' | '429' | '429-once';

export const CORE = '/api/real/core/';

export function newPageLog(): PageLog {
  let release: () => void = () => undefined;
  const log: PageLog = {
    calls: [], changes: 0, changesTokens: [], openings: [], changesGate: null, submits: [], answers: [],
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

/** A2 (tests/RULES.md): the one route a row holds `unavailable`, answered as the Host's own rejection shape. */
const UNAVAILABLE = { status: 'rejected', code: 'unavailable', reason: 'E3U: this route is held unavailable' };

/**
 * The forwarded Host origin is read on every call, so a reopen's new address
 * is used. `unavailable` names one core route whose every call answers the
 * Host's `unavailable` rejection instead of reaching the Host.
 */
export function forwardPage(world: Pick<E3NTarget, 'base'>, log: PageLog, mode: ChangeMode = 'stream',
  unavailable: string | null = null): PageFetch {
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
    let call: RecordedCall | null = null;
    if (route !== 'changes' && url.includes(CORE)) {
      call = { route, url, input: body['input'] ?? writeInput?.input ?? null, body, token: tokenOf(init), reply: undefined };
      log.calls.push(call);
      if (route === unavailable) {
        call.reply = UNAVAILABLE;
        return new Response(JSON.stringify(UNAVAILABLE), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
    const target = /^https?:/i.test(url) ? url : new URL(url, world.base).href;
    const answer = await realFetch(target, init);
    if (call !== null) call.reply = await answer.clone().json().catch(() => null);
    if (route === 'requests/submit') {
      log.submits.push(await answer.clone().json().catch(() => null));
    }
    if (route === 'decisions/answer') {
      log.answers.push(await answer.clone().json().catch(() => null));
    }
    return answer;
  };
}

export async function bootE3N(world: E3NTarget, name: 'Main' | 'TaskMap' | 'Goals' | 'ArchOverview' | 'Decide' | 'Member' | 'Chain', options: {
  search?: string; mode?: ChangeMode; token?: string | (() => string | null); source?: string;
  gate?: boolean; unavailable?: string;
} = {}): Promise<{ page: BootedPage; log: PageLog }> {
  const log = newPageLog();
  if (options.gate === true) gateChanges(log);
  const page = await bootPage({
    name,
    ...(options.search === undefined ? {} : { search: options.search }),
    token: options.token ?? (() => world.token),
    request: forwardPage(world, log, options.mode ?? 'stream', options.unavailable ?? null),
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

/**
 * E3U card worlds (test sheet §0): Main booted on a Host scenario (`h.host`,
 * as `E3D-page.ts` `hostTarget`); every non-stream request goes to that Host.
 */
export async function bootMainCard(h: { readonly host: E3NTarget }, search: string): Promise<{ page: BootedPage; log: PageLog }> {
  return await bootE3N({ get base() { return h.host.base; }, get token() { return h.host.token; } }, 'Main', { search });
}

export function countRoute(log: PageLog, route: string): number {
  return log.calls.filter((call) => call.route === route).length;
}

export function callsTo(log: PageLog, route: string): RecordedCall[] {
  return log.calls.filter((call) => call.route === route);
}

/** A graph write's `{ input, meta }` as the page sent it. */
export function sentWrite(call: RecordedCall | undefined): { input: Record<string, unknown>; meta: { requestId?: string; expected: unknown[] } } {
  return (call?.body as { request: { input: Record<string, unknown>; meta: { requestId?: string; expected: unknown[] } } }).request;
}

/**
 * Waits until no new core call starts for `stillMs` and every call has its
 * answer (25 ms turns of the runner's clock, never `Date`: the S6A worlds fake it).
 */
export async function quietPage(log: PageLog, stillMs = 300, timeoutMs = 8_000): Promise<number> {
  let last = -1;
  let still = 0;
  for (let waited = 0; waited < timeoutMs; waited += 25) {
    const open = log.calls.some((call) => call.reply === undefined);
    if (log.calls.length !== last || open) {
      last = log.calls.length;
      still = 0;
    } else {
      still += 25;
      if (still >= stillMs) return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return log.calls.length;
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

/** The same bounded wait without `expect.poll`: it never advances the Host's
 * fake timers, for a page whose only pending work is its own real requests. */
export async function turns(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const count = Math.max(1, Math.ceil(timeoutMs / 25));
  for (let turn = 0; turn < count; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (predicate()) return;
  }
  if (predicate()) return;
  throw new Error(`condition not reached within ${timeoutMs} ms`);
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
  return goalRows(root).find((row) => {
    const text = textOf(findClass(row, 'row-name'));
    return text === name || text.endsWith(' · ' + name);
  });
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

/* ------------------------------------------------- E3U Main thread DOM reads */

/** The main conversation (`.thread`); its rows are `.msg-user`, `.msg-agent` and `.sys-line`. */
export function thread(root: FakeElement): FakeElement | undefined {
  return findClass(root, 'thread');
}

/** The user bubbles' text in document order (a bubble without quotes is the round's input). */
export function userTexts(root: FakeElement): string[] {
  const holder = thread(root);
  return holder === undefined ? [] : findAllClass(holder, 'msg-user').map((row) => textOf(findClass(row, 'bubble')));
}

/** The secretary answers' text (`.msg-agent .prose`) in document order. */
export function answerTexts(root: FakeElement): string[] {
  const holder = thread(root);
  return holder === undefined ? [] : findAllClass(holder, 'msg-agent').map((row) => textOf(findClass(row, 'prose')));
}

/**
 * The element that carries a click listener and whose text contains `text`,
 * the narrowest one: the fake DOM does not bubble, so a row is clicked where
 * the board bound it.
 */
export function clickable(root: FakeElement, text: string): FakeElement | undefined {
  const found = [root, ...descendants(root)].filter((element) => (element.listeners.get('click')?.length ?? 0) > 0
    && element.textContent.includes(text));
  return found.sort((a, b) => a.textContent.length - b.textContent.length)[0];
}
