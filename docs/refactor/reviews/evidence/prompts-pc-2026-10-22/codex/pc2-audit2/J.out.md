只读审查发现 **4 项违规**。未运行测试、构建或联网；以下变异判断均为静态判断，不确认回信中的 RED/GREEN 执行记录。

| 编号 | 类别 | 位置（file:line） | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| J2-01 | 违规 | `tests/app/PC2-joint-routes-prepare.test.ts:133`、`:150`、`:228`、`:370` | 冻结表 `.lead-ref/books/pc2-findings.md:124`、`:125`、`:88`；前次唯一改法 `.lead-ref/audit1/J.out.md:7`、`:8` | Host 只解析人为构造的 RunRef，再把 selection 复制给独立 Work 夹具。旧准备启动时，实际承载它的绑定也没有经历设置更新。这不能证明同一 Host 的设置→准备→启动链。具体漏检：删除 Host 注入磁盘包源的 `src/app/host.ts:558`，这些测试仍自行创建磁盘源，仍可通过，真实 Host 却不能准备所选个人包。 | 在现有 Host 夹具暴露的平台上，经公开 owner 创建并领取 Work，直接调用其 `prepareExecution/startRun/readPromptRecord`，由 `host.model.requests` 验看；覆盖双模型、同 modelId A→B、清空和重启。删除复制 selection 到另一 Work 世界的替代链。下面列出可用公开路径。 |
| J2-02 | 违规 | `tests/runtime/PC2-joint-history.test.ts:174`、`:179`、`:185` | 冻结表 `.lead-ref/books/pc2-findings.md:128`、`:119`；前次唯一改法 `.lead-ref/audit1/J.out.md:11` | LA-1 已走新 Session 的公开链，但“历史前缀”只检查简报的一句说明；模型请求仅数提醒。把启动时的 `sessionBasis` 改为 `undefined`（`src/core/agent-runtime/execution-driver.ts:781`），会丢掉源 Session 历史，准备中的说明和提醒仍在，这些断言仍可通过。 | 保留现有公开步骤，增加对新 Session 实际请求中历史消息前缀的完整断言；期望来自本例独立手写的旧输入或脚本预设消息，不能复制第一次捕获请求。保留提醒数 1，并用上述启动侧丢 basis 的变异验证。 |
| J2-03 | 违规 | `tests/runtime/PC2-joint-tools.test.ts:179`、`:181`、`:192` | 冻结表 `.lead-ref/books/pc2-findings.md:133`；前次唯一改法 `.lead-ref/audit1/J.out.md:16`；期望值规则 `.lead-ref/books/run-pc2-r1.md:45` | Skill 是整文比较，但 brief 仅检查开头和 `BRE/BE` 后缀，再把 manifest 截出的 `briefText` 当作请求期望。marker 与后缀之间多出一个字符仍可通过；入口也调用同一 brief renderer，不能替代独立期望（`src/core/work-graph/tasks/execution-entry-service.ts:1304`）。 | 根据公开场景输入独立构造预期 brief 数据，按契约手算规范 JSON 的 SHA-256 和完整 marker，形成完整 `marker+BRE/BE` 期望；分别整段比较准备结果和实际请求中的 brief，不使用 manifest 正文作为期望。 |
| J2-04 | 违规 | `tests/runtime/PC2-joint-tools.test.ts:75`、`:83`、`:90`、`:240`、`:297` | 冻结表 `.lead-ref/books/pc2-findings.md:136`、`:121`；前次唯一改法 `.lead-ref/audit1/J.out.md:196`；规格 `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md:191` | 只完整比较 `list_files`、`record_note`；其余工具只检查名字和三个禁用子串。把 `read.description` 改成任意其他文字，仍满足全部断言。解析再序列化也放过原 body 的空白变化。两个 SHA 断言只校验测试常量，没有校验整个实际 body 的引用 digest。 | 为 Work、Query 分别手写包含全部工具的完整规范 JSON，与原始 `toolSpecsRef` body 整文比较；同时将实际 `toolSpecsRef.digest` 和 `toolsDigest` 与该完整字面正文的 SHA-256 比较。 |

J2-01 的公开路径无需改冻结夹具：`PC2HostStart` 已允许配置 `kernelStores`，返回值暴露 `live.platform` 和脚本模型（`tests/helpers/PC2-host-fixture.ts:48`、`:164`、`:234`）。可以在测试中沿公开接口建立项目、工作区、完成策略、架构、Goal、Plan、Session 和 claim；已有公开步骤示例见 `tests/helpers/WP2-platform-support.ts:266`、`:292`、`:304`、`:308`、`:312`、`:320`。随后在 **Host 自己的平台** 调用准备、启动和读记录。`workflow` 缺省不撤销这些 Runtime 接口；组合层仍提供 `createSession`（`src/composition/create-platform.ts:1453`），Host 仍装配 runtime 和包源（`src/app/host.ts:552`、`:558`）。

逐行结论：

- J-01: J2-01。回信所称“不保存 promptPack”会被 selection 字面断言抓住，但不能补齐 Host 执行链（`tests/app/PC2-joint-routes-prepare.test.ts:186`）。
- J-02: J2-01。同 modelId 保存已做到；“settingsModelBinding 不回填”会被抓住，但旧准备仍在另一套绑定中启动（`tests/app/PC2-joint-routes-prepare.test.ts:233`、`:235`、`:237`）。
- J-03: OK。旧、新当前输入整文比较，输入 digest 来自独立字面正文；记录也核了 base 正文及 digest。“标签固定”会失败（`tests/runtime/PC2-joint-packs.test.ts:174`、`:176`、`:182`、`:222`、`:223`、`:229`）。
- J-04: deferred, untouched；未增加派生 Query 历史用例，历史夹具不在 J 改动清单内（`.lead-ref/books/pc2-findings.md:127`、`.lead-ref/parts/J-files.txt:1`）。
- J-05: J2-02。公开新 Session 链已补，实际历史前缀未验（`tests/runtime/PC2-joint-history.test.ts:138`、`:151`、`:159`、`:185`）。
- J-06: deferred；非空 K3 seed 未补。现有空基线仅按 F1/J-07 删除独立规则调用、增加启动断言，属于获准重叠修改（`.lead-ref/parts/J.diff:513`、`tests/runtime/PC2-joint-history.test.ts:219`）。
- J-07: OK，按 narrowed 裁定。五种现有情形分别核 manifest 布尔和启动提醒数；反转 recipe 会失败（`.lead-ref/books/pc2-findings.md:130`、`tests/runtime/PC2-joint-history.test.ts:81`、`:92`、`:166`、`:200`、`:222`）。
- J-08: deferred, untouched；零预算仍是原纯渲染例，未把它冒充新增真实链（`tests/runtime/PC2-joint-history.test.ts:232`、`.lead-ref/parts/J.diff:529`）。
- J-09: deferred, untouched；三工具仍保留原纯渲染例（`tests/runtime/PC2-joint-tools.test.ts:118`、`.lead-ref/parts/J.diff:1004`）。
- J-10: J2-03。“传空工具清单”能被 read 情形抓住，但整文门槛未达到（`tests/runtime/PC2-joint-tools.test.ts:157`、`:182`、`:189`）。
- J-11: OK。真实收缩、整段 review/reminders、范围、计费和入口已经连起来；恢复旧 sections 会被完整范围断言抓住（`tests/runtime/PC2-joint-shrink-entry.test.ts:126`、`:135`、`:143`、`:157`、`:160`）。
- J-12: OK。Query 准备后改包仍断言旧文本；Work 开始及恢复都核两项工具文本。“重新读取当前包”会失败（`tests/runtime/PC2-joint-tools.test.ts:274`、`:284`、`:325`、`:340`、`:353`）。
- J-13: J2-04。“只留两短条”会被名单或完整对象断言抓住，但其他工具正文变异仍漏检（`tests/runtime/PC2-joint-tools.test.ts:77`、`:79`、`:83`）。
- H-09: J2-01；随 J-01/J-02（`.lead-ref/books/pc2-findings.md:88`）。
- T-09: OK，随 J-11（`.lead-ref/books/pc2-findings.md:101`）。
- G-09: OK，随 J-11（`.lead-ref/books/pc2-findings.md:112`）。
- Q-06: OK，随 J-11（`.lead-ref/books/pc2-findings.md:118`）。
- Q-07: J2-02；同 Session 启动已补，LA-1 缺实际前缀断言；Query/K3 非空历史部分继续 deferred（`.lead-ref/books/pc2-findings.md:119`、`tests/runtime/PC2-joint-history.test.ts:107`、`:185`）。
- Q-08: OK，随 J-12（`.lead-ref/books/pc2-findings.md:120`）。
- Q-09: J2-04，随 J-13（`.lead-ref/books/pc2-findings.md:121`）。

F1 在 J 中要求删除的独立规则调用及生产边界期望已删除（`.lead-ref/books/pc2-findings.md:33`、`.lead-ref/parts/J.diff:362`、`:395`）。J 的五个改动文件均为获准测试，没有生产或冻结夹具 hunk；未见提高原超时，新例均不超过 `60_000`（`.lead-ref/parts/J-files.txt:1`、`.lead-ref/books/pc2-r1-whitelist.txt:17`、`.lead-ref/parts/J.diff:144`、`:193`、`:330`、`:896`、`:1060`）。

DSH 自述涉及本部分的结论：

- **§1.2：“没有完整 Host 执行链”成立；“冻结夹具因此无法承载”不成立。** 当前确实拆成两套世界，但公开平台和 Kernel 配置入口均已暴露，见 J2-01（`.lead-ref/replies/pc2-r1-reply.md:10`）。
- **§1.3：“逐工具完整对象＋名单等价于整块正文”不成立。** 实际只有两个工具完整比较，且没有整块实际正文的 digest 断言，见 J2-04（`.lead-ref/replies/pc2-r1-reply.md:11`）。
- **§1.5：J 的四个 deferred 项未补做，成立。** K3 空基线上的修改由 F1/J-07 授权；“same-as 都完成”则不成立，H-09、Q-07 的 LA-1 部分、Q-09 仍对应上述发现（`.lead-ref/replies/pc2-r1-reply.md:13`、`:89`）。
- **§3 J-05 的变异声明不能笼统成立。** 若“忽略 basis”发生在准备的模式规则，布尔断言会失败；若仅发生在启动的历史选择，现有断言会漏过，见 J2-02（`.lead-ref/replies/pc2-r1-reply.md:82`、`src/core/agent-runtime/execution-driver.ts:781`）。

J-11 数字独立核算成立：

- review 七段 UTF-8 长度为 `109+126+95+50+160+108+129=777`；reminders 为 `12+1+11+1+16=41`（`tests/runtime/PC2-joint-shrink-entry.test.ts:52`、`:53`、`:54`、`:55`、`:56`、`:57`、`:58`、`:60`）。
- 前言为 125；按固定输入和拼接规则，角色段为 495、Goal 段为 32、Task 段为 715（`resources/prompts/platform/strings.json:55`、`:131`、`src/core/agent-runtime/context-fact-text.ts:63`、`:234`、`tests/helpers/K3-review-card-fixture.ts:107`、`:115`、`tests/helpers/S5-decision-fixture.ts:453`）。
- 因而 review 起点为 `125+2+495+2+32+2+715+2=1375`，终点 `1375+777=2152`；提醒起点 `2152+2=2154`，终点及总长 `2154+41=2195`，与断言一致（`tests/runtime/PC2-joint-shrink-entry.test.ts:141`、`:147`、`:148`）。
- 计费为提醒正文加前置双换行：`41+2=43`；预算 4096 来自夹具明确配置（`src/core/agent-runtime/context-rendering.ts:326`、`tests/helpers/K3-35-runtime.ts:107`、`tests/runtime/PC2-joint-shrink-entry.test.ts:152`）。

```json
[
  {
    "id": "J2-01",
    "class": "违规",
    "file": "tests/app/PC2-joint-routes-prepare.test.ts",
    "line": 150,
    "basis": ".lead-ref/books/pc2-findings.md:124、125、88；.lead-ref/audit1/J.out.md:7、8",
    "problem": "Host只解析构造的RunRef，再复制selection给独立Work夹具；旧准备所在绑定没有经历设置更新。删除src/app/host.ts:558的磁盘包源注入，当前测试仍自行创建磁盘源而通过，不能证明Host自身的设置到准备、启动链。",
    "fix": "使用冻结Host夹具暴露的live.platform和启动kernelStores选项，经公开owner建立并领取Work，直接调用该平台的prepareExecution、startRun、readPromptRecord并检查host.model.requests；覆盖双模型、同modelId换包、清空和重启，删除复制selection到另一Work世界的替代链。"
  },
  {
    "id": "J2-02",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-history.test.ts",
    "line": 185,
    "basis": ".lead-ref/books/pc2-findings.md:128、119；.lead-ref/audit1/J.out.md:11",
    "problem": "LA-1仅检查简报中的历史说明及请求内提醒数，没有检查实际历史消息前缀。仅将src/core/agent-runtime/execution-driver.ts:781的sessionBasis改为undefined，源历史丢失而现有断言仍可通过。",
    "fix": "保留公开新Session链，在实际模型请求中完整比较独立手写的历史消息前缀，期望来自场景输入或脚本预设消息，不复制捕获请求；保留提醒数1，并验证启动侧丢basis的变异会失败。"
  },
  {
    "id": "J2-03",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-tools.test.ts",
    "line": 179,
    "basis": ".lead-ref/books/pc2-findings.md:133；.lead-ref/audit1/J.out.md:16；.lead-ref/books/run-pc2-r1.md:45",
    "problem": "brief只检查开头和BRE/BE后缀，再以manifest截取的briefText作为请求期望。marker和后缀之间多一个字符仍可通过，不满足独立期望和整文比较。",
    "fix": "按公开场景输入独立构造预期brief数据并计算规范JSON的SHA-256及完整marker，形成完整marker+BRE/BE期望，分别整段比较准备结果和实际请求中的brief，不使用manifest正文作为期望。"
  },
  {
    "id": "J2-04",
    "class": "违规",
    "file": "tests/runtime/PC2-joint-tools.test.ts",
    "line": 75,
    "basis": ".lead-ref/books/pc2-findings.md:136、121；.lead-ref/audit1/J.out.md:196；docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md:191",
    "problem": "完整规格断言只覆盖list_files和record_note，其余工具只核名字和三个禁用子串；修改read.description仍通过。解析再序列化还忽略原body空白，SHA断言只验证两个测试常量，没有验证整个实际正文引用。",
    "fix": "为Work和Query分别手写包含全部工具的完整规范JSON，与原始toolSpecsRef正文整文比较，并将实际toolSpecsRef.digest及toolsDigest与该完整字面正文的SHA-256比较。"
  }
]
```

会出错 0，违规 4，不整洁 0，建议 0