/**
 * Slice 3 §5.11, case SC01 (one run on SQLite, scripted provider only).
 *
 * The AG2b harness Host has a fixed scope, a fixed plan and a fixed grant
 * without `look_graph`/`find_graph` (lead decision 3, `tests/scenarios/harness.ts`
 * stays unchanged), so this scenario builds its OWN composition root with the
 * same exported building blocks and the same pattern the harness's platform mode
 * uses: one SQLite ledger + Kernel store, the real owners, a scripted provider,
 * and the real `claim_task` / `prepare` / `start` performed through the Workflow
 * (`platform.workflow.advanceWork`). The shared root lives in
 * `tests/scenarios/support/S3-host.ts`.
 *
 * It seeds the §5.1 graph: scope `p/w`, Goal `g`, Plan `p1`, stage `Main` with
 * the work tasks `tA`/`tB` (tB instruction `Implement B`), obligation `oB`
 * (`Deliver B`) with verification `vB` (`node check-b.js`), the edge
 * `tB -> tA: artifact A.out`, the legacy declaration `old-A` (exactly the
 * stored body, under the real completed owner Run of `tA`), and grants
 * `look_graph`/`find_graph` in the Work binding.
 *
 * The scenario follows the row: claim and prepare `tB` while `A.out` has no
 * output; the scripted model finds `A.out`, looks at `tA` and `tA`'s history,
 * then reads the declared legacy `old-A`; the second prepare of the same Run
 * returns the original manifest; `tB` is not satisfied by `tA`'s completed Run.
 *
 * Part 1 has stubs (`createGraphTools` is unwired, `contextAssembly` is never
 * attached), so this scenario is RED by design; the failure must be an
 * assertion or `not implemented: ...`, never a fixture/setup error.
 */
import { afterEach, expect, it } from 'vitest';
import type { RunRef } from '../../src/contracts/dispatch.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type { ScriptedReply } from '../helpers/B2-runtime-fixture.js';
import { cleanupScenarios, performs } from './harness.js';
import { manifestOf } from './support/brief.js';
import { preparedOf, toolOutputJson } from './support/common.js';
import {
  EDGE_LABEL, G, GOAL_REF, LEGACY_BODY, P, PLAN_REF, SCOPE, TA, WORK_TASK, openS3Host, type S3Host,
} from './support/S3-host.js';

// ---------------------------------------------------------------------------
// SC01 identities
// ---------------------------------------------------------------------------

const LEGACY_DECLARATION_ID = 'legacy:old-A';

/** `H(s)` of spec §5.1: the exact sha256 expression, not a fuzzy "valid digest". */
const H = (s: string): string => sha256Hex(s);

afterEach(async () => {
  await cleanupScenarios();
});

// ---------------------------------------------------------------------------

it('SC01: the real claim, prepare and start assemble the declared legacy input, and a repeated prepare keeps the original manifest', async () => {
  let h: S3Host | undefined;
  try {
    const historyReply = { kind: 'calls' as const, calls: [{ callId: 'sc01-history', name: 'look_graph',
      args: { mode: 'history' as const, runRef: { aggregateType: 'Run' as const, projectId: P, goalId: G,
        runId: 'placeholder-tA-run' } as RunRef } }] };
    const replies: ScriptedReply[] = [
      // tA's own real Run: one scripted answer, no tool calls.
      { kind: 'text', text: 'SC01: tA completed' },
      { kind: 'calls', calls: [{ callId: 'sc01-find', name: 'find_graph', args: { needle: EDGE_LABEL } }] },
      { kind: 'calls', calls: [{ callId: 'sc01-look', name: 'look_graph', args: { mode: 'node', target: { kind: 'task', ref: TA, planRef: PLAN_REF } } }] },
      historyReply,
      { kind: 'calls', calls: [{ callId: 'sc01-input', name: 'look_graph', args: { mode: 'input',
        consumer: WORK_TASK, planRef: PLAN_REF, declarationId: LEGACY_DECLARATION_ID } }] },
      { kind: 'text', text: 'SC01: the declared legacy input was read' },
    ];
    h = await openS3Host('s3-context', { replies });
    // The history lookup names the real Run the Workflow generated for tA.
    historyReply.calls[0]!.args.runRef = h.runA;
    // tA already ran (and made its own requests) before the test starts.
    const requestsAfterA = h.modelRequests().length;

    // Formal claim → prepare; the Run is authorized and its input binding is
    // fixed, but the Kernel has not started (stop before `start`).
    const first = await h.advance(h.select('sc01-1', WORK_TASK.taskId), { stopBefore: performs('start') });
    expect(first.state).toBe('stopped');
    expect(first.receipts.map(receipt => receipt.kind)).toEqual(expect.arrayContaining(['claim_task', 'prepare']));
    const prepared = preparedOf(first.next);

    // The same Run prepared again returns the original immutable manifest.
    const second = await h.advance(h.select('sc01-1b', WORK_TASK.taskId), { stopBefore: performs('start') });
    const repeated = preparedOf(second.next);
    expect(repeated.inputBinding).toEqual(prepared.inputBinding);
    if (second.next === null) throw new Error('the repeated prepare must leave a start to perform');

    // The real start reaches the scripted model, which asks the read-only graph
    // tools; stop before the registered round opens (no sandboxed check needed).
    const started = await h.advance(second.next, { stopBefore: performs('open_checks') });
    expect(started.state).toBe('stopped');
    expect(started.receipts.map(receipt => receipt.kind)).toContain('start');
    const runRef = await selectedRunOf(h);
    const record = await executionOf(h, runRef);
    // The recorded Run keeps the original input binding byte for byte.
    expect(record.run.inputBinding).toEqual(prepared.inputBinding);
    expect(record.run.inputBinding?.inputDigest).toBe(prepared.inputBinding.inputDigest);

    // The first input carries the assembled context: the required obligation and
    // its verification, and the declared legacy input read as missing.
    const manifest = manifestOf(h.database, prepared.inputBinding.manifestDigest);
    expect(manifest.contextAssembly).toBeDefined();
    expect(manifest.contextAssembly).toMatchObject({ formatVersion: 's3-context-v1', callKind: 'work', duty: 'executor' });
    expect(manifest.input).toContain('Deliver B');
    expect(manifest.input).toContain('node check-b.js');
    expect(manifest.contextAssembly?.inputSelections).toEqual(expect.arrayContaining([
      expect.objectContaining({ declaration: expect.objectContaining({ requires: { kind: 'artifact', label: EDGE_LABEL } }),
        state: 'missing' }),
    ]));

    const requests = h.modelRequests();
    // tA's own request comes first in the same Session; tB's first request follows it.
    const tBRequest = requests[requestsAfterA];
    expect(tBRequest).toBeDefined();
    const lastNameUser = [...(tBRequest?.messages ?? [])].reverse().find(message => message.role === 'user');
    expect(lastNameUser).toBeDefined();
    expect(lastNameUser?.content).toContain('## Goal');
    // The declared legacy artifact `old-A` reaches the model only through the
    // graph tool result, whose source keeps the exact content digest H('old-A').
    const inputCall = requests.find(request => toolOutputJson(request, 'sc01-input') !== undefined);
    expect(toolOutputJson(inputCall, 'sc01-input')).toMatchObject({ status: 'ready',
      value: { selection: { source: { kind: 'artifact', ref: { digest: H(LEGACY_BODY) } } } } });

    // The read-only find/look/history calls created no second Session; and the
    // completed upstream Run `runA` never made `tB` satisfied.
    expect(await sessionCount(h)).toBe(1);
    expect((await taskRowOf(h, WORK_TASK.taskId)).effectivePhase).not.toBe('satisfied');
  } finally {
    await h?.close();
  }
}, 120_000);

async function selectedRunOf(h: S3Host): Promise<RunRef> {
  const row = await taskRowOf(h, WORK_TASK.taskId);
  if (row.execution === null) throw new Error(`the Task ${WORK_TASK.taskId} must select a Run`);
  return row.execution;
}

async function taskRowOf(h: S3Host, taskId: string): Promise<{ effectivePhase: string; execution: RunRef | null }> {
  const read = await h.platform.plans.queryTaskGraph(h.ctx(), { goalRef: GOAL_REF });
  if (read.status !== 'ready') throw new Error(`the task graph must be readable: ${JSON.stringify(read)}`);
  const row = read.value.tasks.find(candidate => candidate.ref.taskId === taskId);
  if (row === undefined) throw new Error(`the Task ${taskId} must be in the graph`);
  return row;
}

async function executionOf(h: S3Host, runRef: RunRef): Promise<{ run: { inputBinding?: { inputDigest: string } } }> {
  const read = await h.platform.executions.readExecution(h.ctx(), runRef);
  if (read.status !== 'ready') throw new Error(`the Run must be readable: ${JSON.stringify(read)}`);
  return read.value as unknown as { run: { inputBinding?: { inputDigest: string } } };
}

async function sessionCount(h: S3Host): Promise<number> {
  const read = await h.platform.sessions.findSessions(h.ctx(), { workspace: SCOPE, includeArchived: true, page: { limit: 50 } });
  if (read.status !== 'ready') throw new Error(`the Session directory must be readable: ${JSON.stringify(read)}`);
  return read.value.items.length;
}
