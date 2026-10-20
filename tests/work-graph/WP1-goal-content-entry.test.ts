/**
 * Wiring package 1, W15 (spec §3 W1-CTX-01, §4.3, L2-L4): the Goal-content
 * check between a prepared Work context and the entry.
 *
 * GE01-GE07 run once per backend. Every given comes from the real prepared
 * entry fixture (`openGoalContentEntry`); GE02/GE03/GE06 replace only the
 * hand-made unbound manifest body (allowed by §5.1), never a database record.
 *
 * GE01 compares the prepared Goal digest with the production
 * `goalContextDigestV1` (itself a `not implemented` stub in part 1, so GE01
 * fails on that throw). GE02/GE06 need a wrong Goal digest only to build their
 * givens, so they compute the §2.1 formula locally instead of calling the
 * throwing stub.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex, type JsonValue } from '../../src/contracts/fingerprint.js';
import { goalContextDigestV1, type ContextAssemblyBindingV1, type ContextSourceV1 } from '../../src/contracts/graph-context.js';
import type { GoalSnapshot } from '../../src/contracts/ledger.js';
import type { PlanRevisionRef } from '../../src/contracts/plan.js';
import {
  adoptUnrelatedPlan, makeUnboundGoalPrepared, openGoalContentEntry, revokeUnentered,
  type GoalContentEntryFixture,
} from '../helpers/WP1-entry-fixture.js';

function key(value: object): string { return canonicalJson(value as unknown as JsonValue); }

/** §2.1 `goalContextDigestV1` content, computed locally (see the file header). */
function goalDigest(goal: Pick<GoalSnapshot, 'ref' | 'objective' | 'workspaceRef'>, objective = goal.objective): string {
  return sha256Hex(canonicalJson({
    contentVersion: 1, goalId: goal.ref.goalId, objective,
    workspaceId: goal.workspaceRef.workspaceId,
  } as unknown as JsonValue));
}

function goalSource(binding: ContextAssemblyBindingV1, goal: GoalSnapshot): ContextSourceV1 | undefined {
  return binding.sources.find(source => source.kind === 'record' && key(source.ref) === key(goal.ref));
}

function goalSourceDigest(binding: ContextAssemblyBindingV1, goal: GoalSnapshot): string | null {
  const source = goalSource(binding, goal);
  if (source === undefined || source.kind !== 'record') {
    throw new Error(`the prepared binding has no ${goal.ref.goalId} Goal record source`);
  }
  return source.digest;
}

describe.each(['memory', 'sqlite'] as const)('WP1 goal-content entry (%s)', (kind) => {
  let fixture: GoalContentEntryFixture | undefined;
  afterEach(async () => {
    const current = fixture;
    fixture = undefined;
    if (current !== undefined) await current.close();
  });

  it('GE01 commits and the prepared Goal source digest is the current Goal content digest', async () => {
    const f = await openGoalContentEntry(kind);
    fixture = f;
    const result = await f.authorize(f.prepared, 'ge01');
    expect(result.status).toBe('committed');
    expect(goalSourceDigest(f.binding, f.goal)).toBe(goalContextDigestV1(await f.readGoal()));
  });

  it('GE02 refuses an unbound manifest whose Goal digest changed, with zero write', async () => {
    const f = await openGoalContentEntry(kind);
    fixture = f;
    const made = await makeUnboundGoalPrepared(f, { goalDigest: goalDigest(f.goal, 'other') });
    const beforeRun = await f.readRun();
    const beforePin = await f.runPin();
    const result = await f.authorize(made.prepared, 'ge02');
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error(`GE02 expected a rejection: ${JSON.stringify(result)}`);
    expect(result.code).toBe('revision_conflict');
    expect(result.reason.startsWith('context_goal_changed:')).toBe(true);
    expect((await f.readRun()).revision).toBe(beforeRun.revision);
    expect(await f.runPin()).toEqual(beforePin);
    expect(f.authorizedEvents()).toEqual([]);
  });

  it('GE04 admits after an unrelated plan adoption, audits P2 and keeps a non-empty Goal digest', async () => {
    const f = await openGoalContentEntry(kind);
    fixture = f;
    const adopted: PlanRevisionRef = await adoptUnrelatedPlan(f);
    const result = await f.authorize(f.prepared, 'ge04');
    expect(result.status).toBe('committed');
    expect(f.activePlanRefs()).toEqual([adopted]);
    const digest = goalSourceDigest(f.binding, f.goal);
    expect(digest).not.toBeNull();
    expect((digest ?? '').length).toBeGreaterThan(0);
  });

  it('GE05 re-authorizes the same fixed binding after a real RUN-16 revocation', async () => {
    const f = await openGoalContentEntry(kind);
    fixture = f;
    const first = await f.authorize(f.prepared, 'ge05-first');
    expect(first.status).toBe('committed');
    if (first.status !== 'committed') throw new Error(`GE05 expected the first authorization to commit: ${JSON.stringify(first)}`);
    const revoked = await revokeUnentered(f, first);
    const second = await f.entry.authorizeRuntimeEntry(f.ctx, revoked.request);
    expect(second.status).toBe('committed');
    expect(await f.entryGeneration()).toBe(2);
  });

  it('GE06 rejects a wrong Workspace revision before the Goal-content check', async () => {
    const f = await openGoalContentEntry(kind);
    fixture = f;
    const made = await makeUnboundGoalPrepared(f, {
      goalDigest: goalDigest(f.goal, 'other'),
      workspaceRevision: f.prepared.envelope.workspaceSnapshot.revision + 1,
    });
    const result = await f.authorize(made.prepared, 'ge06');
    expect(result.status).toBe('rejected');
    if (result.status !== 'rejected') throw new Error(`GE06 expected a rejection: ${JSON.stringify(result)}`);
    expect(result.code).toBe('revision_conflict');
    expect(result.reason).toBe('the assembled context named another Workspace revision');
  });

  it('GE07 replays the identical authorization request with the original cursor', async () => {
    const f = await openGoalContentEntry(kind);
    fixture = f;
    const first = await f.authorize(f.prepared, 'ge07');
    const second = await f.authorize(f.prepared, 'ge07');
    expect(first.status).toBe('committed');
    expect(second.status).toBe('committed');
    if (first.status !== 'committed' || second.status !== 'committed') {
      throw new Error(`GE07 expected two commits: ${JSON.stringify({ first, second })}`);
    }
    expect(second.replayed).toBe(true);
    expect(second.cursor).toEqual(first.cursor);
  });
});
