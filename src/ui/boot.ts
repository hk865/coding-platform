import { BoardView } from './runtime.js';
import { parseBoard } from './board.js';
import {
  createHostClient, fetchPageText, readPlatformToken, readPlatformTokenText, readyRouteValue, RouteReadError,
  subscribeChanges, type CoreScope,
} from './host-client.js';
import { createAutoRefresh, type RefreshRead, type RefreshSnapshot, type RefreshSources } from './refresh.js';
import {
  NO_PLAN_TEXT, adaptTaskMap, isFinishedGoalDisplayPhase,
  type TaskMapData, type TaskMapDisplayRead, type TaskMapGoalRead, type TaskMapGraphRead,
} from './adapters/task-map.js';

/** Ruling item 5: the top-bar line while the change stream is down. */
const RECONNECT_TEXT = '连接断开，正在重连。';

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
  const board = parseBoard(document.title, await fetchPageText(location.href));
  if (board.helmetHtml.length > 0) hoistHelmet(board.helmetHtml);

  const documentToken = readPlatformToken(document);
  const reader = BOARD_READERS[boardNameOf(location.href)];
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
  const goalId = new URLSearchParams(location.search).get('goal');
  const sources: RefreshSources<TaskMapData> = {
    read: async () => await reader(client, goalId),
    publish: (snapshot) => {
      if (snapshot.error !== null) logReadError(snapshot.error);
      view.updateProps(pageProps(board.defaults, snapshot, restart));
    },
    subscribe: (handlers, cursor) => subscribeChanges(tokenOf, handlers, cursor),
  };
  const refresh = createAutoRefresh(sources);
  /** Ruling item 6: the retry button restarts the loop; only a successful first
   * read reaches `connect()` and starts the stream. */
  function restart(): void { void refresh.start(); }
  await refresh.start();
}

type BoardReader = (
  client: ReturnType<typeof createHostClient>, goalId: string | null,
) => Promise<RefreshRead<TaskMapData>>;

/** Ruling item 8: the one board this slice wires; every other board keeps the
 * E3-1 sample mount and issues no route request. */
const BOARD_READERS: Record<string, BoardReader> = { TaskMap: readTaskMap };

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
function pageProps(
  defaults: Record<string, string>, snapshot: RefreshSnapshot<TaskMapData>, retry: () => void,
): Record<string, unknown> {
  if (snapshot.dataVersion === 0 && snapshot.error !== null) {
    return {
      ...defaults,
      readState: { status: 'error', message: pageTextOf(snapshot.error), retry, stale: false },
    };
  }
  const staleText = !snapshot.stale ? ''
    : snapshot.error !== null ? pageTextOf(snapshot.error) : RECONNECT_TEXT;
  const stale = { stale: snapshot.stale, staleText };
  const data = snapshot.data;
  if (data === null) return { ...defaults, readState: { status: 'empty', ...stale } };
  if (data.planMissing === true) {
    return {
      ...defaults, data, dataVersion: snapshot.dataVersion,
      readState: { status: 'empty', message: NO_PLAN_TEXT, ...stale },
    };
  }
  return { ...defaults, data, dataVersion: snapshot.dataVersion, readState: { status: 'ready', ...stale } };
}

/** `goals/conflicts` carries one footprint entry per Goal; only the ref is read. */
type GoalConflictRead = { footprintCompleteness: Array<{ goalRef: { goalId: string } }> };

/**
 * Ruling items 1, 2 and 5: the first workspace is the scope; a given goal id
 * wins, otherwise the first Goal whose display state is unfinished; none is the
 * empty state. Every read reply must be `ready`. The returned `cursor` is this
 * read's bootstrap `changesHead`, never a later head.
 */
export async function readTaskMap(
  client: ReturnType<typeof createHostClient>, goalId: string | null,
): Promise<RefreshRead<TaskMapData>> {
  const boot = await client.bootstrap();
  const cursor = boot.changesHead ?? null;
  const workspace = boot.workspaces[0];
  if (workspace === undefined) return { data: null, cursor };
  const scope: CoreScope = workspace.scope;

  if (goalId !== null) {
    const ref = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId };
    const data = await loadTaskMapForGoal(client, scope, ref, await readGoalReads(client, scope, ref));
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
    const data = await loadTaskMapForGoal(client, scope, ref, reads);
    return { data, cursor };
  }
  return { data: null, cursor };
}

async function readGoalReads(
  client: ReturnType<typeof createHostClient>, scope: CoreScope,
  ref: { aggregateType: 'Goal'; projectId: string; goalId: string },
): Promise<{ goal: TaskMapGoalRead; display: TaskMapDisplayRead }> {
  const goal = readyRouteValue<TaskMapGoalRead>(
    await client.post('goals/read', scope, ref), 'goals/read',
  );
  const display = readyRouteValue<TaskMapDisplayRead>(
    await client.post('goals/display', scope, { goalRef: ref }), 'goals/display',
  );
  return { goal, display };
}

/** Ruling item 1: `tasks/query` `not_found` is a Goal without an adopted Plan,
 * not an error; every other non-ready reply still throws through `readyRouteValue`. */
async function loadTaskMapForGoal(
  client: ReturnType<typeof createHostClient>,
  scope: CoreScope,
  ref: { aggregateType: 'Goal'; projectId: string; goalId: string },
  reads: { goal: TaskMapGoalRead; display: TaskMapDisplayRead },
): Promise<TaskMapData> {
  const reply = await client.post('tasks/query', scope, { goalRef: ref });
  if (reply.status === 'not_found') return adaptTaskMap(reads.goal, null, reads.display);
  const graph = readyRouteValue<TaskMapGraphRead>(reply, 'tasks/query');
  return adaptTaskMap(reads.goal, graph, reads.display);
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
