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
 *   `readWorkspace`/`readWorkspaceFiles`/`verify` before the real factory runs,
 *   so the write-time evidence gate (the note service's `noteCheckWorkspace`
 *   view of the object) is counted and faulted too. It returns the real
 *   factories, exposes the build counter and the faults, and restores both
 *   module exports and the workspace methods in `close()`. No `vi.spyOn`, no
 *   new Host option or port, no product change. 8E-2 (§4.1 :708, :712): where
 *   the object has them, `verify` is counted (`builds`), faulted and gated, and
 *   the read fault also hits `readWorkspaceFiles` path by path.
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
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ModelRequest, ToolResult } from '../../vendor/coding-agent/dist/public-api.js';
import * as platformModule from '../../src/composition/create-platform.js';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { TaskTriple } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type {
  LinkDraftV1, LinkEndRequestV1, LinkEvidenceV1, LinkKeyV1, LinkVerificationV1, NoteDraftAnchorV1, NoteDraftV1,
  SemanticRelationV1, SymbolRequestV1,
} from '../../src/contracts/note.js';
import type { SemanticLinkV1, SemanticPageV1 } from '../../src/contracts/semantic-layer.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import { isRecord } from '../../src/contracts/validation/common.js';
import type {
  NoteItemV1, WriteNoteEnvelopeV1, WriteNoteResult,
} from '../../src/core/work-graph/model/note-contracts.js';
import type { PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import { localWorkbenchGrant, type WorkbenchWorkspaceConfig } from '../../src/app/host.js';
import {
  LOCAL_WORKBENCH_BUDGET, LOCAL_WORKBENCH_ROLE, LOCAL_WORKBENCH_ROLE_BINDING, type WorkbenchQueryProfile,
} from '../../src/app/runtime-configuration.js';
import type {
  ReadWorkspaceRequest, ReferenceAnalyzerPort, ReferenceCheckRequestV1, ReferenceCheckResultV1,
  WorkspaceFile, WorkspaceResult,
} from '../../src/core/workspace/ports.js';
import type { WorkspaceToolsHandle } from '../../src/core/workspace/workspace-tools.js';
import * as noteServiceModule from '../../src/core/work-graph/notes/note-service.js';
import * as noteViewsModule from '../../src/core/work-graph/views/note-views.js';
import { driveWorkflow } from './A2-restart-fixture.js';
import { AG2B_CONSUMER_ID, graphWrite, plain } from './AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace, type S6ACardsWorkspace } from './S6A-cards-fixture.js';
import { openS6AHostWorld, type S6AHostWorld, type S6AReply } from './S6A-host-fixture.js';
import { committedValue, readyValue } from './S6A-memory-fixture.js';
import {
  S6A_SCRIBE_ROLE, S6A_SCOPE, type S6AExtraBinding, type S6ASession,
} from './S6A-request-fixture.js';
import {
  adoptS6BPlan, createS6BLine, holdS6BRequestRound, type S6BHeldRound, type S6BLine,
} from './S6B1-fixture.js';
import { sessionOf } from './S7A-fixture.js';
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
/** E2-14a/E2-14b: the second Goal, its one Plan task and line, the grant binding and the Query profile. */
export const S8E_LOCAL_GOAL_ID = 's8e-h-local-goal';
export const S8E_LOCAL_TASK_ID = 's8e-h-local-task';
export const S8E_LOCAL_WORKBENCH_BINDING_ID = 's8e-h-local-workbench';
export const S8E_LOCAL_WORKBENCH_PROFILE_ID = 's8e-h-local-workbench-query';

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

/** The real platform factory, captured before any wrapper: `restoreMocks` puts a previous test's wrapper back. */
const realCreateTargetPlatform = platformModule.createTargetPlatform;

/**
 * Installs ONE plain delegating function around the real module export: it
 * merges the world's limits into the Host's existing `noteLimits` and returns
 * the real platform. No `vi.spyOn` on this export (the S6A world already has
 * its own single delegating spy for platform capture), no Host option and no
 * new port. Returns the paired restore.
 */
function installQuotaWrapper(limits: S4ANoteLimits, noteNewId?: () => string): () => void {
  const actual = realCreateTargetPlatform;
  const wrapper: typeof actual = async options => {
    const merged = {
      ...options,
      ...(Object.keys(limits).length === 0 ? {} : { noteLimits: { ...(options.noteLimits ?? {}), ...limits } }),
      ...(noteNewId === undefined ? {} : { noteNewId }),
    };
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
// The check / workspace proxy (the build counter and faults)
// ---------------------------------------------------------------------------

/** 8E-2 G (§4.1 :708, :886): the one counter left is the second tier's program builds. */
export type S8ELinkCheckCounters = { builds: number };
/** A fault for one `readWorkspace` call; `null` delegates to the real read. */
export type S8EWorkspaceReadFault = (request: ReadWorkspaceRequest) => WorkspaceResult<WorkspaceFile> | null;

/** 8E-2 R (§4.1): a fault for one `verify` call; non-null is that call's result and no program is built. */
export type S8EVerifyFault = (request: ReferenceCheckRequestV1) => WorkspaceResult<ReferenceCheckResultV1> | null;
/** 8E-2 R (§4.1, A3/F9): the next `verify` resolves `entered` and waits for `release()`; `settled` follows its result. */
export type S8EVerifyGate = { entered: Promise<void>; release(): void; settled: Promise<void> };

export type S8ELinkCheckProbe = {
  counters(): S8ELinkCheckCounters;
  reset(): void;
  /** Also hits each path of `readWorkspaceFiles` (as a working-tree `readWorkspace` request). */
  faultReads(fault: S8EWorkspaceReadFault | null): void;
  /** 8E-2 R: second-tier program builds (one per `verify` handed to the real analyzer); `reset()` zeroes it. */
  builds(): number;
  faultVerify(fault: S8EVerifyFault | null): void;
  holdVerify(): S8EVerifyGate;
};

type CheckDependencies = Parameters<typeof noteViewsModule.createNoteCheck>[0];
/** Widened locally: before 8E-2 R the shared `noteWorkspace` has neither `verify` nor `readWorkspaceFiles`. */
type CheckWorkspace = NonNullable<CheckDependencies['workspace']> & {
  verify?: ReferenceAnalyzerPort['verify'];
  readWorkspaceFiles?: WorkspaceToolsHandle['readWorkspaceFiles'];
};

/**
 * Installs ONE plain delegating function around each of the real
 * `createNoteService` and `createNoteCheck` exports. The platform passes its
 * shared `noteWorkspace` object to both; the first wrapper that sees it
 * proxies that object's three workspace methods IN PLACE before the real
 * factory runs (the note service builds its `noteCheckWorkspace` view from the
 * methods it finds then), counts the program builds of `verify`, offers
 * optional faults, and returns the real factory's result unchanged. `restore()`
 * puts both module exports and every proxied method back.
 */
function installLinkCheckProbe(): { probe: S8ELinkCheckProbe; restore: () => void } {
  const actual = noteViewsModule.createNoteCheck;
  const actualService = noteServiceModule.createNoteService;
  let readFault: S8EWorkspaceReadFault | null = null;
  let builds = 0;
  let verifyFault: S8EVerifyFault | null = null;
  let verifyGate: { enter(): void; released: Promise<void>; settle(): void } | null = null;
  const restores: (() => void)[] = [];
  const proxied = new WeakSet<object>();

  const proxyInPlace = (workspace: CheckWorkspace | undefined): void => {
    if (workspace !== undefined && !proxied.has(workspace)) {
      proxied.add(workspace);
      const originalRead = workspace.readWorkspace;
      const originalVerify = workspace.verify;
      const originalReadFiles = workspace.readWorkspaceFiles;
      if (originalVerify !== undefined) {
        // One `verify` handed to the real analyzer is one program build (8E-2 §4.1 :708);
        // a faulted call is short-circuited and builds nothing.
        workspace.verify = async (ctx, request) => {
          const gate = verifyGate;
          verifyGate = null;
          try {
            if (gate !== null) {
              gate.enter();
              await gate.released;
            }
            const faulted = verifyFault?.(request) ?? null;
            if (faulted !== null) return faulted;
            builds += 1;
            return await originalVerify(ctx, request);
          } finally {
            gate?.settle();
          }
        };
      }
      if (originalReadFiles !== undefined) {
        // The read fault hits each path as the working-tree read it stands for; the
        // rest goes to the real batch read once, merged back in `paths` order.
        workspace.readWorkspaceFiles = async (ctx, input) => {
          const fault = readFault;
          if (fault === null) return await originalReadFiles(ctx, input);
          const faulted = input.paths.map(path => fault({ workspace: input.workspace, path,
            maxBytes: input.maxBytes, version: { kind: 'working_tree' } }));
          const rest = input.paths.filter((_, index) => faulted[index] === null);
          let real: WorkspaceResult<WorkspaceFile>[] = [];
          if (rest.length > 0) {
            const outer = await originalReadFiles(ctx, { ...input, paths: rest });
            if (outer.status !== 'ready') return outer;
            real = outer.value;
          }
          let next = 0;
          return { status: 'ready', value: faulted.map(entry => {
            if (entry !== null) return entry;
            const answer = real[next];
            next += 1;
            if (answer === undefined) throw new Error('S8E: readWorkspaceFiles answered fewer paths than asked');
            return answer;
          }) };
        };
      }
      workspace.readWorkspace = async (ctx, request) => {
        const faulted = readFault?.(request);
        return faulted ?? await originalRead(ctx, request);
      };
      restores.push(() => {
        workspace.readWorkspace = originalRead;
        if (originalVerify !== undefined) workspace.verify = originalVerify;
        if (originalReadFiles !== undefined) workspace.readWorkspaceFiles = originalReadFiles;
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
    counters: () => ({ builds }),
    reset: () => { builds = 0; },
    faultReads: fault => { readFault = fault; },
    builds: () => builds,
    faultVerify: fault => { verifyFault = fault; },
    holdVerify: () => {
      let enter = (): void => undefined;
      let release = (): void => undefined;
      let settle = (): void => undefined;
      const entered = new Promise<void>(resolve => { enter = resolve; });
      const released = new Promise<void>(resolve => { release = resolve; });
      const settled = new Promise<void>(resolve => { settle = resolve; });
      verifyGate = { enter, released, settle };
      return { entered, release, settled };
    },
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
  if (note.kind === 'flow') return { ...common, body: note.body, flow: structuredClone(note.flow) };
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
  /** 8E2 S：固定 L8 摘要用的 noteId 序列（组合根已有的 `noteNewId`）。 */
  noteNewId?: () => string;
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
  /**
   * 8E2 H: extra real Host options, passed through untyped to
   * `openS6AHostWorld`'s `extraHostOptions` (the link-batch knobs and the
   * injected clock). Omitted keeps the Host exactly as it is today.
   */
  hostOptions?: Record<string, unknown>;
  /**
   * 8E2 H (E2-14a/E2-14b): add ONE new binding whose grant is the production
   * `localWorkbenchGrant` (a read-only workspace with no write prefix and no
   * command), its Workflow row for the `local-workbench` role and its Query
   * profile, then create a second Goal, Plan task and line for it. The
   * existing fixture binding, Goal, Plan and scribe line are untouched.
   */
  localWorkbench?: true;
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

/**
 * E2-14a/E2-14b: the second Goal, its one Plan task, the line responsible for
 * it (the real `sessions/read` handle) and the Query profile registered for the
 * same grant. `profile` is the configuration object handed to the Host, not a
 * bootstrap read; a Query row still drives it through the public routes.
 */
export type S8ELocalWorkbench = {
  readonly bindingId: string;
  readonly goalRef: GoalRef;
  readonly task: TaskTriple;
  readonly line: S6BLine;
  readonly session: S6ASession;
  readonly profile: WorkbenchQueryProfile;
};

export type S8ESemanticWorld = S6AHostWorld & {
  readonly scope: typeof S8E_SCOPE;
  readonly root: string;
  readonly goalRef: GoalRef;
  readonly catalogRevision: number;
  readonly tasks: readonly TaskTriple[];
  nextScribeTask(): TaskTriple;
  /** The program-build counter and the faults; proxy installed before the Host is built. */
  readonly linkCheck: S8ELinkCheckProbe;
  /** The scribe line the world's own Goal/Plan belongs to (`holdS8EScribeRun` holds its Run). */
  readonly scribeLine: S6BLine;
  /** The `localWorkbench: true` Goal/task/line/session/profile; null when the option is omitted. */
  readonly localWorkbench: S8ELocalWorkbench | null;

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
  const restoreQuota = installQuotaWrapper(options.noteLimits ?? {}, options.noteNewId);
  const linkCheck = installLinkCheckProbe();
  let localProfile: WorkbenchQueryProfile | null = null;
  const extraBindings: S6AExtraBinding[] = [...(options.extraBindings ?? [])];
  if (options.localWorkbench === true) {
    // The production grant's source: a read-only workspace (no write prefix, no
    // command), so the binding gets `read`, the graph tools and the check tool
    // when H ships it, and the Query projection keeps the same ceiling.
    const workspace: WorkbenchWorkspaceConfig = { scope: S8E_SCOPE, name: 'S8E local workbench',
      root: '/workspace', workspaceRevision: 1, readPrefixes: ['.'] };
    localProfile = {
      id: S8E_LOCAL_WORKBENCH_PROFILE_ID, label: 'S8E local workbench query', scope: S8E_SCOPE,
      runtimeBindingId: S8E_LOCAL_WORKBENCH_BINDING_ID,
      sessionRole: structuredClone(LOCAL_WORKBENCH_ROLE),
      roleBinding: structuredClone(LOCAL_WORKBENCH_ROLE_BINDING),
      runtimeBudget: structuredClone(LOCAL_WORKBENCH_BUDGET), budget: { maxTokens: null, deadline: null },
      consumerId: AG2B_CONSUMER_ID,
    };
    extraBindings.push({
      binding: {
        id: S8E_LOCAL_WORKBENCH_BINDING_ID, label: 'S8E local workbench binding', scope: S8E_SCOPE,
        role: structuredClone(LOCAL_WORKBENCH_ROLE), configurationRevision: 's8e-h-local-workbench@1',
        model: { revision: 's8e-h-local-workbench-model@1', provider: 'deepseek',
          model: 's8e-h-local-workbench-scripted' },
        grant: localWorkbenchGrant(workspace, { id: 's8e-h-local-workbench', label: 'S8E local workbench model',
          provider: 'deepseek', model: 'deepseek-flash' }),
      },
      workflow: { workspace: S8E_SCOPE, sessionRole: structuredClone(LOCAL_WORKBENCH_ROLE),
        roleBinding: structuredClone(LOCAL_WORKBENCH_ROLE_BINDING), budget: { tokenBudget: 1_000_000, deadline: null } },
      queryProfile: localProfile,
    });
  }
  let hostWorld: S6AHostWorld;
  try {
    // `scribe: true` gives the Runtime and Workflow the platform scribe binding;
    // `defaultGoals: false` leaves the project/workspace seed only (the 8E Goal
    // is created below through its own route).
    hostWorld = await openS6AHostWorld({ backend, scribe: true, defaultGoals: false,
      ...(options.secretaryTools === undefined ? {} : { secretaryTools: options.secretaryTools }),
      ...(extraBindings.length === 0 ? {} : { extraBindings }),
      ...(options.hostOptions === undefined ? {} : { extraHostOptions: options.hostOptions }) });
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

    // 4. E2-14a/E2-14b: a second Goal, its one Plan task assigned to the
    // `local-workbench` template and the line responsible for it, all public.
    // The fixture Goal/Plan/scribe line above are already built and untouched.
    let localWorkbench: S8ELocalWorkbench | null = null;
    if (options.localWorkbench === true) {
      if (localProfile === null) throw new Error('S8E: the local workbench profile was not built');
      const localRole = LOCAL_WORKBENCH_ROLE;
      if (localRole.kind !== 'legacy_template') throw new Error('S8E: the local workbench role is not a template');
      const localGoalRef: GoalRef = { aggregateType: 'Goal', projectId: scope.projectId, goalId: S8E_LOCAL_GOAL_ID };
      await ws.createGoal(localGoalRef.goalId, 'S8E local workbench goal');
      const localPlan = await adoptS6BPlan(ws, localGoalRef, { label: 's8e-h-local',
        taskIds: [S8E_LOCAL_TASK_ID], role: localRole.templateId });
      const localTask = localPlan.tasks[0];
      if (localTask === undefined) throw new Error('S8E: the local workbench Plan has no task');
      const localLine = await createS6BLine(ws, { label: 's8e-h-local-line', role: localRole,
        tasks: localPlan.tasks });
      const localSession = await sessionOf(hostWorld, localLine);
      localWorkbench = { bindingId: S8E_LOCAL_WORKBENCH_BINDING_ID, goalRef: localGoalRef, task: localTask,
        line: localLine, session: localSession, profile: localProfile };
    }

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
      scribeLine: line,
      localWorkbench,
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

// ---------------------------------------------------------------------------
// 8E2 H: one Run that calls `check_links`, and one scribe Run held at its model request
// ---------------------------------------------------------------------------

/** The check Run's second model request (the one carrying the tool result), the result and its request slice. */
export type S8ECheckLinksRun = { readonly request: ModelRequest; readonly toolResult: ToolResult;
  readonly requests: readonly ModelRequest[] };

/**
 * E2-14a/E2-14b: one real Work Run of `input.line` that calls `check_links`
 * with `input.args` and then answers. The returned `toolResult` is exactly what
 * the Kernel delivered to the model, error results included; only a missing
 * tool message throws.
 */
export async function runS8ECheckLinks(world: S8ESemanticWorld, input: {
  goalRef: GoalRef; task: TaskTriple; line: S6BLine; label: string; args: Record<string, unknown>;
}): Promise<S8ECheckLinksRun> {
  const callId = `s8e-check-links-${input.label}`;
  const before = world.model.calls();
  world.scriptReplies([
    { kind: 'calls', calls: [{ callId, name: 'check_links', args: input.args }] },
    { kind: 'text', text: `S8E checked links ${input.label}` },
  ]);
  await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: input.goalRef, flowId: `s8e-${input.label}`,
    sessionHint: input.line.ref, kind: 'select_work', taskId: input.task.taskId });
  const requests = world.model.requests.slice(before);
  const request = requests[1];
  if (request === undefined) {
    throw new Error(`S8E: the check_links Run ${input.label} made no second model request`);
  }
  const delivered = request.messages.find(message => message.role === 'tool' && message.callId === callId);
  if (delivered === undefined || delivered.role !== 'tool') {
    throw new Error(`S8E: the check_links result for ${input.label} was not delivered to the model`);
  }
  return { request, toolResult: delivered.result, requests };
}

/** The held scribe Run: its task, the line's handle and the release that lets the Run finish. */
export type S8EHeldScribeRun = { readonly task: TaskTriple; readonly session: S6ASession;
  release(): Promise<void> };

/**
 * E2-19c: claim and start the next scribe task and hold its first model
 * request (the `holdPLTaskRequest` shape). `release()` lets that request answer
 * and awaits the Run; the caller must release.
 */
export async function holdS8EScribeRun(world: S8ESemanticWorld, label: string): Promise<S8EHeldScribeRun> {
  const task = world.nextScribeTask();
  const session = await sessionOf(world, world.scribeLine);
  world.scriptReplies([{ kind: 'text', text: `S8E held scribe ${label}` }]);
  const gate = await world.gates.modelRequest(session);
  const driving = driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: S8E_GOAL_REF,
    flowId: `s8e-${label}`, sessionHint: world.scribeLine.ref, kind: 'select_work', taskId: task.taskId });
  await gate.reached;
  return { task, session, release: async () => { gate.release(); await driving; } };
}

// ---------------------------------------------------------------------------
// Shared public steps of the H rows (E3 read, compose line, person write)
// ---------------------------------------------------------------------------

/** E3: the project page of `architecture/semantic-links`; `ready` or the row stops. */
export async function s8eLinkPage(world: S8ESemanticWorld): Promise<readonly SemanticLinkV1[]> {
  const answer = await world.route('architecture/semantic-links',
    { scope: { kind: 'project' }, cursor: null, limit: 100 });
  const read = answer as ReadResult<SemanticPageV1<SemanticLinkV1>>;
  if (read.status !== 'ready') throw new Error(`the semantic read was not ready: ${JSON.stringify(answer)}`);
  return read.value.items;
}

/** E3: the read-time verification of exactly one note version. */
export async function s8eLinkVerification(world: S8ESemanticWorld, noteId: string,
  version: number): Promise<LinkVerificationV1> {
  const item = (await s8eLinkPage(world)).find(candidate => candidate.noteId === noteId
    && candidate.version === version);
  if (item === undefined) throw new Error(`the semantic read has no ${noteId}@${String(version)}`);
  return item.verification;
}

/** `compose.ts` line 10 becomes `begin`, the edit that makes K1's stored verdict refs-pending. */
export async function s8eChangeComposeLine10(world: S8ESemanticWorld): Promise<void> {
  const target = join(world.root, 'src/compose.ts');
  const lines = (await readFile(target, 'utf8')).split('\n');
  lines[9] = 'export const begin = (id: string) => runModel(access, id);';
  await writeFile(target, lines.join('\n'), 'utf8');
}

/** One person write of a link draft through the real `notes/write` route; accepted or it throws. */
export async function s8eWriteLink(world: S8ESemanticWorld,
  spec: S8ELinkSpec): Promise<{ noteId: string; version: number }> {
  const write = await world.writePerson(s8eLinkDraft(spec));
  if (write.status !== 'accepted') {
    throw new Error(`the ${spec.name} write was not accepted: ${JSON.stringify(write)}`);
  }
  return { noteId: write.noteId, version: write.version };
}
