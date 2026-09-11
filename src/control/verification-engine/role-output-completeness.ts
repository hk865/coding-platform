/**
 * Compare declarative role output expectations with attributed run material.
 * ContextCompiler owns canonical reads; this table owns category-to-witness mapping.
 * Missing outputs remain visible in roleOutputs and never gate completion.
 * Control alone reduces formal Plan obligations using admitted Evidence.
 * Decision provenance: ADR 0003, 2026-09-11 scoped user acceptance.
 */
import type { RunSnapshot } from '../../contracts/dispatch.js';
import type { RoleOutputKindV1 } from '../../contracts/role-spec.js';
import type { RoleSpecReadPort } from '../../contracts/role-spec-materials.js';
import type { VerificationRoundRoleOutput, VerificationRoundRoleOutputs } from '../../contracts/verification-round.js';
import type { RoleOutputWitnessChannelV1, RunOutputMaterialPort } from '../../contracts/run-output-materials.js';
export type { RoleOutputWitnessChannelV1 } from '../../contracts/run-output-materials.js';

export type RoleOutputWitnessRuleV1 = {
  channel: RoleOutputWitnessChannelV1;
  /** 为什么是这条通道 / 为什么今天没有通道（写清需要哪条通道、以及该缺口的产品后果）。 */
  because: string;
};

/**
 * 必产出种类 → 见证通道（**全键穷尽**）。
 *
 * 每条通道读的都是 canonical 聚合，并且**必须归因到本 Run**（runRef 逐字段相等）；因此模型无法靠
 * 一段自述文字让某一类「被见证」：落账这些事实的是 ControlEngine 的既有命令守卫（补丁要求运行已结束、
 * 持有活动写租约、改动路径 ⊆ 租约范围、基于当前工作区版本；集成记录要求输入是已接纳证据、冲突无解释
 * 且未升级即拒绝；留痕要求作者运行已 link 进该工作身份且正文 body-first 落盘）。
 *
 * 今天仍为 null 的两类（读的时候不要把它们当成「已满足」）：
 *   - 'answer-with-sources'：平台今天**没有**把「带来源答案」归因到某个 dispatch Run 的事实通道。
 *     两条候选都不成立：QueryJobAnswer 绑的是 QueryRun（P1-09 的独立运行身份，不是本 Run）；
 *     探索报告落在探索会话 journal 与 Vault，且其证据由**人**的审阅产生。审阅原报告确实绑到审阅 Run，
 *     但它是该 Run 的逐条结论事实（已用于 verification-verdict），不是 investigator／secretary 的答案。
 *     后果：只读探索入口（/api/real/explore 侧绑 investigator）与任何要求该种类的角色，其轮次仍会记录未见证的产出期望；不扣留归约。
 *   - 'proposal'：PlanProposalV1／InitialDesignProposalV1 都不带 runRef，提案的正式承载是 Control 的
 *     受理链而不是某次运行的产物记录；后果同上（planner／advisor 角色的仅记录未见证的产出期望）。
 */
export const ROLE_OUTPUT_WITNESS_V1: Record<RoleOutputKindV1, RoleOutputWitnessRuleV1> = {
  'answer-with-sources': {
    channel: null,
    because: '今天没有把「带来源答案」归因到某个 Run 的事实通道：QueryJobAnswer 绑的是 QueryRun（P1-09 的独立运行身份），探索报告只落在探索会话 journal 与 Vault，审阅原报告则是审阅 Run 的逐条结论事实（已用于 verification-verdict）。'
      + '需要的通道：一条把「答案正文 + 来源清单 + 作者运行」一起落账、且 runRef 就是本 Run 的正式答案记录。'
      + '产品后果：在通道接通前，要求该种类的角色（investigator／secretary）的轮次仅记录未见证的产出期望，不扣留归约 —— 这是如实陈述，不是把判据放松。',
  },
  proposal: {
    channel: null,
    because: '今天没有把「提案」归因到某个 Run 的事实通道：PlanProposalV1／InitialDesignProposalV1 都不带 runRef，提案的正式承载是 ControlEngine 的受理链（提案→决定→应用），不是某次运行的产物记录。'
      + '需要的通道：提案记录带上提出它的运行身份（或另有一条按 Run 登记的提案事实）。'
      + '产品后果：在通道接通前，要求该种类的角色（planner／advisor）的轮次仅记录未见证的产出期望，不扣留归约 —— 这是如实陈述，不是把判据放松。',
  },
  'conflict-report': {
    channel: 'run-bound-conflict-surface',
    because: '集成冲突的正式事实就是 IntegrationResult 记录里的冲突面：conflicts（机械检测结果，逐条带 conflictKey 与来源证据）、explanation 与 escalate 一起随 join 原子落账；'
      + '冲突存在却既无 explanation 又未 escalate 的记录会被 ControlEngine 拒绝（conflict_unresolved，零写），因此已落账的记录必然是完整表过态的冲突报告。'
      + 'conflicts 为空表示该次集成对已接纳输入机械检测后**未发现冲突**，同样是已落账的正式结论（不是「没报告」）。',
  },
  'verification-verdict': {
    channel: 'run-bound-review-output',
    because: '独立审阅运行的原报告由正式 ReviewWork 绑定到该 Run（output.reportRef + output.runRef）；报告正文的逐条结论与来源由审阅生命周期按 review-report-v1 校验后才落账。',
  },
  'implementation-result': {
    channel: 'run-bound-patch-record',
    because: '实现结果的正式承载就是 writer 链的 PatchRecord：改动路径、补丁正文引用、前后工作区版本与检查结果都随记录原子落账，且记录必须归因到本 Run（payload.runRef 与聚合里的 runRef 同时相等）。'
      + '轮次**不**用工作区变化反推（runBaselineKnown=false），因此没有 PatchRecord 的运行仍然是缺项。',
  },
  'integration-result': {
    channel: 'run-bound-integration-result',
    because: '集成结果的正式承载是 IntegrationResult 聚合里 runRef 等于本 Run 的 join 记录（输入清单、冲突、缺口、工作区版本与计划版本都在记录里）。',
  },
  'work-record': {
    channel: 'run-bound-execution-note',
    because: '工作留痕的正式承载是 canonical ExecutionNote：note.runRef 必须等于本 Run，正文 body-first 落在 ArtifactVault，来源引用与适用版本随记录落账（noFullTranscript=true）。',
  },
};

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export type RoleOutputCompletenessInput = {
  projectId: string;
  /** 本次轮次冻结材料里的 canonical Run（含 roleBinding 与信封上的实际权限）。 */
  run: RunSnapshot;
  /** 角色规格解析端口（ControlEngine 的受理判据，由组合根注入）。缺省=未接线。 */
  roleSpec?: RoleSpecReadPort;
  materials: RunOutputMaterialPort;
};

/**
 * 核对本 Run 绑定角色的必产出完备性（**声明性提示的见证报告**，不是门禁）。
 *
 * 返回值只描述「哪些产出有见证事实、哪些没有」，调用方**不得**据此降级结论或扣留归约
 * （见 verification-rounds.ts 的 prepare／refreshCoverage／reduce）。三种结果与失败口径见
 * VerificationRoundRoleOutputs 的注释。只读：不改写任何状态，不提交任何命令。
 */
export async function evaluateRoleOutputCompleteness(
  input: RoleOutputCompletenessInput,
): Promise<VerificationRoundRoleOutputs> {
  const base = { schemaVersion: 1 as const, roleId: null, revision: null, required: [] as VerificationRoundRoleOutput[], missing: [] as string[] };
  if (input.roleSpec === undefined) {
    return { ...base, status: 'absent', detail: '宿主未接线 RoleSpecReadPort：本次没有可核对的角色规格，必产出未核对（不据此认为已满足）。' };
  }
  const envelope = input.run.envelope;
  if (envelope === undefined || envelope === null) {
    return { ...base, status: 'absent', detail: '本 Run 没有冻结的运行信封，无法确定它实际被授予的权限，因此不解析角色规格（不猜一份权限去匹配）。' };
  }
  let resolution: Awaited<ReturnType<RoleSpecReadPort['resolve']>>;
  try {
    resolution = await input.roleSpec.resolve({
      projectId: input.projectId,
      roleBinding: { ...input.run.roleBinding },
      declaredPermissions: { tools: [...envelope.permissions.tools], writeScope: [...envelope.permissions.writeScope] },
    });
  } catch (error) {
    // 读不到规格就**不能**说"必产出已满足"：记为缺项（fail-closed），并保留原始错误。
    return { ...base, status: 'incomplete', missing: ['<角色规格不可读>'], detail: '角色规格解析失败（' + describe(error) + '）：必产出无法核对，记为缺项；本入口不据此判定满足。' };
  }
  if (resolution.status === 'absent') {
    return { ...base, status: 'absent', roleId: resolution.roleId, detail: '本次运行没有角色规格可依（' + resolution.reason + '）：必产出未核对（这只是如实说明，不改变既有判据）。' };
  }
  if (resolution.status === 'inadmissible') {
    // 该 Run 在 claim 时已经过同一条受理判据；这里读到 inadmissible 只说明**现在**的治理状态变了
    // （角色被撤下／revision 移动／权限口径变化）。轮次核对的是**已经发生**的那次运行，
    // 因此这里如实记录「无法按该规格核对」，但**不**据此新造一条运行否决路径：
    // 撤销既有运行属于人的决定路径，不属于本检查。
    return {
      ...base,
      status: 'absent',
      roleId: resolution.roleId,
      detail: '角色绑定在当前治理状态下不再被受理（' + resolution.reasons.map((reason) => reason.message).join(' | ') + '）：本次无法按该规格核对必产出，不据此认为已满足。',
    };
  }
  const spec = resolution.spec;

  const required: VerificationRoundRoleOutput[] = [];
  const missing: string[] = [];
  for (const requirement of spec.requiredOutputs) {
    const rule = ROLE_OUTPUT_WITNESS_V1[requirement.kind];
    let witness: { channel: RoleOutputWitnessChannelV1; fact: string } | { channel: RoleOutputWitnessChannelV1; unavailable: string } | null;
    try {
      witness = rule.channel === null ? null : await input.materials.runOutputWitness(input.run, rule.channel);
    } catch (error) {
      // 见证通道读不到（例如账本不可读）：同样是"无法见证"，记为缺项而不是当成已产出。
      witness = { channel: rule.channel, unavailable: '见证通道读取失败（' + describe(error) + '）' };
    }
    const fact = witness !== null && 'fact' in witness ? witness.fact : null;
    if (fact === null) missing.push(requirement.kind);
    required.push({
      kind: requirement.kind,
      reason: requirement.reason,
      channel: rule.channel,
      witness: fact,
      detail: fact !== null
        ? fact
        : witness !== null && 'unavailable' in witness
          ? witness.unavailable + '：无法见证该种类，记为缺项。'
          : '本引擎今天没有能见证该种类的既有事实通道：' + rule.because + ' 记为缺项，不得据此认为已产出。',
    });
  }
  return {
    schemaVersion: 1,
    status: missing.length === 0 ? 'complete' : 'incomplete',
    roleId: resolution.roleId,
    revision: resolution.revision.revision,
    required,
    missing,
    detail: missing.length === 0
      ? '角色规格 ' + resolution.roleId + ' revision ' + String(resolution.revision.revision) + ' 的产出期望全部被既有事实见证。'
      : '角色规格 ' + resolution.roleId + ' revision ' + String(resolution.revision.revision) + ' 有 ' + String(missing.length) +
        ' 项产出期望没有见证事实（' + missing.join('、') + '）：如实记为「没有见证到」。' +
        '按 RW-18，requiredOutputs 是角色规格的**声明性产出期望**，不是完成判据 —— ' +
        '该缺项不降级本次轮次结论，也不扣留归约；它只是审计信息。',
  };
}

export type { VerificationRoundRoleOutput, VerificationRoundRoleOutputs };
