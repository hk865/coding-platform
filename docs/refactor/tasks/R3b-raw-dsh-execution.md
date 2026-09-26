# R3b 受限并行实现任务

W=/home/hyh001/projects/coding-platform，C=W/coding-platform。先读 C/AGENTS.md、W/docs/refactor/tasks/R3b-sol-skeleton.md、N= W/docs/refactor/modules/core/{record-store,work-graph}.md 材料章节、docs/refactor/refactor-plan.md R3b。主Agent已审Sol骨架/测试，10项目前因明确未实现而RED。Raw正文与WG规则有独立DSH Session同时实现；你只填下述洞，不管另一组、Host集成或其余R批次。

ports/types、测试、配置、脚本及其他文件由外层操作系统只读。单文件挂载不能原子rename，请用Python Path.write_text或Node fs.writeFileSync原地写批准文件。不要创建文件/安装依赖/重置或提交Git，不修改标准、不增加timeout、不建立新模块/泛型框架。需要冻结接口修改时明确报告具体阻碍，等待主Agent。所有实际实现要复用现有原语，不保留同义规则副本；新的类工厂之外不要发布无消费者API。

主Agent最终独立审阅、运行测试、核对hash后手工合入；你返回已改文件、真正检查、未完成和错误。只跑下面组别，另一组stub未实现是并行中的预期状态，不能为了使全套通过写另一组。你可把自己的额外检查写/tmp/dsh-output，但不能替代冻结测试。

## 你的范围：Raw body (3个文件)

只写 core/record-store/body-codec.ts、body-store.ts、sqlite-body-store.ts。body-ports.ts 是冻结契约。

实现公开骨架，复用已有 artifactBodyDigest/artifactBodySize、256KiB上限、contentType+digest+size键、artifacts(key,record)表。所有物理验证在共享codec/Raw类只保留一份，Memory与SQLite只区别持久机制。输入原始schema形状必须验证，新增put拒绝legacy origin；旧无origin的StoredRecord按ownerRunRef解码legacy，null不猜主体。旧有效ArtifactRef/sourceRefs不得改写或丢失。未知origin/schema、正文digest/size/ref不一致、坏JSON读为corrupt，不能not_found或空正文。非法调用输入返回invalid，与已存数据损坏区别。

content-addressed重复/两连接争用必须保留第一次ref/sourceRefs/origin。原子INSERT ON CONFLICT DO NOTHING和读取获胜行是依据，不用先读再覆盖，不再自己开上层事务。可消除多余预读；旧竞态测试已由Sol移动到INSERT前，断言不变。返回不可泄漏可变内部引用，输入不能在await后漂移。sqlite.close幂等、reopen读取原库；不要自动清库/迁移删数据/GC。编码新行保留旧ownerRunRef兼容字段（Run/QueryRun为其完整ref，TaskAttempt/platform为null），origin为新附加字段；新policy读取规范origin。闭包关闭后的不可用与SQLite异常应明确返回/抛错，不能伪造成功。

检查：python3 /home/hyh001/projects/coding-platform/tools/dsh-refactor/check.py r3b-raw（3项有效，其余按分组跳过）以及 platform-types、platform-architecture。旧Vault暂时没切新raw，旧竞态由集成时主Agent运行，不要冒报已测新接线。
