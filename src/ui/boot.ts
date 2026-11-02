import { BoardView } from './runtime.js';
import { parseBoard } from './board.js';
import { createHostClient, fetchPageText, readPlatformToken, readyRouteValue, RouteReadError, type CoreScope } from './host-client.js';
import {
  NO_PLAN_TEXT, adaptTaskMap, isFinishedGoalDisplayPhase,
  type TaskMapData, type TaskMapDisplayRead, type TaskMapGoalRead, type TaskMapGraphRead,
} from './adapters/task-map.js';

/**
 * Browser entry for one frozen board page. The Host serves the original
 * `.dc.html` at this URL; boot fetches that source through the host client and
 * parses it, because the DOM lowercases attribute names (`onClick` becomes
 * `onclick`). `parseBoard` hoists `<helmet>` into `<head>` and mounts the
 * rendered tree.
 *
 * E3-2 ruling items 3, 4, 6, 7 and 8: only the boards in `BOARD_READERS` read
 * real routes; every other board mounts exactly as before on its sample data.
 * With the token meta the TaskMap page reads the first workspace's real Goal and
 * Task graph and calls `updateProps`.
 */
export async function bootBoardPage(): Promise<void> {
  const root = document.querySelector('x-dc');
  if (!root) return;
  const board = parseBoard(document.title, await fetchPageText(location.href));
  if (board.helmetHtml.length > 0) hoistHelmet(board.helmetHtml);

  const token = readPlatformToken(document);
  const reader = BOARD_READERS[boardNameOf(location.href)];
  if (token === null || reader === undefined) {
    new BoardView(board).mount(root);
    return;
  }

  const view = new BoardView(board, { ...board.defaults, readState: { status: 'loading' } });
  view.mount(root);
  const client = createHostClient(token);
  const goalId = new URLSearchParams(location.search).get('goal');
  let version = 0;
  const load = async (): Promise<void> => {
    view.updateProps({ ...board.defaults, readState: { status: 'loading' } });
    try {
      const data = await reader(client, goalId);
      if (data === null) {
        view.updateProps({ ...board.defaults, readState: { status: 'empty' } });
        return;
      }
      if (data.planMissing === true) {
        view.updateProps({
          ...board.defaults, data, readState: { status: 'empty', message: NO_PLAN_TEXT },
        });
        return;
      }
      version += 1;
      view.updateProps({ ...board.defaults, data, readState: { status: 'ready' }, dataVersion: version });
    } catch (error) {
      logReadError(error);
      view.updateProps({
        ...board.defaults,
        readState: { status: 'error', message: pageTextOf(error), retry: () => { void load(); } },
      });
    }
  };
  await load();
}

type BoardReader = (
  client: ReturnType<typeof createHostClient>, goalId: string | null,
) => Promise<TaskMapData | null>;

/** Ruling item 8: the one board this slice wires; every other board keeps the
 * E3-1 sample mount and issues no route request. */
const BOARD_READERS: Record<string, BoardReader> = { TaskMap: readTaskMap };

/** The board name a served page is for: `/workbench/TaskMap.dc.html` -> `TaskMap`. */
function boardNameOf(href: string): string {
  const file = new URL(href).pathname.split('/').pop() ?? '';
  return file.endsWith('.dc.html') ? file.slice(0, -'.dc.html'.length) : '';
}

/** `goals/conflicts` carries one footprint entry per Goal; only the ref is read. */
type GoalConflictRead = { footprintCompleteness: Array<{ goalRef: { goalId: string } }> };

/** Ruling items 1, 2 and 5: the first workspace is the scope; a given goal id
 * wins, otherwise the first Goal whose display state is unfinished; none is the
 * empty state. Every read reply must be `ready`. */
export async function readTaskMap(
  client: ReturnType<typeof createHostClient>, goalId: string | null,
): Promise<TaskMapData | null> {
  const boot = await client.bootstrap();
  const workspace = boot.workspaces[0];
  if (workspace === undefined) return null;
  const scope: CoreScope = workspace.scope;

  if (goalId !== null) {
    const ref = { aggregateType: 'Goal' as const, projectId: scope.projectId, goalId };
    return await loadTaskMapForGoal(client, scope, ref, await readGoalReads(client, scope, ref));
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
    return await loadTaskMapForGoal(client, scope, ref, reads);
  }
  return null;
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
