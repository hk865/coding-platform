# agent-team 在 dsh 中的调研记录

> **性质**：调研记录（用户直接委托的调查，无 Ticket ID）。
> **日期**：2026-09-19
> **调研对象**：dsh（DeepSeek Harness）中的 agent-team
> **本地检出**：`/home/hyh001/projects/deepseek-harness/deepseek-harness-master`
> **用途**：为 `docs/agent-vs-agent-team.md` 的前提更正提供事实基准。
> **边界**：只做调研与文档；未改任何产品代码，未改动其它文档。
> 找不到实现的写「未找到实现」，未验证的写「未核实」，需要人决策的写「【待拍板】」。

---

## 摘要（一屏）

**agent-team 是 dsh 中一个仍在测试中的功能，不是 Agent Platform 产品线的能力。**

| 项 | 结论 | 关键依据 |
|---|---|---|
| 归属 | dsh（DeepSeek Harness），**独立于** Agent Platform 产品仓 | 本地检出 `/home/hyh001/projects/deepseek-harness/deepseek-harness-master` |
| 位置 | `packages/experimental/` 下 **5 个包**，全部 `0.1.6-alpha.1` | `packages/experimental/{agent-team,agent-team-profile,agent-team-web-profile,tool-agent-team,client-ui-agent-team}` |
| 启动方式 | 一个 **Cordis profile patch**（`dsh.bundle.patch`），叠加在 `dsh-base` 之后 | `agent-team-profile/package.json` 的 `dsh.bundle.patch` → `cordis.patch.yml` |
| 它做的最关键一件事 | **禁用 4 个既有 subagent 工具，替换成 Team 工具** | `cordis.patch.yml:4-14`（`tool-subagent-control`/`list-agents`/`subagent`/`subagent-fork` 全部 `disabled: true`） |
| "测试中"的证据 | 目录名 `experimental` · 包名 `dsh-experimental-*` · 版本 `alpha` · **默认不启用** · 无稳定性承诺 · **组外已发布产品不得依赖** | `packages/experimental/README.zh.md`、各 README「已知限制与延期工作」 |
| 对外界面 | 有 Web 侧（roster／task board／teammate 导航）与 Web profile 层，**但同样默认不启用** | `client-ui-agent-team`、`agent-team-web-profile` 包描述 |
| 对本次更正的结论 | **Agent Platform 不得依赖 agent-team** | dsh 明文：「组外已发布产品不得依赖实验性包。」 |

---

## 1. dsh 是什么、在哪里

### 1.1 结论

**dsh = DeepSeek Harness。** 它是一个**独立的项目**，与 Agent Platform 产品不是同一个代码库。

### 1.2 位置与判断依据

| 候选 | 位置 | 判断依据 | 结论 |
|---|---|---|---|
| **dsh 实现检出（主）** | `/home/hyh001/projects/deepseek-harness/deepseek-harness-master` | 目录内 `packages/` 全部以 `@deepseek-ai/dsh-*` 命名；`packages/experimental/README.zh.md` 自述为"实验组地图"；`dsh plugin --profile` 是其 CLI 入口 | **dsh 本体** |
| Agent Platform 产品仓内的 dsh 引用 | `C/vendor/coding-agent/docs/architecture/dsh-pi-relationship.md`、`.../README.md`、`.../evolution-overview.md`、`C/vendor/coding-agent/UPSTREAM.json`、`C/IMPLEMENTATION-HANDOFF.md` | 是**对 dsh 的引用与关系说明**，不是 dsh 实现本身 | **引用，非实现** |

用户已于 2026-09-19 确认："dsh 是 deepseek-harness"，并指定可看本地检出、也可联网。**故不存在"同名多候选"的歧义**；上表第二行只是产品仓里对 dsh 的引用。

### 1.3 Agent Platform 与 dsh 的关系（本产品视角）

- Agent Platform 产品仓 = `C = /home/hyh001/projects/coding-platform/coding-platform`（TypeScript 产品，含 `vendor/coding-agent` 内核副本）
- dsh = 另一个独立项目，有自己的 `packages/`、自己的 CLI（`dsh`）、自己的 profile 机制
- **两者之间没有依赖关系**：产品仓内 grep `dsh` 命中的都是文档性引用（见 §1.2），没有代码依赖

---

## 2. agent-team 的具体位置、包与入口文件

### 2.1 五个包（全部在 `packages/experimental/`，版本全部 `0.1.6-alpha.1`）

| 包名 | 描述（原文） | 职责 |
|---|---|---|
| `@deepseek-ai/dsh-experimental-agent-team` | "Implicit-root Agent Teams roster, durable peer mailbox, and shared task DAG" | **核心**：roster + 持久 mailbox + 共享任务板 |
| `@deepseek-ai/dsh-experimental-agent-team-profile` | "Experimental profile bundle enabling Agent Teams over dsh-base" | **启用层**：profile patch，把 Team 装进 dsh |
| `@deepseek-ai/dsh-experimental-agent-team-web-profile` | "Experimental Web profile layer for Agent Teams Remote and UI plugins" | Web 侧 profile 层 |
| `@deepseek-ai/dsh-experimental-tool-agent-team` | "Scoped model-facing Agent Teams tools over `ctx.agentTeams`" | **工具层**：给模型用的 Team 工具 |
| `@deepseek-ai/dsh-experimental-client-ui-agent-team` | "Web Agent Teams roster, task board, and teammate navigation" | **界面层**：Web UI |

依据：各包 `package.json` 的 `name`/`version`/`description`。

### 2.2 入口文件

**核心包 `agent-team/src/`（16 个源文件）**：

`index.ts` · `roster.ts` · `mailbox.ts` · `task-board.ts` · `task-graph.ts` · `lifecycle.ts` · `persisted.ts` · `projection.ts` · `journal.ts` · `invariant.ts` · `validation.ts` · `session-message.ts` · `activity.ts` · `client.ts` · `error.ts` · `types.ts`

**启用层 `agent-team-profile/src/index.ts`（全文 8 行，关键）**：

```ts
/**
 * @deepseek-ai/dsh-experimental-agent-team-profile — experimental Agent Teams profile bundle.
 * The package's runtime content is its `dsh.bundle.patch` document; this
 * module exports no runtime API.
 */
export {}
```

→ **它不导出任何运行时 API；它的运行内容就是那个 patch 文档。**

### 2.3 它是怎么被启动起来的（本调研最关键的机制）

**三步：**

1. **包声明自己是 bundle patch**（`agent-team-profile/package.json`）：
   ```json
   "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
   ```
2. **用户显式把它加进某个已初始化的 profile**（README.zh.md「使用本包」原文命令）：
   ```sh
   dsh plugin --profile headless add @deepseek-ai/dsh-experimental-agent-team-profile
   ```
   前置条件：该 profile **必须已经包含 `@deepseek-ai/dsh-base`**（本层要用它的 Subagent 服务与提供方配置行）。
3. **patch 生效时替换既有能力**（`agent-team-profile/cordis.patch.yml` 全文语义）：
   ```yaml
   # Experimental Agent Teams profile layer. Apply after dsh-base so these replacements
   # keep direct delegation and coordination on the Team tools.

   - id: tool-subagent-control
     disabled: true
   - id: tool-subagent-list-agents
     disabled: true
   - id: tool-subagent
     disabled: true
   - id: tool-subagent-fork
     disabled: true

   - insert:
       - id: agent-team
         name: '@deepseek-ai/dsh-experimental-agent-team'
         config:
           maxMembers: 8
           maxTasks: 256
           maxPendingMessagesPerMember: 64
           maxMessageBytes: 65536
           disposalTimeoutMs: 5000

       - id: tool-agent-team
         name: '@deepseek-ai/dsh-experimental-tool-agent-team'
         config:
           freshProvider: spawn
           forkProvider: fork
   ```

**可读出的硬事实**：
- 它**禁用**了 4 个既有 subagent 工具（`tool-subagent`、`tool-subagent-fork`、`tool-subagent-control`、`tool-subagent-list-agents`）
- 它**插入** 2 个插件，其中 `agent-team` 带上限配置：**最多 8 名成员、最多 256 个任务、每成员最多 64 条待处理消息、单条消息最大 64 KiB、disposal 超时 5 秒**
- `tool-agent-team` 的 `freshProvider: spawn` / `forkProvider: fork` → 团队成员的两种来源：**新建（spawn）** 与 **分叉（fork）**

**为什么用 patch 而不是配置开关**：因为 dsh 的能力是**按 profile 组合**的（`dsh plugin ... add/remove`），patch 是组合层的能力替换机制。这解释了"为什么必须显式添加"。

**未核实**：`dsh-base` 里 `tool-subagent-*` 的原始定义；本机是否有任何 profile 已经启用过它。

**未找到实现**：本机没有发现"默认开启"的路径——README 明确"随附 CLI、Web、SDK、ACP 与 Python profile 都不会启用它"。

---

## 3. "测试中"体现在哪里（逐条证据）

| # | 证据类型 | 具体内容 | 依据 |
|---|---|---|---|
| 1 | **目录** | 位于 `packages/experimental/`，与 `auto-review`、`browser-use-*`、`computer-use-*`、`inspector` 等原型同组 | `packages/experimental/` 目录列表 |
| 2 | **包名** | 全部以 `@deepseek-ai/dsh-experimental-*` 发布 | 各 `package.json` |
| 3 | **版本** | 全部 `0.1.6-alpha.1`（alpha 预发布） | 各 `package.json` |
| 4 | **组的自述** | "实验组包含**约定可能变更且不提供支持承诺**的原型能力" | `packages/experimental/README.zh.md` 概述 |
| 5 | **硬性依赖禁令** | "**组外已发布产品不得依赖实验性包。**" | 同上 |
| 6 | **默认关闭** | "**仅显式启用**——本包公开发布，但随附 CLI、Web、SDK、ACP 与 Python profile 都不会启用它。" | `agent-team-profile/README.zh.md`「已知限制与延期工作」 |
| 7 | **必须显式安装** | "**必须将本包显式添加到已初始化的 profile**；随附 profile 默认都不会启用它。" | `agent-team-profile/README.zh.md` 概述 |
| 8 | **稳定性自述** | "它以**实验性名称公开发布、不承诺稳定性**，并且**需要持久会话存储才能激活**。" | `agent-team/README.zh.md` 概述 |
| 9 | **限制自述** | "**实验原型，无稳定性承诺**——本包公开发布，但**孵化期间约定仍可自由变更**。" | `agent-team/README.zh.md`「已知限制与延期工作」 |
| 10 | **依赖未稳定基座** | "本 patch 依赖 `dsh-base` 提供的配置行 id 与 Subagent 提供方；**它不是独立 profile**。" | `agent-team-profile/README.zh.md` 已知限制 |

**它属于哪一类"测试中"**：**不是 feature flag 式的运行时开关，而是"包级 + profile 级"的实验能力**——以实验命名空间发布、默认不装配、需显式 `dsh plugin add`，且上游明文禁止组外已发布产品依赖。

---

## 4. 它和 Agent 的关系

### 4.1 它是什么（原文）

> `agent-team/README.zh.md` 概述：
> "`dsh-experimental-agent-team` 把一个**编码会话**变成一个小型工作团队：**会话中的 agent 成为 Lead**，创建**具名 teammate** 处理委派的工作，与它们交换**持久消息**，并在**公共任务板**上跟踪共享任务。消息与任务状态能**挺过崩溃、reload 与中断**，因此离线的 teammate 会在恢复后收到排队的消息。它本身**不提供任何工具**——请挂载兄弟包 `dsh-experimental-tool-agent-team`，让模型能够创建 teammate、给它们发消息并使用任务板。"

### 4.2 谁包含谁、谁调度谁

| 关系 | 事实 | 依据 |
|---|---|---|
| **包含** | 一个 **dsh 会话（session）**包含一支 Team；会话中的那个 agent 成为 **Lead** | `agent-team/README.zh.md` 概述 |
| **调度** | **只有 Lead 可以创建直接 teammate**；teammate 处理被委派的工作 | `agent-team/README.zh.md` 已知限制："只有 Lead 可以创建直接 teammate" |
| **层级** | **扁平**：不支持嵌套 Team、重命名、删除或名字复用 | 同上 |
| **工具与本体分离** | 核心包**不带工具**；模型可见的 Team 工具在 `tool-agent-team` 包，经 `ctx.agentTeams` | `agent-team/README.zh.md` 概述；`tool-agent-team/package.json` 描述 |
| **与既有 subagent 的关系** | patch **禁用** `tool-subagent`／`tool-subagent-fork`／`tool-subagent-control`／`tool-subagent-list-agents`；**Workflow 仍可创建 fresh 子代理** | `cordis.patch.yml:4-14`；`agent-team-profile/README.zh.md` 概述 |

### 4.3 共享的结构

- **roster**（成员名册）— `agent-team/src/roster.ts`
- **mailbox**（成员间持久消息）— `agent-team/src/mailbox.ts`
- **task board / task graph**（共享任务板与任务图）— `agent-team/src/task-board.ts`、`task-graph.ts`
- **session**（会话内隐式根）— 描述里的 "Implicit-root"

### 4.4 边界划在哪（原文的"何时不要选择"）

> `agent-team/README.zh.md`「何时选择」：
> "当多个 agent 必须在**同一个共享工作区**协作、且 roster、消息与任务状态需要挺过崩溃与重启时，选择它。当 teammate 需要**独立工作目录**、**多个进程需要协调同一支团队**、或**任务 owner 需要自动释放**时，**请不要选择——这些都不受支持**。"

---

## 5. 测试覆盖到什么程度

### 5.1 已确认存在的测试（按文件规模）

| 文件 | 行数 | 对应能力 |
|---|---|---|
| `agent-team/tests/team.spec.ts` | **1852** | 团队主流程 |
| `agent-team/tests/persistence.spec.ts` | **514** | 持久化（崩溃/reload 后消息与任务状态） |
| `agent-team/tests/projection-events.spec.ts` | 346 | 投影与事件 |
| `agent-team/tests/invariant.spec.ts` | 74 | 不变量 |
| `agent-team/tests/built-lib.e2e.ts` | 69 | 构建产物 e2e |
| `agent-team/tests/test-session-query.ts` | 62 | 测试辅助 |
| `agent-team-profile/tests/profile.spec.ts` | **52** | profile patch 装配 |
| **合计** | **≈2969** | |

**注意对比**：核心逻辑有 ~2900 行测试，而**启用层（profile patch）只有 52 行测试**。也就是说"能不能启用、启用后替换了什么"这件事的测试覆盖，远低于核心逻辑。

### 5.2 已知问题与已知限制（README 明列）

**`agent-team/README.zh.md`「已知限制与延期工作」（6 条，原文摘要）**：

1. **实验原型，无稳定性承诺**——孵化期间约定仍可自由变更。
2. **单进程、共享 checkout**——成员共享 cwd，修改立即可见；**不提供 worktree、远端成员、merge 或文件锁**。
3. **write scope 仅作提示**——"Bash、formatter、代码生成器与直接外部写入**可以绕过文件版本检查**；Lead 必须协调 owner 并检查最终 diff。"
4. **扁平且不可变的 roster**——只有 Lead 可以创建直接 teammate；**不支持嵌套 Team、重命名、删除或名字复用**。
5. **不会自动释放 owner**——"idle、interrupt、进程退出与工作失败**都不会释放任务 owner**。"
6. **mailbox 不保证跨进程 exactly-once**——**不支持多个 harness 进程并发操作同一 Team**。

**`agent-team-profile/README.zh.md`「已知限制与延期工作」（4 条）**：

1. **仅显式启用**——随附 CLI、Web、SDK、ACP 与 Python profile 都不启用它。
2. **Workflow 子代理工具**——Team 工具可见性限制也适用于 workflow 子代理。
3. **共享 checkout**——所有 teammate 观察同一个工作目录；**本 bundle 不提供 worktree 隔离或文件系统锁**。
4. **需要 base profile**——依赖 `dsh-base` 的配置行 id 与 Subagent 提供方；不是独立 profile。

### 5.3 哪些路径真能跑通／哪些是半成品

| 判断 | 内容 | 依据 |
|---|---|---|
| **有测试、很可能真能跑通** | 团队主流程、持久化、投影与事件、不变量 | §5.1 的测试文件存在且规模可观 |
| **半成品／占位** | **未找到实现**：嵌套 Team、远端成员、merge、文件锁、owner 自动释放、跨进程 exactly-once | README 明确列为"不受支持"或"延期工作" |
| **未核实** | 我**没有运行**这些测试，因此"能跑通"只是"存在对应测试"的推断，**不是实测结论** | 本轮只做只读调研，未执行 dsh 的测试命令 |
| **未核实** | git log / CHANGELOG 里的历史已知问题（未查提交记录） | — |

---

## 6. 对外界面与交互入口

### 6.1 有界面

| 层 | 包 | 描述（原文） |
|---|---|---|
| Web UI | `@deepseek-ai/dsh-experimental-client-ui-agent-team` | "Web Agent Teams roster, task board, and teammate navigation" |
| Web profile | `@deepseek-ai/dsh-experimental-agent-team-web-profile` | "Experimental Web profile layer for Agent Teams Remote and UI plugins" |

即：**有成员名册、任务板与 teammate 导航的 Web 界面**，以及一个 Web 侧的 profile 层。

### 6.2 用户当前能不能实际用到

**默认不能。** 需要同时满足：

1. profile 里已有 `@deepseek-ai/dsh-base`；
2. 显式执行 `dsh plugin --profile <name> add @deepseek-ai/dsh-experimental-agent-team-profile`；
3. 核心包自身还要求 **"需要持久会话存储才能激活"**（`agent-team/README.zh.md` 概述）；
4. Web 侧若要界面，还需要叠加 `agent-team-web-profile`。

**从哪里进去**：CLI 入口是 `dsh plugin ... add`（装）与 `dsh --profile <name> "<任务>"`（用）；界面入口在 Web profile 启用后由 `client-ui-agent-team` 提供。

**未核实**：界面具体长什么样、在 Web UI 的哪个位置——本轮未启动 dsh、未打开其界面。

---

## 7. "测试中"状态给设计带来的约束

### 7.1 结论：不得依赖

**最重要的一条**（`packages/experimental/README.zh.md` 原文）：

> "**组外已发布产品不得依赖实验性包。**"

Agent Platform 是一个**已独立验收**的产品（`C/IMPLEMENTATION-HANDOFF.md` 记 I01–I04 全部 PASS）。因此：

> **按 dsh 自己的规定，Agent Platform 不得把 agent-team 作为依赖或设计前提。**

### 7.2 可以依赖 / 不可以依赖（逐项）

| 若某设计依赖… | 能否依赖 | 原因 |
|---|---|---|
| agent-team 的**运行时能力**（roster／mailbox／task board） | ❌ **不能** | 组外依赖禁令；且默认不启用、alpha、无稳定性承诺 |
| agent-team 的**术语**（Lead／teammate／roster／mailbox／task board） | ❌ **不能直接搬** | 本产品有自成一体的领域词典（`Coordination Role`／`Execution Role`／`RoleSpec`／`RoleBinding`／`Run`，见 `D/CONTEXT.md`）；且跨项目术语混用会造成前述"把 dsh 功能当本产品能力"的同类错误 |
| agent-team 的**设计取舍**（作为参考读物） | ⚠️ **可以，但只能当参考** | 它把"共享 checkout 无隔离""write scope 仅作提示""owner 不自动释放""跨进程 exactly-once 不保证"这些坑写明了；**读它来避免重犯是合理的，但不能据此声称本产品有该能力** |
| agent-team 的 **Web UI 设计**（roster／任务板／导航） | ⚠️ **仅作参考** | 同上；且本产品的对应界面是「Agent」视图与「任务图」视图（`C/src/ui/src/state/layout.ts:48,47`），二者语义不同 |
| **将来**（它离开 `experimental/` 且给出稳定承诺后） | 🔶 **需重新评估** | 届时应重新调研版本、稳定性承诺与依赖政策 |

### 7.3 对 `docs/agent-vs-agent-team.md` 的具体影响

- §1 的"本仓库不存在 Agent Team"→ 必须限定为**产品仓**，并指出它在 dsh 里存在但属实验功能；
- §1 把 Agent Team 描述成"多个平级主体自由协作"→ **与事实不符**（dsh 是 **Lead + teammate** 的扁平但**非平级**结构）；
- §2 的"要不要基于它来做"→ 从"要不要采用一种协作模型"变成"**要不要依赖另一个项目的实验包**"，而 dsh 已用明文规定回答了：**不得依赖**。

---

## 8. 未找到实现 / 未核实 清单

| # | 项 | 状态 |
|---|---|---|
| 1 | 嵌套 Team、远端成员、merge、文件锁 | **未找到实现**（README 明列不受支持） |
| 2 | 任务 owner 自动释放 | **未找到实现**（README 明列不支持） |
| 3 | mailbox 跨进程 exactly-once | **未找到实现**（README 明列不保证） |
| 4 | 独立 worktree 隔离 | **未找到实现**（README 明列不提供） |
| 5 | `dsh-base` 中 `tool-subagent-*` 的原始定义 | **未核实**（本轮未展开读 dsh-base） |
| 6 | 本机是否有 profile 已启用 agent-team | **未核实**（未查 profile 状态） |
| 7 | dsh 的测试是否实际通过 | **未核实**（本轮未执行任何 dsh 测试命令） |
| 8 | git log / CHANGELOG 中的历史已知问题 | **未核实**（未查提交记录） |
| 9 | Web 界面的实际外观与入口位置 | **未核实**（未启动 dsh） |

---

## 9. 待拍板

**【待拍板 1】** 是否在 Agent Platform 的规范文档里显式登记"不得依赖 dsh 实验包"（写入 `D/ARCHITECTURE.md` 全局不变量，或 `D/CONTEXT.md` 的边界说明）。这是跨仓库的规范动作。

**【待拍板 2】** 是否需要补充调研 §8 的 5 项未核实内容（尤其 5、7、9）。若需要，建议另开一轮、限定在 dsh 检出内、并允许执行 dsh 的测试命令。

**【待拍板 3】** 若将来 dsh 的 agent-team 转正，本产品是否要评估**参考其 Web UI 形态**（roster／任务板／teammate 导航）来改进自己的「Agent」与「任务图」视图。

---

## 10. 调研方法与边界

- **方法**：只读勘察 dsh 本地检出 `/home/hyh001/projects/deepseek-harness/deepseek-harness-master` 下的 `packages/experimental/`：读各包 `package.json`、`README.zh.md`、`cordis.patch.yml`、`src/index.ts`，并列目录与测试文件。所有结论指向具体文件。
- **未做**：未运行 dsh、未执行其测试、未改任何文件、未查 dsh 的 git 历史。
- **不改代码**：本轮零代码改动。
- **子代理使用说明（如实记录）**：本次委托要求"开一个子 agent 去做这次调研"。主 agent 已按派发信封派出子代理 `560b5705-8a1f-4b1b-9ed5-b02dcd53b9bb`（write_scope 限定为本文档）。该子代理运行逾 10 分钟后仍未产出任何文件，主 agent 将其停止；**它未留下收尾信息，也未留下任何中间产物**（已核查 `docs/` 与工作区，停止前后均无新文件）。因此**本文档的全部内容由主 agent 依据自己的一手只读勘察撰写**，未使用子代理结论。
- **此前的三个子代理**（`4ed93bbf`、`1cc3efa2`、`ea2ad915`，上一轮"Agent vs Agent Team"勘察）同样被停止/失败，**未留下任何中间产物**；本轮已核查，未发现可复用文件。
