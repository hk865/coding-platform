import type { CoreCallContext } from '../../../contracts/core/call-context.js';
import type { VersionPin, WorkspaceScope } from '../../../contracts/core/identity.js';
import type { CoreRejection, ReadResult, WriteResult } from '../../../contracts/core/results.js';
import type { MessageRecipient, SessionMessageRef, DecisionMessageMetadataV1 } from '../../../contracts/core/session-message.js';
import type { DecisionObjectV1, DecisionOptionV1, GoalAutonomyV1, GoalDecisionBasisV1 } from '../../../contracts/goal-decisions.js';
import type { GoalRef, GoalSnapshot } from '../../../contracts/ledger.js';
import type { TaskTriple } from '../../../contracts/dispatch.js';
import { TaskTripleShape } from '../../../contracts/data-format-refs.js';
import { checkShape } from '../../../contracts/validation/data-format.js';
import type { RecordBatchRead, EncodedRecord, RecordGuard, StoreResult } from '../../record-store/ports.js';
import type { MessageSender, SendMessageResultV1, SessionMessage, SessionMessageSendInputV1 } from '../model/communication-contracts.js';
import type { QueryRoundV1 } from '../model/query-round-contracts.js';
import type { SecretaryQueryRunV1 } from '../model/secretary-query-run-contracts.js';
import type { GraphWrite } from '../model/task-contracts.js';
import type { MessageGuardContext } from '../state/message-machine.js';
import type { MailboxContext, Unknown, WorkRunPrincipal, Owned, AuthOutcome } from './mailbox-types.js';
import { rejectedWithCurrent as reject } from '../../../contracts/core/rejections.js';
import { canonicalJson, canonicalOf } from '../../../contracts/fingerprint.js';
import { decisionSourceKey } from '../../../contracts/goal-decisions.js';
import { isPos as isPositiveInt, isRecord as isObject, nonEmpty } from '../../../contracts/validation/common.js';
import { normalizeSendMessageInput } from '../model/message-payload.js';
import { decodeEvidenceSnapshot } from '../persistence/evidence-record-codecs.js';
import { decodePlanRevisionSnapshot } from '../persistence/plan-record-codecs.js';
import { sessionStoreFailureToRejection } from '../persistence/read-result-failures.js';
import { canonicalRefKey, decodeGoalSnapshot } from '../persistence/record-codecs.js';
import { SESSION_MESSAGE_MAX_TEXT_BYTES, sessionMessageTextBound, checkSessionMessageRef } from '../sessions/message-record-codecs.js';
import { canSendUserMessage } from '../state/decision-policy.js';
import { createSessionMessageRecord, messageRecipientProjectProblem, messageSendFlagsProblem } from '../state/message-machine.js';
import { sendUserMessageFingerprintPayload } from '../model/tool-commit-arguments.js';
import { sentMessageCompanions } from './mailbox-basis.js';
import { isGoalRef, mapReadResult, ownContext, ownWrite, normalizeText, guardRejection, judge, refusalOf, followupConnects, senderIdentityOf, identityKeyOf, fingerprintOf, messageRefOf, internalHostContext, loadMessage } from './mailbox-common.js';
import {
  readWorkRunIdentity, deriveWorkRunSender, authorizeNewWorkRunAction, requiredQueryRound, resolveSecretaryRound,
  requestRoundOwnership, reviewerFactsOfLine,
} from './mailbox-identity.js';
import { replayMessage, recheckAfterMiss, refuse, writeMessage } from './mailbox-write.js';

// ---- slice-5 user-send helpers ------------------------------------------

async function loadGoal(mailbox: MailboxContext, owned: Owned, ref: GoalRef): Promise<ReadResult<GoalSnapshot>> {
  if (owned.signal.aborted) return reject('cancelled', 'the Goal read was cancelled');
  const key = canonicalOf(ref);
  if (key === null) return reject('invalid', 'the Goal ref is not canonicalizable JSON');
  let read: StoreResult<RecordBatchRead>;
  try {
    read = await mailbox.records.readMany([key]);
  } catch {
    return reject('unavailable', 'the Goal record could not be read');
  }
  if (read.status !== 'ready') return sessionStoreFailureToRejection(read);
  const record = read.value.records.find((candidate) => candidate.refKey === key);
  if (record === undefined) {
    return read.value.missing.includes(key)
      ? { status: 'not_found' }
      : reject('unavailable', 'the record store neither returned nor reported missing the Goal');
  }
  const decoded = decodeGoalSnapshot(record);
  if (decoded.status !== 'decoded') return reject('unavailable', `the Goal record is damaged: ${decoded.reason}`);
  return { status: 'ready', value: decoded.value };
}

function goalBasis(mailbox: MailboxContext, goal: GoalSnapshot): GoalDecisionBasisV1 {
  return {
    goalRef: structuredClone(goal.ref),
    workspaceRef: structuredClone(goal.workspaceRef),
    objective: goal.objective,
    activePlanRef: structuredClone(goal.activePlanRevision),
    settings: structuredClone(goal.settings),
  };
}

/**
 * §3.3 line 614: the aggregate objects' required pins. Every aggregate was
 * shape-validated by `verifyDecisionObjectWorkspaces` before this extraction,
 * so a malformed pin is never silently dropped here.
 */
function aggregateObjectPins(mailbox: MailboxContext, objects: readonly DecisionObjectV1[]): VersionPin[] {
  const pins: VersionPin[] = [];
  for (const object of objects) {
    if (isObject(object) && object['kind'] === 'aggregate') {
      pins.push(structuredClone((object as Unknown)['pin']) as unknown as VersionPin);
    }
  }
  return pins;
}

/**
 * SPEC §3.3 line 614: every allowed decision object kind must ESTABLISH its
 * owning Workspace. A `file` object carries its Workspace directly; a kind
 * that names none is refused as `invalid`, and a Workspace other than the
 * bound one as `forbidden`. `aggregate` objects are established through the
 * pin their kind carries by `verifyDecisionObjectPins`.
 */
function verifyDecisionObjectWorkspaces(mailbox: MailboxContext, owned: Owned, objects: readonly DecisionObjectV1[]): CoreRejection | null {
  for (const object of objects) {
    if (!isObject(object)) return reject('invalid', 'a decision object is not an object');
    const kind = object['kind'];
    if (kind === 'aggregate') {
      // §3.3 line 614: an aggregate object establishes its owning Workspace
      // through its pin, so the pin is mandatory. A missing or malformed pin
      // is refused as `invalid` BEFORE any pin extraction or body effect,
      // never dropped for the store codec to reject after body storage.
      const pin = object['pin'];
      if (!isObject(pin) || !isObject(pin['ref']) || !isPositiveInt(pin['revision'])) {
        return reject('invalid', 'an aggregate decision object does not carry a complete version pin');
      }
      continue;
    }
    if (kind !== 'file') {
      return reject('invalid', 'a decision object of this kind does not establish its owning Workspace');
    }
    const workspace = object['workspace'];
    if (!isObject(workspace)) {
      return reject('invalid', 'a file decision object does not establish its owning Workspace');
    }
    const projectId = workspace['projectId'];
    const workspaceId = workspace['workspaceId'];
    if (typeof projectId !== 'string' || projectId.length === 0
      || typeof workspaceId !== 'string' || workspaceId.length === 0) {
      return reject('invalid', 'a file decision object does not establish its owning Workspace');
    }
    if (projectId !== owned.projectId || workspaceId !== owned.workspaceId) {
      return reject('forbidden', 'a file decision object belongs to another Workspace');
    }
  }
  return null;
}

function dedupePins(mailbox: MailboxContext, pins: readonly VersionPin[]): VersionPin[] {
  const byKey = new Map<string, VersionPin>();
  for (const pin of pins) {
    const key = canonicalOf(pin.ref);
    if (key !== null) byKey.set(key, pin);
  }
  return [...byKey.values()];
}

/** §3.3 line 614: the owning Goal a goal-scoped object ref names, or null. */
function goalRefOfDecisionObject(mailbox: MailboxContext, ref: Record<string, unknown>): GoalRef | null {
  const projectId = ref['projectId'];
  if (typeof projectId !== 'string' || projectId.length === 0) return null;
  const goalId = ref['goalId'];
  if (typeof goalId !== 'string' || goalId.length === 0) return null;
  return { aggregateType: 'Goal', projectId, goalId };
}

/** §3.3 line 614: read the owning Goal and return its REAL Workspace. */
async function owningGoalWorkspace(mailbox: MailboxContext, owned: Owned, goalRef: GoalRef): Promise<
  { ok: true; workspace: WorkspaceScope } | { ok: false; rejection: CoreRejection }> {
  const goal = await loadGoal(mailbox, owned, goalRef);
  if (goal.status === 'ready') return { ok: true, workspace: goal.value.workspaceRef };
  if (goal.status === 'not_found') {
    return { ok: false, rejection: reject('not_found', 'a decision object owning Goal does not exist') };
  }
  return { ok: false, rejection: mapReadResult(goal) as CoreRejection };
}

async function readDecisionObjectRecord(mailbox: MailboxContext, key: string): Promise<
  { ok: true; record: EncodedRecord } | { ok: false; rejection: CoreRejection }> {
  let read: StoreResult<RecordBatchRead>;
  try {
    read = await mailbox.records.readMany([key]);
  } catch {
    return { ok: false, rejection: reject('unavailable', 'a decision object could not be read') };
  }
  if (read.status !== 'ready') return { ok: false, rejection: sessionStoreFailureToRejection(read) };
  const record = read.value.records.find((candidate) => candidate.refKey === key);
  if (record === undefined) {
    return read.value.missing.includes(key)
      ? { ok: false, rejection: reject('not_found', 'a decision object does not exist') }
      : { ok: false, rejection: reject('unavailable', 'the record store neither returned nor reported missing the decision object') };
  }
  return { ok: true, record };
}

/**
 * SPEC §3.3 line 614: a decision request's object pins are REAL facts, not
 * caller claims. Before any foreign record is read, a ref that carries another
 * project/Workspace is refused. Every allowed kind must then ESTABLISH its
 * owning Workspace — directly from its ref, through the Goal its `goalId`
 * names, or through the owning Goal named by its own record (Goal,
 * PlanRevision, Evidence). A kind whose Workspace cannot be established is
 * refused as `invalid`, never accepted. Only a same-Workspace object that
 * reads at the pin's exact revision joins the source metadata and the guards.
 */
async function verifyDecisionObjectPins(mailbox: MailboxContext, owned: Owned, pins: readonly VersionPin[]): Promise<CoreRejection | null> {
  for (const pin of pins) {
    if (!isObject(pin) || !isObject(pin.ref) || !isPositiveInt(pin.revision)) {
      return reject('invalid', 'a decision object pin is not a complete positive-integer version pin');
    }
    const ref = pin.ref as unknown as Record<string, unknown>;
    const projectId = ref['projectId'];
    const workspaceId = ref['workspaceId'];
    if (typeof projectId === 'string' && projectId.length > 0 && projectId !== owned.projectId) {
      return reject('forbidden', 'a decision object pin belongs to another project');
    }
    if (typeof workspaceId === 'string' && workspaceId.length > 0 && workspaceId !== owned.workspaceId) {
      return reject('forbidden', 'a decision object pin belongs to another Workspace');
    }
    const key = canonicalOf(pin.ref);
    if (key === null) return reject('invalid', 'a decision object pin ref is not canonicalizable JSON');
    const aggregateType = ref['aggregateType'];
    const directWorkspace = typeof workspaceId === 'string' && workspaceId.length > 0;
    let record: EncodedRecord | null = null;
    let goalRef: GoalRef | null = null;
    if (!directWorkspace) {
      goalRef = goalRefOfDecisionObject(mailbox, ref);
      if (goalRef !== null && aggregateType !== 'Goal') {
        const owner = await owningGoalWorkspace(mailbox, owned, goalRef);
        if (!owner.ok) return owner.rejection;
        if (owner.workspace.projectId !== owned.projectId
          || owner.workspace.workspaceId !== owned.workspaceId) {
          return reject('forbidden', 'a decision object belongs to another Workspace Goal');
        }
      } else if (aggregateType === 'Goal' || aggregateType === 'PlanRevision' || aggregateType === 'Evidence') {
        const loaded = await readDecisionObjectRecord(mailbox, key);
        if (!loaded.ok) return loaded.rejection;
        record = loaded.record;
        if (aggregateType === 'Goal') {
          const decoded = decodeGoalSnapshot(record);
          if (decoded.status !== 'decoded') {
            return reject('unavailable', `the decision object Goal is damaged: ${decoded.reason}`);
          }
          if (decoded.value.workspaceRef.projectId !== owned.projectId
            || decoded.value.workspaceRef.workspaceId !== owned.workspaceId) {
            return reject('forbidden', 'a decision object Goal belongs to another Workspace');
          }
        } else if (aggregateType === 'PlanRevision') {
          const decoded = decodePlanRevisionSnapshot(record);
          if (decoded.status !== 'decoded') {
            return reject('unavailable', `the decision object PlanRevision is damaged: ${decoded.reason}`);
          }
          goalRef = decoded.value.goalRef;
        } else {
          const decoded = decodeEvidenceSnapshot(record);
          if (decoded.status !== 'decoded') {
            return reject('unavailable', `the decision object Evidence is damaged: ${decoded.reason}`);
          }
          const subject = decoded.value.evidence.subject;
          goalRef = { aggregateType: 'Goal', projectId: subject.projectId, goalId: subject.goalId };
        }
        if (aggregateType !== 'Goal') {
          const owner = await owningGoalWorkspace(mailbox, owned, goalRef as GoalRef);
          if (!owner.ok) return owner.rejection;
          if (owner.workspace.projectId !== owned.projectId
            || owner.workspace.workspaceId !== owned.workspaceId) {
            return reject('forbidden', 'a decision object belongs to another Workspace Goal');
          }
        }
      } else {
        return reject('invalid', 'a decision object of this kind does not establish its owning Workspace');
      }
    }
    if (record === null) {
      const loaded = await readDecisionObjectRecord(mailbox, key);
      if (!loaded.ok) return loaded.rejection;
      record = loaded.record;
    }
    if (record.revision !== pin.revision) {
      return reject('revision_conflict', 'a decision object changed since it was read', [pin]);
    }
  }
  return null;
}

function validOptionObjects(mailbox: MailboxContext, options: readonly DecisionOptionV1[], objects: readonly DecisionObjectV1[]): boolean {
  if (!Array.isArray(options) || options.length < 2 || options.length > 4) return false;
  if (!Array.isArray(objects) || objects.length > 32) return false;
  const ids = new Set<string>();
  for (const option of options) {
    if (!isObject(option) || !nonEmpty(option['id']) || typeof option['label'] !== 'string') return false;
    if (option['effect'] !== 'apply' && option['effect'] !== 'reject' && option['effect'] !== 'defer') return false;
    if (Buffer.byteLength(String(option['id']), 'utf8') > 64 || Buffer.byteLength(String(option['label']), 'utf8') > 512) return false;
    if (ids.has(String(option['id']))) return false;
    ids.add(String(option['id']));
  }
  return true;
}

/** The `user_message_sent` facts (spec §3.1 S5-MSG-01) are built inline. */

// ---- sendMessage --------------------------------------------------------

/**
 * The send's own result: the one commit's outcome. A rejection already carries
 * the frozen `SendRejectionV1` shape.
 */
function sendStatusOf(result: WriteResult<SessionMessage>): SendMessageResultV1 {
  if (result.status !== 'committed') return result;
  return { ...result, sendStatus: 'sent' };
}

async function refuseSend<T extends CoreRejection>(mailbox: MailboxContext, rejection: T, identityKey: string, fingerprint: string): Promise<SendMessageResultV1> {
  const restored = await recheckAfterMiss(mailbox, identityKey, fingerprint);
  return restored === null ? rejection : sendStatusOf(restored);
}

export async function sendMessage(mailbox: MailboxContext, ctx: CoreCallContext, request: SessionMessageSendInputV1): Promise<SendMessageResultV1> {
  const owned = ownContext(ctx);
  if (!owned.ok) return owned.rejection;
  if (owned.signal.aborted) return reject('cancelled', 'the send was cancelled before validation');
  const write = ownWrite(request);
  if (!write.ok) return write.rejection;
  // T's ONE normalizer replaces the inline shape checks: the recipient, the ten
  // payload fields and their defaults. It reads no Goal, Run or Session.
  const normalized = normalizeSendMessageInput(write.input);
  if (normalized.status === 'rejected') return normalized;
  if (normalized.status !== 'ready') return reject('invalid', 'the send input could not be normalized');
  const send = normalized.value;
  // The text bound follows THIS send's principal/sender: only the fixed Host
  // system-round identity may write a 64 KiB `message` part; every other send
  // stays 16 KiB. The principal is the same trusted source the sender is
  // derived from below, so this never reads the input or `followupOf`.
  const maxTextBytes = owned.principal.kind === 'host'
    ? sessionMessageTextBound({
      sender: { kind: 'host', actor: { ...owned.principal.actor } }, part: 'message', original: null,
    })
    : SESSION_MESSAGE_MAX_TEXT_BYTES;
  const text = normalizeText(send.text, maxTextBytes);
  if (!text.ok) return text.rejection;
  const projectRejection = guardRejection(messageRecipientProjectProblem(
    send.recipient.projectId === owned.projectId, owned.projectId));
  if (projectRejection !== null) return projectRejection;
  const sendFlags: NonNullable<MessageGuardContext['sendFlags']> = {
    needsReply: send.needsReply, waitAfterSend: send.waitAfterSend, pinCount: write.expected.length,
  };
  const flagRejection = guardRejection(messageSendFlagsProblem(sendFlags));
  if (flagRejection !== null) return flagRejection;

  // The stable sender facts: Host => the same trusted actor; a work Run => the
  // persisted claim and Run; a `query_run` principal => only its literal
  // `queryRunRef` (the round is resolved after the receipt miss). The identity
  // and the fingerprint never read the resolver.
  let sender: MessageSender | null = null;
  let senderIdentity: Unknown;
  let workRunPrincipal: WorkRunPrincipal | null = null;
  let workRunSessionWorkspaceId: string | null = null;
  if (owned.principal.kind === 'host') {
    sender = { kind: 'host', actor: { ...owned.principal.actor } };
    senderIdentity = senderIdentityOf(sender);
  } else if (owned.principal.kind === 'work_run') {
    const identity = await readWorkRunIdentity(mailbox, owned, owned.principal, owned.principal.runRef);
    if (!identity.ok) return identity.rejection;
    const derived = deriveWorkRunSender(mailbox, identity);
    if (!derived.ok) return derived.rejection;
    sender = derived.sender;
    workRunPrincipal = owned.principal;
    workRunSessionWorkspaceId = identity.session.workspaceId;
    senderIdentity = senderIdentityOf(sender);
  } else {
    senderIdentity = { kind: 'query_run', queryRunRef: { ...owned.principal.queryRunRef } };
  }

  // The identity and the fingerprint are fixed from the stable facts and the
  // WHOLE normalized payload (all ten fields, the explicit nulls included): a
  // changed field under the same identity is `idempotency_conflict`, never a
  // silent re-send.
  const identityKey = identityKeyOf('send', owned, senderIdentity, write.requestId);
  const fingerprint = fingerprintOf('send', owned, senderIdentity, send as unknown as Unknown, write.expected);

  // Receipt first: a replay restores the original result from the original
  // event, before any admission and without re-reading the world.
  if (owned.signal.aborted) return reject('cancelled', 'the send was cancelled before the idempotency lookup');
  const existing = await mailbox.records.lookupCommit({ identityKey, fingerprint });
  if (existing.status === 'ready') return sendStatusOf(await replayMessage(mailbox, existing.value));
  if (existing.code !== 'not_found') return sessionStoreFailureToRejection(existing);

  // 问答轮自己发信，也在查回执之后解析，只经 `requiredQueryRound` 这一次：非请求轮的发件人是本轮 Session、QueryRun
  // 和代数；秘书请求轮复用这一次解析出的请求根和准入守卫，与当前请求归属严格合并。没有第二条路：解析不出、请求记录
  // 损坏的 `query_run` 就拒。
  let queryRound: QueryRoundV1 | null = null;
  let secretaryGuards: readonly RecordGuard[] = [];
  if (owned.principal.kind === 'query_run') {
    const routed = await requiredQueryRound(mailbox, owned);
    // A business refusal (no stored round, not entered, an unknown duty) may be stale: a concurrent same-identity
    // send can have committed after this send's lookup missed, so restore its receipt. A read failure stays the
    // read failure.
    if (!routed.ok) {
      return routed.rejection.code === 'forbidden'
        ? refuseSend(mailbox, routed.rejection, identityKey, fingerprint) : routed.rejection;
    }
    const round = routed.round;
    queryRound = round;
    // 副本不冒充原线，永不发信。
    if (round.readOnlyCopy) {
      return refuseSend(mailbox, reject('forbidden', 'a read-only copy never sends a Session message'),
        identityKey, fingerprint);
    }
    if (round.requestRound) {
      // 请求轮只属于秘书（请求由秘书持有，设计 2.4）；请求根没存下是记录坏了，读不到的事实不能当真。
      if (round.duty !== 'secretary') {
        return refuseSend(mailbox, reject('forbidden', 'the round Session is not the secretary duty'),
          identityKey, fingerprint);
      }
      if (round.requestRoot === null) return reject('unavailable', 'the round QueryJob names no request root');
      const ownership = await requestRoundOwnership(mailbox, owned, {
        requestRoot: round.requestRoot, session: round.session, scope: round.scope });
      if (!ownership.ok) {
        return ownership.rejection.code === 'forbidden'
          ? refuseSend(mailbox, ownership.rejection, identityKey, fingerprint) : ownership.rejection;
      }
      // The first trusted read's QueryRun/Session versions stay in the commit, strictly merged with the
      // current request ownership; a round that ended between the two reads is a revision_conflict.
      secretaryGuards = [...round.guards, ...ownership.guards];
      sender = { kind: 'secretary_round', sessionRef: { ...round.session },
        queryRunRef: { ...round.run }, requestRoot: { ...round.requestRoot },
        generation: round.sessionGeneration };
    } else {
      sender = { kind: 'query_run', sessionRef: { ...round.session }, queryRunRef: { ...round.run },
        generation: round.sessionGeneration };
    }
  }
  if (sender === null) throw new Error('a send reached admission without its trusted sender facts');
  const committedSender: MessageSender = sender;
  const committedRequestRoot = committedSender.kind === 'secretary_round' ? committedSender.requestRoot : null;
  // Rule W: a Work Run's message belongs to the sending line's workspace, not
  // the Run's; a request round's message belongs to its line's workspace too. A
  // Host send keeps the caller's workspace.
  // 问答轮的信同样放线的工作区：规划 Query 在目标的工作区，线可能在别处，放 Query 那边它就读不到自己的信。
  const lineWorkspaceId = workRunSessionWorkspaceId ?? queryRound?.lineWorkspaceId ?? owned.workspaceId;
  const lineCtx = lineWorkspaceId === owned.workspaceId
    ? internalHostContext(mailbox, owned)
    : { ...internalHostContext(mailbox, owned), workspaceId: lineWorkspaceId };

  // MSG-02's fresh admission comes before the target Session read; a refused
  // admission never reads the target (the machine asks the admission first).
  let authorized: AuthOutcome | null = null;
  let senderReviewer = false;
  if (workRunPrincipal !== null) {
    // The real tool name comes from the send shape: a copy question is `ask_copy`;
    // every other Session send is `send_session_message`. The Host grants the new
    // names, so the old `send_user_message` fallback is gone.
    const operationToolName = send.answeredBy === 'copy' ? 'ask_copy' : 'send_session_message';
    authorized = await authorizeNewWorkRunAction(mailbox, {
      owned, principal: workRunPrincipal, operationToolName,
    });
    // The trusted duties facts refuse the two senders that are never senders:
    // a read-only copy and an independent reviewer. The adapter is the only
    // source; when it is not bound the historical paths stay unchanged.
    if (authorized.ok && mailbox.deps.duties !== undefined && sender.kind === 'work_run') {
      if (owned.signal.aborted) return reject('cancelled', 'the send was cancelled before the duties read');
      // The duties facts are the sending line's: a Work Run may sit in another workspace of the project.
      const duties = await mailbox.deps.duties.readMessageDutiesFacts(lineCtx, {
        sessionRef: sender.sessionRef, roleBinding: sender.roleBinding,
      });
      if (duties.status !== 'ready') return duties.status === 'rejected' ? duties : mapReadResult(duties) as CoreRejection;
      if (duties.value.readOnlyCopy) return refuseSend(mailbox, reject('forbidden', 'a read-only copy never sends a Session message'), identityKey, fingerprint);
      senderReviewer = duties.value.independentReview || duties.value.duties.includes('reviewer');
    }
  }
  if (queryRound !== null) senderReviewer = queryRound.duty === 'reviewer';
  // C23: an independent reviewer only sends a message that asks no reply and does not wait. Asking a copy question
  // is the same forbidden ask; `wake` keeps its frozen default (true), so its absence is not a refusal. Reply, ask,
  // action and forwarding are outside this owner; the adapter is refused here.
  if (senderReviewer && (send.needsReply || send.waitAfterSend || send.answeredBy === 'copy')) {
    return refuseSend(mailbox, reject('forbidden', '独立审阅只发请知悉'), identityKey, fingerprint);
  }
  // 让出执行只属于做事轮：问答轮没有可让出、可接续的运行，owner 在查回执之后、解析之前就拒；平台为请求等待
  // 发的问件不属这条工具规则。审阅者的 C23 拒绝先于这条普通等待拒绝。
  if (owned.principal.kind === 'query_run' && send.waitAfterSend) {
    return refuseSend(mailbox, reject('invalid', 'a query round cannot set waitAfterSend: it has no Run to yield '
      + 'and resume; send without waiting, and the reply arrives in your next round'), identityKey, fingerprint);
  }
  // S-1 applies to `send_session_message` (`answeredBy:'line'`): an agent's reply-asking letter must wake its
  // recipient. An explicit `wake:false` on `needsReply:true` is refused here, in the send owner, before anything is
  // written; omitting `wake` keeps the record default (true). A copy question (`ask_copy`, `answeredBy:'copy'`)
  // deliberately does not wake the original line, so it is not this rule's subject.
  if (sender.kind !== 'host' && send.answeredBy === 'line' && send.needsReply && send.wake === false) {
    return refuseSend(mailbox, reject('invalid',
      'a message that needs a reply must wake the recipient; drop wake:false or set needsReply:false'),
    identityKey, fingerprint);
  }

  // The target Session must exist in the same project (the directory's project read). Across workspaces of the
  // project (121-109 C; XWS) the record is written in the recipient line's workspace and the replay identity stays
  // the sender's. Across workspaces a send is a notify that needs no reply (any sender), or a Host system round's
  // notify/action_request. Any other cross-workspace send is refused (coordination): its reply and its wait are read
  // back in the sending line's workspace (outbox, wait continuation, consultation). busy/archived never blocks mail.
  let recipientScope: MessageGuardContext['recipientScope'] = null;
  let receivingWorkspaceId = lineWorkspaceId;
  if (authorized === null || authorized.ok) {
    if (owned.signal.aborted) return reject('cancelled', 'the send was cancelled before the target Session read');
    const target = await mailbox.deps.sessions.readSession(lineCtx, send.recipient, 'project');
    if (owned.signal.aborted) return reject('cancelled', 'the send was cancelled during the target Session read');
    if (target.status !== 'ready' && target.status !== 'not_found') return mapReadResult(target) as CoreRejection;
    if (target.status === 'ready') {
      const targetWorkspaceId = target.value.record.workspaceId;
      const hostSystem = owned.principal.kind === 'host' && owned.principal.actor.kind === 'system';
      // 跨工作区只放开不要回复的请知悉；Host 系统的通知和系统轮照旧能过。
      const mayCross = !send.needsReply || hostSystem;
      if (targetWorkspaceId === lineWorkspaceId || mayCross) {
        recipientScope = 'same_workspace';
        receivingWorkspaceId = targetWorkspaceId;
      } else {
        recipientScope = 'other_workspace';
      }
      // C23/S6: an AGENT that asks a reviewer line for a reply is refused at send
      // time; the person's own direct intervention is unchanged. The recipient
      // line's duty comes from the one duties read, never from the caller.
      if (send.needsReply && sender.kind !== 'host') {
        const lineReviewer = await reviewerFactsOfLine(mailbox, owned, {
          sessionRef: send.recipient, role: target.value.record.role, workspaceId: targetWorkspaceId,
        });
        if (!lineReviewer.ok) return refuseSend(mailbox, lineReviewer.rejection, identityKey, fingerprint);
        if (lineReviewer.reviewer) {
          return refuseSend(mailbox, reject('forbidden', '审阅者不回复（C23），要回复请发给参谋或秘书'), identityKey, fingerprint);
        }
      }
    }
  }

  // MSG-01/02. The messageId derives from the send identity, so the record is
  // not read: an existing one is caught by the create CAS@0. A refused
  // admission first restores this identity's receipt if a concurrent identical
  // request committed after the lookup missed (`refuse`).
  const sendFacts: Partial<Omit<MessageGuardContext, 'principal'>> = {
    workRunAuthorization: authorized === null ? null : authorized.ok ? 'ok' : authorized.rejection,
    recipientScope,
    sendFlags,
  };
  const { decided, ctx: messageCtx } = judge(owned.principal, null, { type: 'message_sent' }, sendFacts);
  if (!decided.ok) return refuseSend(mailbox, refusalOf(decided, messageCtx), identityKey, fingerprint);

  // The Goal comes from the sender's trusted facts: a work Run's Task goal, the
  // query round's `effectiveGoalId` (never a request's `goals` batch), the person's
  // own `goalRef` input. An input that disagrees with the trusted fact is
  // `invalid`, never a silent override.
  let trustedGoal: GoalRef | null = null;
  if (sender.kind === 'host') {
    if (send.goalRef !== null) trustedGoal = structuredClone(send.goalRef);
  } else if (sender.kind === 'work_run') {
    trustedGoal = { aggregateType: 'Goal', projectId: owned.projectId, goalId: sender.runRef.goalId };
    if (send.goalRef !== null
      && (send.goalRef.projectId !== trustedGoal.projectId || send.goalRef.goalId !== trustedGoal.goalId)) {
      return refuseSend(mailbox, reject('invalid', 'the send goalRef disagrees with the sender Session\'s trusted Goal'), identityKey, fingerprint);
    }
  } else {
    const effectiveGoalId = queryRound !== null ? queryRound.effectiveGoalId : null;
    trustedGoal = effectiveGoalId === null
      ? null : { aggregateType: 'Goal', projectId: owned.projectId, goalId: effectiveGoalId };
    if (send.goalRef !== null && (trustedGoal === null
      || send.goalRef.projectId !== trustedGoal.projectId || send.goalRef.goalId !== trustedGoal.goalId)) {
      return refuseSend(mailbox, reject('invalid', 'the send goalRef disagrees with the sender round\'s effective Goal'), identityKey, fingerprint);
    }
  }
  // `taskRef` is a full Task triple of that Goal, and `followupOf` an existing
  // message between these two Sessions: one error each, no message written.
  if (send.taskRef !== null) {
    if (trustedGoal === null || send.taskRef.projectId !== trustedGoal.projectId
      || send.taskRef.goalId !== trustedGoal.goalId) {
      return refuseSend(mailbox, reject('invalid', 'the send taskRef is not a Task of the message\'s Goal'), identityKey, fingerprint);
    }
  }
  if (send.followupOf !== null) {
    if (owned.signal.aborted) return reject('cancelled', 'the send was cancelled before the follow-up read');
    const followed = await loadMessage(mailbox, owned, send.followupOf);
    if (followed.status === 'not_found') return refuseSend(mailbox, reject('invalid', 'the followupOf message does not exist'), identityKey, fingerprint);
    if (followed.status !== 'ready') return mapReadResult(followed) as CoreRejection;
    if (!followupConnects(followed.value, sender, send.recipient)) {
      return refuseSend(mailbox, reject('invalid', 'the followupOf message is not between these two Sessions'), identityKey, fingerprint);
    }
  }

  // 目标暂停只影响投递，发送时只拒取消（`sendGoal`）；Goal 读失败是读失败，不当成没目标。这次读到的
  // Goal 版本也进同一次提交，读和提交之间目标换了代就冲突；暂停在读时已看到，照收下排队。
  let sendGoal: GoalSnapshot['desiredState'] | null = null;
  let sendGoalGuard: RecordGuard | null = null;
  if (trustedGoal !== null) {
    if (owned.signal.aborted) return reject('cancelled', 'the send was cancelled before the Goal read');
    const goal = await loadGoal(mailbox, owned, trustedGoal);
    if (goal.status !== 'ready') return mapReadResult(goal) as CoreRejection;
    sendGoal = goal.value.desiredState;
    sendGoalGuard = { refKey: canonicalRefKey(goal.value.ref), expectedRevision: goal.value.revision };
  }
  // 只有人的直接干预入口写 `entry`；agent 和平台填了也不用。
  const entry = sender.kind === 'host' && sender.actor.kind === 'human' ? send.entry ?? undefined : undefined;

  const messageRef = messageRefOf(owned, senderIdentity, write.requestId, receivingWorkspaceId);
  // The machine's send row refuses a cancelled Goal; a paused one is accepted
  // and the delivery gate withholds it until the Goal resumes.
  const { decided: sent, ctx: sentCtx } = judge(owned.principal, null, { type: 'message_sent' },
    { ...sendFacts, sendGoal });
  if (!sent.ok) return refuseSend(mailbox, refusalOf(sent, sentCtx), identityKey, fingerprint);
  // The deadline is frozen at the commit's one clock instant; an overflow is
  // refused before anything is written.
  // A reply-asking send with no explicit deadline gets the platform's default
  // inquiry deadline; the frozen instant and the record both use this value.
  const deadlineMs = send.deadlineMs ?? (send.needsReply ? mailbox.deps.defaultInquiryDeadlineMs ?? null : null);
  let frozenDeadline: string | null = null;
  const companions = async (at: string) => {
    const sentCompanions = sentMessageCompanions(at, deadlineMs);
    if (!sentCompanions.ok) return sentCompanions;
    frozenDeadline = sentCompanions.value.deadline;
    return { ok: true as const, value: { records: [], events: [], guards: [], claims: [] } };
  };

  // 问答轮守它这一读窗的 QueryRun 和 Session 版本（请求轮另并入当前请求归属）：读和提交之间这一轮结束或换代
  // 就是冲突。
  const roundGuards: readonly RecordGuard[] = secretaryGuards.length > 0
    ? secretaryGuards : queryRound === null ? [] : queryRound.guards;
  const written = await writeMessage(mailbox, sent, {
    owned, identityKey, fingerprint, requestId: write.requestId, actor: committedSender, admission: authorized,
    cancelled: 'the send was cancelled before commit',
    ...(roundGuards.length === 0 && sendGoalGuard === null ? {}
      : { extraGuards: [...roundGuards, ...(sendGoalGuard === null ? [] : [sendGoalGuard])] }),
    companions,
    body: { messageRef, text: text.text, answerSource: null },
    record: (createdAt, bodyRef) => createSessionMessageRecord({
      ref: messageRef, sender: committedSender, recipient: send.recipient, bodyRef, sourceRef: bodyRef.source, createdAt,
      wake: send.wake, answeredBy: send.answeredBy,
      ...(entry === undefined ? {} : { entry }),
      needsReply: send.needsReply, waitAfterSend: send.waitAfterSend,
      goalRef: trustedGoal === null ? null : structuredClone(trustedGoal),
      taskRef: send.taskRef === null ? null : structuredClone(send.taskRef),
      followupOf: send.followupOf === null ? null : structuredClone(send.followupOf),
      requestRoot: committedRequestRoot === null ? null : { ...committedRequestRoot },
      deadlineMs, deadline: frozenDeadline,
    }),
  });
  return sendStatusOf(written);
}

// ---- sendUserMessage (slice 5 user-send owner) --------------------------

/**
 * The slice-5 user-message owner (SPEC §3.3 table line 614, row S5-MSG-01).
 * The user is not a Session: the recipient is the bound workspace's user
 * address and this method never enters the legacy `sendMessage` admission.
 * The sender identity/duties always come from the trusted context and the
 * configured duties adapter, never from the input.
 */
export async function sendUserMessage(mailbox: MailboxContext, ctx: CoreCallContext, request: GraphWrite<{
  goalRef: GoalRef; intent: 'notify' | 'decision_request'; text: string;
  needsReply: boolean; waitAfterSend: boolean;
  /** The sender's choice; omitted is the record constructor's `true`. */
  wake?: boolean;
  /** The Task of the message's Goal, when the sender names one. */
  taskRef?: TaskTriple;
  options: DecisionOptionV1[]; objects: DecisionObjectV1[];
  forwardedFrom?: SessionMessageRef;
}>): Promise<WriteResult<SessionMessage>> {
  const owned = ownContext(ctx);
  if (!owned.ok) return owned.rejection;
  if (owned.signal.aborted) return reject('cancelled', 'the user send was cancelled before validation');
  const write = ownWrite(request);
  if (!write.ok) return write.rejection;
  const raw = write.input as unknown as Unknown | null | undefined;
  if (!isObject(raw)) return reject('invalid', 'sendUserMessage requires an input object');

  const rawGoal = raw['goalRef'];
  if (!isGoalRef(rawGoal)) return reject('invalid', 'sendUserMessage requires a complete GoalRef');
  // `ownWrite` already isolated the whole input; a second clone would only copy the copy.
  const goalRef = rawGoal as GoalRef;
  if (goalRef.projectId !== owned.projectId) return reject('forbidden', 'the user message Goal is outside the bound project');

  const rawTaskRef = raw['taskRef'];
  if (rawTaskRef !== undefined) {
    const problem = checkShape(TaskTripleShape, rawTaskRef, 'stored');
    if (problem !== null) return reject('invalid', `sendUserMessage taskRef: ${problem}`);
  }
  const taskRef = rawTaskRef === undefined ? null : rawTaskRef as TaskTriple;
  if (taskRef !== null && (taskRef.projectId !== goalRef.projectId || taskRef.goalId !== goalRef.goalId)) {
    return reject('invalid', 'the user message taskRef is not a Task of the message\'s Goal');
  }

  const intent = raw['intent'];
  if (intent !== 'notify' && intent !== 'decision_request') {
    return reject('invalid', 'the user message intent must be notify or decision_request');
  }
  const text = normalizeText(raw['text'], SESSION_MESSAGE_MAX_TEXT_BYTES);
  if (!text.ok) return text.rejection;
  const needsReply = raw['needsReply'];
  const waitAfterSend = raw['waitAfterSend'];
  if (typeof needsReply !== 'boolean' || typeof waitAfterSend !== 'boolean') {
    return reject('invalid', 'sendUserMessage requires boolean needsReply and waitAfterSend');
  }
  const rawWake = raw['wake'];
  if (rawWake !== undefined && typeof rawWake !== 'boolean') {
    return reject('invalid', 'sendUserMessage wake must be a boolean');
  }
  const wake = rawWake ?? true;
  if (waitAfterSend && !needsReply) return reject('invalid', 'waitAfterSend requires needsReply');
  if (intent === 'decision_request' && !needsReply) {
    return reject('invalid', 'a decision_request must expect a reply');
  }
  const rawOptions = raw['options'];
  const rawObjects = raw['objects'];
  if (!Array.isArray(rawOptions) || !Array.isArray(rawObjects)) {
    return reject('invalid', 'sendUserMessage requires option and object arrays');
  }
  const options = rawOptions as DecisionOptionV1[];
  const objects = rawObjects as DecisionObjectV1[];
  const rawForwardedFrom = raw['forwardedFrom'];
  if (rawForwardedFrom !== undefined && checkSessionMessageRef(rawForwardedFrom) !== null) {
    return reject('invalid', 'the forwardedFrom ref must be a complete SessionMessageRef');
  }
  const forwardedFrom = rawForwardedFrom as SessionMessageRef | undefined;

  let sender: MessageSender | null = null;
  let workRunPrincipal: WorkRunPrincipal | null = null;
  let queryRound: QueryRoundV1 | null = null;
  let secretaryRound: SecretaryQueryRunV1 | null = null;
  let roundGuards: readonly RecordGuard[] = [];
  let senderIdentity: Unknown;
  if (owned.principal.kind === 'host') {
    sender = { kind: 'host', actor: { ...owned.principal.actor } };
    senderIdentity = senderIdentityOf(sender);
  } else if (owned.principal.kind === 'work_run') {
    const identity = await readWorkRunIdentity(mailbox, owned, owned.principal, owned.principal.runRef);
    if (!identity.ok) return identity.rejection;
    const derived = deriveWorkRunSender(mailbox, identity);
    if (!derived.ok) return derived.rejection;
    sender = derived.sender;
    workRunPrincipal = owned.principal;
    senderIdentity = senderIdentityOf(sender);
  } else {
    // The round is resolved after the receipt miss, like the Session send; its
    // literal QueryRun is the identity material.
    senderIdentity = { kind: 'query_run', queryRunRef: { ...owned.principal.queryRunRef } };
  }
  const messageRef = messageRefOf(owned, senderIdentity, write.requestId, owned.workspaceId);
  const identityKey = identityKeyOf('user-send', owned, senderIdentity, write.requestId);
  // The write and `lookupToolCommit` share this payload, `wake` included: the
  // same request id with another wake must not replay the old receipt.
  const fingerprint = fingerprintOf('user-send', owned, senderIdentity, sendUserMessageFingerprintPayload({
    goalRef, intent, text: text.text, needsReply, waitAfterSend, wake, options, objects,
    ...(taskRef === null ? {} : { taskRef }),
    ...(forwardedFrom === undefined ? {} : { forwardedFrom }),
  }), write.expected);
  if (owned.signal.aborted) return reject('cancelled', 'the user send was cancelled before the idempotency lookup');
  const existing = await mailbox.records.lookupCommit({ identityKey, fingerprint });
  if (existing.status === 'ready') return replayMessage(mailbox, existing.value);
  if (existing.code !== 'not_found') return sessionStoreFailureToRejection(existing);

  // A query-round sender is the resolved round's Session and QueryRun (no
  // `answerRef`). A secretary REQUEST round is a sender too: it keeps the
  // resolved `secretary_round` identity and its real `requestRoot`, and its
  // commit carries this round's and the request's current ownership versions.
  if (owned.principal.kind === 'query_run') {
    const routed = await requiredQueryRound(mailbox, owned);
    if (!routed.ok) return routed.rejection;
    const round = routed.round;
    queryRound = round;
    if (round.readOnlyCopy) {
      return reject('forbidden', 'a read-only copy never sends a Session message');
    }
    if (round.requestRound) {
      const resolved = await resolveSecretaryRound(mailbox, owned);
      if (!resolved.ok) return resolved.rejection;
      const ownership = await requestRoundOwnership(mailbox, owned, resolved.round);
      if (!ownership.ok) return ownership.rejection;
      secretaryRound = resolved.round;
      roundGuards = [...round.guards, ...ownership.guards];
      sender = { kind: 'secretary_round', sessionRef: { ...secretaryRound.session },
        queryRunRef: { ...secretaryRound.run }, requestRoot: { ...secretaryRound.requestRoot },
        generation: secretaryRound.sessionGeneration };
    } else {
      roundGuards = round.guards;
      sender = { kind: 'query_run', sessionRef: { ...round.session },
        queryRunRef: { ...round.run }, generation: round.sessionGeneration };
    }
  }
  if (sender === null) throw new Error('a user message reached admission without its trusted sender facts');
  if (sender.kind === 'work_run'
    && (sender.runRef.projectId !== goalRef.projectId || sender.runRef.goalId !== goalRef.goalId)) {
    return reject('forbidden', 'the user message Goal is not the sender Run Goal');
  }
  if (sender.kind === 'query_run') {
    if (queryRound === null) throw new Error('a query-round user message reached admission without its round');
    if (queryRound.effectiveGoalId === null || queryRound.effectiveGoalId !== goalRef.goalId) {
      return reject('forbidden', 'the user message Goal is not the sender round\'s effective Goal');
    }
  }
  if (sender.kind === 'secretary_round') {
    if (secretaryRound === null) throw new Error('a secretary user message reached admission without its round');
    if (secretaryRound.effectiveGoalId === null || secretaryRound.effectiveGoalId !== goalRef.goalId) {
      return reject('forbidden', 'the user message Goal is not the sender round\'s effective Goal');
    }
  }

  // S5-MSG-01: the legacy work_run admission still runs; a refused admission
  // never reads the Goal or the duties facts.
  let authorized: AuthOutcome | null = null;
  if (workRunPrincipal !== null) {
    // A user send is one of the two person tools: `notify_person` asks nothing,
    // `ask_person` carries the decision card. G3 grants these names.
    const operationToolName = intent === 'decision_request' ? 'ask_person' : 'notify_person';
    authorized = await authorizeNewWorkRunAction(mailbox, { owned, principal: workRunPrincipal, operationToolName });
  }
  // D3: the trusted duties seam is the ONLY duties source for a Work Run. A
  // query round already carries its trusted duty and copy flag in the resolver.
  let dutiesAllowSend: boolean;
  let dutiesGuards: readonly RecordGuard[];
  let senderReviewer = false;
  if (sender.kind === 'work_run') {
    if (mailbox.deps.duties === undefined) {
      return reject('unsupported', 'the trusted duties adapter is not configured for a new user message');
    }
    if (owned.signal.aborted) return reject('cancelled', 'the user send was cancelled before the duties read');
    const facts = await mailbox.deps.duties.readMessageDutiesFacts(internalHostContext(mailbox, owned), {
      sessionRef: sender.sessionRef, roleBinding: sender.roleBinding,
    });
    if (facts.status !== 'ready') {
      if (facts.status === 'rejected') return facts;
      return mapReadResult(facts) as CoreRejection;
    }
    dutiesGuards = facts.value.guards;
    dutiesAllowSend = canSendUserMessage({
      duties: facts.value.duties, readOnlyCopy: facts.value.readOnlyCopy,
      independentReview: facts.value.independentReview,
      kind: intent === 'decision_request' ? 'ask_person' : 'notify_person',
    });
    senderReviewer = facts.value.independentReview || facts.value.duties.includes('reviewer');
  } else if (sender.kind === 'query_run') {
    if (queryRound === null) throw new Error('a query-round user message reached admission without its round');
    dutiesGuards = queryRound.guards;
    dutiesAllowSend = canSendUserMessage({
      duties: queryRound.duty === 'unknown' ? [] : [queryRound.duty],
      readOnlyCopy: queryRound.readOnlyCopy, independentReview: false,
      kind: intent === 'decision_request' ? 'ask_person' : 'notify_person',
    });
    senderReviewer = queryRound.duty === 'reviewer';
  } else if (sender.kind === 'secretary_round') {
    if (secretaryRound === null) throw new Error('a secretary user message reached admission without its round');
    dutiesGuards = roundGuards;
    dutiesAllowSend = canSendUserMessage({
      duties: ['secretary'], readOnlyCopy: false, independentReview: false,
      kind: intent === 'decision_request' ? 'ask_person' : 'notify_person',
    });
  } else {
    return reject('unsupported', 'a user message must be sent by a trusted Session');
  }
  // C23: the reviewer's only person send is a notification: no card, no reply,
  // no waking. Ask-person/card and every other kind are refused with this text.
  if (senderReviewer && !(intent === 'notify' && !needsReply && !waitAfterSend && wake === false)) {
    return reject('forbidden', '独立审阅只发请知悉');
  }

  // S5-MSG-01: the real owning Goal of the recipient user workspace.
  if (owned.signal.aborted) return reject('cancelled', 'the user send was cancelled before the Goal read');
  const goalRead = await loadGoal(mailbox, owned, goalRef);
  if (goalRead.status !== 'ready') return mapReadResult(goalRead) as CoreRejection;
  const goal = goalRead.value;
  if (goal.workspaceRef.projectId !== owned.projectId || goal.workspaceRef.workspaceId !== owned.workspaceId) {
    return reject('forbidden', 'the user message Goal is outside the bound workspace');
  }
  for (const pin of write.expected) {
    if (canonicalOf(pin.ref) === canonicalOf(goal.ref) && pin.revision !== goal.revision) {
      return reject('revision_conflict', 'the Goal revision changed since it was read', [pin]);
    }
  }

  // S5-MSG-01 decision parameters; only a decision_request carries metadata.
  let decisionMetadata: DecisionMessageMetadataV1 | null = null;
  let decisionObjectPins: VersionPin[] = [];
  if (intent === 'decision_request') {
    if (!validOptionObjects(mailbox, options, objects)) {
      return reject('invalid', 'the decision request options or objects are invalid');
    }
    // §3.3 line 614: establish every object kind's owning Workspace first.
    const objectWorkspaceProblem = verifyDecisionObjectWorkspaces(mailbox, owned, objects);
    if (objectWorkspaceProblem !== null) return objectWorkspaceProblem;
    // §3.3 line 614: read every real source object before state and guard it.
    decisionObjectPins = aggregateObjectPins(mailbox, objects);
    const objectProblem = await verifyDecisionObjectPins(mailbox, owned, decisionObjectPins);
    if (objectProblem !== null) return objectProblem;
    const sourcePins = dedupePins(mailbox, [{ ref: structuredClone(goal.ref), revision: goal.revision }, ...decisionObjectPins])
      .filter((pin) => canonicalOf(pin.ref) !== canonicalOf(messageRef));
    const source = {
      kind: 'message' as const,
      key: decisionSourceKey({ kind: 'message', messageRef }),
      subject: { kind: 'goal' as const, goalRef },
      pins: sourcePins,
      goalBases: [goalBasis(mailbox, goal)],
    };
    const metadata: DecisionMessageMetadataV1 = {
      schemaVersion: 1, source, objects, options, syntheticAnswer: false,
      forwardedFrom: forwardedFrom === undefined ? null : forwardedFrom as SessionMessageRef,
    };
    if (Buffer.byteLength(source.key, 'utf8') > 8192
      || Buffer.byteLength(canonicalJson(metadata as never), 'utf8') > 64 * 1024) {
      return reject('capacity', 'the decision message metadata exceeds its bound');
    }
    decisionMetadata = metadata;
  } else if (options.length > 0 || objects.length > 0) {
    return reject('invalid', 'a notify user message carries no options or objects');
  }

  const userRecipient: MessageRecipient = { kind: 'user', projectId: owned.projectId, workspaceId: owned.workspaceId };
  const { decided, ctx: messageCtx } = judge(owned.principal, null, { type: 'message_sent' }, {
    recipientScope: 'same_workspace',
    sendFlags: { needsReply, waitAfterSend, pinCount: 0 },
    userSend: { goalScopeMatches: true, dutiesAllowSend, decisionParamsValid: true },
    workRunAuthorization: authorized === null ? null : authorized.ok ? 'ok' : authorized.rejection,
  });
  if (!decided.ok) return refuse(mailbox, decided, messageCtx, identityKey, fingerprint);

  const extraGuards: RecordGuard[] = [...dutiesGuards,
    { refKey: canonicalRefKey(goal.ref), expectedRevision: goal.revision }];
  for (const pin of decisionObjectPins) {
    const refKey = canonicalOf(pin.ref);
    if (refKey !== null) extraGuards.push({ refKey, expectedRevision: pin.revision });
  }
  for (const pin of write.expected) {
    const refKey = canonicalOf(pin.ref);
    if (refKey !== null && isPositiveInt(pin.revision)) extraGuards.push({ refKey, expectedRevision: pin.revision });
  }
  return writeMessage(mailbox, decided, {
    owned, identityKey, fingerprint, requestId: write.requestId, actor: sender, admission: authorized,
    cancelled: 'the user send was cancelled before commit',
    body: { messageRef, text: text.text, answerSource: null },
    extraGuards,
    record: (createdAt, bodyRef) => createSessionMessageRecord({
      ref: messageRef, sender, recipient: userRecipient, bodyRef, sourceRef: bodyRef.source, createdAt,
      wake, needsReply, waitAfterSend,
      ...(taskRef === null ? {} : { taskRef }),
      goalRef,
      requestRoot: secretaryRound === null ? null : { ...secretaryRound.requestRoot },
      ...(decisionMetadata === null ? {} : { decision: decisionMetadata }),
    }),
  });
}
