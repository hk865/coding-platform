import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from 'vitest';
import type { SessionRef } from '../../../src/contracts/core/identity.js';
import type { SubmittedControl } from '../../../src/contracts/control-intent.js';
import type { RunRef } from '../../../src/contracts/dispatch.js';
import type { QueryJobRef } from '../../../src/contracts/query-job.js';
import { asRecord, asText } from '../../../src/ui/values.js';
import { AG2B_SCOPE, AG2B_WORK_TASK_ID, graphWrite, plain } from '../../helpers/AG2b-collaboration-fixture.js';
import { submitControl } from '../../helpers/A2-restart-fixture.js';
import { openS6ANoticesWorld, type S6ANoticesWorld } from '../../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE, type S6ARequestWorld } from '../../helpers/S6A-request-fixture.js';
import { openS7C1World, type S7C1World } from '../../helpers/S7C-member-fixture.js';
import { cleanupScenarios, openHostScenario, type Driven, type HostScenario } from '../../scenarios/harness.js';
import { NO_REDRIVE, editThenText, readCall, selectedRun } from '../../scenarios/support/common.js';
import { bootPage, findClass, findElement, type BootedPage } from './boot-page.js';
import type { FakeElement } from './dom.js';
import { click } from './E3N-interact.js';
import { descendants, forwardPage, gateChanges, hasClass, lineRows, newPageLog, routeOf, textOf, type PageLog } from './E3N-page.js';

/**
 * E3 Member worlds (test sheet §1.2) and the Member page boot. W0/W5 are
 * `openW1`/`openW2` (E3N-world); W1/W2 the S7C world; W3 the S6A notices world
 * with its three reworks; W4/W6 a real Host scenario (A7's pause at the safe
 * point, C8's cap). Every state comes from a public route or the scenario's
 * own Workflow steps; the literals the rows assert are the sheet's.
 */

/** RFC 4122 v4, the sheet's §2 regular expression. */
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** One world per file at a time: rows of a world run together; `use` closes the previous one first. */
export function worldSlot(): { use<T>(key: string, open: () => Promise<T>, close: (value: T) => Promise<void>): Promise<T>; close(): Promise<void> } {
  let held: { key: string; value: unknown; close(): Promise<void> } | null = null;
  const slot = {
    async use<T>(key: string, open: () => Promise<T>, close: (value: T) => Promise<void>): Promise<T> {
      if (held?.key === key) return held.value as T;
      await slot.close();
      const value = await open();
      held = { key, value, close: () => close(value) };
      return value;
    },
    async close(): Promise<void> {
      const last = held;
      held = null;
      if (last !== null) await last.close();
      await cleanupScenarios();
    },
  };
  return slot;
}

export type E3MW1 = { s7c: S7C1World; module: SessionRef; work: SessionRef; copyRound: QueryJobRef | null };

/** `queries/ask` through the public route; `round` is the copy's Query. */
export async function askLine(world: S6ARequestWorld, sessionRef: SessionRef, question: string, commandId: string): Promise<QueryJobRef> {
  const answer = asRecord((await world.post('queries/ask', plain(S6A_SCOPE, { sessionRef, question, commandId }))).body);
  if (answer['status'] !== 'queued') throw new Error(`E3M: queries/ask was not queued: ${JSON.stringify(answer)}`);
  return answer['round'] as QueryJobRef;
}

/** W1 (`firstRun` ended) or W2 (`held`); `copy` asks `E3M copy question` before the page; `track` sends `E3M track message`. */
export async function openMemberS7C(options: { firstRun?: 'ended' | 'held'; copy?: boolean; track?: boolean } = {}): Promise<E3MW1> {
  const s7c = await openS7C1World({ backend: 'memory', ...(options.firstRun === undefined ? {} : { firstRun: options.firstRun }) });
  try {
    /* One answer per copy the rows ask: the world's `E3M copy question` and the 问一问 row's page question (lead 11-10). */
    s7c.world.scriptReplies([{ kind: 'text', text: 'E3M copy answer' }, { kind: 'text', text: 'E3M copy answer' }]);
    const module = s7c.lines.module.ref;
    const copyRound = options.copy === true ? await askLine(s7c.world, module, 'E3M copy question', 'e3m-copy-question') : null;
    if (options.track === true) {
      const sent = asRecord((await s7c.world.post('messages/send', graphWrite(S6A_SCOPE, {
        recipient: module, text: 'E3M track message', intent: 'action_request', needsReply: true,
      }, 'e3m-track-message'))).body);
      if (sent['status'] !== 'committed') throw new Error(`E3M: the track message did not commit: ${JSON.stringify(sent)}`);
    }
    return { s7c, module, work: s7c.lines.work.ref, copyRound };
  } catch (error) {
    await s7c.close().catch(() => undefined);
    throw error;
  }
}

/** W3: the notices world and its three failed Runs with their automatic requeues. */
export async function openMemberW3(): Promise<S6ANoticesWorld> {
  const notices = await openS6ANoticesWorld({ backend: 'memory' });
  try {
    await notices.seedReworkNotices();
    return notices;
  } catch (error) {
    await notices.close().catch(() => undefined);
    throw error;
  }
}

export type E3MHost = { h: HostScenario; line: SessionRef; run: RunRef };

/** The seeded executor line of `ag2b-work`, read from `lines/list`. */
export async function workLineOf(h: HostScenario): Promise<SessionRef> {
  const list = asRecord(asRecord(await h.answer('lines/list', plain(AG2B_SCOPE, { workspace: AG2B_SCOPE })))['value']);
  const rows = Array.isArray(list['rows']) ? list['rows'] : [];
  const row = rows.map(asRecord).find((entry) => (Array.isArray(entry['responsibleNow']) ? entry['responsibleNow'] : [])
    .some((brief) => asText(asRecord(asRecord(brief)['task'])['taskId']) === AG2B_WORK_TASK_ID));
  if (row === undefined) throw new Error(`E3M: no line is responsible for ${AG2B_WORK_TASK_ID}: ${JSON.stringify(list)}`);
  return row['key'] as SessionRef;
}

type E3MW4Run = { h: HostScenario; line: SessionRef; run: RunRef; done: Promise<Driven>;
  page?: { page: BootedPage; log: PageLog }; intent?: SubmittedControl['intent'] };

/** W4's Host and first pause; `bootPage` opens Member while the pause/cancel is
 * still queued (its `duringReply`), the one difference between W4 and P04-4/P05-3. */
async function openW4Run(options: { kind?: 'pause' | 'cancel'; bootPage?: boolean } = {}): Promise<E3MW4Run> {
  const boot = options.bootPage === true;
  const flowId = boot ? 'e3m-queue' : 'e3m-w4';
  let h: HostScenario | undefined;
  let opened: { page: BootedPage; log: PageLog } | undefined;
  let line: SessionRef | undefined;
  let run: RunRef | undefined;
  let intent: SubmittedControl['intent'] | undefined;
  let signal: () => void = () => undefined;
  const pageOpened = new Promise<void>((resolve) => { signal = resolve; });
  const scenario = await openHostScenario({ automation: NO_REDRIVE, gitWorkspace: !boot, script: {
    replies: boot ? [readCall(flowId)] : [readCall(flowId), ...editThenText(flowId)],
    duringReply: async (index) => {
      if (index !== 0 || h === undefined) return;
      if (!boot) {
        await submitControl(h.host, await selectedRun(h), 'pause', 'operator pause', 'e3m-w4-pause');
        return;
      }
      run = await selectedRun(h);
      line = await workLineOf(h);
      const submitted = await submitControl(h.host, run, options.kind!, 'operator ' + options.kind, 'e3m-queue-' + options.kind);
      intent = submitted.intent;
      opened = await bootMemberOnHost(h, memberSearch('ag2b-goal', line));
      signal();
    } } });
  h = scenario;
  const done = scenario.advance(scenario.select(flowId, AG2B_WORK_TASK_ID));
  if (!boot) {
    const first = await done;
    if (first.state !== 'waiting') throw new Error(`E3M W4: the paused Run did not wait: ${first.state}`);
    await mkdir(join(scenario.root, 'src'), { recursive: true });
    await writeFile(join(scenario.root, 'src/e3m-change.ts'), 'export const e3mOne = 1;\nexport const e3mTwo = 2;\nexport const e3mThree = 3;\n');
    return { h: scenario, line: await workLineOf(scenario), run: await selectedRun(scenario), done };
  }
  await pageOpened;
  if (opened === undefined || line === undefined || run === undefined || intent === undefined) {
    throw new Error(`E3M: the ${options.kind} page did not open during the first model call`);
  }
  return { h: scenario, line, run, done, page: opened, intent };
}

/**
 * W4 (A7-control.test.ts:243-268): the first model request pauses the Run,
 * the pause lands at the safe point; then `src/e3m-change.ts` (three lines) is
 * written into the git workspace before any page opens.
 */
export async function openMemberW4(): Promise<E3MHost> {
  const { h, line, run } = await openW4Run();
  return { h, line, run };
}

/**
 * W4's pause at the safe point, plus the Member page opened while the control
 * is still `queued`: `duringReply` submits the control and boots the page before
 * the Run reaches its safe point, so the head reads `已请求暂停/取消，等安全点`.
 * `done` is the Workflow drive; `intent` is the submitted control.
 */
export type E3MQueued = { h: HostScenario; line: SessionRef; run: RunRef; page: BootedPage; log: PageLog;
  done: Promise<Driven>; intent: SubmittedControl['intent'] };

export async function openMemberControlQueued(kind: 'pause' | 'cancel'): Promise<E3MQueued> {
  const opened = await openW4Run({ kind, bootPage: true });
  if (opened.page === undefined || opened.intent === undefined) {
    throw new Error(`E3M: the ${kind} page did not open during the first model call`);
  }
  return { h: opened.h, line: opened.line, run: opened.run, page: opened.page.page, log: opened.page.log,
    done: opened.done, intent: opened.intent };
}

/** C8-auto-rework-cap.test.ts:40-95: Run n creates its own file, then answers; the check always fails. */
const CAP_RUN = (n: number) => [
  { kind: 'calls' as const, calls: [{ callId: `e3m-cap-run-${n}-edit`, name: 'edit', args: { mode: 'create', path: `src/e3m-cap-run-${n}.txt`,
    newText: `E3M cap: Run ${n} tries another fix\n` } }] },
  { kind: 'text' as const, text: `E3M cap: Run ${n} wrote its file; the check still fails` }];

/** W6: three automatic requeues, then the cap stops the fourth Run's Task failed with a person's requeue open. */
export async function openMemberW6(): Promise<E3MHost> {
  const h = await openHostScenario({ check: 'fail', script: { replies: [1, 2, 3, 4].flatMap(CAP_RUN) } });
  const capped = await h.advance(h.select('e3m-w6', AG2B_WORK_TASK_ID));
  const row = await h.taskRow();
  if (capped.state !== 'waiting' || row.effectivePhase !== 'failed' || row.attemptOrdinal !== 4
    || !(row.failure?.requeueActors ?? []).includes('human') || row.execution === null) {
    throw new Error(`E3M W6: the cap did not stop the fourth Run: ${JSON.stringify(row)}`);
  }
  return { h, line: await workLineOf(h), run: row.execution };
}

/** The pins `lines/read` gives a line control (`work-line.ts:105`), read the way the page reads (E3G-world `e3gCardPins`). */
export async function controlPins(world: S6ARequestWorld, key: SessionRef, kind: string): Promise<unknown[]> {
  const read = asRecord(asRecord((await world.post('lines/read', plain(S6A_SCOPE, { workspace: S6A_SCOPE, key }))).body)['value']);
  const controls = asRecord(read['row'])['controls'];
  const control = (Array.isArray(controls) ? controls : []).map(asRecord).find((entry) => entry['kind'] === kind);
  if (control === undefined || !Array.isArray(control['pins'])) throw new Error(`E3M: lines/read has no ${kind} control: ${JSON.stringify(read)}`);
  return control['pins'];
}

/* -------------------------------------------------------------- the page */

export type MemberPage = { page: BootedPage; log: PageLog; receipts: Array<{ route: string; body: Record<string, unknown> }> };

const RECEIPT_ROUTES = new Set(['controls/submit', 'tasks/requeue', 'messages/send', 'queries/ask']);

/**
 * The Member page on a real Host (`forwardPage`, sheet §1.1). The change stream
 * is held (`gateChanges`), so the page has made exactly its first read when the
 * boot returns and a click's reread is the only later one. The write routes'
 * answers are kept for the rows' `committed` checks.
 */
export async function bootMemberAt(target: { readonly base: string; readonly token: string }, search: string): Promise<MemberPage> {
  const log = newPageLog();
  gateChanges(log);
  const receipts: MemberPage['receipts'] = [];
  const forward = forwardPage(target as unknown as S6ARequestWorld, log, 'controlled');
  const page = await bootPage({ name: 'Member', search, token: () => target.token, request: async (url, init, realFetch) => {
    const answer = await forward(url, init, realFetch);
    const route = routeOf(url);
    if (RECEIPT_ROUTES.has(route)) receipts.push({ route, body: asRecord(await answer.clone().json().catch(() => null)) });
    return answer;
  } });
  return { page, log, receipts };
}

/** W4/W6: the same forwarder over the scenario's live Host (Codex 17). */
export function bootMemberOnHost(h: HostScenario, search: string): Promise<MemberPage> {
  return bootMemberAt({ get base() { return h.host.base; }, get token() { return h.host.token; } }, search);
}

export function memberSearch(goalId: string | null, line: SessionRef | null): string {
  const params = new URLSearchParams();
  if (goalId !== null) params.set('goal', goalId);
  if (line !== null) { params.set('lineProject', line.projectId); params.set('lineSession', line.sessionId); }
  const text = params.toString();
  return text === '' ? '' : '?' + text;
}

/** A bounded wait that never throws: the row's own `expect` says what was missed. */
export async function settle(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  for (let waited = 0; waited < timeoutMs; waited += 25) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (predicate()) return;
  }
}

/** The answer the Host gave the page's write on `route` (`bootMemberAt` keeps them). */
export function receiptBody(booted: MemberPage, route: string): Record<string, unknown> | undefined {
  return booted.receipts.find((receipt) => receipt.route === route)?.body;
}

export function callsOf(log: PageLog, route: string, from = 0): Array<PageLog['calls'][number]> {
  return log.calls.slice(from).filter((call) => call.route === route);
}

export function metaOf(call: PageLog['calls'][number] | undefined): { requestId?: unknown; expected?: Array<{ ref: unknown; revision: number }> } {
  return asRecord(asRecord(asRecord(call?.body)['request'])['meta']) as never;
}

/* ------------------------------------------------------------- DOM reads */

/** The rail button of `key`: `lines/list`'s order after the synthetic 秘书（主对话） row. */
export async function railRowOf(root: FakeElement, world: S6ARequestWorld, key: SessionRef): Promise<FakeElement | undefined> {
  const list = asRecord(asRecord((await world.post('lines/list', plain(S6A_SCOPE, { workspace: S6A_SCOPE }))).body)['value']);
  const rows = (Array.isArray(list['rows']) ? list['rows'] : []).map(asRecord);
  const index = rows.findIndex((row) => asText(asRecord(row['key'])['sessionId']) === key.sessionId);
  const holder = index < 0 ? undefined : lineRows(root)[index + 1];
  return holder === undefined ? undefined
    : descendants(holder).find((element) => element.tagName.toLowerCase() === 'button') ?? holder;
}

export function elementsOf(scope: FakeElement | undefined, tag: string, className?: string): FakeElement[] {
  if (scope === undefined) return [];
  return descendants(scope).filter((element) => element.tagName.toLowerCase() === tag
    && (className === undefined || hasClass(element, className)));
}

/** The first button under `scope` whose trimmed text is exactly `text`. */
export function buttonText(scope: FakeElement | undefined, text: string): FakeElement | undefined {
  return elementsOf(scope, 'button').find((element) => textOf(element) === text);
}

/** The `.mh-f` value whose `.mh-k` is `key` (状态、职责、任务、尝试). */
export function headFact(root: FakeElement, key: string): string {
  const fact = findClass(root, 'mh-facts') === undefined ? undefined
    : descendants(findClass(root, 'mh-facts')!).find((element) => hasClass(element, 'mh-f') && textOf(findClass(element, 'mh-k')) === key);
  return textOf(fact === undefined ? undefined : findClass(fact, 'mh-v'));
}

/** The `<dd>` after the `<dt>` named `label` in the detail. */
export function detailValue(root: FakeElement, label: string): string | null {
  const list = findClass(findClass(root, 'detail') ?? root, 'd-dl');
  const children = (list?.childNodes ?? []).filter((child): child is FakeElement => 'tagName' in child);
  const at = children.findIndex((child) => child.tagName.toLowerCase() === 'dt' && textOf(child) === label);
  return at < 0 || children[at + 1] === undefined ? null : textOf(children[at + 1]);
}

/** The right panel's record rows (`button.row`, records and their derived rows). */
export function recordRows(root: FakeElement): FakeElement[] {
  return elementsOf(findClass(root, 'panel'), 'button', 'row');
}

export function radio(root: FakeElement, text: string): FakeElement | undefined {
  return findElement(root, (element) => element.getAttribute('role') === 'radio' && textOf(element).includes(text));
}

export function memberInput(root: FakeElement): FakeElement | undefined {
  return findElement(root, (element) => element.getAttribute('id') === 'member-input');
}

/** One click on an element the row needs present; a missing one fails here, on its name. */
export function press(element: FakeElement | undefined, what: string): void {
  expect(element, what).toBeDefined();
  click(element!);
}

/** Type into the composer the way the runtime's `onChange` listens (`input`). */
export function typeDraft(root: FakeElement, text: string): void {
  const box = memberInput(root);
  if (box === undefined) return;
  box.value = text;
  box.dispatch('input', { target: box, currentTarget: box });
}
