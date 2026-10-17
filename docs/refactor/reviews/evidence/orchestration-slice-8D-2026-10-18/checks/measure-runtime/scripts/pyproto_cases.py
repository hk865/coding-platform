#!/usr/bin/env python3
"""Fixture cases for light_import_scan.py: A-20 and A-21 of slice-8 draft 4 section 11.6 (expected values copied
from the draft text, not from a run), plus extra cases X1-X6 whose expected values the prototype author computed by
hand from 11.3 before running.  Used by pyproto_check.py; this module only holds data.
"""

A20_FILES = {
    'pyrightconfig.json': '{"extraPaths": ["lib"]}',
    'app.py': ('import a.b.c\nimport a.b.c.d\nimport mod.x\nimport email\nimport ns\nimport ns.mod\nimport fast\n'
               'import native\nimport plug\nimport shared.util\nfrom shared import util\nfrom pkg import sub, name\n'
               'from pkg import *\n'),
    'a/__init__.py': '', 'a/b/__init__.py': '', 'a/b/c.py': '',
    'mod.py': '', 'mod/x.py': '',
    'email/utils.py': '', 'ns/mod.py': '',
    'nsuser.py': 'from ns import nothere\nfrom ns import mod\n',
    'fast.py': '', 'fast.pyi': '', 'native.pyi': '',
    'plug/x.py': '', 'lib/plug/__init__.py': '',
    'shared/__init__.py': '', 'lib/shared/util.py': '',
    'pkg/__init__.py': 'from . import sub\nfrom . import helper\nfrom .. import top\nhelper = 1\n',
    'pkg/sub.py': 'from .inner import k\nfrom .deep.leaf import z\n',
    'pkg/inner.py': '', 'pkg/deep/__init__.py': '', 'pkg/deep/leaf.py': '',
    'solo.py': 'from . import x\n',
}

A20_EXPECT = {
    'files': 22, 'parsed': 22, 'edgesStatus': 'supported', 'reason': None, 'notes': [], 'failed': [], 'skipped': [],
    'edges': [
        ('app.py', 'a/b/c.py'), ('app.py', 'fast.py'), ('app.py', 'lib/plug/__init__.py'), ('app.py', 'native.pyi'),
        ('app.py', 'ns/mod.py'), ('app.py', 'pkg/__init__.py'), ('app.py', 'pkg/sub.py'), ('app.py', 'shared/__init__.py'),
        ('nsuser.py', 'ns/mod.py'), ('pkg/__init__.py', 'pkg/sub.py'), ('pkg/sub.py', 'pkg/deep/leaf.py'),
        ('pkg/sub.py', 'pkg/inner.py'),
    ],
    'unresolved': [
        ('app.py', 'a.b.c.d', 'a.b.c 是模块，不是包'), ('app.py', 'email', '命名空间目录和标准库重名'),
        ('app.py', 'mod.x', 'mod 是模块，不是包'), ('app.py', 'ns', '命名空间包，没有文件'), ('app.py', 'shared.util', None),
        ('nsuser.py', 'ns', '命名空间包，没有文件'), ('pkg/__init__.py', '..', '相对导入越过了顶层包'),
        ('solo.py', '.', '相对导入越过了顶层包'),
    ],
}

A21_BASE = {'a.py': 'import b\n', 'b.py': '', 'd.py': 'import c\n', 'lib/c.py': '', 'bad.py': 'def broken(:\n'}
BAD = {'path': 'bad.py', 'reason': 'SyntaxError: invalid syntax'}


def with_base(extra):
    files = dict(A21_BASE)
    files.update(extra)
    return files


CASES = [
    {'name': 'A-20', 'source': 'draft 4 line 197-200', 'files': A20_FILES, 'expect': A20_EXPECT},
    {'name': 'A-21-1 pythonVersion noted', 'source': 'draft 4 line 202',
     'files': with_base({'pyproject.toml': '[tool.pyright]\npythonVersion = "3.11"\nextraPaths = ["lib"]\n'}),
     'expect': {'files': 5, 'parsed': 4, 'edgesStatus': 'supported', 'reason': None,
                'notes': ['pyproject.toml 里观测不用的字段：pythonVersion'], 'failed': [BAD], 'skipped': [],
                'edges': [('a.py', 'b.py'), ('d.py', 'lib/c.py')]}},
    {'name': 'A-21-2 extraPaths not a list', 'source': 'draft 4 line 203',
     'files': with_base({'pyproject.toml': '[tool.pyright]\npythonVersion = "3.11"\nextraPaths = "lib"\n'}),
     'expect': {'files': 5, 'parsed': 0, 'edgesStatus': 'failed',
                'reason': '配置错误：pyproject.toml 的 extraPaths 不是字符串列表', 'notes': [], 'failed': [],
                'skipped': [], 'edges': [], 'unresolved': []}},
    {'name': 'A-21-3 unusable root', 'source': 'draft 4 line 204',
     'files': with_base({'pyproject.toml': '[tool.pyright]\nextraPaths = ["vendor"]\n'}),
     'expect': {'files': 5, 'parsed': 4, 'edgesStatus': 'supported', 'reason': None,
                'notes': ['pyproject.toml 里用不了的查找根：vendor'], 'failed': [BAD], 'skipped': [],
                'edges': [('a.py', 'b.py')], 'unresolved': [('d.py', 'c', None)]}},
    {'name': 'A-21-4 selected config skipped (NUL)', 'source': 'draft 4 line 205',
     'files': with_base({'pyrightconfig.json': b'{"extraPaths": ["lib"]}\x00\n', 'pyproject.toml': '[tool.pyright]\nextraPaths = ["lib"]\n'}),
     'expect': {'parsed': 0, 'edgesStatus': 'failed', 'reason': 'pyrightconfig.json 读不了：binary source',
                'notes': [], 'failed': [], 'skipped': [], 'edges': [], 'unresolved': []}},
    {'name': 'A-21-5 extends', 'source': 'draft 4 line 206',
     'files': with_base({'pyrightconfig.json': '{"extends": "base.json"}'}),
     'expect': {'edgesStatus': 'failed', 'reason': '配置错误：pyrightconfig.json 的 extends 观测还不跟进',
                'notes': [], 'edges': [], 'unresolved': []}},
    {'name': 'A-21-6 root order', 'source': 'draft 4 line 207',
     'files': {'x.py': 'import m\n', 'a/m.py': '', 'b/m.py': '',
               'pyproject.toml': '[tool.setuptools.packages.find]\nwhere = ["a"]\n[tool.pyright]\nextraPaths = ["b"]\n'},
     'expect': {'edgesStatus': 'supported', 'edges': [('x.py', 'a/m.py')], 'unresolved': [], 'notes': []}},
    # ---- extra cases (not in the draft; hand-computed from 11.3 by the prototype author before running)
    {'name': 'X1 setup.cfg roots and a named package_dir',
     'files': {'setup.cfg': '[options]\npackage_dir =\n    =src\n    other = lib\n[options.packages.find]\nwhere = src, extra\n',
               'main.py': 'import p\nimport extra_mod\n', 'src/p/__init__.py': 'from . import q\nfrom .q import r\n',
               'src/p/q.py': '', 'extra/extra_mod.py': ''},
     'expect': {'files': 4, 'parsed': 4, 'edgesStatus': 'supported', 'reason': None,
                'notes': ['setup.cfg 里观测不用的字段：package_dir'],
                'roots': ['.', 'src', 'extra'],
                'edges': [('main.py', 'extra/extra_mod.py'), ('main.py', 'src/p/__init__.py'), ('src/p/__init__.py', 'src/p/q.py')],
                'unresolved': []}},
    {'name': 'X2 pyright roots/notes, __init__.pyi package, relative namespace, dotted reason',
     'files': {'pyrightconfig.json': '{"extraPaths": ["lib/", "/abs", "vendor"], "stubPath": "typings", "venv": "x", '
                                     '"include": ["a"], "pythonPlatform": "Linux"}',
               'stubpkg/__init__.pyi': '', 'stubpkg/m.py': 'from . import m\nfrom . import nothing\n',
               'user.py': 'import stubpkg\nimport tp\nimport libmod\nfrom rel import json\nfrom rel.json import x\n',
               'rel/__init__.py': 'from . import json\nfrom .json import y\nfrom .mm.k import z\n',
               'rel/json/data.py': '', 'rel/mm.py': '', 'typings/tp.pyi': '', 'lib/libmod.py': ''},
     'expect': {'files': 8, 'parsed': 8, 'edgesStatus': 'supported', 'reason': None,
                'notes': ['pyrightconfig.json 里用不了的查找根：/abs、lib/、vendor',
                          'pyrightconfig.json 里观测不用的字段：include、pythonPlatform、venv'],
                'roots': ['.', 'typings'],
                'edges': [('stubpkg/m.py', 'stubpkg/__init__.pyi'), ('user.py', 'stubpkg/__init__.pyi'), ('user.py', 'typings/tp.pyi')],
                'unresolved': [('rel/__init__.py', '.', '命名空间包，没有文件'), ('rel/__init__.py', '.json', '命名空间包，没有文件'),
                               ('rel/__init__.py', '.mm.k', '.mm 是模块，不是包'), ('user.py', 'libmod', None),
                               ('user.py', 'rel', '命名空间包，没有文件'), ('user.py', 'rel.json', '命名空间包，没有文件')]}},
    {'name': 'X3 capture skips, BOM, CRLF, parse failures, literal dynamic', 'args': ['--literal-dynamic'],
     'files': {'nul.py': b'import os\x00\n', 'latin.py': b'x = "\xe9"\n', 'bom.py': b'\xef\xbb\xbfimport crlf\r\n',
               'crlf.py': 'import os\r\nx = 1\r\n', 'indent.py': '  x = 1\n',
               'new.py': 'try:\n    pass\nexcept ValueError, TypeError:\n    pass\n',
               'dyn.py': ("import importlib\nm = importlib.import_module('crlf')\nn = importlib.import_module(name)\n"
                          "o = __import__('pkg.sub')\np = importlib.import_module('.sub', 'pkg')\n"
                          "q = importlib.import_module('.sub', __package__)\nr = importlib.import_module('nothere')\n"),
               'pkg/__init__.py': '', 'pkg/sub.py': ''},
     'expect': {'files': 9, 'parsed': 5, 'edgesStatus': 'supported', 'reason': None, 'notes': [],
                'failed': [{'path': 'indent.py', 'reason': 'IndentationError: unexpected indent'},
                           {'path': 'new.py', 'reason': 'SyntaxError: multiple exception types must be parenthesized'}],
                'skipped': [{'path': 'latin.py', 'reason': 'binary source'}, {'path': 'nul.py', 'reason': 'binary source'}],
                'edges': [('bom.py', 'crlf.py')],
                'unresolved': [('crlf.py', 'os', None), ('dyn.py', 'importlib', None)],
                'dynamic': {'literalSites': 5, 'nonLiteralSites': 1, 'resolvedSites': 3, 'edgePairs': 2,
                            'edgePairsNotInStaticEdges': 2,
                            'sites': [('dyn.py', 2, 'crlf.py', None), ('dyn.py', 4, 'pkg/sub.py', None),
                                      ('dyn.py', 5, 'pkg/sub.py', None), ('dyn.py', 6, None, '动态：相对名字没有 package'),
                                      ('dyn.py', 7, None, None)]}}},
    {'name': 'X4a pyproject tool not a table', 'files': {'m.py': '', 'pyproject.toml': 'tool = 1\n'},
     'expect': {'edgesStatus': 'failed', 'reason': '配置错误：pyproject.toml 的 tool 不是表'}},
    {'name': 'X4b tool.setuptools not a table', 'files': {'m.py': '', 'pyproject.toml': '[tool]\nsetuptools = 1\n'},
     'expect': {'edgesStatus': 'failed', 'reason': '配置错误：pyproject.toml 的 tool.setuptools 不是表'}},
    {'name': 'X4c package-dir not a table', 'files': {'m.py': '', 'pyproject.toml': '[tool.setuptools]\npackage-dir = "src"\n'},
     'expect': {'edgesStatus': 'failed', 'reason': '配置错误：pyproject.toml 的 tool.setuptools.package-dir 不是表'}},
    {'name': 'X4d where not a list', 'files': {'m.py': '', 'pyproject.toml': '[tool.setuptools.packages.find]\nwhere = "src"\n'},
     'expect': {'edgesStatus': 'failed', 'reason': '配置错误：pyproject.toml 的 packages.find.where 不是字符串列表'}},
    {'name': 'X4e tool.pyright not an object', 'files': {'m.py': '', 'pyproject.toml': '[tool]\npyright = 1\n'},
     'expect': {'edgesStatus': 'failed', 'reason': '配置错误：pyproject.toml 的 tool.pyright 不是对象'}},
    {'name': 'X4f pyrightconfig not an object', 'files': {'m.py': '', 'pyrightconfig.json': '[]'},
     'expect': {'edgesStatus': 'failed', 'reason': '配置错误：pyrightconfig.json 不是对象'}},
    {'name': 'X4g stubPath empty', 'files': {'m.py': '', 'pyrightconfig.json': '{"stubPath": ""}'},
     'expect': {'edgesStatus': 'failed', 'reason': '配置错误：pyrightconfig.json 的 stubPath 不是非空字符串'}},
    {'name': 'X4h pyrightconfig with a comment (JSONC) does not fall back',
     'files': {'m.py': '', 'pyrightconfig.json': '{\n  // comment\n  "extraPaths": []\n}\n', 'pyproject.toml': ''},
     'expect': {'edgesStatus': 'failed', 'reason': '配置错误：pyrightconfig.json 解析不了'}},
    {'name': 'X4i pyproject parse error', 'files': {'m.py': '', 'pyproject.toml': '[[\n'},
     'expect': {'edgesStatus': 'failed', 'reason': '配置错误：pyproject.toml 解析不了'}},
    {'name': 'X4j setup.cfg parse error', 'files': {'m.py': '', 'setup.cfg': 'no header\n'},
     'expect': {'edgesStatus': 'failed', 'reason': '配置错误：setup.cfg 解析不了'}},
    {'name': 'X4k pyproject extends', 'files': {'m.py': '', 'pyproject.toml': '[tool.pyright]\nextends = "base.json"\n'},
     'expect': {'edgesStatus': 'failed', 'reason': '配置错误：pyproject.toml 的 extends 观测还不跟进'}},
    {'name': 'X5a autoSearchPaths false drops src',
     'files': {'pyrightconfig.json': '{"autoSearchPaths": false}', 'main.py': 'import m\n', 'src/m.py': ''},
     'expect': {'edgesStatus': 'supported', 'roots': ['.'], 'edges': [], 'unresolved': [('main.py', 'm', None)], 'notes': []}},
    {'name': 'X5b no configuration adds src',
     'files': {'main.py': 'import m\n', 'src/m.py': ''},
     'expect': {'edgesStatus': 'supported', 'roots': ['.', 'src'], 'edges': [('main.py', 'src/m.py')], 'unresolved': []}},
    {'name': 'X6 namespace across roots, module beats later namespace, exact case',
     'files': {'pyproject.toml': '[tool.pyright]\nextraPaths = ["lib"]\n',
               'main.py': 'import nsx.a\nimport nsx.b\nfrom nsx import a, b, c\nimport Upper\nimport mixed\n',
               'nsx/a.py': '', 'lib/nsx/b.py': '', 'upper.py': '', 'mixed/x.py': '', 'lib/mixed.py': ''},
     'expect': {'files': 6, 'parsed': 6, 'edgesStatus': 'supported', 'roots': ['.', 'lib'],
                'edges': [('main.py', 'lib/mixed.py'), ('main.py', 'lib/nsx/b.py'), ('main.py', 'nsx/a.py')],
                'unresolved': [('main.py', 'Upper', None), ('main.py', 'nsx', '命名空间包，没有文件')]}},
]
