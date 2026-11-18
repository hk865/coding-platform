# 015 联合参数错误：展开问题最少的那种写法，几种一样少时都列出来，不取第一种

状态：采用（第二十二批 R6，决定 121-149）
日期：2026-11-18

## 背景和约束

- G6 第十一次，模型调工具填错参数时，常常只拿到一句 `工具参数不符合 schema：(根): Invalid input`，只能乱试（`look_graph` 被拒 61 次，分类见 `D:/cc-lead-notes/impl/g6r11/diag-walls.md:147-161`；lead 诊断平台第 6 项 `docs/refactor/reviews/evidence/slice9-rerun11-2026-11-18/lead-diagnosis.md:236-243`）。
- 原因有两层：
  - Kernel 发给模型的 schema 是拍平的。模型接口要求工具参数的根是 `type: "object"`（决定 96-1），Kernel 把联合的各写法并成一个对象，必填只留所有写法都要的字段（`vendor/coding-agent/dist/tools/registry/tool-registry.js:59-60`）。`look_graph` 五种写法没有一个共同必填，拍平后一个必填都不剩，模型看不出哪个字段属于哪种写法。
  - zod 4.4.3 在联合的各写法都不中时只给一条 `invalid_union`，消息是 “Invalid input”；每种写法差在哪，在这条的 `errors` 里。
- 拍平不改：根必须是对象，怎么拍都会丢“每种写法各自的必填”；改它要新加受管源，还会改每个工具发给模型的 schema。所以只在派发器补报错（受管补丁 `vendor/coding-agent/patches/tools/dispatcher/tool-dispatcher.ts`，只经 `scripts/build-kernel-patch.mjs` 生成，根 AGENTS 第 6 条）。
- 已定的：遇到 `invalid_union` 就展开问题最少的那种写法，路径接上外层，选中的写法里再有联合照样往下展开；判别值对不上时 zod 自带的消息已经列出可选值，原样打。要定的只剩一件：几种写法的问题一样少时怎么办。

## 选项

| 选项 | 怎么做 | 好处 | 坏处 |
|---|---|---|---|
| 甲. 取第一种（冻结稿 Q-a2 的原推荐） | 并列时按 zod 给的写法顺序取第一种 | 消息最短；撞得最多的几类（`look_graph` 缺 `mode`、`limit` 放顶层）都有唯一最少的写法，用不上这一步 | 并列时“第一种”只是 schema 里的书写顺序，和模型想写的是哪种无关。检查的 `taskIds` 是 `'all'` 和数组的联合（`src/core/agent-runtime/answer-tools.ts:495`），模型写成 `"t1"` 时两种写法各差一条；取第一种就只告诉它“应为 `"all"`”，照改就悄悄把检查扩到全部任务。E05 停死就出在一条 `"all"` 的检查上 |
| **乙. 并列的都列出来，用“ 或 ”隔开（选）** | 先算各写法的问题数，取最少的那几种；只有一种时照旧逐条列，几种时每种的问题用“; ”连成一段，段之间用“ 或 ” | 不替模型挑写法，模型看得到每种写法各差什么，自己选它本来想写的那种 | 消息变长；最外层的问题之间也用“; ”，形如“A; B 或 C; D”，层次不太明显 |

## 选了什么，为什么

- **选乙。** 甲的毛病不在少见的写法上，而在检查的 `taskIds` 这种常见字段上：它会把模型引向一个能通过校验、意思却错了的值，错误不会再报出来。乙最坏只是消息长一点。
- 这一条是多视角只读审查推演出来的（`taskIds` 写成字符串的情形没有在 G6 里实际撞到），lead 收下后改判 Q-a2（`D:/cc-lead-notes/impl/s7d2/close-todo.md` 11-18 的 R6 三视角审查一条）。冻结稿原来把“并列都列”记在“以后”。
- 写法见 `vendor/coding-agent/patches/tools/dispatcher/tool-dispatcher.ts:262-271`（`issueLines`；并列在 `:266-268`）。补丁构建开着 `noUncheckedIndexedAccess`，所以先把每种写法展开、只有一种时 `flat()`，不按下标取。

## 代价，以及因此要守的规矩

- 并列时消息变长，层次靠“ 或 ”分开，读起来一般；合并方核过，lead 照收。
- 错误码 `invalid_arguments`、消息框架 `工具参数不符合 schema：…`、`retryable` 都不变；`dist/tools/dispatcher/tool-dispatcher.d.ts` 逐字不变。
- 这一层只管报错，不放宽校验：严格对象多一个键照旧拒。
- 守这一步的测试是 `tests/contracts/R6-tool-walls.test.ts` 的 A3（`look_graph {runRef, page}` 在审阅轮里 node 写法和记忆写法各差两条，期望两段都在）。改回“取第一种”时只有 A3 红。

## 什么情况变了要重新考虑

- 真实运行里，并列的长消息让模型反复改错（同一次调用连续被拒、每次换一种写法）：考虑在并列时只列和模型已写的键重合最多的那几种。
- Kernel 的拍平改成按写法给提示，或者把 `look_graph` 拆成每种 mode 一个工具：模型从 schema 就能看出写法，这一层的展开可以简化。
- zod 升级后 `invalid_union` 的 `errors` 形状变了：重核 `issueLines`。

## 来源

- lead 诊断 `docs/refactor/reviews/evidence/slice9-rerun11-2026-11-18/lead-diagnosis.md:236-243`（平台第 6 项）、`:297-301`（提示词第 4 项）。
- R6 冻结稿 `D:/cc-lead-notes/impl/n1118/g6fix/r6-tool-walls-frozen.md` 第一、二节和“lead 裁定”第 1、2 条；合并方回复 `r6m-reply.md` 的“lead 补充裁定后”。
- 决定 96-1（工具 schema 根必须是对象）、98-1（派发器补丁的来历和证据做法）、121-149。
- 代码：`vendor/coding-agent/patches/tools/dispatcher/tool-dispatcher.ts:262`；补丁证据 `vendor/coding-agent/patches/README.md:142`；`src/core/agent-runtime/answer-tools.ts:495`。
