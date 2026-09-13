# 1C 决定回流接线方案（待实现）

只读调查来源：memory_seam；实施责任 /root。此文件记录技术方案，不能作为功能存在或验收通过证据。

复用正式 ArchitectureChangeDecision 作为权限结论，增加决定回流记录来固定精确提案、候选、来源、正文及完整目标集合；决定、回流记录和 deterministic per-Work intent 同事务提交。CommunicationIntent 新增明确的架构决定投递 domain，Delivery 新增真实 architecture_decision 来源，不把决定伪装成请求或订阅。拒绝/延后仍通知，但不允许候选实施；修改必须产生新提案并令旧待决版本不可再接受。

完整性可用事务内集合比较，不必另造目录 head：首次决定提交在 SQLite BEGIN IMMEDIATE 或内存同步提交段读取同 Project/Workspace 的全部 canonical WorkContextBinding，将按 canonical ref 排序的 {ref, revision} 与固定集合摘要比较。扫描后新增/换手导致整个决定提交冲突；禁止截断、损坏数据默认为空或只核对已列目标。已成功命令先走持久幂等，不能用今天集合拒绝昨天回执。不得同时在此批修改 Work binding。

范围必须明确为决定时已有 Work，包括非 task Work、无参与者和历史 Work；不能把该集合称为未来所有工作。无真实前驱或 participation 的目标显示不能自动接续，不创建虚假 Run。尚无 Work 的计划任务以及后续新 Work 必须由首次派发/当前正式架构适用性另行守卫；不能只靠历史回流记录。

投递由唯一 CoordinationDrive 领取和重试，Control 最终核对 distribution、target、lease generation 与 Work 身份，原子创建 Delivery 并 settle intent。需接续的目标经正式内部 Control 路径绑定真实前驱及 deterministic wait，复用 admitWaitSuccessor 的 Run/Attempt/outbox 原子提交；附加决定适用性与 disposition 的最终 CAS，不借 Host 伪装 Agent 注册等待。unknown 前驱不重做。

Context 复用 admission 固定的 DeliveryRefs 和 exact artifact grant；正文由真实报告 Run 拥有，不虚构 Vault owner。逐 Work 展示由 intent、Delivery、wait/admission、RuntimeInputBound、ModelRequestEvidence 派生，区分已通知、已绑定、实际调用已采用及失败。普通 Run 不会自动读取 mailbox，必须实际接通 admission 或首次派发材料路径。全部采用只能由全部 required 目标的精确当前决定输入证据成立。
