# CM-M06-001 开工裁决

输入snap-04/f930c3ef…，Gate A独立通过，见CM-1A-001/acceptance/CM1A-001-snap-04/gate-a-01/acceptance.md。唯一实施owner /root。

- M-D01：旧RegisterWait缺省all，缺省字段不进入旧指纹；新增any仅用于可替代公开报告。request_closed不作为any成员，取消/过期不是报告。any不会提交Evidence、改变必要验证或取消其他Work。
- M-D02：胜出依据是目标Work实际收到的canonical报告Delivery；按DeliveryRecorded持久游标选首个，tie按条件index，记录conditionIndex/DeliveryRef/sourceCursor。请求已回应但没有投递正文不能成为胜出。Control复核，Ledger同一事务重算，admission保存实际满足成员，不伪造其余满足。
- M-D03：候选只从本Work/真实回应取，正文引用必须匹配响应。正文摘要/当前来源/精确grant仍经既有Context和逐请求授权检查；wait满足不声称正文已被模型采用或结论有效，输入准备失败明确阻断provider。权限不是由any授予。
- M-D04：兼容all的现有材料解析；any只固定胜出报告，迟到报告留邮箱。正式回应版本不可变；订阅取消不删除已有Delivery，也不代表撤销Artifact授权。
- M-D05：历史重放是每页512条prefix、固定有限horizon，不新增累计512条产品限制。Host显式起点进入正式Control校验。
- M-D06：通信视图在ReadModel负责，持久事件重建并标freshness/不完整，HTTP与UI只消费它；不得依据驱动内存计数宣称持久状态。

中间定向测试和必要类型/边界，集中实现/审查/文档/清单后冻结并集中全量；按用户当前节奏。所有结果以实际日志补充，当前不是交付PASS。

## M-D07：通信展示的投影实现

采用ReadModelIndex模块的单一CommunicationViewIndex，按StateLedger有序事件重建，并由真实app/state响应供主界面消费。内存与SQLite账本共用同一投影算法，不在两种旧ReadModel表中复制业务规则；因此旧投影库无需猜测新增表是否已回填。每次返回精确sourceCursor，历史缺口/上限/读取失败为not_ready；目前有界扫描上限200页，每页1000，后续若真实负载要求可增加同语义检查点缓存。模式、胜出、等待原因、工作区积压均来自事实；不以保存或wait满足声称模型已采用。

阶段验证：any-04.log四例通过（内存/SQLite × any/all），证明array index 1先回应先选、无Delivery不满足、前驱未结束不接续、迟到报告保留、伪造全满足Ledger提交拒绝、ReadModel重建/项目隔离/freshness。coordination-01.log三文件40例通过，新增真实Host any面对第二未回应报告并重启后进入实际输入。测试不替代后续集中审查、更多边界及最终交验。

## M-D08：首个合格报告的验读准入（替代M-D03的延后检查）
独立审查M06-R02指出：仅canonical引用匹配便占Wait唯一后继名额，不满足“无效材料不充数”。现改为Dispatch先为真实前驱Run准备确定性的精确grant，可信Host观察端口调用Context验读正文/current source；Control只接收宿主观察，不接受命令payload的readable/赢家声明。Ledger在admission事务重算完整canonical候选前缀、匹配grant/正文/basis及版本守卫，首个可读候选才获胜。成功观察前缀与admission同事务留存，不新增资格聚合，不跨重启复用观察。零可读保持Wait active，借用既有intent重试留存原因。已撤销grant不可换随机ID重发。候选至多64，超过显式unavailable，不截断选后者。外部文件系统不声称跨SQLite原子，后继Context/provider仍复核。

## M-D09：重启事件身份与真实输入缺陷
新验读grant使Host any重启用例暴露persistent harness重新初始化事件序列的问题：新事件与历史eventId相同，被投影当作重复事件跳过，导致已提交后继grant不可见。现同一harness的reopen保留注入依赖及默认ID生成器；不改写历史事件。host-qualification-02.log保留失败，03.log三条真实Host链通过，包含any重启后真实ModelRequest精确正文。

M06仍在实施；qualification-01.log有27通过/1失败（失败已定位并在Host定向重验修复），不冒充全票PASS。view-01.log九条投影反例通过。全量仍留到集中冻结收尾。

## M-D10：Host观察的调用生命周期与暂时不可用
不采用Control→Context的DI回调。Dispatch完成验读后在Host一次性记录，按随机token隔离本次admit；精确Wait/前驱/候选版本键再校验，Control仅取已完成事实，Dispatch全路径finally清理。稳定命令指纹排除短命token。source unavailable被Vault压成stale时，整轮unavailable而非排除较早候选；授权投影未包含canonical grant同样unavailable。独立R03/R04与重叠授权反例促成这些收口，细节和复验见review/current-02。

qualification-03.log四文件42例通过（包含真实Host、两个Ledger、前缀伪造/准入前撤权、一次性观察生命周期、投影终态与缺口）。browser-02.log真实HTTP/SQLite/浏览器1例通过：公开Control登记等待与取消、主界面显示、刷新持久化与项目隔离；使用已安装Chromium-1234。browser-01缺对应默认浏览器，保留环境失败日志。均是阶段定向证据，不宣称M06全票通过。
