import type { SessionRef, VersionPin } from '../../../../contracts/core/identity.js';
import type { DecisionObjectV1, DecisionOptionV1, DecisionSourceIdentityV1,
  GoalDecisionBasisV1 } from '../../../../contracts/goal-decisions.js';
import { rejectedWithCurrent } from '../../../../contracts/core/rejections.js';
import type { GoalRef, GoalSnapshot } from '../../../../contracts/ledger.js';
import { decodeSessionMessageRecord } from '../../sessions/message-record-codecs.js';
import { isMessageAgentSender } from '../../state/message-machine.js';
import { goalBasis, isUserRecipient, sameJson } from './read-support.js';
import type { SourceReadResult, SourceReadSupport } from './types.js';

/** The `message` decision source: a real user decision request and its Goal. */
export async function readMessageSource(
  support: SourceReadSupport,
  identity: Extract<DecisionSourceIdentityV1, { kind: 'message' }>,
  goalRef: GoalRef,
): Promise<SourceReadResult> {
  let goal: GoalSnapshot;
  let objects: DecisionObjectV1[] = [];
  let options: DecisionOptionV1[] = [];
  let pins: VersionPin[] = [];
  let goalBases: GoalDecisionBasisV1[] = [];
  let closed = false;
  let allowedReaderSessionRefs: SessionRef[] = [];
  const messageProblem = support.scopeProblem(identity.messageRef);
  if (messageProblem !== null) return messageProblem;
  const loaded = await support.readEncoded(identity.messageRef);
  if (!loaded.ok) return loaded.rejection;
  const decoded = decodeSessionMessageRecord(loaded.record);
  if (decoded.status !== 'decoded') return rejectedWithCurrent('unavailable', `the message record is damaged: ${decoded.reason}`);
  const message = decoded.value;
  // §2.3: the card is recognized by its formal card metadata and the saved `decision`, never by a message intent.
  if (!isUserRecipient(message.recipient) || message.decision === undefined || message.decision.syntheticAnswer) {
    return rejectedWithCurrent('invalid', 'the decision source message is not an answerable user decision card');
  }
  // The message's own Goal wins when it has one; otherwise the source subject's.
  const goalRead = await support.readGoal(message.goalRef ?? goalRef);
  if (goalRead.status !== 'ready') return goalRead;
  goal = goalRead.value;
  if (goal.ref.projectId !== support.scope.projectId || goal.workspaceRef.workspaceId !== support.scope.workspaceId) {
    return rejectedWithCurrent('forbidden', 'the decision source Goal is outside the bound scope');
  }
  // §2.3 line 224: the answer source is generated in the current window;
  // the Goal pin follows the current Goal revision and the basis is the
  // formal Goal. The message's own pin stays out of `source.pins`.
  const refreshed = await support.refreshPins(message.decision.source.pins);
  if (refreshed.status !== 'ready') return refreshed;
  pins = refreshed.value.filter((pin) => !sameJson(pin.ref, message.ref));
  objects = message.decision.objects.map((object) => structuredClone(object));
  options = message.decision.options.map((option) => structuredClone(option));
  goalBases = [goalBasis(goal)];
  closed = goal.desiredState === 'cancelled';
  // §4.6: every trusted agent sender line (`work_run`, `query_run`, `secretary_round`) names the formal
  // reader; the caller must still be that exact Session.
  allowedReaderSessionRefs = isMessageAgentSender(message.sender)
    ? [{ projectId: message.sender.sessionRef.projectId, sessionId: message.sender.sessionRef.sessionId }] : [];
  return { status: 'ready', value: { goal, objects, options, pins, goalBases, closed, allowedReaderSessionRefs } };
}
