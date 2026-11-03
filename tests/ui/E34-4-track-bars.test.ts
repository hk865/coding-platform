import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHostClient } from '../../src/ui/host-client.js';
import { readTaskMap } from '../../src/ui/boot.js';
import type { TaskMapTimeData } from '../../src/ui/adapters/task-map.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { checkConfiguration, sessionOf } from '../helpers/S7A-fixture.js';
import { OPERATOR, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { until } from '../helpers/change-stream-reader.js';
import {
  adoptPLTwoStageSkeleton, advancePLGoal, openPLWorkflowWorld, satisfyPLTask, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';
import {
  bootPage, findAllClass, findButton, findClass, findElement, type BootedPage, type PageFetch,
} from './helpers/boot-page.js';
import { scene } from './helpers/task-map-scene.js';

/** E34-4 (design §3/§5): a real Work Run and the formal check round its
 * `open_checks` step runs reach the track through the real activity route;
 * results, the real ordinal and the activity totals are the written facts, and
 * the board shows the same check bar. */
let world: PLWorkflowWorld | undefined;
let time: TaskMapTimeData;

/** The rows freeze Date to the scene's now; poll with the un-faked clock. */
async function poll(predicate: () => boolean, timeoutMs = 20_000): Promise<void> {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeoutMs) throw new Error('condition not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeAll(async () => {
  /* The check configuration is the Host's own input (the same `checkConfiguration`
     the PL chain uses): without it `open_checks` opens no formal round. */
  world = await openPLWorkflowWorld({ backend: 'memory', label: 'e34-4',
    extraHostOptions: { checks: checkConfiguration({ kind: 'human', id: OPERATOR.id }) } });
  await adoptPLTwoStageSkeleton(world.main, world.goal, { label: 'e34-4', stageOneTaskIds: ['pl-a', 'pl-b'] });
  const line = await sessionOf(world.world, await createS6BLine(world.main, { label: 'e34-4-line', role: S6A_WORK_ROLE }));
  await satisfyPLTask(world.world, world.goal, 'pl-a', line, 'e34-4');
  await satisfyPLTask(world.world, world.goal, 'pl-b', line, 'e34-4');
  await advancePLGoal(world.world, world.goal, 'e34-4-gate');
  const client = createHostClient(world.world.token, new URL(world.world.base).origin);
  const { data } = await readTaskMap(client, world.goal.goalId, { track: true });
  time = data!.time!;
}, 90_000);

afterAll(async () => { await world?.close(); world = undefined; });

type Root = BootedPage['root'];
type Bar = Record<string, unknown>;
const classesOf = (element: Root): string[] => (element.getAttribute('class') ?? '').split(/\s+/);
const styleOf = (element: Root): string => element.getAttribute('style') ?? '';
const decideMarks = (root: Root): string[] => findAllClass(root, 'tl-mark')
  .filter((mark) => classesOf(mark).includes('s-decide')).map(styleOf);
const incompleteMarks = (root: Root): string[] => findAllClass(root, 'tl-mark')
  .filter((mark) => (mark.getAttribute('title') ?? '').includes('检查不完整')).map(styleOf);
const waitLines = (root: Root): string[] => findAllClass(root, 'tl-link')
  .filter((link) => classesOf(link).includes('wait')).map(styleOf).sort();
const hourCell = (root: Root, label: string): Root | undefined => findAllClass(root, 'cal-c')
  .find((element) => (element.getAttribute('aria-label') ?? '').startsWith(label));

/** The scene's replies with each `activity/track` page edited in place; a Query
 * pass is the page read with `sessionRefs`. */
const editedTrack = (edit: (bars: Bar[], queryPass: boolean) => void): PageFetch => async (url, init) => {
  const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
  if (route === 'changes') return new Response('{}', { status: 404 });
  const envelope = init?.body === undefined ? {} : JSON.parse(String(init.body)) as { input?: unknown };
  const input = (envelope.input ?? envelope) as Record<string, unknown>;
  const reply = scene.reply(route, input) as { value?: { bars?: Bar[] } };
  if (route === 'activity/track' && reply.value?.bars !== undefined) edit(reply.value.bars, input.sessionRefs !== undefined);
  return new Response(JSON.stringify(reply), { status: 200 });
};

/** A read-only consultation asked of the line `sessionId`: the real bar shape has
 * no Task and is placed by `askedSessionRef`. */
function consultation(sessionId: string, startAt: string, endAt: string): Bar {
  const page = scene.reply('activity/track', { sessionRefs: [{ sessionId: 'T28' }] }) as unknown as { value: { bars: Bar[] } };
  const base = JSON.parse(JSON.stringify(page.value.bars[0])) as Bar;
  const asked = { ...(base.sessionRef as Bar), sessionId };
  return { ...base, queryRunRef: { ...(base.queryRunRef as Bar), queryJobId: 'ask-' + sessionId, runId: 'ask-' + sessionId },
    sessionRef: asked, askedSessionRef: asked, startAt, endAt };
}

/** Yesterday's T21 Run, 15:00 to 15:40, on T21's own line. */
function yesterdayRun(bars: readonly Bar[]): Bar {
  const base = bars.find((bar) => bar.kind === 'run' && bar.taskId === 'T21')!;
  return { ...JSON.parse(JSON.stringify(base)) as Bar, runRef: { ...(base.runRef as Bar), runId: 'y-t21' },
    startAt: '2026-10-03T15:00:00+08:00', endAt: '2026-10-03T15:40:00+08:00', result: 'completed', previous: null };
}

/** Yesterday's incomplete T20 check, 15:45 to 15:50, on T20's own line. */
function yesterdayIncompleteCheck(bars: readonly Bar[]): Bar {
  const base = bars.find((bar) => bar.kind === 'check' && bar.taskId === 'T20')!;
  return { ...JSON.parse(JSON.stringify(base)) as Bar, roundRef: { ...(base.roundRef as Bar), runId: 'y-t20', roundId: 'y-t20' },
    startAt: '2026-10-03T15:45:00+08:00', endAt: '2026-10-03T15:50:00+08:00', result: 'INCONCLUSIVE', previous: null };
}

describe('E34-4 real Work and check bars', () => {
  it('E34-4 shows the completed Run and the PASS check with its real ordinal', () => {
    const bars = time.rows.flatMap((row) => row.bars);
    const run = bars.find((bar) => bar.kind === 'run' && bar.taskId === 'pl-a')!;
    expect(run).toBeDefined();
    expect(run.word).toBe('已结束');
    expect(run.pauses).toHaveLength(0);
    expect(run.activity).not.toBeNull();

    const check = bars.find((bar) => bar.kind === 'check' && bar.taskId === 'pl-a')!;
    expect(check).toBeDefined();
    expect(check.result).toBe('PASS');
    expect(check.word).toBe('通过');
    expect(check.ordinal).toBe(1);
    expect(check.activity).toBeNull();
    expect(check.marks).toEqual([]);
    /* The check round sits on the same line as the Run it checked. */
    const runRow = time.rows.find((row) => row.bars.some((bar) => bar.id === run.id))!;
    expect(runRow.bars.some((bar) => bar.id === check.id)).toBe(true);
  }, 60_000);

  it('E34-4 renders that check bar and its ordinal through the page', async () => {
    let page: BootedPage | undefined;
    try {
      page = await bootPage({
        name: 'TaskMap', search: `?goal=${world!.goal.goalId}`, token: world!.world.token,
        request: async (url, init, realFetch) => realFetch(new URL(url, world!.world.base).href, init),
      });
      const view = page!;
      findButton(view.root, '轨道')!.dispatch('click');
      await until(() => findClass(view.root, 'k-check') !== undefined, 20_000);
      const bar = findClass(view.root, 'k-check')!;
      /* The prototype classes: `tl-b k-check s-satisfied wN`; no second-set
         `r-pass`. */
      const cls = bar.getAttribute('class')!;
      expect(cls).toContain('tl-b');
      expect(cls).toContain('k-check');
      expect(cls).toContain('s-satisfied');
      expect(cls).toMatch(/\bw\d+\b/);
      expect(cls).not.toContain('r-pass');
      expect(bar.getAttribute('aria-label')).toContain('通过');
      bar.dispatch('mouseenter', { currentTarget: bar });
      const card = findClass(view.root, 'hcard');
      expect(card).toBeDefined();
      expect(card!.textContent).toContain('第 1 轮');
      expect(view.root.textContent).not.toContain('状态机可靠性改造');
      expect(view.root.textContent).not.toContain('NaN');
    } finally {
      await page?.restore();
    }
  }, 60_000);

  /* Named mutations: remove the `yielded` tuple from `tlRes` (20); restore the
     second `stage:` prefix on the 任务 group key (24). */
  it('E34-4 a yielded Run reads as 已让出 and keeps the dock rendering', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    let page: BootedPage | undefined;
    try {
      page = await bootPage({
        name: 'TaskMap', search: '?goal=g1', token: 'e34-4-yielded',
        request: async (url, init) => {
          const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
          if (route === 'changes') return new Response('{}', { status: 404 });
          const envelope = init?.body === undefined ? {} : JSON.parse(String(init.body)) as { input?: unknown };
          const input = (envelope.input ?? envelope) as Record<string, unknown>;
          const reply = scene.reply(route, input) as { value?: { bars?: Array<Record<string, unknown>> } };
          if (route === 'activity/track' && input.sessionRefs === undefined && reply.value?.bars !== undefined) {
            const base = reply.value.bars.find((bar) => bar.kind === 'run' && bar.taskId === 'T13');
            if (base !== undefined) {
              reply.value.bars.push({
                ...JSON.parse(JSON.stringify(base)),
                runRef: { ...(base.runRef as Record<string, unknown>), runId: 'v-yielded' },
                startAt: '2026-10-04T10:30:00+08:00', endAt: '2026-10-04T10:50:00+08:00',
                result: 'yielded',
              });
            }
          }
          return new Response(JSON.stringify(reply), { status: 200 });
        },
      });
      await poll(() => page!.root.textContent.includes('状态机规格对齐'));
      await poll(() => findElement(page!.root, (element) => {
        const cls = element.getAttribute('class') ?? '';
        return cls.includes('tl-b') && (element.getAttribute('aria-label') ?? '').includes('已让出');
      }) !== undefined);
      const yielded = findElement(page.root, (element) => {
        const cls = element.getAttribute('class') ?? '';
        return cls.includes('tl-b') && (element.getAttribute('aria-label') ?? '').includes('已让出');
      });
      expect(yielded).toBeDefined();
      expect(page.root.textContent).not.toContain('NaN');
      expect(page.root.textContent).not.toContain('undefined');
    } finally {
      await page?.restore();
      vi.useRealTimers();
    }
  }, 60_000);

  it('E34-4 任务 grouping keeps a stage Task lane and its check bar', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    let page: BootedPage | undefined;
    try {
      page = await bootPage({
        name: 'TaskMap', search: '?goal=g1', token: 'e34-4-task-group',
        request: async (url, init) => {
          const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
          if (route === 'changes') return new Response('{}', { status: 404 });
          const envelope = init?.body === undefined ? {} : JSON.parse(String(init.body)) as { input?: unknown };
          return new Response(JSON.stringify(scene.reply(route, envelope.input ?? envelope)), { status: 200 });
        },
      });
      findButton(page.root, '轨道')!.dispatch('click');
      await poll(() => findClass(page!.root, 'is-full') !== undefined);
      findButton(page.root, '任务')!.dispatch('click');
      await poll(() => page!.root.textContent.includes('失败与重新入队'));
      expect(page.root.textContent).toContain('失败与重新入队');
      expect(findClass(page.root, 'k-check')).toBeDefined();
    } finally {
      await page?.restore();
      vi.useRealTimers();
    }
  }, 60_000);

  it('E34-4 a historical hour draws no decision mark or wait from the current state', async () => {
    /* Row 6: T21 reached its rework cap today. Selecting yesterday's hour must
       not move the current decide mark to yesterday's last bar nor draw a wait
       from there to now; only the window that still contains now shows it. */
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    let page: BootedPage | undefined;
    const cellLabel = '10-03 周六 15:00–16:00';
    const cellWith = (label: string) => findElement(page!.root, (element) => {
      const cls = (element.getAttribute('class') ?? '').split(/\s+/);
      return cls.includes('cal-c') && (element.getAttribute('aria-label') ?? '').startsWith(label);
    });
    try {
      page = await bootPage({
        name: 'TaskMap', search: '?goal=g1', token: 'e34-4-yesterday',
        request: async (url, init) => {
          const route = url.slice(url.indexOf('/api/real/core/') + '/api/real/core/'.length);
          if (route === 'changes') return new Response('{}', { status: 404 });
          const envelope = init?.body === undefined ? {} : JSON.parse(String(init.body)) as { input?: unknown };
          const input = (envelope.input ?? envelope) as Record<string, unknown>;
          const reply = scene.reply(route, input) as { value?: { bars?: Array<Record<string, unknown>> } };
          if (route === 'activity/track' && input.sessionRefs === undefined && reply.value?.bars !== undefined) {
            const base = reply.value.bars.find((bar) => bar.kind === 'run' && bar.taskId === 'T21');
            if (base !== undefined) {
              reply.value.bars.push({
                ...JSON.parse(JSON.stringify(base)),
                runRef: { ...(base.runRef as Record<string, unknown>), runId: 'y-t21' },
                startAt: '2026-10-03T15:00:00+08:00', endAt: '2026-10-03T15:40:00+08:00',
                result: 'completed', previous: null,
              });
            }
          }
          return new Response(JSON.stringify(reply), { status: 200 });
        },
      });
      findButton(page.root, '轨道')!.dispatch('click');
      await poll(() => findClass(page!.root, 'is-full') !== undefined);
      findButton(page.root, '本周')!.dispatch('click');
      await poll(() => cellWith(cellLabel) !== undefined);
      cellWith(cellLabel)!.dispatch('click');
      await poll(() => (findClass(page!.root, 'tl-sum')?.textContent ?? '').includes('10-03 15:00 这一小时'));
      /* Under the old code the in-window T21 bar is the "last" one, so the
         decide mark and a wait to now land on yesterday. */
      expect(findElement(page.root, (element) => {
        const cls = (element.getAttribute('class') ?? '').split(/\s+/);
        return cls.includes('tl-mark') && cls.includes('s-decide');
      })).toBeUndefined();
      expect(findElement(page.root, (element) => {
        const cls = (element.getAttribute('class') ?? '').split(/\s+/);
        return cls.includes('tl-link') && cls.includes('wait');
      })).toBeUndefined();

      /* The window that contains now still shows the mark at today's last bar. */
      findButton(page.root, '今天')!.dispatch('click');
      await poll(() => findElement(page!.root, (element) => {
        const cls = (element.getAttribute('class') ?? '').split(/\s+/);
        return cls.includes('tl-mark') && cls.includes('s-decide');
      }) !== undefined);
      expect(findElement(page.root, (element) => {
        const cls = (element.getAttribute('class') ?? '').split(/\s+/);
        return cls.includes('tl-mark') && cls.includes('s-decide');
      })).toBeDefined();
    } finally {
      await page?.restore();
      vi.useRealTimers();
    }
  }, 60_000);

  it('E34-4 a consultation after the Task leaves the decision and incomplete-check marks on the Task\'s last bar', async () => {
    /* Row C. The today window is 08:00 to 15:00, 420 minutes: T21's last bar ends
       at 14:11 (371/420 = 88.33%), T20's incomplete check at 14:02 (362/420 =
       86.19%) and now is 14:15 (89.29%), so the waits are 0.95 and 3.10 wide.
       Named mutations: take the unit's tail bar again (the decision moves to the
       consultation's end at 14:14, 89.05%, and the incomplete mark disappears);
       drop the whole gate (yesterday's in-window bars draw both marks). */
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    const decisionAt = ['left: 88.33%;'];
    const incompleteAt = ['left: 86.19%;'];
    const waits = ['left: 86.19%; width: 3.1%;', 'left: 88.33%; width: 0.95%;'];
    const cellLabel = '10-03 周六 15:00–16:00';
    let page: BootedPage | undefined;
    try {
      page = await bootPage({
        name: 'TaskMap', search: '?goal=g1', token: 'e34-4-consult',
        request: editedTrack((bars, queryPass) => {
          if (queryPass) {
            bars.push(consultation('T21', '2026-10-04T14:12:00+08:00', '2026-10-04T14:14:00+08:00'),
              consultation('T20', '2026-10-04T14:03:00+08:00', '2026-10-04T14:06:00+08:00'));
          } else {
            bars.push(yesterdayRun(bars), yesterdayIncompleteCheck(bars));
          }
        }),
      });
      const root = page.root;
      findButton(root, '轨道')!.dispatch('click');
      await poll(() => findClass(root, 'is-full') !== undefined && decideMarks(root).length > 0);
      expect(decideMarks(root)).toEqual(decisionAt);
      expect(incompleteMarks(root)).toEqual(incompleteAt);
      expect(waitLines(root)).toEqual(waits);

      findButton(root, '本周')!.dispatch('click');
      await poll(() => hourCell(root, cellLabel) !== undefined);
      hourCell(root, cellLabel)!.dispatch('click');
      await poll(() => (findClass(root, 'tl-sum')?.textContent ?? '').includes('10-03 15:00 这一小时'));
      expect(decideMarks(root)).toEqual([]);
      expect(incompleteMarks(root)).toEqual([]);
      expect(waitLines(root)).toEqual([]);

      findButton(root, '今天')!.dispatch('click');
      await poll(() => decideMarks(root).length > 0);
      expect(decideMarks(root)).toEqual(decisionAt);
      expect(incompleteMarks(root)).toEqual(incompleteAt);
      expect(waitLines(root)).toEqual(waits);
    } finally {
      await page?.restore();
      vi.useRealTimers();
    }
  }, 60_000);

  it('E34-4 a Task whose real last bar is in a past hour marks it only in a window that holds now', async () => {
    /* Row C, the second half of the gate: T21's only bar is yesterday's, so it is
       the real last bar in both windows. The week holds now; a day is drawn 08:00–20:00: 10-03 15:40 is
       (5 + 460/720) of 7 days, 80.56%, and now is (6 + 375/720) of 7, 93.15%, so
       its wait is 12.6 wide; T20's incomplete check at 14:02, (6 + 362/720) of 7, 92.90%, waits 0.26.
       The picked hour does not hold now. Named mutation: drop the window-contains-now
       gate; the picked hour draws the mark and a wait. */
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(scene.now));
    const cellLabel = '10-03 周六 15:00–16:00';
    let page: BootedPage | undefined;
    try {
      page = await bootPage({
        name: 'TaskMap', search: '?goal=g1', token: 'e34-4-past-last',
        request: editedTrack((bars, queryPass) => {
          if (queryPass) return;
          const past = yesterdayRun(bars);
          bars.splice(0, bars.length, ...bars.filter((bar) => bar.taskId !== 'T21'), past);
        }),
      });
      const root = page.root;
      findButton(root, '轨道')!.dispatch('click');
      await poll(() => findClass(root, 'is-full') !== undefined);
      findButton(root, '本周')!.dispatch('click');
      await poll(() => hourCell(root, cellLabel) !== undefined && decideMarks(root).length > 0);
      expect(decideMarks(root)).toEqual(['left: 80.56%;']);
      expect(waitLines(root)).toEqual(['left: 80.56%; width: 12.6%;', 'left: 92.9%; width: 0.26%;']);

      hourCell(root, cellLabel)!.dispatch('click');
      await poll(() => (findClass(root, 'tl-sum')?.textContent ?? '').includes('10-03 15:00 这一小时'));
      expect(decideMarks(root)).toEqual([]);
      expect(waitLines(root)).toEqual([]);
    } finally {
      await page?.restore();
      vi.useRealTimers();
    }
  }, 60_000);
});
