/**
 * 一轮里没过的登记检查的输出：命令原文、出处、退出码和两路输出的末尾（`STATE-MACHINES-SPEC.md` §6.1 契约 (e) 的
 * `checks.outputs`；`slice-PL-SPEC.md` §7.1.1 `stop` 偏差的第五项）。接续说明（`readContinuationBasis`）和参谋的
 * 偏差轮共用这一处读。只读，不写任何记录；输出不进无进展键。
 */
import type { ArtifactRef } from '../../../contracts/artifact.js';
import { checkBaselineOf, checkDigestOf } from '../../../contracts/check-review.js';
import {
  CHECK_OUTPUT_COMMAND_CHARS, type FailingCheckOutputV1, type InstalledCheckOriginEntryV1,
} from '../../../contracts/check-output.js';
import { boundedTo } from '../../../contracts/continuation-brief.js';
import type { WorkspaceScope } from '../../../contracts/core/identity.js';
import { messageOf } from '../../../contracts/error-message.js';
import { RUN_STEP_OUTPUT_TAIL_BYTES } from '../../../contracts/run-steps.js';
import { parseObject } from '../../../contracts/validation/common.js';
import type { CheckProcessObservation, RegisteredCommandCheck, RoundSnapshot } from '../../../contracts/verification.js';
import type { RawArtifactStorePort } from '../../record-store/body-ports.js';

/** 报告正文的存储和 Host 现在装的检查的出处。两样都可以没有：报告写“读不到”和原因，出处写“不明”。 */
export type CheckOutputDeps = {
  bodies?: Pick<RawArtifactStorePort, 'read'>;
  /** Host 现在装的每条检查从哪来（现值，每次读）。 */
  checkOrigins?: (scope: WorkspaceScope) => readonly InstalledCheckOriginEntryV1[];
};
type CheckOutputBase = Omit<FailingCheckOutputV1, 'observed' | 'unreadable'>;

/**
 * 一轮里没过的登记检查，按 checkId 排（和 `roundFailureFacts` 同序）。只要不是 PASS、跑完、有报告就列：不分 FAIL 和
 * INCONCLUSIVE。中断、还没跑完的检查没有报告，原因照旧在 `failing` 那一行；见证检查没有命令；审查项不在
 * `round.checks` 里。
 */
export async function failingCheckOutputsOf(round: RoundSnapshot, deps: CheckOutputDeps): Promise<FailingCheckOutputV1[]> {
  const workspace = round.configuration.workspace;
  const origins = deps.checkOrigins?.({ projectId: workspace.projectId, workspaceId: workspace.workspaceId }) ?? [];
  const outputs: FailingCheckOutputV1[] = [];
  const ordered = [...round.checks].sort((left, right) =>
    (left.checkId < right.checkId ? -1 : left.checkId > right.checkId ? 1 : 0));
  for (const check of ordered) {
    if (check.outcome === 'PASS' || check.phase !== 'finished' || check.reportRef === null) continue;
    const definition = check.definition;
    if (definition.kind === 'witness') continue;
    // 按内容找出处：和 Host 装检查时匹配用的是同一个摘要。
    const digest = checkDigestOf(definition);
    const base: CheckOutputBase = { checkId: check.checkId, kind: definition.kind,
      command: boundedTo(definition.command, CHECK_OUTPUT_COMMAND_CHARS),
      taskIds: definition.taskIds === 'all' ? 'all' : [...definition.taskIds],
      origin: origins.find(entry => entry.checkDigest === digest)?.origin ?? null };
    outputs.push(await observedOf(deps.bodies, check.reportRef, definition, base));
  }
  return outputs;
}

/**
 * 报告正文里的观察换成事实（两路输出各取末尾 `RUN_STEP_OUTPUT_TAIL_BYTES`）。只有读失败一支，写法同
 * `run-state-service.ts` 的 `boundedBody`。报告只由 `storeReport` 写，存之前核过观察的形状，读的时候不再核：真坏了
 * `checkBaselineOf` 抛错，落进同一个 catch，写一行原因。
 */
async function observedOf(bodies: CheckOutputDeps['bodies'], ref: ArtifactRef, definition: RegisteredCommandCheck,
  base: CheckOutputBase): Promise<FailingCheckOutputV1> {
  const unreadable = (reason: string): FailingCheckOutputV1 => ({ ...base, observed: null, unreadable: reason });
  if (bodies === undefined) return unreadable('the body store is not readable by this reader');
  try {
    const read = await bodies.read(ref);
    if (read.status !== 'ready') return unreadable(`the report is not readable: ${read.reason}`);
    const observation = parseObject(read.value.body)?.['observation'] as CheckProcessObservation;
    return { ...base, unreadable: null,
      observed: checkBaselineOf(definition, observation.finishedAt, observation, RUN_STEP_OUTPUT_TAIL_BYTES) };
  } catch (error) {
    return unreadable(`the report read failed: ${messageOf(error)}`);
  }
}
