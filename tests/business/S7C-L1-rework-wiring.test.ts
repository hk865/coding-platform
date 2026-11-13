/**
 * L1-rework-wiring (`book-7c.md:1375`; A-05/B-07; §3.7 item 2): a real Work Run of a rework-capable line is
 * offered `request_rework` and `request_recheck` before the model, and the real tool call commits its owner
 * receipt, which replays by identity through the composed `lookupToolCommit`.
 *
 * The line is the L46 world's Work binding; its two names are installed at open by the helper's caller-grant
 * wrapper (no live-Host patch and no second world). The Run starts through `workflow/advance` and the scripted
 * tool is released at the real gate. The receipt sub-row runs on both backends (a receipt replay is a storage
 * row); the offer is the same run, so both backends also prove the prepared envelope and the adapter.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as lookupModule from '../../src/composition/tool-commit-lookup.js';
import type { ToolCommitLookup, ToolCommitLookupInput } from '../../src/contracts/unknown-call-review.js';
import type { DecisionQueueReadV1 } from '../../src/core/work-graph/model/decision-contracts.js';
import { finalToolNamesOf, type FinalToolListInputV1 } from '../../src/core/agent-runtime/tool-group-assembly.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { openS7BL46World, requestL46Rework } from '../helpers/S7B-L46-fixture.js';
import { committed, ready } from '../helpers/S7A-fixture.js';

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

describe('L1-rework-wiring: the rework tool names and their receipts', () => {
  it.each(['memory', 'sqlite'] as const)(
    'a real Work Run is offered both names and its request_rework receipt replays by identity (%s)', async backend => {
      // Capture the composition's own lookup: the real factory over the real owners, not a second dispatch.
      const realFactory = lookupModule.createToolCommitLookup;
      let lookup: ToolCommitLookup | undefined;
      const spy = vi.spyOn(lookupModule, 'createToolCommitLookup').mockImplementation((...args) => {
        const built = realFactory(...args);
        lookup = built;
        return built;
      });
      try {
        const opened = await openS7BL46World({ backend });
        worlds.push(opened.world);

        const rework = await requestL46Rework(opened.world, { goalRef: opened.goalRef,
          tasks: { A: opened.tasks.A, B: opened.tasks.B }, afterRun: opened.run,
          label: `s7c-l1-rework-${backend}`, reason: 'L1-rework-wiring: request the rework of A' });

        // The accepted envelope proves both known names were selected and declared before the model.
        expect(rework.execution.run.envelope?.permissions.tools).toEqual(expect.arrayContaining([
          'request_rework', 'request_recheck']));
        expect(rework.call.name).toBe('request_rework');

        // The same two names selected on a Query are not in the final list: the
        // declared list agrees with the Query factory that never builds them.
        const queryFinal = finalToolNamesOf({
          callKind: 'query', noteAdmission: { class: 'none' }, selected: ['request_rework', 'request_recheck'],
          reviewPhase: null, hasBlockedCommands: false,
          reviewSource: false, frozenSource: false, materialTools: false,
          owners: { mailbox: true, decisionMessages: true, applicationReceipt: true, sessions: true,
            plans: true, graph: true, notes: true, unknownCallReviews: true, commandRerunRequests: true,
            memberCreation: true, reworkRequests: true, recheckRequests: true },
          readonlyCommand: { requested: false, access: undefined, allowsReadWholeWorkspace: false },
        } satisfies FinalToolListInputV1);
        expect(queryFinal.ok).toBe(true);
        if (!queryFinal.ok) return;
        expect(queryFinal.value).not.toEqual(expect.arrayContaining(['request_rework', 'request_recheck']));

        // The adapter resolved: the real tool wrote R's pending request, read back through the public queue.
        const queue = ready<DecisionQueueReadV1>(await opened.world.post('decisions/queue', plain(S6A_SCOPE, {
          workspace: S6A_SCOPE, goalRef: opened.goalRef, sections: ['waiting_answer'], page: { limit: 100 },
        })), 'the L46 queue');
        expect(queue.waitingAnswer.some(card => card.source.kind === 'rework_request')).toBe(true);

        // The receipt replays by identity: the same Kernel call and arguments answer the committed receipt.
        if (lookup === undefined) throw new Error('L1-rework-wiring: the composed lookup was not captured');
        const input: ToolCommitLookupInput = {
          toolName: 'request_rework', arguments: rework.call.arguments, kernelCallId: rework.call.callId,
          // `generation` is not read by the rework owner's identity; the run, session, workspace and callId are.
          origin: { runRef: rework.execution.run.ref, sessionRef: rework.line.ref, generation: 0,
            workspaceId: S6A_SCOPE.workspaceId },
        };
        const first = await lookup(opened.world.systemContext(), input);
        expect(first.status).toBe('committed');
        if (first.status !== 'committed') {
          throw new Error(`L1-rework-wiring: the rework receipt is not committed: ${JSON.stringify(first)}`);
        }
        expect(first.eventIds.length).toBeGreaterThan(0);
        const again = await lookup(opened.world.systemContext(), input);
        expect(again).toEqual(first);

        // The same real Work Run origin answers the member and withdraw rows: a
        // well-formed but uncommitted identity is `not_committed`, never
        // `lookup_not_published` (the owner slot and the withdraw arm are wired).
        const memberAttempt = await lookup(opened.world.systemContext(), {
          toolName: 'create_member',
          arguments: { duty: 'executor', scope: { kind: 'task', task: opened.tasks.C },
            reason: 'L1-rework-wiring: member lookup only' },
          kernelCallId: 's7c-l1-member-lookup', origin: input.origin,
        });
        expect(memberAttempt.status).toBe('not_committed');
        const sent = committed<{ ref: unknown }>(await opened.world.post('messages/send', graphWrite(S6A_SCOPE, {
          recipient: rework.line.ref, text: 'L1-rework-wiring: withdraw lookup', intent: 'notify',
        }, 's7c-l1-withdraw-lookup')), 'the withdraw lookup message');
        const withdrawAttempt = await lookup(opened.world.systemContext(), {
          toolName: 'withdraw_session_message', arguments: { messageRef: sent.ref },
          kernelCallId: 's7c-l1-withdraw-lookup', origin: input.origin,
        });
        expect(withdrawAttempt.status).toBe('not_committed');
      } finally {
        spy.mockRestore();
      }
    });
});
