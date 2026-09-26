# R3b Host 历史授权最后一项主审返修

继续同Session、仍仅7个批准文件可写。上一轮缺basis配置、隐藏第二内存库、重复close已修；保留。

独立只读审查确认：Host路径绕过旧 runAdmission→grantIssuerOwnsMaterial。resolver只给canonical候选和basis，不是完整授权。非法history grant如果issuedBy Control跨goal、issuer是Run、或history.usage不是historical_explanation，legacy Vault会拒绝，而你目前Host路径会返回正文。

Sol已按主Agent批准在冻结core/work-graph/materials/applicability.ts **仅导出既有 grantIssuerOwnsMaterial，函数体没变**。新的Host真实消费者应复用它，不再复制权限条件，不用假Run验证。`tests/app/R3b-host-boundaries.test.ts`原2项保持不变，追加3个反例；主审在你第二版候选复现 **3失败/2通过**。

请 HistoryMaterialsContext.read 在打开正文前用共享判据核对该历史grant与其history.owner，非法返回forbidden。读取后实际owner须仍相等，前后basis/撤权核对保留。不要改core、types或tests。

测试：r3b-host-boundaries、r3b-host、r3b-gui、r3b-body-first、r3b-query、r3b-regression、platform-types/architecture。主Agent已修复实施环境的只读依赖挂载：既有 `.local/linux-test-tools/node_modules` 现已可见，未安装依赖、未改夹具；独立执行r3b-regression现 **11文件68项全部通过**，所以不要再排除跨进程首写测试或报告宿主缺依赖。新启动的本Session能看到该挂载。

输出实际修改和检查，勿作范围外工作。
