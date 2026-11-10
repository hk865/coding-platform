# 004 第二工作区的路径前缀 `/@ws:`

状态：采用（决定 121-36、121-55、121-59、121-75）
日期：2026-11-09

## 背景和约束

- 第二个工作区加进项目，不是把两个项目合并：原有的秘书、参谋、书记要服务它，它的模块要进项目的架构图、分区域给参谋线（[HANDOFF 121-36](../HANDOFF.md)）。
- 两个工作区是两个仓库，同一条相对路径（`src`、`src/index.ts`）很常见。如果项目级路径不区分工作区，第二个工作区的模块和文件注记会和主工作区的撞成同一个，121-36 的“模块进架构图、分区域”就做错了。
- 这里要区分两种路径。工作区相对路径是文件在某个工作区里的真实路径（`src/a.ts`），只给 Kernel、git、文件读写用；项目路径是平台在项目级记录模块、注记、联系时用的路径，它要能分出是哪个工作区。Kernel 是平台底下的执行器，它只接受工作区相对路径，以 `/` 开头的路径会被当成绝对路径拒绝。
- 约束：主工作区的路径照旧，不改、不迁移；第二个及以后的工作区路径要带工作区；不新增“WorkspaceId 必须是 32 位十六进制”的规则；只在“项目路径 → 工作区文件”一处解析（[HANDOFF 121-55](../HANDOFF.md)）。
- 这一篇只定项目路径的写法；工作区、线和库的位置分别见 001 和 005。
- P 已落地：`src/contracts/workspace-path.ts` 和 `src/contracts/workspace-catalog.ts` 在当前树上；`ExecutedFileV1.workspaceId` 已必填（`src/contracts/work-line.ts:227`）。这一篇按当前代码写，不再说“还没有、落地时补”。

## 选项

三个选项来自决定 121-55。

| 选项 | 怎么做 | 好处 | 坏处 |
|---|---|---|---|
| (ii) 类型里加 `workspaceId` 字段 | 把 `ModuleDefinition.paths` 改成带 `workspaceId`，文件锚也加 `workspaceId` | 类型最干净，读文件处不用解析字符串 | 要改两个 contracts 和两个 codec；`pathOwnershipOf` 的候选在 15+ 个生产文件里从 `string` 改成 `{workspaceId,path}`，再改 `anchorKeyOf`、views/UI 和旧数据读法；估计生产 +550–750 行 |
| **(iii) 路径串里带工作区前缀** | 第二个工作区的项目路径写成 `/@ws:<编码 id>/src/a.ts`，根写成 `/@ws:<编码 id>`；主工作区仍是 `src/a.ts`、`.` | 不改 `ModuleDefinition.paths`、`NoteAnchorV1.file`、`NoteDraftAnchorV1.file` 和注记/目录/联系的编解码形状；旧数据按无前缀读，不迁移；前缀以 `/` 开头，Kernel 的 absolute 拒绝保证它不可能是真实相对路径 | 每个读文件处要先解析一次；显示时要把前缀转成 `<workspaceId>/<relative>`；解析必须只有一份，否则会在 15+ 个读点各写一套 |
| 不区分工作区 | 两个仓库的同名路径当成同一个模块/注记 | 不用改任何形状 | 两个 `src/a.ts` 撞成同一个，架构图分区域和注记都会错 |

## 选了什么，为什么

- 选 (iii) 前缀，不选 (ii) 字段。格式：主工作区照旧，`src`、`src/a.ts`、`.`，不迁移、不加前缀；第二个及以后的工作区，根是 `/@ws:<encodeURIComponent(workspaceId)>`，根下路径是 `/@ws:<encoded>/<relative>`。正本在 `src/contracts/workspace-path.ts`：`WORKSPACE_PROJECT_PATH_PREFIX`（`:16`）、`splitWorkspacePath`（`:66`）、`qualifyProjectPath`（`:109`）、`normalizeProjectPath`（`:91`）、`normalizeRequestProjectPath`（`:126`）、`resolveStoredProjectPath`（`:141`）、`displayProjectPath`（`:155`）。
- `encodeURIComponent` 把 `/`、`:`、`%`、空格和非 ASCII 都编码，所以 id 段里不会再出现 `/`；解析时按第一个 `/` 切开 id 段，再 `decodeURIComponent`。任何路径在查重、算键、写回之前，先 `id = decodeURIComponent(encodedId)`，再取 `canonicalPrefix = '/@ws:' + encodeURIComponent(id)`，所以 `/@ws:%77s2/src/a.ts` 和 `/@ws:ws2/src/a.ts` 是同一个键（`src/contracts/workspace-path.ts:91`）。
- 相对部分仍必须满足旧的工作区相对路径语法（`isSafeWorkspaceRelativePath`，`src/contracts/workspace-path.ts:21`），所以不会有 `..`、`.` 段、`\`、NUL；显式写主工作区前缀（包括它的编码别名）直接拒，主工作区只有裸路径一种写法（`src/contracts/workspace-path.ts:49`、`:109`）。
- 两条读规则：请求路径先规范化，再按请求的工作区限定、查重、算键（`normalizeRequestProjectPath`，`src/contracts/workspace-path.ts:126`）；已存路径有前缀取指定工作区，无前缀就是主工作区，不回落调用者的工作区（`resolveStoredProjectPath`，`src/contracts/workspace-path.ts:141`）。
- 正式 catalog 仍只有一份；`catalogForWorkspace`（`src/contracts/workspace-catalog.ts:16`）是读时投影，不是第二份 catalog。显示只在 DTO 最后一步用 `displayProjectPath`，主工作区保持裸路径，另一个工作区显示 `<decoded id>/<relative>`（`src/contracts/workspace-path.ts:155`）。
- **模块编号也按工作区区分（121-75）。** 在项目视图里，非主工作区的模块编号写成 `'/@ws:' + encodeURIComponent(workspaceId) + '/' + encodeURIComponent(moduleId)`，主工作区原样；只有主工作区的模块编号本身以 `/@ws:` 开头时，写成 `'/@ws:#' + encodeURIComponent(moduleId)`。这个项目视图编号要进到区域 claim，不能只改显示（[HANDOFF 121-75](../HANDOFF.md)）。当前树还没有模块编号前缀的实现，按 121-75 排在 A 之后的 KLS-2a。
- 为什么选前缀：不用改两个 contracts 和两个 codec，不用把 15+ 个生产文件的 `string` 改成 `{workspaceId,path}`，旧数据也不用迁移；代价是每个读文件处解析一次，但解析只有一份。前缀以 `/` 开头，真实工作区相对路径不可能以 `/` 开头，所以不会和真实路径撞车（[HANDOFF 121-55](../HANDOFF.md)）。

## 代价，以及因此要守的规矩

- **主工作区的旧路径一个字节不改：** 不加前缀、不迁移、不重写旧注记/旧模块/旧 catalog；旧数据按无前缀（主工作区）读（[HANDOFF 121-55](../HANDOFF.md)）。
- **不新增 `workspaceId` 字段：** 不改 `ModuleDefinition.paths`（`src/contracts/architecture-catalog.ts:24`）、`NoteAnchorV1.file`（`src/contracts/note.ts:29`）、`NoteDraftAnchorV1.file`（`src/contracts/note.ts:39`）和注记/目录/联系的编解码形状。
- **不新增“WorkspaceId 必须是 32 位十六进制”的规则。** 登记的公开约束只有非空，id 用 `encodeURIComponent` 编码，明确可逆（[HANDOFF 121-55](../HANDOFF.md)）。
- **路径语法只有一份正本。** `note-anchors.ts`、`architecture-service.ts`、`graph-context-reader.ts` 的旧检查改成调用 Contracts 的函数，不复制规则；今天这些模块都从 `src/contracts/workspace-path.ts` 取语法，后来的改动仍从这一处进（[HANDOFF 121-55](../HANDOFF.md)）。
- **请求路径先规范化，再按请求工作区限定、查重、算键。** 裸 `src/a.ts`、带前缀路径和编码别名在同一个请求里是同一个键，不能绕过重复检查（`src/contracts/workspace-path.ts:126`）。
- **已存路径无前缀就是主工作区，不是调用者的工作区。** `checkFileAnchor`、依据文件、批量读都用同一个解析结果，不各自回落 `ctx.workspaceId`（`src/contracts/workspace-path.ts:141`）。
- **前缀不能进 Kernel、`files/*`、git、`WorkspaceToolsPort`。** `plannedFiles`、Run 的 changedFiles 仍是工作区相对路径，只在和项目路径比较时投影或限定一次（[HANDOFF 121-55](../HANDOFF.md)）。
- **区域 claim 用项目视图的模块编号。** 两个工作区都有 `core` 时 claim 不同；主工作区的编号不变（[HANDOFF 121-75](../HANDOFF.md)）。
- **显示只在 DTO（给界面的数据传输对象）最后一步做。** 不要把 `/@ws:` 原文给界面，也不要在 HTML/模板里拆前缀；用 `displayProjectPath`（`src/contracts/workspace-path.ts:155`；[HANDOFF 121-55](../HANDOFF.md)）。

## 什么情况变了要重新考虑

- 第 3 步“线”和 121-65 的“移出”落地后，看前缀是否还够用：线会带来同一仓库的多个检出，移出会改工作区集合（[HANDOFF 121-65](../HANDOFF.md)、[HANDOFF 121-68](../HANDOFF.md)、[HANDOFF 121-75](../HANDOFF.md)）。
- 工作区多到几十个时，显示 `<workspaceId>/<relative>` 是否还读得懂；如果界面需要按工作区过滤、分组或排序，可能要补显示规则，但仍不改存储格式（起草方推断；[HANDOFF 121-55](../HANDOFF.md)）。
- 用户要用 Perforce 一类非 git 的版本管理：内容哈希、worktree 和线都要一层适配，项目路径前缀仍可用，但版本管理适配层要另写（[HANDOFF 121-69](../HANDOFF.md)）。
- 如果路径解析在 15+ 个读点被各写一套，说明“一处解析”没做到；这时先收回一份，不要改格式（[HANDOFF 121-55](../HANDOFF.md)）。
- 如果以后有消费者必须在类型上直接拿到工作区，而不是从路径解析，重新比较 (ii) 字段方案；这需要新的测量和取舍记录（起草方推断：材料没有记录这种消费者）。

## 来源

- 决定 121-36：第二个工作区是项目的扩张；模块进架构图、分区域给参谋线、书记按项目管注记（[HANDOFF 121-36](../HANDOFF.md)）。
- 决定 121-55：主工作区照旧、不改不迁移；第二个及以后带工作区前缀；前缀取 Kernel 已拒绝的表示（如 `/@ws:`）；id 用可逆编码；不新增 32 位十六进制规则；只在一处解析（[HANDOFF 121-55](../HANDOFF.md)）。
- 决定 121-59：P 的施工和返工；`ExecutedFileV1.workspaceId` 必填、任务图行键按项目路径、Task 工作区服务端必给；主前缀和别名要抛；请求路径先去 `./` 再校验（[HANDOFF 121-59](../HANDOFF.md)）。
- 决定 121-75：模块编号在项目视图里按工作区转义加前缀，主工作区原样，进到区域 claim（[HANDOFF 121-75](../HANDOFF.md)）。
- 代码：`src/contracts/workspace-path.ts:16`、`:21`、`:49`、`:66`、`:91`、`:109`、`:126`、`:141`、`:155`；`src/contracts/workspace-catalog.ts:16`；`src/contracts/work-line.ts:227`；`src/contracts/architecture-catalog.ts:24`；`src/contracts/note.ts:29`、`:39`。
- 模板：决定 121-70 的七段要求（[HANDOFF 121-70](../HANDOFF.md)）。
