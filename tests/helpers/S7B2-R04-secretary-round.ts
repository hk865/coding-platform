/**
 * One real memory Host with a secretary, a notify to the secretary and one real request round.
 * Every step is a public route (`messages/send`, `requests/submit`, `messages/read`); the opener is the secretary
 * round world's, so no second Host or request world exists. The one 25 ms consumer supplies the Host heartbeat that
 * the row's barrier observes; it is not a session selector.
 */
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { graphWrite } from './AG2b-collaboration-fixture.js';
import type { S6AHostWorld } from './S6A-host-fixture.js';
import { secretaryAnswer, submitRound as submitHistoryRound } from './S6A-history-fixture.js';
import { S6A_SCOPE, S6A_SECRETARY_PROFILE_ID, type S6ASession } from './S6A-request-fixture.js';
import { committed } from './S7A-fixture.js';
import { readS7BMessage } from './S7B-fixture.js';
import { openS7B2RoundWorld } from './S7B2-secretary-rounds.js';

export type R04World = {
  world: S6AHostWorld;
  secretary: S6ASession;
  /** A real `messages/send` with `intent: 'notify'`, `needsReply: false`; returns the message ref. */
  notify(text: string): Promise<SessionMessage['ref']>;
  /** A real `requests/submit` assigned to `secretary`; returns the queued root and round. */
  submitRound(commandId: string, text: string): Promise<{ requestRoot: QueryJobRef; round: QueryJobRef }>;
  /** `messages/read` of a ref; its `acceptedInputs` is the public acceptance the row asserts. */
  readMessage(ref: SessionMessage['ref']): Promise<SessionMessage>;
};

export async function openR04World(options?: { at?: string }): Promise<R04World> {
  const opened = await openS7B2RoundWorld({
    backend: 'memory',
    ...(options?.at === undefined ? {} : { at: options.at }),
    extraHostOptions: { inputConsumers: [{ scope: S6A_SCOPE,
      sessionRef: { projectId: S6A_SCOPE.projectId, sessionId: 's7b2-consume-period' },
      goalRef: { aggregateType: 'Goal' as const, projectId: S6A_SCOPE.projectId, goalId: 's7b2-consume-period' },
      queryProfileId: S6A_SECRETARY_PROFILE_ID, heartbeatMs: 25 }] },
  });
  const { world, secretary } = opened;

  return {
    world,
    secretary,

    async notify(text) {
      // A host-person notify is filtered out of the request round's notify-only supply, so the helper sends it
      // through the system-context path the accepted round uses.
      const saved = committed<SessionMessage>(await world.dispatch('messages/send', world.systemContext(),
        graphWrite(S6A_SCOPE, {
          recipient: secretary.ref, text, intent: 'notify', needsReply: false, goalRef: world.goals.first,
        }, 's7b2-r04-notify')), 'the R04 notify message');
      return saved.ref;
    },

    async submitRound(commandId, text) {
      // The world's own model is the one the row counts; a per-Session queue would answer the same round without
      // touching that count.
      world.scriptReplies([{ kind: 'text', text: secretaryAnswer({ body: `R04 round answer for ${commandId}` }) }]);
      const { requestRoot, round } = await submitHistoryRound(world, { commandId, goalId: world.goals.first.goalId, text,
        recipient: secretary });
      return { requestRoot, round };
    },

    async readMessage(ref) {
      return await readS7BMessage(world, ref);
    },
  };
}
