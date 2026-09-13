# CM-1B-001 Gate B 独立验收

结论：PASS。B01–B05 在下述限定范围通过；尚非整批协作记忆验收通过。没有未解决阻断缺陷。验收者 gate_a_independent 未实施被验产品路径，仅审查和运行隔离测试；未修改产品源码、测试源码、上游文档，未提交或推送。

## 精确输入与结束核对

正式输入为 implementation/CM1B-001-snap-01/handoff.md 及其 documents/ 中的 Ticket、ACCEPTANCE-PROMPT 和关联依据；上游为已验收 CMM06-001-snap-01。1270 个源码文件 SHA256 `ba2841a9f018b2c3a22cd2d87eb40ae71a06e7eb0ba27e37121b9b24116d1eea`。产品 HEAD `0eb02717d16412298c786166a75ca1a9d3e05ac7`，文档 HEAD `e99484fb2bd3296a32d8442e74b47d8ed569b3d5`。交付相对 M06 为 17 新增、21 修改、0 删除；包含历史改动的 HEAD patch 不作为单独 1B 差分。

独立运行 verify-snapshot.py，在开始及结束均检查实际 Git 跟踪/新增文件集合、逐文件字节、source-files 副本、11 份冻结文档摘要和 HEAD；snapshot-before.json 与 snapshot-after.json 一致，errors 均为空。主实施者 source-snapshot-after.json 与此一致。

独立运行 verify-build.py，检查 dist 与 vendor/coding-agent/dist 实际文件集合和全部 658 文件摘要，构建 SHA256 `b97065a4437494a649b80cddfc5368e91de1ecf8fb049fd76eebf69bdbccc278` 与 build-origin.json 一致，绑定同一源码 SHA；详见 build-and-logs.json（含冻结日志摘要）。最终检查开始于 2026-09-13T11:36:26Z，在全量结束之后，避免构建产物与测试并发写入。

## 逐项结论

| 条目 | 结论 | 实际放行范围 |
|---|---|---|
| B01 | PASS | 明确记住/纠正直接正式提交；幂等、冲突、容量、存储故障、版本与删除语义；内存及 SQLite Ledger 同一 fold/事务校验。 |
| B02 | PASS | 无需创建开发 Task 的单机用户记忆维护；稳定 profile、跨项目用户偏好、项目隔离及授权选定版本复制，每次消费重查来源。 |
| B03 | PASS | 同 Task 后继 Run 的真实输入采用当前持久记忆；原偏好原文不再提供并经重启重建；纠正、临时例外、删除和来源失效按下一次输入生效。 |
| B04 | PASS | 真实 UI 保存、失败与实际采用版本分离；reply/architecture/progress 三用途接线；确定性浏览器证据和两组实际 DeepSeek 样例分别支持流程与本次表达变化。 |
| B05 | PASS | 实际 started Run 的公开经验生产入口经 Vault/ExecutionNote/项目记忆进入后继、planning/progress/handoff；原始治理见证及正文摘要绑定、Control/Ledger 四项 CAS、旧未知笔记拒导入和稳定来源墓碑；固定来源许可及局部适配。 |

细项实现路径、反例及范围见 coverage.md、source-review.md、defects.md。实施中发现的原始治理依据补写漏洞和同一来源换治理复活漏洞已在本快照闭合，不能仅靠实施者声明关闭。

## 运行证据与分层判断

独立运行环境为 WSL、Node 24.18.0，产品 scripts/test-wsl.sh；隔离测试数据库/服务，未使用用户项目做写入或故障注入。run-independent.sh 记录入口：4 个 memory 文件 10 个用例 PASS，另同 Task memory=true 1 个用例 PASS（3 个不匹配用例跳过），两条命令退出 0。日志为 independent-memory.log、independent-same-task.log。

复用同一冻结源码的集中全量 logs/full-regression.log：322 文件、2156 用例 PASS，792.36 秒，full-regression.exit-code=0。冻结后的 types、Module boundaries、UI types、build 四项退出 0；documents.log 13/13。独立方没有重复全量或构建。定向与全量使用真实 Control、Ledger、Dispatch、Context 与 Runtime，替换的模型边界按用例声明；请求捕获证明组装与投递路径，不等同模型理解。

浏览器证据引用 continuation-01/browser-04 两例及 browser-06 实际 Run 公开经验保存/重启一例。browser-05 测试进程缺少既有 sandbox 路径的失败保留，后续配置既有 bubblewrap 重跑通过；未放宽产品隔离。浏览器三用途表达断言使用确定性模型 fixture，未冒称真实模型运行。

实际模型证据独立解析 real-model-responses-01.json 与 real-herdr-responses-01.json：各 6 个 completed 请求，记录 v1→v2 与服务重启，三个用途的实际 adopted entry/revision 和输出可比较。真实 DeepSeek/deepseek-flash 本次样例支持架构变详细、进度仍简洁的表达变化，详见 model-evidence-summary.json。Herdr 是用户授权的只读样例；其他登记项目只是候选。未重新调用付费模型，未读取或保存密钥；不把输出长度视为采用质量指标。

## 明确边界与后续

此票放行的是小型、显式、版本化记忆和上述公开经验链路。记忆不是 Evidence PASS、权限或正式规范；治理变化后保守排除旧经验，不宣称识别任意自然语言矛盾。新输入组装时刷新，不热改已经发送的请求。容量 256 包含 tombstone，不承诺物理擦除 SQLite 历史字节。跨项目复制不是跨库分布式事务，消费时重新核对来源。

record-experience 使用实际已开始 Run 为人的当前新公开陈述提供来源，允许选择已结束 Run，不证明原 Run 当时持有当前治理。正文、公开笔记、记忆分步保存；只有最后 memory committed 才表示记忆已保存，前面的公开笔记可能先行持久化。

未验收长期采用率或效率收益、图像、所有候选项目质量、自动画像/后台提炼/向量库/自动 Skill 治理、跨设备账户系统。1C、M01–M05 与 I01–I04 后续范围仍需其正式票和整批集成验证，不能用本 PASS 替代。

结束冻结检查已完成；统筹者可结束本快照源码冻结并继续获授权后续票。本报告只对上述精确输入有效，后续源码变更不自动继承本票结论。