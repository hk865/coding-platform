# B01–B05 覆盖矩阵

输入 CM1B-001-snap-01 / ba2841a9f018b2c3a22cd2d87eb40ae71a06e7eb0ba27e37121b9b24116d1eea。最终Gate结论另见acceptance.md，未取得冻结全量退出码前不作最终PASS。

| 条目 | 当前实现与证据 | 工程行为判断 |
|---|---|---|
| B01 | HumanMemory→唯一MemoryControlEngine→两个Ledger同纯fold/CAS/幂等。独立memory suite覆盖保存/纠正/删除、重复/异载荷、容量/批量/存储故障与损坏读、SQLite并发；删除来源不靠历史日志复活。UI显示scope/revision/source和失败，不把保存说成采用。 | PASS |
| B02 | 独立host/context suite：安装profile无Project/Goal/Run、两项目共享用户偏好/项目隔离、显式选定revision copy/递归源失效、重放后不复活、重开/新项目不抹profile。源码profile独立目录，非伪造执行身份。 | PASS |
| B03 | 独立同Task memory=true：原Task后继Run真实输入、纠正/Host+profile+Runtime重启、旧原文不在新输入；query suite临时例外后仍原长期偏好，删除下一输入不含旧文；source/governance失效排除。更新不取消在途Run。 | PASS |
| B04 | 独立query suite真实内核请求及确定性响应；browser04两例保存/冲突/跨项目/删除/三用途采用；真实DeepSeek两组各6 completed，重启v1→v2、架构增详细而进度仍简洁的本次表达变化。真实模型与浏览器deterministic fixture分层，不混称同一次运行。 | PASS |
| B05 | 正式record-experience以实际started Run/真实Work产生公开note；独立sameTask含后继/规划/进度/交接输入。原始memoryGovernance/body digest、完整四治理CAS，旧note未知拒导入，规范变化后首次导入拒绝，tombstone稳定note ref+digest。browser06实际Run选择/保存/重启。Hermes/OpenClaw固定SHA、MIT通知、规则与失败用例已核对。 | PASS |

边界：不替代Evidence、工具权限、正式规范；治理变化保守排除不是自动理解自然语言矛盾。记忆刷新发生在新输入组装，非热改已发请求。原文移除和上下文重建有实际证据，不夸称任意压缩算法质量。项目copy跨库无分布式事务，每次消费重查来源；256标识包含tombstones。record-experience两阶段保存，公开note可能先于memory失败落账。已结束Run只是人的当前新陈述所选来源，不证明原Run生成时持有新治理。

N/A：1C四种人的决定、M01–M05其余入口迁移、I01–I04整批集成、自动画像/自动后台提炼/向量库/自动Skill治理/跨设备账户系统。实模型样例支持本次结果，未验证长期采用率、效率收益、图像或各用户候选项目整体质量。
