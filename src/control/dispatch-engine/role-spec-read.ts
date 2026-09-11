/**
 * RW-12 DispatchEngine — 角色规格只读解析（RoleSpecReadPort 的实现）。
 *
 * 这里**不复制**角色规则：矩阵 pin、revision 过期、摘要一致、权限越界的判据全部来自
 * ControlEngine 自己的 `evaluateRoleBindingAdmission`（同一份纯策略）与
 * `resolveActiveCoordinationPolicy`（同一份生效策略解析）。本类只负责把账本事实读成该策略的输入。
 *
 * 为什么放在 DispatchEngine：ModuleDependencyDAG 允许 DispatchEngine → ControlEngine，
 * 但**不允许** ContextCompiler → ControlEngine；把适配器放在派发面，ContextCompiler 就只需要
 * 消费"解析出来的规格正文"，不新增依赖边。
 */
import type { StateLedger } from '../../contracts/ledger.js';
import type { RoleBindingRefV1 } from '../../contracts/dispatch.js';
import type { RoleSpecReadPort, RoleSpecResolutionV1 } from '../../contracts/role-spec-materials.js';
import type { RoleSpecRevisionSnapshot, RoleSpecRevisionRef, ProjectRoleSpecActiveSnapshot } from '../../contracts/role-spec.js';
import { projectRoleSpecActiveRefFor, roleSpecRevisionRefFor, roleSpecRevisionFromBinding } from '../../contracts/role-spec.js';
import { resolveActiveCoordinationPolicy } from '../control-engine/policies/coordination-policy.js';
import {
  evaluateRoleBindingAdmission,
  type RoleBindingAdmissionFactsV1,
} from '../control-engine/policies/role-binding-admission.js';

export class LedgerRoleSpecRead implements RoleSpecReadPort {
  constructor(private readonly deps: { ledger: StateLedger }) {}

  async resolve(request: {
    projectId: string;
    roleBinding: RoleBindingRefV1;
    declaredPermissions: { tools: string[]; writeScope: string[] };
  }): Promise<RoleSpecResolutionV1> {
    const roleId = request.roleBinding.templateId;
    const declaredRevision = roleSpecRevisionFromBinding(request.roleBinding.templateRevision);
    if (declaredRevision === null) {
      // 绑定不是在角色规格下签发的（templateRevision 不是十进制 revision）。RW-11 明确：
      // 没有登记角色的项目，claim 语义与之前完全一致——这里同样不编造一个规格出来。
      return { status: 'absent', roleId, reason: '绑定的 templateRevision（' + request.roleBinding.templateRevision + '）不是角色规格 revision，视为未登记角色目录' };
    }
    const policy = await resolveActiveCoordinationPolicy(this.deps.ledger, request.projectId);
    const matrix = policy?.content.roles ?? null;
    if (matrix === null) {
      return { status: 'absent', roleId, reason: '项目当前生效的 CoordinationPolicy 没有角色矩阵，按 RW-11 沿用既有绑定语义' };
    }
    const pin = Object.prototype.hasOwnProperty.call(matrix.catalog, roleId) ? matrix.catalog[roleId]! : undefined;
    if (pin === undefined) {
      return { status: 'absent', roleId, reason: '角色 ' + roleId + ' 不在项目当前生效的角色矩阵里' };
    }
    let pinnedSpec: RoleSpecRevisionSnapshot | null = null;
    const installed = await this.deps.ledger.load(pin.ref);
    if (installed.status === 'found' && installed.snapshot.ref.aggregateType === 'RoleSpecRevision') {
      pinnedSpec = installed.snapshot as RoleSpecRevisionSnapshot;
    }
    let activeRevision: RoleBindingAdmissionFactsV1['activeRevision'] = null;
    const active = await this.deps.ledger.load(projectRoleSpecActiveRefFor(request.projectId, roleId));
    if (active.status === 'found' && active.snapshot.ref.aggregateType === 'ProjectRoleSpecActive') {
      activeRevision = (active.snapshot as ProjectRoleSpecActiveSnapshot).activeRevision;
    }
    const admission = evaluateRoleBindingAdmission({
      roleBinding: request.roleBinding,
      declaredPermissions: request.declaredPermissions,
      matrix,
      pinnedSpec,
      activeRevision,
    });
    if (!admission.admissible) return { status: 'inadmissible', roleId, reasons: admission.reasons };
    if (admission.spec === null || pinnedSpec === null) {
      return { status: 'absent', roleId, reason: '受理通过但没有解析出规格正文（矩阵为空）；不编造规格' };
    }
    return {
      status: 'resolved',
      roleId,
      revision: roleSpecRevisionRefFor(request.projectId, roleId, pinnedSpec.contentRevision),
      spec: admission.spec,
    };
  }
}

// ------------------------------------------------------------------------ //
// 角色绑定由**矩阵签发**                                                //
// ------------------------------------------------------------------------ //

/**
 * 一次角色绑定的**签发来源**。
 *
 * 为什么要有这个类型：RW-14 之前，产品入口把角色名字符串（`executor`／`assignment.role`）与
 * revision（`'1'`）写死在派发代码里；矩阵只是"claim 时用来校验"的另一份事实。用户对上一轮报告的
 * 明确指示是：**派发/claim 的角色绑定要由矩阵签发**，绑定内容取自当前生效矩阵 pin 与对应规格，
 * 而不是调用方写死字符串。因此签发结果必须自带来源，读者（与测试）能看出这条绑定到底是
 * 「按矩阵 pin 签发的」还是「没有矩阵时的既有绑定」。
 */
export type RoleBindingIssuanceV1 = {
  /** matrix = 由当前生效矩阵的 pin 签发；static-fallback = 没有可用的矩阵 pin，沿用既有绑定。 */
  source: 'matrix' | 'static-fallback';
  roleBinding: RoleBindingRefV1;
  /** 矩阵签发时所用的生效矩阵 pin（policyId + 规格 revision + 内容摘要）；否则 null。 */
  matrixPin: { policyId: string; contentRevision: number; ref: RoleSpecRevisionRef; digest: string } | null;
  /** 为什么是这个来源（写给人看，由签发方给出，不在别处重复措辞）。 */
  note: string;
};

/**
 * 按当前生效的**角色矩阵**签发角色绑定（唯一实现；派发面只消费结果）。
 *
 * 判据与不变量：
 *   1. 没有生效协调策略、策略正文没有 `roles`：**不编造角色目录**，原样返回调用方给的既有绑定
 *      （`source: 'static-fallback'`）。这正是"没有矩阵的项目保持既有语义"——逐字保留。
 *   2. 有矩阵但矩阵**没有登记**这个角色：同样不签发（`static-fallback`）。这时仍会把既有绑定
 *      提交给 claim，由**未改动的**守卫按 role_not_registered 拒绝并零写 —— 拒绝能力不因为
 *      签发面而改变，也不在这里另写一份"角色是否存在"的判据。
 *   3. 矩阵登记了它：`templateId` 与 `templateRevision` 直接取自 pin（角色 id 用矩阵的写法，
 *      revision 用 pin 的十进制 revision），`policyRevision` 记录**签发依据**
 *      （policyId@contentRevision#pin 摘要前 16 位），因此 revision 与摘要都能从绑定本身复核。
 *      这里**不**判断 pin 是否已安装/已激活：那是 claim 守卫（`evaluateRoleBindingAdmission`）的
 *      职责，重复判断会出现"签发放行、守卫拒绝"的分叉。pin 指向未激活规格时，绑定照签，
 *      claim 照旧被守卫拒绝且零写。
 *
 * 只读：本函数不写账本、不提交命令。
 */
export async function issueMatrixRoleBinding(
  deps: { ledger: Pick<StateLedger, 'load'> },
  input: { projectId: string; roleId: string; fallback: RoleBindingRefV1 },
): Promise<RoleBindingIssuanceV1> {
  const policy = await resolveActiveCoordinationPolicy(deps.ledger, input.projectId);
  const matrix = policy?.content.roles ?? null;
  if (policy === null || matrix === null) {
    return {
      source: 'static-fallback',
      roleBinding: { ...input.fallback },
      matrixPin: null,
      note: '项目当前生效的协调策略没有角色矩阵：按 RW-11 沿用既有绑定语义（Control 不编造默认目录）。',
    };
  }
  const pin = Object.prototype.hasOwnProperty.call(matrix.catalog, input.roleId) ? matrix.catalog[input.roleId]! : undefined;
  if (pin === undefined) {
    return {
      source: 'static-fallback',
      roleBinding: { ...input.fallback },
      matrixPin: null,
      note: '当前生效的角色矩阵没有登记角色 ' + input.roleId + '：没有可签发的 pin，沿用既有绑定并交由 claim 守卫拒绝（零写）。',
    };
  }
  return {
    source: 'matrix',
    roleBinding: {
      schemaVersion: 1,
      bindingId: 'binding-matrix-' + pin.ref.roleId + '@' + String(pin.ref.revision),
      templateId: pin.ref.roleId,
      templateRevision: String(pin.ref.revision),
      bindingVersion: 1,
      policyRevision: 'matrix:' + policy.policyId + '@' + String(policy.contentRevision) + '#' + pin.digest.slice(0, 16),
    },
    matrixPin: { policyId: policy.policyId, contentRevision: policy.contentRevision, ref: { ...pin.ref }, digest: pin.digest },
    note: '按当前生效矩阵 ' + policy.policyId + '@' + String(policy.contentRevision) + ' 的 pin（角色 ' + pin.ref.roleId +
      ' revision ' + String(pin.ref.revision) + '，摘要 ' + pin.digest.slice(0, 16) + '…）签发；是否已安装/已激活由 claim 守卫判定。',
  };
}

