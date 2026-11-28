import { BoardView } from './runtime.js';
import { parseBoard } from './board.js';
import {
  committedRouteValue, createHostClient, fetchPageText, readPlatformToken, readPlatformTokenText, readyRouteValue,
  RouteReadError, subscribeChanges, type BootstrapReply, type CoreScope, type GraphWriteRequest, type RouteReply,
} from './host-client.js';
import { asRecord, asText } from './values.js';
import { qualifyProjectPath, splitWorkspacePath } from '../contracts/workspace-path.js';
import type { ChecksConfirmationV1 } from '../contracts/initialization-adoption.js';
import { createAutoRefresh, type RefreshRead, type RefreshSnapshot, type RefreshSources } from './refresh.js';
import {
  adaptNav, completionRevisionOf, goalHref, lineHref, lineNameOfSession, sessionRefAtEdge,
  type LineKey, type NavData, type NavLineDetail,
} from './adapters/nav.js';
import {
  adaptMember, adaptMemberLine, messageBodyKey, queryUnknownTextOf, startupReportOf, taskOfLine, traceOf,
  waitRowsOf,
  type MemberData, type MemberLine, type MemberSource, type MemberWriteBasis,
} from './adapters/member.js';
import { adaptChain, runHostsTextOf, type ChainData, type ChainSource } from './adapters/chain.js';
import {
  ACCESS_FIXED_TEXT, adaptSettings, readSettings, ruleExpiresAtOf, saveSettings, settingsRoleLimitsOf,
  settingsRulesOf, settingsScopeKeyOf, SettingsNotEffectiveError,
  type SettingsData, type SettingsGoalName, type SettingsRoleLimits, type SettingsRuleAnswer,
  type SettingsRules, type SettingsRuleView, type SettingsSnapshot, type SettingsSnapshotData,
} from './adapters/settings.js';
import type { CreatorContactV1, RoleLineDutyV1 } from '../contracts/role-lines.js';
import {
  adaptDone, type DoneData, type DoneDeliveryRead, type DonePolicyRead, type DoneRoundRead, type DoneRunActivity, type DoneSource,
} from './adapters/done.js';
import {
  continuationControlOf, readLine, readSessionTrace, requeueVisible, submitRunControl, type LineReadValue,
} from './adapters/line-shared.js';
import {
  runningMinutesText, type RunningCommandItemV1,
} from './adapters/run-steps.js';
import {
  adaptMain, copyDraftOf, copyReportOf, failedRunStepsOf, goalControlReportOf, lvRecordOf,
  mainRequestFeedbackOf, mainRunStepsOf, recipientNoteOf, requestRootKey,
  type GoalControlOutcomeReadV1, type GoalControlReportLine, type MainCopyDraft, type MainData, type MainLineRecord, type MainPageCursorV1, type MainPageV1,
  type MainRequestFeedback, type MainRunStepStop, type MainRunSteps, type MainTrackRow,
} from './adapters/main.js';
import {
  adaptPlan, adoptedPlanDoc, candidateReadOf, ideasRoundOf, versionRowsOf,
  type MainPageRead, type PlanCandidateFacts, type PlanCandidateRead, type PlanData, type PlanDoc,
  type PlanProposalRef, type PlanProposalShape, type PlanVersionRow,
} from './adapters/plan.js';
import {
  auxChangedRowsOf, auxCommandViewOf, auxDiffHunksOf, auxDiffViewOf, auxFileListOf, auxFilePageOf, auxLeafCountsOf, auxTaskDetailOf,
  catalogArchTree, goalTaskTree, goalTreeNodeOf,
  type AuxCommandHandle, type AuxCommandRow, type AuxCommandView,
  type AuxDemand, type AuxDiffHunk, type AuxDiffView, type AuxFilePage, type AuxPanelData, type AuxTab, type AuxTaskData, type AuxWorkspaceFile,
  type GoalsTaskNode,
} from './adapters/aux-panel.js';
import { adaptGoals, conflictSelectionOf, goalOrderOf, type GoalsData } from './adapters/goals.js';
import {
  adaptDecide, budgetTokensOf, draftOf, factsOf, pinsFor, reworkRefusalTextOf, roundChainFactsOf, subjectGoalId, taskTripleOf,
  type CandidateDetail, type CandidateFactsRead, type DecideCard, type DecideCheckRow, type DecideData, type DecideRow, type DecideStepKey, type KnowledgeNoticeRead,
} from './adapters/decide.js';
import {
  adaptArchOverview, adaptArchSemantics, SEMANTIC_CHECK_FAIL_WORD, type ArchCatalogRead, type ArchNoteRead, type ArchObservedRead,
  type ArchOperationRow, type ArchOverviewData, type ArchOverviewSource, type ArchSemanticRead,
} from './adapters/arch-overview.js';
import type { SemanticFlowV1, SemanticLinkV1, SemanticPageV1 } from '../contracts/semantic-layer.js';
import type { ArchitectureObservationStateV1 } from '../contracts/architecture-observation.js';
import type {
  KnowledgeCommitResult, KnowledgeCommitStatus, KnowledgeProblemV1, KnowledgeRecoveryItemV1, ProposalBatchFileV1,
} from '../contracts/knowledge.js';
import type { ControlIntentSnapshotV1 } from '../contracts/control-intent.js';
import type { ContinuationBriefV1 } from '../contracts/continuation-brief.js';
import type { GraphHoverReadV1, LineControlV1, LineExecutionItemV1, LineMessageStateV1, WorkLineDetailV1, WorkLineSectionPageV1 } from '../contracts/work-line.js';
import type { SessionMessageRef } from '../contracts/core/session-message.js';
import type { QueryJobAnswerSnapshot } from '../contracts/query-job.js';
import type { QueryExecutionRecord } from '../contracts/query-job.js';
import type { QueryRunRef } from '../contracts/query-job.js';
import {
  RUN_STEPS_PAGE_LIMIT, type RunStepsReadV1, type RunStepV1,
} from '../contracts/run-steps.js';
import type { GoalCopyConfirmResultV1, GoalCopyDraftResultV1 } from '../contracts/goal-card.js';
import type { MessageBody, SessionMessageReadV1 } from '../contracts/mailbox.js';
import type { TaskExecutionRecord } from '../contracts/execution-read.js';
import type { RunNetworkSnapshotV1 } from '../contracts/run-network.js';
import type { ArtifactRecord } from '../contracts/artifact.js';
import type { RunRef, TaskTriple } from '../contracts/dispatch.js';
import type { TaskGraph, TaskRow } from '../contracts/task-graph.js';
import type { UncommittedFileListV1, UncommittedFileV1, UncommittedFilesV1 } from '../contracts/workspace-files.js';
import type { MemberCopySource } from './adapters/member.js';
import type { ArchitectureChangeScopeV1, ArchitectureWorkScopeV1 } from '../contracts/architecture-search.js';
import type { NoteAnchorV1 } from '../contracts/note.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from './adapters/decide.js';
import { guardNotConnected, notConnectedAttrs } from './not-connected.js';
import type { RequestReferenceInputV1 } from '../contracts/query-job.js';
import type { QueryJobRef } from '../contracts/query-job.js';
import {
  NO_PLAN_TEXT, adaptTaskMap, adaptTaskMapCalendar, adaptTaskMapDecisionCards, adaptTaskMapDetail, adaptTaskMapTime, anchorLinesOf, mergeUncountedWhy,
  decisionCardCountPartial, overlapGatesOf, runningCommandsByTask,
  isFinishedGoalDisplayPhase, localShortAt, moduleNamesOf, type GoalDisplayPhaseCode, type TaskMapQueueRead,
  type TaskMapData, type TaskMapDetailTaskRead, type TaskMapDisplayRead, type TaskMapGoalRead,
  type TaskMapGraphRead, type TaskMapHoverRead, type TaskMapLineRead, type TaskMapNodeDetailData,
  type TaskMapOverlapGate, type TaskMapOverlapGateRead,
  type TaskMapParticipantRead, type TaskMapRiskRead, type TaskMapSummaryRead, type TaskMapCalendarRead, type TaskMapTimeData, type TaskMapTimelineRead,
  type TaskMapTrackLineRead, type TaskMapTrackPageRead, type TaskMapUncommittedRead,
} from './adapters/task-map.js';

/** Ruling item 5: the top-bar line while the change stream is down. */
const RECONNECT_TEXT = '连接断开，正在重连。';
/** The Host refused the stream with 429: too many pages open on it (lead ruling 7 of E3-5). */
const TOO_MANY_PAGES_TEXT = '这台主机同时打开的页面太多，这一页暂时不自动更新；关掉别的页签后会自己接上。';

/** The scope and selected Goal of the last successful read of any board; the
 * one `askSecretary` seam reads them, so Goals and Main send through the same
 * scope. A failed reread never becomes the next write's basis (§2.10). */
let latestNavScope: CoreScope | null = null;
let latestSelectedGoalId: string | null = null;
/** §2.7: the one line the four line actions read, set by `publish` from a
 * successful Member or Main read only (READS-1); a failed reread keeps none. */
let latestLine: {
  scope: CoreScope; line: MemberLine; write: MemberWriteBasis | null;
  /** K3 L7: the line's task-row review record, from the same Main read. */
  review: MainLineRecord['review'];
} | null = null;
/** 5.5-10: this page's last 继续, kept with its own request id and the two pins it
 * used, so 重试恢复 resends exactly that write. Cleared on a Goal pick. */
let lastResume: {
  goalId: string; scope: CoreScope; goalRef: { aggregateType: 'Goal'; projectId: string; goalId: string };
  requestId: string; expected: Array<{ ref: unknown; revision: number }>;
} | null = null;
/** K2: the shown delivery's write facts, set by `publish` from a successful Done
 * read only; a failed reread keeps the previous ones like every other write seam. */
let latestDelivery: DoneData['deliveryWrite'] = null;
/** D42/decision 121-…: after 采用 the request's candidate closes, so the Plan
 * read no longer carries the adopted draft; the page keeps the adopted card
 * (prototype `Plan.dc.html:4506` 已采用, checks included) while that version is
 * the newest one. A later candidate or a newer version drops it. One state per
 * page boot, reset at `bootBoardPage`, so a reconnect or a second page never
 * loses or borrows an adoption. */
type AdoptedPlanState = {
  pending: Map<string, PlanProposalShape>;
  cards: Map<string, { revision: number; doc: PlanDoc }>;
};
let pageAdoptedPlans: AdoptedPlanState | null = null;

/** P2 (DPS-1): `plans/apply` answered `busy` because it is stopping the affected
 * work. The page keeps the one proposal it waits to adopt again; every Plan
 * publish checks it, and a closed or reloaded page simply loses it. */
let pendingAdoption: { goalId: string; proposal: PlanProposalShape } | null = null;
/** One automatic re-adoption in flight at a time. */
let pendingAdoptionBusy = false;
/** P2: the automatic retry's failure, delivered to the page by the next read once. */
let pendingAdoptError: { text: string; keep: boolean } | null = null;

/** One Goal reference of the shown project: the one builder the line and right-panel readers share (READS-10 a). */
function goalRefIn(projectId: string, goalId: string): { aggregateType: 'Goal'; projectId: string; goalId: string } {
  return { aggregateType: 'Goal', projectId, goalId };
}

/** Ruling 4: the board tells boot which not-yet-read material it needs; the read
 * joins the same refresh loop. */
export type TaskMapReadDemand = {
  detailTaskId?: string | null;
  /** Ruling 3: the DAG's dock reads today's track and hour calendar by default. */
  track?: boolean;
  /** The window the dock/轨道 shows: today, this week, or all loaded history. */
  win?: 'today' | 'week' | 'all';
  /** While a replay cursor is live, every reread keeps the `tasks/timeline`
   * demand; only the board's explicit `replay:false` withdraws it. */
  replay?: boolean;
  /** A picked year day (`YYYY-MM-DD`) appends that local day's hour calendar
   * and track; `null` withdraws it. */
  hourDay?: string | null;
  /** The archive expansion reads `lines/archived` on demand. */
  archive?: boolean;
  /** The dropped list expansion reads the disposition dates on demand. */
  dropped?: boolean;
  /** A full-history number is only read when the caller asks for it. */
  executions?: boolean;
  /** A selected multi-Session line reads its chain (`lines/read`). */
  lineKey?: TaskMapSessionRef | null;
  /** Decide's 已处理 tab: read `history` + `answered_pending_application`. */
  decideDone?: boolean;
  /** Decide's goal filter: only this Goal's queue; `null` withdraws it. */
  decideGoal?: string | null;
  /** Decide's on-demand answer body: read this card's `materials/open` (one click). */
  decideAnswer?: string | null;
  /** Member only: this page's own line, fixed at entry; a click opens another line as `lineKey`. */
  ownKey?: LineKey | null;
  /** Member only: the 轨迹 tab is open, so `sessions/history` joins the read. */
  traceOpen?: boolean;
  /** Member only: the 改动 tab is open, so `files/*` join the read. */
  changesOpen?: boolean;
};
/** A complete `SessionRef`: exactly projectId + sessionId (no workspaceId). */
export type TaskMapSessionRef = LineKey;
export type TaskMapActions = {
  readMore(demand: TaskMapReadDemand): void;
  pinLine(key: TaskMapSessionRef, pinned: boolean): Promise<void>;
};

/** §2.4/§2.7/§2.11: the board tells boot what it needs read; every demand joins
 * the same refresh loop. A Goal pick changes the loop's Goal; a line opens that
 * line's `lines/read`; the archive row reads `lines/archived` only while open. */
export type BoardReadDemand = TaskMapReadDemand & {
  archive?: boolean;
  /** Main only: how many `main/read` pages the conversation has expanded to;
   * `pickGoal` resets it to 1. */
  mainPages?: number;
  /** Main only: the 轨迹 tab is open, so `sessions/history` joins the read. */
  mainTrack?: boolean;
  /** Main B §2.7: the right panel's current tab and file, explicit `null` to
   * withdraw; `detailTaskId` is in `TaskMapReadDemand`. */
  auxTab?: AuxTab | null;
  auxPath?: string | null;
  /** Which Goal the right panel's two maps show; `null`/undefined means
   * `nav.selectedGoalId`. */
  mapGoal?: string | null;
  /** ArchOverview's page state: the search needle, the work-only switch, the
   * directory view and the selected node's anchor. Explicit values replace the
   * old demand, so closing one passes `''`, `false` or `null`. */
  search?: string;
  workOnly?: boolean;
  dirView?: boolean;
  noteAnchor?: NoteAnchorV1 | null;
  /** Done: expanding one requirement's report reads its `materials/open` once. */
  doneReport?: string | null;
  /** Main M2: the expanded answered card whose `materials/open` body is read once.
   * `null` withdraws it; the result is not cached. */
  mainCardAnswer?: string | null;
  /** Main M4: the expanded check notice whose `settings/snapshot` is read once. */
  mainNoticeOpen?: string | null;
  /** Chain A5: the trace record whose `materials/open` body is read once;
   * `null` withdraws it (closing the panel or picking another row). */
  chainRecord?: string | null;
  /** Member B6: the Run whose open detail reads its `network/read` once;
   * `null` withdraws it (closing the detail or picking another row). */
  memberRunHosts?: RunRef | null;
  /** 只给 Main：本页自己的命令句柄，键是 `projectId/workspaceId|<行键>`。 */
  commandRuns?: Map<string, { scope: CoreScope; commandId: string } | 'gone'>;
  /** The semantic layer's switch: `true` reads both routes once per refresh,
   * `false` withdraws them. Absent is off (4-2 甲). */
  semantic?: boolean;
  /** The `?sem=<noteId>` deep link's selected link; `null` withdraws the selection. */
  semPick?: string | null;
  /** Main only: the `#flow=<id>` deep link's selected flow. */
  flowPick?: string | null;
};

/** 本页命令表的键前缀，一个范围一个；`runCommand`、`stopCommand`、`readMain` 共用。 */
const commandRunPrefix = (scope: CoreScope): string => scope.projectId + '/' + scope.workspaceId + '|';

/** A6: one Run's steps as this page has read them. The raw steps are kept
 * merged by position so a live continuation and 再看 50 步 append without
 * drawing a duplicate; an ended Run is never read again on a page refresh. */
type RunStepsScope = { projectId: string; workspaceId: string };
type RunStepsCacheEntry = {
  key: string;
  ref: RunRef | import('../contracts/query-job.js').QueryRunRef;
  scope: RunStepsScope;
  steps: RunStepV1[];
  next: number | null;
  runningFrom: number | null;
  live: boolean;
  /** The whole block answer the board projects from (summary + merged steps). */
  view: RunStepsReadV1;
};
/** One page's cache, reset at `bootBoardPage`; tests boot one page at a time. */
let pageRunSteps = new Map<string, RunStepsCacheEntry>();
/** A6/A3: each drawn Run's workspace, from its own `executions/read`, once per
 * page. `null` is a Run whose snapshot could not be read; it stays without a
 * block and is never retried under a guessed scope. */
let pageRunWorkspaces = new Map<string, string | null>();
/** A7: each ended Run's network record, once per page; a live Run is read per refresh. */
let pageRunHosts = new Map<string, RunNetworkSnapshotV1 | null>();
/** 5 s is the one live-block timer (A6); `setTimeout` chains it, never a polling loop. */
const LIVE_RUN_REREAD_MS = 5_000;

function runStepsKeyOf(scope: RunStepsScope, runId: string): string {
  return scope.projectId + '/' + scope.workspaceId + '/' + runId;
}

/** The per-page key of a Run's own `executions/read`: its workspace is unknown
 * before that read, so the Run's own identity is the key. */
function runWorkspaceKeyOf(ref: RunRef): string {
  return ref.projectId + '/' + ref.goalId + '/' + ref.runId;
}

/** A6: append by Kernel position; the fresh answer wins for a position it reports. */
function mergeRunStepPages(oldSteps: readonly RunStepV1[], fresh: readonly RunStepV1[]): RunStepV1[] {
  const byPosition = new Map<number, RunStepV1>();
  for (const step of oldSteps) byPosition.set(step.position, step);
  for (const step of fresh) byPosition.set(step.position, step);
  return [...byPosition.values()].sort((a, b) => a.position - b.position);
}

/**
 * A6: the one `executions/steps` read of a Run block. A first read is
 * `after:null`; a live Run is reread from `runningFrom-1` and merged by
 * position on every page refresh; an ended Run is answered from the cache with
 * no request. `after` is the explicit paging cursor of 再看 50 步.
 */
async function readRunStepsPage(
  client: ReturnType<typeof createHostClient>, scope: RunStepsScope,
  ref: RunRef | import('../contracts/query-job.js').QueryRunRef, after?: number,
): Promise<{ key: string; read: RunStepsReadV1 }> {
  const key = runStepsKeyOf(scope, ref.runId);
  const cached = pageRunSteps.get(key);
  const explicit = after !== undefined;
  /* A6: an ended Run's steps never change, so a page refresh does not re-read
     it. The one exception is the user's own 再看 50 步. */
  if (cached !== undefined && !cached.live && !explicit) return { key, read: cached.view };
  const cursor = explicit ? after : cached !== undefined && cached.live
    ? (cached.runningFrom === null ? null : cached.runningFrom - 1)
    : null;
  const read = readyRouteValue<RunStepsReadV1>(await client.post('executions/steps', scope, {
    ref, after: cursor, limit: RUN_STEPS_PAGE_LIMIT,
  }), 'executions/steps');
  if (read.kind !== 'steps') {
    pageRunSteps.delete(key);
    return { key, read };
  }
  const steps = cached !== undefined && cursor !== null
    ? mergeRunStepPages(cached.steps, read.steps)
    : read.steps.slice();
  const view: RunStepsReadV1 = { kind: 'steps', summary: read.summary, steps, next: read.next, runningFrom: read.runningFrom };
  pageRunSteps.set(key, {
    key, ref, scope, steps, next: read.next, runningFrom: read.runningFrom,
    live: read.summary.live, view,
  });
  return { key, read: view };
}

/**
 * A3/A5: one drawn Run's workspace. The current Run's `executions/read` is
 * already held by `readLineFacts`; every other drawn Run is read once per page.
 * A failed read is logged and leaves that Run without a block (no guessed
 * workspace, no second steps reader).
 */
async function drawnRunWorkspace(
  client: ReturnType<typeof createHostClient>, scope: CoreScope, ref: RunRef,
  known: readonly TaskExecutionRecord[],
): Promise<string | null> {
  /* A1: the caller already read some Runs' snapshots; reuse them instead of a
     second `executions/read` for the same Run. */
  const current = known.find((record) => record.run.ref.runId === ref.runId) ?? null;
  if (current !== null) return current.run.workspaceSnapshot.workspaceId;
  const key = runWorkspaceKeyOf(ref);
  if (pageRunWorkspaces.has(key)) return pageRunWorkspaces.get(key) ?? null;
  let workspaceId: string | null = null;
  try {
    const record = readyRouteValue<TaskExecutionRecord>(
      await client.post('executions/read', scope, ref), 'executions/read');
    workspaceId = record.run.workspaceSnapshot.workspaceId;
  } catch (error) {
    logReadError(error);
  }
  pageRunWorkspaces.set(key, workspaceId);
  return workspaceId;
}

/**
 * A3/A5: every Run the line draws reads its own `executions/steps`, through the
 * one `readRunStepsPage`. `executions` is the line's page order; the current
 * Run's `executions/read` is `current`, the others' workspaces come from their
 * own snapshot. A Run whose workspace is unavailable is left out.
 */
async function readDrawnRunSteps(
  client: ReturnType<typeof createHostClient>, scope: CoreScope, nav: NavData, key: LineKey,
  executions: readonly LineExecutionItemV1[], current: TaskExecutionRecord | null,
  known: readonly TaskExecutionRecord[] = [],
): Promise<Map<string, MainRunSteps>> {
  const views = new Map<string, MainRunSteps>();
  for (const item of executions) {
    if (item.kind !== 'execution' || views.has(item.runRef.runId)) continue;
    const records = current === null || known.some((record) => record.run.ref.runId === current.run.ref.runId)
      ? known : [current, ...known];
    const workspaceId = await drawnRunWorkspace(client, scope, item.runRef, records);
    if (workspaceId === null) continue;
    const runScope: RunStepsScope = { projectId: item.runRef.projectId, workspaceId };
    let view: MainRunSteps;
    try {
      const { key: runKey, read } = await readRunStepsPage(client, runScope, item.runRef);
      view = mainRunStepsOf(read);
      view.key = runKey;
      /* A7: a line Run's raw record is this line on Chain. */
      if (view.thinkTruncated) view.rawHref = lineHref('Chain.dc.html', nav.selectedGoalId, key);
    } catch (error) {
      /* Note 5a: this block still draws, with the page's one failure sentence;
         the raw failure is the log's, never the page's. */
      logReadError(error);
      view = failedRunStepsOf(pageTextOf(error));
    }
    /* Note 5a: an unreadable answer (failed or `unknown`) is this block's one
       sentence; the board keeps a Run row's terminal word in that row's head. */
    view.ref = item.runRef;
    views.set(item.runRef.runId, view);
  }
  return views;
}

/**
 * A8: one `executions/running-commands` read, shared by the Run blocks and the
 * TaskMap. A failed read is logged and answers `null`; each caller hides only
 * the long-command item it would have drawn, never its whole page.
 */
export async function readRunningCommands(
  client: ReturnType<typeof createHostClient>, scope: CoreScope,
): Promise<{ items: RunningCommandItemV1[] } | null> {
  try {
    return readyRouteValue<{ items: RunningCommandItemV1[] }>(
      await client.post('executions/running-commands', scope, {}), 'executions/running-commands');
  } catch (error) {
    logReadError(error);
    return null;
  }
}

/**
 * A8: one `executions/running-commands` read for every live Run block this
 * refresh draws, then the one command step each item names (same run, same
 * callId). The step's meta is the Host's own minute count; its 停止 is the
 * Work line's existing cancel card or the Query round's own cancel. A failed
 * read keeps the block and every finished command's own meta; only the live
 * command step loses its long-command meta and 停止, so A1's “进行中” stays.
 */
async function readRunningCommandSteps(
  client: ReturnType<typeof createHostClient>, scope: CoreScope, views: MainRunSteps[],
): Promise<void> {
  const live = views.filter((view) => view.live);
  if (live.length === 0) return;
  const read = await readRunningCommands(client, scope);
  if (read === null) {
    /* Note 5b: a failed read leaves the long-command row out. The board's A1
       “进行中” is the live step's own fallback meta, so only a still-running
       command drops its earlier meta and 停止; a finished command keeps its own
       `通过，n 秒` / `退出码 n，n 秒` untouched. */
    for (const view of live) {
      for (const step of view.steps) {
        if (step.ic !== 'cmd' || !step.live) continue;
        step.meta = '';
        delete step.stop;
      }
    }
    return;
  }
  const items = read.items;
  for (const view of live) {
    const ref = view.ref;
    if (ref === null) continue;
    const kind = 'goalId' in ref ? 'run' : 'query';
    for (const item of items) {
      if (item.run.kind !== kind) continue;
      const sameRun = kind === 'run'
        ? item.run.kind === 'run' && item.run.runRef.projectId === ref.projectId
          && item.run.runRef.runId === ref.runId
        : item.run.kind === 'query' && item.run.queryRunRef.projectId === ref.projectId
          && item.run.queryRunRef.runId === ref.runId;
      if (!sameRun) continue;
      const index = view.callIds.indexOf(item.callId);
      if (index < 0) continue;
      const step = view.steps[index];
      if (step === undefined || step.ic !== 'cmd' || !step.live) continue;
      step.meta = '正在跑，' + runningMinutesText(item);
      const stop: MainRunStepStop = item.run.kind === 'query'
        ? { kind: 'query', queryRunRef: item.run.queryRunRef } : { kind: 'run' };
      step.stop = stop;
    }
  }
}

/** A6: the keys of the live Run blocks this page data draws. Only those may
 * keep the 5 s chain running; a closed block's key is withdrawn by its board. */
function liveRunKeysOf(data: unknown): Set<string> {
  const keys = new Set<string>();
  const addDrawnRunSteps = (view: unknown): void => {
    const row = asRecord(view);
    if (row.live !== true || typeof row.key !== 'string' || row.key === '') return;
    keys.add(row.key);
  };
  const d = asRecord(data);
  /* A1: Chain's one process group per attempt; only an open group keeps its
     live Run's 5 s chain, and `b.steps` is that group's projection. */
  if (Array.isArray(d.attempts)) {
    for (const row of d.attempts) addDrawnRunSteps(asRecord(row).steps);
  }
  if (Array.isArray(d.conversation)) {
    for (const row of d.conversation) addDrawnRunSteps(asRecord(row).run);
  }
  const line = asRecord(d.line);
  const entries = asRecord(asRecord(line.rec).entries);
  if (Array.isArray(entries)) {
    for (const entry of entries) addDrawnRunSteps(asRecord(entry).runSteps);
  }
  for (const key of ['items', 'groups'] as const) {
    const rows = Array.isArray(line[key]) ? line[key] as unknown[] : [];
    for (const row of rows) {
      const items = key === 'groups' ? asRecord(row).rows : [row];
      if (!Array.isArray(items)) continue;
      for (const item of items) addDrawnRunSteps(asRecord(item).runSteps);
    }
  }
  return keys;
}

/** The one action surface `pageProps` gives every board. TaskMap uses
 * `readMore`/`pinLine`; Main also uses `pickGoal`, `openLine` and the shared
 * not-connected guard. */
/** 只有本页刚答过的卡持有重放原请求的依据。 */
type ApplicationRetry = {
  cardKey: string;
  state: 'application_not_recorded' | 'awaiting_resume';
  retry: () => Promise<ApplicationRetry | void>;
};

export type BoardActions = {
  readMore(demand: BoardReadDemand): void;
  /** A6: 再看 50 步 reads one page after the block's own `next` and appends it
   * by position, then the same refresh loop republishes the block. */
  readRunSteps?: (key: string) => Promise<void>;
  /** The semantic layer's 重新核对: one check route call, then the same reread
   * loop redraws from the new receipt; a failure throws the page's sentence. */
  checkSemanticLinks?: (items: Array<{ noteId: string; version: number }>) => Promise<{ removed: boolean }>;
  /** A6: the board's own open/close state of one drawn Run block, by the
   * block's page key. Boot starts the 5 s chain only while an open block is
   * live; a block auto-opened by 详细/完全展开 reports itself open too. */
  runOpen: (key: string, open: boolean) => void;
  /** A8: a Query command's 停止 cancels its own round through `queries/cancel`;
   * there is no confirm card (the Work stop uses the line's cancel control). */
  stopQueryRun?: (ref: QueryRunRef) => Promise<void>;
  pinLine?: (key: TaskMapSessionRef, pinned: boolean) => Promise<void>;
  pickGoal: (goalId: string) => void;
  openLine: (key: TaskMapSessionRef | null) => void;
  notConnected: (event: { preventDefault(): void; stopPropagation(): void }) => void;
  notConnectedAttrs: () => ReturnType<typeof notConnectedAttrs>;
  /** §2.8: one `goals/control` write with the Goal and GoalPhase pins the page
   * last showed, then the same refresh loop rereads the chrome. Returns the
   * receipt's system lines (5.5-2/5.6-6). */
  controlGoal: (control: 'pause' | 'resume' | 'cancel') => Promise<GoalControlReportLine[]>;
  /** 5.5-10: resend this page's last 继续 with its own request id and pins. */
  retryResume: () => Promise<void>;
  /** K3: one `goals/accept-delivery` with the shown delivery's Goal and GoalPhase pins. */
  ackDelivery: () => Promise<void>;
  /** K4: one `queries/ask` to the delivery's secretary; returns the Member-page
   * link the page puts on its own system line. */
  reviewDelivery: () => Promise<{ href: string }>;
  /** K5: one `messages/send` from the delivery page, with `entry: person_intervention`. */
  reportDeliveryProblem: (text: string) => Promise<void>;
  /** §2.3: one `goals/reorder` write with every Goal's current revision, then
   * the same refresh loop rereads the list. */
  reorderGoal: (goalId: string, direction: 'up' | 'down') => Promise<void>;
  /** D49-13: the first step of the two-step requeue; the dialog reads the answer. */
  readCopyDraft: (goalId: string) => Promise<MainCopyDraft>;
  /** D49-13: the confirmation, with the revision the first step read. */
  confirmCopy: (draft: MainCopyDraft, selected: readonly SessionMessageRef[]) => Promise<GoalControlReportLine[]>;
  /** §2.4: one `decisions/answer` write for the shown conflict card, then a
   * reread; `revision_conflict` is shown, never retried with fresh revisions. */
  answerConflict: (cardKey: string, optionId: 'wait' | 'order' | 'parallel') => Promise<void>;
  /** §2.6: one `requests/submit` plus one `requests/read`; returns the round's
   * root key, user text and the secretary's non-null answer so the page can append
   * it to its own log. `null` only when the submit reply carried no `requestRoot`. */
  askSecretary: (text: string,
    reference: RequestReferenceInputV1 | readonly RequestReferenceInputV1[] | null,
    options?: { continues?: QueryJobRef | null },
  ) => Promise<{ root: string; input: string; answer: string | null } | null>;
  /** D18/D30: one `decisions/answer` with the card's own source and pins. `text` is
   * the repropose reason; every other card sends `''`. */
  answerCard: (cardKey: string, optionId: string | null, text?: string,
    annotations?: readonly { objectKey: string; text: string }[]) => Promise<ApplicationRetry | void>;
  writeCandidate: (cardKey: string, action: 'adopt' | 'abandon') => Promise<void>;
  /** 7D2 X9: one `knowledge/recover` for the shown knowledge notice's recovery
   * item (the notice id is the row's `project_notice:` suffix), then a reread. */
  recoverKnowledge: (itemKey: string, itemNo: number) => Promise<void>;
  /** 7D2 EXC: stop the shown workspace's unfinished initialization exploration; the range and
   * `input.workspace` come from the row of the last ArchOverview read. */
  stopExploration: (projectId: string, workspaceId: string) => Promise<void>;
  /** 7D2 EXC: continue the shown workspace's stopped exploration, from the same last read. */
  continueExploration: (projectId: string, workspaceId: string) => Promise<void>;
  /** 7D2 EXC: open one more exploration round for the shown module, from the same last read. */
  deepenBlock: (projectId: string, workspaceId: string, moduleId: string) => Promise<void>;
  /** 121-74: commit the shown workspace's architecture and note files, from the same last read. */
  commitKnowledge: (projectId: string, workspaceId: string, message: string | null) => Promise<void>;
  /** D22/D24/D34/D35: `tasks/requeue`, afterRun and pins from the card itself. */
  requeueCard: (cardKey: string, input: { reason: string; budget: string | null; note?: string | null }) => Promise<void>;
  /** D26/D39: `verification/reverify` with the Task's head round and its one pin;
   * a null note sends no `note` key at all. */
  reverifyCard: (cardKey: string, note: string | null) => Promise<void>;
  /** Y3: withdraw every check the card names, then reverify without a note. */
  withdrawAndReverify: (cardKey: string) => Promise<void>;
  /** D25/D40: `executions/resolve-unknown` with the card's Run. */
  attestCard: (cardKey: string, reason: string) => Promise<void>;
  /** S6 (5.6-11): the Member head's 认定结果; the line's own `attest_unknown`
   * control picks the route and pins (Run or QueryRun). */
  attestLine: (reason: string) => Promise<void>;
  /** D20/D23/D27: `plans/propose` + `plans/apply`, changing one Task's disposition. */
  changeDisposition: (cardKey: string, disposition: 'active' | 'deferred' | 'cancelled', note?: string) => Promise<void>;
  /** D21/D36/D37: `plans/propose` + `plans/apply`, adding a required repair Task. */
  addRepairTask: (cardKey: string, input: { name: string; checkIds: string[]; note?: string }) => Promise<void>;
  /** D28: `decisions/notices/seen` with the row's own page token. */
  markNoticeSeen: (itemKey: string) => Promise<void>;
  /** M4/121-138: one `settings/checks/withdraw` in the named workspace, then a reread. */
  withdrawCheck: (scope: { projectId: string; workspaceId: string }, checkId: string) => Promise<void>;
  /** D31/D43/D44: the card's question; returns the user's text, this round's root
   * key and answer. */
  askCard: (cardKey: string, text: string) => Promise<{ root: string; input: string; answer: string | null } | null>;
  /** §2.5/§2.8: one `tasks/hold/release` (the task card's 撤销暂缓), releasing
   * every hold reason of that Task in one commit. */
  releaseHolds: (taskRef: TaskTriple) => Promise<void>;
  releaseOverlapGate: (gate: TaskMapOverlapGate, reason: string) => Promise<void>;
  /** A8: the TaskMap's 停止 — the line's own cancel control, from the running
   * command's `{ runRef, sessionRef, workspaceId }`. */
  stopTaskRun: (item: { runRef: RunRef; sessionRef: TaskMapSessionRef; workspaceId: string }) => Promise<void>;
  /** 5.10-1: the TaskMap detail's 延后 / 取消 / 恢复, with an optional note. */
  changeTaskDisposition: (taskId: string, disposition: 'active' | 'deferred' | 'cancelled', note?: string) => Promise<void>;
  /** D49-03: the calendar's 补算这一段 over one time range. */
  backfillCalendar: (range: { from: string; to: string }) => Promise<void>;
  /** E3 Plan A §2.3: one `goals/confirm-draft` for the shown draft round. */
  confirmGoalDraft: (round: QueryJobRef, index: number) => Promise<void>;
  /** E3 Plan A §2.3: one `requests/select-idea` for the shown ideas round. */
  selectIdea: (round: QueryJobRef, index: number) => Promise<void>;
  /** E3 Plan A §2.3: one `plans/apply` pinned to the shown candidate and Goal. */
  adoptPlan: (proposal: PlanProposalShape) => Promise<void>;
  /** E3 Plan A §2.3: one `requests/ask` with `regenerate` for the shown plan. */
  askPlanChange: (text: string,
    target: { round: QueryJobRef; proposalRef: PlanProposalRef; revision: number })
    => Promise<{ root: string; input: string; answer: string | null } | null>;
  /** E3 Member §2.12: one published control of the line in the centre. */
  controlLine: (kind: 'pause' | 'resume' | 'cancel') => Promise<void>;
  /** K3 L7: "我来处理" holds this line's unknown-call review (the page's last task read). */
  holdReview: () => Promise<void>;
  /** K3 L7: release that hold; the line continues by the original Task and Run. */
  releaseReviewHold: () => Promise<void>;
  /** E3 Member §2.12: one `tasks/requeue` from the facts of the last successful read. */
  requeueLine: () => Promise<void>;
  /** E3 Chain §2.7: one published control of the line whose chain is shown. */
  controlChain: (kind: 'pause' | 'resume' | 'cancel') => Promise<void>;
  /** E3 Chain §2.7: one `tasks/requeue` from the shown Run's public failure facts. */
  requeueChain: () => Promise<void>;
  /** E3 Member §2.8: one `queries/ask` for the line in the centre. */
  askLine: (question: string) => Promise<void>;
  /** E3 Member §2.8: one `messages/send` to the line in the centre. */
  interveneLine: (text: string) => Promise<void>;
  /** B4：数据模式的冲突“比较”经这个口要共享的 hunk（`auxDiffHunksOf`），画板不建 n×m 表。 */
  diffHunks: (before: string, after: string) => AuxDiffHunk[] | null;
  /** E3 Main B §2.5: one `files/save` CAS write; the page passes the digest it read. */
  saveFile: (path: string, content: string, expectedRevision: string | null) => Promise<void>;
  /** 121-147：给一行命令发一次 `commands/start`；句柄按行键记下。 */
  runCommand: (rowKey: string, row: { command: string; cwd: string; timeoutMs: number }) => Promise<void>;
  /** 121-147：给这一行自己最近的那个句柄发一次 `commands/stop`。 */
  stopCommand: (rowKey: string) => Promise<void>;
  /** Settings page: one `settings/<route>` write; its answer's snapshot becomes
   * the page data. A not-effective answer rereads the snapshot once before the
   * page draws the stored value. `notEffective` is the Host's “saved but not
   * confirmed” answer, a page-facing data flag (the page never inspects the
   * error). */
  saveSettings: (route: string, input: unknown) => Promise<{ notEffective: boolean }>;
  /** 7D2 D60-5: one `projects/role-limits/set`, carrying only the changed cells.
   *  The page keeps an edit open across a conflict reread; the next save takes the
   *  reread's revision. */
  saveRoleLimits: (change: {
    running?: Partial<Record<RoleLineDutyV1, number>>;
    open?: Partial<Record<RoleLineDutyV1, number>>;
  }) => Promise<void>;
  /** 7D2 D62-2: one `autonomy-rules/update`; `date` null clears the expiry. */
  changeRuleExpiry: (ruleId: string, date: string | null) => Promise<void>;
  /** 7D2 D62-2: one `autonomy-rules/revoke` for a row the page draws. */
  revokeRule: (ruleId: string) => Promise<void>;
  /** A block's own 重试: reread the whole page, so one failed secondary read
   *  does not need its own route read. */
  rereadSettings: () => void;
};

/* One write per line at a time: the line's four controls and its requeue share
   this key, so a second click while the first is in flight gets that promise
   instead of a second `controls/submit`/`tasks/requeue`. The board also greys
   the four buttons while the write is in flight; both read the same latch. */
const lineWrites = new Map<string, Promise<void>>();

/** One write per line at a time: a second click joins the first promise. */
async function withLineWrite(key: string, write: () => Promise<void>): Promise<void> {
  const inFlight = lineWrites.get(key);
  if (inFlight !== undefined) return inFlight;
  const pending = write();
  lineWrites.set(key, pending);
  try {
    await pending;
  } finally {
    lineWrites.delete(key);
  }
}

/**
 * Browser entry for one frozen board page. The Host serves the original
 * `.dc.html` at this URL; boot fetches that source through the host client and
 * parses it, because the DOM lowercases attribute names (`onClick` becomes
 * `onclick`). `parseBoard` hoists `<helmet>` into `<head>` and mounts the
 * rendered tree.
 *
 * E3-2 ruling items 3, 4, 6, 7 and 8: only the boards in `BOARD_READERS` read
 * real routes; every other board mounts exactly as before on its sample data.
 * E3-3 ruling items 2 and 3: the TaskMap read and its change stream are one
 * auto-refresh loop, and `readTaskMap` carries that read's `changesHead` so a
 * commit between the read and the subscription is replayed rather than lost.
 */
export async function bootBoardPage(): Promise<void> {
  const root = document.querySelector('x-dc');
  if (!root) return;
  pageAdoptedPlans = { pending: new Map(), cards: new Map() };
  pendingAdoption = null;
  pendingAdoptionBusy = false;
  pendingAdoptError = null;
  pageRunSteps = new Map();
  pageRunWorkspaces = new Map();
  pageRunHosts = new Map();
  const pageDocument = document;
  const search = new URLSearchParams(location.search);
  const goalParam = search.get('goal');
  let goalId = goalParam === null || goalParam === '' ? null : goalParam;
  /* 4-2 甲: `?sem=` is the one explicit way in (the full page's link from Main);
     nothing is written to the URL or either storage. `#flow=` selects a flow. */
  const semParam = search.get('sem');
  const flowParam = (location.hash ?? '').startsWith('#flow=') ? location.hash.slice('#flow='.length) : '';
  /* §2.2: Member's whole-line identity. Both values are needed together; one
     alone is ambiguous across projects. Other boards parse them but ignore. */
  const lineProject = search.get('lineProject');
  const lineSession = search.get('lineSession');
  const boardName = boardNameOf(location.href);
  /* A1/A24: the frozen template keeps `Main.dc.html`; every live page reaches
     the cross-page links through the `mainHref`/`taskMapHref` props, so the
     mount value is the URL's Goal and a successful read can move them to the
     Goal the page shows. Done's sample card keeps its static link. */
  const source = await fetchPageText(location.href);
  const board = parseBoard(document.title, source);
  if (board.helmetHtml.length > 0) hoistHelmet(board.helmetHtml);

  const documentToken = readPlatformToken(document);
  const reader = BOARD_READERS[boardName];
  if (documentToken === null || reader === undefined) {
    new BoardView(board).mount(root);
    return;
  }

  /* The page's 完整架构图 link keeps the current Goal: the URL's Goal until a
     read says which Goal the page shows. A failed read falls back to the URL. */
  const defaults = {
    ...board.defaults,
    archHref: goalHref('ArchOverview.dc.html', goalId),
    mainHref: goalHref('Main.dc.html', goalId),
    taskMapHref: goalHref('TaskMap.dc.html', goalId),
    settingsHref: settingsHrefOf(boardName, location.search),
    backHref: settingsBackHrefOf(location.search),
  };
  const view = new BoardView(board, { ...defaults, readState: { status: 'loading' } });
  view.mount(root);
  /* Esc leaves the settings page the same way 返回工作台 does. The fake DOM
     used by page tests has no document listener, so this only runs in a browser. */
  if (boardName === 'Settings' && typeof document.addEventListener === 'function') {
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') location.assign(settingsBackHrefOf(location.search));
    });
  }
  let token = documentToken;
  let client = createHostClient(token);
  let firstConnection = true;
  /** A restarted Host serves a new token: the first connection uses the page's
   * meta, every reconnect rereads the served page text and rebuilds the client
   * so both the stream and the reads use the new token. A page with no token is
   * the same page condition as a lost stream: `onEnd` schedules the retry. */
  async function tokenOf(): Promise<string> {
    if (firstConnection) {
      firstConnection = false;
      return token;
    }
    const next = readPlatformTokenText(await fetchPageText(location.href));
    if (next === null) throw new Error('the served page carries no platform token');
    /* 令牌变了就是换了 Host 实例：旧句柄已经没了，旧号可能已是别的命令，
       所以全部标成“没了”、不再读。 */
    if (next !== token) for (const key of commandRuns.keys()) commandRuns.set(key, 'gone');
    token = next;
    client = createHostClient(token);
    return token;
  }
  /* 121-147 Q6：本页自己的命令句柄。只有 `runCommand` 写句柄号，
   * `tokenOf` 把它们标成“没了”；刷新页面这张表就没了。 */
  const commandRuns = new Map<string, { scope: CoreScope; commandId: string } | 'gone'>();
  /* B5：正在发 `commands/start` 的行键。画板还没重画时的第二下拿到同一个
     在途动作，不再发请求。 */
  const commandStarts = new Map<string, Promise<void>>();
  /* Ruling 3 "默认页": opening the board reads the DAG's today track and today
   * hour calendar, not only the six base reads. */
  const demand: BoardReadDemand = { track: true, win: 'today', commandRuns };
  /* Main B §2.1: the panel opens on 任务图, so its first read is `auxTab:'task'`;
     Decide's, Plan's and Done's panels open on 任务图 too. */
  if (boardName === 'Main' || boardName === 'Decide' || boardName === 'Plan' || boardName === 'Done') demand.auxTab = 'task';
  if (boardName === 'ArchOverview' && semParam !== null && semParam !== '') {
    demand.semantic = true;
    demand.semPick = semParam;
  }
  if (boardName === 'Main' && flowParam !== '') demand.flowPick = flowParam;
  if ((boardName === 'Member' || boardName === 'Chain')
    && lineProject !== null && lineProject !== '' && lineSession !== null && lineSession !== '') {
    demand.lineKey = { projectId: lineProject, sessionId: lineSession };
    demand.ownKey = demand.lineKey;
  }
  /** The navigation data the page last published; a control write pins those
   * exact revisions (§2.8), never a second read after the click. */
  let latest: NavData | null = null;
  /** The Goals data and scope the page last published successfully. A failed
   * reread must not become the pins of a reorder/answer write. */
  let latestGoals: GoalsData | null = null;
  let latestGoalsScope: CoreScope | null = null;
  /** The TaskMap data and scope this page last published; a disposition write
   * takes its Goal revision and plan from these, never from a second read. */
  let latestTaskMap: TaskMapData | null = null;
  /** The Decide data and scope the page last published; every card action takes
   * its source/pins/task/run from these, never from a route shape the page sends. */
  let latestDecide: DecideData | null = null;
  let latestDecideScope: CoreScope | null = null;
  /** The ArchOverview read the page last published; its rows carry the range each exploration
   * and knowledge write sends, so a click never reads a second time. */
  let latestArch: ArchOverviewData | null = null;
  /** §2.7: the one line the four line actions read, set by both readers. */
  /** Chain's last successful read; the write seams live beside the reader. */
  let latestChain: ChainData | null = null;
  /** Settings' last published data and read version; a settings write updates
   * both in place from its own answer. */
  let latestSettings: SettingsData | null = null;
  let settingsDataVersion = 0;
  /** 7D2 K: the three project writes share one path — commit the answer, reread
   *  when the row moved or vanished so the next click carries the reread's
   *  versions, and reread after every commit. */
  const projectWrite = async (route: string, send: () => Promise<RouteReply>): Promise<void> => {
    try {
      committedRouteValue(await send(), route);
    } catch (error) {
      if (error instanceof RouteReadError
        && (error.code === 'revision_conflict' || error.code === 'not_found')) {
        await refresh.reread();
      }
      throw new Error(projectWriteTextOf(route, error));
    }
    await refresh.reread();
  };
  const decideRowOf = (key: string): DecideRow | null => {
    const data = latestDecide;
    if (data === null) return null;
    return data.sections.flatMap((section) => section.rows).concat(data.history)
      .find((row) => row.key === key) ?? null;
  };
  const decideCardOf = (key: string): DecisionCardV1 | null => decideRowOf(key)?.card ?? null;
  async function sendCardAnswer(cardKey: string, scope: CoreScope, request: GraphWriteRequest,
    retry = false): Promise<ApplicationRetry | void> {
    try {
      const reply = await client.write('decisions/answer', scope, request);
      const result = asRecord(reply.value);
      const receipt = reply.status === 'ready' ? asRecord(result.answer) : null;
      if (reply.status !== 'committed' && receipt?.status !== 'committed') {
        throw new RouteReadError('decisions/answer', reply.code || reply.status, reply.reason ?? '');
      }
      if (boardName === 'Decide' && (result.state === 'application_not_recorded' || result.state === 'awaiting_resume')) {
        // 保留第一次的范围、答复和版本。画板移到待落实的这一行时重读队列。
        return { cardKey, state: result.state, retry: () => sendCardAnswer(cardKey, scope, request, true) };
      }
    } catch (error) {
      logReadError(error);
      if (boardName === 'Decide' && error instanceof RouteReadError && error.code === 'revision_conflict') {
        await refresh.reread();
      }
      throw new Error(retry ? writeTextOf(error) : cardWriteTextOf(error));
    }
    await refresh.reread();
  }
  /** Y1/Y6: the card's Task row from the same last Decide read, for its `rework`
   * history (the refusal sentence names the earlier requeue). */
  const decideTaskRowOf = (card: DecisionCardV1 | null): Record<string, unknown> | null => {
    if (card === null) return null;
    const triple = taskTripleOf(card);
    if (triple === null) return null;
    const graph = latestDecide?.plans[triple.goalId];
    const tasks = asRecord(graph).tasks;
    if (!Array.isArray(tasks)) return null;
    return tasks.map((entry) => asRecord(entry))
      .find((entry) => asText(asRecord(entry.ref).taskId) === triple.taskId) ?? null;
  };
  /** One ArchOverview row's own range; a row that is no longer in the last read never becomes a
   * guessed scope. */
  const archRowScope = (row: { projectId: string; workspaceId: string } | null): CoreScope => {
    if (row === null) throw new Error(knowledgeWriteTextOf(new Error('the architecture row is gone')));
    return { projectId: row.projectId, workspaceId: row.workspaceId };
  };
  /** §2.7 D20/D21: one propose, then one apply only when the proposal is
   * committed and has no issues; both pin the displayed Goal revision. */
  async function writePlanChange(
    scope: CoreScope, goalRef: { aggregateType: 'Goal'; projectId: string; goalId: string },
    goalRevision: number, plan: unknown,
    change: {
      planId: string; taskId?: string; disposition?: 'active' | 'deferred' | 'cancelled';
      repair?: { taskId: string; name: string; role: string; instruction: string; failureTaskId: string };
      text: string; reason: { text: string; sources: unknown[]; affectedTaskIds?: string[] };
    },
  ): Promise<void> {
    const expected = [{ ref: goalRef, revision: goalRevision }];
    try {
      const propose = await client.write('plans/propose', scope, {
        input: { goalRef, basedOn: asRecord(asRecord(plan).plan ?? plan).ref ?? null,
          draft: draftOf(plan, change), reason: change.reason },
        meta: { requestId: crypto.randomUUID(), expected },
      });
      const proposal = committedRouteValue<unknown>(propose, 'plans/propose');
      const issues = asRecord(proposal).issues;
      if (Array.isArray(issues) && issues.length > 0) {
        throw new RouteReadError('plans/propose', 'invalid', JSON.stringify(issues));
      }
      const apply = await client.write('plans/apply', scope, {
        input: { proposalRef: asRecord(proposal).ref,
          expectedProposalRevision: asRecord(proposal).revision, decisionRefs: [] },
        meta: { requestId: crypto.randomUUID(), expected },
      });
      committedRouteValue(apply, 'plans/apply');
    } catch (error) {
      throw new Error(planWriteTextOf(error));
    }
    await refresh.reread();
  }
  /** D20/D23/D27 and 5.10-1: one Task's disposition change. The note, when a
   * person wrote one, becomes the plan change's reason; otherwise the button's
   * own word does. */
  async function writeDisposition(
    scope: CoreScope, goalRef: { aggregateType: 'Goal'; projectId: string; goalId: string },
    goalRevision: number, plan: unknown, taskId: string,
    disposition: 'active' | 'deferred' | 'cancelled', note = '',
  ): Promise<void> {
    const text = disposition === 'active' ? '恢复任务' : disposition === 'deferred' ? '延后任务' : '取消任务';
    const reason = note.trim();
    await writePlanChange(scope, goalRef, goalRevision, plan, {
      planId: crypto.randomUUID(), taskId, disposition, text,
      reason: { text: reason === '' ? text : reason, sources: [], affectedTaskIds: [taskId] },
    });
  }
  /**
   * E3 Plan A §2.3: one `requests/ask` (or, for a card without a request, one
   * `requests/submit`) plus the one `requests/read` that finds this round's
   * answer. Card questions and plan changes share it; Main's `askCard` keeps
   * its replies unchanged.
   */
  async function askAndRead(
    scope: CoreScope, round: QueryJobRef | null, requestRoot: QueryJobRef | null,
    cardRefs: ReadonlyArray<{ ref: unknown; revision: number }>,
    regenerate: boolean, text: string, fallbackGoalId: string | null,
  ): Promise<{ root: string; input: string; answer: string | null } | null> {
    const commandId = crypto.randomUUID();
    let askRoot: unknown = null;
    let target: unknown;
    try {
      if (round !== null) {
        const reply = await client.post('requests/ask', scope, {
          commandId, round, cardRefs, regenerate, text,
        });
        if (reply.status !== 'queued') {
          throw new RouteReadError('requests/ask', reply.code || reply.status || 'no status', reply.reason ?? '');
        }
        askRoot = round;
        target = asRecord(reply).followupRound;
      } else {
        const reply = await client.post('requests/submit', scope, {
          commandId, goalId: fallbackGoalId, text, continues: null, recipient: null, references: [],
        });
        if (reply.status !== 'queued') {
          throw new RouteReadError('requests/submit', reply.code || reply.status || 'no status', reply.reason ?? '');
        }
        askRoot = asRecord(reply).requestRoot;
        target = asRecord(reply).round;
      }
    } catch (error) {
      throw new Error(writeTextOf(error));
    }
    let answer: string | null = null;
    let readRoot: unknown = null;
    const readInput = requestRoot ?? askRoot;
    try {
      const read = readyRouteValue<unknown>(
        await client.post('requests/read', scope, { requestRoot: readInput }), 'requests/read',
      );
      const echoed = asRecord(read).requestRoot;
      if (echoed !== null && echoed !== undefined) readRoot = echoed;
      const rounds = asRecord(read).rounds;
      const targetId = asText(asRecord(target).queryJobId);
      if (Array.isArray(rounds) && targetId !== '') {
        const hit = rounds.map((entry) => asRecord(entry))
          .find((entry) => asText(asRecord(entry.ref).queryJobId) === targetId);
        if (hit !== undefined) answer = asText(hit.answer) || null;
      }
    } catch {
      /* The send stands; a failed read only means this round has no answer yet. */
      answer = null;
    }
    return { root: requestRootKey((readRoot ?? readInput) as QueryJobRef), input: text, answer };
  }

  /** Y4: the one `verification/reverify` write, shared by the card action and
   * the withdraw-then-reverify action. A null/blank note sends no `note` key. */
  async function reverifyWrite(cardKey: string, note: string | null): Promise<void> {
    const row = decideRowOf(cardKey);
    const card = row?.card ?? null;
    const view = row?.view ?? null;
    const scope = latestDecideScope;
    if (card === null || view === null || scope === null || view.roundRef === null) {
      throw new Error(reworkWriteTextOf(new Error('this card has no head round to reverify')));
    }
    const clean = note === null ? null : note.trim() === '' ? null : note;
    let value: unknown;
    try {
      const reply = await client.write('verification/reverify', scope, {
        input: { predecessorRoundRef: view.roundRef, ...(clean === null ? {} : { note: clean }) },
        meta: { requestId: crypto.randomUUID(), expected: [{ ref: view.roundRef, revision: view.roundRevision ?? 0 }] },
      });
      value = committedRouteValue<unknown>(reply, 'verification/reverify');
    } catch (error) {
      throw new Error(reworkWriteTextOf(error));
    }
    if (asText(asRecord(value).kind) === 'refused') {
      throw new Error(reworkRefusalTextOf('reverify', asRecord(value).refusal,
        decideTaskRowOf(card)?.rework ?? null));
    }
    await refresh.reread();
  }

  /** The one unknown-call-review write; `input` adds the route's own fields.
   *  Chain publishes its review on `latestChain`, every other board on `latestLine`. */
  async function writeReview(route: string, input: Record<string, unknown>): Promise<void> {
    const basis = boardName === 'Chain'
      ? (latestChain !== null && latestChainScope !== null && latestChain.bar.review !== null
        ? { scope: latestChainScope, review: latestChain.bar.review } : null)
      : (latestLine !== null && latestLine.review !== null
        ? { scope: latestLine.scope, review: latestLine.review } : null);
    if (basis === null) throw new Error(reviewWriteTextOf(new Error('no review')));
    try {
      committedRouteValue(await client.write(route, basis.scope, {
        input: { reviewRef: basis.review.ref, ...input },
        meta: { requestId: crypto.randomUUID(), expected: [{ ref: basis.review.ref, revision: basis.review.revision }] },
      }), route);
    } catch (error) {
      logReadError(error);
      throw new Error(reviewWriteTextOf(error));
    }
    await refresh.reread();
  }

  const actions: BoardActions = {
    readMore(next: BoardReadDemand): void {
      /* Explicit fields replace the old demand, including `false`/`null`, so a
       * closed view can withdraw its read instead of sticking forever. Closing
       * a detail only withdraws its note anchor; the closed detail shows no
       * note, so that withdrawal reads nothing (E3A-15). */
      Object.assign(demand, next);
      /* Closing a detail only withdraws its one-shot read; the closed detail
         shows no note or Run hosts, so the withdrawal reads nothing. */
      if (Object.keys(next).length === 1 && (next.noteAnchor === null || next.memberRunHosts === null)) return;
      void refresh.reread();
    },
    async checkSemanticLinks(items: Array<{ noteId: string; version: number }>): Promise<{ removed: boolean }> {
      const data = latestArch;
      if (data === null) return { removed: false };
      let removed = false;
      try {
        const reply = readyRouteValue<{ items: Array<{ noteId: string; version: number; verification: unknown | null }> }>(
          await client.post('architecture/semantic-links/check', data.scope, { items }),
          'architecture/semantic-links/check');
        removed = reply.items.some((item) => item.verification === null);
      } catch (error) {
        logReadError(error);
        const code = error instanceof RouteReadError
          ? (error.code === 'not_found' ? 'not_found' : 'other') : 'network';
        const text = code === 'not_found' ? SEMANTIC_CHECK_FAIL_WORD.not_found
          : code === 'other' ? SEMANTIC_CHECK_FAIL_WORD.other : SEMANTIC_CHECK_FAIL_WORD.network;
        /* The page suppresses 重新核对 on a stale/not_found answer (item 3); the code is the
           action's public contract, the words stay the page's. */
        throw Object.assign(new Error(text), { code: code });
      }
      await refresh.reread();
      return { removed };
    },
    async readRunSteps(key: string): Promise<void> {
      const cached = pageRunSteps.get(key);
      if (cached === undefined || cached.next === null) return;
      try {
        await readRunStepsPage(client, cached.scope, cached.ref, cached.next);
      } catch (error) {
        logReadError(error);
        return;
      }
      await refresh.reread();
    },
    runOpen(key: string, open: boolean): void {
      if (open) openLiveRunKeys.add(key);
      else openLiveRunKeys.delete(key);
      scheduleLiveRunTimer();
    },
    async pinLine(key: TaskMapSessionRef, pinned: boolean): Promise<void> {
      try {
        const found = await taskMapScope(client, (await client.bootstrap()).workspaces, goalId);
        if (found === null) throw new Error('找不到工作区。');
        await pinTaskMapLine(client, found.scope, key, pinned);
      } catch (error) {
        throw new Error(writeTextOf(error));
      }
      await refresh.reread();
    },
    pickGoal(next: string): void {
      /* §2.9: the same refresh loop rereads the chrome for the new Goal; the
       * URL is not rewritten and no draft table is built. The two cross-page
       * links move with the pick at once; a failed reread falls back to the
       * URL Goal through `defaults`. */
      goalId = next === '' ? null : next;
      if (lastResume !== null && lastResume.goalId !== goalId) lastResume = null;
      demand.lineKey = null;
      demand.archive = false;
      /* §2.3: a Goal pick goes back to the conversation's first page. */
      demand.mainPages = 1;
      if (boardName === 'Main') demand.mapGoal = null;
      view.updateProps({
        ...view.instance.props,
        mainHref: goalHref('Main.dc.html', goalId),
        taskMapHref: goalHref('TaskMap.dc.html', goalId),
      });
      void refresh.reread();
    },
    openLine(key: TaskMapSessionRef | null): void {
      /* B6: an open Run detail belongs to the old line. Switching the rail line
         withdraws its host read, so the next page read does not re-ask the old
         Run's network record. */
      demand.memberRunHosts = null;
      demand.lineKey = key;
      void refresh.reread();
    },
    notConnected: guardNotConnected,
    notConnectedAttrs: () => notConnectedAttrs(),
    async controlGoal(control: 'pause' | 'resume' | 'cancel'): Promise<GoalControlReportLine[]> {
      const data = latest;
      if (data === null || data.scope === null || data.selectedGoalId === null
        || data.selectedGoalRevision === null || data.phaseRevision === null) {
        throw new Error('goals/control needs the shown Goal and its GoalPhase revision');
      }
      const scope = data.scope;
      const goalRef = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId: data.selectedGoalId };
      const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: scope.projectId, goalId: data.selectedGoalId };
      const requestId = crypto.randomUUID();
      const expected = [
        { ref: goalRef, revision: data.selectedGoalRevision },
        { ref: phaseRef, revision: data.phaseRevision },
      ];
      let outcome: GoalControlOutcomeReadV1;
      try {
        outcome = committedRouteValue<GoalControlOutcomeReadV1>(await client.write('goals/control', scope, {
          input: { goalRef, control, reason: null },
          meta: { requestId, expected },
        }), 'goals/control');
      } catch (error) {
        logReadError(error);
        /* 5.5-11: a conflict rereads before the page offers the same click again. */
        if (error instanceof RouteReadError && error.code === 'revision_conflict') await refresh.reread();
        throw new Error(goalControlTextOf(error));
      }
      /* 5.5-2: only a resume's receipt carries an intentRef per Run; it is the
       * one control whose "已进入" the Host can answer. */
      const entered = control === 'resume'
        ? await readEnteredResumes(client, scope, outcome)
        : new Map<string, ControlIntentSnapshotV1>();
      if (control === 'resume') lastResume = { goalId: goalRef.goalId, scope, goalRef, requestId, expected };
      const fanOut = outcome.fanOut;
      if ((fanOut.problem ?? '') !== '') logReadError(new Error(fanOut.problem!));
      /* 5.5-2/5.6-6: each skipped/failed/refused reason is raw and stays in the log. */
      for (const run of fanOut.runs) {
        if ((run.outcome === 'skipped' || run.outcome === 'failed') && (run.reason ?? '') !== '') {
          logReadError(new Error(run.reason!));
        }
      }
      for (const continuation of fanOut.continuations ?? []) {
        if ((continuation.outcome === 'refused' || continuation.outcome === 'failed')
          && (continuation.reason ?? '') !== '') logReadError(new Error(continuation.reason!));
      }
      const lines = goalControlReportOf(outcome, control, data.tasks, entered);
      await refresh.reread();
      return lines;
    },
    async retryResume(): Promise<void> {
      const saved = lastResume;
      if (saved === null) return;
      try {
        committedRouteValue(await client.write('goals/control', saved.scope, {
          input: { goalRef: saved.goalRef, control: 'resume', reason: null },
          meta: { requestId: saved.requestId, expected: saved.expected },
        }), 'goals/control');
      } catch (error) {
        logReadError(error);
        throw new Error(goalControlTextOf(error));
      }
      await refresh.reread();
    },
    async ackDelivery(): Promise<void> {
      const data = latestDelivery;
      if (data === null) throw new Error(writeTextOf(new Error('no delivery')));
      const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: data.scope.projectId, goalId: data.goalRef.goalId };
      try {
        /* K3/ACC-02: exactly the Goal and GoalPhase pins the delivery read showed. */
        const reply = await client.write('goals/accept-delivery', data.scope, {
          input: { goalRef: data.goalRef },
          meta: {
            requestId: crypto.randomUUID(),
            expected: [
              { ref: data.goalRef, revision: data.goalRevision },
              { ref: phaseRef, revision: data.phaseRevision },
            ],
          },
        });
        committedRouteValue(reply, 'goals/accept-delivery');
      } catch (error) {
        throw new Error(deliveryWriteTextOf(error));
      }
      await refresh.reread();
    },
    async reviewDelivery(): Promise<{ href: string }> {
      const data = latestDelivery;
      if (data === null || data.secretary === null) {
        throw new Error(writeTextOf(new Error('no secretary')));
      }
      /* K4/ruling 4: the secretary is the workspace's one line and `queries/ask`
         carries no Goal, so the question names the Goal and its number. */
      const target = data.goalOrdinal === null
        ? '目标「' + data.goalName + '」'
        : '目标 ' + String(data.goalOrdinal) + '「' + data.goalName + '」';
      const question = '请审查' + target + '的交付：实现、改动和规格是否一致，行为有没有偏离。';
      let reply: RouteReply;
      try {
        reply = await client.post('queries/ask', data.scope, {
          sessionRef: data.secretary, question, commandId: crypto.randomUUID(),
        });
      } catch (error) {
        throw new Error(deliveryWriteTextOf(error));
      }
      if (reply.status !== 'queued') {
        throw new Error(deliveryWriteTextOf(new RouteReadError('queries/ask',
          reply.code || reply.status || 'no status', reply.reason ?? '')));
      }
      await refresh.reread();
      return { href: lineHref('Member.dc.html', data.goalRef.goalId, data.secretary) };
    },
    async reportDeliveryProblem(text: string): Promise<void> {
      const data = latestDelivery;
      if (data === null || data.secretary === null) {
        throw new Error(writeTextOf(new Error('no secretary')));
      }
      let reply: RouteReply;
      try {
        /* K5/ACC-11: the person's own intervention entry needs the Goal on a
           completed delivery; the Host then opens the follow-up request. */
        reply = await client.write('messages/send', data.scope, {
          input: {
            recipient: data.secretary, goalRef: data.goalRef, needsReply: true,
            entry: 'person_intervention', text,
          },
          meta: { requestId: crypto.randomUUID(), expected: [] },
        });
        committedRouteValue(reply, 'messages/send');
      } catch (error) {
        throw new Error(deliveryWriteTextOf(error));
      }
      const result = asRecord(reply);
      if (result.sendStatus !== 'sent' && result.sendStatus !== 'awaiting_release') {
        throw new Error(deliveryWriteTextOf(new Error('messages/send did not send')));
      }
      await refresh.reread();
    },
    async reorderGoal(goalId: string, direction: 'up' | 'down'): Promise<void> {
      const data = latestGoals;
      const scope = latestGoalsScope;
      if (data === null || scope === null) throw new Error(writeTextOf(new Error('no Goals data')));
      const goals = data.goals;
      const from = goals.findIndex((goal) => goal.id === goalId);
      const to = from + (direction === 'up' ? -1 : 1);
      /* Already first/last (or not in the published list): no request at all. */
      if (from < 0 || to < 0 || to >= goals.length) return;
      const next = goals.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      try {
        const reply = await client.write('goals/reorder', scope, {
          input: { workspace: scope, goalOrder: next.map((goal) => goal.ref) },
          meta: {
            requestId: crypto.randomUUID(),
            expected: next.map((goal) => ({ ref: goal.ref, revision: goal.revision })),
          },
        });
        committedRouteValue(reply, 'goals/reorder');
      } catch (error) {
        throw new Error(writeTextOf(error));
      }
      await refresh.reread();
    },
    async readCopyDraft(goalId: string): Promise<MainCopyDraft> {
      const scope = latestNavScope;
      const nav = latest;
      if (scope === null || nav === null) throw new Error(writeTextOf(new Error('no navigation scope')));
      const goalRef = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId };
      let draft: GoalCopyDraftResultV1;
      try {
        draft = readyRouteValue<GoalCopyDraftResultV1>(
          await client.post('goals/copy-draft', scope, { goalRef }), 'goals/copy-draft');
      } catch (error) {
        logReadError(error);
        throw new Error(writeTextOf(error));
      }
      /* D49-13: each candidate's body is read once; a failed one is that row's
       * fixed sentence, never a failed dialog. */
      const bodies: Record<string, string> = {};
      if (draft.interventions.available) {
        for (const candidate of draft.interventions.candidates) {
          const key = messageBodyKey(candidate.messageRef, 'message');
          try {
            bodies[key] = readyRouteValue<MessageBody>(
              await client.post('messages/body', scope, { messageRef: candidate.messageRef, part: 'message' }),
              'messages/body').text;
          } catch (error) {
            logReadError(error);
            bodies[key] = '这条消息暂时读不到';
          }
        }
      }
      return copyDraftOf(draft, bodies, nav);
    },
    async confirmCopy(draft: MainCopyDraft, selected: readonly SessionMessageRef[]): Promise<GoalControlReportLine[]> {
      const scope = latestNavScope;
      if (scope === null) throw new Error(writeTextOf(new Error('no navigation scope')));
      const sourceGoalRef = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId: draft.goalId };
      let result: GoalCopyConfirmResultV1;
      try {
        result = committedRouteValue<GoalCopyConfirmResultV1>(
          await client.post('goals/copy-confirm', scope, {
            commandId: crypto.randomUUID(),
            sourceGoalRef,
            expectedSourceRevision: draft.sourceRevision,
            selectedInterventions: selected,
          }), 'goals/copy-confirm');
      } catch (error) {
        logReadError(error);
        /* A conflict is the Goal's own revision moving; reread the draft's
         * source and ask for the click again instead of reusing the old one. */
        if (error instanceof RouteReadError && error.code === 'revision_conflict') {
          await refresh.reread();
          throw Object.assign(new Error('原目标刚变过，已重新读取，请再确认一次。'), { rereadCopy: true });
        }
        throw new Error(writeTextOf(error));
      }
      await refresh.reread();
      return copyReportOf(result);
    },
    async confirmGoalDraft(round: QueryJobRef, index: number): Promise<void> {
      const scope = latestNavScope;
      if (scope === null) throw new Error(writeTextOf(new Error('no navigation scope')));
      try {
        committedRouteValue(await client.post('goals/confirm-draft', scope, {
          commandId: crypto.randomUUID(), round, index,
        }), 'goals/confirm-draft');
      } catch (error) {
        throw new Error(writeTextOf(error));
      }
      /* §2.7: the view stays where it is; the reread finds the confirmed row. */
      await refresh.reread();
    },
    async selectIdea(round: QueryJobRef, index: number): Promise<void> {
      const scope = latestNavScope;
      if (scope === null) throw new Error(writeTextOf(new Error('no navigation scope')));
      try {
        const reply = await client.post('requests/select-idea', scope, {
          commandId: crypto.randomUUID(), round, index,
        });
        if (reply.status !== 'queued') {
          throw new RouteReadError('requests/select-idea',
            reply.code || reply.status || 'no status', reply.reason ?? '');
        }
      } catch (error) {
        throw new Error(writeTextOf(error));
      }
      await refresh.reread();
    },
    async adoptPlan(proposal: PlanProposalShape): Promise<void> {
      const data = latest;
      const scope = latestNavScope;
      if (data === null || scope === null || data.selectedGoalId === null
        || data.selectedGoalRevision === null) {
        throw new Error(writeTextOf(new Error('plans/apply needs the shown Goal')));
      }
      const goalRef = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId: data.selectedGoalId };
      try {
        committedRouteValue(await client.write('plans/apply', scope, {
          input: { proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [] },
          meta: {
            requestId: crypto.randomUUID(),
            expected: [{ ref: goalRef, revision: data.selectedGoalRevision }],
          },
        }), 'plans/apply');
        /* The shown candidate's own draft is what the adopted version carries;
           the next readPlan draws it as the read-only 已采用 card (prototype
           `Plan.dc.html:4506`), checks included. */
        pageAdoptedPlans?.pending.set(data.selectedGoalId, proposal);
      } catch (error) {
        /* P2 (DPS-1): the Host is stopping the affected work and will adopt
           again by itself once it has stopped; the person clicks once. This is
           not a failure, so no error reaches the page. */
        if (error instanceof RouteReadError && error.code === 'busy'
          && error.reason === 'stopping_affected_work') {
          pendingAdoption = { goalId: data.selectedGoalId, proposal };
          await refresh.reread();
          return;
        }
        /* §2.3: a revision conflict is shown and the page rereads; `busy` keeps
           its one-click retry text and does not reread. The stop behind `busy`
           still reaches the page as rereads, so that error carries `keep`: the
           page keeps its text until the next 采用 or 发送 (STK15 P1). */
        if (error instanceof RouteReadError && error.code === 'revision_conflict') {
          await refresh.reread();
        }
        const shown = new Error(planWriteTextOf(error));
        throw error instanceof RouteReadError && error.code === 'busy' ? Object.assign(shown, { keep: true }) : shown;
      }
      await refresh.reread();
    },
    async askPlanChange(text: string,
      target: { round: QueryJobRef; proposalRef: PlanProposalRef; revision: number }):
      Promise<{ root: string; input: string; answer: string | null } | null> {
      const scope = latestNavScope;
      const plan = (latest as PlanData | null)?.plan ?? null;
      if (scope === null || plan === null) throw new Error(writeTextOf(new Error('no navigation scope')));
      /* `target.round` is the request's last answered round; `requests/read`
         needs the request root the page read, not that round. */
      const result = await askAndRead(scope, target.round, plan.requestRoot,
        [{ ref: target.proposalRef, revision: target.revision }], true, text, null);
      await refresh.reread();
      return result;
    },
    async answerConflict(cardKey: string, optionId: 'wait' | 'order' | 'parallel'): Promise<void> {
      const data = latestGoals;
      const scope = latestGoalsScope;
      if (data === null || scope === null) throw new Error(writeTextOf(new Error('no Goals data')));
      const conflict = data.conflict;
      if (conflict === null || conflict.cardKey !== cardKey) {
        throw new Error(writeTextOf(new Error('the shown conflict card is gone')));
      }
      const goalOf = (id: string) => data.goals.find((goal) => goal.id === id);
      const earlier = goalOf(conflict.earlierId);
      const later = goalOf(conflict.laterId);
      if (earlier === undefined || later === undefined) {
        throw new Error(writeTextOf(new Error('the conflict Goals are not in the list')));
      }
      const selection = optionId === 'wait'
        ? { kind: 'conflict_wait' as const, earlier: earlier.ref, later: later.ref }
        : optionId === 'parallel'
          ? { kind: 'conflict_parallel' as const, earlier: earlier.ref, later: later.ref }
          : {
            kind: 'conflict_order' as const,
            /* `later` moves in front of `earlier`; every other Goal keeps its
               relative order. */
            goalOrder: (() => {
              const order = data.goals.map((goal) => goal.id).filter((id) => id !== conflict.laterId);
              const at = order.indexOf(conflict.earlierId);
              order.splice(at < 0 ? 0 : at, 0, conflict.laterId);
              return order.map((id) => goalOf(id)!.ref);
            })(),
          };
      /* The answer command's pins are the card's captured source pins, exactly:
         a conflict card also pins the two Plan revisions, not only the Goals
         and the earlier GoalPhase. */
      const sourcePins = asRecord(conflict.source).pins;
      const expected: Array<{ ref: unknown; revision: number }> = Array.isArray(sourcePins)
        ? sourcePins as Array<{ ref: unknown; revision: number }>
        : [
          { ref: earlier.ref, revision: earlier.revision },
          { ref: later.ref, revision: later.revision },
        ];
      if (!Array.isArray(sourcePins) && optionId === 'wait') {
        expected.push({
          ref: { aggregateType: 'GoalPhase' as const, projectId: scope.projectId, goalId: conflict.earlierId },
          revision: conflict.earlierPhaseRevision,
        });
      }
      try {
        const reply = await client.write('decisions/answer', scope, {
          input: { source: conflict.source, selection, text: '', annotations: [] },
          meta: { requestId: crypto.randomUUID(), expected },
        });
        /* `decisions/answer` answers a read of the resolved decision: the
           commit is the nested `answer` receipt, not the top-level status. */
        const receipt = reply.status === 'ready' ? asRecord(asRecord(reply.value).answer) : null;
        if (reply.status !== 'committed' && receipt?.status !== 'committed') {
          throw new RouteReadError('decisions/answer', reply.code || reply.status || 'no status', reply.reason ?? '');
        }
      } catch (error) {
        throw new Error(writeTextOf(error));
      }
      await refresh.reread();
    },
    async askSecretary(
      text: string,
      reference: RequestReferenceInputV1 | readonly RequestReferenceInputV1[] | null,
      options: { continues?: QueryJobRef | null } = {},
    ): Promise<{ root: string; input: string; answer: string | null } | null> {
      const scope = latestNavScope;
      if (scope === null) throw new Error(writeTextOf(new Error('no navigation scope')));
      const references: RequestReferenceInputV1[] = reference === null ? []
        : Array.isArray(reference) ? [...reference] : [reference as RequestReferenceInputV1];
      /* A request that continues a goal-card draft's request is Goal-less: the
         Host takes its Goal from the continued round (qc 11). */
      const continues = options.continues ?? null;
      let reply: RouteReply;
      try {
        reply = await client.post('requests/submit', scope, {
          commandId: crypto.randomUUID(),
          goalId: continues === null ? latestSelectedGoalId : null,
          text,
          continues,
          recipient: null,
          references,
        });
      } catch (error) {
        throw new Error(writeTextOf(error));
      }
      if (reply.status !== 'queued') {
        throw new Error(writeTextOf(new RouteReadError('requests/submit',
          reply.code || reply.status || 'no status', reply.reason ?? '')));
      }
      const requestRoot = asRecord(reply).requestRoot;
      if (requestRoot === null || requestRoot === undefined) return null;
      let answer: string | null = null;
      try {
        const read = readyRouteValue<unknown>(
          await client.post('requests/read', scope, { requestRoot }), 'requests/read',
        );
        const rounds = asRecord(read).rounds;
        if (Array.isArray(rounds)) {
          for (let index = rounds.length - 1; index >= 0; index -= 1) {
            const value = asText(asRecord(rounds[index]).answer);
            if (value !== '') { answer = value; break; }
          }
        }
      } catch {
        /* The submit stands; a failed read only means no answer to append yet. */
        answer = null;
      }
      return { root: requestRootKey(requestRoot as QueryJobRef), input: text, answer };
    },
    async answerCard(cardKey: string, optionId: string | null, text = '',
      annotations: readonly { objectKey: string; text: string }[] = []): Promise<ApplicationRetry | void> {
      const card = decideCardOf(cardKey);
      const scope = latestDecideScope;
      if (card === null || scope === null) throw new Error(cardWriteTextOf(new Error('the shown card is gone')));
      const pins = Array.isArray(card.source.pins) ? card.source.pins : [];
      let selection: unknown;
      if (card.source.kind === 'goal_conflict' && optionId !== null && optionId !== 'repropose') {
        const ids = pinsFor(card, 'Goal').map((pin) => asText(asRecord(pin.ref).goalId)).filter((id) => id !== '');
        const goals = (latestDecide?.nav.goals ?? []).map((goal) => ({
          ref: { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId: goal.goalId }, order: goal.order,
        }));
        ids.sort((a, b) => (goals.find((goal) => goal.ref.goalId === a)?.order ?? 0)
          - (goals.find((goal) => goal.ref.goalId === b)?.order ?? 0));
        if (ids.length < 2) throw new Error(cardWriteTextOf(new Error('the conflict Goals are not in the list')));
        selection = conflictSelectionOf(optionId,
          { ref: { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId: ids[0]! } },
          { ref: { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId: ids[1]! } }, goals);
      } else if (optionId === null) {
        selection = { kind: 'other' as const };
      } else {
        selection = optionId === null ? { kind: 'other' as const } : { kind: 'option' as const, optionId };
      }
      return sendCardAnswer(cardKey, scope, {
        input: { source: card.source, selection, text, annotations: [...annotations] },
        meta: { requestId: crypto.randomUUID(), expected: pins },
      });
    },
    async writeCandidate(cardKey, action) {
      const card = decideCardOf(cardKey);
      const scope = latestDecideScope;
      if (card?.source.kind !== 'candidate' || scope === null || !card.actions.includes(action)) {
        throw new Error('这份候选已经变了，请重新查看。');
      }
      const proposal = pinsFor(card, 'PlanProposal')[0]!;
      const goal = pinsFor(card, 'Goal')[0]!;
      const route = action === 'adopt' ? 'plans/apply' : 'plans/abandon';
      try {
        committedRouteValue(await client.write(route, scope, {
          input: action === 'adopt'
            ? { proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [] }
            : { proposalRef: proposal.ref },
          meta: { requestId: crypto.randomUUID(), expected: action === 'adopt' ? [goal] : [proposal, goal] },
        }), route);
      } catch (error) {
        logReadError(error);
        if (error instanceof RouteReadError && (error.code === 'revision_conflict' || error.code === 'source_stale')) {
          await refresh.reread();
          if (error.code === 'source_stale') {
            throw new Error('这份候选已经过期（来源撤回或计划已变），页面已重新读取。');
          }
        }
        throw new Error(planWriteTextOf(error));
      }
      await refresh.reread();
    },
    async recoverKnowledge(itemKey: string, itemNo: number): Promise<void> {
      const row = decideRowOf(itemKey);
      const scope = latestDecideScope;
      if (row === null || row.notice === null || scope === null) {
        throw new Error(writeTextOf(new Error('the shown notice is gone')));
      }
      /* X9: the notice's id is the queue item key without its `project_notice:` prefix
         (project-notice-notices.ts:87); no second read of the queue is made here. */
      const prefix = 'project_notice:';
      const noticeId = row.key.startsWith(prefix) ? row.key.slice(prefix.length) : '';
      if (noticeId === '') throw new Error(writeTextOf(new Error('this notice names no project notice')));
      try {
        const reply = await client.post('knowledge/recover', scope, { noticeId, itemNo });
        committedRouteValue(reply, 'knowledge/recover');
      } catch (error) {
        throw new Error(knowledgeWriteTextOf(error));
      }
      await refresh.reread();
    },
    async stopExploration(projectId: string, workspaceId: string): Promise<void> {
      const row = latestArch?.explore.find((entry) => entry.projectId === projectId
        && entry.workspaceId === workspaceId && entry.action === 'stop') ?? null;
      const scope = archRowScope(row);
      try {
        const reply = await client.write('workspaces/exploration/stop', scope, {
          input: { workspace: scope },
          /* The owner checks the person, not a version; the route requires `expected` to be an
             array, and the stop write carries no pins. */
          meta: { requestId: crypto.randomUUID(), expected: [] },
        });
        committedRouteValue(reply, 'workspaces/exploration/stop');
      } catch (error) {
        throw new Error(knowledgeWriteTextOf(error));
      }
      await refresh.reread();
    },
    async continueExploration(projectId: string, workspaceId: string): Promise<void> {
      const row = latestArch?.explore.find((entry) => entry.projectId === projectId
        && entry.workspaceId === workspaceId && entry.action === 'continue') ?? null;
      const scope = archRowScope(row);
      try {
        const reply = await client.write('workspaces/exploration/continue', scope, {
          input: { workspace: scope },
          meta: { requestId: crypto.randomUUID(), expected: [] },
        });
        committedRouteValue(reply, 'workspaces/exploration/continue');
      } catch (error) {
        throw new Error(knowledgeWriteTextOf(error));
      }
      await refresh.reread();
    },
    async deepenBlock(projectId: string, workspaceId: string, moduleId: string): Promise<void> {
      const row = latestArch?.deepen.find((entry) => entry.projectId === projectId
        && entry.workspaceId === workspaceId && entry.moduleId === moduleId && !entry.deepening) ?? null;
      const scope = archRowScope(row);
      try {
        const reply = await client.write('workspaces/exploration/deepen', scope, {
          input: { workspace: scope, module: { projectId: scope.projectId, moduleId } },
          meta: { requestId: crypto.randomUUID(), expected: [] },
        });
        committedRouteValue(reply, 'workspaces/exploration/deepen');
      } catch (error) {
        throw new Error(knowledgeWriteTextOf(error));
      }
      await refresh.reread();
    },
    async commitKnowledge(projectId: string, workspaceId: string, message: string | null): Promise<void> {
      const row = latestArch?.commitBars.find((entry) => entry.projectId === projectId
        && entry.workspaceId === workspaceId) ?? null;
      const scope = archRowScope(row);
      try {
        const reply = await client.post('knowledge/commit', scope, { message });
        /* `knowledge/commit` writes no record: its one success status is `ready`. */
        readyRouteValue<KnowledgeCommitResult>(reply, 'knowledge/commit');
      } catch (error) {
        throw new Error(knowledgeWriteTextOf(error));
      }
      await refresh.reread();
    },
    async requeueCard(cardKey: string,
      input: { reason: string; budget: string | null; note?: string | null }): Promise<void> {
      const card = decideCardOf(cardKey);
      const scope = latestDecideScope;
      /* D6: the Goal-level interruption card's 继续 starts the Goal's driver
         (`workflow/driver-start`, decision 97-9), not `tasks/requeue`. */
      const interrupted = card !== null && card.source.kind === 'goal_cause'
        && asText(asRecord(card.source).key).includes('interrupted_pending_resume');
      if (interrupted && card !== null && scope !== null) {
        const goalId = asText(asRecord(pinsFor(card, 'Goal')[0]?.ref).goalId);
        if (goalId === '') throw new Error(cardWriteTextOf(new Error('this interruption names no Goal')));
        try {
          const reply = await client.post('workflow/driver-start', scope, {
            advance: { schemaVersion: 1, goalRef: { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId },
              flowId: 'decide-continue:' + goalId, sessionHint: null, kind: 'select_work' },
            queryProfileIds: [],
          });
          readyRouteValue(reply, 'workflow/driver-start');
        } catch (error) {
          throw new Error(reworkWriteTextOf(error));
        }
        await refresh.reread();
        return;
      }
      const triple = card === null ? null : taskTripleOf(card);
      if (card === null || scope === null || triple === null || card.runRef === null) {
        throw new Error(reworkWriteTextOf(new Error('this card has no Task and Run to requeue')));
      }
      const expected = [...pinsFor(card, 'Goal'), ...pinsFor(card, 'Run')];
      const budget = input.budget === null ? null : budgetTokensOf(input.budget);
      if (input.budget !== null && budget === null) {
        throw new Error(reworkWriteTextOf(new RouteReadError('tasks/requeue', 'invalid', 'bad budget')));
      }
      const note = typeof input.note === 'string' && input.note.trim() !== '' ? input.note : null;
      let value: unknown;
      try {
        const reply = await client.write('tasks/requeue', scope, {
          input: { taskRef: triple, afterRunRef: card.runRef, reason: input.reason,
            ...(budget === null ? {} : { budget }), ...(note === null ? {} : { note }) },
          meta: { requestId: crypto.randomUUID(), expected },
        });
        if (reply.status === 'needs_decision' || asText(asRecord(reply.value).status) === 'needs_decision') {
          await refresh.reread();
          return;
        }
        value = committedRouteValue<unknown>(reply, 'tasks/requeue');
      } catch (error) {
        throw new Error(reworkWriteTextOf(error));
      }
      if (asText(asRecord(value).kind) === 'refused') {
        throw new Error(reworkRefusalTextOf('requeue', asRecord(value).refusal, decideTaskRowOf(card)?.rework ?? null));
      }
      await refresh.reread();
    },
    async reverifyCard(cardKey: string, note: string | null): Promise<void> {
      await reverifyWrite(cardKey, note);
    },
    async withdrawAndReverify(cardKey: string): Promise<void> {
      const row = decideRowOf(cardKey);
      const card = row?.card ?? null;
      const view = row?.view ?? null;
      const scope = latestDecideScope;
      if (card === null || view === null || scope === null || view.roundRef === null) {
        throw new Error(reworkWriteTextOf(new Error('this card has no head round to reverify')));
      }
      for (const check of view.withdraw) {
        try {
          await saveSettings(client, 'checks/withdraw', { scope, checkId: check.checkId }, scope.projectId);
        } catch (error) {
          /* E3 :498: a check already gone from the settings does not stop the
             rest; the person replaced the whole list in between. */
          if (error instanceof RouteReadError && error.code === 'not_found') continue;
          if (error instanceof SettingsNotEffectiveError) {
            throw new Error('撤回已保存，Host 还没确认，所以没有重新检查。再点一次“撤回并重新检查”。');
          }
          const text = settingsWriteTextOf('checks/withdraw', error);
          if (text === null) logReadError(error);
          throw new Error(text ?? '撤回没有成功，可以重试。');
        }
      }
      /* The settings route carries no requestId; a repeat answers `ready`, so a
         second click is safe. Withdrawing changed the configuration, so the
         reverify carries no note. */
      await reverifyWrite(cardKey, null);
    },
    async attestCard(cardKey: string, reason: string): Promise<void> {
      const card = decideCardOf(cardKey);
      const scope = latestDecideScope;
      if (card === null || scope === null || card.runRef === null) {
        throw new Error(writeTextOf(new Error('this card has no Run to resolve')));
      }
      try {
        const reply = await client.write('executions/resolve-unknown', scope, {
          input: { runRef: card.runRef, reason },
          meta: { requestId: crypto.randomUUID(), expected: pinsFor(card, 'Run') },
        });
        committedRouteValue(reply, 'executions/resolve-unknown');
      } catch (error) {
        throw new Error(attestWriteTextOf(error));
      }
      await refresh.reread();
    },
    async attestLine(reason: string): Promise<void> {
      const data = latestLine;
      const attest = data?.line.attest ?? null;
      if (data === null || attest === null) throw new Error(writeTextOf(new Error('this line has no unknown result to attest')));
      const target = attest.target;
      const input = target.queryRunRef !== undefined ? { queryRunRef: target.queryRunRef, reason }
        : target.runRef !== undefined ? { runRef: target.runRef, reason } : null;
      if (input === null) throw new Error(writeTextOf(new Error('this attestation names no Run')));
      try {
        committedRouteValue(await client.write(attest.route, data.scope, {
          input, meta: { requestId: crypto.randomUUID(), expected: attest.pins },
        }), attest.route);
      } catch (error) {
        throw new Error(attestWriteTextOf(error));
      }
      await refresh.reread();
    },
    async changeDisposition(cardKey: string, disposition: 'active' | 'deferred' | 'cancelled', note = ''): Promise<void> {
      const card = decideCardOf(cardKey);
      const scope = latestDecideScope;
      const triple = card === null ? null : taskTripleOf(card);
      if (card === null || scope === null || triple === null) {
        throw new Error(writeTextOf(new Error('this card has no Task to change')));
      }
      const goalId = triple.goalId;
      const plan = latestDecide?.plans[goalId];
      const goal = latestDecide?.nav.goals.find((entry) => entry.goalId === goalId) ?? null;
      if (plan === undefined || goal === null) {
        throw new Error(writeTextOf(new Error('the Goal plan is not read')));
      }
      const goalRef = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId };
      await writeDisposition(scope, goalRef, goal.revision, plan, triple.taskId, disposition, note);
    },
    async addRepairTask(cardKey: string, input: { name: string; checkIds: string[]; note?: string }): Promise<void> {
      const row = decideRowOf(cardKey);
      const view = row?.view ?? null;
      const card = row?.card ?? null;
      const scope = latestDecideScope;
      const triple = card === null ? null : taskTripleOf(card);
      if (card === null || view === null || scope === null || triple === null) {
        throw new Error(writeTextOf(new Error('this card has no repair task to add')));
      }
      const goalId = triple.goalId;
      const plan = latestDecide?.plans[goalId];
      const goal = latestDecide?.nav.goals.find((entry) => entry.goalId === goalId) ?? null;
      if (plan === undefined || goal === null || view.fixRole === null || view.ownerTaskId === '') {
        throw new Error(writeTextOf(new Error('no public assignment role for the failed task')));
      }
      const taskId = 'fix-' + crypto.randomUUID();
      const note = input.note?.trim();
      const instruction = input.name + '：让失败的检查 ' + input.checkIds.join('、') + ' 通过' + (note ? '。' + note : '');
      const sources = input.checkIds
        .map((checkId) => view.checks.find((check) => check.checkId === checkId)?.reportRef ?? null)
        .filter((ref) => ref !== null);
      const goalRef = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId };
      await writePlanChange(scope, goalRef, goal.revision, plan, {
        planId: crypto.randomUUID(),
        repair: { taskId, name: input.name, role: view.fixRole, instruction, failureTaskId: view.ownerTaskId },
        text: instruction, reason: { text: instruction, sources },
      });
    },
    async markNoticeSeen(itemKey: string): Promise<void> {
      const row = decideRowOf(itemKey);
      const data = latestDecide;
      const scope = latestDecideScope;
      if (row === null || row.noticeWindow === null || data === null || scope === null
        || row.noticeWindow.displayToken === null) {
        throw new Error(writeTextOf(new Error('this notice has no page token to mark')));
      }
      const workspace = { aggregateType: 'Workspace' as const, projectId: scope.projectId, workspaceId: scope.workspaceId };
      try {
        const reply = await client.write('decisions/notices/seen', scope, {
          input: { workspace: scope, displayToken: row.noticeWindow.displayToken,
            seenThrough: row.noticeWindow.seenThrough },
          meta: { requestId: crypto.randomUUID(), expected: [{ ref: workspace, revision: data.workspaceRevision }] },
        });
        committedRouteValue(reply, 'decisions/notices/seen');
      } catch (error) {
        throw new Error(cardWriteTextOf(error));
      }
      await refresh.reread();
    },
    async withdrawCheck(scope: { projectId: string; workspaceId: string }, checkId: string): Promise<void> {
      try {
        await saveSettings(client, 'checks/withdraw', { scope, checkId }, scope.projectId);
      } catch (error) {
        if (error instanceof SettingsNotEffectiveError) {
          throw new Error('撤回已保存，Host 还没确认，可以重试');
        }
        const text = settingsWriteTextOf('checks/withdraw', error);
        if (text === null) {
          logReadError(error);
          throw new Error('没有撤回成功，可以重试');
        }
        throw new Error(text);
      }
      await refresh.reread();
    },
    async askCard(cardKey: string, text: string): Promise<{ root: string; input: string; answer: string | null } | null> {
      const card = decideCardOf(cardKey);
      const scope = latestDecideScope;
      if (card === null || scope === null) throw new Error(writeTextOf(new Error('the shown card is gone')));
      const goalId = subjectGoalId(card.subject) ?? latestDecide?.nav.selectedGoalId ?? null;
      return askAndRead(scope, card.requestRef, card.requestRef, card.source.pins, false, text, goalId);
    },
    async controlLine(kind: 'pause' | 'resume' | 'cancel'): Promise<void> {
      const data = latestLine;
      const line = data?.line ?? null;
      if (data === null || line === null) throw new Error(writeTextOf(new Error('no line')));
      const control = line.controls.find((entry) => entry.kind === kind && entry.availability === 'available') ?? null;
      /* S3: a paused-interrupted Task has no `resume`; its 继续 is the Task's
         own `continue` control (tasks/requeue, a new Run), for this line's Task. */
      const continuation = kind !== 'resume' || control !== null ? null
        : continuationControlOf(line.controls, line.taskRef);
      if (control === null && continuation === null) throw new Error(writeTextOf(new Error('this control is not available')));
      const key = line.key.projectId + '|' + line.key.sessionId;
      await withLineWrite(key, async (): Promise<void> => {
        if (continuation !== null) {
          await submitContinuation(client, data.scope, continuation, refresh.reread);
        } else {
          try {
            await submitRunControl(client, data.scope, control!, kind);
          } catch (error) {
            throw new Error(controlWriteTextOf(error));
          }
          await refresh.reread();
        }
      });
    },
    async stopQueryRun(ref: QueryRunRef): Promise<void> {
      /* A8: the Query run's own scope, as its `executions/steps` read uses; the
         QueryRunRef carries it, so the page scope is never guessed. */
      try {
        readyRouteValue(await client.post('queries/cancel',
          { projectId: ref.projectId, workspaceId: ref.workspaceId }, { queryRunRef: ref }), 'queries/cancel');
      } catch (error) {
        /* Note 4: the board keeps this failure under that step's 停止 (keyed by
           the Run and callId), so a page reread never clears it; boot only
           hands over the one Chinese sentence. */
        throw new Error(writeTextOf(error));
      }
      await refresh.reread();
    },
    async holdReview(): Promise<void> {
      await writeReview('unknown-call-reviews/hold', { text: null });
    },
    async releaseReviewHold(): Promise<void> {
      await writeReview('unknown-call-reviews/release-hold', {});
    },
    async requeueLine(): Promise<void> {
      const data = latestLine;
      const write = data?.write ?? null;
      if (data === null || write === null) throw new Error(writeTextOf(new Error('no requeue facts')));
      const key = data.line.key.projectId + '|' + data.line.key.sessionId;
      await withLineWrite(key, async (): Promise<void> => {
        let value: unknown;
        try {
          const reply = await client.write('tasks/requeue', data.scope, {
            input: {
              taskRef: write.taskRef, afterRunRef: write.afterRunRef,
              reason: '在工作线页面重新入队',
            },
            meta: {
              requestId: crypto.randomUUID(),
              expected: [
                { ref: write.goalRef, revision: write.goalRevision },
                { ref: write.afterRunRef, revision: write.runRevision },
              ],
            },
          });
          value = committedRouteValue(reply, 'tasks/requeue');
        } catch (error) {
          throw new Error(writeTextOf(error));
        }
        requeuedOrThrow(value);
        await refresh.reread();
      });
    },
    async controlChain(kind: 'pause' | 'resume' | 'cancel'): Promise<void> {
      const data = latestChain;
      const line = data?.line ?? null;
      if (data === null || line === null || latestChainScope === null) {
        throw new Error(writeTextOf(new Error('no Chain line')));
      }
      const control = line.controls.find((entry) => entry.kind === kind && entry.availability === 'available') ?? null;
      /* S3: the same paused-interrupted Task branch as Member's line head. */
      const continuation = kind !== 'resume' || control !== null || data.task === null ? null
        : continuationControlOf(line.controls, data.task.ref);
      if (control === null && continuation === null) throw new Error(writeTextOf(new Error('this control is not available')));
      const scope = latestChainScope;
      await withLineWrite(line.key.projectId + '|' + line.key.sessionId, async (): Promise<void> => {
        if (continuation !== null) {
          await submitContinuation(client, scope, continuation, refresh.reread);
        } else {
          try {
            await submitRunControl(client, scope, control!, kind);
          } catch (error) {
            throw new Error(controlWriteTextOf(error));
          }
          await refresh.reread();
        }
      });
    },
    async requeueChain(): Promise<void> {
      const write = latestChainWrite;
      const line = latestChain?.line ?? null;
      if (write === null || latestChainScope === null || line === null) {
        throw new Error(writeTextOf(new Error('no requeue facts')));
      }
      const scope = latestChainScope;
      await withLineWrite(line.key.projectId + '|' + line.key.sessionId, async (): Promise<void> => {
        let value: unknown;
        try {
          const reply = await client.write('tasks/requeue', scope, {
            input: { taskRef: write.taskRef, afterRunRef: write.afterRunRef, reason: '人工重新入队' },
            meta: {
              requestId: crypto.randomUUID(),
              expected: [
                { ref: write.goalRef, revision: write.goalRevision },
                { ref: write.afterRunRef, revision: write.runRevision },
              ],
            },
          });
          value = committedRouteValue(reply, 'tasks/requeue');
        } catch (error) {
          throw new Error(writeTextOf(error));
        }
        requeuedOrThrow(value);
        await refresh.reread();
      });
    },
    async releaseHolds(taskRef: TaskTriple): Promise<void> {
      const scope = latestNavScope;
      if (scope === null) throw new Error(writeTextOf(new Error('no navigation scope')));
      let reply: RouteReply;
      try {
        /* The owner admits the configured operator and needs no revision pin;
           `expected` is the route's required empty list, not a guessed one. */
        reply = await client.write('tasks/hold/release', scope, {
          input: { taskRef },
          meta: { requestId: crypto.randomUUID(), expected: [] },
        });
      } catch (error) {
        throw new Error(writeTextOf(error));
      }
      /* `unchanged` is the owner's "nothing held" success; only a committed or
         unchanged reply means the release is done. */
      if (reply.status !== 'committed' && reply.status !== 'unchanged') {
        throw new Error(writeTextOf(new RouteReadError('tasks/hold/release',
          reply.code || reply.status || 'no status', reply.reason ?? '')));
      }
      await refresh.reread();
    },
    async releaseOverlapGate(gate, reason): Promise<void> {
      const scope = { projectId: gate.ref.projectId, workspaceId: gate.workspaceId };
      try {
        const reply = await client.post('goals/overlap-release', scope, {
          commandId: crypto.randomUUID(), gate: gate.ref, revision: gate.revision, reason,
        });
        if (reply.status !== 'released') {
          throw new RouteReadError('goals/overlap-release', reply.code || reply.status, reply.reason ?? '');
        }
      } catch (error) {
        throw new Error(gateWriteTextOf(error));
      }
      await refresh.reread();
    },
    async stopTaskRun(item: { runRef: RunRef; sessionRef: TaskMapSessionRef; workspaceId: string }): Promise<void> {
      const scope = { projectId: item.runRef.projectId, workspaceId: item.workspaceId };
      let read: LineReadValue;
      try {
        read = await readLine(client, scope, item.sessionRef);
      } catch (error) {
        if (error instanceof RouteReadError && error.code === 'not_found') {
          throw new Error('这次执行已经结束，或现在停不了。');
        }
        throw new Error(writeTextOf(error));
      }
      /* `branched` has no single line and so no control: the same answer as a
         line whose cancel control is gone. */
      if (read.kind === 'branched') throw new Error('这次执行已经结束，或现在停不了。');
      const control = read.row.controls.find((entry) => entry.kind === 'cancel'
        && entry.availability === 'available'
        && entry.target.runRef?.runId === item.runRef.runId) ?? null;
      if (control === null) throw new Error('这次执行已经结束，或现在停不了。');
      try {
        await submitRunControl(client, scope, control, 'cancel');
      } catch (error) {
        throw new Error(stopWriteTextOf(error));
      }
      await refresh.reread();
    },
    async changeTaskDisposition(taskId: string, disposition: 'active' | 'deferred' | 'cancelled',
      note?: string): Promise<void> {
      const data = latestTaskMap;
      const scope = data?.scope ?? null;
      const planWrite = data?.planWrite ?? null;
      if (data === null || scope === null || planWrite === null) {
        throw new Error(writeTextOf(new Error('the task map plan is not read')));
      }
      await writeDisposition(scope, goalRefIn(scope.projectId, data.goal.id), planWrite.goalRevision,
        planWrite.graph, taskId, disposition, note);
    },
    async backfillCalendar(range: { from: string; to: string }): Promise<void> {
      const data = latestTaskMap;
      const scope = data?.scope ?? null;
      if (data === null || scope === null) throw new Error(writeTextOf(new Error('the task map plan is not read')));
      let cursor: string | null = null;
      for (let guard = 0; guard < 1000; guard += 1) {
        let page: { processed?: unknown[]; next?: unknown; done?: unknown };
        try {
          page = readyRouteValue(await client.post('activity/backfill', scope,
            { workspace: scope, from: range.from, to: range.to, cursor }), 'activity/backfill');
        } catch (error) {
          throw new Error(error instanceof RouteReadError && error.code === 'busy'
            ? '这台 Host 现在补算不了，稍后再试。' : writeTextOf(error));
        }
        /* A retry cursor points at the same place; following it would repeat the
           same request, so this click stops and asks for another. */
        const retry = (Array.isArray(page.processed) ? page.processed : [])
          .some((entry) => asText(asRecord(entry).outcome) === 'retry_later');
        if (retry) {
          await refresh.reread();
          throw new Error('有的记录这次读不了，稍后再点。');
        }
        const next = asText(page.next);
        if (page.done === true || next === '') break;
        cursor = next;
        if (guard === 999) {
          throw new Error(writeTextOf(new RouteReadError('activity/backfill', 'unavailable',
            'the backfill did not finish paging')));
        }
      }
      await refresh.reread();
    },
    async askLine(question: string): Promise<void> {
      const data = latestLine;
      const line = data?.line ?? null;
      if (data === null || line === null) throw new Error(writeTextOf(new Error('no line')));
      let reply: RouteReply;
      try {
        reply = await client.post('queries/ask', data.scope, {
          sessionRef: line.key, question, commandId: crypto.randomUUID(),
        });
      } catch (error) {
        throw new Error(writeTextOf(error));
      }
      if (reply.status !== 'queued') {
        throw new Error(writeTextOf(new RouteReadError('queries/ask',
          reply.code || reply.status || 'no status', reply.reason ?? '')));
      }
      await refresh.reread();
    },
    async interveneLine(text: string): Promise<void> {
      const data = latestLine;
      const line = data?.line ?? null;
      if (data === null || line === null) throw new Error(writeTextOf(new Error('no line')));
      let reply: RouteReply;
      try {
        reply = await client.write('messages/send', data.scope, {
          /* p2-frozen §2.1/§2.3: two entries write `entry` — this direct-intervention line send and
             Done's 有问题 (`reportDeliveryProblem`); the Host claims, plans or opens a new-goal
             request only for a stored `person_intervention` (B20). The words name the Goal the
             page's subtitle shows: without one an adviser line cannot plan them at all. */
          input: { recipient: line.key, text, needsReply: true, entry: 'person_intervention',
            ...(line.goalId === null ? {} : { goalRef: goalRefIn(data.scope.projectId, line.goalId) }) },
          meta: { requestId: crypto.randomUUID(), expected: [] },
        });
        /* the committed write is the reply's `value`; `sendStatus` is its
           sibling on the envelope (SendMessageResultV1), not a field inside. */
        committedRouteValue(reply, 'messages/send');
      } catch (error) {
        throw new Error(writeTextOf(error));
      }
      const result = asRecord(reply);
      if (result.sendStatus !== 'sent' && result.sendStatus !== 'awaiting_release') {
        throw new Error(writeTextOf(new Error('messages/send did not send')));
      }
      await refresh.reread();
    },
    diffHunks(before: string, after: string): AuxDiffHunk[] | null {
      return auxDiffHunksOf(before, after);
    },
    async saveFile(path: string, content: string, expectedRevision: string | null): Promise<void> {
      const scope = latestNavScope;
      if (scope === null) throw new Error(writeTextOf(new Error('no navigation scope')));
      /* §2.5: the plain `files/save` route; `digest` is the Kernel content
         revision, so the expected value is the page's own last read. A
         `source_stale` rejection is rethrown with its code so the page can
         draw the conflict bar; any other failure is the generic write text
         (READS-2), never the raw route and code. */
      try {
        const reply = await client.post('files/save', scope, { path, expectedRevision, content });
        readyRouteValue<unknown>(reply, 'files/save');
      } catch (error) {
        /* The conflict bar's 仍然保存 needs the disk's new digest, so the page
           re-reads the file before it draws the conflict. */
        if (error instanceof RouteReadError && error.code === 'source_stale') {
          await refresh.reread();
          throw error;
        }
        throw new Error(writeTextOf(error));
      }
      await refresh.reread();
    },
    async runCommand(rowKey: string, row: { command: string; cwd: string; timeoutMs: number }): Promise<void> {
      const scope = latestNavScope;
      if (scope === null) throw new Error(writeTextOf(new Error('no navigation scope')));
      const key = commandRunPrefix(scope) + rowKey;
      const inFlight = commandStarts.get(key);
      if (inFlight !== undefined) return inFlight;
      const pendingStart = (async (): Promise<void> => {
        try {
          const reply = await client.post('commands/start', scope, {
            requestId: crypto.randomUUID(), command: row.command, cwd: row.cwd, timeoutMs: row.timeoutMs,
          });
          const commandId = readyRouteValue<{ commandId: string }>(reply, 'commands/start').commandId;
          commandRuns.set(key, { scope, commandId });
        } catch (error) {
          throw new Error(commandWriteTextOf(error));
        }
        await refresh.reread();
      })();
      commandStarts.set(key, pendingStart);
      try {
        await pendingStart;
      } finally {
        commandStarts.delete(key);
      }
    },
    async stopCommand(rowKey: string): Promise<void> {
      const scope = latestNavScope;
      if (scope === null) throw new Error(writeTextOf(new Error('no navigation scope')));
      const run = commandRuns.get(commandRunPrefix(scope) + rowKey) ?? 'gone';
      if (run === 'gone') return;
      try {
        await client.post('commands/stop', run.scope, { commandId: run.commandId });
      } catch (error) {
        throw new Error(commandWriteTextOf(error));
      }
      await refresh.reread();
    },
    async saveSettings(route: string, input: unknown): Promise<{ notEffective: boolean }> {
      let saved: SettingsSnapshotData;
      const projectId = latestSettings?.projectId ?? '';
      try {
        saved = await saveSettings(client, route, input, projectId);
      } catch (error) {
        /* “已保存，尚未生效” shares the rejected/unavailable code with a failed
           write. The adapter's error carries `pending`; this is the only place it
           crosses to the page, as the explicit `notEffective` data flag. The Host
           already stored the value, so reread once and draw the new value (表一 2). */
        if (error instanceof SettingsNotEffectiveError && error.pending) {
          await refresh.reread();
          return { notEffective: true };
        }
        const text = settingsWriteTextOf(route, error);
        /* 表一 6: an unknown Host reason is not shown; its original goes to the log. */
        if (text === null) logReadError(error);
        throw new Error(text ?? '没有保存成功，可以重试');
      }
      /* 7D2 G: the answer carries the snapshot subset only; the four project reads
         (`scope`, `rules`, `roleLimits`, `knowledgeGit`) are kept from the page's
         last read, so a settings write never blanks those blocks. Only a page that
         already published a read can reach a settings control. */
      const data: SettingsData = {
        ...latestSettings!, ...saved, projectName: latestSettings?.projectName ?? '', projectId,
      };
      latestSettings = data;
      settingsDataVersion += 1;
      view.updateProps({
        ...defaults, actions, data, dataVersion: settingsDataVersion, readState: { status: 'ready' },
      });
      return { notEffective: false };
    },
    async saveRoleLimits(change: {
      running?: Partial<Record<RoleLineDutyV1, number>>;
      open?: Partial<Record<RoleLineDutyV1, number>>;
    }): Promise<void> {
      /* The page draws the block and its 保存 only from a successful read, so the
         range and the revision are there whenever the button is clickable. */
      const settings = latestSettings!;
      const scope = settings.scope!;
      const limits = settings.roleLimits!;
      await projectWrite('projects/role-limits/set', () => client.post('projects/role-limits/set', scope, {
        commandId: crypto.randomUUID(),
        expectedRevision: limits.revision,
        ...change,
      }));
    },
    async changeRuleExpiry(ruleId: string, date: string | null): Promise<void> {
      /* The page draws only rows of `latestSettings.rules.active`, so the row and
         the scope are there whenever its button is clickable. */
      const settings = latestSettings!;
      const scope = settings.scope!;
      const rules = settings.rules!;
      const row = rules.active.find((rule) => rule.ruleId === ruleId)!;
      await projectWrite('autonomy-rules/update', () => client.write('autonomy-rules/update', scope, {
        input: {
          ruleId, expectedRevision: row.revision, expectedSetRevision: rules.setRevision,
          expiresAt: date === null ? null : ruleExpiresAtOf(date),
        },
        /* The route only checks that `expected` is an array; the owner guards the
           versions in `input` (`autonomy-rule-service.ts:203-208`). */
        meta: { requestId: crypto.randomUUID(), expected: [] },
      }));
    },
    async revokeRule(ruleId: string): Promise<void> {
      const settings = latestSettings!;
      const scope = settings.scope!;
      const rules = settings.rules!;
      const row = rules.active.find((rule) => rule.ruleId === ruleId)!;
      await projectWrite('autonomy-rules/revoke', () => client.write('autonomy-rules/revoke', scope, {
        input: { ruleId, expectedRevision: row.revision, expectedSetRevision: rules.setRevision },
        meta: { requestId: crypto.randomUUID(), expected: [] },
      }));
    },
    rereadSettings(): void {
      void refresh.reread();
    },
  };
  /**
   * A6: the 5 s chain belongs to the live Run blocks that are open on the
   * board. Each board reports every drawn block's open state (`runOpen`),
   * including a block 详细/完全展开 opens by itself and the first render; boot
   * keeps their keys and starts/stops the one `setTimeout` chain from that set.
   * It joins the one refresh loop, so the live reread goes through
   * `readRunStepsPage`'s `runningFrom-1` and merge. A key stops counting as soon
   * as its cache entry is no longer live.
   */
  const openLiveRunKeys = new Set<string>();
  let liveRunTimer: ReturnType<typeof setTimeout> | null = null;
  const stopLiveRunTimer = (): void => {
    if (liveRunTimer === null) return;
    clearTimeout(liveRunTimer);
    liveRunTimer = null;
  };
  const hasOpenLiveRun = (): boolean => [...openLiveRunKeys]
    .some((key) => pageRunSteps.get(key)?.live === true);
  const scheduleLiveRunTimer = (data?: unknown): void => {
    if (data !== undefined) {
      const drawn = liveRunKeysOf(data);
      for (const key of [...openLiveRunKeys]) if (!drawn.has(key)) openLiveRunKeys.delete(key);
    }
    if (!hasOpenLiveRun()) { stopLiveRunTimer(); return; }
    if (liveRunTimer !== null) return;
    liveRunTimer = setTimeout(() => {
      liveRunTimer = null;
      /* A fake page or a navigation drops this document; its timer must not
         outlive it (the preserved test harness has no `pagehide`). */
      if (typeof document === 'undefined' || document !== pageDocument) return;
      void refresh.reread();
    }, LIVE_RUN_REREAD_MS);
  };
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    /* 5.5-10: a document that goes away also drops this page's last resume. */
    window.addEventListener('pagehide', () => { lastResume = null; stopLiveRunTimer(); }, { once: true });
  }
  const sources: RefreshSources<unknown> = {
    read: async () => await reader(client, goalId, demand),
    publish: (snapshot) => {
      if (snapshot.error !== null) logReadError(snapshot.error);
      /* A failed reread keeps the old data for the page; it must not become
         the pins of a control write (§2.8: no second, stale read window). */
      if (snapshot.error === null) {
        /* §2.10: every board's successful read publishes the scope and selected
           Goal the one `askSecretary` seam sends with. Done publishes its five
           sections beside the chrome, so its navigation is unwrapped first. */
        const nav = boardName === 'Done'
          ? (snapshot.data as DoneData | null)?.nav ?? null
          : boardName === 'Settings' ? null : snapshot.data as NavData | null;
        latest = nav;
        latestNavScope = nav?.scope ?? null;
        latestSelectedGoalId = nav?.selectedGoalId ?? null;
        if (boardName === 'Goals') {
          latestGoals = snapshot.data as GoalsData | null;
          latestGoalsScope = latestGoals?.scope ?? null;
        }
        if (boardName === 'TaskMap') latestTaskMap = snapshot.data as TaskMapData | null;
        if (boardName === 'Decide') {
          latestDecide = snapshot.data as DecideData | null;
          latestDecideScope = latestDecide?.scope ?? null;
          latestLine = latestDecide?.line && latestDecide.scope
            ? { scope: latestDecide.scope, line: latestDecide.line.line, write: latestDecide.line.write, review: null } : null;
        }
        if (boardName === 'ArchOverview') latestArch = snapshot.data as ArchOverviewData | null;
        /* MainData is flat `NavData &` extras, so the card writes use this
           read's queue exactly like Decide's own. */
        const main = snapshot.data as MainData | null;
        if ((boardName === 'Main' || boardName === 'Plan') && main?.decisions) {
          latestDecide = main.decisions;
          latestDecideScope = main.scope;
        }
        if (boardName === 'Chain') latestChain = snapshot.data as ChainData | null;
        if (boardName === 'Settings') latestSettings = snapshot.data as SettingsData | null;
        if (boardName === 'Member') {
          const member = snapshot.data as MemberData | null;
          latestLine = member?.line
            ? { scope: member.scope, line: member.line, write: member.write, review: member.line.review } : null;
        }
        if (boardName === 'Main' || boardName === 'Plan') {
          latestLine = main?.line && main.scope
            ? { scope: main.scope, line: main.line.line, write: main.line.write, review: main.line.review } : null;
        }
        if (boardName === 'Done') latestDelivery = (snapshot.data as DoneData | null)?.deliveryWrite ?? null;
      }
      const props = pageProps(defaults, snapshot, restart, actions);
      if (snapshot.error === null && snapshot.data !== null) {
        /* The one Goal the page's own read published; a failed read keeps the
           URL Goal through `defaults`. */
        let linksGoal: string | null;
        if (boardName === 'Goals') linksGoal = (snapshot.data as GoalsData).selectedGoalId;
        else if (boardName === 'Main' || boardName === 'Plan') linksGoal = (snapshot.data as NavData).selectedGoalId;
        else if (boardName === 'Decide') linksGoal = (snapshot.data as DecideData).nav.selectedGoalId;
        else if (boardName === 'Done') linksGoal = (snapshot.data as DoneData).nav.selectedGoalId;
        else if (boardName === 'Member') linksGoal = (snapshot.data as MemberData).goal?.id ?? null;
        else if (boardName === 'Chain') linksGoal = (snapshot.data as ChainData).goal?.id ?? null;
        else if (boardName === 'TaskMap') linksGoal = (snapshot.data as TaskMapData).goal?.id ?? null;
        else linksGoal = goalId;
        props.mainHref = goalHref('Main.dc.html', linksGoal);
        props.taskMapHref = goalHref('TaskMap.dc.html', linksGoal);
      }
      if (boardName === 'Goals') {
        props.archHref = goalHref('ArchOverview.dc.html', latestGoals?.selectedGoalId ?? goalId);
      } else if (boardName === 'Main' || boardName === 'Plan') {
        /* A failed read keeps `defaults.archHref`, the URL Goal, though `goalId`
           may already name a Goal picked after mount. */
        if (snapshot.error === null) {
          props.archHref = goalHref('ArchOverview.dc.html', latestSelectedGoalId);
        }
      } else if (boardName === 'Decide') {
        /* DecideData keeps its navigation under `nav`, so the publish above does
           not unwrap it; the link takes the Goal that read published. */
        if (snapshot.error === null) {
          props.archHref = goalHref('ArchOverview.dc.html', latestDecide?.nav.selectedGoalId ?? null);
        }
      } else if (boardName === 'Done') {
        /* DoneData keeps its navigation under `nav` too; C1 gives the
           完整架构图 link the Goal this read published. */
        if (snapshot.error === null) {
          props.archHref = goalHref('ArchOverview.dc.html', (snapshot.data as DoneData | null)?.nav.selectedGoalId ?? null);
        }
      }
      view.updateProps(props);
      /* P2: a Plan read is also the moment the waiting re-adoption checks the
         affected Tasks; the page already shows the "采用中…" note. */
      if (boardName === 'Plan' && snapshot.error === null && snapshot.data !== null) {
        void reapplyAdoption(client, snapshot.data as PlanData, () => { void refresh.reread(); });
      }
      scheduleLiveRunTimer(snapshot.data);
    },
    subscribe: (handlers, cursor) => subscribeChanges(tokenOf, handlers, cursor),
  };
  const refresh = createAutoRefresh(sources);
  /** Ruling item 6: the retry button restarts the loop; only a successful first
   * read reaches `connect()` and starts the stream. */
  function restart(): void { void refresh.start(); }
  await refresh.start();
}

/** STK15 M9: the one place `files/uncommitted` is called — one call per 100
 * paths of one workspace, each answer yielded in order; an empty `paths`
 * makes no call (READS-7: the Host rejects an empty `paths`). Both
 * `readUncommittedByWorkspace` and `readUncommittedPage` read through it;
 * which paths they pass and what a failure does stay their own. */
async function* uncommittedPagesOf(
  client: ReturnType<typeof createHostClient>, scope: CoreScope, workspaceId: string, paths: readonly string[],
): AsyncGenerator<UncommittedFilesV1> {
  for (let index = 0; index < paths.length; index += 100) {
    /* §2.3: this route wants a WorkspaceRef, not the caller's CoreScope. */
    yield readyRouteValue<UncommittedFilesV1>(await client.post('files/uncommitted',
      { ...scope, workspaceId }, {
        workspace: { aggregateType: 'Workspace', projectId: scope.projectId, workspaceId },
        paths: paths.slice(index, index + 100),
      }), 'files/uncommitted');
  }
}

/** One per-workspace `files/uncommitted` read shared by TaskMap's detail and Done:
 * each path is sent with its own workspace's ref and the answer's path is
 * qualified back to the canonical project path. TaskMap caps the whole read at
 * 100 paths; Done has no total cap; the calls go through `uncommittedPagesOf`.
 * One workspace's failed read leaves its files without numbers (the other
 * workspaces keep theirs). */
async function readUncommittedByWorkspace(
  client: ReturnType<typeof createHostClient>, scope: CoreScope,
  entries: ReadonlyArray<{ workspaceId: string; path: string }>,
  options: { totalCap?: number } = {},
): Promise<{ repository: 'git' | 'not_git' | null; files: UncommittedFileV1[] }> {
  const groupedPaths = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.path === '') continue;
    const paths = groupedPaths.get(entry.workspaceId) ?? [];
    if (!paths.includes(entry.path)) paths.push(entry.path);
    groupedPaths.set(entry.workspaceId, paths);
  }
  const files: UncommittedFileV1[] = [];
  let repository: 'git' | 'not_git' | null = null;
  let remaining = options.totalCap ?? Number.POSITIVE_INFINITY;
  for (const [workspaceId, workspacePaths] of groupedPaths) {
    if (remaining <= 0) break;
    const capped = workspacePaths.slice(0, remaining);
    remaining -= capped.length;
    if (capped.length === 0) continue;
    const collected: UncommittedFileV1[] = [];
    try {
      for await (const page of uncommittedPagesOf(client, scope, workspaceId, capped)) {
        if (page.repository !== 'git') {
          if (repository === null) repository = 'not_git';
          continue;
        }
        repository = 'git';
        for (const file of page.files) {
          collected.push({ ...file, path: qualifyProjectPath(workspaceId, file.path, scope.workspaceId) });
        }
      }
      files.push(...collected);
    } catch {
      // One workspace's failed read leaves its files without numbers.
    }
  }
  return { repository, files };
}

/**
 * E3-DONE §2.2: the Done read. It is `readNav`'s chrome read plus the delivery's
 * six public routes in the ruled order: completion policy, the one gate's
 * verification round, `architecture/change-scope`, one `graph/detail` per Task
 * (only its actual files), `files/uncommitted` for those paths, the Runs and
 * their briefs, `activity/runs`, and — only when the page asks for one digest —
 * `materials/open`. A completed Goal also reads `goals/delivery`; a
 * `RouteReadError` there only greys the card's three actions, while every other
 * failure is the read's own error. `not_found` is a legitimate empty state only
 * where §2.2 names it. No route shape reaches the page: `adaptDone` folds it
 * into `DoneData`.
 */
export async function readDone(
  client: ReturnType<typeof createHostClient>, goalId: string | null,
  demand: BoardReadDemand = {},
): Promise<RefreshRead<DoneData>> {
  const boot = await client.bootstrap();
  const cursor = boot.changesHead ?? null;
  const navRead = await readNav(client, goalId, demand, boot);
  const nav = navRead.data;
  if (nav === null) return { data: null, cursor };
  const selectedGoalId = nav.selectedGoalId;
  const scope = nav.scope;
  if (selectedGoalId === null || scope === null) {
    /* No selected Goal still has a workspace: files, commands and Diff are
       workspace facts, so the panel is read. Without a scope there is nothing
       to read. */
    const aux = scope === null ? null : await readPageAux(client, boot, scope, nav, demand);
    const blankSource: DoneSource = {
      nav, aux, deliveryState: 'no_plan', round: null, policy: null,
      changeScope: {
        goalRef: { aggregateType: 'Goal', projectId: scope?.projectId ?? '', goalId: selectedGoalId ?? '' },
        files: [], modules: [], counts: { files: 0, changed: 0, possible: 0 }, complete: true, sourceCursor: null,
      },
      taskFiles: {}, taskFilesIncomplete: false, files: null, runs: [], briefs: {}, activity: [],
      delivery: null, deliveryError: null, reports: {}, reportError: null,
    };
    return { data: adaptDone(blankSource), cursor };
  }
  const goalRef = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId: selectedGoalId };

  /* ④ The completion policy: `not_found` is "no policy yet", not a read error;
     only the section's closing note depends on it. */
  let policy: DonePolicyRead | null = null;
  try {
    policy = readyRouteValue<DonePolicyRead>(
      await client.post('completion-policies/read', scope, { projectId: scope.projectId }),
      'completion-policies/read');
  } catch (error) {
    if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
  }

  /* ⑤ One gate: the Goal-level one; else the only one; more than one without a
     Goal-level gate is the ruled "many gates, not connected" state. */
  const graph = nav.tasks;
  let gate: TaskRow | null = null;
  let deliveryState: DoneSource['deliveryState'] = 'no_plan';
  if (graph !== null) {
    const gates = graph.tasks.filter((row) => row.definition.taskKind === 'gate' && row.disposition === 'active');
    const goalGate = gates.find((row) => row.definition.scope.kind === 'goal') ?? null;
    if (goalGate !== null) gate = goalGate;
    else if (gates.length === 1) gate = gates[0] ?? null;
    else if (gates.length === 0) deliveryState = 'no_gate';
    else deliveryState = 'many_gates';
  }
  let round: DoneRoundRead | null = null;
  if (gate !== null) {
    deliveryState = 'ready';
    try {
      round = readyRouteValue<DoneRoundRead>(
        await client.post('verification/round', scope, { taskRef: gate.ref }), 'verification/round');
    } catch (error) {
      if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
      deliveryState = 'no_round';
    }
  }

  /* ⑤b K2: the delivery card's own read, only while the shown Goal displays as
     completed. A failed read greys its three actions and drops the write facts,
     but the five sections from the routes above are still drawn. */
  let delivery: DoneDeliveryRead | null = null;
  let deliveryError: string | null = null;
  if (nav.selectedDisplay?.phase === 'COMPLETED') {
    try {
      delivery = readyRouteValue<DoneDeliveryRead>(
        await client.post('goals/delivery', scope, { goalRef }), 'goals/delivery');
    } catch (error) {
      if (!(error instanceof RouteReadError)) throw error;
      logReadError(error);
      deliveryError = pageTextOf(error);
    }
  }

  /* ⑥ The one file grouping: `architecture/change-scope`; a failure fails the read. */
  const changeScope = readyRouteValue<ArchitectureChangeScopeV1>(
    await client.post('architecture/change-scope', scope, { goalRef }), 'architecture/change-scope');

  /* ⑦ Task ↔ file: one summary read per Task; `unavailable` only leaves that
     Task without an attribution and never guesses `plannedFiles`. */
  const taskFiles: Record<string, string[]> = {};
  let taskFilesIncomplete = false;
  if (graph !== null) {
    for (const row of graph.tasks) {
      const detail = readyRouteValue<unknown>(await client.post('graph/detail', scope, {
        goalRef, node: { kind: 'task', ref: row.ref, planRef: graph.plan.ref },
        section: 'summary', page: { afterCursor: null, limit: 100 },
      }), 'graph/detail');
      const actual = asRecord(asRecord(asRecord(detail).task).actualFiles);
      if (actual.availability !== 'available') continue;
      const files = (Array.isArray(actual.value) ? actual.value : []).map((entry) => {
        const file = asRecord(entry);
        const path = asText(file.path);
        if (path === '') return '';
        const workspaceId = asText(file.workspaceId) || scope.workspaceId;
        return qualifyProjectPath(workspaceId, path, scope.workspaceId);
      }).filter((path) => path !== '');
      if (files.length > 0) taskFiles[row.ref.taskId] = [...new Set(files)];
      if (actual.possiblyIncomplete === true) taskFilesIncomplete = true;
    }
  }

  /* ⑧ The added/deleted numbers only: each change-scope path against its own
     workspace's HEAD (the canonical project path names the workspace). A
     failed read only makes that workspace's numbers unreadable; the file list
     stays. Done has no total path cap, only 100-path batches per workspace. */
  const paths = changeScope.files.map((file) => {
    const parsed = splitWorkspacePath(file.path);
    return { workspaceId: parsed.workspaceId ?? scope.workspaceId, path: parsed.path };
  });
  let files: UncommittedFileListV1 | null = null;
  if (paths.length > 0) {
    const read = await readUncommittedByWorkspace(client, scope, paths);
    files = read.repository === 'git' ? { repository: 'git', files: read.files }
      : read.repository === 'not_git' ? { repository: 'not_git' } : null;
  }

  /* ⑨ Rework/succession Runs: each rework entry's after Run, each Task's
     requeue target and its selected Run; deduplicated, then `executions/read`
     (one unreadable Run only leaves that row without facts) and, for a Run that
     carries `requeueRef`, its continuation brief. */
  const runRefs: RunRef[] = [];
  const seenRuns = new Set<string>();
  const addRun = (ref: RunRef | null | undefined): void => {
    if (ref === null || ref === undefined || seenRuns.has(ref.runId)) return;
    seenRuns.add(ref.runId);
    runRefs.push(ref);
  };
  for (const row of graph?.tasks ?? []) {
    for (const entry of row.rework?.entries ?? []) addRun(entry.afterRunRef);
    if (row.requeueRef !== undefined) {
      addRun({ aggregateType: 'Run', projectId: scope.projectId, goalId: row.ref.goalId, runId: row.requeueRef.afterRunId });
    }
    addRun(row.execution);
  }
  const runs: TaskExecutionRecord[] = [];
  for (const ref of runRefs) {
    try {
      runs.push(readyRouteValue<TaskExecutionRecord>(
        await client.post('executions/read', scope, ref), 'executions/read'));
    } catch (error) {
      if (!(error instanceof RouteReadError)) throw error;
    }
  }
  const briefs: Record<string, ContinuationBriefV1 | null> = {};
  for (const record of runs) {
    if (record.run.requeueRef === undefined) continue;
    const read = readyRouteValue<{ brief: ContinuationBriefV1; digest: string } | null>(
      await client.post('executions/brief', scope, { runRef: record.run.ref }), 'executions/brief');
    briefs[record.run.ref.runId] = read === null ? null : read.brief;
  }

  /* ⑩ Token usage: `activity/runs` for those Runs, 200 at a time; no Run means
     no route call and `usage === null` in the adapter. */
  const activity: DoneRunActivity[] = [];
  const activityRefs = runs.map((record) => record.run.ref);
  for (let index = 0; index < activityRefs.length; index += 200) {
    const page = readyRouteValue<DoneRunActivity[]>(await client.post('activity/runs', scope, {
      runRefs: activityRefs.slice(index, index + 200),
    }), 'activity/runs');
    activity.push(...page);
  }

  /* ⑪ The one on-demand report: only a digest the shown round really carries;
     its failure is `reportError`, never the page's failure. */
  const reports: Record<string, string> = {};
  let reportError: string | null = null;
  const reportDigest = demand.doneReport ?? null;
  if (reportDigest !== null && round !== null) {
    const wanted = round.delivery.requirements.flatMap((requirement) => requirement.checks)
      .find((check) => check.reportRef !== null && check.reportRef.digest === reportDigest)?.reportRef ?? null;
    if (wanted !== null) {
      try {
        const record = readyRouteValue<ArtifactRecord>(
          await client.post('materials/open', scope, { ref: wanted, usage: 'historical_explanation' }),
          'materials/open');
        reports[wanted.digest] = record.body;
      } catch (error) {
        reportError = pageTextOf(error);
      }
    }
  }

  /* ⑫ The right panel's current tab (C1), after the page's own reads. */
  const aux = await readPageAux(client, boot, scope, nav, demand);

  return {
    data: adaptDone({
      nav, aux, deliveryState, round, policy, changeScope, taskFiles, taskFilesIncomplete,
      files, runs, briefs, activity, delivery, deliveryError, reports, reportError,
    }),
    cursor,
  };
}

type BoardReader<T> = (
  client: ReturnType<typeof createHostClient>, goalId: string | null, demand?: BoardReadDemand,
) => Promise<RefreshRead<T>>;

/** The Settings page reads the snapshot once and takes the project name from
 * the same first bootstrap the page's link came with. The four project reads
 * after it are secondary: each failure only leaves its own block null (or the
 * names unread) and its block's 重试 rereads the whole page. */
async function readSettingsBoard(
  client: ReturnType<typeof createHostClient>, goalId: string | null,
): Promise<RefreshRead<SettingsData>> {
  const boot = await client.bootstrap();
  /* The bootstrap lists projects, not a project name; the Goal's project (or the
   * first project when the page has no Goal) supplies the header's name and the
   * row the structural switches read (`saved[current] ?? defaults`). */
  const found = goalId === null ? null : await taskMapScope(client, boot.workspaces, goalId);
  const projectId = found?.scope.projectId ?? boot.workspaces[0]?.scope.projectId ?? '';
  /* 7D2 G: the write range. With a Goal it is the Goal's workspace; without one
     it is this project's first bootstrap workspace. No project open leaves it
     null, and the two project blocks say nothing is open. */
  const scope = found?.scope ?? boot.workspaces.find((workspace) => workspace.scope.projectId === projectId)?.scope ?? null;
  const data = await readSettings(client, goalId, projectId);
  const name = boot.workspaces.find((workspace) => workspace.scope.projectId === projectId)?.name ?? '';
  const base: SettingsData = {
    ...data, projectName: name, projectId, scope, rules: null, roleLimits: null, knowledgeGit: {},
  };
  if (scope === null) return { data: base, cursor: boot.changesHead ?? null };
  const workspaces = boot.workspaces.filter((workspace) => workspace.scope.projectId === projectId);
  /* The three reads do not depend on each other: one round trip, each failure
     still only emptying its own block. */
  const [rules, roleLimits, knowledgeGit] = await Promise.all([
    readSettingsRules(client, projectId, scope, workspaces),
    readSettingsRoleLimits(client, projectId, scope),
    /* J: the same workspaces the block draws (the snapshot's rows), not the bootstrap's. */
    readSettingsKnowledgeGit(client, data.workspaces),
  ]);
  return { data: { ...base, rules, roleLimits, knowledgeGit }, cursor: boot.changesHead ?? null };
}

type SettingsGoalListRead = {
  goals: Array<{ ref: { goalId: string }; ordinal: number | null; objective: string }>;
};
type SettingsRoleLimitsRead = { revision: number; running: Record<RoleLineDutyV1, number>; open: Record<RoleLineDutyV1, number> };
type SettingsAllocationRead = { duties: Record<RoleLineDutyV1, { holders: readonly unknown[] }> };
type SettingsMessageRead = {
  createdAt?: unknown;
  decision?: { source?: unknown };
  response?: { decision?: { source?: unknown } } | null;
};
type SettingsCardRead = { subject?: { kind?: unknown; goalRef?: { goalId?: unknown } } };

/** One rule's source card: the answer message's `createdAt` and the card's
 *  subject. Any failed read is the caller's `logReadError`, which falls back to
 *  “你答卡时存的” for that rule only (`messages/read` and `decisions/card`). */
async function settingsRuleAnswerOf(
  client: ReturnType<typeof createHostClient>, ref: unknown,
): Promise<SettingsRuleAnswer> {
  const messageRef = asRecord(ref);
  const scope = {
    projectId: asText(messageRef.projectId), workspaceId: asText(messageRef.workspaceId),
  };
  const message = readyRouteValue<SettingsMessageRead>(
    await client.post('messages/read', scope, ref), 'messages/read',
  );
  const at = asText(message.createdAt);
  if (at === '') throw new Error('the answer message has no createdAt');
  /* The answer's own slot is the canonical source; a synthetic answer records it
     on the message's `decision` metadata (`contracts/core/session-message.ts:79-98`). */
  const source = asRecord(message.response).decision !== undefined
    ? asRecord(asRecord(message.response).decision).source
    : asRecord(message.decision).source;
  const card = readyRouteValue<SettingsCardRead>(
    await client.post('decisions/card', scope, { source }), 'decisions/card',
  );
  const subject = asRecord(card.subject);
  const kind = asText(subject.kind);
  if (kind === 'goal') {
    return { at, scope: 'goal', goalId: asText(asRecord(subject.goalRef).goalId) };
  }
  if (kind !== 'project') throw new Error('the answer card has no subject');
  return { at, scope: 'project', goalId: null };
}

/** `autonomy-rules`, the Goal names it may need, and each rule's source card. */
async function readSettingsRules(
  client: ReturnType<typeof createHostClient>, projectId: string, scope: CoreScope,
  workspaces: BootstrapReply['workspaces'],
): Promise<SettingsRules | null> {
  let view: SettingsRuleView;
  try {
    view = readyRouteValue<SettingsRuleView>(
      await client.post('autonomy-rules', scope, { projectRef: { projectId } }), 'autonomy-rules',
    );
  } catch (error) {
    logReadError(error);
    return null;
  }
  /* The Goal names and the per-rule source cards do not depend on each other:
     both groups start here and are awaited together. A failed `goals/list` only
     leaves its own Goal names unread, and a failed source read only leaves that
     rule's answer missing. */
  const goalsRead = !view.rules.some((rule) => rule.scope.some((item) => item.kind === 'goal'))
    ? Promise.resolve(null)
    : (async (): Promise<Record<string, SettingsGoalName>> => {
      const goals: Record<string, SettingsGoalName> = {};
      /* `goals/list` reads one workspace; Goals live per workspace, so read this
         project's each and merge by goalId, like `readArchOverview`'s per-workspace loop.
         A failed workspace only leaves its own Goal names unread. */
      const lists = await Promise.all(workspaces.map(async (workspace) => {
        try {
          return readyRouteValue<SettingsGoalListRead>(
            await client.post('goals/list', workspace.scope, { workspace: workspace.scope }), 'goals/list',
          ).goals;
        } catch (error) {
          logReadError(error);
          return [];
        }
      }));
      for (const list of lists) {
        for (const goal of list) {
          goals[goal.ref.goalId] = { ordinal: goal.ordinal, objective: goal.objective };
        }
      }
      return goals;
    })();
  const answersRead = (async (): Promise<Record<string, SettingsRuleAnswer>> => {
    const answers: Record<string, SettingsRuleAnswer> = {};
    await Promise.all(view.rules.map(async (rule) => {
      /* Only an active rule's source is drawn; a revoked row keeps its scope only. */
      if (rule.state !== 'active' || rule.approvedFrom === null) return;
      try {
        answers[rule.ref.ruleId] = await settingsRuleAnswerOf(client, rule.approvedFrom.answerMessageRef);
      } catch (error) {
        logReadError(error);
      }
    }));
    return answers;
  })();
  const [goals, answers] = await Promise.all([goalsRead, answersRead]);
  return settingsRulesOf(view, goals, answers);
}

/** `projects/role-limits` plus the allocation read; a failed allocation only
 *  leaves the “现在” column empty. */
async function readSettingsRoleLimits(
  client: ReturnType<typeof createHostClient>, projectId: string, scope: CoreScope,
): Promise<SettingsRoleLimits | null> {
  const [view, allocation] = await Promise.all([
    (async (): Promise<SettingsRoleLimitsRead | null> => {
      try {
        return readyRouteValue<SettingsRoleLimitsRead>(
          await client.post('projects/role-limits', scope, { projectRef: { projectId } }), 'projects/role-limits',
        );
      } catch (error) {
        logReadError(error);
        return null;
      }
    })(),
    (async (): Promise<SettingsAllocationRead | null> => {
      try {
        return readyRouteValue<SettingsAllocationRead>(
          await client.post('role-lines/allocation', scope, {}), 'role-lines/allocation',
        );
      } catch (error) {
        logReadError(error);
        return null;
      }
    })(),
  ]);
  return view === null ? null : settingsRoleLimitsOf(view, allocation);
}

/** One `knowledge/status` per workspace: ready is a git checkout, `unsupported`
 *  is not a git repository, anything else is “unknown” (the page still draws
 *  the checkbox and lets the Host decide). */
async function readSettingsKnowledgeGit(
  client: ReturnType<typeof createHostClient>, workspaces: ReadonlyArray<{ scope: CoreScope }>,
): Promise<Record<string, boolean | null>> {
  const entries = await Promise.all(workspaces.map(async (workspace): Promise<[string, boolean | null]> => {
    const key = settingsScopeKeyOf(workspace.scope);
    try {
      readyRouteValue(await client.post('knowledge/status', workspace.scope, {}), 'knowledge/status');
      return [key, true];
    } catch (error) {
      if (error instanceof RouteReadError && error.code === 'unsupported') return [key, false];
      logReadError(error);
      return [key, null];
    }
  }));
  return Object.fromEntries(entries);
}

/** §2.11: one table, keyed by the served file name. TaskMap keeps its reader's
 * signature and return type; Main joins with the chrome read. Every other
 * board keeps the E3-1 sample mount and issues no route request. */
const BOARD_READERS: Record<string, BoardReader<unknown>> = {
  TaskMap: readTaskMap as BoardReader<unknown>,
  Main: readMain,
  Plan: readPlan as BoardReader<unknown>,
  Goals: readGoals,
  ArchOverview: readArchOverview as BoardReader<unknown>,
  Decide: readDecide as BoardReader<unknown>,
  Member: readMember as BoardReader<unknown>,
  Chain: readChain as BoardReader<unknown>,
  Done: readDone as BoardReader<unknown>,
  Settings: readSettingsBoard as BoardReader<unknown>,
};

/** The board name a served page is for: `/workbench/TaskMap.dc.html` -> `TaskMap`. */
function boardNameOf(href: string): string {
  const file = new URL(href).pathname.split('/').pop() ?? '';
  return file.endsWith('.dc.html') ? file.slice(0, -'.dc.html'.length) : '';
}

/** The six boards with the left rail, the only pages the settings link returns
 * to; anything else (or opening Settings directly) returns to Main. */
const SETTINGS_BACK_BOARDS = new Set(['Main', 'Plan', 'Decide', 'Done', 'Member', 'Chain']);

/** The rail-foot link: the page it returns to, plus every query parameter of the
 * page it was opened from (Goal, Member/Chain `lineProject` / `lineSession`, …). */
function settingsHrefOf(boardName: string, search: string): string {
  const query = new URLSearchParams(search);
  query.delete('from');
  query.set('from', boardName);
  return 'Settings.dc.html?' + query.toString();
}

/** The settings page's 返回工作台 target: the page it was opened from, with all of
 * that page's query parameters; direct opening returns to Main. */
function settingsBackHrefOf(search: string): string {
  const query = new URLSearchParams(search);
  const from = query.get('from');
  query.delete('from');
  const board = from !== null && SETTINGS_BACK_BOARDS.has(from) ? from : 'Main';
  const rest = query.toString();
  return board + '.dc.html' + (rest === '' ? '' : '?' + rest);
}

/**
 * Ruling items 5 and 6: one snapshot becomes the board props. A first-read
 * failure keeps the E3-2 error and retry and no data; a successful read shows
 * its data (or the empty/no-Plan state) and bumps `dataVersion`. While the
 * stream is down the last data stays and `barWhy` carries the reconnect text;
 * a failed reread carries the E3-2 code-table text instead. `status` stays
 * `ready` when data exists so the gate in `renderVals` does not hide it.
 */
function pageProps<T>(
  defaults: Record<string, string>, snapshot: RefreshSnapshot<T>, retry: () => void,
  actions: BoardActions,
): Record<string, unknown> {
  if (snapshot.dataVersion === 0 && snapshot.error !== null) {
    return {
      ...defaults, actions,
      readState: { status: 'error', message: pageTextOf(snapshot.error), retry, stale: false },
    };
  }
  const staleText = !snapshot.stale ? ''
    : snapshot.error !== null ? pageTextOf(snapshot.error) : snapshot.tooMany === true ? TOO_MANY_PAGES_TEXT : RECONNECT_TEXT;
  const stale = { stale: snapshot.stale, staleText };
  const data = snapshot.data;
  if (data === null) return { ...defaults, actions, readState: { status: 'empty', ...stale } };
  if (data !== null && asRecord(data).planMissing === true) {
    return {
      ...defaults, actions, data, dataVersion: snapshot.dataVersion,
      readState: { status: 'empty', message: NO_PLAN_TEXT, ...stale },
    };
  }
  return { ...defaults, actions, data, dataVersion: snapshot.dataVersion, readState: { status: 'ready', ...stale } };
}

/** `goals/conflicts` carries one footprint entry per Goal; only the ref is read. */
type GoalConflictRead = { footprintCompleteness: Array<{ goalRef: { goalId: string } }> };

type TaskMapGoalRef = { aggregateType: 'Goal'; projectId: string; goalId: string };

/**
 * The one scope choice of the read and the pin write. Without a goal id it is
 * the first workspace. With one, each workspace is tried once in bootstrap
 * order: `goals/read` answers `ready` in the workspace that holds the Goal, and
 * that scope is the read's and the fixed writes' scope; the read is returned so
 * the Goal is not read twice. `not_found` and `forbidden` both mean this
 * workspace is not its home, so the next one is tried and each real error is
 * kept; any other failure is the read's own error. After every workspace,
 * `forbidden` is thrown first, then `not_found`; no workspace at all is `null`.
 */
async function taskMapScope(
  client: ReturnType<typeof createHostClient>, workspaces: BootstrapReply['workspaces'], goalId: string | null,
): Promise<{ scope: CoreScope; goal: { ref: TaskMapGoalRef; read: TaskMapGoalRead } | null } | null> {
  if (goalId === null) {
    const first = workspaces[0];
    return first === undefined ? null : { scope: first.scope, goal: null };
  }
  let denied: RouteReadError | null = null;
  let missing: RouteReadError | null = null;
  for (const { scope } of workspaces) {
    const ref = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId };
    try {
      const read = readyRouteValue<TaskMapGoalRead>(await client.post('goals/read', scope, ref), 'goals/read');
      return { scope, goal: { ref, read } };
    } catch (error) {
      if (!(error instanceof RouteReadError)
        || (error.code !== 'not_found' && error.code !== 'forbidden')) throw error;
      if (error.code === 'not_found') missing = error;
      else denied = error;
    }
  }
  if (denied !== null) throw denied;
  if (missing !== null) throw missing;
  return null;
}

/** `goals/list`'s value at the JSON boundary; the chrome reads `ref`, `revision`,
 * `ordinal`, `objective`, `order` and `display.phase` (§2.7). */
type GoalListRead = { goals: Array<Record<string, unknown>> };

/** `lines/archived`'s value at the JSON boundary. */
type ArchivedLineRead = { rows?: unknown[]; nextCursor?: string | null };

/** `decisions/queue`'s value: the counts are taken before paging (§2.11). */
type QueueCountsRead = { counts?: unknown; capabilities?: unknown };

/**
 * E3-NAV §2.2/§2.4/§2.7/§2.11: the chrome read of Main and of every board that
 * takes the navigation segment. The scope is the same `taskMapScope` the
 * TaskMap read uses (decision 104-1), so `?goal=` is resolved in the workspace
 * that holds the Goal and the navigation reads never fall back to
 * `workspaces[0]` when a Goal was asked for. With no Goal id the first unfinished Goal is chosen: a `null` list
 * phase is read through `goals/display` before it is called unfinished, and a
 * finished one is skipped. The returned `cursor` is this read's bootstrap
 * `changesHead`, never a later head.
 */
export async function readNav(
  client: ReturnType<typeof createHostClient>, goalId: string | null,
  demand: BoardReadDemand = {}, preloadedBoot?: BootstrapReply, readPhase = true,
): Promise<RefreshRead<NavData>> {
  const boot = preloadedBoot ?? await client.bootstrap();
  const cursor = boot.changesHead ?? null;
  const found = await taskMapScope(client, boot.workspaces, goalId);
  if (found === null) return { data: null, cursor };
  const scope = found.scope;
  const goals = readyRouteValue<GoalListRead>(
    await client.post('goals/list', scope, { workspace: scope }), 'goals/list',
  );
  const displays = new Map<string, unknown>();
  const refOf = (id: string) => ({ aggregateType: 'Goal' as const, projectId: scope.projectId, goalId: id });
  const readDisplay = async (id: string): Promise<TaskMapDisplayRead> => {
    const read = await readGoalDisplay(client, scope, refOf(id));
    displays.set(id, read);
    return read;
  };
  let selected = goalId;
  if (selected !== null) {
    await readDisplay(selected);
  } else {
    for (const entry of goals.goals) {
      const id = asText(asRecord(entry.ref).goalId);
      if (id === '') continue;
      let display: TaskMapDisplayRead;
      try {
        display = await readDisplay(id);
      } catch (error) {
        if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
        continue;
      }
      if (!isFinishedGoalDisplayPhase(display.display.phase)) { selected = id; break; }
    }
  }
  const lines = readyRouteValue<unknown>(
    await client.post('lines/list', scope, { workspace: scope }), 'lines/list',
  );
  /* The inbox is the workspace's, as the rail's two rows were; a failed count
   * hides the item and is not an error of the page. */
  let queue: QueueCountsRead | null = null;
  try {
    queue = readyRouteValue<QueueCountsRead>(await client.post('decisions/queue', scope, {
      workspace: scope, sections: ['waiting_answer', 'notices'], page: { limit: 1 },
    }), 'decisions/queue');
  } catch {
    queue = null;
  }
  let detail: NavLineDetail | null = null;
  if (demand.lineKey !== null && demand.lineKey !== undefined) {
    /* §2.4: both pages read a selected line through the one shared `readLine`. */
    detail = await readLine(client, scope, demand.lineKey) as unknown as NavLineDetail;
  }
  let archived: unknown = null;
  if (demand.archive === true) {
    const rows: unknown[] = [];
    let after: string | null = null;
    for (let guard = 0; guard < 1000; guard += 1) {
      const page: ArchivedLineRead = readyRouteValue<ArchivedLineRead>(await client.post('lines/archived', scope,
        { workspace: scope, page: { limit: 100, ...(after === null ? {} : { cursor: after }) } }), 'lines/archived');
      rows.push(...(Array.isArray(page.rows) ? page.rows : []));
      after = page.nextCursor ?? null;
      if (after === null) break;
    }
    archived = { rows };
  }
  const display = selected === null ? null : displays.get(selected) ?? null;
  /* §2.8: the GoalPhase pin is read with the display. `not_found` is a Goal
   * without an adopted Plan (0); any other failure is a read error, not 0. */
  let phase: unknown;
  if (selected !== null && readPhase) {
    try {
      phase = readyRouteValue<unknown>(
        await client.post('tasks/query', scope, { goalRef: refOf(selected) }), 'tasks/query',
      );
    } catch (error) {
      if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
      phase = null;
    }
  }
  const nav = adaptNav({ goals, lines, display, queue, archived, detail, phase, tasks: phase }, selected, scope);
  for (const failure of nav.selectedDisplay?.facts.reentryFailures ?? []) {
    if (failure.reason !== '') {
      logNavReasonOnce('reentry:' + failure.runRef.runId + ':' + failure.reason, failure.reason);
    }
  }
  /* 5.5-5: an unsupported control's own reason is English and stays in the log. */
  for (const stop of nav.selectedDisplay?.facts.runStops ?? []) {
    if (stop.stop.kind === 'unsupported' && stop.stop.reason !== '') {
      logNavReasonOnce('unsupported:' + stop.runRef.runId + ':' + stop.stop.reason, stop.stop.reason);
    }
  }
  return { data: nav, cursor };
}

async function readCandidateDetail(client: ReturnType<typeof createHostClient>, scope: CoreScope,
  card: DecisionCardV1): Promise<CandidateDetail> {
  const proposalRef = pinsFor(card, 'PlanProposal')[0]!.ref;
  const goalRef = pinsFor(card, 'Goal')[0]!.ref;
  async function read<T>(route: string, input: unknown): Promise<T | null> {
    try {
      return readyRouteValue<T>(await client.post(route, scope, input), route);
    } catch (error) {
      logReadError(error);
      return null;
    }
  }
  const [proposal, facts] = await Promise.all([
    read<NonNullable<CandidateDetail['proposal']>>('plans/proposal', proposalRef),
    read<CandidateFactsRead>('decisions/candidate-card', { goalRef, proposalRef }),
  ]);
  if (facts !== null) {
    const review = facts.exactReview;
    if (review.status !== 'ready') logReadError(review);
    else if (review.value.status === 'terminal_invalid') logReadError(review.value.reason);
    if (facts.exportRead.status === 'unavailable') logReadError(facts.exportRead.reason);
    if (facts.standardChange.status !== 'ready') logReadError(facts.standardChange);
  }
  return { proposal, facts };
}

/**
 * §2.10: the one decision-queue read Decide and Main share. The section follows
 * `decideDone`, the page follows `decideGoal`, every page keeps its own notice
 * token, and `tasks/query` is read only for Goals that actually carry a Task
 * card. A card-bearing Goal the navigation read already read
 * (`nav.phaseRevision`) is not read twice. `materials/open` stays the caller's
 * on-demand step. Main and Decide also read the waiting candidates' details,
 * structural proposals' file lists and the knowledge notices' recovery facts.
 */

/** The settings snapshot's check rows, by checkId: Decide's facts and the
 * TaskMap's failed-check line share it. A failed read is logged and null. */
async function readSnapshotCheckRows(
  client: ReturnType<typeof createHostClient>, scope: CoreScope,
): Promise<Record<string, DecideCheckRow> | null> {
  try {
    const snapshot = readyRouteValue<SettingsSnapshot>(
      await client.settings('snapshot', {}), 'settings/snapshot');
    const adapted = adaptSettings(snapshot, '', scope.projectId);
    const raw = snapshot.workspaces.flatMap((workspace) => workspace.checks ?? []);
    const rows: Record<string, DecideCheckRow> = {};
    for (const workspace of adapted.workspaces) {
      for (const check of workspace.checks) {
        const own = raw.find((entry) => entry.checkId === check.checkId);
        rows[check.checkId] = { ...check, ...(own === undefined ? {} : { taskIds: own.taskIds }) };
      }
    }
    return rows;
  } catch (error) {
    if (error instanceof RouteReadError) {
      logReadError(error);
      return null;
    }
    throw error;
  }
}

export async function readDecisionQueue(
  client: ReturnType<typeof createHostClient>, scope: CoreScope, nav: NavData,
  demand: BoardReadDemand, workspaceRevision: number, readCardDetails = false,
  readCheckRows = false, readAnswerBody = false,
): Promise<DecideData> {
  const sections: Array<'waiting_answer' | 'notices' | 'answered_pending_application' | 'history'> =
    demand.decideDone === true ? ['answered_pending_application', 'history'] : ['waiting_answer', 'notices'];
  const pages: DecisionQueueReadV1[] = [];
  let after: string | null = null;
  for (let guard = 0; guard < 1000; guard += 1) {
    const input: Record<string, unknown> = {
      workspace: scope, sections,
      page: { limit: 100, ...(after === null ? {} : { cursor: after }) },
    };
    if (demand.decideGoal !== null && demand.decideGoal !== undefined) input.goalRef = { aggregateType: 'Goal', projectId: scope.projectId, goalId: demand.decideGoal };
    const page = readyRouteValue<DecisionQueueReadV1>(
      await client.post('decisions/queue', scope, input), 'decisions/queue');
    pages.push(page);
    after = page.nextCursor ?? null;
    if (after === null) break;
  }
  /* KC-1 G2: each waiting structural card's batch files, by cardKey. `null` is
     that card's failed read; a card without a batch pin is not read. */
  let proposalFiles: Record<string, readonly ProposalBatchFileV1[] | null> | undefined;
  let workspaceNames: Record<string, string> | undefined;
  const candidates: Record<string, CandidateDetail> = {};
  if (readCardDetails) {
    const waiting = pages.flatMap((page) => page.waitingAnswer ?? []);
    for (const card of waiting.filter((row) => row.source.kind === 'candidate')) {
      candidates[card.cardKey] = await readCandidateDetail(client, scope, card);
    }
    const cards = waiting.filter((card) => card.source.kind === 'structural_proposal');
    if (cards.length > 0) {
      const boot = await client.bootstrap();
      workspaceNames = {};
      for (const entry of boot.workspaces) {
        if (entry.scope.projectId === scope.projectId) workspaceNames[entry.scope.workspaceId] = entry.name;
      }
      proposalFiles = {};
      for (const card of cards) {
        const batch = pinsFor(card, 'ArchitectureProposalBatch')[0];
        if (batch === undefined) continue;
        try {
          const read = readyRouteValue<{ files?: readonly ProposalBatchFileV1[] }>(
            await client.post('architecture/proposal-batch-files', scope, { batchRef: batch.ref }),
            'architecture/proposal-batch-files',
          );
          proposalFiles[card.cardKey] = read.files ?? [];
        } catch (error) {
          logReadError(error);
          proposalFiles[card.cardKey] = null;
        }
      }
    }
  }
  /* X9: a knowledge notice's detail. The notice id is the item key's suffix; a
     conflict reads its places first and then the recovery items, the other two
     kinds read only the recovery items. `not_found` is “nothing there”; every
     other failure is that notice's one "暂时读不到" row, logged and not thrown. */
  let noticeFacts: Record<string, KnowledgeNoticeRead> | undefined;
  const notices = pages.flatMap((page) => page.notices ?? []).filter((notice) =>
    notice.noticeKind === 'knowledge_reverted' || notice.noticeKind === 'knowledge_write_unconfirmed'
    || notice.noticeKind === 'knowledge_conflict');
  if (readCardDetails && notices.length > 0) {
    noticeFacts = {};
    for (const notice of notices) {
      const noticeId = notice.itemKey.startsWith('project_notice:')
        ? notice.itemKey.slice('project_notice:'.length) : '';
      let problems: KnowledgeNoticeRead['problems'] = 'not_found';
      let recovery: KnowledgeNoticeRead['recovery'] = null;
      if (notice.noticeKind === 'knowledge_conflict') {
        if (noticeId === '') {
          problems = null;
        } else {
          try {
            problems = readyRouteValue<{ problems: readonly KnowledgeProblemV1[] }>(
              await client.post('knowledge/problems', scope, { noticeId }), 'knowledge/problems').problems;
          } catch (error) {
            if (error instanceof RouteReadError && error.code === 'not_found') problems = 'not_found';
            else { logReadError(error); problems = null; }
          }
        }
      }
      if (noticeId !== '' && problems !== null) {
        try {
          recovery = readyRouteValue<{ items: readonly KnowledgeRecoveryItemV1[] }>(
            await client.post('knowledge/recovery-items', scope, { noticeId }), 'knowledge/recovery-items').items;
        } catch (error) {
          if (error instanceof RouteReadError && error.code === 'not_found') recovery = 'not_found';
          else { logReadError(error); recovery = null; }
        }
      }
      noticeFacts[notice.itemKey] = notice.noticeKind === 'knowledge_conflict'
        ? { recovery, problems } : { recovery };
    }
  }
  const tasks: Record<string, unknown | null> = {};
  const goalIds = new Set<string>();
  for (const page of pages) {
    for (const card of [...(page.waitingAnswer ?? []), ...(page.answeredPendingApplication ?? []), ...(page.history ?? [])]) {
      const triple = taskTripleOf(card);
      if (triple !== null) goalIds.add(triple.goalId);
    }
  }
  for (const id of goalIds) {
    if (id === nav.selectedGoalId && nav.phaseRevision !== null) {
      /* §2.3 step 1 already read this Goal's graph; a card is not a reason to
         read the same `tasks/query` again. */
      tasks[id] = nav.tasks;
      continue;
    }
    try {
      tasks[id] = readyRouteValue<unknown>(await client.post('tasks/query', scope,
        { goalRef: { aggregateType: 'Goal', projectId: scope.projectId, goalId: id } }), 'tasks/query');
    } catch (error) {
      if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
      tasks[id] = null;
    }
  }
  /* Y3: the settings snapshot's checks, only for a Decide read with a Task-bearing
     stop card (the facts' failed-check commands and the withdraw step need them).
     A failed read is that block's one “命令暂时读不到”, logged and not thrown. */
  let checkRows: Record<string, DecideCheckRow> | null | undefined;
  if (readCheckRows) {
    const cards = pages.flatMap((page) => page.waitingAnswer ?? [])
      .filter((card) => card.source.kind === 'goal_cause' && taskTripleOf(card) !== null);
    if (cards.length > 0) checkRows = await readSnapshotCheckRows(client, scope);
  }
  /* Y12: the selected answered card's body, read here so `adaptDecide` can turn
     the canonical JSON into the person's line and the annotation rows. */
  const answerBodies: Record<string, string> = {};
  if (readAnswerBody && demand.decideAnswer !== null && demand.decideAnswer !== undefined) {
    const card = pages.flatMap((page) => [
      ...(page.waitingAnswer ?? []), ...(page.answeredPendingApplication ?? []), ...(page.history ?? []),
    ]).find((entry) => entry.cardKey === demand.decideAnswer) ?? null;
    const bodyRef = card?.answer?.bodyRef ?? null;
    if (bodyRef !== null && bodyRef !== undefined) {
      const material = readyRouteValue<{ body?: unknown }>(await client.post('materials/open', scope,
        { ref: bodyRef, usage: 'historical_explanation' }), 'materials/open');
      answerBodies[demand.decideAnswer] = asText(material.body);
    }
  }
  return adaptDecide({
    nav, scope, workspaceRevision, queue: pages, tasks, candidates, selectedGoalId: nav.selectedGoalId,
    ...(proposalFiles === undefined ? {} : { proposalFiles }),
    ...(noticeFacts === undefined ? {} : { noticeFacts }),
    ...(workspaceNames === undefined ? {} : { workspaceNames }),
    ...(checkRows === undefined ? {} : { checkRows }),
    ...(Object.keys(answerBodies).length === 0 ? {} : { answerBodies }),
  }, {
    tab: demand.decideDone === true ? 'done' : 'open',
    goalFilter: demand.decideGoal ?? null,
    selectedCardKey: demand.decideAnswer ?? null,
    factsOpen: false, step: null, form: {}, lineKey: demand.lineKey ?? null,
  });
}

/**
 * E3-DECIDE §2.2: the Decide read. The navigation segment is `readNav`'s one
 * read (so the rail keeps the workspace's own counts, Y1); the queue body is
 * the shared `readDecisionQueue`. The GoalPhase pin is taken from a card-bearing
 * Goal's own `tasks/query`; `materials/open` is the one on-demand read
 * (§2.2 step 9).
 */
export async function readDecide(
  client: ReturnType<typeof createHostClient>, goalId: string | null,
  demand: BoardReadDemand = {},
): Promise<RefreshRead<DecideData>> {
  const boot = await client.bootstrap();
  const cursor = boot.changesHead ?? null;
  const found = await taskMapScope(client, boot.workspaces, goalId);
  if (found === null) return { data: null, cursor };
  const scope = found.scope;
  /* D8: the Workspace pin is the record's current revision, not the Host
     configuration number `bootstrap.workspaces[]` was opened with. */
  const registration = readyRouteValue<{ workspace: { ref: unknown; revision: number } }>(
    await client.post('workspaces/registration', scope, scope), 'workspaces/registration',
  );
  /* §2.2 step 8: the GoalPhase pin is taken only from a card-bearing Goal's
     own `tasks/query`; the navigation read does not make a second read for an
     empty rail. */
  const navRead = await readNav(client, goalId, demand, boot, false);
  if (navRead.data === null) return { data: null, cursor };
  /* The page's goal filter follows the URL's Goal on the first read; a later
     readMore that clears it passes `decideGoal: null` explicitly. */
  const queueDemand: BoardReadDemand = demand.decideGoal === undefined && goalId !== null
    ? { ...demand, decideGoal: goalId } : demand;
  const queue = await readDecisionQueue(client, scope, navRead.data, queueDemand,
    registration.workspace.revision, true, true, true);
  /* §2.2 step 8: a card-bearing selected Goal hands its own `tasks/query`
     completion revision to the navigation segment; no separate read. A
     `not_found` read is still a read and keeps the original 0. */
  if (goalId !== null && queue.taskGoalIds.includes(goalId)) {
    navRead.data.phaseRevision = completionRevisionOf(queue.plans[goalId]);
  }
  /* Z1: one `tasks/query` per Goal per read, shared by the right panel and the
     open line. A Goal with a card already read its graph in `readDecisionQueue`. */
  const taskGraphs: Record<string, unknown | null> = {};
  const graphOf = async (goal: string | null): Promise<TaskGraph | null> => {
    if (goal === null) return null;
    if (Object.prototype.hasOwnProperty.call(taskGraphs, goal)) return taskGraphs[goal] as TaskGraph | null;
    let graph: TaskGraph | null;
    if (queue.taskGoalIds.includes(goal)) {
      graph = (queue.plans[goal] ?? null) as TaskGraph | null;
    } else {
      try {
        graph = readyRouteValue<TaskGraph>(await client.post('tasks/query', scope, {
          goalRef: goalRefIn(scope.projectId, goal),
        }), 'tasks/query');
      } catch (error) {
        if (!(error instanceof RouteReadError)) throw error;
        if (error.code !== 'not_found') logReadError(error);
        graph = null;
      }
    }
    taskGraphs[goal] = graph;
    return graph;
  };
  /* Z1: the right panel reads only its open tab; other tabs (and a closed panel)
     leave `aux` null. */
  let aux: AuxPanelData | null = null;
  if (demand.auxTab === 'task' || demand.auxTab === 'arch') {
    const goal = demand.mapGoal ?? navRead.data.selectedGoalId;
    const tasks = await graphOf(goal);
    aux = await readAuxPanel(client, scope, { ...navRead.data, selectedGoalId: goal, tasks }, {
      auxTab: demand.auxTab, auxPath: null, detailTaskId: demand.detailTaskId ?? null,
      workOnly: demand.workOnly === true,
    }, { allowed: false, runs: {} });
  }
  /* Z5: the open line's record, through the same read and projection Member uses.
     A failed line read is that view's page text; every other failure fails the read. */
  let line: { line: MemberLine; write: MemberWriteBasis | null } | null = null;
  let lineError: string | null = null;
  if (demand.lineKey !== null && demand.lineKey !== undefined
    && navRead.data.detail !== null && navRead.data.detail.kind === 'line') {
    const lineGoal = taskOfLine(navRead.data.detail.row)?.goalId ?? null;
    const lineTasks = lineGoal === null ? null : await graphOf(lineGoal);
    try {
      const source = await readLineFacts(client, scope, demand.lineKey, navRead.data.detail,
        { ...navRead.data, tasks: lineTasks }, { record: false, taskGraphRead: true });
      const memberLine = adaptMemberLine(source, navRead.data.detail);
      const write = writeBasisOf(navRead.data, memberLine, source.execution, source.taskGraph);
      line = { line: memberLine, write };
    } catch (error) {
      if (!(error instanceof RouteReadError)) throw error;
      logReadError(error);
      line = null;
      lineError = pageTextOf(error);
    }
  }
  return { data: { ...queue, aux, line, lineError }, cursor };
}

/**
 * The browser copy of `consultationQueryRefs` (`contracts/query-job.ts:138`).
 * That module imports `node:crypto` for its sha256, which the browser bundle
 * cannot load; this function hashes the same canonical message reference with
 * WebCrypto and yields the same id. It is the one place the UI builds that
 * identity; a Host-only helper is not usable here.
 */
export async function consultationQueryRefsForUi(messageRef: SessionMessageRef): Promise<{
  queryJobRef: { aggregateType: 'QueryJob'; projectId: string; workspaceId: string; queryJobId: string };
}> {
  const canonical = (value: unknown): string => {
    if (value === null) return 'null';
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('canonical JSON: non-finite number');
      return JSON.stringify(value);
    }
    if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    const row = asRecord(value);
    return '{' + Object.keys(row).sort().map((key) => JSON.stringify(key) + ':' + canonical(row[key])).join(',') + '}';
  };
  const bytes = new TextEncoder().encode(canonical(messageRef));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return { queryJobRef: {
    aggregateType: 'QueryJob', projectId: messageRef.projectId,
    workspaceId: messageRef.workspaceId, queryJobId: 'consultation-' + hash,
  } };
}

/**
 * §2.2: the one line record read Member's page and Main's line view share. It
 * reads the four `lines/page` sections, each shown message's `messages/view`
 * and body, the current Run's `executions/read` + `controls/read` +
 * `executions/brief`, the shown copies' Query/answer, and (only when the line
 * serves another Goal) that Goal's `tasks/query`. `history`/`files`/`hover`/
 * `write` stay the wrapper's. `record: false` is the Decide line view: it reads
 * only the executions page, the current Run and its control, and skips the
 * messages/copies/participation pages, the brief and the drawn run steps.
 * `taskGraphRead: true` says the caller already put the line Goal's graph (a
 * `not_found` included) into `nav.tasks`, so no supplement is read here.
 */
export async function readLineFacts(
  client: ReturnType<typeof createHostClient>, scope: CoreScope, key: LineKey,
  detail: WorkLineDetailV1, nav: NavData,
  options: { record?: boolean; taskGraphRead?: boolean } = {},
): Promise<MemberSource> {
  const record = options.record !== false;
  let executions: LineExecutionItemV1[] = [];
  let messages: LineMessageStateV1[] = [];
  const messageViews: SessionMessageReadV1[] = [];
  const messageBodies: Record<string, MessageBody> = {};
  const copies: MemberCopySource[] = [];
  let execution: TaskExecutionRecord | null = null;
  let controls: ControlIntentSnapshotV1 | null = null;
  let brief: { brief: ContinuationBriefV1; digest: string } | null = null;
  let taskGraph: TaskGraph | null = nav.tasks;
  const pageOf = async (section: WorkLineSectionPageV1['section']): Promise<WorkLineSectionPageV1> =>
    readyRouteValue<WorkLineSectionPageV1>(await client.post('lines/page', scope, {
      workspace: scope, key, section, page: { limit: 100 },
    }), 'lines/page');
  const executionPage = await pageOf('executions');
  executions = executionPage.section === 'executions' ? executionPage.items : [];
  let copyItems: MemberCopySource['item'][] = [];
  if (record) {
    const messagePage = await pageOf('messages');
    messages = messagePage.section === 'messages' ? messagePage.items : [];
    const copyPage = await pageOf('copies');
    copyItems = copyPage.section === 'copies' ? copyPage.items : [];
    await pageOf('participation');
  }
  for (const item of messages) {
    const view = readyRouteValue<SessionMessageReadV1>(
      await client.post('messages/view', scope, item.messageRef), 'messages/view');
    messageViews.push(view);
    for (const part of ['message', 'response'] as const) {
      if (part === 'response' && view.message.response === null) continue;
      try {
        messageBodies[messageBodyKey(item.messageRef, part)] = readyRouteValue<MessageBody>(
          await client.post('messages/body', scope, { messageRef: item.messageRef, part }), 'messages/body');
      } catch (error) {
        if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
      }
    }
  }
  for (const item of copyItems) {
    const refs = await consultationQueryRefsForUi(item.messageRef);
    let query: QueryExecutionRecord | null = null;
    let answer: QueryJobAnswerSnapshot | null = null;
    try {
      query = readyRouteValue<QueryExecutionRecord>(
        await client.post('queries/read', scope, refs.queryJobRef), 'queries/read');
    } catch (error) {
      if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
    }
    const answerRef = query?.job.job.answerRefs.at(-1) ?? null;
    if (answerRef !== null) {
      try {
        answer = readyRouteValue<QueryJobAnswerSnapshot>(
          await client.post('queries/answer', scope, answerRef), 'queries/answer');
      } catch (error) {
        if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
      }
    }
    copies.push({ item, query, answer });
  }
  const executionItems = executions.filter((entry) => entry.kind === 'execution');
  const live = executionItems.filter((entry) => entry.status === 'running' || entry.status === 'starting');
  const ended = executionItems.filter((entry) => entry.status === 'ended');
  const current = live.at(-1) ?? ended.at(-1) ?? null;
  if (current !== null) {
    execution = readyRouteValue<TaskExecutionRecord>(
      await client.post('executions/read', scope, current.runRef), 'executions/read');
  }
  const intentRef = execution?.run.controlState?.intentRef ?? null;
  if (intentRef !== null) {
    controls = readyRouteValue<ControlIntentSnapshotV1>(
      await client.post('controls/read', scope, intentRef), 'controls/read');
  }
  /* S6: a QueryRun's unknown cause is in its own record; a Run's page already
     says why (the head's 待核对 and the task card). */
  let attestWhy: string | null = null;
  const attest = detail.row.controls.find((entry) => entry.kind === 'attest_unknown'
    && entry.availability === 'available') ?? null;
  const attestQuery = attest?.target.queryRunRef;
  if (attestQuery !== undefined) {
    try {
      const query = readyRouteValue<QueryExecutionRecord>(
        await client.post('queries/read', scope, {
          aggregateType: 'QueryJob', projectId: attestQuery.projectId,
          workspaceId: attestQuery.workspaceId, queryJobId: attestQuery.queryJobId,
        }), 'queries/read');
      attestWhy = queryUnknownTextOf(query.run.run.executionState?.unknown);
    } catch (error) {
      logReadError(error);
    }
  }
  if (record && execution !== null && execution.run.requeueRef !== undefined) {
    brief = readyRouteValue<{ brief: ContinuationBriefV1; digest: string } | null>(
      await client.post('executions/brief', scope, { runRef: execution.run.ref }), 'executions/brief');
  }
  /* §2.4 step 6: a line may own a task of another Goal; its own graph is read
     once, never the selected Goal's graph. */
  if (options.taskGraphRead !== true) {
    const lineTask = taskOfLine(detail.row);
    if (lineTask !== null && lineTask.goalId !== (nav.selectedGoalId ?? '')) {
      try {
        taskGraph = readyRouteValue<TaskGraph>(
          await client.post('tasks/query', scope, { goalRef: goalRefIn(scope.projectId, lineTask.goalId) }), 'tasks/query');
      } catch (error) {
        if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
        taskGraph = null;
      }
    }
  }
  /* The line's own Goal graph rides as `nav.tasks` too, as `readMember` gave
     its adapter before the extraction (the selected Goal's when they match). */
  const runStepsByRun = record
    ? await readDrawnRunSteps(client, scope, nav, key, executions, execution)
    : new Map<string, MainRunSteps>();
  return {
    scope, nav: { ...nav, tasks: taskGraph }, line: detail, ownKey: key,
    executions, messages, messageViews, messageBodies, copies, controls, brief,
    history: null, files: null, hover: null, execution, taskGraph, write: null, startup: null, startupError: null,
    creators: null, runStepsByRun, runHosts: null, waits: [], attestWhy,
  };
}

/**
 * §2.2: the one requeue basis both pages use; it reads only the public Task
 * row (`effectivePhase` + `failure.requeueActors`) and the shown Goal's
 * revision. `null` when either is not loaded.
 */
export function writeBasisOf(
  nav: NavData, line: MemberLine, execution: TaskExecutionRecord | null, taskGraph: TaskGraph | null,
): MemberWriteBasis | null {
  if (execution === null || line.taskRef === null) return null;
  const taskRef = line.taskRef;
  const taskRow = taskGraph?.tasks.find((row) => row.ref.projectId === taskRef.projectId
    && row.ref.goalId === taskRef.goalId && row.ref.taskId === taskRef.taskId) ?? null;
  const goalRow = taskRow === null ? null : nav.goals.find((goal) => goal.goalId === taskRow.ref.goalId) ?? null;
  if (taskRow === null || goalRow === null || !requeueVisible(taskRow)) return null;
  return {
    taskRef: taskRow.ref, afterRunRef: execution.run.ref, runRevision: execution.run.revision,
    goalRef: goalRefIn(taskRow.ref.projectId, goalRow.goalId),
    goalRevision: goalRow.revision,
  };
}

/**
 * E3 Member §2.4: one read for the member page. The chrome is `readNav`'s
 * (the selected line's `lines/read` included); this reader adds the line's
 * four first pages, the shown messages' view/body, the current Run's
 * execution/control/brief, the shown copies' Query/answer, and the two
 * on-demand tabs. The line may be missing: the rail stays and the page says so.
 */
export async function readMember(
  client: ReturnType<typeof createHostClient>, goalId: string | null,
  demand: BoardReadDemand = {},
): Promise<RefreshRead<MemberData>> {
  const requested = demand.lineKey ?? null;
  let nav: NavData | null;
  let cursor: string | null;
  let missing = false;
  try {
    const read = await readNav(client, goalId, { ...demand, lineKey: requested });
    nav = read.data;
    cursor = read.cursor;
  } catch (error) {
    if (!(error instanceof RouteReadError) || error.code !== 'not_found' || requested === null) throw error;
    /* §2.13: a line named by the URL is gone. Keep the rail, drop only the line. */
    missing = true;
    const read = await readNav(client, goalId, { ...demand, lineKey: null });
    nav = read.data;
    cursor = read.cursor;
  }
  if (nav === null || nav.scope === null) return { data: null, cursor };
  const scope = nav.scope;
  /* B2: one whole-workspace role-line read per page read fills every rail card's
     建它的; a failed read leaves the cards without that row, never a guess. */
  let creators: ReadonlyMap<string, CreatorContactV1> | null = null;
  try {
    const roleLines = readyRouteValue<{ rows: Array<{ row: { key: LineKey }; creator: CreatorContactV1 }> }>(
      await client.post('role-lines/read', scope, { workspace: scope }), 'role-lines/read');
    creators = new Map(roleLines.rows.map((line) => [
      line.row.key.projectId + '/' + line.row.key.sessionId, line.creator,
    ]));
  } catch (error) {
    logReadError(error);
  }
  /* B6: the open Run detail's network record, read once while that detail is
     open; a failed read says so in that row, never as the page's error. */
  let runHosts: MemberSource['runHosts'] = null;
  if (demand.memberRunHosts !== undefined && demand.memberRunHosts !== null) {
    const ref = demand.memberRunHosts;
    try {
      const snapshot = readyRouteValue<RunNetworkSnapshotV1 | null>(
        await client.post('network/read', scope, { subject: ref }), 'network/read');
      runHosts = { runRef: ref, text: snapshot === null ? '这次执行没有连过外网' : runHostsTextOf(snapshot) };
    } catch (error) {
      logReadError(error);
      runHosts = { runRef: ref, text: '暂时读不到' };
    }
  }
  /* §2.4: the Host's start-up report is read once per page read; the Member
     page's 启动核对 section lists its reconcile lines. A failed read is that
     section's own 错误和重试: the line, the conversation and the controls stay. */
  let startup: ReturnType<typeof startupReportOf> = null;
  let startupError: string | null = null;
  try {
    const startupRead = readyRouteValue<unknown>(
      await client.post('host/reconcile-report', scope, {}), 'host/reconcile-report');
    startup = startupReportOf(startupRead);
  } catch (error) {
    logReadError(error);
    startupError = pageTextOf(error);
  }
  let key = requested;
  if (key === null) {
    key = nav.lines.find((row) => !row.synth && !row.archived)?.key ?? null;
    if (key !== null) {
      demand.lineKey = key;
      demand.ownKey = key;
    }
  }
  let line: LineReadValue | null = requested !== null && !missing
    ? nav.detail as unknown as LineReadValue : null;
  if (key !== null && line === null && !missing) {
    try {
      line = await readLine(client, scope, key);
    } catch (error) {
      if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
      line = null;
    }
  }
  let source: MemberSource;
  if (line !== null && line.kind === 'line' && key !== null) {
    source = await readLineFacts(client, scope, key, line, nav);
    source.startup = startup;
    source.startupError = startupError;
    /* The page's own line, not the selected one (§2.4: the rail's `current`). */
    source.ownKey = demand.ownKey ?? key;
  } else {
    /* A missing/branched line keeps the rail; the centre has no record. */
    source = {
      scope, nav, line, ownKey: demand.ownKey ?? key,
      executions: [], messages: [], messageViews: [], messageBodies: {}, copies: [],
      controls: null, brief: null, history: null, files: null, hover: null,
      execution: null, taskGraph: nav.tasks, write: null, startup, startupError, creators,
      runStepsByRun: new Map(), runHosts: null, waits: [], attestWhy: null,
    };
  }
  source.creators = creators;
  source.runHosts = runHosts;
  /* S7: the Member page's one line reads its open waits once; a failed read
     leaves the card without that row and is logged, never drawn as a code. */
  if (source.line !== null && source.line.kind === 'line' && key !== null) {
    try {
      const facts = readyRouteValue<{ waits?: unknown }>(
        await client.post('sessions/facts', scope, key), 'sessions/facts');
      source.waits = waitRowsOf(facts.waits, nav);
    } catch (error) {
      logReadError(error);
    }
  }
  if (demand.traceOpen === true && key !== null) {
    source.history = await readSessionTrace(client, scope, key);
  }
  if (demand.changesOpen === true) {
    const page = await readUncommittedPage(client, scope);
    source.files = page.files;
    /* Member's 只列了部分 is only `files/list`'s own `partial` (lead 11-12 item 4). */
    source.filesPartial = page.partial;
  }
  if (nav.selectedGoalId !== null) {
    try {
      source.hover = readyRouteValue<GraphHoverReadV1>(
        await client.post('graph/hover', scope, { goalRef: goalRefIn(scope.projectId, nav.selectedGoalId) }), 'graph/hover');
    } catch (error) {
      /* A Goal without an adopted Plan has no graph to hover; `readTaskMap`
         already reads the same `unavailable` as empty. */
      if (!(error instanceof RouteReadError) || error.code !== 'unavailable') throw error;
      source.hover = null;
    }
  }
  /* A5/A8: every Run block this record draws was read by `readLineFacts`; the
     one running-commands read matches all of their live steps. */
  await readRunningCommandSteps(client, scope, [...source.runStepsByRun.values()]);
  if (source.line !== null && source.line.kind === 'line') {
    source.write = writeBasisOf(nav, adaptMemberLine(source, source.line), source.execution, source.taskGraph);
  }
  return { data: adaptMember(source, key), cursor };
}

/** The two write seams of the Chain reader: the scope of the last successful
 * read and the Task/Run/Goal pins of its newest Run (§2.7). One page reads at
 * a time, as the module's other board-specific write facts do. */
let latestChainScope: CoreScope | null = null;
let latestChainWrite: {
  taskRef: ChainSource['runs'][number]['run']['task'];
  afterRunRef: ChainSource['runs'][number]['run']['ref'];
  runRevision: number;
  goalRef: { aggregateType: 'Goal'; projectId: string; goalId: string };
  goalRevision: number;
} | null = null;

/**
 * E3 Chain §2.4: one read for the chain page. The chrome and the selected
 * line's `lines/read` are `readNav`'s; this reader adds the Goal's waiting
 * count, the line's executions paged to the newest ten, and each of those
 * Runs' execution/history/brief/round reads. The line may be missing: the
 * rail stays and the page says so.
 */
export async function readChain(
  client: ReturnType<typeof createHostClient>, goalId: string | null,
  demand: BoardReadDemand = {},
): Promise<RefreshRead<ChainData>> {
  const requested = demand.lineKey ?? null;
  let nav: NavData | null;
  let cursor: string | null;
  let missing = false;
  try {
    /* §2.2: the archive expansion is Chain's own first page; `readNav` must
       not follow every archived page. */
    const read = await readNav(client, goalId, { ...demand, lineKey: requested, archive: false }, undefined, true);
    nav = read.data;
    cursor = read.cursor;
  } catch (error) {
    if (!(error instanceof RouteReadError) || error.code !== 'not_found' || requested === null) throw error;
    missing = true;
    const read = await readNav(client, goalId, { ...demand, lineKey: null, archive: false }, undefined, true);
    nav = read.data;
    cursor = read.cursor;
  }
  if (nav === null || nav.scope === null) return { data: null, cursor };
  const scope = nav.scope;
  const chainGoalRefOf = (id: string) => ({ aggregateType: 'Goal' as const, projectId: scope.projectId, goalId: id });
  /* DC3: the URL's line, else the selected Goal's first executor line, else
     its first non-secretary line; never the synthetic main-conversation row
     and never another Goal's line (a Goal without lines has no centre line). */
  const goalLines = nav.lines.filter((row) => !row.synth && row.goalId === nav.selectedGoalId);
  const key = requested ?? goalLines.find((row) => row.duty === 'executor')?.key
    ?? goalLines.find((row) => row.duty !== 'secretary')?.key ?? null;
  /* §2.6 L1: the page's own line is fixed at entry; a rail click opens another
     one through `lineKey`, and going back targets this one. */
  const ownKey = demand.ownKey ?? requested ?? key;
  if (ownKey !== null) demand.ownKey = ownKey;
  let line: ChainSource['line'] = null;
  let detail: WorkLineDetailV1 | null = null;
  if (key !== null && !missing) {
    if (requested !== null && nav.detail !== null && nav.detail.kind === 'line') {
      detail = nav.detail;
      line = nav.detail.row;
    } else {
      try {
        const read = await readLine(client, scope, key);
        if (read.kind === 'line') {
          detail = read;
          line = read.row;
        }
      } catch (error) {
        if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
        line = null;
      }
    }
  }

  let goalWaiting: number | null = null;
  let goalWaitingPartial = false;
  if (nav.selectedGoalId !== null) {
    try {
      const queue = readyRouteValue<TaskMapQueueRead>(
        await client.post('decisions/queue', scope, {
          workspace: scope, sections: ['waiting_answer', 'notices'], page: { limit: 1 },
          goalRef: chainGoalRefOf(nav.selectedGoalId),
        }), 'decisions/queue');
      if (typeof queue.counts?.waitingAnswer === 'number') goalWaiting = queue.counts.waitingAnswer;
      goalWaitingPartial = decisionCardCountPartial(queue);
    } catch (error) {
      /* The rail's own waiting count already read; a per-Goal count that
         cannot be read stays `null`, not a made-up 0. */
      if (!(error instanceof RouteReadError)) throw error;
      goalWaiting = null;
    }
  }

  /* §2.4: follow the owner's page order to its end, then keep the newest ten
     execution items; queries are not this board's rows. */
  let segments: Array<Extract<WorkLineSectionPageV1, { section: 'executions' }>['segments'][number]> = [];
  let sourceCursor: Extract<WorkLineSectionPageV1, { section: 'executions' }>['sourceCursor'] | null = null;
  const executions: Array<Extract<LineExecutionItemV1, { kind: 'execution' }>> = [];
  if (key !== null && line !== null) {
    let after: string | null = null;
    for (let guard = 0; guard < 1000; guard += 1) {
      const page: WorkLineSectionPageV1 = readyRouteValue<WorkLineSectionPageV1>(await client.post('lines/page', scope, {
        workspace: scope, key, section: 'executions',
        page: { limit: 100, ...(after === null ? {} : { cursor: after }) },
      }), 'lines/page');
      if (page.section !== 'executions') break;
      segments = page.segments;
      sourceCursor = page.sourceCursor;
      for (const item of page.items) if (item.kind === 'execution') executions.push(item);
      after = page.nextCursor;
      if (after === null) break;
    }
  }
  const tail = executions.slice(-10);
  const runs: ChainSource['runs'] = [];
  const histories: ChainSource['histories'] = {};
  const briefs: ChainSource['briefs'] = {};
  const rounds: ChainSource['rounds'] = {};
  for (const item of tail) {
    const record = readyRouteValue<TaskExecutionRecord>(
      await client.post('executions/read', scope, item.runRef), 'executions/read');
    runs.push(record);
    const runId = item.runRef.runId;
    histories[runId] = readyRouteValue<ChainSource['histories'][string]>(
      await client.post('executions/history', scope, { runRef: item.runRef, afterCursor: null, limit: 200 }),
      'executions/history');
    if (record.run.requeueRef !== undefined) {
      briefs[runId] = readyRouteValue<ChainSource['briefs'][string]>(
        await client.post('executions/brief', scope, { runRef: item.runRef }), 'executions/brief');
    }
    let main: ChainSource['rounds'][string][number] | null = null;
    try {
      main = readyRouteValue<ChainSource['rounds'][string][number]>(
        await client.post('verification/round', scope, { subjectRunRef: item.runRef }), 'verification/round');
    } catch (error) {
      /* §2.12: a Run with no verification round is an empty row, not a page error. */
      if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
      main = null;
    }
    const reads: ChainSource['rounds'][string] = [];
    if (main !== null) {
      /* §2.8: every round of the chain is read by its roundRef, in the chain's
         order, with no four-round cap; one round's failed check read only
         leaves its checks empty. */
      for (const entry of main.chain.rounds) {
        try {
          reads.push(readyRouteValue<ChainSource['rounds'][string][number]>(
            await client.post('verification/round', scope, { roundRef: entry.roundRef }), 'verification/round'));
        } catch (error) {
          if (!(error instanceof RouteReadError)) throw error;
          reads.push({
            ...entry, displayStatus: entry.status === 'open' ? 'incomplete' : 'completed',
            checks: [], gaps: [],
            /* A10: the head chain's reverify belongs to the head round, never to
               this failed read; its `autoCount` is the chain's own count. */
            chain: { ...main.chain, reverify: null }, delivery: { requirements: [] },
          } as unknown as ChainSource['rounds'][string][number]);
        }
      }
    }
    rounds[runId] = reads;
  }

  const lastRun = runs.at(-1) ?? null;
  /* A1: every drawn Run's steps, from the page's own `executions/read`s (no
     second read of the same Run) and one running-commands match. */
  const runStepsByRun = key === null || line === null
    ? new Map<string, MainRunSteps>()
    : await readDrawnRunSteps(client, scope, nav, key, tail, lastRun, runs);
  await readRunningCommandSteps(client, scope, [...runStepsByRun.values()]);

  /* A7: each Run's hosts. An ended Run cannot reach another host (the proxy
     records before it connects), so its answer is kept for this page; a live
     Run is read again with every 5 s refresh. */
  const hosts: ChainSource['hosts'] = {};
  for (const run of runs) {
    const ref = run.run.ref;
    const hostKey = runWorkspaceKeyOf(ref);
    if (run.run.status === 'ended' && pageRunHosts.has(hostKey)) {
      hosts[ref.runId] = pageRunHosts.get(hostKey) ?? null;
      continue;
    }
    try {
      const snapshot = readyRouteValue<RunNetworkSnapshotV1 | null>(
        await client.post('network/read', scope, { subject: ref }), 'network/read');
      hosts[ref.runId] = snapshot;
      if (run.run.status === 'ended') pageRunHosts.set(hostKey, snapshot);
    } catch (error) {
      logReadError(error);
      hosts[ref.runId] = null;
    }
  }

  /* §2.4: the shown stop marker's or Run's control state, each intent once. */
  const controls: ChainSource['controls'] = {};
  const intentKeys = new Set<string>();
  const readChainControl = async (ref: { projectId: string; workspaceId: string; intentId: string } | undefined): Promise<void> => {
    if (ref === undefined) return;
    const keyOf = ref.projectId + '/' + ref.workspaceId + '/' + ref.intentId;
    if (intentKeys.has(keyOf)) return;
    intentKeys.add(keyOf);
    controls[keyOf] = readyRouteValue<ControlIntentSnapshotV1>(
      await client.post('controls/read', scope, ref), 'controls/read');
  };
  for (const marker of line?.status.markers ?? []) {
    if (marker.kind === 'stop_pending') await readChainControl(marker.intentRef);
  }
  for (const run of runs) await readChainControl(run.run.controlState?.intentRef);

  /* A5: one `materials/open` for the trace record the page selected; a failed
     read is that block's one sentence, never the page's failure. */
  let recordBody: ChainSource['recordBody'] = null;
  if (demand.chainRecord !== null && demand.chainRecord !== undefined) {
    const wanted = demand.chainRecord;
    const found = Object.values(histories).flatMap((history) => history.items)
      .find((entry) => entry.recordId === wanted) ?? null;
    if (found !== null && !('encoding' in found.body)) {
      try {
        const material = readyRouteValue<{ body?: unknown }>(await client.post('materials/open', scope,
          { ref: found.body, usage: 'historical_explanation' }), 'materials/open');
        recordBody = { recordId: wanted, text: asText(material.body) };
      } catch (error) {
        logReadError(error);
        recordBody = { recordId: wanted, error: true };
      }
    }
  }

  let archive: ChainSource['archive'] = null;
  if (demand.archive === true) {
    /* R8: the first page only; a non-empty cursor is a reported truncation,
       not a reason to page. */
    archive = readyRouteValue<ChainSource['archive']>(await client.post('lines/archived', scope, {
      workspace: scope, page: { limit: 100 },
    }), 'lines/archived');
  }

  /* §8.3 A: the selected Goal's graph is `readNav`'s; a selected line may
     serve another Goal, whose graph is read once here. */
  const lineTask = line === null ? null : taskOfLine(line);
  let tasks: unknown = nav.tasks;
  if (lineTask !== null && lineTask.goalId !== (nav.selectedGoalId ?? '')) {
    try {
      tasks = readyRouteValue<TaskGraph>(
        await client.post('tasks/query', scope, { goalRef: chainGoalRefOf(lineTask.goalId) }), 'tasks/query');
    } catch (error) {
      /* §2.12: `tasks/query` not_found is "no adopted Plan", not a read error. */
      if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
      tasks = null;
    }
  }
  const graph = tasks === null || tasks === undefined ? null : tasks as TaskGraph;
  const taskRef = lastRun?.run.task ?? null;
  const taskRow = taskRef === null ? null : graph?.tasks.find((row) => row.ref.projectId === taskRef.projectId
    && row.ref.goalId === taskRef.goalId && row.ref.taskId === taskRef.taskId) ?? null;
  const goalRow = taskRow === null ? null : nav.goals.find((goal) => goal.goalId === taskRow.ref.goalId) ?? null;
  latestChainScope = scope;
  latestChainWrite = lastRun !== null && taskRow !== null && goalRow !== null && requeueVisible(taskRow)
    ? {
      taskRef: lastRun.run.task, afterRunRef: lastRun.run.ref, runRevision: lastRun.run.revision,
      goalRef: chainGoalRefOf(goalRow.goalId), goalRevision: goalRow.revision,
    }
    : null;

  const source: ChainSource = {
    nav, line, detail, archive,
    executions: key === null ? null : {
      section: 'executions', segments, scope: 'indexed', items: tail, nextCursor: null,
      sourceCursor: sourceCursor ?? ('' as never),
    },
    runs, histories, briefs, rounds, tasks, goalWaiting, goalWaitingPartial, controls,
    runStepsByRun, hosts, recordBody,
  };
  return { data: adaptChain(source, { selected: key, ownKey, dens: '标准', theme: 'dark' }), cursor };
}

/** §2.4：一次 `files/read`，读工作区或一个固定提交；`maxBytes` 同文件页。 */
async function readAuxFile(
  client: ReturnType<typeof createHostClient>, scope: CoreScope, path: string,
  version: { kind: 'working_tree' } | { kind: 'git'; commit: string } = { kind: 'working_tree' },
): Promise<AuxFilePage> {
  return auxFilePageOf(readyRouteValue<AuxWorkspaceFile>(await client.post('files/read', scope, {
    workspace: { aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId },
    path, maxBytes: 1_048_576, version,
  }), 'files/read'));
}

/**
 * P3 Diff 页一侧的正文，读法同 readAuxFile。`not_found` 是这一侧没有，`content` 为 null（新文件没有 HEAD 一侧，
 * 删掉的文件没有工作区一侧）；`unsupported` 是不是文本（B2，这一侧不画）；其余失败往外抛，Diff 页按文件
 * 接下（改动清单照常、逐行区写页面文字，下次刷新再读）。
 * 正文包一层再回，不和 `'not_text'` 并成一个字符串：正文恰好是 not_text 的文件不会被当成不是文本。
 */
async function readDiffSide(
  client: ReturnType<typeof createHostClient>, scope: CoreScope, path: string, version: Parameters<typeof readAuxFile>[3],
): Promise<{ content: string | null } | 'not_text'> {
  try {
    return { content: (await readAuxFile(client, scope, path, version)).content };
  } catch (error) {
    if (!(error instanceof RouteReadError)) throw error;
    if (error.code === 'not_found') return { content: null };
    if (error.code === 'unsupported') return 'not_text';
    throw error;
  }
}

/**
 * §2.3/第三轮 Main 8, lead 11-12 ruling 1: the one `files/list` +
 * `files/uncommitted` read Member's changes tab and Main's file/Diff tabs
 * share. `paths` is the full listing; `partial` is `files/list`'s own
 * truncation fact (Member's 只列了部分); `checkedFirst` is how many files the
 * uncommitted read checked when that is not every file of the workspace (the
 * listing passed 100, or the listing itself is partial), and `null` when it
 * checked them all (lead 11-12 item 4). The first 100 paths are one
 * `uncommittedPagesOf` call; an empty listing makes none, so `files` is null.
 */
async function readUncommittedPage(
  client: ReturnType<typeof createHostClient>, scope: CoreScope,
): Promise<{ files: UncommittedFilesV1 | null; checkedFirst: number | null; paths: string[]; partial: boolean }> {
  const list = readyRouteValue<{ paths: string[]; partial: boolean }>(
    await client.post('files/list', scope, { prefix: '' }), 'files/list');
  const paths = list.paths;
  const partial = list.partial === true;
  const first = paths.slice(0, 100);
  let files: UncommittedFilesV1 | null = null;
  for await (const page of uncommittedPagesOf(client, scope, scope.workspaceId, first)) files = page;
  return { files, checkedFirst: partial || paths.length > first.length ? first.length : null, paths, partial };
}

/**
 * §2.3: the one right-panel read. It reads only the tab it is given and never
 * the navigation reads again: the task tree uses `nav.tasks`, the architecture
 * tree uses `nav.tasks` + `architecture/read`, and `files/list` is read once
 * per files/Diff tab. A `RouteReadError` becomes that tab's explanation; any
 * other failure still fails the page (B-09).
 */
export async function readAuxPanel(
  client: ReturnType<typeof createHostClient>, scope: CoreScope, nav: NavData, demand: AuxDemand & { auxTab: AuxTab },
  commands: { allowed: boolean; runs: Record<string, string | 'gone'> },
): Promise<AuxPanelData> {
  const tab = demand.auxTab;
  const empty: AuxPanelData = {
    tab, task: null, arch: null, files: null, file: null, diff: null, commands: null, error: null,
  };
  const goal = nav.selectedGoalId === null ? null
    : nav.goals.find((row) => row.goalId === nav.selectedGoalId) ?? null;
  /* The task tree is `nav.tasks` (no read): 任务图 draws it and 架构图 names its tasks from it (lead 11-12, M6). */
  const taskTreeOf = (): Pick<AuxTaskData, 'tree' | 'counts'> => {
    const tree = goal === null ? null : goalTaskTree({ id: goal.goalId, name: goal.objective }, nav.tasks);
    return { tree, counts: tree === null ? {} : auxLeafCountsOf(tree, 'task') };
  };
  /* B1: one file's read failing writes its own page text; the tab and the list stay. */
  const readOneFile = async (path: string): Promise<{
    file: AuxFilePage | null; error: { code: string; text: string } | null;
  }> => {
    try {
      return { file: await readAuxFile(client, scope, path), error: null };
    } catch (error) {
      if (!(error instanceof RouteReadError)) throw error;
      if (error.code === 'not_found') return { file: null, error: null };
      logReadError(error);
      return { file: null, error: { code: error.code, text: pageTextOf(error) } };
    }
  };
  try {
    if (tab === 'task') {
      const { tree, counts } = taskTreeOf();
      let moduleNames: Record<string, string> = {};
      const taskModules: Record<string, string> = {};
      if (goal !== null) {
        try {
          const hover = readyRouteValue<GraphHoverReadV1>(await client.post('graph/hover', scope, {
            goalRef: goalRefIn(scope.projectId, goal.goalId),
          }), 'graph/hover');
          moduleNames = moduleNamesOf(hover);
          /* lead 11-12 (T-B10): each task's own `tasks[].module`, named. */
          for (const entry of Array.isArray(hover.tasks) ? hover.tasks : []) {
            const row = asRecord(entry);
            const name = moduleNames[asText(asRecord(row.module).moduleId)];
            if (name !== undefined) taskModules[asText(asRecord(row.task).taskId)] = name;
          }
        } catch (error) {
          /* A Goal without an adopted Plan has no graph to hover; `not_found`
             and `unavailable` both mean the panel draws the tree it already has. */
          if (!(error instanceof RouteReadError) || (error.code !== 'unavailable' && error.code !== 'not_found')) throw error;
        }
      }
      let detail: TaskMapNodeDetailData | null = null;
      if (demand.detailTaskId !== null && goal !== null && nav.tasks !== null) {
        const node = goalTreeNodeOf(tree, demand.detailTaskId);
        try {
          detail = await readNodeDetail(client, scope, goalRefIn(scope.projectId, goal.goalId),
            nav.tasks, demand.detailTaskId, node?.st ?? '', '');
        } catch (error) {
          if (!(error instanceof RouteReadError)) throw error;
          logReadError(error);
          detail = null;
        }
      }
      const det = detail !== null && tree !== null
        ? auxTaskDetailOf(detail, tree, (id) => crumbPathOf(tree, id))
        : null;
      return { ...empty, task: { tree, counts, detail, detailFor: demand.detailTaskId, moduleNames, taskModules, det } };
    }
    if (tab === 'arch') {
      let architecture: ArchCatalogRead | null = null;
      try {
        architecture = readyRouteValue<ArchCatalogRead>(await client.post('architecture/read', scope, {
          selection: { kind: 'current' },
        }), 'architecture/read');
      } catch (error) {
        /* `not_found` is "no adopted architecture": an empty tree, not a page error. */
        if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
      }
      let work: ReadonlySet<string> | null = null;
      if (demand.workOnly) {
        const scopeRead = readyRouteValue<ArchitectureWorkScopeV1>(
          await client.post('architecture/work-scope', scope, {}), 'architecture/work-scope');
        work = new Set(scopeRead.files.map((file) => file.path));
      }
      const tree = catalogArchTree(architecture, scope.projectId, nav.tasks, work);
      /* The names come from the whole catalog, not the work-filtered tree: the other
         end of a semantic link may be a module the filter dropped (item 11). */
      const moduleNames = new Map<string, string>();
      if (architecture !== null) {
        for (const module of architecture.catalog.catalog.modules) moduleNames.set(module.ref.moduleId, module.name);
      }
      const semantic = demand.semantic === true
        ? adaptArchSemantics(await readSemanticPages(client, scope), { flowPick: demand.flowPick ?? null },
          moduleNames, null)
        : null;
      return {
        ...empty, arch: { tree, counts: tree === null ? {} : auxLeafCountsOf(tree, 'file'), work, semantic },
        task: { ...taskTreeOf(), detail: null, detailFor: null, moduleNames: {}, taskModules: {}, det: null },
      };
    }
    if (tab === 'files') {
      const page = await readUncommittedPage(client, scope);
      const one = demand.auxPath === null ? { file: null, error: null } : await readOneFile(demand.auxPath);
      return {
        ...empty, files: auxFileListOf(page.paths), file: one.file, error: one.error,
        diff: { files: page.files, checkedFirst: page.checkedFirst, rows: auxChangedRowsOf(page.files), view: null },
      };
    }
    if (tab === 'file') {
      if (demand.auxPath === null) return empty;
      const one = await readOneFile(demand.auxPath);
      return { ...empty, file: one.file, error: one.error };
    }
    if (tab === 'diff') {
      const page = await readUncommittedPage(client, scope);
      const rows = auxChangedRowsOf(page.files);
      /* 选中行照画板自己的规则（Main.dc.html）：点过的路径还在清单里就用它，否则第一行；清单外的路径不读。 */
      const row = rows.find((entry) => entry.path === demand.auxPath) ?? rows[0] ?? null;
      let view: AuxDiffView | null = null;
      if (row !== null && page.files !== null && page.files.repository === 'git') {
        if (row.added === null) {
          view = auxDiffViewOf(row, null);
        } else {
          try {
            /* 先读 HEAD、再读工作区（readDiffSide）；两侧都读（B2）。 */
            const before = await readDiffSide(client, scope, row.path, { kind: 'git', commit: page.files.head });
            const after = await readDiffSide(client, scope, row.path, { kind: 'working_tree' });
            if (before === 'not_text') {
              view = after === 'not_text' ? auxDiffViewOf(row, 'not_text')
                : auxDiffViewOf(row, { before: null, after: after.content, notText: 'before' });
            } else if (after === 'not_text') {
              view = auxDiffViewOf(row, { before: before.content, after: null, notText: 'after' });
            } else {
              view = auxDiffViewOf(row, { before: before.content, after: after.content });
            }
          } catch (error) {
            /* B1：这一行读失败只写这一行的逐行区；清单和页签照常画，原始失败进日志。 */
            if (!(error instanceof RouteReadError)) throw error;
            logReadError(error);
            view = { path: row.path, hunks: null, note: pageTextOf(error) };
          }
        }
      }
      return { ...empty, diff: { files: page.files, checkedFirst: page.checkedFirst, rows, view } };
    }
    if (tab === 'commands') {
      /* 121-147：和检查轮读同一张已装检查的登记表。 */
      const confirmation = readyRouteValue<ChecksConfirmationV1>(
        await client.post('verification/installed-checks', scope, { scope }),
        'verification/installed-checks',
      );
      const rows: AuxCommandRow[] = confirmation.checks.map((check) => ({
        checkId: check.checkId,
        command: check.command,
        cwd: check.cwd,
        timeoutMs: check.timeoutMs,
        line: check.cwd === '.' ? check.command : check.command + ' · 目录 ' + check.cwd,
      }));
      const runs: Record<string, AuxCommandView> = {};
      for (const [rowKey, commandId] of Object.entries(commands.runs)) {
        if (commandId === 'gone') {
          runs[rowKey] = auxCommandViewOf('gone');
          continue;
        }
        try {
          const handle = readyRouteValue<AuxCommandHandle>(
            await client.post('commands/read', scope, { commandId }), 'commands/read',
          );
          /* 页面只按码给字；原始 reason 只进日志。 */
          if (handle.error !== null) console.error('commands/read', handle.error.code, handle.error.reason);
          runs[rowKey] = auxCommandViewOf(handle);
        } catch (error) {
          if (error instanceof RouteReadError && error.code === 'not_found') {
            runs[rowKey] = auxCommandViewOf('gone');
            continue;
          }
          throw error;
        }
      }
      return {
        ...empty,
        commands: { rows, allowed: commands.allowed, idle: auxCommandViewOf(null), runs },
      };
    }
    return empty;
  } catch (error) {
    if (error instanceof RouteReadError) {
      /* READS-12: the tab shows the page text; the raw route, code and reason go to the log. */
      logReadError(error);
      return { ...empty, error: { code: error.code, text: pageTextOf(error) } };
    }
    throw error;
  }
}

/**
 * §2.4 step 7 (Main, Plan, Done): only the open tab is read; `null` means the panel
 * is closed. The task/architecture trees are the page's own navigation (PB-M1:
 * the panel follows the selected Goal, never the open line).
 */
async function readPageAux(
  client: ReturnType<typeof createHostClient>, boot: BootstrapReply, scope: CoreScope, nav: NavData,
  demand: BoardReadDemand,
): Promise<AuxPanelData | null> {
  const allowed = boot.workspaces.some((workspace) =>
    workspace.scope.projectId === scope.projectId && workspace.scope.workspaceId === scope.workspaceId
    && workspace.commandsAllowed === true);
  const runPrefix = commandRunPrefix(scope);
  const runs: Record<string, string | 'gone'> = {};
  for (const [key, run] of demand.commandRuns ?? []) {
    if (!key.startsWith(runPrefix)) continue;
    runs[key.slice(runPrefix.length)] = run === 'gone' ? 'gone' : run.commandId;
  }
  return demand.auxTab === null || demand.auxTab === undefined
    ? null
    : await readAuxPanel(client, scope, nav, {
      auxTab: demand.auxTab,
      auxPath: demand.auxPath ?? null,
      detailTaskId: demand.detailTaskId ?? null,
      workOnly: demand.workOnly === true,
      semantic: demand.auxTab === 'arch' && demand.semantic === true,
      flowPick: demand.flowPick ?? null,
    }, { allowed, runs });
}

function crumbPathOf(tree: GoalsTaskNode, id: string): Array<{ id: string; name: string }> {
  const walk = (node: GoalsTaskNode, path: Array<{ id: string; name: string }>): Array<{ id: string; name: string }> | null => {
    const next = path.concat([{ id: node.id, name: node.name }]);
    if (node.id === id) return next;
    for (const kid of node.kids) {
      const found = walk(kid, next);
      if (found !== null) return found;
    }
    return null;
  };
  return walk(tree, []) ?? [];
}

/**
 * §2.3 steps 2–5: the one centre read Main and Plan share. The conversation
 * follows `mainPages` (a missing Goal keeps the pages read so far), the cards
 * are the shared queue (a failed queue read hides them only), the Workspace pin
 * is read only when a 请知悉 row is drawn (and only when the caller asks for
 * notice tokens), and the 轨迹 tab adds the one `sessions/history` read.
 */
type MainPageReadWithCards = MainPageRead & { cards?: DecisionCardV1[] };

export async function readMainThread(
  client: ReturnType<typeof createHostClient>, nav: NavData, demand: BoardReadDemand,
  options: { noticeTokens?: boolean } = {},
): Promise<{
  pages: MainPageReadWithCards[]; decisions: DecideData | null;
  older: MainPageCursorV1 | null; track: MainTrackRow[] | null;
}> {
  const scope = nav.scope;
  if (scope === null) return { pages: [], decisions: null, older: null, track: null };
  /* §2.3 step 2: first page at `cursor: null`, then each page's `next`; a
     missing Goal (only with a Goal selected) keeps the pages read so far. */
  let cursor: MainPageCursorV1 | null = null;
  const pages: MainPageReadWithCards[] = [];
  const want = Math.max(1, demand.mainPages ?? 1);
  for (let index = 0; index < want; index += 1) {
    try {
      const page: MainPageRead = readyRouteValue<MainPageRead>(await client.post('main/read', scope, {
        goalId: nav.selectedGoalId, cursor,
      }), 'main/read');
      pages.push(page);
      cursor = page.next;
    } catch (error) {
      if (error instanceof RouteReadError && error.code === 'not_found' && nav.selectedGoalId !== null) break;
      throw error;
    }
    if (cursor === null) break;
  }
  /* A2 (121-147): every drawn run row reads its own `executions/steps`; the
     QueryRun's own project/workspace is its scope, never the page's. Pages can
     repeat a request root, so one round is read once. */
  const readRounds = new Set<string>();
  for (const page of pages) {
    for (const request of page.requests) {
      for (const round of request.rounds) {
        if (round.runRef === null || readRounds.has(round.runRef.runId)) continue;
        readRounds.add(round.runRef.runId);
        const scope: RunStepsScope = { projectId: round.runRef.projectId, workspaceId: round.runRef.workspaceId };
        let view: MainRunSteps;
        try {
          const { key, read } = await readRunStepsPage(client, scope, round.runRef);
          view = mainRunStepsOf(read);
          view.key = key;
          /* A7: a secretary Query round's raw record opens its Member page, whose
             `sessions/history` read is the one that carries it. */
          if (view.thinkTruncated && round.session !== null) {
            view.rawHref = lineHref('Member.dc.html', nav.selectedGoalId, round.session);
          }
        } catch (error) {
          /* Note 5a: the round's block still draws with the page's failure
             sentence; one unreadable Run never fails the conversation. */
          logReadError(error);
          view = failedRunStepsOf(pageTextOf(error));
        }
        view.ref = round.runRef;
        round.runSteps = view;
      }
    }
  }
  /* §2.3 step 3: the cards are the queue's; a failed queue read hides them and
     is not an error of the page. */
  let decisions: DecideData | null = null;
  try {
    decisions = await readDecisionQueue(client, scope, nav, { decideGoal: null }, 0,
      options.noticeTokens !== false);
  } catch {
    decisions = null;
  }
  /* §2.3 step 4: the Workspace pin is read once, and only when a 请知悉 row is
     drawn (Decide D8). Plan passes `noticeTokens:false`: it draws no notice
     card and does not read the pin (qc 2). */
  if (options.noticeTokens !== false && decisions !== null
    && decisions.sections.some((section) => section.level === 'notice' && section.rows.length > 0)) {
    const registration = readyRouteValue<{ workspace: { ref: unknown; revision: number } }>(
      await client.post('workspaces/registration', scope, scope), 'workspaces/registration',
    );
    decisions.workspaceRevision = registration.workspace.revision;
  }
  /* §2.3 step 5: the trace is read only while the 轨迹 tab is open. The line is
     the newest request's owner; a request without an owner falls back to the
     first round's session. `not_found` is the empty trace, nothing else. */
  let track: MainTrackRow[] | null = null;
  if (demand.mainTrack === true) {
    let sessionRef: LineKey | null = null;
    for (const page of pages) {
      for (const request of page.requests) {
        if (request.owner !== null) {
          sessionRef = { projectId: request.owner.projectId, sessionId: request.owner.sessionId };
          break;
        }
      }
      if (sessionRef !== null) break;
    }
    if (sessionRef === null) {
      const session = pages[0]?.requests[0]?.rounds[0]?.session ?? null;
      if (session !== null) sessionRef = { projectId: session.projectId, sessionId: session.sessionId };
    }
    if (sessionRef === null) {
      track = [];
    } else {
      try {
        track = traceOf(await readSessionTrace(client, scope, sessionRef)).map((row) => ({
          at: row.at, type: row.kind, id: row.recordId, summary: '',
        }));
      } catch (error) {
        if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
        track = [];
      }
    }
  }
  return { pages, decisions, older: cursor, track };
}

/**
 * L2/D100-1/D107-2: each drawn message's closed fact. A transferred or copied
 * message names its other line through one `messages/view` read; a failed read
 * says 另一条线 and never fails the page. Only messages that carry one of the
 * three fields cost a read.
 */
async function readClosedByMessage(
  client: ReturnType<typeof createHostClient>, scope: CoreScope,
  views: readonly SessionMessageReadV1[], nav: NavData,
): Promise<Record<string, string>> {
  const closed: Record<string, string> = {};
  const lineNameOfMessageRef = async (ref: SessionMessageRef): Promise<string> => {
    try {
      const view = readyRouteValue<SessionMessageReadV1>(
        await client.post('messages/view', scope, ref), 'messages/view');
      const name = lineNameOfSession(nav.lines, sessionRefAtEdge(view.message.recipient));
      return name === '' ? '另一条线' : name;
    } catch (error) {
      logReadError(error);
      return '另一条线';
    }
  };
  for (const view of views) {
    const message = view.message;
    if (message.withdrawnAt !== null) {
      closed[message.ref.messageId] = '消息已撤回';
    } else if (message.transferredTo !== null) {
      closed[message.ref.messageId] = '已转交给 ' + await lineNameOfMessageRef(message.transferredTo);
    } else if (message.originalRef !== null) {
      closed[message.ref.messageId] = '转自 ' + await lineNameOfMessageRef(message.originalRef) + ' 的一条消息';
    }
  }
  return closed;
}

/** A failed preview leaves the composer usable. A ready null really means waiting. */
async function readRecipient(
  client: ReturnType<typeof createHostClient>, scope: CoreScope, nav: NavData,
): Promise<string> {
  if (nav.selectedGoalId === null) return '';
  try {
    const ref = readyRouteValue<LineKey | null>(await client.post('requests/recipient', scope, {
      goalRef: goalRefIn(scope.projectId, nav.selectedGoalId),
    }), 'requests/recipient');
    return recipientNoteOf(ref, nav);
  } catch (error) {
    logReadError(error);
    return '';
  }
}

/** §2.4 step 1 (Main, Plan): the open line's record through the read and projection Member uses,
 *  and the Run step views it drew (for the one running-commands read). `branched` has no record. */
async function readOpenLine(
  client: ReturnType<typeof createHostClient>, scope: CoreScope, demand: BoardReadDemand, nav: NavData,
): Promise<{ line: MainLineRecord | null; runSteps: MainRunSteps[] }> {
  let line: MainLineRecord | null = null;
  const runSteps: MainRunSteps[] = [];
  if (demand.lineKey !== null && demand.lineKey !== undefined
    && nav.detail !== null && nav.detail.kind === 'line') {
    const source = await readLineFacts(client, scope, demand.lineKey, nav.detail, nav);
    const memberLine = adaptMemberLine(source, nav.detail);
    const write = writeBasisOf(nav, memberLine, source.execution, source.taskGraph);
    /* A3 (121-147): every Run entry carries its own steps, in the workspace the
       Run's own saved snapshot names. `readLineFacts` read them all (and cached
       each once), so this line view adds no second read and no guessed scope. */
    runSteps.push(...source.runStepsByRun.values());
    const closedByMessage = await readClosedByMessage(client, scope, source.messageViews, nav);
    const rec = lvRecordOf({
      executions: source.executions, messages: source.messages, messageViews: source.messageViews,
      bodies: source.messageBodies, copies: source.copies, line: memberLine,
      runStepsByRun: source.runStepsByRun, closedByMessage,
    });
    line = {
      line: memberLine,
      rec,
      rich: { reply: '', liveStep: null, page: memberLine.task !== null ? 'chain' : 'member' },
      write,
      review: memberLine.review,
    };
  }
  return { line, runSteps };
}

/**
 * §2.3: the Main read. The chrome is `readNav`'s one read (so `lines/list`,
 * `bootstrap` and the selected Goal's `tasks/query` are not read twice); the
 * centre is the shared `readMainThread`.
 */
export async function readMain(
  client: ReturnType<typeof createHostClient>, goalId: string | null,
  demand: BoardReadDemand = {},
): Promise<RefreshRead<MainData>> {
  /* R1：整次读只读一次 bootstrap；`readNav` 用的就是这一份回答。 */
  const boot = await client.bootstrap();
  const navRead = await readNav(client, goalId, demand, boot);
  if (navRead.data === null) return { data: null, cursor: navRead.cursor };
  const nav = navRead.data;
  const scope = nav.scope;
  if (scope === null) return { data: null, cursor: navRead.cursor };
  const [thread, recipientNote] = await Promise.all([
    readMainThread(client, nav, demand), readRecipient(client, scope, nav),
  ]);
  const { pages, decisions, older: cursor, track } = thread;
  /* A8: every live Run block this refresh draws is matched against the one
     running-commands read, after the line view's own block is built. */
  const runStepViews: MainRunSteps[] = [];
  for (const page of pages) {
    for (const request of page.requests) {
      for (const round of request.rounds) if (round.runSteps) runStepViews.push(round.runSteps);
    }
  }
  /* §2.4 step 1: the selected line's record, through the same read and the
     same projection Member uses. `branched` has no single record. */
  const opened = await readOpenLine(client, scope, demand, nav);
  runStepViews.push(...opened.runSteps);
  const line = opened.line;
  await readRunningCommandSteps(client, scope, runStepViews);
  // The inbox spans goals. Its queue already read the task graph for the card.
  const mapGoal = demand.auxTab === 'task' ? demand.mapGoal : null;
  const mapNav = mapGoal && mapGoal !== nav.selectedGoalId
    ? { ...nav, selectedGoalId: mapGoal, tasks: (decisions?.plans[mapGoal] ?? null) as TaskGraph | null }
    : nav;
  const aux = await readPageAux(client, boot, scope, mapNav, demand);
  /* §2.8/T37: the conversation's current request is the newest root on the
     newest page; read that ORIGINAL root's own feedback, not a round, so the
     request surface can show what the handling changed. `not_found` (the
     request went away between the two reads) draws no block; any other failure
     fails the read like the trace read does. */
  let requestFeedback: MainRequestFeedback | null = null;
  const newestRequest = pages[0]?.requests[0] ?? null;
  if (newestRequest !== null) {
    try {
      const read = readyRouteValue<unknown>(
        await client.post('requests/read', scope, { requestRoot: newestRequest.requestRoot }), 'requests/read',
      );
      requestFeedback = mainRequestFeedbackOf(read, nav, requestRootKey(newestRequest.requestRoot));
    } catch (error) {
      if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
    }
  }
  const retry = lastResume !== null && lastResume.goalId === nav.selectedGoalId
    && (nav.selectedDisplay?.facts.reentryFailures.length ?? 0) > 0;
  /* M2: one expanded answered card's body, read once; a failed read is that
     card's one “暂时读不到” line, never the page's error. */
  const cardAnswers: Record<string, string | null> = {};
  if (demand.mainCardAnswer !== null && demand.mainCardAnswer !== undefined) {
    const card = (pages[0]?.cards ?? []).find((entry) => entry.cardKey === demand.mainCardAnswer) ?? null;
    const bodyRef = card?.answer?.bodyRef ?? null;
    if (bodyRef !== null) {
      try {
        const material = readyRouteValue<{ body?: unknown }>(await client.post('materials/open', scope,
          { ref: bodyRef, usage: 'historical_explanation' }), 'materials/open');
        cardAnswers[demand.mainCardAnswer] = asText(material.body);
      } catch (error) {
        logReadError(error);
        cardAnswers[demand.mainCardAnswer] = null;
      }
    }
  }
  /* M4: one expanded check notice's settings snapshot; a failed read is that
     fold's one “设置暂时读不到”, never the page's error. */
  let noticeSnapshot: unknown = null;
  let noticeSnapshotError = false;
  if (demand.mainNoticeOpen !== null && demand.mainNoticeOpen !== undefined) {
    const notice = (pages[0]?.notices ?? []).find((entry) => entry.itemKey === demand.mainNoticeOpen) ?? null;
    if (notice !== null) {
      try {
        noticeSnapshot = readyRouteValue<unknown>(await client.settings('snapshot', {}), 'settings/snapshot');
      } catch (error) {
        logReadError(error);
        noticeSnapshotError = true;
      }
    }
  }
  const data: MainData = adaptMain({
    nav, pages, decisions, older: cursor, track, line, aux, requestFeedback, recipientNote, retry,
    cardAnswers, noticeSnapshot, noticeSnapshotError,
    settingsHref: settingsHrefOf('Main', location.search),
  });
  return { data, cursor: navRead.cursor };
}

/** P2: the one Task row's phase in this read, or '' when the map has no row. */
function taskPhaseOf(data: PlanData, taskId: string): string {
  return data.tasks?.tasks.find((task) => task.definition.taskId === taskId)?.effectivePhase ?? '';
}

/** P2: the plan card's one "采用中…" sentence while the re-adoption waits. */
function adoptNoteOf(data: PlanData, pending: { goalId: string; proposal: PlanProposalShape }): string {
  const plan = data.plan;
  if (data.selectedGoalId !== pending.goalId || plan === null || plan.proposal === null
    || plan.proposal.ref.proposalId !== pending.proposal.ref.proposalId
    || plan.proposal.revision !== pending.proposal.revision) return '';
  const running = plan.delta.filter((row) => taskPhaseOf(data, row.ref) === 'running');
  if (running.length === 0) return '采用中：受影响的执行已经停下，正在再采用一次。';
  return '采用中：等' + running.map((row) => '「' + row.text + '」').join('') + '停下，停下后自动再采用一次。';
}

/** P2 (DPS-1): after a Plan read, adopt the waiting proposal again once none of
 * the affected Tasks is running. A changed Goal or candidate drops the wait; a
 * second `busy` keeps it for the next publish; any other failure goes to the
 * composer's foot once, through `PlanData.adoptError`. */
async function reapplyAdoption(client: ReturnType<typeof createHostClient>, data: PlanData,
  reread: () => void): Promise<void> {
  const pending = pendingAdoption;
  if (pending === null || pendingAdoptionBusy) return;
  const plan = data.plan;
  if (data.selectedGoalId !== pending.goalId || plan === null || plan.proposal === null
    || plan.proposal.ref.proposalId !== pending.proposal.ref.proposalId
    || plan.proposal.revision !== pending.proposal.revision) {
    pendingAdoption = null;
    return;
  }
  if (plan.delta.some((row) => taskPhaseOf(data, row.ref) === 'running')) return;
  const scope = data.scope;
  if (scope === null || data.selectedGoalRevision === null) return;
  pendingAdoptionBusy = true;
  try {
    committedRouteValue(await client.write('plans/apply', scope, {
      input: { proposalRef: pending.proposal.ref, expectedProposalRevision: pending.proposal.revision, decisionRefs: [] },
      meta: {
        requestId: crypto.randomUUID(),
        expected: [{ ref: { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId: pending.goalId },
          revision: data.selectedGoalRevision }],
      },
    }), 'plans/apply');
    pageAdoptedPlans?.pending.set(pending.goalId, pending.proposal);
    pendingAdoption = null;
  } catch (error) {
    if (error instanceof RouteReadError && error.code === 'busy' && error.reason === 'stopping_affected_work') return;
    pendingAdoption = null;
    pendingAdoptError = { text: planWriteTextOf(error), keep: error instanceof RouteReadError && error.code === 'busy' };
  } finally {
    pendingAdoptionBusy = false;
  }
  reread();
}

/**
 * E3 Plan A §2.2: the Plan read. The chrome is `readNav`'s one read; the centre
 * is the shared `readMainThread` (its first page only, no notice tokens); the
 * candidate is `plans/request-candidate` of the newest ideas round, and the
 * adopted versions are `plans/versions`. The conversion is `adaptPlan`; the
 * page never parses a proposal.
 */
export async function readPlan(
  client: ReturnType<typeof createHostClient>, goalId: string | null,
  demand: BoardReadDemand = {},
): Promise<RefreshRead<PlanData>> {
  /* R1：整次读只读一次 bootstrap；`readNav` 和右栏的 `commandsAllowed` 用的就是这一份回答。 */
  const boot = await client.bootstrap();
  const navRead = await readNav(client, goalId, demand, boot);
  if (navRead.data === null) return { data: null, cursor: navRead.cursor };
  const nav = navRead.data;
  const scope = nav.scope;
  if (scope === null) return { data: null, cursor: navRead.cursor };
  /* Ruling 2: Plan A reads the first page only; no "更早" entry is drawn. */
  const thread = await readMainThread(client, nav, { ...demand, mainPages: 1 }, { noticeTokens: false });
  /* A8: Plan draws the same conversation Run blocks, so the same one read (and
     the same step match) fills the long-command line here too. */
  const planStepViews: MainRunSteps[] = [];
  for (const page of thread.pages) {
    for (const request of page.requests) {
      for (const round of request.rounds) if (round.runSteps) planStepViews.push(round.runSteps);
    }
  }
  /* §2.4 step 1: the open line's record, as Main reads it; its Run steps join
     this refresh's one running-commands read. */
  const opened = await readOpenLine(client, scope, demand, nav);
  planStepViews.push(...opened.runSteps);
  await readRunningCommandSteps(client, scope, planStepViews);
  /* §2.2 step 3: the newest round with ideas names the request whose candidate
     the page reads; no request, no candidate, or an empty `candidate` means
     "not read" (`cand: null`). */
  const found = ideasRoundOf(thread.pages, nav.selectedGoalId);
  let cand: PlanCandidateRead | null = null;
  if (nav.selectedGoalId !== null && found !== null && found.request.candidate !== null) {
    const goalRef = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId: nav.selectedGoalId };
    try {
      const read = readyRouteValue<unknown>(await client.post('plans/request-candidate', scope, {
        goalRef, requestRef: found.request.requestRoot,
      }), 'plans/request-candidate');
      cand = candidateReadOf(read);
    } catch (error) {
      /* `not_found` is "this request has no candidate"; any other failure only
         turns the plan card unconnected (M8), never the whole page. */
      cand = { head: null, status: 'closed', impact: { marks: [] }, facts: null,
        error: !(error instanceof RouteReadError && error.code === 'not_found') };
    }
  }
  /* P1: the selected candidate's diagnosis, review, taskbook and standard
     change. A failed read only makes those rows say so; it never fails the page. */
  if (cand !== null && cand.head !== null && nav.selectedGoalId !== null) {
    try {
      cand.facts = readyRouteValue<PlanCandidateFacts>(await client.post('decisions/candidate-card', scope, {
        goalRef: { aggregateType: 'Goal', projectId: scope.projectId, goalId: nav.selectedGoalId },
        proposalRef: cand.head.ref,
      }), 'decisions/candidate-card');
    } catch (error) {
      logReadError(error);
    }
  }
  /* §2.2 step 4: the adopted versions; `not_found` is the empty page and any
     other failure fails this read. */
  let versions: PlanVersionRow[] = [];
  if (nav.selectedGoalId !== null) {
    try {
      versions = versionRowsOf(readyRouteValue<{
        items: { revision: number; at: string | null; reasonLabel: string }[];
      }>(await client.post('plans/versions', scope, {
        goalId: nav.selectedGoalId, limit: 50, cursor: null,
      }), 'plans/versions'));
    } catch (error) {
      if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
    }
  }
  /* §2.4 step 7 (B1): the open right-panel tab; the panel starts on 任务图 (first read). */
  const aux = await readPageAux(client, boot, scope, nav, demand);
  const adoptError = pendingAdoptError;
  pendingAdoptError = null;
  const data = adaptPlan({
    main: adaptMain({ nav, ...thread, line: opened.line, requestFeedback: null, aux }),
    pages: thread.pages, cand, versions, adoptNote: '', adoptError,
  });
  if (pendingAdoption !== null) data.adoptNote = adoptNoteOf(data, pendingAdoption);
  /* The adopted card is the one the page just adopted: its proposal read
     (above) carries the draft the closed candidate no longer does. */
  if (nav.selectedGoalId !== null) {
    const goalId = nav.selectedGoalId;
    const newest = data.versions[0]?.revision ?? null;
    const adopted = pageAdoptedPlans;
    const pending = adopted?.pending.get(goalId);
    if (pending !== undefined && adopted !== null) {
      if (newest !== null && data.plan !== null && data.plan.proposal === null) {
        data.plan = adoptedPlanDoc(data.plan, pending);
        adopted.cards.set(goalId, { revision: newest, doc: data.plan });
        adopted.pending.delete(goalId);
      } else if (data.plan?.proposal?.ref.proposalId !== pending.ref.proposalId) {
        /* A different candidate (or no Plan page) means this adoption is no
           longer the one to draw; the same stale candidate waits one read. */
        adopted.pending.delete(goalId);
      }
    } else if (adopted !== null) {
      const card = adopted.cards.get(goalId);
      if (card !== undefined) {
        if (newest === card.revision && data.plan !== null && data.plan.proposal === null) data.plan = card.doc;
        else adopted.cards.delete(goalId);
      }
    }
  }
  return { data, cursor: navRead.cursor };
}

/**
 * The semantic layer's two reads (4-2 甲/4-3 甲): the project scope, links at 100
 * a page and flows at 50, each at most 100 pages. Each route is caught on its
 * own so one failure leaves the other block drawable; only a network failure is
 * "连不上平台" and only the page limit is the cap sentence.
 */
async function readSemanticPages(
  client: ReturnType<typeof createHostClient>, scope: CoreScope,
): Promise<ArchSemanticRead> {
  const out: ArchSemanticRead = {
    links: null, flows: null, linkError: '', flowError: '', linkCap: false, flowCap: false,
  };
  const readEveryPage = async <T>(route: string, limit: number): Promise<T[]> => {
    const items: T[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 100; guard += 1) {
      const page: SemanticPageV1<T> = readyRouteValue<SemanticPageV1<T>>(
        await client.post(route, scope, { scope: { kind: 'project' }, cursor, limit }), route,
      );
      items.push(...page.items);
      cursor = page.next ?? null;
      if (cursor === null) return items;
    }
    throw new RouteReadError(route, 'pagination_limit', 'over 100 pages');
  };
  const semanticErrorTextOf = (error: unknown): string => error instanceof RouteReadError
    ? pageTextOf(error) : SEMANTIC_CHECK_FAIL_WORD.network;
  try {
    out.links = await readEveryPage<SemanticLinkV1>('architecture/semantic-links', 100);
  } catch (error) {
    if (error instanceof RouteReadError && error.code === 'pagination_limit') { logReadError(error); out.linkCap = true; }
    else { logReadError(error); out.linkError = semanticErrorTextOf(error); }
  }
  try {
    out.flows = await readEveryPage<SemanticFlowV1>('architecture/semantic-flows', 50);
  } catch (error) {
    if (error instanceof RouteReadError && error.code === 'pagination_limit') { logReadError(error); out.flowCap = true; }
    else { logReadError(error); out.flowError = semanticErrorTextOf(error); }
  }
  return out;
}

/**
 * E3-ARCH: the ArchOverview read. Scope is `taskMapScope`'s; catalog
 * `not_found` is the ruled "not adopted" empty state, `tasks/query`
 * `not_found` is "no plan", and `architecture/query` reads every page of the
 * observed neighbourhood before the page sees it.
 */
export async function readArchOverview(
  client: ReturnType<typeof createHostClient>, goalId: string | null,
  demand: BoardReadDemand = {},
): Promise<RefreshRead<ArchOverviewData>> {
  const boot = await client.bootstrap();
  const cursor = boot.changesHead ?? null;
  const found = await taskMapScope(client, boot.workspaces, goalId);
  if (found === null) return { data: null, cursor };
  const scope = found.scope;

  let catalog: ArchCatalogRead | null = null;
  try {
    catalog = readyRouteValue<ArchCatalogRead>(
      await client.post('architecture/read', scope, { selection: { kind: 'current' } }), 'architecture/read',
    );
  } catch (error) {
    if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
  }

  let observation: ArchitectureObservationStateV1 | null = null;
  try {
    observation = readyRouteValue<ArchitectureObservationStateV1>(
      await client.post('architecture/observation-state', scope, { workspace: scope }), 'architecture/observation-state',
    );
  } catch (error) {
    if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
  }

  let observed: ArchObservedRead | null = null;
  const capture = observation?.current?.persistedRef ?? null;
  if (capture !== null) {
    const nodes: ArchObservedRead['nodes'] = [];
    const edges: ArchObservedRead['edges'] = [];
    const unresolved: string[] = [];
    let after: string | null = null;
    for (let guard = 0; guard < 1000; guard += 1) {
      const page: ArchObservedRead = readyRouteValue<ArchObservedRead>(
        await client.post('architecture/query', scope, {
          selection: { kind: 'observed', capture },
          depth: 2,
          relations: ['dependency', 'interface'],
          page: { limit: 200, ...(after === null ? {} : { cursor: after }) },
        }), 'architecture/query',
      );
      nodes.push(...page.nodes);
      edges.push(...page.edges);
      unresolved.push(...page.unresolved);
      after = page.nextCursor ?? null;
      if (after === null) break;
    }
    if (after !== null) throw new RouteReadError('architecture/query', 'pagination_limit', 'over 1000 pages');
    observed = { nodes, edges, unresolved, nextCursor: null };
  }

  /* The page's files are the workspace's real paths (A1); the observed graph
     has no public file read, so its file nodes are never used here. */
  const files = readyRouteValue<ArchOverviewSource['files']>(
    await client.post('files/list', scope, {}), 'files/list',
  );

  const needle = (demand.search ?? '').trim();
  const search = needle === '' ? null : readyRouteValue<ArchOverviewSource['search']>(
    await client.post('architecture/find', scope, { needle, page: { afterCursor: null, limit: 6 } }), 'architecture/find',
  );
  const work = demand.workOnly === true ? readyRouteValue<ArchOverviewSource['work']>(
    await client.post('architecture/work-scope', scope, {}), 'architecture/work-scope',
  ) : null;

  let tasks: ArchOverviewSource['tasks'] = null;
  if (found.goal !== null) {
    const reply = await client.post('tasks/query', scope, { goalRef: found.goal.ref });
    if (reply.status !== 'not_found') tasks = readyRouteValue<ArchOverviewSource['tasks']>(reply, 'tasks/query');
  }
  /* The Goal's actual changes: one more read in the same loop, and only when a
     Goal is in scope (`not_found` is not swallowed). */
  let changes: ArchitectureChangeScopeV1 | null = null;
  if (found.goal !== null) {
    changes = readyRouteValue<ArchitectureChangeScopeV1>(
      await client.post('architecture/change-scope', scope, { goalRef: found.goal.ref }), 'architecture/change-scope',
    );
  }
  /* Each workspace of this project reads its own operation rows and knowledge status before
     `lines/list`. A `role-lines/operations` or `knowledge/status` failure only drops that
     workspace from those two rows and is logged; the whole page still reads (ruling 3). */
  const operations: ArchOverviewSource['operations'] = {};
  const knowledge: ArchOverviewSource['knowledge'] = {};
  const workspaceNames: Record<string, string> = {};
  for (const entry of boot.workspaces) {
    if (entry.scope.projectId !== scope.projectId) continue;
    workspaceNames[entry.scope.workspaceId] = entry.name;
    try {
      operations[entry.scope.workspaceId] = readyRouteValue<ArchOperationRow[]>(
        await client.post('role-lines/operations', entry.scope, { workspace: entry.scope }), 'role-lines/operations',
      );
    } catch (error) {
      logReadError(error);
    }
    try {
      knowledge[entry.scope.workspaceId] = readyRouteValue<KnowledgeCommitStatus>(
        await client.post('knowledge/status', entry.scope, {}), 'knowledge/status',
      );
    } catch (error) {
      logReadError(error);
    }
  }
  const lines = readyRouteValue<ArchOverviewSource['lines']>(
    await client.post('lines/list', scope, { workspace: scope }), 'lines/list',
  );

  const notes: Record<string, ArchNoteRead> = {};
  const anchor = demand.noteAnchor ?? null;
  if (anchor !== null && (anchor.kind === 'file' || anchor.kind === 'module')) {
    const anchorKey = anchor.kind === 'file' ? 'file:' + anchor.path : 'module:' + anchor.moduleId;
    try {
      notes[anchorKey] = readyRouteValue<ArchNoteRead>(
        await client.post('notes/list', scope, { anchor, limit: 1, cursor: null }), 'notes/list',
      );
    } catch (error) {
      if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
      notes[anchorKey] = { items: [] };
    }
  }

  const semantic = demand.semantic === true ? await readSemanticPages(client, scope) : null;
  const workspace = boot.workspaces.find((entry) => entry.scope.workspaceId === scope.workspaceId);
  const source: ArchOverviewSource = {
    scope, projectName: workspace?.name ?? '', workspaceNames,
    goal: found.goal === null ? null : {
      id: found.goal.ref.goalId, ordinal: found.goal.read.ordinal ?? null,
      objective: asText(found.goal.read.goal.objective),
    },
    catalog, observation, observed, changes, files, search, work, tasks, lines, notes, operations, knowledge, semantic,
  };
  const ui = {
    level: 'SYS', view: demand.dirView === true ? 'dir' as const : 'sem' as const,
    selected: anchor === null ? null : anchor.kind === 'file' ? anchor.path : null,
    hover: null, q: needle, workOnly: demand.workOnly === true, legend: false, theme: 'dark' as const,
    semPick: demand.semPick ?? null,
  };
  return { data: adaptArchOverview(source, ui), cursor };
}

/**
 * E3 Goals §2.1: one read for the Goals page. The order is fixed: bootstrap,
 * the `?goal=` scope, `goals/list`, one `goals/display` per row whose list phase
 * is null (only `not_found` skips that row), `lines/list`, `goals/conflicts`,
 * the conflict card's two Goals' `tasks/query` plus `architecture/read`, then
 * one `tasks/query` per remaining Goal and one `workflow/driver-read` per
 * RUNNING Goal. A default Goal is the first row that is not finished, never
 * `goals[0]`; `goalId` stays the URL value and the resolved Goal is passed to
 * the adapter only.
 */
export async function readGoals(
  client: ReturnType<typeof createHostClient>, goalId: string | null,
  demand: BoardReadDemand = {},
): Promise<RefreshRead<GoalsData>> {
  // A tab change during the Goal reads schedules its own refresh.
  const auxDemand = { ...demand };
  const boot = await client.bootstrap();
  const cursor = boot.changesHead ?? null;
  const found = await taskMapScope(client, boot.workspaces, goalId);
  if (found === null) return { data: null, cursor };
  const scope = found.scope;
  const goals = readyRouteValue<GoalListRead>(
    await client.post('goals/list', scope, { workspace: scope }), 'goals/list',
  );
  const rows = Array.isArray(goals.goals) ? goals.goals : [];
  const displays: Record<string, unknown> = {};
  const refOf = (id: string): TaskMapGoalRef => ({ aggregateType: 'Goal', projectId: scope.projectId, goalId: id });
  for (const entry of rows) {
    const row = asRecord(entry);
    const listPhase = row.display === undefined || row.display === null ? null : asRecord(row.display).phase;
    if (listPhase !== null && listPhase !== undefined) continue;
    const id = asText(asRecord(row.ref).goalId);
    if (id === '') continue;
    try {
      displays[id] = await readGoalDisplay(client, scope, refOf(id));
    } catch (error) {
      if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
    }
  }
  let selected = goalId;
  if (selected === null) {
    const ordered = rows.map((entry) => asRecord(entry))
      .map((row, index) => ({ row, order: typeof row.order === 'number' ? row.order : index }))
      .sort((a, b) => a.order - b.order);
    for (const { row } of ordered) {
      const id = asText(asRecord(row.ref).goalId);
      if (id === '') continue;
      const listPhase = row.display === undefined || row.display === null ? null : asRecord(row.display).phase;
      if (listPhase === null || listPhase === undefined) {
        const display = displays[id];
        if (display === undefined) continue;
        const phase = asText(asRecord(asRecord(display).display).phase);
        if (phase !== '' && !isFinishedGoalDisplayPhase(phase as GoalDisplayPhaseCode)) { selected = id; break; }
      } else if (!isFinishedGoalDisplayPhase(listPhase as GoalDisplayPhaseCode)) {
        selected = id; break;
      }
    }
  }
  const lines = readyRouteValue<unknown>(
    await client.post('lines/list', scope, { workspace: scope }), 'lines/list',
  );
  const conflicts = readyRouteValue<unknown>(
    await client.post('goals/conflicts', scope, { workspace: scope }), 'goals/conflicts',
  );
  const cards = Array.isArray(asRecord(conflicts).cards) ? asRecord(conflicts).cards as unknown[] : [];
  const tasks: Record<string, unknown | null> = {};
  let architecture: unknown = null;
  if (cards.length > 0) {
    const pins = asRecord(asRecord(cards[0]).source).pins;
    const ids = [...new Set((Array.isArray(pins) ? pins : []).map((pin) => asRecord(pin))
      .map((pin) => asRecord(pin.ref))
      .filter((ref) => ref.aggregateType === 'Goal')
      .map((ref) => asText(ref.goalId)).filter((id) => id !== ''))];
    const orderById = new Map(rows.map((entry) => {
      const row = asRecord(entry);
      return [asText(asRecord(row.ref).goalId),
        typeof row.order === 'number' ? row.order : Number.POSITIVE_INFINITY] as const;
    }));
    ids.sort((a, b) => goalOrderOf(orderById, a) - goalOrderOf(orderById, b));
    for (const id of ids.slice(0, 2)) {
      try {
        tasks[id] = readyRouteValue<unknown>(
          await client.post('tasks/query', scope, { goalRef: refOf(id) }), 'tasks/query',
        );
      } catch (error) {
        if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
        tasks[id] = null;
      }
    }
    architecture = readyRouteValue<unknown>(
      await client.post('architecture/read', scope, { selection: { kind: 'current' } }), 'architecture/read',
    );
  }
  /* Q3: every Goal's progress and reason sentences read its own `tasks/query`;
     the conflict card's two Goals were already read above and are not read twice. */
  for (const entry of rows) {
    const id = asText(asRecord(asRecord(entry).ref).goalId);
    if (id === '' || tasks[id] !== undefined) continue;
    try {
      tasks[id] = readyRouteValue<unknown>(
        await client.post('tasks/query', scope, { goalRef: refOf(id) }), 'tasks/query',
      );
    } catch (error) {
      if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
      tasks[id] = null;
    }
  }
  /* Q5: the driver state is not in `goals/display`; a RUNNING Goal reads its
     driver once for both the wait line and the wait basis. A missing driver is
     not an error (the Host has not started it yet). */
  const drivers: Record<string, unknown> = {};
  for (const entry of rows) {
    const id = asText(asRecord(asRecord(entry).ref).goalId);
    if (id === '' || asText(asRecord(asRecord(displays[id]).display).phase) !== 'RUNNING') continue;
    try {
      drivers[id] = readyRouteValue<unknown>(
        await client.post('workflow/driver-read', scope, { goalRef: refOf(id) }), 'workflow/driver-read',
      );
    } catch (error) {
      if (error instanceof RouteReadError && error.code === 'not_found') continue;
      logReadError(error);
    }
  }
  let aux: AuxPanelData | null = null;
  const tab = auxDemand.auxTab;
  if (tab === 'files' || tab === 'file' || tab === 'commands' || tab === 'diff') {
    const nav = adaptNav({ goals, lines }, selected, scope);
    const auxClient: typeof client = {
      ...client,
      async post(route, workspace, input) {
        try {
          return await client.post(route, workspace, input);
        } catch (error) {
          // Let the shared reader localize a lost connection to the same file, diff side or tab as a rejected read.
          if (error instanceof RouteReadError) throw error;
          throw new RouteReadError(route, 'unavailable', String(error));
        }
      },
    };
    aux = await readPageAux(auxClient, boot, scope, nav, auxDemand);
  }
  return {
    data: adaptGoals({
      goals, displays, lines, conflicts, tasks, drivers, architecture, aux, projectId: scope.projectId, scope,
    }, selected),
    cursor,
  };
}

/**
 * Ruling items 1, 2 and 5: the scope is `taskMapScope`'s; a given goal id
 * wins, otherwise the first Goal whose display state is unfinished; none is the
 * empty state. Every read reply must be `ready`. The returned `cursor` is this
 * read's bootstrap `changesHead`, never a later head.
 */
export async function readTaskMap(
  client: ReturnType<typeof createHostClient>, goalId: string | null,
  demand: TaskMapReadDemand = {},
): Promise<RefreshRead<TaskMapData>> {
  const boot = await client.bootstrap();
  const cursor = boot.changesHead ?? null;
  const found = await taskMapScope(client, boot.workspaces, goalId);
  if (found === null) return { data: null, cursor };
  const scope = found.scope;

  if (found.goal !== null) {
    const { ref, read } = found.goal;
    const reads = { goal: read, display: await readGoalDisplay(client, scope, ref) };
    const data = await loadTaskMapForGoal(client, scope, ref, reads, demand);
    return { data, cursor };
  }

  const conflicts = readyRouteValue<GoalConflictRead>(
    await client.post('goals/conflicts', scope, { workspace: scope }), 'goals/conflicts',
  );
  for (const entry of conflicts.footprintCompleteness) {
    const id = entry.goalRef.goalId;
    if (typeof id !== 'string' || id === '') continue;
    const ref = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId: id };
    const reads = await readGoalReads(client, scope, ref);
    if (isFinishedGoalDisplayPhase(reads.display.display.phase)) continue;
    const data = await loadTaskMapForGoal(client, scope, ref, reads, demand);
    return { data, cursor };
  }
  return { data: null, cursor };
}

async function readGoalReads(
  client: ReturnType<typeof createHostClient>, scope: CoreScope, ref: TaskMapGoalRef,
): Promise<{ goal: TaskMapGoalRead; display: TaskMapDisplayRead }> {
  const goal = readyRouteValue<TaskMapGoalRead>(
    await client.post('goals/read', scope, ref), 'goals/read',
  );
  return { goal, display: await readGoalDisplay(client, scope, ref) };
}

async function readGoalDisplay(
  client: ReturnType<typeof createHostClient>, scope: CoreScope, ref: TaskMapGoalRef,
): Promise<TaskMapDisplayRead> {
  return readyRouteValue<TaskMapDisplayRead>(
    await client.post('goals/display', scope, { goalRef: ref }), 'goals/display',
  );
}

/** The Goal's first `main/read` page, for the complete count of requests that still wait for it; a failed read is
 *  `null` (the line hides), never 0. */
async function readPendingSourceRequests(
  client: ReturnType<typeof createHostClient>, scope: CoreScope, ref: TaskMapGoalRef,
): Promise<number | null> {
  try {
    const page = readyRouteValue<MainPageV1>(
      await client.post('main/read', scope, { goalId: ref.goalId, cursor: null }), 'main/read',
    );
    return typeof page.pendingSourceRequests === 'number' ? page.pendingSourceRequests : null;
  } catch (error) {
    logReadError(error);
    return null;
  }
}

/** Ruling item 1: `tasks/query` `not_found` is a Goal without an adopted Plan,
 * not an error; every other non-ready reply still throws through `readyRouteValue`. */
async function loadTaskMapForGoal(
  client: ReturnType<typeof createHostClient>,
  scope: CoreScope,
  ref: { aggregateType: 'Goal'; projectId: string; goalId: string },
  reads: { goal: TaskMapGoalRead; display: TaskMapDisplayRead },
  demand: TaskMapReadDemand,
): Promise<TaskMapData> {
  // Only an ended Goal (completed or partly accepted) can be the source of a request that still waits for it: R2
  // records a request sent on an ended Goal as coming from it. A running Goal has none, so it skips this read.
  const phase = reads.display.display.phase;
  const pendingSourceRequests = phase === 'COMPLETED' || phase === 'ACCEPTED_PARTIAL'
    ? await readPendingSourceRequests(client, scope, ref) : 0;
  const reply = await client.post('tasks/query', scope, { goalRef: ref });
  /* Ruling item 4: `lines/list` and `graph/hover` join the base four on every
   * notification — one read each for the Goal, never one per Task. A Goal with
   * no adopted Plan has no task graph, so its hover read is expectedly
   * `unavailable`; the empty Plan state is still the ruled answer. */
  const lines = readyRouteValue<TaskMapLineRead>(
    await client.post('lines/list', scope, { workspace: scope }), 'lines/list',
  );
  if (reply.status === 'not_found') {
    let hover: TaskMapHoverRead | null = null;
    try {
      hover = readyRouteValue<TaskMapHoverRead>(
        await client.post('graph/hover', scope, { goalRef: ref }), 'graph/hover',
      );
    } catch (error) {
      if (!(error instanceof RouteReadError) || error.code !== 'unavailable') throw error;
    }
    const data = adaptTaskMap(reads.goal, null, reads.display, { lines, hover, pendingSourceRequests });
    data.scope = scope;
    return data;
  }
  const hover = readyRouteValue<TaskMapHoverRead>(
    await client.post('graph/hover', scope, { goalRef: ref }), 'graph/hover',
  );
  const decisionCards = await readDecisionCards(client, scope, ref);
  const graph = readyRouteValue<TaskMapGraphRead>(reply, 'tasks/query');
  /* D101-3: a blocked Task's root is always a waiting card, so the waits read
     only when this Goal has one; no card leaves the first-screen reads alone. */
  let waits: unknown = null;
  if (decisionCards !== null && decisionCards.n > 0) {
    try {
      waits = readyRouteValue<unknown>(await client.post('workflow/waits', scope, { goalRef: ref }), 'workflow/waits');
    } catch (error) {
      logReadError(error);
    }
  }
  const data = adaptTaskMap(reads.goal, graph, reads.display, { lines, hover, waits, pendingSourceRequests });
  /* 5.10-1: a disposition write pins this page's Goal revision and plan. */
  data.planWrite = typeof reads.goal.goal.revision === 'number'
    ? { goalRevision: reads.goal.goal.revision, graph } : null;
  /* The one task write (`releaseHolds`) sends with this read's own workspace,
     never a second navigation read. */
  data.scope = scope;
  data.decisionCards = decisionCards;
  /* A8: only a Goal with a running Task asks for this Host's running commands;
     the read's own failure hides the long-command item, never the page. */
  if (data.tasks.some((task) => task.st === 'running')) {
    const read = await readRunningCommands(client, scope);
    if (read !== null) {
      const running = runningCommandsByTask(read.items, ref.goalId);
      for (const item of Object.values(running)) {
        try {
          const record = readyRouteValue<TaskExecutionRecord>(
            await client.post('executions/read',
              { projectId: item.runRef.projectId, workspaceId: item.workspaceId }, item.runRef), 'executions/read');
          item.stopping = record.run.controlState?.desiredState === 'cancelled';
        } catch (error) {
          /* This read only adds “停止请求中”; its failure is not the page's. */
          logReadError(error);
          item.stopping = false;
        }
      }
      data.running = running;
    }
  }
  /* Ruling 4: disposition dates are read only while the dropped list is open. */
  if (demand.dropped === true) await resolveDroppedDates(client, scope, ref, data);
  if (demand.track === true) {
    /* The replay demand stays until the board itself leaves replay
       (`replay:false`); a later notification must not fall back to today. */
    data.time = await readTaskMapTime(client, scope, ref, lines, demand);
  }
  const node = demand.detailTaskId ?? null;
  if (node !== null) {
    data.detailFor = node;
    /* The detail head uses the state the map already shows, never a recount
       from `phase/disposition` (a future intention must stay 未来意图); its
       reason comes from the same row, not from the verdict-less summary. */
    const mapRow = data.tasks.find((task) => task.id === node);
    data.detail = await readNodeDetail(client, scope, ref, graph, node,
      mapRow?.st ?? '', mapRow?.why ?? '');
    if (data.detail !== null) {
      await addTaskDetailFacts(client, scope, ref, graph, node, data.detail);
      try {
        const gateScope = { projectId: ref.projectId, workspaceId: data.detail.workspaceId };
        const page = readyRouteValue<{ gates: TaskMapOverlapGateRead[] }>(await client.post(
          'goals/overlap-gates', gateScope, { goalRef: ref, page: { limit: 50 } }), 'goals/overlap-gates');
        data.detail.overlapGates = overlapGatesOf(page.gates, data.detail, data);
      } catch (error) {
        logReadError(error);
      }
    }
  }
  return data;
}

/** 5.3-9, 5.4-5, 5.8a-2 and D42-2: the selected Task's failure facts, its round
 * chain and its anomaly anchors. Each is an attached read: a failure hides only
 * its own block. */
async function addTaskDetailFacts(
  client: ReturnType<typeof createHostClient>, scope: CoreScope,
  goalRef: { aggregateType: 'Goal'; projectId: string; goalId: string },
  graph: TaskMapGraphRead, taskId: string, detail: TaskMapNodeDetailData,
): Promise<void> {
  const found = taskDetailNodeOf(graph, taskId);
  if (found === null) return;
  const failure = asRecord(found.row.failure);
  const round = asRecord(failure.round);
  const failing = Array.isArray(round.failingChecks) ? round.failingChecks : [];
  const checkRows = failing.length > 0 ? await readSnapshotCheckRows(client, scope) : null;
  detail.failure = factsOf(found.row, checkRows, { attempt: false, rework: false, exit: false });
  /* A chain of one round already has its 检查 line; the list is only for a
     successor round. */
  if (typeof round.ordinal === 'number' && round.ordinal >= 2) {
    try {
      const read = readyRouteValue<unknown>(await client.post('verification/round', scope,
        { roundRef: round.roundRef }), 'verification/round');
      detail.failure = detail.failure.concat(roundChainFactsOf(asRecord(asRecord(read).chain).rounds));
    } catch (error) {
      if (!(error instanceof RouteReadError) || error.code !== 'not_found') logReadError(error);
    }
  }
  try {
    const read = readyRouteValue<unknown>(await client.post('graph/detail', scope, {
      goalRef, node: found.node, section: 'anomalies', page: { afterCursor: null, limit: 20 },
    }), 'graph/detail');
    detail.anchors = anchorLinesOf(asRecord(read).items, found.row);
  } catch (error) {
    logReadError(error);
  }
}

/** HO:2051: this Goal's waiting cards for the 需要关注 item, one card page is
 * enough because the count is taken before paging. A failed read hides the
 * item; it is not an error of the page and never a 0. */
async function readDecisionCards(
  client: ReturnType<typeof createHostClient>, scope: CoreScope, goalRef: TaskMapGoalRef,
): Promise<{ n: number; atLeast: boolean } | null> {
  try {
    return adaptTaskMapDecisionCards(readyRouteValue<TaskMapQueueRead>(await client.post('decisions/queue', scope,
      { workspace: scope, goalRef, sections: ['waiting_answer'], page: { limit: 1 } }), 'decisions/queue'));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------- detail and writes */

/** Immutable material keyed by its full reference, never by "current": an
 * adopted revision's acceptedAt cannot change. */
const ACCEPTED_AT = new Map<string, string>();

function bootRefKey(ref: unknown): string {
  const row = asRecord(ref);
  const projectId = asText(row.projectId);
  const planId = asText(row.planId);
  const revision = typeof row.revision === 'number' ? String(row.revision) : '';
  /* The cache key is the whole PlanRef: the same plan id in another project is
   * another adopted revision with another acceptedAt. */
  return planId === '' || projectId === '' ? '' : projectId + '/' + planId + '@' + revision;
}

/** Ruling 2: a disposition change's date is the acceptedAt of the Plan named
 * by `dispositionChange.setIn`, as local short text; unreadable is ''. */
async function acceptedAtText(
  client: ReturnType<typeof createHostClient>, scope: CoreScope,
  goalRef: { aggregateType: 'Goal'; projectId: string; goalId: string }, setIn: unknown,
): Promise<string> {
  const key = bootRefKey(setIn);
  if (key === '') return '';
  let acceptedAt = ACCEPTED_AT.get(key) ?? '';
  if (acceptedAt === '') {
    try {
      const plan = readyRouteValue<{ plan?: { acceptedAt?: unknown } }>(
        await client.post('tasks/query', scope, { goalRef, planRef: setIn }), 'tasks/query',
      );
      acceptedAt = asText(plan.plan?.acceptedAt);
    } catch {
      acceptedAt = '';
    }
    if (acceptedAt === '') return '';
    ACCEPTED_AT.set(key, acceptedAt);
  }
  return localShortAt(acceptedAt);
}

/** A dropped Task's date; unreadable hides only the date. */
async function resolveDroppedDates(
  client: ReturnType<typeof createHostClient>, scope: CoreScope,
  goalRef: { aggregateType: 'Goal'; projectId: string; goalId: string }, data: TaskMapData,
): Promise<void> {
  for (const dropped of data.dag.dropped) {
    const at = await acceptedAtText(client, scope, goalRef, dropped.setIn);
    if (at !== '') dropped.at = at;
  }
}

/* The Task's `graph/detail` node and its `tasks/query` row, from one graph read;
   the detail and the anomaly page use the same node. */
function taskDetailNodeOf(graph: TaskMapGraphRead, taskId: string): {
  row: Record<string, unknown>;
  node: { kind: 'task'; ref: unknown; planRef: unknown };
} | null {
  const planRef = graph.plan.ref;
  const row = graph.tasks.map(asRecord).find((entry) => asText(asRecord(entry.ref).taskId) === taskId);
  if (row === undefined || planRef === undefined) return null;
  return { row, node: { kind: 'task' as const, ref: row.ref, planRef } };
}

async function readNodeDetail(
  client: ReturnType<typeof createHostClient>, scope: CoreScope,
  goalRef: { aggregateType: 'Goal'; projectId: string; goalId: string },
  graph: TaskMapGraphRead, taskId: string, state: string, mapWhy: string,
): Promise<TaskMapNodeDetailData | null> {
  const found = taskDetailNodeOf(graph, taskId);
  if (found === null) return null;
  const row = found.row;
  const node = found.node;
  const readDetailPage = (section: string, afterCursor: string | null) => client.post('graph/detail', scope,
    { goalRef, node, section, page: { afterCursor, limit: 100 } });
  const summaryRead = readyRouteValue<TaskMapSummaryRead>(await readDetailPage('summary', null), 'graph/detail');
  // The Task's Goal may live in another workspace: its workspace comes from the
  // `graph/detail` Goal read, never from the board's scope. The board scope is
  // the main workspace the settings opened, and the adapter projects per workspace.
  const summary: TaskMapSummaryRead = { ...summaryRead,
    workspaceId: asText(asRecord(summaryRead.task).workspaceId),
    mainWorkspaceId: scope.workspaceId };
  const participants: TaskMapParticipantRead[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const pageRead: TaskMapParticipantRead = readyRouteValue<TaskMapParticipantRead>(
      await readDetailPage('participants', cursor), 'graph/detail');
    participants.push(pageRead);
    cursor = pageRead.nextCursor ?? null;
    if (cursor === null) break;
  }
  /* 4.10: the risks pages, read the same way as the participants */
  const risks: TaskMapRiskRead[] = [];
  cursor = null;
  for (let page = 0; page < 10; page += 1) {
    const pageRead: TaskMapRiskRead = readyRouteValue<TaskMapRiskRead>(await readDetailPage('risks', cursor), 'graph/detail');
    risks.push(pageRead);
    cursor = pageRead.nextCursor ?? null;
    if (cursor === null) break;
  }
  const task = asRecord(summary.task);
  const actual = asRecord(task.actualFiles);
  /* `FromExecutedFilesV1` says `availability`; `status` was never its field. */
  const needsCatalog = (actual.availability === 'available' && Array.isArray(actual.value) && actual.value.length > 0)
    || (Array.isArray(task.plannedModules) && task.plannedModules.length > 0)
    || (Array.isArray(task.plannedFiles) && task.plannedFiles.length > 0)
    || risks.some((page) => (page.items ?? []).some((item) => asRecord(asRecord(item).shared).kind === 'module'));
  /* E3-7: each actual file's path against ITS OWN workspace's HEAD; the Host takes at most 100
   * (UNCOMMITTED_FILES_MAX_PATHS). The result is keyed by the canonical project path, the same key
   * the adapter's rows use, so two workspaces' same-named files never share a number. A failed read
   * only hides that workspace's numbers. */
  const entries: Array<{ workspaceId: string; path: string }> = [];
  if (actual.availability === 'available' && Array.isArray(actual.value)) {
    for (const entry of actual.value) {
      const file = asRecord(entry);
      const path = asText(file.path);
      if (path === '') continue;
      entries.push({ workspaceId: asText(file.workspaceId) || scope.workspaceId, path });
    }
  }
  const read = await readUncommittedByWorkspace(client, scope, entries, { totalCap: 100 });
  const uncommitted: TaskMapUncommittedRead = read.repository === 'git' ? { repository: 'git', files: read.files } : null;
  let catalog: { modules?: unknown[]; containment?: unknown } | null = null;
  if (needsCatalog) {
    try {
      const architecture = readyRouteValue<{ catalog?: { catalog?: unknown } }>(
        await client.post('architecture/read', scope, { selection: { kind: 'current' } }), 'architecture/read',
      );
      catalog = asRecord(asRecord(architecture.catalog).catalog) as { modules?: unknown[]; containment?: unknown };
    } catch {
      catalog = null;
    }
  }
  /* 4.6: the row's own disposition change and its plan's adoption time */
  const change = row?.dispositionChange ?? null;
  const changeAt = change === null ? '' : await acceptedAtText(client, scope, goalRef, asRecord(change).setIn);
  return adaptTaskMapDetail(summary, participants, null,
    catalog as Parameters<typeof adaptTaskMapDetail>[3], state, mapWhy, change, changeAt, risks,
    typeof row.attemptOrdinal === 'number' ? row.attemptOrdinal : null, uncommitted, graph.plan, row);
}

/** Ruling 7: the one write path. Read the real Workspace pin, commit, then let
 * the caller reread. A rejected write is an error, never a fake success. */
export async function pinTaskMapLine(
  client: ReturnType<typeof createHostClient>, scope: CoreScope,
  key: TaskMapSessionRef, pinned: boolean,
): Promise<void> {
  const registration = readyRouteValue<{ workspace: { ref: unknown; revision: number } }>(
    await client.post('workspaces/registration', scope, scope), 'workspaces/registration',
  );
  const revision = registration.workspace.revision;
  /* `WorkspaceSnapshot@1` requires exactly { projectId, sessionId } in the
   * pin table (record-codecs.ts:299); aggregateType/workspaceId are rejected. */
  const sessionRef = { projectId: key.projectId, sessionId: key.sessionId };
  const requestId = `line-pin-${scope.workspaceId}-${sessionRef.sessionId}-${pinned ? 'add' : 'remove'}-${revision}`;
  const reply = await client.write('lines/pin', scope, {
    input: { workspace: scope, add: pinned ? [sessionRef] : [], remove: pinned ? [] : [sessionRef] },
    meta: { requestId, expected: [{ ref: registration.workspace.ref, revision }] },
  });
  committedRouteValue(reply, 'lines/pin');
}

const WRITE_ERROR_TEXT: Record<string, string> = {
  revision_conflict: '这条工作线的版本已变化，请重读后再试。',
  'busy:stopping_affected_work': '有工作还在停下，等停下后再点一次。',
  unavailable: '暂时写不了，可以重试。',
  forbidden: '这次写入没有被允许。',
  invalid: '这次写入的输入无效。',
};

function writeTextOf(error: unknown): string {
  const code = error instanceof RouteReadError ? error.code : '';
  const reason = error instanceof RouteReadError ? error.reason : '';
  return WRITE_ERROR_TEXT[code + ':' + reason] ?? WRITE_ERROR_TEXT[code] ?? '写入失败。';
}

function gateWriteTextOf(error: unknown): string {
  if (error instanceof RouteReadError) {
    if (error.code === 'revision_conflict') return '这道门刚变过，等页面刷新后再点一次。';
    if (error.code === 'invalid' && error.reason.includes('already satisfied')) {
      return '参谋已经记了约定，这道门已经过了。';
    }
  }
  return writeTextOf(error);
}

/** S2 (5.1-8): the control owner's English refusals in the person's words,
 * matched by substring in this order; an unknown reason falls back to the
 * generic table, so an owner rewording its text never says something wrong. */
export function controlWriteTextOf(error: unknown): string {
  if (!(error instanceof RouteReadError)) return writeTextOf(error);
  const { code, reason } = error;
  if (code === 'busy' && reason.includes('paused Run ended at the Host restart')) {
    return '主机重启时已暂停，这次执行已经结束；点“继续”接着做这个任务。';
  }
  if (code === 'busy' && reason.includes('Run already ended')) {
    return '这次执行已经结束，不能再暂停或取消。';
  }
  if (code === 'busy' && reason.includes('consumed the yielded wait continuation')) {
    return '让出等待的接续已经被后面的执行用掉了，不能再控制它。';
  }
  if (code === 'busy' && reason.includes('is not resumed while its Goal is not active')) {
    return '目标没在进行，先在主对话的目标栏点继续。';
  }
  if (code === 'busy' && reason.includes('already fenced by a queued cancel')) {
    return '已经请求取消，等它停下。';
  }
  if (code === 'busy' && reason.includes('already fenced by a queued pause')) {
    return '已经请求暂停，等它停下。';
  }
  if (code === 'busy' && (reason.includes('resume requires') || reason.includes('not fenced by a pause'))) {
    return '它没有停在暂停上，不能继续。';
  }
  return writeTextOf(error);
}

/** 表一 6: the Host publishes these reasons on a settings write; the page shows one
 *  fixed Chinese sentence each, never the Host's own words. */
/** Y6 (b): the not-written refusals of the three rework writes. The owner's
 * reasons are matched by substring in this order (the outcome phrase wins over
 * the generic `reconcile` one); an unknown reason falls back to `writeTextOf`. */
function reworkWriteTextOf(error: unknown): string {
  if (!(error instanceof RouteReadError)) return writeTextOf(error);
  const { code, reason } = error;
  if (code === 'busy' && reason.startsWith('finalize_first:')) return '这一轮检查还没结束，等平台结束这一轮再试。';
  if (code === 'busy' && (reason.includes('resume the Goal first') || reason.includes('Goal is not active'))) {
    return '目标已暂停，先在主对话的目标栏点继续，再试。';
  }
  if (code === 'busy' && reason.includes('outcome is not known')) return '这次执行结果未知，先核对它。';
  if (code === 'busy' && reason.includes('has not ended')) return '这次执行还没结束，先停下它再试。';
  if (code === 'busy' && reason.includes('reconcile')) return '这次执行还没对完账，等平台对完再试。';
  if (code === 'busy' && reason.includes('yielded wait is paused')) return '让出的等待已暂停，先继续或取消它。';
  if (code === 'revision_conflict' && reason.includes('a TaskRequeue covers')) {
    return '这次执行已经重新入队，新的执行在接着做。';
  }
  if (code === 'revision_conflict') return '这个任务刚变过（别处又检查或重新入队了一次），等页面刷新后再看。';
  if (code === 'dependency_blocked' && reason.startsWith('round_chain_limit:')) {
    return '检查轮次已到上限，不能再重新检查；要改计划。';
  }
  if (code === 'incomplete') return '这个任务的检查链读不通（旧数据），没有自动出口；要改计划。';
  if (code === 'invalid' && reason.includes('clean PASS')) return '这一轮已经通过，不用再检查。';
  return writeTextOf(error);
}

/** Y6 (c): the plan writes' refusals (defer/cancel/restore/repair and adoption). */
function planWriteTextOf(error: unknown): string {
  if (!(error instanceof RouteReadError)) return writeTextOf(error);
  const { code, reason } = error;
  if (code === 'busy' && reason === 'stopping_affected_work') return WRITE_ERROR_TEXT['busy:stopping_affected_work']!;
  if (code === 'busy' && reason.includes('still has an unfinished execution')) {
    return '这个任务还有一次执行没结束，等它停下再点一次。';
  }
  if (code === 'busy' && reason.includes('resolve the unknown outcome of run')) {
    return '有一次执行结果未知，先到“需要你决定”里核对它，再点一次。';
  }
  if (code === 'busy' && reason.includes(': reconcile run')) {
    return '有一次执行还没对完账，等平台对完再点一次。';
  }
  if (code === 'busy' && reason.includes('cancel or resume the yielded wait')) {
    return '有一次让出的等待还挂着，先在那条工作线上继续或取消它，再点一次。';
  }
  if (code === 'busy' && reason.includes('still holds its TaskLease')) {
    return '任务还占着执行租约，等它释放再点一次。';
  }
  if (code === 'invalid' && reason.includes('the disposition of a satisfied task is final')) {
    return '这个任务已经满足，处置不能再改。';
  }
  if (code === 'invalid' && reason.includes('no longer has a valid active required carrier')) {
    return '它是这项要求唯一的承担者。延后或取消前要先加一个新的承担者：告诉秘书，秘书会起草新的计划。';
  }
  if (code === 'invalid' && reason.includes('source gate task')) return '验收不能改。';
  if (code === 'invalid' && reason.includes('the Goal is cancelled')) return '目标已取消，计划不能再改。';
  if (code === 'revision_conflict' && reason.includes('is no longer a future task')) {
    return '这个任务已经跑过，只能改处置；要换做法，告诉秘书，秘书会起草带替代任务的计划。';
  }
  if (code === 'revision_conflict') return '计划刚变过，等页面刷新后再点一次。';
  return writeTextOf(error);
}

/** Y6 (d): attesting an unknown outcome. */
function attestWriteTextOf(error: unknown): string {
  if (!(error instanceof RouteReadError)) return writeTextOf(error);
  const { code, reason } = error;
  if (code === 'busy' && reason.includes('does not hold the Host instance lease')) {
    return '这台 Host 没有执行租约，只有持有租约的 Host 能认定。';
  }
  if (code === 'busy' && reason.includes('has no unknown outcome to attest')) {
    return '这次执行的结果已经知道了，不用再认定。';
  }
  if (code === 'unavailable') return '暂时读不到执行记录，稍后重试。';
  if (code === 'revision_conflict') return '这次执行刚变过，等页面刷新后再看。';
  return writeTextOf(error);
}

/** Y6 (e): the card writes' own translations (answer and mark-as-seen). */
function cardWriteTextOf(error: unknown): string {
  if (error instanceof RouteReadError && error.code === 'revision_conflict') {
    return '这张卡依据的事实刚变过，等页面刷新后再看一次。';
  }
  if (error instanceof RouteReadError && error.code === 'invalid'
    && error.reason.includes('names neither a stored option nor the explicit other selection')) {
    return '这张卡要选一项；只想说话，点‘问秘书’';
  }
  return writeTextOf(error);
}

const SETTINGS_WRITE_REASON_TEXT: Record<string, string> = {
  'commandsAllowed requires writeAllowed': '跑命令要先允许改文件',
  'the Host does not publish the workspace access switch': '这个工作区的权限由启动配置决定，这里改不了',
  'the settings file could not be written': '设置文件写不进去，可以重试',
};

/** 设置页的失败文字：已知原因换成中文句子；`checks/withdraw` 的 Host 原句本来就是
 *  中文，照用；其余（含原文）返回 null，由调用方写日志后给一句通用话。 */
function settingsWriteTextOf(route: string, error: unknown): string | null {
  const code = error instanceof RouteReadError ? error.code : '';
  const reason = error instanceof RouteReadError ? error.reason : '';
  if (route === 'checks/withdraw' && /[\u4e00-\u9fff]/.test(reason)) return reason;
  /* E 第 3 件：固定工作区的两种 Host 原因用 `ACCESS_FIXED_TEXT` 的同一句，不再另抄。 */
  if (route === 'workspaces/access' && code === 'unsupported') {
    if (reason === "the start-up runtime configuration fixes this workspace's access") {
      return ACCESS_FIXED_TEXT.startup_binding;
    }
    if (reason === "a programmatic runtime fixes this workspace's access") {
      return ACCESS_FIXED_TEXT.programmatic_runtime;
    }
  }
  /* F：超过本机内存、进程数越界都交给 Host 判，按它的原因开头给中文句。 */
  if (route === 'resource-caps/save' && code === 'invalid') {
    if (reason.startsWith('memoryMaxMiB')) return '内存超出这台机器能设的范围';
    if (reason.startsWith('tasksMax')) return '进程数超出这台机器能设的范围';
  }
  if (route === 'knowledge-local' && code === 'unsupported'
    && reason === 'the checkout is not a git repository') {
    return '不在 git 仓库里，没有这一项。';
  }
  if (route === 'knowledge-local' && code === 'unavailable'
    && reason === 'the checkout of the workspace could not be read') {
    return '读不到这个工作区的检出，可以重试';
  }
  const known = SETTINGS_WRITE_REASON_TEXT[reason];
  if (known !== undefined) return known;
  if (route === 'command-review/save' && code === 'invalid') return '要 1 或更大的整数分钟；清空就回默认';
  return null;
}

/** 7D2 K: the two project writes' own failure text. A stale write already reread
 *  the page (`projectWrite`); everything else keeps `writeTextOf`. */
function projectWriteTextOf(route: string, error: unknown): string {
  const code = error instanceof RouteReadError ? error.code : '';
  if (code === 'revision_conflict') {
    return route === 'projects/role-limits/set'
      ? '工作线上限刚被别处改过，已经重读，请再改一次。'
      : '这条规则刚被别处改过，已经重读，请再点一次。';
  }
  if (code === 'not_found' && route.startsWith('autonomy-rules/')) return '这条规则已经不在了。';
  return writeTextOf(error);
}

/** 命令页两个写口（`runCommand`、`stopCommand`）的失败文字：`unsupported` 是“这台 Host 跑不了命令”，
 * 只给命令页用、不进 `WRITE_ERROR_TEXT`（K7）；其余照 `writeTextOf`。 */
function commandWriteTextOf(error: unknown): string {
  return error instanceof RouteReadError && error.code === 'unsupported'
    ? '这台 Host 现在跑不了命令（命令沙箱不可用，或 Host 正在关闭）。'
    : writeTextOf(error);
}

/** 5.5-2: the resume receipt's submitted Runs are read once each for their
 * `controls/read` observation. A queued or failed read leaves no entry, so the
 * report keeps the table's 已送去恢复 row. */
async function readEnteredResumes(
  client: ReturnType<typeof createHostClient>, scope: CoreScope, outcome: GoalControlOutcomeReadV1,
): Promise<Map<string, ControlIntentSnapshotV1>> {
  const entered = new Map<string, ControlIntentSnapshotV1>();
  for (const run of outcome.fanOut.runs) {
    if (run.outcome !== 'submitted' && run.outcome !== 'already_submitted') continue;
    if (run.intentRef === null) continue;
    try {
      const snapshot = readyRouteValue<ControlIntentSnapshotV1>(
        await client.post('controls/read', scope, run.intentRef),
        'controls/read');
      entered.set(run.runRef.runId, snapshot);
    } catch (error) {
      logReadError(error);
    }
  }
  return entered;
}

/** 5.5-3/5.5-11: the Goal control's own refusals. The three `busy` reasons are
 * the state machine's exact text (`goal-machine.ts:578`, `:592`, `:593`). */
function goalControlTextOf(error: unknown): string {
  if (error instanceof RouteReadError) {
    if (error.code === 'busy') {
      if (error.reason === 'the Goal is already paused') return '目标已经暂停了。';
      if (error.reason === 'the Goal is not paused') return '目标没有暂停，不用继续。';
      if (error.reason === 'the Goal is already cancelled') return '目标已经取消了。';
    }
    if (error.code === 'revision_conflict') return '目标刚变过，页面已经重读，再点一次。';
  }
  return writeTextOf(error);
}

/** K3 L7: the unknown-call review's refusals; everything else keeps `writeTextOf`. */
function reviewWriteTextOf(error: unknown): string {
  if (error instanceof RouteReadError) {
    if (error.code === 'busy' && error.reason === '已经在等你处理') return '这项任务已经暂停了，你在处理。';
    if (error.code === 'revision_conflict') return '这条核对记录刚变过，等页面刷新后再点一次。';
  }
  return writeTextOf(error);
}

/** K7: the delivery card's own translations; every other failure keeps `writeTextOf`. */
function deliveryWriteTextOf(error: unknown): string {
  if (error instanceof RouteReadError && error.code === 'revision_conflict') {
    return '目标刚变过，等页面刷新后再点一次。';
  }
  if (error instanceof RouteReadError && error.code === 'invalid'
    && error.reason === 'the delivery was already accepted') {
    return '这次交付已经确认过。';
  }
  return writeTextOf(error);
}

/** 任务图的停止写口：撞版本有自己的一句，页面本来也会重读（N2）；其余照 `writeTextOf`。 */
function stopWriteTextOf(error: unknown): string {
  return error instanceof RouteReadError && error.code === 'revision_conflict'
    ? '刚有变化，等页面刷新后再点一次。'
    : writeTextOf(error);
}

/** S3: the one `tasks/requeue` write a paused-interrupted Task's 继续 makes.
 * The control's own pins are the expected versions; the result's outer
 * `committed` and inner refusal are judged by `requeuedOrThrow`. */
async function submitContinuation(
  client: ReturnType<typeof createHostClient>, scope: CoreScope, control: LineControlV1,
  reread: () => Promise<void>,
): Promise<void> {
  const task = control.target.task;
  const afterRunRef = control.target.runRef;
  if (task === undefined || afterRunRef === undefined) {
    throw new Error(writeTextOf(new Error('this continuation names no Task and Run')));
  }
  let value: unknown;
  try {
    const reply = await client.write('tasks/requeue', scope, {
      input: { taskRef: task, afterRunRef, reason: '在工作线页面点继续' },
      meta: { requestId: crypto.randomUUID(), expected: control.pins },
    });
    value = committedRouteValue(reply, 'tasks/requeue');
  } catch (error) {
    throw new Error(reworkWriteTextOf(error));
  }
  requeuedOrThrow(value);
  await reread();
}

/** A35 (§2.6, §2.7; lead ruling 4): the outer `committed` of `tasks/requeue`
 * only says the write was recorded; its inner `refused` is a business result,
 * never a success, and the page shows the refusal's own reason. Shared by the
 * line page (`requeueLine`) and Chain (`requeueChain`). */
function requeuedOrThrow(value: unknown): void {
  const outcome = asRecord(value);
  if (outcome.kind === 'refused') {
    /* Lead ruling 1: the line view and Chain refuse with the same sentence as
       the Decide card; one table, `reworkRefusalTextOf`. */
    throw new Error(reworkRefusalTextOf('requeue', outcome.refusal));
  }
  if (outcome.kind !== 'requeued') throw new Error(writeTextOf(new Error('tasks/requeue returned no outcome')));
}

/** The exploration and knowledge writes' failure text. The stop/continue/deepen reasons are the
 * owner's own words; a commit's `unavailable` is git's (shown as it is), the two platform lease
 * reasons are shown as they are, and a bad workspace or a failed `git status` keeps the common
 * write text. `revision_conflict` and everything else falls back to `writeTextOf`. */
function knowledgeWriteTextOf(error: unknown): string {
  if (error instanceof RouteReadError) {
    const exploration = error.route.startsWith('workspaces/exploration/');
    if (error.code === 'unsupported') {
      return exploration ? '这台 Host 没有开放探索控制。' : writeTextOf(error);
    }
    const reason = error.reason;
    if (exploration && error.code === 'invalid') {
      if (reason.includes('this workspace has no unfinished exploration')) return '这个工作区没有在进行的探索。';
      if (reason.includes('this exploration is not stopped')) return '探索没有停下，不用继续。';
      if (reason.includes('the exploration command was refused')) return '这次没能停下或继续，请重读后再试。';
      if (reason.includes('initialization is not complete')) return '初始化还没做完，不能再深一层。';
      if (reason.includes('the block is not in the catalogue')) return '这一块不在当前的架构图里。';
    }
    if (error.code === 'forbidden' && reason === '架构图和注记设置为只留在本机') {
      return '架构图和注记设置为只留在本机，不提交。';
    }
    if (error.code === 'unavailable' && error.route === 'knowledge/commit') {
      if (reason.startsWith('租约目录建不了：') || reason.startsWith('另一个 Host 正在写这个检出：')) return reason;
      if ((reason.startsWith('the workspace ') && reason.includes(' is not registered in the project'))
        || reason.startsWith('git status of ')) return writeTextOf(error);
      if (reason !== '') return '提交没成功：' + reason;
    }
    /* X9 (121-75, group2): a recovery shows only the backend's own Chinese sentence;
       every other reason keeps the common write text. */
    if (error.route === 'knowledge/recover') {
      if (error.code === 'revision_conflict') {
        if (reason === '检出的分支已经变了') return '检出的分支已经变了，没恢复。';
        if (reason === '文件在通知之后又被改过') return '这个文件在通知之后又被改过，没恢复。';
      }
      if (error.code === 'not_found') return '这一项已经恢复过了，或者不在了。';
      if (error.code === 'unavailable' && (
        reason.endsWith(' 的写日志读不出来')
        || reason.endsWith(' 按事件重建的内容不是平台当时写的')
        || reason.endsWith(' 的快照不在了')
        || reason.endsWith(' 在平台记录里已经没有了')
        || reason.includes(' 按事件重建不出来：')
        || reason.startsWith('租约目录建不了：')
        || reason.startsWith('另一个 Host 正在写这个检出：')
      )) return '没恢复：' + reason;
    }
  }
  return writeTextOf(error);
}

/** Ruling item 6: the page text is chosen by the reply code, never the raw
 * route or code. `boot` logs the raw facts; this table is the only translation. */
const READ_ERROR_TEXT: Record<string, string> = {
  not_found: '找不到这个目标。',
  unavailable: '暂时读不到，可以重试。',
  source_stale: '文件正在被改，下次刷新再读。',
};

function pageTextOf(error: unknown): string {
  const code = error instanceof RouteReadError ? error.code : '';
  return READ_ERROR_TEXT[code] ?? '读取失败。';
}

function logReadError(error: unknown): void {
  if (error instanceof RouteReadError) console.error(error.route, error.code, error.reason);
  else console.error(error);
}

/* `readNav` runs on every refresh, so the same English reason is written
   once per Run and reason, never once per refresh. */
const loggedNavReasons = new Set<string>();
function logNavReasonOnce(key: string, reason: string): void {
  if (loggedNavReasons.has(key)) return;
  loggedNavReasons.add(key);
  logReadError(new Error(reason));
}

function hoistHelmet(html: string): void {
  const template = document.createElement('template');
  template.innerHTML = html;
  document.head.append(template.content);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootBoardPage, { once: true });
  else void bootBoardPage();
}

/* --------------------------------------------------------------- track reads */

type TrackPage = TaskMapTrackPageRead & { from?: string; to?: string };

/* Ruling 4/§3: calendar windows have no cursor; a day window is at most 400
 * days, so a longer range is read as several windows and is complete only
 * after every one. The hour read stops at the board's own 14-day long-view
 * threshold (`wlLong`), so the two never disagree about a 14–15 day range;
 * beyond it one day read covers the whole range. */
const HOUR_WINDOW_MAX_MS = 14 * 24 * 60 * 60 * 1000;
const DAY_WINDOW_MAX_MS = 400 * 24 * 60 * 60 * 1000;
const QUARTER_MS = 15 * 60 * 1000;

function browserTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof zone === 'string' && zone !== '') return zone;
  } catch { /* no Intl: the calendar's default zone is UTC */ }
  return 'UTC';
}

function quarterFloor(ms: number): string {
  return new Date(Math.floor(ms / QUARTER_MS) * QUARTER_MS).toISOString();
}
function quarterCeil(ms: number): string {
  return new Date(Math.ceil(ms / QUARTER_MS) * QUARTER_MS).toISOString();
}

/* The browser's local day/week boundaries. A DST day is 23 or 25 hours, so the
 * end is the next local date's start, never `start + 24h`. */
function localDayStart(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function localDayEnd(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}
function localWeekStart(ms: number): number {
  const d = new Date(ms);
  const back = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();
}
function localWeekEnd(ms: number): number {
  const d = new Date(localWeekStart(ms));
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
}

/** Split one range into quarter-aligned windows no longer than the route's own
 * limit. Both ends are aligned before splitting, so rounding can never push a
 * window over 15/400 days (the previous ceil-after-clamp bug). */
function calendarWindows(fromMs: number, toMs: number, maxMs: number):
Array<{ from: string; to: string }> {
  const step = Math.max(QUARTER_MS, Math.floor(maxMs / QUARTER_MS) * QUARTER_MS);
  const start = Math.floor(fromMs / QUARTER_MS) * QUARTER_MS;
  const end = Math.ceil(toMs / QUARTER_MS) * QUARTER_MS;
  const out: Array<{ from: string; to: string }> = [];
  for (let at = start; at < end; at += step) {
    out.push({ from: new Date(at).toISOString(), to: new Date(Math.min(end, at + step)).toISOString() });
  }
  return out;
}

async function readCalendarWindowForBoard(
  client: ReturnType<typeof createHostClient>, scope: CoreScope,
  goalRef: { aggregateType: 'Goal'; projectId: string; goalId: string },
  from: string, to: string, granularity: 'hour' | 'day', timeZone: string,
): Promise<TaskMapCalendarRead> {
  const value = readyRouteValue<TaskMapCalendarRead>(await client.post('activity/calendar', scope, {
    scope: { kind: 'goal', goalRef }, from, to, granularity, timeZone,
  }), 'activity/calendar');
  return { ...value, windows: [{ granularity, from, to }], scope: 'goal' };
}

/* Design §3/§4: one range has one granularity (hour up to 15 days, day up to
 * 400), read as the route's non-overlapping windows. Day and hour windows are
 * never both read for the same range, so their totals cannot be added twice. */
async function readTaskMapCalendar(
  client: ReturnType<typeof createHostClient>, scope: CoreScope,
  goalRef: { aggregateType: 'Goal'; projectId: string; goalId: string },
  fromMs: number, toMs: number,
): Promise<TaskMapCalendarRead[]> {
  const timeZone = browserTimeZone();
  /* The board judges the returned window, so judge its quarter-rounded span. */
  const span = Date.parse(quarterCeil(toMs)) - Date.parse(quarterFloor(fromMs));
  const granularity: 'hour' | 'day' = span <= HOUR_WINDOW_MAX_MS ? 'hour' : 'day';
  const maxMs = granularity === 'hour' ? HOUR_WINDOW_MAX_MS : DAY_WINDOW_MAX_MS;
  const reads: TaskMapCalendarRead[] = [];
  for (const window of calendarWindows(fromMs, toMs, maxMs)) {
    reads.push(await readCalendarWindowForBoard(client, scope, goalRef, window.from, window.to, granularity, timeZone));
  }
  return reads;
}

/** The 500-bar page cap and the 33-Session filter cap (design §3). */
const TRACK_PAGE_LIMIT = 500;
const SESSION_BATCH = 33;
const EXECUTION_PAGE_LIMIT = 100;
const TIMELINE_PAGE_LIMIT = 200;

function sessionKeyOfSession(key: TaskMapSessionRef): string {
  return key.projectId + '/' + key.sessionId;
}

/** Every page of `activity/track` for one filter (none, then ≤33 Sessions). */
async function readTrackPages(
  client: ReturnType<typeof createHostClient>, scope: CoreScope,
  input: Record<string, unknown>, limit: number,
): Promise<TrackPage[]> {
  const pages: TrackPage[] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 1000; guard += 1) {
    const page: TrackPage = readyRouteValue<TrackPage>(await client.post('activity/track', scope,
      { ...input, cursor, limit }), 'activity/track');
    pages.push(page);
    cursor = page.next ?? null;
    if (cursor === null) break;
    if (guard === 999) throw new RouteReadError('activity/track', 'unavailable', 'the track did not finish paging');
  }
  return pages;
}

/** Every `executions/list` page (for 全部, or the open track's 未排期 on any window). */
async function readExecutionPages(
  client: ReturnType<typeof createHostClient>, scope: CoreScope,
  goalRef: { aggregateType: 'Goal'; projectId: string; goalId: string },
): Promise<{ executions: Array<{ runId: string; taskId: string; startAt: string }>; complete: boolean }> {
  const executions: Array<{ runId: string; taskId: string; startAt: string }> = [];
  let after: string | null = null;
  let complete = false;
  for (let guard = 0; guard < 10_000; guard += 1) {
    const page: { items?: unknown[]; nextCursor?: string | null } = readyRouteValue<{ items?: unknown[]; nextCursor?: string | null }>(
      await client.post('executions/list', scope, { goalRef, page: { afterCursor: after, limit: EXECUTION_PAGE_LIMIT } }),
      'executions/list');
    for (const entry of Array.isArray(page.items) ? page.items : []) {
      const run = asRecord(entry).run as Record<string, unknown> | undefined;
      const ref = asRecord(run?.ref);
      executions.push({ runId: asText(ref.runId), taskId: asText(asRecord(run?.task).taskId),
        startAt: asText(run?.startedAt) });
    }
    after = page.nextCursor ?? null;
    if (after === null) { complete = true; break; }
  }
  return { executions, complete };
}

/** Ruling 3/4/§3: the unfiltered Work/check page, then the Query passes over the
 * unique `chainSessions` in batches of at most 33. A Query is deduped by its
 * complete `queryRunRef`; the unfiltered Work/check bars are not counted again.
 * The window is the selected local day/week or the real execution index start —
 * never a fixed 2000 origin. */
async function readTaskMapTime(
  client: ReturnType<typeof createHostClient>, scope: CoreScope,
  goalRef: { aggregateType: 'Goal'; projectId: string; goalId: string },
  lines: TaskMapLineRead, demand: TaskMapReadDemand,
): Promise<TaskMapTimeData> {
  const rows: unknown[] = Array.isArray(lines.rows) ? lines.rows : [];
  const nowMs = Date.now();
  const win = demand.win ?? 'today';
  const fullHistory = win === 'all';
  let executions: Array<{ runId: string; taskId: string; startAt: string }> = [];
  let executionsComplete = false;
  let fromMs: number;
  let toMs: number;
  /* Ruling 4: archived lines join the line set before the Query Sessions and
   * the 全部 origin are taken. The rows are read once and merged. */
  const archived: unknown[] = [];
  if (demand.archive === true) {
    let cursor: string | null = null;
    for (let guard = 0; guard < 1000; guard += 1) {
      const page: { rows?: unknown[]; nextCursor?: string | null } = readyRouteValue<{ rows?: unknown[]; nextCursor?: string | null }>(
        await client.post('lines/archived', scope, { workspace: scope, page: { limit: 100, cursor } }), 'lines/archived');
      archived.push(...(Array.isArray(page.rows) ? page.rows : []));
      cursor = page.nextCursor ?? null;
      if (cursor === null) break;
    }
  }
  const lineRows = archived.length > 0 ? [...rows, ...archived] : rows;
  /* The 全部 `L` reads: one `lines/read` per included line head. Its chain is
   * the only field with a Session's real `createdAt`; the same read serves the
   * selected line below instead of a second request. */
  const lineDetails = new Map<string, { kind?: unknown; row?: unknown; chain?: unknown[]; omitted?: unknown }>();
  const readLineDetail = async (key: { projectId: string; sessionId: string }) =>
    readyRouteValue<{ kind?: unknown; row?: unknown; chain?: unknown[]; omitted?: unknown }>(
      await client.post('lines/read', scope, { workspace: scope, key }), 'lines/read');
  /* `executions: true` reads the index alone; only 全部 takes the track's origin and line chains from it. */
  if (fullHistory || demand.executions === true) {
    const read = await readExecutionPages(client, scope, goalRef);
    executions = read.executions;
    executionsComplete = read.complete;
  }
  if (fullHistory) {
    const originTimes = executions.map((entry) => Date.parse(entry.startAt)).filter((at) => !Number.isNaN(at));
    const seenLine = new Set<string>();
    for (const entry of lineRows) {
      const key = asRecord(asRecord(entry).key);
      const projectId = asText(key.projectId); const sessionId = asText(key.sessionId);
      const id = projectId + '/' + sessionId;
      if (projectId === '' || sessionId === '' || seenLine.has(id)) continue;
      seenLine.add(id);
      let detail: { kind?: unknown; row?: unknown; chain?: unknown[]; omitted?: unknown };
      try {
        detail = await readLineDetail({ projectId, sessionId });
      } catch {
        /* A line whose chain cannot be read does not move the origin. */
        continue;
      }
      lineDetails.set(id, detail);
      for (const chainEntry of Array.isArray(detail.chain) ? detail.chain : []) {
        const at = Date.parse(asText(asRecord(chainEntry).createdAt));
        if (!Number.isNaN(at)) originTimes.push(at);
      }
    }
    fromMs = originTimes.length > 0 ? Math.min(...originTimes) : localDayStart(nowMs);
    toMs = Math.max(nowMs + 60 * 60 * 1000, fromMs + 60 * 60 * 1000);
  } else if (win === 'week') {
    fromMs = localWeekStart(nowMs);
    toMs = Math.max(localWeekEnd(nowMs), nowMs + 45 * 60 * 1000);
  } else {
    fromMs = localDayStart(nowMs);
    toMs = Math.max(localDayEnd(nowMs), nowMs + 45 * 60 * 1000);
  }
  const from = quarterFloor(fromMs);
  const to = quarterCeil(toMs);
  const input = { goalRef, from, to };
  const pages = await readTrackPages(client, scope, input, TRACK_PAGE_LIMIT);
  const seen = new Set<string>();
  const sessions: TaskMapSessionRef[] = [];
  for (const row of lineRows) {
    for (const entry of (Array.isArray(asRecord(row).chainSessions) ? asRecord(row).chainSessions as unknown[] : [])) {
      const session = asRecord(entry);
      const key = asText(session.projectId) + '/' + asText(session.sessionId);
      if (key === '/' || seen.has(key)) continue;
      seen.add(key);
      sessions.push({ projectId: asText(session.projectId), sessionId: asText(session.sessionId) });
    }
  }
  for (let at = 0; at < sessions.length; at += SESSION_BATCH) {
    pages.push(...await readTrackPages(client, scope, {
      ...input, sessionRefs: sessions.slice(at, at + SESSION_BATCH),
    }, TRACK_PAGE_LIMIT));
  }
  /* A picked year day: one hour calendar read for that local day plus that
     day's track, merged for the day→hour row. No per-Session Query page. */
  const hourDay = typeof demand.hourDay === 'string' ? demand.hourDay : '';
  let hourCalendars: TaskMapCalendarRead[] = [];
  let dayTrackPages: TrackPage[] = [];
  if (hourDay !== '') {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(hourDay);
    if (parts !== null) {
      const dayStart = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])).getTime();
      const dayEnd = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]) + 1).getTime();
      hourCalendars = await readTaskMapCalendar(client, scope, goalRef, dayStart, dayEnd);
      dayTrackPages = await readTrackPages(client, scope,
        { goalRef, from: quarterFloor(dayStart), to: quarterCeil(dayEnd) }, TRACK_PAGE_LIMIT);
    }
  }
  const baseComplete = pages.length > 0 && (pages[pages.length - 1]?.next ?? null) === null;
  if (dayTrackPages.length > 0) pages.push(...dayTrackPages);
  let timeline: TaskMapTimelineRead | null = null;
  if (demand.replay === true) {
    const tasks: TaskMapTimelineRead['tasks'] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 1000; guard += 1) {
      const page: TaskMapTimelineRead & { next?: string | null } = readyRouteValue<TaskMapTimelineRead & { next?: string | null }>(
        await client.post('tasks/timeline', scope, { goalRef, cursor, limit: TIMELINE_PAGE_LIMIT }), 'tasks/timeline');
      tasks.push(...page.tasks);
      cursor = page.next ?? null;
      if (cursor === null) break;
    }
    timeline = { tasks };
  }
  const calendars = await readTaskMapCalendar(client, scope, goalRef, fromMs, toMs);
  const time = adaptTaskMapTime(pages, calendars, timeline, lineRows as TaskMapTrackLineRead[],
    new Date(nowMs).toISOString(), asRecord(lines).counts);
  if (dayTrackPages.length > 0) {
    const dayComplete = (dayTrackPages[dayTrackPages.length - 1]?.next ?? null) === null;
    time.complete = baseComplete && dayComplete;
  }
  if (hourCalendars.length > 0 && time.calendar !== null) {
    const calendar = time.calendar;
    const extra = adaptTaskMapCalendar(hourCalendars);
    const seenHours = new Set(calendar.hours.map((hour) => hour.key));
    for (const hour of extra.hours) {
      if (seenHours.has(hour.key)) continue;
      seenHours.add(hour.key);
      calendar.hours.push(hour);
    }
    calendar.hours.sort((a, b) => a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0);
    for (const day of calendar.days) day.hours = calendar.hours.filter((hour) => hour.localDate === day.localDate);
    calendar.windows.push(...extra.windows);
    /* the drilled day's hour pages can carry reasons the year page did not */
    calendar.uncountedWhy = mergeUncountedWhy(calendar.uncountedWhy, extra.uncountedWhy);
    calendar.canBackfill = calendar.canBackfill || extra.canBackfill;
    /* The summary for the drilled day is an hour summary; the year grid keeps
       its own day cells. */
    calendar.granularity = 'hour';
  }
  Object.assign(time, { executionsComplete, executions, archived });
  time.executionsRead = executions.length;
  if (demand.lineKey !== null && demand.lineKey !== undefined) {
    try {
      const key = sessionKeyOfSession(demand.lineKey);
      const detail = lineDetails.get(key) ?? await readLineDetail(demand.lineKey);
      const row = time.rows.find((entry) => entry.id === key);
      if (row !== undefined) {
        const count = asRecord(asRecord(detail.row).sessionCount);
        if (typeof count.value === 'number') row.sessionCount = String(count.value);
        else if (typeof count.atLeast === 'number') row.sessionCount = '至少 ' + String(count.atLeast);
        if (typeof count.status === 'string') row.countPartial = count.status !== 'exact';
        const omitted = asRecord(detail.omitted);
        /* `omitted: {status:'exact', value:0}` is not a partial chain. */
        if (omitted.status === 'partial' || omitted.status === 'unavailable') row.countPartial = true;
        row.chain = Array.isArray(detail.chain) ? detail.chain : [];
        row.omitted = detail.omitted ?? null;
        row.lineRead = true;
      }
      Object.assign(time, { lineDetail: detail, lineKey: demand.lineKey });
    } catch {
      /* A selected line that no longer reads shows the list row; no chain is invented. */
    }
  }
  return time;
}
