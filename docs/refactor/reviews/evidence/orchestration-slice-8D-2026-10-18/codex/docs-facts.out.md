仅做只读核对，未改文件，未运行测试或构建。以下路径相对仓库根；为缩短引用：

S＝`docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md`；E＝`docs/refactor/reviews/evidence/orchestration-slice-8D-2026-10-18/`；R＝`.dsh-ref/`；W＝`src/core/workspace/`；A＝`src/core/work-graph/architecture/`；STATUS＝`docs/refactor/STATUS.md`。

1. **必须改｜S:895**：“缺 notes 补 []”已撤销，与 S:919 自相矛盾。依据 R/books/s8a-scale-rework-1.md:57、A/architecture-record-codecs.ts:222、:231。改为：“notes 必须存在；缺失则解码拒绝，空列表必须明确写成 []。”

2. **必须改｜S:938**：A-16 正文断言、tests/fixtures 排除安排仍列在“接受”项，未标撤回。R/codex/scale-review.out.md:56 明确撤回。改为：“这两项随决定79撤回，相关测试、夹具及配置均删除。”映射器默认值已在 S:939 标明不接受，这项无需再改。

3. **必须改｜E/lead-acceptance.md:10、:12、:13、:14、:15；S:934；STATUS:266**：把首轮的 importCoverage、C++ 缓存、提供者翻页及 stale 字段当作现行验收；还保留“缺分析器包影响观测”。这些路径已撤销，见 R/books/s8d-rework-impl.md:41、:46，R/dsh/rework-1-final.md:28、:37。改为：“首轮曾如此实现，返工后改用 import_graph 和 NDJSON；观测不再翻页、不依赖 Jedi 包；旧缓存和 stale 限制不再适用。”C++ 失败判定应限定为预处理错误，见 S:885。

4. **必须改｜S:902、:913**：把逐文件异常写成整门语言失败，并笼统写 issueCount 为0。W/capture.ts:378、:424、:432 保留捕获跳过项及显式配置失败项；A/architecture-service.ts:841 区分文件失败与语言失败。改为：“逐文件失败保留来源并记 issues；语言级失败才使 TS 模块层为空。语言级失败仍保留捕获跳过项，TS 显式配置失败另记一项。”

5. **必须改｜S:903**：“configOnly 这一段是空 Map”只适用于8D返工，现已过时。依据 R/books/s8a-scale-impl.md:187、W/capture.ts:351。改为：“configOnly 携带可读的被忽略编译数据库；不可读者通过 skipped 参与配置选择。”

6. **必须改｜S:839**：只强调2048条契约上限，漏掉观测实际截短规则，易覆盖早前已定要求。依据 S:617、`src/contracts/architecture-source.ts:33`、W/architecture-source.ts:89。补为：“契约上限仍是2048条；观测先去重排序，保留不超过500行且累计不超过64 KiB的内容，再加省略说明。”

7. **必须改｜STATUS:30**：“全部回到8D之前的行为”过强。S:588、:589 明确保留构造选项、接线及 Python 三处修改；W/python-source-index.ts:79 已传目录并加 -S。改为：“查源码和严格捕获保留原分析语义；保留分析器选项接线，以及 Python 目录传参、-S 和缺 Jedi 消息修正。”

8. **必须改｜STATUS:262**：并非固定只按 x86_64 读；嵌套 CMake 文件也不是“没解析引用”。依据 S:808、:810。改为：“C/C++ 按数据库目标读取，未写目标才默认 x86_64-pc-linux-gnu；未进入根数据库的嵌套项目文件记 skipped。”

9. **建议｜E/lead-acceptance.md:79；STATUS:264**：限制基本仍成立，但265毫秒须标历史测量。出处是 R/checks/measure-8a-scale-cost.md:18、:20 和 R/books/s8a-scale-impl.md:99。当前全块读取在 A/architecture-service.ts:642；三次材料读取在 W/capture.ts:653、:725、:253；扫描直接调用在 :655。返工去重的是重复记录读取等，见 R/dsh/scale-rework-1-final.md:25。改为：“仍逐次读全部块、每次新观测读取材料三遍；54块约265毫秒是8A旧测量。扫描仍在Host内，严格捕获和索引未增加独立的TS程序预算。”

10. **必须改｜E/README.md:38**：+2160/−125 是返工2累计，不能称“三轮以后”。依据 R/dsh/rework-2-final.md:37、R/s8d-docs.md:46。改为：“返工2累计+2160/−125；返工3本轮另有+36/−23。三轮最终累计须按同一基线重算。”

11. **必须改｜E/lead-acceptance.md:46**：X未展开。R/checks/verify-s8d.out.md:56 指出：imports 返回全语言 importCoverage，令限定路径、limit=10的1500文件查询仍超过60 KiB而失败。改为：“另发现探索 imports 输出膨胀回归；随§11.1删除逐文件覆盖输出而修复。”

12. **必须改｜E/lead-acceptance.md:101**：“不算跳过”错误；默认过滤原因也不能直接套本仓库。W/typescript-light-scan.ts:419 明确记 skipped；W/typescript-source-query.ts:122 用配置覆盖默认根集合，本仓库配置见 `tsconfig.json:16`。改为：“250是首轮回报数字；范围外文件仍记 skipped。返工1测量为1409个TS/JS文件、1162个parsed，不能沿用250或直接归因于默认过滤。”数字出处 R/dsh/scale-final.md:28、R/dsh/scale-rework-1-final.md:27。

13. **必须改｜S:30**：“验收行均公开入口、双后端”漏例外。R/books/s8d-rework2.md:52 明定A-24仅内存；R/dsh/scale-rework-2-final.md:9 保留A-27行号直测。改为：“规定的平台验收行经公开入口、双后端；A-24仅内存，A-27类型引用行号保留扫描层测试。”

14. **必须改｜错误出处**：
   - S:852、:853 所引 `scale-spec-review` 第1项实际讲git，见 R/codex/scale-spec-review.out.md:3；改引 S:600、:603。
   - S:877 文件名应为 `books/s8d-rework2.md`，配置复用在该文件:58。
   - E/lead-acceptance.md:50 的“第10项”不在该实现审查中；“共用分析、提前释放”出自 R/codex/scale-spec-review.out.md:18。
   - E/README.md:19 把§10审查归到§11；按 R/s8d-docs.md:21、:27，改放§10规格行。

15. **建议｜S:886；E/lead-acceptance.md:93**：补足裁定和验收边界。改补：“已完成单元中的预处理失败不算‘单元未完成’”（R/books/s8d-rework2.md:33）；“严格捕获关系上限保护分支未被直接覆盖，无需造不可达状态补测”（R/codex/scale-review2.out.md:3）。实测限制还应补：“四项目R2lex结果来自原型，第二轮无新故障注入；Python只测3.12，未测Django应用项目”（S:804）。