# R3b WorkGraph 首轮独立审阅返修

继续当前 Session，仅两个原批准实现文件可写。主 Agent 补充冻结 `check.py r3b-admission-boundaries`，6项中当前5项失败/1项通过；原7项继续冻结。同步由主 Agent 登记为 manifest.rootUpdates，不是你的修改。

1. `hostAdmission` 不能把所有 platform_operation origin 当无owner拒绝。合法Host写入后必须能以相应project/workspace读取历史；直接核对规范platform origin，不伪造Run。workspace受限Host不得读取其他workspace或无可信工作区关联的正文；project-wide Host可读同project正文。legacy owner=null仍不能推断授权。
2. Core openArtifact传入的reader必须在首个await前隔离。当前传ctx.materialReader原引用，raw.read等待时可由调用方修改项目、requester或basis，绕过已做的principal一致性检查。复制必要ctx/principal/reader数据，保留原AbortSignal；新work_run的workspaceId同时核对canonical Run（完整ref与scope）才能读取/写入。legacy owner-only不得为此被改成需要伪造角色或新的canonical查询。
3. 无副作用的读取在body I/O或授权等待后已取消，应返回cancelled，不返回正文。原Store成功已产生的副作用不能假装回滚。
4. raw corrupt在新Core接口映射unavailable并保留具体reason；旧ArtifactPort仍映射invalid。内部保留足够错误语义，在各协议边界一次转换，不靠reason字符串猜错。不要给公共CoreError新增corrupt。

测试新文件有真实行为正负对照：平台来源写后读、跨域拒绝、等待时reader双向修改、取消、损坏映射、真实canonical工作区。运行原 r3b-work-graph、新 r3b-admission-boundaries、platform-types、platform-architecture。报告结果与残留，不动raw/Host/其他测试，不扩大功能。
