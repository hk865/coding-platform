完成只读审查，未运行测试、构建或网络请求，未修改文件。下文“书”指 `.lead-ref/books/pc2-book.md`。

| 编号 | 类别 | 位置（file:line） | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| H-01 | 会出错 | `src/app/host.ts:263`、`:235`、`:497`；`src/core/workspace/access.ts:95` | 书裁定 2，`:76`；规格 P1 | **不存在的配置根确实被放行，`validateWorkspaces` 没有检查存在性。** 例如启动时 `/tmp/alias` 不存在，随后把它建成指向设置目录的链接；该根已在 Host 映射中，后续访问直接解析它，不经过 `workspaces/open` 的覆盖检查。应完成真实路径检查后才接纳；实际可以覆盖 `prompts/`。Kernel 也接受解析后的根链接：`vendor/coding-agent/dist/sandbox/workspace/workspace-sandbox.js:115`。 | 删除 ENOENT 放行分支；无法取得配置根真实路径时，启动报含根路径与提示词路径的配置错误。 |
| H-02 | 违规 | `src/app/host-settings.ts:607` | 书裁定 2，`:80`，要求在恢复循环前检查恢复根 | 现在是“检查根 A → 恢复 A → 检查根 B”。保存列表为 `[合法 A, 覆盖 prompts 的 B]` 时，检查 B 前已经调用 A 的恢复入口：`:610`、`:611`。 | 先遍历全部恢复根完成检查，再进入现有恢复循环。 |
| H-03 | 会出错 | `src/app/host-settings.ts:1048`、`:1050`、`:1114`、`:1119`；`src/app/server.ts:339` | 书裁定 6，`:259`；PC-04，`:832` | 有效包的保存请求带 `text: 17`，或工具 `entry.description: 17`，以及 HTTP 坏 JSON，实际均返回 **没有 `problems` 的 `invalid`**；要求是 `invalid` 并列出问题。所谓“broken body”测试实际只装载了 version=0 的坏包，没有提交坏请求体：`tests/app/PC2-H-pack-routes.test.ts:129`。 | 为提示词路由统一构造带 `problems` 的请求校验错误，并在 HTTP 坏 JSON 分支保留这个契约；用夹具的 `rawBody` 入口补对应字面断言。 |
| H-04 | 会出错 | `src/app/host-settings.ts:1041`、`:1050`、`:1057`、`:1102` | 书裁定 6 保存顺序，`:267`–`:270` | **保存前先要求旧包整体有效。** 例如 `base` 的版本是 7、旧正文为 `BASE {{`，用正确版本保存合法正文，应校验候选包并保存为 8；实际在 `packForRoute` 就返回 `invalid`（`:955`）。另外，旧版本 6 加 `text:17` 会先返回 `invalid`，没有先返回要求的 `revision_conflict`。 | 保存路径先读链并取得有效供应者的版本／摘要，完成冲突比较，再替换候选条目并校验保存后的整包；不要以旧包整体有效作为保存前提。 |
| H-05 | 会出错 | `src/app/prompt-packs.ts:357`；`src/app/host-settings.ts:1072`、`:1139` | 书裁定 6，`:272`–`:276`、`:282` | **“新文件”可以覆盖现有普通文件。** 合法 manifest 可声明版本 7，却指向 `templates/base@8.txt`；文件命名不受版本绑定限制：`src/contracts/prompts/resolve-pack.ts:249`、`:255`。保存版本 8 时直接覆盖该文件。若随后 rename 失败或进程退出，应仍可见版本 7 的旧正文；实际旧 manifest 已读到新正文。 | 独占创建目标；已有文件仅在逐字节相同且为普通文件时复用，绝不覆盖不同内容。撞名错误码需 lead 裁定，建议 `unavailable`，且保留所有已有文件。 |
| H-06 | 会出错 | `src/app/prompt-packs.ts:342` | 书裁定 1、3，`:74`、`:94`；检查裁定 7 | `templates` 是指向**同一包内真实目录**的链接时，真实父目录同时位于包内和 prompts 内，符合书的条件；读取也接受：`:70`。保存却因 `lstat().isDirectory()` 为假返回 `invalid`。因此实现的额外限制不只是回复所称的“两层包含检查”。 | 对父目录先取 `realpath`，再检查目录类型及两层包含关系；允许目标仍在包内的目录链接。 |
| H-07 | 会出错 | `src/app/prompt-packs.ts:231`、`:117` | 书裁定 4，`:167`；裁定 6 的完整问题返回 | 任一模板／工具读失败就跳过 A 的整包校验。例如同一模板 `version:0` 且文件缺失，应同时报告版本与缺文件问题；实际只报告读失败。字符串文件的读取错误还在 `:117`–`:119` 被丢弃。 | 保留各文件读取问题，并继续校验可读链；合并、去重读取问题与 A 的校验问题后返回。 |
| H-08 | 会出错 | `src/app/prompt-packs.ts:264`、`:267` | 书裁定 1，`:73`；裁定 6，`:260` | 磁盘上存在 `prompts/platform/` 时，`ids` 包含 `platform`，随后又在首位手动添加它。应只有一个保留的平台包；实际列表出现两个相同的平台包，且都来自生成模块。 | 扫描磁盘目录时排除保留 id `platform`。 |
| H-09 | 违规 | `tests/app/PC2-H-settings-model.test.ts:22`、`:66`；`tests/runtime/PC2-joint-packs.test.ts:139`；`tests/app/PC2-joint-routes-prepare.test.ts:45` | 书 PC-05、PC-06、PC-08，`:834`–`:841`；§2 测试规则 | **设置到执行的接线没有验收到。** H 测试只读设置快照，未提供带旧 pack/policy 的启动 catalog；joint 则直接 `installBinding`，磁盘源也手工注入另一个平台。恢复“省略字段时从启动 catalog 补回旧值”，或删除 Host 的磁盘源注入，都可漏过这组验收。所谓“只检查语法”还只保存了必然存在的 `platform`：`PC2-H-settings-model.test.ts:101`。 | 用现有 Host 夹具的真实平台公开步骤贯通保存／选择、准备、启动和重启：检查 A/B 字面正文、旧执行冻结、新执行更新、清除后默认值，并保存一个合法但不存在的 pack id。 |
| H-10 | 违规 | `tests/app/PC2-H-pack-routes.test.ts:251` | 书 PC-22，`:882` | 保存测试只有 role 非首位、重复 section，缺少“调用类不允许的 section”。删掉该拒绝规则，现有这两例仍可通过。 | 增加通过保存路由给 `query-copy-input` 加 `{{footprint}}` 的用例，字面断言问题并比较保存前后全部文件字节。 |
| H-11 | 违规 | `tests/app/PC2-H-directory-checks.test.ts:15`、`:40`；`tests/helpers/PC2-host-fixture.ts:264` | 书裁定 2，`:76`、`:84`；decision 80 | 指定的 PC-23 基本场景都有，但未区分**字符串前缀与路径段**，也未锁住**既有根快捷返回前检查**。把比较改为 `child.startsWith(parent)`，或把打开检查挪到既有根返回之后，当前输入仍可全部通过。 | 补两个公开入口反例：同字符串前缀但不包含 prompts 的兄弟目录应成功；已登记根后来通过链接解析成 prompts 上级时，再打开必须 `invalid`。 |
| H-12 | 不整洁 | `src/app/prompt-packs.ts:234` | 用户审查项 5：不可达分支 | `chain[0]?.packId === 'platform'` 的真分支不可达：请求 `platform` 已在 `:188`–`:192` 返回；其余成功路径首项必是请求的用户包（`:201`、`:212`、`:227`）。 | 删除该条件分支，直接解析用户包目录；保留真实的解析失败处理。 |
| H-13 | 不整洁 | `src/app/prompt-packs.ts:238`；`src/app/host-settings.ts:935`；`src/composition/create-platform.ts:1189` | 书 §2，`:64`；用户审查项 6 | 生产注释仍写施工批次和替换过程，如“PC-2 wires in place…”、“PC-2 swaps…”。 | 改成当前职责和原因说明，去掉批次／施工经过，保留路径边界、无缓存和原子发布的规则说明。 |

逐裁定、逐行核对：

- 裁定 1：H-06、H-08；目录位置与 id 语法本身正确（`src/app/host.ts:350`；`src/app/prompt-packs.ts:24`）。
- 裁定 2：H-01、H-02、H-11；当前分段比较和打开检查的位置正确（`src/app/prompt-packs.ts:31`；`src/app/host.ts:929`、`:944`）。
- 裁定 3：H-07、H-12；读取为异步、没有跨准备缓存，`..name` 合法，文件真实路径限制在包内（`src/app/prompt-packs.ts:53`、`:63`、`:239`）。
- 裁定 6：H-03、H-04、H-05、H-06、H-07、H-08。六个 DTO 和路由名字齐全；保存复用设置队列，manifest 使用临时文件和 rename（`src/app/host-settings-types.ts:153`；`src/app/host-settings.ts:988`、`:1171`）。
- 裁定 7：实现 OK，验收缺口 H-09。类型、解析、初值、保存及只在设置时投影均有对应字段；省略保存会清除（`src/app/host-settings-types.ts:18`、`:82`；`src/app/host-settings.ts:407`、`:463`、`:574`、`:686`）。
- 裁定 8：实现 OK，验收缺口 H-09。绑定取存储模型的两字段，启动 options map 不再保存它们（`src/app/host.ts:423`、`:719`）。
- PC-04：H-03、H-04、H-05、H-06、H-07、H-08。7→8、旧文件保留和 invalid 后字节相等已有断言（`tests/app/PC2-H-pack-routes.test.ts:45`、`:61`、`:81`）。
- PC-05：H-09。
- PC-06／PC-08 设置半边：H-09。
- PC-22 保存：H-10。
- PC-23：H-01、H-02、H-11。
- PC-25 路由：H-03、H-04、H-05、H-06、H-07；摘要调用 A 的同一函数，没有复制算法（`src/app/host-settings.ts:29`、`:1125`；`src/contracts/prompts/prompt-set.ts:229`）。
- §4 H 的文件范围：OK，所给 H 清单匹配所属文件和白名单（`.lead-ref/parts/H-files.txt:1`；书 `:762`；`.lead-ref/books/pc2-whitelist.txt:5`、`:17`、`:24`）。
- §5.1 Host 夹具：未发现阻止 H 行验收的缺陷；已有原始请求体、token/origin 和真实平台入口（`tests/helpers/PC2-host-fixture.ts:39`、`:215`、`:234`）。
- §5.3 S2B：OK，只分离设置目录及增加其清理，没有放宽回填断言（`.lead-ref/parts/H.diff:1687`、`:1716`、`:1738`、`:1776`）。

访问控制沿用 settings 分支的 token 和同源门，没有新 principal；没有 settings port 时返回 `unsupported`（`src/app/server.ts:331`、`:343`、`:363`、`:394`）。

PC-25 的两个摘要、保存正文和文件名都是字面量，独立复算摘要一致；旧正文也按完整字符串比较（`tests/app/PC2-H-tool-routes.test.ts:14`、`:55`、`:59`、`:60`）。这些输入的 `parameters` 都为空，因此会漏掉“取消参数键排序”的变异。PC-04/PC-25 的正常保存测试也会漏掉“用直接写 manifest 代替临时文件＋rename”的变异，因为只观察调用完成后的文件（`tests/app/PC2-H-pack-routes.test.ts:45`；`tests/app/PC2-H-tool-routes.test.ts:41`）。跨准备缓存则会被 joint 的先准备、保存、再次准备场景发现，但该场景没有验证 Host 注入接线（`tests/app/PC2-joint-routes-prepare.test.ts:45`、`:55`、`:81`）。

所给差异清单未列四个冻结夹具的修改；当前材料没有它们的冻结版本副本，因此这里不声称完成了四夹具的逐字节比对（`.lead-ref/all-files.txt:56`、`:72`；冻结要求见 `.lead-ref/books/run-pc2.md:61`）。

DSH 自述核对：

- **§8.3，Host 构造磁盘源再注入 composition：成立。** 有设置目录时注入，无目录时保留平台源（`src/app/host.ts:356`、`:558`；`src/composition/create-platform.ts:1192`）。其他直接装配脚本未配置 settings，也没有执行模型的 runtime，不构成有设置目录却退回平台源的生产路径（`scripts/graph-session-demo.mjs:54`；`scripts/verify-isolated.mjs:31`）。
- **§8.3，保存父目录同时限制在包内与 prompts 内：这项包含检查本身成立且无害。** 保存后的文件也必须满足读入时的包内限制（`src/app/prompt-packs.ts:74`、`:354`）。但一律拒绝包内目录链接不成立，见 H-06。
- **§8.3，坏包列表展示可读链声明：成立，属于合理选择。** 书要求保留问题，没有要求只展示本包声明；请求包 manifest 不可读时链为空，仍得到 `templates: []`（书 `:260`；`src/app/prompt-packs.ts:101`、`:219`、`:307`）。问题汇总与保留 id 的缺陷另见 H-07、H-08。
- **§8.3，不存在配置根可以跳过：不成立。** `validateWorkspaces` 不会拒绝它，后续访问也不补 prompts 覆盖检查，见 H-01。
- **§1.4，`section-extra` 先被未声明槽检查拒绝：成立；不能据此省略 H 的保存用例。** 夹具已有对应文本，直接通过保存路由即可验收，无需修改冻结夹具（`tests/helpers/PC2-pack-fixture.ts:188`；`src/contracts/prompts/render-template.ts:104`；H-10）。
- **§3 的 H/joint 覆盖完整性：不成立。** 设置到真实 Host 执行的链路及 PC-22 第三种保存拒绝未覆盖，见 H-09、H-10；回复中的测试运行数量未在本次只读审查中重验（`.lead-ref/replies/pc2-reply.md:17`、`:22`）。

```json
[
  {
    "id": "H-01",
    "class": "会出错",
    "file": "src/app/host.ts",
    "line": 263,
    "basis": ".lead-ref/books/pc2-book.md:76，裁定2；规格P1",
    "problem": "不存在的配置根被跳过，validateWorkspaces仅检查根字符串非空（host.ts:235）。该根仍由resolveRoot返回（host.ts:497）；后来创建为指向设置目录的链接后，workspace/access.ts:95直接解析它，未重查prompts覆盖关系。应完成真实路径检查后接纳，实际可以覆盖prompts。",
    "fix": "删除ENOENT放行分支；无法取得配置根真实路径时，启动报含根路径与提示词路径的配置错误。"
  },
  {
    "id": "H-02",
    "class": "违规",
    "file": "src/app/host-settings.ts",
    "line": 607,
    "basis": ".lead-ref/books/pc2-book.md:80，裁定2",
    "problem": "恢复根检查放在恢复循环内部。列表为合法A、非法B时，检查B之前已经调用A的恢复入口（610、611行），不符合恢复循环前检查全部恢复根的要求。",
    "fix": "先遍历全部恢复根完成检查，再进入现有恢复循环。"
  },
  {
    "id": "H-03",
    "class": "会出错",
    "file": "src/app/host-settings.ts",
    "line": 1050,
    "basis": ".lead-ref/books/pc2-book.md:259、:832，裁定6、PC-04",
    "problem": "有效包的text:17、工具entry.description:17及HTTP坏JSON返回invalid但没有problems；相关位置还有host-settings.ts:1119、server.ts:339。PC2-H-pack-routes.test.ts:129所谓broken body只测试坏包，没有提交坏请求体。",
    "fix": "提示词路由统一返回带problems的请求校验错误，HTTP坏JSON分支保持该契约；通过夹具rawBody入口补字面断言。"
  },
  {
    "id": "H-04",
    "class": "会出错",
    "file": "src/app/host-settings.ts",
    "line": 1041,
    "basis": ".lead-ref/books/pc2-book.md:267，裁定6保存顺序",
    "problem": "保存先要求旧包整体有效。版本7、旧正文BASE {{的模板，用正确版本保存合法正文，应按候选包校验后保存为8，实际在packForRoute返回invalid（955行）。旧版本6加text:17也先返回invalid，而非revision_conflict（1050、1057行）。",
    "fix": "保存先读链并取得有效供应者的版本或摘要，完成冲突比较，再替换候选条目并校验保存后的整包；移除旧包整体有效这一前置条件。"
  },
  {
    "id": "H-05",
    "class": "会出错",
    "file": "src/app/host-settings.ts",
    "line": 1072,
    "basis": ".lead-ref/books/pc2-book.md:272、:282，裁定6",
    "problem": "preparePackWriteTarget允许已存在的普通文件（prompt-packs.ts:357），保存直接覆盖它。合法manifest若把版本7指向templates/base@8.txt，保存版本8后、rename之前失败，应仍可见旧正文，实际旧manifest已读到新正文。工具保存1139行同样可覆盖已有目标。",
    "fix": "独占创建目标；已有普通文件仅在逐字节相同时复用，绝不覆盖不同内容。撞名错误码需lead裁定，建议unavailable并保留所有已有文件。"
  },
  {
    "id": "H-06",
    "class": "会出错",
    "file": "src/app/prompt-packs.ts",
    "line": 342,
    "basis": ".lead-ref/books/pc2-book.md:74、:94，裁定1、3；检查裁定7",
    "problem": "templates链接到同一包内真实目录时，真实父目录满足包内及prompts内限制，读取接受（70行），保存却因lstat().isDirectory()为假返回invalid；合法保存应成功。",
    "fix": "父目录先取realpath，再检查目录类型及两层包含关系，允许目标仍在包内的目录链接。"
  },
  {
    "id": "H-07",
    "class": "会出错",
    "file": "src/app/prompt-packs.ts",
    "line": 231,
    "basis": ".lead-ref/books/pc2-book.md:167、:259，整包问题汇总及裁定6",
    "problem": "任一模板或工具读失败就跳过A的整包校验。版本0且文件缺失的模板应同时返回版本及缺文件问题，实际只返回读失败。字符串文件读取错误也在117至119行丢失。",
    "fix": "保留各文件读取问题并继续校验可读链，合并、去重读取问题和A的校验问题后返回。"
  },
  {
    "id": "H-08",
    "class": "会出错",
    "file": "src/app/prompt-packs.ts",
    "line": 267,
    "basis": ".lead-ref/books/pc2-book.md:73、:260，裁定1、6",
    "problem": "存在prompts/platform目录时，扫描把platform加入ids，随后又手动在首位加入platform；应只有一个保留的平台包，实际列表有两个相同的平台包。",
    "fix": "扫描磁盘目录时排除保留id platform。"
  },
  {
    "id": "H-09",
    "class": "违规",
    "file": "tests/app/PC2-H-settings-model.test.ts",
    "line": 22,
    "basis": ".lead-ref/books/pc2-book.md:834，PC-05、PC-06、PC-08；§2测试规则",
    "problem": "设置测试只读快照且没有带旧pack/policy的启动catalog；joint通过installBinding替代设置修改（tests/runtime/PC2-joint-packs.test.ts:139），磁盘源也注入另一平台（tests/app/PC2-joint-routes-prepare.test.ts:45）。会漏过清除后恢复启动catalog旧值以及Host磁盘源接线缺失。语法测试101行只保存必然存在的platform，不能证明不检查存在性。",
    "fix": "用现有Host夹具的真实平台公开步骤贯通保存、选择、准备、启动及重启，检查A/B字面正文、执行冻结、新执行更新、清除后的默认值，并保存合法但不存在的pack id。"
  },
  {
    "id": "H-10",
    "class": "违规",
    "file": "tests/app/PC2-H-pack-routes.test.ts",
    "line": 251,
    "basis": ".lead-ref/books/pc2-book.md:882，PC-22",
    "problem": "保存测试只有role非首位和重复section，缺少调用类不允许的section；删掉该拒绝规则仍可通过现有两例。",
    "fix": "通过保存路由给query-copy-input添加footprint槽，字面断言问题，并比较保存前后全部文件字节。"
  },
  {
    "id": "H-11",
    "class": "违规",
    "file": "tests/app/PC2-H-directory-checks.test.ts",
    "line": 40,
    "basis": ".lead-ref/books/pc2-book.md:76、:84，裁定2；decision80",
    "problem": "现有路径没有同字符串前缀但无包含关系的目录，也没有覆盖既有根快捷返回顺序的输入。改为child.startsWith(parent)，或把覆盖检查移到既有根返回后，现有用例仍可通过。",
    "fix": "补两个公开入口反例：同字符串前缀的兄弟目录应成功；已登记根后来经链接解析成prompts上级，再打开必须invalid。"
  },
  {
    "id": "H-12",
    "class": "不整洁",
    "file": "src/app/prompt-packs.ts",
    "line": 234,
    "basis": "用户审查项5：不可达分支",
    "problem": "chain[0]?.packId === platform的真分支不可达：platform请求已在188至192行返回，其余成功路径首项必为请求的用户包（201、212、227行）。",
    "fix": "删除该条件分支，直接解析用户包目录，保留真实的解析失败处理。"
  },
  {
    "id": "H-13",
    "class": "不整洁",
    "file": "src/app/prompt-packs.ts",
    "line": 238,
    "basis": ".lead-ref/books/pc2-book.md:64；用户审查项6",
    "problem": "生产注释保留施工批次和替换过程；同类位置包括host-settings.ts:935、create-platform.ts:1189。",
    "fix": "改成当前职责和原因说明，删除批次及施工经过，保留路径边界、无缓存和原子发布规则。"
  }
]
```

会出错 7，违规 4，不整洁 2，建议 0