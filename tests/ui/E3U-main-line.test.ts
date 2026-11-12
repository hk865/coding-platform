import { afterAll, describe, expect, it } from 'vitest';
import { findAllClass, findButton, findClass, findElement, type BootedPage } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import {
  auxPanel, callsTo, countRoute, descendants, hasClass, lineRowNamed, lineRows, onMain, pickTab, quietPage,
  routesSince, sentWrite, settledN, textOf, treeNames, waitFor,
  type E3NTarget, type PageLog,
} from './helpers/E3N-page.js';
import { click, hover } from './helpers/E3N-interact.js';
import { lineOrder, openW1, openW2, openW4 } from './helpers/E3N-world.js';
import {
  buttonText, controlPins, elementsOf, openMemberS7C, openMemberW4, openMemberW6, radio, worldSlot, type E3MHost, type E3MW1,
} from './helpers/E3M-world.js';
import { typeInto } from './helpers/E3D-page.js';
import { openBudgetWorld } from './helpers/E3D-world.js';
import { dlValue } from './helpers/E3C-world.js';
import { AG2B_SCOPE, graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import type { S6ARequestWorld } from '../helpers/S6A-request-fixture.js';

/**
 * E3U T-B01–T-B07 (test sheet e3main-b-tests §1.1; wiring A34–A38, L07): a
 * line picked in the rail fills the centre from `lines/read` and `lines/page`,
 * its controls go through `controls/submit` and `tasks/requeue`, 问一问 and 直接干预
 * through `queries/ask` and `messages/send`, an archived line opens read-only.
 * Real Host, scripted model; the change stream is held except where the row
 * waits for its reread.
 */

const slot = worldSlot();
afterAll(async () => { await slot.close(); }, 180_000);
/* The S7C world: `s7c-m1`'s Run ended on the module line, then one 直接干预 sent to it (E3M-world). */
const lineWorld = () => slot.use('line', () => openMemberS7C({ firstRun: 'ended', track: true }), (w) => w.s7c.close());
const heldWorld = () => slot.use('held', () => openMemberS7C({ firstRun: 'held' }), (w) => w.s7c.close());
const w6 = () => slot.use('W6', () => openMemberW6(), (w) => w.h.dispose());
/* E3M W4: the work Run paused at its safe point (own `paused`, controls resume/cancel). */
const paused = () => slot.use('MW4', () => openMemberW4(), (w) => w.h.dispose());
/* E3D's budget world: the work Run ended budget exhausted; a requeue without a larger budget is refused. */
const budget = () => slot.use('budget', () => openBudgetWorld(), (h) => h.dispose());
const w1 = () => slot.use('W1', () => openW1(), (w) => w.world.close());
const w2 = () => slot.use('W2', () => openW2(), (w) => w.world.close());
const w4 = () => slot.use('W4', () => openW4(), (w) => w.world.close());

const posting = (world: S6ARequestWorld) => async (route: string, body: unknown): Promise<unknown> =>
  (await world.post(route, body)).body;

type Row = (page: BootedPage, log: PageLog) => Promise<void>;
type MainOptions = Parameters<typeof onMain>[2];
const S7C = { search: '?goal=s7c-goal' };

/** A Host scenario as Main's target, as `bootMainCard` makes it; its rows boot with the change stream on, as that does. */
const hostOf = (h: { readonly host: E3NTarget }): E3NTarget => ({ get base() { return h.host.base; }, get token() { return h.host.token; } });

/** The rail button of the line at `index` of `lines/list` (after the synthetic 秘书（主对话） row). */
function railButton(root: FakeElement, index: number): FakeElement | undefined {
  const holder = lineRows(root)[index + 1];
  return holder === undefined ? undefined
    : descendants(holder).find((element) => element.tagName.toLowerCase() === 'button') ?? holder;
}

async function openRailLine(page: BootedPage, log: PageLog, index: number): Promise<void> {
  expect(index).toBeGreaterThanOrEqual(0);
  await waitFor(() => railButton(page.root, index) !== undefined);
  click(railButton(page.root, index)!);
  await waitFor(() => findClass(page.root, 'lv-headbar') !== undefined);
  await quietPage(log);
}

/** `onMain` (`options` as its) with the line at rail `index` opened before the row's `body`. */
async function onLine(world: E3NTarget, index: number, body: Row, options: MainOptions = {}): Promise<void> {
  await onMain(world, async (page, log) => {
    await openRailLine(page, log, index);
    await body(page, log);
  }, options);
}
/** The S7C module line's index in `lines/list`, read before the page boots (after it, the read is the page's own call). */
const moduleIndex = async (w: E3MW1): Promise<number> => (await lineOrder(posting(w.s7c.world))).indexOf(w.module.sessionId);
/** The S7C world's module line opened on `?goal=s7c-goal`. */
const onModule = async (w: E3MW1, body: Row, options: MainOptions = {}): Promise<void> =>
  onLine(w.s7c.world, await moduleIndex(w), body, { ...S7C, ...options });
/** A Host scenario's executor line opened, the change stream on (the rows wait for their reread). */
const onHostLine = async (w: E3MHost, body: Row): Promise<void> => onLine(hostOf(w.h),
  (await lineOrder((route, request) => w.h.answer(route, request), AG2B_SCOPE)).indexOf(w.line.sessionId), body, { mode: 'stream' });

const lineThread = (root: FakeElement): FakeElement | undefined => findClass(root, 'lv-thread');
const runRows = (root: FakeElement): FakeElement[] => elementsOf(lineThread(root) ?? root, 'button', 'run');
const bubbles = (root: FakeElement): FakeElement[] => findAllClass(lineThread(root) ?? root, 'msg-user');
const bubbleTexts = (root: FakeElement): string[] => bubbles(root).map((row) => textOf(findClass(row, 'bubble')));

/** A control of `.lv-acts` by its label (暂停/继续/取消/重新入队). */
const lineAct = (root: FakeElement, label: string): FakeElement | undefined => buttonText(findClass(root, 'lv-acts'), label);

/** The line view's own composer (the `.composer` holding `#lv-input`): its send button, or its foot's words (`.to`). */
function lineComposer(root: FakeElement, part: 'send' | 'to'): FakeElement | undefined {
  const composer = findAllClass(root, 'composer').find((element) => findElement(element,
    (child) => child.getAttribute('id') === 'lv-input') !== undefined);
  return composer === undefined ? undefined : findClass(composer, part);
}
const lineSend = (root: FakeElement): FakeElement | undefined => lineComposer(root, 'send');

/** The delivery cells of the 直接干预 whose bubble is `text` (the words after `直接干预 ·`, in order). */
function trackCells(root: FakeElement, text: string): string[] | undefined {
  const row = bubbles(root).find((entry) => textOf(findClass(entry, 'bubble')) === text);
  const track = row === undefined ? undefined : findClass(row, 'deliv');
  if (track === undefined) return undefined;
  return elementsOf(track, 'span').filter((element) => !hasClass(element, 'sep')).map((element) => textOf(element)).slice(1);
}

/** The line head's fact `key` (`.lv-f`: 状态、任务、负责、尝试…), '' when it is not drawn. */
function lvFact(root: FakeElement, key: string): string {
  const fact = findAllClass(findClass(root, 'lv-facts') ?? root, 'lv-f').find((f) => textOf(findClass(f, 'lv-k')) === key);
  return fact === undefined ? '' : textOf(findClass(fact, 'lv-v'));
}

const lineHeadPanel = (root: FakeElement): FakeElement | undefined =>
  findElement(findClass(root, 'lv-headbar') ?? root, (element) => element.getAttribute('aria-label') === '显示或隐藏右栏');

describe('E3U Main line view', () => {
  it('T-B01 a picked line fills the centre from lines/page and reads lines/read once', async () => {
    await onModule(await lineWorld(), async (page, log) => {
      await waitFor(() => runRows(page.root).length > 0 && bubbles(page.root).length > 0);
      const sections = callsTo(log, 'lines/page').map((call) => (call.input as { section?: unknown }).section);
      expect(sections).toContain('executions');
      expect(sections).toContain('messages');
      expect(bubbleTexts(page.root)).toContain('E3M track message');
      /* The ended Run's word is its status and outcome (`已结束 · 完成`, the Member words).
         READS-10 具名改坏: `member.ts` 的 `runWordOf` 不接结果；这一句红。 */
      expect(textOf(findClass(runRows(page.root)[0]!, 'lv-w'))).toContain('完成');
      /* 具名改坏: `src/ui/boot.ts` 的 `readMain` 再调一次 `readLine`；这一句红。 */
      expect(countRoute(log, 'lines/read')).toBe(1);
    });
  }, 180_000);

  it('T-B07 the sent message’s track shows only the stages it reached', async () => {
    await onModule(await lineWorld(), async (page) => {
      await waitFor(() => trackCells(page.root, 'E3M track message') !== undefined);
      /* This world has no round after the send: the message stays `queued` (stage 0), one cell.
         具名改坏: `src/ui/adapters/main.ts` 的 `lvRecordOf` 把 `stage` 恒写 1（或 2）；这一句红（多出 已送达）。 */
      expect(trackCells(page.root, 'E3M track message')).toEqual(['已排队']);
    });
  }, 180_000);

  it('T-B04 问一问 sends one queries/ask to the picked line, also on a double click', async () => {
    await onModule(await lineWorld(), async (page, log) => {
      click(radio(page.root, '问一问')!);
      await waitFor(() => radio(page.root, '问一问')?.getAttribute('aria-checked') === 'true');
      typeInto(page.root, 'lv-input', '现在做到哪');
      click(lineSend(page.root)!);
      /* M1: the draft stays until the ask is answered (SPEC-9), so the send is off while it is in flight. */
      const inFlight = lineSend(page.root)!.getAttribute('aria-disabled');
      click(lineSend(page.root)!);
      await quietPage(log);
      /* 具名改坏（ruling 7，Main 自己的接线）: `Main.dc.html` 线视图覆盖的 `lv.cm.send` 在 ask 时也调
         `actions.interveneLine`；这一句红（0 次）。
         具名改坏（M1）: 覆盖的 `lv.cm.send` 不看在途键 `lvSending`；这一句红（2 次）。 */
      expect(countRoute(log, 'queries/ask')).toBe(1);
      /* The ask's `sessionRef` (the line's key) and UUID `commandId` are the shared `askLine`'s, held by E3M-3-record's '问一问 sends one queries/ask with a UUID command id' (ruling 7). */
      const input = callsTo(log, 'queries/ask')[0]!.input as Record<string, unknown>;
      expect(input['question']).toBe('现在做到哪');
      /* 具名改坏: 覆盖的 `sendOff` 不并上在途键；这一句红（`false`）。 */
      expect(inFlight).toBe('true');
      /* Once answered the key is cleared: a new draft can be sent.
         具名改坏: `lv.cm.send` 回来后不清 `lvSending`；这一句红（`true`）。 */
      typeInto(page.root, 'lv-input', '再问一句');
      expect(lineSend(page.root)!.getAttribute('aria-disabled')).not.toBe('true');
    });
  }, 180_000);

  it('SPEC-6 before the line read lands the view sends nothing and invents no attempt', async () => {
    const w = await lineWorld();
    const index = await moduleIndex(w);
    await onMain(w.s7c.world, async (page, log) => {
      await waitFor(() => railButton(page.root, index) !== undefined);
      /* Asserted in the click's own turn: `lines/read` has not answered yet. */
      click(railButton(page.root, index)!);
      expect(lvFact(page.root, '尝试')).toBe('—');
      typeInto(page.root, 'lv-input', '读回来之前');
      /* 具名改坏: `Main.dc.html` 的 lineRead 为 null 那一支不覆盖 `lv.cm`；这一句红（发送键亮着）。 */
      expect(lineSend(page.root)!.getAttribute('aria-disabled')).toBe('true');
      click(lineSend(page.root)!);
      expect(bubbleTexts(page.root)).not.toContain('读回来之前');
      await quietPage(log);
      expect(countRoute(log, 'queries/ask')).toBe(0);
    }, S7C);
  }, 180_000);

  it('READS-5 SPEC-17 the line head’s panel button withdraws and restores the right panel’s read', async () => {
    const w = await lineWorld();
    const index = await moduleIndex(w);
    await onMain(w.s7c.world, async (page, log) => {
      click(findElement(auxPanel(page.root)!, (element) => element.getAttribute('aria-label') === '隐藏右栏')!);
      await quietPage(log);
      await openRailLine(page, log, index);
      const reopen = log.calls.length;
      /* 具名改坏: `auxRenderVals` 不覆盖 `out.lv.togglePanel`；下面两句红（不重读，右栏是空树）。 */
      click(lineHeadPanel(page.root)!);
      await quietPage(log);
      expect(routesSince(log, reopen)).toContain('graph/hover');
      expect(treeNames(page.root).filter((name) => name !== '')).not.toEqual([]);
      const hide = log.calls.length;
      click(lineHeadPanel(page.root)!);
      await quietPage(log);
      expect(routesSince(log, hide)).toContain('main/read');
      expect(routesSince(log, hide)).not.toContain('graph/hover');
    }, S7C);
  }, 180_000);

  it('SPEC-4 ruling 15 the rail card names the line’s task; the head draws the line read’s own state, goal, task and duty', async () => {
    const w = await heldWorld();
    const index = await moduleIndex(w);
    await onMain(w.s7c.world, async (page, log) => {
      await waitFor(() => railButton(page.root, index) !== undefined);
      hover(railButton(page.root, index)!);
      /* 具名改坏: `nav.ts` 的 `navLineOf` 回到读 `responsibleNow[0].task`；这一句红（负责是空的）。 */
      expect(dlValue(findClass(page.root, 'lv-card'), '负责')).toBe('任务：Independent work s7c-m1');
      await openRailLine(page, log, index);
      expect(textOf(findClass(findClass(page.root, 'lv-mh')!, 'live'))).toBe('工作中');
      expect(textOf(findClass(findClass(page.root, 'lv-headbar')!, 'head-sub'))).toBe('目标 3 · S7C member world');
      expect([lvFact(page.root, '任务'), lvFact(page.root, '尝试')]).toEqual(['Independent work s7c-m1', '第 1 次尝试']);
      click(lineRowNamed(page.root, '秘书 1')!);
      await quietPage(log);
      /* 具名改坏: `Main.dc.html` 的 `lineRow` 又过一遍 `navLineRow`；这一句红（秘书线的“负责”丢了）。 */
      expect(lvFact(page.root, '负责')).toBe('秘书');
    }, S7C);
  }, 180_000);

  it.each([
    { entry: 'an ended Run', open: lineWorld, head: /^用时 —：运行步骤还没接通/ },
    { entry: 'the running Run', open: heldWorld, head: /^正在执行：运行步骤还没接通$/ },
  ])('SPEC-7 ruling 11 $entry is drawn unconnected and opens no steps', async ({ open, head }) => {
    await onModule(await open(), async (page) => {
      await waitFor(() => runRows(page.root).length > 0);
      const run = runRows(page.root)[0]!;
      /* 具名改坏: `main.ts` 的 `lvRecordOf` 给运行行 `label: ''`；这一句红（“用时 ，步骤 0 · 编辑 0” / “正在执行：第 1 次尝试”）。 */
      expect(textOf(findClass(run, 'lv-rt'))).toMatch(head);
      /* 具名改坏: `Main.dc.html` 的运行行覆盖不给 `runOff`/`runTip`；这一句红。 */
      expect([run.getAttribute('aria-disabled'), run.getAttribute('title')]).toEqual(['true', '还没接通']);
      click(run);
      expect(findClass(lineThread(page.root)!, 'steps')).toBeUndefined();
    });
  }, 180_000);

  it('T-B02 暂停 submits one pause of the running Run with the pins lines/read gives', async () => {
    const w = await heldWorld();
    await onModule(w, async (page, log) => {
      await waitFor(() => lineAct(page.root, '暂停') !== undefined);
      click(lineAct(page.root, '暂停')!);
      /* READS-1 具名改坏: `boot.ts` 的 publish 不给 Main 设 `latestLine`；这一句红（“写入失败。”，没有发出）。 */
      await settledN(log, 'controls/submit', 1);
      const sent = sentWrite(callsTo(log, 'controls/submit')[0]);
      /* 具名改坏（ruling 7，Main 自己的接线）: `Main.dc.html` 线视图覆盖的 `lv.acts.pause` 调
         `actions.controlLine('cancel')`；这一句红。 */
      expect(sent.input).toEqual({ runRef: w.s7c.run.runRef, kind: 'pause', reason: null });
      /* The pins, request id and `committed` are the shared `submitRunControl`'s, held by E3M-2-head's '暂停 submits one pause with the pins lines/read gives' (ruling 7). */
    });
  }, 180_000);

  it('READS-1 a failed reread leaves the control write on the pins of the line still shown', async () => {
    /* The held world after T-B02 (its pause is pending, 取消 stays open), or on its own: so this row cancels. */
    const w = await heldWorld();
    const shown = await controlPins(w.s7c.world, w.module, 'cancel');
    await onModule(w, async (page, log) => {
      /* A write outside the page moves the Run's pins; the stream is held, so the page does not reread. */
      const outside = await w.s7c.world.post('controls/submit', graphWrite(AG2B_SCOPE,
        { runRef: w.s7c.run.runRef, kind: 'cancel', reason: null }, 'e3u-reads1-outside', shown));
      expect((outside.body as { status?: string }).status).toBe('committed');
      /* 架构图 rereads the page: `lines/read` gives the new pins, then `architecture/read` drops on the page side
         and the whole read fails, so the line view still shows the old read (the retry comes 2 s later). */
      const reread = await pickTab(page, log, '架构图');
      expect(routesSince(log, reread)).toContain('lines/read');
      /* The write above went through the patched fetch too, so only the calls after the click are the page's. */
      const clicked = log.calls.length;
      click(lineAct(page.root, '取消')!);
      click(findButton(findElement(page.root, (element) => element.getAttribute('role') === 'alertdialog')!, '取消执行')!);
      await quietPage(log);
      const sent = log.calls.slice(clicked).filter((call) => call.route === 'controls/submit');
      /* 具名改坏: `boot.ts` 的 `readMain` 读到线就设 `latestLine`（这次失败的读也设了）；这一句红（新 pins 下取消已不可用，`[]`）。 */
      expect(sent.map((call) => sentWrite(call).meta.expected)).toEqual([shown]);
    }, { failOnce: 'architecture/read' });
  }, 180_000);

  it('T-B03 重新入队 requeues after the failed Run and the button leaves once the line is not failed', async () => {
    await onHostLine(await w6(), async (page, log) => {
      await waitFor(() => lineAct(page.root, '重新入队') !== undefined);
      click(lineAct(page.root, '重新入队')!);
      await settledN(log, 'tasks/requeue', 1);
      /* The taskRef, afterRunRef, Goal and Run pins and the `requeued` reply are the shared `requeueLine`'s, held by E3M-2-head's '重新入队 sends one tasks/requeue after the fourth Run' (ruling 7). */
      /* 具名改坏（ruling 7，Main 自己的接线）: `Main.dc.html` 线视图覆盖的 `lv.acts` 把 `canRequeue` 恒写 `true`
         （不读 `D.canRequeue`）；这一句红（按钮还在）。 */
      await waitFor(() => lineAct(page.root, '重新入队') === undefined);
    });
  }, 240_000);

  it('SPEC-9 ruling 4 a refused 重新入队 says the refusal’s own reason in the foot', async () => {
    await onMain(hostOf(await budget()), async (page, log) => {
      click(lineRowNamed(page.root, 'Independent work ag2b-work')!);
      await waitFor(() => lineAct(page.root, '重新入队') !== undefined);
      click(lineAct(page.root, '重新入队')!);
      await settledN(log, 'tasks/requeue', 1);
      await quietPage(log);
      const reply = callsTo(log, 'tasks/requeue')[0]!.reply as { status?: string; value?: { kind?: string; refusal?: { reason?: string } } };
      expect([reply.status, reply.value?.kind]).toEqual(['committed', 'refused']);
      /* 具名改坏: `boot.ts` 的 `requeuedOrThrow` 回到 `writeTextOf`；这一句红（“写入失败。”）。
         具名改坏: `Main.dc.html` 的 `lvGuarded` 不接 `.catch(lvFailed)`；这一句红（页脚还是原来那句）。 */
      expect(textOf(lineComposer(page.root, 'to'))).toBe('重新入队被拒绝：' + reply.value!.refusal!.reason);
    }, { mode: 'stream' });
  }, 240_000);

  it('SPEC-5 取消 on a line paused at its safe point opens the confirm and submits one cancel', async () => {
    const w = await paused();
    await onHostLine(w, async (page, log) => {
      await waitFor(() => lineAct(page.root, '取消') !== undefined);
      click(lineAct(page.root, '取消')!);
      const dialog = findElement(page.root, (element) => element.getAttribute('role') === 'alertdialog');
      /* W4's paused Run is still `running` (an applied pause), so the prototype's own confirm opens too; the words are the read's.
         具名改坏: `Main.dc.html` 的 SPEC-5 覆盖不改 `line`（原型的“它会在下一个安全点停下（…）”）；这一句红。 */
      expect(textOf(findClass(dialog ?? page.root, 'dc-line')))
        .toBe('它已停在安全点，取消立即生效：任务记为“已取消”，之后只有你能重新入队；改动和工作记录保留。');
      click(findButton(dialog!, '取消执行')!);
      await settledN(log, 'controls/submit', 1);
      expect(sentWrite(callsTo(log, 'controls/submit')[0]).input).toEqual({ runRef: w.run, kind: 'cancel', reason: null });
    });
  }, 240_000);

  it('T-B05 直接干预 sends one action_request that needs a reply to the picked line', async () => {
    const w = await w1();
    await onLine(w.world, (await lineOrder(posting(w.world))).indexOf(w.work.ref.sessionId), async (page, log) => {
      click(radio(page.root, '直接干预')!);
      await waitFor(() => radio(page.root, '直接干预')?.getAttribute('aria-checked') === 'true');
      typeInto(page.root, 'lv-input', '先停下');
      click(lineSend(page.root)!);
      /* 具名改坏（ruling 7，Main 自己的接线）: `Main.dc.html` 线视图覆盖的 `lv.cm.send` 的 `mode` 不读
         `lvMode`、恒为 'ask'；这一句红（发的是 `queries/ask`）。 */
      await settledN(log, 'messages/send', 1);
      const sent = sentWrite(callsTo(log, 'messages/send')[0]);
      /* The recipient (the line's key), `action_request`, `needsReply`, empty pins and request id are the shared
         `interveneLine`'s, held by E3M-3-record's '直接干预 sends one action_request that needs a reply' (ruling 7). */
      expect(sent.input['text']).toBe('先停下');
    });
  }, 120_000);

  it('T-B06 an archived line opens read-only: 直接干预 disabled, 问一问 open, no control write', async () => {
    await onMain((await w2()).world, async (page, log) => {
      const archived = (): FakeElement | undefined => buttonText(findClass(page.root, 'rail-archived'), '执行者');
      click(findClass(page.root, 'rail-arch')!);
      await waitFor(() => archived() !== undefined);
      click(archived()!);
      await waitFor(() => findClass(page.root, 'lv-headbar') !== undefined && radio(page.root, '直接干预') !== undefined);
      await quietPage(log);
      /* 具名改坏: `src/ui/boards/Main.dc.html` 线视图覆盖的 `actOff: !D.canIntervene || !!lv.cm.actOff` 改成 `actOff: false`；这一句红。 */
      expect(radio(page.root, '直接干预')!.getAttribute('aria-disabled')).toBe('true');
      /* The archive mark itself (MUT-T-B06): 直接干预 above is off by the read's `canIntervene` alone, so only the
         banner shows the line drawn as archived. ruling 16: the archived bucket keeps its own sentence.
         具名改坏: `Main.dc.html` 线视图的 `lineRow` 不按 `D0.readOnly` 写 `state: 'archived'`；这一句红（没有横幅）。
         具名改坏: `Main.dc.html` 的横幅覆盖不看 archived bucket；这一句红。 */
      expect(textOf(findClass(page.root, 'lv-note'))).toMatch(/^已归档：.*超过一天。/);
      const ask = radio(page.root, '问一问')!;
      expect(ask.getAttribute('aria-disabled')).not.toBe('true');
      click(ask);
      await waitFor(() => radio(page.root, '问一问')?.getAttribute('aria-checked') === 'true');
      expect(lineAct(page.root, '暂停')).toBeUndefined();
      expect(countRoute(log, 'controls/submit')).toBe(0);
    });
  }, 120_000);

  it('ruling 16 a done line outside the archived bucket says only 只读：这条线已结束', async () => {
    /* W4's executor finished its Task (`lines/list` own `done`, not read-only, not archived). */
    await onMain((await w4()).world, async (page, log) => {
      click(lineRowNamed(page.root, 'Independent work e3n-w4-work')!);
      await quietPage(log);
      /* 具名改坏: `Main.dc.html` 去掉 ruling 16 的横幅覆盖；这一句红（原型的“工作已结束：…已满足”）。 */
      expect(textOf(findClass(page.root, 'lv-note'))).toBe('只读：这条线已结束');
      /* A37: the ended line's 直接干预 is drawn off, and reads off (the read still gives `intervene` available).
         具名改坏: `Main.dc.html` 线视图覆盖的 `actOff` 去掉 `|| !!lv.cm.actOff`；这一句红（`false`）。 */
      expect(radio(page.root, '直接干预')!.getAttribute('aria-disabled')).toBe('true');
    });
  }, 180_000);
});
