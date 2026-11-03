import { until } from '../../helpers/change-stream-reader.js';
import { bootPage, type BootedPage, type PageFetch } from './boot-page.js';

/** E3-5: a Host with one Goal and one pending Task (nothing to decide, fail or block) for the boot-page rows. */
export const SCOPE = { projectId: 'e35-p', workspaceId: 'e35-w' };
export const GOAL = { aggregateType: 'Goal', projectId: SCOPE.projectId, goalId: 'e35-g' };
const REPLIES: Record<string, unknown> = {
  bootstrap: { workspaces: [{ scope: SCOPE, name: 'E35', workspaceRevision: 1 }], changesHead: 'c0000000001' },
  'goals/read': { status: 'ready', value: { goal: { ref: GOAL, objective: 'E35 目标' } } },
  'goals/display': { status: 'ready', value: { goal: { ref: GOAL, objective: 'E35 目标' }, display: { phase: 'RUNNING' } } },
  'tasks/query': { status: 'ready', value: { plan: { stages: [], executionDag: { dependsOn: [] } }, tasks: [{
    definition: { taskId: 'e35-t', title: 'E35 任务', disposition: 'active', phase: 'pending', executionIntent: 'request_execution' },
    effectivePhase: 'pending', disposition: 'active' }] } },
  'lines/list': { status: 'ready', value: { rows: [], counts: { working: { status: 'exact', value: 0 } } } },
  'graph/hover': { status: 'ready', value: { groups: [], tasks: [] } },
  'activity/track': { status: 'ready', value: { bars: [], next: null } },
  'activity/calendar': { status: 'ready', value: { cells: [], totals: { complete: true } } },
};

/** Boots the page on that Host and runs `run` once the Task is drawn (and the change stream is open, unless
 * `changes` answers it). `answer` replaces a route's reply when it returns one; `notify` sends one change. */
export async function withE35Page(answer: (route: string, input: unknown) => unknown,
  run: (page: BootedPage, notify: () => void) => Promise<void>, changes?: () => Response): Promise<void> {
  const openings: ReadableStreamDefaultController<Uint8Array>[] = [];
  const request: PageFetch = async (url, init) => {
    const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
    if (route === 'changes') return changes?.() ?? new Response(new ReadableStream<Uint8Array>({ start(c) { openings.push(c); } }), { status: 200 });
    const input = init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as { input?: unknown }).input;
    const body = answer(route, input) ?? REPLIES[route] ?? { status: 'rejected', code: 'not_found', reason: route };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const page = await bootPage({ name: 'TaskMap', search: '?goal=' + GOAL.goalId, token: 'e35-token', request });
  try {
    await until(() => page.root.textContent.includes('E35 任务') && (changes !== undefined || openings.length > 0), 20_000);
    await run(page, () => { openings.at(-1)!.enqueue(new TextEncoder().encode('event: change\nid: c0000000002\ndata: {}\n\n')); });
  } finally { await page.restore(); }
}
