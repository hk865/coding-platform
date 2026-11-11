/**
 * KLS-2a-1 pure rows P1–P8 (A5): the R16 module ids and the file frame, the key-sorted indented JSON, a note
 * file's bytes in its frame, the architecture files of one line, the two read-back gates, the knowledge a note
 * head projects to, and the write side under ruling D3′ (a path two modules claim is written and read as it is).
 * Every input is a literal; every expectation is written by hand.
 */
import { describe, expect, it } from 'vitest';
import type { AdoptedArchitecture } from '../../src/contracts/architecture-catalog.js';
import type { NoteBodyV1, NoteSourceV1 } from '../../src/contracts/note.js';
import {
  fileModuleId, fileProjectPath, projectModuleId, projectModuleIdOfFile, rawModuleId,
} from '../../src/contracts/workspace-module-id.js';
import {
  architectureFilesOf, architectureOfFiles, prettyJson,
} from '../../src/core/work-graph/architecture/architecture-file.js';
import type {
  KnowledgeBaselineV1, KnowledgeLineScope, NoteKnowledgeV1,
} from '../../src/core/work-graph/model/line-knowledge.js';
import { noteFileBytes, noteKnowledgeOf, noteOfFileBytes } from '../../src/core/work-graph/notes/note-file.js';

const MAIN: KnowledgeLineScope = { workspaceId: 'ws', mainWorkspaceId: 'ws' };
const SECOND: KnowledgeLineScope = { workspaceId: 'ws2', mainWorkspaceId: 'ws' };
const PROJECT = 'p';
const USER: NoteSourceV1 = { kind: 'user', principalId: 'u1' };

const encodeText = (value: string): Uint8Array => new TextEncoder().encode(value);
const decodeText = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
/** The value of a `decoded` result; an `invalid` one fails the row with its reason. */
function decodedOf<T>(result: { status: 'decoded'; value: T } | { status: 'invalid'; reason: string }): T {
  if (result.status !== 'decoded') throw new Error(`expected decoded, got invalid: ${result.reason}`);
  return result.value;
}
const moduleRef = (moduleId: string) => ({ projectId: PROJECT, moduleId });
const moduleDef = (moduleId: string, paths: string[]) => ({ ref: moduleRef(moduleId), name: moduleId,
  responsibility: `own ${moduleId}`, paths, interfaces: [] });

describe('P1 R16 and the file frame', () => {
  const rows: [string, () => unknown, unknown][] = [
    ['① a main-workspace id stays as it is', () => projectModuleId('ws', 'core', 'ws'), 'core'],
    ['② another workspace gets the prefix', () => projectModuleId('ws2', 'core', 'ws'), '/@ws:ws2/core'],
    ['③ the id is encoded', () => projectModuleId('ws2', 'a/x', 'ws'), '/@ws:ws2/a%2Fx'],
    ['④ a main id that starts with the prefix is escaped with #', () => projectModuleId('ws', '/@ws:core', 'ws'),
      '/@ws:#%2F%40ws%3Acore'],
    ['⑤ rawModuleId reverses ③', () => rawModuleId('/@ws:ws2/a%2Fx'), { workspaceId: 'ws2', moduleId: 'a/x' }],
    ['⑥ a main-workspace module in a second-workspace file carries the prefix', () => fileModuleId('core', 'ws2', 'ws'),
      '/@ws:ws/core'],
    ['⑦ the file workspace\'s own module is bare in its file', () => fileModuleId('/@ws:ws2/core', 'ws2', 'ws'), 'core'],
    ['⑧ a prefixed main id read from a second-workspace file', () => projectModuleIdOfFile('/@ws:ws/core', 'ws2', 'ws'),
      'core'],
    ['⑨ the file workspace\'s own path is bare in its file', () => fileProjectPath('/@ws:ws2/src/x', 'ws2', 'ws'), 'src/x'],
    ['⑩ a main-workspace path in a second-workspace file carries the prefix', () => fileProjectPath('src/x', 'ws2', 'ws'),
      '/@ws:ws/src/x'],
  ];
  it.each(rows)('%s', (_label, run, expected) => {
    expect(run()).toEqual(expected);
  });
});

it('P2 prettyJson: canonicalJson key order, two-space indent, one trailing newline', () => {
  expect(prettyJson({ b: 1, a: [2] })).toBe('{\n  "a": [\n    2\n  ],\n  "b": 1\n}\n');
});

describe('P3 a note file: the version line, the JSON header, the separator line and the body bytes', () => {
  const understanding: NoteKnowledgeV1 = {
    kind: 'understanding', source: USER, topic: '写入顺序', conclusion: '先事件后文件', body: '正文\n---\n后半',
    sections: { status: '现状', decided: '已定', open: '未决', next: '下一步', risks: '风险' },
    anchor: { kind: 'module', moduleId: 'mod_billing' }, extraAnchors: [], structural: false, facts: [], basisFiles: [],
    replaces: [], contradicts: [], coexistWith: [],
  };
  const understandingFile = [
    '--- knowledge-note@1',
    '{',
    '  "anchor": {',
    '    "kind": "module",',
    '    "moduleId": "mod_billing"',
    '  },',
    '  "basisFiles": [],',
    '  "coexistWith": [],',
    '  "conclusion": "先事件后文件",',
    '  "contradicts": [],',
    '  "extraAnchors": [],',
    '  "facts": [],',
    '  "kind": "understanding",',
    '  "replaces": [],',
    '  "sections": {',
    '    "decided": "已定",',
    '    "next": "下一步",',
    '    "open": "未决",',
    '    "risks": "风险",',
    '    "status": "现状"',
    '  },',
    '  "source": {',
    '    "kind": "user",',
    '    "principalId": "u1"',
    '  },',
    '  "structural": false,',
    '  "topic": "写入顺序"',
    '}',
    '---',
    '正文',
    '---',
    '后半',
  ].join('\n');
  // The project view of a second-workspace note: its own module is prefixed here, a main one is bare.
  const secondNote: NoteKnowledgeV1 = {
    kind: 'pitfall', source: USER, topic: 't', conclusion: 'c', body: 'b',
    anchor: { kind: 'module', moduleId: '/@ws:ws2/core' }, extraAnchors: [{ kind: 'module', moduleId: 'core' }],
    structural: false, facts: [], basisFiles: ['/@ws:ws2/src/a.ts', 'src/b.ts'],
    replaces: [], contradicts: [], coexistWith: [],
  };
  const secondFile = [
    '--- knowledge-note@1',
    '{',
    '  "anchor": {',
    '    "kind": "module",',
    '    "moduleId": "core"',
    '  },',
    '  "basisFiles": [',
    '    "src/a.ts",',
    '    "/@ws:ws/src/b.ts"',
    '  ],',
    '  "coexistWith": [],',
    '  "conclusion": "c",',
    '  "contradicts": [],',
    '  "extraAnchors": [',
    '    {',
    '      "kind": "module",',
    '      "moduleId": "/@ws:ws/core"',
    '    }',
    '  ],',
    '  "facts": [],',
    '  "kind": "pitfall",',
    '  "replaces": [],',
    '  "source": {',
    '    "kind": "user",',
    '    "principalId": "u1"',
    '  },',
    '  "structural": false,',
    '  "topic": "t"',
    '}',
    '---',
    'b',
  ].join('\n');

  it.each([
    ['A a main-workspace understanding, a --- line inside the body', understanding, MAIN, understandingFile],
    ['B a second-workspace note in its own file frame', secondNote, SECOND, secondFile],
  ] as const)('%s', (_label, knowledge, scope, file) => {
    const bytes = decodedOf(noteFileBytes(knowledge, scope));
    expect(decodeText(bytes)).toBe(file);
    expect(noteOfFileBytes(bytes, scope)).toEqual({ status: 'decoded', value: knowledge });
  });

  it('C an interface anchor keeps a module id with a slash', () => {
    const knowledge: NoteKnowledgeV1 = { ...secondNote, anchor: { kind: 'interface', moduleId: 'a/b', interfaceId: 'c' },
      extraAnchors: [], basisFiles: [] };
    const read = decodedOf(noteOfFileBytes(decodedOf(noteFileBytes(knowledge, MAIN)), MAIN));
    expect(read.anchor).toEqual({ kind: 'interface', moduleId: 'a/b', interfaceId: 'c' });
  });
});

describe('P4 one line\'s architecture files: its own modules, cross-workspace edges at the referrer, the baseline in main', () => {
  // core contains util and depends on it (r1); core depends on the second workspace's svc (r2); svc depends on util (r3).
  const project: AdoptedArchitecture = {
    requireDag: true,
    modules: [moduleDef('core', ['src/core']), moduleDef('util', ['src/util']), moduleDef('/@ws:ws2/svc', ['/@ws:ws2/src/svc'])],
    dependencies: [
      { from: moduleRef('core'), to: moduleRef('util'), reason: 'r1' },
      { from: moduleRef('core'), to: moduleRef('/@ws:ws2/svc'), reason: 'r2' },
      { from: moduleRef('/@ws:ws2/svc'), to: moduleRef('util'), reason: 'r3' },
    ],
    containment: { parentOf: [{ parent: moduleRef('core'), child: moduleRef('util') }] },
  };
  const baseline: KnowledgeBaselineV1 = { description: 'd', constraints: [] };
  const parsed = (scope: KnowledgeLineScope) => {
    const files = decodedOf(architectureFilesOf(project, baseline, scope));
    const modules = files.modules.map(entry => JSON.parse(decodeText(entry.bytes)) as Record<string, unknown>);
    return { architecture: JSON.parse(decodeText(files.architecture)) as Record<string, unknown>, modules };
  };

  it('the main workspace\'s files', () => {
    const { architecture, modules } = parsed(MAIN);
    expect(architecture['crossWorkspace']).toEqual({ contains: [], dependsOn: [{ from: 'core', reason: 'r2', to: '/@ws:ws2/svc' }] });
    expect(architecture['modules']).toEqual(['core']);
    expect(Object.keys(architecture)).toContain('baseline');
    expect(modules.map(module => module['id']).sort()).toEqual(['core', 'util']);
    const core = modules.find(module => module['id'] === 'core')!;
    expect(core['contains']).toEqual(['util']);
    expect(core['dependsOn']).toEqual([{ to: 'util', reason: 'r1' }]);
    expect(modules.filter(module => 'group' in module)).toEqual([]);
  });

  it('the second workspace\'s files', () => {
    const { architecture, modules } = parsed(SECOND);
    expect(Object.keys(architecture)).not.toContain('baseline');
    expect(architecture['crossWorkspace']).toEqual({ contains: [], dependsOn: [{ from: 'svc', reason: 'r3', to: '/@ws:ws/util' }] });
    expect(architecture['modules']).toEqual(['svc']);
    expect(modules.map(module => module['id'])).toEqual(['svc']);
    expect(modules[0]!['dependsOn']).toEqual([]);
    expect(modules.filter(module => 'group' in module)).toEqual([]);
  });
});

describe('P5 the architecture read-back gates', () => {
  const pathOf = (hex: string) => `.workbench/modules/${hex.repeat(32)}.json`;
  const prettyText = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const moduleFile = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, responsibility: `own ${id}`,
    paths: [`src/${id}`], interfaces: [], contains: [], dependsOn: [], ...extra });
  const architecture = encodeText(prettyText({ baseline: { constraints: [], description: 'd' },
    crossWorkspace: { contains: [], dependsOn: [] }, modules: ['a'] }));
  const fileA = moduleFile('a', { contains: ['b'], dependsOn: [{ to: 'b', reason: 'r' }] });
  const fileB = moduleFile('b');
  const read = (modules: [string, unknown][]) => architectureOfFiles(architecture,
    modules.map(([path, body]) => ({ path, bytes: encodeText(prettyText(body)) })), MAIN, PROJECT);
  const { contains: _contains, ...fileBWithoutContains } = fileB;

  it('the unchanged pair reads back', () => {
    expect(read([[pathOf('a'), fileA], [pathOf('b'), fileB]]).status).toBe('decoded');
  });

  it.each([
    ['① a dependency on a module no file declares', [[pathOf('a'), { ...fileA, dependsOn: [{ to: 'missing', reason: 'r' }] }],
      [pathOf('b'), fileB]], ['missing']],
    ['② a module file no root reaches', [[pathOf('a'), fileA], [pathOf('b'), fileB], [pathOf('c'), moduleFile('c')]],
      ['c'.repeat(32)]],
    ['③ two module files with one id', [[pathOf('a'), fileA], [pathOf('b'), fileB], [pathOf('c'), fileA]],
      ['a'.repeat(32), 'c'.repeat(32)]],
    ['④ one file declares contains and another does not', [[pathOf('a'), fileA], [pathOf('b'), fileBWithoutContains]], []],
    ['⑤ a dependency cycle a→b→a', [[pathOf('a'), fileA], [pathOf('b'), { ...fileB, dependsOn: [{ to: 'a', reason: 'r' }] }]],
      ['cycle']],
  ] as [string, [string, unknown][], string[]][])('%s is invalid', (_label, modules, mentions) => {
    const result = read(modules);
    expect(result.status).toBe('invalid');
    for (const mention of mentions) expect((result as { reason: string }).reason).toContain(mention);
  });

  it('⑥ (D3′) a path two modules claim reads back', () => {
    expect(read([[pathOf('a'), { ...fileA, paths: ['src/core'] }], [pathOf('b'), { ...fileB, paths: ['src/core'] }]]).status)
      .toBe('decoded');
  });
});

describe('P6 a note file the reader refuses', () => {
  const valid = [
    '--- knowledge-note@1',
    '{',
    '  "anchor": {',
    '    "kind": "module",',
    '    "moduleId": "a"',
    '  },',
    '  "basisFiles": [],',
    '  "coexistWith": [],',
    '  "conclusion": "c",',
    '  "contradicts": [],',
    '  "extraAnchors": [],',
    '  "facts": [],',
    '  "kind": "pitfall",',
    '  "replaces": [],',
    '  "source": {',
    '    "kind": "user",',
    '    "principalId": "u1"',
    '  },',
    '  "structural": false,',
    '  "topic": "t"',
    '}',
    '---',
    'body',
  ].join('\n');
  const anchorBlock = '  "anchor": {\n    "kind": "module",\n    "moduleId": "a"\n  },';

  it('the unchanged file reads back', () => {
    expect(noteOfFileBytes(encodeText(valid), MAIN).status).toBe('decoded');
  });

  it.each([
    ['the first line is another version', ['--- knowledge-note@1', '--- knowledge-note@2']],
    ['the header is not JSON', ['  "topic": "t"\n}', '  "topic": "t"\n']],
    ['the header carries an id key', ['{\n  "anchor"', '{\n  "id": "n1",\n  "anchor"']],
    ['the anchor is a goal', [anchorBlock, '  "anchor": {\n    "goalId": "g",\n    "kind": "goal"\n  },']],
    ['a pitfall carries sections', ['  "replaces": [],', '  "replaces": [],\n  "sections": {\n    "decided": "d",\n'
      + '    "next": "n",\n    "open": "o",\n    "risks": "r",\n    "status": "s"\n  },']],
    ['a link note has no link', ['"kind": "pitfall"', '"kind": "link"'], 'header.link is required for link'],
  ] as [string, [string, string], string?][])('%s', (_label, [from, to], rule) => {
    const changed = valid.replace(from, to);
    expect(changed).not.toBe(valid);
    const result = noteOfFileBytes(encodeText(changed), MAIN);
    expect(result.status).toBe('invalid');
    if (rule !== undefined) expect((result as { reason: string }).reason).toContain(rule);
  });
});

it('P7 noteKnowledgeOf keeps the head\'s source and drops the run-time fields', () => {
  const body: NoteBodyV1 = {
    kind: 'pitfall', topic: 't', topicKey: 't', conclusion: 'c', body: 'b',
    anchor: { kind: 'file', path: 'a.ts', symbol: { language: 'typescript', qualifiedName: 'f', signatureDigest: 's',
      range: { startLine: 1, endLine: 2 }, fileDigest: 'd' } },
    extraAnchors: [{ kind: 'goal', goalId: 'g' }, { kind: 'module', moduleId: 'm' }],
    facts: [{ kind: 'file', path: 'a.ts', digest: 'd' }],
    basis: { planRevision: 1, catalogRevision: 2, files: [{ path: 'a.ts', digest: 'd' }] },
    structural: false, replaces: [], contradicts: [], coexistWith: [],
  };
  const head = { ...body, source: { kind: 'user' as const, principalId: 'u' }, version: 3, state: 'accepted' as const };
  const knowledge = noteKnowledgeOf(head);
  expect(knowledge.source).toEqual({ kind: 'user', principalId: 'u' });
  expect(knowledge.facts).toEqual([{ kind: 'file', path: 'a.ts' }]);
  expect(knowledge.basisFiles).toEqual(['a.ts']);
  expect(knowledge.anchor).toEqual({ kind: 'file', path: 'a.ts' });
  expect(knowledge.extraAnchors).toEqual([{ kind: 'module', moduleId: 'm' }]);
  expect(Object.keys(knowledge).filter(key => ['topicKey', 'version', 'state'].includes(key))).toEqual([]);
});

it('P8 (D3′) the write side writes a path two modules claim', () => {
  const shared: AdoptedArchitecture = { requireDag: true, dependencies: [],
    modules: [moduleDef('a', ['src/core']), moduleDef('b', ['src/core'])] };
  expect(architectureFilesOf(shared, { description: 'd', constraints: [] }, MAIN).status).toBe('decoded');
});
