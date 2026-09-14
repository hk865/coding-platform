# C01–C04 独立覆盖矩阵

输入 CM1C-001-snap-01，1288 文件，SHA256 d0dadb34031309df103d7e9ad293be4d8210850d93a2895d56d245cfe3b45f05。当前仅行为审查，最终 Gate 待冻结全量和结束指纹，结论以 acceptance.md 为准。

| 条款 | 独立核对与实际证据 | 行为判断 |
|---|---|---|
| C01 | 正式 HTTP Goal/规划/首次指派；三个真实 Run 及 C 的实际 report_architecture_conflict 工具形成 Finding/Brief/Proposal/Candidate/Review。完整构建浏览器截图显示原始 Record.id 冲突、Run/Plan/baseline、提案摘要、方案和逐 Work 影响。模型报告 producer 为协议替身，独立工作按旧规范可继续。 | PASS |
| C02 | 独立核心/Host/服务四分支：accept/reject/defer 正式决定；modify 产生新 proposal 与 pending，旧选择拒绝、原请求幂等、篡改正文拒绝。完整目标集在两个 Ledger 最终事务重算，竞态新增和伪造漏项拒绝。来源、Candidate 和 MigrationGate 回归独立运行。 | PASS |
| C03 | 决定+全部 intent 原子；逐 Work Delivery+intent done+真实 Wait 原子；当前材料/权限经既有 Context/Vault 与 provider-boundary 验证。独立 Host 四 Work（两个resume、两个notify），真实服务三 Work（两个resume、一个notify），决定落账关闭重开、投递后/bind前后故障恢复、三 drive 竞争、缺正文集拒绝，只有两个有效 admission。绑定故障一 Work明确failed、另一只启动一次。 | PASS |
| C04 | 真实 dist Node/workbench 四按钮证据、同服务 Ledger/Runtime 输入与重启回放；profile偏好修改不改Review事实、只读调用工具无写权限。实际 DeepSeek 两后继样例与确定性 producer 分层；仅本次模型输出，不证明自动发现项目质量。 | PASS |

N/A：M01–M05 其余入口迁移、I01–I04 全批集成；1A/M06/1B 的历史 PASS 不替代当前全量。自主模型发现质量、任意真实项目方案质量、图像、长期效益未验证。目标集固定于决定时全部既存 Work（最多64，不截断）；修改仅方案说明且不降级既定影响，来源过期须重新报告。决定不是基线激活或 Evidence PASS，旧规范和权限守卫仍有效。

新增阻断：集中全量和单例复现确认 C-ACCEPT-01（专用explore Run获得协调写入口），C02/C04最终应为FAIL，不能仅凭上表局部行为PASS放行。详见defects.md；本快照不判Gate PASS。
