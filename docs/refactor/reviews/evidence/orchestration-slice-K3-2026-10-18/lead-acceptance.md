# K3：lead 的验收（2026-10-18）

**结论：** 合入（2026-10-18，代码 `d3146d69`；补做 `5e83681b`）。四组施工、B3 的 8 轮返工、决定 80 的一次全审、决定 81 的三轮上限和 N-01 的 Codex 测试补丁都走完。最终表只剩 1 条缺保护 N-01 交 Codex 测试补丁，没有仍未关闭的“会出错”行，所以不开 DSH 返工 3；N-01 第二次补丁通过，冻结变异 M1 在新例的两条断言上失败。K3 自己的第 10 轮全量：716 个测试文件全过，9,559 项过、5 项跳过，2,834 秒，测试 scope 峰值 4.95 GB。合入时的全量：最终树（K3 代码 `d3146d69` 加补做 `5e83681b`；WSL、bubblewrap、systemd 用户会话、5 个并行、scope 6G）：771 个测试文件全过，10,082 项过、5 项跳过，2,787 秒，测试 scope 峰值 5.28 GB；类型检查、模块边界检查、构建都是 0（`checks/merge-full-suite-summary.txt`）。

## K3 的范围

| 项 | 结论 | 怎么验收的 |
| --- | --- | --- |
| 按种类核对（R1） | 接受 | 只读不核对；平台工具按请求号查回执，按工具名固定分派；改文件的附 diff；跑程序的先开只读核对轮。K3-01、02、04、05、06、40 走真实 Host 和真实 Kernel；K3-03 用存储包装让查找失败一次；K3-08 的等待关系；K3-09 在每步之间重启；K3-HO1 的换手维护。 |
| 核对轮和卡（R2） | 接受 | K3-10 的 12 格、K3-11 的五种原因、K3-12 的工具清单和写范围、K3-13 的缺结论、K3-14 的身份、K3-15 的四个选项和 hold、K3-16 的方案轮、K3-17 的答复形状和二次落实、K3-18 的五种自治、K3-19 的只读命令用不了、K3-20 的 5 张卡分页、K3-35 的大小、K3-37 的停下的核对轮、K3-42 的看不全的命令、K3-45 的轮次、K3-46 的两组作用对象、K3-48 的三档大小。 |
| 仍然等人（R3） | 接受 | K3-21 的每条守卫、K3-22 的探测、K3-23 的零调用零关闭、K3-24 的旧结果未知和进程内结果未知。`head_mismatch` 造不出来，按规格不写测试；排队的插话加其余守卫成立时走 RUN-25／W-26，Kernel 已接受则 Applied，否则 Superseded，接续说明保留原文；已生效的暂停＋在途调用不可达，按 AGENTS 第 4 条不测。 |
| 人认定（R4） | 接受 | K3-25 的认定和重放、K3-26 的九种清单、K3-27 的核对领取关闭、K3-28 的理由和返工计数、K3-29 的逐行恢复、K3-39 的三个 owner 查找、K3-41 的人停下的原 Run、K3-43 的两种先后、K3-44 的三种找回、K3-47 的 owner 断言。 |
| 纯状态（R5） | 接受 | K3-30–34、36、38：RUN-25、UCR 表、L23 的 11 例、FC-7b 和 AV 的位置、L3 的表、租约释放、核对领取。纯状态里看不到的回执重放、读失败、真租约、真重排放在 K3-47 的 owner 层。 |
| 拦命令和请求重跑（B2） | 接受 | B2-01 的例子表逐行、B2-02 已批准方案、B2-03–08 的请求和答复、B2-09 的重放和崩溃、B2-10 的纯解析、B2-11 的脚本展开、B2-12 的注明改写、B2-13 的只放行一种写法、B2-14 的按别名、B2-15 的不重新展开、B2-16–18 的读取上界。 |

## 逐行的判断

- **K3-01、02、04、05、06：** 走真实 Host、真实 Kernel 和真实 git 工作区；K3-01 的消息提交后崩溃、K3-02 的提交前崩溃、K3-04 的 `replace`／`create`、K3-05 的核对轮全程、K3-06 保留真实单条链，三类混合的多条目部分放在无存储纯测试。接续说明的“已做／没做”、卡、租约释放和最后的零写入都断言。
- **K3-07：** 要真 SIGKILL 和真 bwrap。冻结规格第 1414 行列了它，但 lead 没把它放进任何分组书；K3 没有这条测试，也没有单独的运行记录。这是 lead 的遗漏。已补做（`5e83681b`，`books/k3-x07-book.md`）：真实平台 Host 跑在子进程里，在真实 `shell` 途中被 SIGKILL；沙箱里的命令随之停下（沙箱内的 pid 是隔离的，照 RL-08 查宿主机上的进程名），新 Host 走 RUN-25 收尾，`hl03_stale_lock` 带被杀进程的 pid。最终全量里这一行过了，exit 5 的修复后单跑又过一次（`checks/k3-makeup-check.txt`）。
- **K3-08、09：** 等回复的发送和接收；K3-09 在收尾、领取、写结论、定稿后各重启一次，最后只有一次收尾、一份记录、两轮核对、一次接续。
- **K3-10–20：** 12 格、原因、工具、身份、四个选项、方案、答复、自治、只读命令、分页；卡的文字用字面期望，不引生产常量。K3-15（七）的取消专用判断和 `revision_conflict` 两例都有。
- **K3-21–24：** 每条守卫各一例，报 L25 的第一条；探测 `missing`／`host_config`／Turn 有终态；零模型调用、零关闭、零记录；K3 之前的 `EndedUnknown` 和进程内 RUN-08 不变。
- **K3-25–29、39、41、43、44、47：** 认定、清单、关闭、理由、重启恢复、三个 owner 查找、人停下的原 Run、两种先后、三种找回、owner 断言。K3-29 的第 2b、6b、UR7b 和“最后一次重启零写入”都在。
- **K3-30–34、36、38：** 纯状态逐行；构造函数的拒绝、`open`、`stateEntry`、`too_large`、`busy`、`stale`、表外迁移都有。
- **K3-35、42、45、46、48：** 长命令、512／600 字节、200 条路径、截断和不展开、两轮没做完、两组作用对象、创建和可选文字的预算。K3-35 的真实记录只有 1 条进程条目：串行 Kernel 只真正开始被拦的那一个 `shell`，32 条的极值留在无存储的纯渲染测试里。
- **K3-49：** 冻结规格第 1441 行（配 L31b 第 774 行）列了它，但 lead 没把它放进任何分组书；K3 没写 RL-10c 的断言，`process-sandbox.ts` 的 L31b 改动也没做。这是 lead 的遗漏。已补做（`5e83681b`）：命令在 systemd-run 已起、放行以前被取消时，Host 对自己建的单元跑一次 `systemctl --user stop`，停不掉只记一行 stderr；systemctl 退出 5（单元没加载）算没有东西可停，不记——这是 lead 在最终全量里看到 22 行这种误报后补的一行。RL-10c 断言每次这样的取消后单元 5 秒内不在了，最终全量和单跑都过。实测：今天此前的每次全量留下 28–55 个空单元，补做后的两次运行新留 0 个；机器上原有的 469 个空单元（0 个进程、0 字节）是 10-16 以来的旧运行留下的。
- **B2-01–18：** 例子表、已批准方案、请求和答复、重放、纯解析、脚本展开、注明改写、只放行一种写法、按别名、不重新展开、三个读取上界。B2-16 的 401 条分页和 3 页、B2-17 的每命令至多 4 个 `package.json`、B2-18 的每次请求 `max(1, ⌈R/200⌉)` 页（R＝0／1／200／201 → 1／1／1／2）都有字面断言。
- **旧测试：** §5.3 的每一行按 lead 写的前后断言改；A2 的 W-13、A8-3f、A8-3g、A8-2b 只加断言不翻转；IT26、WP1、WP2 的草稿按 L8 改成“不完整、`needs_decision`”；WP2-wiring 的 F10 不改输入；平台对象加 `unknownCallReviews`；不变量加 I-23。

## 冻结的 102 行

- **总数：** F-001–F-102。生产 26 行（6 行有业务后果、20 行只影响整洁）；测试 76 行（20 行缺保护、56 行只是写法）。F-098–F-101 是书 9 新加的行，F-102 是书 9b 新加的改写行。
- **处置：** 下表逐行列出（“分类表”＝`checks/k3-business-classification.md`，“冻结”＝`checks/k3-final-freeze.md`，verify9＝`codex/k3-verify9.out.md` §1，final-list＝`codex/k3-final-list.out.md` §2，T＝清理轮）。整行进 T 37 行（36 条 F 行 + N-04），只把剩余部分留 T 10 行；其余 59 行关闭或接受裁定。

| 行 | 类别 | 结果 | 来源 |
| --- | --- | --- | --- |
| F-001–F-007 | 只是写法 | T | 分类表；书 9b §1（只做业务行，未做） |
| F-008 | 缺保护 | 9b 关闭 | verify9 §1：`H/B2-crr-world:288`；`W/B2-07-crr-card:54、61、84` |
| F-009–F-013 | 只是写法 | T | 分类表；书 9b §1（只做业务行，未做） |
| F-014 | 只是写法 | 部分完成，剩余迁移进 T | verify9 :72；书 10 §2.2 |
| F-015–F-019 | 只是写法 | T | 分类表；书 9b §1（只做业务行，未做） |
| F-020 | 缺保护 | 10 关闭 | final-list §2：`K3-44-crr-kind4:218–231、261、317`；`host:1036` |
| F-021 | 缺保护 | 10 关闭 | final-list §2：`B2-02-recognition-unified:93、104`；`B2-12-recognition:166–182` |
| F-022 | 只是写法 | T | 分类表；书 9b §1（只做业务行，未做） |
| F-023 | 只是写法 | 9a 关闭 | verify9 §1：`B2-07-crr-card-pure:77–124` |
| F-024 | 只是写法 | 9a 关闭 | verify9 §1：`B2-command-rerun-request-event-pure:79–112` |
| F-025 | 只是写法 | T | 分类表；书 9b §1（只做业务行，未做） |
| F-026 | 缺保护 | 10 关闭 | final-list §2：`B2-01-blocked-commands:77、113–114、138–139` 等六处 |
| F-027 | 只是写法 | T（部分） | 书 10 §2.2；9a 已改 hash／forms，工具常量仍 T |
| F-028–F-029 | 只是写法 | T | 分类表；书 9b §1（只做业务行，未做） |
| F-030 | 只是写法 | 9a 关闭 | verify9 §1：`B2-01-shell-hook:88–109` |
| F-031 | 缺保护 | 9b 关闭 | verify9 §1：`B2-02-recognition-unified:175、205` |
| F-032 | 缺保护 | 10 关闭 | final-list §2：`K3-15-list-by-task:64–100` |
| F-033 | 缺保护 | 9b 关闭 | verify9 §1：`K3-19-review-admission:303、333` |
| F-034 | 只是写法 | 9a 关闭 | verify9 §1：`K3-29-startup-reconcile-2b:256–285` |
| F-035 | 缺保护 | 10 关闭 | final-list §2：G1 真交接；`B2-UR7-crr-answer:156、162–174` |
| F-036 | 只是写法 | T | 分类表；书 9b §1（只做业务行，未做） |
| F-037 | 只是写法 | 9a 关闭 | verify9 §1：`B2-11-blocked-commands-bytes-pure:32–71` |
| F-038 | 只是写法 | 9a 关闭 | verify9 §1：按 D1 删八处，业务行仍在 |
| F-039 | 只是写法 | 9a 关闭 | verify9 §1：`K3-15-blocked-sentence-pure:20–56` |
| F-040 | 缺保护 | 9b 关闭 | verify9 §1：`K3-18-review-card-queue:195–218` |
| F-041 | 缺保护 | 9b 关闭 | verify9 §1：`K3-26-unknown-call-review-storage:608、673` |
| F-042 | 缺保护 | 9b 关闭 | verify9 §1：`K3-47-claim-gate:262、281、302` |
| F-043 | 只是写法 | 9a 关闭 | verify9 §1：`K3-47-reader-facts:167、186` |
| F-044 | 缺保护 | 9b 关闭 | verify9 §1：`K3-41-release-hold:371、430–455` |
| F-045 | 缺保护 | 9b 关闭 | verify9 §1：`K3-15-ur3h:280–301`；`K3-review-workflow-rows:1063、1107、1120` |
| F-046 | 只是写法 | T（部分） | 书 10 §2.2；final-list §2：裁定 5 的丢失断言已恢复，纯迁移仍 T |
| F-047–F-049 | 只是写法 | T | 分类表；书 9b §1（只做业务行，未做） |
| F-050 | 只是写法 | 接受裁定 | 书 9b §2.2；verify9 §1：`B2-08-crr-cancel:54–64` |
| F-051–F-052 | 只是写法 | T | 分类表；书 9b §1（只做业务行，未做） |
| F-053 | 只是写法 | 9a 关闭 | verify9 §1：`K3-48-3-required-writes:55、70` |
| F-054 | 缺保护 | 范围内七行在第 10 轮关闭；旧片余项仍 T | 书 9 :40；verify9 :369；
| F-055 | 只是写法 | T（部分） | 书 10 §2.2；9a 恢复 25 处时限，3 处仍默认 |
| F-056 | 只是写法 | 9a 关闭 | verify9 §1：`K3-06-mixed-kinds-pure:115、157、186` |
| F-057 | 只是写法 | 9a 关闭 | verify9 §1：`K3-15-disposition-effects-pure:196、207` |
| F-058 | 只是写法 | T | 分类表；书 9b §1（只做业务行，未做） |
| F-059 | 只是写法 | 9a 关闭 | verify9 §1：`K3-16-targets-pure:80–106` |
| F-060 | 只是写法 | 9a 关闭 | verify9 §1：`K3-16-review-extremes-pure:218–281` |
| F-061 | 只是写法 | 9a 关闭 | verify9 §1：`K3-16-proposals-pure:117–137` |
| F-062 | 只是写法 | 9a 关闭 | verify9 §1：`K3-35-manifest-trim-pure:283、284、295、428` |
| F-063 | 只是写法 | 9a 关闭 | verify9 §1：`K3-35-owner-manifest-trim:67、81–100` |
| F-064 | 只是写法 | 接受裁定 | 书 9b §2.2；verify9 §1：`K3-26-unknown-call-review-codec-pure:74–92` |
| F-065 | 只是写法 | 9a 关闭 | verify9 §1：`K3-35-renderer-boundary-pure:260–320` |
| F-066 | 缺保护 | T | 书 10 裁定 6；纯渲染的容量抛错测试保留 |
| F-067 | 缺保护 | T（部分） | 冻结：容量保护成立；完整 C 手算 T |
| F-068 | 只是写法 | 9a 关闭 | verify9 §1：`K3-15-ur3h:241` |
| F-069 | 会出错 | 10 关闭 | final-list §2：`command-rerun-request-service:741–744`；`B2-09-crr-owner:514、526、538` |
| F-070 | 会出错 | 9a 关闭 | verify9 §1：`execution-driver:539`；`B2-02-recognition-unified:306、321` |
| F-071 | 没有可见后果 | T（部分） | 书 10 §2.2：生产守卫已接，测试部分 T |
| F-072 | 会出错 | 10 关闭 | final-list §2：`decision-actions:277–287`；`K3-44-crr-recovery:85–90、148、159` |
| F-073 | 会出错 | 10 关闭 | final-list §2：`unknown-call-review-answers:206–211`；`K3-44-crr-recovery:191、209–213` |
| F-074 | 没有可见后果 | 9a 关闭 | verify9 §1：`blocked-command-order:26`；prepare、brief、recognizer 共用 |
| F-075 | 没有可见后果 | T（部分） | 书 10 §2.2：共享分页已接，测试部分 T |
| F-076 | 没有可见后果 | 10 关闭 | final-list §2：`decision-read-model:566、641`；`K3-B3-cancellation-cancelled:147、193` |
| F-077 | 没有可见后果 | 9a 关闭 | verify9 §1：`workflow:514、1954`；`K3-46:626、733` |
| F-078 | 没有可见后果 | 9a 关闭 | verify9 §1：`command-rerun-request-card:65`；`B2-07-crr-card:79` |
| F-079 | 没有可见后果 | 9a 关闭 | verify9 §1：`command-expansion:99、217`；`B2-11-script-expansion:141、241` |
| F-080 | 没有可见后果 | 9a 关闭 | verify9 §1：`command-rerun-request-service:818、827`；`B2-09-crr-owner:336、362` |
| F-081 | 没有可见后果 | 9a 关闭 | verify9 §1：`command-rerun-request-service:640`；`K3-B3-shared-rules-pure:89` |
| F-082 | 没有可见后果 | 接受裁定 | 书 9b §2.2：无需行为测试；verify9 §1 |
| F-083 | 没有可见后果 | 9a 关闭 | verify9 §1：`src/contracts/utf8:21`；`K3-B3-shared-rules-pure:36` |
| F-084 | 没有可见后果 | 9a 关闭 | verify9 §1：`decision-actions:259` |
| F-085 | 没有可见后果 | 9a 关闭 | verify9 §1：`command-rerun-request-service:601、724` |
| F-086 | 没有可见后果 | 9a 关闭 | verify9 §1：`command-rerun-request-card:45` |
| F-087 | 没有可见后果 | 9a 关闭 | verify9 §1：`execution-contracts:339`；`B2-02-recognition-unified:338` |
| F-088 | 没有可见后果 | T（部分） | 书 10 §2.2：共享算法已改，测试自比仍 T |
| F-089 | 没有可见后果 | 9a 关闭 | verify9 §1：`revision-guard:13`；`K3-B3-shared-rules-pure:64、122` |
| F-090–F-092 | 只是写法 | T | 分类表；书 9b §1（只做业务行，未做） |
| F-093–F-095 | 缺保护 | T | 书 9 §2 裁定 1（`books/k3-g4b3-rework-9.md:36–41`；旧片，移出本轮） |
| F-096 | 只是写法 | T | 书 9 §2 裁定 1（`books/k3-g4b3-rework-9.md:36–41`；旧片，移出本轮） |
| F-097 | 缺保护 | 9b 关闭 | verify9 §1：`B2-07-crr-card:138–166` |
| F-098 | 没有可见后果 | 10 关闭 | final-list §2：`command-rerun-request-card:143–149、177`；`K3-B3-newest-request-order:79–114` |
| F-099 | 没有可见后果 | 9a 关闭 | verify9 §1：`unknown-call-review-codecs:273`；`K3-B3-crr-codec-rejects:69` |
| F-100 | 会出错 | 10 关闭 | final-list §2：`K3-10-crr-goal-basis:115、143–146、156、194–201` |
| F-101 | 没有可见后果 | T（部分）；10 关闭主分支 | final-list §2：`K3-B3-cancellation-cancelled:91–143`；页帽／停滞见书 10 §2.2 |
| F-102 | 会出错 | 9b 关闭 | verify9 §1–§2：`B2-02-recognition-unified:214、251` |
| N-01 | 缺保护 | Codex 测试补丁（已过） | 冻结；`checks/k3-n01-check.txt` |
| N-02 | 只是写法 | 接受裁定（获准替换） | 冻结第 11 行 |
| N-03 | 只是写法 | 接受裁定（局部删减） | 冻结第 12 行 |
| N-04 | 只是写法 | T | 冻结第 13 行 |

- **N-01：** 新例在 `B2-UR7-crr-answer` 的现有双后端世界里，公开 `answerDecision` 只保存 ①，在 Workflow 的 `decisionMessages.readDecisionAnswer` 注入一次 `unavailable`；断言 `waiting`／`next: null`、准确原因、公开 revision 和 application 不变。M1 把非 ready 的已保存答复读改成 `continue`；内存和 SQLite 都在 `:223`／`:224` 失败，F-035 两例仍过。
- **N-02：** 真实单条记录保留 `[1]`，多条目映射留在 `K3-review-input-pure:94`，记为获准替换。**N-03：** 两个真实 Host 例守自动交接和公开结果，`B2-UR7-crr-answer:162–174` 守真实 ②③ 重放；旧报告投影断言不恢复，记为局部删减。**N-04：** 五个新增超时记进 F-055／T，时限不改；N-02、N-03 不进 T。
- **进 T：** 整行 37 行（F-001–F-007、F-009–F-013、F-015–F-019、F-022、F-025、F-028、F-029、F-036、F-047–F-049、F-051、F-052、F-058、F-066、F-090–F-096、N-04）；部分 10 行（F-014、F-027、F-046、F-054、F-055、F-067、F-071、F-075、F-088、F-101）。20+56 是历史分类，不是待办数。清单见规格 §10.10。

## 合并

- **范围：** K3 建在 lead `f15f25a4`；8D（4041c30）和 L8（de70ff4）其间合入。整个 K3 变更（`f15f25a4..k3-g4b3-r10`，359 个文件）3 路应用到 lead `c7f7cb0`：355 个文件干净，4 个文件 13 个冲突块。
- **13 个块：** `create-platform.ts` 2 个、`context-assembler.ts` 7 个、`execution-preparation.ts` 3 个、`workspace-tools.ts` 1 个。两边新增的检查、错误码、文字、顺序、摘要输入和返回形状都保留，只有 M1 的三处取消语义是例外（见下）；同一位置的顺序没有规格裁定时，lead 侧在前、K3 在后，只影响成员顺序，不影响运行时。`context-assembler.ts:1146–1200` 的 TaskRequeue 路径保留 lead 的显式取消循环，K3 的 `lastTerminalBoundary` 仍给 `reviewSessionBasis` 用。
- **漂移：** L8 让默认上下文装配器的 `materials` 变成必需。合并后 `K3-12-review-round-tools` 和 `K3-review-preparation` 的 12 项在两边都失败（`the default context assembler requires the materials port`）；lead 让这两个测试传真实的材料服务，12 项全过。这是测试夹具的漂移，不是冲突解错。
- **合并检查：** DSH 的 `dsh/k3-merge-final.md`：typecheck、`check:architecture`、build 都 0，没有冲突标记，只改四个文件。它跑 236 个文件、1,672 项：228 个文件、1,633 项过；8 个文件、39 项失败，其中 6 项是缺 bwrap、21 项是同一个 bwrap 级联、12 项是 `materials` 漂移。lead 修完漂移后，未加 M1 修复的合并树（`k3-merge-1`）全量：769 个文件全过，10,067 项过、5 项跳过，2,670 秒，峰值 5.33 GB（`checks/merge-full-suite-summary.txt`）。
- **Codex 的合并检查：** `codex/k3-merge-check.out.md` 核了 13 个已解冲突块、11 个干净合入的重叠文件、启动顺序和租约规则（决定 82）、lead 的材料漂移修复，都判对；另报 1 条必须修复 M1。
- **M1：** 三处 prepare 读取把明确的 `cancelled` 变成“没有事实”，违反 slice-8 §13.8：核对轮的 session 历史边界（`lastTerminalBoundary`／`reviewSessionBasis`）、接续的 review 文件读取（`unknownCallReviewFilesFor` 的第二次 `resolveRoot`）、Run 启动时的工作区基线（`recordWorkspaceBaseline`：`resolveRoot` 取消 → `read_failed`；基线读取中途取消仍写入基线体）。K3 写在 L8 的规则之前，这是合并级缺口，不是解冲突解错。
- **M1 的修复：** lead 已修（`checks/k3-merge-fix.diff`，净增约 30 行，与 L8 的 `sessionBasisForContext`／`briefWorkspaceFactsFor` 同一写法；非取消的失败保持今天的回退）。Codex 以补丁交测试（决定 81-5；`codex/k3-mfix-tests.*`）：新 `tests/runtime/K3-merge-cancel-propagation.test.ts`，T1 只有 session 边界窗口答取消，T2 只有 review 文件根，T3 只有基线根，T3b 基线根解析时信号已置位＝零基线体，内存和 SQLite 各一遍。lead 的检查 `checks/k3-mfix-check.txt`：第一次就过；未变异 24/24 过（8 个新例 + `K3-review-preparation`、`K3-B3-cancellation-cancelled`、`K3-35-workspace-baseline-prepare` 的 16 项）；M-F1／M-F2／M-F3／M-F3b 四个变异各只让本行在两个后端按指定断言失败（T3b：`expected 1 to be +0`，基线写入计数），其余行照过。合并提交 `d3146d69`；合入时的全量：最终树（K3 代码 `d3146d69` 加补做 `5e83681b`；WSL、bubblewrap、systemd 用户会话、5 个并行、scope 6G）：771 个测试文件全过，10,082 项过、5 项跳过，2,787 秒，测试 scope 峰值 5.28 GB；类型检查、模块边界检查、构建都是 0（`checks/merge-full-suite-summary.txt`）。

## 已知限制

- **没有调用真实模型。** 所有模型都是脚本化或回放的；整个 MVP 仍未完成。
- **Host 一直活着时的结果未知仍等人认定。** 进程还在，证明不了工具已停；非 git 工作区、采集不到改动、Kernel 读不了、等待重建不了、查询的恢复，也都照今天等人认定（规格 §0、§8）。
- **几条要真实 Host 记录的行只跑 SQLite。** 内存世界接不上平台的 Host 装配；第 9b 轮接受这一点，没有另造共享后端接缝。`F-054` 原点名的 S3 旧片行按范围裁定留 T（不是“无存储夹具”的豁免，`codex/k3-verify9.out.md:369`），`S4C2` 的行已修成双后端。
- **K3-08（二）只有一格不可达。** 同批 wait-send 和命令同时在途没有公开路径；核对轮期间把待处理消息送到原 Session、核对轮不接受而接续接受，仍有真实测试（`tests/scenarios/K3-08-wait-reply.test.ts:192–199、231–233`）。
- **F-067 的完整前置手算没做完。** 容量保护成立，变异 M2 已受现有断言保护；缺的是按完整记录字段列出的独立算式，进 T。
- **形式行仍在 T。** 见规格 §10.10；它们不改变行为，测试仍然弱或重复。

## 没有测的、以及为什么

- **K3-07 和 K3-49 是补做的。** 两行都列在冻结规格里，但 lead 没把它们放进任何分组书；K3 合入后补做，单独提交 `5e83681b`。真实行在 WSL 用 bwrap 和 systemd 用户会话跑过：最终全量里过了，exit 5 的修复后单跑 23/23（`checks/k3-makeup-check.txt`）。
- **PASS 三行**在 DSH 沙箱里只失败在缺 `/usr/bin/bwrap`；lead 的 K3 第 10 轮全量在有 bwrap 的环境跑过，但没有逐行标出这三行。
- **几条真实 Host 行只跑 SQLite**（见已知限制）；不是后端豁免，是当前夹具的限制。
- **K3-08（二）的同批 wait-send＋命令在途不可达**（见已知限制）；没有为它造篡改状态。
- **多条目不再用 owner 层造态。** 真实单条链保留；多条目转无存储纯测试（K3-06 的三类混合、K3-13 的两条、K3-35 的 32 条极值）；没有对应纯函数的不可达行删除。K3-35 的真实记录只有 Kernel 真正开始的那 1 条进程条目。
- **F-066 的 15,030／15,031 算术**没有公开 prepare 实测；两个数都小于 16,384，按 book 10 裁定 6 留 T。
- **F-054 原点名的 S3 旧片行**按范围裁定留 T（`codex/k3-verify9.out.md:369`），没有另造存储接缝。

## 模型

没有调用真实模型。
