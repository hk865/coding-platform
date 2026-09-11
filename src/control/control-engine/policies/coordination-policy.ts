/**
 * RW-11：读取「项目当前生效的 CoordinationPolicy revision」的唯一实现。
 *
 * 为什么抽出来：RW-04 的自动受理（autonomous-rework.ts）与 RW-11 的 claim 角色守卫都要读同一份
 * 生效策略。复制一份读取逻辑会出现两处「没有生效策略怎么办」的判断，进而出现两个互相矛盾的
 * 默认行为——这正是「不得复制业务规则」要避免的。因此解析规则只在这里定义：
 *
 *   - 没有生效引用、引用的 revision 未安装、或快照身份与引用不一致 → null；
 *   - null **不代表**授权成立，也不代表拒绝：调用方必须自己决定（自动受理据此转人工，
 *     claim 守卫据此跳过角色矩阵校验），并且都不得编造默认值。
 */
import type { StateLedger } from "../../../contracts/ledger.js";
import type {
  CoordinationPolicyContentV1,
  CoordinationPolicyRevisionRef,
  CoordinationPolicyRevisionSnapshot,
  ProjectCoordinationPolicyActiveSnapshot,
} from "../../../contracts/human-role-collaboration.js";

export type ActiveCoordinationPolicyV1 = {
  policyId: string;
  contentRevision: number;
  content: CoordinationPolicyContentV1;
};

/**
 * 生效的 CoordinationPolicy revision；缺失或身份不一致即 null（没有默认值，也没有回退）。
 * 只依赖 `load`：调用方可以是完整 StateLedger，也可以是只读投影（例如自动受理的
 * `Pick<StateLedger,'load'|'events'>`），解析规则仍然只有这一份。
 */
export async function resolveActiveCoordinationPolicy(
  ledger: Pick<StateLedger, "load">,
  projectId: string,
): Promise<ActiveCoordinationPolicyV1 | null> {
  const activeRef = { aggregateType: "ProjectCoordinationPolicyActive" as const, projectId };
  const active = await ledger.load(activeRef);
  if (active.status !== "found" || active.snapshot.ref.aggregateType !== "ProjectCoordinationPolicyActive") return null;
  const revisionRef: CoordinationPolicyRevisionRef = (active.snapshot as ProjectCoordinationPolicyActiveSnapshot).activeRevision;
  const loaded = await ledger.load(revisionRef);
  if (loaded.status !== "found" || loaded.snapshot.ref.aggregateType !== "CoordinationPolicyRevision") return null;
  const snapshot = loaded.snapshot as CoordinationPolicyRevisionSnapshot;
  if (snapshot.policyId !== revisionRef.policyId || snapshot.contentRevision !== revisionRef.revision) return null;
  return { policyId: snapshot.policyId, contentRevision: snapshot.contentRevision, content: snapshot.content };
}
