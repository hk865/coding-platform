/**
 * Slice 8E L2: the ONE shared semantic world (rulings §8.3). L3 / F1 / F2 only
 * read it; they never open a second world and never build a note by hand.
 *
 * What it composes, and the public step behind each item:
 * - The spec §5.2 hand-made tree: the five modules `runtime` (`src/runtime`),
 *   `wg` (`src/wg`), `contracts` (`src/contracts`), `robot` (`src/robot`),
 *   `launch` (`launch`); the three unowned paths `src/compose.ts`,
 *   `src/wire2.ts`, `config/handlers.json`; and the 19 source files written
 *   VERBATIM from §5.2. The temporary root is the real S6A request world's
 *   `mkdtemp` root; this helper replaces the AG2b seed files in it before the
 *   catalog is adopted, so the tree is exactly the 19 files.
 * - The catalog through the real `architecture/adopt-initial` route, the
 *   completion policy through `completion-policies/install` +
 *   `completion-policies/activate`, and the Goal through `goals/create`; the
 *   Plan (tasks assigned to the platform scribe) and the scribe line through
 *   `plans/propose` + `plans/apply` and `sessions/create`.
 * - A REAL Host (`createLocalWorkbenchHost` behind the frozen
 *   `openS6AHostWorld`, which is the one host world the later rows already
 *   use), its in-process route function (`route`, the Host's real bindings)
 *   and `close()`.
 * - Person writes through `notes/write` (the S6B1 shape) and real Work Run
 *   writes through the scripted model + `driveWorkflow` starting at
 *   `select_work` (the S6B1 `scribeUnderstanding` shape, but the draft is the
 *   caller's link note, never the hardcoded understanding). The
 *   `record_note` tool result the Kernel delivered to the model is returned as
 *   the real write receipt; the public `notes.readNote` read returns the item.
 *   SF2 之后 Agent 和秘书的 `record_note` 走真实路径。
 * - `linkCheck` is ONE plain delegating wrapper around each of the real
 *   `createNoteService` and `createNoteCheck` module exports. Both receive the
 *   SAME `noteWorkspace` object, and the first wrapper proxies that object's
 *   `capture`/`querySource`/`readWorkspace` before the real factory runs, so
 *   the write-time evidence gate (the note service's `noteCheckWorkspace` view
 *   of the object) is counted and faulted too. It returns the real factories,
 *   exposes the counters/faults, and restores both module exports and the
 *   workspace methods in `close()`. No `vi.spyOn`, no new Host option or
 *   port, no product change.
 * - A secretary round helper that is `holdS6BRequestRound` on this same world.
 * - The `noteLimits` small-quota wrapper (DR-8E L2-04): ONE plain delegating
 *   function around the real `createTargetPlatform` module export, installed
 *   before Host construction and restored by `close()`. It merges the world's
 *   limits into the existing `TargetPlatformOptions.noteLimits` and returns the
 *   real platform. There is no `vi.spyOn` on that export and no new Host
 *   option or port.
 *
 * Rules: no hand-built `ctx` (the Host's `humanContext()` is used), no
 * hand-made note record, no store read, no mocked owner. IDs are never pinned:
 * every write returns the receipt the platform produced, and K1's `noteId` is
 * whatever that receipt says.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ToolResult } from '../../vendor/coding-agent/dist/public-api.js';
import * as platformModule from '../../src/composition/create-platform.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type {
  LinkDraftV1, LinkEndRequestV1, LinkEvidenceV1, LinkKeyV1, NoteDraftAnchorV1, NoteDraftV1,
  SemanticRelationV1, SymbolRequestV1,
} from '../../src/contracts/note.js';
import { isRecord } from '../../src/contracts/validation/common.js';
import type {
  NoteItemV1, WriteNoteEnvelopeV1, WriteNoteResult,
} from '../../src/core/work-graph/model/note-contracts.js';
import type { PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type {
  CaptureSummary, ReadWorkspaceRequest, SourcePage, SourcePageRequest, SourceProvider,
  WorkspaceFile, WorkspaceResult,
} from '../../src/core/workspace/ports.js';
import * as noteServiceModule from '../../src/core/work-graph/notes/note-service.js';
import * as noteViewsModule from '../../src/core/work-graph/views/note-views.js';
import { driveWorkflow } from './A2-restart-fixture.js';
import { graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from './S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld, type S6AReply } from './S6A-host-fixture.js';
import { committedValue, readyValue } from './S6A-memory-fixture.js';
import { S6A_SCRIBE_ROLE, S6A_SCOPE, type S6AExtraBinding } from './S6A-request-fixture.js';
import {
  adoptS6BPlan, createS6BLine, holdS6BRequestRound, type S6BHeldRound,
} from './S6B1-fixture.js';
import type { S4ANoteLimits } from './S4A-note-fixture.js';

// ---------------------------------------------------------------------------
// The §5.2 tree, verbatim
// ---------------------------------------------------------------------------

export type S8ESemanticFile = { readonly path: string; readonly content: string };

/** The 19 files of spec §5.2, in spec order; paths and contents are exact. */
export const S8E_SEMANTIC_WORLD_FILES: readonly S8ESemanticFile[] = [
  { path: 'src/contracts/access.ts', content: [
    'export interface Access {',
    '  beforeCall(id: string): Promise<void>;',
    '}',
  ].join('\n') + '\n' },
  { path: 'src/contracts/hooks.ts', content: [
    'export interface Hooks {',
    '  onSelected(id: string): void;',
    '}',
  ].join('\n') + '\n' },
  { path: 'src/runtime/run.ts', content: [
    "import type { Access } from '../contracts/access.js';",
    "import { handlers } from '../wg/registry.js';",
    'export async function runModel(access: Access, id: string) {',
    '  await access.beforeCall(id);',
    '}',
    'export function dispatch(id: string) {',
    "  handlers.get('wg.audit')?.(id);",
    '}',
    'export function saveReport(write: (path: string, text: string) => void) {',
    "  write('reports/latest.json', '{}');",
    '}',
  ].join('\n') + '\n' },
  { path: 'src/runtime/kernel.ts', content: [
    "import type { Hooks } from '../contracts/hooks.js';",
    'export function select(hooks: Hooks, id: string) {',
    '  hooks.onSelected(id);',
    '}',
  ].join('\n') + '\n' },
  { path: 'src/runtime/bus.ts', content: [
    'export class Bus {',
    '  onSelected: (id: string) => void = () => {};',
    '  select(id: string) { this.onSelected(id); }',
    '}',
  ].join('\n') + '\n' },
  { path: 'src/wg/permit.ts', content: [
    'export async function authorize(id: string): Promise<void> {',
    "  if (id === '') throw new Error('empty');",
    '}',
    'export function onPicked(id: string) {}',
    'export function loadReport(read: (path: string) => string) {',
    "  return read('reports/latest.json');",
    '}',
  ].join('\n') + '\n' },
  { path: 'src/wg/registry.ts', content: [
    'export const handlers = new Map<string, (id: string) => void>();',
  ].join('\n') + '\n' },
  { path: 'src/wg/audit.ts', content: [
    'export function audit(id: string) {}',
  ].join('\n') + '\n' },
  { path: 'src/wg/dual.ts', content: [
    'export class First {',
    '  authorize(): void {}',
    '}',
    'export class Second {',
    '  authorize(): void {}',
    '}',
  ].join('\n') + '\n' },
  { path: 'src/wg/overload.ts', content: [
    'export function pick(id: string): string;',
    'export function pick(id: number): string;',
    'export function pick(id: string | number): string {',
    "  return String(id) + 'overload-key';",
    '}',
  ].join('\n') + '\n' },
  { path: 'src/wg/overload_use.ts', content: [
    'export function runPicked(id: string) {',
    "  return id + 'overload-key';",
    '}',
  ].join('\n') + '\n' },
  { path: 'src/compose.ts', content: [
    "import { runModel } from './runtime/run.js';",
    "import { authorize, onPicked } from './wg/permit.js';",
    "import { handlers } from './wg/registry.js';",
    "import { audit } from './wg/audit.js';",
    "import type { Access } from './contracts/access.js';",
    "import type { Hooks } from './contracts/hooks.js';",
    'const access: Access = { beforeCall: authorize };',
    'export const hooks: Hooks = { onSelected: onPicked };',
    "handlers.set('wg.audit', audit);",
    'export const start = (id: string) => runModel(access, id);',
  ].join('\n') + '\n' },
  { path: 'src/wire2.ts', content: [
    "import { Bus } from './runtime/bus.js';",
    "import { onPicked } from './wg/permit.js';",
    'const bus = new Bus(); bus.onSelected = bus.select;',
  ].join('\n') + '\n' },
  { path: 'config/handlers.json', content: '{"wg.audit": "src/wg/audit.ts#audit"}\n' },
  { path: 'src/robot/teleop.py', content: [
    'def start(node):',
    "    node.create_publisher(Twist, '/cmd_vel', 10)",
  ].join('\n') + '\n' },
  { path: 'src/robot/drive.py', content: [
    'def main(node):',
    "    node.create_subscription(Twist, '/cmd_vel', on_twist, 10)",
  ].join('\n') + '\n' },
  { path: 'src/robot/ports.py', content: [
    'class Publisher:',
    '    pass',
  ].join('\n') + '\n' },
  { path: 'src/robot/setup.py', content: [
    "entry_points = {'console_scripts': ['drive_node = robot.drive:main']}",
  ].join('\n') + '\n' },
  { path: 'launch/bringup.launch.py', content: [
    "Node(package='robot', executable='drive_node')",
  ].join('\n') + '\n' },
];

/** The five modules and the three paths no module owns (spec §5.2). */
export const S8E_SEMANTIC_MODULES = [
  { moduleId: 'runtime', paths: ['src/runtime'] },
  { moduleId: 'wg', paths: ['src/wg'] },
  { moduleId: 'contracts', paths: ['src/contracts'] },
  { moduleId: 'robot', paths: ['src/robot'] },
  { moduleId: 'launch', paths: ['launch'] },
] as const;

/**
 * One interface on the `robot` module. Its declared path is drive.py, while
 * setup.py is in the same module outside that path: the fixture for `entry`
 * containment when the "to" end is an interface.
 */
export const S8E_SEMANTIC_INTERFACES = [
  { moduleId: 'robot', id: 'drive', description: 'the robot drive node interface', paths: ['src/robot/drive.py'] },
] as const;

export const S8E_UNOWNED_PATHS = ['src/compose.ts', 'src/wire2.ts', 'config/handlers.json'] as const;

/** One module of the initial catalog handed to `architecture/adopt-initial`. */
export type S8ECatalogModule = { readonly moduleId: string; readonly paths: readonly string[] };

/** The world's one project/workspace: the frozen S6A request world's real scope. */
export const S8E_SCOPE = S6A_SCOPE;
export const S8E_GOAL_REF: GoalRef = { aggregateType: 'Goal', projectId: S8E_SCOPE.projectId, goalId: 's8e-goal' };
export const S8E_BASELINE_ID = 's8e-baseline';
export const S8E_POLICY_ID = 's8e-policy';

// ---------------------------------------------------------------------------
// K1–K7, the seven contacts of spec §5.2
// ---------------------------------------------------------------------------

export type S8ELinkSpec = {
  readonly name: 'K1' | 'K2' | 'K3' | 'K4' | 'K5' | 'K6' | 'K7';
  readonly relation: SemanticRelationV1;
  readonly from: LinkEndRequestV1;
  readonly to: LinkEndRequestV1;
  readonly via: LinkEndRequestV1 | null;
  readonly key: LinkKeyV1 | null;
  readonly evidence: readonly LinkEvidenceV1[];
  readonly topic: string;
  readonly conclusion: string;
};

const tsSymbol = (path: string, name: string): LinkEndRequestV1 =>
  ({ kind: 'file', path, symbolRequest: { language: 'typescript', name } });
const plainFile = (path: string): LinkEndRequestV1 => ({ kind: 'file', path });
const symbolAt = (path: string, name: string): LinkEvidenceV1['at'] =>
  ({ path, symbolRequest: { language: 'typescript', name } });
const rangeAt = (path: string, startLine: number, endLine: number = startLine): LinkEvidenceV1['at'] =>
  ({ path, range: { startLine, endLine } });
const literalKey = (text: string): LinkKeyV1 => ({ kind: 'literal', text });

/**
 * The seven contacts exactly as spec §5.2 gives them (relation, from → to,
 * via, key, two evidence entries). K1's conclusion is the frozen literal
 * `runModel authorizes through beforeCall`.
 */
export const S8E_LINKS: Readonly<Record<S8ELinkSpec['name'], S8ELinkSpec>> = {
  K1: {
    name: 'K1', relation: 'injects', topic: 'K1', conclusion: 'runModel authorizes through beforeCall',
    from: tsSymbol('src/runtime/run.ts', 'runModel'),
    to: tsSymbol('src/wg/permit.ts', 'authorize'),
    via: tsSymbol('src/contracts/access.ts', 'beforeCall'),
    key: null,
    evidence: [
      { role: 'use', at: symbolAt('src/runtime/run.ts', 'runModel') },
      { role: 'wire', at: rangeAt('src/compose.ts', 7) },
    ],
  },
  K2: {
    name: 'K2', relation: 'callback', topic: 'K2', conclusion: 'select calls back onPicked through onSelected',
    from: tsSymbol('src/runtime/kernel.ts', 'select'),
    to: tsSymbol('src/wg/permit.ts', 'onPicked'),
    via: tsSymbol('src/contracts/hooks.ts', 'onSelected'),
    key: null,
    evidence: [
      { role: 'wire', at: rangeAt('src/compose.ts', 8) },
      { role: 'use', at: symbolAt('src/runtime/kernel.ts', 'select') },
    ],
  },
  K3: {
    name: 'K3', relation: 'calls', topic: 'K3', conclusion: 'dispatch calls audit through the wg.audit handler',
    from: tsSymbol('src/runtime/run.ts', 'dispatch'),
    to: tsSymbol('src/wg/audit.ts', 'audit'),
    via: null,
    key: literalKey('wg.audit'),
    evidence: [
      { role: 'register', at: rangeAt('src/compose.ts', 9) },
      { role: 'use', at: symbolAt('src/runtime/run.ts', 'dispatch') },
    ],
  },
  K4: {
    name: 'K4', relation: 'data', topic: 'K4', conclusion: 'saveReport writes the report loadReport reads',
    from: tsSymbol('src/runtime/run.ts', 'saveReport'),
    to: tsSymbol('src/wg/permit.ts', 'loadReport'),
    via: null,
    key: literalKey('reports/latest.json'),
    evidence: [
      { role: 'emit', at: symbolAt('src/runtime/run.ts', 'saveReport') },
      { role: 'receive', at: symbolAt('src/wg/permit.ts', 'loadReport') },
    ],
  },
  K5: {
    name: 'K5', relation: 'message', topic: 'K5', conclusion: 'teleop publishes the drive command',
    from: plainFile('src/robot/teleop.py'),
    to: plainFile('src/robot/drive.py'),
    via: null,
    key: literalKey('/cmd_vel'),
    evidence: [
      { role: 'emit', at: rangeAt('src/robot/teleop.py', 2) },
      { role: 'receive', at: rangeAt('src/robot/drive.py', 2) },
    ],
  },
  K6: {
    name: 'K6', relation: 'spawns', topic: 'K6', conclusion: 'bringup launches the robot drive node',
    from: plainFile('launch/bringup.launch.py'),
    to: { kind: 'module', moduleId: 'robot' },
    via: null,
    key: literalKey('drive_node'),
    evidence: [
      { role: 'launch', at: { path: 'launch/bringup.launch.py' } },
      { role: 'entry', at: { path: 'src/robot/setup.py' } },
    ],
  },
  K7: {
    name: 'K7', relation: 'data', topic: 'K7', conclusion: 'pick feeds runPicked through overload-key',
    from: tsSymbol('src/wg/overload.ts', 'pick'),
    to: tsSymbol('src/wg/overload_use.ts', 'runPicked'),
    via: null,
    key: literalKey('overload-key'),
    evidence: [
      { role: 'emit', at: symbolAt('src/wg/overload.ts', 'pick') },
      { role: 'receive', at: symbolAt('src/wg/overload_use.ts', 'runPicked') },
    ],
  },
};

/** A `link` draft for one contact; `overrides` replace top-level draft fields. */
export function s8eLinkDraft(spec: S8ELinkSpec, overrides: Partial<LinkDraftV1> = {}): LinkDraftV1 {
  const extraAnchors: NoteDraftAnchorV1[] = spec.via === null ? [spec.to] : [spec.to, spec.via];
  const draft: LinkDraftV1 = {
    kind: 'link', topic: spec.topic, conclusion: spec.conclusion,
    anchor: spec.from, extraAnchors,
    facts: [], basisFiles: [], structural: false, replaces: [], contradicts: [], coexistWith: [],
    body: '',
    link: { relation: spec.relation, key: spec.key,
      evidence: spec.evidence.map(entry => structuredClone(entry)) },
  };
  return { ...draft, ...overrides };
}

// ---------------------------------------------------------------------------
// The quota wrapper (DR-8E L2-04)
// ---------------------------------------------------------------------------

/**
 * Installs ONE plain delegating function around the real module export: it
 * merges the world's limits into the Host's existing `noteLimits` and returns
 * the real platform. No `vi.spyOn` on this export (the S6A world already has
 * its own single delegating spy for platform capture), no Host option and no
 * new port. Returns the paired restore.
 */
function installQuotaWrapper(limits: S4ANoteLimits): () => void {
  const actual = platformModule.createTargetPlatform;
  const wrapper: typeof actual = async options => {
    const merged = Object.keys(limits).length === 0
      ? options
      : { ...options, noteLimits: { ...(options.noteLimits ?? {}), ...limits } };
    return await actual(merged);
  };
  Object.defineProperty(platformModule, 'createTargetPlatform',
    { value: wrapper, configurable: true, writable: true });
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    Object.defineProperty(platformModule, 'createTargetPlatform',
      { value: actual, configurable: true, writable: true });
  };
}

// ---------------------------------------------------------------------------
// The check / workspace proxy (counters and faults)
// ---------------------------------------------------------------------------

export type S8ELinkCheckCounters = { captures: number; queries: number; textQueries: number };
/** A fault for one `capture` call; `null` delegates to the real capture. */
export type S8ECaptureFault = (request: { provider: SourceProvider }) => WorkspaceResult<CaptureSummary> | null;
/** A fault for one `querySource` call; `null` delegates to the real query. */
export type S8ESourceQueryFault = (request: SourcePageRequest) => WorkspaceResult<SourcePage> | null;
/** A fault for one `readWorkspace` call; `null` delegates to the real read. */
export type S8EWorkspaceReadFault = (request: ReadWorkspaceRequest) => WorkspaceResult<WorkspaceFile> | null;

export type S8ELinkCheckProbe = {
  counters(): S8ELinkCheckCounters;
  reset(): void;
  faultCaptures(fault: S8ECaptureFault | null): void;
  faultQueries(fault: S8ESourceQueryFault | null): void;
  faultReads(fault: S8EWorkspaceReadFault | null): void;
};

type CheckDependencies = Parameters<typeof noteViewsModule.createNoteCheck>[0];
type CheckWorkspace = NonNullable<CheckDependencies['workspace']>;

/**
 * Installs ONE plain delegating function around each of the real
 * `createNoteService` and `createNoteCheck` exports. The platform passes its
 * shared `noteWorkspace` object to both; the first wrapper that sees it
 * proxies that object's three workspace methods IN PLACE before the real
 * factory runs (the note service builds its `noteCheckWorkspace` view from the
 * methods it finds then), counts capture/query calls, offers optional faults,
 * and returns the real factory's result unchanged. `restore()` puts both module
 * exports and every proxied method back.
 */
function installLinkCheckProbe(): { probe: S8ELinkCheckProbe; restore: () => void } {
  const actual = noteViewsModule.createNoteCheck;
  const actualService = noteServiceModule.createNoteService;
  let counters: S8ELinkCheckCounters = { captures: 0, queries: 0, textQueries: 0 };
  let captureFault: S8ECaptureFault | null = null;
  let queryFault: S8ESourceQueryFault | null = null;
  let readFault: S8EWorkspaceReadFault | null = null;
  const restores: (() => void)[] = [];
  const proxied = new WeakSet<object>();

  const proxyInPlace = (workspace: CheckWorkspace | undefined): void => {
    if (workspace !== undefined && !proxied.has(workspace)) {
      proxied.add(workspace);
      const originalCapture = workspace.capture;
      const originalQuery = workspace.querySource;
      const originalRead = workspace.readWorkspace;
      if (originalCapture !== undefined) {
        workspace.capture = async (ctx, request) => {
          counters = { ...counters, captures: counters.captures + 1 };
          const faulted = captureFault?.(request);
          return faulted ?? await originalCapture(ctx, request);
        };
      }
      if (originalQuery !== undefined) {
        workspace.querySource = async (ctx, request) => {
          counters = { ...counters, queries: counters.queries + 1,
            ...(request.query.kind === 'text' ? { textQueries: counters.textQueries + 1 } : {}) };
          const faulted = queryFault?.(request);
          return faulted ?? await originalQuery(ctx, request);
        };
      }
      workspace.readWorkspace = async (ctx, request) => {
        const faulted = readFault?.(request);
        return faulted ?? await originalRead(ctx, request);
      };
      restores.push(() => {
        if (originalCapture !== undefined) workspace.capture = originalCapture;
        if (originalQuery !== undefined) workspace.querySource = originalQuery;
        workspace.readWorkspace = originalRead;
      });
    }
  };
  const wrapper: typeof actual = dependencies => {
    proxyInPlace(dependencies.workspace as CheckWorkspace | undefined);
    return actual(dependencies);
  };
  const serviceWrapper: typeof actualService = dependencies => {
    proxyInPlace(dependencies.workspace);
    return actualService(dependencies);
  };
  Object.defineProperty(noteViewsModule, 'createNoteCheck',
    { value: wrapper, configurable: true, writable: true });
  Object.defineProperty(noteServiceModule, 'createNoteService',
    { value: serviceWrapper, configurable: true, writable: true });
  const probe: S8ELinkCheckProbe = {
    counters: () => ({ ...counters }),
    reset: () => { counters = { captures: 0, queries: 0, textQueries: 0 }; },
    faultCaptures: fault => { captureFault = fault; },
    faultQueries: fault => { queryFault = fault; },
    faultReads: fault => { readFault = fault; },
  };
  let restored = false;
  return {
    probe,
    restore: () => {
      if (restored) return;
      restored = true;
      for (const restore of restores.splice(0)) restore();
      Object.defineProperty(noteViewsModule, 'createNoteCheck',
        { value: actual, configurable: true, writable: true });
      Object.defineProperty(noteServiceModule, 'createNoteService',
        { value: actualService, configurable: true, writable: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Route / receipt helpers
// ---------------------------------------------------------------------------

const toolResultOf = (tool: ToolResult): WriteNoteEnvelopeV1 | null => {
  if (tool.status !== 'success') return null;
  const json = tool.output.find(entry => entry.kind === 'json');
  if (json === undefined || json.kind !== 'json' || !isRecord(json.value)) return null;
  const value = json.value;
  if (!isRecord(value['write'])) return null;
  return { write: value['write'] as unknown as WriteNoteResult,
    check: value['check'] as WriteNoteEnvelopeV1['check'] };
};

/** The strict model args of one draft (the shape `RecordNoteArgs` accepts). */
function recordNoteArgs(note: NoteDraftV1): Record<string, unknown> {
  const common = {
    op: 'write', kind: note.kind, topic: note.topic, conclusion: note.conclusion,
    anchor: structuredClone(note.anchor), extraAnchors: structuredClone(note.extraAnchors),
    facts: structuredClone(note.facts), basisFiles: [...note.basisFiles], structural: note.structural,
    replaces: [...note.replaces], contradicts: [...note.contradicts], coexistWith: [...note.coexistWith],
  };
  if (note.kind === 'link') return { ...common, body: note.body, link: structuredClone(note.link) };
  if (note.kind === 'understanding') return { ...common, sections: structuredClone(note.sections) };
  if (note.kind === 'repair') return { ...common, body: note.body, repair: structuredClone(note.repair) };
  return { ...common, body: note.body };
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

export type S8EWorldOptions = {
  backend?: 'memory' | 'sqlite';
  /** Merged over the Host's existing `TargetPlatformOptions.noteLimits`. */
  noteLimits?: S4ANoteLimits;
  /** Work tasks assigned to the platform scribe; default 24 (K1–K7 and the later variants). */
  scribeTasks?: number;
  /** The Host secretary binding's tool grant; omitted keeps the Host default (`['read']`). */
  secretaryTools?: readonly string[];
  /**
   * L3 R-context: optional pass-through of the Host fixture's existing
   * `extraBindings` (an edit-granted binding adds `write`/a write scope to the
   * scribe binding). Omitted keeps every fixture binding exactly as it is.
   */
  extraBindings?: readonly S6AExtraBinding[];
  /**
   * L3 R-route E-14: the initial catalog's module list, passed through to the
   * real `architecture/adopt-initial` body. Omitted keeps `S8E_SEMANTIC_MODULES`
   * (the five-module §5.2 world); no step or default changes.
   */
  catalogModules?: readonly S8ECatalogModule[];
};

export type S8EPersonWriteOptions = {
  goalId?: string | null;
  expectedPointerRevision?: number | null;
  commandId?: string;
};

export type S8EAgentWriteOptions = {
  label?: string;
  /** Run an existing Plan task instead of consuming the next one. */
  taskId?: string;
};

export type S8EAgentWrite = {
  task: TaskTriple;
  /** The Kernel-delivered `record_note` result (the real receipt path). */
  toolResult: ToolResult;
  /** `{write, check}` when the Kernel delivered a successful tool result. */
  envelope: WriteNoteEnvelopeV1 | null;
  /** The public `notes.readNote` item of the accepted note, or null. */
  item: NoteItemV1 | null;
};

export type S8ESecretaryRoundInput = {
  label: string;
  goalId: string | null;
  replies?: (manifest: PreparedQueryManifestV1) => S6AReply[];
};

export type S8ESemanticWorld = S6AHostWorld & {
  readonly scope: typeof S8E_SCOPE;
  readonly root: string;
  readonly goalRef: GoalRef;
  readonly catalogRevision: number;
  readonly tasks: readonly TaskTriple[];
  nextScribeTask(): TaskTriple;
  /** The check/capture counters and faults; proxy installed before the Host is built. */
  readonly linkCheck: S8ELinkCheckProbe;

  /** Person write through the real `notes/write` route; returns the owner's `WriteNoteResult`. */
  writePerson(note: NoteDraftV1, options?: S8EPersonWriteOptions): Promise<WriteNoteResult>;
  /** The same person write with the route's full `{write, check}` envelope. */
  writePersonEnvelope(note: NoteDraftV1, options?: S8EPersonWriteOptions): Promise<WriteNoteEnvelopeV1>;
  /** Real Work Run write through the scripted model and `workflow/advance` from `select_work`. */
  writeAgent(note: NoteDraftV1, options?: S8EAgentWriteOptions): Promise<S8EAgentWrite>;
  /** `writeAgent(s8eLinkDraft(spec))` for one of K1–K7. */
  writeAgentLink(spec: S8ELinkSpec, options?: S8EAgentWriteOptions): Promise<S8EAgentWrite>;
  /** A route in process on the Host's real bindings, with a trusted context (default the Host human). */
  route(suffix: string, input: unknown, ctx?: CoreCallContext): Promise<unknown>;
  /** The real secretary round (`holdS6BRequestRound`) on this world. */
  secretaryRound<T>(input: S8ESecretaryRoundInput,
    use: (round: S6BHeldRound) => Promise<T>): Promise<{ value: T; started: unknown }>;
};

/** Replaces the S6A seed's files so the root is exactly the 19 §5.2 files. */
async function writeTree(root: string): Promise<void> {
  await rm(join(root, 'src'), { recursive: true, force: true });
  await rm(join(root, 'tsconfig.json'), { force: true });
  for (const file of S8E_SEMANTIC_WORLD_FILES) {
    const target = join(root, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
  }
}

export async function openS8ESemanticWorld(options: S8EWorldOptions = {}): Promise<S8ESemanticWorld> {
  const backend = options.backend ?? 'memory';
  const restoreQuota = installQuotaWrapper(options.noteLimits ?? {});
  const linkCheck = installLinkCheckProbe();
  let hostWorld: S6AHostWorld;
  try {
    // `scribe: true` gives the Runtime and Workflow the platform scribe binding;
    // `defaultGoals: false` leaves the project/workspace seed only (the 8E Goal
    // is created below through its own route).
    hostWorld = await openS6AHostWorld({ backend, scribe: true, defaultGoals: false,
      ...(options.secretaryTools === undefined ? {} : { secretaryTools: options.secretaryTools }),
      ...(options.extraBindings === undefined ? {} : { extraBindings: options.extraBindings }) });
  } catch (error) {
    linkCheck.restore();
    restoreQuota();
    throw error;
  }

  let closed = false;
  try {
    const scope = S8E_SCOPE;
    const projectRef = { aggregateType: 'Project' as const, projectId: scope.projectId };
    const workspaceRef = { aggregateType: 'Workspace' as const, ...scope };
    const ws: S6ACardsWorkspace = s6aCardsWorkspace(hostWorld, scope);

    // 1. The exact 19-file tree, written into the real Host workspace root.
    await writeTree(hostWorld.root);

    // 2. The completion policy and the initial catalog, through their routes.
    const registration = readyValue<{ project: { revision: number }; workspace: { revision: number } }>(
      await ws.route('workspaces/registration', { ...scope }), 'the workspace registration');
    const installed = committedValue<Record<string, unknown>>(await ws.post('completion-policies/install', graphWrite(scope, {
      policyId: S8E_POLICY_ID, contentRevision: 1,
      content: { schemaVersion: 1, requirementKinds: ['test', 'static'], minimumRequiredRequirementsPerObligation: 1 },
    }, 's8e-policy-install', [
      { ref: projectRef, revision: registration.project.revision },
      { ref: { aggregateType: 'CompletionPolicyRevision', projectId: scope.projectId,
        policyId: S8E_POLICY_ID, revision: 1 }, revision: 0 },
    ])), 'the completion policy install');
    committedValue(await ws.post('completion-policies/activate', graphWrite(scope, {
      target: { ref: installed['ref'], digest: installed['contentDigest'] },
    }, 's8e-policy-activate', [
      { ref: projectRef, revision: registration.project.revision },
      { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId: scope.projectId }, revision: 0 },
    ])), 'the completion policy activation');

    const catalogModules = options.catalogModules ?? S8E_SEMANTIC_MODULES;
    const adopted = committedValue<Record<string, unknown>>(await ws.post('architecture/adopt-initial', graphWrite(scope, {
      baselineId: S8E_BASELINE_ID, description: 'S8E semantic world', constraints: [],
      catalog: {
        requireDag: true, dependencies: [],
        modules: catalogModules.map(module => ({
          ref: { projectId: scope.projectId, moduleId: module.moduleId },
          name: module.moduleId, responsibility: `The ${module.moduleId} module`,
          paths: [...module.paths],
          interfaces: S8E_SEMANTIC_INTERFACES
            .filter(entry => entry.moduleId === module.moduleId)
            .map(({ id, description, paths }) => ({ id, description, paths: [...paths] })),
        })),
      },
    }, 's8e-adopt-initial', [
      { ref: projectRef, revision: registration.project.revision },
      { ref: workspaceRef, revision: registration.workspace.revision },
    ])), 'the initial catalog adoption');
    const baseline = isRecord(adopted['baseline']) ? adopted['baseline'] : {};
    const baselineRef = isRecord(baseline['ref']) ? baseline['ref'] : {};
    const catalogRevision = typeof baselineRef['revision'] === 'number' ? baselineRef['revision'] : 1;
    // The Host's own auto capture follows the adoption as detached work; settle it.
    await hostWorld.settleDetached();

    // 3. Goal, Plan (scribe tasks) and the project scribe line, all public.
    await ws.createGoal(S8E_GOAL_REF.goalId, 'S8E semantic world');
    const taskCount = options.scribeTasks ?? 24;
    const taskIds = Array.from({ length: taskCount }, (_, index) => `s8e-task-${String(index + 1).padStart(2, '0')}`);
    const { tasks } = await adoptS6BPlan(ws, S8E_GOAL_REF, { label: 's8e', role: S6A_SCRIBE_ROLE.templateId, taskIds });
    const line = await createS6BLine(ws, { label: 's8e-scribe', role: S6A_SCRIBE_ROLE });

    const closeHost = hostWorld.close.bind(hostWorld);
    let taskCursor = 0;
    let commandSeq = 0;
    const nextScribeTask = (): TaskTriple => {
      const task = tasks[taskCursor];
      if (task === undefined) throw new Error(`S8E: the scribe's ${tasks.length} tasks are used up`);
      taskCursor += 1;
      return task;
    };
    const taskById = (taskId: string): TaskTriple => {
      const task = tasks.find(candidate => candidate.taskId === taskId);
      if (task === undefined) throw new Error(`S8E: the Plan has no task ${taskId}`);
      return task;
    };

    const noteById = async (noteId: string): Promise<NoteItemV1 | null> => {
      const read = await hostWorld.platform.notes.readNote(hostWorld.humanContext(), { noteId });
      return read.status === 'ready' ? read.value : null;
    };

    const world: S8ESemanticWorld = Object.assign(hostWorld, {
      goalRef: S8E_GOAL_REF,
      catalogRevision,
      tasks,
      nextScribeTask,
      linkCheck: linkCheck.probe,
      async writePersonEnvelope(note: NoteDraftV1,
        writeOptions: S8EPersonWriteOptions = {}): Promise<WriteNoteEnvelopeV1> {
        commandSeq += 1;
        hostWorld.clock.advance(1000);
        const body = await ws.route('notes/write', {
          commandId: writeOptions.commandId ?? `s8e-person-${commandSeq}`,
          goalId: writeOptions.goalId === undefined ? null : writeOptions.goalId,
          expectedPointerRevision: writeOptions.expectedPointerRevision === undefined
            ? null : writeOptions.expectedPointerRevision,
          note,
        });
        const record = isRecord(body) ? body : {};
        const write = record['write'];
        if (!isRecord(write) || typeof write['status'] !== 'string') {
          throw new Error(`S8E: notes/write returned no write receipt: ${JSON.stringify(body)}`);
        }
        return body as WriteNoteEnvelopeV1;
      },
      async writePerson(note: NoteDraftV1, writeOptions: S8EPersonWriteOptions = {}): Promise<WriteNoteResult> {
        return (await world.writePersonEnvelope(note, writeOptions)).write;
      },
      async writeAgent(note: NoteDraftV1, writeOptions: S8EAgentWriteOptions = {}): Promise<S8EAgentWrite> {
        const task = writeOptions.taskId === undefined ? nextScribeTask() : taskById(writeOptions.taskId);
        commandSeq += 1;
        const label = writeOptions.label ?? `note-${commandSeq}`;
        const callId = `s8e-note-${label}`;
        const before = hostWorld.model.calls();
        hostWorld.clock.advance(1000);
        hostWorld.scriptReplies([
          { kind: 'calls', calls: [{ callId, name: 'record_note', args: recordNoteArgs(note) }] },
          { kind: 'text', text: `S8E wrote ${label}` },
        ]);
        await driveWorkflow(hostWorld.ag2b, { schemaVersion: 1, goalRef: S8E_GOAL_REF,
          flowId: `s8e-${label}`, sessionHint: line.ref, kind: 'select_work', taskId: task.taskId });
        const after = hostWorld.model.calls();
        if (after !== before + 2) {
          throw new Error(`S8E: the Run for ${label} made ${after - before} model calls, not 2`);
        }
        const request = hostWorld.model.requests[before + 1];
        const delivered = request?.messages.find(message => message.role === 'tool' && message.callId === callId);
        if (delivered === undefined || delivered.role !== 'tool') {
          throw new Error(`S8E: the record_note result for ${label} was not delivered to the model`);
        }
        const toolResult = delivered.result;
        if (toolResult.status !== 'success') {
          const detail = toolResult.status === 'error' ? toolResult.error.message : toolResult.status;
          throw new Error(`S8E: record_note failed for ${label}: ${detail}`);
        }
        const envelope = toolResultOf(toolResult);
        const item = envelope !== null && 'noteId' in envelope.write
          ? await noteById(envelope.write.noteId) : null;
        return { task, toolResult, envelope, item };
      },
      async writeAgentLink(spec: S8ELinkSpec, writeOptions: S8EAgentWriteOptions = {}): Promise<S8EAgentWrite> {
        return await world.writeAgent(s8eLinkDraft(spec), writeOptions);
      },
      async route(suffix: string, input: unknown, ctx: CoreCallContext = hostWorld.humanContext()) {
        return await hostWorld.dispatch(suffix, ctx, plain(scope, input));
      },
      async secretaryRound<T>(input: S8ESecretaryRoundInput, use: (round: S6BHeldRound) => Promise<T>) {
        return await holdS6BRequestRound(hostWorld, input, use);
      },
      async close() {
        if (closed) return;
        closed = true;
        try {
          await closeHost();
        } finally {
          linkCheck.restore();
          restoreQuota();
        }
      },
    }) as S8ESemanticWorld;
    return world;
  } catch (error) {
    await hostWorld.close().catch(() => undefined);
    linkCheck.restore();
    restoreQuota();
    throw error;
  }
}

/** Convenience type for the seven contact names. */
export type S8ELinkName = S8ELinkSpec['name'];
/** The raw symbol request type, re-exported so rows do not import production contracts twice. */
export type { SymbolRequestV1 };
