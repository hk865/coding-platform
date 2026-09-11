# 契约续轮独立复核

Ticket：SC-CONTRACTS-FOLLOWUP-REVIEW。复核者未实现生产、测试或现行文档改动；唯一写入是本报告。范围以本目录 baseline.json 和 history 中保存的续轮起点为准，不把前轮清理及原有未提交变更算成本轮实现。

## 候选源码结论

未发现本轮引入的阻断性行为、持久协议、HTTP 形状或权限回归。此结论针对契约重组，不表示协调角色实际消费 FAIL 并形成正式调整已经实现。

- 独立读取两根 AGENTS、架构相关责任、当前状态相关段落，检查 validation/rework 新入口、组合根及真实消费者；没有只依赖主 Agent 类型检查结论。
- 使用 TypeScript AST 独立比较原 validation 与四个返工文件的 170 个保留声明：忽略注释、拆分需要的 export 及等价相对 inline import 路径，类型结构、常量和函数体全部相同。ReworkIssueReadPort 迁入 harness 后再次比较仍为零差异。
- 核对既有消费者 3,281 条 named/inline import 绑定，本地名称、导出名称、type-only 性质与迁移映射一致；随后单独核对宿主读取器的四个消费者已指向 harness。69 个既有改动 TS/TSX 文件初始检查只有 imports/注释变化；TSX 单独用文本差异复核，避免把解析器扩展名差异当产品变化。
- 检查 20 个新协议文件的相对导入及 inline imports：目标可解析，包含 type edges 的子图也无循环。返工 issues、proposal、drive、acceptance 的依赖方向分别对应材料、提案、驱动、受理。结构校验仍调用同一原函数，不引入准入政策副本。
- 原 ValidationIssue 等 75 个导出声明保留；拆分增加 12 个校验器间复用的原私有声明导出。它们是源码内部复用，不是新的业务端口，也不应报告为公共导出净减少。
- ReworkIssueMaterials 是 OpenIssuesViewV1 的无消费者同义别名，源码、测试、脚本及相邻 coding-agent 搜索未发现消费者；可删除。ReworkDispositionPort 有真实跨模块消费，继续公开。宿主读取器无跨模块消费者，已移回组合层。
- 未修改版本字段、序列化键、拒绝码、错误消息、哈希算法、HTTP 处理体、计划受理守卫和历史兼容函数。包为 private 且未声明 package exports；内部 deep-import 路径变化已迁移仓内及已知邻仓消费者，不能由此保证未知外部深路径导入兼容。

## 发现及修复复核

1. ReworkDriveRequestV1 注释错误称只传作用域。已改为组合根取得问题材料，驱动读取和核对当前计划，与实际 issueMaterials 一致。
2. common.ts 错称全部内容只供校验器内部消费。已说明公共问题结果与内部结构原语的两种消费者。
3. 返工注释仍以 RW/RC 阶段编号描述当前行为，义务承担者函数仍声称三处消费。已改为当前模块和实际 Control/Dispatch 用途，保留未处置义务、currentness/disposition 区别及兼容回退理由。
4. ReworkIssueReadPort 起初仍公开在 contracts。已迁回 harness/rework-composition.ts；两宿主与测试导入同步，函数类型和组合实现未改变。
5. 旧 validation.js/rework.ts 文档引用和角色校验施工标题已修复。contracts README、validation README、PlanCompiler README、权威 Module 边界/运行时协作/ArtifactVault 文档与当前入口一致。含 P1-03 的既有运行期错误字符串有意保留兼容，不当作过期注释删除。

以上发现均在源码候选复核中关闭。精确材料授权、Control 正式权威、PlanCompiler 仅提案、Context 不启动 Agent、Dispatch 无 Verification 长期回调、旧 FAIL/义务保留的责任未改变。

## 验收边界

已查看本轮定向日志：13 文件、136 测试通过；随后核对 full-tests.log 的实际结果为 299 文件、1951 测试通过。外层脚本运行期间被添加分支，导致测试完成后的 shell 解析失败；full-wrapper-failure.txt 单独保留该证据运行器错误，不将其抹成整次运行全绿，也不混称产品回归。构建、浏览器及最终当前状态文档由主 Agent 统一完成，本报告不预报其结果。此报告是限定范围独立源码复核，不替代真实 HTTP/浏览器验收，也不宣称清完其它平面协议、私有类型或历史注释。

补充复核 architecture-evolution-policy.ts 与 governance-install.ts 文件头：删除的 FROZEN、Lane A、旧 Ticket 和已不存在交接章节仅是历史施工指令。安装不自动激活、精确目标 identity/revision/digest、失败零写入、StateLedger 决定幂等和 CAS、旧 active ref 不被冲突改写等有效约束均保留；当前注释指向 validation/governance.js。未发现这两处注释更新丢失有效语义。

## 最终状态与证据一致性复核

最终核对 IMPLEMENTATION-HANDOFF.md、human/module-status.md、本目录 verification.md 与实际日志，未发现不一致的完成声明。module-status 的“剩余产品能力（不是实施顺序）”整节与本轮 history 原文逐字一致，14 项有效未完义务未被清理取消。两个当前入口均明确工具 FAIL 进入协调角色语义调查、结果形成正式提案并受理的连接仍未实现，未以机械返工或只读执行反馈调查冒充语义改计划完成。

读取最终类型、边界、build、ui-artifacts 的 exit 均为 0；浏览器首轮日志明确是 4399 端口已占用、测试未启动，隔离配置继承原配置并仅改端口，独立夹具目录通过已有环境参数传入，没有放宽断言或复用旧服务。browser-isolated.log 为 26 passed (4.2m)。产物扫描为 338、stale 为空；docs-final 为 13/13，source-docs 为 62 条链接且零失败。文档历史坏链接、旧构建产物首检、环境和脚本失败仍单列记录，后来 PASS 没有覆盖它们。

独立重新读取 final.json 所列产品 1419 个文件、文档 487 个文件并逐个计算 SHA256，与最终清单全部相同。交付摘要在 verification.md/preservation.json 中一致：产品 `486834413c503516aeb7646ec2baec4f911bae79f89aa89903bc8254cac4647a`，文档 `e87d6833641efbb10cd86ffdcfc027ad439fd98065068d41c149bb9ea5b2e596`。preservation.json 显示 HEAD 未变、无未保存文件，探针与 .gitignore 恢复/保留；本报告位于不计入源码摘要的 evidence 范围。本次独立复核关闭，无剩余阻断发现。
