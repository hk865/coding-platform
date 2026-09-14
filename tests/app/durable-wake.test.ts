import { expect, it } from 'vitest';
import { DurableWake } from '../../src/app/scheduling/durable-wake.js';

it('retains a wake arriving during a scan and permits independent scopes', async () => {
  const wake = new DurableWake();
  let release!: () => void, entered!: () => void, calls = 0, other = false;
  const barrier = new Promise<void>(resolve => release = resolve);
  const started = new Promise<void>(resolve => entered = resolve);
  const scan = async () => { if (++calls === 1) { entered(); await barrier; } };
  const first = wake.request('a', scan);
  await started;
  const second = wake.request('a', scan);
  await wake.request('b', async () => { other = true; });
  expect(other).toBe(true); expect(calls).toBe(1);
  release(); await Promise.all([first, second]); expect(calls).toBe(2);
  await wake.close();
});

it('reconstructs accepted work after losing a wake, and retries a failed scan', async () => {
  const durable = new Set(['accepted-before-wake']);
  let fail = true;
  const restored = new DurableWake();
  const scan = async () => { if (fail) { fail = false; throw Error('storage temporarily unavailable'); } durable.clear(); };
  await expect(restored.request('plans', scan)).rejects.toThrow('storage');
  expect(durable.size).toBe(1);
  await restored.request('plans', scan); expect(durable.size).toBe(0);
  await restored.close();
});
