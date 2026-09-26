# R6.1a 骨架中审：一次窄返修后转实现

2026-09-26。沿原 `session-cebf5ed0-bf0b-4a1a-a729-2a8049ac988c` 返修已 STOP 的 R6 骨架。依据 [原任务](R6-host-workbench-skeleton.md)，优先推进正常端到端路径；本轮只纠正以下已确认问题，不再扩大审阅、增加功能或为测试完备循环。

原 19 文件 scope 不变，**本次仅允许修改以下 4 文件**（相对 `coding-platform/next/`），其余包括 `R6-workbench.test.ts` 保持字节不变：

1. **`src/ui/main.ts`**：删除无审阅资料时补造的 policy、Goal、空 baseline/Plan，以及空 target/proposal/capture refs 请求；删除按 route 缓存 requestId、随后改变同键 expected 的错误逻辑。尚无真实输入/引用的动作明确显示“未接通”，不发送假请求。保留真实 bootstrap、token 和页面启动；不在返修阶段实现完整 UI 业务。后续实现按一次具体操作保存完整原请求，重试保留原 input/requestId/expected。
2. **`src/app/host.ts`**：首 await 前快照固定启动纯数据，至少覆盖 workspaces 的 scope/root/name/workspaceRevision/readPrefixes 及 review；授权、白名单、bootstrap 都消费同一隔离后的数据，不再保留这些调用者可变引用。既有函数依赖沿原接缝保留，不新增热配置或版本机制。
3. **`scripts/check-boundaries.mjs`**：在通用 Node/Kernel 豁免前执行已定 UI 规则：仅本地 UI 模块与 type-only `app/core-http-types.ts`，不得经提前 return 放行浏览器 Node/Kernel、任意 Host 或 Contracts 值导入。保留现五模块八边、第三方白名单和 UI 传递声明所需 Node 类型；不扩检查框架。
4. **`tests/app/R6-host.test.ts`**：仅修以下既有断言/夹具，不新增 case：删除原 203–204、209–210 行两组合法请求永久 `expect(501)` 的阶段断言（共四句，以实际对应代码定位，合法调用后续已有端到端断言）；`startHost` 与 reopen 配置的 readPrefixes 加入实际 source capture 需要的 `tsconfig.json`；原 343 行 registerWorkspace 冲突请求补对应 Workspace@0 expected，保留错误 Project pin，从而真实得到 revision_conflict，避免因缺 pin 提前 invalid。

不新增测试、状态矩阵或相邻模块改动；不修改其他测试、生产、构建配置、selector、scope 或文档。17 条领域路由仍保持骨架明确 unsupported，不在本轮提前接实现。

仅运行既有 `next-r6-host`、`next-types`、`next-ui-types`。目标流程首红仍应来自尚未实现路由；报告实际首红及未到达后段，不断言 unsupported 为产品成功。不重复邻接或全量检查。

交付四文件最终 hash、实际修改及上述检查结果后立即 **STOP**。主审确认后冻结并直接派实现，不自行进入实现，也不追加完善性返修循环。
