import { BoardView } from './runtime.js';
import { parseBoard } from './board.js';
import {
  committedRouteValue, createHostClient, fetchPageText, readPlatformToken, readPlatformTokenText, readyRouteValue,
  RouteReadError, subscribeChanges, type BootstrapReply, type CoreScope, type RouteReply,
} from './host-client.js';
import { asRecord, asText } from './values.js';
import { qualifyProjectPath } from '../contracts/workspace-path.js';
import { createAutoRefresh, type RefreshRead, type RefreshSnapshot, type RefreshSources } from './refresh.js';
import { adaptNav, goalHref, type NavData, type NavLineDetail } from './adapters/nav.js';
import { adaptGoals, goalOrderOf, type GoalsData } from './adapters/goals.js';
import {
  adaptArchOverview, type ArchCatalogRead, type ArchNoteRead, type ArchObservedRead, type ArchOverviewData,
  type ArchOverviewSource,
} from './adapters/arch-overview.js';
import type { ArchitectureObservationStateV1 } from '../contracts/architecture-observation.js';
import type { NoteAnchorV1 } from '../contracts/note.js';
import { guardNotConnected, notConnectedAttrs } from './not-connected.js';
import type { RequestReferenceInputV1 } from '../contracts/query-job.js';
import {
  NO_PLAN_TEXT, adaptTaskMap, adaptTaskMapCalendar, adaptTaskMapDecisionCards, adaptTaskMapDetail, adaptTaskMapTime,
  isFinishedGoalDisplayPhase, localShortAt, type GoalDisplayPhaseCode, type TaskMapQueueRead,
  type TaskMapData, type TaskMapDetailTaskRead, type TaskMapDisplayRead, type TaskMapGoalRead,
  type TaskMapGraphRead, type TaskMapHoverRead, type TaskMapLineRead, type TaskMapNodeDetailData,
  type TaskMapParticipantRead, type TaskMapRiskRead, type TaskMapSummaryRead, type TaskMapCalendarRead, type TaskMapTimeData, type TaskMapTimelineRead,
  type TaskMapTrackLineRead, type TaskMapTrackPageRead, type TaskMapUncommittedRead,
} from './adapters/task-map.js';

/** Ruling item 5: the top-bar line while the change stream is down. */
const RECONNECT_TEXT = '连接断开，正在重连。';
/** The Host refused the stream with 429: too many pages open on it (lead ruling 7 of E3-5). */
const TOO_MANY_PAGES_TEXT = '这台主机同时打开的页面太多，这一页暂时不自动更新；关掉别的页签后会自己接上。';

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
};
/** A complete `SessionRef`: exactly projectId + sessionId (no workspaceId). */
export type TaskMapSessionRef = { projectId: string; sessionId: string };
export type TaskMapActions = {
  readMore(demand: TaskMapReadDemand): void;
  pinLine(key: TaskMapSessionRef, pinned: boolean): Promise<void>;
};

/** §2.4/§2.7/§2.11: the board tells boot what it needs read; every demand joins
 * the same refresh loop. A Goal pick changes the loop's Goal; a line opens that
 * line's `lines/read`; the archive row reads `lines/archived` only while open. */
export type BoardReadDemand = TaskMapReadDemand & {
  archive?: boolean;
  /** ArchOverview's page state: the search needle, the work-only switch, the
   * directory view and the selected node's anchor. Explicit values replace the
   * old demand, so closing one passes `''`, `false` or `null`. */
  search?: string;
  workOnly?: boolean;
  dirView?: boolean;
  noteAnchor?: NoteAnchorV1 | null;
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
  /** §2.4: one `decisions/answer` write for the shown conflict card, then a
   * reread; `revision_conflict` is shown, never retried with fresh revisions. */
  answerConflict: (cardKey: string, optionId: 'wait' | 'order' | 'parallel') => Promise<void>;
  /** §2.6: one `requests/submit` plus one `requests/read`; returns the round's
   * user text and the secretary's non-null answer so the page can append it to
   * its own log. `null` only when the submit reply carried no `requestRoot`. */
  askSecretary: (text: string,
    reference: RequestReferenceInputV1 | readonly RequestReferenceInputV1[] | null,
  ) => Promise<{ input: string; answer: string | null } | null>;
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
  const goalParam = new URLSearchParams(location.search).get('goal');
  let goalId = goalParam === null || goalParam === '' ? null : goalParam;
  const boardName = boardNameOf(location.href);
  /* A1/A24: the frozen template keeps `Main.dc.html`; the ArchOverview copy
     carries the Goal through the one `goalHref` encoding. */
  const source = await fetchPageText(location.href);
  const board = parseBoard(document.title, boardName === 'ArchOverview'
    ? source.split('href="Main.dc.html"').join('href="' + goalHref('Main.dc.html', goalId) + '"')
    : source);
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
  /** The navigation data the page last published; a control write pins those
   * exact revisions (§2.8), never a second read after the click. */
  let latest: NavData | null = null;
  /** The Goals data and scope the page last published successfully. A failed
   * reread must not become the pins of a reorder/answer write. */
  let latestGoals: GoalsData | null = null;
  let latestGoalsScope: CoreScope | null = null;
  let controlSeq = 0;
  let reorderSeq = 0;
  let answerSeq = 0;
  let askSeq = 0;
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
      controlSeq += 1;
      const reply = await client.write('goals/control', data.scope, {
        input: { goalRef, control, reason: null },
        meta: {
          requestId: 'navfix-control-' + String(controlSeq),
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
      reorderSeq += 1;
      try {
        const reply = await client.write('goals/reorder', scope, {
          input: { workspace: scope, goalOrder: next.map((goal) => goal.ref) },
          meta: {
            requestId: 'goals-reorder-' + String(reorderSeq),
            expected: next.map((goal) => ({ ref: goal.ref, revision: goal.revision })),
          },
        });
        committedRouteValue(reply, 'goals/reorder');
      } catch (error) {
        throw new Error(writeTextOf(error));
      }
      await refresh.reread();
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
      answerSeq += 1;
      try {
        const reply = await client.write('decisions/answer', scope, {
          input: { source: conflict.source, selection, text: '', annotations: [] },
          meta: { requestId: 'goals-answer-' + String(answerSeq), expected },
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
    ): Promise<{ input: string; answer: string | null } | null> {
      const scope = latestGoalsScope;
      if (scope === null) throw new Error(writeTextOf(new Error('no Goals scope')));
      const references: RequestReferenceInputV1[] = reference === null ? []
        : Array.isArray(reference) ? [...reference] : [reference as RequestReferenceInputV1];
      askSeq += 1;
      let reply: RouteReply;
      try {
        reply = await client.post('requests/submit', scope, {
          commandId: 'goals-ask-' + String(askSeq),
          goalId: latestGoals?.selectedGoalId ?? null,
          text,
          continues: null,
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
      return { input: text, answer };
    },
  };
  const sources: RefreshSources<unknown> = {
    read: async () => await reader(client, goalId, demand),
    publish: (snapshot) => {
      if (snapshot.error !== null) logReadError(snapshot.error);
      /* A failed reread keeps the old data for the page; it must not become
         the pins of a control write (§2.8: no second, stale read window). */
      if (snapshot.error === null) {
        latest = snapshot.data as NavData | null;
        if (boardName === 'Goals') {
          latestGoals = snapshot.data as GoalsData | null;
          latestGoalsScope = latestGoals?.scope ?? null;
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

type BoardReader<T> = (
  client: ReturnType<typeof createHostClient>, goalId: string | null, demand?: BoardReadDemand,
) => Promise<RefreshRead<T>>;

/** §2.11: one table, keyed by the served file name. TaskMap keeps its reader's
 * signature and return type; Main joins with the chrome read. Every other
 * board keeps the E3-1 sample mount and issues no route request. */
const BOARD_READERS: Record<string, BoardReader<unknown>> = {
  TaskMap: readTaskMap as BoardReader<unknown>,
  Main: readMain,
  Goals: readGoals,
  ArchOverview: readArchOverview as BoardReader<unknown>,
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
  demand: BoardReadDemand = {},
): Promise<RefreshRead<NavData>> {
  const boot = await client.bootstrap();
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
    detail = readyRouteValue<NavLineDetail>(
      await client.post('lines/read', scope, { workspace: scope, key: demand.lineKey }), 'lines/read',
    );
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
  if (selected !== null) {
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
    data: adaptNav({ goals, lines, display, queue, archived, detail, phase }, selected, scope),
    cursor,
  };
}

/** The `BOARD_READERS` entry for Main: this package wires the chrome (rail,
 * Goals bar, inbox, line switch); the main conversation body joins the same
 * `props.data` in the Main page package (§2.7). */
export async function readMain(
  client: ReturnType<typeof createHostClient>, goalId: string | null,
  demand: BoardReadDemand = {},
): Promise<RefreshRead<NavData>> {
  return readNav(client, goalId, demand);
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
    catalog, observation, observed, files, search, work, tasks, lines, notes,
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
  graph: TaskMapGraphRead, taskId: string, state: string, mapWhy: string,
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
  const groupedPaths = new Map<string, string[]>();
  if (actual.availability === 'available' && Array.isArray(actual.value)) {
    for (const entry of actual.value) {
      const file = asRecord(entry);
      const path = asText(file.path);
      if (path === '') continue;
      const workspaceId = asText(file.workspaceId) || scope.workspaceId;
      const paths = groupedPaths.get(workspaceId) ?? [];
      if (!paths.includes(path)) paths.push(path);
      groupedPaths.set(workspaceId, paths);
    }
  }
  let uncommitted: TaskMapUncommittedRead = null;
  if (groupedPaths.size > 0) {
    const files: NonNullable<NonNullable<TaskMapUncommittedRead>['files']> = [];
    let repository: 'git' | 'not_git' | null = null;
    let remaining = 100;
    for (const [workspaceId, workspacePaths] of groupedPaths) {
      const paths = workspacePaths.slice(0, remaining);
      remaining -= paths.length;
      if (paths.length === 0) break;
      try {
        const read = readyRouteValue<NonNullable<TaskMapUncommittedRead>>(await client.post('files/uncommitted',
          { ...scope, workspaceId }, {
            workspace: { aggregateType: 'Workspace', projectId: scope.projectId, workspaceId }, paths,
          }), 'files/uncommitted');
        if (read.repository !== 'git') continue;
        repository = 'git';
        for (const entry of read.files ?? []) {
          const file = asRecord(entry);
          files.push({ ...file, path: qualifyProjectPath(workspaceId, asText(file.path), scope.workspaceId) });
        }
      } catch {
        // One workspace's failed read leaves its files without numbers.
      }
    }
    uncommitted = repository === null ? null : { repository, files };
  }
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
  unavailable: '暂时写不了，可以重试。',
  forbidden: '这次写入没有被允许。',
  invalid: '这次写入的输入无效。',
};

function writeTextOf(error: unknown): string {
  const code = error instanceof RouteReadError ? error.code : '';
  return WRITE_ERROR_TEXT[code] ?? '写入失败。';
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
