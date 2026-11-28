/**
 * The Main page adapter (E3 Main A §2.2/§2.4/§2.7): one pure conversion from
 * the navigation read, the `main/read` pages, the decision queue and the
 * session trace into the flat `props.data` of `Main.dc.html`. It touches no
 * DOM, no network and no app module.
 *
 * §2.2: the UI keeps its own boundary shapes at the JSON edge, as `decide.ts`
 * does; `MainPageV1`/`MainPageCursorV1` here name only the fields this adapter
 * reads and are never a second copy of a rule.
 */
import type { SessionRef } from '../../contracts/core/identity.js';
import type { DecisionSubjectV1 } from '../../contracts/goal-decisions.js';
import type { QueryJobRef, QueryRunRef, RequestReferenceV1 } from '../../contracts/query-job.js';
import type { RunRef } from '../../contracts/dispatch.js';
import type { TaskGraph } from '../../contracts/task-graph.js';
import type { SessionMessageRef } from '../../contracts/core/session-message.js';
import type { RunStepsReadV1 } from '../../contracts/run-steps.js';
import type { LineExecutionItemV1, LineMessageStateV1 } from '../../contracts/work-line.js';
import type { SessionMessageReadV1, MessageBody } from '../../contracts/mailbox.js';
import type { GoalCopyDraftResultV1, GoalCopyConfirmResultV1 } from '../../contracts/goal-card.js';
import type { ControlIntentRef, ControlIntentSnapshotV1 } from '../../contracts/control-intent.js';
import { asRecord, asText } from '../values.js';
import { holdKindWordOf, localShortAt, planRefText, planVersionText, stopRunText } from './task-map.js';
import {
  runStepsHeadOf, runStepsOf, runStepsSentenceOf, runStepsTimeOf, type RunStepView,
} from './run-steps.js';
import { subjectGoalId, adaptDecide, answerBodyViewOf, cardFromOf, cardReplyOf, cardStateWordOf, FAILURE_WORD,
  type DecideCardReply, type DecideData, type DecideRow, type DecisionCardV1, type DecisionQueueReadV1 } from './decide.js';
import { AUTONOMY_TEXT, goalCauseSentenceOf, taskProgressOf, taskRowIn, taskTitleOf } from './goals.js';
import {
  messageBodyKey, messageFlagsOf, runWordOf, type MemberCopySource, type MemberLine, type MemberWriteBasis,
} from './member.js';
import type { LineReview } from './line-shared.js';
import {
  dutyWordOf, lineNameOfSession, sessionRefAtEdge, type NavData, type NavGoal, type NavGoalFacts, type NavDisplay,
  type NavRunStopFact,
} from './nav.js';
import type { AuxPanelData } from './aux-panel.js';
import { canonicalJson } from '../../contracts/canonical-json.js';

/** One file quote of a user bubble (`RequestReferenceV1`'s four fields). */
export type MainQuote = { path: string; a: number | null; b: number | null; snap: boolean; text: string };

/** A8: what a running command's 停止 button does: the Work one opens the line
 * view's existing cancel card (no second stop path), the Query one cancels its
 * own round. */
export type MainRunStepStop =
  | { kind: 'run' }
  | { kind: 'query'; queryRunRef: QueryRunRef };

/** A1: a step plus A8's stop facts; the board never parses a route. */
export type MainRunStep = RunStepView & { stop?: MainRunStepStop };

/**
 * A1: one Run's `executions/steps` answer as the Run block draws it. The whole
 * page answer is kept (not only the visible strings) so the later paging,
 * live reread and raw-record entry can reuse it without a new route.
 */
export type MainRunSteps = {
  /** A8: the Run this block is (the running-commands match), set by `boot`. */
  ref: RunRef | QueryRunRef | null;
  /** A8: the callId of each drawn step, parallel to `steps` (think steps keep
   * ''); the running-commands match needs it, the page never draws it. */
  callIds: string[];
  /** A2: each step's Kernel position, parallel to `steps`; the trace row with
   * the same position is that step's raw record. */
  positions: number[];
  head: string;
  time: string;
  live: boolean;
  steps: MainRunStep[];
  /** The last shown step's position while more remain; `null` at the end. */
  next: number | null;
  /** The earliest running step's position; the live reread starts one before it. */
  runningFrom: number | null;
  /** The one sentence for `not_started`/`not_entered`/`unknown`; `''` for `steps`. */
  sentence: string;
  /** Whether any think step's text was cut at 16 KB. */
  thinkTruncated: boolean;
  /** The per-page cache key (`boot` sets it): what 再看 50 步 reads. Empty
   * when the block has no page to continue. */
  key: string;
  /** A7: the raw-record link, only when a think step was cut; `null` otherwise. */
  rawHref: string | null;
};

/** Note 5a: a failed `executions/steps` still draws its block, with the page's
 * one failure sentence and no steps (so the block stays one sentence). */
export function failedRunStepsOf(sentence: string): MainRunSteps {
  return {
    ref: null, callIds: [], positions: [], head: sentence, time: '', live: false, steps: [],
    next: null, runningFrom: null, sentence, thinkTruncated: false, key: '', rawHref: null,
  };
}

/** A1: `executions/steps` → the Run block's fields; the board never parses a route. */
export function mainRunStepsOf(read: RunStepsReadV1): MainRunSteps {
  const summary = read.kind === 'steps' ? read.summary : null;
  return {
    ref: null,
    callIds: read.kind === 'steps'
      ? read.steps.map((step) => step.kind === 'think' ? '' : step.callId) : [],
    positions: read.kind === 'steps' ? read.steps.map((step) => step.position) : [],
    head: summary === null ? runStepsSentenceOf(read) : runStepsHeadOf(summary),
    time: summary === null ? '' : runStepsTimeOf(summary),
    live: summary !== null && summary.live,
    steps: runStepsOf(read),
    next: read.kind === 'steps' ? read.next : null,
    runningFrom: read.kind === 'steps' ? read.runningFrom : null,
    sentence: runStepsSentenceOf(read),
    thinkTruncated: read.kind === 'steps'
      && read.steps.some((step) => step.kind === 'think' && step.text.truncated),
    key: '',
    rawHref: null,
  };
}

export type MainLogRow = {
  /** The request root, only for the page to drop a local pending bubble it has
   * already read back; never drawn. */
  root: string;
  /** The original request to continue when revising this round's ideas. */
  requestRoot: QueryJobRef;
  /** The round this row belongs to; Main's plan card 采用 uses it for
   * `selectIdea`. Not drawn. */
  round: QueryJobRef | null;
  /** Whether this round is still the request's last answered round; the plan
   * card's 采用 is live only then (same rule as `plan.ts`). */
  selectable: boolean;
  isSys: boolean; isUser: boolean; isAgent: boolean; isRun: boolean;
  /** Empty for a run row; the fixed words live in the template. */
  text: string;
  /** A round has no public time; this stays empty and `since` is not shown. */
  t: '';
  from: string; hasFrom: boolean;
  /** M1: the request's first user row says where it went (`交给 秘书 N`), and
   * `toKey` is the line it opens; `''` means the sentence is not a link. */
  to: string; toKey: string;
  quotes: MainQuote[]; hasQuotes: boolean;
  ideas: { title: string; detail: string }[];
  hasIdeas: boolean;
  /** A1: this run row's `executions/steps` projection; null on every other row. */
  run: MainRunSteps | null;
};

export type MainTrackRow = { at: string; type: string; id: string; summary: string };

/** M4: one row-action of an expanded fold; the board binds it, the adapter never
 * builds a route. `href` is the one link (调高上限) that leaves the page. */
export type MainFoldAct = {
  kind: 'raise_cap' | 'withdraw';
  label: string;
  /** The settings workspace a withdrawal names (only `withdraw`). */
  scope?: { projectId: string; workspaceId: string };
  checkId?: string;
  href?: string;
  off: string;
  tip: string;
};

/** M2/M4/M6: one folded line of the conversation (`isFold`). `openable` is the
 * toggle; `opens` says whether it opens the centre card (`card`) or its own
 * facts (`fold`). */
export type MainFoldRow = {
  key: string;
  kind: 'card' | 'notice' | 'unreadable';
  text: string;
  title: string;
  from: string;
  facts: { k: string; v: string }[];
  openable: boolean;
  opens: 'card' | 'fold' | null;
  /** A4: the one on-demand read this fold's open asks for; null reads none. */
  reads: 'answer' | 'snapshot' | null;
  cardKey?: string;
  noticeKey?: string;
  acts?: MainFoldAct[];
};


/** §2.2: one run/check/query/talk/mark row of the line's record (the
 * prototype's `wlRecord` shape). `day`/`sep` stay the page's. */
export type LvEntry = {
  id: string;
  kind: 'run' | 'check' | 'query' | 'talk' | 'mark';
  /** Lead ruling 5 (sheet §2.6 `:324`): the line's attempt ordinal; null stays null, never a made-up 1. */
  task: string; taskName: string; att: number | null; seg: number; round: number;
  start: string; end: string; day: string; time: string; dur: string;
  res: string; word: string; tx: string; label: string; gap: string;
  asker: string | null; steps: number; edits: number; checks: number;
  live: boolean;
  /** A1: the current Run's whole steps projection; null on every other entry. */
  runSteps: MainRunSteps | null;
  /** §2.8: the stored message's wake word; only a line message has it. */
  wakeWord?: string;
};
export type LvAct = {
  id: string; start: string; day: string; time: string;
  text: string; stage: 0 | 1 | 2; res: 'applied' | 'rejected' | null; why: string; reply: string;
  /** §2.8: the stored message's two words; only a line message has them. */
  replyWord?: string; wakeWord?: string;
  /** D100-1/D107-2: the message's own closed fact (withdrawn, transferred, original). */
  closed?: string;
};
export type LvRecord = {
  entries: LvEntry[]; acts: LvAct[];
  segs: Array<{ seg: number; from: string; why: string }>;
  attempt: number | null; sessions: number; first: string; last: string;
};

export type MainLineRecord = {
  line: MemberLine;
  rec: LvRecord;
  rich: { reply: string; liveStep: null; page: 'chain' | 'member' | null };
  write: MemberWriteBasis | null;
  /** K3 L7: this line's Task row review, or null when the key is unreadable/absent. */
  review: LineReview | null;
};

export type MainGoal = NavGoal & {
  /** The shown notice lines of this Goal (`main/read`'s folded `summary`); empty for every other Goal. */
  notices: string[];
};

export type MainData = NavData & {
  /** The rail rows with this Goal's folded notice lines (main/read is one Goal's view). */
  goals: MainGoal[];
  /** This read's queue; null = the queue read failed and only the cards hide. */
  decisions: DecideData | null;
  /** Time order, oldest first (the prototype draws the newest at the bottom). */
  conversation: MainLogRow[];
  recipientNote: string;
  /** The last page's `next`; non-null is what draws “更早”. */
  older: MainPageCursorV1 | null;
  /** null = the 轨迹 tab was not opened. */
  track: MainTrackRow[] | null;
  /** §2.7 A07: the one `taskProgressOf` rule Goals also draws. The board's
   * inline logic cannot call a TS function, so the shared result rides here. */
  progress: { done: number; total: number };
  /** Main B §2.2: the selected line's record, or null when none is open. */
  line: MainLineRecord | null;
  /** Main B §2.3: the right panel's current tab read, or null when closed. */
  aux: AuxPanelData | null;
  /** §2.8/T37: the newest original request's own `requests/read` feedback, or
   * null when it has no plan change and no action behind it. */
  requestFeedback: MainRequestFeedback | null;
  /** 5.5-4/5.5-5: the Goal bar's reason line and its hover, from this read's
   * `goals/display` facts; the board only binds it. */
  goalBar: { why: string; tip: string; live: string };
  /** 5.5-10: this page may retry the resume it last sent (`boot` keeps that
   * request id and pins; the Host still reports the re-entry failure). */
  retry: boolean;
  /** M2: the cards filed under one request root, drawn after its last row. */
  cardLines: Record<string, MainFoldRow[]>;
  /** M2/M4/M6: the page-level rows, drawn after the request block. */
  pageLines: MainFoldRow[];
  /** M3: the waiting card's own source line, by cardKey. */
  cardFrom: Record<string, string>;
  /** M9: each answerable card's words, by cardKey. */
  cardReply: Record<string, DecideCardReply>;
};

/**
 * §2.8/T37: the request surface's own feedback (`requests/read`'s `feedback`),
 * shown beside the original request's bubbles instead of only its round
 * answers. The rows carry complete Chinese sentences: the board binds them and
 * never sees a route field name.
 */
export type MainRequestFeedback = {
  /** The original request root the feedback was read from (the bubble key). */
  root: string;
  title: string;
  rows: { k: string; v: string }[];
  /** M5: the sent plan change's one sentence, drawn above the block; `''` hides it. */
  arranged: string;
};

/** One read round, the fields §2.4 draws (`RequestRoundViewV1`). The plan page
 * extends this shape beside it; `ref` is the round's own identity. */
export type MainRoundRead = {
  ref: QueryJobRef;
  /** P1：这一轮的 QueryRun；路由轮是 null，那一轮不画 Run 块。 */
  runRef: QueryRunRef | null;
  /** A1: this round's `executions/steps` answer; filled by `readMainThread`. */
  runSteps: MainRunSteps | null;
  input: string;
  references: RequestReferenceV1[];
  answer: string | null;
  ideas: { title: string; detail: string }[];
  session: SessionRef | null;
  status: string;
  closeCode: string | null;
  closeMessage: string | null;
};

/** One request root of a page (`RequestCoreViewV1`). */
export type MainRequestRead = {
  requestRoot: QueryJobRef;
  owner: SessionRef | null;
  /** M1: `owned`/`waiting`/`owner_archived`/`dropped`; the route always sends it. */
  ownerState?: string;
  /** The Goal the request's rounds now belong to; `null` while no Goal was confirmed from it. */
  effectiveGoalId: string | null;
  rounds: MainRoundRead[];
};

/** One shown notice of `main/read`, narrowed to what the conversation reads. */
export type MainNoticeRead = {
  itemKey?: string;
  summary: string;
  subject: DecisionSubjectV1;
  /** M4: the handoff and the check notice are recognised by these. */
  category?: string;
  noticeKind?: string;
  actions?: readonly { kind: string }[];
  /** The automatic-rework fold's members (their own actions and rework). */
  memberViews?: MainNoticeRead[];
  rework?: {
    operation?: string; reason?: string; sourceRef?: unknown; requestedAt?: string;
    taskRef?: unknown;
  } | null;
  objects?: readonly unknown[];
};

/** `main/read`'s value (`MainPageV1`), narrowed to what the page reads. */
export type MainPageV1 = {
  notices: MainNoticeRead[];
  requests: MainRequestRead[];
  /** M2: optional because Plan's page read omits the field; a missing one is no card. */
  cards?: DecisionCardV1[];
  /** The Goal's source requests still without an effective Goal; optional on scene pages that predate it. */
  pendingSourceRequests?: number;
  next: MainPageCursorV1 | null;
};

/** The continuation `main/read` returns; the UI keeps its boundary shape. */
export type MainPageCursorV1 = { phase: 'goal' | 'pre' | 'bound' | 'source'; since: string; rootKey: string };

function feedbackRequestStateText(state: string): string {
  switch (state) {
    case 'pending': return '等你答复这张卡';
    case 'open': return '已批准，等平台安排领取';
    case 'applied': return '已领取';
    case 'released': return '已放行';
    case 'void': return '已作废';
    case 'denied': return '你已拒绝';
    case 'withdrawn': return '已撤回';
    default: return '状态暂时读不到';
  }
}

/** §2.8: one feedback action as the request surface's one row: the task, the
 * reason and how it ended, in the shared words the task cards also use. */
function feedbackActionRow(
  action: Record<string, unknown>, nav: NavData, taskTitleOf: (task: unknown) => string,
): { k: string; v: string } | null {
  const kind = asText(action.kind);
  const task = taskTitleOf(action.task);
  if (task === '') return null;
  const reason = asText(action.reason);
  const reasonText = reason === '' ? '' : '：' + reason;
  if (kind === 'hold') {
    const word = holdKindWordOf(action.holdKind);
    const line = lineNameOfSession(nav.lines, sessionRefAtEdge(action.heldBy));
    const by = line === '' ? '' : '，由“' + line + '”提出';
    const held = asText(action.holdState) === 'held';
    const state = held ? (word === '叫停' ? '仍叫停' : '仍暂缓') : '已解除';
    return { k: word, v: '「' + task + '」' + reasonText + '（' + state + by + '）' };
  }
  if (kind === 'dispatch') {
    const planVersion = asRecord(action.planVersion);
    const version = typeof planVersion.planRevision === 'number'
      ? '，请求时' + planVersionText(planVersion.planRevision) : '';
    const state = asText(action.requestState);
    const claimed = lineNameOfSession(nav.lines, sessionRefAtEdge(asRecord(action.claimedBy).session));
    const stateText = state === 'applied'
      ? (claimed === '' ? '已领取' : '已由“' + claimed + '”领取')
      : feedbackRequestStateText(state);
    return { k: '派活', v: '「' + task + '」' + reasonText + version + '（' + stateText + '）' };
  }
  if (kind === 'stop') {
    const runId = asText(asRecord(action.stopRun).runId);
    const taskId = asText(asRecord(action.task).taskId);
    const hit = taskRowIn(nav.tasks, taskId);
    const taskRow = hit === null ? null : asRecord(hit);
    const runText = runId === '' ? '' : '，要停的运行 ' + stopRunText(action.stopRun, taskRow);
    const state = asText(action.requestState);
    const notSent = asText(action.notSent);
    const stateText = state === 'released'
      ? notSent === 'person_stopped' ? '你已接手，没有送停'
        : notSent === 'run_ended' ? '运行已结束，没有送停' : '已送出'
      : feedbackRequestStateText(state);
    return { k: '叫停', v: '「' + task + '」' + reasonText + runText + '（' + stateText + '）' };
  }
  return null;
}

/** §2.8/T37: turns `requests/read`'s feedback into the block the request
 * surface draws; a request with no plan change and no action behind it has no
 * block. */
export function mainRequestFeedbackOf(read: unknown, nav: NavData, root: string): MainRequestFeedback | null {
  const feedback = asRecord(asRecord(read).feedback);
  const affected = Array.isArray(feedback.affectedTasks) ? feedback.affectedTasks : [];
  const actions = Array.isArray(feedback.actions) ? feedback.actions : [];
  const planRevision = asRecord(feedback.planRevision);
  if (affected.length === 0 && actions.length === 0 && Object.keys(planRevision).length === 0) return null;
  const tasks = nav.tasks?.tasks ?? null;
  const feedbackTitleOf = (task: unknown): string => {
    const id = asText(asRecord(task).taskId);
    if (id === '') return '';
    return taskTitleOf(tasks, id, '一个任务');
  };
  const rows: { k: string; v: string }[] = [];
  const planId = asText(planRevision.planId);
  if (planId !== '') {
    const current = nav.tasks?.plan ?? null;
    rows.push({ k: '计划版本', v: planRefText(planId, current) });
  }
  const names = affected.map(feedbackTitleOf).filter((name) => name !== '');
  if (names.length > 0) rows.push({ k: '受影响的任务', v: names.join('、') });
  for (const action of actions) {
    const row = feedbackActionRow(asRecord(action), nav, feedbackTitleOf);
    if (row !== null) rows.push(row);
  }
  /* M5: `affectedTasks` is the request's actions' tasks and the adopted plan
     change's tasks; the latter is what remains after the action tasks. The
     line only appears when that change really entered the plan. */
  const actionTaskIds = new Set(actions.map((action) => asText(asRecord(asRecord(action).task).taskId))
    .filter((id) => id !== ''));
  const planTaskNames = affected
    .filter((task) => !actionTaskIds.has(asText(asRecord(task).taskId)))
    .map(feedbackTitleOf).filter((name) => name !== '');
  let arranged = '';
  if (planTaskNames.length > 0 && planId !== '') {
    const shown = planTaskNames.slice(0, 3);
    arranged = '已安排：' + shown.join('、')
      + (planTaskNames.length > 3 ? '，等 ' + String(planTaskNames.length) + ' 个任务' : '')
      + '，进了' + planRefText(planId, nav.tasks?.plan ?? null);
  }
  return rows.length === 0 && arranged === '' ? null : { root, title: '这条请求的处理', rows, arranged };
}

/** The composite identity of one request root: the dedupe key across pages and
 * the one place the page's pending bubbles get the key they match. */
export function requestRootKey(ref: QueryJobRef): string {
  return ref.projectId + '/' + ref.workspaceId + '/' + ref.queryJobId;
}

function quoteOf(reference: RequestReferenceV1): MainQuote {
  return {
    path: reference.path,
    a: reference.startLine,
    /* §2.4: `endLine === null` is one line, not `a–null`. */
    b: reference.endLine ?? reference.startLine,
    snap: reference.snapshot !== null,
    text: reference.snapshot ?? '',
  };
}

/** §2.8: the last round of one request that has an answer; `selectable` (and
 * Plan's `askRound`) is this round, never a copy of the search. */
export function lastAnsweredRoundOf(
  request: { rounds: readonly { ref: QueryJobRef; answer: string | null }[] },
): QueryJobRef | null {
  return [...request.rounds].reverse().find((round) => round.answer !== null)?.ref ?? null;
}

function logRowOf(
  requestRoot: QueryJobRef,
  fields: Pick<MainLogRow, 'text'>
  & Partial<Pick<MainLogRow, 'isUser' | 'isAgent' | 'isRun' | 'quotes' | 'ideas' | 'round' | 'selectable' | 'run' | 'to' | 'toKey'>>,
): MainLogRow {
  const quotes = fields.quotes ?? [];
  const ideas = fields.ideas ?? [];
  return {
    root: requestRootKey(requestRoot),
    requestRoot,
    round: fields.round ?? null,
    selectable: fields.selectable === true,
    isSys: false,
    isUser: fields.isUser === true,
    isAgent: fields.isAgent === true,
    isRun: fields.isRun === true,
    text: fields.text,
    t: '',
    from: '',
    hasFrom: false,
    to: fields.to ?? '',
    toKey: fields.toKey ?? '',
    quotes,
    hasQuotes: quotes.length > 0,
    ideas,
    hasIdeas: ideas.length > 0,
    run: fields.run ?? null,
  };
}

export function recipientNoteOf(ref: SessionRef | null, nav: NavData): string {
  if (ref === null) return '等空闲的秘书接手';
  const name = lineNameOfSession(nav.lines, ref) || lineNameOfSession(nav.archived, ref);
  return '将交给 ' + (name || '秘书');
}

/** M1: the request's own line, or the sentence saying why there is none. The
 * line is found in this page's rail (open and archived rows); a line this page
 * cannot name keeps the unnumbered word rather than a guessed name. */
function toOf(request: MainRequestRead, nav: NavData): { to: string; toKey: string } {
  const state = request.ownerState ?? 'owned';
  if (state === 'dropped') return { to: '', toKey: '' };
  if (state === 'waiting') return { to: '等空闲的秘书接手', toKey: '' };
  if (state === 'owner_archived') return { to: '原来的秘书已归档，等平台另派', toKey: '' };
  const owner = request.owner;
  if (owner === null) return { to: '交给 秘书', toKey: '' };
  const line = nav.lines.find((row) => row.key.projectId === owner.projectId
    && row.key.sessionId === owner.sessionId)
    ?? nav.archived.find((row) => row.key.projectId === owner.projectId
      && row.key.sessionId === owner.sessionId);
  if (line === undefined) return { to: '交给 秘书', toKey: '' };
  return { to: '交给 ' + line.name, toKey: line.key.projectId + '/' + line.key.sessionId };
}

/** §2.4: pages are newest first and so are their requests; dedupe by request
 * root, then reverse once so the oldest request draws first. A round is one
 * user line, an optional run line, then its answer or its failure line. */
export function conversationOf(pages: readonly MainPageV1[], nav: NavData): MainLogRow[] {
  const seen = new Set<string>();
  const requests: MainRequestRead[] = [];
  for (const page of pages) {
    for (const request of page.requests) {
      const key = requestRootKey(request.requestRoot);
      if (seen.has(key)) continue;
      seen.add(key);
      requests.push(request);
    }
  }
  const rows: MainLogRow[] = [];
  for (const request of requests.reverse()) {
    const root = request.requestRoot;
    const lastAnswered = lastAnsweredRoundOf(request);
    const to = toOf(request, nav);
    let firstRow = true;
    for (const round of request.rounds) {
      const selectable = lastAnswered !== null && lastAnswered.queryJobId === round.ref.queryJobId;
      rows.push(logRowOf(root, {
        text: round.input, isUser: true, round: round.ref, selectable, quotes: round.references.map(quoteOf),
        ...(firstRow ? to : {}),
      }));
      firstRow = false;
      if (round.runRef !== null) {
        rows.push(logRowOf(root, {
          text: '', isRun: true, round: round.ref, selectable, run: round.runSteps,
        }));
      }
      if (round.answer !== null) {
        rows.push(logRowOf(root, {
          text: round.answer,
          isAgent: true,
          round: round.ref,
          selectable,
          ideas: round.ideas.map((idea) => ({ title: idea.title, detail: idea.detail })),
        }));
      } else if (round.status === 'ended' && round.closeMessage !== null) {
        /* §2.4: a failed secretary round is still the secretary's line, never a
           system line; the page shows the message alone, the code stays in logs. */
        rows.push(logRowOf(root, {
          text: round.closeMessage,
          isAgent: true,
          round: round.ref,
          selectable,
        }));
      }
    }
  }
  return rows;
}

/** `lvView`'s day and time cells: `localShortAt` (the one stamp rule) split at
 * its space; `''` stays `''`. Decide's `timeOf` keeps the whole stamp or null. */
function dayTimeOf(at: string): { day: string; time: string } {
  const text = at === '' ? '' : localShortAt(at);
  return { day: text.slice(0, 5), time: text.slice(6) };
}

function runTx(status: string, outcome: string | null): string {
  if (status !== 'ended') return 'tx-running';
  if (outcome === 'completed') return 'tx-plain';
  if (outcome === 'cancelled') return 'tx-cancelled';
  if (outcome === null) return 'tx-waiting';
  return 'tx-failed';
}

/** §2.2: the prototype record from the route facts, not from Member's rows.
 * The same `lines/page`/`messages/view` reads feed both pages; only this
 * projection is Main's (day/sep stay in `lvView`). */
export function lvRecordOf(f: {
  executions: LineExecutionItemV1[];
  messages: LineMessageStateV1[];
  messageViews: SessionMessageReadV1[];
  bodies: Record<string, MessageBody>;
  copies: MemberCopySource[];
  line: MemberLine;
  /** A1/A3: every Run the record draws, keyed by its own run id, from that
   * Run's `executions/steps` projection. */
  runStepsByRun: ReadonlyMap<string, MainRunSteps>;
  /** L2: each drawn message's closed fact, keyed by its message id. */
  closedByMessage?: Readonly<Record<string, string>>;
}): LvRecord {
  const line = f.line;
  const entries: LvEntry[] = [];
  const acts: LvAct[] = [];
  const messageStates = new Map(f.messages.map((state) => [state.messageRef.messageId, state]));
  const taskId = line.taskRef?.taskId ?? '';
  const executions = f.executions.slice().sort((a, b) => a.generation - b.generation);
  for (const item of executions) {
    if (item.kind === 'query') {
      const at = item.startedAt === null ? '' : item.startedAt;
      const stamp = dayTimeOf(at);
      entries.push({
        id: item.queryRunRef.runId, kind: 'query', task: taskId, taskName: line.title,
        att: line.attempt.ordinal, seg: 1, round: 0, start: item.startedAt === null ? '' : localShortAt(item.startedAt),
        end: '', day: stamp.day, time: stamp.time, dur: '',
        res: item.outcome ?? item.phase, word: item.phase, tx: 'tx-plain',
        label: '只读咨询 · ' + item.phase + (item.outcome === null ? '' : ' · ' + item.outcome),
        gap: '', asker: null, steps: 0, edits: 0, checks: 0, live: false, runSteps: null,
      });
      continue;
    }
    const stamp = dayTimeOf(item.startedAt ?? '');
    const live = item.status !== 'ended';
    /* A3: every drawn Run's steps come from its own `executions/steps`; a line
       whose workspace could not be read draws its row without a block, never
       the old not-connected text. */
    const runSteps = f.runStepsByRun.get(item.runRef.runId) ?? null;
    entries.push({
      id: item.runRef.runId, kind: 'run', task: item.task.taskId, taskName: line.title,
      att: line.attempt.ordinal, seg: 1, round: 0, start: item.startedAt === null ? '' : localShortAt(item.startedAt),
      end: '', day: stamp.day, time: stamp.time, dur: runSteps === null ? '—' : '',
      res: item.outcome ?? item.status,
      word: runWordOf(item),
      tx: runTx(item.status, item.outcome), label: runSteps === null ? '' : runSteps.head,
      gap: '', asker: null,
      steps: runSteps === null ? 0 : runSteps.steps.length, edits: 0, checks: item.checks.length, live,
      runSteps,
    });
  }
  for (const state of f.messageViews) {
    const message = state.message;
    const text = f.bodies[messageBodyKey(state.message.ref, 'message')]?.text ?? '';
    const reply = f.bodies[messageBodyKey(state.message.ref, 'response')]?.text ?? '';
    const at = message.createdAt;
    const stamp = dayTimeOf(at);
    const appliedAt = message.appliedAt;
    const rejectedAt = message.rejectedAt;
    const stage: 0 | 1 | 2 = rejectedAt !== null || appliedAt !== null ? 2 : state.delivery.delivery === 'delivered' ? 1 : 0;
    const recipient = message.recipient;
    const toLine = !('kind' in recipient) && recipient.projectId === line.key.projectId
      && recipient.sessionId === line.key.sessionId;
    const human = message.sender.kind === 'host' && message.sender.actor.kind === 'human';
    const lineState = messageStates.get(message.ref.messageId);
    const flags = lineState === undefined ? null : messageFlagsOf(lineState);
    if (human && toLine) {
      const act: LvAct = {
        id: message.ref.messageId, start: localShortAt(at), day: stamp.day, time: stamp.time,
        text, stage,
        res: rejectedAt !== null ? 'rejected' : appliedAt !== null ? 'applied' : null,
        /* SPEC-22: the message read has no rejection reason (only `rejectedAt`),
           so a rejected one carries none and `recAct` says only 被拒绝 */
        why: rejectedAt !== null ? '' : appliedAt !== null ? '已生效' : '',
        reply,
      };
      const closed = f.closedByMessage?.[message.ref.messageId];
      if (closed !== undefined && closed !== '') act.closed = closed;
      if (flags !== null) {
        act.replyWord = flags.replyWord;
        act.wakeWord = flags.wakeWord;
      }
      acts.push(act);
      continue;
    }
    entries.push({
      id: message.ref.messageId, kind: 'talk', task: taskId, taskName: line.title,
      att: 1, seg: 1, round: 0, start: localShortAt(at), end: '', day: stamp.day, time: stamp.time, dur: '',
      res: '', word: flags === null ? '' : flags.replyWord, tx: 'tx-plain', label: text, gap: '', asker: null,
      ...(flags === null ? {} : { wakeWord: flags.wakeWord }),
      steps: 0, edits: 0, checks: 0, live: false, runSteps: null,
    });
  }
  for (const copy of f.copies) {
    const question = copy.query === null ? '' : asText(asRecord(copy.query.job.job.intent).question);
    const answer = copy.answer === null ? '' : asText(asRecord(copy.answer.answer).answer);
    const startedAt = copy.query === null ? null : copy.query.run.run.startedAt;
    const stamp = dayTimeOf(startedAt ?? '');
    entries.push({
      id: copy.item.messageRef.messageId, kind: 'query', task: taskId, taskName: line.title,
      att: 1, seg: 1, round: 0, start: startedAt === null ? '' : localShortAt(startedAt), end: '',
      day: stamp.day, time: stamp.time, dur: '', res: answer === '' ? 'pending' : 'answered',
      word: answer === '' ? '等待回答' : '已回答', tx: 'tx-plain', label: question || '咨询（只读副本）',
      gap: '', asker: null, steps: 0, edits: 0, checks: 0, live: false, runSteps: null,
    });
  }
  entries.sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
  acts.sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
  const times = entries.map((entry) => entry.start).filter((value) => value !== '');
  return {
    entries, acts, segs: [], attempt: line.attempt.ordinal, sessions: 1,
    first: times[0] ?? '', last: times[times.length - 1] ?? '',
  };
}

const INTENT_WORD: Record<string, string> = { pause: '暂停', cancel: '取消', resume: '继续', steer: '改向' };
const INTENT_STATUS_WORD: Record<string, string> = {
  queued: '排队', applied: '已生效', outcome_unknown: '结果未知', superseded: '已被替代',
};

function taskNameOfRun(tasks: TaskGraph | null, runId: string): string {
  const row = tasks?.tasks.find((task) => task.execution !== null && task.execution.runId === runId);
  return row === undefined ? '一个执行' : row.definition.title;
}

/** 5.5-5: one Run's actual stop state in the hover's words. The `unsupported`
 * reason is English and stays in the log; `other_intent` names the intent kind
 * and status, never its ref. */
function runStopSentenceOf(fact: NavRunStopFact, phase: string, tasks: TaskGraph | null): string {
  const stop = fact.stop;
  const task = taskNameOfRun(tasks, fact.runRef.runId);
  if (stop.kind === 'paused_interrupted') {
    return '「' + task + '」：' + (stop.pausedBy === 'goal_fan_out'
      ? '已暂停，继续目标后接着做' : '已暂停，要你点继续');
  }
  if (stop.kind === 'ended') {
    const word = stop.outcome === 'completed' ? '已结束：完成'
      : stop.outcome === 'failed' ? '已结束：失败'
        : stop.outcome === 'cancelled' ? '已结束：已取消' : '已结束';
    return '「' + task + '」：' + word;
  }
  if (stop.kind === 'unknown_outcome' || stop.kind === 'stop_unknown') return '「' + task + '」：待核对';
  if (stop.kind === 'unsupported') {
    const reason = stop.reason;
    /* 5.5-5: an English or code reason stays in the log; a Chinese one is the
       Host's own capability sentence and is shown after the prefix. */
    return '「' + task + '」：停不了：这台 Host 不支持'
      + (reason !== '' && /[\u4e00-\u9fff]/.test(reason) ? '（' + reason + '）' : '');
  }
  if (stop.kind === 'stop_requested') {
    return '「' + task + '」：' + (phase === 'PAUSED' ? '已请求暂停，等安全点' : '已请求取消');
  }
  if (stop.kind === 'paused') return '「' + task + '」：已暂停';
  if (stop.kind === 'cancelled') return '「' + task + '」：已取消';
  if (stop.kind === 'other_intent') {
    const kind = INTENT_WORD[stop.intentKind] ?? '认不出';
    const state = INTENT_STATUS_WORD[stop.status] ?? '结果未知';
    return '「' + task + '」：有别的控制在先：' + kind + '·' + state;
  }
  if (stop.kind === 'not_delivered') return '「' + task + '」：还没送到，平台会再送';
  return '「' + task + '」：待核对';
}

/** 5.5-9: one resume wait in the hover's words. */
function resumePendingSentenceOf(fact: { runRef: { runId: string }; intentKind: string; status: string },
  tasks: TaskGraph | null): string {
  const task = taskNameOfRun(tasks, fact.runRef.runId);
  if (fact.intentKind === 'pause' && fact.status === 'queued') return '「' + task + '」：暂停到了安全点就自动恢复';
  if (fact.intentKind === 'resume' && fact.status === 'queued') return '「' + task + '」：正在接着原来那一轮做';
  return '「' + task + '」：待核对';
}

/** 5.5-4/5.5-5/5.5-9/5.5-10/5.5-6: the Goal bar's reason line and its whole
 * hover. The caller has already handled a broken read (its own stale text is
 * the first thing the board draws). */
export function goalBarTextOf(
  display: NavDisplay | null, facts: NavGoalFacts | null, tasks: TaskGraph | null, working: number,
): { why: string; tip: string; live: string } {
  if (display === null || facts === null) return { why: '', tip: '', live: '' };
  const tip: string[] = [];
  if (facts.continuedFrom !== null) {
    const from = facts.continuedFrom;
    tip.push(from.ordinal === null
      ? '接续自一个已取消的目标'
      : '接续自 目标 ' + String(from.ordinal) + (from.name === '' ? '' : '「' + from.name + '」'));
  }
  if (display.phase === 'PAUSED') {
    tip.push('暂停期间仍可问一问、查找、起草和答卡；不会开始修改、不放行等着发的工作，也不会自己继续。');
  }
  for (const cause of facts.causes) {
    const sentence = goalCauseSentenceOf(cause, tasks);
    if (sentence !== '') tip.push(sentence);
  }
  for (const stop of facts.runStops) tip.push(runStopSentenceOf(stop, display.phase, tasks));
  for (const pending of facts.resumePending) tip.push(resumePendingSentenceOf(pending, tasks));
  for (const failure of facts.reentryFailures) {
    tip.push('「' + taskNameOfRun(tasks, failure.runRef.runId) + '」：接着做没接上，可以重试恢复');
  }
  for (const live of facts.liveRuns) tip.push('会停下：「' + taskNameOfRun(tasks, live.runId) + '」');
  let why: string;
  if (display.phase === 'CANCELLED') {
    why = '记录保留，可重新入队';
  } else if (display.phase === 'PAUSED') {
    why = '只读可用';
  } else if (['NEEDS_DECISION', 'BLOCKED', 'FAILED', 'CHANGE_PENDING', 'PLANNING'].includes(display.phase)
    && facts.cause !== null) {
    why = goalCauseSentenceOf(facts.cause, tasks);
  } else {
    why = '';
  }
  if (why === '') {
    why = (working > 0 ? String(working) + ' 条工作线工作中' : '没有工作线在工作')
      + (facts.resumePending.length > 0 ? '；恢复等待中 ' + String(facts.resumePending.length) + ' 个执行' : '');
  }
  const live = facts.liveRuns.length === 0 ? ''
    : '会停下的执行：' + facts.liveRuns.map((run) => '「' + taskNameOfRun(tasks, run.runId) + '」').join('、');
  return { why, tip: tip.join('\n'), live };
}

/** The fan-out receipt's narrow read shape, declared here at the JSON edge as
 * `main.ts` does for every route (the same fields as
 * `src/app/goal-fan-out-driver.ts:70-123`). */
export type GoalFanOutRunReadV1 = {
  runRef: RunRef;
  outcome: 'submitted' | 'already_submitted' | 'skipped' | 'stale' | 'failed';
  intentRef: ControlIntentRef | null;
  reason: string | null;
};
export type GoalFanOutContinuationReadV1 = {
  taskId: string;
  afterRunRef: RunRef;
  outcome: 'requeued' | 'refused' | 'already_continued' | 'stale' | 'failed';
  reason: string | null;
};
export type GoalFanOutReportReadV1 = {
  control: string | null;
  runs: readonly GoalFanOutRunReadV1[];
  problem: string | null;
  continuations?: readonly GoalFanOutContinuationReadV1[];
};
export type GoalControlOutcomeReadV1 = {
  goal: { ref: unknown };
  fanOut: GoalFanOutReportReadV1;
};

/** One result word for every fan-out outcome; `submitted` is the control's own. */
const FAN_OUT_RESULT_WORD: Record<Exclude<GoalFanOutRunReadV1['outcome'], 'submitted'>, string> = {
  already_submitted: '之前已经送过',
  skipped: '这次没送（已结束，或者有别的控制在先）',
  stale: '目标又变了，这次没送',
  failed: '没送成，平台下一轮会再试',
};
const FAN_OUT_SUBMITTED_WORD: Record<'pause' | 'resume' | 'cancel', string> = {
  pause: '已送去暂停', cancel: '已送去取消', resume: '已送去恢复',
};

const CONTINUATION_WORD: Record<GoalFanOutContinuationReadV1['outcome'], string> = {
  requeued: '已接着做', refused: '没接上（被拒）', already_continued: '之前已经接着做了',
  stale: '目标又变了，没接', failed: '没接上，平台下一轮会再试',
};

/** One receipt line plus whether it is a success the board may tick. */
export type GoalControlReportLine = { text: string; tick: boolean };

/** 5.5-2/5.6-6: the control's receipt, one row per affected Run. `entered` is the
 * `controls/read` answer of every submitted resume, keyed by the Run id; a
 * queued or unread one keeps the table's 已送去恢复 word. A successful entry
 * observation replaces that Run's one word rather than appending a second row. */
export function goalControlReportOf(
  outcome: GoalControlOutcomeReadV1, control: 'pause' | 'resume' | 'cancel', tasks: TaskGraph | null,
  entered: ReadonlyMap<string, ControlIntentSnapshotV1> = new Map(),
): GoalControlReportLine[] {
  const fanOut = outcome.fanOut;
  const runs = fanOut.runs;
  const head = control === 'pause' ? '暂停目标：新的领取、进入和检查已停下。各执行的情况：'
    : control === 'cancel' ? '取消目标：新的领取、进入和检查已停下。各执行的情况：'
      : '继续目标。各执行的情况：';
  const lines: GoalControlReportLine[] = [
    { text: runs.length === 0 ? head.replace('各执行的情况：', '没有在跑的执行。') : head, tick: true },
  ];
  for (const run of runs) {
    const task = taskNameOfRun(tasks, run.runRef.runId);
    const snapshot = control === 'resume' && run.intentRef !== null
      && (run.outcome === 'submitted' || run.outcome === 'already_submitted')
      ? entered.get(run.runRef.runId) : undefined;
    const word = snapshot !== undefined && snapshot.status === 'applied'
      ? (asText(asRecord(snapshot.observation).origin) === 'platform_not_entered'
        ? '原执行还没进入，恢复已排队' : '原执行的 Turn 已重新进入')
      : run.outcome === 'submitted'
        ? FAN_OUT_SUBMITTED_WORD[control] : FAN_OUT_RESULT_WORD[run.outcome];
    lines.push({
      text: '「' + task + '」：' + word,
      tick: run.outcome === 'submitted' || run.outcome === 'already_submitted',
    });
  }
  if (control === 'resume') {
    for (const continuation of fanOut.continuations ?? []) {
      const task = taskTitleOf(tasks, continuation.taskId, '一个任务');
      lines.push({
        text: '「' + task + '」：' + CONTINUATION_WORD[continuation.outcome],
        tick: continuation.outcome === 'requeued' || continuation.outcome === 'already_continued',
      });
    }
  }
  if ((fanOut.problem ?? '') !== '') {
    lines.push({ text: '这一轮读不到受影响的执行，平台下一轮会再读。', tick: false });
  }
  return lines;
}

/** The copy dialog's candidate: the part of the body the person ticks. */
export type MainCopyCandidate = {
  ref: SessionMessageRef;
  text: string;
  selectable: boolean;
  reasonWord: string;
  retractable: boolean;
  retractWord: string;
};

/** 5.5 G5: the confirmation dialog's whole data, already in the page's words. */
export type MainCopyDraft = {
  goalId: string;
  sourceRevision: number;
  objective: string;
  autonomy: string;
  waitFor: string;
  parallel: string;
  available: boolean;
  candidates: MainCopyCandidate[];
};

const COPY_STATE_WORD: Record<string, string> = {
  withdrawn: '已撤回', applied: '已生效', rejected: '被拒绝', copied: '已转交过',
  delivered: '已送达', not_delivered: '还没送到',
};

/** D49-13: the copy draft in the confirmation dialog's words. `bodies` is keyed
 * by `messageBodyKey(ref, 'message')`; a failed body read is one fixed sentence. */
export function copyDraftOf(
  draft: GoalCopyDraftResultV1, bodies: Readonly<Record<string, string>>, nav: NavData,
): MainCopyDraft {
  const goalOrdinalOf = (goalId: string): number | null => nav.goals.find((row) => row.goalId === goalId)?.ordinal ?? null;
  const waitForRef = draft.toReconfirm.waitForGoalRef;
  const waitForId = waitForRef === null ? '' : waitForRef.goalId;
  const waitFor = waitForId === '' ? ''
    : '还要等目标 ' + String(goalOrdinalOf(waitForId) ?? '?') + ' 完成。';
  const parallelIds = draft.toReconfirm.parallelRisks.map((ref) => String(goalOrdinalOf(ref.goalId) ?? '?'));
  const parallel = parallelIds.length === 0 ? '' : '和目标 ' + parallelIds.join('、目标 ') + ' 并行有风险。';
  const candidates: MainCopyCandidate[] = draft.interventions.available
    ? draft.interventions.candidates.map((candidate) => {
      const text = bodies[messageBodyKey(candidate.messageRef, 'message')];
      const state = candidate.reason ?? candidate.state;
      return {
        ref: candidate.messageRef,
        text: text === undefined ? '这条消息暂时读不到' : text.slice(0, 60),
        selectable: candidate.selectable,
        reasonWord: candidate.selectable ? '' : (COPY_STATE_WORD[state] ?? ''),
        retractable: candidate.retractable,
        retractWord: candidate.retractable ? '' : (COPY_STATE_WORD[candidate.retractReason ?? candidate.state] ?? ''),
      };
    })
    : [];
  return {
    goalId: draft.source.goal.goalId,
    sourceRevision: draft.source.revision,
    objective: draft.objective,
    autonomy: AUTONOMY_TEXT[draft.autonomy],
    waitFor,
    parallel,
    available: draft.interventions.available,
    candidates,
  };
}

/** G5: the copy's success system line; only the retraction outcomes are counted. */
export function copyReportOf(result: GoalCopyConfirmResultV1): GoalControlReportLine[] {
  const lines: GoalControlReportLine[] = [{ text: '已复制成新目标。', tick: true }];
  const retractions = result.retractions;
  const countStatus = (status: string): number => retractions.filter((row) => row.status === status).length;
  const parts: string[] = [];
  if (countStatus('retracted') > 0) parts.push('撤回了 ' + String(countStatus('retracted')) + ' 条');
  if (countStatus('not_retractable') > 0) parts.push(String(countStatus('not_retractable')) + ' 条撤不回');
  if (countStatus('unfinished') > 0) parts.push(String(countStatus('unfinished')) + ' 条还在撤');
  if (parts.length > 0) lines.push({ text: parts.join('，') + '。', tick: true });
  return lines;
}

function queryRefKey(ref: QueryJobRef): string {
  return ref.projectId + '/' + ref.workspaceId + '/' + ref.queryJobId;
}

/** M2: one page's answered/closed cards as the queue's 已处理 rows, so the card
 * name, its selected option's word and its facts are `adaptDecide`'s, never a
 * second table here. The task graph is the selected Goal's own (the page read
 * loads no other Goal's graph). */
export function mainCardRowsOf(
  cards: readonly DecisionCardV1[], nav: NavData, scope: { projectId: string; workspaceId: string },
): DecideRow[] {
  const tasks: Record<string, unknown | null> = {};
  if (nav.selectedGoalId !== null) tasks[nav.selectedGoalId] = nav.tasks;
  const queue: DecisionQueueReadV1 = {
    waitingAnswer: [], answeredPendingApplication: [], history: [...cards], notices: [],
    counts: { waitingAnswer: 0, answeredPendingApplication: 0, notices: {} },
    countsComplete: true, nextCursor: null, sourceCursor: null, seenThrough: {},
    displayToken: null, capabilities: [],
  };
  return adaptDecide({
    nav, scope, workspaceRevision: 0, queue: [queue], tasks, selectedGoalId: nav.selectedGoalId,
  }, {
    tab: 'done', goalFilter: null, selectedCardKey: null, factsOpen: false,
    step: null, form: {}, lineKey: null,
  }).history;
}

/** M2: the options row; the one the person chose carries `（你选的）`, and a
 * text answer names no option. */
function cardOptionsTextOf(card: DecisionCardV1, row: DecideRow | null): string {
  const selection = card.answer?.decision.selection;
  if (selection !== undefined && selection.kind === 'other') return '其他（你写的话）';
  const chosen = row?.view?.answer?.selection ?? '';
  return card.options.map((option) => option.label === chosen ? option.label + '（你选的）' : option.label).join('、');
}

/** M2: the expanded card's facts, shared by a request's card line and the page's. */
function cardFactsOf(
  card: DecisionCardV1, label: string, from: string, row: DecideRow | null,
  answerBody: string | null | undefined,
): { k: string; v: string }[] {
  const facts: { k: string; v: string }[] = [{ k: '卡', v: label }];
  if (from !== '') facts.push({ k: '来源', v: from });
  if (card.options.length > 0) facts.push({ k: '选项', v: cardOptionsTextOf(card, row) });
  if (answerBody === null) {
    facts.push({ k: '你写的话', v: '暂时读不到' });
  } else if (answerBody !== undefined) {
    const view = answerBodyViewOf(answerBody, card.objects);
    if (view.line !== '') facts.push({ k: '你写的话', v: view.line });
    facts.push(...view.facts);
  }
  const application = asRecord(card.application);
  const appliedAt = asText(application.appliedAt);
  if (appliedAt !== '') {
    const changes = Array.isArray(application.changes) ? application.changes : [];
    facts.push({ k: '落实', v: localShortAt(appliedAt) + '，改了 ' + String(changes.length) + ' 项' });
  }
  const closedReason = asText(asRecord(card).closedReason);
  if (card.state === 'closed' && closedReason !== '') {
    facts.push({ k: '关闭原因', v: '已关闭：' + (closedReason === 'source_resolved' ? '来源已解决' : '目标已取消') });
  }
  return facts;
}

/** M2: one card's folded line; a waiting card opens the centre card, every
 * other one opens its own facts. */
function cardFoldRow(
  card: DecisionCardV1, label: string, from: string, row: DecideRow | null,
  inQueue: boolean, answerBody: string | null | undefined,
): MainFoldRow {
  const stateWord = cardStateWordOf(card.state);
  const selection = row?.view?.answer?.selection ?? '';
  if (card.state === 'waiting_answer') {
    return {
      key: 'card:' + card.cardKey, kind: 'card', text: '等你决定：' + label, title: label,
      from, facts: cardFactsOf(card, label, from, row, answerBody), openable: inQueue,
      opens: 'card', reads: null, cardKey: card.cardKey,
    };
  }
  const answered = card.answer !== null;
  const pick = card.answer?.decision.selection?.kind === 'other' ? '其他（你写的话）' : selection;
  return {
    key: 'card:' + card.cardKey, kind: 'card',
    text: answered ? '你答了：' + pick + ' · ' + stateWord : '已关闭：' + label,
    title: label, from, facts: cardFactsOf(card, label, from, row, answerBody), openable: true,
    opens: 'fold', reads: card.answer?.bodyRef ? 'answer' : null, cardKey: card.cardKey,
  };
}

/** M4: the automatic-rework member's reason: a requeue's Failure class word from
 * the selected Goal's task rows, or the reverify arm's own reason when a person
 * wrote it. A machine code is never printed. */
function reworkReasonOf(notice: MainNoticeRead, nav: NavData): string {
  const rework = asRecord(notice.rework);
  const operation = asText(rework.operation);
  const reason = asText(rework.reason);
  if (operation === 'reverify') {
    return reason === '' || reason.includes('auto-rework:') || reason.includes('#') ? '自动重新检查' : reason;
  }
  const sourceRef = rework.sourceRef;
  if (sourceRef !== undefined && sourceRef !== null) {
    for (const row of nav.tasks?.tasks ?? []) {
      const entries = asRecord(asRecord(row).rework).entries;
      if (!Array.isArray(entries)) continue;
      const hit = entries.map((entry) => asRecord(entry))
        .find((entry) => canonicalJson(entry.ref as never) === canonicalJson(sourceRef as never));
      if (hit !== undefined) {
        const failure = asText(hit.failureClass);
        return FAILURE_WORD[failure] ?? '原因暂时读不到';
      }
    }
  }
  return '原因暂时读不到';
}

type SnapshotWorkspace = {
  scope: { projectId: string; workspaceId: string };
  checks: Record<string, unknown>[];
  approvals: Record<string, unknown>[];
  withdrawn: Record<string, unknown>[];
  row: Record<string, unknown>;
};

/** M4: the snapshot's workspaces with their three check lists, read as records
 * (the page declares only the fields it shows). */
function snapshotWorkspacesOf(snapshot: unknown): SnapshotWorkspace[] {
  const row = asRecord(snapshot);
  const workspaces = Array.isArray(row.workspaces) ? row.workspaces.map((entry) => asRecord(entry)) : [];
  return workspaces.map((workspace) => {
    const scope = asRecord(workspace.scope);
    return {
      scope: { projectId: asText(scope.projectId), workspaceId: asText(scope.workspaceId) },
      checks: Array.isArray(workspace.checks) ? workspace.checks.map((entry) => asRecord(entry)) : [],
      approvals: Array.isArray(workspace.checkApprovals)
        ? workspace.checkApprovals.map((entry) => asRecord(entry)) : [],
      withdrawn: Array.isArray(workspace.withdrawnChecks)
        ? workspace.withdrawnChecks.map((entry) => asRecord(entry)) : [],
      row: workspace,
    };
  });
}

/** M4: one `check_approved` notice's facts and its one 撤回. The card's candidate
 * is `objects[0].pin.ref`; both `checkApprovals` and `withdrawnChecks` name it. */
function checkNoticeRowsOf(
  notice: MainNoticeRead, nav: NavData, snapshot: unknown, snapshotError: boolean, settingsHref: string,
): { facts: { k: string; v: string }[]; acts: MainFoldAct[] } {
  const candidate = asText(asRecord(asRecord(asRecord((notice.objects ?? [])[0]).pin).ref).proposalId);
  if (snapshotError) return { facts: [{ k: '设置', v: '暂时读不到' }], acts: [] };
  const facts: { k: string; v: string }[] = [];
  const acts: MainFoldAct[] = [];
  let matched = false;
  for (const workspace of snapshotWorkspacesOf(snapshot)) {
    for (const approval of workspace.approvals) {
      if (asText(asRecord(asRecord(approval.plan).proposalRef).proposalId) !== candidate) continue;
      matched = true;
      const check = workspace.checks.find((entry) => asText(entry.checkId) === asText(approval.checkId));
      const checkId = asText(approval.checkId);
      facts.push({ k: '检查', v: checkId });
      if (check !== undefined) {
        const command = asText(check.command);
        if (command !== '') facts.push({ k: '命令', v: command });
        const taskIds = check.taskIds;
        facts.push({ k: '查哪些任务', v: taskIds === 'all' ? '全部任务'
          : Array.isArray(taskIds) ? taskIds.map((id) => taskTitleOf(nav.tasks?.tasks ?? null, asText(id), '一个任务')).join('、') : '全部任务' });
      }
      const authorDuty = asText(asRecord(approval.author).duty);
      facts.push({ k: '谁写的', v: authorDuty === '' ? '—' : dutyWordOf(authorDuty) });
      const approver = asRecord(approval.approvedBy);
      if (asText(approver.kind) === 'person') {
        facts.push({ k: '谁批的', v: '你' });
      } else {
        const ref = sessionRefAtEdge(approver.session);
        const line = ref === null ? '' : lineNameOfSession([...nav.lines, ...nav.archived], ref);
        facts.push({ k: '谁批的', v: line !== '' ? line : dutyWordOf(asText(approver.duty)) });
      }
      const baseline = asRecord(approval.baseline);
      const outcome = asText(baseline.outcome);
      const exitCode = typeof baseline.exitCode === 'number' ? baseline.exitCode : null;
      facts.push({ k: '改动前跑', v: outcome === 'failed'
        ? '会失败' + (exitCode === null ? '' : '（退出码 ' + String(exitCode) + '）')
        : outcome === '' ? '—' : '没有失败' });
      const approvedAt = asText(approval.approvedAt);
      facts.push({ k: '批准时间', v: approvedAt === '' ? '—' : localShortAt(approvedAt) });
      if (check !== undefined) {
        acts.push({ kind: 'withdraw', label: '撤回', scope: workspace.scope, checkId: checkId,
          off: 'false', tip: '撤回这条检查' });
      }
    }
    for (const withdrawn of workspace.withdrawn) {
      if (asText(asRecord(asRecord(withdrawn.plan).proposalRef).proposalId) !== candidate) continue;
      matched = true;
      facts.push({ k: '检查', v: asText(withdrawn.checkId) });
      const at = asText(withdrawn.withdrawnAt);
      facts.push({ k: '已撤回', v: at === '' ? '—' : localShortAt(at) });
    }
  }
  if (!matched) facts.push({ k: '现在', v: '这条检查已经不在设置里' });
  void settingsHref;
  return { facts, acts };
}

/** M4: one notice's folded line; only an automatic-rework fold and a check
 * notice open. The handoff never prints its summary (it carries Session ids). */
function noticeFoldRow(
  notice: MainNoticeRead, nav: NavData, snapshot: unknown, snapshotError: boolean, settingsHref: string,
): MainFoldRow {
  const itemKey = asText(asRecord(notice).itemKey);
  const key = 'notice:' + (itemKey || notice.summary);
  const summary = notice.summary;
  if (notice.category === 'handoff') {
    return { key, kind: 'notice', text: '请知悉：秘书换了一次手', title: '秘书换了一次手',
      from: '', facts: [], openable: false, opens: null, reads: null, noticeKey: itemKey };
  }
  if ((notice.memberViews ?? []).length > 0) {
    const members = notice.memberViews ?? [];
    const facts = members.map((member) => {
      const at = asText(asRecord(member.rework).requestedAt);
      return { k: at === '' ? '—' : localShortAt(at), v: member.summary + '：' + reworkReasonOf(member, nav) };
    });
    const hasCap = members.some((member) => (member.actions ?? []).some((action) => action.kind === 'raise_memory_cap'));
    return {
      key, kind: 'notice', text: '请知悉：' + summary, title: summary, from: '', facts,
      openable: true, opens: 'fold', reads: null, noticeKey: itemKey,
      ...(hasCap && settingsHref !== '' ? { acts: [{ kind: 'raise_cap' as const, label: '调高上限',
        href: settingsHref + '#g-lim', off: 'false', tip: '到设置页的“运行上限”一节调高' }] } : {}),
    };
  }
  if (notice.noticeKind === 'check_approved') {
    const checked = checkNoticeRowsOf(notice, nav, snapshot, snapshotError, settingsHref);
    return { key, kind: 'notice', text: '请知悉：' + summary, title: summary, from: '', facts: checked.facts,
      openable: true, opens: 'fold', reads: 'snapshot', noticeKey: itemKey,
      ...(checked.acts.length === 0 ? {} : { acts: checked.acts }) };
  }
  return { key, kind: 'notice', text: '请知悉：' + summary, title: summary, from: '', facts: [],
    openable: false, opens: null, reads: null, noticeKey: itemKey };
}

/** M6: the one sentence the page and Decide share for a queue whose sources
 * could not be read. */
export function unreadableLineOf(words: readonly string[]): string {
  return words.length === 0 ? '' : '暂时读不到：' + words.join('、') + '。其余照常显示。';
}

/** M2/M4/M6: the page's folded lines and each request's card lines, from the
 * one page's cards and notices. Every card is considered once (the page read
 * already deduplicates by cardKey); a card whose request is not on this page
 * falls back to the page-level lines rather than disappearing. */
function foldRowsOf(input: {
  nav: NavData; pages: MainPageV1[]; decisions: DecideData | null; page: MainPageV1 | null;
  cardAnswers: Record<string, string | null>; noticeSnapshot: unknown; noticeSnapshotError: boolean;
  settingsHref: string;
}): {
  cardLines: Record<string, MainFoldRow[]>; pageLines: MainFoldRow[];
  cardFrom: Record<string, string>; cardReply: Record<string, DecideCardReply>;
} {
  const { nav, pages, decisions, page } = input;
  const cards = page?.cards ?? [];
  const rows = mainCardRowsOf(cards, nav, nav.scope ?? { projectId: '', workspaceId: '' });
  const rowByKey = new Map(rows.map((row) => [row.key, row]));
  const rootByRound = new Map<string, string>();
  for (const read of pages) {
    for (const request of read.requests) {
      const root = requestRootKey(request.requestRoot);
      for (const round of request.rounds) rootByRound.set(queryRefKey(round.ref), root);
    }
  }
  const queueRows = decisions?.sections.flatMap((section) => section.rows) ?? [];
  const queueRowByKey = new Map<string, DecideRow>();
  for (const row of queueRows) if (row.card !== null) queueRowByKey.set(row.key, row);
  const inQueue = new Set<string>();
  for (const row of queueRows) if (row.card !== null) inQueue.add(row.key);
  for (const row of decisions?.history ?? []) if (row.card !== null) inQueue.add(row.key);
  const cardLines: Record<string, MainFoldRow[]> = {};
  const pageLines: MainFoldRow[] = [];
  const cardFrom: Record<string, string> = {};
  const cardReply: Record<string, DecideCardReply> = {};
  /* A1: the centre card's reply data follows the queue rows it draws, not the
     page's first-page cards. */
  for (const row of queueRows) {
    if (row.card === null) continue;
    const from = cardFromOf(row.card, nav);
    if (from !== '') cardFrom[row.key] = from;
    cardReply[row.key] = cardReplyOf(row.card);
  }
  const cardLabelOf = (card: DecisionCardV1): string => {
    const queued = queueRowByKey.get(card.cardKey);
    return queued !== undefined ? queued.label : rowByKey.get(card.cardKey)?.label ?? '需要你决定';
  };
  const pageCards: DecisionCardV1[] = [];
  for (const card of cards) {
    const from = cardFromOf(card, nav);
    if (from !== '') cardFrom[card.cardKey] = from;
    const row = rowByKey.get(card.cardKey) ?? null;
    const label = cardLabelOf(card);
    const fold = cardFoldRow(card, label, from, row, inQueue.has(card.cardKey), input.cardAnswers[card.cardKey]);
    if (card.requestRef === null) {
      pageCards.push(card);
      continue;
    }
    const root = rootByRound.get(queryRefKey(card.requestRef));
    if (root === undefined) {
      pageCards.push(card);
      continue;
    }
    (cardLines[root] ??= []).push(fold);
  }
  const unreadable = decisions === null ? '' : unreadableLineOf(decisions.unreadable);
  if (unreadable !== '') {
    pageLines.push({ key: 'unreadable', kind: 'unreadable', text: unreadable, title: '', from: '',
      facts: [], openable: false, opens: null, reads: null });
  }
  for (const notice of page?.notices ?? []) {
    pageLines.push(noticeFoldRow(notice, nav, input.noticeSnapshot, input.noticeSnapshotError, input.settingsHref));
  }
  const waiting = pageCards.filter((card) => card.state === 'waiting_answer');
  const closed = pageCards.filter((card) => card.state === 'closed' && card.answer === null);
  const answered = pageCards.filter((card) => card.state !== 'waiting_answer' && card.answer !== null);
  answered.sort((left, right) => {
    const a = asText(asRecord(left).answer === null ? '' : asRecord(asRecord(left).answer).respondedAt);
    const b = asText(asRecord(right).answer === null ? '' : asRecord(asRecord(right).answer).respondedAt);
    return a < b ? 1 : a > b ? -1 : 0;
  });
  for (const card of closed.concat(answered.slice(0, 3), waiting)) {
    const row = rowByKey.get(card.cardKey) ?? null;
    const label = cardLabelOf(card);
    const from = cardFrom[card.cardKey] ?? '';
    pageLines.push(cardFoldRow(card, label, from, row, inQueue.has(card.cardKey), input.cardAnswers[card.cardKey]));
  }
  const rest = answered.slice(3);
  if (rest.length > 0) {
    pageLines.push({ key: 'older-cards', kind: 'unreadable', from: '',
      text: '更早已答的 ' + String(rest.length) + ' 张卡在「需要你决定」的「已处理」里',
      title: '', facts: [], openable: false, opens: null, reads: null });
  }
  return { cardLines, pageLines, cardFrom, cardReply };
}

/** §2.2: one flat object; the navigation fields stay flat beside the extras. */
export function adaptMain(input: {
  nav: NavData; pages: MainPageV1[]; decisions: DecideData | null;
  older: MainPageCursorV1 | null; track: MainTrackRow[] | null;
  line?: MainLineRecord | null; aux?: AuxPanelData | null;
  requestFeedback: MainRequestFeedback | null;
  recipientNote?: string;
  retry?: boolean;
  /** M2: the one on-demand answer body this read fetched, by cardKey; `null`
   * is that read's failure, absent is not read. */
  cardAnswers?: Record<string, string | null>;
  /** M4: the one settings snapshot the open check notice read, and its failure. */
  noticeSnapshot?: unknown; noticeSnapshotError?: boolean;
  /** M4: the settings link the 调高上限 entry opens (with the page's query). */
  settingsHref?: string;
}): MainData {
  const page = input.pages[0] ?? null;
  const notices = page === null ? [] : page.notices;
  const goals = input.nav.goals.map((goal) => ({
    ...goal,
    notices: notices.filter((notice) => subjectGoalId(notice.subject) === goal.goalId).map((notice) => notice.summary),
  }));
  const display = input.nav.selectedDisplay;
  const folds = foldRowsOf({
    nav: input.nav, pages: input.pages, decisions: input.decisions, page,
    cardAnswers: input.cardAnswers ?? {}, noticeSnapshot: input.noticeSnapshot,
    noticeSnapshotError: input.noticeSnapshotError === true, settingsHref: input.settingsHref ?? '',
  });
  return {
    ...input.nav,
    goals,
    goalBar: goalBarTextOf(display, display === null ? null : display.facts, input.nav.tasks, input.nav.counts.working),
    retry: input.retry === true,
    decisions: input.decisions,
    conversation: conversationOf(input.pages, input.nav),
    recipientNote: input.recipientNote ?? '',
    older: input.older,
    track: input.track,
    progress: taskProgressOf(input.nav.tasks),
    line: input.line ?? null,
    aux: input.aux ?? null,
    requestFeedback: input.requestFeedback,
    cardLines: folds.cardLines,
    pageLines: folds.pageLines,
    cardFrom: folds.cardFrom,
    cardReply: folds.cardReply,
  };
}

