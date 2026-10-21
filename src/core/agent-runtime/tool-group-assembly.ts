/**
 * Tool-group assembly shared by the Work and Query model loops.
 *
 * A tool group is the narrow `{ names, create }` seam the Kernel callbacks and
 * the model loop consume: the enabled/authorized name lists must be fixed before
 * a workspace exists, while the definitions are created per workspace. The
 * modules that own each path keep their own eligibility and failure rules; only
 * the assembly code below is shared.
 */
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { GoalRef } from '../../contracts/ledger.js';
import type {
  ToolCall, ToolDefinition, WorkspaceSandbox,
} from '../../../vendor/coding-agent/dist/public-api.js';
import {
  createSessionMailboxTools, SESSION_MAILBOX_TOOL_NAMES, USER_DECISION_TOOL_NAMES,
} from './communication-tools.js';
import { createWhiteboardTools, WHITEBOARD_TOOL_NAMES } from './whiteboard-tools.js';
import { createSessionDiscoveryTools, SESSION_DISCOVERY_TOOL_NAMES } from './session-discovery-tools.js';
import { createGraphTools, GRAPH_TOOL_NAMES } from './graph-tools.js';
import { createNoteTools, NOTE_TOOL_NAMES } from './note-tool.js';
import { createUnknownCallReviewTools } from './unknown-call-review-tools.js';
import { createCommandRerunTools } from './command-rerun-tools.js';
import { READONLY_COMMAND_TOOL_NAME } from './readonly-command-tool.js';
import { kernelToolNameOf } from '../work-graph/state/unknown-call-kinds.js';
import type { SessionMailboxPort, SessionMessage } from '../work-graph/model/communication-contracts.js';
import type { SessionDirectoryPort } from '../work-graph/model/session-contracts.js';
import type { GraphContextReadPort } from '../work-graph/model/graph-context-contracts.js';
import type { TaskContextInputPort } from '../work-graph/model/context-input-contracts.js';
import type {
  ExecutionHistoryPage, GraphExecutionHistoryReadPort, TaskExecutionHistoryRequest,
} from './execution-history-contracts.js';
import type { PlanTaskPort } from '../work-graph/model/plan-contracts.js';
import type { RuntimeExecutionDependencies } from './execution-contracts.js';
import type { ObservedModelRunOptions } from './observed-model-run.js';

export type ToolGroup = { names: readonly string[]; create: (workspace: WorkspaceSandbox) => ToolDefinition[] };
export type ToolGroupResult<T = ToolGroup> = { ok: true; value: T } | { ok: false; rejection: CoreRejection };

/**
 * Every possible exploration tool name (K3 L3 row 1, spec §1 note). The
 * conditional subsets below are picked from this list; exporting it lets the
 * K3 table check stay in sync with the real registration behavior.
 */
export const EXPLORATION_TOOL_NAMES = [
  'list_files', 'search', 'symbols', 'code_index', 'project_source',
  'python_index', 'cpp_index', 'source_excerpt', 'read_source', 'read_material',
] as const;

/** The frozen C1 + W2 platform coordination tool names. Declaring a name here
 * grants nothing: the real selection set is the manifest/Role/Host intersection
 * re-checked above. */
const PLATFORM_COORDINATION_TOOL_NAMES = new Set<string>([
  ...SESSION_MAILBOX_TOOL_NAMES, ...USER_DECISION_TOOL_NAMES, ...WHITEBOARD_TOOL_NAMES, ...SESSION_DISCOVERY_TOOL_NAMES,
  ...GRAPH_TOOL_NAMES, ...NOTE_TOOL_NAMES,
]);
/** K3 group 3: the L13 exploration names a review-round manifest may select.
 * The set is deliberately NOT all of `RESERVED_TOOL_NAMES`: a mutation name
 * such as `edit` stays unknown and is refused `unsupported` (KB-09). */
const EXPLORATION_TOOL_NAME_SET = new Set<string>(EXPLORATION_TOOL_NAMES);

function rejected(code: CoreRejection['code'], reason: string): CoreRejection {
  return { status: 'rejected', code, reason };
}
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Builtin Kernel file/process tools. The platform coordination tools below are
 * extension tools and are never file/read/shell capabilities. */
export const BUILTIN_TOOL_NAMES = new Set<string>(['read', 'write', 'shell']);
/** Names the coordination factories must never collide with. Declaring a name
 * here still grants nothing; this is an assembly guard only. */
export const RESERVED_TOOL_NAMES = new Set<string>([
  ...BUILTIN_TOOL_NAMES, 'edit', 'check', 'list_files', 'search', 'symbols', 'code_index',
  'project_source', 'python_index', 'cpp_index', 'source_excerpt', 'read_source', 'read_material',
]);

export type GraphHistoryProxyInput = {
  graph: GraphContextReadPort;
  history: GraphExecutionHistoryReadPort;
  goalRef: GoalRef;
  hostContext: CoreCallContext;
};

/**
 * The narrow history proxy the graph tools receive as their `history`
 * dependency. It is NOT the Host-only RT8: every call first re-validates the
 * requested Run card through the ORIGINAL tool context (its own principal and
 * signal) against the tool config's trusted Goal, then delegates to RT8 with
 * the driver's own same-scope trusted Host context and THIS tool call's signal.
 * The Host context is never handed to the model, and RT8's own
 * `source_stale`/cursor rejections pass through unchanged.
 *
 * Work passes the original `startRun` Host context and the Work Run's canonical
 * Goal; Query passes the `queryExecution.readPreparationFacts` original
 * initiator for both `principal` and `materialReader` (the caller builds that
 * context) and the QueryJob's canonical Goal.
 */
export function createGraphHistoryProxy(input: GraphHistoryProxyInput): GraphExecutionHistoryReadPort {
  return {
    async readTaskExecutionHistory(toolCtx, request: TaskExecutionHistoryRequest): Promise<ReadResult<ExecutionHistoryPage>> {
      // The Run card is validated under the ORIGINAL tool identity (its own
      // principal and its own signal) against the tool config's trusted Goal:
      // the tool can never widen its own scope to another Goal. The trusted Host
      // context is used only for the RT8 read below.
      let looked;
      try {
        looked = await input.graph.lookGraph(toolCtx, {
          goalRef: input.goalRef,
          target: { kind: 'node', node: { kind: 'run', ref: request.runRef } },
          relation: 'card',
          page: { afterCursor: null, limit: 1 },
        });
      } catch (error) {
        return rejected('unavailable', `the Run card could not be read before the history read: ${messageOf(error)}`);
      }
      // A canonical scope/identity rejection from the card read (including a Run
      // of another Goal) is returned as is; no history owner is reached.
      if (looked.status !== 'ready') return looked;
      const card = looked.value.items[0];
      if (card === undefined) return rejected('not_found', 'the graph did not return the requested Run card');
      if (request.runRef.projectId !== input.goalRef.projectId || request.runRef.goalId !== input.goalRef.goalId) {
        return rejected('forbidden', 'the requested Run is not in the bound Goal');
      }
      const node = card.node;
      if (node.kind !== 'run' || node.ref.projectId !== request.runRef.projectId
        || node.ref.goalId !== request.runRef.goalId || node.ref.runId !== request.runRef.runId) {
        return rejected('unavailable', 'the graph returned a different node than the requested Run');
      }
      if (card.run === null || card.run.ref.runId !== request.runRef.runId
        || card.run.workspaceSnapshot.workspaceId !== input.hostContext.workspaceId) {
        return rejected('forbidden', 'the Run belongs to another workspace');
      }
      const trusted: CoreCallContext = { ...input.hostContext, signal: toolCtx.signal };
      const result = await input.history.readTaskExecutionHistory(trusted, request);
      // Keep RT8's own code and result shape, but make the result name the Run it
      // was reading: a history page or rejection is always locatable to one Run.
      if (result.status === 'rejected') {
        return { ...result, reason: `${result.reason} (Run ${request.runRef.runId})` };
      }
      return result;
    },
  };
}

/**
 * The exact parameter set the Work selection filters, field for field. It is
 * deliberately NOT a generic "big deps" object, so each dependency keeps its own
 * optionality.
 */
export type WorkToolGroupInput = {
  selected: readonly string[];
  mailbox: SessionMailboxPort | undefined;
  /** Slice 5 §4.6 user-decision owner; absent makes the three tools unregisterable. */
  decisionMessages?: RuntimeExecutionDependencies['decisionMessages'];
  /** Slice 5 §4.5/T-R2-1 plan-application receipt reader; absent keeps the old tool result shape. */
  applicationReceipt?: RuntimeExecutionDependencies['applicationReceipt'];
  sessions: SessionDirectoryPort;
  plans: PlanTaskPort;
  context: CoreCallContext;
  sessionRef: SessionRef;
  goalRef: GoalRef;
  requestIdForCall: (call: Readonly<ToolCall>) => string;
  /** Real registration seam for an explicit waitAfterSend; the Runtime owns the
   * per-Run wait and the Kernel barrier commits the yielded terminal. */
  onWaitRegistered?: (message: SessionMessage) => void;
  /** Slice 3 read-only graph tools and the trusted Host context their narrow
   * history proxy delegates with. Absent, a selection of look/find fails closed. */
  graph?: {
    graphContext: GraphContextReadPort;
    taskInputs: TaskContextInputPort;
    graphHistory: GraphExecutionHistoryReadPort;
    hostContext: CoreCallContext;
  };
  /** Slice 4C L13/L14: `platform.notes`' reads, write and check ports. A
   * selection of look/find memory or `record_note` without the needed port
   * fails closed before the model. */
  notes?: RuntimeExecutionDependencies['notes'];
  /** Names this Runtime handles outside the coordination factories (the
   * read-only process tool). They are recognized but never built here. */
  extensionNames?: ReadonlySet<string>;
};

/**
 * Filter the already-reviewed coordination factories down to the effective manifest
 * intersection. An unknown selected name or a selected platform tool whose
 * dependency is unbound fails closed here, before any provider, authorize/begin
 * write or new-entry Host call. The returned `names` and the actual definitions
 * are kept one-to-one; a factory product mismatch throws so the Kernel run
 * aborts before the first provider call.
 */
export function selectWorkToolGroup(input: WorkToolGroupInput): ToolGroupResult<ToolGroup | null> {
  const unknown = input.selected.filter(name => !BUILTIN_TOOL_NAMES.has(name)
    && !EXPLORATION_TOOL_NAME_SET.has(name) && !PLATFORM_COORDINATION_TOOL_NAMES.has(name)
    && !(input.extensionNames?.has(name) ?? false));
  if (unknown.length > 0) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects tool names this Runtime does not know: ${[...new Set(unknown)].join(', ')}`) };
  }
  const wanted = new Set(input.selected);
  const mailboxNames = SESSION_MAILBOX_TOOL_NAMES.filter(name => wanted.has(name));
  const decisionNames = USER_DECISION_TOOL_NAMES.filter(name => wanted.has(name));
  const whiteboardNames = WHITEBOARD_TOOL_NAMES.filter(name => wanted.has(name));
  const discoveryNames = SESSION_DISCOVERY_TOOL_NAMES.filter(name => wanted.has(name));
  const graphNames = GRAPH_TOOL_NAMES.filter(name => wanted.has(name));
  const noteNames = NOTE_TOOL_NAMES.filter(name => wanted.has(name));
  if (mailboxNames.length === 0 && decisionNames.length === 0 && whiteboardNames.length === 0 && discoveryNames.length === 0
    && graphNames.length === 0 && noteNames.length === 0) {
    return { ok: true, value: null };
  }
  if ((mailboxNames.length > 0 || decisionNames.length > 0) && input.mailbox === undefined) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects communication tools but no SessionMailbox dependency is bound: ${[...mailboxNames, ...decisionNames].join(', ')}`) };
  }
  if (decisionNames.length > 0 && input.decisionMessages === undefined) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects user decision tools but no decisionMessages dependency is bound: ${decisionNames.join(', ')}`) };
  }
  if (graphNames.length > 0 && input.graph === undefined) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects graph read tools but no graph read dependency is bound: ${graphNames.join(', ')}`) };
  }
  if (noteNames.length > 0 && (input.notes?.write === undefined || input.notes.check === undefined)) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects note tools but no note write/check dependency is bound: ${noteNames.join(', ')}`) };
  }
  const handles: Array<{ names: readonly string[]; create: (workspace: WorkspaceSandbox) => ToolDefinition[] }> = [];
  if (mailboxNames.length > 0 || decisionNames.length > 0) {
    handles.push(createSessionMailboxTools({
      mailbox: input.mailbox as SessionMailboxPort,
      ...(input.decisionMessages === undefined ? {} : { decisionMessages: input.decisionMessages }),
      context: input.context,
      sessionRef: input.sessionRef,
      requestIdForCall: input.requestIdForCall,
      ...(input.onWaitRegistered === undefined ? {} : { onWaitRegistered: input.onWaitRegistered }),
    }));
  }
  if (whiteboardNames.length > 0) {
    handles.push(createWhiteboardTools({
      plans: input.plans,
      context: input.context,
      goalRef: input.goalRef,
      requestIdForCall: input.requestIdForCall,
      ...(input.applicationReceipt === undefined ? {} : { applicationReceipt: input.applicationReceipt }),
    }));
  }
  if (discoveryNames.length > 0) {
    handles.push(createSessionDiscoveryTools({ sessions: input.sessions, context: input.context }));
  }
  if (graphNames.length > 0) {
    const graphDeps = input.graph as NonNullable<typeof input.graph>;
    handles.push(createGraphTools({
      context: input.context,
      goalRef: input.goalRef,
      graph: graphDeps.graphContext,
      inputs: graphDeps.taskInputs,
      history: createGraphHistoryProxy({
        graph: graphDeps.graphContext,
        history: graphDeps.graphHistory,
        goalRef: input.goalRef,
        hostContext: graphDeps.hostContext,
      }),
      ...(input.notes?.memory === undefined ? {} : { notes: input.notes.memory }),
    }));
  }
  if (noteNames.length > 0) {
    const noteDeps = input.notes;
    if (noteDeps?.write === undefined || noteDeps.check === undefined) {
      return { ok: false, rejection: rejected('unsupported', `the Run selects note tools but no note write/check dependency is bound: ${noteNames.join(', ')}`) };
    }
    handles.push(createNoteTools({
      context: input.context,
      notes: noteDeps.write,
      check: noteDeps.check,
      requestIdForCall: input.requestIdForCall,
    }));
  }
  const names = [...mailboxNames, ...decisionNames, ...whiteboardNames, ...discoveryNames, ...graphNames, ...noteNames];
  if (new Set(names).size !== names.length) {
    return { ok: false, rejection: rejected('unsupported', 'the selected coordination tool names are duplicated') };
  }
  if (names.some(name => RESERVED_TOOL_NAMES.has(name))) {
    return { ok: false, rejection: rejected('unsupported', 'a coordination tool name collides with a builtin, exploration or material tool') };
  }
  return {
    ok: true,
    value: {
      names,
      create: (workspace: WorkspaceSandbox): ToolDefinition[] => {
        const definitions = handles.flatMap(handle => handle.create(workspace)).filter(definition => wanted.has(definition.name));
        const produced = definitions.map(definition => definition.name);
        if (produced.length !== names.length || new Set(produced).size !== produced.length
          || names.some(name => !produced.includes(name))) {
          throw new Error('the coordination tool factory did not produce exactly the selected definitions');
        }
        return definitions;
      },
    },
  };
}

/**
 * The Query grant's two read-only graph tools. The caller keeps the grant
 * projection, the dependency check and the identity construction; this factory
 * only builds the handle and filters its definitions by the passed names. It
 * has NO completeness or duplication check (the Work product check is not
 * shared with Query).
 */
export function createQueryGraphToolGroup(input: {
  names: readonly string[];
  context: CoreCallContext;
  goalRef: GoalRef;
  graph: GraphContextReadPort;
  inputs: TaskContextInputPort;
  history: GraphExecutionHistoryReadPort;
  hostContext: CoreCallContext;
}): ToolGroup {
  const names = input.names;
  // The original query_run tool context (spec §4.1: tool inputs never
  // obtain the Host context/reader). The narrow history proxy separately
  // uses the ORIGINAL initiator's same-scope Host context for RT8 only.
  const handle = createGraphTools({
    context: input.context,
    goalRef: input.goalRef,
    graph: input.graph,
    inputs: input.inputs,
    history: createGraphHistoryProxy({
      graph: input.graph,
      history: input.history,
      goalRef: input.goalRef,
      hostContext: input.hostContext,
    }),
  });
  return {
    names,
    create: (workspace: WorkspaceSandbox): ToolDefinition[] =>
      handle.create(workspace).filter(definition => names.includes(definition.name as (typeof GRAPH_TOOL_NAMES)[number])),
  };
}

/** K3 L14/L20: the review-purpose round's one write tool, adapted to a one-name
 * group. A factory with no name is the same `unsupported` rejection; the
 * definition is produced by the factory at create time. */
export function createReviewToolGroup(
  input: Parameters<typeof createUnknownCallReviewTools>[0],
): ToolGroupResult {
  const reviewTools = createUnknownCallReviewTools(input);
  const chosenName = reviewTools.names[0];
  if (chosenName === undefined) return { ok: false, rejection: rejected('unsupported', 'the review tool factory produced no name') };
  return {
    ok: true,
    value: {
      names: [chosenName],
      create: (workspaceHandle: WorkspaceSandbox): ToolDefinition[] => {
        const definition = reviewTools.create(workspaceHandle)[0];
        if (definition === undefined) throw new Error('the review tool factory produced no definition');
        return [definition];
      },
    },
  };
}

/** L19a: the blocked Work Run's `request_command_rerun` tool, adapted to a
 * one-name group. A factory with no name is the same `unsupported` rejection;
 * the definition is produced by the factory at create time. */
export function createRerunToolGroup(
  input: Parameters<typeof createCommandRerunTools>[0],
): ToolGroupResult {
  const requestTools = createCommandRerunTools(input);
  const chosenName = requestTools.names[0];
  if (chosenName === undefined) return { ok: false, rejection: rejected('unsupported', 'the rerun request tool factory produced no name') };
  return {
    ok: true,
    value: {
      names: [chosenName],
      create: (workspaceHandle: WorkspaceSandbox): ToolDefinition[] => {
        const definition = requestTools.create(workspaceHandle)[0];
        if (definition === undefined) throw new Error('the rerun request tool factory produced no definition');
        return [definition];
      },
    },
  };
}

/**
 * Normalize the model loop's three dedicated extension slots plus the
 * coordination group into one tool group. The tool functions are snapshotted
 * here; the coordination group stays live so its `create` is read from the
 * options when the Kernel callback runs. The name list and the definition order
 * both follow coordination, read-only command, review, rerun.
 */
export function assembleObservedExtensions(input: Pick<ObservedModelRunOptions,
  'coordinationTools' | 'readonlyCommandTool' | 'unknownCallReviewTool' | 'unknownCallReviewToolName' |
  'commandRerunTool' | 'commandRerunToolName'>): ToolGroup {
  // 协调工具只有在宿主**确实**注入了访问面时才装配；注入时它们和内置工具一样出现在
  // 本次请求的工具清单里（模型只能看见被启用的工具名）。
  const coordinationNames = [...(input.coordinationTools?.names ?? [])];
  // The single read-only process tool, if this Run's Host grant selected it.
  const readonlyCommandTool = input.readonlyCommandTool;
  const readonlyCommandNames = readonlyCommandTool === undefined ? [] : [READONLY_COMMAND_TOOL_NAME];
  // K3 L14: the review round's own tool, registered only when the driver built
  // it for a review-purpose Run.
  const unknownCallReviewTool = input.unknownCallReviewTool;
  const unknownCallReviewNames = unknownCallReviewTool === undefined || input.unknownCallReviewToolName === undefined
    ? [] : [input.unknownCallReviewToolName];
  // L19a: the request tool has the same conditional registration shape.
  const commandRerunTool = input.commandRerunTool;
  const commandRerunNames = commandRerunTool === undefined || input.commandRerunToolName === undefined
    ? [] : [input.commandRerunToolName];
  return {
    names: [...coordinationNames, ...readonlyCommandNames, ...unknownCallReviewNames, ...commandRerunNames],
    create: (workspace: WorkspaceSandbox): ToolDefinition[] => {
      const tools: ToolDefinition[] = [...(input.coordinationTools?.create(workspace) ?? [])];
      if (readonlyCommandTool !== undefined) tools.push(readonlyCommandTool(workspace));
      if (unknownCallReviewTool !== undefined) tools.push(unknownCallReviewTool(workspace));
      if (commandRerunTool !== undefined) tools.push(commandRerunTool(workspace));
      return tools;
    },
  };
}

/**
 * The final Kernel `enabledNames`: with both a read permission and the pinned
 * review source, the fixed source reads (plus `read_material` only with material
 * tools) precede exploration and extensions; otherwise the mapped builtin
 * allowlist precedes exploration and extensions. Extensions are already in
 * coordination, read-only, review, rerun order. Never sort: the exploration
 * list follows its declared order.
 */
export function kernelEnabledToolNames(input: {
  allowed: readonly string[];
  hasRead: boolean;
  reviewSource: boolean;
  hasFrozenSource: boolean;
  hasMaterialTools: boolean;
  extensionNames: readonly string[];
}): string[] {
  // K3 L3: pick the conditional exploration subset from the exported list.
  const sourceReadNames: readonly string[] = ['read_source', 'read_material'];
  const readTools: string[] = input.hasRead
    ? EXPLORATION_TOOL_NAMES.filter(name => !sourceReadNames.includes(name)
      && (name !== 'project_source' || input.hasFrozenSource))
    : [];
  return input.hasRead && input.reviewSource
    ? ['read_source', ...(input.hasMaterialTools ? ['read_material'] : []), ...readTools, ...input.extensionNames]
    : [...input.allowed.map(kernelToolNameOf), ...readTools, ...input.extensionNames];
}
