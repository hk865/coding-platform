/**
 * PC-2 G2-02 (ruling 11): the public Query bind owns the frozen-order check.
 *
 * Both counterexamples are real Query preparations: RL's public
 * submit/createSession/claim/prepare chain produces the PreparedQueryExecution,
 * and the QueryExecutionPort the composition constructs and wires into the
 * Runtime dependencies is the one that binds. Each test re-opens the saved
 * manifest through the public materials interface, stores one mutated copy as
 * that QueryRun's own body, and calls the same owner's `bindPreparedQuery`.
 * The first keeps the binding legal (a real goal/task swap in both the order and
 * the bytes) but differs from the frozen set; the second removes the frozen
 * order for the call kind. Only the Query owner's `frozenSectionOrderProblem`
 * call rejects either.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { PreparedQueryExecution, PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import { createHash } from 'node:crypto';
import * as queryExecutionModule from '../../src/core/work-graph/queries/query-execution.js';
import {
  QUERY_MANIFEST_CONTENT_TYPE,
} from '../../src/core/work-graph/queries/query-execution.js';
import type { QueryExecutionPort } from '../../src/core/work-graph/queries/contracts.js';
import { openPCQueryFixture } from '../helpers/PC-platform-fixture.js';
import { rlQueryHostCtx } from '../helpers/RL-query-fixture.js';

type QueryBindFixture = {
  bind(mutate: (manifest: PreparedQueryManifestV1) => void, tag: string): Promise<Awaited<ReturnType<QueryExecutionPort['bindPreparedQuery']>>>;
  close(): Promise<void>;
};

async function openQueryBindFixture(): Promise<QueryBindFixture> {
  // Capture the ONE Query owner the composition constructs for the real
  // platform: the same instance it passes to createAgentRuntime.
  const capture = vi.spyOn(queryExecutionModule, 'createQueryExecution');
  let openedFixture: Awaited<ReturnType<typeof openPCQueryFixture>> | undefined;
  let owners: QueryExecutionPort[] = [];
  let calls = 0;
  try {
    openedFixture = await openPCQueryFixture();
    calls = capture.mock.calls.length;
    owners = capture.mock.results
      .filter(result => result.type === 'return')
      .map(result => result.value as QueryExecutionPort);
  } finally {
    capture.mockRestore();
  }
  const fixture = openedFixture;
  if (fixture === undefined || calls !== 1 || owners.length !== 1) {
    throw new Error(`G2-02 expected one wired Query owner, found ${calls} calls and ${owners.length} owners`);
  }
  const port = owners[0]!;

  const ctx = rlQueryHostCtx();
  if (ctx.principal.kind !== 'host') throw new Error('G2-02 needs a Host call context');
  const hostActor = ctx.principal.actor;
  const prepared = await fixture.prepare().catch(async (error: unknown) => {
    await fixture.close();
    throw error;
  });
  const opened = await fixture.base.platform.materials.openArtifact(ctx, {
    ref: prepared.bundleRef, usage: 'historical_explanation',
  });
  if (opened.status !== 'ready') {
    await fixture.close();
    throw new Error(`G2-02 manifest read failed: ${JSON.stringify(opened)}`);
  }
  const openedArtifact = opened.value;

  async function bind(
    mutate: (manifest: PreparedQueryManifestV1) => void, tag: string,
  ) {
    const manifest = JSON.parse(openedArtifact.body) as PreparedQueryManifestV1;
    mutate(manifest);
    const body = JSON.stringify(manifest);
    // The bind owner's loadQueryManifest reads only a body whose trusted origin
    // is this QueryRun; the public material writer admits an execution origin
    // only from that QueryRun's own principal. Save the counterexample as such.
    const queryRunRef = prepared.queryRunRef;
    const writerCtx: CoreCallContext = {
      projectId: queryRunRef.projectId,
      workspaceId: queryRunRef.workspaceId,
      principal: { kind: 'query_run', queryRunRef, initiator: hostActor },
      materialReader: { kind: 'run', requester: queryRunRef },
      signal: ctx.signal,
    };
    const stored = await fixture.base.platform.materials.storeArtifact(writerCtx, {
      contentType: QUERY_MANIFEST_CONTENT_TYPE, body,
      sources: openedArtifact.sourceRefs, origin: { kind: 'execution', ref: queryRunRef },
    });
    if (stored.status !== 'stored') throw new Error(`G2-02 manifest write failed: ${JSON.stringify(stored)}`);
    const current = await port.readQueryExecution(ctx, queryRunRef);
    if (current.status !== 'ready') throw new Error(`G2-02 Query read failed: ${JSON.stringify(current)}`);
    const candidate: PreparedQueryExecution = { ...prepared,
      bundleRef: stored.ref, inputDigest: manifest.inputDigest };
    return port.bindPreparedQuery(ctx, { input: { prepared: candidate },
      meta: { requestId: `pc2-g-query-bind-${tag}`, expected: [
        { ref: queryRunRef, revision: current.value.run.revision },
        { ref: current.value.session.ref, revision: current.value.session.revision },
      ] } });
  }

  return {
    bind,
    close: () => fixture.close(),
  };
}

/**
 * A legal binding whose goal/task order differs from the frozen set. The saved
 * Query manifest may render only role+goal, so a real task section is inserted
 * before goal (shifting the later intervals); the two names are swapped in
 * `sectionOrder` and the sections/bytes are reordered to match. The binding
 * stays legal while the element-for-element frozen comparison rejects it.
 */
function swapGoalAndTask(manifest: PreparedQueryManifestV1): void {
  const binding = manifest.contextAssembly;
  const order = [...binding.sectionOrder];
  const goalIndex = order.indexOf('goal');
  const taskIndex = order.indexOf('task');
  const goal = binding.sections.find(section => section.name === 'goal');
  if (goalIndex < 0 || taskIndex < 0 || goal === undefined
    || goal.startByte === null || goal.endByte === null) {
    throw new Error('G2-02 needs a rendered goal section and both order names');
  }
  const goalStart = goal.startByte;
  const goalEnd = goal.endByte;
  const task = binding.sections.find(section => section.name === 'task');
  let bytes = Buffer.from(manifest.input, 'utf8');
  let sections = binding.sections;
  if (task === undefined) {
    // Put a real task section between role and goal; everything from goal on
    // shifts by the inserted bytes.
    const taskText = Buffer.from('## Accepted task\nHAND-TASK', 'utf8');
    const inserted = Buffer.concat([taskText, Buffer.from('\n\n', 'utf8')]);
    const at = goalStart;
    bytes = Buffer.concat([bytes.subarray(0, at), inserted, bytes.subarray(at)]);
    sections = sections.map(section => section.startByte !== null && section.startByte >= at
      ? { ...section, startByte: section.startByte + inserted.length,
          endByte: (section.endByte ?? section.startByte) + inserted.length }
      : section);
    sections = [...sections, { name: 'task' as const, startByte: at,
      endByte: at + taskText.length, omitted: 0 }];
  } else if (task.startByte === null || task.endByte === null) {
    throw new Error('G2-02 needs a present task interval');
  } else {
    if (task.startByte < goalStart) throw new Error('G2-02 expects goal before task');
    // Both rendered: swap the bytes and their intervals with the order.
    const goalBytes = bytes.subarray(goalStart, goalEnd);
    const taskBytes = bytes.subarray(task.startByte, task.endByte);
    const between = bytes.subarray(goalEnd, task.startByte);
    bytes = Buffer.concat([
      bytes.subarray(0, goalStart), taskBytes, between, goalBytes, bytes.subarray(task.endByte),
    ]);
    const taskStart = goalStart;
    const goalStartInOutput = taskStart + taskBytes.length + between.length;
    sections = sections.map(section => section.name === 'goal'
      ? { ...section, startByte: goalStartInOutput, endByte: goalStartInOutput + goalBytes.length }
      : section.name === 'task'
        ? { ...section, startByte: taskStart, endByte: taskStart + taskBytes.length }
        : section);
  }
  manifest.input = bytes.toString('utf8');
  manifest.inputDigest = createHash('sha256').update(manifest.input, 'utf8').digest('hex');
  binding.totalBytes = bytes.length;
  [order[goalIndex], order[taskIndex]] = [order[taskIndex]!, order[goalIndex]!];
  binding.sectionOrder = order;
  const positions = new Map(order.map((name, index) => [name, index]));
  binding.sections = sections.sort((left, right) =>
    (positions.get(left.name) ?? 0) - (positions.get(right.name) ?? 0));
}

describe('PC2 G2-02 Query bind frozen order', () => {
  it('rejects a legal binding whose order differs from the frozen prompt set', async () => {
    const fixture = await openQueryBindFixture();
    try {
      const result = await fixture.bind(swapGoalAndTask, 'foreign-order');
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    } finally { await fixture.close(); }
  });

  it('rejects a frozen prompt set that names no order for the binding call kind', async () => {
    const fixture = await openQueryBindFixture();
    try {
      const result = await fixture.bind(manifest => {
        delete (manifest.promptSet.sectionOrder as Partial<Record<string, unknown>>)[manifest.contextAssembly.callKind];
      }, 'missing-order');
      expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    } finally { await fixture.close(); }
  });
});
