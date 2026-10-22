/**
 * PC-1b group R, rulings 29 and 30 (the small public-path read).
 *
 * A Work and a Query execution each make one tool call and then the final
 * answer; `readPromptRecord` is read afresh afterwards. The joint step writes
 * the full PC-09; this file checks the read seam only, through the frozen
 * platform fixture's public steps.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import { createB2RuntimeFixture } from '../helpers/B2-runtime-fixture.js';
import { openPCQueryFixture, openPCWorkFixture, scriptedModel } from '../helpers/PC-platform-fixture.js';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const PER_RESPONSE = 321;

/**
 * The exact text set: every digest the frozen set and the request rows name.
 * The read must return every one, no more and no fewer, and each body must
 * still hash to the key it is filed under.
 */
function expectExactTexts(
  set: { templates: { ref: { digest: string } }[]; strings: { ref: { digest: string } };
    base: { ref: { digest: string } }; skills: { ref: { digest: string } }[] },
  requests: { toolSpecsRef: { digest: string } }[],
  texts: Record<string, string>,
): void {
  const referred = new Set<string>();
  for (const template of set.templates) referred.add(template.ref.digest);
  referred.add(set.strings.ref.digest);
  referred.add(set.base.ref.digest);
  for (const skill of set.skills) referred.add(skill.ref.digest);
  for (const request of requests) referred.add(request.toolSpecsRef.digest);
  expect(Object.keys(texts).sort()).toEqual([...referred].sort());
  for (const [digest, text] of Object.entries(texts)) expect(sha(text), `text keyed ${digest}`).toBe(digest);
}

describe('ruling 29: readPromptRecord returns a Work Run\'s set, requests and texts', () => {
  it('reads two Work permits in sequence order after one tool call and the final answer', async () => {
    const fixture = await openPCWorkFixture({
      model: scriptedModel([
        { toolCalls: [{ callId: 'pc-read-work-call', name: 'read', arguments: { path: 'wp2-read.txt' } }] },
        { text: 'PC read record: the Work final answer' },
      ]),
      budget: { perResponseTokens: PER_RESPONSE },
      selection: { modelId: 'pc-read-work-model', promptPack: 'platform', reasoningReplay: 'none' },
    });
    try {
      await fixture.work.prepare();
      const started = await fixture.work.start();
      expect(started.status, JSON.stringify(started)).toBe('ready');
      expect(fixture.model.calls()).toBe(2);

      const read = await fixture.work.readPromptRecord();
      expect(read.status, JSON.stringify(read)).toBe('ready');
      if (read.status !== 'ready') return;
      const { set, requests, texts } = read.value;

      expect(set).toMatchObject({
        modelId: 'pc-read-work-model', packId: 'platform', reasoningReplay: 'none',
      });
      expect(requests).toHaveLength(2);
      expect(requests.map(request => request.kind)).toEqual(['work', 'work']);
      expect(requests.map(request => (request.kind === 'work' ? request.maxOutputTokens : -1)))
        .toEqual([PER_RESPONSE, PER_RESPONSE]);
      // The permits come back in the order the model really received the requests.
      expect(requests.map(request => request.requestId))
        .toEqual(fixture.model.requests.map(request => request.requestId));
      expect(requests[1]!.toolSpecsRef).toEqual(requests[0]!.toolSpecsRef);
      expectExactTexts(set, requests, texts);
    } finally {
      await fixture.close();
    }
  }, 60_000);
});

describe('ruling 29: readPromptRecord returns a QueryRun\'s set, requests and texts', () => {
  it('reads two Query request rows in sequence order after one tool call and the final answer', async () => {
    const fixture = await openPCQueryFixture({
      model: scriptedModel([
        { toolCalls: [{ callId: 'pc-read-query-call', name: 'read', arguments: { path: 'src/module.ts' } }] },
        { text: 'PC read record: the Query final answer' },
      ]),
      budget: { perResponseTokens: PER_RESPONSE },
      selection: { modelId: 'pc-read-query-model', promptPack: 'platform', reasoningReplay: 'none' },
    });
    try {
      await fixture.prepare();
      const started = await fixture.start();
      expect(started.status, JSON.stringify(started)).toBe('ready');
      expect(fixture.model.calls()).toBe(2);

      const read = await fixture.readPromptRecord();
      expect(read.status, JSON.stringify(read)).toBe('ready');
      if (read.status !== 'ready') return;
      const { set, requests, texts } = read.value;

      expect(set).toMatchObject({
        modelId: 'pc-read-query-model', packId: 'platform', reasoningReplay: 'none',
      });
      expect(requests).toHaveLength(2);
      expect(requests.map(request => request.kind)).toEqual(['query', 'query']);
      expect(requests.map(request => (request.kind === 'query' ? request.reservedOutput : -1)))
        .toEqual([PER_RESPONSE, PER_RESPONSE]);
      // The Query row's output cap is the existing reserve; no Work cap is added.
      expect(requests.some(request => 'maxOutputTokens' in request)).toBe(false);
      expect(requests.map(request => request.requestId))
        .toEqual(fixture.model.requests.map(request => request.requestId));
      expect(requests[1]!.toolSpecsRef).toEqual(requests[0]!.toolSpecsRef);
      expectExactTexts(set, requests, texts);
    } finally {
      await fixture.close();
    }
  }, 60_000);
});

describe('ruling 30: a Work Runtime without modelRequestReads is unavailable', () => {
  it('rejects the read with unavailable and never returns an empty request list', async () => {
    const fixture = await createB2RuntimeFixture({ kind: 'memory' });
    try {
      // The B2 dependency bundle wires no model-request read port.
      expect(fixture.deps.modelRequestReads).toBeUndefined();
      const runtime = createAgentRuntime(fixture.deps);
      expect(runtime.port.readPromptRecord).toBeDefined();
      const read = await runtime.port.readPromptRecord!(fixture.ctx, fixture.claim.runRef);
      expect(read.status).toBe('rejected');
      if (read.status !== 'rejected') return;
      expect(read.code).toBe('unavailable');
      expect(read.reason).toBe('model request reads are not wired');
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it('validates the ref and answers a complete Work ref before any wiring exists', async () => {
    const runtime = createAgentRuntime();
    expect(runtime.port.readPromptRecord).toBeDefined();
    const ctx = { projectId: 'p', workspaceId: 'w',
      principal: { kind: 'host' as const, actor: { kind: 'human' as const, id: 'pc-no-deps' } },
      materialReader: { kind: 'host' as const, projectId: 'p', workspaceId: 'w',
        actor: { kind: 'human' as const, id: 'pc-no-deps' } },
      signal: new AbortController().signal };
    const runRef = { aggregateType: 'Run' as const, projectId: 'p', goalId: 'g', runId: 'r' };
    expect(await runtime.port.readPromptRecord!(ctx, { ...runRef, runId: '' }))
      .toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(await runtime.port.readPromptRecord!(ctx, runRef)).toEqual({
      status: 'rejected', code: 'unavailable', reason: 'model request reads are not wired',
    });
  }, 60_000);
});
