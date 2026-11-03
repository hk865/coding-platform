import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHostClient, committedRouteValue, readyRouteValue, RouteReadError } from '../../src/ui/host-client.js';
import { pinTaskMapLine } from '../../src/ui/boot.js';
import { OPERATOR, S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { adoptPLTwoStageSkeleton, openPLWorkflowWorld, satisfyPLTask, type PLWorkflowWorld } from '../helpers/PL-workflow-fixture.js';
import { S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { checkConfiguration, sessionOf, setS7AAutonomy } from '../helpers/S7A-fixture.js';
import { bootPage, findButton, findClass, type BootedPage } from './helpers/boot-page.js';
import type { FakeElement } from './helpers/dom.js';
import { until } from '../helpers/change-stream-reader.js';

/** E34-11 (ruling 7): the first write goes registration → lines/pin → lines/list
 * for the real Workspace pin; a stale pin is a real rejection, never a fake
 * success. */
function nodesWithClass(root: FakeElement, cls: string): FakeElement[] {
  const found: FakeElement[] = [];
  const seen = new Set<FakeElement>();
  const stack = [root];
  while (stack.length > 0) {
    const el = stack.pop()!;
    if (seen.has(el)) continue;
    seen.add(el);
    if ((el.getAttribute('class') ?? '').split(/\s+/).includes(cls)) found.push(el);
    for (const child of el.childNodes) if (child instanceof Object && 'tagName' in child) stack.push(child as FakeElement);
  }
  return found;
}

let world: PLWorkflowWorld | undefined;
let client: ReturnType<typeof createHostClient>;
let scope: { projectId: string; workspaceId: string };

beforeAll(async () => {
  world = await openPLWorkflowWorld({ backend: 'memory', label: 'e34-11',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  await adoptPLTwoStageSkeleton(world.main, world.goal, { label: 'e34-11', stageOneTaskIds: ['e34-11-a'] });
  await setS7AAutonomy(world.world, world.goal, 'after_plan_confirmation');
  /* A line with real activity: the prototype's packed group shows a quiet
     group's header only, so the pin button lives on a row doing something. */
  const line = await sessionOf(world.world, await createS6BLine(world.main, { label: 'e34-11-line', role: S6A_WORK_ROLE,
    tasks: [{ projectId: world.goal.projectId, goalId: world.goal.goalId, taskId: 'e34-11-a' }] }));
  await satisfyPLTask(world.world, world.goal, 'e34-11-a', line, 'e34-11');
  client = createHostClient(world.world.token, new URL(world.world.base).origin);
  scope = S6A_SCOPE;
}, 30_000);

afterAll(async () => { await world?.close(); world = undefined; });

async function lineRows(): Promise<{ key: Record<string, unknown>; pinned: boolean }[]> {
  const reply = await client.post('lines/list', scope, { workspace: scope });
  return readyRows(reply);
}

function readyRows(reply: { status: string; value?: unknown }): { key: Record<string, unknown>; pinned: boolean }[] {
  const value = readyRouteValue<{ rows?: unknown[] }>(reply as never, 'lines/list');
  return (value.rows ?? []).map((row) => {
    const entry = row as { key: Record<string, unknown>; pinned: boolean };
    return { key: entry.key, pinned: entry.pinned };
  });
}

describe('E34-11 the real Workspace pin write and its rejection', () => {
  it('E34-11 reads registration, commits lines/pin, rereads the pin, and rejects a stale pin', async () => {
    const before = await lineRows();
    expect(before.length).toBeGreaterThan(0);
    const key = before[0]!.key as { projectId: string; workspaceId: string; sessionId: string };
    expect(before[0]!.pinned).toBe(false);
    const registration = await client.post('workspaces/registration', scope, scope);
    const registrationValue = readyRouteValue<{ workspace: { ref: unknown; revision: number } }>(
      registration as never, 'workspaces/registration');

    await pinTaskMapLine(client, scope, key, true);
    const after = await lineRows();
    expect(after.find((row) => (row.key as { sessionId?: string }).sessionId === key.sessionId)?.pinned).toBe(true);

    /* A pin read before the first commit names the old Workspace revision; a
       write carrying it is really rejected by the owner. */
    let failure: unknown = null;
    try {
      committedRouteValue(await client.write('lines/pin', scope, {
        input: { workspace: scope, add: [], remove: [key] },
        meta: { requestId: 'e34-11-stale', expected: [{ ref: registrationValue.workspace.ref, revision: registrationValue.workspace.revision }] },
      }), 'lines/pin');
    } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(RouteReadError);
    expect((failure as RouteReadError).code).toBe('revision_conflict');

    /* The one write helper must reject the same stale registration itself:
       deleting its `committedRouteValue` makes this resolve instead. */
    const staleClient = {
      ...client,
      post: async (route: string, s: typeof scope, input: unknown) => route === 'workspaces/registration'
        ? registration : client.post(route, s, input),
    } as ReturnType<typeof createHostClient>;
    await expect(pinTaskMapLine(staleClient, scope, key, false)).rejects.toMatchObject({ code: 'revision_conflict' });
    const unchanged = await lineRows();
    expect(unchanged.find((row) => (row.key as { sessionId?: string }).sessionId === key.sessionId)?.pinned).toBe(true);
  }, 30_000);

  it('E34-11 pins through the board button with a complete SessionRef and rereads the pin', async () => {
    /* The first row pinned the shared world's line; unpin it through the real
       write so this row starts from an unpinned line. */
    const rows = await lineRows();
    const line = rows.find((row) => row.pinned) ?? rows[0]!;
    await pinTaskMapLine(client, scope, line.key as { projectId: string; sessionId: string }, false);
    expect((await lineRows()).find((row) => (row.key as { sessionId?: string }).sessionId === line.key.sessionId)?.pinned).toBe(false);

    let page: BootedPage | undefined;
    let pinInput: unknown = null;
    try {
      page = await bootPage({
        name: 'TaskMap', search: `?goal=${world!.goal.goalId}`, token: world!.world.token,
        request: async (url, init, realFetch) => {
          const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
          if (route === 'lines/pin') pinInput = JSON.parse(String(init?.body)) as unknown;
          return realFetch(new URL(url, world!.world.base).href, init);
        },
      });
      findButton(page!.root, '轨道')!.dispatch('click');
      await until(() => nodesWithClass(page!.root, 'wl-pin').length > 0, 20_000);
      const pin = nodesWithClass(page!.root, 'wl-pin')[0]!;
      expect(pin.getAttribute('aria-pressed')).toBe('false');
      pin.dispatch('click');
      await until(() => nodesWithClass(page!.root, 'wl-pin')[0]?.getAttribute('aria-pressed') === 'true', 20_000);
      /* A graph write is {scope, request:{input, meta}}. */
      const body = pinInput as { request?: { input?: { add?: Array<Record<string, unknown>> } } } | null;
      const added = body?.request?.input?.add?.[0];
      /* The WorkspaceSnapshot codec accepts exactly projectId+sessionId; the
         earlier extra workspaceId was the 503. */
      expect(added?.projectId).toBe(scope.projectId);
      expect(typeof added?.sessionId).toBe('string');
      expect(Object.keys(added ?? {}).sort()).toEqual(['projectId', 'sessionId']);
      expect(nodesWithClass(page!.root, 'wl-pin')[0]!.getAttribute('aria-label')).toContain('取消固定');
      expect(page!.root.textContent).not.toContain('NaN');
      expect(page!.root.textContent).not.toContain('undefined');
    } finally {
      await page?.restore();
    }
  }, 60_000);
});
