/**
 * E3X — the task map's file rows are keyed by PROJECT path: two workspaces can
 * both hold `src/a.ts` and they are two rows.
 *
 * The adapter is the public pure entry (`adaptTaskMapDetail`); the data is the
 * `graph/detail` summary shape E37-1 uses, with `mainWorkspaceId` and the two
 * actual files' own `workspaceId`s. The second workspace's row keys by the
 * canonical `/@ws:` project path and displays it through `displayProjectPath`.
 *
 * Named mutation (`src/ui/adapters/task-map.ts:794–:795`): `projectPathOf` uses
 * `path` only and drops the workspace, so both files collapse onto one key and
 * the "two rows" assertion goes red.
 */
import { describe, expect, it, vi } from 'vitest';
import { adaptTaskMapDetail, type TaskMapSummaryRead } from '../../src/ui/adapters/task-map.js';
import { bootPage, findButton, findClass } from './helpers/boot-page.js';
import { scene } from './helpers/task-map-scene.js';

const MAIN = 'ws main';
const SECOND = 'ws/2';
const SECOND_SRC = '/@ws:ws%2F2/src';

const summaryOf = (task: Record<string, unknown>): TaskMapSummaryRead => ({
  section: 'summary', workspaceId: MAIN, mainWorkspaceId: MAIN,
  task: { task: { taskId: 't' }, ...task },
}) as unknown as TaskMapSummaryRead;

const catalog = {
  modules: [
    { ref: { moduleId: 'first-mod' }, name: 'first-mod', paths: ['src'] },
    { ref: { moduleId: 'second-mod' }, name: 'second-mod', paths: [SECOND_SRC] },
  ],
  containment: { parentOf: [] },
};

const actual = (entries: unknown[]) => ({ availability: 'available', value: entries });

describe('E3X the task map keys file rows by project path', () => {
  it('gives two rows when two workspaces hold the same relative path', () => {
    const detail = adaptTaskMapDetail(summaryOf({
      actualFiles: actual([
        { path: 'src/a.ts', workspaceId: MAIN, certainty: 'definite' },
        { path: 'src/a.ts', workspaceId: SECOND, certainty: 'definite' },
      ]),
    }), [], null, catalog, 'running', '', null, '', [], null, null);
    expect(detail).not.toBeNull();
    const rows = detail!.files.flatMap((group) => group.files);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.path)).toEqual(['src/a.ts', 'ws/2/src/a.ts']);
  });

  it('keys each workspace’s uncommitted numbers by its own project path', () => {
    // Named mutation (`task-map.ts:901–:933`): key `stateOf` and the lookups by the
    // raw relative path -> the second workspace's file loses its numbers and the
    // summary says the workspace has no uncommitted work.
    const detail = adaptTaskMapDetail(summaryOf({
      actualFiles: actual([
        { path: 'src/a.ts', workspaceId: MAIN, certainty: 'definite' },
        { path: 'src/a.ts', workspaceId: SECOND, certainty: 'definite' },
      ]),
    }), [], null, catalog, 'running', '', null, '', [], null, {
      repository: 'git', files: [
        { path: 'src/a.ts', state: 'clean', lines: null },
        { path: `${SECOND_SRC}/a.ts`, state: 'uncommitted', lines: { added: 2, deleted: 1 } },
      ],
    });
    expect(detail).not.toBeNull();
    const rows = detail!.files.flatMap((group) => group.files);
    expect(rows.find((row) => row.path === 'src/a.ts')?.tag).toBe('实际改过');
    expect(rows.find((row) => row.path === 'ws/2/src/a.ts')?.tag).toBe('实际改过 +2 −1（未提交）');
    expect(detail!.filesNote).toContain('还没提交');
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

type Sent = { scope?: { projectId?: string; workspaceId?: string };
  input?: { workspace?: { projectId?: string; workspaceId?: string }; paths?: unknown } };

/** One TaskMap page on the scene (E37-1's openDetail): the row's Goal is the second workspace and its
 * actual file is `src/a.ts` there; the `files/uncommitted` reply answers only a matching scope. */
async function openSecondWorkspaceDetail(): Promise<{ detail: string; sent: Sent | undefined }> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(scene.now));
  let sent: Sent | undefined;
  let page: Awaited<ReturnType<typeof bootPage>> | undefined;
  try {
    page = await bootPage({
      name: 'TaskMap', search: '?goal=g1', token: 'e3x-task-map-workspace',
      request: async (url, init) => {
        const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
        if (route === 'changes') return new Response('{}', { status: 404 });
        const body = (init?.body === undefined ? {} : JSON.parse(String(init.body))) as Sent;
        let reply: unknown;
        if (route === 'files/uncommitted') {
          sent = body;
          const own = body.scope?.workspaceId === SECOND && body.input?.workspace?.workspaceId === SECOND;
          reply = own
            ? { status: 'ready', value: { repository: 'git', files: [
              { path: 'src/a.ts', state: 'uncommitted', lines: { added: 1, deleted: 2 } }] } }
            : { status: 'rejected', code: 'forbidden', reason: 'e3x scope' };
        } else if (route === 'architecture/read') {
          reply = { status: 'ready', value: { catalog: { catalog: catalog } } };
        } else {
          const read = scene.reply(route, body.input ?? body) as unknown as {
            value?: { task?: Record<string, unknown> } };
          if (route === 'graph/detail' && read.value?.task !== undefined) {
            read.value.task.workspaceId = SECOND;
            read.value.task.actualFiles = actual([{ path: 'src/a.ts', workspaceId: SECOND, certainty: 'definite' }]);
          }
          reply = read;
        }
        return new Response(JSON.stringify(reply), { status: 200 });
      },
    });
    const opened = page;
    await textWith(() => opened.root.textContent, '重新入队与失败类别');
    findButton(opened.root, '重新入队与失败类别')!.dispatch('click');
    const detail = await textWith(() => findClass(opened.root, 'detail')?.textContent ?? '', '实际改过');
    return { detail, sent };
  } finally {
    await page?.restore();
    vi.useRealTimers();
  }
}

describe('E3X the task map asks each row’s own workspace for its uncommitted numbers', () => {
  it('sends the second workspace’s scope and shows its `+1 −2（未提交）`', async () => {
    // Named mutation (`src/ui/boot.ts:467`): post with the board `scope` -> the Host
    // builds ctx from the main workspace, refuses the mismatch, and the second
    // workspace's row loses `+1 −2（未提交）`.
    const seen = await openSecondWorkspaceDetail();
    expect(seen.sent).toMatchObject({
      scope: { workspaceId: SECOND },
      input: { workspace: { workspaceId: SECOND }, paths: ['src/a.ts'] },
    });
    expect(seen.detail).toContain('+1 −2（未提交）');
  });
});
