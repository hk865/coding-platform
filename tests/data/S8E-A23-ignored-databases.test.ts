/**
 * §11.4/§11.6 A-23〔§10 段〕: ignored `compile_commands.json` files are read as
 * config-only material (never nodes, never `other` issues), merged in path order,
 * the aggregate colcon database wins alone, a binary database fails C/C++ whole,
 * and changing only an ignored database changes `sourceDigest`.
 */
import { afterEach, expect, it } from 'vitest';
import { BACKENDS, fixture, type Entry, type PlatformFixture } from '../helpers/S8D-platform-fixture.js';

const fixtures: PlatformFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.close();
});

const APPROX = '近似：不读系统头文件和观测以外的头文件';
const db = (directory: string, file: string) =>
  `[{"directory":"${directory}","file":"${file}","arguments":["c++","-c","${file}"]}]\n`;
const p1Db = db('../../p1', 'a.cpp');
const p2Db = db('../../p2', 'b.cpp');
const aggregateDb = `[{"directory":"../p1","file":"a.cpp","arguments":["c++","-c","a.cpp"]},{"directory":"../p2","file":"b.cpp","arguments":["c++","-c","b.cpp"]}]\n`;

function baseEntries(extra: Entry[] = []): Entry[] {
  return [
    ['.gitignore', 'build/\n'],
    ['build/p1/compile_commands.json', p1Db],
    ['build/p2/compile_commands.json', p2Db],
    ['p1/a.cpp', '#include "a.h"\n'],
    ['p1/a.h', 'int a;\n'],
    ['p2/b.cpp', '#include "b.h"\n'],
    ['p2/b.h', 'int b;\n'],
    ['main.cpp', 'int m;\n'],
    ['README.md', '# readme\n'],
    ...extra,
  ];
}

const cppEdges = [{ from: 'p1/a.cpp', to: 'p1/a.h' }, { from: 'p2/b.cpp', to: 'p2/b.h' }];

for (const backend of BACKENDS) {
  it(`A-23 merges ignored per-package databases and recaptures on their change [${backend}]`, async () => {
    const f = await fixture(backend, `s8e-a23-merge-${backend}`, baseEntries([
      // Replaces the base `.gitignore` (a later entry for the same path wins).
      ['.gitignore', 'build/\nnode_modules/\n'],
      // Ignored, but under a skip-list directory: never a third merged database.
      ['node_modules/pkg/compile_commands.json', p1Db],
    ]), { git: true });
    fixtures.push(f);
    const first = await f.capture();
    const page = await f.listFiles(first);
    expect(page.inventory).toEqual({ source: 'git', reason: null });
    expect(page.nodes.map(node => node.path)).toEqual(['.gitignore', 'README.md', 'main.cpp', 'p1/a.cpp', 'p1/a.h', 'p2/b.cpp', 'p2/b.h']);
    expect(page.edges).toEqual(cppEdges);
    expect(page.languages.find(language => language.language === 'cpp')).toEqual({
      language: 'cpp', files: 5, parsed: 4, edges: 'supported', reason: null,
      // Exactly the two `build/` databases merge: the ignored database under
      // `node_modules/` does not become a third one.
      notes: ['合并了 2 个编译数据库', APPROX],
      // The added `main.cpp` claims C/C++ but the merged databases do not compile it.
      issues: [{ path: 'main.cpp', kind: 'skipped', reason: '源文件不在编译数据库里' }],
      issueCount: 1, complete: false,
    });
    // The database paths are neither nodes nor issues of any language.
    const other = page.languages.find(language => language.language === 'other');
    expect(other?.issues).toEqual([]);
    expect(page.languages.flatMap(language => language.issues.map(issue => issue.path)))
      .not.toContain('build/p1/compile_commands.json');

    const firstDigest = first.persisted.capture.sourceDigest;
    await f.write('build/p1/compile_commands.json', p1Db + '\n');
    const second = await f.capture();
    expect(second.persisted.capture.sourceDigest).not.toBe(firstDigest);
  });

  it(`A-23 uses only the ignored colcon aggregate database [${backend}]`, async () => {
    const f = await fixture(backend, `s8e-a23-aggregate-${backend}`,
      baseEntries([['build/compile_commands.json', aggregateDb]]), { git: true });
    fixtures.push(f);
    const page = await f.listFiles(await f.capture());
    expect(page.edges).toEqual(cppEdges);
    expect(page.languages.find(language => language.language === 'cpp')?.notes).toEqual([APPROX]);
  });

  it(`A-23 fails C/C++ whole on a binary ignored database [${backend}]`, async () => {
    const f = await fixture(backend, `s8e-a23-binary-${backend}`, baseEntries([
      ['build/p2/compile_commands.json', '[{"directory":"../../p2","file":"b.cpp","arguments":["c++","-c","b.cpp"]}]\u0000\n'],
    ]), { git: true });
    fixtures.push(f);
    const page = await f.listFiles(await f.capture());
    expect(page.edges.filter(edge => edge.from.endsWith('.cpp'))).toEqual([]);
    expect(page.languages.find(language => language.language === 'cpp')).toEqual({
      language: 'cpp', files: 5, parsed: 0, edges: 'failed',
      reason: 'compile_commands.json 读不了：binary source', notes: [], issues: [], issueCount: 0, complete: false,
    });
  });
}
