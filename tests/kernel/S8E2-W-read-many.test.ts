/**
 * 8E-2 W 组验收行 E2-34（8E-2 :865）：Kernel 的 `readMany` 两种读法都和 `read` 逐项相同。
 * 入口：冻结公开入口 `WorkspaceSandbox`（vendor/coding-agent/dist/public-api.js，§4.1 :711；
 * 导入同 tests/kernel/K-readonly-sandbox.test.ts:37–41）；`readMany` 的形状照 §2.0 :232–234，W12 :299–308。
 * 世界：提速研究的刁难夹具（.dsh-ref/proto/tmp-sp8e2-readpath-b.ts:18–37），真实临时目录，不 mock；
 * 要 FIFO、`chmod 000`、符号链接，只在 WSL 跑。沙箱选项照原型 :14（输入，不是期望）。
 */
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { WorkspaceSandbox } from '../../vendor/coding-agent/dist/public-api.js';
import { WORKSPACE_DENIED_PREFIXES } from '../../src/core/workspace/denied-prefixes.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await chmod(join(root, 'ws/noread'), 0o755).catch(() => {});
    await chmod(join(root, 'ws/m/unreadable.txt'), 0o644).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

/** 原型 :18–31：普通文件、多层目录、指到外面和 `..` 的链接、受保护前缀、FIFO、二进制、坏 UTF-8、超上限、无读权限。 */
async function hostileWorkspace(): Promise<string> {
  const fx = await mkdtemp(join(tmpdir(), 's8e2-w-read-many-'));
  roots.push(fx);
  const ws = join(fx, 'ws');
  for (const dir of ['dir/sub/deeper', 'noread', '.git', 'hidden-tests', 'other', 'm']) await mkdir(join(ws, dir), { recursive: true });
  await mkdir(join(fx, 'outside')); await writeFile(join(fx, 'outside/secret.txt'), 'outside secret\n');
  const files: [string, string | Uint8Array][] = [
    ['a.txt', 'alpha\n'], ['dir/b.txt', 'beta\n'], ['dir/sub/c.txt', 'gamma\n'], ['dir/sub/deeper/d.txt', 'delta\n'],
    ['dir/ba.txt', 'beta-a\n'], ['other/e.txt', 'eps\n'], ['.git/config', '[core]\n'], ['.env', 'X=1\n'],
    ['hidden-tests/h.txt', 'h\n'], ['bin.dat', Buffer.from([0x41, 0x00, 0x42])],
    ['latin1.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])], ['big.txt', 'x'.repeat(2000)],
    ['noread/f.txt', 'nr\n'], ['m/unreadable.txt', 'u\n'],
  ];
  for (const [path, content] of files) await writeFile(join(ws, path), content);
  await symlink('../outside', join(ws, 'link-dir')); await symlink('dir/b.txt', join(ws, 'link-file.txt'));
  await symlink('..', join(ws, 'dir/link-up')); await symlink(join(fx, 'outside/secret.txt'), join(ws, 'abs-link.txt'));
  await symlink('/etc', join(ws, 'dir/etc')); execFileSync('mkfifo', [join(ws, 'fifo')]);
  await chmod(join(ws, 'noread'), 0o000); await chmod(join(ws, 'm/unreadable.txt'), 0o000);
  return ws;
}

/** 原型 :32–37 的 43 个路径，逐个照抄：含 `..`、绝对路径、反斜杠、空串、NUL、`C:/`、重复、乱序。 */
const CASES = [
  'a.txt', './a.txt', 'dir//b.txt', 'dir/b.txt', 'dir/ba.txt', 'dir/sub/c.txt', 'dir/sub/deeper/d.txt', 'other/e.txt',
  'link-dir/secret.txt', 'link-dir', 'link-file.txt', 'abs-link.txt', 'dir/link-up/a.txt', 'dir/etc/passwd', 'dir/etc',
  '.git/config', '.env', 'hidden-tests/h.txt', 'bin.dat', 'latin1.txt', 'big.txt', 'fifo', 'dir', 'dir/sub',
  'a.txt/x', 'a.txt/x/y', 'missing.txt', 'nodir/x.txt', 'nodir/deeper/x.txt', 'noread/f.txt', 'noread/g/h.txt', 'm/unreadable.txt',
  '../outside/secret.txt', '/etc/passwd', 'a\\b', '', 'dir/../a.txt', 'dir/sub/../../a.txt', 'a\0b', 'C:/x',
  'dir/b.txt', 'link-dir/secret.txt', 'missing.txt',
];

type ReadFile = Awaited<ReturnType<WorkspaceSandbox['read']>>;
type Outcome = { ok: true; file: ReadFile } | { ok: false; error: unknown };
/** 读到的比 path、content、byteLength、revision、mode、identity；失败的比错误的 name、code、message（8E-2 :865）。 */
function shapeOf(outcome: Outcome) {
  if (outcome.ok) {
    const { path, content, byteLength, revision, mode, identity } = outcome.file;
    return { ok: true, file: { path, content, byteLength, revision, mode, identity } };
  }
  const { name, code, message } = outcome.error as { name?: unknown; code?: unknown; message?: unknown };
  return { ok: false, error: { name, code, message } };
}

it('E2-34 readMany via sync and via async gives, item by item, what read gives for 43 hostile paths', async () => {
  const ws = await hostileWorkspace();
  const options = { deniedPrefixes: [...WORKSPACE_DENIED_PREFIXES], maxFileBytes: 32 * 1024 * 1024 };
  const reader = await WorkspaceSandbox.create(ws, options);
  const expected: ReturnType<typeof shapeOf>[] = [];
  for (const path of CASES) {
    try { expected.push(shapeOf({ ok: true, file: await reader.read(path, 1024) })); } catch (error) { expected.push(shapeOf({ ok: false, error })); }
  }
  // 夹具真的造出了 FIFO（F11）：`read('fifo')` 抛 `not_file`（8E-2 :865 改坏一栏）。
  expect(CASES).toHaveLength(43);
  expect(expected[CASES.indexOf('fifo')]).toMatchObject({ ok: false, error: { code: 'not_file' } });
  // 改坏（8E-2 :865；W12 :301）：同步版不调抽出来的检查函数、少判“是不是普通文件”
  // → `via: 'sync'` 那次 `fifo`（下标 21）回读到的空内容，下面逐项比较在 `sync [21] "fifo"` 红。
  for (const via of ['sync', 'async'] as const) {
    const sandbox = await WorkspaceSandbox.create(ws, options);
    const got: Outcome[] = await sandbox.readMany(CASES, 1024, { via });
    expect(got, via).toHaveLength(43);
    for (const [index, item] of got.entries())
      expect(shapeOf(item), `${via} [${index}] ${JSON.stringify(CASES[index])}`).toEqual(expected[index]);
  }
});
