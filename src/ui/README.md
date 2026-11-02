# src/ui/：画板运行时和第一块接后端的页面

这一层把 `docs/ui-reference/workbench-2026-10/*.dc.html` 跑起来：读画板自己的模板和逻辑脚本，用画板自带的示例数据渲染，交给现有 Host 的静态目录。十块画板里只有 `TaskMap` 有工作副本（`src/ui/boards/TaskMap.dc.html`），其余九块仍按冻结原件构建（E3-2 裁定 1）。`TaskMap` 是唯一接后端的一页：`boot.ts` 读平台令牌，经 `host-client.ts` 走同源路由，经 `adapters/task-map.ts` 转成 `props.data`；没有令牌时照旧用示例数据（裁定 3、4、6、7、8）。

## 文件

| 文件 | 负责什么 |
| --- | --- |
| `template.ts` | 解析模板体：元素/文本/属性、`sc-if`、`sc-for`、`{{dot.path}}` 洞、事件属性、`ref`；`holePath`（`template.ts:41`）取单洞，`isEventAttribute` 判事件属性；统计 §1.5 的指令/洞/事件数，遇到不认识的 `sc-*` 就报错。 |
| `board.ts` | `parseBoard`（整份 `.dc.html`）和 `parseBoardParts`（各部分）：取出 `<helmet>`、模板、`data-dc-script` 逻辑和 `data-props` 默认值；浏览器入口和测试共用。 |
| `render.ts` | `renderBoardTemplate`：在根作用域和 `sc-for` 循环作用域上求值模板，得到可在 Node 里检查的渲染树，并接线事件/`ref` 绑定。缺失的点号路径渲染为空串（画板上没有 `undefined` 兜底）。 |
| `runtime.ts` | `DCLogic` 基类（`props`/`state`/浅合并 `setState`/`componentDidUpdate`）、`BoardView`（编译逻辑脚本、`render`、`updateProps`、浏览器 `mount`、按模板位置定键就地更新、事件与 `ref` 接线）；`domEventName` 把模板的事件属性换成浏览器派发的名字，`value` 写属性，`checked`/`disabled` 走同一处布尔属性写入。 |
| `host-client.ts` | 浏览器调 Host 的唯一出口：`PLATFORM_TOKEN_META_NAME`、`readPlatformToken`（从令牌 meta 读，空串算没有）、`createHostClient`（同源 `POST /api/real/core/<route>` 和 `GET bootstrap`，令牌进 `x-platform-token` 头）、`readyRouteValue`（读取只在 `ready` 时取值；失败抛 `RouteReadError`，带路由、码/状态和 `reason`）、`fetchPageText`（取页面原文）；`CoreScope`、`RouteReply`、`BootstrapReply` 是路由的结构类型。HTTP 状态和返回体的 `status` 都检查。 |
| `values.ts` | `asRecord` / `asText`：`boot.ts` 和纯适配层共用的 JSON 值守卫；不碰 DOM、网络或 `src/app`。 |
| `adapters/task-map.ts` | 纯适配：`adaptTaskMap` 把 `goals/read`、`goals/display` 和 `tasks/query` 的值转成 `TaskMapData`；Goal 的状态词和方格来自展示状态；不碰 DOM、不碰网络、不引用 `src/app`。 |
| `boot.ts` | 浏览器入口 `bootBoardPage`（`boot.ts:16`）：等 `DOMContentLoaded`，取 `x-dc` 根，`fetchPageText(location.href)` 读原始 `.dc.html` 并交给 `parseBoard`（浏览器会把属性名改成小写，不能读 `innerHTML`）；把 `<helmet>` 提到 `<head>`，挂载 `BoardView`；打包成 `support.js`。有令牌且页面在 `BOARD_READERS`（目前只有 `TaskMap`）时挂载后调用一次 `readTaskMap`，再用 `updateProps` 传入完整 props；没有令牌或不在表里的板照旧挂载示例数据。读取失败时按 `RouteReadError` 的码查 `READ_ERROR_TEXT` 给页面文字，原始路由、码和 `reason` 只进 `console.error`，页面仍走 `readState: error` 和重试。 |

## 可复用的能力

- `parseTemplate` / `parseBoard` / `parseBoardParts` / `holePath` / `isEventAttribute`：只读解析，不依赖 DOM。
- `renderBoardTemplate`：纯模板求值。
- `DCLogic` / `BoardView` / `bootBoardPage`：一块画板的实例、更新、挂载和浏览器入口。
- `asRecord` / `asText`：路由 JSON 边界上共用的值守卫。
- `readPlatformToken` / `createHostClient` / `readyRouteValue` / `RouteReadError` / `fetchPageText` / `readTaskMap` / `adaptTaskMap`：从页面令牌到真实 `TaskMap` 数据的读取链；测试可以只拿 `adaptTaskMap` 做纯转换。

## 边界

- `docs/ui-reference/workbench-2026-10/` 的十块画板是冻结原型（决定 35），这一层只读、不改写；`src/ui/boards/` 只有 `TaskMap` 一份工作副本。
- 模板语义只实现这十块画板真正用到的部分：点号路径、`sc-if`、`sc-for`、属性洞、15 种 DOM 事件属性、`ref`；没有 `sc-else`、`slot`、列表 key 或表达式。
- `setState` 是浅合并；每次提交（`setState` 和 `updateProps`）先渲染、就地更新 DOM、跑完 `ref`，再调 `componentDidUpdate(prev)`（上一份 props）。钩子里的 `setState` 走普通路径再提交一次；画板按 props 比较，所以会停（§1.1.4）。
- 浏览器里每个节点按模板位置定键（`sc-if`/`sc-for` 的子节点带自己的前缀），每次提交按这个键就地更新：条件块插入时同一元素保留身份和焦点，每种事件只注册一个分发函数，`value` 写属性，`checked`/`disabled` 只在 `true` 时保留属性；这够本地单页看画板用。
- 只有 `host-client.ts` 碰 `fetch`；平台令牌只从页面 meta 读，进请求头，不进 URL、不写日志、不进构建产物。没有令牌时 `bootBoardPage` 不读任何核心路由，行为与 E3-1 的页面一致（裁定 4、E32-5）。
- 外部资源只有 Google Fonts；`./support.js`、`./kit.css` 和十块画板由 `scripts/build-ui.mjs` 放进 `dist/app/public/workbench/`，由 Host 现有 `publicDir` 提供。
- 十块画板的清单、Node 侧读取和渲染树序列化只在 `tests/ui/helpers/` 里，不进运行时。

## 怎么跑

```sh
npm run build          # tsc，然后打包 support.js 并复制画板
node dist/app/main.js <workbench-config.json>
```

打开 Host 打印的 `/workbench/` 地址，入口页列出十块画板。测试用 `npx vitest run tests/ui --maxWorkers=2`。
