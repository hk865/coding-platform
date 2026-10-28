import type { SessionRef, VersionPin } from '../../../../contracts/core/identity.js';
import type { DecisionObjectV1, DecisionOptionV1, DecisionSourceIdentityV1,
  GoalDecisionBasisV1 } from '../../../../contracts/goal-decisions.js';
import { rejectedWithCurrent } from '../../../../contracts/core/rejections.js';
import type { GoalRef, GoalSnapshot } from '../../../../contracts/ledger.js';
import { decodeSessionMessageRecord } from '../../sessions/message-record-codecs.js';
import { messageReleaseCardFacts } from '../../tasks/message-release-card.js';
import { clonePins } from './read-support.js';
import type { SourceReadResult, SourceReadSupport } from './types.js';

/**
 * The `message_release` decision source: the real message record, its Goal and the card's own facts. The derived
 * block is the read's DTO, not a source fact, so the branch facts never carry it.
 */
export async function readMessageReleaseSource(
  support: SourceReadSupport,
  identity: Extract<DecisionSourceIdentityV1, { kind: 'message_release' }>,
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
  // The release message's own Goal is the card's Goal; a message without one is not this source.
  const messageGoalRef = message.goalRef;
  if (messageGoalRef === null || messageGoalRef.projectId !== goalRef.projectId
    || messageGoalRef.goalId !== goalRef.goalId) {
    return rejectedWithCurrent('forbidden', 'the release message does not belong to the decision source Goal');
  }
  const goalRead = await support.readGoal(messageGoalRef);
  if (goalRead.status !== 'ready') return goalRead;
  goal = goalRead.value;
  if (goal.ref.projectId !== support.scope.projectId || goal.workspaceRef.workspaceId !== support.scope.workspaceId) {
    return rejectedWithCurrent('forbidden', 'the decision source Goal is outside the bound scope');
  }
  const facts = messageReleaseCardFacts({ message, goal });
  pins = clonePins(facts.source.pins);
  objects = facts.objects.map((object) => structuredClone(object));
  options = facts.options.map((option) => structuredClone(option));
  goalBases = facts.source.goalBases ?? [];
  closed = facts.closedReason !== null;
  allowedReaderSessionRefs = [];
  return { status: 'ready', value: { goal, objects, options, pins, goalBases, closed, allowedReaderSessionRefs } };
}
