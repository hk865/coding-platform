/**
 * Group Q (slice 2A) QA-17: one Goal with more Runs than the old shared
 * `readLookupKeys` window still computes its reason card.
 *
 * DEVIATION from L-fixtures (UNSPECIFIED, proposed third exception; coordinator
 * ruled the seeded fixture acceptable only if the public path is infeasible
 * within P12's 600 s). The public path WAS tried: a new Goal Q17 + a 5,001-task
 * Plan (proposePlan/applyPlanChange) + one `createTaskClaimService.claimTask`
 * per task via `f.claimRun` with a fresh Session each. It produced the
 * `change_pending` cause correctly, but the 5,001 claims took 830,529 ms on
 * memory (plan build 218 ms, `queryGoalDisplay` 1,133 ms) — because every claim
 * re-reads the Goal's whole Run set, which 2A reads to the end (O(n^2)). This is
 * far beyond P12's 600 s, so the 5,000 extra rows are committed once at the
 * fixture's storage boundary as valid `RunSnapshot@1` records cloned from the
 * real Run RA; every ASSERTION goes through the public queue read.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { GOAL_B, OPERATOR, openS5DecisionFixture, type S5DecisionFixture } from '../helpers/S5-decision-fixture.js';
import { ready, owners } from '../helpers/S5-application-support.js';
import { recordAt } from '../helpers/S5-application-support.js';
import { S2A_SCALE_TIMEOUT_MS } from '../helpers/S2A-queue-fixture.js';

const EXTRA_RUNS = 5_000;

/** Hand-computed `change_pending` reason key of the fixture's Goal B (literal). */
const B_CHANGE_PENDING = '{"affected":[{"ref":{"aggregateType":"PlanProposal","projectId":"P","proposalId":"plan-proposal-079880d9c059786361b3a930cb78a292","workspaceId":"W"},"revision":1}],'
  + '"code":"change_pending","goalRef":{"aggregateType":"Goal","goalId":"B","projectId":"P"},"kind":"goal_cause"}';

describe.each(['memory', 'sqlite'] as const)('S2A queue goal runs (%s)', (kind) => {
  const opened: S5DecisionFixture[] = [];
  afterEach(async () => { for (const f of opened.splice(0)) await f.close(); });
  const open = async () => {
    const f = await openS5DecisionFixture(kind, { operatorActor: { ...OPERATOR } });
    opened.push(f);
    return f;
  };

  it('QA-17 - a Goal with 5001 Runs still yields its hand-computed reason card, no incomplete', async () => {
    const f = await open();
    const source = await recordAt(f.records, f.runRA.ref);
    const base = JSON.parse(source.json) as RunSnapshot;
    for (let index = 0; index < EXTRA_RUNS; index += 1) {
      const runId = `S2AQ17-${String(index)}`;
      const run: RunSnapshot = { ...base, ref: { ...base.ref, runId } };
      const receipt = await f.seedCommit([{ refKey: canonicalJson(run.ref as unknown as JsonValue),
        schemaId: 'RunSnapshot@1', revision: run.revision, json: JSON.stringify(run) }]);
      if (receipt.status !== 'committed') throw new Error(`Run seed failed: ${JSON.stringify(receipt)}`);
    }
    const queue = ready(await owners(f).reads.queryDecisionQueue(f.ctx, { workspace: { projectId: 'P', workspaceId: 'W' },
      goalRef: GOAL_B, sections: ['waiting_answer'], page: { limit: 50 } }));
    const goalCauses = queue.waitingAnswer.filter((card) => card.source.kind === 'goal_cause');
    expect(goalCauses.map((card) => card.source.key)).toEqual([B_CHANGE_PENDING]);
  }, S2A_SCALE_TIMEOUT_MS);
});
