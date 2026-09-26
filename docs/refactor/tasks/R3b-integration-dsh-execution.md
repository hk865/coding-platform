# R3b 真实调用链集成：受限实施任务

W=/home/hyh001/projects/coding-platform，C=W/coding-platform，N=W/docs/refactor。先读 C/AGENTS.md、N/tasks/R3b-sol-skeleton.md、本任务、R3b 实施计划和两个已实现的 core/{record-store,work-graph/materials} 窄接口。Sol 已提供骨架与独立测试，主 Agent 已审阅 Raw/WG 实现；本轮只完成真实装配并删除旧副本，不再设计一套 API。其余 R 批次不是本任务。

仅能改 write-scope.json 的7个现有文件。测试、类型、core 实现、配置及其他文件由操作系统设为只读。单文件挂载不能原子 rename；用 Python Path.write_text 或 Node fs.writeFileSync 原地写。不得安装依赖、改测试/阈值、提交/清理 Git、创建替代模块或用 any 绕过类型。若批准接口无法完成行为，报告具体缺口；不要编造成功。本任务需要完成实际实现和检查，由主 Agent 独立验收后手工导入。

## 批准的装配和兼容形状

1. ArtifactVault 保留原类/工厂和旧 ArtifactPort.put/open，内部委托 WG createLegacyArtifactPort；新增只读 materials:MaterialPort，由同一组 dependencies 调用 createMaterialService。原 byKey 可注入共享 Map 的 seam 必须保持实时读写，用 RawArtifactBodyStore 的 ArtifactBodyRows 做 JSON/对象转换；不能构造时复制整个 Map。旧 StoredRecord 可保留兼容类型，允许存储新增 origin（只转形状，不复制验证）。首写争用依赖 putIfAbsent，不能恢复多余的 put 前预读。内存自有 Map 适配必需的 get/set 不算多余预读。默认 grants 无候选；options 可新增 authority:MaterialAuthorityReads、now。现有未注入 authority 的旧 fixtures 保持 owner-only 行为。
2. SqliteArtifactVault 只调用 createSqliteRawArtifactStore、装配上述 WG/legacy 入口并委托 close；不再拥有 DatabaseSync/schema/摘要/权限逻辑。可给父构造函数增加第三个可选 rawStore 参数。正文库与 Ledger 是不同持久对象；保留 body-first，不宣称跨库原子，不清理历史数据。
3. material-access-policy.ts 仅重导出 WG createMaterialAccessResolver，删除旧规则副本。所有真实 Run/Query 消费者通过薄 ArtifactPort 进入同一 WG 规则。不得改 runtime-context.ts 或放宽其 TaskEnvelope/来源校验；不得伪造 work_run roleBinding 来适配 legacy。
4. PersistentPlatform 接口新增只读 materials:MaterialPort，返回 built.vault.materials；vault 仍保持 ArtifactPort。PersistentPlatform 和默认 InMemoryHarness 构造 Vault 时传入现有 canonical ledger authority 与 resolver（同一物理后端，不再开 Ledger 连接）。自定义旧 ArtifactPort 注入仍兼容。不能发布 raw body store 给 Host/模型工具。
5. service.ts 在已知 project/workspace scope 验证后构造 CoreCallContext Host，固定 actor={kind:'human',id:'local-gui'}，signal=serviceStop.signal；JSON不接受principal/reader/actor权限。给 HistoryMaterialsContext 注入 h.materials、readHostContext、grantAuthority。grantAuthority 复用 createMaterialAccessResolver(h.ledger,h.readModel,sourceApplicability)，不复制规则。为保持现有同项目跨工作区历史选择，readHostContext 先 scopeOf 校验目标，再返回项目范围 Host（ctx和materialReader均省略workspaceId），而非错误地将来源限制在目标工作区。
6. HistoryMaterialsContext 的 available/read 新路径均使用上述 Host port，绝不借 item.owner 或 grant.reader 假扮 Run 读正文。available 仍先核对 canonical owner/full ref/workspace，并确保实际首 owner 与目录候选一致。旧未注入三个新参数的 fixtures 保持旧入口；只要启用新入口，就必须完整注入，不在缺参数时偷偷回退。
7. HistoryMaterialsContext.read 的页面 grant 规则必须完整保留：精确 scope、grant 存在、history用途、revision=1、未撤销；使用注入 grantAuthority 的 grantsFor 与 currentBasisValid 核对 exact canonical grant、当前 workspace/plan、显式人类跨工作区历史授权。材料 Host 权限不能代替页面 grant。已有失效 basis 返回 HistoryMaterialRead.result=rejected/stale，不抛成新的 wire；缺失/已撤销仍沿旧抛错。读取正文完成后再次 currentBasisValid，拒绝 I/O 期间撤销/版本变化；只读一次正文，不重新捕获工作区。将 Core ReadResult 映射旧 ArtifactOpenResult，保留拒绝理由，不把失败伪装为成功/空正文。始终历史 applicability，绝不提升为 current。

## 检查能力

在 W 使用 `python3 tools/dsh-refactor/check.py <name>`，脚本固定 C cwd、Node24、单 worker、只读测试。需要：r3b、r3b-raw-boundaries、r3b-admission-boundaries、r3b-await-boundaries、r3b-host、r3b-gui、r3b-regression、platform-types、platform-architecture。最后一个依赖表由主 Agent 根据真实迁移更新；发现未声明边应报告，不可改表。不要运行全工作区测试（会收集历史副本），不要改冻结测试或 race fixture。额外诊断只写 /tmp/dsh-output。

交付：7文件改动、真正测试结果、删除的旧规则、未解决项。首轮无需追求绿而放宽准入；主 Agent 会独立核对真实 GUI 重开、Run bundle、Query、跨进程首写与旧数据库兼容。
