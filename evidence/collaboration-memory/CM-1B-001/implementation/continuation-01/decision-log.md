# 1B 实施决策与当前缺口

当前唯一源码 owner：/root。输入 CMM06-001-snap-01，fb3be7f46cf471269427f1f1e2ece8651f8b185ac2408618fc56740309991d96。M06 已独立 PASS 并结束冻结；1B 正在实施，未冻结、未独立验收。本文件不覆盖开工前 preparation 的历史时点。

- B-D01：StateLedger 提供显式 memory capability，两个适配器共享纯折叠。profile 单例使用安装级已有 SQLite Ledger 实例，项目使用自身 Ledger；不修改旧领域事件/CommandIdentity。
- B-D02：记忆维护是明确人类动作，模型工具不获写权限。记忆 HTTP 路由不要求 Goal/Task；已有语义 Query 仍要求真实 Goal 来源，无需计划或开发 Task。
- B-D03：保存结果和实际采用分开。下一 Query/Run 重读当前 scope/revision；旧 Runtime 输入留存原版本。偏好更新不取消运行，不承诺同 Run 请求热刷新。
- B-D04：copy 保存选定 revision 和适用条件，首次提交与每次消费递归复核实际源项目，循环/32层拒绝。跨库没有分布式事务，因此不能仅凭保存时检查宣布以后永远有效。
- B-D05：copy/import 原请求的 SHA 与回执同事务保存；重试先按 scope/actor/key/请求 SHA 查回执。审计和幂等记录不保存来源正文。同键不同路径、参数或许可值仍冲突。
- B-D06：同文本不同来源明确拒绝，要求纠正现有 entry revision；不沿用失效来源并声称保存成功。删除标识不回收，256 标识容量包括 tombstone；不以清理旧标识换取历史复活风险。
- B-D07：只读审阅 memory_seam 发现的递归 copy 失效、源变化后重放、不同来源去重、回执结构校验四项已修。审阅者复看源码认为路径闭合，但它不是冻结快照验收。结构校验不承诺识别任意符合 schema 的人为数据库篡改。
- B-D08：同 Task 实际输入测试暴露 WorkRunMaterialCompiler 可选 WorkContext 缺失时提前返回、绕过记忆的问题。将当前记忆选择放到该分支前，保留原 WorkContext 缺口与权限判据，不放宽 Work/Run 校验。same-task-01 为失败原记录，same-task-02 的真实后继请求通过。

## 已有定向证据

- storage-01：5 例维护、批量失败、双 SQLite 连接 CAS/稳定 profile。
- targeted-03：4 文件16例通过（含模块文件归属）。
- responses-01：维护/Context/Host/既有并行语义查询9例通过；新增 Query 输入测试因未提供既有要求的 Goal 失败，保留日志。测试补实际 Goal，接口继续明确拒绝缺失 Goal。
- responses-02：三用途前后共6次实际内核 ModelRequest、SQLite重启、保存/采用版本分离通过。确定性客户端根据选入偏好输出差异，不是商业模型质量证明。
- same-task-02：前驱/后继同 Task、不同 Run，纠正及 profile/harness/runtime 重启后，旧偏好原文不在后继实际请求，新偏好与正式导入的公开经验进入该请求；只跑 memory=true 变体，未将跳过的旧变体计为通过。
- 类型与边界日志按版本追加；以交付时最终检查为准，不迁移旧检查到之后的改动。

## 仍须集中收口

- B-D09：原笔记 memoryGovernance 固定记录时四项治理见证，与完整公开正文摘要绑定，Control/Ledger 在记录事务中 CAS；不修改原 applicableVersions.governanceRevision 的权限策略语义。无见证旧笔记保留历史，拒绝导入。删除来源身份只依赖 note ref/digest，改变治理条件不能复活。
- B-D10：新增人的公开经验入口，使用实际已启动 Run 及 Control 解析的既有 Task Work。Vault 正文、ExecutionNote、项目 collection 分步持久化；只有最终记忆 committed 是保存确认，重试复用原笔记。Run 的 Workspace 必须仍为当前版本。界面选择实际运行并填写结论/依据，不要求用户填写 Work ID 或伪造规范版本。
- targeted-05：59 通过/1 失败，实际生产者误用了 UI Run 状态（completed 等）校验 canonical Run；已改用 running/ended 并要求 startedAt，未放行未启动 Run。same-task-04 通过。
- targeted-06：9 文件61例通过，覆盖原始治理变化后首次导入拒绝、删除后换元数据不能复活、真实产品入口的同 Task 重启接续和三用途消费，以及旧 WorkRecord 15 例兼容行为。
- browser-04：两例维护/冲突/删除/跨项目与三用途输入版本展示通过。新增公开经验实际运行选择/保存/重启用例正在单独验证。
- types-08 / ui-types-06 / boundaries-06 / docs-02：均退出 0；后续新增测试与细节修改需最终定向检查。
- model-connection-01.json：用户提供本地密钥路径并确认 DeepSeek/deepseek-flash；通过产品安全设置入口配置 WSL 默认 .local/gui 数据对应目录，文字与工具调用连接测试通过，不执行工具。密钥不进入证据。
- real-model-responses-01.json：真实 DeepSeek 经产品 Query Runtime 六次完成，修改偏好后重启，输入 profileRevision 从 1 到 2；架构回应长度 407→1481 字符，进度 395→283，接话 403→302。空工作区仅含真实 Goal 材料，结论限于选材及表达变化，不能代表用户前端/SLAM项目正确性；没有验证图像输入。回答内容保留原样，包括模型对下一步或权限的推断，不将其当成产品权威。

仍须完成公开经验浏览器用例、原始治理事务竞争及旧笔记导入反例、最终接口/文件清单审查；计划修改完成后才冻结并集中全量与独立验收。不以本日志或测试通过宣称 Gate B。1C/M01–M05/I01–I04继续保留未完成状态。

## 冻结补记

上述浏览器与治理反例已完成：browser-06 真实公开经验 UI 保存/重启通过；targeted-07 9文件61例包括最终 SQLite CAS 拒绝旧规范/缺 guard 和旧无见证笔记导入拒绝；types-10/ui-types-08/boundaries-08/docs-04 均0。browser-05 的失败为缺少现有进程沙箱路径，browser-06 配置已有 bubblewrap 后通过。只读复审确认两处 B05 原缺陷闭合，并明确新陈述/原 Run 历史和分步提交边界。

源码冻结 CM1B-001-snap-01：1270文件，ba2841a9f018b2c3a22cd2d87eb40ae71a06e7eb0ba27e37121b9b24116d1eea；相对M06新增17、修改21、删除0。集中全量和正式独立验收运行中，未给 Gate B 结论。Herdr真实项目另组六次completed，完整记录见 real-herdr-responses-01.json。1C已制草案，只读准备；冻结期间产品源码停止写入。
