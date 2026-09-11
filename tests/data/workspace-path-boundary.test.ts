/**
 * RC-02 WorkspaceReader — 工作区**路径边界**的唯一权威，以及归位后的「角色源码索引」读取。
 *
 * 覆盖两件在这一票里被定死的事：
 *   1. 拒绝前缀只有 `denied-prefixes.ts` 一份，值是内核默认值 + 平台追加的并集（逐字核对）；
 *   2. 归位到 WorkspaceReader 的 `WorkspaceSourceIndexReader` 真的把这份边界用在**真实的内核工作区**
 *      上：没有 `read` 一个路径都不返回，拒绝前缀下的路径连列目录都不出现，正文只取调用方声明的前缀
 *      且超限如实说明。
 */
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WORKSPACE_DENIED_PREFIXES } from '../../src/data/workspace-reader/denied-prefixes.js';
import { WorkspaceSourceIndexReader } from '../../src/data/workspace-reader/role-source-reader.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

/** 造一个同时含"可读源码"与"各类拒绝前缀目录"的工作区。 */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rc02-boundary-')); roots.push(root);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'hello.ts'), 'export const hello = (): string => "rc02";\n');
  await writeFile(join(root, 'src', 'second.ts'), 'export const second = 2;\n');
  await writeFile(join(root, 'src', 'third.ts'), 'export const third = 3;\n');
  await writeFile(join(root, 'README.md'), 'local source\n');
  // 平台拒绝前缀下的内容：它们必须连"出现在索引里"都不可以。
  await writeFile(join(root, '.env'), 'TOKEN=secret\n');
  await writeFile(join(root, '.env.local'), 'TOKEN=secret-local\n');
  await mkdir(join(root, '.git'), { recursive: true });
  await writeFile(join(root, '.git', 'config'), '[core]\n');
  await mkdir(join(root, '.platform-runtime'), { recursive: true });
  await writeFile(join(root, '.platform-runtime', 'run.lock'), 'locked\n');
  await mkdir(join(root, '.oracle'), { recursive: true });
  await writeFile(join(root, '.oracle', 'answer.txt'), 'must not leak\n');
  await mkdir(join(root, '.evaluator'), { recursive: true });
  await writeFile(join(root, '.evaluator', 'grade.txt'), 'must not leak\n');
  await mkdir(join(root, 'hidden-tests'), { recursive: true });
  await writeFile(join(root, 'hidden-tests', 'hidden.test.ts'), 'export const hidden = true;\n');
  return root;
}

const request = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1 as const,
  projectId: 'p1',
  workspaceId: 'ws1',
  declaredTools: ['read'],
  workspaceRevision: 3,
  maxEntries: 100,
  maxExcerptFiles: 1,
  maxExcerptBytes: 4096,
  pathPrefix: 'src',
  ...overrides,
});

it('拒绝前缀的唯一来源是内核默认值 + 平台追加，二者都逐字保留', () => {
  // 内核（vendor/coding-agent 的 WorkspaceSandbox）在调用方不传 deniedPrefixes 时用的三项；
  // 平台在此之上追加 .git／.env／.env.local／.platform-runtime。顺序不参与语义（内核会排序）。
  expect([...WORKSPACE_DENIED_PREFIXES].sort()).toEqual(
    ['.evaluator', '.oracle', 'hidden-tests', '.git', '.env', '.env.local', '.platform-runtime'].sort(),
  );
});

it('没有 read 工具就不读取：一个路径都不返回（端口不授权，也不放宽）', async () => {
  const root = await fixture();
  const reader = new WorkspaceSourceIndexReader({ rootFor: () => root });
  const result = await reader.readSourceIndex(request({ declaredTools: ['write'] }) as never);
  expect(result).toMatchObject({ status: 'forbidden' });
  expect(JSON.stringify(result)).not.toContain('hello.ts');
});

it('有界索引不含任何拒绝前缀下的路径，正文只取调用方声明的模块前缀', async () => {
  const root = await fixture();
  const reader = new WorkspaceSourceIndexReader({ rootFor: () => root });
  const result = await reader.readSourceIndex(request() as never);
  expect(result.status).toBe('sourced');
  if (result.status !== 'sourced') return;
  const paths = result.entries.map((entry) => entry.path);
  expect(paths).toContain('src/hello.ts');
  expect(paths).toContain('README.md');
  for (const denied of ['.env', '.env.local', '.git/config', '.platform-runtime/run.lock', '.oracle/answer.txt', '.evaluator/grade.txt', 'hidden-tests/hidden.test.ts']) {
    expect(paths, denied).not.toContain(denied);
  }
  expect(JSON.stringify(result)).not.toContain('must not leak');
  expect(result.truncated).toBe(false);
  // 正文只取前缀下的文件，且逐个带内核给出的内容 revision。
  expect(result.excerpts.map((excerpt) => excerpt.path)).toEqual(['src/hello.ts']);
  expect(result.excerpts[0]!.revision.length).toBeGreaterThan(0);
  expect(result.excerpts[0]!.content).toContain('rc02');
  // 前缀下还有 2 个文件没取：这是上限事实，必须如实说出来（不静默裁剪）。
  expect(result.excerptNotes.join('\n')).toContain('正文只取前 1 个');
});

it('上限造成的未取全如实记在 excerptNotes 里，索引本身仍然是有界清单', async () => {
  const root = await fixture();
  const reader = new WorkspaceSourceIndexReader({ rootFor: () => root });
  const result = await reader.readSourceIndex(request({ maxEntries: 2, pathPrefix: undefined }) as never);
  expect(result.status).toBe('sourced');
  if (result.status !== 'sourced') return;
  expect(result.entryCount).toBeLessThanOrEqual(2);
  expect(result.truncated).toBe(true);
  expect(result.excerptNotes.join('\n')).toContain('索引清单达到上限 2 条');
  expect(result.excerpts).toEqual([]);
});
