/** Shared UM/TU assembly: real owners, one Store, and observable allocations. */
import { expect } from 'vitest';
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { ReadResult, WriteResult } from '../../src/contracts/core/results.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import type { SessionMailboxDependencies } from '../../src/core/work-graph/model/communication-contracts.js';
import type { RunSnapshot } from '../../src/contracts/dispatch.js';
import type { PlatformDutyV1 } from '../../src/contracts/platform-duty.js';
import { canonicalJson, type JsonValue } from '../../src/contracts/fingerprint.js';
import { decisionSourceKey } from '../../src/contracts/goal-decisions.js';
import { createSessionMailbox, createMessageWriteOwner } from '../../src/core/work-graph/communication/mailbox-service.js';
import { createDecisionMessageService } from '../../src/core/work-graph/communication/decision-service.js';
import { createDecisionSourceFacts } from '../../src/core/work-graph/communication/decision-source-facts.js';
import { createSessionDirectory } from '../../src/core/work-graph/sessions/session-directory.js';
import { createRunStateReader } from '../../src/core/work-graph/tasks/run-state-service.js';
import { createRoleConfigurationService } from '../../src/core/work-graph/configuration/role-memory-service.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { GOAL_B, GOAL_REVISION, type S5DecisionFixture, type S5Records, type S5StoreSnapshot } from './S5-decision-fixture.js';

export function committed<T>(result: WriteResult<T>): Extract<WriteResult<T>, { status: 'committed' }> {
  expect(result.status).toBe('committed');
  if (result.status !== 'committed') throw new Error(`expected committed: ${JSON.stringify(result)}`);
  return result;
}

export function ready<T>(result: ReadResult<T>): T {
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error(`expected ready: ${JSON.stringify(result)}`);
  return result.value;
}

export const refKey = (ref: object): string => canonicalJson(ref as JsonValue);

export function workContext(f: S5DecisionFixture, run: RunSnapshot = f.runRA): CoreCallContext {
  return {
    projectId: f.base.scope.projectId, workspaceId: f.base.scope.workspaceId,
    principal: { kind: 'work_run', runRef: run.ref, roleBinding: run.roleBinding },
    materialReader: { kind: 'run', requester: run.ref }, signal: new AbortController().signal,
  };
}

export function realOwners(f: S5DecisionFixture, duties: readonly PlatformDutyV1[] | null = ['executor'],
  records: S5Records = f.records) {
  const { now, newId } = f;
  const readers = createMaterialRecordReaders(records);
  const materials = createMaterialService({ bodies: f.bodies, authority: readers.authority, now });
  const deps: SessionMailboxDependencies = {
    defaultInquiryDeadlineMs: 86_400_000,
    records, materials, now, newId, systemActor: f.operatorActor,
    sessions: createSessionDirectory({ records, lookups: records }),
    executions: createRunStateReader({ records }),
    roles: createRoleConfigurationService({ records, now, eventId: newId }),
    ...(duties === null ? {} : { duties: {
      async readMessageDutiesFacts() {
        return { status: 'ready' as const, value: {
          duties: [...duties], readOnlyCopy: false, independentReview: false, guards: [],
        } };
      },
    } }),
    runtimeAdmission: {
      bodies: f.bodies,
      authorizeConfiguration: async (_ctx, input) => ({ status: 'ready', value: {
        configurationRevision: input.configurationRevision,
        permissions: structuredClone(input.permissions), hostTemplate: structuredClone(input.hostTemplate),
      } }),
    },
  };
  const mailbox = createSessionMailbox(deps);
  const decisions = createDecisionMessageService({
    records, now, newId, operatorActor: f.operatorActor, messages: mailbox, materials,
    messageWrites: createMessageWriteOwner(deps), sources: createDecisionSourceFacts({ records }),
  });
  return { mailbox, decisions, decisionMessages: {
    sendUserMessage: mailbox.sendUserMessage,
    recordDecisionApplication: decisions.recordDecisionApplication,
    readDecisionAnswer: decisions.readDecisionAnswer,
  } };
}

export type RealOwners = ReturnType<typeof realOwners>;

export function decisionInput(f: S5DecisionFixture) {
  const card = f.messages.decision.decision;
  if (card === undefined) throw new Error('S5 decision options/objects missing');
  return {
    goalRef: GOAL_B, intent: 'decision_request' as const, text: 'Please decide.',
    needsReply: true, waitAfterSend: true,
    options: structuredClone(card.options), objects: structuredClone(card.objects),
  };
}

/** A new ordinary message is always sent pending@1 by its actual entered Run. */
export async function sendDecision(f: S5DecisionFixture, owners: RealOwners, requestId: string,
  run: RunSnapshot = f.runRA) {
  const sent = committed(await owners.mailbox.sendUserMessage(workContext(f, run), {
    input: decisionInput(f),
    meta: { requestId, expected: [{ ref: GOAL_B, revision: GOAL_REVISION }] },
  }));
  expect(sent.value).toMatchObject({ status: 'pending', revision: 1, response: null });
  const card = sent.value.decision;
  expect(card).toBeDefined();
  if (card === undefined) throw new Error('committed decision request has no metadata');
  expect(card.source.key).toBe(decisionSourceKey({ kind: 'message', messageRef: sent.value.ref }));
  // SPEC §2.3: the message's own version belongs only in meta.expected.
  expect(card.source.pins.filter(pin => refKey(pin.ref) === refKey(sent.value.ref))).toEqual([]);
  expect(new Set(card.source.pins.map(pin => refKey(pin.ref))).size).toBe(card.source.pins.length);
  return { message: sent.value, card };
}

export function answerPins(message: SessionMessage) {
  if (message.decision === undefined) throw new Error('answer pins require a decision message');
  return [{ ref: message.ref, revision: message.revision }, ...message.decision.source.pins];
}

/** No Runtime/provider is assembled in these owners; inspect durable model requests too. */
export function modelRequests(snapshot: S5StoreSnapshot) {
  return snapshot.records.filter(record => {
    const ref: { aggregateType: string } = JSON.parse(record.refKey);
    return ref.aggregateType === 'ModelRequestPermit';
  });
}

export async function storedJson(f: S5DecisionFixture, ref: object): Promise<string> {
  const key = refKey(ref);
  const read = await f.records.readMany([key]);
  if (read.status !== 'ready') throw new Error(`stored read failed: ${JSON.stringify(read)}`);
  const record = read.value.records.find(row => row.refKey === key);
  if (record === undefined) throw new Error(`missing stored record: ${key}`);
  return record.json;
}
