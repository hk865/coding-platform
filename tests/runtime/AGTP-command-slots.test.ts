/**
 * AGTP-5 (AGT+ ruling §3; §2 item 14): the Host's one cap on platform-run commands. A command that finds no free
 * slot waits (FIFO); an abort while queued drops the waiter and resolves `null`; a release hands its slot to the
 * next waiter without changing the running count.
 *
 * Today red at the import: `src/core/agent-runtime/command-slots.ts` lands with AGT+; the `// @ts-ignore` keeps the
 * tree's typecheck at zero until then and is unused once the module exists (the ruling's frozen signature is
 * `createCommandSlots(limit)` and `acquire(signal): Promise<(() => void) | null>`).
 */
import { expect, it } from 'vitest';
// @ts-ignore -- the module lands with AGT+.
import { createCommandSlots } from '../../src/core/agent-runtime/command-slots.js';
import { deferred, type Deferred } from '../helpers/A2-restart-fixture.js';
/** Let every pending promise continuation run; the module only uses promises, never a timer. */
async function settle(times = 8): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

type Hold = { name: string; gate: Deferred; result: Promise<(() => void) | null> };
function hold(slots: ReturnType<typeof createCommandSlots>, name: string, signal: AbortSignal,
  gate: Deferred, log: string[]): Hold {
  const result = slots.acquire(signal).then((release: (() => void) | null) => {
    if (release !== null) log.push(`s${name}`);
    return release;
  });
  return { name, gate, result };
}

it('AGTP-5 one slot runs A then B then C in FIFO order', async () => {
  const slots = createCommandSlots(1);
  const log: string[] = [];
  const gates = [deferred(), deferred(), deferred()];
  const starts = ['A', 'B', 'C'].map((name, index) => hold(
    slots, name, new AbortController().signal, gates[index]!, log));
  const bodies = starts.map(async (entry, index) => {
    const release = await entry.result;
    if (release === null) return;
    await gates[index]!.promise;
    log.push(`e${entry.name}`);
    release();
  });
  await settle();
  expect(log).toEqual(['sA']);
  for (const gate of gates) gate.resolve();
  await Promise.all(bodies);
  expect(log).toEqual(['sA', 'eA', 'sB', 'eB', 'sC', 'eC']);
});

it('AGTP-5 an abort while queued resolves null and the next waiter takes the released slot', async () => {
  const slots = createCommandSlots(1);
  const log: string[] = [];
  const gateA = deferred();
  const gateC = deferred();
  const first = hold(slots, 'A', new AbortController().signal, gateA, log);
  const firstBody = (async () => {
    const release = await first.result;
    await gateA.promise;
    log.push('eA');
    if (release !== null) release();
  })();
  await settle();
  expect(log).toEqual(['sA']);

  const controller = new AbortController();
  const queued = slots.acquire(controller.signal);
  let queuedResult: (() => void) | null | undefined;
  const queuedDone = queued.then((release: (() => void) | null) => { queuedResult = release; });
  await settle();
  const third = hold(slots, 'C', new AbortController().signal, gateC, log);
  const thirdBody = (async () => {
    const release = await third.result;
    await gateC.promise;
    log.push('eC');
    if (release !== null) release();
  })();
  await settle();
  controller.abort();
  await queuedDone;
  expect(queuedResult).toBeNull();
  expect(log).toEqual(['sA']);

  gateA.resolve();
  await settle();
  expect(log).toEqual(['sA', 'eA', 'sC']);
  gateC.resolve();
  await Promise.all([firstBody, thirdBody]);
  expect(log).toEqual(['sA', 'eA', 'sC', 'eC']);
});
