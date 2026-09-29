# Session 渐进展示验收记录（2026-09-29）

当前状态：五文件 UI 候选已导入，限定浏览器验收完成。用户追加反馈后，删除实时事件转发中裁剪 reasoningContent 的一行，并通过已有设置开启当前模型思考。没有新增模型调用，不宣告逐 token 流式或整个 MVP 完成。

## 两阶段施工

任务：[UI-progressive-session-2026-09-29.md](../../../tasks/UI-progressive-session-2026-09-29.md)。Lane `ui-progressive-session-20260929`，DSH Session `session-9cdf5a2c-c1e2-4f5f-b88d-0e5f73c08496`。

- Stage1：`attempt-1790653339499550730`，只修改既有 Session 渲染测试，新增两项分组/摘要行为并加强原文可访问断言。14 项中 12 通过、2 项因活动分组尚未实现而失败，类型检查通过，然后 STOP。
- Stage2：`attempt-1790653619641799004`，实现 `main.ts`、`views.ts`、`markdown.ts`、`styles.css`，保留冻结测试。DSH 报告 Session 渲染 14 项、相关 5 文件 37 项通过，类型、临时输出 UI 构建与架构边界检查通过，然后 STOP。这里的 51 项属于候选检查，不与下述主树检查累加。
- 范围审计：[scope-audit.json](./scope-audit.json)，只涉及上述四个 UI 文件与 `tests/app/session-rendering.test.ts`，无 scope 外改动、未自动写回原工作树。

## 主审与集成检查

主审收敛中文活动摘要与失败信号、稳定展开键、同 Session 最新定位、原记录计数与回执展示。独审核对工具身份、原记录顺序、未知结果、Markdown 安全与三栏固定高度；另发现旧尾页 `nextCursor=null` 或未加载历史时“查看最新”不读取，交由主审窄修及浏览器确认。没有据此追加后端或测试矩阵。

主审报告导入后限定检查 **28 项通过**，主树 build 与 architecture boundary 检查通过。28 项为 session-rendering、goal-conversation-start、MVP-ui-entry 三文件；后续主审视觉调整后，独审另跑 session-rendering、R6-workbench、MVP-ui-entry 三文件 30 项通过。这些集合有重合，不累加。最后 build 和 architecture boundary 再次通过；AG6 的 3 项另见下方。

## 真实 Session 纯读计数

基线：[model-counters-baseline.json](./model-counters-baseline.json)；本次只读复核：[model-counters-final.json](./model-counters-final.json)。读取现有 Kernel SQLite 元数据时使用只读连接，没有调用 observe、start 或模型，也没有写用户工作区。

两次快照均为 72 条记录、末位置 72、9 次 Kernel request_started、8 次 usage event；累计 inputTokens 249176、outputTokens 3332、cachedInputTokens 165504、既有 modelFailures 1。所有计数差值为 **0**。这些是该 Session 的历史累计计数，不是本批新请求；原有 1 次失败没有被本批抹除或重算。

## 实际浏览器验收

使用原工作台 `http://127.0.0.1:44797/workbench/`，读取 slam6_navigation (test) 原有 Session；没有发送测试消息或编辑项目文件。

- 历史从 50 条追加到 72 条，DOM 中 72 个 recordId 唯一，所有原始记录 position 严格为 1–72。点击已有末页的“查看最新”后仍为 72 条，没有重复；当前无新尾记录，新增尾页场景不伪称真实验收。
- 默认可见“读取文件 4 次 · README.md、架构.md 等 4 项”；展开后直接看到四条 read 的文件路径和状态。开始/用量等连续事件仍在原位置的“执行细节”中。旧失败、模型失败和运行限制在外层可辨认。
- 展开 README.md 的 read 可读到 2,094 字符的真实工具输出；再展开原始记录，核对为 position 18 的 tool.completed。重新读取“查看最新”后，活动组、read 输出和原始记录的展开状态保留。
- Markdown 代码复制按钮给出“已复制”；在空消息草稿中通过真实 Ctrl+V 粘贴，743 字符与代码块 textContent 逐字相等，然后清空草稿，未发送。浏览器工具的 clipboard.readText 返回空，故不以该工具读值判定产品复制失败，最终依据实际粘贴。
- 代码换行按钮实际切换 aria-pressed=true、is-wrapped 及 pre-wrap；没有宣称换行偏好跨重载持久化。
- 检查深色、浅色及右栏键盘调宽；对话宽度缩至 548px 时，页面仍为 1715×1286、无外层宽高溢出，输入框底部为 1270px。长代码在自身横向滚动，不缩字挤入。验证后恢复原主题、隐藏辅助区，关闭本轮新开的文件页。
- 未扩大为任意规模图、所有跨 Session 情况或流式显示验收。已有运行记录仅用于展示核验，不算本轮新模型执行。

最终构建已部署；用户级服务重启后 active/running，PID 3233874。浏览器重新打开并读取原成员成功；模型设置的 enabled 已保存在本机，启动时通过原配置安装入口恢复。

## read / think 追加核对与窄修

只读检查原 72 条记录：17 次工具启动中有 13 次 `read`、2 次 `list_files`、2 次 `search`；`read` 参数使用真实 `{path}` 对象，已有前端映射可以解析。此前默认活动折叠隐藏了工具明细，不是历史缺少读取事实。8 条已保存助手消息没有 `reasoningContent`，全记录亦无其他 reasoning/thinking/analysis 字段；这只证明未保存，不能单凭此断言 Provider 未返回。

主审随后核实当前两个 runtime bindings 与已保存模型设置均为 `thinking=disabled`，并通过本地设置 UI 将原模型改为 `enabled`；保存配置本身没有调用模型。DeepSeek 适配器原本支持 `delta.reasoning_content` → `reasoning_delta` → 完成消息的 `reasoningContent`，Kernel Session sink 保存原完整事件。

另确认 `src/core/agent-runtime/observed-model-run.ts` 的 `platform-live-events` observer 曾在深拷贝后主动删除 `message.reasoningContent`。主审仅删除该行，保留完整 payload clone 与原事件身份。这符合已确认的完整保存记录按需查看语义，不新建推理事实、不改历史库，也不让 observer 修改 Kernel 原事件。旧 72 条记录缺失的内容无法通过此补丁补齐。

必要回归使用仓库 Node 24 运行 `tests/app/AG6-agent-assembly.test.ts`，exit 0；具体数量与输出见 [ag6-agent-assembly.log](./ag6-agent-assembly.log)。未改测试或扩大检查。此追加核对未发起新 Provider 请求；新配置下实际 Provider 返回推理并被 UI 展示尚不能凭静态检查宣告通过。最终 build、Host 加载和既有历史浏览器验收已完成；仍没有发起新 Provider 请求来证明新思考输出，不能把配置保存等同模型调用验收。
