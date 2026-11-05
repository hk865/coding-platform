# src/ui/：画板运行时和第一块接后端的页面

这一层把 `docs/ui-reference/workbench-2026-10/*.dc.html` 跑起来：读画板自己的模板和逻辑脚本，用画板自带的示例数据渲染，交给现有 Host 的静态目录。十块画板里只有 `TaskMap` 有工作副本（`src/ui/boards/TaskMap.dc.html`），其余九块仍按冻结原件构建（E3-2 裁定 1）。`TaskMap` 是唯一接后端的一页：`boot.ts` 读平台令牌，经 `host-client.ts` 走同源路由，经 `adapters/task-map.ts` 转成 `props.data`；没有令牌时任务图只显示空壳（“这个项目还没有目标。”，工作副本不带示例数据），另外九块照旧用示例数据（裁定 3、4、6、7、8）。

## 文件

| 文件 | 负责什么 |
| --- | --- |
| `template.ts` | 解析模板体：元素/文本/属性、`sc-if`、`sc-for`、`{{dot.path}}` 洞、事件属性、`ref`；`holePath`（`template.ts:41`）取单洞，`isEventAttribute` 判事件属性；统计 §1.5 的指令/洞/事件数，遇到不认识的 `sc-*` 就报错。 |
| `board.ts` | `parseBoard`（整份 `.dc.html`）和 `parseBoardParts`（各部分）：取出 `<helmet>`、模板、`data-dc-script` 逻辑和 `data-props` 默认值；浏览器入口和测试共用。 |
| `render.ts` | `renderBoardTemplate`：在根作用域和 `sc-for` 循环作用域上求值模板，得到可在 Node 里检查的渲染树，并接线事件/`ref` 绑定。缺失的点号路径渲染为空串（画板上没有 `undefined` 兜底）。 |
| `runtime.ts` | `DCLogic` 基类（`props`/`state`/浅合并 `setState`/`componentDidUpdate`）、`BoardView`（编译逻辑脚本、`render`、`updateProps`、浏览器 `mount`、按模板位置定键就地更新、事件与 `ref` 接线）；`domEventName` 把模板的事件属性换成浏览器派发的名字，`value` 写属性，`checked`/`disabled` 走同一处布尔属性写入。 |
| `host-client.ts` | 浏览器调 Host 的唯一出口：`PLATFORM_TOKEN_META_NAME`、`readPlatformToken`（从文档的令牌 meta 读，空串算没有）、`readPlatformTokenText`（从页面原文读同一个 meta，重连时用来取 Host 新令牌）、`createHostClient`（同源 `POST /api/real/core/<route>` 和 `GET bootstrap`，令牌进 `x-platform-token` 头）、`readyRouteValue`（读取只在 `ready` 时取值；失败抛 `RouteReadError`，带路由、码/状态和 `reason`）、`committedRouteValue`（写结果只在 `committed` 时取值）、`fetchPageText`（取页面原文）；`CoreScope`、`RouteReply`、`BootstrapReply` 是路由的结构类型。HTTP 状态和返回体的 `status` 都检查。 |
| `refresh.ts` | 自动刷新环：`createAutoRefresh` 拿「读一次」和「发布结果」，合并通知、串行重读、每次连接成功补读一次、断连 2 秒重连、已有数据时重读失败 2 秒后再读（不设上限，同一时刻一个计时器）；不碰 DOM、不认板名。 |
| `values.ts` | `asRecord` / `asText`：`boot.ts` 和纯适配层共用的 JSON 值守卫；不碰 DOM、网络或 `src/app`。 |
| `adapters/task-map.ts` | 纯适配：`adaptTaskMap` 把 `goals/read`、`goals/display`、`tasks/query` 和每次通知的 `lines/list`/`graph/hover` 值转成 `TaskMapData`（含真实 DAG 的节点、边、阶段、未排定带、真实门、关键路径）；`taskMapStatesAt` 按时间线取历史状态（段由一次执行的结束打开时，带那条执行横条的键，回放的停止原因取那条横条的原因）；`adaptTaskMapTime` 把 `activity/track` 的 Work/check/Query 横条、`lines/list` 行和 `tasks/timeline` 转成一条线一行的轨道（含接续 Session），只保留真实 result、`ordinal`、pauses、执行横条的 `reason`（原文，不截）、执行横条的尝试序号和重新入队的来由（类别、目标恢复、时刻、中断时是暂停还是在跑；序号只取 Host 给的，第 2 次起才写“第 n 次尝试”）、Host 重启近似标记；`adaptTaskMapDecisionCards` 把这个目标的 `decisions/queue` 回复转成“需要关注”里的“需要你决定 n 张卡”（分页前的 `counts.waitingAnswer`；只有卡的来源不可用才写“至少”，通知类别不可用不算），0 或读不到就是 `null`；Goal 的状态词和方格来自展示状态，“目标 n”只取 `goals/read` 的 `ordinal`（是数字才用，不从目标列表数）；不碰 DOM、不碰网络、不引用 `src/app`。 |
| `boot.ts` | 浏览器入口 `bootBoardPage`（`boot.ts:66`）：等 `DOMContentLoaded`，取 `x-dc` 根，`fetchPageText(location.href)` 读原始 `.dc.html` 并交给 `parseBoard`（浏览器会把属性名改成小写，不能读 `innerHTML`）；把 `<helmet>` 提到 `<head>`，挂载 `BoardView`；打包成 `support.js`。有令牌且页面在 `BOARD_READERS`（目前只有 `TaskMap`）时把 `readTaskMap`（返回 `{data, cursor}`，`cursor` 是这次读的 bootstrap `changesHead`）、`createAutoRefresh` 的发布和 `subscribeChanges` 接成一条自动刷新环：通知后合并重读、`dataVersion` 递增、断连显示 `barWhy`（Host 以 429 拒绝时写页面太多的那句）并在 2 秒后重连重读（重连先重取页面原文里的令牌并重建客户端，再读和订阅）；没有令牌或不在表里的板照旧按画板默认值挂载：任务图显示空壳，另外九块是示例数据。读取失败时按 `RouteReadError` 的码查 `READ_ERROR_TEXT` 给页面文字，原始路由、码和 `reason` 只进 `console.error`；第一次读失败走 `readState: error` 和重试且不订阅，已有数据时保留数据；有计划时在 `graph/hover` 之后读一次这个目标的 `decisions/queue`（`sections: ['waiting_answer']`、`page.limit: 1`），读不到只是不显示那一项、不报错；`pinTaskMapLine` 是页面层的固定写入口。读和固定写的范围只由 `taskMapScope` 定：不带 `goal` 是第一个工作区；带 `goal` 时按项目各用它的第一个工作区读 `goals/read`，第一个 `ready` 的项目就是范围（决定 104-1：项目内的读不受工作区限制），都 `not_found` 仍是“找不到这个目标。”。 |

## 可复用的能力

- `parseTemplate` / `parseBoard` / `parseBoardParts` / `holePath` / `isEventAttribute`：只读解析，不依赖 DOM。
- `renderBoardTemplate`：纯模板求值。
- `DCLogic` / `BoardView` / `bootBoardPage`：一块画板的实例、更新、挂载和浏览器入口。
- `asRecord` / `asText`：路由 JSON 边界上共用的值守卫。
- `readPlatformToken` / `readPlatformTokenText` / `createHostClient` / `readyRouteValue` / `RouteReadError` / `fetchPageText` / `readTaskMap` / `adaptTaskMap` / `taskMapStatesAt` / `adaptTaskMapTime`：从页面令牌到真实 `TaskMap` 数据的读取链；`subscribeChanges` / `createAutoRefresh` 是变更流和自动刷新环；测试可以只拿 `adaptTaskMap` 做纯转换。

## 边界

- `docs/ui-reference/workbench-2026-10/` 的十块画板是冻结原型（决定 35），这一层只读、不改写；`src/ui/boards/` 只有 `TaskMap` 一份工作副本。
- 模板语义只实现这十块画板真正用到的部分：点号路径、`sc-if`、`sc-for`、属性洞、15 种 DOM 事件属性、`ref`；没有 `sc-else`、`slot`、列表 key 或表达式。
- `setState` 是浅合并；每次提交（`setState` 和 `updateProps`）先渲染、就地更新 DOM、跑完 `ref`，再调 `componentDidUpdate(prev)`（上一份 props）。钩子里的 `setState` 走普通路径再提交一次；画板按 props 比较，所以会停（§1.1.4）。
- 浏览器里每个节点按模板位置定键（`sc-if`/`sc-for` 的子节点带自己的前缀），每次提交按这个键就地更新：条件块插入时同一元素保留身份和焦点，每种事件只注册一个分发函数，`value` 写属性，`checked`/`disabled` 只在 `true` 时保留属性；这够本地单页看画板用。
- 只有 `host-client.ts` 碰 `fetch`；平台令牌只从页面 meta 读，进请求头，不进 URL、不写日志、不进构建产物。没有令牌时 `bootBoardPage` 不读任何核心路由：任务图显示空壳，另外九块和 E3-1 的页面一致，用示例数据（裁定 4、E32-5）。
- 外部资源只有 Google Fonts；`./support.js`、`./kit.css` 和十块画板由 `scripts/build-ui.mjs` 放进 `dist/app/public/workbench/`，由 Host 现有 `publicDir` 提供。
- 十块画板的清单、Node 侧读取和渲染树序列化只在 `tests/ui/helpers/` 里，不进运行时。

## 怎么跑

```sh
npm run build          # tsc，然后打包 support.js 并复制画板
node dist/app/main.js <workbench-config.json>
```

打开 Host 打印的 `/workbench/` 地址，入口页列出十块画板。测试用 `npx vitest run tests/ui --maxWorkers=2`。

- E34 的轨道读：打开轨道后 `readMore({track:true})` 让 `boot` 按 `cursor → next` 读完 `activity/track`（无过滤的 Work/check，再按 ≤33 个唯一 `chainSessions` 分批读 Query，按 `queryRunRef` 去重），并按完整页读 `executions/list`（每页 100）；首次回放读 `tasks/timeline`（每页 200 个 Task），归档展开读 `lines/archived`，选中线读 `lines/read`。这些读取走同一个刷新环，不另开轮询；打开的轨道在每次通知后重读当前窗口。
- E34 的日历读：打开轨道时 `boot` 按浏览器 IANA 时区读 `activity/calendar`；小时窗 ≤14 天（与板的 14 天长历阈值同一判断）、日窗 ≤400 天、没有游标，更长范围拆窗，全部窗都读完才算完整；任一窗失败走既有 stale/失败路径，不当空日历。日/小时身份只用返回的 `localDate/localHour/startAt/endAt`。
- E34 的详情和第一个写动作：`adaptTaskMapDetail` 只把已读的 `graph/detail` summary/participants/risks（risks 成“重叠”，最多 6 个）、可选完整计数、正式目录（计划模块和实际文件的分组；计划只记到模块，所以实际文件按它的模块对计划：既不是计划模块、也不在计划模块下面的标“不在计划里”，计划没有模块时不标）、`files/uncommitted` 的值（实际文件的加减行和“未提交”，E3-7）和任务行的 `dispositionChange`（处置句，计划时间取那一版的 `acceptedAt`）、`attemptOrdinal`（负责是一条线时接“第 n 次尝试”，“未分配”不接）转成详情；`boot` 在选中节点时经 `props.actions.readMore` 读它，读详情时再按实际文件的路径读 `files/uncommitted`，读失败只是不写数，`host-client.write` 发 `{scope,request:{input,meta}}`，`pinLine` 先读 `workspaces/registration` 再提交 `lines/pin`，结果只看 `committed`（裁定 7）。
