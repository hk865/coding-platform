/**
 * Slice K2 KE3: the observed input meter on a real Host binding (slice-K2-SPEC M1–M3, rows K2M-01, K2M-02).
 *
 * The world is the frozen S6A request world with its request driver on and Host settings enabled. A directory
 * is opened through the settings routes and given DeepSeek's deepseek-v4.1-flash, so its local secretary
 * binding has a 1,000,000-token window and a 16,384-token reply reserve (slice-K2-SPEC §4 shared budget). The
 * secretary rounds are real `requests/submit` rounds the Host's own driver runs; the scripted model answers
 * with fixed usage and records every request it receives.
 *
 * Hand-computed bounds (slice-K2-SPEC §4 K2-M shared numbers): the selection budget is 1,000,000 − 16,384 =
 * 983,616, so a request of B UTF-8 bytes is trimmed when metered by bytes once B + 4,096 > 983,616, i.e.
 * B > 979,520. f1–f16 are single-line 64,000-byte ASCII files, so sixteen read results are at least 1,024,000
 * bytes; one read call and result add less than 65,000 bytes to the next request.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { CoreScope, SessionRef } from '../../src/app/core-http-types.js';
import type { RequestCoreViewV1 } from '../../src/core/work-graph/model/request-contracts.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import { openS6ARequestWorld, type S6ARequestWorld } from '../helpers/S6A-request-fixture.js';
import { waitFor } from '../scenarios/harness.js';
import { plain, settingsPost } from './support/S8A-L8-host.js';

const worlds: S6ARequestWorld[] = [];
const temporary: string[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

/** f1 is 64,000 `a`, …, f16 is 64,000 `p`; small.txt is 100 `x`. */
const ORIGINAL = new Map<string, string>([
  ...Array.from({ length: 16 }, (_, index) => [`read-f${String(index + 1)}`, String.fromCharCode(97 + index).repeat(64_000)] as const),
  ['read-small', 'x'.repeat(100)],
]);
const placeholder = (callId: string): string => `内容因长度省略（工具 read，调用 ${callId}），需要时重新读`;
const sixteenOriginals = Array.from({ length: 16 }, (_, index) => `read-f${String(index + 1)}:original`);

function usage(inputTokens: number) {
  return { inputTokens, outputTokens: 1, cachedInputTokens: 0, costUsdMicros: null };
}
function readCall(name: string, inputTokens: number): ScriptedReply {
  return { kind: 'calls', calls: [{ callId: `read-${name}`, name: 'read', args: { path: `${name}.txt` } }], usage: usage(inputTokens) };
}
function answer(inputTokens: number): ScriptedReply {
  return { kind: 'text', text: 'K2M answer', usage: usage(inputTokens) };
}
/** Reads of f1..f_n, each request reporting `inputTokens`, then the answer. */
function readsThenAnswer(n: number, inputTokens: number): ScriptedReply[] {
  return [...Array.from({ length: n }, (_, index) => readCall(`f${String(index + 1)}`, inputTokens)), answer(inputTokens)];
}

/** Each read result of a request: `<callId>:original` (its file's full text), `:placeholder` or `:other`. */
function readState(request: ModelRequest): string[] {
  return request.messages.flatMap((message) => {
    if (message.role !== 'tool') return [];
    const output = message.result.output;
    const text = output[0]?.kind === 'text' ? output[0].text : null;
    const state = text === ORIGINAL.get(message.callId) ? 'original'
      : output.length === 1 && text === placeholder(message.callId) ? 'placeholder' : 'other';
    return [`${message.callId}:${state}`];
  });
}

async function settings<T>(world: S6ARequestWorld, route: string, body: unknown): Promise<T> {
  const response = await (await settingsPost(world.base, route, world.token, body)).json() as { status: string; value?: T };
  if (response.status !== 'ready') throw new Error(`K2M: the settings route ${route} answered ${JSON.stringify(response)}`);
  return response.value as T;
}

/** The world, and the opened directory whose local secretary runs on deepseek-v4.1-flash. */
async function openMeterWorld(backend: 'memory' | 'sqlite'): Promise<{ world: S6ARequestWorld; scope: CoreScope }> {
  const settingsDirectory = await mkdtemp(join(tmpdir(), 'k2m-settings-'));
  const root = await mkdtemp(join(tmpdir(), 'k2m-directory-'));
  temporary.push(settingsDirectory, root);
  for (const [callId, text] of ORIGINAL) await writeFile(join(root, `${callId.slice('read-'.length)}.txt`), text);
  const world = await openS6ARequestWorld({ backend, extraHostOptions: { requestDriver: 'on', settings: { settingsDirectory } } });
  worlds.push(world);
  const { scope } = await settings<{ scope: CoreScope }>(world, 'workspaces/open',
    { path: root, writeAllowed: false, commandsAllowed: false });
  const saved = await settings<{ models: { id: string; model: string }[] }>(world, 'models/save',
    { label: 'K2M v4.1 flash', provider: 'deepseek', model: 'deepseek-v4.1-flash', apiKey: 'k2m-synthetic-key' });
  const model = saved.models.find((entry) => entry.model === 'deepseek-v4.1-flash');
  if (model === undefined) throw new Error('K2M: the saved model is not in the catalog');
  await settings(world, 'models/select', { scope, modelId: model.id });
  return { world, scope };
}

let commands = 0;
/** One request round the Host's driver runs to its end; returns the model requests it made and its secretary. */
async function round(world: S6ARequestWorld, scope: CoreScope, replies: ScriptedReply[]):
Promise<{ requests: ModelRequest[]; secretary: SessionRef }> {
  const before = world.model.requests.length;
  world.scriptReplies(replies);
  const submitted = (await world.post('requests/submit', plain(scope, {
    commandId: `k2m-request-${String(++commands)}`, goalId: null, text: 'K2M: read the files', continues: null, recipient: null,
  }))).body as { status: string; requestRoot: unknown; round: { queryJobId: string }; secretary: SessionRef };
  if (submitted.status !== 'queued') throw new Error(`K2M: the request was refused: ${JSON.stringify(submitted)}`);
  const read = async () => (await world.post('requests/read', plain(scope, { requestRoot: submitted.requestRoot })))
    .body as { status: string; value?: RequestCoreViewV1 };
  await waitFor(read,
    (view) => view.value?.rounds.find((entry) => entry.ref.queryJobId === submitted.round.queryJobId)?.status === 'ended',
    'the K2M request round to end');
  return { requests: world.model.requests.slice(before), secretary: submitted.secretary };
}

describe('K2 observed input meter (KE3, real Host binding)', () => {
  it('K2M-01 a sixteen-read secretary round keeps every read in its 17th request (memory)', async () => {
    const { world, scope } = await openMeterWorld('memory');

    const { requests } = await round(world, scope, readsThenAnswer(16, 1_000));

    expect(requests).toHaveLength(17);
    expect(readState(requests[16]!)).toEqual(sixteenOriginals);
  }, 120_000);

  it('K2M-02 (a) SQLite only (Host restart): the ratio is not persisted, so the next round first meters by bytes, then by the new report', async () => {
    const { world, scope } = await openMeterWorld('sqlite');
    const first = await round(world, scope, readsThenAnswer(16, 1_000));
    await world.reopen();

    const next = await round(world, scope, [readCall('small', 1_000), answer(1_000)]);

    expect(next.secretary).toEqual(first.secretary);
    expect(next.requests).toHaveLength(2);
    expect(readState(next.requests[0]!)[0]).toBe('read-f1:placeholder');
    expect(readState(next.requests[1]!)).toEqual([...sixteenOriginals, 'read-small:original']);
  }, 180_000);

  it('K2M-02 (b) a report of 0 input tokens is not a ratio: the 17th request still loses the earliest reads (memory)', async () => {
    const { world, scope } = await openMeterWorld('memory');

    const { requests } = await round(world, scope, readsThenAnswer(16, 0));

    expect(requests).toHaveLength(17);
    expect(readState(requests[16]!).map((entry) => entry.split(':')[0])).not.toContain('read-f1');
  }, 120_000);

  it('K2M-02 (c) a non-retryable provider_request_failed drops the ratio, so the round after it meters by bytes (memory)', async () => {
    const { world, scope } = await openMeterWorld('memory');
    const first = await round(world, scope, readsThenAnswer(16, 1_000));
    const failed = await round(world, scope, [{ kind: 'error', code: 'provider_request_failed', retryable: false }]);

    const after = await round(world, scope, [answer(1_000)]);

    expect([failed.secretary, after.secretary]).toEqual([first.secretary, first.secretary]);
    expect(failed.requests).toHaveLength(1);
    expect(readState(after.requests[0]!)[0]).toBe('read-f1:placeholder');
  }, 180_000);

  it('K2M-02 (d) a report far above the byte count never meters above the UTF-8 reservation: the 6th request keeps its five reads (memory)', async () => {
    const { world, scope } = await openMeterWorld('memory');

    const { requests } = await round(world, scope, readsThenAnswer(5, 4_000_000));

    expect(readState(requests[5]!)).toEqual(sixteenOriginals.slice(0, 5));
  }, 120_000);
});
