/** R4a 内部恢复接线骨架。实现前不得从生产组合根调用占位函数。 */
import type { SessionRecord } from "../../core/ports/session_store/session-store-port.js";
import type {
  EffectiveRecoveryConstraints,
  RecoveryConstraintEvidence,
  RecoveryTarget,
} from "./recovery-contract-types.js";

export type {
  EffectiveRecoveryConstraints,
  RecoveryConstraintEvidence,
  RecoveryTarget,
} from "./recovery-contract-types.js";

/** 返回目标 Turn 的独占记录范围；不得把后续 Turn 的事件归入目标状态。 */
export function selectRecoveryTurn(
  _records: readonly SessionRecord[],
  _target: RecoveryTarget,
): readonly SessionRecord[] {
  throw new Error("R4a selectRecoveryTurn 尚未实现；禁止接入生产路径");
}

/** 在 runner.resume/continueRecovered 和任何恢复对账写入前核验原约束。 */
export function requireEffectiveRecoveryConstraints(
  _evidence: RecoveryConstraintEvidence,
): EffectiveRecoveryConstraints {
  throw new Error("R4a requireEffectiveRecoveryConstraints 尚未实现；禁止接入生产路径");
}
