import { expect } from 'vitest';
import type { ArchitectureObservationStateV1 } from '../../../src/contracts/architecture-observation.js';
import type { ArchitectureChangeScopeV1 } from '../../../src/contracts/architecture-search.js';
import type { ArchCatalogRead, ArchFilesRead, ArchObservedRead } from '../../../src/ui/adapters/arch-overview.js';
import type { S6ARequestWorld } from '../../helpers/S6A-request-fixture.js';
import { bootPage, findButton, findClass, findElement, type BootedPage, type PageFetch } from './boot-page.js';
import type { FakeElement } from './dom.js';
import { click } from './E3N-interact.js';
import { descendants, forwardPage, hasClass, newPageLog, routeOf, textOf, type PageLog } from './E3N-page.js';

/**
 * B2-F (DARR B2 tests §1.1): the page-contract world of the ArchOverview counts,
 * layering and "改动 n" rows. A real S6A Host answers the page text, the token,
 * `bootstrap`, `goals/read` and the change stream; the routes below are answered
 * with fixed values that are only the page's input (the `bootArchMissingObservation`
 * way, one answer per route), never a store write or a stand-in Host. Every
 * literal is the test's own; the rows' expectations are hand-computed from it.
 */

export const WG = 'src/core/work-graph';
export const STATE = 'src/core/work-graph/state';

/** The prototype's ten top-level modules, in the prototype's order. */
const TOP_MODULES: ReadonlyArray<readonly [string, string]> = [
  ['src/ui', 'UI'], ['src/app', 'Host'], ['src/composition', 'Composition'],
  ['src/business/workflow', 'Workflow'], ['src/core/agent-runtime', 'AgentRuntime'], [WG, 'WorkGraph'],
  ['src/core/workspace', 'WorkspaceTools'], ['src/core/record-store', 'RecordStore'],
  ['src/contracts', 'Contracts'], ['vendor/coding-agent', 'Kernel'],
];

/** WorkGraph's seven interface groups and the one source file each owns. */
export const B2_FILES = {
  architecture: `${WG}/architecture/architecture-service.ts`,
  model: `${WG}/model/model.ts`,
  tasks: `${WG}/tasks/task-service.ts`,
  persistence: `${WG}/persistence/persistence.ts`,
  notes: `${WG}/notes/notes.ts`,
  views: `${WG}/views/views.ts`,
  runtime: `${WG}/runtime/runtime.ts`,
} as const;

type B2Interface = keyof typeof B2_FILES;
const INTERFACES = Object.keys(B2_FILES) as B2Interface[];

export const B2 = {
  machine: `${STATE}/task-machine.ts`,
  host: 'src/app/host.ts',
  boot: 'src/ui/boot.ts',
  persistenceMd: `${WG}/persistence/persistence.md`,
  /** The eight support areas' files: no catalog module claims any of them. */
  support: ['tests/t.ts', 'docs/d.md', 'scripts/s.mjs', 'resources/r.md', 'tools/t.ts', '.github/ci.yml', '.local/l.ts', 'README.md'],
} as const;

export type B2Variant = {
  /** `architecture/change-scope`'s `complete` (B2-10 uses `false`). */
  complete?: boolean;
  /** B2-06 ②: the persistence group's one file is `persistence.md` (no code). */
  persistenceMd?: boolean;
};

const interfaceNode = (id: string): string => `interface:${JSON.stringify([WG, id])}`;

function edge(fromNode: string, toNode: string, kind: ArchObservedRead['edges'][number]['kind'], count: number):
ArchObservedRead['edges'][number] {
  const structuralKey = JSON.stringify([fromNode, toNode]);
  return { edgeId: structuralKey, fromNode, toNode, kind, structuralKey, count };
}

/** The fixed route answers of §1.1, keyed by route; `goalId` is the world's first Goal. */
export function b2Reads(world: S6ARequestWorld, goalId: string, variant: B2Variant = {}): Record<string, unknown> {
  const { projectId, workspaceId } = world.scope;
  const ref = (moduleId: string) => ({ projectId, moduleId });
  const catalog: ArchCatalogRead = { catalog: { catalog: {
    requireDag: true,
    dependencies: [],
    containment: { parentOf: [{ parent: ref(WG), child: ref(STATE) }] },
    modules: [
      ...TOP_MODULES.map(([moduleId, name]) => ({
        ref: ref(moduleId), name, responsibility: `${name} 的职责`, paths: [moduleId],
        interfaces: moduleId !== WG ? [] : INTERFACES.map((id) => ({ id, description: `${id} 接口`, paths: [`${WG}/${id}`] })),
      })),
      { ref: ref(STATE), name: 'state', responsibility: '状态机', paths: [STATE], interfaces: [] },
    ],
  } } };
  const observation: ArchitectureObservationStateV1 = {
    current: {
      captureRef: { aggregateType: 'ObservedArchitecture', projectId, workspaceId, captureId: 'b2-capture' },
      persistedRef: {
        capture: { projectId, workspaceId, captureId: 'b2-capture', workspaceRevision: 1,
          sourceDigest: 'd', configDigest: 'd', indexVersion: 'typescript-source-index@1' },
        material: { kind: 'artifact', contentType: 'application/json', digest: 'd', sizeBytes: 1,
          source: { kind: 'workspace', refId: workspaceId, revision: '1' } },
      },
      observedAt: '2026-11-10T01:00:00.000Z',
    },
    previous: null, previousPersistedRef: null, autoCapture: null,
  };
  const moduleNode = (moduleId: string, name: string): ArchObservedRead['nodes'][number] => ({
    nodeId: `module:${moduleId}`, kind: 'module', name, path: moduleId, structuralKey: `module:${moduleId}`, contentDigest: 'd',
  });
  const observed: ArchObservedRead = {
    nodes: [
      ...TOP_MODULES.map(([moduleId, name]) => moduleNode(moduleId, name)),
      moduleNode(STATE, 'state'),
      ...INTERFACES.map((id): ArchObservedRead['nodes'][number] => ({ nodeId: interfaceNode(id), kind: 'interface', name: id,
        path: `${WG}/${id}`, structuralKey: interfaceNode(id), contentDigest: 'd' })),
    ],
    edges: [
      edge(interfaceNode('architecture'), interfaceNode('model'), 'interface_uses', 59),
      edge(interfaceNode('tasks'), interfaceNode('architecture'), 'interface_uses', 114),
      edge('module:src/app', `module:${WG}`, 'module_dependency', 3),
    ],
    unresolved: [],
    nextCursor: null,
  };
  const own = INTERFACES.map((id) => (id === 'persistence' && variant.persistenceMd === true ? B2.persistenceMd : B2_FILES[id]));
  const files: ArchFilesRead = { paths: [...own, B2.machine, B2.host, B2.boot, ...B2.support], partial: false };
  const changes: ArchitectureChangeScopeV1 = {
    goalRef: { aggregateType: 'Goal', projectId, goalId },
    files: [
      { path: B2_FILES.architecture, certainty: 'definite', interfaceId: 'architecture', moduleRef: ref(WG) },
      { path: B2_FILES.tasks, certainty: 'definite', interfaceId: 'tasks', moduleRef: ref(WG) },
      { path: B2.machine, certainty: 'definite', interfaceId: null, moduleRef: ref(STATE) },
      { path: B2.host, certainty: 'possible', interfaceId: null, moduleRef: ref('src/app') },
    ],
    modules: [
      { moduleRef: ref('src/app'), changed: 0, possible: 1 },
      { moduleRef: ref(WG), changed: 2, possible: 0 },
      { moduleRef: ref(STATE), changed: 1, possible: 0 },
    ],
    counts: { files: 4, changed: 3, possible: 1 },
    complete: variant.complete ?? true,
    sourceCursor: null,
  };
  const task = { projectId, goalId, taskId: 'b2-task' };
  const tasks = {
    plan: {
      ref: { aggregateType: 'PlanRevision', projectId, planId: 'b2-plan', revision: 1 },
      stages: [{ stageId: 'S1', title: '接口整理', description: '整理 WorkGraph 的接口组。' }],
      obligations: [],
      executionDag: { dependsOn: [] },
    },
    tasks: [{
      ref: task,
      definition: { taskId: task.taskId, stageId: 'S1', title: '架构接口改造', requirementLevel: 'required', taskKind: 'work',
        disposition: 'active', phase: 'pending', scope: { kind: 'stage', stageId: 'S1' },
        plannedFiles: [B2_FILES.architecture], executionIntent: 'request_execution', instruction: '改 architecture 接口。' },
      effectivePhase: 'pending', disposition: 'active', eligibility: { eligible: false }, phaseCause: { code: '' },
      attemptOrdinal: 1, rework: { entries: [], cap: 3 },
    }],
    sourceCursor: null,
  };
  const exact = (value: number) => ({ status: 'exact', value });
  const lines = {
    rows: [{
      key: { projectId, sessionId: 'b2-exec' }, duty: 'executor',
      name: { source: 'duty_only', primary: '执行者', extraCount: 0, ordinal: null, tasks: [], goalRef: null, complete: true },
      status: { own: 'working', ownReason: { code: 'idle', params: {}, refs: [] }, attention: null,
        attentionCounts: { decide: 0, failed: 0, blocked: 0, unknown: 0 }, attentionComplete: true,
        doneEvidence: 'not_applicable', partialParts: [], markers: [], bucket: 'working', archivedTag: null, readOnly: false },
      runningCap: null,
      responsibleNow: [{ task, title: '架构接口改造', phase: 'pending', disposition: 'active', phaseCause: null, attention: null }],
      doneTasks: null, retired: null, groups: { duty: 'executor', module: null, task: null, alsoMaintains: [] },
      sessionCount: exact(1), chainSessions: [{ projectId, sessionId: 'b2-exec' }], pinned: false, pinnedBy: [],
      lastActivityAt: '2026-11-10T01:00:00.000Z', sortKey: 'b2-exec', controls: [], problem: null,
    }],
    counts: { working: exact(1), standby: exact(0), archived: { ...exact(0), asOf: null } },
    legacyUnchecked: exact(0), attentionComplete: true, attentionProblem: null,
    readWindow: { from: null, to: null },
  };
  const notes = { items: [], next: null, complete: true, readBasis: {}, warnings: [],
    coverage: { checkedItems: 0, uncheckedItems: 0, filesRead: 0 } };
  const readyReply = (value: unknown) => ({ status: 'ready', value });
  return {
    'architecture/read': readyReply(catalog),
    'architecture/observation-state': readyReply(observation),
    'architecture/query': readyReply(observed),
    'files/list': readyReply(files),
    'tasks/query': readyReply(tasks),
    'lines/list': readyReply(lines),
    'notes/list': readyReply(notes),
    'architecture/change-scope': readyReply(changes),
  };
}

/**
 * Boot ArchOverview against the real Host with `answers` (route -> reply body)
 * replacing those routes' replies; every other request reaches the Host. Every
 * call still enters the E3W page log, so the request-set rows count the
 * replaced routes too.
 */
export async function bootArchAnswers(world: S6ARequestWorld, answers: Record<string, unknown>,
  search?: string): Promise<{ page: BootedPage; log: PageLog }> {
  const log = newPageLog();
  const forward = forwardPage(world, log);
  const pageRequest: PageFetch = async (url, init, realFetch) => await forward(url, init, async (target, targetInit) => {
    const answer = answers[routeOf(String(target))];
    if (answer === undefined) return await realFetch(target, targetInit);
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const page = await bootPage({
    name: 'ArchOverview',
    ...(search === undefined ? {} : { search }),
    token: () => world.token,
    request: pageRequest,
  });
  return { page, log };
}

/** The B2-F boot: `?goal=` the world's first Goal, or no `?goal=` at all (B2-11). */
export async function bootB2(world: S6ARequestWorld, options: { goal?: boolean; variant?: B2Variant } = {}):
Promise<{ page: BootedPage; log: PageLog }> {
  const goalId = world.goals.first.goalId;
  return await bootArchAnswers(world, b2Reads(world, goalId, options.variant),
    options.goal === false ? undefined : '?goal=' + goalId);
}

/* ---------------------------------------------------------------- DOM reads */

/** One graph node (`div.ov-node`) whose `.ov-name` is exactly `name`. */
export function graphNode(root: FakeElement, name: string): FakeElement | undefined {
  return findElement(root, (element) => hasClass(element, 'ov-node') && textOf(findClass(element, 'ov-name')) === name);
}

/** The node's head button (`button.ov-head`), the element a click reaches. */
export function nodeHead(node: FakeElement): FakeElement | undefined {
  return findElement(node, (element) => element.tagName.toLowerCase() === 'button' && hasClass(element, 'ov-head'));
}

/** SYS → select WorkGraph → 进入这一层: the person's two clicks into WorkGraph. */
export function enterWorkGraph(root: FakeElement): void {
  const workGraph = graphNode(root, 'WorkGraph');
  expect(workGraph).toBeDefined();
  click(nodeHead(workGraph!)!);
  const enter = findButton(root, '进入这一层');
  expect(enter).toBeDefined();
  click(enter!);
}

/** The `left`/`top`/`width`/`height` pixels of an absolutely placed element's style. */
export function placed(element: FakeElement): { x: number; y: number; w: number; h: number } {
  const style = element.getAttribute('style') ?? '';
  const px = (name: string): number => {
    const match = new RegExp(`(?:^|;)\\s*${name}:\\s*(-?[\\d.]+)px`).exec(style);
    return match === null ? Number.NaN : Number(match[1]);
  };
  return { x: px('left'), y: px('top'), w: px('width'), h: px('height') };
}

/** Every `div.ov-box` with its title text. */
export function boxes(root: FakeElement): Array<{ name: string; element: FakeElement }> {
  return descendants(root).filter((element) => element.tagName.toLowerCase() === 'div' && hasClass(element, 'ov-box'))
    .map((element) => ({ name: textOf(findClass(element, 'ov-box-t')), element }));
}

/** Whether the node's top-left corner lies inside the box's rectangle. */
export function insideBox(node: FakeElement, box: FakeElement): boolean {
  const n = placed(node);
  const b = placed(box);
  return n.x >= b.x && n.x < b.x + b.w && n.y >= b.y && n.y < b.y + b.h;
}

/** The text of every `button.ov-count` (the edge count labels). */
export function countLabels(root: FakeElement): string[] {
  return descendants(root).filter((element) => element.tagName.toLowerCase() === 'button' && hasClass(element, 'ov-count'))
    .map((element) => textOf(element));
}

/** The detail's state line (`p.d-state`): the state word or the change text, with its why. */
export function detailState(root: FakeElement): string {
  const detail = findClass(root, 'detail');
  return textOf(detail === undefined ? undefined : findClass(detail, 'd-state'));
}
