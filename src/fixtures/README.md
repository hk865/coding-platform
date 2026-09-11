# 宿主默认样例

这些版本化值有实际源码消费者，因此保留在构建内，不能作为纯测试夹具移到 tests。app/service.ts 消费治理、角色规格、计划和显式 fixture 运行脚本；FakeRuntimeAdapter 消费运行脚本；FakeWorkspaceReaderAdapter 消费架构图样例。真实能力是否启用由宿主显式接线决定。

这里不定义公共业务规则。命令构造使用 contracts/commands，纯测试场景在 tests/contract-support/fixtures。未来替换默认样例须先处理上述真实消费者及已保存的版本化引用，不能仅因为名称包含 fixture 就删除。
