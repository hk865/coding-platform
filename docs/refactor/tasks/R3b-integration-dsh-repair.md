# R3b 集成主审返修

继续同一 Session、同7文件范围，ports/tests/config/core 仍只读。主 Agent 已审你的候选并新增冻结测试，不能只按基础自检宣布完成。

1. 新 check.py `r3b-host-boundaries` 在候选是1失败1通过：新 Host路径即使注入了grantAuthority，也必须有 currentBasisValid，不能用 `basisValid && ...` 把能力缺失变成跳过检查。构造时明确拒绝缺失能力，或读取前明确拒绝均可；建议构造检查并将内部 HostMaterialPath 收窄为确实包含该函数，保持读取前后两次canonical basis/撤权检查。不修改公共 MaterialAccessResolver（legacy可选语义保留），不改测试。
2. 你为 InMemoryHarness 额外发布 materials，并无论传入自定义 vault 与否都创建defaultVault，使 h.vault 与 h.materials 可能操作不同正文库。该新 API 没有本批消费者、也不在批准的必要公开入口内。删除 InMemoryHarness.materials 的接口/return/import新增项，将默认ArtifactVault按 options.vault ?? new ArtifactVault(...) 懒创建；默认Vault仍注入authority/grants/clock，自定义旧ArtifactPort不强行发布新能力。PersistentPlatform.materials 是本批GUI真实消费者必需，保留并标readonly。
3. SqliteArtifactVault.close 只委托 raw.close 即可，raw store已唯一拥有关闭和幂等状态，删除重复closed字段/判断。保留原公开close签名。

额外主审已提供 `r3b-body-first`（真实Dispatch提交失败和正文失败）与 `r3b-query`（既有真实Query输入读取链），也需运行。其余上轮指定检查照旧，尤其 r3b-host/r3b-gui/r3b-regression/types/architecture。架构输出已明确 fullDependencyDagVerified=false 和两条临时DI边；这是登记迁移债，不得删掉或伪造整图无环。

交付实际检查、这三处精简与剩余问题；源码图/文档由主Agent同步，不由你改写。
