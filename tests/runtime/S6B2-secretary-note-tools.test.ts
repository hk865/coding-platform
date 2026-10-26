/**
 * Row 26: the one Query note admission value. The first section is the pure
 * table (constructed input in, literal expected value out; no store, port, Host
 * or Runtime). The second section drives the same value through real rounds:
 * the frozen manifest's tool list, the start's re-check, and the actual
 * `createNoteTools` config on the secretary, plain and copy paths.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import * as noteToolModule from '../../src/core/agent-runtime/note-tool.js';
import type { NoteToolsConfig, NoteToolsHandle } from '../../src/core/agent-runtime/note-tool.js';
import type { QueryNoteAdmissionV1 } from '../../src/core/work-graph/model/secretary-note-contracts.js';
import { secretaryNoteAdmission } from '../../src/core/work-graph/state/secretary-note.js';
import type { ReadResult } from '../../src/contracts/core/results.js';
import type { PreparedQueryExecution, PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import type { QueryJobRecord } from '../../src/core/work-graph/queries/contracts.js';
import * as factsModule from '../../src/core/work-graph/views/secretary-preparation-facts.js';
import * as toolGroupModule from '../../src/core/agent-runtime/tool-group-assembly.js';
import type { ToolCall, ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { readQuery } from '../helpers/A2-restart-fixture.js';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { holdS6BRequestRound } from '../helpers/S6B1-fixture.js';
import { holdS6BUnderstandingRound, seedS6BTwoProcessingRoots, seedS6BTooLongSecretary } from '../helpers/S6B2-fixture.js';
import { ensureProjectPointers, openS6AHostWorld, type S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { submitRound } from '../helpers/S6A-history-fixture.js';
import { claimWithSecretaryProfile } from '../helpers/request-claim-steps.js';
import {
  openS6ARequestWorld, S6A_GOAL_1, S6A_GOAL_2, S6A_SCOPE, type S6ARequestWorld,
} from '../helpers/S6A-request-fixture.js';

const ROOT: QueryJobRef = {
  aggregateType: 'QueryJob', projectId: 'project-1', workspaceId: 'workspace-1', queryJobId: 'query-job-1',
};
const GOAL_A: GoalRef = { aggregateType: 'Goal', projectId: 'project-1', goalId: 'goal-a' };
const GOAL_B: GoalRef = { aggregateType: 'Goal', projectId: 'project-1', goalId: 'goal-b' };

const SECRETARY_KINDS = [
  'convention', 'pitfall', 'tradeoff', 'open_question', 'preference', 'decision', 'understanding',
] as const;

type Case = {
  name: string;
  input: Parameters<typeof secretaryNoteAdmission>[0];
  expected: QueryNoteAdmissionV1;
};

const TABLE: readonly Case[] = [
  {
    name: 'admits a secretary request round with the six general kinds, understanding and its granted goals',
    input: { requestRoot: ROOT, effectiveGoalId: 'goal-a', grantedGoalIds: [GOAL_A, GOAL_B] },
    expected: {
      class: 'secretary', kinds: [...SECRETARY_KINDS], withdraw: true, grantedGoalIds: ['goal-a', 'goal-b'],
    },
  },
  {
    name: 'admits a no-goal secretary request round with the same kinds and no invented grants',
    input: { requestRoot: ROOT, effectiveGoalId: null, grantedGoalIds: [] },
    expected: { class: 'secretary', kinds: [...SECRETARY_KINDS], withdraw: true, grantedGoalIds: [] },
  },
  {
    name: 'gives a plain Query none, even when its facts carry a goal and a grant set',
    input: { requestRoot: null, effectiveGoalId: 'goal-a', grantedGoalIds: [GOAL_A] },
    expected: { class: 'none' },
  },
  {
    name: 'gives a copy none',
    input: { requestRoot: null, effectiveGoalId: null, grantedGoalIds: [] },
    expected: { class: 'none' },
  },
];

describe('secretaryNoteAdmission', () => {
  it.each(TABLE)('$name', ({ input, expected }) => {
    expect(secretaryNoteAdmission(input)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Part 2: the service rows on real rounds (memory backend)
// ---------------------------------------------------------------------------

type CapturedNoteTools = { configs: NoteToolsConfig[]; definitions: ToolDefinition[] };

/** A3 forwarding spy: the production call is the real one; the wrapper only records its config and definitions. */
function forwardNoteTools(captured: CapturedNoteTools) {
  const original = noteToolModule.createNoteTools;
  return vi.spyOn(noteToolModule, 'createNoteTools').mockImplementation((config: NoteToolsConfig): NoteToolsHandle => {
    captured.configs.push(config);
    const real = original(config);
    return {
      names: real.names,
      create(workspace) {
        const definitions = real.create(workspace);
        captured.definitions = definitions;
        return definitions;
      },
    };
  });
}

function capture(): CapturedNoteTools {
  return { configs: [], definitions: [] };
}

const worlds: S6AHostWorld[] = [];
const requestWorlds: S6ARequestWorld[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(worlds.splice(0).map(world => world.close()));
  await Promise.all(requestWorlds.splice(0).map(world => world.close()));
});

function readValue<T>(answer: unknown): T {
  const result = answer as ReadResult<T>;
  expect(result.status, JSON.stringify(answer)).toBe('ready');
  if (result.status !== 'ready') throw new Error(`not ready: ${JSON.stringify(answer)}`);
  return result.value;
}

describe('the Query note admission in a real round', () => {
  it('a secretary request round declares record_note with the admitted kinds and no review', async () => {
    const captured = capture();
    const spy = forwardNoteTools(captured);
    const world = await openS6AHostWorld({ backend: 'memory', secretaryTools: ['read', 'record_note'] });
    worlds.push(world);
    await ensureProjectPointers(world);
    let frozen: readonly string[] = [];
    const result = await holdS6BRequestRound(world, { label: 'note-tools', goalId: null }, async round => {
      // The preparation froze the declaration from the same admission the start
      // re-checks; reaching `use` means the start accepted the frozen list.
      frozen = round.manifest.promptSet.toolNames;
      expect(frozen).toContain('record_note');
      expect(round.manifest.request).not.toBeNull();
      expect(captured.configs).toHaveLength(1);
      const config = captured.configs[0];
      if (config === undefined) throw new Error('the secretary round built no note tool config');
      expect(config.kinds).toEqual([...SECRETARY_KINDS]);
      expect(config.kinds).not.toContain('repair');
      expect(config.withdraw).toBe(true);
      // The note tool received the Runtime's own query_run principal, never a
      // context built by the test or by the model.
      expect(config.context.principal).toMatchObject({
        kind: 'query_run', queryRunRef: round.query.run.ref,
      });
      // The command identity is derived from the QueryRun principal and the
      // Kernel call, so a replay of the same call gets the same id and another
      // call id gets another one; no model argument enters it.
      const call: ToolCall = {
        schemaVersion: 1, callId: 's6b-note-identity', name: 'record_note',
        arguments: { op: 'withdraw', noteId: 'note-1', expectedVersion: 1 },
      };
      const requestId = config.requestIdForCall(call);
      expect(requestId).toMatch(/^r5b-query-note:[0-9a-f]{64}$/);
      expect(config.requestIdForCall(call)).toBe(requestId);
      expect(config.requestIdForCall({ ...call, callId: 's6b-note-identity-2' })).not.toBe(requestId);
      const definition = captured.definitions.find(entry => entry.name === 'record_note');
      expect(definition).toBeDefined();
      if (definition === undefined) throw new Error('the secretary round built no record_note definition');
      // The real write schema, not only the factory config, excludes `repair`:
      // the secretary declaration never admits it.
      expect(definition.inputSchema.safeParse({
        op: 'write', kind: 'repair', topic: 't', conclusion: 'c',
        anchor: { kind: 'project' }, body: 'b',
      }).success).toBe(false);
      const refused = await definition.handler.execute({
        schemaVersion: 1, callId: 's6b-note-review', name: 'record_note',
        arguments: { op: 'review', noteId: 'note-1', expectedVersion: 1, verdict: 'review' },
      }, { signal: new AbortController().signal });
      expect(refused.status).toBe('error');
      if (refused.status === 'error') expect(refused.error.code).toBe('invalid_arguments');
    });
    spy.mockRestore();
    expect(result.started).toMatchObject({ status: 'ready' });
    expect(frozen).toContain('record_note');
  });

  it('a plain Query declares no record_note and builds no note tool', async () => {
    const captured = capture();
    const spy = forwardNoteTools(captured);
    const world = await openS6ARequestWorld({ backend: 'memory' });
    requestWorlds.push(world);
    const session = await world.createSecretary('plain-note-tools');
    const refs = await world.occupy(session);
    await world.finishQuery(refs);
    spy.mockRestore();

    const readPromptRecord = world.platform.runtime.readPromptRecord;
    expect(readPromptRecord).toBeDefined();
    if (readPromptRecord === undefined) return;
    const prompt = await readPromptRecord.call(world.platform.runtime, world.humanContext(), refs.queryRunRef);
    expect(prompt.status).toBe('ready');
    if (prompt.status !== 'ready') return;
    expect(prompt.value.set.toolNames).not.toContain('record_note');
    expect(captured.configs).toEqual([]);
    expect(captured.definitions).toEqual([]);

    const record = readValue<QueryJobRecord>((await world.post('queries/read', plain(S6A_SCOPE, refs.queryJobRef))).body);
    expect(record.run.run.status).toBe('answered');
  });

  it('a read-only copy declares no record_note and builds no note tool', async () => {
    const captured = capture();
    const spy = forwardNoteTools(captured);
    const world = await openS6AHostWorld({ backend: 'memory', secretaryTools: ['read', 'record_note'] });
    worlds.push(world);
    const source = await world.createSecretary('copy-source');
    const copied = await world.makeReadonlyCopy(source, 'note-copy');
    spy.mockRestore();

    const readPromptRecord = world.platform.runtime.readPromptRecord;
    expect(readPromptRecord).toBeDefined();
    if (readPromptRecord === undefined) return;
    const prompt = await readPromptRecord.call(world.platform.runtime, world.humanContext(), copied.query.queryRunRef);
    expect(prompt.status).toBe('ready');
    if (prompt.status !== 'ready') return;
    expect(prompt.value.set.toolNames).not.toContain('record_note');
    expect(captured.configs).toEqual([]);
    expect(captured.definitions).toEqual([]);
  });
});

/** A3 count wrapper over the real facts read; `state.fail` is the A2 fault at this one declared point. */
function factsReadPort() {
  const original = factsModule.createSecretaryPreparationFacts;
  const state = { reads: 0, fail: false };
  const spy = vi.spyOn(factsModule, 'createSecretaryPreparationFacts').mockImplementation((deps) => {
    const real = original(deps);
    return { async read(ctx, input) {
      state.reads += 1;
      if (state.fail) throw new Error('S6B2: the facts read failed (A2)');
      return real.read(ctx, input);
    } };
  });
  return { state, spy };
}

describe('the one facts read of a request round', () => {
  it('supplies two grants to the admission, declaration, manifest and start', async () => {
    const captured = capture();
    const spy = forwardNoteTools(captured);
    const admissions: QueryNoteAdmissionV1[] = [];
    const originalToolNames = toolGroupModule.finalToolNamesOf;
    const toolSpy = vi.spyOn(toolGroupModule, 'finalToolNamesOf')
      .mockImplementation((input) => { admissions.push(input.noteAdmission); return originalToolNames(input); });
    const world = await openS6AHostWorld({ backend: 'memory', secretaryTools: ['read', 'record_note'] });
    worlds.push(world);
    const seeded = await seedS6BTooLongSecretary(world, { windowTokens: 1_000_000, inputTokens: 500_000, label: 'grant-two' });
    const secretary = seeded.secretary;
    // Two goal roots the same secretary still owns: the real understanding command then grants exactly those two Goals.
    await seedS6BTwoProcessingRoots(world, { secretary, label: 'grant-two' });
    const round = await holdS6BUnderstandingRound(world, { secretary, goals: [S6A_GOAL_1, S6A_GOAL_2] });
    spy.mockRestore(); toolSpy.mockRestore();
    // The frozen manifest carries the two grants, the declaration keeps `understanding`, and the start restore
    // re-hands exactly the same admission (the round's start is the second entry).
    expect(round.manifest.request?.understandingGrants).toEqual([S6A_GOAL_1, S6A_GOAL_2]);
    expect(round.manifest.promptSet.toolNames).toContain('record_note');
    const granted = admissions.filter(entry => entry.class === 'secretary' && entry.grantedGoalIds.length === 2);
    expect(granted).toHaveLength(2);
    expect(granted[0]).toEqual({ class: 'secretary', kinds: [...SECRETARY_KINDS], withdraw: true,
      grantedGoalIds: [S6A_GOAL_1.goalId, S6A_GOAL_2.goalId] });
    expect(granted[1]).toEqual(granted[0]);
    expect(captured.configs.some(config => config.kinds.includes('understanding'))).toBe(true);
  });

  it('supplies the real empty grant set to the admission, declaration, manifest and start', async () => {
    const facts = factsReadPort();
    const admissions: QueryNoteAdmissionV1[] = [];
    const originalToolNames = toolGroupModule.finalToolNamesOf;
    const toolSpy = vi.spyOn(toolGroupModule, 'finalToolNamesOf')
      .mockImplementation((input) => { admissions.push(input.noteAdmission); return originalToolNames(input); });
    const world = await openS6AHostWorld({ backend: 'memory', secretaryTools: ['read', 'record_note'] });
    worlds.push(world);
    const secretary = await world.createSecretary('grant-round');
    const request = await submitRound(world, { commandId: 'grant-round', goalId: null, text: 'grants', recipient: secretary });
    expect(await claimWithSecretaryProfile(world, request.round, secretary, 'grant-claim')).toMatchObject({ status: 'committed' });
    const runRef = (await readQuery(world.ag2b, request.round)).run.ref;
    const prepared = readValue<PreparedQueryExecution>((await world.post('queries/prepare', plain(S6A_SCOPE, {
      queryRunRef: runRef, requestId: 'grant-prepare',
    }))).body);
    expect(facts.state.reads).toBe(1);
    const manifest = JSON.parse(readValue<{ body: string }>((await world.post('materials/open', plain(S6A_SCOPE, {
      ref: prepared.bundleRef, usage: 'historical_explanation',
    }))).body).body) as PreparedQueryManifestV1;
    expect(manifest.request?.understandingGrants).toEqual([]);
    expect(manifest.promptSet.toolNames).toContain('record_note');
    expect(admissions).toEqual([{ class: 'secretary', kinds: [...SECRETARY_KINDS], withdraw: true,
      grantedGoalIds: [] }]);
    await world.scripted.script(secretary, [{ kind: 'text', text: '{"schemaVersion":1,"body":"answer","ideas":[],"goalCardDrafts":[]}' }]);
    expect(await world.post('queries/start', plain(S6A_SCOPE, { prepared, consumerId: 'grant-consumer', requestId: 'grant-start' })))
      .toMatchObject({ body: { status: 'ready' } });
    expect(admissions[1]).toEqual(admissions[0]);
    expect(facts.state.reads).toBe(1);
  });

  it('a read failure is unavailable, never an empty grant set', async () => {
    const facts = factsReadPort();
    facts.state.fail = true;
    const toolSpy = vi.spyOn(toolGroupModule, 'finalToolNamesOf');
    const world = await openS6AHostWorld({ backend: 'memory', secretaryTools: ['read', 'record_note'] });
    worlds.push(world);
    const secretary = await world.createSecretary('facts-down');
    const request = await submitRound(world, { commandId: 'facts-down', goalId: null, text: 'down', recipient: secretary });
    expect(await claimWithSecretaryProfile(world, request.round, secretary, 'facts-down-claim')).toMatchObject({ status: 'committed' });
    const runRef = (await readQuery(world.ag2b, request.round)).run.ref;
    expect((await world.post('queries/prepare', plain(S6A_SCOPE, { queryRunRef: runRef, requestId: 'down-prepare' }))).body)
      .toMatchObject({ status: 'rejected', code: 'unavailable' });
    expect(toolSpy).not.toHaveBeenCalled();
  });
});
