/**
 * A.2 rework shape checks (spec §4.1, §9.1, §13.1).
 *
 * The pure, closed shape validators shared by the claim codecs
 * (`TaskRequeue@1`, `TaskReworkRefusal@1` and their events, the Attempt
 * `requeueRef`), the Run reader (`requeueRef`, reconciliation intent refs) and
 * the round codec (`RoundSnapshot.chain.reverify`). They only check encoding, identity and the
 * enumerations the contracts declare; derived values (actor class, automatic
 * counts, key digests) are produced by the `state/` constructors and checked by
 * the invariant checks, never re-derived here. No I/O, no Store access.
 */
import { MAX_NEW_BASIS_INPUT_REFS } from '../../../contracts/no-progress.js';
import { REWORK_FAILURE_CLASSES } from '../../../contracts/task-requeue.js';
import { ROUND_CHECK_INCOMPLETE_CAUSES } from '../../../contracts/verification.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import { isArtifactRef } from '../../record-store/body-codec.js';

type UnknownRecord = Record<string, unknown>;
/** `null` = the check passed; a string is the precise rejection reason. */
export type Problem = string | null;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
export function isPositiveSafeInteger(value: unknown): value is number {
  return isNonNegativeSafeInteger(value) && value >= 1;
}
export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
export function hasOnlyKeys(value: UnknownRecord, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}
/** Canonical JSON equality; false when either side is not canonical JSON. */
export function sameJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue);
  } catch {
    return false;
  }
}

// --------------------------------------------------------------------------
// References and actors
// --------------------------------------------------------------------------

/** Mirrors `contracts/validation/identity.ts::validateActor`: human, system or agent with its RunRef. */
export function actorRefProblem(value: unknown, label: string): Problem {
  if (!isRecord(value) || !nonEmpty(value['id'])) return `${label} must be an ActorRef`;
  if (value['kind'] === 'human' || value['kind'] === 'system') {
    return hasOnlyKeys(value, ['kind', 'id']) ? null : `${label} carries unknown fields`;
  }
  if (value['kind'] !== 'agent') return `${label} kind must be human, system or agent`;
  if (!hasOnlyKeys(value, ['kind', 'id', 'runRef'])) return `${label} carries unknown fields`;
  return runRefProblem(value['runRef'], `${label}.runRef`);
}
export function taskTripleProblem(value: unknown, label: string): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['projectId', 'goalId', 'taskId'])
    || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId']) || !nonEmpty(value['taskId'])) {
    return `${label} must be a complete TaskTriple`;
  }
  return null;
}
export function runRefProblem(value: unknown, label: string): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'goalId', 'runId'])
    || value['aggregateType'] !== 'Run' || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId'])
    || !nonEmpty(value['runId'])) {
    return `${label} must be a complete RunRef`;
  }
  return null;
}
export function taskAttemptRefProblem(value: unknown, label: string): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'goalId', 'taskId', 'attemptId'])
    || value['aggregateType'] !== 'TaskAttempt' || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId'])
    || !nonEmpty(value['taskId']) || !nonEmpty(value['attemptId'])) {
    return `${label} must be a complete TaskAttemptRef`;
  }
  return null;
}
export function planRevisionRefProblem(value: unknown, label: string, projectId: string): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'planId'])
    || value['aggregateType'] !== 'PlanRevision' || !nonEmpty(value['planId'])) {
    return `${label} must be a complete PlanRevisionRef`;
  }
  return value['projectId'] === projectId ? null : `${label} belongs to another project`;
}
export function goalRefProblem(value: unknown, label: string): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'goalId'])
    || value['aggregateType'] !== 'Goal' || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId'])) {
    return `${label} must be a complete GoalRef`;
  }
  return null;
}
export function verificationRoundRefProblem(value: unknown, label: string): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'workspaceId', 'goalId', 'taskId', 'runId', 'roundId'])
    || value['aggregateType'] !== 'VerificationRound') {
    return `${label} must be a complete VerificationRoundRef`;
  }
  for (const field of ['projectId', 'workspaceId', 'goalId', 'taskId', 'runId', 'roundId']) {
    if (!nonEmpty(value[field])) return `${label} is missing ${field}`;
  }
  return null;
}
export function sessionRefProblem(value: unknown, label: string): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['projectId', 'sessionId'])
    || !nonEmpty(value['projectId']) || !nonEmpty(value['sessionId'])) {
    return `${label} must be a complete SessionRef`;
  }
  return null;
}
/** A complete `TaskRequeueRef` (spec §4.1); scope agreement is checked by the owner. */
export function taskRequeueRefProblem(value: unknown, label: string): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'goalId', 'taskId', 'afterRunId'])
    || value['aggregateType'] !== 'TaskRequeue' || !nonEmpty(value['projectId']) || !nonEmpty(value['goalId'])
    || !nonEmpty(value['taskId']) || !nonEmpty(value['afterRunId'])) {
    return `${label} must be a complete TaskRequeueRef`;
  }
  return null;
}
export function controlIntentRefProblem(value: unknown, label: string): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['aggregateType', 'projectId', 'workspaceId', 'intentId'])
    || value['aggregateType'] !== 'ControlIntent' || !nonEmpty(value['projectId'])
    || !nonEmpty(value['workspaceId']) || !nonEmpty(value['intentId'])) {
    return `${label} must be a complete ControlIntentRef`;
  }
  return null;
}

// --------------------------------------------------------------------------
// Small facts
// --------------------------------------------------------------------------

export function reworkFailureClassProblem(value: unknown, label: string): Problem {
  return typeof value === 'string' && (REWORK_FAILURE_CLASSES as readonly string[]).includes(value)
    ? null : `${label} is not a ReworkFailureClass`;
}
export function taskBudgetProblem(value: unknown, label: string): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['tokenBudget', 'deadline']) || !isNonNegativeSafeInteger(value['tokenBudget'])
    || !(value['deadline'] === null || typeof value['deadline'] === 'string')) {
    return `${label} must be a TaskBudgetV1`;
  }
  return null;
}
/** `SourceStampV1`: a digest-only whole-workspace capture (ND-2, ND-4). */
export function sourceStampProblem(value: unknown, label: string): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['workspaceRevision', 'sourceDigest'])
    || !isNonNegativeSafeInteger(value['workspaceRevision']) || !nonEmpty(value['sourceDigest'])) {
    return `${label} must be a SourceStampV1`;
  }
  return null;
}
/** `NewBasisInputRefV1[]` (at most `MAX_NEW_BASIS_INPUT_REFS`); verification happens in the owner. */
export function newBasisInputRefsProblem(value: unknown, label: string): Problem {
  if (!Array.isArray(value)) return `${label} must be an array`;
  if (value.length > MAX_NEW_BASIS_INPUT_REFS) return `${label} holds more than ${String(MAX_NEW_BASIS_INPUT_REFS)} inputs`;
  for (const [index, entry] of value.entries()) {
    const path = `${label}[${String(index)}]`;
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['kind', 'ref'])) return `${path} must be a NewBasisInputRefV1`;
    if (entry['kind'] === 'artifact') {
      if (!isArtifactRef(entry['ref'])) return `${path}.ref must be a complete ArtifactRef`;
      continue;
    }
    if (entry['kind'] !== 'session_message') return `${path}.kind must be session_message or artifact`;
    const ref = entry['ref'];
    if (!isRecord(ref) || !hasOnlyKeys(ref, ['aggregateType', 'projectId', 'workspaceId', 'messageId'])
      || ref['aggregateType'] !== 'SessionMessage' || !nonEmpty(ref['projectId'])
      || !nonEmpty(ref['workspaceId']) || !nonEmpty(ref['messageId'])) {
      return `${path}.ref must be a complete SessionMessageRef`;
    }
  }
  return null;
}

const CHECK_PHASES: readonly string[] = ['pending', 'executing', 'finished', 'interrupted'];
const EVIDENCE_OUTCOMES: readonly string[] = ['PASS', 'FAIL', 'INCONCLUSIVE'];

/** `RoundCheckIncompleteCause | null`. */
export function incompleteCauseProblem(value: unknown, label: string): Problem {
  return value === null || (typeof value === 'string' && (ROUND_CHECK_INCOMPLETE_CAUSES as readonly string[]).includes(value))
    ? null : `${label} must be a RoundCheckIncompleteCause or null`;
}
/** `NoProgressCheckFactV1[]` (ND-1: no report digest). */
function noProgressChecksProblem(value: unknown, label: string): Problem {
  if (!Array.isArray(value)) return `${label} must be an array`;
  for (const [index, entry] of value.entries()) {
    const path = `${label}[${String(index)}]`;
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['checkId', 'phase', 'outcome', 'cause']) || !nonEmpty(entry['checkId'])) {
      return `${path} must be a NoProgressCheckFactV1`;
    }
    if (!CHECK_PHASES.includes(entry['phase'] as string)) return `${path}.phase is not recognized`;
    if (!(entry['outcome'] === null || EVIDENCE_OUTCOMES.includes(entry['outcome'] as string))) {
      return `${path}.outcome must be an EvidenceOutcome or null`;
    }
    const cause = incompleteCauseProblem(entry['cause'], `${path}.cause`);
    if (cause !== null) return cause;
  }
  return null;
}
function gapCodesProblem(value: unknown, label: string): Problem {
  return Array.isArray(value) && value.every(nonEmpty) ? null : `${label} must be an array of non-empty strings`;
}

const KNOWN_OUTCOMES: readonly string[] = ['completed', 'failed', 'cancelled', 'budget_exhausted', 'crashed', 'yielded'];
const FAILURE_ORIGINS: readonly string[] = ['observed', 'host_interrupted', 'human_attested'];

/** The §13.1 requeue key `NoProgressKeyV1` (stored on `TaskRequeue.basis`). */
export function noProgressKeyProblem(value: unknown, label: string): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['taskRef', 'actionKind', 'failure', 'source', 'plan', 'newInputDigest', 'digest'])) {
    return `${label} must be a NoProgressKeyV1`;
  }
  const task = taskTripleProblem(value['taskRef'], `${label}.taskRef`);
  if (task !== null) return task;
  if (value['actionKind'] !== 'requeue') return `${label}.actionKind must be requeue`;
  const failure = value['failure'];
  if (!isRecord(failure) || !hasOnlyKeys(failure, ['outcome', 'origin', 'exhaustedTokenBudget', 'checks', 'gapCodes'])) {
    return `${label}.failure is incomplete`;
  }
  if (!KNOWN_OUTCOMES.includes(failure['outcome'] as string)) return `${label}.failure.outcome must be a known RunOutcome`;
  if (!FAILURE_ORIGINS.includes(failure['origin'] as string)) return `${label}.failure.origin is not a RunFailureOrigin`;
  if (!(failure['exhaustedTokenBudget'] === null || isNonNegativeSafeInteger(failure['exhaustedTokenBudget']))) {
    return `${label}.failure.exhaustedTokenBudget must be null or a non-negative safe integer`;
  }
  const checks = noProgressChecksProblem(failure['checks'], `${label}.failure.checks`);
  if (checks !== null) return checks;
  const gaps = gapCodesProblem(failure['gapCodes'], `${label}.failure.gapCodes`);
  if (gaps !== null) return gaps;
  const source = sourceStampProblem(value['source'], `${label}.source`);
  if (source !== null) return source;
  const projectId = (value['taskRef'] as UnknownRecord)['projectId'] as string;
  const plan = planRevisionRefProblem(value['plan'], `${label}.plan`, projectId);
  if (plan !== null) return plan;
  if (!(value['newInputDigest'] === null || isSha256Hex(value['newInputDigest']))) {
    return `${label}.newInputDigest must be null or a sha256 hex`;
  }
  return isSha256Hex(value['digest']) ? null : `${label}.digest must be a sha256 hex`;
}

function governancePinProblem(value: unknown, label: string, aggregateType: string, idField: string, projectId: string): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['ref', 'digest']) || !isSha256Hex(value['digest'])) {
    return `${label} must be a pin with a sha256 digest`;
  }
  const ref = value['ref'];
  if (!isRecord(ref) || !hasOnlyKeys(ref, ['aggregateType', 'projectId', idField, 'revision'])
    || ref['aggregateType'] !== aggregateType || ref['projectId'] !== projectId
    || !nonEmpty(ref[idField]) || !isPositiveSafeInteger(ref['revision'])) {
    return `${label}.ref must be a ${aggregateType} ref of this project`;
  }
  return null;
}

/** The §13.7 reverify key `ReverifyBasisV1` (stored on `RoundChainV1.reverify.basis`). */
export function reverifyBasisProblem(value: unknown, label: string): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['subject', 'subjectRunId', 'actionKind', 'failure', 'source',
    'configuration', 'verificationInputs', 'newInputDigest', 'digest'])) {
    return `${label} must be a ReverifyBasisV1`;
  }
  const subject = taskTripleProblem(value['subject'], `${label}.subject`);
  if (subject !== null) return subject;
  if (!nonEmpty(value['subjectRunId'])) return `${label}.subjectRunId is required`;
  if (value['actionKind'] !== 'reverify') return `${label}.actionKind must be reverify`;
  const failure = value['failure'];
  if (!isRecord(failure) || !hasOnlyKeys(failure, ['checks', 'gapCodes'])) return `${label}.failure is incomplete`;
  const checks = noProgressChecksProblem(failure['checks'], `${label}.failure.checks`);
  if (checks !== null) return checks;
  const gaps = gapCodesProblem(failure['gapCodes'], `${label}.failure.gapCodes`);
  if (gaps !== null) return gaps;
  const source = sourceStampProblem(value['source'], `${label}.source`);
  if (source !== null) return source;
  const configuration = value['configuration'];
  if (!isRecord(configuration) || !hasOnlyKeys(configuration, ['configurationRevision', 'configurationDigest'])
    || !nonEmpty(configuration['configurationRevision']) || !nonEmpty(configuration['configurationDigest'])) {
    return `${label}.configuration must carry configurationRevision and configurationDigest`;
  }
  const projectId = (value['subject'] as UnknownRecord)['projectId'] as string;
  const inputs = value['verificationInputs'];
  if (!isRecord(inputs) || !hasOnlyKeys(inputs, ['basisPlanRef', 'completionPolicyPin', 'architectureBaselinePin'])) {
    return `${label}.verificationInputs is incomplete`;
  }
  const plan = planRevisionRefProblem(inputs['basisPlanRef'], `${label}.verificationInputs.basisPlanRef`, projectId);
  if (plan !== null) return plan;
  const policy = governancePinProblem(inputs['completionPolicyPin'], `${label}.verificationInputs.completionPolicyPin`,
    'CompletionPolicyRevision', 'policyId', projectId);
  if (policy !== null) return policy;
  const baseline = governancePinProblem(inputs['architectureBaselinePin'], `${label}.verificationInputs.architectureBaselinePin`,
    'ArchitectureBaselineRevision', 'baselineId', projectId);
  if (baseline !== null) return baseline;
  if (!(value['newInputDigest'] === null || isSha256Hex(value['newInputDigest']))) {
    return `${label}.newInputDigest must be null or a sha256 hex`;
  }
  return isSha256Hex(value['digest']) ? null : `${label}.digest must be a sha256 hex`;
}

/** `DelegatedWriteProvenanceV1` (the former `PlanWriteProvenanceV1` JSON shape). */
export function delegatedWriteProvenanceProblem(value: unknown, label: string, projectId: string): Problem {
  if (!isRecord(value) || !hasOnlyKeys(value, ['schemaVersion', 'runRef', 'sessionRef', 'roleBinding', 'sessionGeneration',
    'entryGeneration', 'authorizationRevision', 'configurationRevision'])) {
    return `${label} must be a DelegatedWriteProvenanceV1`;
  }
  if (value['schemaVersion'] !== 1) return `${label}.schemaVersion must be 1`;
  const run = runRefProblem(value['runRef'], `${label}.runRef`);
  if (run !== null) return run;
  if ((value['runRef'] as UnknownRecord)['projectId'] !== projectId) return `${label}.runRef belongs to another project`;
  const session = sessionRefProblem(value['sessionRef'], `${label}.sessionRef`);
  if (session !== null) return session;
  const binding = value['roleBinding'];
  if (!isRecord(binding) || binding['schemaVersion'] !== 1 || !nonEmpty(binding['bindingId'])
    || !nonEmpty(binding['templateId']) || !nonEmpty(binding['templateRevision'])
    || !isNonNegativeSafeInteger(binding['bindingVersion']) || !nonEmpty(binding['policyRevision'])) {
    return `${label}.roleBinding must be a RoleBindingRefV1`;
  }
  for (const field of ['sessionGeneration', 'entryGeneration', 'authorizationRevision']) {
    if (!isPositiveSafeInteger(value[field])) return `${label}.${field} must be a positive safe integer`;
  }
  return nonEmpty(value['configurationRevision']) ? null : `${label}.configurationRevision is required`;
}
