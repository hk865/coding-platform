import { describe, expect, it, vi } from 'vitest';
import { adaptTaskMapDetail, type TaskMapSummaryRead } from '../../src/ui/adapters/task-map.js';
import { bootPage, findButton, findClass } from './helpers/boot-page.js';
import { scene } from './helpers/task-map-scene.js';

/** E37-U1–U4 (spec §4.4, §5): the count and （未提交） in an actual file's tag, one row
 * per path, the summary's second half (`filesNote`), and the page's `files/uncommitted`
 * read. U1–U3 are the adapter's pure tables (A5); U4 is the page through `bootPage`. */
type File = { path: string; state: string; lines?: { added: number; deleted: number } | null };
type Read = { repository: string; files?: File[] } | null;
const summaryOf = (task: Record<string, unknown>) => ({ section: 'summary', task: { task: { taskId: 't' }, ...task } }) as unknown as TaskMapSummaryRead;
const catalog = { modules: [{ ref: { moduleId: 'app-server' }, name: 'app-server', paths: ['src/app/server'] },
  { ref: { moduleId: 'ui-files' }, name: 'ui-files', paths: ['src/ui'] }], containment: { parentOf: [] } };
const planned = { plannedModules: [{ moduleId: 'app-server' }] };
const IN = 'src/app/server/a.ts';
const OUT = 'src/ui/d.ts';
const B = 'src/app/server/b.ts';
const actual = (entries: unknown[]) => ({ availability: 'available', value: entries });
const git = (files: File[]): Read => ({ repository: 'git', files });
const counted = (path: string, lines: File['lines'] = { added: 2, deleted: 1 }): Read => git([{ path, state: 'uncommitted', lines }]);
const detailOf = (task: Record<string, unknown>, read: Read) =>
  adaptTaskMapDetail(summaryOf(task), [], null, catalog, 'running', '', null, '', [], null, read)!;

describe('E37-U the adapter (spec §4.4)', () => {
  /* Named mutation: 不在计划里 after “）” is also written “ · ” (cells 2 and 5 turn). */
  it.each([
    [1, 'definite', IN, counted(IN), '实际改过 +2 −1（未提交）'],
    [2, 'definite', OUT, counted(OUT), '实际改过 +2 −1（未提交）· 不在计划里'],
    [3, 'possible', IN, counted(IN, { added: 0, deleted: 3 }), '可能改过 +0 −3（未提交）'],
    [4, 'definite', IN, counted(IN, null), '实际改过（未提交）'],
    [5, 'definite', OUT, counted(OUT, null), '实际改过（未提交）· 不在计划里'],
    [6, 'definite', OUT, git([{ path: OUT, state: 'clean' }]), '实际改过 · 不在计划里'],
    [7, 'definite', IN, git([{ path: IN, state: 'unknown' }]), '实际改过'],
    [8, 'definite', IN, null, '实际改过'],
    [9, 'definite', IN, { repository: 'not_git' }, '实际改过'],
    [10, 'definite', IN, git([]), '实际改过'],
  ])('E37-U1 cell %i: a %s file %s', (_, certainty, path, read, tag) => {
    const files = detailOf({ ...planned, actualFiles: actual([{ path, certainty }]) }, read).files;
    expect(files.flatMap((group) => group.files).find((file) => file.path === path)!.tag).toBe(tag);
  });

  /* Named mutations: no dedup (three rows); the first certainty kept (the first row reads possible, 可能改过 …). */
  it('E37-U2 a path several runs recorded is one row, definite if any run is', () => {
    const files = [{ runRef: { runId: 'r1' }, path: IN, certainty: 'possible' }, { runRef: { runId: 'r2' }, path: IN, certainty: 'definite' },
      { runRef: { runId: 'r1' }, path: B, certainty: 'possible' }];
    expect(detailOf({ actualFiles: actual(files) }, counted(IN)).files).toEqual([{ crumb: 'app-server', files: [
      { path: IN, name: 'a.ts', certainty: 'definite', tag: '实际改过 +2 −1（未提交）' },
      { path: B, name: 'b.ts', certainty: 'possible', tag: '可能改过' }] }]);
  });

  /* Named mutations: every read entry clean means 没有 even when one path is missing (the 有一个没读到 row turns);
     unknown taken as clean (the 有一个不知道 row turns). */
  it.each([
    ['有未提交', git([{ path: IN, state: 'uncommitted', lines: { added: 2, deleted: 1 } }, { path: B, state: 'clean' }]), undefined,
      '工作区里还没提交的改动，可能混有别的执行的改动'],
    ['都没有未提交', git([{ path: IN, state: 'clean' }, { path: B, state: 'clean' }]), undefined, '工作区里没有它未提交的改动'],
    ['有一个不知道', git([{ path: IN, state: 'clean' }, { path: B, state: 'unknown' }]), undefined, ''],
    ['有一个没读到', git([{ path: IN, state: 'clean' }]), undefined, ''],
    ['没读', null, undefined, ''],
    ['不是 git', { repository: 'not_git' }, undefined, ''],
    ['没有实际文件', null, { availability: 'unavailable', cause: 'not_recorded', reason: 'e37' }, ''],
  ])('E37-U3 %s', (_, read, actualFiles, note) => {
    const both = actual([IN, B].map((path) => ({ path, certainty: 'definite' })));
    expect(detailOf({ ...planned, actualFiles: actualFiles ?? both }, read).filesNote).toBe(note);
  });

  /* 具名改坏: `filesUnknown` 恒 false；本表第 1、2 行红。 */
  it.each([
    ['记录读不到', { availability: 'unavailable', cause: 'not_recorded', reason: 'e37' }, true],
    ['可能不全且零文件', { availability: 'available', value: [], possiblyIncomplete: true }, true],
    ['已知零文件', { availability: 'available', value: [], possiblyIncomplete: false }, false],
    ['有一个实际文件', actual([{ path: IN, certainty: 'definite' }]), false],
  ])('E37-U5 %s', (_, actualFiles, unknown) => {
    expect(detailOf({ ...planned, actualFiles }, null).filesUnknown).toBe(unknown);
  });
});

/** Bounded polling (F9): the text once it contains `text`, or a throw with the last text read. */
async function textWith(read: () => string, text: string): Promise<string> {
  const start = performance.now();
  for (;;) {
    const now = read();
    if (now.includes(text)) return now;
    if (performance.now() - start > 20_000) throw new Error(`"${text}" not reached in time; last text: ${now}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

type Sent = { scope?: unknown; input?: { paths?: unknown } };

/** One page on the scene (E34-12-supersede.test.ts:221-270): this row's actual files in the summary, a
 * catalog, this row's `files/uncommitted` reply (each body kept, the last one returned); the task opened. */
async function openDetail(files: unknown[], answer: unknown, wait: string): Promise<{ detail: string; sum: string; sent: Sent | undefined }> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(scene.now));
  let sent: Sent | undefined;
  let page: Awaited<ReturnType<typeof bootPage>> | undefined;
  try {
    page = await bootPage({
      name: 'TaskMap', search: '?goal=g1', token: 'e37-1-lines',
      request: async (url, init) => {
        const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
        if (route === 'changes') return new Response('{}', { status: 404 });
        const body = (init?.body === undefined ? {} : JSON.parse(String(init.body))) as Sent & { input?: unknown };
        let reply: unknown;
        if (route === 'files/uncommitted') {
          sent = body;
          reply = answer;
        } else if (route === 'architecture/read') {
          reply = { status: 'ready', value: { catalog: { catalog: {
            modules: [{ ref: { moduleId: 'e37-ui' }, name: '界面', paths: ['src/ui/'] }], containment: { parentOf: [] } } } } };
        } else {
          const read = scene.reply(route, body.input ?? body) as { value?: { task?: Record<string, unknown> } };
          if (route === 'graph/detail' && read.value?.task !== undefined) read.value.task.actualFiles = actual(files);
          reply = read;
        }
        return new Response(JSON.stringify(reply), { status: 200 });
      },
    });
    const opened = page;
    await textWith(() => opened.root.textContent, '重新入队与失败类别');
    findButton(opened.root, '重新入队与失败类别')!.dispatch('click');
    const detail = await textWith(() => findClass(opened.root, 'detail')?.textContent ?? '', wait);
    return { detail, sum: findClass(opened.root, 'd-arch-sum')!.textContent, sent };
  } finally {
    await page?.restore();
    vi.useRealTimers();
  }
}

describe('E37-U4 the page reads files/uncommitted with the detail (spec §4.1, §5)', () => {
  const ui = (name: string, certainty = 'definite', runId = 'r1') => ({ runRef: { runId }, path: 'src/ui/' + name, workspaceId: 'scene', certainty });
  const three = [ui('x.ts'), ui('x.ts', 'definite', 'r2'), ui('y.ts', 'possible')];
  const ready = (files: File[]) => ({ status: 'ready', value: { repository: 'git', files } });
  const name = (i: number): string => 'f' + String(i).padStart(3, '0') + '.ts';

  /* Named mutations: send without dedup (paths has three items); send definite only (y.ts is gone). */
  it('E37-U4a the deduped paths go out with the page scope; the tag and the summary carry the read', async () => {
    const seen = await openDetail(three, ready([{ path: 'src/ui/x.ts', state: 'uncommitted', lines: { added: 2, deleted: 1 } },
      { path: 'src/ui/y.ts', state: 'clean' }]), '（未提交）');
    expect(seen.sent).toEqual({ scope: { projectId: 'ple34b', workspaceId: 'scene' }, input: {
      workspace: { aggregateType: 'Workspace', projectId: 'ple34b', workspaceId: 'scene' }, paths: ['src/ui/x.ts', 'src/ui/y.ts'] } });
    expect(seen.detail).toContain('实际改过 +2 −1（未提交）');
    expect(seen.detail).toContain('可能改过');
    expect(seen.sum).toBe('实际改过／可能改过（现在） · 工作区里还没提交的改动，可能混有别的执行的改动');
  }, 60_000);

  /* Named mutation: a refused read is not caught, so the whole detail read fails (实际改过 never shows; spec §4.1
     "读失败（任何拒绝或异常）就当没读到"). Green at the base: the base never sends this request. */
  it('E37-U4b a refused read leaves the tags without counts and the summary at （现在）', async () => {
    const seen = await openDetail(three, { status: 'rejected', code: 'unavailable', reason: 'e37' }, '实际改过');
    expect(seen.detail).toContain('实际改过');
    expect(seen.detail).not.toContain('（未提交）');
    expect(seen.sum).toBe('实际改过／可能改过（现在）');
  }, 60_000);

  /* Named mutation: no cut at 100 (the Host would refuse 101; the page's request body is asserted here). */
  it('E37-U4c only the first 100 paths are sent', async () => {
    const seen = await openDetail(Array.from({ length: 101 }, (_, i) => ui(name(i))), ready([]), '实际改过');
    expect(seen.sent?.input?.paths).toEqual(Array.from({ length: 100 }, (_, i) => 'src/ui/' + name(i)));
  }, 60_000);

});
