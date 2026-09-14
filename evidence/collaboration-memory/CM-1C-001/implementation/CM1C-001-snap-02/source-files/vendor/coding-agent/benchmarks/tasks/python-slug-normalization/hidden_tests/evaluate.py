import importlib.util
import pathlib
import sys


try:
    workspace = pathlib.Path(sys.argv[1]).resolve()
    spec = importlib.util.spec_from_file_location("candidate_slug", workspace / "slug.py")
    if spec is None or spec.loader is None:
        raise AssertionError("cannot import slug.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    cases = {
        "Hello World": "hello-world",
        "  Many   Spaces  ": "many-spaces",
        "Tab\tSeparated": "tab-separated",
        "Line\nBreak": "line-break",
        "Already-Slug": "already-slug",
    }
    for source, expected in cases.items():
        assert module.slugify(source) == expected, source
    print('{"resolved":true,"checks":5}')
except Exception as error:
    print(str(error), file=sys.stderr)
    raise SystemExit(1)
