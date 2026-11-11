/**
 * KLS-2b pure rows BP1–BP4 (A5): the file form of a link, a flow and a repair note in the line's file frame; a
 * note's derived index rows; the project view merged from each workspace's architecture files; and a Plan draft's
 * module ids taken from the caller frame once. Every input is a literal; every expectation is written by hand.
 */
import { describe, expect, it } from 'vitest';
import type { AdoptedArchitecture } from '../../src/contracts/architecture-catalog.js';
import type { NoteBodyV1, NoteSourceV1 } from '../../src/contracts/note.js';
import type { PlanRevisionDraft } from '../../src/contracts/plan.js';
import type {
  KnowledgeArchitecture, KnowledgeBaselineV1, KnowledgeLineScope, NoteKnowledgeV1,
} from '../../src/core/work-graph/model/line-knowledge.js';
import { noteFileBytes, noteKnowledgeOf, noteOfFileBytes } from '../../src/core/work-graph/notes/note-file.js';
import { noteDerivedRowsOf } from '../../src/core/work-graph/notes/note-knowledge.js';
import { projectArchitectureOf } from '../../src/core/work-graph/architecture/project-architecture.js';
import { qualifyPlanDraft } from '../../src/core/work-graph/tasks/plan-validation.js';

const MAIN: KnowledgeLineScope = { workspaceId: 'ws', mainWorkspaceId: 'ws' };
const SECOND: KnowledgeLineScope = { workspaceId: 'ws2', mainWorkspaceId: 'ws' };
const PROJECT = 'p';
const USER: NoteSourceV1 = { kind: 'user', principalId: 'u1' };

/** The value of a `decoded` result; an `invalid` one fails the row with its reason. */
function decodedOf<T>(result: { status: 'decoded'; value: T } | { status: 'invalid'; reason: string }): T {
  if (result.status !== 'decoded') throw new Error(`expected decoded, got invalid: ${result.reason}`);
  return result.value;
}
/** The JSON header of a note file: the lines between the version line and the first `---` line. */
function headerOf(bytes: Uint8Array): Record<string, unknown> {
  const lines = new TextDecoder().decode(bytes).split('\n');
  return JSON.parse(lines.slice(1, lines.indexOf('---')).join('\n')) as Record<string, unknown>;
}

describe('BP1 a link, a flow and a repair note in its file: only the knowledge fields, in the file frame', () => {
  const head = { topic: 't', topicKey: 't', conclusion: 'c', body: 'b', facts: [], structural: false,
    basis: { planRevision: null, catalogRevision: null, files: [] }, replaces: [], contradicts: [], coexistWith: [],
    source: USER };
  const knowledge = { source: USER, topic: 't', conclusion: 'c', body: 'b', structural: false, facts: [], basisFiles: [],
    replaces: [], contradicts: [], coexistWith: [] };
  const symbol = { language: 'typescript', qualifiedName: 'run', signatureDigest: 's1',
    range: { startLine: 1, endLine: 3 }, fileDigest: 'f0' };
  const linkEnds = { from: { kind: 'module', moduleId: '/@ws:ws2/svc' }, to: { kind: 'module', moduleId: 'core' },
    via: null } as const;
  // A) the second workspace's link with every write-time result the record keeps (resolved symbol, digests, config).
  const link: NoteBodyV1 & { source: NoteSourceV1 } = { ...head, kind: 'link',
    anchor: { kind: 'module', moduleId: '/@ws:ws2/svc' }, extraAnchors: [{ kind: 'module', moduleId: 'core' }],
    link: { relation: 'data', ends: linkEnds,
      key: { kind: 'symbol', path: '/@ws:ws2/src/a.ts', symbolRequest: { language: 'typescript', name: 'run' }, symbol },
      evidence: [
        { role: 'emit', at: { path: '/@ws:ws2/src/a.ts' }, fileDigest: 'f1', digestBasis: 'raw_bytes' },
        { role: 'receive', at: { path: 'src/core/b.ts' }, fileDigest: 'f2', digestBasis: 'raw_bytes' },
      ],
      analysisConfig: { path: 'tsconfig.json', digest: 'c1' }, verification: { status: 'verified' } } };
  const linkKnowledge: NoteKnowledgeV1 = { ...knowledge, kind: 'link',
    anchor: { kind: 'module', moduleId: '/@ws:ws2/svc' }, extraAnchors: [{ kind: 'module', moduleId: 'core' }],
    link: { relation: 'data', ends: linkEnds,
      key: { kind: 'symbol', path: '/@ws:ws2/src/a.ts', symbolRequest: { language: 'typescript', name: 'run' } },
      evidence: [{ role: 'emit', at: { path: '/@ws:ws2/src/a.ts' } }, { role: 'receive', at: { path: 'src/core/b.ts' } }] } };
  const linkInFile = { relation: 'data',
    ends: { from: { kind: 'module', moduleId: 'svc' }, to: { kind: 'module', moduleId: '/@ws:ws/core' }, via: null },
    key: { kind: 'symbol', path: 'src/a.ts', symbolRequest: { language: 'typescript', name: 'run' } },
    evidence: [{ role: 'emit', at: { path: 'src/a.ts' } }, { role: 'receive', at: { path: '/@ws:ws/src/core/b.ts' } }] };
  // B) a flow keeps only its steps.
  const steps = [{ link: 'n1' }, { link: 'n2' }];
  const flow: NoteBodyV1 & { source: NoteSourceV1 } = { ...head, kind: 'flow',
    anchor: { kind: 'module', moduleId: 'core' }, extraAnchors: [], flow: { steps } };
  const flowKnowledge: NoteKnowledgeV1 = { ...knowledge, kind: 'flow', anchor: { kind: 'module', moduleId: 'core' },
    extraAnchors: [], flow: { steps } };
  // C) a main-workspace repair: the pin and the responsibility moves stay in the record.
  const ops = [{ op: 'set_responsibility' as const, moduleId: 'core', text: 't' }];
  const repair: NoteBodyV1 & { source: NoteSourceV1 } = { ...head, kind: 'repair',
    anchor: { kind: 'module', moduleId: 'core' }, extraAnchors: [],
    repair: { pin: { catalogRef: { aggregateType: 'ArchitectureCatalog', projectId: PROJECT, baselineId: 'b', revision: 1 },
      baseline: { ref: { aggregateType: 'ArchitectureBaselineRevision', projectId: PROJECT, baselineId: 'b', revision: 1 },
        digest: 'd' } }, ops, responsibilityMoves: [], structural: false } };
  const repairKnowledge: NoteKnowledgeV1 = { ...knowledge, kind: 'repair', anchor: { kind: 'module', moduleId: 'core' },
    extraAnchors: [], repair: { ops } };

  it.each([
    ['A a second-workspace link', link, linkKnowledge, SECOND, 'link', linkInFile],
    ['B a flow', flow, flowKnowledge, MAIN, 'flow', { steps: [{ link: 'n1' }, { link: 'n2' }] }],
    ['C a repair', repair, repairKnowledge, MAIN, 'repair',
      { ops: [{ op: 'set_responsibility', moduleId: 'core', text: 't' }] }],
  ] as const)('%s', (_label, body, expected, scope, field, inFile) => {
    expect(noteKnowledgeOf(body)).toEqual(expected);
    const bytes = decodedOf(noteFileBytes(expected, scope));
    expect(headerOf(bytes)[field]).toEqual(inFile);
    expect(noteOfFileBytes(bytes, scope)).toEqual({ status: 'decoded', value: expected });
  });
});

describe('BP2 a note\'s derived index rows', () => {
  const note = { source: USER, topic: 'T', conclusion: 'C', body: 'Body', structural: false, facts: [], basisFiles: [],
    replaces: [], contradicts: [], coexistWith: [] };

  it('a decision: every knowledge anchor key, primary first, and the normalized text', () => {
    const rows = noteDerivedRowsOf({ ...note, kind: 'decision', anchor: { kind: 'module', moduleId: 'core' },
      extraAnchors: [{ kind: 'file', path: 'src/x.ts' }, { kind: 'interface', moduleId: 'core', interfaceId: 'api' }] });
    expect(rows.anchorKeys).toEqual(['module:core', 'file:src/x.ts', 'interface:core/api']);
    expect(rows.text).toBe('t\nc\nbody');
    expect(rows.edges).toEqual([]);
  });

  it('a link: one edge, to its from end (ruling 8 #4: the edge kinds are link_from and flow_step)', () => {
    const rows = noteDerivedRowsOf({ ...note, kind: 'link', anchor: { kind: 'module', moduleId: 'core' },
      extraAnchors: [{ kind: 'module', moduleId: 'billing' }, { kind: 'module', moduleId: 'bus' }],
      link: { relation: 'data', key: { kind: 'literal', text: 'k' }, evidence: [],
        ends: { from: { kind: 'module', moduleId: 'core' }, to: { kind: 'module', moduleId: 'billing' },
          via: { kind: 'module', moduleId: 'bus' } } } });
    expect(rows.edges).toEqual([{ toRef: 'module:core', kind: 'link_from' }]);
  });
});

describe('BP3 the project view merged from each workspace\'s files', () => {
  const ref = (moduleId: string) => ({ projectId: PROJECT, moduleId });
  const moduleDef = (moduleId: string, paths: string[]) => ({ ref: ref(moduleId), name: moduleId,
    responsibility: `own ${moduleId}`, paths, interfaces: [] });
  const BASELINE: KnowledgeBaselineV1 = { description: 'd', constraints: [] };
  const mainPart = (catalog: Partial<AdoptedArchitecture> = {}, baseline: KnowledgeBaselineV1 | null = BASELINE) => ({
    scope: MAIN, architecture: { baseline, crossWorkspace: { dependencies: [], parentOf: [] },
      catalog: { requireDag: true, modules: [moduleDef('core', ['src/core'])], dependencies: [], ...catalog } } });
  /** ws2's `svc`, with one cross-workspace dependency on `to` (a project-view id). */
  const secondPart = (to: string) => ({
    scope: SECOND, architecture: { baseline: null,
      catalog: { requireDag: true, modules: [moduleDef('/@ws:ws2/svc', ['/@ws:ws2/src'])], dependencies: [] },
      crossWorkspace: { dependencies: [{ from: ref('/@ws:ws2/svc'), to: ref(to), reason: 'r' }], parentOf: [] } } });
  type Parts = { scope: KnowledgeLineScope; architecture: KnowledgeArchitecture }[];

  it('① the main and the second workspace\'s modules and the edge between them', () => {
    const merged = decodedOf(projectArchitectureOf([mainPart(), secondPart('core')] as Parts, PROJECT));
    expect(merged.catalog.modules.map(module => module.ref.moduleId).sort()).toEqual(['/@ws:ws2/svc', 'core']);
    expect(merged.catalog.dependencies).toEqual([{ from: ref('/@ws:ws2/svc'), to: ref('core'), reason: 'r' }]);
    expect(merged.baseline).toEqual({ description: 'd', constraints: [] });
  });

  it('② an edge to a workspace the project no longer has is left out', () => {
    const merged = decodedOf(projectArchitectureOf([mainPart(), secondPart('/@ws:ws3/x')] as Parts, PROJECT));
    expect(merged.catalog.dependencies).toEqual([]);
  });

  it.each([
    ['③ an edge to a module the main workspace does not declare', [mainPart(), secondPart('missing')]],
    ['④ the main workspace has no baseline', [mainPart({}, null), secondPart('core')]],
    ['⑤ one workspace declares containment and the other does not',
      [mainPart({ containment: { parentOf: [] } }), secondPart('core')]],
  ])('%s is invalid', (_label, parts) => {
    expect(projectArchitectureOf(parts as Parts, PROJECT).status).toBe('invalid');
  });
});

describe('BP4 a Plan draft\'s module ids go from the goal workspace\'s frame to the project view once', () => {
  const draftWith = (moduleRef: string): PlanRevisionDraft => ({ schemaVersion: 2, planId: 'p1', planRevision: 1,
    goalId: 'g', stages: [{ stageId: 's1', title: 'S' }],
    tasks: [{ taskId: 't1', stageId: 's1', title: 'T', requirementLevel: 'required', taskKind: 'work',
      disposition: 'active', phase: 'pending', scope: { kind: 'module', stageId: 's1', moduleRef } }],
    obligations: [], taskHierarchy: { parentOf: [] }, executionDag: { dependsOn: [] } });

  it.each([
    ['the goal in ws2, its own module bare', 'ws2', 'svc', '/@ws:ws2/svc'],
    ['the goal in ws2, a main-workspace module prefixed', 'ws2', '/@ws:ws/core', 'core'],
    ['the goal in the main workspace', 'ws', 'core', 'core'],
  ])('%s', (_label, goalWorkspaceId, moduleRef, expected) => {
    expect(qualifyPlanDraft(draftWith(moduleRef), goalWorkspaceId, 'ws').tasks[0]!.scope)
      .toEqual({ kind: 'module', stageId: 's1', moduleRef: expected });
  });
});
