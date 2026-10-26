/**
 * Tool-group assembly shared by the Work and Query model loops.
 *
 * A tool group is the narrow `{ names, create }` seam the Kernel callbacks and
 * the model loop consume: the enabled/authorized name lists must be fixed before
 * a workspace exists, while the definitions are created per workspace. The
 * modules that own each path keep their own eligibility and failure rules; only
 * the assembly code below is shared.
 */
import { messageOf } from '../../contracts/error-message.js';
import type { NoteKind } from '../../contracts/note.js';
import { NOTE_GENERAL_KINDS } from '../../contracts/note.js';
import { rejected } from '../../contracts/core/rejections.js';
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
import {
  createUnknownCallReviewTools, PROPOSE_SAFER_METHOD_TOOL_NAME, RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME,
} from './unknown-call-review-tools.js';
import { createCommandRerunTools, REQUEST_COMMAND_RERUN_TOOL_NAME } from './command-rerun-tools.js';
import { READONLY_COMMAND_TOOL_NAME } from './readonly-command-tool.js';
import { kernelToolNameOf } from '../work-graph/state/unknown-call-kinds.js';
import type { SessionMessageCommandPort, SessionMessage } from '../work-graph/model/communication-contracts.js';
import type { SessionDirectoryPort } from '../work-graph/model/session-contracts.js';
import type { GraphContextReadPort } from '../work-graph/model/graph-context-contracts.js';
import type { NoteMemoryReadPort } from '../work-graph/model/note-contracts.js';
import type { QueryNoteAdmissionV1 } from '../work-graph/model/secretary-note-contracts.js';
import type { TaskContextInputPort } from '../work-graph/model/context-input-contracts.js';
import type {
  ExecutionHistoryPage, GraphExecutionHistoryReadPort, TaskExecutionHistoryRequest,
} from './execution-history-contracts.js';
import type { PlanTaskPort } from '../work-graph/model/plan-contracts.js';
import type { RuntimeExecutionDependencies } from './execution-contracts.js';
import type { ObservedModelRunOptions } from './observed-model-run.js';
import type { ToolTextV1 } from '../../contracts/prompts/prompt-pack.js';

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

/** Builtin Kernel file/process tools. The platform coordination tools below are
 * extension tools and are never file/read/shell capabilities. */
export const BUILTIN_TOOL_NAMES = new Set<string>(['read', 'write', 'shell']);
/** Names the coordination factories must never collide with. Declaring a name
 * here still grants nothing; this is an assembly guard only. */
export const RESERVED_TOOL_NAMES = new Set<string>([
  ...BUILTIN_TOOL_NAMES, 'edit', 'check', 'list_files', 'search', 'symbols', 'code_index',
  'project_source', 'python_index', 'cpp_index', 'source_excerpt', 'read_source', 'read_material',
]);

/**
 * Every tool name this Runtime can register: the builtin file/process tools,
 * the exploration tools, the platform coordination families and the platform
 * extension tools (read-only command, review/proposal and rerun). It is the one
 * definition of "known to this Runtime": preparation drops any other selected
 * name and the start still rejects it, so the registration facts stay with the
 * start where the real owner wiring is known.
 */
export const RUNTIME_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  ...BUILTIN_TOOL_NAMES, ...EXPLORATION_TOOL_NAMES, ...PLATFORM_COORDINATION_TOOL_NAMES,
  READONLY_COMMAND_TOOL_NAME, RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME,
  PROPOSE_SAFER_METHOD_TOOL_NAME, REQUEST_COMMAND_RERUN_TOOL_NAME,
]);

export type GraphHistoryProxyInput = {
  graph: GraphContextReadPort;
  history: GraphExecutionHistoryReadPort;
  /** The trusted current Goal; `null` refuses every Run history read. */
  goalRef: GoalRef | null;
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
  const goalRef = input.goalRef;
  return {
    async readTaskExecutionHistory(toolCtx, request: TaskExecutionHistoryRequest): Promise<ReadResult<ExecutionHistoryPage>> {
      // The Run card is validated in one Goal's universe. With no trusted Goal
      // no Run can be checked, so refuse before either owner is reached.
      if (goalRef === null) return rejected('invalid', 'this request has no goal');
      // The Run card is validated under the ORIGINAL tool identity (its own
      // principal and its own signal) against the tool config's trusted Goal:
      // the tool can never widen its own scope to another Goal. The trusted Host
      // context is used only for the RT8 read below.
      let looked;
      try {
        looked = await input.graph.lookGraph(toolCtx, {
          goalRef,
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
      if (request.runRef.projectId !== goalRef.projectId || request.runRef.goalId !== goalRef.goalId) {
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
  mailbox: SessionMessageCommandPort | undefined;
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
  /** The frozen tool texts every coordination factory reads. */
  texts?: Readonly<Record<string, ToolTextV1>>;
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
    const mailbox = input.mailbox;
    if (mailbox === undefined) {
      return { ok: false, rejection: rejected('unsupported', `the Run selects communication tools but no SessionMailbox dependency is bound: ${[...mailboxNames, ...decisionNames].join(', ')}`) };
    }
    handles.push(createSessionMailboxTools({
      mailbox,
      ...(input.decisionMessages === undefined ? {} : { decisionMessages: input.decisionMessages }),
      context: input.context,
      sessionRef: input.sessionRef,
      requestIdForCall: input.requestIdForCall,
      ...(input.onWaitRegistered === undefined ? {} : { onWaitRegistered: input.onWaitRegistered }),
      ...(input.texts === undefined ? {} : { texts: input.texts }),
    }));
  }
  if (whiteboardNames.length > 0) {
    handles.push(createWhiteboardTools({
      plans: input.plans,
      context: input.context,
      goalRef: input.goalRef,
      requestIdForCall: input.requestIdForCall,
      ...(input.applicationReceipt === undefined ? {} : { applicationReceipt: input.applicationReceipt }),
      ...(input.texts === undefined ? {} : { texts: input.texts }),
    }));
  }
  if (discoveryNames.length > 0) {
    handles.push(createSessionDiscoveryTools({ sessions: input.sessions, context: input.context,
      ...(input.texts === undefined ? {} : { texts: input.texts }) }));
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
      ...(input.texts === undefined ? {} : { texts: input.texts }),
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
      kinds: WORK_NOTE_KINDS,
      withdraw: true,
      ...(input.texts === undefined ? {} : { texts: input.texts }),
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
  /** The trusted current Goal, or `null` for a request with no goal (project reads). */
  goalRef: GoalRef | null;
  graph: GraphContextReadPort;
  inputs: TaskContextInputPort;
  history: GraphExecutionHistoryReadPort;
  hostContext: CoreCallContext;
  /** The notes read port bound only for a secretary round; absent keeps the
   * memory branch's explicit refusal. */
  notes?: NoteMemoryReadPort;
  /** The frozen tool texts the graph factory reads. */
  texts?: Readonly<Record<string, ToolTextV1>>;
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
    ...(input.notes === undefined ? {} : { notes: input.notes }),
    ...(input.texts === undefined ? {} : { texts: input.texts }),
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

/**
 * The Work declaration shows every write kind, so a Work Run keeps the review
 * and repair operations; only a Query's declaration is narrowed.
 */
const WORK_NOTE_KINDS: readonly NoteKind[] = [...NOTE_GENERAL_KINDS, 'understanding', 'repair'];

/**
 * Every fact the final tool list needs, all of them facts the
 * preparation and the start already hold. The list is computed once at
 * preparation and compared exactly at start, never sorted.
 */
export type FinalToolListInputV1 = {
  callKind: 'work' | 'query';
  /**
   * What a Query round may write in this round. The Work branch never reads
   * it; a Query selects a note tool only when the value is `secretary`.
   */
  noteAdmission: QueryNoteAdmissionV1;
  /** `manifest.permissions.tools`, already intersected with Host/Role/Query ceilings. */
  selected: readonly string[];
  readOnly: boolean;
  reviewPhase: 'review' | 'proposal' | null;
  hasBlockedCommands: boolean;
  /** `sourceTools.includeReadSource`: independent of the frozen project source. */
  reviewSource: boolean;
  /** `projectSource.mode === 'frozen'`. */
  frozenSource: boolean;
  materialTools: boolean;
  owners: {
    mailbox: boolean; decisionMessages: boolean; applicationReceipt: boolean;
    sessions: boolean; plans: boolean; graph: boolean; notes: boolean;
    unknownCallReviews: boolean; commandRerunRequests: boolean;
  };
  readonlyCommand: {
    requested: boolean;
    access: 'all_except_denied' | undefined;
    allowsReadWholeWorkspace: boolean;
  };
};

/**
 * The ONE final tool list (ruling 16). Rejections come first — an unknown
 * selected name or a selected family whose owner is missing is `unsupported`,
 * never a silent drop — then the exact `kernelEnabledToolNames` order.
 */
export function finalToolNamesOf(input: FinalToolListInputV1): ToolGroupResult<string[]> {
  const unknown = input.selected.filter(name => !RUNTIME_TOOL_NAMES.has(name));
  if (unknown.length > 0) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects tool names this Runtime does not know: ${[...new Set(unknown)].join(', ')}`) };
  }
  const wanted = new Set(input.selected);
  const owners = input.owners;
  // Query builds graph/read-only tools and secretary-admitted note tools.
  // Every other coordination family a Query's projected permissions may name
  // is neither built nor a rejection: it is outside this call kind's final list.
  const query = input.callKind === 'query';
  // Review and proposal tools follow the Run, not `selected`. A review-purpose
  // Work Run without its owner fails closed before any tool is added.
  const reviewToolName = input.callKind === 'work' && input.reviewPhase !== null
    ? input.reviewPhase === 'proposal' ? PROPOSE_SAFER_METHOD_TOOL_NAME : RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME
    : null;
  if (reviewToolName !== null && !owners.unknownCallReviews) {
    return { ok: false, rejection: rejected('unsupported', 'the review Run requires the unknownCallReviews owner to register its review tool') };
  }
  const mailboxNames = query ? [] : SESSION_MAILBOX_TOOL_NAMES.filter(name => wanted.has(name));
  const decisionNames = query ? [] : USER_DECISION_TOOL_NAMES.filter(name => wanted.has(name));
  const whiteboardNames = query ? [] : WHITEBOARD_TOOL_NAMES.filter(name => wanted.has(name));
  const discoveryNames = query ? [] : SESSION_DISCOVERY_TOOL_NAMES.filter(name => wanted.has(name));
  const graphNames = GRAPH_TOOL_NAMES.filter(name => wanted.has(name));
  const noteNames = NOTE_TOOL_NAMES.filter(name => wanted.has(name) && (input.callKind === 'work' ? true : input.noteAdmission.class === 'secretary'));
  if ((mailboxNames.length > 0 || decisionNames.length > 0) && !owners.mailbox) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects communication tools but no SessionMailbox dependency is bound: ${[...mailboxNames, ...decisionNames].join(', ')}`) };
  }
  if (decisionNames.length > 0 && !owners.decisionMessages) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects user decision tools but no decisionMessages dependency is bound: ${decisionNames.join(', ')}`) };
  }
  if (whiteboardNames.length > 0 && !owners.plans) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects plan tools but no plans dependency is bound: ${whiteboardNames.join(', ')}`) };
  }
  if (discoveryNames.length > 0 && !owners.sessions) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects Session discovery tools but no sessions dependency is bound: ${discoveryNames.join(', ')}`) };
  }
  if (graphNames.length > 0 && !owners.graph) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects graph read tools but no graph read dependency is bound: ${graphNames.join(', ')}`) };
  }
  if (noteNames.length > 0 && !owners.notes) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects note tools but no note write/check dependency is bound: ${noteNames.join(', ')}`) };
  }
  // L19a: the rerun tool is registered only on a blocked ordinary Work Run.
  const rerun = input.callKind === 'work' && input.hasBlockedCommands && input.reviewPhase === null;
  if (rerun && (!owners.commandRerunRequests || !owners.unknownCallReviews)) {
    return { ok: false, rejection: rejected('unsupported', 'the blocked Work Run requires the commandRerunRequests owner and the unknownCallReviews read port to register its request tool') };
  }
  const coordinationNames = [...mailboxNames, ...decisionNames, ...whiteboardNames,
    ...discoveryNames, ...graphNames, ...noteNames];
  if (new Set(coordinationNames).size !== coordinationNames.length) {
    return { ok: false, rejection: rejected('unsupported', 'the selected coordination tool names are duplicated') };
  }
  if (coordinationNames.some(name => RESERVED_TOOL_NAMES.has(name))) {
    return { ok: false, rejection: rejected('unsupported', 'a coordination tool name collides with a builtin, exploration or material tool') };
  }
  const readonlyName = input.readOnly && input.readonlyCommand.requested
    && input.readonlyCommand.access === 'all_except_denied' && input.readonlyCommand.allowsReadWholeWorkspace
    ? READONLY_COMMAND_TOOL_NAME : null;
  const extensionNames = [...coordinationNames,
    ...(readonlyName === null ? [] : [readonlyName]),
    ...(reviewToolName === null ? [] : [reviewToolName]),
    ...(rerun ? [REQUEST_COMMAND_RERUN_TOOL_NAME] : [])];
  // The builtin allowlist is the only part `kernelEnabledToolNames` maps; the
  // coordination/extension names are appended in today's order.
  const allowed = input.selected.filter(name => BUILTIN_TOOL_NAMES.has(name));
  const hasRead = allowed.includes('read');
  return { ok: true, value: kernelEnabledToolNames({
    allowed,
    hasRead,
    reviewSource: input.reviewSource,
    hasFrozenSource: input.frozenSource,
    hasMaterialTools: input.materialTools,
    extensionNames,
  }) };
}
