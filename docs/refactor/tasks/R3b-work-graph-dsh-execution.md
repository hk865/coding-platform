# R3b 受限并行实现任务

W=/home/hyh001/projects/coding-platform，C=W/coding-platform。先读 C/AGENTS.md、W/docs/refactor/tasks/R3b-sol-skeleton.md、N= W/docs/refactor/modules/core/{record-store,work-graph}.md 材料章节、docs/refactor/refactor-plan.md R3b。主Agent已审Sol骨架/测试，10项目前因明确未实现而RED。Raw正文与WG规则有独立DSH Session同时实现；你只填下述洞，不管另一组、Host集成或其余R批次。

ports/types、测试、配置、脚本及其他文件由外层操作系统只读。单文件挂载不能原子rename，请用Python Path.write_text或Node fs.writeFileSync原地写批准文件。不要创建文件/安装依赖/重置或提交Git，不修改标准、不增加timeout、不建立新模块/泛型框架。需要冻结接口修改时明确报告具体阻碍，等待主Agent。所有实际实现要复用现有原语，不保留同义规则副本；新的类工厂之外不要发布无消费者API。

主Agent最终独立审阅、运行测试、核对hash后手工合入；你返回已改文件、真正检查、未完成和错误。只跑下面组别，另一组stub未实现是并行中的预期状态，不能为了使全套通过写另一组。你可把自己的额外检查写/tmp/dsh-output，但不能替代冻结测试。

## 你的范围：WorkGraph material (2个文件)

只写 core/work-graph/materials/applicability.ts、material-service.ts，contracts.ts/body-ports.ts/CoreCallContext/ReadResult及测试均冻结。实现 createMaterialService、createLegacyArtifactPort、createMaterialApplicability、createMaterialAccessResolver 四个骨架工厂。

把 data/artifact-vault/artifact-vault.ts 原owner/exact grant/currentBasis/历史标记策略、material-access-policy.ts原canonical/sourcePin规则移到这些函数，不修改旧文件（下一集成任务会变薄适配/重导出）。WorkGraph只依赖RecordStore原始正文Port和现有WorkspaceTools source applicability helper及contracts中的只读load/index类型，不能importStateLedger实现。不得通过SQL或自己持久化第二份授权/来源记录。候选index不是授权，仍须canonical撤销与currentBasis二次核验，source I/O后最终重核。

Core请求验证上下文一致：principal/reader/project/workspace/actor或Run/Query身份；Host由真实Host构造、不可把模型参数升级Host；writer必须匹配origin。读/写输入在首个await前隔离，不克隆AbortSignal本身；取消如实拒绝。Host historical按真实origin或legacyowner查询canonical Run/Query确定scope，拒绝跨project/workspace；legacy null没有可信关联则forbidden；Host current本批没有足够sourcepin入口时source_stale，不能伪称current。Run/Query保留全部原exactgrant、历史与当前区别；TaskAttempt origin不赋予Run资格。只存正文返回stored，不捏造Ledger cursor。

Legacy ArtifactPort不能通过伪造roleBinding/CoreCallContext转发：用同一private body+authorization原语，仅参数/结果映射。open usage缺省保留原owner-only语义，includeOwner=false不多owner字段；只有历史grant或显式historical才能标historical，current必须有效pin。corrupt→旧invalid，source_stale→旧stale，not_found→旧unavailable，细节保留。所有正式规则只有一份，legacy适配不能复制授权算法。

检查：python3 /home/hyh001/projects/coding-platform/tools/dsh-refactor/check.py r3b-work-graph（7项有效，raw3项分组跳过且测试使用fake raw不依赖其实现）以及 platform-types、platform-architecture。不要把fake raw测试称为端到端，真实Host/Run接线稍后独立验收。
