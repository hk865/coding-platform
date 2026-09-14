# 明确维护的小记忆与回应选材

状态：CM-1B-001 实施中，未冻结、未独立验收。范围来自 [1B Ticket](../planning/active/collaboration-memory/CM-1B-001.md) 与 [Context 生命周期](context-lifecycle.md)。测试记录和当前实现状态分别见产品 evidence/collaboration-memory/CM-1B-001/ 与 [模块状态](../../human/module-status.md)。

## 作用域与权威

MemoryScope 是安装级 profile 或真实 project，两者不需要制造 Project、Goal、Task 或 Run。profile 的 singleton 身份保存在安装目录 profile/ 的 StateLedger 实例，项目记忆存于项目已有 Ledger。项目初始化或新增 Workspace 不清空 profile。不提供账户、设备同步或自动画像。

HumanCollaboration 根据明确人的操作构造 actor；Control 校验请求、来源与版本并形成纯折叠提交；StateLedger 在同一事务中保存 collection、无正文审计和幂等回执；ReadModelIndex 提供当前版本视图；ContextCompiler 只读当前适用条目。旧 DomainEvent、CommandIdentity 与项目 bootstrap 指纹不变；记忆记录不混进项目事件流。

每 scope 一份 collection revision，每条 entry 有独立 revision、active/candidate/removed 状态、explicit/inferred 来源性质、正文摘要、适用用途与可选到期时间。inferred 不作为当前偏好采用。删除去掉当前正文，保留标识、版本、来源和摘要，拒绝原标识或同来源历史导入复活。历史运行输入不是当前记忆，也不承诺抹除历史审计文件或 SQLite 物理残留。

## 命令、冲突与回执

维护请求包含 scope、requestId、expectedRevision 和 remember/correct/remove 批量操作。correct/remove 指定 entryId 或唯一匹配旧文本，并给出 expectedEntryRevision；零匹配或多个匹配均拒绝。不同来源但相同正文须显式纠正已有版本，不能静默保留旧失效依据。相同人的明确正文和条件重复保存可返回 changed=false。

幂等身份为 scope + actor + key。相同指纹回放原 committed 回执，不受随后 collection 变更影响；同键异内容拒绝。跨项目 copy 和公开 note import 额外记录 Host 计算的原请求 SHA，在重新读取来源前查询原回执，避免成功后源变动使重试失败；这个摘要不能绕过首次提交的来源校验。外部请求不能指定 actor、来源证明或请求摘要。

SQLite 使用 BEGIN IMMEDIATE 做最终 CAS。批量只在最终状态满足容量时整体提交；存储故障、损坏快照/回执均 unavailable，不能当空数据覆盖。默认 collection 上限 256 个标识（含删除标记）、16384 个正文字符、单条 2048 字符。这是存储容量，不是运行累计预算。删除释放正文容量，但不回收标识；达到标识上限必须明确返回 capacity，不丢弃删除标记。

## 来源与授权复制

human 来源记录明确操作的 statementId。公开 WorkNote 导入只接受当前项目的真实 ExecutionNote，保留正文摘要、Work/Run 来源、Workspace 和 Plan 版本、可选 WorkMemory revision，并核对笔记记录时的 memoryGovernance 见证。见证包含四种正式治理 active revision（完成策略、架构基线、架构演进策略、协调策略，缺失以 revision 0 明确记录），与完整公开笔记正文摘要绑定；Control 和 Ledger 在首次记录的事务中对四项做 CAS。导入不把当前规范版本追填成旧笔记的原始依据。缺少见证的旧笔记仍按原契约读取历史，但不能导入为当前经验。原 governanceRevision 继续表示既有权限策略版本，未被改作四项治理见证。

人的“保存公开经验”入口选择真实已启动 Run，填写结论与依据；Host 通过 Control 解析既有 Task Work，先存 Vault 正文，再记录正式 ExecutionNote，最后维护项目记忆。三个步骤不是跨存储原子事务：失败可能留下尚未导入的公开笔记，只有记忆 committed 回执才表示保存成功；同请求重试复用原笔记及回执。当前 Workspace/Plan 或治理版本不匹配、后继记忆存在、retired 或 contradicted 时不得采用。删除标记按原 note ref 和正文摘要识别来源，改变治理参数不能复活同一来源。治理更新时保守停用旧经验，不承诺自动理解任意文本间的语义冲突。公开经验不产生验收结论，也不能覆盖正式规则。

项目默认隔离。用户明确允许后只复制选定 sourceProjectId、entryId、revision 的正文和适用条件，保留原来源；不复制工具权限、工作区写资格或验收状态。首次受理及每次选材均递归校验源条目的当前性，来源失效向后续复制传播；循环或超过 32 层拒绝。跨项目 Ledger 不构成分布式原子事务，后续选材必须再次查源，不能将保存时读到的来源永远标 current。

## 实际消费与界面

记录经验表示人现在作出的新公开陈述，可关联已经结束的 Run；治理见证说明这条陈述记录时的适用依据，不证明原 Run 执行当时持有这些治理版本。

每个新 QueryRun 或后继 Run 组装输入时重读 profile/project，按 reply、architecture、progress、planning、handoff、execution 用途与到期条件筛选；每次输入容量默认 4096 正文字符，未选条目保留排除原因。缓存只在重新读取并校验完整来源、版本和内容后复用，最多 64 项。读取失败不可使用旧缓存冒充当前。

当前明确指示与正式规则优先于长期偏好；更具体的适用用途优先于一般偏好。偏好不是权限变动，不取消已有运行，也不热修改已发送模型请求。Query 的现有 Goal 来源要求保持；维护本身无需 Goal 或开发 Task。同 Task 采用证据必须核对正式 Task/Work 与不同 Run，不能靠新 Query 名称替代。

MemoryView 展示查看、纠正、删除及真实回执；保存仅表示持久版本已更新。实际回应采用记录来自 Runtime 保存的输入版本和摘要，旧记录不被后续维护改写；尚未完成的运行仅说明输入已经组装。确定性模型输入/行为见证与真实模型效果、浏览器证据分别记录，不相互替代。

上游固定版本、MIT 许可和实际适配差异见产品 src/contracts/notices/README.md 与 evidence/collaboration-memory/CM-1B-001/preparation/upstream-files.json。沿用现有 12 Module，不引入第二套 MemoryStore 或调度器。
