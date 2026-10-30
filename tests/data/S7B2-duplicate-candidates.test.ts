import { afterEach, expect, it } from 'vitest';
import { createProjectSourceTool, projectSourceInputSchema } from '../../src/core/agent-runtime/project-source-tool.js';
import type { WorkspaceComparison, WorkspaceResult } from '../../src/core/workspace/ports.js';
import {
  duplicatePairWorlds, type DuplicateCaptureWorldV1, type DuplicateGitWorldV1,
} from '../helpers/S7B2-duplicate-pair.js';
import { ready, type Entry } from '../helpers/workspace-tools-fixture.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const defaults = {
  projectId: 'p-d', actorId: 'a-d', permissionRevision: 'perm-d@1', tempPrefix: 's7b2-duplicate-', cleanups,
};
const D = duplicatePairWorlds(defaults);

const L = (path: string, line: number) => ({ path, line });
const pad2 = (n: number) => String(n).padStart(2, '0');

const C = (w: DuplicateCaptureWorldV1) => w.handle.tools.compareWorkspace(w.context, {
  workspace: w.workspace,
  before: { kind: 'capture', capture: w.before },
  after: { kind: 'capture', capture: w.after },
  duplicates: true,
});
const G = (w: DuplicateGitWorldV1, p?: string) => w.handle.tools.compareWorkspace(w.context, {
  workspace: w.workspace,
  before: { kind: 'git', commit: w.commitBefore() },
  after: { kind: 'git', commit: w.commitAfter() },
  duplicates: true,
  ...(p === undefined ? {} : { prefix: p }),
});

it('row 1 lists two same-name definitions and the same literal with two locations each', async () => {
  // Mutation: delete the literal arm in duplicateCandidates -> the second candidate is missing.
  const alpha = 'export function alpha() { return 1; }\n';
  const beta = "export function beta() { return '0123456789012345678901234567890123456789'; }\n";
  // sha256(src/a.ts before) adff9e58cc98b735fe2c262febfc15fb575444f74c0523e188379d3e4ef51385
  // sha256(src/b.ts) aa1b67eefb30db1c6f7c8a21b1e381fb83bbd9f28049dfb963752e0c4575959a
  // sha256(src/a.ts after) 9a82116fe6243a688241e8b8e49833e29a2b18fb921bfd9e054c7a06621a990d
  const before: Entry[] = [['src/a.ts', alpha], ['src/b.ts', beta]];
  const after: Entry[] = [['src/a.ts', alpha + beta], ['src/b.ts', beta]];
  const w = await D.capturePair({ before, after });
  const r = await C(w);
  expect(ready(r).duplicates).toEqual({
    candidates: [
      { kind: 'definition', name: 'beta', first: L('src/a.ts', 2), second: L('src/b.ts', 1) },
      { kind: 'literal', preview: '0123456789012345678901234567890123456789', length: 40,
        digest: 'fb526cd4ad0ec978c1a9e78f7c0728711139978424d618eb228be59e21188970',
        first: L('src/a.ts', 2), second: L('src/b.ts', 1) },
    ],
    coverage: { scanned: 2, skipped: 0 },
    truncated: false,
  });
});

it('row 2 does not list a pre-existing duplicate', async () => {
  // Mutation: pass {files:[],skipped:0} as the before material -> shared is reported.
  // sha256(src/a.ts) f622c2cc58e7b5be88702d12b619d40aaa998d66ed9cc69132a447da86827cf4
  // sha256(src/b.ts) 796b86854525105dbc92e88a1b04ed12740abc7cfd6e58eff71b194dd33731af
  const before: Entry[] = [
    ['src/a.ts', 'export function shared() { return 1; }\n'],
    ['src/b.ts', 'export function shared() { return 2; }\n'],
  ];
  const w = await D.capturePair({ before, after: before });
  const r = await C(w);
  expect(ready(r).duplicates).toEqual({ candidates: [], coverage: { scanned: 2, skipped: 0 }, truncated: false });
});

it('row 3 keeps an unchanged file participating as elsewhere when only one file changed', async () => {
  // Mutation: build the pool from changes.added/changes.modified only -> b.ts is dropped and the candidate disappears.
  // sha256(src/a.ts before) adff9e58cc98b735fe2c262febfc15fb575444f74c0523e188379d3e4ef51385
  // sha256(src/b.ts) 8c4ec028431d15a910848de04c4605888b2393d7e5ec55d22a5fbaee02e692b1
  // sha256(src/a.ts after) 6ecca9fd2e7ca726417436c5bfa51dd5de8de84884c8661e22a5020f51a905b6
  const before: Entry[] = [
    ['src/a.ts', 'export function alpha() { return 1; }\n'],
    ['src/b.ts', 'export function gamma() { return 3; }\n'],
  ];
  const after: Entry[] = [
    ['src/a.ts', 'export function alpha() { return 1; }\nexport function gamma() { return 4; }\n'],
    ['src/b.ts', 'export function gamma() { return 3; }\n'],
  ];
  const w = await D.capturePair({ before, after });
  const r = await C(w);
  expect(ready(r).duplicates).toEqual({
    candidates: [{ kind: 'definition', name: 'gamma', first: L('src/a.ts', 2), second: L('src/b.ts', 1) }],
    coverage: { scanned: 2, skipped: 0 },
    truncated: false,
  });
});

it('row 4 excludes out-of-scope material', async () => {
  // Mutation: pass prefix null to the git tree listing and the material filter -> shared is reported and scanned becomes 2.
  // sha256(src/one/x.ts before) adff9e58cc98b735fe2c262febfc15fb575444f74c0523e188379d3e4ef51385
  // sha256(src/two/y.ts) 796b86854525105dbc92e88a1b04ed12740abc7cfd6e58eff71b194dd33731af
  // sha256(src/one/x.ts after) ee3c6368ec573ad95bc901ef253467b4ef907cfd9ce9c88e3ac56768112a4fda
  const before: Entry[] = [
    ['src/one/x.ts', 'export function alpha() { return 1; }\n'],
    ['src/two/y.ts', 'export function shared() { return 2; }\n'],
  ];
  const after: Entry[] = [
    ['src/one/x.ts', 'export function alpha() { return 1; }\nexport function shared() { return 3; }\n'],
    ['src/two/y.ts', 'export function shared() { return 2; }\n'],
  ];
  const w = await D.gitWorld({ before, after, working: [] });
  const r = await G(w, 'src/one');
  expect(ready(r).duplicates).toEqual({ candidates: [], coverage: { scanned: 1, skipped: 0 }, truncated: false });
});

it('row 5 git/git lists only a duplicate added in the after commit', async () => {
  // Mutation: take the after text as the before text for every path -> beta at a:3 is treated as existing and the row lists [].
  // sha256(src/a.ts before) 8bdb54e76eb852afe1f6019518e847718f88c5a74f4108d317cb1feb6a6cbbda
  // sha256(src/b.ts) e9aee4ab3b1cde4c605d5d7678c74483c4dab40d1734265d18f4d7a8fd7d4953
  // sha256(src/a.ts after) c13b9557e45c9e9fe0f897b80e6b313c4ad654e89dd2c7ce465ee491e7619ff5
  const before: Entry[] = [
    ['src/a.ts', 'export function alpha() { return 1; }\nexport function shared() { return 0; }\n'],
    ['src/b.ts', 'export function beta() { return 2; }\nexport function shared() { return 9; }\n'],
  ];
  const after: Entry[] = [
    ['src/a.ts', 'export function alpha() { return 1; }\nexport function shared() { return 0; }\nexport function beta() { return 3; }\n'],
    ['src/b.ts', 'export function beta() { return 2; }\nexport function shared() { return 9; }\n'],
  ];
  const w = await D.gitWorld({ before, after, working: [] });
  const r = await G(w);
  expect(ready(r).duplicates).toEqual({
    candidates: [{ kind: 'definition', name: 'beta', first: L('src/a.ts', 3), second: L('src/b.ts', 1) }],
    coverage: { scanned: 2, skipped: 0 },
    truncated: false,
  });
});

it('row 6 git to working tree lists a teammate uncommitted duplicate', async () => {
  // Mutation: take the git commit as the after material regardless of direction -> the working-tree beta is not in the pool and the row lists [].
  // sha256(src/a.ts) adff9e58cc98b735fe2c262febfc15fb575444f74c0523e188379d3e4ef51385
  // sha256(src/b.ts) 4c525f54dc7f98cab36f5a2a30e206b23e684a8af104781093549fb4ef9c7657
  // sha256(src/a.ts working) 05d155f1ed2cf60c68e7f859aeeff4fc53e76c050021e5dce0d5a2bcd78a2a04
  const before: Entry[] = [
    ['src/a.ts', 'export function alpha() { return 1; }\n'],
    ['src/b.ts', 'export function beta() { return 2; }\n'],
  ];
  const after: Entry[] = [
    ['src/a.ts', 'export function alpha() { return 1; }\n'],
    ['src/b.ts', 'export function beta() { return 2; }\n'],
  ];
  const working: Entry[] = [
    ['src/a.ts', 'export function alpha() { return 1; }\nexport function beta() { return 2; }\n'],
    ['src/b.ts', 'export function beta() { return 2; }\n'],
  ];
  const w = await D.gitWorld({ before, after, working });
  const r = await w.handle.tools.compareWorkspace(w.context, {
    workspace: w.workspace,
    before: { kind: 'git', commit: w.commitAfter() },
    after: { kind: 'working_tree' },
    duplicates: true,
  });
  expect(ready(r).duplicates).toEqual({
    candidates: [{ kind: 'definition', name: 'beta', first: L('src/a.ts', 2), second: L('src/b.ts', 1) }],
    coverage: { scanned: 2, skipped: 0 },
    truncated: false,
  });
});

it('row 7 working tree to git judges new by the after commit and lists nothing working-tree-only', async () => {
  // Mutation: judge newness against the working tree (use the working tree as the after pool) -> gamma at a:3 pairs with b:2 and the row lists it.
  // sha256(c1 src/a.ts) adff9e58cc98b735fe2c262febfc15fb575444f74c0523e188379d3e4ef51385
  // sha256(c1 src/b.ts) 1ba17d5fa9c1a98f91cfab89c75df929b6c91e702ea7876d2614d7b39c6f8071
  // sha256(c2 src/a.ts) 93c3cc1bd38b5bf0ba316530b72b3cd8fa9548013d98a7508507ec55c992d869
  // sha256(c2 src/b.ts) 1ba17d5fa9c1a98f91cfab89c75df929b6c91e702ea7876d2614d7b39c6f8071
  // sha256(working src/a.ts) 8f4e13f413a167e57e865a40cc400238bdf67c724e4c10d1529acc7c0e67df68
  const c1a = 'export function alpha() { return 1; }\n';
  const c1b = 'export function beta() { return 2; }\nexport function gamma() { return 3; }\n';
  const c2a = 'export function alpha() { return 1; }\nexport function delta() { return 4; }\n';
  const workingA = 'export function alpha() { return 1; }\nexport function delta() { return 4; }\nexport function gamma() { return 5; }\n';
  const before: Entry[] = [['src/a.ts', c1a], ['src/b.ts', c1b]];
  const after: Entry[] = [['src/a.ts', c2a], ['src/b.ts', c1b]];
  const working: Entry[] = [['src/a.ts', workingA], ['src/b.ts', c1b]];
  const w = await D.gitWorld({ before, after, working });
  const r = await w.handle.tools.compareWorkspace(w.context, {
    workspace: w.workspace,
    before: { kind: 'working_tree' },
    after: { kind: 'git', commit: w.commitAfter() },
    duplicates: true,
  });
  expect(ready(r).duplicates).toEqual({ candidates: [], coverage: { scanned: 2, skipped: 0 }, truncated: false });
});

it('row 8 does not treat a nested declaration as a top-level candidate', async () => {
  // Mutation: let readTopLevelDeclarations walk into nested nodes -> inner (a:1/b:1) is reported.
  // sha256(before a/b) 8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881
  // sha256(after a) 2793e0289e029960fc86a2310ea5c75635b3be8bea38e3d05533bc4e9fe9404d
  // sha256(after b) f7f5b084aff2affb8ea3e50b84b0e3e4b762d39d215a470bc7d34547c291b2a1
  const before: Entry[] = [['src/a.ts', 'export {};\n'], ['src/b.ts', 'export {};\n']];
  const after: Entry[] = [
    ['src/a.ts', 'export function outer() { function inner() { return 1; } }\n'],
    ['src/b.ts', 'export function inner() { return 2; }\n'],
  ];
  const w = await D.capturePair({ before, after });
  const r = await C(w);
  expect(ready(r).duplicates).toEqual({ candidates: [], coverage: { scanned: 2, skipped: 0 }, truncated: false });
});

it('row 9 reports the literal preview, length, digest and both locations exactly', async () => {
  // Mutation: use UTF-16 .slice(0,160) and .length -> preview ends in a lone high surrogate and length is 162.
  // sha256(before src/a.ts) 8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881
  // sha256(src/b.ts and after src/a.ts) 9b97e1e712abf46a0ecf215c82176d35ad6f5e3c9eeb6f5a200a6fcba6cd7ce8
  const V = 'A'.repeat(159) + '😀' + 'Z';
  const literal = `'${V}';\n`;
  const before: Entry[] = [['src/a.ts', 'export {};\n'], ['src/b.ts', literal]];
  const after: Entry[] = [['src/a.ts', literal], ['src/b.ts', literal]];
  const w = await D.capturePair({ before, after });
  const r = await C(w);
  expect(ready(r).duplicates).toEqual({
    candidates: [{
      kind: 'literal', preview: 'A'.repeat(159) + '😀', length: 161,
      digest: '6e3d2b6c4123c6a1273e940245dd8f9f9f2d4aa5de5fac1423b9e66a5ad46a57',
      first: L('src/a.ts', 1), second: L('src/b.ts', 1),
    }],
    coverage: { scanned: 2, skipped: 0 },
    truncated: false,
  });
});

it('row 10 truncates past the item cap while coverage stays whole', async () => {
  // Mutation: change limit to 51 -> candidates.length is 51 and the row is red.
  // sha256(before a/b) 8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881
  // sha256(after a/b) 0e7185312a763d5f8351cea847c04b3511590c11bc74125a414948ccfa0f9578 (1,377 bytes each)
  const capped = Array.from({ length: 51 }, (_, i) => `export function dup${pad2(i + 1)}() {}\n`).join('');
  const before: Entry[] = [['src/a.ts', 'export {};\n'], ['src/b.ts', 'export {};\n']];
  const after: Entry[] = [['src/a.ts', capped], ['src/b.ts', capped]];
  const w = await D.capturePair({ before, after });
  const r = await C(w);
  const candidates = Array.from({ length: 50 }, (_, i) => ({
    kind: 'definition', name: `dup${pad2(i + 1)}`,
    first: L('src/a.ts', i + 1), second: L('src/b.ts', i + 1),
  }));
  const report = ready(r).duplicates;
  expect(report?.candidates.length).toBe(50);
  expect(report).toEqual({ candidates, coverage: { scanned: 2, skipped: 0 }, truncated: true });
});

it('row 11 stops at the report byte budget and at the tool value budget with coverage whole', async () => {
  // Mutation A: delete the 32 KiB report cap -> A returns 24 candidates and is red.
  // Mutation B: delete the tool 60 KiB candidate fit -> B's value carries all 15 candidates and is red.
  // sha256(A before a/b) 8e609bb71c20b858c77f0e9f90bb1319db8477b13f9f965f1a1e18524bf50881
  // sha256(A after a/b) f0cb03616ccd2978400b381615a3e1c63fd03dafce4d7ba830b0618c3b77671c (48,528 bytes each)
  const namedA = Array.from({ length: 24 }, (_, i) => `export function n${pad2(i + 1)}_${'x'.repeat(1996)}() {}\n`).join('');
  const beforeA: Entry[] = [['src/name/a.ts', 'export {};\n'], ['src/name/b.ts', 'export {};\n']];
  const afterA: Entry[] = [['src/name/a.ts', namedA], ['src/name/b.ts', namedA]];
  const wA = await D.capturePair({ before: beforeA, after: afterA });
  const rA = await C(wA);
  const candidatesA = Array.from({ length: 15 }, (_, i) => ({
    kind: 'definition', name: `n${pad2(i + 1)}_${'x'.repeat(1996)}`,
    first: L('src/name/a.ts', i + 1), second: L('src/name/b.ts', i + 1),
  }));
  expect(ready(rA).duplicates).toEqual({ candidates: candidatesA, coverage: { scanned: 2, skipped: 0 }, truncated: true });

  // sha256(B long before) 5d8f65d2774e206bc9f7a7a4ad39ca2dc563b5c31e46ab57ef4874961237ce29 (24 bytes each)
  // sha256(B long after) f4918c8ac9858f83b2c0307536179d6bd283bc7c20ba34b53074721f43611f4a (24 bytes each)
  // sha256(B src/name/a.ts and b.ts after) f0cb03616ccd2978400b381615a3e1c63fd03dafce4d7ba830b0618c3b77671c (48,528 bytes each)
  const longPath = (i: number) =>
    'src/' + ['a'.repeat(200), 'b'.repeat(200), 'c'.repeat(200), 'd'.repeat(200), 'e'.repeat(200)].join('/') + '/f' + pad2(i) + '.ts';
  const beforeB: Entry[] = Array.from({ length: 30 }, (_, i): Entry => [longPath(i + 1), 'export const value = 1;\n']);
  const afterB: Entry[] = [
    ...Array.from({ length: 30 }, (_, i): Entry => [longPath(i + 1), 'export const value = 2;\n']),
    ['src/name/a.ts', namedA],
    ['src/name/b.ts', namedA],
  ];
  const wB = await D.gitWorld({ before: beforeB, after: afterB, working: [] });
  const tool = createProjectSourceTool({
    access: {
      port: wB.handle.tools, workspace: wB.workspace, context: () => wB.context,
      currentWorkspaceRevision: async () => ({ status: 'ready', value: 1 }), close: async () => {},
    },
    requireVisible: () => {},
  });
  const out = await tool.handler.execute({
    schemaVersion: 1, callId: 'r11', name: 'project_source',
    arguments: {
      action: 'compare',
      before: { kind: 'git', commit: wB.commitBefore() },
      after: { kind: 'git', commit: wB.commitAfter() },
      duplicates: true,
    },
  }, { signal: new AbortController().signal });
  expect(out.status).toBe('success');
  if (out.status !== 'success') throw Error(`project_source compare failed: ${JSON.stringify(out)}`);
  const payload = out.output[0] as unknown as { value: WorkspaceResult<WorkspaceComparison> };
  const value = ready(payload.value);
  const candidatesB = Array.from({ length: 11 }, (_, i) => ({
    kind: 'definition', name: `n${pad2(i + 1)}_${'x'.repeat(1996)}`,
    first: L('src/name/a.ts', i + 1), second: L('src/name/b.ts', i + 1),
  }));
  expect(value.changes.length).toBe(32);
  expect(value.duplicates).toEqual({ candidates: candidatesB, coverage: { scanned: 32, skipped: 0 }, truncated: true });
  expect(Buffer.byteLength(JSON.stringify(payload.value))).toBeLessThanOrEqual(61_440);
});

it('row 12a counts an unreadable after-side source file as skipped coverage', async () => {
  // Mutation: omit the unreadable path without incrementing skipped -> skipped is 0 and the row is red.
  // sha256(src/a.ts before) adff9e58cc98b735fe2c262febfc15fb575444f74c0523e188379d3e4ef51385
  // sha256(src/b.ts) 4c525f54dc7f98cab36f5a2a30e206b23e684a8af104781093549fb4ef9c7657
  // sha256(src/a.ts after) 8b02df9b2518ed37014fff4ddcc8e691cdc6ad664c4352976402dadac15f5023
  // sha256(src/bad.ts bytes) ca4c600c4daa7806cea3fb6bfbefe7939a78035cf4545dc468ddd889f4bd9221 (23 bytes)
  const before: Entry[] = [
    ['src/a.ts', 'export function alpha() { return 1; }\n'],
    ['src/b.ts', 'export function beta() { return 2; }\n'],
  ];
  const after: Entry[] = [
    ['src/a.ts', 'export function alpha() { return 1; }\nexport function beta() { return 3; }\n'],
    ['src/b.ts', 'export function beta() { return 2; }\n'],
    ['src/bad.ts', new TextEncoder().encode('export const bad = 1;\0\n')],
  ];
  const w = await D.gitWorld({ before, after, working: [] });
  const r = await G(w);
  expect(ready(r).duplicates).toEqual({
    candidates: [{ kind: 'definition', name: 'beta', first: L('src/a.ts', 2), second: L('src/b.ts', 1) }],
    coverage: { scanned: 3, skipped: 1 },
    truncated: false,
  });
});

it('row 12b refuses an invalid duplicates argument at the schema and at the port', async () => {
  // Mutation: widen the tool schema to z.boolean() -> the duplicates:false schema assertion parses and the row is red.
  // sha256(row 1 src/a.ts before) adff9e58cc98b735fe2c262febfc15fb575444f74c0523e188379d3e4ef51385
  // sha256(row 1 src/a.ts after) 9a82116fe6243a688241e8b8e49833e29a2b18fb921bfd9e054c7a06621a990d
  // sha256(row 1 src/b.ts) aa1b67eefb30db1c6f7c8a21b1e381fb83bbd9f28049dfb963752e0c4575959a
  const alpha = 'export function alpha() { return 1; }\n';
  const beta = "export function beta() { return '0123456789012345678901234567890123456789'; }\n";
  const w = await D.capturePair({
    before: [['src/a.ts', alpha]],
    after: [['src/a.ts', alpha + beta], ['src/b.ts', beta]],
  });
  expect(projectSourceInputSchema.safeParse({
    action: 'compare', before: w.before, after: w.after, duplicates: false,
  }).success).toBe(false);
  expect(projectSourceInputSchema.safeParse({
    action: 'compare', before: w.before, after: w.after, duplicates: 'yes',
  }).success).toBe(false);
  const r = await w.handle.tools.compareWorkspace(w.context, {
    workspace: w.workspace,
    before: { kind: 'capture', capture: w.before },
    after: { kind: 'capture', capture: w.after },
    duplicates: false,
  } as never);
  expect(r).toEqual({ status: 'rejected', code: 'invalid', reason: 'duplicates must be true when present' });
});
