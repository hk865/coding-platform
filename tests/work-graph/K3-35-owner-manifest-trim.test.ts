/**
 * K3-35 (一) owner row, rework 5 item 2: the record is the ONE real
 * `pending_review` record the platform produces for a reachable single process
 * call, and its review round ends ONLY through the Runtime (the scripted
 * model's final text reply). The round is claimed, concluded and settled by the
 * public owners, so no item, event, position, history or terminal is written by
 * the test.
 *
 * The 32-item size/trim extreme is unreachable by a real Run (one Run can hold
 * at most one process call that needs review), so it lives in the PURE
 * renderer/codec test `tests/runtime/K3-35-manifest-trim-pure.test.ts`, never in
 * this scenario.
 *
 * §5.1: the record Run's real Kernel Turn needs a blocking `shell` stand-in; the
 * stand-in is the frozen builtin replaced by `vi.mock` below, an injected
 * dependency, not a fact.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { renderUnknownCallReviewZh, type PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import { rehydratePreparedExecution } from '../../src/core/agent-runtime/execution-preparation.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import {
  createK3PendingReview, openK3ReviewCardWorld, runK3ReviewRound, type K3ReviewCardWorld,
} from '../helpers/K3-proposal-round.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { T } from '../helpers/S5-decision-fixture.js';

// §5.1's blocking `shell` stand-in, hoisted per test file: the record Run's
// real Kernel Turn holds its call so the production RUN-20/RUN-22 read sees a
// real unresolved call.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

describe('K3-35 (一) the owner review round is reachable and ends through the Runtime', () => {
  it.each(['memory', 'sqlite'] as const)('K3-35 (一) (%s): one real pending record, one conclusion, the model ends the round, and the owner settles it resolved', async kind => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    const taskId = world.tasks[0];
    if (taskId === undefined) throw new Error('the K3 world has no review Task');

    const record = await createK3PendingReview(world, {
      taskId, label: 'k335-owner-real', command: 'npm run build', callId: 'k335-owner-call-1',
    });
    // The reachable state: exactly the one process item the Kernel produced.
    expect(record.status).toBe('pending_review');
    expect(record.items).toHaveLength(1);
    const created = record.items[0];
    if (created === undefined) throw new Error('the real record has no item');
    expect(created.alias).toBe(1);
    expect(created.toolName).toBe('shell');
    expect(created.kind).toBe('process');
    expect(created.observed).toEqual({ verdict: 'pending', by: null });
    expect(created.summary.command).toBe('npm run build');
    // The platform wrote the digest itself (the Kernel call's arguments); the
    // spec's format is one lowercase SHA-256 hex value, never a test value.
    expect(created.argumentsDigest).toMatch(/^[a-f0-9]{64}$/);

    // Claim the real review round, write the one conclusion, end the Run by the
    // scripted model's final reply, then settle through the public owner.
    const round = await runK3ReviewRound(world, record, {
      conclusions: [{
        item: 1, verdict: 'done', evidence: 'the real command finished',
        crashSuspicion: { verdict: 'unlikely', evidence: 'no crash trace' },
      }],
    });
    expect(round.run).toMatchObject({ status: 'ended', outcome: 'completed' });

    // F-063: the round's REAL preparation is kept; its manifest input is read
    // back through the public material port (the WP2 shape, no raw body store).
    const execution = await createRunStateReader({ records: world.records })
      .readExecution(world.fixture.ctx, round.claim.runRef);
    if (execution.status !== 'ready') throw new Error(`the round Run is not readable: ${JSON.stringify(execution)}`);
    const prepared = rehydratePreparedExecution(execution.value);
    if (prepared === null) throw new Error('the round Run has no saved prepared envelope');
    const materials = createMaterialService({ bodies: world.fixture.bodies,
      authority: createMaterialRecordReaders(world.records).authority, now: () => T });
    const bundle = await materials.openArtifact({ ...world.fixture.ctx,
      principal: { kind: 'work_run', runRef: round.claim.runRef, roleBinding: round.run.roleBinding },
      materialReader: { kind: 'run', requester: round.claim.runRef } },
    { ref: prepared.envelope.bundleRef, usage: 'historical_explanation' });
    if (bundle.status !== 'ready') throw new Error(`the prepared manifest is not readable: ${JSON.stringify(bundle)}`);
    const manifest = JSON.parse(bundle.value.body) as PreparedTaskManifestV1;
    // The single process item reached the real review render unchanged.
    expect(manifest.unknownCallReview?.items).toHaveLength(1);
    expect(manifest.unknownCallReview?.items[0]?.alias).toBe(1);
    // F-063: the real manifest input carries the review render at the binding's
    // own byte range; PC-2 ruling 9 moved the reminders after it, so it is no
    // longer the last section.
    const reviewRender = renderUnknownCallReviewZh(
      manifest.unknownCallReview!, undefined, manifest.promptSet.toolNames);
    const reviewSection = manifest.contextAssembly.sections
      .find(section => section.name === 'unknown_call_review');
    expect(reviewSection?.startByte).toEqual(expect.any(Number));
    expect(reviewSection?.endByte).toEqual(expect.any(Number));
    const inputBytes = Buffer.from(manifest.input, 'utf8');
    // The review instruction is not last, but the two LF before its range are
    // still the blank-line separator the old assertion protected.
    expect(reviewSection!.startByte!).toBeGreaterThanOrEqual(2);
    expect(inputBytes.subarray(reviewSection!.startByte! - 2, reviewSection!.endByte!).toString('utf8'))
      .toBe(`\n\n${reviewRender}`);

    const settled = round.settled;
    if (settled === null) throw new Error('the round must be settled');
    expect(settled.status).toBe('resolved');
    expect(settled.open).toBe('no');
    expect(settled.activeRound).toBeNull();
    expect(settled.items).toHaveLength(1);
    const item = settled.items[0];
    if (item === undefined) throw new Error('the settled record has no item');
    expect(item.alias).toBe(1);
    expect(item.observed.by).toBe('review_round');
    expect(item.observed.verdict).toBe('done');
  }, 120_000);
});
