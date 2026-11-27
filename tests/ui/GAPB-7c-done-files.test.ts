import { afterEach, describe, expect, it } from 'vitest';
import { findClass } from './helpers/boot-page.js';
import {
  auxFileRows, auxRowName, auxTab, countRoute, descendants, hasClass, onBoard, openAuxFile, quietPage, textOf, waitFor,
} from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { openDoneDeliveryWorld } from './helpers/E3DN-done-world.js';
import { card, cardButton, labelled, typeInto } from './helpers/E3D-page.js';
import { buttonText, callsOf, worldSlot } from './helpers/E3M-world.js';
import { composerNote } from './helpers/GAPB-quote.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * GAPB-7c (goal card B, B7c): the delivery page's 文件 tab and file page read
 * the world's real `files/list`/`files/read` (the world's own git work tree,
 * `openDoneDeliveryWorld` + `DONE_BASELINE`), and 引用到草稿 rides on 问秘书 as
 * `requests/submit`'s `references`. 有问题 is `messages/send`, whose input has no
 * reference field: the quote stays in the draft and the footnote says so.
 *
 * Red today on `7dg245t-base`: 5c draws the 文件 tab and the "+ 文件" entry
 * `is-off`/`还没接通` with a no-op `pick`, `dataVals` empties `ax.quotes` and the
 * quote note, and 问秘书 calls `askSecretary(text, null)`. So clicking 文件
 * sends no `files/list`, no file page opens, and no reference reaches a send.
 * Astra's B7c maps the tab onto `axFileItem`/`axView`, stops clearing `quotes`,
 * passes the quotes to `askSecretary(text, refs)`, and keeps them (with the one
 * sentence) across 有问题; then these rows go green.
 */

const SENTENCE = '引用没有随这次发出（这一种发送不带引用），还在草稿里。';

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);

/** This row's delivery world with one secretary (问秘书 and 有问题 are live then). */
const withSecretary = () => slot.use('g5-done', async () => {
  const done = await openDoneDeliveryWorld();
  await done.world.createSecretary('g5-done-secretary');
  return done;
}, (done) => done.close());

/** The open file page's line-number buttons. */
const lineNumbers = (root: FakeElement): FakeElement[] => {
  const code = findClass(root, 'fcode');
  return code === undefined ? [] : descendants(code).filter((element) => hasClass(element, 'fl-n'));
};

describe('GAPB-7c the delivery page 文件 tab and references', () => {
  it('G5c-1 点文件：一次 files/list，树是真实路径', async () => {
    /* 今天红在 `tests/ui/GAPB-7c-done-files.test.ts:58`（一次 `files/list` 断言）：5c 的“文件”页签
       还是 `is-off`/`还没接通`，点击不发读；Astra 落地后页签接通、读一次并画出真实路径，转绿。 */
    const done = await withSecretary();
    await onBoard('Done', done.world, async (page, log) => {
      const from = log.calls.length;
      click(auxTab(page.root, '文件')!);
      await quietPage(log);
      /* 具名改坏: `Done.dc.html` 的 `dataVals` 仍给 files 页签 `pick: this.noop`（或 `axRead('files')` 不调）；
         一次 `files/list` 与下面的树都红。 */
      expect(callsOf(log, 'files/list', from)).toHaveLength(1);
      await waitFor(() => auxFileRows(page.root).length > 0);
      const names = auxFileRows(page.root).map(auxRowName);
      /* The baseline commit's real folders/files (DONE_BASELINE + the fixture root); no sample page. */
      expect(names).toEqual(expect.arrayContaining(['docs', 'src', 'tsconfig.json']));
      expect(names).not.toContain('views.ts');
    }, { search: '?goal=' + done.goal.goalId });
  }, 180_000);

  it('G5c-2 打开一个文件、引用两行、问秘书：requests/submit 的 references 是这路径和这两行', async () => {
    /* 今天红在 `tests/ui/GAPB-7c-done-files.test.ts:73`（“文件”页签的 `is-off` 断言）：页签没接通，
       文件页和引用都到不了；Astra 落地后 `files/read`、两行引用和 `references` 都对上，转绿。 */
    const done = await withSecretary();
    await onBoard('Done', done.world, async (page, log) => {
      const tab = auxTab(page.root, '文件')!;
      expect(hasClass(tab, 'is-off')).toBe(false);
      expect(tab.getAttribute('aria-disabled')).not.toBe('true');
      const from = log.calls.length;
      await openAuxFile(page, log, 'src/a.ts');
      const reads = callsOf(log, 'files/read', from);
      /* 具名改坏: `Done.dc.html` 的 `axOpenFile` 在 data 模式下不调 `axRead('f:'+path)`；本行红。 */
      expect(reads).toHaveLength(1);
      expect((reads[0]!.input as { path?: unknown }).path).toBe('src/a.ts');

      click(lineNumbers(page.root).find((element) => textOf(element) === '2')!);
      click(lineNumbers(page.root).find((element) => textOf(element) === '3')!, { shiftKey: true });
      click(buttonText(findClass(page.root, 'fp-bar'), '引用到草稿')!);
      /* The delivery card keeps the composer closed, so the file bar states the quote is held. */
      await waitFor(() => textOf(findClass(page.root, 'fp-bar')).includes('已引用到草稿（1 条）'));

      await waitFor(() => card(page.root) !== undefined);
      click(cardButton(page.root, '问秘书')!);
      await waitFor(() => findClass(page.root, 'composer-quote') !== undefined);
      expect(textOf(findClass(findClass(page.root, 'composer-quote')!, 'cq-lines'))).toBe('第 2–3 行');
      typeInto(page.root, 'composer-input', '这两个文件对不对');
      click(labelled(page.root, '发送')!);
      await waitFor(() => callsOf(log, 'requests/submit').some((call) => call.reply !== undefined));
      await quietPage(log);
      const submits = callsOf(log, 'requests/submit');
      expect(submits).toHaveLength(1);
      const input = submits[0]!.input as Record<string, unknown>;
      expect(input['text']).toBe('这两个文件对不对');
      /* 具名改坏: 问秘书仍 `A.askSecretary(text, null)`；`references` 这一句红。 */
      expect(input['references']).toEqual([{ path: 'src/a.ts', startLine: 2, endLine: 3, snapshot: null }]);
    }, { search: '?goal=' + done.goal.goalId });
  }, 180_000);

  it('G5c-3 有引用时点有问题：messages/send 一次，引用还在草稿，脚注是那句话', async () => {
    /* 今天红在 `tests/ui/GAPB-7c-done-files.test.ts:111`（“文件”页签的 `is-off` 断言）：页签没接通，
       草稿里没有引用；Astra 落地后 `messages/send` 一次、引用和脚注仍留着，转绿。 */
    const done = await withSecretary();
    await onBoard('Done', done.world, async (page, log) => {
      const tab = auxTab(page.root, '文件')!;
      expect(hasClass(tab, 'is-off')).toBe(false);
      expect(tab.getAttribute('aria-disabled')).not.toBe('true');
      await openAuxFile(page, log, 'src/a.ts');
      click(lineNumbers(page.root).find((element) => textOf(element) === '2')!);
      click(lineNumbers(page.root).find((element) => textOf(element) === '3')!, { shiftKey: true });
      click(buttonText(findClass(page.root, 'fp-bar'), '引用到草稿')!);
      await waitFor(() => textOf(findClass(page.root, 'fp-bar')).includes('已引用到草稿（1 条）'));

      await waitFor(() => card(page.root) !== undefined);
      click(cardButton(page.root, '有问题')!);
      await waitFor(() => findClass(page.root, 'composer-ref') !== undefined);
      await waitFor(() => findClass(page.root, 'composer-quote') !== undefined);
      typeInto(page.root, 'composer-input', '改动漏了 README');
      click(labelled(page.root, '发送')!);
      /* The card's §7③ requires the sentence after the send: B7c must keep the
         composer (or an equivalent footnote) rendered after `messages/send`
         succeeds; `.composer-foot .to` is the one public DOM read of it
         (`GAPB-quote.ts:14`). */
      await waitFor(() => callsOf(log, 'messages/send').some((call) => call.reply !== undefined));
      await waitFor(() => composerNote(page) === SENTENCE);
      await quietPage(log);
      const sends = callsOf(log, 'messages/send');
      expect(sends).toHaveLength(1);
      expect((sends[0]!.input as { text?: unknown }).text).toBe('改动漏了 README');
      /* 具名改坏: `dataVals` 仍清 `out.ax.quotes`（或“有问题”成功后清 `quotes`）；引用条和脚注两句先红。 */
      expect(findClass(page.root, 'composer-quote')).toBeDefined();
      expect(textOf(findClass(findClass(page.root, 'composer-quote')!, 'cq-path'))).toBe('src/a.ts');
      expect(countRoute(log, 'requests/submit')).toBe(0);
    }, { search: '?goal=' + done.goal.goalId });
  }, 180_000);
});
