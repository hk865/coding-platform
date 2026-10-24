import type { ModuleRef, SessionRef, VersionPin } from '../../../../contracts/core/identity.js';
import type { ReadResult } from '../../../../contracts/core/results.js';
import type { DecisionObjectV1, DecisionOptionV1, DecisionSourceIdentityV1,
  DecisionSourceV1, GoalDecisionBasisV1, GoalFootprintV1 } from '../../../../contracts/goal-decisions.js';
import { canonicalJson, canonicalOf, type JsonValue } from '../../../../contracts/fingerprint.js';
import { rejectedWithCurrent } from '../../../../contracts/core/rejections.js';
import type { GoalSnapshot } from '../../../../contracts/ledger.js';
import { goalConflictFacts } from '../../state/goal-settings-machine.js';
import { decodeGoalPhaseSnapshot } from '../../tasks/completion-record-codecs.js';
import { decodePlanRevisionSnapshot } from '../../persistence/plan-record-codecs.js';
import { goalBasis, sameJson } from './read-support.js';
import type { SourceReadResult, SourceReadSupport } from './types.js';

/** SPEC §4.3: the three fixed conflict options, in the fixed wait/order/parallel order. */
const CONFLICT_OPTIONS: readonly DecisionOptionV1[] = [
  { id: 'wait', label: '等前一个目标', effect: 'apply' },
  { id: 'order', label: '调整顺序', effect: 'apply' },
  { id: 'parallel', label: '接受风险并行', effect: 'apply' },
];

/** §4.3: the active Plan's planned module scopes (work Tasks only). */
async function plannedModules(support: SourceReadSupport, goal: GoalSnapshot): Promise<ReadResult<ModuleRef[]>> {
  if (goal.activePlanRevision === null) return { status: 'ready', value: [] };
  const read = await support.readDecoded(goal.activePlanRevision, decodePlanRevisionSnapshot, 'PlanRevision');
  if (read.status !== 'ready') return read;
  const modules: ModuleRef[] = [];
  const seen = new Set<string>();
  for (const task of read.value.tasks) {
    if (task.taskKind !== 'work' || task.disposition === 'cancelled' || task.disposition === 'superseded'
      || task.scope.kind !== 'module') continue;
    const module = { projectId: goal.ref.projectId, moduleId: task.scope.moduleRef };
    const key = canonicalOf(module) ?? '';
    if (seen.has(key)) continue;
    seen.add(key);
    modules.push(module);
  }
  return { status: 'ready', value: modules };
}

async function footprintOf(support: SourceReadSupport, goal: GoalSnapshot): Promise<ReadResult<GoalFootprintV1>> {
  const modules = await plannedModules(support, goal);
  if (modules.status !== 'ready') return modules;
  return { status: 'ready', value: {
    goalRef: structuredClone(goal.ref),
    planRef: structuredClone(goal.activePlanRevision),
    plannedModules: modules.value,
    executedFiles: [],
    executedFilesAvailable: false,
    possiblyIncomplete: true,
  } };
}

async function goalTerminal(support: SourceReadSupport, goal: GoalSnapshot): Promise<{ cancelled: boolean; completed: boolean } | ReadResult<never>> {
  if (goal.desiredState === 'cancelled') return { cancelled: true, completed: false };
  const phaseRef = { aggregateType: 'GoalPhase' as const, projectId: goal.ref.projectId, goalId: goal.ref.goalId };
  const decoded = await support.readDecoded(phaseRef, decodeGoalPhaseSnapshot, 'GoalPhase');
  if (decoded.status === 'ready') {
    // §4.3 line 829: only a completion of the CURRENT active Plan is terminal.
    const completedPlanIsActive = goal.activePlanRevision !== null
      && canonicalJson(decoded.value.planRef as unknown as JsonValue) === canonicalJson(goal.activePlanRevision as unknown as JsonValue);
    return { cancelled: false, completed: decoded.value.phase === 'COMPLETED' && completedPlanIsActive };
  }
  // §8.2 data row: only an absent GoalPhase means no recorded completion.
  if (decoded.status === 'not_found' || (decoded.status === 'rejected' && decoded.code === 'not_found')) {
    return { cancelled: false, completed: false };
  }
  return decoded.status === 'rejected' ? decoded : rejectedWithCurrent('unavailable', 'the GoalPhase is not readable');
}

/** The `goal_conflict` decision source: both Goals, both active Plans and a real §4.3 overlap. */
export async function readGoalConflictSource(
  support: SourceReadSupport,
  source: DecisionSourceV1,
  identity: Extract<DecisionSourceIdentityV1, { kind: 'goal_conflict' }>,
): Promise<SourceReadResult> {
  let goal: GoalSnapshot;
  let objects: DecisionObjectV1[] = [];
  let options: DecisionOptionV1[] = [];
  let pins: VersionPin[] = [];
  let goalBases: GoalDecisionBasisV1[] = [];
  let closed = false;
  let allowedReaderSessionRefs: SessionRef[] = [];
  // §8.2: both Goals are scope-checked BEFORE either record is read.
  for (const member of identity.pair) {
    const memberProblem = support.scopeProblem(member.goalRef);
    if (memberProblem !== null) return memberProblem;
  }
  const goals: GoalSnapshot[] = [];
  for (const member of identity.pair) {
    const goalRead = await support.readGoal(member.goalRef);
    if (goalRead.status !== 'ready') return goalRead;
    const memberGoal = goalRead.value;
    if (memberGoal.workspaceRef.projectId !== support.scope.projectId || memberGoal.workspaceRef.workspaceId !== support.scope.workspaceId) {
      return rejectedWithCurrent('forbidden', 'a conflict Goal is outside the bound scope');
    }
    if (!sameJson(memberGoal.activePlanRevision, member.activePlanRef)) {
      return rejectedWithCurrent('revision_conflict', 'a conflict Goal active Plan pointer moved since the pair was read',
        [{ ref: structuredClone(memberGoal.ref), revision: memberGoal.revision }]);
    }
    goals.push(memberGoal);
  }
  if (goals.length !== 2 || sameJson(goals[0]!.ref, goals[1]!.ref)) {
    return rejectedWithCurrent('invalid', 'a goal conflict names two distinct Goals');
  }
  const leftFootprint = await footprintOf(support, goals[0]!);
  if (leftFootprint.status !== 'ready') return leftFootprint;
  const rightFootprint = await footprintOf(support, goals[1]!);
  if (rightFootprint.status !== 'ready') return rightFootprint;
  if (!goalConflictFacts(leftFootprint.value, rightFootprint.value).overlaps) {
    return rejectedWithCurrent('not_found', 'the two Goals have no §4.3 footprint conflict');
  }
  const named = goals.find((candidate) => sameJson(candidate.ref, source.goalRef));
  if (named === undefined) return rejectedWithCurrent('invalid', 'the conflict source does not name one of its Goals');
  goal = named;
  pins = goals.map((member) => ({ ref: structuredClone(member.ref), revision: member.revision }));
  for (const member of goals) {
    if (member.activePlanRevision !== null) {
      pins.push({ ref: structuredClone(member.activePlanRevision), revision: 1 });
    }
  }
  objects = [];
  options = CONFLICT_OPTIONS.map((option) => ({ ...option }));
  goalBases = goals.map(goalBasis);
  const terminals = await Promise.all(goals.map((member) => goalTerminal(support, member)));
  const unreadable = terminals.find((terminal) => 'status' in terminal);
  if (unreadable !== undefined && 'status' in unreadable) return unreadable;
  closed = terminals.some((terminal) => !('status' in terminal) && (terminal.cancelled || terminal.completed));
  return { status: 'ready', value: { goal, objects, options, pins, goalBases, closed, allowedReaderSessionRefs } };
}
