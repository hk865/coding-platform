/**
 * Stable Control interface for collaboration and communication.
 *
 * The public surface remains one cohesive interface for callers. Complete
 * admission operations live behind it by responsibility: participation,
 * directed requests, subscription/routing, waiting/successor and intent
 * lifecycle. Those internal modules own their state reads, permissions,
 * expected versions and commit plans; StateLedger still performs the final
 * transaction-time validation.
 */
import type {
  AdmitWaitSuccessorCommand,
  AdmitWaitSuccessorReceipt,
  CancelCommunicationCommand,
  CommunicationClaimCommand,
  CommunicationClaimReceipt,
  CommunicationIntentRef,
  CommunicationSettleCommand,
  CommunicationSettleReceipt,
  CommunicationWriteReceipt,
  CoordinationRegistrySnapshot,
  EndWorkParticipationCommand,
  EnsureWaitAdmissionCommand,
  EnsureWaitAdmissionReceipt,
  RegisterAgentInstanceCommand,
  RegisterWaitCommand,
  RequestIntentCancellationCommand,
  RespondDirectedRequestCommand,
  SendDirectedRequestCommand,
  StartWorkParticipationCommand,
  SubscribeCommand,
  WorkMailboxSnapshot,
} from '../../contracts/coordination.js';
import type { MailboxViewQuery, MailboxViewResult } from '../../contracts/modules.js';
import type { ControlEngineDeps } from './control-engine.js';
import { DirectedRequestOperations } from './coordination/directed-request-operations.js';
import { IntentLifecycleOperations } from './coordination/intent-lifecycle-operations.js';
import {
  MAILBOX_MAX_SCAN_PAGES,
  MAILBOX_SCAN_PAGE_SIZE,
  readMailboxView,
} from './coordination/mailbox-view.js';
import { CoordinationOperationContext } from './coordination/operation-context.js';
import { ParticipationOperations } from './coordination/participation-operations.js';
import { SubscriptionRoutingOperations } from './coordination/subscription-routing-operations.js';
import { WaitingSuccessorOperations } from './coordination/waiting-successor-operations.js';

export type { MailboxViewQuery, MailboxViewResult };
export { MAILBOX_MAX_SCAN_PAGES, MAILBOX_SCAN_PAGE_SIZE } from './coordination/mailbox-view.js';

export class CoordinationEngineImpl {
  private readonly participation: ParticipationOperations;
  private readonly directedRequests: DirectedRequestOperations;
  private readonly subscriptions: SubscriptionRoutingOperations;
  private readonly waits: WaitingSuccessorOperations;
  private readonly intents: IntentLifecycleOperations;

  constructor(private readonly deps: ControlEngineDeps) {
    const context = new CoordinationOperationContext(deps);
    this.participation = new ParticipationOperations(context);
    this.directedRequests = new DirectedRequestOperations(context);
    this.subscriptions = new SubscriptionRoutingOperations(context);
    this.waits = new WaitingSuccessorOperations(context);
    this.intents = new IntentLifecycleOperations(context, this.subscriptions);
  }

  registerAgentInstance(command: RegisterAgentInstanceCommand): Promise<CommunicationWriteReceipt> {
    return this.participation.registerAgentInstance(command);
  }

  startWorkParticipation(command: StartWorkParticipationCommand): Promise<CommunicationWriteReceipt> {
    return this.participation.startWorkParticipation(command);
  }

  endWorkParticipation(command: EndWorkParticipationCommand): Promise<CommunicationWriteReceipt> {
    return this.participation.endWorkParticipation(command);
  }

  sendDirectedRequest(command: SendDirectedRequestCommand): Promise<CommunicationWriteReceipt> {
    return this.directedRequests.sendDirectedRequest(command);
  }

  respondDirectedRequest(command: RespondDirectedRequestCommand): Promise<CommunicationWriteReceipt> {
    return this.directedRequests.respondDirectedRequest(command);
  }

  createSubscription(command: SubscribeCommand): Promise<CommunicationWriteReceipt> {
    return this.subscriptions.createSubscription(command);
  }

  registerWait(command: RegisterWaitCommand): Promise<CommunicationWriteReceipt> {
    return this.waits.registerWait(command);
  }

  cancelCommunication(command: CancelCommunicationCommand): Promise<CommunicationWriteReceipt> {
    return this.intents.cancelCommunication(command);
  }

  requestCommunicationIntentCancellation(command: RequestIntentCancellationCommand): Promise<CommunicationWriteReceipt> {
    return this.intents.requestCommunicationIntentCancellation(command);
  }

  claimCommunicationIntent(command: CommunicationClaimCommand): Promise<CommunicationClaimReceipt> {
    return this.intents.claimCommunicationIntent(command);
  }

  settleCommunicationIntent(command: CommunicationSettleCommand): Promise<CommunicationSettleReceipt> {
    return this.intents.settleCommunicationIntent(command);
  }

  admitWaitSuccessor(command: AdmitWaitSuccessorCommand): Promise<AdmitWaitSuccessorReceipt> {
    return this.waits.admitWaitSuccessor(command);
  }

  ensureWaitAdmission(command: EnsureWaitAdmissionCommand): Promise<EnsureWaitAdmissionReceipt> {
    return this.waits.ensureWaitAdmission(command);
  }

  mailboxView(query: MailboxViewQuery): Promise<MailboxViewResult> {
    return readMailboxView(this.deps.ledger, query);
  }
}

export type { CoordinationRegistrySnapshot, WorkMailboxSnapshot, CommunicationIntentRef };
