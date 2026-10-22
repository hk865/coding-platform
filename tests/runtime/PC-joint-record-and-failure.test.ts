/**
 * PC-1b joint step: R-12/J-05 (PC-09, ruling 24/28/29, §5.2 lines 691-700),
 * R-13's joint half (ruling 29), R-14 (ruling 27) and S-09 (PC-10, ruling 25,
 * §5.2 lines 701-702). Every world is opened and driven through the frozen
 * platform fixture's public prepare/start/read steps; the bases and the Skill
 * are literals, and the rebuilt systems are hand-written.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PROMPT_TOOL_SPECS_CONTENT_TYPE } from '../../src/contracts/prompts/prompt-set.js';
import {
  openPCQueryFixture, openPCWorkFixture, scriptedModel,
} from '../helpers/PC-platform-fixture.js';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const PER_RESPONSE = 321;
const ZERO_REMOVALS = {
  memory: 0, skillReference: 0, additionalInstruction: 0, toolResultBody: 0,
  historyExchange: 0, historyConclusion: 0, currentExchange: 0,
};
const WORK_BASE = 'PC_RECORD_WORK_BASE';
const QUERY_BASE = 'PC_RECORD_QUERY_BASE';
const SKILL = 'PC_CUSTOM_SKILL_V1';
const SKILL_SOURCE = `skill:pc-custom@sha256:${sha(SKILL)}`;
const TEMPLATE_IDS = {
  work: ['work-input', 'base'],
  query: ['initial-planning-answer', 'query-planning-input', 'base'],
} as const;

function section(kind: string, id: string, source: string, content: string): string {
  return `[${kind} id=${JSON.stringify(id)} source=${JSON.stringify(source)}]\n${content}`;
}

/** The literal context-builder.js ~20 shape: base, then the instruction Skill. */
function rebuildSystem(base: string): string {
  return base + '\n\n' + section('skill_instruction', 'pc-custom', SKILL_SOURCE, SKILL);
}

/** One frozen record read, checked against hand-written literals. */
function expectRecord(
  read: Awaited<ReturnType<Awaited<ReturnType<typeof openPCWorkFixture>>['work']['readPromptRecord']>>,
  kind: 'work' | 'query',
  base: string,
  modelRequests: readonly { requestId: string; systemPrompt: string; tools: readonly unknown[] }[],
): void {
  expect(read.status, JSON.stringify(read)).toBe('ready');
  if (read.status !== 'ready') return;
  const { set, requests, texts } = read.value;
  const expectedSystem = rebuildSystem(base);
  expect(set.base.digest).toBe(sha(base));
  expect(texts[set.base.digest]).toBe(base);
  expect(set.templates.map(template => template.id)).toEqual(TEMPLATE_IDS[kind]);
  expect(set.skills).toHaveLength(1);
  expect(set.skills[0]).toMatchObject({ id: 'pc-custom', kind: 'instruction', priority: 10,
    source: SKILL_SOURCE, digest: sha(SKILL) });
  expect(texts[set.skills[0]!.digest]).toBe(SKILL);

  // R-13: the set and every request refer to exactly this text key set.
  const referred = [...new Set([
    ...set.templates.map(template => template.digest),
    set.strings.digest,
    set.base.digest,
    ...set.skills.map(skill => skill.digest),
    ...requests.map(request => request.toolSpecsRef.digest),
  ])].sort();
  expect(Object.keys(texts).sort()).toEqual(referred);
  for (const [digest, text] of Object.entries(texts)) expect(sha(text), digest).toBe(digest);

  // R-12/J-05: each request's tools JSON, its body, `toolsDigest` and the ref agree.
  expect(requests.map(request => request.requestId)).toEqual(modelRequests.map(request => request.requestId));
  expect(requests).toHaveLength(modelRequests.length);
  for (const [index, request] of requests.entries()) {
    const sent = modelRequests[index]!;
    const toolsJson = JSON.stringify(sent.tools);
    expect(request.toolSpecsRef.contentType).toBe(PROMPT_TOOL_SPECS_CONTENT_TYPE);
    expect(request.toolsDigest).toBe(sha(toolsJson));
    expect(request.toolSpecsRef.digest).toBe(sha(toolsJson));
    expect(request.toolSpecsRef.sizeBytes).toBe(Buffer.byteLength(toolsJson, 'utf8'));
    expect(texts[request.toolSpecsRef.digest]).toBe(toolsJson);
    expect(request.selection.removed).toEqual(ZERO_REMOVALS);
    // Every request's system digest is the hand-rebuilt literal system.
    expect(request.systemDigest).toBe(sha(expectedSystem));
    expect(sent.systemPrompt).toBe(expectedSystem);
  }
  expect(requests[1]!.toolSpecsRef).toEqual(requests[0]!.toolSpecsRef);
}

describe('PC-09: a Work and a Query execution record two frozen requests', () => {
  it('records sequence, tools, texts, a hand-rebuilt system and idempotent replays', async () => {
    const work = await openPCWorkFixture({
      model: scriptedModel([
        { toolCalls: [{ callId: 'pc-joint-work-call', name: 'read', arguments: { path: 'wp2-read.txt' } }] },
        { text: 'PC joint Work final answer' },
      ]),
      budget: { perResponseTokens: PER_RESPONSE },
      systemInstruction: null,
      selection: { modelId: 'pc-joint-work-model', promptPack: 'platform', reasoningReplay: 'none' },
    });
    try {
      work.packs.change({ base: WORK_BASE });
      await work.work.prepare();
      expect((await work.work.start()).status).toBe('ready');
      expect(work.model.calls()).toBe(2);

      const read = await work.work.readPromptRecord();
      expectRecord(read, 'work', WORK_BASE, work.model.requests);
      if (read.status !== 'ready') return;
      expect(read.value.requests.map(request => request.kind)).toEqual(['work', 'work']);
      expect(read.value.requests.map(request => request.kind === 'work' ? request.maxOutputTokens : -1))
        .toEqual([PER_RESPONSE, PER_RESPONSE]);

      // Replaying the captured Work authorization with one changed fact.
      const authorization = work.commands.authorization.calls[0]!;
      const replay = await authorization.replay(command => {
        command.input.prompt.maxOutputTokens += 1;
      });
      expect(replay.status).toBe('rejected');
      if (replay.status === 'rejected') expect(replay.code).toBe('idempotency_conflict');
    } finally {
      await work.close();
    }
  }, 60_000);

  it('records a Query reservation and conflicts on changed prompt and usage facts', async () => {
    const query = await openPCQueryFixture({
      model: scriptedModel([
        { toolCalls: [{ callId: 'pc-joint-query-call', name: 'read', arguments: { path: 'src/module.ts' } }] },
        { text: 'PC joint Query final answer' },
      ]),
      budget: { perResponseTokens: PER_RESPONSE },
      systemInstruction: null,
      selection: { modelId: 'pc-joint-query-model', promptPack: 'platform', reasoningReplay: 'none' },
    });
    try {
      query.packs.change({ base: QUERY_BASE });
      await query.prepare();
      expect((await query.start()).status).toBe('ready');
      expect(query.model.calls()).toBe(2);

      const read = await query.readPromptRecord();
      expectRecord(read, 'query', QUERY_BASE, query.model.requests);
      if (read.status !== 'ready') return;
      expect(read.value.requests.map(request => request.kind)).toEqual(['query', 'query']);
      expect(read.value.requests.map(request => request.kind === 'query' ? request.reservedOutput : -1))
        .toEqual([PER_RESPONSE, PER_RESPONSE]);

      // R-14: replay the CAPTURED reservation command with only one new prompt fact changed.
      const reservation = query.commands.reservations[0]!;
      const promptReplay = await reservation.replay(command => {
        command.input.entries[0]!.prompt.systemDigest = 'f'.repeat(64);
      });
      expect(promptReplay.status).toBe('rejected');
      if (promptReplay.status === 'rejected') expect(promptReplay.code).toBe('idempotency_conflict');

      const usageReplay = await reservation.replay(command => {
        command.input.entries[0]!.reservedOutput += 1;
      });
      expect(usageReplay.status).toBe('rejected');
      if (usageReplay.status === 'rejected') expect(usageReplay.code).toBe('idempotency_conflict');
    } finally {
      await query.close();
    }
  }, 60_000);
});

describe('PC-10: a failed tool-spec body put makes Work and Query unavailable', () => {
  it('fails Work start after successful preparation, with no authorization, reservation or record', async () => {
    const fixture = await openPCWorkFixture({
      model: scriptedModel([{ text: 'PC must not answer' }]),
      failPutContentType: PROMPT_TOOL_SPECS_CONTENT_TYPE,
    });
    try {
      await expect(fixture.work.prepare()).resolves.toBeDefined();
      const started = await fixture.work.start();
      expect(started.status).toBe('rejected');
      if (started.status === 'rejected') expect(started.code).toBe('unavailable');
      expect(fixture.model.calls()).toBe(0);
      expect(fixture.commands.authorization.calls).toHaveLength(0);
      expect(fixture.commands.usage?.calls ?? []).toHaveLength(0);
      expect(fixture.commands.admission?.calls ?? []).toHaveLength(0);
      expect(fixture.commands.reservations).toHaveLength(0);
      const read = await fixture.work.readPromptRecord();
      expect(read.status, JSON.stringify(read)).toBe('ready');
      if (read.status === 'ready') expect(read.value.requests).toEqual([]);
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it('fails Query start after successful preparation, with no authorization, reservation, admission or record', async () => {
    const fixture = await openPCQueryFixture({
      model: scriptedModel([{ text: 'PC must not answer' }]),
      failPutContentType: PROMPT_TOOL_SPECS_CONTENT_TYPE,
    });
    try {
      await expect(fixture.prepare()).resolves.toBeDefined();
      const started = await fixture.start();
      expect(started.status).toBe('rejected');
      if (started.status === 'rejected') expect(started.code).toBe('unavailable');
      expect(fixture.model.calls()).toBe(0);
      expect(fixture.commands.authorization.calls).toHaveLength(0);
      expect(fixture.commands.usage?.calls ?? []).toHaveLength(0);
      expect(fixture.commands.admission?.calls ?? []).toHaveLength(0);
      expect(fixture.commands.reservations).toHaveLength(0);
      const read = await fixture.readPromptRecord();
      expect(read.status, JSON.stringify(read)).toBe('ready');
      if (read.status === 'ready') expect(read.value.requests).toEqual([]);
    } finally {
      await fixture.close();
    }
  }, 60_000);
});
