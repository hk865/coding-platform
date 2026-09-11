import type { RoleSpecPinReadinessV1 } from '../../../contracts/governance-view.js';
/** Control-owned deterministic domain policy（RW-11 角色绑定受理判据）。 */
import { canonicalJson } from "../../../contracts/fingerprint.js";
import type { RoleBindingRefV1, RoleBindingInadmissibleDetail, TaskIneligibilityReason } from "../../../contracts/dispatch.js";
import type { CoordinationRoleMatrixV1 } from "../../../contracts/human-role-collaboration.js";
import { roleSpecRevisionFromBinding, type RoleSpecPinV1, type RoleSpecRevisionRef, type RoleSpecRevisionSnapshot } from "../../../contracts/role-spec.js";

/**
 * claim 守卫读到的全部事实（纯函数输入；本策略不读账本、不写账本）。
 *
 * matrix 为 null 表示这个项目**没有登记角色矩阵**（没装协调策略，或装的那份正文没有 roles）。
 * 这不是「校验通过」：它只是沿用 RW-11 之前的绑定语义（RoleBindingRefV1 自证 + 命令形状校验）。
 * 有矩阵时，下面每一项都必须成立，否则零写入拒绝。
 */
export type RoleBindingAdmissionFactsV1 = {
  roleBinding: RoleBindingRefV1;
  declaredPermissions: { tools: string[]; writeScope: string[] };
  matrix: CoordinationRoleMatrixV1 | null;
  /** 矩阵 pin 指向的已安装规格 revision；未安装或无此角色即 null。 */
  pinnedSpec: RoleSpecRevisionSnapshot | null;
  /** 该角色在本项目当前生效的规格引用；缺失即 null。 */
  activeRevision: RoleSpecRevisionRef | null;
};

export type RoleBindingAdmissionV1 =
  | { admissible: true; roleId: string; /** 有矩阵时为规格正文；无矩阵时 null（未校验，不等于已授权）。 */ spec: RoleSpecRevisionSnapshot["content"] | null }
  | { admissible: false; reasons: TaskIneligibilityReason[] };

function reject(roleId: string, detail: RoleBindingInadmissibleDetail, message: string): RoleBindingAdmissionV1 {
  return { admissible: false, reasons: [{ code: "role_binding_not_admissible", roleId, detail, message }] };
}

/**
 * RW-11：claim 的角色绑定受理判据（纯函数，确定性）。
 *
 * 判据逐条来自 ADR 0003 D4-2「角色不存在、revision 过期、权限不符即拒绝，零写」：
 *   1. 角色存在：roleId（= RoleBindingRefV1.templateId）必须在当前生效策略的角色矩阵 catalog 里；
 *   2. revision 未过期：绑定的 templateRevision 必须**正好等于**矩阵 pin 的 revision
 *      （绑定是「按 pin 解析出来的」，不是「随便报一个版本」）；
 *   3. digest 未过期：pin 指向的规格必须已安装，且落账 contentDigest／contentRevision 与 pin 一致；
 *      同时该角色在 Project 上的**生效引用**必须等于 pin——矩阵与生效引用不一致时拒绝，
 *      而不是挑一个继续用（两处都是治理事实，没有谁优先）；
 *   4. 权限相符：声明权限是规格授权的**子集**（工具逐项、writeScope 按类别），
 *      超出即越界。这里用子集而不是相等，是因为声明只能小于等于已授权范围；
 *      规格是上界，声明在自己的任务里要更小的范围是收窄，不是越权。
 */
export function evaluateRoleBindingAdmission(facts: RoleBindingAdmissionFactsV1): RoleBindingAdmissionV1 {
  const roleId = facts.roleBinding.templateId;
  const matrix = facts.matrix;
  if (matrix === null) return { admissible: true, roleId, spec: null };

  if (!Object.prototype.hasOwnProperty.call(matrix.catalog, roleId)) {
    return reject(roleId, "role_not_registered", "角色 " + roleId + " 不在项目当前生效的角色矩阵里：未登记的角色不能 claim 任务（要允许它，需安装并激活该项目角色矩阵里的这份规格）");
  }
  const pin = matrix.catalog[roleId]!;

  const declaredRevision = roleSpecRevisionFromBinding(facts.roleBinding.templateRevision);
  if (declaredRevision === null || declaredRevision !== pin.ref.revision) {
    return reject(
      roleId,
      "role_spec_stale",
      "角色 " + roleId + " 的绑定 revision（" + facts.roleBinding.templateRevision + "）不是角色矩阵当前 pin 的 revision（" + pin.ref.revision + "）：按过期规格签发的绑定不能 claim",
    );
  }

  const installed = facts.pinnedSpec;
  if (installed === null) {
    return reject(roleId, "role_spec_not_installed", "角色 " + roleId + " 的矩阵 pin 指向的 RoleSpecRevision " + canonicalJson(pin.ref) + " 没有落账：矩阵不能引用未安装的规格");
  }
  if (installed.contentDigest !== pin.digest || installed.contentRevision !== pin.ref.revision) {
    return reject(roleId, "role_spec_stale", "角色 " + roleId + " 的矩阵 pin 摘要与已落账规格不一致（pin=" + pin.digest + "，已安装=" + installed.contentDigest + "）：摘要不符即视为过期，不做兼容猜测");
  }
  if (facts.activeRevision === null || canonicalJson(facts.activeRevision) !== canonicalJson(pin.ref)) {
    return reject(
      roleId,
      "role_spec_stale",
      "角色 " + roleId + " 在项目上的生效引用（" + canonicalJson(facts.activeRevision) + "）不等于矩阵 pin（" + canonicalJson(pin.ref) + "）：矩阵与生效引用必须一致，冲突时拒绝而不是择一使用",
    );
  }

  const spec = installed.content;
  const allowedTools = new Set(spec.permissions.tools);
  const extraTools = facts.declaredPermissions.tools.filter((tool) => !allowedTools.has(tool));
  if (extraTools.length > 0) {
    return reject(roleId, "permissions_exceed_spec", "角色 " + roleId + " 的 claim 声明了规格未授权的工具：" + extraTools.join(",") + "（规格授权上界：" + spec.permissions.tools.join(",") + "）");
  }
  if (spec.permissions.writeScope === "none" && facts.declaredPermissions.writeScope.length > 0) {
    return reject(roleId, "permissions_exceed_spec", "角色 " + roleId + " 的规格是只读（permissions.writeScope=none），但 claim 声明了写入范围：" + facts.declaredPermissions.writeScope.join(","));
  }

  return { admissible: true, roleId, spec };
}

// ------------------------------------------------------------------------ //
// RW-14：矩阵 pin 就绪预检（给治理视图用；判据仍是上面同一个纯函数）           //
// ------------------------------------------------------------------------ //

/**
 * 一个矩阵 pin 当前是否「装得上、也激活得上」。
 *
 * 为什么在这里、为什么不是第二份规则：这个问题的判据与 claim 守卫**完全相同**——
 * 「如果现在有一条 claim 恰好钉在这个 pin 上，守卫会不会受理它」。因此本函数不重新写一遍
 * 「已安装／摘要一致／生效引用等于 pin」的判断，而是把同一组事实喂给
 * {@link evaluateRoleBindingAdmission}，再把它的拒绝细节翻译成安装者看得懂的状态。
 * 复制一份判据会让预检说「就绪」而守卫在实际 claim 时拒绝——那正是要避免的分叉。
 *
 * status 的取值只覆盖「与声明权限无关」的三类原因（权限越界不是 pin 的属性）：
 *   - spec_not_installed：pin 指向的规格没有落账；
 *   - spec_not_activated：规格装了，但该角色在项目上的生效引用不是它（含从未激活）；
 *   - stale：摘要与 pin 不一致，或生效引用指向另一份 revision。
 */
export type { RoleSpecPinReadinessV1 } from '../../../contracts/governance-view.js';

export function evaluateRoleSpecPinReadiness(facts: {
  roleId: string;
  pin: RoleSpecPinV1;
  pinnedSpec: RoleSpecRevisionSnapshot | null;
  activeRevision: RoleSpecRevisionRef | null;
}): RoleSpecPinReadinessV1 {
  // 声明权限用规格自己的上界：预检问的是「这份规格本身可用吗」，不是「某个 claim 的声明是否越界」。
  // writeScope 只分「只读」与「可写工作区」两类，与角色的实际写入范围无关（范围属于任务事实）。
  const declaredPermissions = facts.pinnedSpec === null
    ? { tools: [] as string[], writeScope: [] as string[] }
    : {
        tools: [...facts.pinnedSpec.content.permissions.tools],
        writeScope: facts.pinnedSpec.content.permissions.writeScope === "none" ? [] : ["workspace"],
      };
  const admission = evaluateRoleBindingAdmission({
    roleBinding: {
      schemaVersion: 1,
      bindingId: "role-spec-pin-readiness",
      templateId: facts.roleId,
      templateRevision: String(facts.pin.ref.revision),
      bindingVersion: 1,
      policyRevision: "role-spec-pin-readiness",
    },
    declaredPermissions,
    // 单角色矩阵：预检只回答「这个 pin 本身」，角色是否登记在生效矩阵里由调用方判断。
    matrix: { catalog: { [facts.roleId]: facts.pin }, coordinator: { roleId: facts.roleId, note: "pin 就绪预检" } },
    pinnedSpec: facts.pinnedSpec,
    activeRevision: facts.activeRevision,
  });
  if (admission.admissible) {
    return { status: "ready", roleId: facts.roleId, message: "规格已安装且已激活，与矩阵 pin 的 revision 和摘要一致。" };
  }
  const reason = admission.reasons[0]!;
  // evaluateRoleBindingAdmission 的拒绝只有 role_binding_not_admissible 一种，其余联合成员在这里不可达；
  // 仍然显式判断 code，避免用断言把未来的新拒绝类型悄悄读成 stale。
  const detail = reason.code === "role_binding_not_admissible" ? reason.detail : null;
  const status: RoleSpecPinReadinessV1["status"] =
    detail === "role_spec_not_installed"
      ? "spec_not_installed"
      : detail === "role_spec_stale" && facts.activeRevision === null
        ? "spec_not_activated"
        : "stale";
  return { status, roleId: facts.roleId, message: reason.message };
}

