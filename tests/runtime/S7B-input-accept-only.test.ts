/**
 * The mailbox input offer is a read, not an acceptance. A real Work Run's real safe point offers the person's
 * ordinary message and supplies nothing else; the public read proves the offer wrote nothing. The person cancels that
 * Run before the Kernel accepts, requeues the Task, and the next real supply carries the same message again, which the
 * real Kernel accepts (the public read records it once). The SAME Run's next real safe point already carries the
 * accepted input id and does not offer it again; neither does a later Run's first safe point.
 * The world, the same-Session Run, the controls, the requeue and the model failure are the frozen fixture's public
 * steps; the only wrapper is on the existing Kernel spy, delegating to the real `inputSupply` unchanged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as kernelModule from '../../vendor/coding-agent/dist/public-api.js';
import type { RunAppInput } from '../../vendor/coding-agent/dist/public-api.js';
import type { WorkflowStepReceipt } from '../../src/business/workflow/contracts.js';
import {
  deriveSessionInputId, type SessionMessage,
} from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionFactsV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import { advanceUntil, deferred, driveWorkflow } from '../helpers/A2-restart-fixture.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import {
  claimedRunOf, committed, openS7AWorkWorld, ready, runS7ASameSessionAgain,
} from '../helpers/S7A-fixture.js';
import { interventionDeliveryText } from '../helpers/S7B-delivery-samples.js';
import { readCall } from '../scenarios/support/common.js';


const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

const BODY = 'S7B accept-only ordinary message';

describe('the mailbox input offer is a read, not an acceptance', () => {
  it.each(['memory', 'sqlite'] as const)('%s: offers the message, writes nothing, then accepts the re-offer once',
    async backend => {
      const { world, goal, line } = await openS7AWorkWorld({ backend });
      worlds.push(world);

      // One delegating wrapper on the existing Kernel spy: the real supply is called unchanged; its first offer of
      // this message is held after it returned, so the person can cancel before the runner accepts.
      const offers: Array<readonly { inputId: string; text: string }[]> = [];
      // The real safe point of every supply call, kept aligned with `offers`, so the same Run's next point can be
      // told from a later Run's first point.
      const supplyPoints: Array<{ runId: string; acceptedInputIds: readonly string[] }> = [];
      const reached = deferred();
      const release = deferred();
      let held = false;
      const kernelSpy = vi.mocked(kernelModule.runCodingAgent);
      const existing = kernelSpy.getMockImplementation();
      if (existing === undefined) throw new Error('the existing Kernel spy is not installed');
      kernelSpy.mockImplementation((input: Readonly<RunAppInput>) => {
        const actual = input.inputSupply;
        if (actual === undefined) return existing(input);
        return existing({ ...input, inputSupply: async (point, options) => {
          const offered = await actual(point, options);
          offers.push(offered);
          supplyPoints.push({ runId: point.runId, acceptedInputIds: [...point.acceptedInputIds] });
          if (!held && offered.some(item => item.inputId === inputId)) {
            held = true;
            reached.resolve();
            await release.promise;
          }
          return offered;
        } });
      });

      // The first real read tool gives Run A its later safe point, where the message is first offered. Run B reads
      // once more after the Kernel accepts, so its NEXT safe point is real and its accepted id is already known; the
      // provider failure is Run B's scripted end. `runS7ASameSessionAgain` appends the closing text.
      const readA = readCall(`s7b-accept-only-read-a-${backend}`);
      const readB = readCall(`s7b-accept-only-read-b-${backend}`);
      if (readA.kind !== 'calls' || readB.kind !== 'calls')
        throw new Error('the shared read helper did not return a tool call');
      await world.scripted.script(line, [readA, readB,
        { kind: 'fail', message: 'S7B accept-only model failure' }]);

      // Run A starts with no message in the inbox; the person sends it while the first model request is held, so the
      // supply after the read tool sees it once the Run has entered. That held supply returns only after the cancel.
      const model = await world.gates.modelRequest(line);
      const firstDrive = runS7ASameSessionAgain(world, line);
      await model.reached;
      const person = committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
        recipient: line.ref, text: BODY, intent: 'action_request', needsReply: true,
      }, `s7b-accept-only-send-${backend}`)), 'the person message');
      const inputId = deriveSessionInputId(person.ref, 'message');
      model.release();
      await reached.promise;

      // The real supply returned the message; the public read proves the offer itself wrote nothing.
      const firstOffer = offers.find(offer => offer.some(item => item.inputId === inputId));
      expect(firstOffer?.map(item => item.inputId)).toContain(inputId);
      expect(firstOffer?.map(item => item.text)).toContain(interventionDeliveryText({
        messageId: person.ref.messageId, body: BODY }));
      const offered = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, person.ref)),
        'the offered message');
      expect(offered.acceptedInputs ?? []).toEqual([]);
      const revision = offered.revision;

      // The live Run and its Task, read publicly while the real supply is paused after returning.
      const facts = ready<SessionFactsV1>(await world.post('sessions/facts', plain(S6A_SCOPE, line.ref)),
        'the Work line facts');
      if (facts.latestWork === null) throw new Error('the second Task has no Run');
      const firstRun = facts.latestWork.runRef;
      const task = facts.latestWork.task;
      const firstRunRead = ready<{ run: { revision: number } }>(await world.post('executions/read',
        plain(S6A_SCOPE, firstRun)), 'the offered Run');

      // The person cancels before acceptance: submit, deliver, then let the held supply return.
      const submitted = committed<{ intent: { ref: unknown } }>(await world.post('controls/submit',
        graphWrite(S6A_SCOPE, { runRef: firstRun, kind: 'cancel', reason: 'accept-only: cancel before acceptance' },
          `s7b-accept-only-cancel-${backend}`, [{ ref: firstRun, revision: firstRunRead.run.revision }])), 'the cancel');
      ready(await world.post('controls/deliver', plain(S6A_SCOPE, { intentRef: submitted.intent.ref })),
        'the cancel delivery');
      release.resolve();
      await firstDrive;
      const runState = async (run: typeof firstRun) => ready<{ run: { status: string; outcome: string; revision: number } }>(
        await world.post('executions/read', plain(S6A_SCOPE, run)), 'the Run').run;
      await expect.poll(async () => `${(await runState(firstRun)).status}/${(await runState(firstRun)).outcome}`,
        { timeout: 10_000, interval: 20 }).toBe('ended/cancelled');
      const firstEnded = await runState(firstRun);
      expect(firstEnded).toMatchObject({ status: 'ended', outcome: 'cancelled' });
      const cancelled = ready<SessionMessage>(await world.post('messages/read', plain(S6A_SCOPE, person.ref)),
        'the message after the cancel');
      expect(cancelled.acceptedInputs ?? []).toEqual([]);
      expect(cancelled.revision).toBe(revision);

      // The person requeues and the Workflow drives the same line and Task again.
      const requeue = async (afterRun: typeof firstRun, ended: { revision: number }, label: string) => {
        const goalRead = ready<{ goal: { revision: number } }>(await world.post('goals/read', plain(S6A_SCOPE, goal)),
          'the Goal');
        committed(await world.post('tasks/requeue', graphWrite(S6A_SCOPE, {
          taskRef: { projectId: S6A_SCOPE.projectId, goalId: goal.goalId, taskId: task.taskId },
          afterRunRef: afterRun, reason: `accept-only: ${label}`,
        }, `s7b-accept-only-requeue-${label}-${backend}`, [
          { ref: goal, revision: goalRead.goal.revision }, { ref: afterRun, revision: ended.revision },
        ])), `the ${label} requeue`);
      };
      const drive = async (label: string) => {
        const select = { schemaVersion: 1 as const, goalRef: goal, flowId: `s7b-accept-only-${label}-${backend}`,
          sessionHint: line.ref, kind: 'select_work' as const, taskId: task.taskId };
        const receipts: WorkflowStepReceipt[] = [];
        await driveWorkflow(world.ag2b, await advanceUntil(world.ag2b, select, 'claim_task'),
          { stopBefore: 'open_checks', receipts });
        return claimedRunOf(receipts, `the ${label} Run`).run;
      };
      await requeue(firstRun, firstEnded, 'after-cancel');
      const acceptedBy = await drive('re-offer');

      // The next real supply carried the message again and the real Kernel accepted it once; the public read proves
      // the one accepted input and its Run.
      const reoffer = offers.find((offer, index) => index > 0 && offer.some(item => item.inputId === inputId));
      expect(reoffer).toBeDefined();
      expect(reoffer?.map(item => item.text)).toContain(interventionDeliveryText({
        messageId: person.ref.messageId, body: BODY }));
      const acceptedRead = async () => ready<SessionMessage>(await world.post('messages/read',
        plain(S6A_SCOPE, person.ref)), 'the accepted message');
      await expect.poll(async () => (await acceptedRead()).acceptedInputs?.length ?? 0,
        { timeout: 10_000, interval: 20 }).toBe(1);
      const accepted = await acceptedRead();
      expect((accepted.acceptedInputs ?? []).filter(entry => entry.part === 'message')
        .map(entry => ({ inputId: entry.inputId, executionRef: entry.executionRef })))
        .toEqual([{ inputId, executionRef: acceptedBy }]);

      // The SAME Run's next real safe point: the Kernel already accepted this input there (the platform confirm has
      // not written it to the message yet), so the supply must start from the safe point's accepted ids and must not
      // offer the message again. This is the window the next-Run assertion below cannot see.
      const acceptedEntry = (accepted.acceptedInputs ?? []).find(entry => entry.inputId === inputId);
      expect(acceptedEntry).toBeDefined();
      const pointsOfAcceptedRun = supplyPoints
        .map((entry, index) => ({ ...entry, items: offers[index]! }))
        .filter(entry => entry.runId === acceptedEntry!.kernel.runId);
      const offeredAt = pointsOfAcceptedRun.findIndex(entry => entry.items.some(item => item.inputId === inputId));
      expect(offeredAt).toBeGreaterThanOrEqual(0);
      const sameRunNextPoint = pointsOfAcceptedRun[offeredAt + 1];
      expect(sameRunNextPoint).toBeDefined();
      expect(sameRunNextPoint!.acceptedInputIds).toContain(inputId);
      expect(sameRunNextPoint!.items.map(item => item.inputId)).not.toContain(inputId);

      // The Workflow's real rework opens the next Run after the failed one; its first real safe point does not
      // offer the accepted message again.
      const factsAfter = ready<SessionFactsV1>(await world.post('sessions/facts', plain(S6A_SCOPE, line.ref)),
        'the Work line facts after the failure');
      if (factsAfter.latestWork === null) throw new Error('the rework Run is not the latest Work claim');
      expect(factsAfter.latestWork.runRef.runId).not.toBe(acceptedBy.runId);
      const lastTarget = offers.map(offer => offer.some(item => item.inputId === inputId)).lastIndexOf(true);
      await expect.poll(() => offers.length, { timeout: 10_000, interval: 20 }).toBeGreaterThan(lastTarget + 1);
      expect(offers.slice(lastTarget + 1).every(offer => offer.every(item => item.inputId !== inputId))).toBe(true);
    });
});
