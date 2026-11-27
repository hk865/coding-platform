import { afterAll, describe, expect, it } from 'vitest';
import { findClass } from './helpers/boot-page.js';
import {
  auxFileRows, auxRowName, auxTab, countRoute, descendants, hasClass, onBoard, openAuxFile, quietPage, textOf, waitFor,
} from './helpers/E3N-page.js';
import { click } from './helpers/E3N-interact.js';
import { openWGit } from './helpers/E3N-world.js';
import { openOldAnswerWorld } from './helpers/E3D-world.js';
import { card, cardButton, labelled, typeInto } from './helpers/E3D-page.js';
import { buttonText, callsOf } from './helpers/E3M-world.js';
import { composerNote } from './helpers/GAPB-quote.js';
import type { FakeElement } from './helpers/dom.js';

/**
 * GAPB-7b (goal card B, B7b): the Plan page's 文件 tab and file page read the
 * world's real `files/list`/`files/read`, and 引用到草稿 rides on an ordinary
 * send as `requests/submit`'s `references`. Asking a card is `requests/ask`,
 * which takes no reference: the quote stays in the draft and the composer's
 * footnote says so.
 *
 * Red today on `7dg245t-base`: 5b draws the 文件 tab and the "+ 文件" entry
 * `is-off`/`还没接通` with a no-op `pick`, `planBoardVals` still empties
 * `ax.quotes`, and `sendPlan` passes `[]`/`null` to `askSecretary`. So clicking
 * 文件 sends no `files/list`, no file page opens, and no reference reaches a
 * send. Astra's B7b maps the tab onto `axFileItem`/`axView`, stops clearing
 * `quotes`, and passes the quotes to `askSecretary(text, refs)` (only the sends
 * that take references); then these rows go green.
 *
 * Spec vs tree: `auxFileListOf` (`src/ui/adapters/aux-panel.ts:210`) sorts
 * folders before files, so WG's first drawn row is `src/`, not README.md; the
 * literal "tree's first item = README.md" cannot hold without changing that
 * shared adapter (outside B7b's white list). The rows use the closest reading:
 * README.md is the listing's first path and the tree's first *file* row.
 */

const SENTENCE = '引用没有随这次发出（这一种发送不带引用），还在草稿里。';

const wgit = await openWGit();
const old = await openOldAnswerWorld();
afterAll(async () => {
  await wgit.world.close().catch(() => undefined);
  await old.world.close().catch(() => undefined);
});

describe('GAPB-7b the Plan page 文件 tab and references', () => {
  it('G5b-1 点文件：一次 files/list，第一个文件行是 README.md', async () => {
    /* 今天红在 `tests/ui/GAPB-7b-plan-files.test.ts:55`（一次 `files/list` 断言）：5b 的文件页签
       还是 `is-off`/`还没接通`，点击不发读；Astra 落地后页签接通、读一次并画出真实树，转绿。 */
    await onBoard('Plan', wgit.world, async (page, log) => {
      const from = log.calls.length;
      click(auxTab(page.root, '文件')!);
      await quietPage(log);
      /* 具名改坏: `Plan.dc.html` 的 `auxRenderVals` 仍给 files 页签 `pick: ncGo`（或 `axRead('files')` 不调）；
         一次 `files/list` 与下面的树都红。 */
      expect(callsOf(log, 'files/list', from)).toHaveLength(1);
      await waitFor(() => auxFileRows(page.root).length > 0);
      /* `auxFileListOf` sorts folders before files (`src/ui/adapters/aux-panel.ts:210`),
         so `src/` is the first drawn row; README.md is the listing's first path
         and therefore the first file row. */
      const files = auxFileRows(page.root).filter((row) => findClass(row, 'fsp') !== undefined);
      expect(files.map(auxRowName)[0]).toBe('README.md');
    });
  }, 180_000);

  it('G5b-2 打开 src/module.ts、选两行、普通发送：references 是这路径和这两行', async () => {
    /* 今天红在 `tests/ui/GAPB-7b-plan-files.test.ts:70`（文件页签的 `is-off` 断言）：页签没接通，
       文件页和引用都到不了；Astra 落地后 `files/read`、两行引用和 `references` 都对上，转绿。 */
    await onBoard('Plan', wgit.world, async (page, log) => {
      const tab = auxTab(page.root, '文件')!;
      expect(hasClass(tab, 'is-off')).toBe(false);
      expect(tab.getAttribute('aria-disabled')).not.toBe('true');
      const from = log.calls.length;
      await openAuxFile(page, log, 'src/module.ts');
      const reads = callsOf(log, 'files/read', from);
      /* 具名改坏: `Plan.dc.html` 的 `axOpenFile` 在 data 模式下不调 `axRead('f:'+path)`；本行红。 */
      expect(reads).toHaveLength(1);
      expect((reads[0]!.input as { path?: unknown }).path).toBe('src/module.ts');

      const code = findClass(page.root, 'fcode')!;
      const lineNo = (n: number): FakeElement | undefined => descendants(code)
        .find((element) => hasClass(element, 'fl-n') && textOf(element) === String(n));
      click(lineNo(2)!);
      click(lineNo(3)!, { shiftKey: true });
      click(buttonText(findClass(page.root, 'fp-bar'), '引用到草稿')!);
      await waitFor(() => findClass(page.root, 'composer-quote') !== undefined);
      expect(textOf(findClass(findClass(page.root, 'composer-quote')!, 'cq-lines'))).toBe('第 2–3 行');
      typeInto(page.root, 'plan-input', '看这里');
      click(labelled(page.root, '发送')!);
      await waitFor(() => callsOf(log, 'requests/submit').some((call) => call.reply !== undefined));
      await quietPage(log);
      const submits = callsOf(log, 'requests/submit');
      expect(submits).toHaveLength(1);
      const input = submits[0]!.input as Record<string, unknown>;
      expect(input['text']).toBe('看这里');
      /* 具名改坏: `sendPlan` 的普通发送仍 `askSecretary(text, [])`；`references` 这一句红。 */
      expect(input['references']).toEqual([{ path: 'src/module.ts', startLine: 2, endLine: 3, snapshot: null }]);
    });
  }, 180_000);

  it('G5b-3 有引用时问卡：requests/ask 不带 references，引用还在草稿，脚注是那句话', async () => {
    /* 今天红在 `tests/ui/GAPB-7b-plan-files.test.ts:105`（文件页签的 `is-off` 断言）：页签没接通，
       草稿里没有引用；Astra 落地后 `requests/ask` 不带引用、引用和脚注仍留着，转绿。 */
    await onBoard('Plan', old.world, async (page, log) => {
      const tab = auxTab(page.root, '文件')!;
      expect(hasClass(tab, 'is-off')).toBe(false);
      expect(tab.getAttribute('aria-disabled')).not.toBe('true');
      await openAuxFile(page, log, 'src/module.ts');
      const code = findClass(page.root, 'fcode')!;
      click(descendants(code).find((element) => hasClass(element, 'fl-n'))!);
      click(buttonText(findClass(page.root, 'fp-bar'), '引用到草稿')!);
      await waitFor(() => findClass(page.root, 'composer-quote') !== undefined);

      /* Still the Plan page: `.gb-decide` opens its own bottom card, whose
         问秘书 sets `askCardKey` (planDecisionVals.ask); the same page's
         `sendPlan` sends that through `actions.askCard` (`Plan.dc.html:6141-6142`)
         — the `requests/ask` path, not another board. `openOldAnswerWorld` is
         the existing world that already carries this candidate card (E3U T-A09);
         WG has no card at all, so it cannot reach this path. */
      await waitFor(() => findClass(page.root, 'gb-decide') !== undefined);
      click(findClass(page.root, 'gb-decide')!);
      await waitFor(() => card(page.root) !== undefined);
      click(cardButton(page.root, '问秘书')!);
      await waitFor(() => labelled(page.root, '发送') !== undefined);
      typeInto(page.root, 'plan-input', '这张卡怎么处理');
      click(labelled(page.root, '发送')!);
      await waitFor(() => callsOf(log, 'requests/ask').some((call) => call.reply !== undefined));
      await waitFor(() => composerNote(page) === SENTENCE);
      await quietPage(log);
      const asks = callsOf(log, 'requests/ask');
      expect(asks).toHaveLength(1);
      expect('references' in (asks[0]!.input as Record<string, unknown>)).toBe(false);
      /* 具名改坏: `sendPlan` 的 `askCard` 分支成功后照旧清 `quotes`（`planBoardVals` 也清 `ax.quotes`）；
         引用条和脚注两句先红。 */
      expect(findClass(page.root, 'composer-quote')).toBeDefined();
      expect(textOf(findClass(findClass(page.root, 'composer-quote')!, 'cq-path'))).toBe('src/module.ts');
      expect(countRoute(log, 'requests/submit')).toBe(0);
    });
  }, 180_000);
});
