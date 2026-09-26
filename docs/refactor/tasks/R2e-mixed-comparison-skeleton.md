# R2e 混合工作树比较：骨架与一个真实消费者测试

2026-09-26 中审状态：六文件骨架已精确导入，独立原 Git 14 项通过、新 mixed 1 项为真实 unsupported 首红，Node types 通过，scope audit 无越界。见 reviews/evidence/next-b2-2026-09-26/r2e-mixed-comparison-skeleton-import.json。[单文件第二阶段实现](R2e-mixed-comparison-implementation.md)随后也已独立验收导入，最终 15 项与 types 通过；以下为冻结骨架规格，不能重新施工。

2026-09-26。按现已验收Git固定版本实现继续，唯一新增设计见 R2e-2-git-read-compare-dispatch.md §6；该文件§1–5是已完成的上一批，不能重复执行或据其旧working_tree invalid关闭本增量。当前机器scope为R2e-mixed-comparison-skeleton-scope.json，恰好5生产+1现有测试，无新增文件。仅第一阶段，完成后STOP中审。

先定向读现Capability索引Workspace/Git、该§6与所复用captureTextSource/readGitWorkspaceFile、access/Kernel read、CaptureRegistry.compare及原project_source compare消费者。旧其他模块只读，不重做全仓调查。

## 已冻结接口

ports按§6发布WorkingTreeWorkspaceVersion/GitWorkingTreePair/WorkspaceContentModeIdentity/GitWorkingTreeChange/GitWorkingTreeComparison，将现WorkspaceComparisonRequest两侧扩为WorkspaceVersion、结果加入原联合。access.read只透传原sandbox.read已给出的mode?:number，不新建沙箱/目录读取。

现git-read.ts声明：

```ts
export function compareGitWorkingTree(
  access: WorkspaceReadAccess,
  input: GitWorkingTreePair & { prefix: string | null },
  signal: AbortSignal,
  limits: Pick<WorkspaceCaptureLimits, 'maxFileBytes' | 'maxCaptureBytes' | 'maxInventoryFiles' | 'maxQueryResults'>,
  now: () => string,
): Promise<WorkspaceResult<GitWorkingTreeComparison>>;
```

阶段一该函数明确unsupported，不提前实现比较。CaptureRegistry沿同track/withAccess一次绑定该函数；合法pair检查仅git↔working_tree新分支，旧git/git、capture/capture行为不变，git/capture保持unsupported，两个working_tree或capture/working_tree invalid。完整OID、path/prefix/scope在open前按原惯例检查，phase1不自造变化数组。

project_source原compare action接明确working_tree版本，保留bare capture兼容和有限pair/schema/原direction，实际薄转发到同WorkspaceTools。不得新建工具/命令执行入口或修改source-capture-access/Kernel/composition；它们正在其他批次施工。原输出容量和权限门槛保持。

## 实现语义供测试冻结

当前工作树只做一次captureTextSource有界观察，透传同次原read的mode；历史侧复用原readTree/readGitWorkspaceFile。digest来自原bytes revision，不重新编码正文；mode按原owner-executable规则归一化。加删/内容修改/mode修改双向正确，结果observedAt/currentness:not_rechecked、complete仅表示所选授权普通文本域读取完成，不承诺原子全树一致/未来不变，不新增全树双读或HEAD一致性门禁。原Kernel单文件file_changed等真实失败、权限和容量继续保留；binary/非法编码/缺mode明确unsupported，不复制Kernel或扩Git写入。

仅在现tests/runtime/R2e-git-source-loop.test.ts新增一个正常链it：复用真实B2 fixture/Git/Kernel/scripted model，基线普通文本在docs范围内内容修改、mode-only、增加、删除；依次通过真实project_source调用git→working_tree与反向，核原OID/rawdigest/mode/方向与真实工具正文进入后继model request，最后正式正常终态释放。原case不删/弱化；无新增异常/并发/撤权矩阵。主审已把现data旧working_tree→git invalid输入迁成working_tree→working_tree，只有这行兼容变化、无新增case，该文件对你只读。

仅跑next-git-read（两现有文件，新增一个it）与next-types分别调用；新测试应在mixed明确unsupported首红，旧正常能力绿，后半未达如实说明。交付6文件hash/首红位置/结果后STOP，不自行实施第二阶段或改其他测试/脚本。
