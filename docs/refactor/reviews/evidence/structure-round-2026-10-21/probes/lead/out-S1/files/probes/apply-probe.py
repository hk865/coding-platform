#!/usr/bin/env python3
"""Apply the D2 byte-proof probe to one scratch copy root.

Usage: python3 apply-probe.py <copy-root>

The same edits are made in every copy. The script is idempotent: a copy that
already carries the complete probe is left alone; a partial application fails
loudly instead of guessing. Every anchor must occur exactly once.

Edits (all in src/core/agent-runtime/observed-model-run.ts):
  1. import the probe log module;
  2. capture enabledNames + hostAuthorizedTools where runObservedModel computes
     them (the authorised array is bound to a local first, same value/timing);
  3. wrap the existing `additionalTools` callback so it records its own return
     value exactly once;
  4. capture request.tools at the model client's stream input.

Added probe-only files (copied from this directory):
  src/core/agent-runtime/__probe-log.ts
  tests/runtime/__probe-cases.test.ts
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

PROBES = Path(__file__).resolve().parent

IMPORT_ADD = "\nimport { probeLog, probeAdditionalTools } from './__probe-log.js';"

# Two layouts: pristine base (s85-base) and the S1 result, where the block moved
# into assembleObservedExtensions/kernelEnabledToolNames. The captured payloads
# and the injection semantics are identical; only the anchors differ.
IMPORT_ANCHORS = (
    "import { kernelToolNameOf } from '../work-graph/state/unknown-call-kinds.js';",
    "import { assembleObservedExtensions, kernelEnabledToolNames } from './tool-group-assembly.js';",
)

AUTH_ANCHORS = (
    (
        "        hostAuthorizedTools: [...coordinationNames, ...readonlyCommandNames, "
        "...unknownCallReviewNames, ...commandRerunNames],",
        """        hostAuthorizedTools: (() => {
          const probeAuthorized = [...coordinationNames, ...readonlyCommandNames, ...unknownCallReviewNames, ...commandRerunNames];
          probeLog('observed-lists', { enabledNames, hostAuthorizedTools: probeAuthorized });
          return probeAuthorized;
        })(),""",
    ),
    (
        "        hostAuthorizedTools: [...extensions.names],",
        """        hostAuthorizedTools: (() => {
          const probeAuthorized = [...extensions.names];
          probeLog('observed-lists', { enabledNames, hostAuthorizedTools: probeAuthorized });
          return probeAuthorized;
        })(),""",
    ),
)

TOOLS_ANCHOR = """        additionalTools: workspace => {
          const tools: ToolDefinition[] = [];"""
TOOLS_REPLACEMENT = """        additionalTools: workspace => probeAdditionalTools(() => {
          const tools: ToolDefinition[] = [];"""

TOOLS_CLOSE_ANCHORS = (
    (
        """          if (commandRerunTool !== undefined) tools.push(commandRerunTool(workspace));
          return tools;
        },""",
        """          if (commandRerunTool !== undefined) tools.push(commandRerunTool(workspace));
          return tools;
        }),""",
    ),
    (
        """          tools.push(...extensions.create(workspace));
          return tools;
        },""",
        """          tools.push(...extensions.create(workspace));
          return tools;
        }),""",
    ),
)

CLIENT_ANCHOR = """      async *stream(request, options) {
        await o.sourceTools?.assertCurrent?.();"""
CLIENT_REPLACEMENT = """      async *stream(request, options) {
        probeLog('model-client-tools', { tools: request.tools });
        await o.sourceTools?.assertCurrent?.();"""

MARKERS = (
    "from './__probe-log.js';",
    "probeLog('observed-lists'",
    "probeAdditionalTools(() =>",
    "probeLog('model-client-tools'",
)


def replace_once(text: str, anchor: str, replacement: str, label: str) -> str:
    count = text.count(anchor)
    if count != 1:
        raise SystemExit(f"apply-probe: anchor {label!r} occurs {count} times (need exactly 1)")
    return text.replace(anchor, replacement, 1)


def replace_first_matching(text: str, candidates, label: str) -> str:
    """Try each known layout anchor; exactly one must match exactly once."""
    matches = [(anchor, replacement) for anchor, replacement in candidates if text.count(anchor) == 1]
    if len(matches) != 1:
        counts = ", ".join(repr(text.count(anchor)) for anchor, _ in candidates)
        raise SystemExit(
            f"apply-probe: anchor {label!r} matches {len(matches)} known layouts (counts {counts}); "
            "refusing to guess"
        )
    anchor, replacement = matches[0]
    return text.replace(anchor, replacement, 1)


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("usage: python3 apply-probe.py <copy-root>")
    root = Path(sys.argv[1]).resolve()
    if not (root / "package.json").is_file():
        raise SystemExit(f"apply-probe: {root} does not look like a copy root (no package.json)")

    target = root / "src/core/agent-runtime/observed-model-run.ts"
    text = target.read_text(encoding="utf-8")

    if "__probe-log.js" in text:
        missing = [marker for marker in MARKERS if marker not in text]
        if missing:
            raise SystemExit(
                "apply-probe: copy already has a partial probe; refusing to continue. Missing: "
                + ", ".join(repr(item) for item in missing)
            )
        print("apply-probe: source edits already present; skipping")
    else:
        text = replace_first_matching(text, tuple((anchor, anchor + IMPORT_ADD) for anchor in IMPORT_ANCHORS), "import")
        text = replace_first_matching(text, AUTH_ANCHORS, "hostAuthorizedTools")
        text = replace_once(text, TOOLS_ANCHOR, TOOLS_REPLACEMENT, "additionalTools open")
        text = replace_first_matching(text, TOOLS_CLOSE_ANCHORS, "additionalTools close")
        text = replace_once(text, CLIENT_ANCHOR, CLIENT_REPLACEMENT, "model client stream")
        target.write_text(text, encoding="utf-8")
        print("apply-probe: source edits applied")

    shutil.copyfile(PROBES / "probe-log.ts", root / "src/core/agent-runtime/__probe-log.ts")
    shutil.copyfile(PROBES / "probe-cases.test.ts", root / "tests/runtime/__probe-cases.test.ts")
    print(f"apply-probe: probe files written under {root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
