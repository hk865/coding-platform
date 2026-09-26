# R2d.2：普通 Work、探索和 Reviewer 的真实源码能力绑定

状态：2026-09-23 已独立验收：本批16项＋协议/资源24项＋正式探索10项，最终6文件/50项通过；相关回归11文件/74项、类型/边界/app构建也通过。见[批次证据](../reviews/implementation-batches.md)。本批已接普通、探索与Reviewer三种运行，Query留R2d.3。代码根 C=`/home/hyh001/projects/coding-platform/coding-platform`；设计根 N=`/home/hyh001/projects/coding-platform/docs/refactor`。

前置读 [R2d整体](R2d-model-source-tools.md)、[R2d.1协议](R2d-1-tool-protocol.md)。R2d.1 的 projectSource 判别联合、工具 schema、捕获 registry 与 finally 直接复用，不再实现一套。

## 1. 交付与精确文件

正式 Host 的 ordinary Work、explore、review 三条实际模型链启用 `project_source`，不启用或创建旧 `project_index`。保持真实模型准入、租约、材料、Reviewer JSON 与当前性检查。缺少 Host 政策明确失败，不能退回旧模式。

| 文件 | 本批职责 |
|---|---|
| `app/source-capture-access.ts` | 在既有桥上增加可信 live 绑定；导出下述工厂；复用同一次真实 Run load 的身份、权限和存活判断 |
| `app/service.ts` | 向同一 LeasedWorkerRuntime 注入真实工厂，复用现有 sourcePolicyFor、lazy ledger、Host signal/clock |
| `control/dispatch-engine/leased-worker-runtime.ts` | 材料/租约准备后传递闭包，不提前 open registry |
| `data/context-compiler/runtime-context.ts` | RuntimeContextAccess 新增 `sourceCapture?: RuntimeSourceCaptureFactory`，只传运行期能力 |
| `execution/worker-runtime/coding-agent-runtime.ts` | 实际模型循环传 `projectSource:{mode:'frozen',open:context.sourceCapture}`，沿 R2d.1 统一资源归属 |

不修改 Kernel、UI、Query、磁盘 schema、正式 Run 状态协议。不新增模块/依赖边；无新的 AST、游标缓存或权限数据库。

## 2. 冻结工厂与调用方式

```ts
export function createRuntimeSourceCaptureFactory(
  deps: {
    ledger: () => StateLedger;
    sourcePolicyFor?: (projectId: string, workspaceId: string) => Promise<SourcePolicy | null>;
    hostSignal: AbortSignal;
    now: () => string;
  },
  spec: RunSpec,
  envelope: TaskEnvelopeV1,
): RuntimeSourceCaptureFactory;
```

RunSpec 取共享 `contracts/runtime-preparation.ts`，不要从模型工具 ID/Session 合成 Run。RuntimeSourceCaptureFactory 沿 R2d.1 类型，无第二种 openSourceCapture 选项。

调用工厂只核对并复制绑定，返回闭包，不创建 registry；实际 `open(runSignal)` 才校验当前资格并创建独占 handle。复制 workspace、root、runRef、attemptRef、roleBinding、mode；review 另外复制 workRef/profile/envelope.work/reviewInput。spec/envelope 后续被修改不改变已经绑定的身份。返回的workspace DTO、context中的RunRef/RoleBinding/materialReader也不能暴露私有绑定的可变对象；调用者修改一次返回值不改变下次context或授权。scope/task/goal/run/attempt 不一致在准备阶段明确拒绝。

在同文件为既有 `createSourceCaptureAccess` 增加一个内部可信可选 runtime 绑定参数；其缺席仍是 R2c 架构取材语义。已加载的同一 Run 先执行共同 scope/role/read/materialReader 检查，再执行 live 或 review 检查。不要外层再 load 同一 Run、内层重复一次，也不要把业务判断搬到 core。

LeasedWorkerRuntime.deps 增 `sourceCapture?: (spec:RunSpec,envelope:TaskEnvelopeV1)=>RuntimeSourceCaptureFactory`。在原准备 try 中取得闭包，和材料等一起交 RuntimeContextAccess；没有 read 时可不绑定，不得 open。正式 service 始终配置该回调：sourcePolicyFor 缺席时工厂 open 报 unavailable，不省略回调导致 legacy 默认生效。

现有直接 CodingAgentRuntime 嵌入/fixture 无工厂时保留 R2d.1 的明确 legacy 兼容行为；这不是正式 Host 降级。生产 ordinary/explore/Reviewer 共用上述 Leased 实例，三者都须在实际清单退出旧工具。terminal replay、材料/租约/start 前拒绝不能新建 registry。

## 3. 每请求当前资格，不改变历史架构读取

当前正式 Run 的状态字段是 `starting|running|ended`；暂停/取消位于 controlState.desiredState。live 绑定允许集合：

- status 为 running，outcome 为 null，真实 envelope 存在且 read 授予有效；精确 runRef/attemptRef/role/workspace 仍匹配。
- desiredState 缺席、running 或 steered 可继续；paused/cancelled 拒绝新读，不能据此宣称内核已完成暂停/终止。
- executionAuthorization 存在时 phase 必须 entered；authorized/revoked/quarantined/settled 拒绝。缺席沿现有旧合法 Run 兼容，不制造 generation。
- Host、运行、当次工具任一 signal 取消则拒绝；单个工具取消不能反向取消其他操作。

正式 Dispatch 在调用 Runtime 前已写 running；无需放行 starting。ended/outcome_unknown 等由历史入口读取，不提供新模型页。

以上只用于此 live factory，**不加到 R2c 架构共享 reader 的通用许可上**；SourceGraph 原来可合法以已结束 Run 取材，其完整 Plan/baseline/Workspace/Vault 守卫保持。

subjectKey 使用完整真实 RunRef、完整 RoleBinding 的规范 JSON 摘要。permissionRevision 使用实际 envelope.permissions、完整 role、Host mount/private 政策以及稳定的 live 政策版本；review 加固定 ReviewWork/profile/input/候选范围政策绑定。正常 Run.revision、Workspace.revision 和文件内容变化不是权限版本，不造成无意义拒绝；正式绑定/政策变化则旧捕获整份拒绝。

## 4. 根和 Reviewer 的可读范围

每次 fresh policy 都要求 `policy.root === copied spec.root`，再沿现有 Host realpath/private 与 Kernel 链接边界。另一个本身合法的根也不能替代实际运行的工作树；不能把旧 spec.root 先 realpath 后接受已被替换的链接。

mode与真实工作身份双向一致：非review模式不得带spec.review、envelope.work的review绑定或reviewInput，准备阶段拒绝；已建立的非review绑定每次重核当前Run.work/envelope.work/reviewInput，不得因mode未标review而按普通Host范围读取。不能自动降级或猜profile。review 必须使用 reviewerRunRef，不能使用 profile.subjectScope 中的 producer Run。重读真实 ReviewWork，精确核对：

1. spec.review.workRef、envelope.work、Run.work 指同一个 Work；Work.reviewerRunRef/reviewerAttemptRef 等于绑定 Run/attempt。
2. Work.reviewerProfile 等于复制的 spec.review.profile；完整 roleBinding 等于 envelope/当前 Run/Work 的角色；权限仅 read 且 writeScope 为空。
3. Work.input 存在且等于复制的及当前真实Run.envelope.reviewInput；当前envelope权限也必须仅read/writeScope为空，不只核对profile.permissions；Work.descriptor.materialIdentity.workspaceRoot 等于绑定 root。

底层 `WorkspaceAuthorization.allowsRead` 取 Host 当前路径政策与 `reviewerSourcePathAllowed` 的交集；Kernel 拒绝前缀继续有效。直接复用该谓词，保留任意目录段中的 node_modules/dist/.platform-runtime 等排除；不能仅检查工具 query.path 或 capture.prefix。TS imports 的间接读取、inventory 和实际 read 都必须遵守此范围，允许未变更但合法的依赖源码。

已有 reviewerContext.runtime 提供的 ReviewerRuntimeAccess、assertReviewCurrent、工具/模型前后守卫和最终结果受理全部保留。新 Host 绑定不再额外调用完整 assertCurrent，以免叠加同一来源扫描。分别统计核心冻结分页的读取与原 Reviewer 守卫的额外读取，不声称后一项已优化。

## 5. 资源和返回能力

open 使用 fresh access 完成资格检查后创建本模型循环独占的 `createWorkspaceTools`，默认限额沿 R2c；工厂校验用的短期 access 在 finally release。不得返回 service 架构图的共享 handle，也不能把创建移到 Leased 准备阶段。

返回 R2d.1 RuntimeSourceCaptureAccess：port、复制的 workspace、组合身份/Host+run+tool signal 的 context、从当前真实 Workspace 记录取得数值 revision 的 currentWorkspaceRevision、幂等 close。模型参数不提供 root/revision/principal。当前 Workspace revision 在 capture 时查，后续每页仍由核心 fresh authorize；文件变化的当前性由显式 verify 和原业务边界处理。

创建 handle 后若工厂自身失败，先关闭再保留原错误；返回后由 ObservedModel finally 唯一负责关闭。本轮完成或取消不得关闭另一 Run 或架构共享 handle。Host/Run 取消后 best-effort release 可能被拒，owned close 仍能清理，不通过放宽权限解决。

## 6. 主 Agent 独立验收

1. 至少一个真实已领取 ordinary Run，经 Leased→CodingAgentRuntime→真实 Kernel/本地 ModelClient，执行 capture→query→release→最终文本。验证实际模型清单有 project_source、无 project_index，真实 Host Run 身份、页结果和末端 owned close；禁止只 mock ObservedModel 参数证明接通。
2. ordinary/explore/review 三类实际清单；Reviewer 保留 read_source/material/JSON 和已有准入。fixture 无外部模型请求。
3. 真 Run 与公开 ledger seam 的 live 矩阵、wrong scope/attempt/完整 role/read、无 participation 成功、正常 Run revision 前进可继续、政策变更拒绝旧页。
4. spec.root 与另一个合法政策根不同、运行中根改变、私有链接替换均拒绝。
5. Reviewer 使用自身 Run；错误 Work/profile/input/root 拒绝；实际 imports 引用被排除文件不能读取其内容/符号，合法依赖仍可读。
6. 原 Reviewer 当前性失败仍阻止后续工具/最终报告；分别报告原 guard 和 core 的扫描。
7. 缺可信政策/工厂失败明确失败且不回落；无 read 不 open；lease/material/start 前拒绝与终态 replay 不创建资源；不同运行与架构资源互不关闭。

测试在本批派发前由主 Agent 冻结；dsh 可运行不可编辑。验证相关 Host/runtime/reviewer/leased/源码回归、typecheck、边界、应用编译；不运行全仓/真实外部模型、不下载依赖、不修改用户原有改动。Query 尚未迁移时不得宣称 R2d 总完成。
