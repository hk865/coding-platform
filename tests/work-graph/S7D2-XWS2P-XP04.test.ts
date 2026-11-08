/**
 * XWS2P XP-04 — the directory comparison runs for ONE workspace at a time.
 *
 * Pure function, hand-built catalog and file graph (S8A's own shapes). The one
 * project catalog has the main workspace's root `M0` (`.`), the main
 * workspace's `M1` (`src`) and the second workspace's `M2` (`/@ws:ws%2F2/src`).
 * The second workspace's file graph holds `src/a.ts` and `other/b.ts`; no module
 * of the second workspace owns `other/b.ts`, so it must stay `ungrouped` — the
 * main workspace's root module must not swallow it.
 *
 * Named mutation (`src/core/work-graph/architecture/formal-comparison.ts:30–:33`):
 * delete the `catalogForWorkspace(...)` call and compare the original catalog →
 * the second workspace's `src/a.ts` becomes `ungrouped` and `other/b.ts` is
 * swallowed by `M0`; assertions 1 and 2 red.
 *
 * Reversal in the same row: hand `catalogForWorkspace` the wrong `mainWorkspaceId`
 * (the second workspace as the main one) → `M2` is dropped, `src/a.ts` becomes
 * `ungrouped`, assertion 1 red: the main-workspace decision is necessary.
 */
import { describe, expect, it } from 'vitest';
import type { AdoptedArchitecture, ModuleDefinition } from '../../src/contracts/architecture-catalog.js';
import type { LanguageCoverageV1 } from '../../src/contracts/architecture-inspection.js';
import type { ModuleRef } from '../../src/contracts/core/identity.js';
import type {
  ProjectFileGraphNodeV1, ProjectFileGraphV1,
} from '../../src/core/workspace/architecture-language-provider.js';
import { compareFormalObservedGraphs } from '../../src/core/work-graph/architecture/formal-comparison.js';

const PROJECT = 'xws2p-project';
const MAIN = 'ws1';
const SECOND = 'ws/2';

const ref = (moduleId: string): ModuleRef => ({ projectId: PROJECT, moduleId });
const moduleDef = (moduleId: string, paths: string[]): ModuleDefinition =>
  ({ ref: ref(moduleId), name: moduleId, responsibility: `${moduleId} responsibility`, paths, interfaces: [] });
const node = (path: string): ProjectFileGraphNodeV1 =>
  ({ path, digest: 'a'.repeat(64), byteSize: 1, language: 'typescript', nonBlankLines: 1, indexed: true });
const coverage = (files: number): LanguageCoverageV1 => ({
  language: 'typescript', files, parsed: files, edges: 'supported', reason: null,
  notes: [], issues: [], issueCount: 0, complete: true,
});
const graph = (paths: readonly string[]): ProjectFileGraphV1 => ({
  nodes: paths.map(node), edges: [], unresolved: [], languages: [coverage(paths.length)],
  complete: true, inventory: { source: 'skip_list', reason: '不是 git 仓库' },
});

const architecture: AdoptedArchitecture = {
  modules: [moduleDef('M0', ['.']), moduleDef('M1', ['src']), moduleDef('M2', ['/@ws:ws%2F2/src'])],
  dependencies: [], requireDag: true,
};

describe('XP-04 one workspace per comparison', () => {
  it('the second workspace compares its own files against the one project catalog', () => {
    const findings = compareFormalObservedGraphs({
      architecture, fileGraph: graph(['src/a.ts', 'other/b.ts']),
      workspaceId: SECOND, mainWorkspaceId: MAIN,
    });

    // 1. src/a.ts is M2's: no finding names it, and no finding is M1's or M0's.
    expect(findings.filter(finding => finding.path === 'src/a.ts')).toEqual([]);
    expect(findings.filter(finding => finding.kind === 'ambiguous')).toEqual([]);
    expect(findings.some(finding => finding.moduleRef?.moduleId === 'M1'
      || finding.moduleRef?.moduleId === 'M0')).toBe(false);
    // 2. The main workspace's root module `.` does not swallow the second workspace's other/b.ts.
    expect(findings).toEqual([
      { kind: 'ungrouped', moduleRef: null, path: 'other/b.ts', detail: '不在任何模块 path 下', certainty: 'unknown' },
    ]);
  });

  it('the main workspace compares its own files, and its root module owns the ungrouped one', () => {
    const findings = compareFormalObservedGraphs({
      architecture, fileGraph: graph(['src/a.ts', 'other/b.ts']),
      workspaceId: MAIN, mainWorkspaceId: MAIN,
    });

    // 3. src/a.ts is M1's (longest prefix) and other/b.ts is M0's: no finding at all.
    expect(findings).toEqual([]);
    // 4. Both calls used the SAME one project catalog (the input takes no second catalog).
    expect(architecture.modules.map(module => module.ref.moduleId)).toEqual(['M0', 'M1', 'M2']);
  });
});
