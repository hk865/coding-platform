import { afterEach, describe, expect, it } from 'vitest';
import {
  bodyRows, bootDone, openDoneDeliveryWorld, openRow, openSection, rowMain, sectionBody, sectionSum,
} from './helpers/E3DN-done-world.js';
import type { FakeElement } from './helpers/dom.js';
import { findClass } from './helpers/boot-page.js';
import { settle, worldSlot } from './helpers/E3M-world.js';
import { notConnected } from './helpers/E3N-interact.js';
import { descendants, hasClass, textOf } from './helpers/E3N-page.js';

/**
 * E3DN-3 D07–D08 (test sheet §2.3): 改动的文件 lists `architecture/change-scope`'s
 * files grouped by `moduleRef` (the S6A catalog: `s6a-core` = `src`,
 * `s6a-ui` = `src/ui`, `docs/x.md` unowned), the line counts of
 * `files/uncommitted` against the world's baseline commit, and each file's
 * tasks from `graph/detail`'s actual files. Hand counts (sheet §1.2 step 3):
 * `src/a.ts` a1 a2 a3 → a1 a2b a3 a4 a5 is +3 −1; `src/ui/x.ts` and
 * `docs/x.md` each +1 −0. `done-a`'s Plan also names `src/planned-only.ts`,
 * which no Run changes. D08c (READS-8): after D10's chain the person's plan
 * change supersedes `done-b`, whose Runs changed `src/a.ts`; it stays under
 * that file, drawn cancelled.
 */

const slot = worldSlot();
afterEach(async () => { await slot.close(); }, 180_000);

const FILES = '改动的文件';
const mainWorld = () => slot.use('main', () => openDoneDeliveryWorld(), (done) => done.close());

type FileRow = { path: string; module: string; add: string; del: string; row: FakeElement };

/** Open every module row and read its file rows; a row's path is the adapter's full `rel`. */
async function fileRows(root: FakeElement): Promise<FileRow[]> {
  const body = await openSection(root, FILES);
  const found: FileRow[] = [];
  for (const module of bodyRows(body)) {
    const name = rowMain(module);
    const files = await openRow(root, module, 'dv-files', name);
    for (const row of descendants(files ?? root).filter((element) => element.tagName.toLowerCase() === 'button'
      && findClass(element, 'dv-fname') !== undefined)) {
      const path = textOf(findClass(row, 'dv-fname'));
      found.push({ path, module: name, add: textOf(findClass(row, 'add')), del: textOf(findClass(row, 'del')), row });
    }
  }
  return found;
}

describe('E3DN-3 改动的文件', () => {
  it('D07 the change-scope files, once each, by module, with the working-tree counts', async () => {
    const done = await mainWorld();
    const { page } = await bootDone(done.world, done.goal.goalId);
    try {
      await settle(() => sectionSum(page.root, FILES) !== '', 10_000);
      const rows = await fileRows(page.root);
      /* 具名改坏: 用 `plannedFiles` 建清单；本行多出 `src/planned-only.ts`，红。 */
      expect(rows.map((row) => row.path).sort()).toEqual(['docs/x.md', 'src/a.ts', 'src/ui/x.ts']);
      /* 具名改坏: 按路径前两段自己分组；本行的模块组名红。 */
      expect(Object.fromEntries(rows.map((row) => [row.path, row.module]))).toEqual({
        'src/a.ts': 's6a-core', 'src/ui/x.ts': 's6a-ui', 'docs/x.md': '未归属模块',
      });
      expect(Object.fromEntries(rows.map((row) => [row.path, `${row.add} ${row.del}`]))).toEqual({
        'src/a.ts': '+3 −1', 'src/ui/x.ts': '+1 −0', 'docs/x.md': '+1 −0',
      });
      expect(textOf(sectionBody(page.root, FILES))).toContain('对照工作区，不是交付基线');
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('D08b a rework Run changing the same file names each task once', async () => {
    const done = await slot.use('same-file-rework', () => openDoneDeliveryWorld({ sameFileRework: true }),
      (world) => world.close());
    const { page } = await bootDone(done.world, done.goal.goalId);
    try {
      await settle(() => sectionSum(page.root, FILES) !== '', 10_000);
      const rows = await fileRows(page.root);
      /* 具名改坏: `taskFiles` 不按路径去重（boot.ts 的 taskFiles 保留每个 Run 的记录）；改动它的
         任务里 `done-b` 出现两次，:83 的任务列表红；:78 数的是 change-scope 的行，是 D07 的
         规则，不受这次改坏影响。 */
      expect(rows.filter((row) => row.path === 'src/a.ts')).toHaveLength(1);
      const shared = rows.find((row) => row.path === 'src/a.ts');
      const more = await openRow(page.root, shared?.row, 'dv-fmore', 'src/a.ts');
      const tasks = descendants(more ?? page.root).filter((element) => element.tagName.toLowerCase() === 'button'
        && hasClass(element, 'd-item'));
      expect(tasks.map((task) => textOf(task)).sort()).toEqual(['PL stage 1 done-a', 'PL stage 1 done-b']);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('D08 a file row names the tasks that changed it; a task name is unconnected', async () => {
    const done = await mainWorld();
    const { page, log } = await bootDone(done.world, done.goal.goalId);
    try {
      await settle(() => sectionSum(page.root, FILES) !== '', 10_000);
      const shared = (await fileRows(page.root)).find((row) => row.path === 'src/a.ts');
      const more = await openRow(page.root, shared?.row, 'dv-fmore', 'src/a.ts');
      const tasks = descendants(more ?? page.root).filter((element) => element.tagName.toLowerCase() === 'button'
        && hasClass(element, 'd-item'));
      expect(tasks.map((task) => textOf(task)).sort()).toEqual(['PL stage 1 done-a', 'PL stage 1 done-b']);
      const before = log.calls.length;
      /* 具名改坏: 任务名点击发 `tasks/query`/`graph/detail`；本行的未接通三样/零请求红。 */
      notConnected(tasks[0]!);
      expect(log.calls.length).toBe(before);
      /* N23 stays in place, drawn 还没接通 (§2.6/§2.11); 具名改坏: `inArch: false` hides it — this line is red. */
      const arch = descendants(more ?? page.root).find((element) => element.tagName.toLowerCase() === 'button'
        && textOf(element) === '在架构图里看');
      expect(arch, 'N23 在架构图里看').toBeDefined();
      expect(hasClass(arch!, 'btn-text')).toBe(true);
      notConnected(arch!);
      expect(log.calls.length).toBe(before);
    } finally {
      await page.restore();
    }
  }, 180_000);

  it('D08c a superseded task stays under the file it changed, its square cancelled', async () => {
    const done = await slot.use('superseded', () => openDoneDeliveryWorld({ humanRework: true, supersedeB: true }),
      (world) => world.close());
    const { page } = await bootDone(done.world, done.goal.goalId);
    try {
      await settle(() => sectionSum(page.root, FILES) !== '', 10_000);
      const shared = (await fileRows(page.root)).find((row) => row.path === 'src/a.ts');
      const more = await openRow(page.root, shared?.row, 'dv-fmore', 'src/a.ts');
      const taskB = descendants(more ?? page.root).find((element) => element.tagName.toLowerCase() === 'button'
        && hasClass(element, 'd-item') && textOf(element) === 'PL stage 1 done-b');
      expect(taskB, 'done-b under src/a.ts').toBeDefined();
      const square = descendants(taskB!).find((element) => hasClass(element, 'sq'));
      /* 具名改坏: done.ts 文件行的 `?? 'cancelled'` 改成 `?? 'pending'`；done-b 画成 s-notyet，本行红。 */
      expect(square?.getAttribute('class')).toMatch(/\bs-cancelled\b/);
    } finally {
      await page.restore();
    }
  }, 180_000);
});
