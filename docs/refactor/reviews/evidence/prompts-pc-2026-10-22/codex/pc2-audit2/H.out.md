只读审查完成；未运行测试、构建或变异，未修改文件。

| 编号 | 类别 | 位置（file:line） | 依据 | 问题 | 唯一改法 |
|---|---|---|---|---|---|
| H2-01 | 会出错 | `src/app/server.ts:342` | H-03；`.lead-ref/books/pc2-findings.md:82`；本轮要求非 prompts 行为不变 | 对 `models/save` 提交坏 JSON，base 返回 400、`status/code/reason` 三字段（`.lead-ref/base/src/app/server.ts:339`）；现在额外返回提示词专用 `problems`。这个分支覆盖全部设置路由，超出了 H-03。 | 仅对已识别的 `prompts/` 路由附加 `problems`；其余坏 JSON 响应保持 base 原样，并补非 prompts 的完整响应回归断言。 |
| H2-02 | 会出错 | `src/app/host-settings.ts:1002`；`src/app/host-settings.ts:1015` | H-04；`.lead-ref/books/pc2-findings.md:83`；`.lead-ref/books/pc2-book.md:270` | 合法身份、继承 platform 的用户包若有 `templates:null`，其余为合法空表，保存 `base`、`expectedVersion:2`、`text:"REPAIRED"`，会取得平台版本 2（`resources/prompts/platform/pack.json:65`），随后向 null 赋值抛异常，最终返回 500 `unavailable`（`src/app/server.ts:357`）。base 返回 400 `invalid` 和声明表问题（`.lead-ref/base/src/app/host-settings.ts:955`、`.lead-ref/base/src/app/host-settings.ts:1041`）。`tools:null` 同类。 | 保持冲突比较先行；候选构造只替换对象声明表中的条目，非对象原值保留给统一整包校验，返回 `invalid/problems`，不写文件。补模板、工具两条公开保存反例及全文件字节断言。 |
| H2-03 | 会出错 | `src/app/prompt-packs.ts:280`；`src/app/prompt-packs.ts:288` | H-07；`.lead-ref/books/pc2-findings.md:86`；`.lead-ref/books/pc2-book.md:167` | H-07 只修了正常读完整条链的路径。包 `loop` 继承自己，同时声明 `base.version=0` 且模板文件缺失：读取错误已在 `src/app/prompt-packs.ts:130` 收集，循环分支却只返回 cycle，丢失读取问题，也跳过版本校验。非法父 id、缺父包、父 manifest 不可读的早退亦未统一校验可读链（`src/app/prompt-packs.ts:277`、`src/app/prompt-packs.ts:293`）。 | 链终止错误统一进入收尾：累积链错误，校验已读材料，再合并去重后拒绝；补“循环继承＋版本 0＋缺文件”的完整字面问题断言。 |
| H2-04 | 违规 | `tests/app/PC2-joint-routes-prepare.test.ts:150` | H-09，同 J-01/J-02；`.lead-ref/books/pc2-findings.md:88`；决定 80 | 测试从 Host 取 selection 后，另建 Work 平台并手工注入磁盘源（`tests/app/PC2-joint-routes-prepare.test.ts:136`、`tests/app/PC2-joint-routes-prepare.test.ts:151`）。静态可见，删除真正的 Host 注入 `src/app/host.ts:558`，这些断言仍不受影响；一审指定的接线缺口尚未闭环。 | 在同一 `host.live.platform` 上经公开步骤建立 Goal/Plan/Run、准备和启动，检查该 Host 的请求及记录；取消另一平台的手工源注入。若确需扩展冻结夹具，须由 lead 先裁定并冻结补丁。 |
| H2-05 | 不整洁 | `src/app/prompt-packs.ts:2`；`src/app/host.ts:250`；`src/app/host.ts:353`；`src/app/host.ts:927`；`src/composition/create-platform.ts:250` | H-13；`.lead-ref/books/pc2-findings.md:92`；本轮检查 6 | 指定的三处替换叙事已改，但上述五处生产注释仍保留 `PC-2 ruling N` 批次标识，未满足本轮明确的注释要求。 | 仅删除五处批次前缀，保留现有职责、路径边界和原因说明。 |

逐行结论：

- H-01: OK。无法解析根时错误包含两条路径；成功解析后的原检查不变（`src/app/host.ts:262`、`src/app/host.ts:266`；测试 `tests/app/PC2-H-directory-checks.test.ts:63`）。
- H-02: OK。全部检查先于恢复循环（`src/app/host-settings.ts:610`、`src/app/host-settings.ts:613`；测试 `tests/app/PC2-H-directory-checks.test.ts:83`）。
- H-03: H2-01；请求体及坏 JSON 的字面断言已补（`tests/app/PC2-H-pack-routes.test.ts:111`、`tests/app/PC2-H-pack-routes.test.ts:130`；`tests/app/PC2-H-tool-routes.test.ts:107`）。
- H-04: H2-02；坏旧正文修复、过期版本优先两例已补（`tests/app/PC2-H-pack-routes.test.ts:144`、`tests/app/PC2-H-pack-routes.test.ts:165`）。
- H-05: OK。按字节复用、不同内容碰撞，以及两条保存路径的 `wx` 均落实（`src/app/prompt-packs.ts:463`；`src/app/host-settings.ts:1115`、`src/app/host-settings.ts:1189`）。
- H-06: OK。按真实父目录检查类型和两层包含关系；包内链接保存用例已补（`src/app/prompt-packs.ts:443`、`src/app/prompt-packs.ts:450`；`tests/app/PC2-H-pack-routes.test.ts:400`）。
- H-07: H2-03。
- H-08: OK。扫描排除保留 id（`src/app/prompt-packs.ts:342`；测试 `tests/app/PC2-H-pack-routes.test.ts:255`）。
- H-09: same as J-01/J-02，H2-04。
- H-10: OK。指定的额外 `footprint` 保存反例、完整问题和全文件字节比较已补（`tests/app/PC2-H-pack-routes.test.ts:449`）。
- H-11: OK。字符串前缀兄弟目录、登记后改为覆盖链接两例已补（`tests/app/PC2-H-directory-checks.test.ts:124`、`tests/app/PC2-H-directory-checks.test.ts:137`）。
- H-12: OK。指定不可达分支已删除（`src/app/prompt-packs.ts:310`）。
- H-13: H2-05。

范围方面，H 的八个文件符合白名单；完整改动清单未列四个冻结夹具，不能据此声称完成其基线逐字节比较（`.lead-ref/parts/H-files.txt:1`、`.lead-ref/books/pc2-r1-whitelist.txt:5`、`.lead-ref/all-files.txt:1`）。联合测试新增限额为 `60_000`（`tests/app/PC2-joint-routes-prepare.test.ts:214`、`tests/app/PC2-joint-routes-prepare.test.ts:263`、`tests/app/PC2-joint-routes-prepare.test.ts:400`）。

DSH 自述核对：

- §1.2“只走通半条 Host 链”：**成立**；代码确实另建 Work 平台，因而 H-09 仍未完成（`.lead-ref/replies/pc2-r1-reply.md:10`；`tests/app/PC2-joint-routes-prepare.test.ts:150`）。
- 同项“Host 没有 Work 入口”的解释：**不成立**。夹具虽未开放 `workflow` 配置，但暴露了真实平台；Runtime 构造取决于 `options.runtime`，并非 `workflow`（`tests/helpers/PC2-host-fixture.ts:48`、`tests/helpers/PC2-host-fixture.ts:234`；`src/composition/create-platform.ts:1172`、`src/composition/create-platform.ts:2207`）。
- §1.5 中涉及 H-09 的“same-as 已完成”：**不成立**，见 H2-04（`.lead-ref/replies/pc2-r1-reply.md:13`）。

H-10 的变异记录只能作有限确认：实际拒绝点是未声明槽检查；删除该检查会改变本例结果。“删 section 拒绝”没有精确指明这一点，不能据此确认其 RED 次数（`.lead-ref/replies/pc2-r1-reply.md:53`；`src/contracts/prompts/render-template.ts:104`；`tests/app/PC2-H-pack-routes.test.ts:474`）。

```json
[
  {
    "id": "H2-01",
    "class": "会出错",
    "file": "src/app/server.ts",
    "line": 342,
    "basis": "冻结H-03（.lead-ref/books/pc2-findings.md:82）；本轮要求非prompts路由行为不变",
    "problem": "所有设置路由的坏JSON响应都增加了提示词专用problems。models/save同样受影响；base/src/app/server.ts:339仅返回status、code、reason。",
    "fix": "仅对已识别的prompts/路由附加problems，其余坏JSON响应保持base原样，并补非prompts完整响应回归断言。"
  },
  {
    "id": "H2-02",
    "class": "会出错",
    "file": "src/app/host-settings.ts",
    "line": 1002,
    "basis": "冻结H-04（.lead-ref/books/pc2-findings.md:83）；pc2-book.md:270候选整包校验",
    "problem": "用户包templates:null时，以继承的有效版本保存base会向null赋值抛异常，经server.ts:357返回500 unavailable，而非invalid/problems。tools:null在host-settings.ts:1015同类。",
    "fix": "保持冲突比较先行；候选构造仅替换对象声明表中的条目，非对象原值保留给统一整包校验，返回invalid/problems且不写文件。补模板和工具的公开保存反例及全文件字节断言。"
  },
  {
    "id": "H2-03",
    "class": "会出错",
    "file": "src/app/prompt-packs.ts",
    "line": 280,
    "basis": "冻结H-07（.lead-ref/books/pc2-findings.md:86）；pc2-book.md:167汇总全部问题",
    "problem": "循环继承分支丢弃已收集的读取问题，并跳过可读链校验。包loop继承自己、base版本0且文件缺失时仅返回cycle；非法父id、缺父包及坏父manifest的早退也未统一校验。",
    "fix": "所有链终止错误统一进入收尾：累积链错误、校验已读材料、合并去重后拒绝；补循环继承加版本0加缺文件的完整字面问题断言。"
  },
  {
    "id": "H2-04",
    "class": "违规",
    "file": "tests/app/PC2-joint-routes-prepare.test.ts",
    "line": 150,
    "basis": "冻结H-09同J-01/J-02（.lead-ref/books/pc2-findings.md:88）；决定80",
    "problem": "读取Host selection后另建Work平台并手工注入磁盘源，仍未经过真实Host执行接线。删除src/app/host.ts:558的磁盘源注入不会影响这些断言。",
    "fix": "在同一host.live.platform上经公开步骤建立事实、准备并启动，检查该Host的请求及记录，取消另一平台的手工源注入。若需扩展冻结夹具，由lead先裁定并冻结补丁。"
  },
  {
    "id": "H2-05",
    "class": "不整洁",
    "file": "src/app/prompt-packs.ts",
    "line": 2,
    "basis": "冻结H-13（.lead-ref/books/pc2-findings.md:92）；本轮检查6",
    "problem": "生产注释仍残留PC-2 ruling N批次前缀；同类位置为host.ts:250、353、927及create-platform.ts:250。",
    "fix": "仅删除五处批次前缀，保留职责、路径边界和原因说明。"
  }
]
```

会出错 3，违规 1，不整洁 1，建议 0