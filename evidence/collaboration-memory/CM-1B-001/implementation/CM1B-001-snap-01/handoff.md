# CM1B-001-snap-01 交验入口

源码已冻结：1270 个文件，SHA256 `ba2841a9f018b2c3a22cd2d87eb40ae71a06e7eb0ba27e37121b9b24116d1eea`。产品 HEAD 保持 `0eb02717d16412298c786166a75ca1a9d3e05ac7`，没有 Git 提交/推送。冻结时间见 source-snapshot.json。唯一实施 owner /root，冻结期间不修改源码。

被验 Ticket 在 documents/dev_docs/planning/active/collaboration-memory/CM-1B-001.md。实际源码逐文件字节在 source-files/，原 M06 输入见 adopted-source-snapshot.json。delivery-files.json 为精确增量：17 新增、21 修改、0 删除。baseline-to-delivery.patch 包含 HEAD 至今的所有历史增量，不能作为仅 1B 差分。

## 当前结果

集中全量已完成：322文件/2156用例通过，退出0；随后冻结类型、模块边界、UI类型和build均退出0，文档13/13通过。source-snapshot-after.json确认源码起止一致，build-origin.json记录实际构建文件摘要。原始日志见logs/。阶段定向证据在../continuation-01/，失败记录保留。当前仍等待另一Agent签出Gate B结论。

| 条款 | 可核对证据 | 边界 |
| --- | --- | --- |
| B01 | maintenance.test.ts：两个 Ledger、幂等/CAS/批量容量/故障/损坏记录、双 SQLite 连接重启、旧来源墓碑 | 容量包含删除标识；不承诺物理擦除历史 SQLite 字节 |
| B02 | host.test.ts：稳定安装 profile、项目隔离、授权选定 revision copy、重放及递归源失效 | 单机单用户，无账户/设备同步；跨库复制非分布式事务 |
| B03 | host-tool-chain.test.ts：同 Task 不同 Run，正式 successor、真实内核输入，profile/Host 重启后纠正替代旧原文 | 输入组装时刷新，不热改已经发送的请求 |
| B04 | query-input.test.ts 与 browser-04/06：三用途、保存与采用版本分离、临时例外、删除、冲突；真实模型六次见 real-model-responses-01.json | 确定性与真实模型分别记录；图像未测 |
| B05 | 实际 record-experience 入口 → Vault/ExecutionNote/项目记忆 → 后继与规划/进度/交接输入；旧规范首次导入拒绝、SQLite最终CAS、删除来源复活拒绝、旧无见证笔记历史兼容 | 人现在的新公开陈述不证明原 Run 当时已持有当前治理；公开 note 可能先于记忆提交持久化 |

targeted-07 为9文件61用例通过。browser-04 的既有两例、browser-06 的真实执行经验保存/重启一例通过。browser-05 是缺少测试进程沙箱路径导致的失败，browser-06 配置现有 bubblewrap 后通过，未放宽产品隔离要求。types-10/ui-types-08/boundaries-08/docs-04 全部退出 0；后续只改证据和 Interface 文档。冻结全量以当前日志为准。

## 独立复审与必须看到的限制

gate_a_independent 对原 B05 两处缺陷复审确认闭合：完整原始治理见证/摘要、Control 和 Ledger 四项 CAS、稳定来源墓碑。该复审不是冻结 Gate。旧 applicableVersions.governanceRevision 继续表示权限策略，未被复用为新治理见证。

运行中的材料按当前版本与来源过滤。小记忆不是 Evidence PASS、工具授权或正式规范。改变正式治理时保守排除旧经验，不声称识别任意自然语言矛盾。公开经验正文、笔记和记忆分步保存，只有最终 memory committed 表示该条进入项目记忆；重试可以复用已存在的公开笔记。

用户提供 DeepSeek 本地密钥并确认 deepseek-flash，产品安全设置连接测试通过；密钥不进入证据。真实样例包含隔离空工作区与后续用户授权的 Herdr 只读项目验证（该项若仍运行，以原 JSON 状态为准）。用户提供的其他项目仅登记为候选，不当成已经验证。

## 重跑与继续

WSL Node 24 PATH 及进程沙箱以 scripts/test-wsl.sh 为准。阶段命令和全量脚本在 ../continuation-01/。验收方按 B01–B05 独立判断，发现缺陷回交编号后创建新快照重验。Gate B 之后继续 1C、M01–M05、I01–I04；M06 和 Gate A 已独立通过，整批仍未完成。
