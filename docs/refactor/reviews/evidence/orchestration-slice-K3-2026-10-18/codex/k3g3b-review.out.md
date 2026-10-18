只读审查完成，未修改文件、未运行测试或构建。以下是静态核对，不代表运行验收；不计第三次会话和第4组尚未施工的内容。短文件名均指当前副本。

| 项 | 结论 | 证据 |
|---|---|---|
| A | 是 | `workflow.ts:211` 钉住记录 revision；`:139` 将钉纳入请求身份；`:1916` 共用结束后定稿 helper。 |
| B | 是 | `workflow.ts:1226` 区分未进入的 starting；`:1283` 忙 Session 返回 skip；`:88` 已加 source。 |
| C | 是 | `review-lease.ts:63` 统一已知结束判断；`unknown-call-review-service.ts:499、522` 限制定稿和 unfinished；`state/unknown-call-review.ts:481` 固定 held 的依据。 |
| D | 是 | `context-input.ts:313` 共用尾段检查；`execution-entry-service.ts:1151、1598` 检查用途、重渲染和缺字段；`execution-preparation.ts:420` 按字节截前缀。 |
| E | 部分 | `runtime-configuration.ts:467` 已按 Role 查绑定且不解析模型；四处准入已接，但 capability 条件仍少一项，见下。 |
| F | 是 | `context-assembler.ts:371、392、1087` 分别裁 cwd、取完整采集前200条、读取完整 capture。 |
| G | 是，另有相邻遗漏 | `unknown-call-review-service.ts:311、339、380、391` 先查回执、自钉、保留 Run 守卫并重试一次；`:658、675、705` 有界分页、同水位、续读；`continuation-diff-reads.ts:135` 检查真实路径；`workspace-baseline-artifact.ts:47` 局部降级；`unknown-call-review-codecs.ts:307` 限 sha256；历史扫描和 display map 已合并（`context-assembler.ts:917`、服务 `:412`）。 |
| H | 是 | `K3-R1-second-cleanup.test.ts:180、193、211` 已补 pending→真实核对→resolved，再准备 B。 |
| I | 部分 | 公共链已补；容量测试仍容许轮次异常结束，且预算夹具随生产常量变化，见下。 |

需修改的问题：

1. **必须改：成功写入后，工具回包使核对轮变成结果未知（UNSPECIFIED 3）。**  
   `unknown-call-review-tools.ts:167` 返回整个 WriteResult，其中含整份记录；`:189` 限64 KiB；`tool-dispatcher.js:137` 超限抛错。最小反例：合法约70 KiB记录提交一个短结论，写入已成功，回包却失败，轮次进入 `outcome_unknown`，随后只能等人认定。现有测试明确容许这个结果（`K3-10-review-round-cells.test.ts:261`）。  
   **修改思路：** L14要求返回原提交回执、保持重放语义（`slice-K3-SPEC.md:379`），没有要求把整份记录塞进工具输出。在 adapter 返回有界回执，保留 cursor、replayed、ref、revision；完整记录继续由 read 读取。无需改 owner 的持久化或提高输出上限。同步让该容量测试断言短写回执、正常结束及定稿。

2. **必须改：缺 Workflow binding 不能当作核对门控通过（UNSPECIFIED 2）。**  
   `workflow.ts:1245` 返回 pass。最小反例：记录仍 pending_review，重启配置移除了该任务绑定；核对分支不处理它，指定任务最终只收到泛化的“不可执行”（`:1645`）。现有 AV-2b 仍阻止自动返工（`task-failure.ts:867`），因此不能夸大成已经绕过 owner。  
   **修改思路：** 缺绑定返回明确的 skip source，指定任务转 waiting。§3.4要求未完成核对先留在核对分支；若已查明只读能力不可用，则必须走 UR2 的 `settle_review{review_unavailable}`（规格`:1322`）。缺模型绑定本身不证明只读能力不可用，不应无依据定稿。

3. **必须改：capability 与启动准入条件不一致。**  
   `runtime-configuration.ts:470` 只检查 `run_readonly_command`；`review-admission.ts:68、93` 同时要求 `read`。最小反例：Host grant 有 shell、只读命令及全工作区权限，但没有 read；capability 报 available，核对轮领取后启动被拒，留下 starting 轮次。  
   **修改思路：** capability 查询也检查 Host 的 read 授权，缺失即 unavailable；保留启动准入检查。四处按用途分流已接（`execution-driver.ts:560、583`、`create-platform.ts:442`、`execution-entry-service.ts:599`）；普通 Work 的检查保留在 driver`:599`，调用时当前授权检查保留在`:914`，不应为修此问题放宽它们。

4. **必须改：基准缺失时，保存采集失败仍虚报“基准已知”（关联 UNSPECIFIED 5）。**  
   `create-platform.ts:1609、1612` 仍硬编码 true。最小反例：baseline 读取失败，但 manifest 保留、采集成功，随后 capture 的写入失败。结果错误声称拥有开始基准。  
   **修改思路：** 两处分支直接传 `captured.baselineKnown`，与成功分支`:1614`一致。这是两处参数修正，无需新抽象。现有 `K3-40-workspace-change-capture.test.ts:114` 只验证 helper 和 capture，agent 所说组合根未验证属实；应在现有存储接缝覆盖这条失败路径。

5. **必须改：容量测试的边界预期跟随实现漂移。**  
   `K3-10-review-round-cells.test.ts:216、220` 从生产预算计算长依据；`K3-48-2-unknown-call-review-model-text-budget.test.ts:27` 同样引用生产常量。反例：预算误增100字节，夹具随之变长，capacity断言仍可通过。  
   **修改思路：** 测试端固定规格所列的158,720字节（`slice-K3-SPEC.md:261`），保留现有用例即可，不增加排列。

R2测试入口总体成立：

- K3-05和K3-10实际经过领取、准备、模型工具、owner、定稿（`K3-05-review-round.test.ts:129、152、164`；`K3-10-review-round-cells.test.ts:148、151、156`）。十二格原因是字面值（后者`:89`）。
- K3-12检查真实 provider 工具表和映射后的写失败；K3-14检查两次新调用覆盖、非法别名及回读（`K3-12-14-review-round.test.ts:202、209、258、281`）。重放/冲突经过真实 adapter 和 owner（`tests/work-graph/K3-14-unknown-call-review-tool.test.ts:309`），符合R5。
- 上述记录断言走公开 read 路由，没有用数据库读取代替业务断言（三个场景文件分别`:82、77、122`；H`:147`）。先经 Workflow 停在 start，再调用真实 Runtime，符合H的入口裁定。
- K3-48（二）确实证明模型收到 capacity且记录未变（`K3-10-review-round-cells.test.ts:252、259`），但尚不能证明短写后的完整恢复链。

其余 UNSPECIFIED：

- **1，建议：** `review-admission.ts:46、90` 以 kind 把 proposal也套入核对工具集；未来合法 `propose_safer_method` 会被拒。核对工具集应限定 review phase，proposal按L20替换记录工具（规格`:548`）；两阶段共有的只读隔离仍可按 kind。属于第4组接入边界，本次不据此报未施工缺失。
- **4，可接受，无需生产修改：** H把 read seam保持到认定完成（`K3-R1-second-cleanup.test.ts:218、246`），符合模拟旧调用仍在途；原 second_auto_cleanup和streak断言保留（`:223、242`）。
- **6，无需补测：** 命中、未命中及冲突已在 `S5R2-agent-application.test.ts:359、378、388` 经生产默认分派表覆盖；测试文件位置不同不是缺口。

**建议，成本：** 本次生产净增428行。一个具体可合并处是 `workflow.ts:1242` 与`:1269`重复查同一 assignment/binding，并各自处理缺失；修缺绑定时容易只修一支。将已选 binding传给 `planReviewRound`，删除第二次查找和pass分支即可，保留所有规则，也保证 capability和准备使用同一选择。无需为压行数合并不同时间点的授权检查。

先改完列出的几处