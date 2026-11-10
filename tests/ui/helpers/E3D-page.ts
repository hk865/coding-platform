import { expect } from 'vitest';
import { bootPage, findClass, findElement, type BootedPage } from './boot-page.js';
import type { FakeElement } from './dom.js';
import { CORE, descendants, hasClass, lineRows, routeOf, textOf } from './E3N-page.js';
import { click } from './E3N-interact.js';

/**
 * E3 Decide page base (test sheet §1.1): the one `bootPage` forwarder and the
 * bounded waits of the Decide rows. Every request the page makes after its own
 * source goes, as it is, to the real Host at the target's origin (X9: the token
 * only from the served meta, the change stream included); the log keeps each
 * core call's route, input and the Host's answer. The DOM reads use only the
 * frozen board's own class names and labels.
 */

/** The Host a page talks to; read on every request (a W3 scenario's Host is `h.host`). */
export type E3DTarget = { base(): string; token(): string };

export type E3DCall = { route: string; input: unknown; body: Record<string, unknown>; reply: unknown };
export type E3DLog = { calls: E3DCall[]; changes: number };

export function worldTarget(world: { base: string; token: string }): E3DTarget {
  return { base: () => world.base, token: () => world.token };
}

export function hostTarget(h: { host: { base: string; token: string } }): E3DTarget {
  return { base: () => h.host.base, token: () => h.host.token };
}

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') return {};
  try {
    const parsed = JSON.parse(init.body) as unknown;
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/** Boot `Decide` against the target; every request is the real Host's answer. */
export async function bootDecide(target: E3DTarget, options: { search?: string } = {}): Promise<{ page: BootedPage; log: E3DLog }> {
  const log: E3DLog = { calls: [], changes: 0 };
  const page = await bootPage({
    name: 'Decide',
    ...(options.search === undefined ? {} : { search: options.search }),
    token: () => target.token(),
    request: async (url, init, realFetch) => {
      const route = routeOf(url);
      const real = new URL(url, target.base()).toString();
      if (route === 'changes') {
        log.changes += 1;
        return await realFetch(real, init);
      }
      if (!url.includes(CORE)) return await realFetch(real, init);
      const body = bodyOf(init);
      const request = body['request'] as { input?: unknown } | undefined;
      const call: E3DCall = { route, input: body['input'] ?? request?.input ?? null, body, reply: undefined };
      log.calls.push(call);
      const answer = await realFetch(real, init);
      call.reply = await answer.clone().json().catch(() => null);
      return answer;
    },
  });
  return { page, log };
}

/** A bounded wait on the test runner's clock; answers whether the condition held (the row then asserts it). */
export async function settle(predicate: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  for (let waited = 0; waited < timeoutMs; waited += 25) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}

/**
 * Waits until no new core call starts for `stillMs` and every call has its
 * answer; returns the call count. It counts 25 ms turns, never `Date`: the S6A
 * worlds fake `Date` alone, so a `Date` deadline would never pass.
 */
export async function quiet(log: E3DLog, stillMs = 200, timeoutMs = 8_000): Promise<number> {
  let last = -1;
  let still = 0;
  for (let waited = 0; waited < timeoutMs; waited += 25) {
    const pending = log.calls.some((call) => call.reply === undefined);
    if (log.calls.length !== last || pending) {
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

export function count(log: E3DLog, route: string): number {
  return log.calls.filter((call) => call.route === route).length;
}

export function callsOf(log: E3DLog, route: string): E3DCall[] {
  return log.calls.filter((call) => call.route === route);
}

/** Every call whose route starts with `prefix` (`architecture/` names the whole family). */
export function countPrefix(log: E3DLog, prefix: string): number {
  return log.calls.filter((call) => call.route.startsWith(prefix)).length;
}

/** A graph write's `{ input, meta }` as the page sent it. */
export function writeOf(call: E3DCall): { input: Record<string, unknown>; meta: { requestId?: string; expected: unknown[] } } {
  return (call.body as { request: { input: Record<string, unknown>; meta: { requestId?: string; expected: unknown[] } } }).request;
}

/** A pin set's meaning does not depend on its array order. */
export function pinSet(pins: readonly unknown[]): string[] {
  return pins.map((pin) => JSON.stringify(pin)).sort();
}

/**
 * The page's first read and the stream-open reread have landed: a `decisions/queue`
 * answer exists and no call has started for a moment. On a page that never reads
 * (the frozen sample board) the wait ends at its bound and the row's own
 * assertion fails.
 */
export async function opened(log: E3DLog, timeoutMs = 6_000): Promise<number> {
  await settle(() => callsOf(log, 'decisions/queue').some((call) => call.reply !== undefined), timeoutMs);
  return await quiet(log);
}

/* ---------------------------------------------------------------- DOM reads */

/** The rail's two inbox rows (`需要你决定`, `请知悉`). */
export function inboxRow(root: FakeElement, name: '需要你决定' | '请知悉'): FakeElement | undefined {
  const rail = findClass(root, 'rail');
  if (rail === undefined) return undefined;
  return descendants(rail).find((element) => element.tagName.toLowerCase() === 'button'
    && textOf(findClass(element, 'row-name')) === name);
}

/** The queue's sections, in order. */
export function sections(root: FakeElement): FakeElement[] {
  return descendants(root).filter((element) => hasClass(element, 'dq-sec'));
}

export function sectionNames(root: FakeElement): string[] {
  return sections(root).map((section) => section.getAttribute('aria-label') ?? textOf(findClass(section, 'dq-label')));
}

/** The item rows of one section (its buttons that carry `.row-name`). */
export function sectionRows(root: FakeElement, name: string): FakeElement[] {
  const section = sections(root).find((element) => (element.getAttribute('aria-label') ?? '') === name);
  if (section === undefined) return [];
  return descendants(section).filter((element) => element.tagName.toLowerCase() === 'button'
    && findClass(element, 'row-name') !== undefined);
}

export function rowName(row: FakeElement | undefined): string {
  return row === undefined ? '' : textOf(findClass(row, 'row-name'));
}

export function rowSub(row: FakeElement | undefined): string {
  return row === undefined ? '' : textOf(findClass(row, 'row-sub'));
}

/** The row's time: an absent node and an empty one both read `''`. */
export function rowMeta(row: FakeElement | undefined): string {
  return row === undefined ? '' : textOf(findClass(row, 'row-meta'));
}

/** The open decision card (`section.decision`). */
export function card(root: FakeElement): FakeElement | undefined {
  return findElement(root, (element) => element.tagName.toLowerCase() === 'section' && hasClass(element, 'decision'));
}

export function cardTitle(root: FakeElement): string {
  const open = card(root);
  return open === undefined ? '' : textOf(findClass(open, 'dc-title'));
}

export function cardPos(root: FakeElement): string {
  const open = card(root);
  return open === undefined ? '' : textOf(findClass(open, 'pos'));
}

/** A button whose `aria-label` is `label` (the icon buttons). */
export function labelled(root: FakeElement | undefined, label: string): FakeElement | undefined {
  if (root === undefined) return undefined;
  return findElement(root, (element) => element.tagName.toLowerCase() === 'button' && element.getAttribute('aria-label') === label);
}

/** A button of the open card whose text is `label` (actions, 问秘书, 确定, a step's confirm). */
export function cardButton(root: FakeElement, label: string): FakeElement | undefined {
  const open = card(root);
  if (open === undefined) return undefined;
  return descendants(open).find((element) => element.tagName.toLowerCase() === 'button' && textOf(element) === label);
}

/** The key/value pairs of the open card's main `详情` list. */
export function cardFacts(root: FakeElement): Array<{ key: string; value: string }> {
  const open = card(root);
  const list = open === undefined ? undefined : descendants(open).find((element) => hasClass(element, 'dc-facts')
    && element.getAttribute('aria-label') === '详情');
  if (list === undefined) return [];
  const pairs: Array<{ key: string; value: string }> = [];
  for (const child of descendants(list)) {
    const tag = child.tagName.toLowerCase();
    if (tag === 'dt') pairs.push({ key: textOf(child), value: '' });
    else if (tag === 'dd' && pairs.length > 0) pairs[pairs.length - 1]!.value = textOf(child);
  }
  return pairs;
}

export function factOf(root: FakeElement, key: string): string | undefined {
  return cardFacts(root).find((fact) => fact.key === key)?.value;
}

/** The step's confirm: the last button of the card's foot while a step is open (after 返回). */
export function stepConfirm(root: FakeElement): FakeElement | undefined {
  const open = card(root);
  if (open === undefined || findClass(open, 'dc-step') === undefined) return undefined;
  const foot = findClass(open, 'dc-foot');
  const buttons = foot === undefined ? [] : descendants(foot).filter((element) => element.tagName.toLowerCase() === 'button');
  const back = buttons.findIndex((element) => textOf(element) === '返回');
  return back < 0 ? undefined : buttons[back + 1];
}

/** `is-off` and `aria-disabled="true"`: a control drawn unusable (R5; the step confirm and 确定 too). */
export function isOff(element: FakeElement | undefined): boolean {
  return element !== undefined && hasClass(element, 'is-off') && element.getAttribute('aria-disabled') === 'true';
}

/** Types `text` into the field with `id`, as a keystroke (`onChange` of a text field listens to `input`). */
export function typeInto(root: FakeElement, id: string, text: string): void {
  const field = findElement(root, (element) => element.getAttribute('id') === id);
  expect(field, `the field #${id}`).toBeDefined();
  field!.value = text;
  field!.dispatch('input', { target: field, currentTarget: field });
}

/** The prefilled failing-check boxes of the fix step, with their label text. */
export function checkBoxes(root: FakeElement): Array<{ box: FakeElement; text: string }> {
  return descendants(root).filter((element) => hasClass(element, 'dc-check')).map((label) => ({
    box: descendants(label).find((element) => element.tagName.toLowerCase() === 'input')!,
    text: textOf(label),
  })).filter((entry) => entry.box !== undefined);
}

export function toggleBox(box: FakeElement): void {
  box.checked = !box.checked;
  box.dispatch('change', { target: box, currentTarget: box });
}

/** The interactive element of a rail line holder (`a` for the secretary row, `button` for the others). */
export function lineControl(holder: FakeElement): FakeElement | undefined {
  return descendants(holder).find((element) => ['a', 'button'].includes(element.tagName.toLowerCase()));
}

/** The first rail line that is not the secretary's link. */
export function firstWorkLine(root: FakeElement): FakeElement | undefined {
  for (const holder of lineRows(root)) {
    const control = lineControl(holder);
    if (control !== undefined && control.tagName.toLowerCase() === 'button') return control;
  }
  return undefined;
}

/**
 * Opens, one row after another, the queue rows of `section` until the card
 * offers a button `label`; answers that button (undefined when no card does).
 * Rows are opened by clicking, which reads nothing (D16/D17).
 */
export async function openCardWith(root: FakeElement, label: string, section = '要决定'): Promise<FakeElement | undefined> {
  const rows = sectionRows(root, section);
  for (let index = 0; index < rows.length; index += 1) {
    const row = sectionRows(root, section)[index];
    if (row === undefined) break;
    click(row);
    await settle(() => card(root) !== undefined, 500);
    const found = cardButton(root, label);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The send button of the question composer. */
export function sendButton(root: FakeElement): FakeElement | undefined {
  return labelled(root, '发送');
}

/** The question composer (`.composer` with `#ask-input`). */
export function composer(root: FakeElement): FakeElement | undefined {
  return findElement(root, (element) => element.getAttribute('id') === 'ask-input');
}
