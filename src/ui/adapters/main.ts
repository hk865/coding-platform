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
import type { DecideData } from './decide.js';
import { taskProgressOf } from './goals.js';
import type { NavData } from './nav.js';

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

/** §2.2: one flat object; the navigation fields stay flat beside the extras. */
export function adaptMain(input: {
  nav: NavData; pages: MainPageV1[]; decisions: DecideData | null;
  older: MainPageCursorV1 | null; track: MainTrackRow[] | null;
}): MainData {
  return {
    ...input.nav,
    decisions: input.decisions,
    conversation: conversationOf(input.pages),
    older: input.older,
    track: input.track,
    progress: taskProgressOf(input.nav.tasks),
  };
}

