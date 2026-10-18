/**
 * K3-15 (一)(二)(三) at the public decision seam: a real `needs_decision` record
 * and card from the shared fixture, answered through the real finite
 * coordinator (`resolveDecision` with the real decision owners and the real
 * `unknown_call_review` adapter).
 *
 * Each of the four options writes ONE `disposition_applied` record, leaves the
 * observation untouched, carries the disposition fields from L19 and, for
 * `safer_method`, moves to `awaiting_proposal` with `stateEntry + 1`. The
 * assembled continuation section is asserted from the applied record (L19);
 * the rendered mandatory lines are asserted on pure values in
 * `tests/runtime/K3-15-disposition-effects-pure.test.ts` (F-046).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { CoreRejection, WriteResult } from '../../src/contracts/core/results.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import type { UnknownCallReviewV1 } from '../../src/contracts/unknown-call-review.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import { assembleUnknownCallReviewSection } from '../../src/core/agent-runtime/continuation-brief-assembly.js';
import {
  createK3NeedsDecisionRecord, openK3ReviewCardWorld, type K3ReviewCardWorld,
} from '../helpers/K3-review-card-fixture.js';
import { openRealRunHarness } from '../helpers/K3-35-continuation-fixture.js';
import { createScriptedModel } from '../helpers/B2-runtime-fixture.js';
import { mixedEditSeam, releaseMixedSeams, type MixedSeam } from '../helpers/K3-mixed-seams.js';
import { GOAL_B, PLAN_B2, WORKSPACE_SCOPE } from '../helpers/S5-decision-fixture.js';
import { readToolSeam, shellSeam } from '../helpers/K3-tool-seams.js';

// The auto-settled record is a REAL Run whose one read-only call is held by the
// §5.1 blocking seam; the mock is per test file, so this file owns it.
const readSeams = vi.hoisted(() => ({
  readToolSeam: undefined as unknown as typeof import('../helpers/K3-tool-seams.js').readToolSeam,
  shellSeam: undefined as unknown as typeof import('../helpers/K3-tool-seams.js').shellSeam,
  edit: undefined as unknown,
}));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/read/read-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/read/read-tool.js')>();
  return { ...actual,
    createReadToolDefinition: (workspace: Parameters<typeof actual.createReadToolDefinition>[0]) =>
      readSeams.readToolSeam.enabled ? readSeams.readToolSeam.definition() : actual.createReadToolDefinition(workspace) };
});
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]) =>
    readSeams.shellSeam.definition(actual.createShellToolDefinition, sandboxArg) };
});
vi.mock('../../vendor/coding-agent/dist/tools/builtin/edit/edit-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/edit/edit-tool.js')>();
  return {
    ...actual,
    createEditToolDefinition: (workspace: Parameters<typeof actual.createEditToolDefinition>[0]): ToolDefinition =>
      (readSeams.edit as MixedSeam).definition(actual.createEditToolDefinition as never, workspace as never),
  };
});
readSeams.readToolSeam = readToolSeam;
readSeams.shellSeam = shellSeam;
readSeams.edit = mixedEditSeam;
afterEach(() => { releaseMixedSeams(); readToolSeam.release(); shellSeam.release(); });

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

async function cardSourceOf(world: K3ReviewCardWorld, record: UnknownCallReviewV1) {
  const page = await world.cardSource.readPage(world.fixture.ctx, { workspace: WORKSPACE_SCOPE, goalRef: GOAL_B,
    page: { limit: 100 } });
  if (page.status !== 'ready') throw new Error(`the card page failed: ${JSON.stringify(page)}`);
  const key = decisionSourceKey({ kind: 'unknown_call_review', reviewRef: record.ref, revision: record.revision });
  const card = page.value.items.find(item => item.source.key === key);
  if (card === undefined) throw new Error(`the card ${key} is not on the source page`);
  return card;
}

/**
 * The ONE real record world of this file, on the backend the row names (F-054:
 * both memory and SQLite; the fixture shares its one backend and body store
 * with the Host assembly) and the production Kernel command reader (the
 * disposition's blocked-command fact comes from the real Kernel record, never a
 * test-written map).
 */
async function openWorld(kind: 'memory' | 'sqlite'): Promise<K3ReviewCardWorld> {
  const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
  worlds.push(world);
  return world;
}

/**
 * The real `file_edit` record the annotation row needs: production claim/
 * prepare/start, the §5.1 edit stand-in holding the call, then the production
 * RUN-20/RUN-22 read. RUN-20's probe is the injected transient Kernel read
 * failure (spec ~274 `kernel_unreadable_at_stop`), so the recovered `file_edit`
 * is kept and the inventory is `incomplete`. The Runtime ends the Run after the
 * call is released; no item, draft or record is an input.
 */
async function createFileEditRecord(world: K3ReviewCardWorld, taskId: string,
  label: string): Promise<UnknownCallReviewV1> {
  const harness = await openRealRunHarness(world);
  try {
    const session = await world.fixture.createS5Session(`k3-15-edit-${label}`);
    const claim = await harness.claimRun({ sessionRef: session, planRef: PLAN_B2, taskId,
      requestId: `k3-15-edit-claim-${label}` });
    mixedEditSeam.arm();
    const run = await harness.prepareAndStart(claim, {
      model: createScriptedModel([{ kind: 'calls', calls: [{ callId: `k3-15-edit-${label}`, name: 'edit',
        args: { mode: 'replace', path: 'src/x.ts', oldText: 'A', newText: 'B' } }] },
      { kind: 'text', text: 'done' }]),
      tools: ['read', 'write'], writeScope: ['.'], blockOnShell: false,
    });
    try {
      await Promise.race([
        mixedEditSeam.waitForCall(),
        run.started.then(result => {
          throw new Error(`the Run settled before its edit call: ${JSON.stringify(result)}`);
        }, error => { throw error; }),
      ]);
      return await harness.createRecord(claim, { probe: { verdict: 'damaged', activeRunId: null,
        reason: 'transient Kernel read failure at the stop' } });
    } finally {
      mixedEditSeam.release();
      await run.started;
    }
  } finally {
    mixedEditSeam.release();
    await harness.closeUnion();
  }
}

async function applyChoice(
  world: K3ReviewCardWorld, choice: 'rerun_as_is' | 'skip_as_done' | 'handle_myself',
  options: { text?: string; annotations?: { objectKey: string; text: string }[]; requestId?: string } = {},
): Promise<UnknownCallReviewV1> {
  const record = await createK3NeedsDecisionRecord(world, 'k3-20-a');
  const card = await cardSourceOf(world, record);
  const result = await world.decisionActions.resolveDecision(world.fixture.ctx, {
    input: { source: card.source, selection: { kind: 'option', optionId: choice },
      text: options.text ?? '', annotations: options.annotations ?? [] },
    meta: { requestId: options.requestId ?? `k3-15-l20-${choice}`, expected: card.source.pins },
  });
  expect(result).toMatchObject({ status: 'ready', value: { state: 'applied' } });
  if (result.status !== 'ready') throw new Error(`the answer did not apply: ${JSON.stringify(result)}`);
  const action = result.value.action as WriteResult<UnknownCallReviewV1> | CoreRejection | null;
  if (action === null || action.status !== 'committed') {
    throw new Error(`the disposition must commit: ${JSON.stringify(action)}`);
  }
  return action.value;
}

describe.each(['memory', 'sqlite'] as const)('K3-15 (一)(二)(三) card dispositions (%s)', kind => {
  it.each(['rerun_as_is', 'skip_as_done', 'safer_method', 'handle_myself'] as const)(
    '%s: resolveDecision applies the card disposition and leaves the observation untouched', async choice => {
      const world = await openWorld(kind);
      const record = await createK3NeedsDecisionRecord(world, 'k3-20-a');
      // The real blocked record carries the ONE process item the serial Kernel
      // batch reached; its Kernel command fact is read by the production reader
      // opened with the world, not written by this test.
      const item = record.items[0]!;
      expect(record.items).toHaveLength(1);
      expect(record).toMatchObject({ status: 'needs_decision', revision: 2,
        dispositionTargets: [item.callId], proposalTargets: [item.callId] });
      const card = await cardSourceOf(world, record);

      const result = await world.decisionActions.resolveDecision(world.fixture.ctx, {
        input: { source: card.source, selection: { kind: 'option', optionId: choice },
          text: `answer ${choice}`, annotations: [] },
        meta: { requestId: `k3-15-${choice}`, expected: card.source.pins },
      });
      expect(result).toMatchObject({ status: 'ready', value: { state: 'applied' } });
      if (result.status !== 'ready') return;
      expect(result.value.application).toMatchObject({ status: 'committed' });
      const action = result.value.action as WriteResult<UnknownCallReviewV1> | CoreRejection | null;
      expect(action).toMatchObject({ status: 'committed' });
      if (action === null || action.status !== 'committed') return;
      const applied = action.value;

      // The observation and the targets are copied, never re-derived.
      expect(applied.items).toEqual(record.items);
      expect(applied.disposition).toMatchObject({
        choice, source: 'card', targets: record.dispositionTargets,
        answeredRevision: record.revision, text: `answer ${choice}`,
      });
      expect(applied.disposition?.answerMessageRef).not.toBeNull();
      if (choice === 'safer_method') {
        expect(applied).toMatchObject({ status: 'awaiting_proposal',
          stateEntry: record.stateEntry + 1, disposition: { choice: 'safer_method' } });
      } else if (choice === 'handle_myself') {
        expect(applied).toMatchObject({ status: 'resolved', disposition: { choice, hold: 'held' } });
      } else {
        expect(applied).toMatchObject({ status: 'resolved', disposition: { choice, hold: null } });
      }

      // The continuation section projects the disposition (L19); the renderer's
      // mandatory lines are asserted on pure values in
      // tests/runtime/K3-15-disposition-effects-pure.test.ts.
      const section = assembleUnknownCallReviewSection({ review: applied });
      expect(section.disposition).toMatchObject({ choice, source: 'card', text: { text: `answer ${choice}` },
        targets: [1], platformTargets: [], approvedMethods: [] });
      // K3-15 (二): only a disposition that really blocked a command carries the
      // blocked-command fact; every other option carries none.
      if (choice === 'skip_as_done') {
        expect(applied.blockedCommands).toHaveLength(1);
        expect(applied.blockedCommands[0]).toMatchObject({ alias: 1, reviewRunId: applied.runRef.runId });
        expect(section.blockedCommands).toEqual([{ alias: 1, reviewRunId: applied.runRef.runId,
          commandSha256: applied.blockedCommands[0]!.commandSha256 }]);
      } else {
        expect(applied.blockedCommands).toEqual([]);
      }
    }, 120_000);

  it('K3-15: a direct hold on a self-settled record has no disposition targets', async () => {
    // The real serial Kernel batch leaves a `needs_decision` record with one
    // process item, so the disposition targets can never be empty there. The
    // reachable no-targets disposition is the human's direct "I'll handle it"
    // on the real self-settled (read-only) record: the platform writes targets
    // `[]`. The rendered `无` line is asserted on a pure value in
    // tests/runtime/K3-15-disposition-effects-pure.test.ts (F-046).
    const world = await openWorld(kind);
    const auto = await createK3NeedsDecisionRecord(world, 'k3-20-a', { autoSettled: true });
    expect(auto).toMatchObject({ status: 'resolved', disposition: null, dispositionTargets: null });
    const held = await world.reviews.holdReview(world.fixture.ctx, {
      input: { reviewRef: auto.ref, text: 'the operator handles it' },
      meta: { requestId: 'k3-15-empty-targets', expected: [{ ref: auto.ref, revision: auto.revision }] },
    });
    expect(held).toMatchObject({ status: 'committed' });
    if (held.status !== 'committed') throw new Error('the hold must commit');
    const section = assembleUnknownCallReviewSection({ review: held.value });
    expect(section.disposition).toMatchObject({ choice: 'handle_myself', source: 'direct',
      targets: [], platformTargets: [] });
  }, 120_000);

  it('K3-15 (L20): a card skip_as_done records the one blocked command', async () => {
    const world = await openWorld(kind);
    const applied = await applyChoice(world, 'skip_as_done', { text: 'skip it' });
    const section = assembleUnknownCallReviewSection({ review: applied });
    // K3-15 (二): the real record blocked #1 and the section carries the fact.
    expect(applied.blockedCommands).toHaveLength(1);
    expect(applied.blockedCommands[0]).toMatchObject({ alias: 1, reviewRunId: applied.runRef.runId });
    expect(section.blockedCommands).toHaveLength(1);
  }, 120_000);

  it('K3-15 (L20): a released handle_myself records the released card hold', async () => {
    const world = await openWorld(kind);
    const held = await applyChoice(world, 'handle_myself', { text: 'I handled it' });
    const released = await world.reviews.releaseHold(world.fixture.ctx, {
      input: { reviewRef: held.ref },
      meta: { requestId: 'k3-15-l20-release', expected: [{ ref: held.ref, revision: held.revision }] },
    });
    expect(released).toMatchObject({ status: 'committed', value: {
      revision: held.revision + 1, status: 'resolved',
      disposition: { choice: 'handle_myself', source: 'card', hold: 'released' } } });
    if (released.status !== 'committed') throw new Error('the release must commit');
  }, 120_000);

  it('K3-15 (L20): a review settled by itself keeps a null disposition', async () => {
    const world = await openWorld(kind);
    const auto = await createK3NeedsDecisionRecord(world, 'k3-20-b', { autoSettled: true });
    expect(auto).toMatchObject({ status: 'resolved', disposition: null });
    const section = assembleUnknownCallReviewSection({ review: auto });
    expect(section.disposition).toBeNull();
  }, 120_000);

  it('K3-15 (L20): annotations survive the real answer and the assembler', async () => {
      // The REAL card annotation: the real transient file_edit record's card has
      // both the record object and the `src/x.ts` file object, so both the
      // record-object and the file-object annotation go through the real
      // object-key validation and the real disposition write.
      const world = await openWorld(kind);
      const record = await createFileEditRecord(world, 'k3-20-b', 'annotations');
      expect(record).toMatchObject({ status: 'needs_decision', inventory: 'incomplete',
        inventoryProblem: 'kernel_unreadable_at_stop' });
      const card = await cardSourceOf(world, record);
      const recordObject = card.objects.find(object => object.kind === 'aggregate');
      const fileObject = card.objects.find(object => object.kind === 'file' && object.path === 'src/x.ts');
      expect(recordObject).toBeDefined();
      expect(fileObject).toBeDefined();
      const annotations = [
        { objectKey: canonicalJson(recordObject as unknown as JsonValue), text: '先核实远端迁移' },
        { objectKey: canonicalJson(fileObject as unknown as JsonValue), text: '看迁移脚本' },
      ];
      const result = await world.decisionActions.resolveDecision(world.fixture.ctx, {
        input: { source: card.source, selection: { kind: 'option', optionId: 'rerun_as_is' },
          text: '先核实远端迁移', annotations },
        meta: { requestId: 'k3-15-l20-annotations', expected: card.source.pins },
      });
      expect(result).toMatchObject({ status: 'ready', value: { state: 'applied' } });
      if (result.status !== 'ready') throw new Error(JSON.stringify(result));
      const action = result.value.action as WriteResult<UnknownCallReviewV1> | CoreRejection | null;
      if (action === null || action.status !== 'committed') throw new Error('the disposition must commit');
      const expectedAnnotations = [
        { path: null, text: '先核实远端迁移' },
        { path: 'src/x.ts', text: '看迁移脚本' },
      ];
      expect(action.value.disposition?.annotations).toEqual(expectedAnnotations);

      // The codec round trip and the rendered annotation lines are pure and
      // live in tests/runtime/K3-15-disposition-effects-pure.test.ts (F-046).
      const section = assembleUnknownCallReviewSection({ review: action.value });
      expect(section.disposition?.annotations).toEqual(expectedAnnotations);
    }, 120_000);
});
