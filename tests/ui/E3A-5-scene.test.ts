import { describe, expect, it } from 'vitest';
import raw from './scenes/ArchOverview.scene.json' with { type: 'json' };
import type { BootstrapReply } from '../../src/ui/host-client.js';
import type {
  ArchCatalogRead, ArchFilesRead, ArchObservedRead,
} from '../../src/ui/adapters/arch-overview.js';
import type { TaskMapGoalRead, TaskMapGraphRead } from '../../src/ui/adapters/task-map.js';
import type { ArchitectureObservationStateV1 } from '../../src/contracts/architecture-observation.js';
import type { ArchitectureWorkScopeV1 } from '../../src/contracts/architecture-search.js';
import type { WorkLineListV1 } from '../../src/contracts/work-line.js';

/** The scene is the prototype's sample (`ArchOverview.dc.html` `treeData`,
 * `edgeData`, `areas`, `semGroups`, `wgAssign`, `std40`), narrowed to the
 * route reply shapes `readArchOverview` reads. The union-valued fields are
 * checked at run time here; the object types are checked by `tsc`. */
const oneOf = <T extends string>(value: string, allowed: readonly T[]): T => {
  if (!(allowed as readonly string[]).includes(value)) throw new Error('unexpected value ' + value);
  return value as T;
};

const routes = raw.routes;
const bootstrap: BootstrapReply = routes.bootstrap;
const catalogRead: ArchCatalogRead = routes['architecture/read'].value;
const files: ArchFilesRead = routes['files/list'].value;
const goal: TaskMapGoalRead = routes['goals/read'].value;
const tasks: TaskMapGraphRead = routes['tasks/query'].value;

const rawObservation = routes['architecture/observation-state'].value;
const observation: ArchitectureObservationStateV1 = {
  current: rawObservation.current === null ? null : {
    captureRef: {
      ...rawObservation.current.captureRef,
      aggregateType: oneOf(rawObservation.current.captureRef.aggregateType, ['ObservedArchitecture'] as const),
    },
    persistedRef: {
      capture: rawObservation.current.persistedRef.capture,
      material: {
        ...rawObservation.current.persistedRef.material,
        kind: oneOf(rawObservation.current.persistedRef.material.kind, ['artifact'] as const),
        source: {
          ...rawObservation.current.persistedRef.material.source,
          kind: oneOf(rawObservation.current.persistedRef.material.source.kind,
            ['plan-revision', 'workspace', 'governance', 'artifact', 'memory'] as const),
        },
      },
    },
    observedAt: rawObservation.current.observedAt,
  },
  previous: null,
  previousPersistedRef: null,
  autoCapture: null,
};

const rawObserved = routes['architecture/query'].value;
const observed: ArchObservedRead = {
  nodes: rawObserved.nodes.map((node) => ({
    ...node,
    kind: oneOf(node.kind, ['module', 'interface', 'type', 'function', 'file'] as const),
  })),
  edges: rawObserved.edges.map((edge) => ({
    ...edge,
    kind: oneOf(edge.kind, ['module_dependency', 'interface_uses', 'type_references', 'calls'] as const),
  })),
  unresolved: rawObserved.unresolved,
  nextCursor: rawObserved.nextCursor,
};

const rawWork = routes['architecture/work-scope'].value;
const work: ArchitectureWorkScopeV1 = {
  workspace: rawWork.workspace,
  runs: [],
  files: rawWork.files.map((file) => ({
    ...file,
    kind: oneOf(file.kind, ['file'] as const),
    nodeRef: { ...file.nodeRef, kind: oneOf(file.nodeRef.kind, ['file', 'module'] as const) },
  })) as ArchitectureWorkScopeV1['files'],
  modules: rawWork.modules.map((module) => ({
    ...module,
    kind: oneOf(module.kind, ['module'] as const),
    nodeRef: {
      ...module.nodeRef,
      kind: oneOf(module.nodeRef.kind, ['file', 'module'] as const),
    },
  })) as ArchitectureWorkScopeV1['modules'],
  counts: rawWork.counts,
  sources: { catalog: oneOf(rawWork.sources.catalog, ['available', 'not_adopted'] as const) },
};

const lines = routes['lines/list'].value as unknown as WorkLineListV1;

describe('ArchOverview fixed scene (prototype sample)', () => {
  it('keeps the prototype sample counts and the route reply shapes', () => {
    expect(bootstrap.workspaces[0]?.name).toBe('coding-platform');
    expect(catalogRead.catalog.catalog.modules).toHaveLength(18);
    const codeModuleIds = new Set([
      'src/ui', 'src/app', 'src/composition', 'src/business/workflow',
      'src/core/agent-runtime', 'src/core/work-graph', 'src/core/workspace', 'src/core/record-store',
      'src/contracts', 'vendor/coding-agent',
    ]);
    const codeModules = catalogRead.catalog.catalog.modules
      .map((module) => module.ref.moduleId)
      .filter((id) => codeModuleIds.has(id));
    expect(codeModules).toEqual([...codeModuleIds]);
    expect(files.paths).toHaveLength(2709);
    expect(observed.nodes).toHaveLength(18);
    expect(observed.edges).toHaveLength(29);
    expect(observation.current?.persistedRef.capture.captureId).toBe('0543261');
    expect(work.counts).toEqual({ runs: 0, files: 7, modules: 3 });
    expect(goal.ordinal).toBe(1);
    expect(goal.goal.objective).toBe('状态机可靠性改造');
    expect(tasks.tasks).toHaveLength(40);
    expect(lines.rows).toHaveLength(3);
    expect(lines.rows.map((row) => row.duty)).toEqual(['secretary', 'executor', 'reviewer']);

    const moduleIds = new Set(catalogRead.catalog.catalog.modules.map((module) => module.ref.moduleId));
    const observedModules = new Set(observed.nodes.map((node) => node.nodeId));
    for (const node of observed.nodes) expect(node.nodeId.startsWith('module:')).toBe(true);
    for (const edge of observed.edges) {
      expect(observedModules.has(edge.fromNode)).toBe(true);
      expect(observedModules.has(edge.toNode)).toBe(true);
      expect(moduleIds.has(edge.fromNode.slice('module:'.length))).toBe(true);
    }
    const paths = new Set(files.paths);
    for (const module of catalogRead.catalog.catalog.modules) {
      const path = module.paths[0] ?? '';
      if (path === '.') continue;
      expect(paths.has(path) || files.paths.some((file) => file.startsWith(path + '/'))).toBe(true);
    }
    const taskRows = tasks.tasks as Array<{ definition: { plannedFiles: string[] } }>;
    const planned = taskRows.flatMap((row) => row.definition.plannedFiles);
    expect(taskRows.filter((row) => row.definition.plannedFiles.length > 0)).toHaveLength(27);
    expect(planned).toHaveLength(34);
    for (const path of planned) expect(paths.has(path)).toBe(true);
  });
});
