/**
 * Slice 8D acceptance entry A-20 (spec §11.6 lines 750–753, round-2 item 8):
 * Python imports are resolved against the configured roots. The graph is read
 * through the SAME public platform fixture A-06 uses, on memory and SQLite;
 * unresolved specifiers come from `compareFormalObserved`'s `unresolved`
 * findings. Literal expectations are §11.6's and do not change.
 */
import { describe, expect, it } from 'vitest';
import { BACKENDS, fixture, type Entry, type GraphShape } from '../helpers/S8D-platform-fixture.js';

const coverageOf = (graph: GraphShape, language: string) => graph.languages.find(entry => entry.language === language);

/** Compare reference sets by value; the capture sorts into its own order. */
function byKey<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((left, right) => {
    const a = key(left), b = key(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}
const edgePairs = (graph: GraphShape) => byKey(graph.edges.map(edge => [edge.from, edge.to] as [string, string]), pair => pair.join('\0'));
const unresolvedPairs = (graph: GraphShape) => byKey(graph.unresolved.map(item => [item.from, item.specifier] as [string, string]), pair => pair.join('\0'));
const pythons = (graph: GraphShape) => byKey(graph.nodes.filter(node => node.language === 'python').map(node => node.path), path => path);

/** The `detail` strings of the formal comparison's unresolved findings, in capture order. */
async function unresolvedDetails(f: Awaited<ReturnType<typeof fixture>>): Promise<string[]> {
  const capture = await f.capture();
  const catalog = await f.adopt();
  const comparison = await f.platform.architecture.compareFormalObserved(f.ctx, { catalog, captureRef: capture });
  if (comparison.status !== 'ready') throw Error(`compareFormalObserved ${comparison.status}`);
  return comparison.value.findings.filter(finding => finding.kind === 'unresolved').map(finding => finding.detail);
}

const PYTHON_FILES = [
  'a/__init__.py',
  'a/b/__init__.py',
  'a/b/c.py',
  'app.py',
  'email/utils.py',
  'fast.py',
  'fast.pyi',
  'lib/plug/__init__.py',
  'lib/shared/util.py',
  'mod.py',
  'mod/x.py',
  'native.pyi',
  'ns/mod.py',
  'nsuser.py',
  'pkg/__init__.py',
  'pkg/deep/__init__.py',
  'pkg/deep/leaf.py',
  'pkg/inner.py',
  'pkg/json/data.py',
  'pkg/sub.py',
  'plug/x.py',
  'shared/__init__.py',
  'solo.py',
  'tools/cfg.py',
].sort();

const FILES: Entry[] = [
  ['pyrightconfig.json', '{"extraPaths": ["lib"]}'],
  ['app.py', 'import a.b.c\nimport a.b.c.d\nimport mod.x\nimport email\nimport ns\nimport ns.mod\nimport fast\nimport native\nimport plug\nimport shared.util\nfrom shared import util\nfrom pkg import sub, name\nfrom pkg import *\nimport os\nfrom tools import run\n'],
  ['a/__init__.py', ''],
  ['a/b/__init__.py', ''],
  ['a/b/c.py', ''],
  ['mod.py', ''],
  ['mod/x.py', ''],
  ['email/utils.py', ''],
  ['ns/mod.py', ''],
  ['nsuser.py', 'from ns import nothere\nfrom ns import mod\n'],
  ['fast.py', ''],
  ['fast.pyi', ''],
  ['native.pyi', ''],
  ['plug/x.py', ''],
  ['lib/plug/__init__.py', ''],
  ['shared/__init__.py', ''],
  ['lib/shared/util.py', ''],
  ['pkg/__init__.py', 'from . import sub\nfrom . import helper\nfrom .. import top\nhelper = 1\n'],
  ['pkg/sub.py', 'from .inner import k\nfrom .deep.leaf import z\nfrom .json import y\n'],
  ['pkg/inner.py', ''],
  ['pkg/deep/__init__.py', ''],
  ['pkg/deep/leaf.py', ''],
  ['pkg/json/data.py', ''],
  ['tools/cfg.py', ''],
  ['solo.py', 'from . import x\n'],
];

const EXPECTED_EDGES: [string, string][] = [
  ['app.py', 'a/b/c.py'],
  ['app.py', 'fast.py'],
  ['app.py', 'lib/plug/__init__.py'],
  ['app.py', 'native.pyi'],
  ['app.py', 'ns/mod.py'],
  ['app.py', 'pkg/__init__.py'],
  ['app.py', 'pkg/sub.py'],
  ['app.py', 'shared/__init__.py'],
  ['nsuser.py', 'ns/mod.py'],
  ['pkg/__init__.py', 'pkg/sub.py'],
  ['pkg/sub.py', 'pkg/deep/leaf.py'],
  ['pkg/sub.py', 'pkg/inner.py'],
];

const EXPECTED_UNRESOLVED: [string, string][] = [
  ['app.py', 'a.b.c.d'],
  ['app.py', 'email'],
  ['app.py', 'mod.x'],
  ['app.py', 'ns'],
  ['app.py', 'shared.util'],
  ['app.py', 'os'],
  ['app.py', 'tools'],
  ['nsuser.py', 'ns'],
  ['pkg/sub.py', '.json'],
  ['pkg/__init__.py', '..'],
  ['solo.py', '.'],
];

/**
 * §11.6 〔§10 段〕: through `compareFormalObserved`, `unresolved.detail` is the
 * bare specifier when the reason is null, otherwise `<specifier>（<reason>）`
 * (§11.5, full-width parentheses). Every reason here is §11.6's literal.
 */
const EXPECTED_DETAILS: string[] = [
  'a.b.c.d（a.b.c 是模块，不是包）',
  'email（命名空间目录和标准库重名）',
  'mod.x（mod 是模块，不是包）',
  'ns（命名空间目录，可能是同名的外部包）',
  'shared.util',
  'os（标准库）',
  'tools（命名空间目录，可能是同名的外部包）',
  'ns（命名空间目录，可能是同名的外部包）',
  '.json（命名空间包，没有文件）',
  '..（相对导入越过了顶层包）',
  '.（相对导入越过了顶层包）',
];

describe.each(BACKENDS)('A-20 Python imports [%s]', backend => {
  it('A-20 resolves Python imports against the configuration roots exactly', async () => {
    const f = await fixture(backend, `s8d-a20-python-imports-${backend}`, FILES);
    try {
      const graph = await f.graph();

      expect(pythons(graph)).toEqual(PYTHON_FILES);
      expect(coverageOf(graph, 'python')).toEqual({
        language: 'python', files: 24, parsed: 24, edges: 'supported', reason: null, notes: [], issues: [], issueCount: 0, complete: true,
      });
      expect(edgePairs(graph)).toEqual(byKey(EXPECTED_EDGES, pair => pair.join('\0')));
      expect(unresolvedPairs(graph)).toEqual(byKey(EXPECTED_UNRESOLVED, pair => pair.join('\0')));
      expect(graph.edges.filter(edge => edge.from === 'pkg/__init__.py' && edge.to === 'pkg/__init__.py')).toEqual([]);
      expect(graph.unresolved.filter(item => item.from === 'pkg/__init__.py' && item.specifier === '.')).toEqual([]);
      const details = await unresolvedDetails(f);
      expect(byKey(details, detail => detail)).toEqual(byKey(EXPECTED_DETAILS, detail => detail));
    } finally {
      await f.close();
    }
  }, 120000);
});
