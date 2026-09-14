# 宿主关闭超时定位

原始失败：snap-02全套浏览器30通过/1失败/1跳过；memory.spec.ts保存公开经验成功，宿主restart未及时结束，120秒超时。原截图和上下文保存在memory-original-failure。单独原用例一次通过；纯观测重复3次2通过1超时，记录observe.log。

最小反例：preconnect.mjs 用实际构建Host打开一个空TCP连接，不发送HTTP请求，随后app.close。实测closedWithinOneSecond=false，释放socket后close结束。独立方复现相同结果。此反例不依赖记忆/模型/查询。

诊断比较：Runtime排空、HTTP已有连接、服务资源先关闭后仍收请求三个边界。纯观测显示Runtime能退出，HTTP仍有连接；最小反例稳定定位空预连接。没有通过关闭浏览器页面绕过产品缺陷。

修复设计：HTTP入口开始关闭时立即停止监听并拒绝之后进入的请求；记录所有已进入HTTP handler的Promise及response结束，不只依赖service.background；等待受理请求和Runtime排空后关服务/工作区，清理残留连接，再等HTTP关闭。close复用同一Promise。正常已进入handler的半上传请求仍按完整请求排空，不承诺永不结束的客户端上传能在固定时间关闭。

新增定向证明：空连接不阻塞关闭；已发headers但body未完整的真实POST，在关闭开始后补全，仍获得回执并能在重启后读到持久结果。原记忆浏览器重复和受影响Host恢复/取消回归随后验证。snap-02全量已完整结束且指纹不变；现已应用限定修复，正在定向验证。

