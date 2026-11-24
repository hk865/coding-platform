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
import { NOTE_KINDS } from '../../contracts/note.js';
import { rejected } from '../../contracts/core/rejections.js';
import type { CoreCallContext } from '../../contracts/core/call-context.js';
import type { CoreRejection, ReadResult } from '../../contracts/core/results.js';
import type { PlatformDutyV1 } from '../../contracts/graph-context.js';
import type { SessionRef } from '../../contracts/core/identity.js';
import type { RunRef } from '../../contracts/dispatch.js';
import type { GoalRef } from '../../contracts/ledger.js';
import type {
  ToolCall, ToolDefinition, WorkspaceSandbox,
} from '../../../vendor/coding-agent/dist/public-api.js';
import {
  ACTION_TOOL_NAMES, ASK_COPY_TOOL_NAME, createAskCopyTool, createPersonMessageTools,
  createSessionMailboxTools, PERSON_MESSAGE_TOOL_NAMES,
  SESSION_MAILBOX_TOOL_NAMES, USER_DECISION_TOOL_NAMES,
} from './communication-tools.js';
import { createMemberTools, CREATE_MEMBER_TOOL_NAME } from './member-tools.js';
import { createHandoffTools, HANDOFF_TOOL_NAMES } from './handoff-tools.js';
import { READ_REQUESTS_TOOL_NAME } from './request-read-tools.js';
import { createWhiteboardTools, WHITEBOARD_TOOL_NAMES } from './whiteboard-tools.js';
import { answerReadToolNamesOf, createGraphTools, GRAPH_TOOL_NAMES } from './graph-tools.js';
import { createLinkCheckTools, LINK_CHECK_TOOL_NAMES } from './link-check-tool.js';
import { createWebLookupTools, WEB_LOOKUP_TOOL_NAMES, type WebLookupPort } from './web-lookup-tools.js';
import { createNoteTools, NOTE_TOOL_NAMES } from './note-tool.js';
import { createArchitectureTools, ARCHITECTURE_TOOL_NAMES } from './architecture-tools.js';
import {
  createUnknownCallReviewTools, PROPOSE_SAFER_METHOD_TOOL_NAME, RECORD_UNKNOWN_CALL_REVIEW_TOOL_NAME,
} from './unknown-call-review-tools.js';
import { createCommandRerunTools, REQUEST_COMMAND_RERUN_TOOL_NAME } from './command-rerun-tools.js';
import { createReworkTools, REWORK_TOOL_NAMES } from './rework-tools.js';
import { createAssignMaintainerTools, ASSIGN_MODULE_MAINTAINER_TOOL_NAME } from './maintainer-tools.js';
import { createRoleSplitTools, PROPOSE_ROLE_SPLIT_TOOL_NAME, type RoleSplitToolOwnerV1 } from './role-split-tool.js';
import { READONLY_COMMAND_TOOL_NAME } from './readonly-command-tool.js';
import { kernelToolNameOf } from '../work-graph/state/unknown-call-kinds.js';
import { agentActorOf } from '../work-graph/model/tool-commit-arguments.js';
import type { SessionMessageCommandPort, SessionMessage } from '../work-graph/model/communication-contracts.js';
import type { GraphContextReadPort } from '../work-graph/model/graph-context-contracts.js';
import type { NoteMemoryReadPort } from '../work-graph/model/note-contracts.js';
import type { QueryNoteAdmissionV1 } from '../work-graph/model/secretary-note-contracts.js';
import type { TaskContextInputPort } from '../work-graph/model/context-input-contracts.js';
import type {
  ExecutionHistoryPage, GraphExecutionHistoryReadPort, TaskExecutionHistoryRequest,
} from './execution-history-contracts.js';
import type { PlanTaskPort } from '../work-graph/model/plan-contracts.js';
import type { TaskClaimPort } from '../work-graph/model/claim-contracts.js';
import type { EvidencePort } from '../work-graph/model/evidence-contracts.js';
import type { RuntimeExecutionDependencies } from './execution-contracts.js';
import type { ObservedModelRunOptions } from './observed-model-run.js';
import type { ToolTextV1 } from '../../contracts/prompts/prompt-pack.js';
import { answerToolNamesOf, type AnswerToolKind } from './answer-tools.js';

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
  ...SESSION_MAILBOX_TOOL_NAMES, ...USER_DECISION_TOOL_NAMES, ...ACTION_TOOL_NAMES,
  ...PERSON_MESSAGE_TOOL_NAMES, ASK_COPY_TOOL_NAME,
  ...WHITEBOARD_TOOL_NAMES,
  ...GRAPH_TOOL_NAMES, ...LINK_CHECK_TOOL_NAMES, ...WEB_LOOKUP_TOOL_NAMES, ...NOTE_TOOL_NAMES, ...HANDOFF_TOOL_NAMES,
  ...ARCHITECTURE_TOOL_NAMES,
  PROPOSE_ROLE_SPLIT_TOOL_NAME,
]);
/** K3 group 3: the L13 exploration names a review-round manifest may select.
 * The set is deliberately NOT all of `RESERVED_TOOL_NAMES`: a mutation name
 * such as `edit` stays unknown and is refused `unsupported` (KB-09). */
const EXPLORATION_TOOL_NAME_SET = new Set<string>(EXPLORATION_TOOL_NAMES);
/** L19's two rework adapters. They are built by one factory whose config needs
 * both owners; a selected name without them stays `unsupported`, never dropped. */
const REWORK_TOOL_NAME_SET = new Set<string>(REWORK_TOOL_NAMES);

/** The three mailbox reads; the request/planning rounds get them, a formal review does not. */
const QUERY_BOX_TOOL_NAMES: readonly string[] =
  ['read_session_inbox', 'read_session_message', 'read_session_message_body'];
const QUERY_SEND_TOOL_NAME = 'send_session_message';
const QUERY_RESPOND_TOOL_NAME = 'respond_session_message';
const QUERY_WITHDRAW_TOOL_NAME = 'withdraw_session_message';
const QUERY_DECISION_READ_TOOL_NAME = 'read_user_decision';
const QUERY_ASK_PERSON_TOOL_NAME = 'ask_person';
const QUERY_NOTIFY_PERSON_TOOL_NAME = 'notify_person';

/**
 * The §2.6 round the existing frozen facts name. It is a pure projection:
 * `duty` is the Session duty preparation/start already resolved,
 * `noteAdmission.class` separates the secretary request round from a planning
 * round, and `answerTools` is the frozen answer shape. No new stored field.
 */
export type QueryRoundKindV1 =
  | 'copy' | 'exploration' | 'request'
  | 'secretary_planning' | 'secretary_text'
  | 'adviser_planning' | 'adviser_text' | 'adviser_advice'
  | 'scribe_review' | 'scribe_text'
  | 'executor_planning' | 'executor_text'
  | 'reviewer_review' | 'reviewer_text'
  | 'check_review' | 'unknown';

export function queryRoundKindOf(input: {
  duty: PlatformDutyV1 | 'unknown' | null;
  noteClass: QueryNoteAdmissionV1['class'];
  answerTools: AnswerToolKind | null;
  explorationRound?: boolean;
  readOnlyCopy?: boolean;
}): QueryRoundKindV1 {
  if (input.readOnlyCopy === true) return 'copy';
  if (input.explorationRound === true) return 'exploration';
  const shape: string | null = input.answerTools;
  if (shape === 'check_review') return 'check_review';
  if (shape === 'plan_review' || shape === 'exec_review') return 'reviewer_review';
  if (shape === 'unknown_call_advice' || shape === 'command_rerun_advice') return 'adviser_advice';
  if (shape === 'scribe_review') return 'scribe_review';
  if (input.duty === 'secretary') {
    if (input.noteClass === 'secretary') return 'request';
    return shape === 'plan_round' ? 'secretary_planning' : 'secretary_text';
  }
  if (input.duty === 'adviser') {
    if (shape === 'plan_round') return 'adviser_planning';
    return 'adviser_text';
  }
  if (input.duty === 'scribe') return 'scribe_text';
  if (input.duty === 'executor') return shape === 'plan_round' ? 'executor_planning' : 'executor_text';
  if (input.duty === 'reviewer') return 'reviewer_text';
  return 'unknown';
}

/** The coordination-family names a §2.6 round may select; every other family is dropped by the ceiling and final list. */
export function queryRoundCoordinationNames(kind: QueryRoundKindV1): ReadonlySet<string> {
  const base = new Set<string>();
  const addRoundNames = (...names: readonly string[]): void => { for (const name of names) base.add(name); };
  const box = (): void => addRoundNames(...QUERY_BOX_TOOL_NAMES);
  const addSendName = (): void => addRoundNames(QUERY_SEND_TOOL_NAME);
  const respond = (): void => addRoundNames(QUERY_RESPOND_TOOL_NAME);
  const addWithdrawName = (): void => addRoundNames(QUERY_WITHDRAW_TOOL_NAME);
  const askCopy = (): void => addRoundNames(ASK_COPY_TOOL_NAME);
  const addNotifyName = (): void => addRoundNames(QUERY_NOTIFY_PERSON_TOOL_NAME);
  const askPerson = (): void => addRoundNames(QUERY_ASK_PERSON_TOOL_NAME);
  const decisionRead = (): void => addRoundNames(QUERY_DECISION_READ_TOOL_NAME);
  const actions = (): void => addRoundNames(...ACTION_TOOL_NAMES);
  const notes = (): void => addRoundNames(...NOTE_TOOL_NAMES);
  switch (kind) {
    case 'request':
      box(); addSendName(); respond(); addWithdrawName(); askCopy(); addNotifyName(); askPerson(); decisionRead(); actions(); notes();
      addRoundNames(CREATE_MEMBER_TOOL_NAME, READ_REQUESTS_TOOL_NAME);
      break;
    case 'secretary_planning':
    case 'secretary_text':
      box(); addSendName(); respond(); addWithdrawName(); askCopy(); addNotifyName(); askPerson(); decisionRead(); actions(); notes();
      break;
    case 'adviser_planning':
      box(); addSendName(); respond(); addWithdrawName(); askCopy(); addNotifyName(); askPerson(); decisionRead(); actions(); notes();
      addRoundNames(CREATE_MEMBER_TOOL_NAME);
      addRoundNames(...REWORK_TOOL_NAMES);
      break;
    case 'adviser_text':
      box(); addSendName(); respond(); addWithdrawName(); askCopy(); addNotifyName(); askPerson(); decisionRead(); actions(); notes();
      addRoundNames(CREATE_MEMBER_TOOL_NAME);
      break;
    case 'adviser_advice':
      box(); addSendName(); respond(); addWithdrawName(); askCopy(); addNotifyName(); decisionRead();
      break;
    case 'scribe_review':
      box(); addSendName(); respond(); addWithdrawName(); askCopy(); addNotifyName(); decisionRead(); notes();
      break;
    case 'scribe_text':
      box(); addSendName(); respond(); addWithdrawName(); askCopy(); addNotifyName(); askPerson(); decisionRead(); notes();
      break;
    case 'executor_planning':
    case 'executor_text':
      box(); addSendName(); respond(); addWithdrawName(); askCopy(); addNotifyName(); decisionRead(); notes();
      break;
    case 'reviewer_review':
    case 'check_review':
      addSendName(); addWithdrawName(); addNotifyName();
      break;
    case 'reviewer_text':
      box(); addSendName(); addWithdrawName(); addNotifyName();
      break;
    case 'exploration':
      box(); addSendName(); respond(); addWithdrawName(); askCopy(); notes(); addRoundNames(READ_REQUESTS_TOOL_NAME);
      break;
    case 'copy':
    case 'unknown':
      break;
  }
  return base;
}

/**
 * §2.6: keep the names `wanted` selects and the round's ceiling allows. A `null`
 * ceiling is the Work path, which keeps every wanted name.
 */
export function roundWanted(
  names: readonly string[],
  wanted: ReadonlySet<string>,
  allowed: ReadonlySet<string> | null,
): string[] {
  return names.filter(name => wanted.has(name) && (allowed === null || allowed.has(name)));
}

/** Every name the round selector may drop from a Query's Host grant; no other family is touched. */
export const QUERY_ROUND_COORDINATION_NAMES: ReadonlySet<string> = new Set<string>([
  ...SESSION_MAILBOX_TOOL_NAMES, ...PERSON_MESSAGE_TOOL_NAMES, ASK_COPY_TOOL_NAME,
  ...USER_DECISION_TOOL_NAMES, ...ACTION_TOOL_NAMES, ...NOTE_TOOL_NAMES,
  CREATE_MEMBER_TOOL_NAME, READ_REQUESTS_TOOL_NAME, ...REWORK_TOOL_NAMES,
  ...HANDOFF_TOOL_NAMES, ASSIGN_MODULE_MAINTAINER_TOOL_NAME, PROPOSE_ROLE_SPLIT_TOOL_NAME,
]);

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
 * extension tools (read-only command, review/proposal, rerun and the two
 * rework requests). It is the one
 * definition of "known to this Runtime": preparation drops any other selected
 * name and the start still rejects it, so the registration facts stay with the
 * start where the real owner wiring is known.
 */
export const RUNTIME_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  ...BUILTIN_TOOL_NAMES, ...EXPLORATION_TOOL_NAMES, ...PLATFORM_COORDINATION_TOOL_NAMES,
  CREATE_MEMBER_TOOL_NAME, READ_REQUESTS_TOOL_NAME, ...REWORK_TOOL_NAMES,
  ASSIGN_MODULE_MAINTAINER_TOOL_NAME,
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
      // 历史只读本轮目标的 Run（A9 放开的是读节点，不是历史）：同项目别的目标的 Run 在读卡之前就拒，
      // Run 在不在都一样；别的项目的 Run 交给下面的读卡，回 121-149 的原句。
      if (request.runRef.projectId === goalRef.projectId && request.runRef.goalId !== goalRef.goalId) {
        return rejected('forbidden', 'the requested Run is not in the bound Goal');
      }
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
      // 读卡的范围或身份拒绝原样返回（别的项目的 Run 在这里拒），不到历史 owner。
      if (looked.status !== 'ready') return looked;
      const card = looked.value.items[0];
      if (card === undefined) return rejected('not_found', 'the graph did not return the requested Run card');
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
  /** M's one member request owner behind `create_member`; absent makes the name unregisterable. */
  memberCreation?: RuntimeExecutionDependencies['memberCreation'];
  /** The `request_rework` owner (`claims.requeueTask`); absent makes both rework names unregisterable. */
  claims?: TaskClaimPort;
  /** The `request_recheck` owner (`evidence.reverifyRound`); absent makes both rework names unregisterable. */
  evidence?: Pick<EvidencePort, 'reverifyRound'>;
  plans: PlanTaskPort;
  context: CoreCallContext;
  sessionRef: SessionRef;
  /** The Run whose trusted identity the `create_member` caller records. */
  runRef: RunRef;
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
    /** 注记是图的一部分，图读依赖少了它等于没绑（A8）。 */
    notes: NoteMemoryReadPort;
  };
  /** Slice 4C L13/L14: `platform.notes`' write and check ports for
   * `record_note` and `check_links`; absent makes a selected note tool or link
   * check unregisterable. */
  notes?: RuntimeExecutionDependencies['notes'];
  /** The bound model's platform web lookup; absent makes a selected web name unregisterable. */
  webLookup?: WebLookupPort;
  /** H's one trusted entry; absent makes a selected `hand_off` unregisterable. */
  handoffs?: RuntimeExecutionDependencies['handoffs'];
  /** The adviser's one maintainer assignment entry; absent makes the name unregisterable. */
  maintainerAssignments?: RuntimeExecutionDependencies['maintainerAssignments'];
  /** The one `propose_role_split` owner; absent makes the name unregisterable. */
  roleSplit?: RoleSplitToolOwnerV1;
  /** The structural-proposal owner behind `propose_architecture_revision`; absent makes the name unregisterable. */
  architectureProposals?: RuntimeExecutionDependencies['architectureProposals'];
  /** The formal Session duty the start resolved; `hand_off` is executor/adviser only. */
  duty?: 'executor' | 'adviser';
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
    && name !== CREATE_MEMBER_TOOL_NAME && !REWORK_TOOL_NAME_SET.has(name)
    && name !== ASSIGN_MODULE_MAINTAINER_TOOL_NAME
    // `read_requests` is a name a Work Run knows but never builds: only a Query builds it.
    && name !== READ_REQUESTS_TOOL_NAME
    && !(input.extensionNames?.has(name) ?? false));
  if (unknown.length > 0) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects tool names this Runtime does not know: ${[...new Set(unknown)].join(', ')}`) };
  }
  const wanted = new Set(input.selected);
  const mailboxNames = SESSION_MAILBOX_TOOL_NAMES.filter(name => wanted.has(name));
  const decisionNames = USER_DECISION_TOOL_NAMES.filter(name => wanted.has(name));
  const askCopyNames = wanted.has(ASK_COPY_TOOL_NAME) ? [ASK_COPY_TOOL_NAME] : [];
  const personNames = PERSON_MESSAGE_TOOL_NAMES.filter(name => wanted.has(name));
  const whiteboardNames = WHITEBOARD_TOOL_NAMES.filter(name => wanted.has(name));
  const graphNames = GRAPH_TOOL_NAMES.filter(name => wanted.has(name));
  const linkCheckNames = LINK_CHECK_TOOL_NAMES.filter(name => wanted.has(name));
  const webNames = WEB_LOOKUP_TOOL_NAMES.filter(name => wanted.has(name));
  const noteNames = NOTE_TOOL_NAMES.filter(name => wanted.has(name));
  const handoffNames = HANDOFF_TOOL_NAMES.filter(name => wanted.has(name));
  const architectureNames = ARCHITECTURE_TOOL_NAMES.filter(name => wanted.has(name));
  const memberNames = wanted.has(CREATE_MEMBER_TOOL_NAME) ? [CREATE_MEMBER_TOOL_NAME] : [];
  const maintainerNames = wanted.has(ASSIGN_MODULE_MAINTAINER_TOOL_NAME)
    ? [ASSIGN_MODULE_MAINTAINER_TOOL_NAME] : [];
  const roleSplitNames = wanted.has(PROPOSE_ROLE_SPLIT_TOOL_NAME) ? [PROPOSE_ROLE_SPLIT_TOOL_NAME] : [];
  const reworkNames = REWORK_TOOL_NAMES.filter(name => wanted.has(name));
  const members = input.memberCreation;
  const maintainers = input.maintainerAssignments;
  const reworkClaims = input.claims?.requeueTask;
  const reworkEvidence = input.evidence?.reverifyRound;
  if (mailboxNames.length === 0 && decisionNames.length === 0 && personNames.length === 0 && askCopyNames.length === 0
    && whiteboardNames.length === 0
    && graphNames.length === 0 && linkCheckNames.length === 0 && webNames.length === 0 && noteNames.length === 0 && handoffNames.length === 0
    && architectureNames.length === 0
    && memberNames.length === 0 && maintainerNames.length === 0 && reworkNames.length === 0
    && roleSplitNames.length === 0) {
    return { ok: true, value: null };
  }
  if (decisionNames.length > 0 && input.decisionMessages === undefined) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects user decision tools but no decisionMessages dependency is bound: ${decisionNames.join(', ')}`) };
  }
  if (personNames.length > 0 && input.decisionMessages === undefined) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects person message tools but no decisionMessages dependency is bound: ${personNames.join(', ')}`) };
  }
  if (askCopyNames.length > 0 && input.mailbox === undefined) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects ask_copy but no SessionMailbox dependency is bound: ${askCopyNames.join(', ')}`) };
  }
  if (memberNames.length > 0 && members === undefined) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects create_member but no member-creation dependency is bound: ${memberNames.join(', ')}`) };
  }
  if (maintainerNames.length > 0 && maintainers === undefined) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects assign_module_maintainer but no maintainer-assignment dependency is bound: ${maintainerNames.join(', ')}`) };
  }
  // The two rework tools come from ONE factory whose config requires both
  // owners, so either absence keeps every selected name `unsupported`.
  if (reworkNames.length > 0 && (reworkClaims === undefined || reworkEvidence === undefined)) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects rework tools but no rework dependency is bound: ${reworkNames.join(', ')}`) };
  }
  if (graphNames.length > 0 && input.graph === undefined) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects graph read tools but no graph read dependency is bound: ${graphNames.join(', ')}`) };
  }
  if (noteNames.length > 0 && (input.notes?.write === undefined || input.notes.check === undefined)) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects note tools but no note write/check dependency is bound: ${noteNames.join(', ')}`) };
  }
  if (linkCheckNames.length > 0 && input.notes?.check === undefined) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects check_links but no note check dependency is bound: ${linkCheckNames.join(', ')}`) };
  }
  if (webNames.length > 0 && input.webLookup === undefined) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects web lookup tools but no web lookup port is bound: ${webNames.join(', ')}`) };
  }
  if (handoffNames.length > 0 && (input.handoffs === undefined || input.duty === undefined)) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects hand_off but no handoff entry or formal Session duty is bound: ${handoffNames.join(', ')}`) };
  }
  if (architectureNames.length > 0 && input.architectureProposals === undefined) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects propose_architecture_revision but no proposal owner is bound: ${architectureNames.join(', ')}`) };
  }
  if (roleSplitNames.length > 0 && input.roleSplit === undefined) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects propose_role_split but no roleSplit owner is bound: ${roleSplitNames.join(', ')}`) };
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
      ...(input.texts === undefined ? {} : { texts: input.texts }),
    }));
  }
  if (personNames.length > 0 && input.decisionMessages !== undefined) {
    handles.push(createPersonMessageTools({
      decisionMessages: input.decisionMessages,
      goalRef: input.goalRef,
      context: input.context,
      requestIdForCall: input.requestIdForCall,
      ...(input.texts === undefined ? {} : { texts: input.texts }),
    }));
  }
  if (askCopyNames.length > 0 && input.mailbox !== undefined) {
    handles.push(createAskCopyTool({
      mailbox: input.mailbox,
      context: input.context,
      requestIdForCall: input.requestIdForCall,
      ...(input.texts === undefined ? {} : { texts: input.texts }),
    }));
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
      notes: graphDeps.notes,
      ...(input.texts === undefined ? {} : { texts: input.texts }),
    }));
  }
  if (linkCheckNames.length > 0) {
    handles.push(createLinkCheckTools({
      context: input.context,
      check: input.notes!.check!,
      ...(input.texts === undefined ? {} : { texts: input.texts }),
    }));
  }
  if (webNames.length > 0 && input.webLookup !== undefined) {
    handles.push(createWebLookupTools({
      lookup: input.webLookup,
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
      kinds: NOTE_KINDS,
      withdraw: true,
      ...(input.texts === undefined ? {} : { texts: input.texts }),
    }));
  }
  if (memberNames.length > 0 && members !== undefined) {
    // The Run's own trusted identity, never a model argument: the owner reads
    // the Run back and compares it with the `work_run` principal.
    handles.push(createMemberTools({
      members,
      context: input.context,
      caller: {
        kind: 'work',
        actor: agentActorOf(input.sessionRef, input.runRef),
        session: input.sessionRef,
        run: input.runRef,
      },
      requestIdForCall: input.requestIdForCall,
      ...(input.texts === undefined ? {} : { texts: input.texts }),
    }));
  }
  if (maintainerNames.length > 0 && maintainers !== undefined) {
    // The Run's own trusted Work identity, never a model argument: the owner
    // stores it in the operation and rebuilds the checker binding from there.
    handles.push(createAssignMaintainerTools({
      maintainers,
      context: input.context,
      caller: {
        kind: 'work',
        actor: agentActorOf(input.sessionRef, input.runRef),
        session: input.sessionRef,
        run: input.runRef,
      },
      requestIdForCall: input.requestIdForCall,
      ...(input.texts === undefined ? {} : { texts: input.texts }),
    }));
  }
  if (reworkNames.length > 0 && reworkClaims !== undefined && reworkEvidence !== undefined) {
    // The Run's own tool context is the caller; the factory supplies only the
    // owner-bound command identity per call.
    handles.push(createReworkTools({
      claims: { requeueTask: reworkClaims },
      evidence: { reverifyRound: reworkEvidence },
      context: input.context,
      requestIdForCall: input.requestIdForCall,
      ...(input.texts === undefined ? {} : { texts: input.texts }),
    }));
  }
  if (handoffNames.length > 0 && input.handoffs !== undefined && input.duty !== undefined) {
    handles.push(createHandoffTools({ handoffs: input.handoffs, context: input.context,
      sessionRef: input.sessionRef, duty: input.duty, requestIdForCall: input.requestIdForCall,
      ...(input.texts === undefined ? {} : { texts: input.texts }) }));
  }
  if (architectureNames.length > 0 && input.architectureProposals !== undefined) {
    handles.push(createArchitectureTools({
      propose: input.architectureProposals,
      context: input.context,
      requestIdForCall: input.requestIdForCall,
      ...(input.texts === undefined ? {} : { texts: input.texts }),
    }));
  }
  if (roleSplitNames.length > 0 && input.roleSplit !== undefined) {
    // The Run's own trusted Work identity, never a model argument.
    handles.push(createRoleSplitTools({
      roleSplit: input.roleSplit,
      context: input.context,
      caller: {
        kind: 'work',
        actor: agentActorOf(input.sessionRef, input.runRef),
        session: input.sessionRef,
        run: input.runRef,
      },
      requestIdForCall: input.requestIdForCall,
      ...(input.texts === undefined ? {} : { texts: input.texts }),
    }));
  }
  const names = [...mailboxNames, ...decisionNames, ...personNames, ...askCopyNames, ...whiteboardNames, ...graphNames, ...linkCheckNames,
    ...webNames, ...noteNames,
    ...handoffNames, ...architectureNames, ...memberNames, ...maintainerNames, ...roleSplitNames, ...reworkNames];
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
 * The Query grant's two read-only graph tools and, for an exec review Query,
 * its `read_execution_history` bound to the frozen subject Run. The caller
 * keeps the grant projection, the dependency check and the identity
 * construction; this factory only builds the handle and filters its
 * definitions by the passed names. It has NO completeness or duplication check
 * (the Work product check is not shared with Query).
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
  /** The `platform.notes` read port; every round that mounts the graph tools
   * binds it（A8，注记是图的一部分）。 */
  notes: NoteMemoryReadPort;
  /** The frozen tool texts the graph factory reads. */
  texts?: Readonly<Record<string, ToolTextV1>>;
  /** The exec review packet's subject Run; present only when the frozen list holds the history read. */
  subjectRunRef?: RunRef;
  /** `false` for the exec review Query: `look_graph` without its history mode.
   * `'refused'` for a plan review or check review round: the history and
   * platform-artifact input writes stay in the schema but answer B15's refusal. */
  lookHistory?: false | 'refused';
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
    notes: input.notes,
    ...(input.texts === undefined ? {} : { texts: input.texts }),
    ...(input.subjectRunRef === undefined ? {} : { subjectRunRef: input.subjectRunRef }),
    ...(input.lookHistory === undefined ? {} : { lookHistory: input.lookHistory }),
  });
  return {
    names,
    create: (workspace: WorkspaceSandbox): ToolDefinition[] =>
      handle.create(workspace).filter(definition => names.includes(definition.name)),
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
 * Every fact the final tool list needs, all of them facts the
 * preparation and the start already hold. The list is computed once at
 * preparation and compared exactly at start, never sorted.
 */
export type FinalToolListInputV1 = {
  callKind: 'work' | 'query';
  /** A cold-start `role_exploration` Query; absent reads false (every Work call and every other Query). */
  explorationRound?: boolean;
  /** A saved-message consultation Query: it runs as a read-only copy and gets no mailbox/person/action tools. */
  readOnlyCopy?: boolean;
  /** 121-114: the adviser's own intervention planning round (plan shape or Host-system text) may create a member. */
  adviserMemberRound?: boolean;
  /**
   * What a Query round may write in this round. The Work branch never reads
   * it; a Query selects a note tool only when the value is `secretary`.
   */
  noteAdmission: QueryNoteAdmissionV1;
  /** `manifest.permissions.tools`, already intersected with Host/Role/Query ceilings. */
  selected: readonly string[];
  /**
   * The round Session's formal duty, from the same `effectiveDuty` projection
   * preparation and start already use. With `noteAdmission.class` (request vs
   * planning) and `answerTools` (the frozen shape) it names the §2.6 round
   * without a second round enum; Work never passes it.
   */
  duty?: PlatformDutyV1 | 'unknown';
  reviewPhase: 'review' | 'proposal' | null;
  hasBlockedCommands: boolean;
  /** `sourceTools.includeReadSource`: independent of the frozen project source. */
  reviewSource: boolean;
  /** `projectSource.mode === 'frozen'`. */
  frozenSource: boolean;
  materialTools: boolean;
  /**
   * A Query bound to a Goal (`manifest.goal !== null`): only then does it build the whiteboard reads, which read that
   * Goal's Plan. Absent reads false; every Work call ignores it.
   */
  goalBound?: boolean;
  /**
   * The submit tools this round's answer shape freezes. It follows the Run,
   * not `selected`, the way the review tool follows a review Run; absent is
   * null, so every Work call and every plain Query stays unchanged.
   */
  answerTools?: AnswerToolKind | null;
  /**
   * 121-112: a secretary round that may arrange a small change directly also
   * freezes `submit_plan_round` beside its own submit tool. Absent is false,
   * so every Work call and every other Query stays unchanged.
   */
  answerPlanTool?: boolean;
  owners: {
    mailbox: boolean; decisionMessages: boolean; applicationReceipt: boolean;
    plans: boolean; graph: boolean; notes: boolean;
    unknownCallReviews: boolean; commandRerunRequests: boolean;
    /** Optional so a preparation that freezes only the capability set keeps
     * compiling; the start passes the real member-owner fact. */
    memberCreation?: boolean;
    /** `claims.requeueTask` behind `request_rework`; optional for the same reason. */
    reworkRequests?: boolean;
    /** `evidence.reverifyRound` behind `request_recheck`; optional for the same reason. */
    recheckRequests?: boolean;
    /** The adviser's maintainer assignment entry; optional for the same reason. */
    maintainerAssignments?: boolean;
    /** The `propose_role_split` owner; optional for the same reason. */
    roleSplit?: boolean;
    /** The structural-proposal owner behind `propose_architecture_revision`. */
    architectureProposals?: boolean;
    /** The note check behind `check_links`; optional for the same reason. */
    linkCheck?: boolean;
    /** The bound model's web lookup port behind the two web tools; optional for the same reason. */
    webLookup?: boolean;
    /** The P1 `platform.actionRequests` owner behind the §2.6 action tools. */
    actionRequests?: boolean;
    /** The P1 `platform.claimHolds` owner behind `hold_claim`/`release_hold`. */
    claimHolds?: boolean;
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
  // Query builds graph reads, whiteboard reads, and secretary-admitted note tools.
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
  // §2.6 by round: `queryRoundKindOf` projects the frozen duty/note class/
  // answer shape into one round, and the same family set drives both the
  // preparation ceiling and this final list. A Work Run keeps its Host-grant
  // intersection; no round filter is re-derived there.
  const round = query
    ? queryRoundKindOf({
        duty: input.duty ?? 'unknown', noteClass: input.noteAdmission.class,
        answerTools: input.answerTools ?? null, explorationRound: input.explorationRound === true,
        readOnlyCopy: input.readOnlyCopy === true,
      })
    : null;
  const roundAllowed = round === null ? null : queryRoundCoordinationNames(round);
  const mailboxNames = query
    ? roundWanted(SESSION_MAILBOX_TOOL_NAMES, wanted, roundAllowed)
    : SESSION_MAILBOX_TOOL_NAMES.filter(name => wanted.has(name));
  const personNames = query && input.goalBound !== true ? [] : roundWanted(PERSON_MESSAGE_TOOL_NAMES, wanted, roundAllowed);
  const askCopyNames = roundWanted([ASK_COPY_TOOL_NAME], wanted, roundAllowed);
  const actionNames = query ? roundWanted(ACTION_TOOL_NAMES, wanted, roundAllowed) : [];
  const handoffNames = query ? [] : HANDOFF_TOOL_NAMES.filter(name => wanted.has(name));
  const decisionNames = query
    ? roundWanted([QUERY_DECISION_READ_TOOL_NAME], wanted, roundAllowed)
    : USER_DECISION_TOOL_NAMES.filter(name => wanted.has(name));
  // A Query builds the whiteboard names its ceiling left (the two reads) only with a Goal to read.
  const whiteboardNames = query && input.goalBound !== true ? [] : WHITEBOARD_TOOL_NAMES.filter(name => wanted.has(name));
  const graphNames = GRAPH_TOOL_NAMES.filter(name => wanted.has(name));
  const linkCheckNames = LINK_CHECK_TOOL_NAMES.filter(name => wanted.has(name));
  const webNames = WEB_LOOKUP_TOOL_NAMES.filter(name => wanted.has(name));
  const noteNames = NOTE_TOOL_NAMES.filter(name => wanted.has(name)
    && (input.callKind === 'work' ? true : input.noteAdmission.class !== 'none')
    && (roundAllowed === null || roundAllowed.has(name)));
  // Only the Work Runtime and an exploration Query build the proposal tool; no other Query reaches its factory.
  const architectureNames = query && input.explorationRound !== true ? []
    : ARCHITECTURE_TOOL_NAMES.filter(name => wanted.has(name));
  const memberNames = query
    ? input.goalBound === true && (input.noteAdmission.class === 'secretary' || input.adviserMemberRound === true)
      ? roundWanted([CREATE_MEMBER_TOOL_NAME], wanted, roundAllowed) : []
    : wanted.has(CREATE_MEMBER_TOOL_NAME) ? [CREATE_MEMBER_TOOL_NAME] : [];
  // Only the Work Runtime builds the maintainer tool; the adviser's planning Query keeps only `create_member` (121-114).
  const maintainerNames = !query && wanted.has(ASSIGN_MODULE_MAINTAINER_TOOL_NAME)
    ? [ASSIGN_MODULE_MAINTAINER_TOOL_NAME] : [];
  // Only the Work Runtime builds the split tool; a Query's projection never reaches its factory.
  const roleSplitNames = !query && wanted.has(PROPOSE_ROLE_SPLIT_TOOL_NAME)
    ? [PROPOSE_ROLE_SPLIT_TOOL_NAME] : [];
  // Only the Work Runtime and the adviser's planning Query build the rework tools; no other Query reaches their factory.
  const reworkNames = query
    ? roundWanted(REWORK_TOOL_NAMES, wanted, roundAllowed)
    : REWORK_TOOL_NAMES.filter(name => wanted.has(name));
  const requestNames = query ? roundWanted([READ_REQUESTS_TOOL_NAME], wanted, roundAllowed) : [];
  // Every Query mailbox/person name is built by its own Query branch, which
  // re-checks the real owner; the Work branch keeps the owner rejection.
  if ((mailboxNames.length > 0 || askCopyNames.length > 0) && !owners.mailbox) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects communication tools but no SessionMailbox dependency is bound: ${[...mailboxNames, ...askCopyNames].join(', ')}`) };
  }
  if ((decisionNames.length > 0 || personNames.length > 0) && !owners.decisionMessages) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects user decision tools but no decisionMessages dependency is bound: ${[...decisionNames, ...personNames].join(', ')}`) };
  }
  if (actionNames.length > 0 && (owners.actionRequests === false || owners.claimHolds === false)) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects action tools but no action-request/claim-hold owner is bound: ${actionNames.join(', ')}`) };
  }
  if (whiteboardNames.length > 0 && !owners.plans) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects plan tools but no plans dependency is bound: ${whiteboardNames.join(', ')}`) };
  }
  if (graphNames.length > 0 && !owners.graph) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects graph read tools but no graph read dependency is bound: ${graphNames.join(', ')}`) };
  }
  if (noteNames.length > 0 && !owners.notes) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects note tools but no note write/check dependency is bound: ${noteNames.join(', ')}`) };
  }
  if (linkCheckNames.length > 0 && owners.linkCheck === false) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects check_links but no note check dependency is bound: ${linkCheckNames.join(', ')}`) };
  }
  if (webNames.length > 0 && owners.webLookup === false) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects web lookup tools but no web lookup port is bound: ${webNames.join(', ')}`) };
  }
  if (architectureNames.length > 0 && owners.architectureProposals === false) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects propose_architecture_revision but no proposal owner is bound: ${architectureNames.join(', ')}`) };
  }
  // The member owner is re-checked at start; a preparation that freezes only
  // capabilities leaves the marker absent.
  if (memberNames.length > 0 && owners.memberCreation === false) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects create_member but no member-creation dependency is bound: ${memberNames.join(', ')}`) };
  }
  if (maintainerNames.length > 0 && owners.maintainerAssignments === false) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects assign_module_maintainer but no maintainer-assignment dependency is bound: ${maintainerNames.join(', ')}`) };
  }
  if (roleSplitNames.length > 0 && owners.roleSplit === false) {
    return { ok: false, rejection: rejected('unsupported',
      'the Run selects propose_role_split but no roleSplit owner is bound') };
  }
  // The one rework factory requires both owners, so either absence keeps every
  // selected rework name `unsupported`; nothing is silently dropped.
  if (reworkNames.length > 0 && (owners.reworkRequests === false || owners.recheckRequests === false)) {
    return { ok: false, rejection: rejected('unsupported', `the Run selects rework tools but no rework dependency is bound: ${reworkNames.join(', ')}`) };
  }
  // L19a: the rerun tool is registered only on a blocked ordinary Work Run.
  const rerun = input.callKind === 'work' && input.hasBlockedCommands && input.reviewPhase === null;
  if (rerun && (!owners.commandRerunRequests || !owners.unknownCallReviews)) {
    return { ok: false, rejection: rejected('unsupported', 'the blocked Work Run requires the commandRerunRequests owner and the unknownCallReviews read port to register its request tool') };
  }
  const coordinationNames = [...mailboxNames, ...decisionNames, ...personNames, ...askCopyNames, ...actionNames, ...handoffNames, ...whiteboardNames,
    ...graphNames, ...linkCheckNames, ...webNames, ...noteNames, ...architectureNames, ...memberNames, ...maintainerNames,
    ...roleSplitNames, ...reworkNames, ...requestNames];
  if (new Set(coordinationNames).size !== coordinationNames.length) {
    return { ok: false, rejection: rejected('unsupported', 'the selected coordination tool names are duplicated') };
  }
  if (coordinationNames.some(name => RESERVED_TOOL_NAMES.has(name))) {
    return { ok: false, rejection: rejected('unsupported', 'a coordination tool name collides with a builtin, exploration or material tool') };
  }
  // A Run with the shell uses it for commands; every other Run grants the
  // read-only command (121-112 ruling 3: one command tool per round).
  const readonlyName = !wanted.has('shell') && input.readonlyCommand.requested
    && input.readonlyCommand.access === 'all_except_denied' && input.readonlyCommand.allowsReadWholeWorkspace
    ? READONLY_COMMAND_TOOL_NAME : null;
  // The exec review's history read follows the answer shape like its submit
  // tool (slice 9) and reads through the graph owner; without it the shape cannot
  // register its read, which is `unsupported`, never a silent drop.
  const answerReadNames = answerReadToolNamesOf(input.answerTools ?? null);
  if (answerReadNames.length > 0 && !owners.graph) {
    return { ok: false, rejection: rejected('unsupported', `the answer shape mounts ${answerReadNames.join(', ')} but no graph read dependency is bound`) };
  }
  const answerNames = [...answerReadNames,
    ...answerToolNamesOf(input.answerTools ?? null, input.answerPlanTool === true)];
  const extensionNames = [...coordinationNames,
    ...(readonlyName === null ? [] : [readonlyName]),
    ...(reviewToolName === null ? [] : [reviewToolName]),
    ...(rerun ? [REQUEST_COMMAND_RERUN_TOOL_NAME] : []),
    ...answerNames];
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
