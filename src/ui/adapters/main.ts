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
import type { QueryJobRef, RequestReferenceV1 } from '../../contracts/query-job.js';
import type { LineExecutionItemV1 } from '../../contracts/work-line.js';
import type { SessionMessageReadV1, MessageBody } from '../../contracts/mailbox.js';
import { asRecord, asText } from '../values.js';
import { localShortAt } from './task-map.js';
import type { DecideData } from './decide.js';
import { taskProgressOf } from './goals.js';
import {
  messageBodyKey, runWordOf, type MemberCopySource, type MemberLine, type MemberWriteBasis,
} from './member.js';
import type { NavData } from './nav.js';
import type { AuxPanelData } from './aux-panel.js';

/** One file quote of a user bubble (`RequestReferenceV1`'s four fields). */
export type MainQuote = { path: string; a: number | null; b: number | null; snap: boolean; text: string };

export type MainLogRow = {
  /** The request root, only for the page to drop a local pending bubble it has
   * already read back; never drawn. */
  root: string;
  isSys: boolean; isUser: boolean; isAgent: boolean; isRun: boolean;
  /** Empty for a run row; the fixed words live in the template. */
  text: string;
  /** A round has no public time; this stays empty and `since` is not shown. */
  t: '';
  from: string; hasFrom: boolean;
  quotes: MainQuote[]; hasQuotes: boolean;
  ideas: { title: string; detail: string }[];
  hasIdeas: boolean;
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
};
export type LvAct = {
  id: string; start: string; day: string; time: string;
  text: string; stage: 0 | 1 | 2; res: 'applied' | 'rejected' | null; why: string; reply: string;
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

export type MainData = NavData & {
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
};

/** One read round, the fields §2.4 draws (`RequestRoundViewV1`). */
type MainRoundRead = {
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
type MainRequestRead = {
  requestRoot: QueryJobRef;
  owner: SessionRef | null;
  rounds: MainRoundRead[];
};

/** `main/read`'s value (`MainPageV1`), narrowed to what the page reads. */
export type MainPageV1 = { requests: MainRequestRead[]; next: MainPageCursorV1 | null };

/** The continuation `main/read` returns; the UI keeps its boundary shape. */
export type MainPageCursorV1 = { phase: 'goal' | 'pre'; since: string; rootKey: string };

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

function logRowOf(
  root: string,
  fields: Pick<MainLogRow, 'text'>
  & Partial<Pick<MainLogRow, 'isUser' | 'isAgent' | 'isRun' | 'quotes' | 'ideas'>>,
): MainLogRow {
  const quotes = fields.quotes ?? [];
  const ideas = fields.ideas ?? [];
  return {
    root,
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
    for (const round of request.rounds) {
      rows.push(logRowOf(root, { text: round.input, isUser: true, quotes: round.references.map(quoteOf) }));
      if (round.session !== null) rows.push(logRowOf(root, { text: '', isRun: true }));
      if (round.answer !== null) {
        rows.push(logRowOf(root, {
          text: round.answer,
          isAgent: true,
          ideas: round.ideas.map((idea) => ({ title: idea.title, detail: idea.detail })),
        }));
      } else if (round.status === 'ended' && round.closeMessage !== null) {
        /* §2.4: a failed secretary round is still the secretary's line, never a
           system line; a null `closeCode` leaves only the message. */
        rows.push(logRowOf(root, {
          text: round.closeCode === null ? round.closeMessage : round.closeCode + ': ' + round.closeMessage,
          isAgent: true,
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
  messageViews: SessionMessageReadV1[];
  bodies: Record<string, MessageBody>;
  copies: MemberCopySource[];
  line: MemberLine;
}): LvRecord {
  const line = f.line;
  const entries: LvEntry[] = [];
  const acts: LvAct[] = [];
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
        gap: '', asker: null, steps: 0, edits: 0, checks: 0, live: false,
      });
      continue;
    }
    const stamp = dayTimeOf(item.startedAt ?? '');
    const live = item.status !== 'ended';
    /* SPEC-7 (B-6): a run's steps, edits and duration are not connected (A13),
       so its row says so instead of 0 steps, 0 edits and an empty duration. */
    entries.push({
      id: item.runRef.runId, kind: 'run', task: item.task.taskId, taskName: line.title,
      att: line.attempt.ordinal, seg: 1, round: 0, start: item.startedAt === null ? '' : localShortAt(item.startedAt),
      end: '', day: stamp.day, time: stamp.time, dur: '—',
      res: item.outcome ?? item.status,
      word: runWordOf(item),
      tx: runTx(item.status, item.outcome), label: '运行步骤还没接通', gap: '', asker: null,
      steps: 0, edits: 0, checks: item.checks.length, live,
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
    if (human && toLine) {
      acts.push({
        id: message.ref.messageId, start: localShortAt(at), day: stamp.day, time: stamp.time,
        text, stage,
        res: rejectedAt !== null ? 'rejected' : appliedAt !== null ? 'applied' : null,
        /* SPEC-22: the message read has no rejection reason (only `rejectedAt`),
           so a rejected one carries none and `recAct` says only 被拒绝 */
        why: rejectedAt !== null ? '' : appliedAt !== null ? '已生效' : '',
        reply,
      });
      continue;
    }
    entries.push({
      id: message.ref.messageId, kind: 'talk', task: taskId, taskName: line.title,
      att: 1, seg: 1, round: 0, start: localShortAt(at), end: '', day: stamp.day, time: stamp.time, dur: '',
      res: '', word: '', tx: 'tx-plain', label: text, gap: '', asker: null,
      steps: 0, edits: 0, checks: 0, live: false,
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
      gap: '', asker: null, steps: 0, edits: 0, checks: 0, live: false,
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
}): MainData {
  return {
    ...input.nav,
    decisions: input.decisions,
    conversation: conversationOf(input.pages),
    older: input.older,
    track: input.track,
    progress: taskProgressOf(input.nav.tasks),
    line: input.line ?? null,
    aux: input.aux ?? null,
  };
}

