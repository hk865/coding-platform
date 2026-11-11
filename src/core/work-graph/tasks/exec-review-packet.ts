/**
 * Slice 9: the exec review packet header.
 * `ExecReviewPacketV1` is the only header of the review request body and it is
 * not a record: the build reads only the frozen round, the text writes the
 * request id, seven canonical-JSON lines, one blank line and the fixed prose,
 * and the parse reads exactly that shape back. The model sees the header, but
 * the `submit_exec_review` schema has none of these members.
 */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import { rejected } from '../../../contracts/core/rejections.js';
import type { CoreRejection } from '../../../contracts/core/results.js';
import type { RunRef, TaskTriple } from '../../../contracts/dispatch.js';
import { requirementKeyOf, type EvidenceCoverageV1 } from '../../../contracts/evidence.js';
import { canonicalJson, type JsonValue } from '../../../contracts/fingerprint.js';
import type { PlanRevisionRef } from '../../../contracts/plan.js';
import { hasOnlyKeys, isRecord, nonEmpty, parseObject } from '../../../contracts/validation/common.js';
import type { RoundSnapshot, VerificationRoundRef } from '../../../contracts/verification.js';
import {
  planRevisionRefProblem, runRefProblem, taskTripleProblem, verificationRoundRefProblem,
} from '../persistence/rework-codecs.js';
import { checkArtifactRef } from '../sessions/session-record-codecs.js';

export type ExecReviewPacketV1 = {
  roundRef: VerificationRoundRef;
  planRevisionRef: PlanRevisionRef;
  taskRef: TaskTriple;
  subjectRunRef: RunRef;
  checkRefs: ArtifactRef[];
  sourceDigest: string;
  coverage: EvidenceCoverageV1[];
};
export type ParsedExecReviewPacketV1 = { packet: ExecReviewPacketV1; body: string };

/** The fixed prose after the header; no slot and no user data, declared once here. */
const EXEC_REVIEW_BODY =
  'Read the workspace, the graph’s Task/Run/round cards, and the original execution history. ' +
  'Return exactly one verdict (pass or fix) with basis and report. For a check with no reportRef, ' +
  'read its result from the round card; do not invent one.';

/** The seven header labels, in their one order. */
const LABELS = ['roundRef', 'planRevisionRef', 'taskRef', 'subjectRunRef', 'checkRefs', 'sourceDigest', 'coverage'] as const;

function byCode(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The packet of one frozen round. `checkRefs` are the report refs of finished
 * checks, by `checkId`; a check with no report contributes none (the prose sends
 * the reviewer to the round card). `coverage` is every reviewer pair the plan
 * routes through the review packet, sorted and once each; none is `invalid`.
 */
export function execReviewPacketOfRound(
  round: RoundSnapshot,
): { status: 'ready'; value: ExecReviewPacketV1 } | CoreRejection {
  const pairs = new Map<string, EvidenceCoverageV1>();
  for (const item of round.verificationPlan.checks) {
    if (item.kind !== 'reviewer' || item.satisfactionPath !== 'review-packet') continue;
    for (const pair of item.coverage) {
      pairs.set(requirementKeyOf(pair), { obligationId: pair.obligationId, requirementId: pair.requirementId });
    }
  }
  const coverage = [...pairs.values()].sort((left, right) =>
    byCode(left.obligationId, right.obligationId) || byCode(left.requirementId, right.requirementId));
  if (coverage.length === 0) return rejected('invalid', 'the round has no review-packet coverage to review');
  const checkRefs = round.checks
    .filter((check): check is typeof check & { reportRef: ArtifactRef } =>
      check.phase === 'finished' && check.reportRef !== null)
    .sort((left, right) => byCode(left.checkId, right.checkId))
    .map(check => check.reportRef);
  return {
    status: 'ready',
    value: {
      roundRef: round.ref,
      planRevisionRef: round.adoptedPlanRef,
      taskRef: round.subject,
      subjectRunRef: round.subjectRunRef,
      checkRefs,
      sourceDigest: round.identity.sourceDigest,
      coverage,
    },
  };
}

function jsonLine(value: unknown): string {
  return canonicalJson(value as JsonValue);
}

/** The request body: request id, the seven header lines, a blank line, the fixed prose. */
export function execReviewPacketText(packet: ExecReviewPacketV1): string {
  return [
    `execreview:${packet.roundRef.roundId}`,
    `roundRef: ${jsonLine(packet.roundRef)}`,
    `planRevisionRef: ${jsonLine(packet.planRevisionRef)}`,
    `taskRef: ${jsonLine(packet.taskRef)}`,
    `subjectRunRef: ${jsonLine(packet.subjectRunRef)}`,
    `checkRefs: ${jsonLine(packet.checkRefs)}`,
    `sourceDigest: ${packet.sourceDigest}`,
    `coverage: ${jsonLine(packet.coverage)}`,
    '',
    EXEC_REVIEW_BODY,
  ].join('\n');
}

function parseArray(json: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function coveragePairProblem(value: unknown): string | null {
  return isRecord(value) && hasOnlyKeys(value, ['obligationId', 'requirementId'])
    && nonEmpty(value['obligationId']) && nonEmpty(value['requirementId'])
    ? null : 'a coverage entry must be a complete {obligationId, requirementId} pair';
}

/**
 * Read the header back. Every line is required in its place: a missing, extra
 * or reordered line, a value that is not a complete ref or array of its kind,
 * an empty digest or coverage, or a first line that is not this round's
 * request id is `invalid`. The body is everything after the blank line.
 */
export function execReviewPacketOfText(
  text: string,
): { status: 'ready'; value: ParsedExecReviewPacketV1 } | CoreRejection {
  const lines = text.split('\n');
  if (lines.length < LABELS.length + 3) return rejected('invalid', 'the exec review packet header is incomplete');
  const values: string[] = [];
  for (const [index, label] of LABELS.entries()) {
    const line = lines[index + 1]!;
    if (!line.startsWith(`${label}: `)) {
      return rejected('invalid', `line ${String(index + 2)} of the exec review packet is not ${label}`);
    }
    values.push(line.slice(label.length + 2));
  }
  if (lines[LABELS.length + 1] !== '') {
    return rejected('invalid', 'the exec review packet header is not followed by one blank line');
  }
  const [roundText, planText, taskText, runText, checksText, sourceDigest, coverageText] = values as
    [string, string, string, string, string, string, string];
  const roundRef = parseObject(roundText);
  if (roundRef === null) return rejected('invalid', 'roundRef is not a JSON object');
  const roundProblem = verificationRoundRefProblem(roundRef, 'roundRef');
  if (roundProblem !== null) return rejected('invalid', roundProblem);
  const projectId = roundRef['projectId'] as string;
  const planRevisionRef = parseObject(planText);
  const planProblem = planRevisionRefProblem(planRevisionRef, 'planRevisionRef', projectId);
  if (planProblem !== null) return rejected('invalid', planProblem);
  const taskRef = parseObject(taskText);
  const taskProblem = taskTripleProblem(taskRef, 'taskRef');
  if (taskProblem !== null) return rejected('invalid', taskProblem);
  const subjectRunRef = parseObject(runText);
  const runProblem = runRefProblem(subjectRunRef, 'subjectRunRef');
  if (runProblem !== null) return rejected('invalid', runProblem);
  const checkRefs = parseArray(checksText);
  if (checkRefs === null) return rejected('invalid', 'checkRefs is not a JSON array');
  for (const ref of checkRefs) {
    const problem = checkArtifactRef(ref);
    if (problem !== null) return rejected('invalid', `checkRefs: ${problem}`);
  }
  if (!nonEmpty(sourceDigest)) return rejected('invalid', 'sourceDigest is empty');
  const coverage = parseArray(coverageText);
  if (coverage === null || coverage.length === 0) return rejected('invalid', 'coverage is not a non-empty JSON array');
  for (const pair of coverage) {
    const problem = coveragePairProblem(pair);
    if (problem !== null) return rejected('invalid', problem);
  }
  if (lines[0] !== `execreview:${roundRef['roundId'] as string}`) {
    return rejected('invalid', 'the first line is not this round\'s exec review request id');
  }
  return {
    status: 'ready',
    value: {
      packet: {
        roundRef: roundRef as unknown as VerificationRoundRef,
        planRevisionRef: planRevisionRef as unknown as PlanRevisionRef,
        taskRef: taskRef as unknown as TaskTriple,
        subjectRunRef: subjectRunRef as unknown as RunRef,
        checkRefs: checkRefs as ArtifactRef[],
        sourceDigest,
        coverage: coverage as EvidenceCoverageV1[],
      },
      body: lines.slice(LABELS.length + 2).join('\n'),
    },
  };
}
