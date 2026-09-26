# W1 实现主审返修

继续当前 implementation Session；七个生产文件 scope 不变，测试保持只读。本轮主审加强了既有 scenario 7/8，未增加测试类别。先阅读更新后的这两个场景和本任务。以下均是原冻结规范的遗漏，不是新产品需求。

1. `readCanonicalTaskFacts` 目前只读取 Run/Reduction 所属的 origin Plan，没有核对 `taskStateBasis` 实际指向的定义来源。对本次读取所需 task，合并去重读取 selected 和实际 origin 的必要 basis Plan；校验同 Goal、来源版本不晚于引用方、该 task 存在、冻结定义一致、来源的有效 basis 是其自身（绝对来源，不递归跟链）。即使没有 Run，或 Run 的 origin 恰是 selected，也不能让跨 Goal、缺失、语义损坏的 basis 变成 ready/pending。旧无 basis 字段的 Run 指向不存在 origin 的保守 blocked/leased 行为继续保留，不将未知 holder 当 free。
2. `validateFutureObligationCoverage` 只检查 source 全局角色集合，导致现有 A 可以换成另一任务已有的 role。existing task 的 role 必须保持原值；只有新增任务可以选 source 已授权的角色。仍允许未来任务改 instruction，不新建权限管理器。
3. `effectiveTaskBasis` 的 find/some 被每 Task/Run 重复调用，仍有平方级扫描。每份 Plan 构造一次 task→basis Map，在 compiler/read 中按 O(1) 取值，复用已有定义分组。`compileFuturePlanAdoption` 同样逐 task 扫全部 inputs，应一次按 consumerTaskId 分组。不要建持久索引、缓存服务或第二套图。
4. 新增任务必须 phase=pending；不能因旧 planPhaseGuardReasons 只拒绝 running 等状态，就让新增 blocked 任务绕过这项约束。reviewAdmissionProtocol 是原验收协议，本窄分支不能新增、移除或切换它；保留 source 的值。origin 不得由候选引入/替换，source 原有来源也不能在 compiler 中被静默删除。依据原来“gate/治理/授权不变”边界收窄，仍不扩张变更能力。
5. 整理新增 evaluate 闭包缩进；保持现有代码可读，不为一次 recheck 新增服务。没有消费者的内部辅助函数可以删除，避免重复 codec/纯规则两套相同校验。

实现后只运行类型检查、W1 两文件和受影响 R3c/Claim 集合，**不要重复全测试**；最终物理隔离由主 Agent 跑。冻结测试失败不可修改测试，先报告真实原因。输出修复位置、实际检查和剩余限制，完成后停止并交主审。
