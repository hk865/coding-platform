/**
 * COPY-ONLY replay driver (S4/D3b). It proves item 1 (the whole assembler
 * result) on a copy that cannot reproduce the base run's random values:
 *
 *   S85_REPLAY_BASE=<base-run1 dir> npx vitest run tests/probe-e4/replay.test.ts
 *
 * For every recorded `assembler:task|query|attention` call it rebuilds the
 * dependency object from the recorded shape, replays the exact recorded deps
 * outcomes for that call's `depsRange`, invokes the assembler with the recorded
 * arguments and compares the complete encoded return value with the recorded
 * one. Nothing is normalised, erased or sorted: ids, hashes and timestamps are
 * compared as recorded. A missing/extra/reordered deps call fails the replay.
 *
 * Installed by run-replay.sh; never part of the repository.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createContextAssembler } from '../../src/core/agent-runtime/context-assembler.js';
import { decodeProbeValue, encodeProbeValue } from '../../src/probe-hook.js';

type Record = {
  testPath: string; testName: string; probe: string; callIndex: number;
  payload: any;
};

const baseDir = process.env.S85_REPLAY_BASE;
const enabled = baseDir !== undefined && baseDir !== '';

function loadRecords(directory: string): Record[] {
  const out: Record[] = [];
  for (const file of readdirSync(directory).filter(name => name.endsWith('.jsonl') && statSync(join(directory, name)).isFile())) {
    for (const line of readFileSync(join(directory, file), 'utf8').split('\n')) {
      if (line !== '') out.push(JSON.parse(line) as Record);
    }
  }
  return out;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function describeError(error: unknown): unknown {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { thrown: String(error) };
}

async function replayOne(records: Record[]): Promise<string | null> {
  const depsEvents = records.filter(record => record.probe === 'deps')
    .sort((a, b) => a.callIndex - b.callIndex);
  const failures: string[] = [];
  for (const call of records.filter(record => record.probe.startsWith('assembler:'))
    .sort((a, b) => a.callIndex - b.callIndex)) {
    const from = Array.isArray(call.payload.depsRange) ? call.payload.depsRange[0] : 0;
    const to = Array.isArray(call.payload.depsRange) ? call.payload.depsRange[1] : depsEvents.length;
    const slice = depsEvents.filter(record => record.callIndex >= from && record.callIndex < to)
      .sort((a, b) => a.callIndex - b.callIndex);
    let cursor = 0;
    const stubFor = (path: string) => async (...args: unknown[]): Promise<unknown> => {
      const event = slice[cursor];
      if (event === undefined) {
        throw new Error(`replay: ${path} has no recorded deps call left (range ${from}..${to})`);
      }
      cursor += 1;
      if (event.payload.method !== path) {
        throw new Error(`replay: deps call ${cursor - 1} expected ${path}, recorded ${event.payload.method}`);
      }
      const encodedArgs = encodeProbeValue(args);
      if (!deepEqual(encodedArgs, event.payload.args)) {
        throw new Error(`replay: ${path} args differ\n  actual   ${JSON.stringify(encodedArgs).slice(0, 500)}\n  recorded ${JSON.stringify(event.payload.args).slice(0, 500)}`);
      }
      const outcome = event.payload.outcome;
      if (outcome.status === 'rejected') {
        const error = new Error(String((outcome.error as any)?.message ?? 'replayed rejection'));
        return Promise.reject(error);
      }
      if (outcome.status === 'threw') {
        throw new Error(String((outcome.error as any)?.message ?? 'replayed throw'));
      }
      return decodeProbeValue(outcome.value);
    };
    const deps: Record<string, any> = {};
    const shape = call.payload.depsShape ?? {};
    for (const key of Object.keys(shape)) {
      const info = shape[key];
      if (info?.present !== true) continue;
      if (info.kind === 'object') {
        deps[key] = {};
        for (const method of info.methods ?? []) deps[key][method] = stubFor(key + '.' + method);
      } else if (info.kind === 'function') {
        deps[key] = stubFor(key);
      } else {
        deps[key] = undefined;
      }
    }
    const assembler = createContextAssembler(deps as never);
    const args = (decodeProbeValue(call.payload.args) as unknown[]);
    const method = String(call.payload.method);
    let actual: unknown;
    let threw: unknown;
    try {
      actual = await (assembler as any)[method](...args);
    } catch (error) {
      threw = error;
      if (process.env.S85_REPLAY_DEBUG === '1') console.log('STACK', (error as Error)?.stack);
    }
    if (call.payload.threw !== undefined) {
      if (threw === undefined) {
        failures.push(`${call.testPath} / ${call.testName} / ${method}: recorded a throw, replay resolved`);
      } else if (!deepEqual(describeError(threw), call.payload.threw)) {
        failures.push(`${call.testPath} / ${call.testName} / ${method}: thrown value differs`);
      }
    } else if (threw !== undefined) {
      failures.push(`${call.testPath} / ${call.testName} / ${method}: replay threw ${JSON.stringify(describeError(threw))}`);
    } else if (!deepEqual(encodeProbeValue(actual), call.payload.result)) {
      const left = JSON.stringify(encodeProbeValue(actual));
      const right = JSON.stringify(call.payload.result);
      let offset = 0;
      while (offset < left.length && offset < right.length && left[offset] === right[offset]) offset += 1;
      failures.push(`${call.testPath} / ${call.testName} / ${method}: result differs at character ${offset}; `
        + `actual length ${left.length}, recorded length ${right.length}; `
        + `actual ${JSON.stringify(left.slice(Math.max(0, offset - 80), offset + 80))}; `
        + `recorded ${JSON.stringify(right.slice(Math.max(0, offset - 80), offset + 80))}`);
    }
    if (cursor !== slice.length) {
      failures.push(`${call.testPath} / ${call.testName} / ${method}: replay made ${cursor} deps calls, recorded ${slice.length}`);
    }
  }
  return failures.length === 0 ? null : failures.join('\n');
}

describe('S4 recorded-input replay', () => {
  it('replays every recorded assembler call through the current copy', async () => {
    if (!enabled) {
      console.log('S85_REPLAY_BASE is not set; replay skipped');
      return;
    }
    const records = loadRecords(baseDir!);
    const groups = new Map<string, Record[]>();
    for (const record of records) {
      const key = record.testPath + '\u0000' + record.testName;
      const list = groups.get(key) ?? [];
      list.push(record);
      groups.set(key, list);
    }
    const failures: string[] = [];
    let calls = 0;
    for (const [key, group] of groups) {
      if (!group.some(record => record.probe.startsWith('assembler:'))) continue;
      const [testPath, testName] = key.split('\u0000');
      const failure = await replayOne(group);
      calls += group.filter(record => record.probe.startsWith('assembler:')).length;
      if (failure !== null) failures.push(`=== ${testPath} / ${testName} ===\n${failure}`);
    }
    console.log(`replay: ${groups.size} test groups, ${calls} assembler calls, ${failures.length} failing groups`);
    for (const failure of failures.slice(0, 3)) console.log(failure);
    expect(failures).toEqual([]);
  });
});
