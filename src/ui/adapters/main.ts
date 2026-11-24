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
import type { RunStepsReadV1 } from '../../contracts/run-steps.js';
import type { LineExecutionItemV1, LineMessageStateV1 } from '../../contracts/work-line.js';
import type { SessionMessageReadV1, MessageBody } from '../../contracts/mailbox.js';
import { asRecord, asText } from '../values.js';
import { holdKindWordOf, localShortAt, planRefText, planVersionText, stopRunText } from './task-map.js';
import {
  runStepsHeadOf, runStepsOf, runStepsSentenceOf, runStepsTimeOf, type RunStepView,
} from './run-steps.js';
import { subjectGoalId, type DecideData } from './decide.js';
import { taskProgressOf } from './goals.js';
import {
  messageBodyKey, messageFlagsOf, runWordOf, type MemberCopySource, type MemberLine, type MemberWriteBasis,
} from './member.js';
import { lineNameOfSession, sessionRefAtEdge, type NavData, type NavGoal } from './nav.js';
import type { AuxPanelData } from './aux-panel.js';

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
    ref: null, callIds: [], head: sentence, time: '', live: false, steps: [],
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
  quotes: MainQuote[]; hasQuotes: boolean;
  ideas: { title: string; detail: string }[];
  hasIdeas: boolean;
  /** A1: this run row's `executions/steps` projection; null on every other row. */
  run: MainRunSteps | null;
};

export type MainTrackRow = { at: string; type: string; id: string; summary: string };

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
  rounds: MainRoundRead[];
};

/** One shown notice of `main/read`, narrowed to what the rail's fold line reads. */
export type MainNoticeRead = { summary: string; subject: DecisionSubjectV1 };

/** `main/read`'s value (`MainPageV1`), narrowed to what the page reads. */
export type MainPageV1 = {
  notices: MainNoticeRead[];
  requests: MainRequestRead[]; next: MainPageCursorV1 | null;
};

/** The continuation `main/read` returns; the UI keeps its boundary shape. */
export type MainPageCursorV1 = { phase: 'goal' | 'pre'; since: string; rootKey: string };

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
    const hit = nav.tasks?.tasks.find((row) => row.ref.taskId === taskId);
    const taskRow = hit === undefined ? null : asRecord(hit);
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
  const titles = new Map<string, string>();
  for (const row of nav.tasks?.tasks ?? []) titles.set(row.ref.taskId, row.definition.title);
  const taskTitleOf = (task: unknown): string => {
    const id = asText(asRecord(task).taskId);
    if (id === '') return '';
    return titles.get(id) ?? '一个不在当前计划里的任务';
  };
  const rows: { k: string; v: string }[] = [];
  const planId = asText(planRevision.planId);
  if (planId !== '') {
    const current = nav.tasks?.plan ?? null;
    rows.push({ k: '计划版本', v: planRefText(planId, current) });
  }
  const names = affected.map(taskTitleOf).filter((name) => name !== '');
  if (names.length > 0) rows.push({ k: '受影响的任务', v: names.join('、') });
  for (const action of actions) {
    const row = feedbackActionRow(asRecord(action), nav, taskTitleOf);
    if (row !== null) rows.push(row);
  }
  return rows.length === 0 ? null : { root, title: '这条请求的处理', rows };
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
  root: string,
  fields: Pick<MainLogRow, 'text'>
  & Partial<Pick<MainLogRow, 'isUser' | 'isAgent' | 'isRun' | 'quotes' | 'ideas' | 'round' | 'selectable' | 'run'>>,
): MainLogRow {
  const quotes = fields.quotes ?? [];
  const ideas = fields.ideas ?? [];
  return {
    root,
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
    quotes,
    hasQuotes: quotes.length > 0,
    ideas,
    hasIdeas: ideas.length > 0,
    run: fields.run ?? null,
  };
}

/** §2.4: pages are newest first and so are their requests; dedupe by request
 * root, then reverse once so the oldest request draws first. A round is one
 * user line, an optional run line, then its answer or its failure line. */
function conversationOf(pages: readonly MainPageV1[]): MainLogRow[] {
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
    const root = requestRootKey(request.requestRoot);
    const lastAnswered = lastAnsweredRoundOf(request);
    for (const round of request.rounds) {
      const selectable = lastAnswered !== null && lastAnswered.queryJobId === round.ref.queryJobId;
      rows.push(logRowOf(root, {
        text: round.input, isUser: true, round: round.ref, selectable, quotes: round.references.map(quoteOf),
      }));
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
           system line; a null `closeCode` leaves only the message. */
        rows.push(logRowOf(root, {
          text: round.closeCode === null ? round.closeMessage : round.closeCode + ': ' + round.closeMessage,
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

/** §2.2: one flat object; the navigation fields stay flat beside the extras. */
export function adaptMain(input: {
  nav: NavData; pages: MainPageV1[]; decisions: DecideData | null;
  older: MainPageCursorV1 | null; track: MainTrackRow[] | null;
  line?: MainLineRecord | null; aux?: AuxPanelData | null;
  requestFeedback: MainRequestFeedback | null;
}): MainData {
  const page = input.pages[0] ?? null;
  const notices = page === null ? [] : page.notices;
  const goals = input.nav.goals.map((goal) => ({
    ...goal,
    notices: notices.filter((notice) => subjectGoalId(notice.subject) === goal.goalId).map((notice) => notice.summary),
  }));
  return {
    ...input.nav,
    goals,
    decisions: input.decisions,
    conversation: conversationOf(input.pages),
    older: input.older,
    track: input.track,
    progress: taskProgressOf(input.nav.tasks),
    line: input.line ?? null,
    aux: input.aux ?? null,
    requestFeedback: input.requestFeedback,
  };
}

