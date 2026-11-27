/**
 * The ArchOverview adapter: one pure conversion from the nine read replies
 * (`architecture/read`, `architecture/observation-state`, `architecture/query`,
 * `architecture/change-scope`, `architecture/find`,
 * `architecture/work-scope`, `tasks/query`, `lines/list` and `notes/list`) into
 * the model the page copy reads through `props.data`.
 *
 * It touches no DOM, no network and no page module. Layout and geometry stay in
 * `src/ui/boards/ArchOverview.dc.html`; the page turns this model into `R` and
 * keeps its own `levelEdges`/`data()`.
 */

import type { AdoptedArchitecture, ModuleDefinition } from '../../contracts/architecture-catalog.js';
import type { CodeGraphEdge, CodeGraphNode } from '../../contracts/architecture-inspection.js';
import type { ArchitectureObservationStateV1 } from '../../contracts/architecture-observation.js';
import type {
  ArchitectureChangeScopeV1, ArchitectureFindResultV1, ArchitectureWorkScopeV1,
} from '../../contracts/architecture-search.js';
import type { KnowledgeCommitStatus } from '../../contracts/knowledge.js';
import type { LinkEvidenceRoleV1, NoteAnchorV1, NoteSourceV1, SemanticRelationV1 } from '../../contracts/note.js';
import type { SemanticFlowStepV1, SemanticFlowV1, SemanticLinkV1 } from '../../contracts/semantic-layer.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../contracts/prompts/platform-pack.generated.js';
import type { WorkLineListV1 } from '../../contracts/work-line.js';
import { pathOwnershipOf } from '../../contracts/path-ownership.js';
import { canonicalJson } from '../../contracts/canonical-json.js';
import { rawModuleId } from '../../contracts/workspace-module-id.js';
import { adaptTaskMap, type TaskMapGraphRead } from './task-map.js';
import { dutyWordOf } from './nav.js';
import { NOT_CONNECTED_TEXT } from '../not-connected.js';
import { asRecord, asText } from '../values.js';

/** `architecture/read`'s value: the read revision, already unwrapped. Only the
 * adopted catalog is read; the baseline row is not displayed. */
export type ArchCatalogRead = { catalog: { catalog: AdoptedArchitecture } };

/** `architecture/query`'s value after all pages are merged. */
export type ArchObservedRead = {
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
  unresolved: string[];
  nextCursor: string | null;
};

/** `files/list`'s value: the workspace's real file paths (no file graph). */
export type ArchFilesRead = { paths: string[]; partial: boolean };

/** `tasks/query`'s value: the page reads the plan's stages, dependencies and
 * each TaskRow's definition; the state words come from `adaptTaskMap`. */
export type ArchTaskGraphRead = TaskMapGraphRead;

/** `notes/list`'s value at the JSON boundary: one label and the optional
 * understanding sections are the only text this board shows. */
export type ArchNoteRead = {
  items: Array<{ label?: string; sections?: Record<string, string> }>;
};

/** One `role-lines/operations` row as the page reads it: the role-line fields the exploration and
 * deepen rows use. A `member_create` row carries none of these and the guards skip it; the declared
 * shape follows `role-line-operations-read.ts`'s `action: 'role_line'` arm. */
export type ArchOperationRow = {
  operation: { operationId: string };
  phase: string;
  actionPhase: string;
  result: { status: 'done' | 'failed' | 'waiting'; reason: string | null } | null;
  /** Only `exploration_followup` rows carry it; the model leaves it absent otherwise. */
  followUp?: {
    kind: 'repropose' | 'deepen' | 'knowledge_conflict';
    moduleRefs: Array<{ moduleId: string }>;
    reason: string | null;
  } | null;
};

/** One read's whole input; each field is one route's value (null = not read). */
export type ArchOverviewSource = {
  scope: { projectId: string; workspaceId: string };
  /** The bootstrap workspace name, when the caller has it. */
  projectName?: string;
  /** boot's workspace names (`workspaceId` → name) for the per-workspace rows; a missing name
   * falls back to the page's project name. */
  workspaceNames?: Record<string, string>;
  goal: { id: string; ordinal: number | null; objective: string } | null;
  catalog: ArchCatalogRead | null;
  observation: ArchitectureObservationStateV1 | null;
  observed: ArchObservedRead | null;
  /** `architecture/change-scope`: what this Goal's Runs changed; null = not read. */
  changes: ArchitectureChangeScopeV1 | null;
  /** `files/list`: the page's file leaves and folder nesting come from here. */
  files: ArchFilesRead | null;
  search: ArchitectureFindResultV1 | null;
  work: ArchitectureWorkScopeV1 | null;
  tasks: ArchTaskGraphRead | null;
  lines: WorkLineListV1 | null;
  notes: Record<string, ArchNoteRead>;
  /** `role-lines/operations` per workspace, keyed by workspaceId; a failed read's workspace is absent. */
  operations: Record<string, ArchOperationRow[]>;
  /** `knowledge/status` per workspace, keyed by workspaceId; a failed read's workspace is absent. */
  knowledge: Record<string, KnowledgeCommitStatus>;
  /** The semantic layer's two reads; null/absent = the switch is off and nothing was read. */
  semantic?: ArchSemanticRead | null;
};

/** The model the page's five data entry points read. */
export type ArchRepoModel = {
  rootId: 'SYS';
  nodes: ArchRepoNode[];
  edges: ArchRepoEdge[];
  workPaths: string[];
  /** `architecture/work-scope`'s own header counts; null when the read is off. */
  workCounts: { files: number; modules: number } | null;
  /** The modules `architecture/work-scope` names, including the ones that
   * claimed work without listing files. They stay bright without inventing files. */
  workModules: string[];
  fileDir: Record<string, string>;
  dirNodes: ArchRepoNode[];
  /** The catalog's declared module dependencies (drawn dotted when unobserved).
   * The frozen SYS screen has the `decl` dotted-edge class, so the truthful
   * read-side counterpart is kept; it is not a sample substitute. */
  declared: Array<{ from: string; to: string }>;
};

export type ArchRepoNode = {
  id: string;
  name: string;
  kind: 'system' | 'module' | 'band' | 'group' | 'dir' | 'folder' | 'loose' | 'file';
  parentId: string | null;
  path: string;
  responsibility: string;
  taskIds: string[];
  state: string;
  counts: { files: number; tasks: number };
  /** Files this Goal's Runs changed, definite only; modules add their descendants. */
  touched: number;
  /** A possible-only change: at least one changed file is not certain. */
  possible: boolean;
  /** SYS row grouping only (outer/business/core/shared/band); layout data, not a fact. */
  group?: string;
};

/** `count` is `CodeGraphEdge.count`: the references between the two endpoints. */
export type ArchRepoEdge = { from: string; to: string; kind: CodeGraphEdge['kind']; count: number };

export type ArchTaskModelRow = {
  id: string;
  stage: string;
  name: string;
  st: string;
  att: number;
  gate: boolean;
  agent: string;
  why: string;
  sem: string;
  deps: string[];
  files: string[];
};

export type ArchRailRow = {
  id: string;
  role: string;
  word: string;
  state: 'doing' | 'standby';
  files: string[];
};

/** The shape `wlRail()` returns for the page's owner lookups. */
export type ArchRail = {
  rows: ArchRailRow[];
  archived: ArchRailRow[];
  counts: Record<string, unknown>;
  head: string;
  goalBar: string;
  owners: Record<string, string>;
  groups: Record<string, string>;
  alt: Record<string, unknown>;
};

/** One workspace's unfinished initialization exploration: the caption's ruled line and its one
 * stop/continue button. The words never carry a round count. */
export type ArchExploreRow = {
  projectId: string;
  workspaceId: string;
  workspaceName: string;
  /** `cold_start` says 正在初始化; `workspace_join` says the workspace is 正在探索;
   * `exploration_followup` (only `continue`) says a follow-up exploration is held. */
  kind: 'cold_start' | 'workspace_join' | 'exploration_followup';
  /** The ruled caption line. */
  text: string;
  /** Stop while the operation runs, continue once it waits. */
  action: 'stop' | 'continue';
  actionLabel: string;
};

/** One workspace whose knowledge directory has uncommitted places. */
export type ArchCommitBar = {
  projectId: string;
  workspaceId: string;
  workspaceName: string;
  branch: string;
  dirty: number;
  files: number;
};

/** One module that can go one layer deeper, or one already deepening. */
export type ArchDeepenRow = {
  projectId: string;
  workspaceId: string;
  workspaceName: string;
  moduleId: string;
  /** True while an unfinished deepen follow-up covers this module; false when it can be deepened. */
  deepening: boolean;
};

export type ArchOverviewData = {
  scope: { projectId: string; workspaceId: string };
  repo: ArchRepoModel;
  taskModel: { tasks: ArchTaskModelRow[]; byId: Record<string, ArchTaskModelRow> };
  words: Record<string, string>;
  rail: ArchRail;
  notes: Record<string, ArchNoteRead>;
  /** Search result rows after the backend's first page (at most six). */
  qlist: Array<{ id: string; name: string; path: string }>;
  qNote: string;
  qMore: string;
  hasQMore: boolean;
  hasGoal: boolean;
  /** `architecture/change-scope` was read and whether it is complete; null = not read. */
  changes: { known: boolean; complete: boolean } | null;
  /** Page-owned empty text kind; the page writes the ruled sentence. */
  empty: 'no_catalog' | 'no_observation' | null;
  unresolved: number;
  /** The paths `architecture/query` could not resolve; shown as text, never
   * dropped, because an unresolved reference is not "no reference". */
  unresolvedPaths: string[];
  /** One row per unfinished initialization exploration, with the row's own range. */
  explore: ArchExploreRow[];
  /** One row per workspace that has uncommitted knowledge files. */
  commitBars: ArchCommitBar[];
  /** One row per deepenable module, and one per module already deepening. */
  deepen: ArchDeepenRow[];
  /** The one not-connected word. */
  notConnected: string;
  /** The semantic layer; null when the switch is off. */
  semantic: ArchSemanticData | null;
};

export type ArchOverviewUi = {
  level: string;
  view: 'sem' | 'dir';
  selected: string | null;
  hover: string | null;
  q: string;
  workOnly: boolean;
  legend: boolean;
  theme: 'dark' | 'light';
  /** `?sem=<noteId>`: the deep link's selected link, null when the page did not open on one. */
  semPick?: string | null;
  /** `#flow=<id>` on Main: the deep link's selected flow. */
  flowPick?: string | null;
};

/** The page's own state words (`ArchOverview.dc.html`'s `words()`); a state
 * code that is not in this table is never written into the page. */
const WORDS: Record<string, string> = {
  decide: '需要你决定', failed: '失败', blocked: '受阻', running: '执行中', verifying: '验证中',
  waiting: '已暂停，可继续', claimable: '可领取', satisfied: '已满足', pending: '待执行',
  future: '未来意图', deferred: '已延后', cancelled: '已取消', none: '本目标未改动',
};

/** Worst-first order of the page's state codes. */
const RANK = ['decide', 'failed', 'blocked', 'running', 'verifying', 'waiting', 'claimable',
  'pending', 'future', 'deferred', 'cancelled', 'satisfied', 'none'];

const WG = 'src/core/work-graph';

const OWN_WORD: Record<string, string> = {
  working: '工作中', checking: '正式检查中', starting: '启动中', waiting_reply: '等回复',
  paused: '已暂停', unknown: '待核对', done: '已做完', retired: '已退役', standby: '待命',
};

function worst(a: string, b: string): string {
  return RANK.indexOf(a) <= RANK.indexOf(b) ? a : b;
}

function baseName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

function modulePath(module: ModuleDefinition): string {
  return module.paths.length === 1 ? module.paths[0] ?? '' : '';
}

/** The page's area grouping, used only by `graphLayout`'s SYS rows. */
function areaOfPath(path: string): string {
  if (path === 'src/app' || path.startsWith('src/app/') || path === 'src/ui' || path === 'src/composition') return 'outer';
  if (path === 'src/business/workflow' || path.startsWith('src/business/')) return 'business';
  if (path.startsWith('src/core/')) return 'core';
  if (path === 'src/contracts' || path.startsWith('vendor/')) return 'shared';
  return 'band';
}

type DraftNode = ArchRepoNode & { area?: Record<string, unknown>; folder?: string };

function moduleOf(catalog: ArchCatalogRead | null): ModuleDefinition[] {
  return catalog === null ? [] : catalog.catalog.catalog.modules;
}

function parentIds(catalog: ArchCatalogRead | null): Map<string, string> {
  const out = new Map<string, string>();
  const containment = catalog?.catalog.catalog.containment;
  for (const edge of containment?.parentOf ?? []) out.set(edge.child.moduleId, edge.parent.moduleId);
  return out;
}

/** One TaskRow's planned files and stage, keyed by task id. */
function taskFacts(tasks: ArchTaskGraphRead | null): Map<string, { files: string[]; stage: string; gate: boolean; sem: string; module: string }> {
  const out = new Map<string, { files: string[]; stage: string; gate: boolean; sem: string; module: string }>();
  if (tasks === null) return out;
  for (const entry of tasks.tasks) {
    const row = asRecord(entry);
    const definition = asRecord(row.definition);
    const id = asText(definition.taskId);
    if (id === '') continue;
    const planned = Array.isArray(definition.plannedFiles)
      ? (definition.plannedFiles as unknown[]).map(asText).filter((path) => path !== '') : [];
    out.set(id, {
      files: planned,
      stage: asText(definition.stageId) || asText(asRecord(definition.scope).stageId),
      gate: definition.taskKind === 'gate',
      sem: asText(definition.instruction),
      module: asText(asRecord(definition.scope).kind) === 'module' ? asText(asRecord(definition.scope).moduleRef) : '',
    });
  }
  return out;
}

/** The states `adaptTaskMap` gives each row: the same `taskState` mapping the
 * task board uses, without a second copy of the phase table here. */
function taskStates(tasks: ArchTaskGraphRead | null, goal: ArchOverviewSource['goal']): Map<string, string> {
  const out = new Map<string, string>();
  if (tasks === null) return out;
  const map = adaptTaskMap(
    { goal: { ref: { goalId: goal?.id ?? '' }, objective: goal?.objective ?? '' }, ordinal: goal?.ordinal ?? null },
    tasks,
    { display: { phase: 'RUNNING' } },
  );
  for (const task of map.tasks) out.set(task.id, task.st);
  return out;
}

function taskDeps(tasks: ArchTaskGraphRead | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (tasks === null) return out;
  for (const entry of tasks.plan.executionDag.dependsOn) {
    const row = asRecord(entry);
    const taskId = asText(row.taskId);
    const dependsOnId = asText(row.dependsOnId);
    if (taskId === '' || dependsOnId === '') continue;
    const list = out.get(taskId) ?? [];
    list.push(dependsOnId);
    out.set(taskId, list);
  }
  return out;
}

/** The rail the page's `wlRail()` returns: line rows for `wlLineOf`/`wlOwner`
 * and the task/module owner maps from `responsibleNow` and `groups`. */
function buildRail(lines: WorkLineListV1 | null, facts: ReturnType<typeof taskFacts>): ArchRail {
  const owners: Record<string, string> = {};
  const groups: Record<string, string> = {};
  const rows: ArchRailRow[] = [];
  for (const line of lines?.rows ?? []) {
    const word = OWN_WORD[asText(asRecord(line.status).own)] ?? '待核对';
    const doing = ['working', 'checking', 'starting', 'waiting_reply'].includes(asText(asRecord(line.status).own));
    const files = new Set<string>();
    const tasks = Array.isArray(line.responsibleNow) ? line.responsibleNow : [];
    for (const brief of tasks) {
      const taskId = asText(asRecord(asRecord(brief).task).taskId);
      if (taskId === '') continue;
      const title = asText(asRecord(brief).title);
      if (owners[taskId] === undefined) {
        owners[taskId] = asText(asRecord(line.name).primary) + (title !== '' ? ' · ' + title : '') + ' · ' + word;
      }
      for (const path of facts.get(taskId)?.files ?? []) files.add(path);
    }
    const groupTask = asText(asRecord(asRecord(line.groups).task).taskId);
    if (groupTask !== '' && owners[groupTask] === undefined) {
      owners[groupTask] = asText(asRecord(line.name).primary) + ' · ' + word;
    }
    const moduleId = asText(asRecord(asRecord(line.groups).module).moduleId);
    if (moduleId !== '') groups[moduleId] = asText(asRecord(line.name).primary) + ' · ' + word;
    rows.push({
      id: asText(asRecord(line.key).sessionId), role: asText(line.duty), word,
      state: doing ? 'doing' : 'standby', files: Array.from(files),
    });
  }
  return { rows, archived: [], counts: {}, head: '', goalBar: '', owners, groups, alt: {} };
}

/** The page's search rows, counts and three ruled notes. */
function searchOf(search: ArchitectureFindResultV1 | null): Pick<ArchOverviewData, 'qlist' | 'qNote' | 'qMore' | 'hasQMore'> {
  if (search === null) return { qlist: [], qNote: '', qMore: '', hasQMore: false };
  const rows = search.items.slice(0, 6).map((item) => {
    if (item.kind === 'file') {
      /* The one path the backend matched; the module trail would lose it. */
      return { id: item.path, name: item.label, path: item.path };
    }
    return { id: item.module.ref.moduleId, name: item.label, path: item.module.ancestor.map((a) => a.name).join(' / ') };
  });
  const modules = new Set<string>();
  for (const item of search.items) {
    if (item.module === null) continue;
    /* The hit's own module is one of the modules it is in; ancestors alone
       would count a hit in a top-level module as "in 0 modules". */
    modules.add(item.module.ref.moduleId);
    for (const ancestor of item.module.ancestor) modules.add(ancestor.ref.moduleId);
  }
  const total = search.counts.total;
  const note = total === 0 ? '没有匹配' : String(total) + ' 个，在 ' + String(modules.size) + ' 个模块';
  const more = total > 6 ? '另有 ' + String(total - 6) + ' 个，图里保持高亮' : '';
  return { qlist: rows, qNote: note, qMore: more, hasQMore: total > 6 };
}

/** Apply the page's empty-state kind from the two pointer reads. */
function emptyOf(catalog: ArchCatalogRead | null, observation: ArchitectureObservationStateV1 | null): ArchOverviewData['empty'] {
  if (catalog === null) return 'no_catalog';
  if (observation === null || observation.current === null || observation.current.persistedRef === null) return 'no_observation';
  return null;
}

/** The operation id of the first workspace's cold start (state/cold-start.ts) and of a join. */
function isColdStartOf(operationId: string, projectId: string): boolean {
  return operationId === 'cold_start:' + projectId;
}
function isJoinOf(operationId: string, workspaceId: string): boolean {
  return operationId === 'workspace_join:' + workspaceId;
}
/** An exploration follow-up's operation id (state/exploration-followup.ts `explorationFollowUpOperationRef`). */
function isFollowUp(operationId: string): boolean {
  return operationId.startsWith('exploration_followup:');
}

/** One workspace's name for the rows; the page's own project name is the fallback. */
function workspaceNameOf(source: ArchOverviewSource, workspaceId: string): string {
  return source.workspaceNames?.[workspaceId] || source.projectName || '';
}

/** The ruled caption and button of one unfinished exploration. A `phase` of `accepted` or
 * `running` means undone; `result.status === 'waiting'` means the person stopped it, or (a
 * follow-up) a round of it ended before it ran. */
function exploreRowsOf(source: ArchOverviewSource): ArchExploreRow[] {
  const out: ArchExploreRow[] = [];
  const named = Object.keys(source.workspaceNames ?? {}).length > 1;
  for (const [workspaceId, entries] of Object.entries(source.operations)) {
    const name = workspaceNameOf(source, workspaceId);
    let mainHeld = false;
    let followUpHeld = false;
    for (const entry of entries) {
      const row = asRecord(entry);
      const phase = asText(row.phase);
      if (phase !== 'accepted' && phase !== 'running') continue;
      const operationId = asText(asRecord(row.operation).operationId);
      const stopped = asText(asRecord(row.result).status) === 'waiting';
      if (isFollowUp(operationId)) { if (stopped) followUpHeld = true; continue; }
      const cold = isColdStartOf(operationId, source.scope.projectId);
      const join = isJoinOf(operationId, workspaceId);
      if (!cold && !join) continue;
      if (stopped) mainHeld = true;
      out.push({
        projectId: source.scope.projectId, workspaceId, workspaceName: name,
        kind: cold ? 'cold_start' : 'workspace_join',
        text: cold
          ? stopped ? '还没初始化完：探索已停下，可以继续。' : '还没初始化完：正在初始化。'
          : name + '加入中：' + (stopped ? '探索已停下，可以继续。' : '正在探索。'),
        action: stopped ? 'continue' : 'stop',
        actionLabel: stopped ? '继续探索' : '停止探索',
      });
    }
    /* P6I r3: a held follow-up (再深一层, 不对重新提) has no stop or continue of its own; the
       workspace's continue releases it once no held join or cold start of that workspace comes
       first (`exploration-control.ts` `continueTarget`), so its row shows only then. One row per
       workspace: each continue releases one held follow-up, and the reread shows the next. */
    if (followUpHeld && !mainHeld) {
      out.push({
        projectId: source.scope.projectId, workspaceId, workspaceName: name, kind: 'exploration_followup',
        text: (named ? name + '：' : '') + '跟进探索已停下，可以继续。',
        action: 'continue', actionLabel: '继续探索',
      });
    }
  }
  return out;
}

/** One bar per workspace with uncommitted knowledge files; clean, local-only and failed-read
 * workspaces are absent. The bar names its workspace only when the project has more than one (X4). */
function commitBarsOf(source: ArchOverviewSource): ArchCommitBar[] {
  const out: ArchCommitBar[] = [];
  const named = Object.keys(source.workspaceNames ?? {}).length > 1;
  for (const [workspaceId, status] of Object.entries(source.knowledge)) {
    if (status.dirty <= 0 || status.localOnly) continue;
    out.push({
      projectId: source.scope.projectId, workspaceId,
      workspaceName: named ? workspaceNameOf(source, workspaceId) : '',
      branch: status.branch, dirty: status.dirty, files: status.files,
    });
  }
  return out;
}

/** The catalog modules with the workspace whose initialization they belong to. The read's
 * own workspace is the main one (`rawModuleId`'s `null`). */
function deepenModulesOf(source: ArchOverviewSource): Array<{ moduleId: string; workspaceId: string }> {
  const out: Array<{ moduleId: string; workspaceId: string }> = [];
  for (const module of moduleOf(source.catalog)) {
    const moduleId = asText(module.ref.moduleId);
    if (moduleId === '') continue;
    const raw = rawModuleId(moduleId);
    out.push({ moduleId, workspaceId: raw.workspaceId ?? source.scope.workspaceId });
  }
  return out;
}

/** The modules one workspace's completed initialization allows deepening, plus the modules an
 * unfinished `deepen` follow-up already covers. A workspace whose operations read failed has no
 * rows: without that read the page cannot know the initialization finished. */
function deepenRowsOf(source: ArchOverviewSource): ArchDeepenRow[] {
  const modules = deepenModulesOf(source);
  const out: ArchDeepenRow[] = [];
  const active = new Set<string>();
  for (const [workspaceId, entries] of Object.entries(source.operations)) {
    const name = workspaceNameOf(source, workspaceId);
    for (const entry of entries) {
      const row = asRecord(entry);
      const phase = asText(row.phase);
      if (phase !== 'accepted' && phase !== 'running') continue;
      const follow = asRecord(row.followUp);
      if (asText(follow.kind) !== 'deepen') continue;
      const refs = Array.isArray(follow.moduleRefs) ? follow.moduleRefs : [];
      for (const ref of refs) {
        const moduleId = asText(asRecord(ref).moduleId);
        if (moduleId === '') continue;
        /* `beginDeepen` stores the page's node id, which is also `module.moduleId`. */
        active.add(workspaceId + '\0' + moduleId);
        out.push({ projectId: source.scope.projectId, workspaceId, workspaceName: name,
          moduleId, deepening: true });
      }
    }
  }
  for (const [workspaceId, entries] of Object.entries(source.operations)) {
    const complete = entries.some((entry) => {
      const row = asRecord(entry);
      if (asText(row.phase) !== 'completed') return false;
      const operationId = asText(asRecord(row.operation).operationId);
      return isColdStartOf(operationId, source.scope.projectId) || isJoinOf(operationId, workspaceId);
    });
    if (!complete) continue;
    const name = workspaceNameOf(source, workspaceId);
    for (const module of modules) {
      if (module.workspaceId !== workspaceId) continue;
      if (active.has(workspaceId + '\0' + module.moduleId)) continue;
      out.push({ projectId: source.scope.projectId, workspaceId, workspaceName: name,
        moduleId: module.moduleId, deepening: false });
    }
  }
  return out;
}


/* ------------------------------------------------------------------ semantic layer (batch 9) */
/* The page reads this projection; it is the only place relation, evidence, result and
   retirement codes become words (README 4.7). `currentEligible` alone decides standing. */

export const EVIDENCE_ROLE_WORD: Record<LinkEvidenceRoleV1, string> = {
  use: '使用', wire: '接线', register: '登记', emit: '发出', receive: '接收', launch: '启动', entry: '入口',
};

export const ANCHOR_RETIRED_WORD: Record<'module_removed' | 'interface_removed' | 'file_deleted'
  | 'task_ended' | 'stage_not_in_current_plan' | 'symbol_missing', string> = {
  module_removed: '模块不在了', interface_removed: '接口不在了', file_deleted: '文件删了',
  task_ended: '任务结束了', stage_not_in_current_plan: '阶段不在当前计划里', symbol_missing: '函数找不到了',
};

export const LINK_RESULT_WORD = {
  verified: '对得上', broken: '断了', unverifiable: '查不了', unchecked: '这次没核', doubt: '存疑', headless: '没登记',
} as const;

export const LINK_STANDING_WORD = { eligible: '作数', ineligible: '暂不作数' } as const;

/** The check route's failures; `invalid` is the page's own bug and falls to 这次没核成. */
export const SEMANTIC_CHECK_FAIL_WORD = {
  not_found: '平台找不到这条联系，可能刚被撤下或换了新版本',
  network: '连不上平台（网络断了，或平台没在运行）',
  other: '这次没核成。',
} as const;

const RELATION_WORD: Record<SemanticRelationV1, string> = {
  calls: PLATFORM_PROMPT_PACK_V1.strings['note.relation.calls'] ?? '调用',
  injects: PLATFORM_PROMPT_PACK_V1.strings['note.relation.injects'] ?? '注入',
  callback: PLATFORM_PROMPT_PACK_V1.strings['note.relation.callback'] ?? '回调',
  data: PLATFORM_PROMPT_PACK_V1.strings['note.relation.data'] ?? '数据',
  message: PLATFORM_PROMPT_PACK_V1.strings['note.relation.message'] ?? '消息',
  spawns: PLATFORM_PROMPT_PACK_V1.strings['note.relation.spawns'] ?? '起进程',
};

/** One end as the page prints it. */
export type ArchSemanticEnd = {
  moduleId: string | null;
  moduleName: string;
  path: string;
  symbol: string;
  /** The retired reasons in the page's words; empty when the end is live. */
  retired: string[];
  missing: boolean;
};

export type ArchSemanticEvidence = { role: string; path: string; line: number | null; broken: boolean };

/** One link row; every word is final, the page only arranges it. */
export type ArchLinkRow = {
  noteId: string;
  version: number | null;
  relation: SemanticRelationV1;
  relationWord: string;
  from: ArchSemanticEnd;
  to: ArchSemanticEnd;
  via: ArchSemanticEnd | null;
  keyText: string;
  evidence: ArchSemanticEvidence[];
  /** `headless` is `version: null`; `doubt` is the unchecked `refs_pending`. */
  /** The receipt's own fields, kept verbatim (the page reads only these for standing). */
  currentEligible: boolean;
  freshness: 'fresh' | 'stale' | 'unchecked';
  state: 'accepted' | 'reviewed' | 'pending_review' | null;
  verification: SemanticLinkV1['verification'];
  fromStatus: 'live' | 'retired';
  toStatus: 'live' | 'retired';
  fromRetired: Array<'module_removed' | 'interface_removed' | 'file_deleted'
    | 'task_ended' | 'stage_not_in_current_plan' | 'symbol_missing'>;
  toRetired: Array<'module_removed' | 'interface_removed' | 'file_deleted'
    | 'task_ended' | 'stage_not_in_current_plan' | 'symbol_missing'>;
  result: keyof typeof LINK_RESULT_WORD;
  resultWord: string;
  resultText: string;
  standing: 'eligible' | 'ineligible';
  standingWord: string;
  standingWhy: string;
  freshWord: string;
  topic: string;
  conclusion: string;
  author: string;
  flowTopics: string[];
};

/** One flow step; the page prints `stepText` and `word`. */
export type ArchFlowStepRow = {
  n: number;
  link: string;
  from: ArchSemanticEnd | null;
  to: ArchSemanticEnd | null;
  inModule: boolean;
  problem: 'not_current' | 'broken' | 'stale' | 'unchecked' | null;
  word: string;
  stepText: string;
  mark: string;
  item: ArchLinkRow | null;
};

export type ArchFlowRow = {
  noteId: string;
  version: number | null;
  topic: string;
  conclusion: string;
  steps: ArchFlowStepRow[];
  gapsAfter: number[];
  gapTexts: string[];
  statusText: string;
  standing: 'eligible' | 'ineligible';
  standingWord: string;
  freshWord: string;
  author: string;
  checkItems: Array<{ noteId: string; version: number }>;
  notCurrent: number[];
  internal: number[];
};

export type ArchSemanticData = {
  status: 'ready' | 'empty' | 'error' | 'cap';
  links: ArchLinkRow[];
  flows: ArchFlowRow[];
  /** The whole layer's failure text (both routes failed); the block texts below are per route. */
  errorText: string;
  linkError: string;
  flowError: string;
  capText: string;
  totalText: string;
  counts: { broken: number; doubt: number; unchecked: number; headless: number; ineligible: number };
  /** The `?sem=` deep link's link; null when the page was not opened on one. */
  pick: string | null;
  /** The `#flow=` deep link's flow; null when the page was not opened on one. */
  flowPick: string | null;
};

/** What boot reads for the layer; `null` is "not read" (the switch is off). */
export type ArchSemanticRead = {
  links: SemanticLinkV1[] | null;
  flows: SemanticFlowV1[] | null;
  linkError: string;
  flowError: string;
  linkCap: boolean;
  flowCap: boolean;
};

const symbolOfEnd = (end: SemanticLinkV1['from']): string =>
  end.anchor.kind === 'file'
    ? (end.request.kind === 'file' ? end.request.symbolRequest?.name ?? '' : '')
      || end.anchor.symbol?.qualifiedName || ''
    : end.anchor.kind === 'interface' ? end.anchor.interfaceId : '';

const pathOfEnd = (end: SemanticLinkV1['from']): string =>
  end.anchor.kind === 'file' ? end.anchor.path : '';

function semanticEndOf(end: SemanticLinkV1['from'], moduleNames: Map<string, string>): ArchSemanticEnd {
  const retired = end.anchorRetiredReasons.map((reason) => ANCHOR_RETIRED_WORD[reason]);
  return {
    moduleId: end.moduleId,
    moduleName: end.moduleId === null ? '' : moduleNames.get(end.moduleId) ?? end.moduleId,
    path: pathOfEnd(end),
    symbol: symbolOfEnd(end),
    retired,
    missing: end.anchorStatus === 'retired' || (end.anchor.kind === 'file' && end.anchor.deleted === true),
  };
}

function semanticResultOf(link: SemanticLinkV1): { result: keyof typeof LINK_RESULT_WORD; text: string } {
  if (link.version === null) {
    return { result: 'headless', text: '没登记：只在注记文件里，平台没有它的记录，核对不了' };
  }
  const verification = link.verification;
  if (verification.status === 'verified') {
    return { result: 'verified', text: `对得上：${link.evidence.length} 条证据都在代码里找到了` };
  }
  if (verification.status === 'broken') {
    const index = verification.missing[0] ?? 0;
    const role = EVIDENCE_ROLE_WORD[link.evidence[index]?.role ?? 'use'];
    return { result: 'broken', text: `断了：第 ${index + 1} 条（${role}）证据在代码里找不到了` };
  }
  if (verification.status === 'unverifiable') {
    const why = verification.reason === 'key_not_literal'
      ? '两边共用的名字是运行时拼出来的，没法按名字去代码里核'
      : verification.reason === 'language_unsupported'
        ? '这种语言平台查不了引用（只查 TS、JS）'
        : '引用分析判断不了（文件可能不在项目配置里）';
    return { result: 'unverifiable', text: '查不了：' + why };
  }
  if (verification.reason === 'refs_pending') {
    return { result: 'doubt', text: '存疑：跨文件引用待核' };
  }
  return {
    result: 'unchecked',
    text: verification.reason === 'budget'
      ? '这次没核：这一次要核的太多，没轮到它'
      : '这次没核：要读的文件这次读不了（可能正被改着）',
  };
}

/** `currentEligible` alone decides standing; the other fields only explain it. */
function standingWhyOf(link: SemanticLinkV1, from: ArchSemanticEnd, to: ArchSemanticEnd): string {
  if (link.currentEligible) return '';
  if (link.freshness === 'stale') return '写它依据的代码改过，需复查';
  if (link.freshness === 'unchecked') return '依据的代码这次没核';
  if (to.retired.length > 0) return '到那一端的' + to.retired[0];
  if (from.retired.length > 0) return '从那一端的' + from.retired[0];
  if (link.state === 'pending_review') return '待审';
  return '';
}

function freshWordOf(freshness: 'fresh' | 'stale' | 'unchecked'): string {
  /* 2.3 乙: the background check does not push a change, so the row says when a new
     result becomes visible. */
  const state = freshness === 'fresh' ? '代码里核过，依据没变'
    : freshness === 'stale' ? '写它依据的代码改过，需复查' : '依据的代码这次没核';
  return state + '；平台空闲时会核，核完不会自己刷新，重新打开联系层或手动核对以后才看得到新结果';
}

function authorOf(source: NoteSourceV1, lines: WorkLineListV1 | null): string {
  if (source.kind === 'user') return '你写的';
  if (source.kind === 'platform') return '平台';
  const duty = dutyWordOf(source.duty);
  const row = lines?.rows.find((line) => line.key.sessionId === source.sessionRef.sessionId);
  const name = row === undefined ? '' : asText(asRecord(row.name).primary);
  return name === '' ? duty : duty + ' · ' + name;
}

/** The one standing word; `currentEligible` alone decides it. */
export function linkStandingOf(row: Pick<ArchLinkRow, 'currentEligible'>): '作数' | '暂不作数' {
  return row.currentEligible ? LINK_STANDING_WORD.eligible : LINK_STANDING_WORD.ineligible;
}

function linkOf(link: SemanticLinkV1, moduleNames: Map<string, string>, lines: WorkLineListV1 | null,
  flowTopics: string[]): ArchLinkRow {
  const from = semanticEndOf(link.from, moduleNames);
  const to = semanticEndOf(link.to, moduleNames);
  const result = semanticResultOf(link);
  const why = standingWhyOf(link, from, to);
  const missing = link.verification.status === 'broken' ? link.verification.missing : [];
  const row = link;
  return {
    noteId: link.noteId, version: link.version, relation: link.relation,
    relationWord: RELATION_WORD[link.relation] ?? link.relation,
    from, to, via: link.via === null ? null : semanticEndOf(link.via, moduleNames),
    keyText: link.key === null ? '' : link.key.kind === 'literal' ? link.key.text
      : link.key.path + '#' + link.key.symbolRequest.name,
    evidence: link.evidence.map((entry, index) => ({
      role: EVIDENCE_ROLE_WORD[entry.role],
      path: entry.at.path,
      line: entry.at.range?.startLine ?? entry.at.symbol?.range.startLine ?? null,
      broken: missing.indexOf(index) >= 0,
    })),
    currentEligible: row.currentEligible, freshness: row.freshness, state: row.state, verification: row.verification,
    fromStatus: row.from.anchorStatus, toStatus: row.to.anchorStatus,
    fromRetired: row.from.anchorRetiredReasons.slice(), toRetired: row.to.anchorRetiredReasons.slice(),
    result: result.result, resultWord: LINK_RESULT_WORD[result.result], resultText: result.text,
    standing: row.currentEligible ? 'eligible' : 'ineligible',
    standingWord: linkStandingOf(row),
    standingWhy: why,
    freshWord: freshWordOf(link.freshness),
    topic: link.topic, conclusion: link.conclusion,
    author: authorOf(link.source, lines), flowTopics,
  };
}


function flowStepOf(step: SemanticFlowStepV1, n: number, moduleNames: Map<string, string>,
  lines: WorkLineListV1 | null, topics: string[]): ArchFlowStepRow {
  const item = step.item === null ? null : linkOf(step.item, moduleNames, lines, topics);
  const inModule = item !== null && item.from.moduleId !== null && item.from.moduleId === item.to.moduleId;
  const word = step.problem === 'not_current' ? '不在了'
    : step.problem === 'broken' ? '断了'
      : step.problem === 'stale' ? '需复查'
        : step.problem === 'unchecked' ? (item?.result === 'doubt' ? '存疑' : '这次没核')
          : item?.resultWord ?? '对得上';
  return {
    n, link: step.link,
    from: item?.from ?? null, to: item?.to ?? null,
    inModule, problem: step.problem, word,
    stepText: n + (item === null ? '' : ' ' + item.relationWord),
    mark: '第 ' + n + ' 步' + (inModule ? '（在模块内部）' : ''),
    item,
  };
}

function flowOf(flow: SemanticFlowV1, moduleNames: Map<string, string>, lines: WorkLineListV1 | null): ArchFlowRow {
  const steps = flow.steps.map((step, index) => flowStepOf(step, index + 1, moduleNames, lines, [flow.topic]));
  const gaps = flow.gapsAfter.map((after) => `第 ${after}、${after + 1} 步接不上`);
  const bad = steps.filter((step) => step.problem !== null);
  const statusText = flow.currentEligible ? '都对得上：每一步都作数'
    : '暂不作数' + (bad.length === 0 ? '' : '：' + bad.map((step) => step.mark + step.word).join('，'));
  return {
    noteId: flow.noteId, version: flow.version, topic: flow.topic, conclusion: flow.conclusion,
    steps, gapsAfter: flow.gapsAfter.slice(), gapTexts: gaps, statusText,
    standing: flow.currentEligible ? 'eligible' : 'ineligible',
    standingWord: flow.currentEligible ? LINK_STANDING_WORD.eligible : LINK_STANDING_WORD.ineligible,
    freshWord: freshWordOf(flow.freshness), author: authorOf(flow.source, lines),
    checkItems: steps.filter((step) => step.item !== null && step.item.version !== null)
      .map((step) => ({ noteId: step.item!.noteId, version: step.item!.version! })),
    notCurrent: steps.filter((step) => step.problem === 'not_current').map((step) => step.n),
    internal: steps.filter((step) => step.inModule).map((step) => step.n),
  };
}

/** The layer's projection; `read` is null when the switch is off. */
export function adaptArchSemantics(read: ArchSemanticRead | null, ui: Pick<ArchOverviewUi, 'semPick' | 'flowPick'> = {},
  moduleNames: Map<string, string> = new Map(), lines: WorkLineListV1 | null = null): ArchSemanticData | null {
  if (read === null) return null;
  const links: ArchLinkRow[] = [];
  const flows: ArchFlowRow[] = [];
  const flowTopics = new Map<string, string[]>();
  for (const flow of read.flows ?? []) {
    for (const step of flow.steps) {
      if (step.item === null) continue;
      flowTopics.set(step.item.noteId, [...(flowTopics.get(step.item.noteId) ?? []), flow.topic]);
    }
  }
  /* A flow step carries its own link item; the same link is listed once more in `links`, so its flow topics join there. */
  for (const link of read.links ?? []) links.push(linkOf(link, moduleNames, lines, flowTopics.get(link.noteId) ?? []));
  for (const flow of read.flows ?? []) flows.push(flowOf(flow, moduleNames, lines));
  const counts = {
    broken: links.filter((row) => row.result === 'broken').length,
    doubt: links.filter((row) => row.result === 'doubt').length,
    unchecked: links.filter((row) => row.result === 'unchecked').length,
    headless: links.filter((row) => row.result === 'headless').length,
    ineligible: links.filter((row) => row.standing === 'ineligible').length,
  };
  const linkFailed = read.links === null;
  const flowFailed = read.flows === null;
  const status = linkFailed && flowFailed ? 'error'
    : read.linkCap || read.flowCap ? 'cap'
      : (read.links?.length ?? 0) === 0 && (read.flows?.length ?? 0) === 0 && !linkFailed && !flowFailed ? 'empty'
        : 'ready';
  return {
    status, links, flows,
    errorText: linkFailed && flowFailed ? (read.linkError || read.flowError) : '',
    linkError: linkFailed ? read.linkError : '', flowError: flowFailed ? read.flowError : '',
    capText: read.linkCap ? '联系太多，没读完：读了 100 页（1 万条）还没到头，这一块先不画'
      : read.flowCap ? '流程太多，没读完：读了 100 页（5 千条）还没到头，这一块先不画' : '',
    totalText: `写下的 ${links.length} 条联系、${flows.length} 条流程`,
    counts, pick: ui.semPick ?? null, flowPick: ui.flowPick ?? null,
  };
}

export function adaptArchOverview(source: ArchOverviewSource, ui: ArchOverviewUi): ArchOverviewData {
  const modules = moduleOf(source.catalog);
  const parentOf = parentIds(source.catalog);
  const facts = taskFacts(source.tasks);
  const states = taskStates(source.tasks, source.goal);
  const deps = taskDeps(source.tasks);
  const rail = buildRail(source.lines, facts);

  /* `architecture/change-scope` is read once per refresh; every changed number
     below comes from it and no node sums a subtree a second time. */
  const changes = source.changes;
  const changedFiles = new Map<string, ArchitectureChangeScopeV1['files'][number]>();
  for (const row of changes?.files ?? []) changedFiles.set(row.path, row);
  const changedModules = new Map<string, { changed: number; possible: number }>();
  for (const row of changes?.modules ?? []) changedModules.set(row.moduleRef.moduleId, row);
  /* One row per interface group: files[]'s moduleRef + interfaceId, never the
     module's own changed number (that would count the files twice). */
  const changedGroups = new Map<string, { definite: number; possible: number }>();
  for (const row of changes?.files ?? []) {
    if (row.moduleRef === null || row.interfaceId === null) continue;
    const key = canonicalJson([row.moduleRef.moduleId, row.interfaceId]);
    const counts = changedGroups.get(key) ?? { definite: 0, possible: 0 };
    if (row.certainty === 'definite') counts.definite += 1;
    else counts.possible += 1;
    changedGroups.set(key, counts);
  }
  /* a module's number is its own row plus every containment descendant's;
     the recursion is safe because adoption rejects a containment cycle. */
  const childModules = new Map<string, string[]>();
  for (const [child, parent] of parentOf) {
    childModules.set(parent, [...(childModules.get(parent) ?? []), child]);
  }
  const moduleTotals = new Map<string, { changed: number; possible: number }>();
  const totalsOf = (moduleId: string): { changed: number; possible: number } => {
    const cached = moduleTotals.get(moduleId);
    if (cached !== undefined) return cached;
    const own = changedModules.get(moduleId) ?? { changed: 0, possible: 0 };
    const total = { changed: own.changed, possible: own.possible };
    for (const child of childModules.get(moduleId) ?? []) {
      const below = totalsOf(child);
      total.changed += below.changed;
      total.possible += below.possible;
    }
    moduleTotals.set(moduleId, total);
    return total;
  };
  /* A file row is definite or possible; a missing row is 0 either way, and the
     page writes 还没接通 when the read was incomplete (R4). */
  const changeOfFile = (path: string): { touched: number; possible: boolean } => {
    const row = changedFiles.get(path);
    if (row === undefined) return { touched: 0, possible: false };
    return row.certainty === 'definite' ? { touched: 1, possible: false } : { touched: 0, possible: true };
  };
  /* A directory shows the files under it, never its modules' own numbers. */
  const changeUnder = (dirPath: string): { touched: number; possible: boolean } => {
    let definite = 0;
    let possible = 0;
    for (const row of changes?.files ?? []) {
      if (!row.path.startsWith(dirPath + '/')) continue;
      if (row.certainty === 'definite') definite += 1;
      else possible += 1;
    }
    return { touched: definite, possible: possible > 0 && definite === 0 };
  };

  const nodes: DraftNode[] = [];
  const byId = new Map<string, DraftNode>();
  const push = (node: DraftNode): DraftNode => { nodes.push(node); byId.set(node.id, node); return node; };
  push({
    id: 'SYS', name: source.projectName || source.scope.projectId, kind: 'system', parentId: null,
    path: '', responsibility: '', taskIds: [], state: 'none', counts: { files: 0, tasks: 0 },
    touched: 0, possible: false,
  });

  const moduleNodes = new Map<string, DraftNode>();
  for (const module of modules) {
    const id = asText(module.ref.moduleId);
    const parent = parentOf.get(id) ?? null;
    const total = totalsOf(id);
    const node = push({
      id, name: asText(module.name), kind: parent === null ? 'module' : 'group', parentId: parent,
      path: modulePath(module), responsibility: asText(module.responsibility), taskIds: [],
      state: 'none', counts: { files: 0, tasks: 0 }, group: areaOfPath(modulePath(module)),
      touched: total.changed, possible: total.possible > 0,
    });
    moduleNodes.set(id, node);
  }
  /* A containment parent whose module is missing is treated as top level. */
  for (const node of moduleNodes.values()) {
    if (node.parentId !== null && !moduleNodes.has(node.parentId)) node.parentId = null;
  }

  const interfaceGroups = new Map<string, DraftNode>();
  for (const module of modules) {
    const id = asText(module.ref.moduleId);
    const parent = moduleNodes.get(id);
    if (parent === undefined) continue;
    for (const entry of module.interfaces ?? []) {
      const interfaceId = asText(entry.id);
      if (interfaceId === '') continue;
      /* The group id is B1's interface identity (an interface id is unique only
         inside its module); an edge's `interface:` endpoint is this same string. */
      const groupId = canonicalJson([id, interfaceId]);
      const counts = changedGroups.get(groupId) ?? { definite: 0, possible: 0 };
      interfaceGroups.set(groupId, push({
        id: groupId, name: interfaceId, kind: 'group', parentId: id, path: parent.path,
        responsibility: asText(entry.description), taskIds: [], state: 'none',
        counts: { files: 0, tasks: 0 },
        touched: counts.definite, possible: counts.possible > 0 && counts.definite === 0,
      }));
    }
  }

  for (const [taskId, fact] of facts) {
    if (fact.module === '') continue;
    const moduleNode = moduleNodes.get(fact.module);
    if (moduleNode !== undefined && !moduleNode.taskIds.includes(taskId)) moduleNode.taskIds.push(taskId);
  }

  /* File nodes from `files/list` (the workspace's real files), owned only by
     the longest legal declared path; a tie puts the file under both owners
     instead of picking the first. The observation graph has no public file
     read, so no file comes from `architecture/query`. */
  const fileNodes = new Map<string, DraftNode>();
  const duplicates = new Map<string, DraftNode[]>();
  const usedInterfaceGroups = new Set<string>();
  const unresolved = source.observed?.unresolved ?? [];
  for (const path of source.files?.paths ?? []) {
    if (asText(path) === '') continue;
    const name = baseName(path);
    const ownership = pathOwnershipOf(path, modules.map((module) => ({ value: module, paths: module.paths })));
    const owners = ownership.status === 'owner' ? [ownership.owner]
      : ownership.status === 'tie' ? ownership.owners : [];
    const taskIds = Array.from(facts.entries())
      .filter(([, fact]) => fact.files.includes(path)).map(([id]) => id);
    let state = 'none';
    for (const id of taskIds) state = worst(state, states.get(id) ?? 'none');
    if (owners.length === 0) {
      /* No declared owner: the file is kept as the adapter's `loose` node and
         turned into a band file below (the declared tree shows it under its
         top-level support directory). */
      const file: DraftNode = {
        id: path, name, kind: 'loose', parentId: null, path,
        responsibility: '', taskIds, state, counts: { files: 1, tasks: taskIds.length },
        ...changeOfFile(path),
      };
      push(file);
      fileNodes.set(path, file);
      continue;
    }
    owners.forEach((owner, index) => {
      const moduleId = asText(owner.ref.moduleId);
      const moduleNode = moduleNodes.get(moduleId);
      if (moduleNode === undefined) return;
      /* Interface paths are declared inside one module; the longest one groups
         the file, and no interface match keeps it directly under the module. */
      const interfaces = owner.interfaces ?? [];
      const groupAt = pathOwnershipOf(path, interfaces.map((entry) => ({ value: entry.id, paths: entry.paths })));
      const groupId = groupAt.status === 'owner' ? canonicalJson([moduleId, groupAt.owner]) : null;
      const parentId = groupId !== null && interfaceGroups.has(groupId) ? groupId : moduleId;
      if (parentId !== moduleId) usedInterfaceGroups.add(parentId);
      const id = index === 0 ? path : path + '#@' + moduleId;
      const file: DraftNode = {
        id, name, kind: 'file', parentId, path,
        responsibility: '', taskIds, state, counts: { files: 1, tasks: taskIds.length },
        ...changeOfFile(path),
      };
      push(file);
      if (index === 0) fileNodes.set(path, file);
      else duplicates.set(path, [...(duplicates.get(path) ?? []), file]);
    });
  }
  /* An interface group exists only because it classified a file; no file means
     no group (a module with no observed files stays hollow, not an empty box). */
  for (const [groupId, group] of interfaceGroups) {
    if (usedInterfaceGroups.has(groupId)) continue;
    const index = nodes.indexOf(group);
    if (index >= 0) nodes.splice(index, 1);
    byId.delete(groupId);
  }

  /* a file no catalog module claims belongs to a support directory. One
     `band` node per top-level directory, its id a fresh `band:<n>` (the display
     name is the directory name, so a module named `tests` cannot be shadowed);
     root files (no `/`) share the prototype's 项目根目录文件 band. */
  const bandFiles = new Map<string, DraftNode[]>();
  for (const node of nodes) {
    if (node.kind !== 'loose') continue;
    const slash = node.path.indexOf('/');
    const key = slash < 0 ? ':files' : node.path.slice(0, slash);
    bandFiles.set(key, [...(bandFiles.get(key) ?? []), node]);
  }
  let bandIndex = 0;
  for (const key of Array.from(bandFiles.keys()).sort()) {
    const files = bandFiles.get(key) ?? [];
    while (byId.has('band:' + String(bandIndex))) bandIndex += 1;
    const bandId = 'band:' + String(bandIndex);
    bandIndex += 1;
    let touched = 0;
    let possible = false;
    for (const file of files) {
      touched += file.touched;
      possible = possible || file.possible;
      file.kind = 'file';
      file.parentId = bandId;
    }
    push({
      id: bandId, name: key === ':files' ? '项目根目录文件' : key, kind: 'band', parentId: 'SYS',
      path: key === ':files' ? '' : key, responsibility: '', taskIds: [], state: 'none',
      counts: { files: files.length, tasks: 0 }, touched, possible,
    });
  }

  /* Directory view: one folder node per observed file's directory (the
     prototype's folder-of-path grouping), whatever module owns the file; the
     files with no directory get the prototype's loose folder. */
  const dirNodes: ArchRepoNode[] = [];
  const fileDir: Record<string, string> = {};
  const wg = moduleNodes.get(WG);
  if (wg !== undefined) {
    const dirs = new Map<string, DraftNode>();
    const dirOf = (id: string, name: string, path: string): DraftNode => {
      const existing = dirs.get(id);
      if (existing !== undefined) return existing;
      const node: DraftNode = {
        id, name, kind: 'folder', parentId: WG, path, responsibility: '',
        taskIds: [], state: 'none', counts: { files: 0, tasks: 0 }, ...changeUnder(path),
      };
      dirs.set(id, node);
      dirNodes.push(node);
      return node;
    };
    const loose = dirOf('F:' + WG + '/:files', 'WorkGraph 根目录文件', WG);
    for (const file of fileNodes.values()) {
      const slash = file.path.lastIndexOf('/');
      const dir = slash < 0 ? loose : dirOf('F:' + WG + '/' + file.path.slice(0, slash), file.path.slice(0, slash), file.path.slice(0, slash));
      fileDir[file.id] = dir.id;
      dir.counts.files += 1;
      dir.state = worst(dir.state, file.state);
      for (const duplicate of duplicates.get(file.path) ?? []) fileDir[duplicate.id] = dir.id;
    }
    for (const dir of dirs.values()) if (dir.counts.files === 0) {
      const index = dirNodes.indexOf(dir);
      if (index >= 0) dirNodes.splice(index, 1);
    }
  }

  /* Link the tree and aggregate files/tasks/worst state bottom-up. */
  const kids = new Map<string, DraftNode[]>();
  for (const node of nodes) {
    if (node.parentId === null) continue;
    kids.set(node.parentId, [...(kids.get(node.parentId) ?? []), node]);
  }
  /* Each node owns the union of its descendants' file ids. */
  const fileCount = (node: DraftNode): number => {
    if (node.kind === 'file') return 1;
    return (kids.get(node.id) ?? []).reduce((sum, child) => sum + fileCount(child), 0);
  };
  const taskSet = (node: DraftNode): Set<string> => {
    const set = new Set(node.taskIds);
    for (const child of kids.get(node.id) ?? []) for (const id of taskSet(child)) set.add(id);
    return set;
  };
  const stateOf = (node: DraftNode): string => {
    if (node.kind === 'file') return node.state;
    let state = 'none';
    for (const child of kids.get(node.id) ?? []) state = worst(state, stateOf(child));
    for (const id of node.taskIds) state = worst(state, states.get(id) ?? 'none');
    return state;
  };
  for (const node of nodes) {
    if (node.kind === 'file') continue;
    node.counts = { files: fileCount(node), tasks: 0 };
    for (const id of taskSet(node)) node.counts.tasks += 1;
    node.state = stateOf(node);
    node.taskIds = Array.from(taskSet(node));
  }

  /* SYS adds its children once: a top-level module already carries its own
     containment descendants, and a band already carries its files. */
  const sys = byId.get('SYS');
  if (sys !== undefined) {
    let touched = 0;
    let possible = false;
    for (const node of nodes) {
      if (node.id === 'SYS') continue;
      if (node.parentId !== null && node.parentId !== 'SYS') continue;
      touched += node.touched;
      possible = possible || node.possible;
    }
    sys.touched = touched;
    sys.possible = possible;
  }

  /* Only module-to-module edges have a public read (`architecture/query`'s
     module nodes); file-to-file imports have none, so the page never invents
     them (its file details say 还没接通 instead). Inside one module, B1 also
     reports `interface_uses` between interface groups, keyed by the group id. */
  const edges: ArchRepoEdge[] = [];
  const endpointOf = (nodeId: string): string | null => {
    if (nodeId.startsWith('module:')) {
      const id = nodeId.slice('module:'.length);
      return moduleNodes.has(id) ? id : null;
    }
    if (nodeId.startsWith('interface:')) {
      const id = nodeId.slice('interface:'.length);
      return usedInterfaceGroups.has(id) ? id : null;
    }
    return null;
  };
  for (const edge of source.observed?.edges ?? []) {
    const from = endpointOf(asText(edge.fromNode));
    const to = endpointOf(asText(edge.toNode));
    if (from === null || to === null) continue;
    edges.push({ from, to, kind: edge.kind, count: edge.count });
  }

  const tasks: ArchTaskModelRow[] = [];
  if (source.tasks !== null) {
    const map = adaptTaskMap(
      { goal: { ref: { goalId: source.goal?.id ?? '' }, objective: source.goal?.objective ?? '' }, ordinal: source.goal?.ordinal ?? null },
      source.tasks,
      { display: { phase: 'RUNNING' } },
    );
    for (const row of map.tasks) {
      const fact = facts.get(row.id);
      tasks.push({
        id: row.id, stage: row.stageId ?? '', name: row.name, st: row.st,
        att: row.attempt ?? 1, gate: row.gate, agent: rail.owners[row.id] ?? '',
        why: row.why, sem: fact?.sem || row.instruction, deps: deps.get(row.id) ?? [],
        files: fact?.files ?? [],
      });
    }
  }
  const byTask: Record<string, ArchTaskModelRow> = {};
  for (const task of tasks) byTask[task.id] = task;

  const search = searchOf(source.search);
  const moduleNames = new Map(modules.map((module) => [asText(module.ref.moduleId), asText(module.name)]));
  const semantic = adaptArchSemantics(source.semantic ?? null, ui, moduleNames, source.lines);
  return {
    scope: { projectId: source.scope.projectId, workspaceId: source.scope.workspaceId },
    repo: {
      rootId: 'SYS', nodes, edges,
      workPaths: source.work?.files.map((file) => file.path) ?? [],
      workCounts: source.work === null ? null : {
        files: source.work.counts.files, modules: source.work.counts.modules,
      },
      workModules: (source.work?.modules ?? []).map((module) => asText(module.module.ref.moduleId))
        .filter((id) => id !== ''),
      fileDir, dirNodes,
      declared: (source.catalog?.catalog.catalog.dependencies ?? []).map((edge) => ({
        from: asText(edge.from.moduleId), to: asText(edge.to.moduleId),
      })).filter((edge) => edge.from !== '' && edge.to !== ''),
    },
    taskModel: { tasks, byId: byTask },
    words: { ...WORDS },
    rail,
    notes: source.notes,
    ...search,
    hasGoal: source.goal !== null,
    changes: source.changes === null ? null
      : { known: true, complete: source.changes.complete },
    empty: emptyOf(source.catalog, source.observation),
    unresolved: unresolved.length,
    unresolvedPaths: unresolved.slice(),
    explore: exploreRowsOf(source),
    commitBars: commitBarsOf(source),
    deepen: deepenRowsOf(source),
    notConnected: NOT_CONNECTED_TEXT,
    semantic,
  };
}
