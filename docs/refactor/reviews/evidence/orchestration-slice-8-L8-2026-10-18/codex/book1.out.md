只读核对完成；未修改文件，未运行测试或构建。以下行号均按当前副本。

1. **必须改：裁定1的触发入口会漏。** Workflow 调用 `workflow.ts:1903`，实际注入的是 `create-platform.ts:1570` 的 `rawEvidence`，绕过书中 `:1213` 的包装器。登记也有 `core-routes.ts:642` 的直接入口，不全经过设置页 `host.ts:880`。提交通知只有类型和项目，没有 PASS 结果（`commit-observer.ts:21`）。修改思路：统一成功提交通知，覆盖内部与公开调用；登记等根绑定完成，采用/PASS 按项目遍历 Host 已绑定工作区，捕获结果不影响原回执。

2. **必须改：复用图的幂等键会跨工作区冲突。** `.lead-ref/l8-preread-final.md:8` 建议的 `auto-capture:<trigger>:<cursor>`，同项目多个工作区会相同；捕获身份不含工作区，而指纹包含它（`architecture-service.ts:787`、`:790`）。第二个工作区会报冲突。修改思路：键加入工作区，并明确重试与合并请求的身份规则。

3. **必须改：裁定2–5会丢排队请求。** 书规定开始捕获前才写记录，关闭却停止队列（`.lead-ref/l8-impl.md:36`、`:42`、`:50`）；尚未开始的工作区没有重试依据，同工作区追加的一轮也可能被前一轮成功抵销。修改思路：持久化待处理请求水位，区分正在运行与后续请求。捕获明确接收调用信号（`capture.ts:581`），应确定使用驱动自身的取消信号；同时明确关闭取消保留 requested，避免按裁定3改成 failed。

4. **必须改：尝试记录缺少写入设计。** 提交至少需要一个事件（`record-store/record-codec.ts:645`），不能只有记录 codec。参照物真正的构造器在 `state/task-failure.ts:1197`，保护表及解码白名单在 `tests/architecture/state-writes.test.ts:108`、`:186`。修改思路：补事件、状态层构造器及检查登记；类型放共享契约。若 architecture 调用 state，还须补依赖声明，当前只允许 model、persistence（`module-target.json:67`）。

5. **必须改：裁定10–11丢掉了“不知道”。** `formal-comparison.ts:163` 会生成 `certainty: unknown` 的缺依赖项；统一渲染为“声明的依赖没有 import”会把未知说成确定，违反 `slice-8-SPEC.md:134`。修改思路：明确只展示 proven，或为 unknown 定诚实措辞。

6. **必须改：失败测试的接缝说明不成立。** 扫描故障会转成失败覆盖，仍可成功保存观测（`capture.ts:819`）；Host 也没有透传平台的 fileGraph/lightScan 选项（`host.ts:491`）。修改思路：指定真正导致捕获拒绝的依赖故障，必要时透传已有容量选项，禁止伪造失败记录。另外观测时间仍用真实时钟（`architecture-service.ts:869`）；三小时用例应明确注入该时钟，或依据公开 observedAt 设置准备时钟。

7. **必须改：漏列旧测试。** `tests/composition/WP2-wiring.test.ts:543` 精确要求省略两条提醒；新增“还没有观测”会改变计数。应列入必要回归，按实际新增提醒重新手算，不能泛化放宽断言。

8. **建议：修正复用图，避免接错位置或误改测试。**
   - 提交观察器实际在 `commit-observer.ts:79`，所引105–113不存在；定案入口/结果在 `evidence-service.ts:1463`、`:1605`。
   - 完整图加载在 `architecture-service.ts:634`、`:683`；`file-graph-index.ts:74`只是排序，去掉 digest 的投影在前者 `:677`。
   - 环计算在 `formal-comparison.ts:107`；装配器时钟在 `context-assembler.ts:945`。
   - `context-extensions.ts:658`不存在，且它已读取一般注记（`:260`），并非只投影复用图列的三类。
   - `core-routes.ts:912`仅转发；pins 在 `requests.ts:208`，上下文可参考 `host.ts:983`。
   - `diffContent`要求摘要在两份**完整清单**中唯一（`workspace-read.ts:111`），不同于裁定9的新增/删除集合唯一，不能直接套用。
   - R3d 的计数拦的是旧 `captureSourceChanges`（测试`:80`），当前观测调用 `captureObservation`（`architecture-service.ts:825`）；R6 的根已预绑定（`R6-host.test.ts:124`）；A2 所引`:201`是登记，PASS 断言在 `:411`。这些不能作为原预测的改断言依据。

9. **建议：明确准备阶段读取成本。** 块助手会读全图，包括边（`architecture-service.ts:642`）；正式比较又加载最新图（`:1148`）。两份节点加比较可能重复加载最新图。修改思路：一次准备共享加载结果，比较与移动复用，列出读取次数。

裁定7的持久观测保留、9的 digest 基础可用（`architecture-service.ts:957`、`:966`；`architecture-inspection.ts:68`）。裁定10的 A-03 前缀结果正确；11改用模块路径符合 `formal-comparison.ts:169`。裁定12的 AgentRuntime→WorkGraph 依赖已允许（`module-target.json:185`）。

先改完列出的几处