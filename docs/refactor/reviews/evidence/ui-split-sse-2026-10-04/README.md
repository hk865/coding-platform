# 任务 E：前端拆分与 SSE · 2026-10-04

本目录是任务 E 的截图与轮询证据，共三部分：

- 重构前（before）的基线。采集时没有改任何产品文件。
- 阶段 1（拆分 `src/ui`，不改行为）结束时的验证（after-split）。结果见下文“阶段 1 拆分验证”。
- 阶段 2（SSE 替代轮询）结束时的验证（after-sse）。结果见下文“阶段 2：SSE”。

## 本批范围

- 截图使用的是一个不调用模型的本机 Host，跑在隔离的临时工程上。它启动的是构建产物里真实的 `dist/app/host.js`，并且走 CLI 同一个启动文件解析路径 `loadWorkbenchCliConfig`。所有业务事实只通过公开的 `/api/real/core/*` 路由写入。
- Host 的 provider 注册表里只有一个本地脚本客户端，写法和 `tests/helpers/AG2b-collaboration-fixture.ts` 相同。它的 base URL 是 `https://invalid.test`，不会打开任何网络连接。真实模型调用次数为 0；脚本回复的次数见 `before/seed-state.json` 的 `scriptedCalls`（工作 6 次、查询 2 次）。
- before 的产品源码固定在 E 工作树的基线提交 215d7ed（未修改），先 `npm run build`，再由 Host 提供 `dist/app/public/workbench` 的现有构建产物。具体对应关系见 `before/bundle-sha256.txt`；其中的 99f45c2 是 WSL 快照，不是真实提交，它的树与 215d7ed 相同。after-split 的源码见下文“阶段 1 拆分验证”，after-sse 的源码见下文“阶段 2：SSE”。
- 没有新增依赖。Playwright 只通过 `npx -p playwright@1.63.0` 在 WSL 里使用（它自带的 chromium 版本 1243 与已缓存的浏览器一致），不写进 package.json，两个锁文件保持不变。

## 文件

| 文件 | 作用 |
| --- | --- |
| `run-host.mjs` | 确定性 Host：建隔离工程，用固定种子写入数据，然后一直服务，直到收到 SIGTERM。阶段 2 起，收到 SIGUSR2 时断开所有已打开的 changes 流连接，只供回退场景使用。 |
| `capture.mjs` | Playwright 截图，加 `--polling` 时还会记录轮询。阶段 2 起还记录 changes 流的连接和帧，并多了三个场景（见“阶段 2：SSE”）。 |
| `compare.mjs` | 逐像素比较两个截图目录。不依赖图片库，PNG 由同一个 Chromium 的 canvas 解码。以后也用它做 before 与 after 的对比。 |
| `capture.sh` | 一键执行：按次数分别启动 Host、截图、停止，然后比较各次结果，并把第 1 次的结果复制到 `<label>/`。阶段 2 起把 Host 的 pid 传给 capture.mjs，并用 trap 保证任何退出都会停止 Host。 |
| `before/*.png` | 23 张基线截图，清单见下文和 `before/manifest.json`。 |
| `before/polling.json` | 当前轮询的实测记录。 |
| `before/determinism-run1-vs-run2.json`、`-run3.json` | 第 1 次运行分别与第 2、3 次独立运行（各自重新播种）的逐像素比较结果。 |
| `before/seed-state.json` | 种子结果：Goal、Task 阶段、Session、workflow 推进记录、虚拟时钟等。 |
| `before/bundle-sha256.txt` | 截图时所用构建产物的哈希，以及源码提交。 |
| `after-split/*.png`、`manifest.json`、`polling.json`、`seed-state.json`、`bundle-sha256.txt`、`determinism-run1-vs-run*.json` | 拆分完成后用同一脚本、同一种子采集的结果，文件含义与 `before/` 中的同名文件相同。 |
| `after-split/compare-before.json` | `before/` 与 `after-split/` 同名截图的逐像素比较。 |
| `after-split/polling-recheck.json` | 在同一棵树上另做一次独立运行（1 次）得到的轮询记录，用来复核空闲窗口。 |
| `after-split/src-ui-sizes.txt` | 拆分后 `src/ui` 下每个文件的行数（`wc -l`）。 |
| `after-sse/*.png`、`manifest.json`、`polling.json`、`seed-state.json`、`bundle-sha256.txt`、`determinism-run1-vs-run*.json` | 阶段 2 完成后用同一脚本、同一种子采集的结果，文件含义与 `before/` 中的同名文件相同。`polling.json` 另有流的记录和三个新场景。 |
| `after-sse/compare-before.json` | `before/` 与 `after-sse/` 同名截图的逐像素比较。 |

## 种子数据（每次运行完全相同）

- 两个工作区：`演示工程`（demo-project，允许命令）和 `示例库`（demo-lib，用于项目树与切换）。
- 完成策略：已安装并激活，只含 static 检查。登记的检查命令是 `grep -q ParseResult src/parser/result.ts`。检查沙箱里看不到用户自装的 node，所以用 /usr/bin 下的 grep。
- 架构包含 4 个模块：应用入口、解析器、文本工具、文档。另有包含关系 app⊃parser、app⊃util，以及依赖 app→parser→util。
- Goal `demo-goal` 有 4 个 Task：
  - `parse-result`、`usage-doc`：都是 required 的工作任务，其中 usage-doc 依赖 parse-result；
  - `future-cli`：optional、plan_only 的未来意图，是 usage-doc 的子任务；
  - `goal-gate`：验收节点。
- 通过显式的 `workflow/advance` 逐步推进（不使用后台 driver），共 23 步：先后完成两个工作 Task 的执行与检查，然后是 gate，最后 `complete_goal`。最终两个工作 Task 和 gate 都是 satisfied，future-cli 保持 pending，Goal 已完成。
- Session：
  - 主对话：顾问角色，有一次只读查询问答，回答里包含表格、列表、代码块和引用；
  - 执行者：两次 Run，包含读取、一次失败的读取、编辑和最终正文；
  - 第二个顾问：关联 parser 模块，有一次问答，另外收到一条普通来信；
  - 一个已归档的顾问 Session。
- 第二个 Goal `demo-goal-poll` 只用于轮询观察，种子阶段不会执行它。

## 截图清单（before/）

桌面截图是 1440×900，窄屏截图是 390×844（isMobile）。

| 文件 | 内容 | 操作 |
| --- | --- | --- |
| 01-overview-main-conversation | 项目树和主对话 | 打开页面。显示偏好已预置为当前 Goal 和主对话 Session |
| 02-member-builder-session | 执行者的原历史 | 左侧点击“执行者” |
| 03-observe-timeline | 行为观察：Run 时间轴和 Task 折叠 | 更多 → 行为观察 → 读取执行事实 |
| 04-execution-history-tab | 右侧的执行记录页 | 点击第一条 Run 的“查看本次执行 / 原历史” |
| 05-execution-tab-claim-session | Task → Run → 原 claim 会话 | 更多 → 对话，然后点“查看原会话 / 完整会话原历史” |
| 06-builder-task-fold | Task 收纳 | 更多 → Task 收纳 |
| 07-member-reviewer-session | 第二个顾问的问答 | 隐藏辅助区，再点击第二个“顾问” |
| 08-archived-session | 归档成员只读 | 加载归档，再点击归档成员 |
| 09-task-graph | 任务图，未来意图仍在图上 | 选回主对话，点顶栏“任务图” |
| 10-task-node-detail | 任务节点详情 | 点击“解析器返回 ParseResult” |
| 11-architecture-graph | 架构包含树 | 点顶栏“架构图”，展开“应用入口” |
| 12-architecture-node-detail | 模块详情 | 点击“解析器” |
| 13-architecture-aux-expanded | 放大后的辅助区 | 点“放大辅助区” |
| 14-files-directory | 文件资源管理器 | 恢复宽度，点顶栏“文件树” |
| 15-file-tab | 文件页 | 点击 README.md |
| 16-command-page | 命令页，`cat README.md` 已 settled | 点顶栏“命令”，运行 |
| 17-diff-page | Diff 表单 | 点顶栏“Diff” |
| 18-settings-dialog | 设置对话框 | 点左下角“设置” |
| 19-second-workspace | 切到第二个工作区 | 点击“示例库” |
| 20-overview-dark / 21-task-graph-dark | 深色主题 | 系统偏好设为深色 |
| 22-mobile-overview / 23-mobile-task-graph | 窄屏 | 390×844 |

每一步操作和对应的哈希都记在 `before/manifest.json`。截图期间，浏览器控制台的 error 和 warning 为 0（见 `consoleProblems`）。

## 确定性及处理办法

用 `capture.sh before 3` 做了三次完全独立的运行，每次都用新的临时目录，重新播种并截图。第 1 次与第 2 次、第 1 次与第 3 次相比，23 张截图都逐字节相同，逐像素差异为 0；用来判断截图是否为空的检查也没有报出问题。见 `before/determinism-run1-vs-run*.json`。

不确定的来源，以及各自的处理办法：

1. **服务端 ID**。服务端多处使用 `crypto.randomUUID()`，涉及 Run、事件、轮次等。`run-host.mjs` 在加载产品模块之前，把它替换成计数器生成的 UUID，然后调用 `syncBuiltinESMExports()`。
2. **服务端时间**。账本与 Kernel 的时间戳、Run 的开始和结束都会显示出来，任务图的时间布局也依赖它们。`run-host.mjs` 把全局 `Date` 换成虚拟时钟，从 2026-10-04T01:00:00Z 起，每调用一次加 10ms。前提是播种严格串行：每个 HTTP 请求都 await，用逐步的 `workflow/advance` 代替后台 driver，这样调用顺序固定，时间值也就固定。环境变量 `RUN_HOST_REAL_CLOCK=1` 可以关掉这个替换，只在诊断时用。
3. **浏览器时间**。界面用 `Date.now()` 加页内计数生成 requestId 和 flowId。截图时使用 `page.clock.setFixedTime`，并且每个页面的固定时刻依次错开 1 分钟。如果多个页面冻结在同一个时刻，就会在同一个 Host 上复用对方的幂等 requestId：调试中，第二个页面的 `commands/start` 实际没有启动新命令。计时器照常运行。
4. **渲染**。固定视口，deviceScaleFactor=1，zh-CN 与 Asia/Shanghai，reducedMotion，截图时关闭 CSS 动画、隐藏光标，鼠标停在视口右下角。每张截图前等待没有在途请求、静止 600ms、字体加载完成，再等两帧。
   - 光栅化。早先一次没有加光栅化参数的运行里，`09-task-graph` 在输入框圆角处有 26 个像素不同，单通道最大差 1/255，属于抗锯齿噪声。现在 Chromium 统一加上 `--force-color-profile=srgb --disable-gpu --disable-partial-raster --disable-skia-runtime-opts --run-all-compositor-stages-before-draw`（另有 `--font-render-hinting=none --disable-lcd-text`），之后三次运行都逐字节一致。所用参数和 Chromium 版本（153.0.8010.12）记在 `manifest.json` 中，after 必须使用相同的参数。
   - 容差。`compare.mjs` 除了严格计数（任一通道差大于 0），还会列出单通道最大差超过 2/255 的文件（`aboveTolerance`），用来区分抗锯齿噪声和真实差异。
5. **显示偏好**。界面会把选中的 Goal 和 Session 存进 localStorage。每个浏览器 context 在首次加载前写入一次相同的值，并用 sessionStorage 防止重复写入。

已知限制：只在同一台机器、同一份字体（WSL 中的 Noto Sans SC 与微软雅黑）、同一个 Chromium 1243 上验证过确定性，换机器或换字体后应该重新采集 before。

## 当前的轮询（before/polling.json）

记录方式：Playwright 的 `page.on("request")`，时间为墙钟毫秒。

| 场景 | 观察结果 |
| --- | --- |
| 空闲页面（Goal 已完成，主对话），加载并静止后记录 30 秒 | 加载阶段约 0.8 秒内发出 10 个请求：页面、样式、脚本、bootstrap、goals/read、sessions/read、queries/read、sessions/history、sessions/find。之后 30 秒内请求数为 0，没有任何定时轮询。 |
| 命令页运行 `sleep 8`，没有其它运行中的工作 | 1 次 `commands/start`，随后 `commands/read` 每约 700ms 一次（实测 699–701ms，共 12 次）。在约 8.9 秒时 settled，之后停止。 |
| 协作 driver 运行中：脚本模型阻塞，状态保持 running。先切到“示例库”再切回“演示工程” | 切回时立即读一次 `workflow/driver-read`，之后每约 1000ms 一次（实测 991–1001ms，12 秒内 13 次）。 |
| 上一场景继续，同时运行 `sleep 1` | 两个计时器并行：`commands/read` 约 700ms，`driver-read` 约 1000ms。 |

从代码中确认的相关事实（215d7ed）：

- 页面首次加载只恢复显示状态，不启动协作轮询。只有在切换工作区、开始、停止或继续协作、刷新执行时才会开始。driver 不再处于活跃状态（running、waiting_for_reply、stopping 以外）时，轮询自行清除。
- 命令轮询从“运行命令”开始，到 settled 结束。
- 两种轮询都不感知页面是否可见。

## 阶段 1 拆分验证（after-split/）

源码：E 工作树 215d7ed，加上当时未提交的拆分（S1–S8）。`after-split/bundle-sha256.txt` 中的 d214b0e 是 WSL 快照，不是真实提交；它的树就是 215d7ed 加上拆分，与随后提交的 `src/ui` 和两个新测试文件相同。拆分和本目录在同一个提交里入库。拆分把 `src/ui/main.ts` 和 `views.ts` 里的代码原样移到按区域划分的模块里，另外新增 `state/store.ts` 和 `api/refresh.ts`（所有 setInterval/clearInterval 都只经过这一个模块）。`settings.ts`、`markdown.ts`、`index.html`、`styles.css` 没有改。全部检查都在 WSL slot e1 中、对 E 工作树的快照执行，2026-10-04。

### 文件规模

- `main.ts` 从 7633 行降到 151 行，只剩文件头、import、测试用的 re-export、`fetchBootstrap`、`main()` 和启动守卫。
- `views.ts` 从 2529 行降到 109 行，现在是只做 re-export 的入口，仍是 esbuild 的第二个入口，所以 `views.js` 照常发布。
- `src/ui` 下现有 76 个文件，共 12495 行；拆分前是 6 个文件，共 11314 行。增加的行数主要是各模块的 import 和一行文件头。
- 没有文件超过 800 行。最大的 5 个：`settings.ts` 572（未改）、`views/history/timeline.ts` 488、`styles.css` 483（未改）、`state/scope-state.ts` 450、`views/execution/query-flow.ts` 443。每个文件的行数见 `after-split/src-ui-sizes.txt`。

### 构建

- `npm run typecheck`（两个 tsconfig，包括 tsconfig.ui.json）、`npm run check:architecture`、`npm run build` 都通过。
- 构建产物 `dist/app/public/workbench` 仍然只有 index.html、main.js、styles.css、views.js 四个文件。index.html 和 styles.css 的哈希与 before 相同。main.js 和 views.js 的哈希变了，这是预期的：代码被移动，打包后的模块顺序也随之改变。见 `after-split/bundle-sha256.txt`。

### 截图

用的是同一个 `capture.sh`、同一个种子、同一个 Chromium（153.0.8010.12）和同一组参数：`capture.sh after-split 3`。

| 比较 | 结果 |
| --- | --- |
| after-split 第 1 次运行与第 2、3 次 | 23/23 逐字节相同，逐像素差异为 0（`after-split/determinism-run1-vs-run*.json`） |
| before 与 after-split 的同名截图 | 23/23 逐字节相同，逐像素差异为 0。没有超出容差的文件，也没有疑似空白的截图（`after-split/compare-before.json`） |
| `manifest.json`（每一步的操作、每张截图的哈希、Chromium 版本和参数） | 与 before 完全相同 |
| `seed-state.json` | 与 before 完全相同 |
| 浏览器控制台的 error 和 warning | 0 |

没有任何差异需要解释。

截图过程中的点击会经过拆分后的大部分 action 表：shell、conversation、sessions、execution、graphs、files 和 terminal。setup 表的处理函数不在截图流程里，它们是否原样搬过来，靠的是拆分时对每个 case 的代码比对。`tests/app/ui-actions.test.ts` 只检查每个 action 名称是否恰好属于一张表。

### 轮询

阶段 1 不改轮询，所以 after-split 应该与 before 一致。实测结果如下（次数；间隔取中位数，括号内为最小到最大值）：

| 场景 | before | after-split |
| --- | --- | --- |
| 空闲页面：加载阶段 | 10 个请求，769ms 内发完 | 10 个请求，782ms 内发完，路由和次数相同 |
| 空闲页面：加载后 30 秒 | 0 个请求 | 0 个请求 |
| 命令 `sleep 8` | `commands/start` 1 次，`commands/read` 12 次，700ms（699–701），8851ms 时 settled | `commands/start` 1 次，`commands/read` 12 次，700ms（699–701），8865ms 时 settled |
| 协作 driver 运行中，切走再切回 | `driver-read` 13 次，1000ms（991–1001） | `driver-read` 13 次，1000ms（982–1002） |
| 上一场景继续，同时运行 `sleep 1` | start 1 次，read 2 次（700ms），driver-read 1 次 | start 1 次，read 2 次（703ms），driver-read 1 次 |

- 每个场景每条路由的请求次数都相同。间隔中位数的差别不超过 3ms，在冒烟检查允许的 ±10ms 之内。
- 加载阶段有两次背靠背的 `goals/read`，它们之间的间隔从 5ms 变为 7ms。S1–S8 的每次冒烟中，这个间隔在 5–10ms 之间波动，属于页内时序，不是轮询。
- 空闲窗口：after-split 的 `polling.json` 记录的窗口是 29602ms，比 30 秒少约 0.4 秒。等待本身是 `page.waitForTimeout(30_000)`，用的是计时器；窗口长度则是 capture 进程两次 `Date.now()` 之差，取的是墙钟。较可能的解释是这 30 秒内 WSL 的墙钟被校时回拨了约 0.4 秒，但没有直接证据。S1–S8 的冒烟都记录到 30001–30003ms。为此在同一棵树上又独立跑了一次（`after-split/polling-recheck.json`）：窗口 30002ms，请求 0 个，其它场景的路由次数也与 before 完全相同。
- 结论：阶段 1 没有改变轮询。空闲页面仍然没有任何定时请求；命令轮询约 700ms，协作轮询约 1000ms，两者都与 before 相同。SSE 留到阶段 2。

### 全量测试

- `~/cc-work/with-usr-bin-node.sh npm test`（即 `vitest run --maxWorkers=1`）：155 个文件、4484 项全部通过，没有跳过，用时 447 秒。开始时 WSL 的负载约为 0.4。
- 基线 215d7ed 的全量是 153 个文件。多出的 2 个文件就是下面列出的两个新增 UI 测试文件，其余测试文件都没有动。
- 这次全量包括 AG2b-collaboration。拆分期间这个文件出现过偶发的计时失败：S3 一次、S5 两次、S6 一次，断言都是会话数“expected 2 to be 3”。Task A 在未改 UI 的代码上也复现过同一失败，所以它与拆分无关。这次全量没有出现这个失败。
- 拆分没有引入回归，因此没有改任何产品代码。

### 未改动的内容

- 已有测试的断言和 import 路径都没有改。新增了两个测试文件：`tests/app/ui-store.test.ts`（16 项）和 `tests/app/ui-actions.test.ts`（5 项）。
- 两个 npm 锁文件没有变，没有新增依赖，也没有改 `vendor/coding-agent/dist`。
- 没有调用真实模型，没有推送。

## 阶段 2：SSE（after-sse/）

源码：E 工作树 759e6a2（阶段 1 的提交），加上阶段 2 的改动；阶段 2 与本目录在同一个提交里入库。`after-sse/bundle-sha256.txt` 中的 8cd318f 是 WSL 快照，不是真实提交，它的 `src` 和 `tests` 与随后的阶段 2 提交相同。采集在 WSL slot e2 中、对 E 工作树的快照执行，端口 44852，2026-10-05。复审修正（见下文“复审修正”）改了流的上限和 bootstrap 回复，页面也多了一处比较，所以修正后重新采集了一次；本节的数字都来自这次重新采集。第一次采集（快照 6596e52）的截图结论和各场景请求次数与这次相同。

### 改了什么

服务端：

- 新增 `GET /api/real/core/changes`（`text/event-stream`）。它只推送“什么变了”的通知，不带数据；页面收到后仍然通过原来的 POST 路由重新读取。令牌头、Host 和 Origin 检查与其它路由相同。
- 通知有三个来源：RecordStore 的每次提交、协作 driver 的状态变化、命令句柄进入 stopping 或 settled。提交通知的 SSE `id` 就是提交游标（events 表的自增 id，形如 `c0000000081`）；driver 和命令的通知没有 id。
- 每 15 秒发一次心跳注释（`: hb`）；最多同时 4 条流（原因见“已知限制”），再多的页面收到 429，按退避重试，期间用原来的轮询；客户端不读而积压超过 64KB 的流会被结束，页面再用 `Last-Event-ID` 续上；Host 关闭时结束所有流。
- `GET bootstrap` 的回复多了 `changesHead`：Host 回复时变更源的头部游标。页面第一次收到 `ready` 时拿它比较，见下文“页面”。
- `Last-Event-ID` 续传：页面已经是最新的，回 `ready`；错过的提交还在最近 512 条之内，合并成一条 `change`；游标太旧、比头部还新或格式不对，回 `reset`。
- 命令输出没有单独的流：输出只在命令结束时才有，所以命令和其它通知共用一条通道，结束时发一条 settled 通知。
- 新增 `src/app/change-feed.ts`、`src/composition/commit-observer.ts`；修改 `src/app/` 下的 `server.ts`、`core-http-types.ts`、`core-routes.ts`、`host.ts`、`collaboration-driver.ts`、`workbench-tools.ts`，以及 `src/composition/create-platform.ts`。core 和 `vendor/coding-agent/dist` 没有改。

页面：

- 用 `fetch()` 加 `ReadableStream` 读这条流，因为 EventSource 不能带 `x-platform-token` 头。新增 `src/ui/api/sse.ts`（解析）和 `src/ui/api/live.ts`（连接）；重写 `src/ui/api/refresh.ts`，它仍是唯一启动计时器的地方。
- 流正常时不运行任何定时器：命令和 driver 的读取，只在收到对应句柄的通知后执行一次（50ms 去抖，同一时间最多一个读取）。
- 流还没连上、失败或者没有响应时，退回原来的 700ms 命令轮询和 1000ms driver 轮询。重连按 1、2、4、8、15 秒退避，每次都带 `Last-Event-ID`。连上以后停掉定时器，并把每个读取补跑一次。Host 返回 401、403、404、405 或 501 时不再重连，只保留原来的轮询。
- 页面隐藏时立即关闭流，读取和定时器全部停止；重新可见时马上带 `Last-Event-ID` 重连，并补读一次。
- 新增 `src/ui/state/change-refetch.ts`：收到涉及当前工作区项目 goals 或 tasks 的提交通知时，只重读已经显示的 Goal 详情和任务图（300ms 去抖）。
- 加载时的空档：页面的第一批读取（goals/read、tasks/query 等）和流的订阅走不同的连接，Host 可能先回答读取、后订阅流，中间的提交就收不到通知。所以页面第一次收到 `ready` 时，把它的游标和 bootstrap 的 `changesHead` 比较：更新，说明加载期间有提交，就把上面的 Goal 详情和任务图重读一次；相同则不读。这个比较只做一次。
- 视图层只改了两处调用：`views/execution/collaboration.ts` 和 `views/terminal/commands.ts`。另外 `main.ts` 在启动时打开连接，并传入 bootstrap 的 `changesHead`。连接状态存在 store 的 `connection` 里，界面不显示它。

采集脚本（只改证据脚本，before 的截图步骤不变）：

- `capture.mjs`：
  - changes 流照常记录，但不算“在途请求”，否则每张截图前都要等满 20 秒；
  - 轮询页通过 CDP（`Network.streamResourceContent`）读出流里的每一帧（ready、change、心跳），和请求一起记录；
  - 新增 fallback、fallbackAtLoad、hidden 三个场景，它们的浏览器控制台消息单独记在 polling.json 里；
  - 所有时间改用单调时钟，原因见下文“计时”；
  - P1 场景在 driver 进入 running 之后，先在“演示工程”停 1.5 秒再切换工作区，用来观察 driver 首批提交的通知。before 在这段时间里页面不发请求，切回后的 12 秒窗口也不受影响。
- `run-host.mjs`：收到 SIGUSR2 时销毁所有已打开的 changes 流的 socket，相当于流在中途断网，只用于 fallback 场景。这样做是因为 Playwright 的 route 只影响新请求，而 Chromium 的离线模拟（`context.setOffline`）断不开已经打开的本机流：探针中离线 17 秒，心跳照常到达。
- `capture.sh`：把 Host 的 pid 传给 capture.mjs；用 trap 保证任何退出都会停止 Host。

### 截图

用的是同一个 `capture.sh`、同一个种子、同一个 Chromium（153.0.8010.12）和同一组参数：`capture.sh after-sse 3`。

| 比较 | 结果 |
| --- | --- |
| after-sse 第 1 次运行与第 2、3 次 | 23/23 逐字节相同，逐像素差异为 0（`after-sse/determinism-run1-vs-run*.json`） |
| before 与 after-sse 的同名截图 | 23/23 逐字节相同，逐像素差异为 0。没有超出容差的文件，也没有疑似空白的截图（`after-sse/compare-before.json`） |
| `manifest.json` | 每张截图的步骤、哈希、Chromium 版本和参数都与 before 相同。只有 `fixedPageTime.pages` 从 6 变为 9，因为新增的三个场景各开了一个页面 |
| `seed-state.json` | 与 before 完全相同 |
| 截图和原有四个轮询场景中，浏览器控制台的 error 和 warning | 0 |

没有任何截图差异需要解释，这也符合预期：连接状态不显示在界面上；截图流程不写任何记录，其中唯一的命令 `cat README.md` 只产生一条命令通知，页面因此读取一次命令结果，最终显示与轮询时相同。

构建产物：index.html 和 styles.css 的哈希与 before 相同；main.js 变了，因为加了新的页面代码；views.js 与 after-split 相同（`ad376f9c…`），这次的改动不在它的导入范围内。

### 轮询与推送（after-sse/polling.json）

前四个场景与 before 相同（次数；间隔取中位数，括号内为最小到最大值）：

| 场景 | before | after-sse |
| --- | --- | --- |
| 空闲页面：加载阶段 | 10 个请求，769ms 内发完 | 11 个请求，753ms 内发完：before 的 10 个，加 1 个 `GET changes` |
| 空闲页面：加载后 30 秒 | 0 个请求 | 0 个请求。流一直开着，从加载到窗口结束收到 1 个 `ready` 和 2 次心跳，没有通知 |
| 命令 `sleep 8` | `commands/start` 1 次，`commands/read` 12 次，700ms（699–701），8851ms 时 settled | `commands/start` 1 次，`commands/read` **1 次**：8052ms 收到 settled 通知，17ms 后读取（近似值，见“计时”），8378ms 时页面显示 settled |
| 协作 driver 运行中，切走再切回，12 秒 | `driver-read` 13 次，1000ms（991–1001） | `driver-read` **1 次**（切回时立即读的那一次），之后 0 次。driver 被脚本模型阻塞，状态不变，所以没有通知；12 秒内只有 1 次心跳 |
| 上一场景继续，同时运行 `sleep 1` | start 1 次，read 2 次（700ms），driver-read 1 次 | start 1 次，read **1 次**（settled 通知后 31ms，近似值），driver-read **0 次** |

另外记录了 driver 启动后、切换工作区之前的 1.6 秒（`collaboration.afterDriverStart`）：

- 第 74–203ms 收到 10 条通知：4 条 driver 通知（没有 id），6 条提交通知（id `c0000000082` 到 `c0000000087`，涉及 executions、sessions、tasks）。
- 页面只发了 1 个请求：第 300ms 的 `goals/read`，即 tasks 提交触发的 Goal 详情重读。多条通知在 300ms 去抖内合并成了一次。
- 这段时间里还有 harness 自己发的 `driver-start` 1 次和 `driver-read` 1 次，记在 `harnessRequests`，不是页面的请求。

结论：正常连接时没有任何定时请求。命令和 driver 的读取只在对应句柄变化后各执行一次；提交只会让已显示的 Goal 重读。

### 断线时退回轮询，恢复后停止

两个新场景都用 Playwright 的 `page.route(..., route => route.abort())` 拦截 changes 路由。

**流中途断开（`fallback`）**：页面在跟随 P1 留下、仍在运行的 driver，并运行 `sleep 14`。1 秒后拦截 changes 路由，并让 Host 断开已打开的流（SIGUSR2）；再过 5 秒解除拦截。时间从点击“运行”算起：

| 阶段 | 时间 | 请求 |
| --- | --- | --- |
| 流正常 | 0–1098ms | 只有 `commands/start` 1 次 |
| 回退 | 1098–8052ms，共 6954ms | `commands/read` 10 次，700ms（698–703）；`driver-read` 7 次，1000ms（999–1002）；`GET changes` 3 次，断开后约 1 秒和 3 秒的两次被拦截，约 7 秒的一次成功 |
| 恢复 | 8052ms 起，共 9459ms | 重连请求带 `last-event-id: c0000000087`，收到同一游标的 `ready`。50ms 后补读 `driver-read` 1 次、`commands/read` 1 次，之后没有定时请求；14102ms 收到 settled 通知，52ms 后读 1 次 |

- 重连间隔是 1、2、4 秒。第 3 次重连落在解除拦截（6100ms）之后，所以在 8052ms 恢复。
- 按断开的标记推算，页面计时器的第一次触发早了约 60ms：断开后 640ms 第一次 `commands/read`，941ms 第一次 `driver-read`，942ms 第一次重连。第一次采集中早约 40ms（661ms、960ms）。不使用 `page.clock` 的单独探针中，第一次读取在断开后 704ms。原因没有查明，它不影响间隔。

**加载时就连不上（`fallbackAtLoad`）**：加载前拦截 changes 路由，运行 `sleep 8`，3 秒后解除拦截。时间从打开页面算起：

- 加载阶段的请求与 idle 相同（11 个），只是其中的 `GET changes` 被拦截。1040ms 和 3041ms 的重连也被拦截。期间 `commands/read` 按 700ms（698–702）轮询，共 8 次。
- 3855ms 解除拦截，下一次重连在 7041ms 成功。页面从没收到过游标，所以这次请求不带 `last-event-id`，收到 `ready`（`c0000000087`）。随后补读 `commands/read` 1 次（50ms 后）；因为断过线又无法续传，还重读了 1 次 Goal 详情（`goals/read`，298ms 后）。之后没有定时请求，8867ms 的 settled 通知到达后读 1 次。

### 页面隐藏（`hidden`）

无头浏览器的页面总是可见，所以用 init script 改写 `document.visibilityState`，再派发 `visibilitychange`。页面在跟随运行中的 driver，运行 `sleep 6` 后被设为 hidden 9 秒，命令在隐藏期间结束：

- 隐藏后 3ms，流以 `net::ERR_ABORTED` 结束。隐藏的 9019ms 内请求数为 0。
- 重新可见后 2ms 重连，请求带 `last-event-id: c0000000087`，收到 `ready`。约 20ms 后（近似值，见“计时”）补读 `driver-read` 1 次和 `commands/read` 1 次，命令随即显示 settled。之后没有定时请求。
- 对比：before 的两种轮询都不感知页面是否可见；现在页面隐藏时不发任何请求。

### 浏览器控制台

- 截图和原有四个轮询场景：error 和 warning 为 0（`manifest.json` 的 `consoleProblems`）。
- 新场景的控制台消息记在各自的 `console` 字段里，都是网络层的预期消息，没有页面错误：
  - `fallback`：1 条 `Failed to load resource: net::ERR_INCOMPLETE_CHUNKED_ENCODING`（Host 断开流），2 条 `net::ERR_FAILED`（被拦截的重连）；
  - `fallbackAtLoad`：3 条 `net::ERR_FAILED`；
  - `hidden`：没有。

### 计时

- 阶段 2 的 `capture.mjs` 所有时间都用单调时钟（`performance.now()`）；before 和 after-split 用的是墙钟（`Date.now()`）。
- 原因：WSL 的墙钟走得快，systemd-timesyncd 定期把它往回拨。在同一台机器上用 90 秒的探针对比两种时钟，墙钟在第 10.8、43.1、75.5 秒分别回拨了 714、750、684ms。用墙钟的一次试跑中，idle 窗口只有 29215ms，还有一个请求的时间早于前一个请求。
- 阶段 1 中 after-split 的空闲窗口只有 29602ms，很可能也是这个原因。
- 时钟只影响记录，不影响页面：页面里的计时器不依赖墙钟。
- 通知到读取请求之间的间隔：代码里命令和 driver 的读取有 50ms 去抖（`refresh.ts` 的 `POLL_DEBOUNCE_MS`），Goal 详情和任务图的重读有 300ms 去抖。上文中“通知后多少 ms 读取”的间隔都只是近似值，低于约 100ms 的尤其不能当真，有几处甚至短于去抖时间：50ms 去抖的读取记成 17ms、31ms，300ms 去抖的 `goals/read` 离第一条 tasks 通知只记了 226ms。原因应是测量本身：`page.clock` 接管页面计时器后，计时器会提前触发，与上文回退场景中第一次触发早约 40–60ms 是同一现象；CDP 记录流数据帧和记录请求的时间点也可能有偏差。请求次数和“正常连接时没有定时器”的结论不受影响。

### 检查

以下是复审修正之后的结果，2026-10-05：

- slot e1：`npm run typecheck`、`npm run check:architecture`、`npm run build` 通过。采集前在 slot e2 又跑了一遍，也通过。
- 页面相关测试、新增测试和改到的 Host 测试（slot e1，19 个文件）：settings-ui、session-rendering、R6-workbench、MVP-ui-entry、ui-store、ui-actions、goal-conversation-start、ui-sse、ui-refresh、ui-live、ui-change-refetch、ui-live-wiring、change-feed、change-stream、change-commit-observer、change-emitters、R6-host、host-settings、MVP-workbench-tools，共 181 项全部通过。
- 全量测试 `~/cc-work/with-usr-bin-node.sh npm test`（slot e1，与采集分开运行）：164 个文件、4567 项全部通过，没有跳过，用时 403 秒。
- 阶段 1 结束时是 155 个文件、4484 项。多出的 9 个文件、83 项都是阶段 2 新增的测试：服务端 `change-feed` 8 项、`change-stream` 11 项、`change-commit-observer` 5 项、`change-emitters` 7 项（共 31 项），页面 `ui-sse` 11 项、`ui-refresh` 11 项、`ui-live` 18 项、`ui-change-refetch` 5 项、`ui-live-wiring` 7 项（共 52 项），另有测试辅助文件 `tests/helpers/change-stream-reader.ts`。已有测试文件都没有改。
- AG2b-collaboration 在服务端那一步的局部运行中有 2 项超时（30 秒），在 759e6a2 未改动的源码上也同样超时；复审前后两次全量中它都全部通过。

### 复审修正

复审提出 6 条意见，全部采纳：

1. 视图和 `main.ts` 接到流上的方式没有自动测试。新增 `tests/app/ui-live-wiring.test.ts`（7 项），不需要 DOM：用页面真实的 refresh hub、替换 fetch、假计时器，调用 `startCommand`、`stopCommand`、`beginCollaborationPoll`，再投递通知。检查：匹配的命令或 driver 通知在 50ms 后正好读 1 次；commandId、Goal 或工作区不同的通知不读；`commands/start` 还没返回时到达的 settled 通知，在 start 回复处理后仍会读 1 次；会启动读取的 `commands/stop` 也一样；流断开时是原来的 700ms 和 1000ms 轮询，流恢复后停止。`main.ts` 用源码检查：`main()` 在空 bootstrap 提前返回之前调用了 `startLiveUpdates(…, bootstrap.changesHead)` 和 `watchRecordChanges()`。
2. driver 有三个通知点没有测试。`change-emitters` 加了 3 项：多步推进时第二步还没返回，已经通知了第一步的 `last`；只观察已开始的 Run 时，长时间的 advance 返回之前就通知了“only observing the original facts”；咨询开始前先通知 `waiting_for_reply`（咨询卡在第一个端口调用上）。
3. 积压上限和心跳清理没有测试。积压上限改成服务端选项 `maxChangeStreamBacklogBytes`（默认仍是 64KB）。`change-stream` 加了 2 项：一个只发 GET、从不读取的原始 socket，在一串大通知之后流被结束，订阅数回到 0；客户端断开后，这条流的心跳计时器被 `clearInterval`。
4. 浏览器 6 个连接是同一浏览器配置下所有标签页共用的，不是每个标签页各 6 个。流的默认上限从 8 降到 4，至少留 2 个连接给普通请求；“已知限制”补了一条说明。
5. 有几处“通知后多少 ms 读取”小于 50ms 去抖，不可能是页面的真实延迟。“计时”补了一条说明：低于约 100ms 的间隔只是近似值。
6. 页面第一批读取和流的订阅之间有空档，期间的提交会漏掉。采用第一种办法：bootstrap 回复带上变更源头部 `changesHead`，页面第一次收到 `ready` 时比较，游标更新才重读一次 Goal 详情和任务图（`ui-live` 加了 2 项，`change-stream` 加了 1 项）。正常加载时 Host 没有提交，所以加载阶段的请求仍是 11 个。

变异检查（slot e1，每次只改一处，跑对应的测试文件）：14 个变异全部被测出，包括复审列出的全部变异：driver 主题的 goalId 写错、命令主题的 commandId 写错、`noticeMark()` 移到 `commands/start` 之后、`noticeMark()` 移到 `commands/stop` 之后、删除 `startLiveUpdates(...)`、删除 `watchRecordChanges()`、删除 driver 的三个通知点（循环开头、`runWithPump`、咨询之前）、删除积压上限、删除 `clearInterval(heartbeat)`、bootstrap 不带头部游标、首次 `ready` 不比较，以及比较不止做一次。

### 已知限制

- 其它进程直接写账本时，页面收不到通知。
- Kernel 的会话记录增长不发通知，只有 Run 的开始和结束（通过提交）会发。
- driver 将来如果在已埋点的位置之外改变状态，需要补发一次通知。
- Host 重启后令牌会变，页面需要刷新，这与之前相同。
- Host 的本机监听是普通 HTTP/1.1，没有 HTTP/2 多路复用。浏览器对同一主机最多开 6 个连接，同一浏览器配置下的所有标签页和窗口共用这 6 个，不是每个标签页各 6 个。每个可见页面的流占住 1 个，所以流的上限定为 4，至少留 2 个给普通请求；第 5 个及以后的可见页面收到 429，退回原来的轮询并按退避重试。隐藏的页面会关闭自己的流，不占名额。
- 只在同一台机器、同一个 Chromium 1243 上采集。

## 复跑方法

在 WSL 中、仓库根目录下执行（需要 Node 24，不需要真实模型密钥）：

```bash
npm run build
bash docs/refactor/reviews/evidence/ui-split-sse-2026-10-04/capture.sh before 3   # 阶段 1 结束时用 after-split，阶段 2 结束时用 after-sse
node docs/refactor/reviews/evidence/ui-split-sse-2026-10-04/compare.mjs <dirA> <dirB>  # 需先设 PLAYWRIGHT_DIR，capture.sh 会打印
```

例如阶段 1 的比较是 `compare.mjs <证据目录>/before <证据目录>/after-split > <证据目录>/after-split/compare-before.json`，阶段 2 的比较是 `compare.mjs <证据目录>/before <证据目录>/after-sse > <证据目录>/after-sse/compare-before.json`。入库的两个 compare-before.json 把 summary 里的 dirA、dirB 改成了相对目录名。

- 端口默认是 44851，可以用 `PORT` 修改，但不要用 44797。
- `capture.sh` 会打印临时目录，两次运行的完整产物保留在那里。
- 只想看 Host 时，可以单独运行 `node run-host.mjs --dir <空临时目录> --port 44851`：stdout 打印就绪 JSON 和地址，停止用 Ctrl+C 或 SIGTERM。
- fallback 场景需要 Host 的 pid，`capture.sh` 会自动传入。单独运行 `capture.mjs` 而不加 `--host-pid` 时，这个场景记为 skipped。
- 阶段 1 是在 WSL 的 slot e1 中执行的，阶段 2 的采集在 slot e2 中（`PORT=44852`），都是对 E 工作树的快照执行。

## 待后续批次

- 阶段 1（拆分）已完成并验证，结果见上文。
- 阶段 2（SSE）已验证，结果见上文。阶段 2 的改动和本目录在同一个提交里入库。
- 任务书收尾项（HANDOFF、IMPLEMENTED-CAPABILITIES、UI-WORKBENCH 中关于轮询的描述）留到批次收尾时更新。
- 本批没有推送。
