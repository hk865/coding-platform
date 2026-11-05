/** E37-R1–R3 (spec §4.2, §5): `files/uncommitted` over the real Host's HTTP route on a real git repository
 * and one plain directory, memory only (S3). The world is built once before the Host starts; every row only
 * reads. Each expected entry is hand-counted from the contents below (spec §4.2's table, §4.3's split). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalWorkbenchHost, type LocalWorkbenchHost } from '../../src/app/host.js';
import { writeHostPage } from '../helpers/host-page.js';
import { corePost, readPageToken } from '../helpers/AG2b-collaboration-fixture.js';
import { gitIn, initGitWorkspace } from '../scenarios/support/git-workspace.js';

const ws1 = { projectId: 'e37-project', workspaceId: 'e37-git' };
const ws2 = { projectId: 'e37-project', workspaceId: 'e37-plain' };
const ws3 = { projectId: 'e37-project', workspaceId: 'e37-nested' };
const refOf = (scope: typeof ws1) => ({ aggregateType: 'Workspace' as const, ...scope });
const big = (p: string): string => Array.from({ length: 600 }, (_, i) => p + i + '\n').join('');
const temporary: string[] = [];
let host: LocalWorkbenchHost | undefined;
let base = '';
let token = '';

beforeAll(async () => {
  const temp = async (name: string): Promise<string> => { const d = await mkdtemp(join(tmpdir(), `e37-${name}-`)); temporary.push(d); return d; };
  const [publicDir, gitRoot, plainRoot, outerRoot] = [await temp('public'), await temp('git'), await temp('plain'), await temp('outer')];
  const at = (path: string): string => join(gitRoot, path);
  await writeHostPage(publicDir);
  await initGitWorkspace(gitRoot, { files: { 'src/mod.ts': 'a\nb\nc\n', 'src/gone.ts': 'x\ny\nz\n', 'src/same.ts': 'keep\n',
    'src/committed.ts': 'v1\n', 'src/bin.dat': 'text\n', 'src/big.ts': big('a'), 'src/grown.ts': 'small\n', 'src/dir/a.ts': 'd\n', 'README.md': 'r\n' } });
  await symlink('mod.ts', at('src/link.ts'));
  await writeFile(at('src/committed.ts'), 'v2\n');
  gitIn(gitRoot, 'add', '-A');
  gitIn(gitRoot, 'commit', '-q', '-m', 'second');
  /* the uncommitted changes: plain disk writes, the way a shell or an editor makes them (spec §1) */
  for (const path of ['src/gone.ts', 'src/link.ts', 'src/dir']) await rm(at(path), { recursive: true }); // the link itself, the whole dir
  const now: Record<string, string | Buffer> = { 'src/mod.ts': 'a\nB\nc\nd\n', 'src/bin.dat': Buffer.from([0, 1, 10]), 'src/big.ts': big('b'),
    'src/grown.ts': 'x'.repeat(1048577), 'README.md': 'r2\n', 'src/link.ts': 'real\n', 'src/dir': 'f\n', 'src/new.ts': 'n1\nn2\n', 'src/huge.ts': 'y'.repeat(1048577) };
  for (const [path, content] of Object.entries(now)) await writeFile(at(path), content);
  await symlink('mod.ts', at('src/newlink.ts'));
  await mkdir(at('private'));
  await writeFile(at('private/a.txt'), 'p1\np2\n');
  await symlink('../private', at('src/outside')); // a directory link from inside readPrefixes ['src'] to outside it (ruling 20)
  await mkdir(join(plainRoot, 'src'));
  await writeFile(join(plainRoot, 'src/a.ts'), 'a\n');
  await initGitWorkspace(outerRoot, { files: { 'sub/src/a.ts': 'a\n' } }); // a repository with HEAD; the root is its sub/
  host = await createLocalWorkbenchHost({
    storage: { kind: 'memory' }, actor: { kind: 'human', id: 'e37-operator' }, publicDir,
    now: () => '2026-11-05T00:00:00.000Z',
    workspaces: [{ scope: ws1, name: 'E37 git', root: gitRoot, workspaceRevision: 1, readPrefixes: ['src'] },
      { scope: ws2, name: 'E37 plain', root: plainRoot, workspaceRevision: 1, readPrefixes: ['src'] },
      { scope: ws3, name: 'E37 nested', root: join(outerRoot, 'sub'), workspaceRevision: 1, readPrefixes: ['src'] }],
  });
  base = (await host.listen()).url;
  token = await readPageToken(base);
}, 60_000);

afterAll(async () => {
  await host?.close();
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

/** One call; the route is published (200, never the unpublished 404) before its body is read. */
async function uncommitted(scope: typeof ws1, input: unknown): Promise<unknown> {
  const response = await corePost(base, 'files/uncommitted', token, { scope, input });
  expect(response.status).toBe(200);
  return response.json();
}

describe('E37-R files/uncommitted', () => {
  /* Named mutations, one cell each: no blob-id compare, always read HEAD and count (same.ts, committed.ts
     turn uncommitted +0 −0); a deleted file answers clean (gone.ts); no mode check on the HEAD side
     (link.ts turns uncommitted +1 −1: HEAD's blob is `mod.ts` without a newline, now `real\n`); no read
     authorization (README.md turns uncommitted); the batched tree read without -t (git descends for
     src/dir/a.ts and drops src/dir's own entry, src/dir taken as new: uncommitted +1 −0); ENOTDIR on the
     current file not taken as missing (src/dir/a.ts turns unknown). */
  it('E37-R1 one request answers each path against HEAD, in the input order (spec §4.2)', async () => {
    const rows: Array<[string, Record<string, unknown>]> = [
      ['src/mod.ts', { state: 'uncommitted', lines: { added: 2, deleted: 1 } }], // [a,b,c] -> [a,B,c,d], LCS 2
      ['src/gone.ts', { state: 'uncommitted', lines: { added: 0, deleted: 3 } }], // in HEAD, gone now
      ['src/same.ts', { state: 'clean' }], // same content as HEAD
      ['src/committed.ts', { state: 'clean' }], // changed, then committed
      ['src/bin.dat', { state: 'uncommitted', lines: null }], // a NUL now
      ['src/big.ts', { state: 'uncommitted', lines: null }], // 600 lines rewritten: distance 1,200 > 1,000
      ['src/grown.ts', { state: 'unknown' }], // over 1 MiB now, in HEAD
      ['src/link.ts', { state: 'unknown' }], // a symbolic link in HEAD
      ['src/newlink.ts', { state: 'unknown' }], // a symbolic link now
      ['src/dir', { state: 'unknown' }], // a tree in HEAD, a plain file now (rulings 6, 16)
      ['src/dir/a.ts', { state: 'uncommitted', lines: { added: 0, deleted: 1 } }], // in HEAD; ENOTDIR now
      ['README.md', { state: 'unknown' }], // outside readPrefixes ['src']
      ['src/new.ts', { state: 'uncommitted', lines: { added: 2, deleted: 0 } }], // new; git's split is 2 lines
      ['src/huge.ts', { state: 'uncommitted', lines: null }], // new, over 1 MiB
      ['src/never.ts', { state: 'clean' }], // on neither side
      ['../outside.ts', { state: 'unknown' }], // not a normal path: answered, not refused (spec §5)
    ];
    expect(await uncommitted(ws1, { workspace: refOf(ws1), paths: rows.map(([path]) => path) }))
      .toEqual({ status: 'ready', value: { repository: 'git', files: rows.map(([path, rest]) => ({ path, ...rest })) } });
  });

  /* Named mutation: the real path not checked against the read prefixes before the bytes are read (this row
     turns uncommitted +2 −0: private/a.txt's two lines, read as a new file). */
  it('E37-R1 a path through a directory link out of the read prefixes answers unknown, no lines (ruling 20)', async () => {
    // src/outside -> ../private: the path asked for is under 'src', the file it reaches is not
    expect(await uncommitted(ws1, { workspace: refOf(ws1), paths: ['src/outside/a.txt'] }))
      .toEqual({ status: 'ready', value: { repository: 'git', files: [{ path: 'src/outside/a.txt', state: 'unknown' }] } });
  });

  /* Named mutation: the parent directory not resolved with realpath and checked against the read prefixes
     before the lstat (this row turns clean: it tells there is no such file under private/). */
  it('E37-R1 a missing file through a directory link out of the read prefixes answers unknown, not clean (ruling 24)', async () => {
    // neither in HEAD nor under private/: only the read prefixes may answer, and they do not allow private/
    expect(await uncommitted(ws1, { workspace: refOf(ws1), paths: ['src/outside/none.ts'] }))
      .toEqual({ status: 'ready', value: { repository: 'git', files: [{ path: 'src/outside/none.ts', state: 'unknown' }] } });
  });

  /* Named mutation: a root that is not git's top level answered path by path (files: one unknown). */
  it('E37-R2 a root that is not a git work tree answers not_git (spec §4.2)', async () => {
    expect(await uncommitted(ws2, { workspace: refOf(ws2), paths: ['src/a.ts'] }))
      .toEqual({ status: 'ready', value: { repository: 'not_git' } });
  });

  /* Named mutation: no top-level check (the repository above the root has a HEAD, so the read goes on path by path). */
  it('E37-R2 a root inside a repository but not its top level answers not_git (spec §4.2)', async () => {
    expect(await uncommitted(ws3, { workspace: refOf(ws3), paths: ['src/a.ts'] }))
      .toEqual({ status: 'ready', value: { repository: 'not_git' } });
  });

  describe('E37-R3 rejects: the code and the reason word for word (spec §5)', () => {
    const paths = (n: number): string[] => Array.from({ length: n }, (_, i) => `src/p${i}.ts`);
    const badPaths = { status: 'rejected', code: 'invalid', reason: 'paths must be 1 to 100 strings' };
    /* Named mutation: no 100 cap (the 101 row turns ready). */
    it.each([
      ['no path', { workspace: refOf(ws1), paths: [] }, badPaths],
      ['101 paths', { workspace: refOf(ws1), paths: paths(101) }, badPaths],
      ['a path that is not a string', { workspace: refOf(ws1), paths: ['src/mod.ts', 7] }, badPaths],
      ['no workspace', { paths: ['src/mod.ts'] }, { status: 'rejected', code: 'invalid', reason: 'workspace scope required' }],
      ['another workspace than the scope', { workspace: refOf(ws2), paths: ['src/mod.ts'] },
        { status: 'rejected', code: 'forbidden', reason: 'call context scope does not match the requested workspace' }],
    ])('E37-R3 %s', async (_, input, expected) => {
      expect(await uncommitted(ws1, input)).toEqual(expected);
    });

    /* Named mutation: the cap written `>= 100` (this row turns rejected). */
    it('E37-R3 exactly 100 paths are read, each clean (on neither side)', async () => {
      const body = await uncommitted(ws1, { workspace: refOf(ws1), paths: paths(100) }) as { value: { files: Array<{ state: unknown }> } };
      expect(body).toMatchObject({ status: 'ready', value: { repository: 'git' } });
      expect(body.value.files.map((file) => file.state)).toEqual(Array(100).fill('clean'));
    });
  });
});
