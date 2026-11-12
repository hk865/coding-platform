/**
 * B06 G1 codec row (G1 start rulings 11-12 §1 item 3, §2; realign question 7; L2: type only, no path check). A draft
 * through the public `plans/propose` whose witness requirement carries `requiredReadPaths` as one string is refused
 * `invalid`, naming the field; the same draft with an array under the same requestId then commits (the type was the
 * one error, and the refusal left nothing to replay). World `openS6ARequestWorld`, memory only (S3).
 * Mutation: drop the new type check in `plan-record-codecs.ts` `obligationIssues` (the first call commits; red).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { openS6ARequestWorld, S6A_GOAL_1, S6A_SCOPE, type S6ARequestWorld } from '../helpers/S6A-request-fixture.js';
import { ag2bPlanDraft, graphWrite } from '../helpers/AG2b-collaboration-fixture.js';

const worlds: S6ARequestWorld[] = [];
afterEach(async () => { await Promise.all(worlds.splice(0).map(world => world.close())); });

const proposeWitnessDraft = (world: S6ARequestWorld, requiredReadPaths: unknown) => world.post('plans/propose', graphWrite(S6A_SCOPE, {
  goalRef: S6A_GOAL_1, basedOn: null,
  draft: { ...ag2bPlanDraft(['sb06-work']), planId: 'sb06-plan', goalId: S6A_GOAL_1.goalId,
    obligations: [{ obligationId: 'sb06-obligation', title: 'Explore the source', requirementLevel: 'required',
      taskIds: ['sb06-work'], verificationRequirements: [{ requirementId: 'sb06-witness', requirementLevel: 'required',
        kind: 'witness', description: 'The report read the named source', requiredReadPaths }] }] },
  reason: { text: 'SB06 a witness requirement with its read paths', sources: [] },
}, 'sb06-propose'));

describe('SB06 codec: requiredReadPaths must be an array of strings', () => {
  it('refuses one string through plans/propose, then commits the same draft with an array', async () => {
    const world = await openS6ARequestWorld({ backend: 'memory' });
    worlds.push(world);
    const refused = (await proposeWitnessDraft(world, 'src/a.ts')).body as { status: string; code?: string; reason?: string };
    expect(refused).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect(refused.reason).toContain('obligations[0].verificationRequirements[0].requiredReadPaths');
    expect((await proposeWitnessDraft(world, ['src/a.ts'])).body).toMatchObject({ status: 'committed' });
  });
});
