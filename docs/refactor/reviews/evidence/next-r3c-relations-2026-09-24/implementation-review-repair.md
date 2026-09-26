# Astra 实现审阅返修（2026-09-24）

第一版没有接受。DSH自报383项PASS后，主审和独立Astra审阅发现：readTaskInput只隔离请求，await之后传原ctx，身份/reader/取消信号可在等待期间被替换；null输入抛异常；新需求ArtifactRef.source={}被视为完整。实际反例第一轮4失败/8通过（Memory/SQLite，见independent-review-red.log）。

主审补充原有两个测试中的完整source形状、畸形请求、异步身份保持/不提权/原信号取消反例，并纠正边界测试旧注释。测试标准只增强，没有放松；其余冻结文件不变。新的只读测试已同步到lane，旧冻结清单存frozen-inputs-before-review.json，当前清单存frozen-inputs.json。下一次DSH调用仍只可写原5个生产文件，沿同一session返修。新引用形状复用已存在RecordStore/body-codec.isArtifactRef，不扩Store或材料授权。

返修后独立终审额外锁住两个正例：consumer自身不具候选资格仍可授权读取；从历史已接受Plan选择输入，当前reader使用另一个Plan及新的有效grant读取。不修改生产接口或放松授权，两条均使用真实Store/材料授权。
