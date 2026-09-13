# 源码审查

独立验收者未实施产品修改；此前有界审查发现R01–R04均交单owner修改。逐路径审查材料见review/current-01至03，本次与冻结source-files/真实工作树逐文件核对。

新增12文件包含alternative-report契约、观察准备/材料编译器/registry、通信View契约与投影、UI组件/浏览器fixture+test、三Work与投影/registry测试；全部读取。修改32文件重点核对Host工具mode→Control注册/ensure/admit→Ledger选择/原子校验→Dispatch材料/token→Context/provider及两harness接线。

唯一canonical owner不变：Control判断，Ledger原子落账；Dispatch不写wait终态，Context负责正文验读，Host registry保存一次性完成观察，不让Control触发Context I/O。token按调用随机隔离、版本严格匹配/取后销毁，Dispatch finally覆盖提前返回与异常；token不进入幂等指纹，不持久化为授权。

候选基于DeliveryRecorded游标，需真实回应/目标Work/精确bodyRef匹配；Ledger重算完整前缀。正文missing/invalid允许继续，source unavailable/stale必须整轮失败。exact revoked直接refused并继续，不被额外宽grant复活。Wait/Work/参与/角色政策/前驱/Workspace/Goal以及候选grant/request/delivery版本受CAS保护。任何失败不产生半个Wait/admission。

future cursor在实际append位置拒绝；null先通过检查再被固定当前创建horizon。两个Ledger共用逻辑，SQLite写锁内执行，内存无await窗口。旧all缺省/指纹兼容保留。

CommunicationView仅投影事件，不作为准入判定；unknown schema/type/历史缺口不报告空或完成。goal筛选只用于wait列表，backlog/timeline明确标当前工作区。终态采用共享helper；sourceCursor可核对。真实HTTP+UI组件已接入，fixture通过真实Control命令准备数据，不直接伪造View。

边界：未知外部文件在最后一次观察到提交之间变化不能由Ledger锁住；实际运行仍逐请求授权/source复核。64候选以上和200000事件以上fail-closed。PID竞争是lease仲裁与CAS组合证据，不声称强制两个终端提交同时撞锁。
