阅读顺序（宽读窄写）：docs/PRODUCT.md相关角色/两图语义；docs/refactor/ARCHITECTURE.md、module-dag.md的当前五模块边界；docs/refactor/modules/core/work-graph.md相关章节及record-store/workspace上下游；docs/refactor/DSH-WORKFLOW.md §3；docs/refactor/tasks/R3d-R3g-next-skeleton.md。本批任务在coding-platform/next，不得依赖旧src运行。需要原意时查docs/refactor/intent/ORIGINAL-DIALOGUE.md对应段。现有contracts/骨架/独立测试共同约束，不自行扩架构。只读事实不能当不存在。

你是实际本地DSH实现Session。只写scope列出的生产文件，tests/contracts/接口形状/其他模块/配置/Kernel只读。文件为单文件bind mount，使用Python/Node原地写，不能atomic rename。不装依赖，不stage/commit/push/reset/restore/clean/stash，不读凭据或无关会话。测试有疑义给出反例交root，不能改测试或凑默认值。需要新私有文件先回报。使用固定检查 python3 tools/dsh-refactor/check.py，next-types和next-architecture。最后报告实际结果/局限，不自行声称通过主Agent验收。

本lane实现R3d持久observed图。冻结 architecture/contracts.ts 与architecture-service.ts的Dependencies/返回类型，graph-index.ts/architecture-delta.ts纯函数seams；独立tests/work-graph/R3d-observed-architecture.test.ts。只实现scope四文件，绝不写formalbaseline/gate/catalog采用。共享core/source.ts PersistedSourceCaptureRef已在。

从真实Project/Workspace canonical事实和Host access绑定核验；WorkGraph调WorkspaceTools capture/verify/export/captureArchitectureSource，正文body-first，再verify，最后Store原子观测记录+当前observedpointer+事件。输入先snapshot，scope/actor/idempotency/CAS/expectedpins不能省略，receipt重放先查原事件不重新capture。捕获正文应持有source summary/files/architecture snapshot以及可复核source范围/完整引用，不直接相信外来ArtifactRef。previous是历史持久观察，不要求其临时capture仍活；需要新捕获时不可拿过期previous作为唯一依据。body持久历史与当前live source校验分开。

历史read通过同一个WorkspaceAccessFactory先当前scope授权，校验canonicalrecord/source完整ref/bodydigest/origin，再逐frozen files/mapping/config path核现行allowsRead；不要求历史文件仍存在/内容不变。权限失败不能先打开body。codec严查键/scope/ref/revisions，拒绝坏body。source变化后失败不得发布current指针。noVerdict及unresolved保留，observed真实环可有。work_link/current/draft/revision明确unsupported不伪造空图。

图算法：依赖有方向，impact沿反向依赖找可能受影响者，用visited保证环终止；邻域应说明方向并按请求depth界限；分页稳定去重、cursor绑定完整source/query参数，允许改变页size；每条edge随它的fromNode页返回，跨页端点仍可由完整ref/nodeID定位；不要丢跨页边。图规模沿existing capture bounds，不能指数枚举所有简单路径。机械compare仅确定可证added/removed/modified，不根据名字猜semantic move；cycle用确定性SCC/DFS，保留unresolved。
检查 next-observed（真实Memory/SQLite+WorkspaceTS）及next-types/next-architecture。只保留必要逻辑，不第二存储或SQL捷径。开始实现。
