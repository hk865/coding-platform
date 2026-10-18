任务书目前不能直接交给 DSH。第 1 项的修复方向正确，但格式、作用域校验、跨次复用和容量测试尚未闭合；第 2、3 项没有覆盖完整的异步失败边界；第 4、5 项仍把测试入口和取舍留给了施工者；第 6 项与本轮测试规则存在冲突。

本次只读核对，未修改文件，未运行测试或构建。以下“可达”均指沿代码核对可达，不表示实际执行通过。文件名无歧义时用短文件名，行号均指当前 `s8l8-r1` 副本。

1. 任务书引用的逐项核对如下。

| 任务书位置 | 引用 | 结论及准确位置 |
|---|---|---|
| `.lead-ref/l8-rework-2.md:25` | `architecture-service.ts ~369` | **对。** `serializeFileGraphChunks` 在 `architecture-service.ts:368`，不含范围的空块模板在 `architecture-service.ts:369`。 |
| 同上 | `architecture-service.ts ~698` | **对，但描述略强。** 来源检查在 `architecture-service.ts:698`；当前允许 `origin.workspaceId` 缺失，仅在其存在时检查一致，见 `architecture-service.ts:699`。 |
| 同上 | `body-store.ts ~39` | **对。** 首写保留发生在 `body-store.ts:39`，重用时返回首写引用在 `body-store.ts:46`。 |
| `.lead-ref/l8-rework-2.md:27` | `architecture-service.ts ~1054` | **对。** 这是显式 `previous` 的加载；省略 `previous` 时还有 `architecture-service.ts:1040`、`architecture-service.ts:1044`。 |
| 同上 | `architecture-service.ts ~1407` | **对，但未列全。** 这是提醒的 current 加载，previous 加载在 `architecture-service.ts:1418`。 |
| `.lead-ref/l8-rework-2.md:34` | `auto-capture-driver.ts ~163` | **对。** 此处已经取得开始快照；读取本身在 `auto-capture-driver.ts:159`。 |
| 同上 | `auto-capture-driver.ts ~178` | **对。** 非 ready 直接退出。 |
| 同上 | `auto-capture-driver.ts ~180` | **对。** catch 在此，静默退出在 `auto-capture-driver.ts:181`。 |
| `.lead-ref/l8-rework-2.md:36` | `catalog-service.ts ~364` | **结论对，证据位置不完整。** 此处是内部返回类型；实际 current 读取在 `catalog-service.ts:786`，内部读取在 `catalog-service.ts:379`、`catalog-service.ts:388`，缺指针返回 `not_found` 在 `catalog-service.ts:382`，确实没有产生 `not_ready` 的分支。 |
| `.lead-ref/l8-rework-2.md:38` | `context-assembler.ts ~1043` | **对。** catch 无条件降级在 `context-assembler.ts:1043`、`context-assembler.ts:1044`。 |
| 同上 | `execution-preparation.ts ~270` | **对。** 此处只检查 assembler 的返回状态，没有在这里检查取消。 |
| `.lead-ref/l8-rework-2.md:39` | `execution-preparation.ts ~298` | **对。** 此处写准备材料。 |
| `.lead-ref/l8-rework-2.md:41` | `S8A-L8-reminders-public.test.ts ~497` | **对。** 实际注入的是返回 `rejected/cancelled`，在 `S8A-L8-reminders-public.test.ts:501`，没有在读取期间触发 signal。 |
| `.lead-ref/l8-rework-2.md:43` | `S8A-L8-observation-state.test.ts ~255` | **位置对，分类应拆开。** 此处是直接读 record store，不是重复登记通知。 |
| 同上 | `~311` | **对。** 无新登记的重复 `workspaceRegistered`。 |
| 同上 | `~336` | **对。** 是 watermark 断言，前面的直接读库调用在 `S8A-L8-observation-state.test.ts:334`。 |
| 同上 | `~356` | **对。** 无新登记的重复通知。 |
| `.lead-ref/l8-rework-2.md:47` | `S8A-L8-capture-mappings.test.ts ~292` | **对。** 自编失败交给 `failAutoCapture`；前面还直接写了请求，见 `S8A-L8-capture-mappings.test.ts:286`。 |
| `.lead-ref/l8-rework-2.md:49` | `S8A-L8-observation-state.test.ts ~598` | **对。** 直接调用 reader，没有经过 prepare。 |
| `.lead-ref/l8-rework-2.md:50` | `~621` | **对。** 第二次同样直接调用 reader。 |
| `.lead-ref/l8-rework-2.md:52` | `l8-rework1.diff ~1397` | **无法核对。** 输入包没有这个文件。应改引当前代码，或把历史 diff 加入输入包。 |
| `.lead-ref/l8-rework-2.md:53` | `S8A-L8-auto-capture-gate.test.ts ~268` | **对。** 调用的是 `driver.close()`。 |
| 同上 | `~291` | **对。** 调用的是 `retryPending()`，不是启动真实 Host。 |
| `.lead-ref/l8-rework-2.md:55` | 419 文件、3904 通过等 | 这是 lead 提供的既有运行结果。本次未重跑，不能把它当成本轮修改的验证结果。 |

规则表还有同一个定位错误：`.lead-ref/test-rule-sheet.md:71` 把 `S8A-L8-observation-state.test.ts:255` 当作伪登记通知例子；应改成 `S8A-L8-observation-state.test.ts:311`。`255` 应继续归到 F7。

任务书使用 `.dsh-ref/`，审查包使用 `.lead-ref/`。这是交付目录映射，不是代码问题；发给 DSH 时应确保任务书和规则表都实际出现在约定位置，并明确规则表优先于 coordinator，依据 `.lead-ref/test-rule-sheet.md:3`。

2. 第 1 项需要把“范围参与摘要”写成完整格式约定。

当前影响链如下，不能只改 `serializeFileGraphChunks`。

| 环节 | 当前代码及所有直接调用关系 | 本轮应冻结的处置 |
|---|---|---|
| 块类型 | `src/core/work-graph/architecture/contracts.ts:47`；codec 使用该类型的别名在 `architecture-record-codecs.ts:44` | 加必填 `projectId`、`workspaceId`。明确仍用 `schemaVersion: 2`，还是另换当前版本号。建议保持 2，直接替换当前格式。 |
| 图归一化 | `normalizeFileGraph` 在 `architecture-service.ts:349`；生产调用在 `architecture-service.ts:1117` | 范围属于块封装，不改变文件路径排序、全局节点索引、文件 digest。无需把工作区 ID 掺进文件内容摘要。 |
| 块编码 | `serializeFileGraphChunks` 在 `architecture-service.ts:368`；唯一生产调用在 `architecture-service.ts:1129` | 明确传入已验证的 workspace scope，四种块——节点、边、unresolved、空图——都带相同范围。 |
| 分块容量 | `packFileGraphChunks` 在 `architecture-service.ts:302`；三次调用在 `architecture-service.ts:380`、`architecture-service.ts:381`、`architecture-service.ts:382` | 完整 JSON 的 UTF-8 字节数包含范围、引号、转义和数组封装。 |
| 写前校验 | `validateObservedFileGraphChunkV2` 在 `architecture-record-codecs.ts:318`；生产调用在 `architecture-service.ts:1136` | exact keys、字段值校验和返回值都要更新，不能只接受字段却在返回值中丢掉它们；当前返回值在 `architecture-record-codecs.ts:334`。 |
| 解码 | `decodeObservedFileGraphChunk` 在 `architecture-record-codecs.ts:338`，内部调用 validator 在 `architecture-record-codecs.ts:341`；唯一生产读调用在 `architecture-service.ts:706` | 只接受带范围的新格式。块中范围必须与本次读取的 canonical observation 范围一致。不能用 origin 替代正文范围检查。 |
| 合并 | `mergeObservedFileGraphChunks` 在 `architecture-record-codecs.ts:354`；唯一生产调用在 `architecture-service.ts:710` | 明确范围检查在逐块解码处完成，合并仍处理节点、边和计数；不可在合并时丢弃不匹配块或把其当空块。 |
| manifest | manifest 类型在 `src/core/work-graph/architecture/contracts.ts:29`；引用解码在 `architecture-record-codecs.ts:277`；manifest 解码在 `architecture-record-codecs.ts:295`；构造在 `architecture-service.ts:1157` | 不必把范围再复制进 manifest；块引用的 digest、size 自然随正文变化。保留 64 块限制。 |
| 持久观测记录 | 编码在 `architecture-record-codecs.ts:753`，解码在 `architecture-record-codecs.ts:785`；写入在 `architecture-service.ts:1207` | 保留实际存储返回的块引用，不从本次 capture 重新拼造引用。 |
| 正文存储 | `body-codec.ts:148` 的键只有 contentType、digest、size；编码摘要和大小在 `body-codec.ts:240`、`body-codec.ts:244`；首写保留在 `body-store.ts:39` | 不改全局 content-store 键、不覆盖首写 origin、不做迁移。范围通过正文改变摘要来隔离。 |
| SQLite 存储 | 插入冲突保留原行在 `sqlite-body-store.ts:29`；共用 RawArtifactBodyStore 在 `sqlite-body-store.ts:48` | 与 memory 同一语义，不另做 SQLite 特例。 |
| 原始读取验证 | body 自身摘要、大小复核在 `body-codec.ts:283`；块引用一致检查在 `architecture-service.ts:697`；块摘要、大小复核在 `architecture-service.ts:702` | 均保留。 |
| origin | `architecture-service.ts:698` | 必须明确新格式块是否要求 `origin.workspaceId` 必填且相等。建议对这些块要求完整匹配；不要修改整个通用 body-store 的 origin 协议。 |
| 路径授权 | 节点路径在 `architecture-service.ts:714`；语言问题路径在 `architecture-service.ts:720`；主正文配置路径在 `architecture-service.ts:646` | 全保留；正文有范围不等于已获当前路径授权。 |

这里有三个容易直接导致下一轮失败的遗漏。

第一，空块也必须计容量。当前单项超限检查只在循环里执行，见 `architecture-service.ts:309`、`architecture-service.ts:314`；空图靠 `alwaysFlush` 直接生成一块，见 `architecture-service.ts:325`。加入范围后，长 ID 或很小的 `chunkBytes` 会让“没有节点的块”自身超限。任务书只说“更新 byte limit”，没有明确这一实例。

第二，不宜继续靠在整段 JSON 中搜索字段文本来切数组。当前找数组位置用 `indexOf('"nodes"')`、`indexOf('[]')` 等，见 `architecture-service.ts:370`。加入前置范围字段后，合法 ID 本身可能是 `nodes` 或包含 `[]`，搜索就可能命中字符串值。当前范围只要求非空，见 `architecture-service.ts:163`；Project 和 Workspace 的公开写入也只作相应非空校验，见 `project-bootstrap-service.ts:559`、`project-bootstrap-service.ts:633`。应冻结为由已 JSON 转义的范围值和固定字段结构直接组装封装，不能在包含用户字符串的整段 JSON 里定位数组。

第三，同一工作区跨 capture 重用块必须继续成立。存储重用返回首写引用，见 `body-store.ts:46`；`sameArtifactRef` 的身份不包含 source，见 `src/contracts/material-access.ts:86`；服务当前保留 put 返回的引用，见 `architecture-service.ts:1155`。因此：

- 块正文只能加稳定范围，不能再加 captureId、requestId、时间或 sourceDigest。
- 不得新增“块 origin.requestId 必须等于本次 capture 请求”的限制。
- 不得要求复用块的 source revision/sourceDigest 等于最新 capture。
- 不得用本次 sourceRef 替换存储返回的首写 ref，否则当前完整引用检查会拒绝它，见 `architecture-service.ts:697`。

这些都应写进裁定，而不是让 DSH 从失败测试中反推。

3. 第 1 项的下游读者已经追到以下出口。

`readFileGraphChunks` 只有两条生产入口：`loadObservation` 的调用在 `architecture-service.ts:635`，`loadFileGraph` 的调用在 `architecture-service.ts:752`。

`loadObservation` 的全部直接调用是：

- capture 省略 previous 时加载当前观测：`architecture-service.ts:1044`。
- capture 显式传 previous：`architecture-service.ts:1054`。
- 提醒加载 latest、previous：`architecture-service.ts:1407`、`architecture-service.ts:1418`。
- 查询观测架构：`architecture-service.ts:1454`。
- 比较两次观测，前后各一次：`architecture-service.ts:1485`、`architecture-service.ts:1487`。
- 查询架构影响：`architecture-service.ts:1513`。

`loadFileGraph` 的全部直接调用是文件页公共实现 `readFilePage`，见 `architecture-service.ts:918`，以及正式架构对观测的比较，见 `architecture-service.ts:1611`。文件页公共实现再由 `listFiles`、`neighbors`、`impact` 调用，见 `architecture-service.ts:1536`、`architecture-service.ts:1556`、`architecture-service.ts:1578`。

这里需要区别四种摘要或身份：

| 值 | 下游用途 | 本轮是否改变含义 |
|---|---|---|
| 块正文 digest | 存储键、引用和读取完整性，见 `body-codec.ts:148`、`architecture-service.ts:702` | **改变：范围进入正文，所以进入摘要。** |
| 文件节点 digest | previous 导出文件、提醒移动判断，见 `architecture-service.ts:640`、`architecture-service.ts:1410`、`architecture-service.ts:1421`、`architecture-reminders.ts:94` | 不变，仍是文件内容身份。 |
| 架构节点 contentDigest | 观测架构差异，见 `architecture-record-codecs.ts:460`、`architecture-delta.ts:102` | 不变。 |
| capture/命令身份 | 命令指纹和分页身份，见 `architecture-service.ts:984`、`file-graph-index.ts:48` | 不因块封装增加范围而改写规则。 |

`observationState` 不读取块，只读指针、请求和观测记录，见 `architecture-service.ts:1364`、`architecture-service.ts:1369`、`architecture-service.ts:1373`。因此仅断言 `observationState.ready`，不能证明新块能被读取；必须实际走 previous 加载、文件页、查询或 prepare。

HTTP 暴露的是持久 capture 引用和派生结果，不是块正文：DTO 由 owner 类型派生，见 `core-http-types.ts:306`；路由绑定见 `core-routes.ts:656`，派发见 `core-routes.ts:920`。UI 保存 capture 引用，见 `src/ui/state/apply-result.ts:63`；下次捕获把它作为 previous 传回，见 `src/ui/views/setup/requests.ts:207`；查询使用同一引用，见 `src/ui/views/setup/requests.ts:215`。这条链应保持，不需要把块 decoder 搬进 HTTP 或 UI。

提醒生产链是 `create-platform.ts:747` 创建真实 reader，`create-platform.ts:1085` 交给 Runtime，`context-assembler.ts:1040` 消费；Runtime 的 prepare 入口见 `runtime.ts:602`，Workflow 调用见 `workflow.ts:1841`。第 1 项回归必须走到这条链，不能只测 `readReminderFacts`。

4. 构造或读取块的测试也需要逐处列入任务书。

| 测试 | 当前实例 | 必须明确的改法 |
|---|---|---|
| `S8D-observed-v2-codecs.test.ts` | writer 调用在 `54`、`82`、`95`、`188`；decoder 调用在 `58`、`84`、`111`、`112`、`113`、`114`、`117`、`122`、`134`、`135`、`140`、`141`、`142`、`156`、`169`、`193`；validator 调用在 `130`、`132`、`133`；merge 调用在 `149`、`162`、`164`、`172`、`175` | 所有当前格式输入带有效范围，所有需要的新增实参补齐。`chunkJson` 在 `105`，另有独立字面量在 `118`、`126`，不能只改 helper。空块精确期望在 `87`。 |
| 同文件容量 | `CAP = 240` 在 `41` | 加范围后这个 cap 不再保证一节点能放下。应按冻结 scope 手算新 cap，不放松“一节点能放、两节点不能放”的语义。 |
| `S8E-old-format-rejection.test.ts` | 无范围 v2 当前被接受，见 `54`；旧版拒绝在 `64`；坏边输入在 `65` | `54` 改为新格式成功例；另加无范围旧格式拒绝。坏边例必须补合法范围，确保只因坏边失败，不能让旧断言靠“缺范围”继续变绿。 |
| `S8E-A12-file-chunks.test.ts` | 57 字节封装手算在 `39`，240 cap 在 `41`；65 块手算在 `93`，精确断言在 `122` | 重算封装，保留跨块索引和精确 65 块行为；不可把拒绝改成只匹配 `capacity`。 |
| `S8E-A28-chunk-contract.test.ts` | 过长 specifier 在 `40`，极小 cap 在 `56` | scope 必须有效；原来针对 specifier 的例子仍须只因 specifier 失败；极小 cap 仍验证容量。 |
| `S8A-file-layer.test.ts` | 分块读取在 `307`、`317`；1 字节 cap 在 `327`，64 块原因断言在 `330` | 保留现有“同时触发单项超限和块数超限时报告块数”的优先级，当前实现明确在 `architecture-service.ts:386`。不能被新空封装预检查意外替换。 |
| `S8A-L8-observation-state.test.ts` | 500 字节 cap 在 `569`；原始块数读取在 `576`、`604`、`614`、`628`、`630` | 删除读库取得预期块数的方式，按新格式手算，计数窗口移到真实 prepare。 |
| `S8A-L8-auto-capture-gate.test.ts` | 用不同文件内容避开共享块的说明和数据在 `33`、`35` | 不再把内容不同当作正确性的前提；新增同内容回归必须在同一实际存储中进行。 |

可直接冻结的容量手算如下：

- 旧空封装为 57 字节，依据现有手算 `S8E-A12-file-chunks.test.ts:39`。
- 增加两个字段后，对无需转义的 ASCII ID，空封装为 `89 + projectId 字节数 + workspaceId 字节数`。
- A12 的 workspace 固定为 `main`，见 `S8D-platform-fixture.ts:147`。`s8e-a12-chunks-memory/sqlite` 的新封装是 114 字节，`s8e-a12-cap-memory/sqlite` 的新封装是 111 字节；分别把 cap 定为 **297、294**，就保留原来的 183 字节数组内容预算，原有分块手算和精确 65 块目的不变。项目 ID 来源见 `S8E-A12-file-chunks.test.ts:56`、`S8E-A12-file-chunks.test.ts:113`。
- L8 计数例 scope 为 `s8a-l8-observation/main`，见 `S8A-L8-observation-state.test.ts:54`，新封装为 111 字节。该例的节点约 168 字节，两个节点正文为 `111 + 168 + 1 + 168 = 448`，500 字节 cap 仍是每块两个节点；12、13 个文件仍分别是 **6、7 块**。文件构造见 `S8A-L8-observation-state.test.ts:565`、`S8A-L8-observation-state.test.ts:611`。

非 ASCII、引号、反斜杠和空块边界另用纯编码例验证，不能把字符长度当 UTF-8 长度。

5. 第 2 项的 await 清单及应有结果如下。

下面区分三个结果：

- **失败出口**：没有取消且本次捕获尚未成功提交时，进入同一个 `failAutoCapture` 出口，使用开始快照的 revision；不能重读最新 revision 强写。
- **取消**：尚未开始不可撤回的提交时，不再提交观测或 failed，请求保留待重试。
- **已提交**：成功提交的事实不能因为后续取消、回读或清理而被解释成“没有提交”。

这分别对应旧裁定 3、5，见 `.lead-ref/l8-impl.md:46`、`.lead-ref/l8-impl.md:79`。新任务书只有 `.lead-ref/l8-rework-2.md:33` 的一句话，尚不足以区分这些边界。

先列 driver 的全部 await：

| await | 非取消的返回失败 | throw | abort |
|---|---|---|---|
| 开始快照 `readAutoCapture`，`auto-capture-driver.ts:159` | 没取得 revision，不能构造受该 revision 保护的失败写；保留 pending | 同左 | 退出，不写 |
| 开始观测状态 `observationState`，`auto-capture-driver.ts:175` | **本轮必须改为失败出口** | signal 未取消时映射 `unavailable`，进入失败出口 | 退出，不写 |
| 当前 catalog，`auto-capture-driver.ts:192` | `not_found` 是合法无目录；`not_ready` 按已接受例外保留 pending；其他失败进入失败出口 | 非取消进入失败出口 | 退出，不写 |
| capture，`auto-capture-driver.ts:212` | 非 cancelled 失败进入失败出口 | 非取消进入失败出口 | 未提交则退出；已成功提交不得再写 failed |
| failed 写，`auto-capture-driver.ts:229` | 保留 pending，不再启动第二轮失败写 | 保留 pending，当前 catch 在 `233` | **任务书未闭合：当前使用全新的未取消 signal** |

第一行不在“已取得快照之后”，但必须写明是例外，否则 DSH 可能把它也改成无可靠 guard 的失败写。

状态读取内部还有这些 await，均可使 `auto-capture-driver.ts:175` 返回失败或抛异常：

| 路径 | await 位置 |
|---|---|
| `observationState → readObservationStateBasis` | `architecture-service.ts:1364` |
| basis 读 current pointer、request | `architecture-service.ts:842`、`architecture-service.ts:844` |
| 两个 helper 的实际 record 读取 | `architecture-service.ts:808`、`architecture-service.ts:795` |
| current、previous 观测记录 | `architecture-service.ts:1369`、`architecture-service.ts:1373` |
| 观测记录 helper 的实际读取 | `architecture-service.ts:820` |

因此“开始观测读取失败”不能只针对第一个 pointer 读取。current 或 previous 记录读取失败也必须进入同一出口。当前服务仅入口检查取消，见 `architecture-service.ts:1351`，结束直接 ready，见 `architecture-service.ts:1378`；driver 必须对 await 返回后的 signal 作优先判断。

捕获服务从入口到提交的全部 await：

| await | 非取消返回失败／throw | abort |
|---|---|---|
| 幂等查找，`architecture-service.ts:992` | `not_found` 继续；其余失败返回，driver 进入失败出口 | 提交前停止 |
| 早期重放恢复，`architecture-service.ts:994`；内部 event 读取 `architecture-service.ts:767` | 这是已有提交的恢复读取，不能笼统当“捕获从未成功” | 不回滚已有提交 |
| 省略 mappings 时读 catalog，`architecture-service.ts:1011`；内部 `catalog-service.ts:786`、`379`、`388` | 无目录正常；其他失败返回／throw 由 driver 处理 | 停止 |
| 手动捕获读取开始 watermark，`architecture-service.ts:1024`；内部 `795` | 返回失败；手动调用没有 driver 代写 failed | 停止 |
| canonical Project/Workspace，`architecture-service.ts:1029`；内部 `534` | 失败返回；自动捕获由 driver 记录 | 停止 |
| 省略 previous 时读 pointer，`architecture-service.ts:1040`；内部 `808` | 同上 | 停止 |
| 省略 previous 时加载前次，`architecture-service.ts:1044` | 同上 | 停止 |
| 显式 previous 加载，`architecture-service.ts:1054` | 同上 | 停止 |
| 获取捕获，`architecture-service.ts:1065` | 工作区失败映射后返回 | 停止 |
| 第一次验证，`architecture-service.ts:1070` | 同上 | 停止 |
| 导出捕获，`architecture-service.ts:1072` | 同上 | 停止 |
| 文件图，`architecture-service.ts:1077` | 同上 | 停止 |
| 条件性的模块映射，`architecture-service.ts:1088` | 同上；条件不满足时无 await | 停止 |
| 主正文 put，`architecture-service.ts:1142` | 失败返回 | 已完成的 body put 可留下不可达正文，不能声称回滚 |
| 每块 put，`architecture-service.ts:1152` | 任一失败返回 | 同上，停止后续发布 |
| 第二次验证，`architecture-service.ts:1163` | 失败返回 | 停止 |
| 提交前 current pointer 读取，`architecture-service.ts:1173` | 失败返回 | 提交前停止，现有检查在 `1186` |
| 原子提交，`architecture-service.ts:1206` | 返回失败由 driver 处理；throw 需要明确是否保证未提交 | **必须定义提交边界，不能保证等待中的取消撤销提交** |
| 提交重放后的恢复，`architecture-service.ts:1211`；内部 `767` | 已有提交的回读错误，须单独处置 | 不回滚已有提交 |
| finally 清理，`architecture-service.ts:1216`；内部 release `454` | helper 吞清理异常，保持原结果 | 清理使用独立 signal，不能因此新增 failed |

两个 previous 加载内部的全部 await 为：

- 打开当前授权：`architecture-service.ts:599`。
- 读取观测记录：`architecture-service.ts:605`。
- 主正文读取：`architecture-service.ts:617`。
- 调用块读取：`architecture-service.ts:635`。
- 每块读取：`architecture-service.ts:694`。
- finally 释放授权：`architecture-service.ts:652`。

这些地方返回失败或抛异常，自动捕获都必须走相同的外层失败／取消分流。释放授权本身抛异常也会使加载失败，不能漏掉。

失败写内部还不是一个无等待的操作：

| await | 位置 | 应明确的处置 |
|---|---|---|
| 查失败写幂等结果 | `architecture-service.ts:1304` | 失败或 throw 后保留 pending；不循环写失败 |
| 恢复既有失败写 | `architecture-service.ts:1306`，内部 event 读取 `887` | 保留既有事实；不能覆盖新请求 |
| 再读请求记录以核 guard | `architecture-service.ts:1316`，内部 `795` | revision 不同即冲突，现有检查在 `1319` |
| 提交失败记录 | `architecture-service.ts:1327` | 使用开始 revision guard，见 `1328` |
| 重放恢复 | `architecture-service.ts:1333`，内部 `887` | 按已提交事实处理 |

当前 `failAutoCapture` 仅入口检查 signal，见 `architecture-service.ts:1284`；driver 又给它新 signal，见 `auto-capture-driver.ts:229`。关闭发生在这些 await 期间，仍可能写下 failed。任务书若继续承诺“取消不写”，就必须同时规定传递原捕获 signal，并在 failed commit 前复核。

底层 `records.commit` 没有 signal 参数，见 `src/core/record-store/ports.ts:194`；body put 同样没有，见 `src/core/record-store/body-ports.ts:25`。因此必须明确：取消在调用 commit 之前阻止提交；已经开始并成功完成的提交保持成功事实。不能要求实现做当前接口不提供的撤销。

6. 第 3 项的提醒及后续准备 await 清单如下。

提醒链并不只有 `context-assembler.ts:1040` 一个读取。

| await／返回的异步调用 | 非取消失败或 throw | 取消应有结果 |
|---|---|---|
| assembler 调 reminder reader，`context-assembler.ts:1040` | 单条“架构提醒不可用”，继续准备；旧裁定见 `.lead-ref/l8-rework-1.md:97` | `cancelled`，不得降级后继续 |
| composition 读 current catalog，`architecture-reminder-facts.ts:20`；内部 `catalog-service.ts:786`、`379`、`388` | `not_found` 合法进入无目录分支；其他失败最终走上述降级 | `cancelled` |
| composition 返回 observed reader 的 Promise，`architecture-reminder-facts.ts:22`、`25` | 同上。虽然没有写 `await`，仍是异步边界 | `cancelled` |
| 提醒读取 basis，`architecture-service.ts:1400`；内部 `842`、`844`、`808`、`795` | 同上 | `cancelled` |
| latest 加载，`architecture-service.ts:1407` | 同上 | `cancelled` |
| previous 加载，`architecture-service.ts:1418` | 同上 | `cancelled` |
| 每次加载内部 open／record／主正文／块／release | `architecture-service.ts:599`、`605`、`617`、`635`、`694`、`652`；任一失败或 throw 均使整体 reminder 读取失败 | `cancelled` |

“读取后检查 signal”必须涵盖 **返回 ready 但等待期间 signal 已取消** 的情况；只补 catch 会遗漏它。当前 `readReminderFacts` 只在入口检查取消，见 `architecture-service.ts:1382`，最后直接返回 ready，见 `architecture-service.ts:1429`。

提醒之后还有以下 await：

| await | 当前非取消语义 | 任务书需要补的取消语义 |
|---|---|---|
| 缺失输入的上游图事实，`context-assembler.ts:1074` | throw 转 unavailable，非 ready 留在可选信息回退，见 `1080`、`1086` | signal 已取消或明确返回 cancelled 时必须结束准备，不能被可选回退吞掉 |
| 每个已选择输入的第一页，`context-assembler.ts:1099` | throw 返回 unavailable，非 ready 原样返回，见 `1103`、`1106` | 返回后和 catch 都先判取消 |
| 续接 brief 组装，`context-assembler.ts:1135` | 失败按 helper 的 rejection 返回，见 `1136` | 返回后检查 signal，不能把 helper 吞掉的取消当成功 |
| continuation basis，`context-assembler.ts:901` | throw unavailable；非 ready 按读结果映射，见 `902`、`903` | 取消优先 |
| 候选 previous Turn 读取，`context-assembler.ts:922`；fallback `931` | retry 会阻止准备，见 `935`；正常 unavailable 事实可进入 brief | 取消不能降级成普通 unavailable 事实 |
| Turn bounds，`continuation-brief-assembly.ts:314` | unsupported/unreadable 转 retry unavailable，见 `315`；throw 向外传播 | 等待期间取消应返回 cancelled |
| Turn 窗口 helper，`continuation-brief-assembly.ts:220`、`251` | 保留既有 retry 与 unavailable 事实之别 | 取消优先 |
| 窗口每页读取，`continuation-brief-assembly.ts:181` | throw 当前转 retry unavailable，见 `183`；返回 cancelled 已转 retry cancelled，见 `189` | throw 时 signal 已取消也必须 cancelled |
| 工作区 brief 信息，`context-assembler.ts:936` | 非取消失败允许形成 unavailable 信息 | 返回后不能忽略取消 |
| 其内部 resolveRoot，`context-assembler.ts:795` | throw／失败形成 unavailable，见 `797`、`798` | 外层需保留取消事实 |
| 其内部 captureDigest，`context-assembler.ts:799` | catch 形成 unavailable | 同上 |
| 其内部 source.capture，`context-assembler.ts:804` | catch 转 null，形成 unavailable，见 `806` | 同上 |
| session basis，`context-assembler.ts:940` | 允许返回 null | 不能把取消后的 null 当正常完成 |
| session basis 每页读取，`context-assembler.ts:846` | catch 或非 ready 返回 null，见 `848`、`849` | 外层必须检查 signal |
| preparation 等 assembler，`execution-preparation.ts:264` | throw 转 unavailable，非 ready 返回，见 `267`、`270` | catch 和返回后先判取消 |
| 保存准备材料，`execution-preparation.ts:298` | throw unavailable；失败映射 capacity/unavailable，见 `302`、`305` | put 前检查取消；put 等待期间取消后不能返回 ready |

准备流程在提醒之前还有 execution、Role、Host 配置三处 await，分别在 `execution-preparation.ts:154`、`183`、`204`；已有阶段性 signal 检查在 `execution-preparation.ts:178`、`199`、`231`。不要把本次修复写成仅在 reminder catch 里多加一行，从而误以为整个准备过程都满足取消规则。

这里不要求重做续接模块的非取消策略。最小做法可以是在调用这些 helper 的外层复核 signal，并保持原有非取消失败语义；但任务书应明确这个边界。

另外，“取消不保存材料”只能对 **put 开始之前已发生的取消** 作严格承诺。put 已开始时，当前接口不能撤销，见 `body-ports.ts:25`；可以返回 cancelled 并留下不可达材料，不能用清理存储或虚构回滚来满足测试。

7. 第 4 项没有逐实例给出处置。建议冻结如下，不再保留“自行判断”。

| 实例 | 唯一处置 | 公开路径与可复用 helper |
|---|---|---|
| `S8A-L8-observation-state.test.ts:311` | 改成真实首次采用触发 | 复用现有 `adopt` 起点 `S8A-L8-observation-state.test.ts:183`，接真实提交回调；接线样例是 `S8A-L8-adoption-capture.test.ts:94`、`122`。 |
| 同文件 `356`、`369` | 第一次用真实采用制造失败，第二次用真实修订重试 | 搬走／恢复根目录后，调用公开 adopt/revise；修订步骤见 `S8A-L8-adoption-capture.test.ts:215`、`221`。 |
| 同文件 `418` | 运行中的第二个请求改成真实采用或修订；这里应固定为该行尚未采用时的首次采用 | 保留 `gatedTools`，见 `S8A-L8-observation-state.test.ts:88`；通过公开 `pending` 证明旧失败不覆盖后来的请求。 |
| 同文件 `494`、`502`、`508` | 均改成后续真实 catalog revision | 该行此前已采用，见 `S8A-L8-observation-state.test.ts:476`；每次先公开读当前 baseline，再用新 requestId 修订。故障包装只作用于 driver 的那次 catalog 读取，不能把用于提交 revision 的公开读取也一起破坏。 |
| 同文件 `255`；调用／断言 `334`、`336`、`443`、`557` | 删除 `pointerOf` 及直接 watermark 断言，逐条替换为公开 pending、current、previous 和晚提交结果 | `state` 在 `S8A-L8-observation-state.test.ts:215`，`waitForState` 在 `222`，真实捕获 gate 在 `88`。不是简单删断言。 |
| 同文件 `266`；调用 `576`、`604`、`614`、`628`、`630` | 删除 `chunkCountOf`，预期块数改为上述手算 6、7 | 保留真实文件与捕获；使用公开 `listFiles` 核对图内容，块数不再从库内取。 |
| 同文件 `598`、`621` | 改成一次真实 Runtime prepare 的计数窗口 | 保留 A3 records/body 包装思想 `582`、`587`，接入真实 composition 创建的 reader；不再直接调用 reader 作为被测动作。 |
| `S8A-L8-capture-mappings.test.ts:286`、`292` | **建议冻结删除该重复行 `281`，保留已有纯状态覆盖** | `requestedRecord` 在 `S8A-L8-auto-capture-state.test.ts:30`，`failedRecord` 在 `36`，requestedAt 保持的断言在 `58`。删除要列入 D1，不能让 DSH判断“若已覆盖则删”。 |
| `S8A-L8-auto-capture-gate.test.ts:207`、`221` | 改成真实首次采用、随后真实修订 | 当前 `openPlatform` 在 `71`，需接真实 `onArchitectureCaptureTrigger`，按 `S8A-L8-adoption-capture.test.ts:94`、`122` 的方式转发。 |
| `S8A-L8-reminders-public.test.ts:543`、`558` | 都改成真实修订触发 | 该夹具已经采用，见 `S8A-L8-reminders-public.test.ts:161`；保留搬走根目录、恢复后准备、再重试的顺序。 |
| `S8A-L8-reminders-public.test.ts:522` | 保留其“首次登记的真实原因”，但把通知与登记集中在一个 helper，避免延迟人工补发的模糊语义 | 登记在该夹具 `138`，driver 却到 `237` 才创建；重组为真实登记成功后立即转发一次。 |

其他首次登记通知有真实公开登记前置，可以保留，不应一律删除：观测状态测试的 `292`、`348`、`414`、`471`、`541`；gate 测试的 `169`、`172`、`198`、`200`、`258`、`260`、`318`、`320`。其公共登记 helper 分别在 `S8A-L8-observation-state.test.ts:155` 和 `S8A-L8-auto-capture-gate.test.ts:123`。

采用替代触发之后，还要同步调整精确重放命令中的 mappings。现在测试某些重放使用空 mappings，见 `S8A-L8-observation-state.test.ts:325`；生产命令指纹包含调用者 mappings，见 `architecture-service.ts:984`。真实采用后不能仍用旧空 mappings 去重放，再把出现的幂等冲突当生产问题。

读取计数应写清楚测量对象：

> 在一次完整的公开 `runtime.prepareExecution` 期间，计数架构提醒依赖所发生的 record/body 读取；准备的其他依赖读取不计入这组公式。准备完成后的材料公开读取也不计入。无 previous 时 5 次 record 读取、7 次 body 读取，共 12 次；有 previous 时 6 次 record 读取、15 次 body 读取，共 21 次。每个观测各加载一次，不另调用 observationState 或 reader 预热。

这个公式来自 catalog 两次读取、pointer/request 各一次、每观测一条记录与一个主正文，再加 6／7 块，见 `catalog-service.ts:379`、`388`，`architecture-service.ts:842`、`844`、`605`、`617`、`694`。它不是“整个 prepare 总共只有 12／21 次存储读取”。

8. 第 5 项也没有冻结可执行的真实 Host 门控办法。

现有 `openPlatform` 创建的是 platform 加独立 driver，见 `S8A-L8-auto-capture-gate.test.ts:108`、`113`。`closeWithQueuedSecondCapture` 在 `S8A-L8-auto-capture-gate.test.ts:254`，内部关闭 driver 在 `268`；重启例手动调用 `retryPending` 在 `291`。这能保留 driver 单元级行为覆盖，但确实不能证明 Host 关闭和启动接线。

真实入口已经存在：

- `startHost`：`tests/app/support/S8A-L8-host.ts:78`。
- `routeRegistered`：`tests/app/support/S8A-L8-host.ts:149`。
- `adoptInitial`：`tests/app/support/S8A-L8-host.ts:161`。
- `waitState`：`tests/app/support/S8A-L8-host.ts:135`。
- Host 关闭实际调用 autoCapture 再关闭 platform：`host.ts:1608`、`host.ts:1609`。
- Host 启动重试入口：`host.ts:1064`。

但现成 `startHost` 仅暴露 `lightScan`，见 `S8A-L8-host.ts:83`；这个 fault 的类型是同步 `void`，见 `typescript-light-scan.ts:15`，调用处不 await，见 `typescript-light-scan.ts:156`、`322`。**不能让 DSH 写一个 async lightScan fault，误以为它能挂住 capture。**

建议固定如下实现入口：

> 在测试侧对真实 `createObservedArchitecture` 工厂作 A3 委托包装，只包装其真实 `workspace.captureObservation`：记录进入和原 signal，在门上等待，释放后调用原依赖并原样返回。真实 Host、真实 driver、真实 platform 均保留。复用 `gatedTools` 的做法（`S8A-L8-observation-state.test.ts:88`），把这个包装集中到 Host 测试 support。不得新增生产测试钩子，不得用 lightScan fault 的未等待 Promise 作门。

公开序列应固定为：

1. SQLite 真实 Host，通过 route 创建项目并登记 A、B；A 的 capture 在上述门上，B 的请求已通过公开状态确认为 pending。
2. 断言 B 的 capture 进入次数为 0。
3. 调用真实 `host.close()`；等门观察到 A 的原 signal 被取消，再放行；等待 close 完成。
4. 用同一 SQLite 数据库启动新的真实 Host。启动重试期间仍可用同一类 A3 门观察请求。
5. 通过公开 observation-state 断言 pending 请求获得 `startup_retry`、序号只增加一次，最终满足；不得直接调用 `retryPending`。
6. 分别覆盖“关闭时队列未开始”和“启动接线确实重试”，可以共享前置 helper，但保留两个明确行为断言。

现有 driver 门控行继续保留 memory 和 SQLite；新增真实 close→restart 行为明确标为 SQLite only，符合 `.lead-ref/l8-rework-1.md:55`。

“保留 gated rows”不等于原样保留其中的时间猜测。固定等待在 `S8A-L8-auto-capture-gate.test.ts:208`、`271`、`326`、`344`，应换成门、close/drain 完成或真实回调完成。公开状态达成条件的有界轮询与“睡一段时间证明没发生”应在任务书里明确区分；后者不满足 F9。

9. 必需测试的公开可达性如下。

| 行为 | 公开调用序列／静态处置 |
|---|---|
| 两工作区相同块不互相污染 | **可达。** 同一个真实 backend/body store → createProject → register A、B → 各完成捕获 → 真实采用／修订再次触发 → 各自读 previous → 各自真实 prepare → `materials.openArtifact` 读返回的 bundle。登记和采用 helper 见 `S8A-L8-host.ts:149`、`161`；previous 加载见 `architecture-service.ts:1054`。不能给 A、B 各建一个隔离数据库。 |
| projectId 和 workspaceId 都进入范围 | **可达，但任务书现有一句测试不够。** 同项目不同 workspace 验 workspaceId；同库不同项目、相同 workspaceId 验 projectId。只测前者，漏写 projectId 仍可能通过。编码入口见 `architecture-service.ts:368`。 |
| 同工作区相同块跨 capture 重用 | **可达。** 两次真实捕获；让部分文件保持不变，使部分节点块／边块保持相同，再经 previous、listFiles、prepare 读取。返回首写 ref 是合法行为，见 `body-store.ts:46`、`architecture-service.ts:1155`。 |
| 空块、边索引块也带范围 | 空图和实际 import 图都能由真实文件公开捕获得到；编码分支见 `architecture-service.ts:380`、`381`。空图不能要求出现非空“架构提醒”，应断言成功准备且没有“架构提醒不可用”。 |
| 开始 observationState 返回失败 | **可达。** 真实登记／采用生成请求 → A2 包装真实 observationState 或其真实 records 依赖，在 driver 开始快照之后失败一次 → 公开 readAutoCapture/observationState 看 failed、pending 和旧 current。driver 两步顺序见 `auto-capture-driver.ts:159`、`175`。 |
| 开始 observationState 抛异常 | 同上，故障包装在命名点 throw；未取消时断言 unavailable 原因进入失败出口。 |
| 开始读取时取消，分别返回失败／throw／ready | **可达。** A3 门持有真实调用 → close 导致 driver signal 取消 → 返回真实结果或在 A2 点抛错 → 用关闭前后公开状态证明没有新增 failed；关闭取消见 `auto-capture-driver.ts:276`。 |
| 旧失败不覆盖新请求 | **可达。** 持有第一次捕获或读取 → 真实 revision 提交第二个请求 → 第一轮失败 → 公开状态保留第二请求 → 第二轮完成。gate helper 在 `S8A-L8-observation-state.test.ts:88`，guard 在 `architecture-service.ts:1319`、`1328`。 |
| 提醒读取期间取消并 throw | **可达。** 真实创建可执行 Run → 公开 prepare → A3 门确认进入真实 reminder read → abort 原 signal → A2 throw → prepare 返回 cancelled；A3 计数确认未进入准备材料 put。入口见 `context-assembler.ts:1040`、`execution-preparation.ts:298`。 |
| 提醒等待期间取消但返回 ready | **可达，建议与上一行一起冻结。** 同一路径，放行真实结果而不 throw，检查仍取消。这才证明“读取后检查”有效。 |
| 提醒非取消失败仍降级一次 | **可达。** 同真实 prepare 前置，A2 包装真实 reader 失败；公开读准备材料，断言单条不可用且准备成功。现有行为入口在 `context-assembler.ts:1043`、`1056`。 |
| 单次 prepare 12／21 读取 | **可达。** 真正的 Run 前置 → 两种真实观测历史 → A3 计数 → 一次 runtime.prepareExecution → 关闭计数 → 公开读材料。不能用当前 `reader.read` 两行替代，见 `S8A-L8-observation-state.test.ts:598`、`621`。 |
| requestedAt 不因失败改写 | **纯状态可达，建议保留已有纯测试并删除重复场景。** helper 和断言见 `S8A-L8-auto-capture-state.test.ts:30`、`36`、`58`。 |
| failed 事件 occurredAt 是写失败的时刻 | **STATIC。** 此值只写入事件，见 `architecture-service.ts:1325`；当前 observationState 返回的是请求记录／观测信息，见 `architecture-service.ts:852`。已有接受的静态核对见 `.lead-ref/l8-review2.out.md:29`。不要为断言它直接读事件库。 |
| catalog 实现产生 not_ready | **STATIC。** 当前实现分支只有 ready、not_found、rejection，见 `catalog-service.ts:364`、`382`、`418`、`786`。无需伪造成功状态来“覆盖实际不存在的分支”。 |
| 正常平台生成“正文范围与 canonical 范围不一致”的块 | **STATIC，场景不可达。** 正文由服务生成，记录由同次提交保存，见 `architecture-service.ts:1129`、`1157`、`1207`。只能做纯 decoder 的单错误拒绝例；不能改库或覆盖读取结果制造场景。 |
| 正常平台生成旧无范围格式 | **STATIC，场景不可达。** 当前 writer 改完后只生成新格式；旧格式拒绝放纯 codec 例，不能增加旧版写入或 decoder。 |
| 真 Host 排队关闭、重启重试 | **可达。** 使用上一节的真实 Host 序列及 A3 门。现有 lightScan 同步 fault 本身无法提供所需异步门，见 `typescript-light-scan.ts:156`。 |

准备材料可以通过真正的公共 owner 读取，不必直接读 body store：`materials.openArtifact` 在 `material-service.ts:156`，platform 暴露在 `create-platform.ts:1221`。使用返回的 bundleRef、同范围 Host context 和 `usage: 'historical_explanation'`；Host 对 Run 所有材料的 canonical 范围检查在 `applicability.ts:59`、`63`、`76`。不要使用 `usage: 'current'`，该路径明确拒绝，见 `applicability.ts:39`。

10. 新规则还使“复用现有 prepare helper”本身不能直接获准。

当前提醒夹具有这些明确实例：

- 手写 `PlanRevisionDraft` 在 `S8A-L8-reminders-public.test.ts:175`，交 owner 接受在 `S8A-L8-reminders-public.test.ts:190`，命中 F1。
- `hostFor` 返回手造 ready 配置，见 `S8A-L8-reminders-public.test.ts:251`、`254`，并用空对象冒充 model client，见 `257`；不是委托真实依赖的 A3 包装。
- Role facts 包装自己补 `guards: []`，见 `S8A-L8-reminders-public.test.ts:283`、`286`；不是“真实返回值不变”。
- `preparePublic` 新建独立 body store，见 `S8A-L8-reminders-public.test.ts:278`，直接读库断言在 `300`，命中 F7。
- 三种 reminder 故障例直接换成只有构造失败结果的端口，见 `S8A-L8-reminders-public.test.ts:468`、`484`、`500`。按 A2 应改成围绕真实依赖、在命名点失败的包装，不能继续使用成功链路也不存在的替身。

PASS 夹具也手写 draft 并被接受，见 `S8A-L8-pass-capture.test.ts:241`、`243`。因此 `.lead-ref/l8-rework-2.md:55` 的“Nothing to do here”不能与规则表 F1 同时执行。

真实生成 Plan 的公开路径已有可核对的步骤：

`submitQueryJob → createSession → claimQuery → prepareQuery → startQuery → readQueryAnswer → proposeInitialPlanFromAnswer → applyPlanChange`。

前六步见 `R5b-initial-plan.test.ts:226`、`228`、`235`、`242`、`245`、`255`，答案转 proposal 在 `R5b-initial-plan.test.ts:325`；生产 owner 入口在 `plan-service.ts:1760`。脚本模型回复可以是 helper 的输入，规则允许，见 `.lead-ref/test-rule-sheet.md:24`。**只能提取这些公开步骤，不能把该旧测试的整套 Host 替身未经审查照搬。**

任务书应指定一个共享 helper，接受 ID、文件内容、脚本模型回复；Plan、Session、Run 和 prepared 均在 helper 内通过公开步骤产生。Host 配置用真实配置解析器，现有 Host 通过 `createWorkbenchRuntimeHostBindings` 建立它，见 `host.ts:431`，不是继续调用手写 `hostFor`。

新的 prepare helper 应调用实际 `platform.runtime.prepareExecution`，然后调用实际 `platform.materials.openArtifact`。这也解决独立 body store 不属于平台公共材料读取链的问题，当前平台 Runtime 使用真实共享 bodies 的接线见 `create-platform.ts:1064`。

11. 与其他约束的冲突需要在发包前处理。

- **旧裁定 1：真实原因才触发。** 目前任务书列了两处伪登记，漏了同文件其余五处、gate 两处、reminder 两处，具体实例已在上表列全。采用／修订回调必须来自非重放的真实提交，依据 `.lead-ref/l8-impl.md:28`。
- **旧裁定 3、5：快照 guard 和取消。** 失败出口不能换成最新 revision，也不能用新的未取消 signal 绕过关闭；当前风险点分别在 `architecture-service.ts:1319`、`auto-capture-driver.ts:229`。
- **旧裁定 6 与 rework 1 的服务器统一 mappings。** 新测试采用后重放输入必须一致；UI 继续省略 mappings，见 `.lead-ref/l8-rework-1.md:37`、`src/ui/views/setup/requests.ts:207`。
- **旧裁定 7：previous 是提交时被替换的 current。** 当前写法在 `architecture-service.ts:1192`。不要为了测试开始快照而把提交时 previous 改成开始时 previous。
- **旧裁定 12：每观测加载一次。** 当前 latest 图被比较和移动提醒共用，见 `architecture-service.ts:1407`、`1424`。修范围不能增加第二次加载；计数测试也不能预读结果后再开始计数。
- **决定 79。** 旧无范围 v2 必须拒绝；不能给缺字段补 scope、从 origin 猜 scope、加兼容 decoder 或迁移。决定原文位置为 `docs/refactor/HANDOFF.md:564`，任务书已重申于 `.lead-ref/l8-rework-2.md:30`。
- **边界检查。** UI 只能使用本地模块和 type-only DTO，见 `scripts/check-boundaries.mjs:449`、`458`、`461`；不能为了范围编码把 core codec/hash 引到浏览器。纯子模块禁止 IO／时钟依赖，见 `scripts/check-boundaries.mjs:413`、`425`，不能把使用 Buffer、hash 或存储的封装逻辑塞进状态纯模块。
- **状态迁移入口。** failed 记录继续通过现有状态构造器，调用在 `architecture-service.ts:1322`；不要在 driver 或测试里自行拼持久状态。
- **production reach。** 新增校验 helper 必须真的由写前校验或生产读取调用；测试独用不能当生产可达。检查要求见 `production-reach.test.ts:103`；既有 allowlist 失效项也必须移除，见 `production-reach.test.ts:104`。旧书明确禁止加 allowlist 绕过，见 `.lead-ref/l8-rework-1.md:78`。
- **F12/D1。** 改 cap、删除重复行、替换 watermark 断言、改拒绝输入，都必须给冻结 finding ID；规则要求累计账本，见 `.lead-ref/test-rule-sheet.md:87`、`100`。任务书目前没有这张逐实例表。
- **F9。** 除 gate 四处外，重放的固定等待还有 `S8A-L8-auto-capture-host.test.ts:50`、`S8A-L8-adoption-capture.test.ts:239`、`S8A-L8-pass-capture.test.ts:423`；Host restart 用固定时长循环证明没有额外动作在 `S8A-L8-host-restart.test.ts:55`、`116`。若本轮规则表绑定整个 L8，就必须逐处指定用完成屏障／回调计数／门替换，不能只处理新行。
- **检测器执行。** 新书检查段只列测试、typecheck、architecture、build，见 `.lead-ref/l8-rework-2.md:61`；规则表另要求 D1、D3，D4 存在时也跑，并且红灯阻止 close-out，见 `.lead-ref/test-rule-sheet.md:98`。任务书应列出实际入口；不存在的检测器不能写成已执行，也不能让施工者自行把命中判为 allowed。

最后建议先改以下条款，再发给 DSH。以下文字可以直接作为修订基础。

**R2-1：补齐块格式和复用裁定。**

> 当前块格式仍为 schemaVersion 2，精确顶层字段为 schemaVersion、projectId、workspaceId、nodes、edges、unresolved。两个范围字段必填，来自已验证的 capture scope。节点块、边块、unresolved 块和空块全部携带范围。无范围旧格式一律拒绝，不补字段、不迁移。  
> 编码器显式接收 scope；写前校验与读取解码均核对正文 scope。读取时同时保留 canonical record、完整 ArtifactRef、摘要、大小、origin 和当前路径授权检查。新格式块的 origin 必须完整匹配 projectId/workspaceId。  
> 块不得加入 captureId、requestId、时间、sourceDigest 或 source revision；同范围相同正文允许跨 capture 重用。始终保存 content store 返回的引用，不要求首写 source/origin requestId 等于当前 capture。

**R2-2：冻结容量和关联测试修改。**

> 容量按完整 JSON 的 UTF-8 字节数计算，包含范围转义；空封装自身超限也返回 capacity。保留 256 KiB、64 块及既有块数超限优先级。数组封装不得通过搜索包含用户字符串的整段 JSON 定位。  
> 按审查表更新全部 writer/validator/decoder 测试输入；旧格式拒绝、坏边拒绝各自只有一个错误。A12 两组 cap 固定为 297、294，保留精确 65 块断言；L8 500 字节例固定手算为 6、7 块。所有断言和拒绝输入变化登记到对应 finding ID。

**R2-3：补齐捕获失败和取消边界。**

> 取得开始 `{requestSeq, revision}` 后，observationState 的任何非取消失败，包括 current/previous 记录读取失败，均进入统一失败出口。rejected 保留 code/reason；not_found/not_ready 映射 unavailable 并明确读状态；throw 在 signal 未取消时映射 unavailable。开始快照自身读取失败仍保留 pending。catalog not_ready 仅保留已接受的现状例外。  
> 每个异步步骤返回或抛错后先分流取消。失败写使用原捕获 signal，并在 failed commit 前复核；只用开始 revision guard，冲突不追写。开始 commit 前的取消不提交；已开始且成功完成的提交保留成功事实，不因后续取消或清理改记 failed。已提交重放的恢复读取失败单列处理，不把已有提交当作未发生。

**R2-4：补齐提醒后的准备边界。**

> reminder read 返回后及 catch 均先检查原 signal；明确返回 cancelled 或 signal 已取消时返回 cancelled。其余 reminder 失败只产生一条“架构提醒不可用”。  
> 对提醒之后的上游事实、输入页、续接 brief/helper，以及 assembler 返回和材料 put 边界，保持原有非取消失败语义，但取消优先。put 开始前已取消不得调用 put；put 等待期间取消则不返回 ready，允许已经写入的不可达材料存在，不删除或伪称回滚。新增“取消后 throw”和“取消后真实 ready”两行。

**R2-5：用逐实例表替换第 4 项。**

> 按本审查第 7 节逐行处理全部伪触发、pointerOf、chunkCountOf 和读取计数，不允许自行选择保留、删除或放宽。删除 mappings 文件从 281 开始的重复失败行，保留纯状态 requestedAt 覆盖；失败事件时间继续 STATIC。  
> 真实采用／修订通过提交回调触发；共享 helper 固定公开步骤。计数发生在一次真实 runtime.prepareExecution 内，架构提醒读取预期固定为 12／21，准备后的公共材料读取不计入。

**R2-6：明确真实 Host 门和测试序列。**

> 保留 driver 门控行及双后端。新增 SQLite 真实 Host 排队关闭和 close→restart 重试行，使用 A3 委托真实 captureObservation 的门；不得以 async lightScan fault 作门，不得直接调用 driver.close/retryPending 代替 Host 行。按本审查第 8 节执行公开序列，以取消信号、门和完成屏障取代固定等待。

**R2-7：消除第 6 项与规则表的冲突。**

> 既有 bubblewrap 通过结果只作为历史基线。三条 PASS 行及提醒行的业务断言和双后端保留，但其手写 Plan 接受入口、Host/Role 替身、独立 body store 和直接读库断言必须按本轮规则重接。  
> 共享 helper 通过脚本模型的真实 Query 答案产生初始 Plan，再公开采用、创建 Session、claim 和 prepare；准备材料通过 materials.openArtifact 的 historical_explanation 读取。不得自行添加 A7 或 allowlist。

**R2-8：补齐交付及检测约定。**

> 修正 F5 的 255 行错误引用，移除或补齐缺失的 l8-rework1.diff 引用，确保规则表随 DSH 输入包提供。冻结全部 finding ID、测试入口、helper 和 D1 变更表。close-out 执行规则表要求的检测器；命中未解决时报告 BLOCKED，不自行判 allowed。测试、构建通过不能替代上述规则检查。

以上条款修订并冻结前，不建议施工。