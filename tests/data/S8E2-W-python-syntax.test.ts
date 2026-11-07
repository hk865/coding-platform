/**
 * W 行 1–2：Python 语法错误是一个独立状态；单文件查只解析、不执行。
 * 入口：W 的公开单文件查 `createNativeSingleFile({ readWorkspaceFiles })`（native-single-file.ts:105，
 * `lookup` 在 :36），用真实默认 python3、不注入 sourceAnalyzers；世界是 workspaceToolsFixture 的真实临时根。
 * 没有 Host、没有记录库：两行都只经 `lookup` 和文件系统的读。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import { createNativeSingleFile } from '../../src/core/workspace/native-single-file.js';
import { workspaceToolsFixture } from '../helpers/workspace-tools-fixture.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const fixture = workspaceToolsFixture({
  projectId: 's8e2-w-python', actorId: 's8e2-w-python-reader', permissionRevision: 's8e2-w-python-policy-v1',
  tempPrefix: 's8e2-w-python-', cleanups,
});

/** 一个根、一个端口；`lookup` 每次给要查的文字（ASCII 文件，原始字节和解码文字的 sha256 相同）。 */
async function pythonWorld(files: [string, string][]) {
  const c = await fixture(files);
  const port = createNativeSingleFile({ readWorkspaceFiles: c.handle.readWorkspaceFiles });
  cleanups.push(() => port.close());
  const lookup = (path: string, text: string) => port.lookup(c.context, { language: 'python', path, text,
    digest: sha256Hex(text), mode: 'read' });
  return { c, lookup };
}

// 行 1：W 的 Python 语法错误是独立状态。
it('WPY-01 a Python syntax error is an independent state', async () => {
  const { lookup } = await pythonWorld([['src/robot/drive.py', 'def broken(:\n    pass\n']]);
  const bad = await lookup('src/robot/drive.py', 'def broken(:\n    pass\n');
  // 改坏（native-single-file.ts:76）：`finalOf` 把 `parse_failed` 折回 `{ status: 'unavailable' }`，
  // 坏文字这一条就红在 `status: 'syntax_error', line: 1` 上；`message` 只要求非空，不钉措辞。
  expect(bad).toMatchObject({ status: 'syntax_error', line: 1, message: expect.stringMatching(/\S/) });
  expect(await lookup('src/robot/drive.py', 'def main(node):\n    return node\n'))
    .toMatchObject({ status: 'parsed', exact: true, symbols: [
      { name: 'main', kind: 'function', start: { line: 1, column: 5 }, end: { line: 1, column: 9 } }] });
});

// 行 2：单文件查只解析、不执行。
it('WPY-02 a lookup parses only and never runs the file', async () => {
  const c = await fixture([['src/probe.py', '']]);
  const port = createNativeSingleFile({ readWorkspaceFiles: c.handle.readWorkspaceFiles });
  cleanups.push(() => port.close());
  // 第一行写的是绝对路径（根要建好才知道，所以文件先放空、再写真内容）。
  const text = `open(${JSON.stringify(join(c.root, 'ran.txt'))}, 'w').write('ran')\ndef main(node):\n    return node\n`;
  await c.edit('src/probe.py', text);
  const result = await port.lookup(c.context, { language: 'python', path: 'src/probe.py', text,
    digest: sha256Hex(text), mode: 'read' });
  expect(result).toMatchObject({ status: 'parsed' });
  // 改坏（scripts/python-source-query.py:640）：`single_file_symbols` 先 exec(compile(request['text'],
  // request['path'], 'exec'), {}) 再收符号 → 进程会写出 ran.txt，这一条红。
  await expect(readFile(join(c.root, 'ran.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
});
