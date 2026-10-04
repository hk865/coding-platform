# 任务 E：前端拆分与 SSE · 2026-10-04

本目录是任务 E 的截图与轮询证据，目前有两部分：

- 重构前（before）的基线。采集时没有改任何产品文件。
- 阶段 1（拆分 `src/ui`，不改行为）结束时的验证（after-split）。结果见下文“阶段 1 拆分验证”。

阶段 2（SSE 替代轮询）还没做，所以 `after/` 目录现在还不存在。

## 本批范围

- 截图使用的是一个不调用模型的本机 Host，跑在隔离的临时工程上。它启动的是构建产物里真实的 `dist/app/host.js`，并且走 CLI 同一个启动文件解析路径 `loadWorkbenchCliConfig`。所有业务事实只通过公开的 `/api/real/core/*` 路由写入。
- Host 的 provider 注册表里只有一个本地脚本客户端，写法和 `tests/helpers/AG2b-collaboration-fixture.ts` 相同。它的 base URL 是 `https://invalid.test`，不会打开任何网络连接。真实模型调用次数为 0；脚本回复的次数见 `before/seed-state.json` 的 `scriptedCalls`（工作 6 次、查询 2 次）。
- before 的产品源码固定在 E 工作树的基线提交 215d7ed（未修改），先 `npm run build`，再由 Host 提供 `dist/app/public/workbench` 的现有构建产物。具体对应关系见 `before/bundle-sha256.txt`；其中的 99f45c2 是 WSL 快照，不是真实提交，它的树与 215d7ed 相同。after-split 的源码见下文“阶段 1 拆分验证”。
- 没有新增依赖。Playwright 只通过 `npx -p playwright@1.63.0` 在 WSL 里使用（它自带的 chromium 版本 1243 与已缓存的浏览器一致），不写进 package.json，两个锁文件保持不变。

## 文件

| 文件 | 作用 |
| --- | --- |
| `run-host.mjs` | 确定性 Host：建隔离工程，用固定种子写入数据，然后一直服务，直到收到 SIGTERM。 |
| `capture.mjs` | Playwright 截图，加 `--polling` 时还会记录轮询。 |
| `compare.mjs` | 逐像素比较两个截图目录。不依赖图片库，PNG 由同一个 Chromium 的 canvas 解码。以后也用它做 before 与 after 的对比。 |
| `capture.sh` | 一键执行：按次数分别启动 Host、截图、停止，然后比较各次结果，并把第 1 次的结果复制到 `<label>/`。 |
| `before/*.png` | 23 张基线截图，清单见下文和 `before/manifest.json`。 |
| `before/polling.json` | 当前轮询的实测记录。 |
| `before/determinism-run1-vs-run2.json`、`-run3.json` | 第 1 次运行分别与第 2、3 次独立运行（各自重新播种）的逐像素比较结果。 |
| `before/seed-state.json` | 种子结果：Goal、Task 阶段、Session、workflow 推进记录、虚拟时钟等。 |
| `before/bundle-sha256.txt` | 截图时所用构建产物的哈希，以及源码提交。 |
| `after-split/*.png`、`manifest.json`、`polling.json`、`seed-state.json`、`bundle-sha256.txt`、`determinism-run1-vs-run*.json` | 拆分完成后用同一脚本、同一种子采集的结果，文件含义与 `before/` 中的同名文件相同。 |
| `after-split/compare-before.json` | `before/` 与 `after-split/` 同名截图的逐像素比较。 |
| `after-split/polling-recheck.json` | 在同一棵树上另做一次独立运行（1 次）得到的轮询记录，用来复核空闲窗口。 |
| `after-split/src-ui-sizes.txt` | 拆分后 `src/ui` 下每个文件的行数（`wc -l`）。 |

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

## 复跑方法

在 WSL 中、仓库根目录下执行（需要 Node 24，不需要真实模型密钥）：

```bash
npm run build
bash docs/refactor/reviews/evidence/ui-split-sse-2026-10-04/capture.sh before 3   # 阶段 1 结束时用 after-split，阶段 2 结束时用 after
node docs/refactor/reviews/evidence/ui-split-sse-2026-10-04/compare.mjs <dirA> <dirB>  # 需先设 PLAYWRIGHT_DIR，capture.sh 会打印
```

例如阶段 1 的比较是 `compare.mjs <证据目录>/before <证据目录>/after-split > <证据目录>/after-split/compare-before.json`。

- 端口默认是 44851，可以用 `PORT` 修改，但不要用 44797。
- `capture.sh` 会打印临时目录，两次运行的完整产物保留在那里。
- 只想看 Host 时，可以单独运行 `node run-host.mjs --dir <空临时目录> --port 44851`：stdout 打印就绪 JSON 和地址，停止用 Ctrl+C 或 SIGTERM。
- 本批是在 WSL 的 slot e1 中，对 E 工作树的快照执行的。

## 待后续批次

- 阶段 1（拆分）已完成并验证，结果见上文。
- 阶段 2 的 SSE 完成后，用同一个种子执行 `capture.sh after 3`。然后对 before 和 after 的同名截图运行 `compare.mjs`，逐项说明差异：预期内的差异写明原因，预期外的差异要修复。
- after 中的 polling.json 应该显示：正常情况下没有定时轮询请求；断线时退回轮询，恢复后停止。阶段 2 的改动从 `src/ui/api/refresh.ts` 开始。
- 阶段 2 的结论之后再补。本批没有推送。
