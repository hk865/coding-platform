/**
 * PC-1b ruling 27: a Query request record's immutable prompt facts.
 *
 * Every state below is reached through the real owners the Runtime uses:
 * `submitQueryJob` -> `claimQuery` -> the production Query preparation ->
 * `beginQueryEntry`, then the WorkGraph `recordQueryUsage` /
 * `admitQueryModelRequest` calls. No record is written by hand. The prompt
 * facts are the send layer's input (the exact facts `beforeCall` computes).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withBackendOrderedLookup } from '../helpers/ordered-lookup-forward.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { PreparedQueryExecution } from '../../src/contracts/core/prepared-execution.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { QueryRequestPromptFactsV1 } from '../../src/contracts/prompts/prompt-set.js';
import type { PromptPackSourcePort } from '../../src/contracts/prompts/prompt-pack.js';
import type { QueryJobRef, QueryRunRef, QueryRunSnapshot } from '../../src/contracts/query-job.js';
import type { RuntimeBudget } from '../../src/contracts/runtime-budget.js';
import type { RawArtifactStorePort } from '../../src/core/record-store/body-ports.js';
import type { QueryEntryIdentity, QueryExecutionPort } from '../../src/core/work-graph/queries/contracts.js';
import { createQueryExecution } from '../../src/core/work-graph/queries/query-execution.js';
import { QUERY_JOB_RECORD_SCHEMAS } from '../../src/core/work-graph/queries/query-record-codecs.js';
import { createQueryJobService } from '../../src/core/work-graph/queries/query-job-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createGoalService } from '../../src/core/work-graph/tasks/task-service.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { plainSessionRefToAggregate } from '../../src/core/work-graph/sessions/session-record-codecs.js';
import { createContextAssembler, type ContextAssemblerDependencies } from '../../src/core/agent-runtime/context-assembler.js';
import {
  createQueryPreparation, type QueryPreparationDependencies,
} from '../../src/core/agent-runtime/query-preparation.js';
import { createPlatformPromptPackSource } from '../../src/contracts/prompts/prompt-pack.js';
import { QUERY_MANIFEST_CONTENT_TYPE } from '../../src/contracts/no-progress.js';
import { createAgentRuntime } from '../../src/core/agent-runtime/runtime.js';
import { createB2ExecutionFixture, type B2ExecutionFixture } from '../helpers/B2-execution-fixture.js';
import { createB2RuntimeFixture } from '../helpers/B2-runtime-fixture.js';
import { committed, pin, ready } from '../helpers/S5-queue-support.js';
import { preparationHost } from '../helpers/task-claim-fixture.js';

const AT = '2026-10-08T00:00:00.000Z';
const BUDGET: RuntimeBudget = { contextWindowTokens: 128000, inputTokens: null, outputTokens: null,
  maxRequests: 4, maxToolCalls: 8, timeoutMs: null, perResponseTokens: 512 };
const CONFIGURATION_REVISION = 'pc-query-record-host@1';
const HOST_TEMPLATE = { templateId: 'builder', revision: '1', digest: sha256Hex('PC query record instructions') };

type HostConfiguration = {
  configurationRevision: string;
  permissions: { tools: string[]; writeScope: [] };
  hostTemplate: typeof HOST_TEMPLATE;
  budget: RuntimeBudget;
};

type QueryRecordWorld = {
  b2: B2ExecutionFixture;
  execution: QueryExecutionPort;
  promptPacks: PromptPackSourcePort;
  goalRef: GoalRef;
  configuration: HostConfiguration;
  now(): string;
  eventId(): string;
  newId(): string;
};

function hostConfiguration(): HostConfiguration {
  return {
    configurationRevision: CONFIGURATION_REVISION,
    permissions: { tools: ['read'], writeScope: [] },
    hostTemplate: HOST_TEMPLATE,
    budget: { ...BUDGET },
  };
}

/** The send layer's facts: literal values (nothing in the record owner derives them). */
function promptFacts(systemText = 'PC query system text'): QueryRequestPromptFactsV1 {
  return {
    systemDigest: sha256Hex(systemText),
    toolsDigest: sha256Hex('[{"name":"read"}]'),
    toolSpecsRef: {
      kind: 'artifact',
      contentType: 'application/vnd.coding-platform.prompt-tool-specs+json;version=1',
      digest: sha256Hex('[{"name":"read"}]'),
      sizeBytes: Buffer.byteLength('[{"name":"read"}]', 'utf8'),
      source: { kind: 'artifact', refId: 'pc-query-tool-specs', revision: '1' },
    },
    selection: {
      inputTokens: 120,
      budget: 2000,
      removed: {
        memory: 0, skillReference: 0, additionalInstruction: 0, toolResultBody: 0,
        historyExchange: 0, historyConclusion: 0, currentExchange: 0,
      },
    },
  };
}

function reservationRow(prompt: QueryRequestPromptFactsV1) {
  return {
    requestId: 'pc-query-model-request-1',
    requestDigest: sha256Hex('PC query model request 1'),
    reservedInput: 120,
    reservedOutput: 64,
    inputTokens: null,
    outputTokens: null,
    cachedInputTokens: null,
    usageStatus: 'reserved' as const,
    prompt,
  };
}

/** Every immutable prompt fact changed alone, with a hand-picked legal value. */
type PromptChange = { label: string; change: (prompt: QueryRequestPromptFactsV1) => QueryRequestPromptFactsV1 };
function promptChanges(): PromptChange[] {
  const change = (label: string, mutate: (prompt: QueryRequestPromptFactsV1) => void): PromptChange => ({
    label,
    change: (prompt) => { const copy = structuredClone(prompt); mutate(copy); return copy; },
  });
  const removedKeys = Object.keys(promptFacts().selection.removed) as (keyof QueryRequestPromptFactsV1['selection']['removed'])[];
  return [
    change('systemDigest', prompt => { prompt.systemDigest = sha256Hex('PC query changed system text'); }),
    change('toolsDigest', prompt => { prompt.toolsDigest = sha256Hex('PC query changed tools'); }),
    change('toolSpecsRef.contentType', prompt => {
      prompt.toolSpecsRef.contentType = 'application/vnd.coding-platform.prompt-tool-specs+json;version=2';
    }),
    change('toolSpecsRef.digest', prompt => { prompt.toolSpecsRef.digest = sha256Hex('PC query changed tool specs'); }),
    change('toolSpecsRef.sizeBytes', prompt => { prompt.toolSpecsRef.sizeBytes += 1; }),
    change('toolSpecsRef.source.kind', prompt => { prompt.toolSpecsRef.source.kind = 'workspace'; }),
    change('toolSpecsRef.source.refId', prompt => { prompt.toolSpecsRef.source.refId = 'pc-query-changed-specs'; }),
    change('toolSpecsRef.source.revision', prompt => { prompt.toolSpecsRef.source.revision = '2'; }),
    change('toolSpecsRef.source.digest', prompt => {
      prompt.toolSpecsRef.source.digest = sha256Hex('PC query changed source');
    }),
    change('selection.inputTokens', prompt => { prompt.selection.inputTokens += 1; }),
    change('selection.budget', prompt => { prompt.selection.budget += 1; }),
    ...removedKeys.map((key): PromptChange => change(`selection.removed.${key}`, prompt => {
      prompt.selection.removed[key] += 1;
    })),
  ];
}

function requestsOf(run: QueryRunSnapshot) {
  const requests = run.run.executionState?.requests;
  if (requests === undefined) throw new Error('the QueryRun has no persisted requests');
  return requests;
}

/**
 * Fault injection: the real body store accepts every put, but the prepared
 * Query manifest loses or corrupts its `promptSet` on the way in. The manifest
 * and its content-addressed ref are still produced by the production writer.
 */
function brokenPromptSetBodies(bodies: RawArtifactStorePort, how: 'missing' | 'broken'): RawArtifactStorePort {
  return {
    read: ref => bodies.read(ref),
    async put(input) {
      if (input.contentType !== QUERY_MANIFEST_CONTENT_TYPE) return bodies.put(input);
      const manifest = JSON.parse(input.body) as Record<string, unknown>;
      if (how === 'missing') delete manifest['promptSet'];
      else manifest['promptSet'] = { ...(manifest['promptSet'] as Record<string, unknown>), schemaVersion: 2 };
      return bodies.put({ ...input, body: JSON.stringify(manifest) });
    },
  };
}

/**
 * Fault injection for R-04: the base ref is rewritten to the first template's
 * digest and size but another content type. Every stored body is genuine; only
 * the manifest's reference differs, so the first read may populate a cache entry
 * that a later ref must not reuse.
 */
function aliasedRefBodies(bodies: RawArtifactStorePort): RawArtifactStorePort {
  return {
    read: ref => bodies.read(ref),
    async put(input) {
      if (input.contentType !== QUERY_MANIFEST_CONTENT_TYPE) return bodies.put(input);
      const manifest = JSON.parse(input.body) as { promptSet: {
        templates: { ref: { digest: string; sizeBytes: number } }[]; base: { ref: Record<string, unknown> };
      } };
      const template = manifest.promptSet.templates[0];
      if (template === undefined) throw new Error('PC: the frozen set has no template to alias');
      manifest.promptSet.base.ref = { ...manifest.promptSet.base.ref,
        digest: template.ref.digest, sizeBytes: template.ref.sizeBytes,
        contentType: 'application/vnd.coding-platform.other;version=1' };
      return bodies.put({ ...input, body: JSON.stringify(manifest) });
    },
  };
}

let world: QueryRecordWorld;

beforeAll(async () => {
  // The B2 fixture supplies the real records/body/Session owners but performs
  // no Work preparation, so this Query-only row is independent of the prompt
  // pack wiring in the Work preparation path.
  const b2 = await createB2ExecutionFixture('memory', QUERY_JOB_RECORD_SCHEMAS);
  const records = b2.base.records;
  const bodies: RawArtifactStorePort = b2.bodies;
  let sequence = 0;
  const now = (): string => AT;
  const eventId = (): string => `pc-qr-event-${++sequence}`;
  const newId = (): string => `pc-qr-id-${++sequence}`;
  const configuration = hostConfiguration();
  const execution = createQueryExecution({
    records: withBackendOrderedLookup(records, records),
    roles: createRoleConfigurationService({ records, now, eventId }),
    bodies,
    authorizeConfiguration: async () => ({ status: 'ready', value: {
      ...configuration, permissions: { tools: ['read'], writeScope: [] } } }),
    now,
    eventId,
  });
  const goalRef: GoalRef = { aggregateType: 'Goal', projectId: b2.base.scope.projectId, goalId: 'PC-QR-D' };
  const goals = createGoalService({ records, now, eventId }).tasks;
  committed(await goals.createGoal(b2.base.ctx, {
    input: { goalId: goalRef.goalId, workspace: b2.base.scope, objective: 'Answer one PC Query record question' },
    meta: { requestId: 'pc-qr-goal', expected: [
      await pin(records, b2.base.projectRef), await pin(records, b2.base.workspaceRef),
    ] },
  }));
  world = {
    b2, execution, promptPacks: createPlatformPromptPackSource(), goalRef, configuration,
    now, eventId, newId,
  };
});

afterAll(async () => { await world?.b2.close(); });

/**
 * The production Query preparation over the fixture's real owners. It mirrors
 * `prepareQueryForReal` only because that shared helper cannot accept the
 * required `promptPacks` dependency (ruling 14); the production owner does all
 * rendering, storing, binding and manifest writing.
 */
async function prepareQuery(
  queryRunRef: QueryRunRef, requestId: string, bodies: RawArtifactStorePort = world.b2.bodies,
) {
  const { b2, execution, promptPacks, configuration, now, eventId, newId } = world;
  const records = b2.base.records;
  const executions = createRunStateReader({ records, bodies });
  const roles = createRoleConfigurationService({ records, now, eventId });
  const materials = createMaterialService({ bodies, authority: createMaterialRecordReaders(records).authority, now });
  const assembler = createContextAssembler({ executions, roles, materials, bodies, now } as ContextAssemblerDependencies);
  const preparation = createQueryPreparation({
    executions, roles, bodies, host: preparationHost({
      configurationRevision: configuration.configurationRevision,
      permissions: configuration.permissions,
      hostTemplate: configuration.hostTemplate,
      budget: configuration.budget,
    }), now, newId, queryExecution: execution, promptPacks,
  } as unknown as QueryPreparationDependencies, assembler);
  return preparation.prepare(b2.base.ctx, { queryRunRef, requestId });
}

/** The public submit + claim half, before any preparation. */
async function claimQueryRun(suffix: string): Promise<{ queryJobRef: QueryJobRef; queryRunRef: QueryRunRef }> {
  const { b2, execution, goalRef, now, eventId } = world;
  const records = b2.base.records;
  const ctx = b2.base.ctx;
  const queryJobRef: QueryJobRef = { aggregateType: 'QueryJob', ...b2.base.scope, queryJobId: `PC-QR-${suffix}` };
  const queryRunRef: QueryRunRef = { aggregateType: 'QueryRun', ...b2.base.scope,
    queryJobId: queryJobRef.queryJobId, runId: `PC-QR-run-${suffix}` };
  const jobs = createQueryJobService({ records, execution, now, eventId });
  const submitted = committed(await jobs.submitQueryJob(ctx, {
    input: {
      queryJobId: queryJobRef.queryJobId,
      runId: queryRunRef.runId,
      intent: {
        schemaVersion: 1, intentId: queryJobRef.queryJobId, ...b2.base.scope, goalId: goalRef.goalId,
        question: `Which PC Query record fact applies to ${suffix}?`, focusTaskRefs: [],
        budget: { maxTokens: null, deadline: null }, multiTurn: { maxRounds: 1 }, correlationId: `PC-QR-${suffix}`,
        execution: { kind: 'initial_coordination', roleBinding: b2.base.roleBinding, runtimeBudget: BUDGET },
      },
    },
    meta: { requestId: `PC-QR-submit-${suffix}`, expected: [
      await pin(records, b2.base.projectRef), await pin(records, b2.base.workspaceRef),
      await pin(records, goalRef), { ref: queryJobRef, revision: 0 }, { ref: queryRunRef, revision: 0 },
    ] },
  }));
  const sessionRef = await b2.base.createSession(`pc-qr-${suffix}`);
  const claimed = committed(await jobs.claimQuery(ctx, {
    input: { queryRunRef, sessionRef },
    meta: { requestId: `PC-QR-claim-${suffix}`, expected: [
      { ref: queryJobRef, revision: submitted.job.revision }, { ref: queryRunRef, revision: submitted.run.revision },
      await pin(records, plainSessionRefToAggregate(sessionRef)),
    ] },
  }));
  if (claimed.session.ref.sessionId !== sessionRef.sessionId) throw new Error('the Query claim moved the Session');
  return { queryJobRef, queryRunRef };
}

/** One claimed -> prepared -> entered QueryRun through the public owners. */
async function createQueryRun(suffix: string): Promise<{
  queryJobRef: QueryJobRef;
  queryRunRef: QueryRunRef;
  entry: QueryEntryIdentity;
  prepared: PreparedQueryExecution;
}> {
  const { b2, execution } = world;
  const ctx = b2.base.ctx;
  const { queryJobRef, queryRunRef } = await claimQueryRun(suffix);
  const result = await prepareQuery(queryRunRef, `PC-QR-prepare-${suffix}`);
  if (result.status !== 'ready') throw new Error(`PC Query preparation failed: ${JSON.stringify(result)}`);
  const prepared = result.value;
  const preparedState = ready(await execution.readQueryExecution(ctx, queryRunRef));
  const kernel = { adapterId: preparedState.session.kernel.adapterId,
    kernelSessionId: preparedState.session.kernel.kernelSessionId,
    runId: `PC-QR-kernel-${suffix}`, turnId: `PC-QR-turn-${suffix}` };
  const ticket = committed(await execution.beginQueryEntry(ctx, {
    input: { prepared, consumerId: `PC-QR-consumer-${suffix}`, kernel },
    meta: { requestId: `PC-QR-begin-${suffix}`, expected: [
      { ref: queryJobRef, revision: preparedState.job.revision },
      { ref: queryRunRef, revision: preparedState.run.revision },
      { ref: preparedState.session.ref, revision: preparedState.session.revision },
    ] },
  }));
  return {
    queryJobRef, queryRunRef, prepared,
    entry: { queryRunRef, sessionRef: ticket.sessionRef, sessionGeneration: ticket.sessionGeneration,
      entryGeneration: ticket.entryGeneration, consumerId: ticket.consumerId, kernel: ticket.kernel },
  };
}

async function reserve(
  query: Awaited<ReturnType<typeof createQueryRun>>,
  prompt: QueryRequestPromptFactsV1,
) {
  const { b2, execution } = world;
  const current = ready(await execution.readQueryExecution(b2.base.ctx, query.queryRunRef)).run;
  return execution.recordQueryUsage(b2.base.ctx, {
    input: { entry: query.entry, entries: [reservationRow(prompt)] },
    meta: { requestId: `PC-QR-usage-reserve-${query.queryRunRef.runId}`,
      expected: [{ ref: query.queryRunRef, revision: current.revision }] },
  });
}

async function admit(
  query: Awaited<ReturnType<typeof createQueryRun>>,
  prompt: QueryRequestPromptFactsV1,
  label = '',
  requestDigest = reservationRow(prompt).requestDigest,
) {
  const { b2, execution } = world;
  const current = ready(await execution.readQueryExecution(b2.base.ctx, query.queryRunRef));
  const state = current.run.run.executionState;
  if (state?.prepared === null || state?.prepared === undefined) throw new Error('the QueryRun has no prepared binding');
  return execution.admitQueryModelRequest(b2.base.ctx, {
    input: {
      entry: query.entry,
      requestId: reservationRow(prompt).requestId,
      requestDigest,
      contextInputDigest: state.prepared.inputDigest,
      manifestDigest: state.prepared.bundleRef.digest,
      prompt,
    },
    meta: { requestId: `PC-QR-admit-${query.queryRunRef.runId}${label}`,
      expected: [{ ref: query.queryRunRef, revision: current.run.revision }] },
  });
}

describe('Query request prompt facts (ruling 27)', () => {
  it('writes the whole prompt facts on the reservation with admitted false', async () => {
    const query = await createQueryRun('reservation');
    const prompt = promptFacts();
    const written = await reserve(query, prompt);
    expect(written).toMatchObject({ status: 'committed', replayed: false });
    if (written.status !== 'committed') throw new Error(JSON.stringify(written));
    const expected = { ...reservationRow(prompt), admitted: false };
    expect(requestsOf(written.value)).toEqual([expected]);
    const read = ready(await world.execution.readQueryExecution(world.b2.base.ctx, query.queryRunRef));
    expect(read.run.run.executionState?.requests).toEqual([expected]);
  });

  it.each(['missing', 'broken'] as const)(
    'rejects a prepared manifest whose promptSet is %s at bind and does not move the QueryRun', async how => {
      const { queryRunRef } = await claimQueryRun(`prompt-set-${how}`);
      const ctx = world.b2.base.ctx;
      const before = ready(await world.execution.readQueryExecution(ctx, queryRunRef)).run;
      const result = await prepareQuery(queryRunRef, `PC-QR-prepare-prompt-set-${how}`,
        brokenPromptSetBodies(world.b2.bodies, how));
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
      const after = ready(await world.execution.readQueryExecution(ctx, queryRunRef));
      expect(after.run.revision).toBe(before.revision);
      expect(after.run.run.executionState).toMatchObject({ phase: 'claimed', prepared: null, requests: [] });
    });

  it('rejects a later text ref with the same digest and size but another content type', async () => {
    const { queryRunRef } = await claimQueryRun('ref-type');
    const prepared = await prepareQuery(queryRunRef, 'PC-QR-prepare-ref-type',
      aliasedRefBodies(world.b2.bodies));
    expect(prepared.status, JSON.stringify(prepared)).toBe('ready');
    // The Runtime read uses the Query execution and the same real body store;
    // only the dependency bundle is borrowed from a throwaway B2 fixture (the
    // read path itself never touches its records).
    const host = await createB2RuntimeFixture({ kind: 'memory' });
    try {
      const runtime = createAgentRuntime({ ...host.deps, bodies: world.b2.bodies,
        queryExecution: world.execution });
      const read = await runtime.port.readPromptRecord!(world.b2.base.ctx, queryRunRef);
      expect(read).toMatchObject({ status: 'rejected', code: 'invalid' });
    } finally {
      await host.close();
    }
  });

  it('compares the prompt facts at admission and only flips admitted to true', async () => {
    const query = await createQueryRun('admission');
    const prompt = promptFacts();
    committed(await reserve(query, prompt));
    const before = ready(await world.execution.readQueryExecution(world.b2.base.ctx, query.queryRunRef)).run;
    expect(requestsOf(before)).toEqual([{ ...reservationRow(prompt), admitted: false }]);
    const admitted = await admit(query, prompt);
    expect(admitted).toMatchObject({ status: 'committed', replayed: false });
    if (admitted.status !== 'committed') throw new Error(JSON.stringify(admitted));
    expect(requestsOf(admitted.value)).toEqual([{ ...reservationRow(prompt), admitted: true }]);
  });

  it('refuses each admission prompt fact changed alone, while requestDigest stays invalid', async () => {
    const query = await createQueryRun('admission-conflict');
    const prompt = promptFacts();
    committed(await reserve(query, prompt));
    const before = ready(await world.execution.readQueryExecution(world.b2.base.ctx, query.queryRunRef)).run;
    for (const { label, change } of promptChanges()) {
      const refused = await admit(query, change(prompt), `-${label}`);
      expect(refused, label).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    }
    // Ruling 27/R-03: the reservation's requestDigest check keeps its own
    // pre-existing `invalid` outcome, not `idempotency_conflict`.
    const digestRefused = await admit(query, prompt, '-request-digest',
      sha256Hex('PC query changed model request 1'));
    expect(digestRefused).toMatchObject({ status: 'rejected', code: 'invalid' });
    const after = ready(await world.execution.readQueryExecution(world.b2.base.ctx, query.queryRunRef));
    expect(after.run.revision).toBe(before.revision);
    expect(after.run.run.executionState?.requests).toEqual([{ ...reservationRow(prompt), admitted: false }]);
  });

  it('keeps the immutable facts on a later usage write and changes only the usage fields', async () => {
    const query = await createQueryRun('later-usage');
    const prompt = promptFacts();
    committed(await reserve(query, prompt));
    committed(await admit(query, prompt));
    const current = ready(await world.execution.readQueryExecution(world.b2.base.ctx, query.queryRunRef)).run;
    const later = { ...reservationRow(prompt),
      inputTokens: 100, outputTokens: 25, cachedInputTokens: 5, usageStatus: 'reported' as const };
    const written = await world.execution.recordQueryUsage(world.b2.base.ctx, {
      input: { entry: query.entry, entries: [later] },
      meta: { requestId: `PC-QR-usage-later-${query.queryRunRef.runId}`,
        expected: [{ ref: query.queryRunRef, revision: current.revision }] },
    });
    expect(written).toMatchObject({ status: 'committed', replayed: false });
    if (written.status !== 'committed') throw new Error(JSON.stringify(written));
    expect(requestsOf(written.value)).toEqual([{
      ...reservationRow(prompt), admitted: true,
      inputTokens: 100, outputTokens: 25, cachedInputTokens: 5, usageStatus: 'reported',
    }]);
  });

  it('answers idempotency_conflict for each immutable usage fact changed alone and keeps the row', async () => {
    const query = await createQueryRun('immutable-usage');
    const prompt = promptFacts();
    committed(await reserve(query, prompt));
    const current = ready(await world.execution.readQueryExecution(world.b2.base.ctx, query.queryRunRef)).run;
    const rows: [string, ReturnType<typeof reservationRow>][] = [
      ['requestDigest', { ...reservationRow(prompt), requestDigest: sha256Hex('PC query changed model request 1') }],
      ['reservedInput', { ...reservationRow(prompt), reservedInput: reservationRow(prompt).reservedInput + 1 }],
      ['reservedOutput', { ...reservationRow(prompt), reservedOutput: reservationRow(prompt).reservedOutput + 1 }],
      ...promptChanges().map(({ label, change }): [string, ReturnType<typeof reservationRow>] =>
        [`prompt.${label}`, reservationRow(change(prompt))]),
    ];
    for (const [label, entry] of rows) {
      const changed = await world.execution.recordQueryUsage(world.b2.base.ctx, {
        input: { entry: query.entry, entries: [entry] },
        meta: { requestId: `PC-QR-usage-immutable-${label}`,
          expected: [{ ref: query.queryRunRef, revision: current.revision }] },
      });
      expect(changed, label).toMatchObject({ status: 'rejected', code: 'idempotency_conflict' });
    }
    const after = ready(await world.execution.readQueryExecution(world.b2.base.ctx, query.queryRunRef));
    expect(after.run.revision).toBe(current.revision);
    expect(after.run.run.executionState?.requests).toEqual([{ ...reservationRow(prompt), admitted: false }]);
  });

  it('rejects an incomplete prompt fact with invalid', async () => {
    const query = await createQueryRun('invalid-prompt');
    const prompt = promptFacts();
    const current = ready(await world.execution.readQueryExecution(world.b2.base.ctx, query.queryRunRef)).run;
    const incomplete = { ...prompt, selection: { ...prompt.selection, removed: { ...prompt.selection.removed } } } as Record<string, unknown>;
    delete (incomplete['selection'] as Record<string, unknown>)['budget'];
    const written = await world.execution.recordQueryUsage(world.b2.base.ctx, {
      input: { entry: query.entry, entries: [{ ...reservationRow(prompt), prompt: incomplete as unknown as QueryRequestPromptFactsV1 }] },
      meta: { requestId: `PC-QR-usage-invalid-${query.queryRunRef.runId}`,
        expected: [{ ref: query.queryRunRef, revision: current.revision }] },
    });
    expect(written).toMatchObject({ status: 'rejected', code: 'invalid' });
  });
});
