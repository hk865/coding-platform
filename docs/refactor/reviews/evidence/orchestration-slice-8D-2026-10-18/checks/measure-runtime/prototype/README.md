# Python 轻型 import 扫描原型（slice-8 草稿 4 §11.3）

2026-10-17，Claude 子 agent 写，给测“运行时依赖抓不到多少”的几个实测 agent 用。只用标准库，WSL 的 Python 3.12.3 上跑。
这是测量用的原型，不是生产代码：不走 §11.5 的 NDJSON 执行器，不起子进程，不强制限时（只记时间）。

## 文件

| 文件 | 用途 |
| --- | --- |
| `../scripts/light_import_scan.py` | 原型本身 |
| `../scripts/pyproto_cases.py` | 夹具和期望值：A-20、A-21 照草稿 §11.6 原文抄；X1–X6 是我先按 §11.3 手算、再跑 |
| `../scripts/pyproto_check.py`、`../scripts/pyproto-check.sh` | 建夹具、逐例跑原型、比期望 |
| `../scripts/pyproto_cpython_crosscheck.py` | 只对**我们自己写的**夹具，用 CPython 的 `importlib.util.find_spec` 对照查找结果（会执行父包的 `__init__.py`，绝不能用在下载的代码上） |
| `validation.txt` | 校验的完整输出（24 例） |
| `cpython-crosscheck.txt` | CPython 对照的输出 |
| `smoke.txt` | 本机现成 Python 目录上的冒烟数字 |

## 用法

```bash
# 在 WSL 里，工作目录放在被扫的目录外面；下载来的东西一律用 -I
cd / && python3 -I /mnt/d/cc-lead-notes/impl/s8d/measure-runtime/scripts/light_import_scan.py WORKSPACE \
    [--file-list LIST] [--literal-dynamic] [--out OUT.json] [--pretty]
# 大一点的项目照规矩包一层：
#   free -m 看 available > 2000，然后 systemd-run --user --scope -q -p MemoryMax=6G python3 -I ...
```

- `WORKSPACE`：工作区根。
- `--file-list LIST`：工作区里的文件清单（相对路径，换行或 NUL 分隔，例如 `git -C WORKSPACE ls-files -z --cached --others --exclude-standard`，模拟决定 77 的 git 清单）。不给时遍历目录，不进 `.git`、`node_modules`、`.venv`、`venv`、`__pycache__`、`.mypy_cache`、`.pytest_cache`、`.tox`（§10 第 1 条的名单）；给了清单也照样去掉这些目录里的路径。符号链接不进材料。**配置文件也要在清单里才算存在**（同生产：选配置只看材料）。
- `--literal-dynamic`：另外报 `importlib.import_module("x")`、`import_module("x")`、`__import__("x")`（含 `importlib.__import__`、`builtins.__import__`）里名字是字符串字面量的调用，用同一套规则对到文件；**不算边**，单独放在 `dynamic` 里；名字不是字面量的调用列在 `dynamic.nonLiteral`（带行号和参数的源码）。
- `--out`：写 JSON 到文件，stderr 打一行汇总；不给时 JSON 打到 stdout。

### 输出

```text
files        认领的 Python 文件数（.py/.pyi，扩展名不分大小写），含被“捕获”跳过的
parsed       解析成功的文件数
failed       [{path, reason}]  解析失败的文件（reason 照 §11.3）
skipped      [{path, reason}]  像捕获那样跳过的：超过 2 MiB → 'source exceeds file capacity'；含 NUL 或不是 UTF-8 → 'binary source'
edges        [[from, to, specifier]]  按 (from, to) 去重，留第一个说明符；按 (from, to) 排
unresolved   [{from, specifier, reason}]  按 (from, specifier) 去重，原因取按字符串排在前面的非 null 的
notes        §11.5 的 notes（Python 只有“观测不用的字段”“用不了的查找根”两种）
reason       整门语言失败时的原因字面量，否则 null
edgesStatus  'supported' | 'failed'；complete = parsed == files 且没有 failed/skipped
config       选中的配置文件名或 null；roots 查找根（按顺序，'.' 是根）
stats        秒数、原始引用条数（每个 alias 算一条）、按原因数的没解析、最慢的文件、超过 20 秒的文件数、是否超过 120 秒、
             原型里遇到 §11.3 列表以外异常的次数
dynamic      只在 --literal-dynamic 时有：literalSites、resolvedSites、nonLiteralSites、edgePairs、
             edgePairsNotInStaticEdges（动态边里静态边没有的 (from,to) 对数）、sites、nonLiteral
```

整门语言失败时同草稿：`parsed: 0`、没有边、没有没解析、`notes: []`，`failed` 是空的，`skipped` 只有捕获跳过的。

## 实现了什么（逐条对 §11.3、§11.5）

- **材料：** 像 `captureObservationSource` 那样读：超过 2 MiB、含 NUL、不是 UTF-8 的跳过（原因用 8A 的英文）；开头一个 BOM 去掉（内核的 `TextDecoder` 也去掉；不去的话 `ast.parse` 报 `invalid non-printable character U+FEFF`）。
- **选配置：** 根上 `pyrightconfig.json` → `pyproject.toml` → `setup.cfg`，按“存在”选（读到的或被跳过的都算存在）；选中的被跳过 → `<文件名> 读不了：<跳过原因>`，不换下一个。
- **查找根的顺序**（照 `python-source-query.py:81–109`，按配置分）：
  - `pyrightconfig.json`：`.`；`autoSearchPaths` 不是 `false` 且 `src/` 下有 Python 文件时 `src`；`extraPaths`；`stubPath`。
  - `pyproject.toml`：`.`；`[tool.setuptools]` 的 `package-dir` 里空包名那一项；`[tool.setuptools.packages.find]` 的 `where`；然后 `[tool.pyright]` 的 `src`、`extraPaths`、`stubPath`（没有 `[tool.pyright]` 也照默认加 `src`）。`packages` 不是表（如 `packages = ["a"]`）或 `find` 不是表时不看。
  - `setup.cfg`：`.`；`[options] package_dir` 里 `=` 开头的行；`[options.packages.find] where`（逗号或换行）；不加 `src`。
  - 没有配置：`.`；`src/` 下有 Python 文件时 `src`。
  - 重复的根只留第一次的位置；`./lib` 规范成 `lib`。没有任何 Python 文件时不加 `.`（同今天的代码）。
- **观测模式：** `pythonVersion`、`pythonPlatform`、`venv`、`venvPath`、`typeshedPath`、`executionEnvironments`、`include`、`exclude`、`ignore`、有包名的 `package-dir`/`package_dir` 只记进 `<配置文件名> 里观测不用的字段：…`；绝对路径、含 `..` 段、`\ : $ ~ * ?`、空段、在跳过名单目录里、下面没有认领的 Python 文件的根去掉，记进 `<配置文件名> 里用不了的查找根：…`（照配置里写的，去重、按字符串排、用“、”连，整条截到 200 个字符）。
- **配置错误只用 §11.3 的字面量：** 解析不了（JSON、TOML、`setup.cfg`）；`pyrightconfig.json 不是对象`；`pyproject.toml 的 tool|tool.setuptools|tool.setuptools.package-dir 不是表`；`tool.pyright 不是对象`；`extraPaths 不是字符串列表`；`stubPath 不是非空字符串`；`packages.find.where 不是字符串列表`；`extends 观测还不跟进`。检查的先后照今天的代码（setuptools 在 pyright 前；pyright 里 `extends` 最先）。
- **每个文件：** `ast.parse` 一次；`SyntaxError`（含 `IndentationError` 等子类，取 `msg`）、`RecursionError`、`MemoryError`、`ValueError`（取 `str(e)`）让文件 `failed`，原因 `<异常类型>: <消息>` 截 200 个字符；`SyntaxWarning` 静音。用 `ast.walk`（不递归）收全部 `Import`、`ImportFrom`，按行号排好再解析。
- **对到文件：** 照 §11.3 一级一级查，路径大小写完全一致；每个目录里 `n/__init__.py` → `n.py` → `n/__init__.pyi` → `n.pyi` → 命名空间部分（`d/n` 是某个认领文件的祖先目录）；`import a.b.c` 的五种结果按草稿的先后取；`from X import n`、`from X import *`、相对导入（最长的根算模块名、`__init__` 的包是自己、k 个点往上 k−1 级、越过顶层包）；自己到自己的边不记、也不记没解析；同一 `(文件, 说明符)` 边和没解析两样都留。
- **没有做的：** 生产执行器的协议、子进程、限时、重启；`python_index`（Jedi）那一侧的断言（A-21 里 `python_index` 的几句不在原型范围里）。

### 原型自己定的（草稿没写，生产不照这个）

- `files` 含被捕获跳过的认领文件（生产里 `files` 由捕获 owner 算，原型照“认领的每个文件都有结果”这样算）。
- 遇到 §11.3 列表以外的异常时，原型把这个文件记成 `failed`、原因 `分析进程崩溃（原型里是 …）`，并在 `stats.unexpectedExceptions` 里数（生产里脚本会崩、执行器记“分析进程崩溃”）。到现在 0 次。
- `package-dir` 里空包名那一项的值不是字符串时，当成用不了的根，note 里写它的 JSON。
- `--literal-dynamic` 的解析：`import_module("a.b")`、`__import__("a.b")` 照 `import a.b`；`import_module(".x", pkg)` 照 `importlib._resolve_name` 先拼成绝对名再照 `import`（`pkg` 是字面量、`__package__` 或 `__name__`；别的写法原因 `动态：package 不是字面量`，没给 `package` 或包名是空的 `动态：相对名字没有 package`）；`__import__("x", g, l, f, level)` 的 `level` 是正整数时照 `from <k 个点>x import *`。只认 `importlib.import_module`、`import_module`、`__import__`、`importlib.__import__`、`builtins.__import__` 这几种写法（`import importlib as il` 之后的 `il.import_module` 认不出）。

## 校验结果

`bash /mnt/d/cc-lead-notes/impl/s8d/measure-runtime/scripts/pyproto-check.sh` → **24 例全过，0 例不符**（完整输出 `validation.txt`）。夹具在 WSL `~/dsh-work/measure-runtime/fixtures/python-prototype/`，每例一个工作区；原型每次单独起 `python3 -I`、工作目录 `/`。

- **A-20**（草稿第 197–200 行）：恰好 12 条边、8 条没解析，原因逐条相同；`files 22, parsed 22, supported, reason null, notes []`。
- **A-21**（草稿第 202–207 行）六例都对：`pythonVersion` 记进 notes、`bad.py` 失败原因 `SyntaxError: invalid syntax`、边 `(a.py,b.py)`、`(d.py,lib/c.py)`；`extraPaths = "lib"` → `配置错误：pyproject.toml 的 extraPaths 不是字符串列表`；`vendor` → `pyproject.toml 里用不了的查找根：vendor`、`d.py` 的 `c` 没解析；带 NUL 的 `pyrightconfig.json`（另放了一个能用的 `pyproject.toml`，确认不退）→ `pyrightconfig.json 读不了：binary source`；`extends` → 字面量；根的顺序例 → 边 `(x.py, a/m.py)`。
- **X1–X6**（我手算的，不是草稿的）：`setup.cfg` 的根和有包名的 `package_dir`；`pyrightconfig.json` 的三种用不了的根（`lib/`、`/abs`、`vendor`）和三个不用的字段、notes 的排序；只有 `__init__.pyi` 的包；相对导入里和标准库同名的命名空间目录；`.mm 是模块，不是包`；捕获跳过（NUL、latin-1）、BOM、CRLF、`IndentationError`、`multiple exception types must be parenthesized`；`--literal-dynamic` 的 5 处字面量和 1 处非字面量；11 个配置错误字面量各一例（含带注释的 `pyrightconfig.json` 不退到 `pyproject.toml`）；`autoSearchPaths: false`；两个根里的命名空间部分合起来、后一个根里的模块胜过前一个根里的命名空间目录、大小写不一致找不到。
- **CPython 对照**（`cpython-crosscheck.txt`）：在 A-20、A-21-6、X6 上，`find_spec` 和原型对每个绝对名字的结论一致（`a.b.c`、`a.b.c.d` 不是包、`mod.x`、`email` 落到标准库、`ns` 命名空间、`plug` 落到 `lib/plug/__init__.py`、`shared.util` 找不到、`nsx` 两个部分、`mixed` 落到 `lib/mixed.py`、`Upper` 找不到、`m` 落到 `a/m.py`）。只有 `.pyi` 不同，是规则有意的：CPython 不导入 `.pyi`（`native`、`tp`、只有 `__init__.pyi` 的 `stubpkg`），§11.3 把它们当文件。
- 另外确认检查脚本不是空跑：故意给 A-20 错的期望，四处都报出不符。

## 冒烟（本机现成目录，不是下载的项目）

见 `smoke.txt`。`/usr/lib/python3/dist-packages` 8,532 个文件单进程 25.2 秒、最大常驻 262 MB，0 失败、0 个列表外异常；最慢的单个文件 0.21 秒。按这个速度，§11.3 的整门语言 120 秒大约够 4 万个文件（生产要加上 NDJSON 往返，没量）。

## 规则上看到的问题（交 lead 判断）

1. **相对导入算不算“和标准库重名”。** 草稿：“`from .a.b import n`：在起点目录里找 `a`，之后同 `import a.b`”。照字面，`from .json import y`（包里有个没 `__init__.py` 的 `json/` 目录）会得到 `命名空间目录和标准库重名`；但相对导入的名字带包名，标准库遮不住它。原型只对绝对名字的第一段用这条（X2 例）。
2. **相对导入里“点号全名”怎么写。** 草稿：“原因 `<到这一段为止的点号全名> 是模块，不是包`（如 `a.b 是模块，不是包`）”。相对导入时可以是写法（`.mm`）也可以是绝对名（`rel.mm`）。原型用写法带点（`.mm 是模块，不是包`）；dist-packages 里真有 `.packages.six 是模块，不是包`、`..packages.six 是模块，不是包`。
3. **只有 `__init__.pyi` 的起点目录。** 草稿：“`from . import n` 的 `X` 就是起点目录（有 `__init__.py` 时是正规包，否则当只有这一个目录的命名空间包）”，而查找规则里 `n/__init__.pyi` 算正规包，模块名那句也写 `__init__.py(i)`。原型把 `__init__.pyi` 也当正规包（X2 例的 `stubpkg/m.py`）。
4. **结尾带 `/` 的根被当成“空段”去掉。** 草稿：“含 `..`、`\`、`:`、`$`、`~`、`*`、`?` 或空段”。`extraPaths: ["src/"]` pyright 认，这里会被去掉，项目里经它的引用全变成没解析。今天的代码也这样拒（`python-source-query.py:29`，本 worktree 的版本），但观测里是静默少边（只多一条 note）。建议先去掉结尾的 `/` 再查。另外“含 `..`”原型按段算（同今天的代码），`a..b` 这种名字不算。
5. **`pyrightconfig.json` 写了注释或结尾逗号。** pyright 读的是 JSONC，`json.loads` 读不了 → 整门 Python `配置错误：pyrightconfig.json 解析不了`，一条边都没有（X4h 例）。今天的 `python_index` 也一样，但观测里代价更大。是否要读 JSONC，或者记为已知限制，请 lead 定。
6. **运行时塞进 `sys.modules` 的子模块。** `import os.path`（扫标准库时）和 `from six.moves import …`（vendored six）静态上确实是“`os`/`six` 是模块，不是包”，运行时却能导入（`os.py` 给 `sys.modules['os.path']` 赋值；six 装了 meta path importer）。冒烟里 13 + 18 处。原因字面量读起来像代码写错了；建议写进已知限制（运行时改 `sys.modules` 或装 importer 的抓不到），原因文字可以不改。
7. **没有 Python 文件时坏掉的配置。** 草稿没说：一个纯 JS 仓库根上有一个解析不了的 `pyproject.toml`，Python 这门语言要不要 `failed`（`files: 0`）。原型照样读配置、照样失败。
8. **`package-dir` 空包名那一项的值不是字符串**（`{"" = 1}`）草稿没有字面量；原型当成用不了的根。
