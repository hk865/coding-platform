
// Completed-capability migration: selected original declarations, no legacy service port.
/**
 * 角色规格材料契约：角色规格的**只读取用**端口，以及随 ContextBundle 投递的角色规格记录。
 *
 * 为什么需要这个端口：ControlEngine 维护角色矩阵与绑定校验，ContextCompiler 按规格取材。
 * ContextCompiler 不允许依赖 ControlEngine（ModuleDependencyDAG），
 * 而角色规格的**解析规则**（矩阵 pin、revision 是否过期、摘要是否一致、权限是否越界）是
 * ControlEngine 的策略，不能复制第二份。因此这里只定义端口的形状：
 * 组合根注入 ControlEngine 自己的那份判据，ContextCompiler 只消费"解析出来的规格正文"。
 *
 * 失败即拒绝、不猜：端口不可用时（没有矩阵、没有安装规格）返回 `absent`，返回 `inadmissible`
 * 时调用方必须**拒绝**该次派发材料，不得降级成"跳过角色校验"。
 */
import type { TaskIneligibilityReason } from './dispatch.js';
import type { RoleSpecContentV1, RoleSpecRevisionRef } from './role-spec.js';
export type RoleSpecResolutionV1 = {
    status: 'resolved';
    roleId: string;
    revision: RoleSpecRevisionRef;
    spec: RoleSpecContentV1;
}
/** 该绑定没有对应的已安装角色规格：沿用引入角色矩阵前的绑定语义（不编造角色目录）。 */
 | {
    status: 'absent';
    roleId: string;
    reason: string;
}
/** 角色不存在／revision 过期／权限越界：必须拒绝，零写入。 */
 | {
    status: 'inadmissible';
    roleId: string;
    reasons: TaskIneligibilityReason[];
};
