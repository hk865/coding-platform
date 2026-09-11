/**
 * RW-12 契约：角色规格的**只读取用**端口，以及随 ContextBundle 投递的角色规格记录。
 *
 * 为什么需要这个端口：ADR 0003 D4-2/D4-3 要求「ControlEngine 维护角色矩阵与绑定校验」而
 * 「ContextCompiler 按规格取材」。ContextCompiler 不允许依赖 ControlEngine（ModuleDependencyDAG），
 * 而角色规格的**解析规则**（矩阵 pin、revision 是否过期、摘要是否一致、权限是否越界）是
 * ControlEngine 的策略，不能复制第二份。因此这里只定义端口的形状：
 * 组合根注入 ControlEngine 自己的那份判据，ContextCompiler 只消费"解析出来的规格正文"。
 *
 * 失败即拒绝、不猜：端口不可用时（没有矩阵、没有安装规格）返回 `absent`，返回 `inadmissible`
 * 时调用方必须**拒绝**该次派发材料，不得降级成"跳过角色校验"。
 */
import type { RoleBindingRefV1, TaskIneligibilityReason } from './dispatch.js';
import type { RoleSpecContentV1, RoleSpecRevisionRef } from './role-spec.js';

export type RoleSpecResolutionV1 =
  | { status: 'resolved'; roleId: string; revision: RoleSpecRevisionRef; spec: RoleSpecContentV1 }
  /** 该绑定没有对应的已安装角色规格：沿用 RW-11 之前的绑定语义（不编造角色目录）。 */
  | { status: 'absent'; roleId: string; reason: string }
  /** 角色不存在／revision 过期／权限越界：必须拒绝，零写入。 */
  | { status: 'inadmissible'; roleId: string; reasons: TaskIneligibilityReason[] };

export interface RoleSpecReadPort {
  resolve(request: {
    projectId: string;
    roleBinding: RoleBindingRefV1;
    /** 本 Run 实际被授予的权限（信封上的那一份），不是"希望拥有"的权限。 */
    declaredPermissions: { tools: string[]; writeScope: string[] };
  }): Promise<RoleSpecResolutionV1>;
}

/** 随 ContextBundle 投递的角色规格记录（只读审计；不产生完成状态）。 */
export type RuntimeRoleSpecMaterials = {
  schemaVersion: 1;
  roleId: string;
  revision: number;
  label: string;
  purpose: string;
  responsibility: string[];
  requiredMaterials: Array<{
    kind: string;
    reason: string;
    /** true=本入口在该通道上供应了它；false=本入口拥有该通道但这次没有供应；
     *  null=本运行入口不拥有该通道（此时派发入口**不开始这次运行**，见
     *  work-run-materials.ts 的 ROLE_MATERIAL_CHANNEL_V1；不得据此认为已满足）。
     *  `supplied: true` 的含义是"本入口给出了带来源与版本的答案"，其中
     *  `selection: 'empty'` 表示答案是**确定的事实**"本次范围内没有这类材料"
     *  （例如该任务首次运行、还没有已接纳证据）——它不是"未核对"，也不是"已满足"。 */
    supplied: boolean | null;
    detail: string;
    /** 这一类的取材结果（选入了具体条目还是读到了"确定为空"的答案）。 */
    selection?: 'selected' | 'empty';
    /** 承载该类材料正文的 manifest 条目 id（规则键／证据 id／决定 id）。 */
    materialIds?: string[];
    /** 这一类的来源（含版本）；缺来源的材料不会进入本记录。 */
    sourceRefs?: import('./dispatch.js').SourceRefV1[];
  }>;
  requiredOutputs: Array<{ kind: string; reason: string }>;
  sourceRefs: import('./dispatch.js').SourceRefV1[];
  selectedBecause: string;
};