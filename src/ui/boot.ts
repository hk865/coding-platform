import { BoardView } from './runtime.js';
import { parseBoard } from './board.js';
import {
  committedRouteValue, createHostClient, fetchPageText, readPlatformToken, readPlatformTokenText, readyRouteValue,
  RouteReadError, subscribeChanges, type BootstrapReply, type CoreScope, type RouteReply,
} from './host-client.js';
import { asRecord, asText } from './values.js';
import { qualifyProjectPath, splitWorkspacePath } from '../contracts/workspace-path.js';
import { createAutoRefresh, type RefreshRead, type RefreshSnapshot, type RefreshSources } from './refresh.js';
import { adaptNav, completionRevisionOf, goalHref, type LineKey, type NavData, type NavLineDetail } from './adapters/nav.js';
import {
  adaptMember, adaptMemberLine, messageBodyKey, startupReportOf, taskOfLine, traceOf,
  type MemberData, type MemberLine, type MemberSource, type MemberWriteBasis,
} from './adapters/member.js';
import { adaptChain, type ChainData, type ChainSource } from './adapters/chain.js';
import { adaptDone, type DoneData, type DonePolicyRead, type DoneRoundRead, type DoneRunActivity, type DoneSource } from './adapters/done.js';
import {
  readLine, readSessionTrace, requeueVisible, submitRunControl, type LineReadValue,
} from './adapters/line-shared.js';
import {
  adaptMain, lvRecordOf, requestRootKey,
  type MainData, type MainLineRecord, type MainPageCursorV1, type MainPageV1, type MainTrackRow,
} from './adapters/main.js';
import {
  adaptPlan, adoptedPlanDoc, candidateReadOf, ideasRoundOf, versionRowsOf,
  type MainPageRead, type PlanCandidateRead, type PlanData, type PlanDoc, type PlanProposalRef,
  type PlanProposalShape, type PlanVersionRow,
} from './adapters/plan.js';
import {
  auxChangedRowsOf, auxFileListOf, auxFilePageOf, auxLeafCountsOf, auxTaskDetailOf, catalogArchTree, goalTaskTree,
  goalTreeNodeOf,
  type AuxDemand, type AuxFilePage, type AuxPanelData, type AuxTab, type AuxTaskData, type AuxWorkspaceFile,
  type GoalsTaskNode,
} from './adapters/aux-panel.js';
import { adaptGoals, conflictSelectionOf, goalOrderOf, type GoalsData } from './adapters/goals.js';
import {
  adaptDecide, budgetTokensOf, draftOf, pinsFor, subjectGoalId, taskTripleOf, type DecideCard, type DecideData, type DecideRow, type DecideStepKey,
} from './adapters/decide.js';
import {
  adaptArchOverview, type ArchCatalogRead, type ArchNoteRead, type ArchObservedRead, type ArchOverviewData,
  type ArchOverviewSource,
} from './adapters/arch-overview.js';
import type { ArchitectureObservationStateV1 } from '../contracts/architecture-observation.js';
import type { ControlIntentSnapshotV1 } from '../contracts/control-intent.js';
import type { ContinuationBriefV1 } from '../contracts/continuation-brief.js';
import type { GraphHoverReadV1, LineExecutionItemV1, LineMessageStateV1, WorkLineDetailV1, WorkLineSectionPageV1 } from '../contracts/work-line.js';
import type { SessionMessageRef } from '../contracts/core/session-message.js';
import type { QueryJobAnswerSnapshot } from '../contracts/query-job.js';
import type { QueryExecutionRecord } from '../contracts/query-job.js';
import type { GoalCopyDraftResultV1 } from '../contracts/goal-card.js';
import type { MessageBody, SessionMessageReadV1 } from '../contracts/mailbox.js';
import type { TaskExecutionRecord } from '../contracts/execution-read.js';
import type { ArtifactRecord } from '../contracts/artifact.js';
import type { RunRef } from '../contracts/dispatch.js';
import type { TaskGraph, TaskRow } from '../contracts/task-graph.js';
import type { UncommittedFileV1, UncommittedFilesV1 } from '../contracts/workspace-files.js';
import type { MemberCopySource } from './adapters/member.js';
import type { ArchitectureChangeScopeV1, ArchitectureWorkScopeV1 } from '../contracts/architecture-search.js';
import type { NoteAnchorV1 } from '../contracts/note.js';
import type { DecisionCardV1, DecisionQueueReadV1 } from './adapters/decide.js';
import { guardNotConnected, notConnectedAttrs } from './not-connected.js';
import type { RequestReferenceInputV1 } from '../contracts/query-job.js';
import type { QueryJobRef } from '../contracts/query-job.js';
import {
  NO_PLAN_TEXT, adaptTaskMap, adaptTaskMapCalendar, adaptTaskMapDecisionCards, adaptTaskMapDetail, adaptTaskMapTime,
  isFinishedGoalDisplayPhase, localShortAt, moduleNamesOf, type GoalDisplayPhaseCode, type TaskMapQueueRead,
  type TaskMapData, type TaskMapDetailTaskRead, type TaskMapDisplayRead, type TaskMapGoalRead,
  type TaskMapGraphRead, type TaskMapHoverRead, type TaskMapLineRead, type TaskMapNodeDetailData,
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
let latestLine: { scope: CoreScope; line: MemberLine; write: MemberWriteBasis | null } | null = null;
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
  /** ArchOverview's page state: the search needle, the work-only switch, the
   * directory view and the selected node's anchor. Explicit values replace the
   * old demand, so closing one passes `''`, `false` or `null`. */
  search?: string;
  workOnly?: boolean;
  dirView?: boolean;
  noteAnchor?: NoteAnchorV1 | null;
  /** Done: expanding one requirement's report reads its `materials/open` once. */
  doneReport?: string | null;
};

/** The one action surface `pageProps` gives every board. TaskMap uses
 * `readMore`/`pinLine`; Main also uses `pickGoal`, `openLine` and the shared
 * not-connected guard. */
export type BoardActions = {
  readMore(demand: BoardReadDemand): void;
  pinLine?: (key: TaskMapSessionRef, pinned: boolean) => Promise<void>;
  pickGoal: (goalId: string) => void;
  openLine: (key: TaskMapSessionRef | null) => void;
  notConnected: (event: { preventDefault(): void; stopPropagation(): void }) => void;
  notConnectedAttrs: () => ReturnType<typeof notConnectedAttrs>;
  /** §2.8: one `goals/control` write with the Goal and GoalPhase pins the page
   * last showed, then the same refresh loop rereads the chrome. */
  controlGoal: (control: 'pause' | 'resume' | 'cancel') => Promise<void>;
  /** §2.3: one `goals/reorder` write with every Goal's current revision, then
   * the same refresh loop rereads the list. */
  reorderGoal: (goalId: string, direction: 'up' | 'down') => Promise<void>;
  /** §2.7 A10: `goals/copy-draft` then `goals/copy-confirm`, both from the
   * draft's own source revision, then the same refresh loop rereads. */
  copyGoal: (goalId: string) => Promise<void>;
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
  /** D18/D30: one `decisions/answer` with the card's own source and pins. */
  answerCard: (cardKey: string, optionId: string) => Promise<void>;
  /** D22/D24/D34/D35: `tasks/requeue`, afterRun and pins from the card itself. */
  requeueCard: (cardKey: string, input: { reason: string; budget: string | null }) => Promise<void>;
  /** D26/D39: `verification/reverify` with the Task's head round and its one pin. */
  reverifyCard: (cardKey: string, note: string) => Promise<void>;
  /** D25/D40: `executions/resolve-unknown` with the card's Run. */
  attestCard: (cardKey: string, reason: string) => Promise<void>;
  /** D20/D23/D27: `plans/propose` + `plans/apply`, changing one Task's disposition. */
  changeDisposition: (cardKey: string, disposition: 'active' | 'deferred' | 'cancelled') => Promise<void>;
  /** D21/D36/D37: `plans/propose` + `plans/apply`, adding a required repair Task. */
  addRepairTask: (cardKey: string, input: { name: string; checkIds: string[] }) => Promise<void>;
  /** D28: `decisions/notices/seen` with the row's own page token. */
  markNoticeSeen: (itemKey: string) => Promise<void>;
  /** D31/D43/D44: the card's question; returns the user's text, this round's root
   * key and answer. */
  askCard: (cardKey: string, text: string) => Promise<{ root: string; input: string; answer: string | null } | null>;
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
  /** E3 Main B §2.5: one `files/save` CAS write; the page passes the digest it read. */
  saveFile: (path: string, content: string, expectedRevision: string | null) => Promise<void>;
};

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
  const search = new URLSearchParams(location.search);
  const goalParam = search.get('goal');
  let goalId = goalParam === null || goalParam === '' ? null : goalParam;
  /* §2.2: Member's whole-line identity. Both values are needed together; one
     alone is ambiguous across projects. Other boards parse them but ignore. */
  const lineProject = search.get('lineProject');
  const lineSession = search.get('lineSession');
  const boardName = boardNameOf(location.href);
  /* A1/A24: the frozen template keeps `Main.dc.html`; the ArchOverview copy
     carries the Goal through the one `goalHref` encoding. TaskMap's detail action
     and Goals/Plan's 整页查看 are the same cross-page links (clk-current P02-9,
     P16-6), so they carry the current Goal too. */
  const source = await fetchPageText(location.href);
  const mainSource = boardName === 'ArchOverview' || boardName === 'Chain' || boardName === 'Decide'
    || boardName === 'Member' || boardName === 'TaskMap'
    ? source.split('href="Main.dc.html"').join('href="' + goalHref('Main.dc.html', goalId) + '"')
    : source;
  const board = parseBoard(document.title, boardName === 'Goals' || boardName === 'Plan' || boardName === 'Main'
    ? mainSource.split('href="TaskMap.dc.html"').join('href="' + goalHref('TaskMap.dc.html', goalId) + '"')
    : mainSource);
  if (board.helmetHtml.length > 0) hoistHelmet(board.helmetHtml);

  const documentToken = readPlatformToken(document);
  const reader = BOARD_READERS[boardName];
  if (documentToken === null || reader === undefined) {
    new BoardView(board).mount(root);
    return;
  }

  const view = new BoardView(board, { ...board.defaults, readState: { status: 'loading' } });
  view.mount(root);
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
    token = next;
    client = createHostClient(token);
    return token;
  }
  /* Ruling 3 "默认页": opening the board reads the DAG's today track and today
   * hour calendar, not only the six base reads. */
  const demand: BoardReadDemand = { track: true, win: 'today' };
  /* Main B §2.1: the panel opens on 任务图, so its first read is `auxTab:'task'`. */
  if (boardName === 'Main') demand.auxTab = 'task';
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
  /** The Decide data and scope the page last published; every card action takes
   * its source/pins/task/run from these, never from a route shape the page sends. */
  let latestDecide: DecideData | null = null;
  let latestDecideScope: CoreScope | null = null;
  /** §2.7: the one line the four line actions read, set by both readers. */
  /** Chain's last successful read; the write seams live beside the reader. */
  let latestChain: ChainData | null = null;
  const decideRowOf = (key: string): DecideRow | null => {
    const data = latestDecide;
    if (data === null) return null;
    return data.sections.flatMap((section) => section.rows).concat(data.history)
      .find((row) => row.key === key) ?? null;
  };
  const decideCardOf = (key: string): DecisionCardV1 | null => decideRowOf(key)?.card ?? null;
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
      throw new Error(writeTextOf(error));
    }
    await refresh.reread();
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

  const actions: BoardActions = {
    readMore(next: BoardReadDemand): void {
      /* Explicit fields replace the old demand, including `false`/`null`, so a
       * closed view can withdraw its read instead of sticking forever. Closing
       * a detail only withdraws its note anchor; the closed detail shows no
       * note, so that withdrawal reads nothing (E3A-15). */
      Object.assign(demand, next);
      if (Object.keys(next).length === 1 && next.noteAnchor === null) return;
      void refresh.reread();
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
       * URL is not rewritten and no draft table is built. */
      goalId = next === '' ? null : next;
      demand.lineKey = null;
      demand.archive = false;
      /* §2.3: a Goal pick goes back to the conversation's first page. */
      demand.mainPages = 1;
      void refresh.reread();
    },
    openLine(key: TaskMapSessionRef | null): void {
      demand.lineKey = key;
      void refresh.reread();
    },
    notConnected: guardNotConnected,
    notConnectedAttrs: () => notConnectedAttrs(),
    async controlGoal(control: 'pause' | 'resume' | 'cancel'): Promise<void> {
      const data = latest;
      if (data === null || data.scope === null || data.selectedGoalId === null
        || data.selectedGoalRevision === null || data.phaseRevision === null) {
        throw new Error('goals/control needs the shown Goal and its GoalPhase revision');
      }
      const goalRef = { aggregateType: 'Goal' as const, projectId: data.scope.projectId, goalId: data.selectedGoalId };
      const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: data.scope.projectId, goalId: data.selectedGoalId };
      const reply = await client.write('goals/control', data.scope, {
        input: { goalRef, control, reason: null },
        meta: {
          requestId: crypto.randomUUID(),
          expected: [
            { ref: goalRef, revision: data.selectedGoalRevision },
            { ref: phaseRef, revision: data.phaseRevision },
          ],
        },
      });
      committedRouteValue(reply, 'goals/control');
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
    async copyGoal(goalId: string): Promise<void> {
      const scope = latestNavScope;
      if (scope === null) throw new Error(writeTextOf(new Error('no navigation scope')));
      const goalRef = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId };
      try {
        const draft = readyRouteValue<GoalCopyDraftResultV1>(
          await client.post('goals/copy-draft', scope, { goalRef }), 'goals/copy-draft');
        /* A10: the confirm pins the revision the draft just read and copies no
           intervention; `goals/copy-confirm` is a plain route, so its input is
           sent as-is and committed is its own receipt. */
        committedRouteValue(await client.post('goals/copy-confirm', scope, {
          commandId: crypto.randomUUID(),
          sourceGoalRef: goalRef,
          expectedSourceRevision: draft.source.revision,
          selectedInterventions: [],
        }), 'goals/copy-confirm');
      } catch (error) {
        throw new Error(writeTextOf(error));
      }
      await refresh.reread();
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
        /* §2.3: a revision conflict is shown and the page rereads; `busy` keeps
           its one-click retry text and does not reread. The stop behind `busy`
           still reaches the page as rereads, so that error carries `keep`: the
           page keeps its text until the next 采用 or 发送 (STK15 P1). */
        if (error instanceof RouteReadError && error.code === 'revision_conflict') {
          await refresh.reread();
        }
        const shown = new Error(writeTextOf(error));
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
    async answerCard(cardKey: string, optionId: string): Promise<void> {
      const card = decideCardOf(cardKey);
      const scope = latestDecideScope;
      if (card === null || scope === null) throw new Error(writeTextOf(new Error('the shown card is gone')));
      const pins = Array.isArray(card.source.pins) ? card.source.pins : [];
      let selection: unknown;
      if (card.source.kind === 'goal_conflict') {
        const ids = pinsFor(card, 'Goal').map((pin) => asText(asRecord(pin.ref).goalId)).filter((id) => id !== '');
        const goals = (latestDecide?.nav.goals ?? []).map((goal) => ({
          ref: { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId: goal.goalId }, order: goal.order,
        }));
        ids.sort((a, b) => (goals.find((goal) => goal.ref.goalId === a)?.order ?? 0)
          - (goals.find((goal) => goal.ref.goalId === b)?.order ?? 0));
        if (ids.length < 2) throw new Error(writeTextOf(new Error('the conflict Goals are not in the list')));
        selection = conflictSelectionOf(optionId,
          { ref: { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId: ids[0]! } },
          { ref: { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId: ids[1]! } }, goals);
      } else {
        selection = { kind: 'option' as const, optionId };
      }
      try {
        const reply = await client.write('decisions/answer', scope, {
          input: { source: card.source, selection, text: '', annotations: [] },
          meta: { requestId: crypto.randomUUID(), expected: pins },
        });
        const receipt = reply.status === 'ready' ? asRecord(asRecord(reply.value).answer) : null;
        if (reply.status !== 'committed' && receipt?.status !== 'committed') {
          throw new RouteReadError('decisions/answer', reply.code || reply.status || 'no status', reply.reason ?? '');
        }
      } catch (error) {
        throw new Error(writeTextOf(error));
      }
      await refresh.reread();
    },
    async requeueCard(cardKey: string, input: { reason: string; budget: string | null }): Promise<void> {
      const card = decideCardOf(cardKey);
      const scope = latestDecideScope;
      /* D6: the Goal-level interruption card's 继续 starts the Goal's driver
         (`workflow/driver-start`, decision 97-9), not `tasks/requeue`. */
      const interrupted = card !== null && card.source.kind === 'goal_cause'
        && asText(asRecord(card.source).key).includes('interrupted_pending_resume');
      if (interrupted && card !== null && scope !== null) {
        const goalId = asText(asRecord(pinsFor(card, 'Goal')[0]?.ref).goalId);
        if (goalId === '') throw new Error(writeTextOf(new Error('this interruption names no Goal')));
        try {
          const reply = await client.post('workflow/driver-start', scope, {
            advance: { schemaVersion: 1, goalRef: { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId },
              flowId: 'decide-continue:' + goalId, sessionHint: null, kind: 'select_work' },
            queryProfileIds: [],
          });
          readyRouteValue(reply, 'workflow/driver-start');
        } catch (error) {
          throw new Error(writeTextOf(error));
        }
        await refresh.reread();
        return;
      }
      const triple = card === null ? null : taskTripleOf(card);
      if (card === null || scope === null || triple === null || card.runRef === null) {
        throw new Error(writeTextOf(new Error('this card has no Task and Run to requeue')));
      }
      const expected = [...pinsFor(card, 'Goal'), ...pinsFor(card, 'Run')];
      const budget = input.budget === null ? null : budgetTokensOf(input.budget);
      if (input.budget !== null && budget === null) {
        throw new Error(writeTextOf(new RouteReadError('tasks/requeue', 'invalid', 'bad budget')));
      }
      try {
        const reply = await client.write('tasks/requeue', scope, {
          input: { taskRef: triple, afterRunRef: card.runRef, reason: input.reason,
            ...(budget === null ? {} : { budget }) },
          meta: { requestId: crypto.randomUUID(), expected },
        });
        if (reply.status === 'needs_decision' || asText(asRecord(reply.value).status) === 'needs_decision') {
          await refresh.reread();
          return;
        }
        const value = committedRouteValue<unknown>(reply, 'tasks/requeue');
        if (asText(asRecord(value).kind) === 'refused') {
          throw new RouteReadError('tasks/requeue', 'refused', asText(asRecord(value).refusal));
        }
      } catch (error) {
        throw new Error(writeTextOf(error));
      }
      await refresh.reread();
    },
    async reverifyCard(cardKey: string, note: string): Promise<void> {
      const row = decideRowOf(cardKey);
      const card = row?.card ?? null;
      const view = row?.view ?? null;
      const scope = latestDecideScope;
      if (card === null || view === null || scope === null || view.roundRef === null) {
        throw new Error(writeTextOf(new Error('this card has no head round to reverify')));
      }
      try {
        const reply = await client.write('verification/reverify', scope, {
          input: { predecessorRoundRef: view.roundRef, note },
          meta: { requestId: crypto.randomUUID(), expected: [{ ref: view.roundRef, revision: view.roundRevision ?? 0 }] },
        });
        const value = committedRouteValue<unknown>(reply, 'verification/reverify');
        if (asText(asRecord(value).kind) === 'refused') {
          throw new RouteReadError('verification/reverify', 'refused', asText(asRecord(value).refusal));
        }
      } catch (error) {
        throw new Error(writeTextOf(error));
      }
      await refresh.reread();
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
        throw new Error(writeTextOf(error));
      }
      await refresh.reread();
    },
    async changeDisposition(cardKey: string, disposition: 'active' | 'deferred' | 'cancelled'): Promise<void> {
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
      const text = disposition === 'active' ? '恢复任务' : disposition === 'deferred' ? '延后任务' : '取消任务';
      await writePlanChange(scope, goalRef, goal.revision, plan, {
        planId: crypto.randomUUID(), taskId: triple.taskId, disposition, text,
        reason: { text, sources: [], affectedTaskIds: [triple.taskId] },
      });
    },
    async addRepairTask(cardKey: string, input: { name: string; checkIds: string[] }): Promise<void> {
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
      const instruction = input.name + '：让失败的检查 ' + input.checkIds.join('、') + ' 通过';
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
        throw new Error(writeTextOf(error));
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
      if (control === null) throw new Error(writeTextOf(new Error('this control is not available')));
      try {
        await submitRunControl(client, data.scope, control, kind);
      } catch (error) {
        throw new Error(writeTextOf(error));
      }
      await refresh.reread();
    },
    async requeueLine(): Promise<void> {
      const data = latestLine;
      const write = data?.write ?? null;
      if (data === null || write === null) throw new Error(writeTextOf(new Error('no requeue facts')));
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
    },
    async controlChain(kind: 'pause' | 'resume' | 'cancel'): Promise<void> {
      const data = latestChain;
      const line = data?.line ?? null;
      if (data === null || line === null || latestChainScope === null) {
        throw new Error(writeTextOf(new Error('no Chain line')));
      }
      const control = line.controls.find((entry) => entry.kind === kind && entry.availability === 'available') ?? null;
      if (control === null) throw new Error(writeTextOf(new Error('this control is not available')));
      try {
        await submitRunControl(client, latestChainScope, control, kind);
      } catch (error) {
        throw new Error(writeTextOf(error));
      }
      await refresh.reread();
    },
    async requeueChain(): Promise<void> {
      const write = latestChainWrite;
      if (write === null || latestChainScope === null) {
        throw new Error(writeTextOf(new Error('no requeue facts')));
      }
      let value: unknown;
      try {
        const reply = await client.write('tasks/requeue', latestChainScope, {
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
          input: { recipient: line.key, text, intent: 'action_request', needsReply: true },
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
  };
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
          : snapshot.data as NavData | null;
        latest = nav;
        latestNavScope = nav?.scope ?? null;
        latestSelectedGoalId = nav?.selectedGoalId ?? null;
        if (boardName === 'Goals') {
          latestGoals = snapshot.data as GoalsData | null;
          latestGoalsScope = latestGoals?.scope ?? null;
        }
        if (boardName === 'Decide') {
          latestDecide = snapshot.data as DecideData | null;
          latestDecideScope = latestDecide?.scope ?? null;
        }
        /* MainData is flat `NavData &` extras, so the card writes use this
           read's queue exactly like Decide's own. */
        const main = snapshot.data as MainData | null;
        if ((boardName === 'Main' || boardName === 'Plan') && main?.decisions) {
          latestDecide = main.decisions;
          latestDecideScope = main.scope;
        }
        if (boardName === 'Chain') latestChain = snapshot.data as ChainData | null;
        if (boardName === 'Member') {
          const member = snapshot.data as MemberData | null;
          latestLine = member?.line ? { scope: member.scope, line: member.line, write: member.write } : null;
        }
        if (boardName === 'Main') {
          latestLine = main?.line && main.scope ? { scope: main.scope, line: main.line.line, write: main.line.write } : null;
        }
      }
      view.updateProps(pageProps(board.defaults, snapshot, restart, actions));
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
 * `materials/open`. `not_found` is a legitimate empty state only where §2.2
 * names it; every other failure is the read's own error. No route shape reaches
 * the page: `adaptDone` folds it into `DoneData`.
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
    const blankSource: DoneSource = {
      nav, deliveryState: 'no_plan', round: null, policy: null,
      changeScope: {
        goalRef: { aggregateType: 'Goal', projectId: scope?.projectId ?? '', goalId: selectedGoalId ?? '' },
        files: [], modules: [], counts: { files: 0, changed: 0, possible: 0 }, complete: true, sourceCursor: null,
      },
      taskFiles: {}, taskFilesIncomplete: false, files: null, runs: [], briefs: {}, activity: [],
      reports: {}, reportError: null,
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
  let files: UncommittedFilesV1 | null = null;
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

  return {
    data: adaptDone({
      nav, deliveryState, round, policy, changeScope, taskFiles, taskFilesIncomplete,
      files, runs, briefs, activity, reports, reportError,
    }),
    cursor,
  };
}

type BoardReader<T> = (
  client: ReturnType<typeof createHostClient>, goalId: string | null, demand?: BoardReadDemand,
) => Promise<RefreshRead<T>>;

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
};

/** The board name a served page is for: `/workbench/TaskMap.dc.html` -> `TaskMap`. */
function boardNameOf(href: string): string {
  const file = new URL(href).pathname.split('/').pop() ?? '';
  return file.endsWith('.dc.html') ? file.slice(0, -'.dc.html'.length) : '';
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
 * the first workspace. With one, decision 104-1 (a read inside a project is not
 * limited by the workspace): each project is tried once, with its first
 * workspace in bootstrap order, and the first `ready` `goals/read` names the
 * scope; that read is returned so the Goal is not read twice. A project that
 * does not hold the Goal answers `not_found` and the next one is tried; when
 * none holds it that `not_found` stands. Any other failure is the read's own
 * error. No workspace at all is `null`.
 */
async function taskMapScope(
  client: ReturnType<typeof createHostClient>, workspaces: BootstrapReply['workspaces'], goalId: string | null,
): Promise<{ scope: CoreScope; goal: { ref: TaskMapGoalRef; read: TaskMapGoalRead } | null } | null> {
  if (goalId === null) {
    const first = workspaces[0];
    return first === undefined ? null : { scope: first.scope, goal: null };
  }
  const tried = new Set<string>();
  let missing: RouteReadError | null = null;
  for (const { scope } of workspaces) {
    if (tried.has(scope.projectId)) continue;
    tried.add(scope.projectId);
    const ref = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId };
    try {
      const read = readyRouteValue<TaskMapGoalRead>(await client.post('goals/read', scope, ref), 'goals/read');
      return { scope, goal: { ref, read } };
    } catch (error) {
      if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
      missing = error;
    }
  }
  if (missing !== null) throw missing;
  return null;
}

/** `goals/list`'s value at the JSON boundary; the chrome reads `ref`, `revision`,
 * `ordinal`, `objective`, `order` and `display.phase` (§2.7). */
type GoalListRead = { goals: Array<Record<string, unknown>> };

/** `lines/archived`'s value at the JSON boundary. */
type ArchivedLineRead = { rows?: unknown[]; nextCursor?: string | null };

/** `decisions/queue`'s value: the counts are taken before paging (§2.11). */
type QueueCountsRead = { counts?: unknown };

/**
 * E3-NAV §2.2/§2.4/§2.7/§2.11: the chrome read of Main and of every board that
 * takes the navigation segment. The scope is the same `taskMapScope` the
 * TaskMap read uses (decision 104-1), so `?goal=` is resolved per project and
 * the navigation reads never fall back to `workspaces[0]` when a Goal was
 * asked for. With no Goal id the first unfinished Goal is chosen: a `null` list
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
  return {
    data: adaptNav({ goals, lines, display, queue, archived, detail, phase, tasks: phase }, selected, scope),
    cursor,
  };
}

/**
 * §2.10: the one decision-queue read Decide and Main share. The section follows
 * `decideDone`, the page follows `decideGoal`, every page keeps its own notice
 * token, and `tasks/query` is read only for Goals that actually carry a Task
 * card. A card-bearing Goal the navigation read already read
 * (`nav.phaseRevision`) is not read twice. `materials/open` stays the caller's
 * on-demand step.
 */
export async function readDecisionQueue(
  client: ReturnType<typeof createHostClient>, scope: CoreScope, nav: NavData,
  demand: BoardReadDemand, workspaceRevision: number,
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
  return adaptDecide({
    nav, scope, workspaceRevision, queue: pages, tasks, selectedGoalId: nav.selectedGoalId,
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
  const queue = await readDecisionQueue(client, scope, navRead.data, demand,
    registration.workspace.revision);
  /* §2.2 step 8: a card-bearing selected Goal hands its own `tasks/query`
     completion revision to the navigation segment; no separate read. A
     `not_found` read is still a read and keeps the original 0. */
  if (goalId !== null && queue.taskGoalIds.includes(goalId)) {
    navRead.data.phaseRevision = completionRevisionOf(queue.plans[goalId]);
  }
  if (demand.decideAnswer !== null && demand.decideAnswer !== undefined) {
    const row = queue.sections.flatMap((section) => section.rows).concat(queue.history)
      .find((entry) => entry.key === demand.decideAnswer) ?? null;
    const bodyRef = row?.card?.answer?.bodyRef ?? null;
    if (bodyRef !== null) {
      const material = readyRouteValue<{ body?: unknown }>(await client.post('materials/open', scope,
        { ref: bodyRef, usage: 'historical_explanation' }), 'materials/open');
      queue.answerBodies[demand.decideAnswer] = asText(material.body);
    }
  }
  return { data: queue, cursor };
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
 * `write` stay the wrapper's.
 */
export async function readLineFacts(
  client: ReturnType<typeof createHostClient>, scope: CoreScope, key: LineKey,
  detail: WorkLineDetailV1, nav: NavData,
): Promise<MemberSource> {
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
  const messagePage = await pageOf('messages');
  messages = messagePage.section === 'messages' ? messagePage.items : [];
  const copyPage = await pageOf('copies');
  const copyItems = copyPage.section === 'copies' ? copyPage.items : [];
  await pageOf('participation');
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
  if (execution !== null && execution.run.requeueRef !== undefined) {
    brief = readyRouteValue<{ brief: ContinuationBriefV1; digest: string } | null>(
      await client.post('executions/brief', scope, { runRef: execution.run.ref }), 'executions/brief');
  }
  /* §2.4 step 6: a line may own a task of another Goal; its own graph is read
     once, never the selected Goal's graph. */
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
  /* The line's own Goal graph rides as `nav.tasks` too, as `readMember` gave
     its adapter before the extraction (the selected Goal's when they match). */
  return {
    scope, nav: { ...nav, tasks: taskGraph }, line: detail, ownKey: key,
    executions, messages, messageViews, messageBodies, copies, controls, brief,
    history: null, files: null, hover: null, execution, taskGraph, write: null, startup: null,
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
  /* §2.4: the Host's start-up report is read once per page read; the Member
     page's 启动核对 section lists its reconcile lines. */
  const startupRead = readyRouteValue<unknown>(
    await client.post('host/reconcile-report', scope, {}), 'host/reconcile-report');
  const startup = startupReportOf(asRecord(startupRead).report);
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
    /* The page's own line, not the selected one (§2.4: the rail's `current`). */
    source.ownKey = demand.ownKey ?? key;
  } else {
    /* A missing/branched line keeps the rail; the centre has no record. */
    source = {
      scope, nav, line, ownKey: demand.ownKey ?? key,
      executions: [], messages: [], messageViews: [], messageBodies: {}, copies: [],
      controls: null, brief: null, history: null, files: null, hover: null,
      execution: null, taskGraph: nav.tasks, write: null, startup,
    };
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
  if (key !== null && !missing) {
    if (requested !== null && nav.detail !== null && nav.detail.kind === 'line') line = nav.detail.row;
    else {
      try {
        const read = await readLine(client, scope, key);
        line = read.kind === 'line' ? read.row : null;
      } catch (error) {
        if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
        line = null;
      }
    }
  }

  let goalWaiting: number | null = null;
  if (nav.selectedGoalId !== null) {
    try {
      const queue = readyRouteValue<{ counts?: { waitingAnswer?: unknown } }>(
        await client.post('decisions/queue', scope, {
          workspace: scope, sections: ['waiting_answer', 'notices'], page: { limit: 1 },
          goalRef: chainGoalRefOf(nav.selectedGoalId),
        }), 'decisions/queue');
      if (typeof queue.counts?.waitingAnswer === 'number') goalWaiting = queue.counts.waitingAnswer;
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
            checks: [], chain: main.chain, delivery: { requirements: [] },
          } as unknown as ChainSource['rounds'][string][number]);
        }
      }
    }
    rounds[runId] = reads;
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
  const lastRun = runs.at(-1) ?? null;
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
    nav, line, archive,
    executions: key === null ? null : {
      section: 'executions', segments, scope: 'indexed', items: tail, nextCursor: null,
      sourceCursor: sourceCursor ?? ('' as never),
    },
    runs, histories, briefs, rounds, tasks, goalWaiting, controls,
  };
  return { data: adaptChain(source, { selected: key, ownKey, dens: '标准', theme: 'dark' }), cursor };
}

/** §2.4: one `files/read` of the working tree; the page's `maxBytes` limit. */
async function readAuxFile(
  client: ReturnType<typeof createHostClient>, scope: CoreScope, path: string,
): Promise<AuxFilePage> {
  return auxFilePageOf(readyRouteValue<AuxWorkspaceFile>(await client.post('files/read', scope, {
    workspace: { aggregateType: 'Workspace', projectId: scope.projectId, workspaceId: scope.workspaceId },
    path, maxBytes: 1_048_576, version: { kind: 'working_tree' },
  }), 'files/read'));
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
): Promise<AuxPanelData> {
  const tab = demand.auxTab;
  const empty: AuxPanelData = {
    tab, task: null, arch: null, files: null, file: null, diff: null, error: null,
  };
  const goal = nav.selectedGoalId === null ? null
    : nav.goals.find((row) => row.goalId === nav.selectedGoalId) ?? null;
  /* The task tree is `nav.tasks` (no read): 任务图 draws it and 架构图 names its tasks from it (lead 11-12, M6). */
  const taskTreeOf = (): Pick<AuxTaskData, 'tree' | 'counts'> => {
    const tree = goal === null ? null : goalTaskTree({ id: goal.goalId, name: goal.objective }, nav.tasks);
    return { tree, counts: tree === null ? {} : auxLeafCountsOf(tree, 'task') };
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
        detail = await readNodeDetail(client, scope, goalRefIn(scope.projectId, goal.goalId),
          nav.tasks, demand.detailTaskId, node?.st ?? '', '');
      }
      const det = detail !== null && tree !== null
        ? auxTaskDetailOf(detail, tree, (id) => crumbPathOf(tree, id))
        : null;
      return { ...empty, task: { tree, counts, detail, detailFor: demand.detailTaskId, moduleNames, taskModules, det } };
    }
    if (tab === 'arch') {
      let architecture: unknown = null;
      try {
        architecture = readyRouteValue<unknown>(await client.post('architecture/read', scope, {
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
      return {
        ...empty, arch: { tree, counts: tree === null ? {} : auxLeafCountsOf(tree, 'file'), work },
        task: { ...taskTreeOf(), detail: null, detailFor: null, moduleNames: {}, taskModules: {}, det: null },
      };
    }
    if (tab === 'files') {
      const page = await readUncommittedPage(client, scope);
      let file: AuxFilePage | null = null;
      if (demand.auxPath !== null) {
        try {
          file = await readAuxFile(client, scope, demand.auxPath);
        } catch (error) {
          /* The path is gone: an empty file page, not a tab error. */
          if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
        }
      }
      return {
        ...empty, files: auxFileListOf(page.paths), file,
        diff: { files: page.files, checkedFirst: page.checkedFirst, rows: auxChangedRowsOf(page.files) },
      };
    }
    if (tab === 'file') {
      if (demand.auxPath === null) return empty;
      let file: AuxFilePage | null = null;
      try {
        file = await readAuxFile(client, scope, demand.auxPath);
      } catch (error) {
        if (!(error instanceof RouteReadError) || error.code !== 'not_found') throw error;
      }
      return { ...empty, file };
    }
    if (tab === 'diff') {
      const page = await readUncommittedPage(client, scope);
      return { ...empty, diff: { files: page.files, checkedFirst: page.checkedFirst, rows: auxChangedRowsOf(page.files) } };
    }
    /* 命令页 has no backend: no route, no command list (B-07). */
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
 * §2.3: the Main read. The chrome is `readNav`'s one read (so `lines/list`,
 * `bootstrap` and the selected Goal's `tasks/query` are not read twice); the
 * conversation follows `mainPages`, the cards are the shared
 * `readDecisionQueue`, and the 轨迹 tab adds the one `sessions/history` read.
 * A failed queue read hides the cards only; every other failure fails the read.
 */
/**
 * §2.3 steps 2–5: the one centre read Main and Plan share. The conversation
 * follows `mainPages` (a missing Goal keeps the pages read so far), the cards
 * are the shared queue (a failed queue read hides them only), the Workspace pin
 * is read only when a 请知悉 row is drawn (and only when the caller asks for
 * notice tokens), and the 轨迹 tab adds the one `sessions/history` read.
 */
export async function readMainThread(
  client: ReturnType<typeof createHostClient>, nav: NavData, demand: BoardReadDemand,
  options: { noticeTokens?: boolean } = {},
): Promise<{
  pages: MainPageRead[]; decisions: DecideData | null;
  older: MainPageCursorV1 | null; track: MainTrackRow[] | null;
}> {
  const scope = nav.scope;
  if (scope === null) return { pages: [], decisions: null, older: null, track: null };
  /* §2.3 step 2: first page at `cursor: null`, then each page's `next`; a
     missing Goal (only with a Goal selected) keeps the pages read so far. */
  let cursor: MainPageCursorV1 | null = null;
  const pages: MainPageRead[] = [];
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
  /* §2.3 step 3: the cards are the queue's; a failed queue read hides them and
     is not an error of the page. */
  let decisions: DecideData | null = null;
  try {
    decisions = await readDecisionQueue(client, scope, nav, { decideGoal: null }, 0);
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
 * §2.3: the Main read. The chrome is `readNav`'s one read (so `lines/list`,
 * `bootstrap` and the selected Goal's `tasks/query` are not read twice); the
 * centre is the shared `readMainThread`. A failed queue read hides the cards
 * only; every other failure fails the read.
 */
export async function readMain(
  client: ReturnType<typeof createHostClient>, goalId: string | null,
  demand: BoardReadDemand = {},
): Promise<RefreshRead<MainData>> {
  const navRead = await readNav(client, goalId, demand);
  if (navRead.data === null) return { data: null, cursor: navRead.cursor };
  const nav = navRead.data;
  const scope = nav.scope;
  if (scope === null) return { data: null, cursor: navRead.cursor };
  const thread = await readMainThread(client, nav, demand);
  const { pages, decisions, older: cursor, track } = thread;
  /* §2.4 step 1: the selected line's record, through the same read and the
     same projection Member uses. `branched` has no single record. */
  let line: MainLineRecord | null = null;
  if (demand.lineKey !== null && demand.lineKey !== undefined
    && nav.detail !== null && nav.detail.kind === 'line') {
    const source = await readLineFacts(client, scope, demand.lineKey, nav.detail, nav);
    const memberLine = adaptMemberLine(source, nav.detail);
    const write = writeBasisOf(nav, memberLine, source.execution, source.taskGraph);
    line = {
      line: memberLine,
      rec: lvRecordOf({
        executions: source.executions, messageViews: source.messageViews,
        bodies: source.messageBodies, copies: source.copies, line: memberLine,
      }),
      rich: { reply: '', liveStep: null, page: memberLine.task !== null ? 'chain' : 'member' },
      write,
    };
  }
  /* §2.4 step 7: only the open tab is read; `null` means the panel is closed. */
  const aux = demand.auxTab === null || demand.auxTab === undefined
    ? null
    : await readAuxPanel(client, scope, nav, {
      auxTab: demand.auxTab,
      auxPath: demand.auxPath ?? null,
      detailTaskId: demand.detailTaskId ?? null,
      workOnly: demand.workOnly === true,
    });
  return {
    data: adaptMain({ nav, pages, decisions, older: cursor, track, line, aux }),
    cursor: navRead.cursor,
  };
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
  const navRead = await readNav(client, goalId, demand);
  if (navRead.data === null) return { data: null, cursor: navRead.cursor };
  const nav = navRead.data;
  const scope = nav.scope;
  if (scope === null) return { data: null, cursor: navRead.cursor };
  /* Ruling 2: Plan A reads the first page only; no "更早" entry is drawn. */
  const thread = await readMainThread(client, nav, { ...demand, mainPages: 1 }, { noticeTokens: false });
  /* §2.2 step 3: the newest round with ideas names the request whose candidate
     the page reads; no request, no candidate, or an empty `candidate` means
     "not read" (`cand: null`). */
  const found = ideasRoundOf(thread.pages);
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
      cand = { head: null, status: 'closed', impact: { marks: [] },
        error: !(error instanceof RouteReadError && error.code === 'not_found') };
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
  const data = adaptPlan({
    main: adaptMain({ nav, ...thread }),
    pages: thread.pages, cand, versions,
  });
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

  const workspace = boot.workspaces.find((entry) => entry.scope.workspaceId === scope.workspaceId);
  const source: ArchOverviewSource = {
    scope, projectName: workspace?.name ?? '',
    goal: found.goal === null ? null : {
      id: found.goal.ref.goalId, ordinal: found.goal.read.ordinal ?? null,
      objective: asText(found.goal.read.goal.objective),
    },
    catalog, observation, observed, changes, files, search, work, tasks, lines, notes,
  };
  const ui = {
    level: 'SYS', view: demand.dirView === true ? 'dir' as const : 'sem' as const,
    selected: anchor === null ? null : anchor.kind === 'file' ? anchor.path : null,
    hover: null, q: needle, workOnly: demand.workOnly === true, legend: false, theme: 'dark' as const,
  };
  return { data: adaptArchOverview(source, ui), cursor };
}

/**
 * E3 Goals §2.1: one read for the Goals page. The order is fixed: bootstrap,
 * the `?goal=` scope, `goals/list`, one `goals/display` per row whose list phase
 * is null (only `not_found` skips that row), `lines/list`, `goals/conflicts`,
 * and only when a card exists the two Goals' `tasks/query` plus
 * `architecture/read`. A default Goal is the first row that is not finished,
 * never `goals[0]`; `goalId` stays the URL value and the resolved Goal is passed
 * to the adapter only.
 */
export async function readGoals(
  client: ReturnType<typeof createHostClient>, goalId: string | null,
  _demand: BoardReadDemand = {},
): Promise<RefreshRead<GoalsData>> {
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
  return {
    data: adaptGoals({
      goals, displays, lines, conflicts, tasks, architecture, projectId: scope.projectId, scope,
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

/** Ruling item 1: `tasks/query` `not_found` is a Goal without an adopted Plan,
 * not an error; every other non-ready reply still throws through `readyRouteValue`. */
async function loadTaskMapForGoal(
  client: ReturnType<typeof createHostClient>,
  scope: CoreScope,
  ref: { aggregateType: 'Goal'; projectId: string; goalId: string },
  reads: { goal: TaskMapGoalRead; display: TaskMapDisplayRead },
  demand: TaskMapReadDemand,
): Promise<TaskMapData> {
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
    return adaptTaskMap(reads.goal, null, reads.display, { lines, hover });
  }
  const hover = readyRouteValue<TaskMapHoverRead>(
    await client.post('graph/hover', scope, { goalRef: ref }), 'graph/hover',
  );
  const decisionCards = await readDecisionCards(client, scope, ref);
  const graph = readyRouteValue<TaskMapGraphRead>(reply, 'tasks/query');
  const data = adaptTaskMap(reads.goal, graph, reads.display, { lines, hover });
  data.decisionCards = decisionCards;
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
  }
  return data;
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

async function readNodeDetail(
  client: ReturnType<typeof createHostClient>, scope: CoreScope,
  goalRef: { aggregateType: 'Goal'; projectId: string; goalId: string },
  graph: { plan: { ref?: unknown }; tasks: readonly unknown[] }, taskId: string, state: string, mapWhy: string,
): Promise<TaskMapNodeDetailData | null> {
  const planRef = graph.plan.ref;
  const row = graph.tasks.map(asRecord).find((entry) => asText(asRecord(entry.ref).taskId) === taskId);
  if (row === undefined || planRef === undefined) return null;
  const node = { kind: 'task' as const, ref: row.ref, planRef };
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
    typeof row.attemptOrdinal === 'number' ? row.attemptOrdinal : null, uncommitted);
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

/** A35 (§2.6, §2.7; lead ruling 4): the outer `committed` of `tasks/requeue`
 * only says the write was recorded; its inner `refused` is a business result,
 * never a success, and the page shows the refusal's own reason. Shared by the
 * line page (`requeueLine`) and Chain (`requeueChain`). */
function requeuedOrThrow(value: unknown): void {
  const outcome = asRecord(value);
  if (outcome.kind === 'refused') {
    const reason = asText(asRecord(outcome.refusal).reason);
    throw new Error(reason === '' ? '重新入队被拒绝。' : '重新入队被拒绝：' + reason);
  }
  if (outcome.kind !== 'requeued') throw new Error(writeTextOf(new Error('tasks/requeue returned no outcome')));
}

/** Ruling item 6: the page text is chosen by the reply code, never the raw
 * route or code. `boot` logs the raw facts; this table is the only translation. */
const READ_ERROR_TEXT: Record<string, string> = {
  not_found: '找不到这个目标。',
  unavailable: '暂时读不到，可以重试。',
};

function pageTextOf(error: unknown): string {
  const code = error instanceof RouteReadError ? error.code : '';
  return READ_ERROR_TEXT[code] ?? '读取失败。';
}

function logReadError(error: unknown): void {
  if (error instanceof RouteReadError) console.error(error.route, error.code, error.reason);
  else console.error(error);
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
