/**
 * A.2 step 6: the seeded invariant fuzz (docs/refactor/STATE-MACHINES-SPEC.md §15.2 "第 6 步" row
 * `tests/state/invariants-fuzz.test.ts`, §11.11 "调用点"; the fuzz items of the step-6 owed list).
 *
 * Two worlds, each driven by a fixed set of seeds through a seeded PRNG (tests/scenarios/support/fuzz.ts):
 *
 * 1. The Host world (`HostFuzz`): the real Host over HTTP on one SQLite ledger and Kernel store, the AG2b Goal
 *    with two required work Tasks and the gate, a scripted model whose replies the PRNG fills in during each call.
 *    Operations: Workflow steps one perform at a time (claim, prepare, `start` = authorize + begin + enter + the
 *    Turn to its terminal, open round, start check and its result, finalize = join, complete Task and Goal, the
 *    automation's requeue and reverify), with controls and Goal pauses inside Turns; Run controls (with delivery
 *    and re-entry); requeue by a person (`tasks/requeue`), the automation and the Goal-resume continuation forged
 *    as the fan-out actor (owner calls) and an Agent (refused by the Host grant); reverify by a person and the
 *    automation (work and gate chains, with a note, `newInputRefs`, `onlyIfSourceChanged`); `automation/save` (cap
 *    0..10, re-drive switch); W16 changing one disposition or adding a carrier, by a person and the automation; Goal
 *    pause, resume (GOAL-29 continuation; through the owner alone now and then) and cancel; workspace edits;
 *    consultation replies to wait messages; replays of earlier performs; restarts (clean, or a crash that abandons
 *    the Host) with the start-up reconcile and the re-drive (`resumeOnStartup` random) settled, and the crash points:
 *    mid-Turn (W-11/W-12), mid-check (C-01), paused at a safe point (RUN-24, RUN-23), the Goal fan-out pause
 *    (GOAL-29), the Kernel store lost (W-14, then RUN-22), an authorization without begin (W-02). Every seed also
 *    runs three directed operations once: the guard 9 cycle (every carrier stopped by a person, then the automation
 *    adds one), the human-stop cycle (a person stops a Run; the automation's requeue, its reverify and the Workflow
 *    must not rework it) and a person's Goal cancel three operations before the end. One seed set runs with a
 *    `kind:'system'` Host actor (still an operator).
 * 2. The agent-grant world (`AgentFuzz`): the R3e evidence fixture on SQLite (it holds the B2 execution fixture)
 *    with Agent Runs entered under the rework and plan-write grant (GAP-46: only the domain fixture reaches a
 *    committed Agent write). Operations: the target Run's terminal (a completed one now and then paused by a person
 *    first), controls (person, automation), requeue by a person, the automation, the Agent of the Goal and an Agent
 *    of another Goal, the requeue claim, the executor's rounds (open, check, result, finalize), reverify by the three
 *    classes on G1's chain and the R3e static-check chain, Goal pause/resume and a cancel near the end, cap and
 *    source changes, W16 disposition changes by the three classes, guard 9 in sequence, and two-writer commit races
 *    in one read window: requeue ∥ W16 (§3.3 point 2), requeue ∥ requeue (§11.15), carrier adoption ∥ a person's pause
 *    (guard 9), W16 ∥ a person's control of the changed Task's Run (PLAN-05).
 *
 * After every operation that changes records, I-1..I-22 run on the whole store (`checkAllInvariants` with the
 * previous world and the step's `FuzzStep`; a `legacy` finding fails too: every store starts empty). Beyond the
 * invariants each operation asserts what the spec names for it: a refusal or a replay out of a Turn writes nothing;
 * a system or agent rework of work a person stopped commits nothing and is `forbidden` (hard limit 3); guard 9; a
 * non-person resume of a Goal a person paused is `forbidden`; the forged continuation's epochs; the Workflow's
 * rework after a refusal only once it is stale (ND-8); the races' outcomes. A failure prints the seed and every
 * operation up to it (enough to replay the seed). The coverage case reports how often each operation kind actually
 * ran and fails when a kind of the row never ran.
 *
 * Scripted model replies only; no real model is called.
 */
import { afterEach, expect, it } from 'vitest';
import { cleanupScenarios } from '../scenarios/harness.js';
import { AgentFuzz, HostFuzz, OpCounts } from '../scenarios/support/fuzz.js';

afterEach(cleanupScenarios);

/** Every seed's counts, merged (the coverage case reads them). */
const total = new OpCounts();
const SEEDS_RUN: string[] = [];
/** GOAL-08 (§2 `goal_completed`): every `complete_goal` the Workflow proposed that was refused `revision_conflict`, by seed. */
const GOAL_COMPLETION_CONFLICTS: string[] = [];

/**
 * The Host world seeds (chosen from seeds 1–30 so that together they cover every kind below): seed 4 reaches the gate
 * chain and reverifies it, seed 25 the GOAL-29 continuation through the route, seed 15 an `outcome_unknown` end
 * (W-14), seed 11 the brief sequence and the forged continuation with the right epochs, seed 20 a yielded wait, its
 * reply and the forged continuation on a Run no fan-out pause stopped, seed 1 a re-completion after a new Plan (GOAL-08).
 * The last runs with a `kind:'system'` Host actor.
 */
const HOST_SEEDS = [{ seed: 1, system: false }, { seed: 4, system: false }, { seed: 11, system: false }, { seed: 15, system: false },
  { seed: 25, system: false }, { seed: 20, system: true }];
const HOST_OPERATIONS = 40;
/**
 * The agent-grant world seeds (chosen from seeds 1–60 so that together with the Host seeds they cover every kind
 * below): seed 16 has the Agent's requeue and reverify of a Run a person paused refused by the fence, seed 43 reaches
 * `verification_uncovered` on G1's chain, seed 14 commits an Agent requeue and Agent W16s, seed 4 brings the three
 * owner-level races to the commit with both writers, seed 23 the requeue ∥ W16 race with W16 committing first.
 */
const AGENT_SEEDS = [4, 14, 16, 23, 43];
const AGENT_OPERATIONS = 40;

it.each(HOST_SEEDS)('Host world, seed $seed (system Host actor: $system): every operation keeps I-1..I-22', async ({ seed, system }) => {
  const fuzz = await HostFuzz.open({ seed, operations: HOST_OPERATIONS, systemHostActor: system });
  const started = performance.now();
  try {
    await fuzz.run();
  } finally {
    await fuzz.dispose();
    console.log(`Host seed ${seed}: ${fuzz.gate.checks} invariant checks (${fuzz.gate.spent} ms, ${fuzz.gate.skipped} skipped) in `
      + `${Math.round(performance.now() - started)} ms; time by operation ${JSON.stringify(fuzz.timings.sorted())}\n${fuzz.log.join('\n')}\n`
      + `seed counts H${seed}: ${JSON.stringify(fuzz.counts.sorted())}`);
  }
  total.merge(fuzz.counts);
  GOAL_COMPLETION_CONFLICTS.push(...fuzz.goalCompletionConflicts.map((conflict) => `Host seed ${seed}, ${conflict}`));
  SEEDS_RUN.push(`H${seed}`);
}, 240_000);

it.each(AGENT_SEEDS)('agent-grant world, seed %i: every operation keeps I-1..I-22', async (seed) => {
  const started = performance.now();
  const fuzz = await AgentFuzz.open({ seed, operations: AGENT_OPERATIONS });
  try {
    await fuzz.run();
  } finally {
    await fuzz.close();
    console.log(`agent-grant seed ${seed}: ${fuzz.gate.checks} invariant checks (${fuzz.gate.spent} ms, ${fuzz.gate.skipped} skipped) in `
      + `${Math.round(performance.now() - started)} ms\n${fuzz.log.join('\n')}\nseed counts A${seed}: ${JSON.stringify(fuzz.counts.sorted())}`);
  }
  total.merge(fuzz.counts);
  SEEDS_RUN.push(`A${seed}`);
}, 120_000);

/**
 * GOAL-08 (§2: `goal_completed` pins GoalPhase@r). Nothing writes between the Workflow's read and the
 * `complete_goal` the fuzz sends at once, so a refusal `revision_conflict` means the Workflow pinned a GoalPhase
 * revision it did not read (after a re-plan of a completed Goal the GoalPhase is @1, so a pin of 0 is stale). Reads
 * what the Host seeds above recorded, so it needs the whole file.
 */
it('GOAL-08: a complete_goal the Workflow proposes is never refused revision_conflict (re-completion after a new Plan)', () => {
  console.log(`complete_goal outcomes: ${JSON.stringify(Object.fromEntries([...total.byKey].filter(([key]) => key.startsWith('goal-completion:'))))}`);
  expect(GOAL_COMPLETION_CONFLICTS, 'complete_goal refused revision_conflict (GOAL-08)').toEqual([]);
});

/** The kinds of the row (and of §11.11's list) and the counts that show each actually ran; `optional` ones are reported only. */
const COVERAGE: ReadonlyArray<{ kind: string; keys: RegExp; optional?: true }> = [
  { kind: '领取 claim', keys: /^event:TaskClaimed$|^claim-requeued:committed$/ },
  { kind: '授权 authorize (RUN-02)', keys: /^event:ExecutionEntryAuthorized$/ },
  { kind: 'begin (RUN-04)', keys: /^event:ExecutionEntryBegun$/ },
  { kind: '进入 enter', keys: /^event:ExecutionEntryEntered$/ },
  { kind: '终态 completed', keys: /^seen:run:ended:completed$/ },
  { kind: '终态 cancelled', keys: /^seen:run:ended:cancelled$/ },
  { kind: '终态 crashed (interrupted, run failure, attested)', keys: /^seen:run:ended:crashed$/ },
  { kind: '终态 yielded', keys: /^seen:run:ended:yielded$/ },
  { kind: '终态 budget_exhausted', keys: /^seen:run:ended:budget_exhausted$/ },
  { kind: '终态 outcome_unknown (W-14)', keys: /^seen:run:ended:outcome_unknown$/ },
  { kind: '控制 pause', keys: /^control:pause:(human:|system:)?committed/ },
  { kind: '控制 resume', keys: /^control:resume:(human:|system:)?committed/ },
  { kind: '控制 cancel', keys: /^control:cancel:(human:|system:)?committed/ },
  { kind: '控制 steer', keys: /^control:steer:(human:|system:)?committed/ },
  { kind: '模拟重启 crash (HL-03)', keys: /^restart:crash:/ },
  { kind: '模拟重启 clean (HL-01)', keys: /^restart:clean:/ },
  { kind: '重启 RUN-19 (W-11)', keys: /^reconcile:run:W-11:/ },
  { kind: '重启 RUN-24 (W-20, paused-interrupted)', keys: /^fact:run:interrupted_clean:paused:/ },
  { kind: '重启 RUN-23 / W-12 (cancelled, clean Turn)', keys: /^fact:run:interrupted_clean:plain:cancelled$/ },
  { kind: '启动重驱 (resumeOnStartup)', keys: /^redrive:started$/ },
  { kind: '接续说明序列 requeue → 领取 → prepare → 授权 → 重启 (I-19)', keys: /^brief-sequence:restarted/ },
  { kind: '… → 重驱 (the start-up re-drive takes the authorized Run on)', keys: /^brief-sequence:restarted:redriven$/ },
  { kind: '开轮 open round', keys: /^event:VerificationRoundOpened$|^verify:(g1|r3e):open:committed$/ },
  { kind: '起检 begin check', keys: /^event:VerificationCheckBegun$/ },
  { kind: '结果 check result', keys: /^event:VerificationCheckResultRecorded$/ },
  { kind: '中断 check interrupted (VR-04)', keys: /^fact:check:interrupted:host_restart$/ },
  { kind: '汇合 finalize', keys: /^event:VerificationRoundFinalized$/ },
  { kind: '完成 Task', keys: /^event:TaskCompleted$/ },
  { kind: '完成 Goal', keys: /^event:GoalCompleted$/ },
  { kind: 'requeue human', keys: /^fact:requeue:human:/ },
  { kind: 'requeue system (WORKFLOW_AUTOMATION_ACTOR)', keys: /^fact:requeue:system:(?!.*goal_resume)/ },
  { kind: 'requeue system (GOAL_FAN_OUT_ACTOR, GOAL-29)', keys: /^fact:requeue:system:interrupted:paused:goal_resume$/ },
  { kind: 'requeue agent', keys: /^fact:requeue:agent:/ },
  { kind: '继续 (a person continues a paused-interrupted Run)', keys: /^fact:requeue:human:interrupted:paused$/ },
  { kind: 'the GOAL-29 continuation forged with the right epochs (continues the fan-out-paused Run)', keys: /^forged:right:fan-out-paused:committed$/ },
  { kind: 'the forged continuation with a moved or another epoch (refused)', keys: /^forged:(stale-resume|wrong-pause):fan-out-paused:rejected:/ },
  { kind: 'the forged continuation on a Run no fan-out pause stopped (forbidden)', keys: /^forged:[a-z-]+:fence-[a-z_]+:rejected:forbidden$/ },
  { kind: '拒绝 policy refusal (requeue)', keys: /^fact:refusal:requeue:/ },
  { kind: '拒绝 budget_not_increased', keys: /^fact:refusal:requeue:budget_not_increased@/ },
  { kind: '拒绝 auto_rework_cap_reached', keys: /^fact:refusal:(requeue|reverify):auto_rework_cap_reached@/ },
  { kind: '拒绝 no_new_basis', keys: /^fact:refusal:(requeue|reverify):no_new_basis@/ },
  { kind: '拒绝 source_unchanged', keys: /^fact:refusal:reverify:source_unchanged@/ },
  { kind: '拒绝 verification_uncovered', keys: /^fact:refusal:reverify:verification_uncovered@/ },
  // `forbidden` by its reason (`forbiddenKind`): the human-stop fence itself, not an earlier refusal of the caller.
  { kind: '拒绝 forbidden: system requeue of work a person stopped (hard limit 3)', keys: /^forbidden:requeue:system:fence$/ },
  { kind: '拒绝 forbidden: system reverify of work a person stopped', keys: /^forbidden:reverify:system:fence$/ },
  { kind: '拒绝 forbidden: agent requeue of work a person stopped', keys: /^forbidden:requeue:agent:fence$/ },
  { kind: '拒绝 forbidden: agent reverify of work a person stopped', keys: /^forbidden:reverify:agent:fence$/ },
  { kind: '拒绝 forbidden: an Agent of another Goal', keys: /^forbidden:(requeue|reverify):agent:other-goal$/ },
  // The Host's Runtime grant (GAP-46) refuses an Agent requeue only from an entered Run (in a Turn); the committed and
  // fenced Agent requeues are the agent-grant world's.
  { kind: '拒绝 forbidden: the Host grant (GAP-46)', keys: /^forbidden:requeue:agent:grant$/, optional: true },
  { kind: '拒绝 Goal not active (busy)', keys: /^requeue:(human|system|agent):rejected:busy$/ },
  { kind: '拒绝 stale afterRunRef (revision_conflict)', keys: /^requeue:(human|system|agent):rejected:revision_conflict$/ },
  { kind: '拒绝 refusals write nothing (checked)', keys: /^zero-write-refusal:checked$/ },
  { kind: 'refused or replayed Workflow performs write nothing (checked)', keys: /^zero-write-perform:/ },
  { kind: 'the Workflow reworks after a refusal only once it is stale (ND-8; checked on a retry)', keys: /^wf-rework:after-refusal:/, optional: true },
  { kind: '上限变更 cap change', keys: /^cap:(saved|changed)$/ },
  { kind: 'reverify (work chain)', keys: /^fact:reverify:work:/ },
  { kind: 'reverify (gate chain)', keys: /^fact:reverify:gate:/ },
  { kind: 'reverify by an Agent (a committed successor)', keys: /^fact:reverify:(work|gate):agent:/ },
  { kind: 'reverify by an Agent at the cap (committed auto_rework_cap_reached)', keys: /^reverify:agent:(g1|r3e):refused:auto_rework_cap_reached$/ },
  { kind: 'reverify refusal', keys: /^fact:refusal:reverify:/ },
  { kind: '只改处置的 W16 by a person', keys: /^fact:disposition:human:/ },
  { kind: '只改处置的 W16 by the automation', keys: /^fact:disposition:system:/ },
  { kind: '只改处置的 W16 by an Agent', keys: /^fact:disposition:agent:/ },
  { kind: 'W16 adds a carrier (a person)', keys: /^w16:human:carrier:committed$/ },
  { kind: 'guard 9: an automatic carrier adoption with every carrier fenced is forbidden', keys: /^guard9:(system|agent):carrier-only:rejected:forbidden$/ },
  { kind: 'the human-stop cycle (requeue, reverify and the Workflow do not rework)', keys: /^human-stop-cycle:done$/ },
  { kind: 'Goal 控制 pause', keys: /^goal:pause:(human:)?committed$/ },
  { kind: 'Goal 控制 resume', keys: /^goal:resume:(human:)?committed$/ },
  { kind: 'Goal resume by the automation, the fan-out actor or an Agent (forbidden)', keys: /^goal:resume(-by-[a-z-]+|:system|:agent):rejected:forbidden$/ },
  { kind: 'Goal 控制 cancel', keys: /^goal:cancel:committed$/ },
  { kind: 'Goal cancel during a Turn (the cancel fan-out)', keys: /^goal-cancel:cancelled:in-Turn$/ },
  { kind: 'after the Goal cancel: a requeue is busy, a W16 invalid', keys: /^goal-cancel:(requeue:rejected:busy|w16:(proposal:)?rejected:invalid)$/ },
  { kind: '恢复后的接续 (GOAL-29)', keys: /^goal-continuation:requeued$/ },
  { kind: '发信 send (wait)', keys: /^event:SessionMessageSent$/ },
  { kind: '回复 reply', keys: /^reply:responded$/ },
  { kind: 'race requeue ∥ refusal in one window', keys: /^race-requeue-refusal:2:/ },
  { kind: 'race carrier adoption ∥ pause in one window (guard 9)', keys: /^race-carrier-pause:2:/ },
  { kind: 'race requeue ∥ W16 in one window', keys: /^race-requeue-w16:2:/ },
  { kind: 'race W16 ∥ a person\'s control (PLAN-05; how far each writer got)', keys: /^race-w16-control:[0-9]:/ },
  { kind: '… both reached the commit', keys: /^race-w16-control:2:/, optional: true },
];

/**
 * Needs the whole file: it reads what the seed cases recorded. When some seed did not finish (a filtered run, or a
 * seed that failed and reported itself), it only reports.
 */
it('coverage: every kind of operation the row lists actually ran (counts merged over the seeds)', () => {
  const count = (keys: RegExp): number => [...total.byKey].reduce((sum, [key, value]) => sum + (keys.test(key) ? value : 0), 0);
  const table = COVERAGE.map(({ kind, keys, optional }) => ({ kind, count: count(keys), optional: optional === true }));
  const complete = SEEDS_RUN.length === HOST_SEEDS.length + AGENT_SEEDS.length;
  console.log(`fuzz coverage over ${SEEDS_RUN.join(', ')}${complete ? '' : ' (not every seed finished: reported only)'}:\n`
    + `${table.map((row) => `  ${String(row.count).padStart(5)}  ${row.kind}${row.optional ? ' (reported only)' : ''}`).join('\n')}\n`
    + `all counts:\n${JSON.stringify(total.sorted(), null, 1)}`);
  if (!complete) return;
  expect(table.filter((row) => !row.optional && row.count === 0).map((row) => row.kind), 'kinds that never ran').toEqual([]);
});
