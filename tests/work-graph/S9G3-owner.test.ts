/**
 * Slice 9 G3 owner rows (lead ruling s9g3 #7): the Workflow-side rules of the exec review loop that the
 * acceptance rows (W1–W5, P4, P5, E2, E4, E5) do not name.
 *
 * - O1 (pure, A5): the submit shape of a planning Query is `exec_review` only for a reviewer line answering the
 *   Host system round whose head is `execreview:`; without the head kind the same reviewer round stays `plan_review`.
 * - O3 (SQLite, Host restart; lead ruling s9g3 after hand-back #1): a check a restart interrupted has no commit the
 *   notice can read by identity, so the no-line notice takes the newest finished check's result commit, or the
 *   opening commit when none finished; the decision queue still reads. The check is held by a marker file
 *   (`.cache` is outside the source digest) while the Host crashes; the new Host's start-up reconcile interrupts it.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { planningAnswerShapeOf } from '../../src/business/workflow/plan-round.js';
import type { WorkflowAdvanceInput, WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import { driveWorkflow } from '../helpers/A2-restart-fixture.js';
import {
  adoptPLPlanDraft, openPLWorkflowWorld, plSingleStageDraft, type PLWorkflowWorld,
} from '../helpers/PL-workflow-fixture.js';
import { OPERATOR, S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { seedS6AMemory } from '../helpers/S6A-memory-fixture.js';
import { createS6BLine } from '../helpers/S6B1-fixture.js';
import { checkConfiguration, sessionOf } from '../helpers/S7A-fixture.js';
import { waitFor } from '../scenarios/harness.js';

let opened: PLWorkflowWorld | null = null;
afterEach(async () => { await opened?.close(); opened = null; });

const systemRound = { sender: { kind: 'host' as const, actor: { kind: 'system' as const, id: 'host:plan-round' } },
  intent: 'action_request' as const };
const person = { sender: { kind: 'host' as const, actor: { kind: 'human' as const, id: 's9g3-person' } },
  intent: 'action_request' as const };

describe('O1 the exec review answer shape', () => {
  it.each([
    ['reviewer, system round, execreview head', systemRound, 'reviewer', 'exec_review', 'exec_review'],
    ['reviewer, system round, no head', systemRound, 'reviewer', undefined, 'plan_review'],
    ['reviewer, system round, planreview head', systemRound, 'reviewer', 'planreview', 'plan_review'],
    ['adviser, system round, execreview head', systemRound, 'adviser', 'exec_review', 'plan_round'],
    ['reviewer, a person, execreview head', person, 'reviewer', 'exec_review', 'text'],
  ] as const)('%s', (_label, message, duty, roundKind, expected) => {
    expect(planningAnswerShapeOf(message, duty, roundKind)).toBe(expected);
  });
});

const HOLD = '.cache/s9g3-hold-check';
/** Sleeps while the marker exists (at most 30 s), then ends PASS. */
const HELD_CHECK = `node -e "const fs=require('node:fs');const t=Date.now();`
  + `const w=setInterval(()=>{if(!fs.existsSync('${HOLD}')||Date.now()-t>30000)clearInterval(w)},50)"`;

describe('O3 the no-line notice of a round whose check a restart interrupted', () => {
  it('the decision queue reads, and the notice sits at the round\'s opening commit (no check finished)', async () => {
    const actor = { kind: 'human' as const, id: OPERATOR.id };
    opened = await openPLWorkflowWorld({ backend: 'sqlite', label: 's9g3-o3', extraHostOptions: { checks: {
      ...checkConfiguration(actor), checks: [{ checkId: 's9g3-held', kind: 'static', command: HELD_CHECK, cwd: '.',
        timeoutMs: 60_000, taskIds: 'all' }] } } });
    const { world, main, goal } = opened;
    const governance = (await seedS6AMemory({ scope: main.scope, goals: world.goals, clock: world.clock,
      platform: world.platform, post: world.post, humanContext: main.humanContext, settleDetached: world.settleDetached },
    { architecture: false, policy: false, notes: false })).governance;
    await governance.activatePolicy({ content: { schemaVersion: 1, requirementKinds: ['static', 'reviewer'],
      minimumRequiredRequirementsPerObligation: 1 } });
    const base = plSingleStageDraft(goal, { label: 's9g3-o3', taskIds: ['pl-a'], carrierTaskIds: ['pl-a'] });
    await adoptPLPlanDraft(main, goal, { ...base, obligations: base.obligations.map(obligation => ({ ...obligation,
      verificationRequirements: [...obligation.verificationRequirements, { requirementId: 's9g3-review',
        requirementLevel: 'required' as const, kind: 'reviewer', description: 'S9 G3 exec review' }] })) }, 's9g3-o3');
    const line = await sessionOf(world, await createS6BLine(main, { label: 's9g3-o3-work', role: S6A_WORK_ROLE }));
    await world.scripted.script(line, [{ kind: 'text', text: 'S9G3 O3 done' }]);
    const receipts: WorkflowStepReceipt[] = [];
    const steps = await driveWorkflow(world.ag2b, { schemaVersion: 1, goalRef: goal, flowId: 's9g3-o3',
      sessionHint: line.ref, kind: 'select_work', taskId: 'pl-a' }, { stopBefore: 'run_check', receipts });
    const open = receipts.find(receipt => receipt.kind === 'open_checks')?.result;
    if (open?.status !== 'committed') throw new Error(`O3: the round did not open: ${JSON.stringify(open)}`);
    await mkdir(join(world.root, '.cache'), { recursive: true });
    await writeFile(join(world.root, HOLD), 'hold\n');
    const runCheck = steps.at(-1)!.next as WorkflowAdvanceInput;
    const held = world.post('workflow/advance', { scope: { ...S6A_SCOPE }, input: runCheck });
    try {
      const heldRoundRead = async () => (await world.post('verification/round', { scope: { ...S6A_SCOPE },
        input: { roundRef: open.value.ref } })).body as { value?: { checks: { phase: string }[] } };
      await waitFor(heldRoundRead, round => round.value?.checks[0]?.phase === 'executing', 'the held check to start');
      await world.crash();
      expect((await heldRoundRead()).value?.checks.map(check => check.phase)).toEqual(['interrupted']);
      const queue = (await world.post('decisions/queue', { scope: { ...S6A_SCOPE }, input: { workspace: S6A_SCOPE,
        sections: ['notices'], categories: ['plan_notice'], page: { limit: 100 } } })).body;
      const itemKey = `exec-review-no-line:${goal.goalId}:${open.value.ref.roundId}`;
      expect(queue).toMatchObject({ status: 'ready', value: { notices: [{ itemKey, category: 'plan_notice',
        position: { kind: 'commit', cursor: open.cursor, itemKey } }] } });
    } finally {
      // The abandoned Host's held check ends now, so the world closes without waiting for it.
      await rm(join(world.root, HOLD), { force: true });
      await held.catch(() => undefined);
    }
  }, 120_000);
});
