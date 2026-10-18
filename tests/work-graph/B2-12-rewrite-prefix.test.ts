/**
 * K3 L19a / binding item 11: `rewriteOf.review` accepts the full Run id or its
 * UNIQUE 8-character prefix. Two real review records of ONE Task are created
 * through the public claim owner with an INJECTED id generator, so their
 * original Run ids share exactly the first 8 characters:
 *
 *   aaaaaaaa-0000-4000-8000-000000000001   (record 1)
 *   aaaaaaaa-1111-4000-8000-000000000002   (record 2, a real requeue claim)
 *
 * A shared prefix must be `invalid` and name BOTH complete Run ids; a full Run
 * id is accepted; a prefix of another Task's Run id is `invalid`; the same
 * record with a non-blocked alias is `invalid`. Every step that produced a
 * prior state is public: claim owner, RUN-20/RUN-22, `skip_as_done` ①/②, the
 * real requeue owner and the real request owner.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import type { CommandRerunRequestV1 } from '../../src/contracts/command-rerun-request.js';
import { openK3ReviewCardWorld, type K3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { sha256Of } from '../helpers/K3-blocked-command-fixture.js';
import { canonicalJson } from '../../src/contracts/fingerprint.js';
import {
  createBlockedRecord, requeueAfterRun, workRunContextOf, type K3PrefixReview,
} from '../helpers/K3-prefix-claim.js';
import { GOAL_B } from '../helpers/S5-decision-fixture.js';

// §5.1's stand-in `shell`, hoisted per test file: the real Runs that produce the
// blocked records use it (the fixture's real chain claims → prepares → starts).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const FIRST_RUN = 'aaaaaaaa-0000-4000-8000-000000000001';
const SECOND_RUN = 'aaaaaaaa-1111-4000-8000-000000000002';
const FOREIGN_RUN = 'bbbbbbbb-0000-4000-8000-000000000003';
/** Exactly the first 8 characters of FIRST_RUN and SECOND_RUN. */
const SHARED_PREFIX = 'aaaaaaaa';
const TASK_ID = 'k3-20-a';

const worlds: K3ReviewCardWorld[] = [];
afterEach(async () => {
  shellSeam.release();
  for (const world of worlds.splice(0)) await world.close();
});

/** Both real records of the one Task, each with a blocked command on alias 1. */
async function twoRecords(world: K3ReviewCardWorld): Promise<{ first: K3PrefixReview; second: K3PrefixReview }> {
  const first = await createBlockedRecord(world, {
    taskId: TASK_ID, runId: FIRST_RUN, label: 'first', command: 'npm run db:migrate', callId: 'prefix-c1',
  });
  const requeue = await requeueAfterRun(world, TASK_ID, first.claim.runRef, 'second');
  const second = await createBlockedRecord(world, {
    taskId: TASK_ID, runId: SECOND_RUN, label: 'second', command: 'pnpm db:push', callId: 'prefix-c2',
    requeueRef: requeue.ref,
  });
  // Two real records of one Task, both with a blocked alias 1.
  expect(first.record.task.taskId).toBe(TASK_ID);
  expect(second.record.task.taskId).toBe(TASK_ID);
  expect(first.record.runRef.runId).toBe(FIRST_RUN);
  expect(second.record.runRef.runId).toBe(SECOND_RUN);
  expect(first.record.blockedCommands).toMatchObject([{ alias: 1 }]);
  expect(second.record.blockedCommands).toMatchObject([{ alias: 1 }]);
  // The item's arguments digest is the PRODUCTION digest of the real Kernel
  // call's arguments (a hand-written item had a constant placeholder digest).
  expect(first.record.items[0]?.argumentsDigest)
    .toBe(sha256Of(canonicalJson({ command: 'npm run db:migrate' })));
  expect(second.record.items[0]?.argumentsDigest)
    .toBe(sha256Of(canonicalJson({ command: 'pnpm db:push' })));
  return { first, second };
}

let requestSeq = 0;

function request(world: K3ReviewCardWorld, run: K3PrefixReview['run'], input: {
  command: string;
  rewriteOf?: { review: string; alias: number };
}) {
  return world.commandRerun.requestRerun(workRunContextOf(world, run), {
    input: {
      task: { projectId: run.ref.projectId, goalId: run.ref.goalId, taskId: TASK_ID },
      runRef: run.ref, command: input.command, reason: 'the migration must really run',
      ...(input.rewriteOf === undefined ? {} : { rewriteOf: input.rewriteOf }),
    },
    meta: { requestId: `b2-12-request-${String(++requestSeq)}`, expected: [] },
  });
}

async function listAll(world: K3ReviewCardWorld): Promise<CommandRerunRequestV1[]> {
  const page = await world.commandRerun.listRequests(world.fixture.ctx, {
    workspace: { projectId: 'P', workspaceId: 'W' },
    filter: { goalId: GOAL_B.goalId, taskId: TASK_ID },
    page: { limit: 200 },
  });
  if (page.status !== 'ready') throw new Error(`the request list failed: ${JSON.stringify(page)}`);
  return page.value.items;
}

describe.each(['memory', 'sqlite'] as const)('B2-12 rewriteOf prefix (L19a, Codex item 11) (%s)', kind => {
  it('an 8-character prefix shared by two records of the Task is invalid and lists both full runIds', async () => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    const { first, second } = await twoRecords(world);
    expect(await listAll(world)).toHaveLength(0);

    // The ambiguity: the shared 8-character prefix cannot select a record.
    const ambiguous = await request(world, first.run, {
      command: 'sh ./migrate.sh', rewriteOf: { review: SHARED_PREFIX, alias: 1 },
    });
    expect(ambiguous).toMatchObject({ status: 'rejected', code: 'invalid' });
    if (ambiguous.status !== 'rejected') throw new Error('the shared prefix was not rejected');
    expect(ambiguous.reason).toContain('ambiguous');
    // Both COMPLETE runIds are candidates: assert each full id, not just a count.
    expect(ambiguous.reason).toContain(FIRST_RUN);
    expect(ambiguous.reason).toContain(SECOND_RUN);
    expect(await listAll(world)).toHaveLength(0);

    // A full runId is still accepted: the prefix rule is about uniqueness.
    const accepted = await request(world, first.run, {
      command: 'sh ./migrate.sh', rewriteOf: { review: FIRST_RUN, alias: 1 },
    });
    expect(accepted).toMatchObject({ status: 'committed', replayed: false,
      value: { request: { alias: 1, declared: true,
        reviewRef: first.record.ref, runRef: first.run.ref } } });
    const requests = await listAll(world);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ reviewRef: first.record.ref, runRef: first.run.ref, alias: 1 });
  }, 120_000);

  it('a prefix of another Task runId is invalid for this Task', async () => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    const { first, second } = await twoRecords(world);
    // A real third record on ANOTHER Task (k3-20-b), with its own real Run id.
    const foreign = await createBlockedRecord(world, {
      taskId: 'k3-20-b', runId: FOREIGN_RUN, label: 'foreign', command: 'cargo build', callId: 'prefix-c3',
    });
    expect(foreign.record.task.taskId).toBe('k3-20-b');

    const result = await request(world, first.run, {
      command: 'sh ./migrate.sh', rewriteOf: { review: FOREIGN_RUN.slice(0, 8), alias: 1 },
    });
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    if (result.status !== 'rejected') throw new Error('the foreign prefix was not rejected');
    expect(result.reason).toContain('not a review record of this task');
    expect(result.reason).toContain(FIRST_RUN);
    expect(result.reason).toContain(SECOND_RUN);
    expect(result.reason).not.toContain(FOREIGN_RUN);
    expect(await listAll(world)).toHaveLength(0);
  }, 120_000);

  it('a command that hits record A while rewriteOf names record B alias 1 is rewrite_of_mismatch', async () => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    const { first, second } = await twoRecords(world);
    // `npm run db:migrate` is record A's blocked command; the declaration names
    // record B (a different real blocked record of the same Task) alias 1.
    const result = await request(world, first.run, {
      command: 'npm run db:migrate',
      rewriteOf: { review: second.record.runRef.runId, alias: 1 },
    });
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    if (result.status !== 'rejected') throw new Error('the mismatched rewrite was not rejected');
    expect(result.reason).toContain('rewrite_of_mismatch');
    expect(await listAll(world)).toHaveLength(0);
  }, 120_000);

  it('the same record with a non-blocked alias is invalid', async () => {
    const world = await openK3ReviewCardWorld(kind);
    worlds.push(world);
    const { first } = await twoRecords(world);
    // The two ids share their 8-character prefix BY CONSTRUCTION, so the alias
    // row is reached with the unique full id (the prefix fails on ambiguity
    // first); the record is the same one as the accepted full-id request.
    const result = await request(world, first.run, {
      command: 'sh ./migrate.sh', rewriteOf: { review: FIRST_RUN, alias: 2 },
    });
    expect(result).toMatchObject({ status: 'rejected', code: 'invalid' });
    if (result.status !== 'rejected') throw new Error('the non-blocked alias was not rejected');
    expect(result.reason).toContain('is not a blocked command');
    expect(result.reason).toContain(FIRST_RUN);
    expect(await listAll(world)).toHaveLength(0);
  }, 120_000);
});
