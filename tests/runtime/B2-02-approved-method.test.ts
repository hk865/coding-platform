/**
 * B2-02 (L19a "在哪拦" (ii)): after a real proposal round and `approve`, the
 * approved method command runs without a request even though it contains a
 * blocked action; the original command still blocks; another form containing
 * the blocked action still blocks. The Run is ONE real `pending_review` record
 * (`createK3PendingReview`: claim → production prepare → the Runtime's own
 * start/end over §5.1's shell stand-in, RUN-20/RUN-22 over the real draft),
 * settled into `needs_decision` and driven through the real disposition,
 * proposal and approval owners (no hand-encoded record/proposal/item).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import { openK3ReviewCardWorld } from '../helpers/K3-review-card-fixture.js';
import {
  answerK3Disposition, claimK3ReviewRound, createK3PendingReview, endK3RunCompleted,
  settleK3Review, writeK3Proposals,
} from '../helpers/K3-proposal-round.js';
import { nextCall, openB2HookWorld, runHook } from '../helpers/B2-blocked-runtime.js';
import type { ToolCall } from '../../vendor/coding-agent/dist/public-api.js';


// §5.1's stand-in `shell`, hoisted per test file (the fixture's real Run uses it).
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const worlds: Array<Awaited<ReturnType<typeof openK3ReviewCardWorld>>> = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close(); });

const shell = (command: string): ToolCall => ({ schemaVersion: 1, callId: nextCall(), name: 'shell',
  arguments: { command } });

const ORIGINAL = 'npm run db:migrate';
const APPROVED = 'npm run backup && npm run db:migrate';

describe('B2-02 approved method runs without a request', () => {
  it.each(['memory', 'sqlite'] as const)(
    'B2-02 (%s): the approved method runs, the original and another blocked-action form are blocked',
    async kind => {
      const world = await openK3ReviewCardWorld(kind, { realKernelCommandFacts: true });
    worlds.push(world);
    // The ONE real blocked Run: its single shell call is the original command.
    const pending = await createK3PendingReview(world, {
      taskId: 'k3-20-a', label: 'b2-02', command: ORIGINAL,
    });
    expect(pending).toMatchObject({ status: 'pending_review', activeRound: null });
    expect(pending.items).toHaveLength(1);
    const decision = await settleK3Review(world, pending, { cause: 'review_unavailable' });
    expect(decision.status).toBe('needs_decision');

    // The real safer-method answer, then the real proposal round proposes the
    // approved method; the proposal Run ends completed and settles.
    const proposed = await answerK3Disposition(world, decision, 'safer_method', {
      text: 'run the approved method',
    });
    expect(proposed.status).toBe('awaiting_proposal');
    const round = await claimK3ReviewRound(world, proposed, { phase: 'proposal' });
    const written = await writeK3Proposals(world, round, { commandFor: () => APPROVED });
    await endK3RunCompleted(world, round.claim);
    const record = await settleK3Review(world, written.record);
    expect(record.status).toBe('awaiting_approval');
    expect(record.proposals.map(proposal => proposal.command)).toEqual([APPROVED]);

    const resolved = await answerK3Disposition(world, record, 'approve');
    expect(resolved.status).toBe('resolved');
    expect(resolved.blockedCommands).toHaveLength(1);
    expect(resolved.disposition?.approvedMethods?.map(method => method.command)).toEqual([APPROVED]);
    expect(resolved.blockedCommands[0]!.actions.map(action => action.text)).toContain(ORIGINAL);

    // The hook reads the record, Task and CRR facts under the REAL later Run of
    // the same Task: the record Run's platform-written claim goes through the
    // public requeue, the later Run is claimed from the world's ONE id stream
    // and ended through the public `platform_not_entered` cancel. Its identity
    // is the later claim's, never the record's own Run.
    const hookWorld = await openB2HookWorld(world, resolved);
    expect(hookWorld.runRef).toMatchObject({
      projectId: resolved.runRef.projectId, goalId: resolved.runRef.goalId });
    expect(hookWorld.runRef.runId).not.toBe(resolved.runRef.runId);
    expect(hookWorld.ctx.principal).toMatchObject({ kind: 'work_run', runRef: hookWorld.runRef });
    // (ii) the approved method is let through, even containing the blocked action.
    expect(await runHook(hookWorld.hook, shell(APPROVED)))
      .toEqual({ point: 'before_tool', kind: 'continue' });
    // The original command is still blocked.
    expect(await runHook(hookWorld.hook, shell(ORIGINAL)))
      .toMatchObject({ point: 'before_tool', kind: 'block' });
    // Another form containing the stored blocked action is still blocked.
    expect(await runHook(hookWorld.hook, shell('bash -c "npm run db:migrate"')))
      .toMatchObject({ point: 'before_tool', kind: 'block' });
  });
});
