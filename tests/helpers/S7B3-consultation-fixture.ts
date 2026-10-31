/** CS1 (fixture spec v2.2 §2.5): CS asks Q2's source its own `inquiry` (Q2's message is an accepted `action_request`),
 * then one consultation copy through the real route; the copy, operation and message are read back publicly. */
import type { WorkflowConsultationBody } from '../../src/app/core-http-types.js';
import type { ConsultationResult } from '../../src/business/workflow/contracts.js';
import { hashOf } from '../../src/business/workflow/consultation.js';
import type { SessionFactsV1 } from '../../src/core/work-graph/model/session-facts-contracts.js';
import type { SessionOperationRecord } from '../../src/core/work-graph/model/session-contracts.js';
import { stableSessionCreationIdentity } from '../../src/core/work-graph/sessions/session-directory.js';
import { plain } from './AG2b-collaboration-fixture.js';
import { byIdentityPrefix } from './S6A-commit-barrier.js';
import { S6A_SCOPE, S6A_WORK_ROLE_BINDING } from './S6A-request-fixture.js';
import { crashS7AHost, holdS7ACommitter, ready } from './S7A-fixture.js';
import { sendS7A2PersonMessage } from './S7A2-fixture.js';
import { readS7BMessage } from './S7B-fixture.js';
import type { S7BDamagedWorld } from './S7B3-damaged-world.js';

export type S7B3Consultation = { result: Extract<ConsultationResult, { status: 'ready' }>['value'];
  message: Awaited<ReturnType<typeof readS7BMessage>>; copy: SessionFactsV1 | null; operation: SessionOperationRecord | null };
export type S7B3Persisted = { operation: SessionOperationRecord };

export function consultRetiredLine(input: S7BDamagedWorld, options?: { replay?: false }):
  Promise<{ first: S7B3Consultation; second: null }>;
export function consultRetiredLine(input: S7BDamagedWorld, options: { replay: true }):
  Promise<{ first: S7B3Persisted; second: S7B3Consultation }>;
export async function consultRetiredLine(input: S7BDamagedWorld, options: { replay?: boolean } = {}):
  Promise<{ first: S7B3Consultation | S7B3Persisted; second: S7B3Consultation | null }> {
  const { world, source } = input;
  const messageRef = (await sendS7A2PersonMessage(world, { label: `s7b3-cs-${input.defect}`, recipient: source.ref })).ref;
  const profile = (await world.readProfiles())[0];
  if (profile === undefined) throw new Error('S7B3: the world publishes no query profile');
  const body: WorkflowConsultationBody = { scope: S6A_SCOPE, input: {
    schemaVersion: 1, messageRef, goalRef: world.goals.first, roleBinding: S6A_WORK_ROLE_BINDING,
    runtimeBudget: profile.runtimeBudget, budget: profile.budget, consumerId: profile.consumerId,
  } };
  const read = async (): Promise<S7B3Consultation> => {
    const result = ready<Extract<ConsultationResult, { status: 'ready' }>['value']>(await world.post('workflow/consultation', body), 'the consultation');
    const message = await readS7BMessage(world, messageRef);
    const copyRef = message.consultationDerivation?.childSessionRef;
    const operationRef = result.query?.job.job.intent.execution.consultation?.operation;
    const copy = copyRef === undefined ? null : ready<SessionFactsV1>(await world.post('sessions/facts', plain(S6A_SCOPE, copyRef)), `the copy of ${messageRef.messageId}`);
    const operation = operationRef === undefined ? null : ready<SessionOperationRecord>(
      await world.post('sessions/operation', plain(S6A_SCOPE, operationRef)), `the operation of ${messageRef.messageId}`);
    return { result, message, copy, operation };
  };
  if (options.replay !== true) return { first: await read(), second: null };
  // §7.9 replay: the create operation is persisted, the derivation commit is held and never lands, then the Host
  // crashes; the same body on the new Host reaches the create-operation pre-read and reuses the frozen payload.
  const hold = holdS7ACommitter(world, byIdentityPrefix('session-message-consultation-derivation:'));
  void read().catch(() => undefined);
  await hold.reached;
  const stable = stableSessionCreationIdentity(world.ag2b.actor, S6A_SCOPE.projectId,
    `consultation-child:${hashOf(messageRef)}`);
  const first = { operation: ready<SessionOperationRecord>(
    await world.post('sessions/operation', plain(S6A_SCOPE, stable.operationRef)),
    `the persisted operation of ${messageRef.messageId}`) };
  await crashS7AHost(world, hold);
  return { first, second: await read() };
}
