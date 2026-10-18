只读核对完成，未修改文件、未运行测试或构建。以下文件名均可唯一定位。

返工逐项结论：

1. **已修**：恢复已有登记不再触发抓取（host.ts:905、933）。
2. **已修**：先排序再编号，公开 prepare 验证最终顺序（architecture-reminders.ts:194；S8A-L8-reminders-public.test.ts:357）。
3. **部分修好**：目录拒绝/抛错进入失败出口；2000字符截断、失败事件时刻符合裁定。开始读取仍有遗漏，见下（auto-capture-driver.ts:191；state/architecture-capture.ts:87；architecture-service.ts:1325）。
4. **已修**：省略 mappings 后由服务统一生成，UI 不再生成（architecture-service.ts:1011；requests.ts:200）。
5. **未完全修**：仍有伪触发和直接读库断言，见下。
6. **部分修好**：公开 prepare 的变体已补，门控替代碰时序；读取计数尚未经过 prepare（S8A-L8-reminders-public.test.ts:383、428、446；S8A-L8-auto-capture-gate.test.ts:264；S8A-L8-observation-state.test.ts:598）。
7. **已写全，待 bubblewrap 验证**：双后端三行走真实 Workflow、Run 和检查，断言首次非重放 PASS、序号恰加1、check_passed、pending=false、新 current、旧 previous；重放断言全部不变（S8A-L8-pass-capture.test.ts:308、337、350、365、383、420）。
8. **已修**：删除无生产入口的函数，保留实际使用的构造器（architecture-reminders.ts:188；l8-rework1.diff:304）。
9. **已修**：计数前等待公开状态满足，精确断言保留（WP2-wiring-scenario.test.ts:217、222）。

采纳建议中的前次引用、持久引用、死字段和弱测试清理已落实（auto-capture-driver.ts:179、59、85；architecture-observation.ts:38；l8-rework1.diff:37、1309、4189）；提醒降级的取消分支未完整落实。

**必须改：UNSPECIFIED 6 是生产缺陷。** 分块正文没有工作区范围，内容存储保留首写来源，读取却要求来源属于当前工作区（architecture-service.ts:369、698；body-store.ts:39）。同库的克隆、worktree、空项目容易触发；甚至不必整树相同，一块相同即可，纯边索引块尤其如此。L8 自动加载前次观测后，后续抓取会持续失败，准备时提醒也不可用（architecture-service.ts:1054、1407）。修改思路：每块正文加入稳定的 projectId/workspaceId，使范围参与摘要；同步编解码、字节上限和范围校验，保留来源及路径授权检查。补同内容双工作区公开抓取、再次触发和 prepare 回归。

**必须改：UNSPECIFIED 1 的观测读取失败仍静默退出。** 此时已经取得开始 revision，却直接返回，只留下 pending、没有原因（auto-capture-driver.ts:163、178、180）。修改思路：非取消失败接同一受 revision 保护的失败出口。目录 `not_ready` 可暂接受：当前目录实现不产生该状态（catalog-service.ts:364）；不能因此忽略实际可发生的观测读取失败。

**必须改：抛出的取消被吞掉。** 提醒读取 catch 无条件降级；随后 prepare 可继续保存材料（context-assembler.ts:1043；execution-preparation.ts:270、298）。修改思路：读取后及 catch 检查取消信号，返回 cancelled；补“读取期间取消并抛错”，现有测试只测返回 cancelled（S8A-L8-reminders-public.test.ts:497）。

**必须改：第5、6项测试仍不满足约束。**

- 重复发送登记通知却没有新登记，并直接读库核对 watermark（S8A-L8-observation-state.test.ts:311、356、255、336）。改用真实采用/修订触发，以公开 pending 和晚提交结果验证。
- 新增测试直接写自编失败（S8A-L8-capture-mappings.test.ts:292）。改为真实触发、搬走根目录；或删除重复测试，保留纯状态断言。
- 12/21次读取只测 reader，未证明一次 prepare 的读取次数（S8A-L8-observation-state.test.ts:598、621）。把计数包装接入公开 prepare。

UNSPECIFIED **2、3、4、5、7接受**：引用形状、调用参数指纹、失败时刻静态核对、替代路径排序例和Z01等待均合理（architecture-observation.ts:38；architecture-service.ts:984、1325；S8A-L8-reminders-public.test.ts:357；WP2-wiring-scenario.test.ts:217）。

**建议**：恢复真实 Host 的排队关闭/重启覆盖；原测试删除后，替代例直接调用 driver.close/retryPending，接线保障减弱（l8-rework1.diff:1397；S8A-L8-auto-capture-gate.test.ts:268、291）。

即使 lead 的 bubblewrap 检查通过，上述必须项仍需完成。

先改完列出的几处