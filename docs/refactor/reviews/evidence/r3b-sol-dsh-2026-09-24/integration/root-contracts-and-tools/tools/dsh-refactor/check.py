#!/usr/bin/env python3
"""Read-only, fixed test entry points exposed to the implementation sessions."""
import subprocess
import sys
from pathlib import Path

WORKSPACE = Path('/home/hyh001/projects/coding-platform')
CODE = WORKSPACE / 'coding-platform'
NODE = WORKSPACE / '.toolchain/node-v24.21.0-linux-x64/bin/node'
KERNEL = CODE / 'vendor/coding-agent'

checks = {
    'r3b-raw': (CODE, ['node_modules/vitest/vitest.mjs', 'run',
        'tests/data/R3b-materials-contract.test.ts', '-t', 'R3b raw']),
    'r3b-work-graph': (CODE, ['node_modules/vitest/vitest.mjs', 'run',
        'tests/data/R3b-materials-contract.test.ts', '-t', 'R3b WorkGraph']),
    'r3b': (CODE, ['node_modules/vitest/vitest.mjs', 'run',
        'tests/data/R3b-materials-contract.test.ts']),
    'r3b-raw-boundaries': (CODE, ['node_modules/vitest/vitest.mjs', 'run',
        'tests/data/R3b-body-boundaries.test.ts']),
    'r3b-admission-boundaries': (CODE, ['node_modules/vitest/vitest.mjs', 'run',
        'tests/data/R3b-material-admission-boundaries.test.ts']),
    'r3b-await-boundaries': (CODE, ['node_modules/vitest/vitest.mjs', 'run',
        'tests/data/R3b-material-await-boundaries.test.ts']),
    'r3b-gui': (CODE, ['node_modules/vitest/vitest.mjs', 'run',
        'tests/app/R3b-gui-materials.test.ts']),
    'r3b-body-first': (CODE, ['node_modules/vitest/vitest.mjs', 'run',
        'tests/data/R3b-body-first.test.ts']),
    'r3b-query': (CODE, ['node_modules/vitest/vitest.mjs', 'run',
        'tests/context/query-execution-context.test.ts']),
    'r3b-host-boundaries': (CODE, ['node_modules/vitest/vitest.mjs', 'run',
        'tests/app/R3b-host-boundaries.test.ts']),
    'r3b-host': (CODE, ['node_modules/vitest/vitest.mjs', 'run',
        'tests/app/R3b-host-materials.test.ts']),
    'r3b-regression': (CODE, ['node_modules/vitest/vitest.mjs', 'run',
        'tests/vault', 'tests/app/history-materials.test.ts',
        'tests/app/runtime-context.test.ts', 'tests/control/material-access.test.ts',
        'tests/restart/material-access-restart.test.ts',
        'tests/read-model/material-access-lookup.test.ts']),
    'r2e1': (CODE, ['node_modules/vitest/vitest.mjs', 'run',
        'tests/data/workspace-text-operations.test.ts',
        'tests/runtime/runtime-workspace-text-tools.test.ts',
        'tests/data/R2e-text-boundaries.test.ts']),
    'r2e1-regression': (CODE, ['node_modules/vitest/vitest.mjs', 'run',
        'tests/data/workspace-capture.test.ts',
        'tests/data/workspace-capture-access.test.ts',
        'tests/data/workspace-capture-architecture.test.ts',
        'tests/data/workspace-path-boundary.test.ts']),
    'r3a': (CODE, ['node_modules/vitest/vitest.mjs', 'run',
        'tests/data/R3a-goal-record-store.test.ts',
        'tests/data/R3a-goal-input-isolation.test.ts',
        'tests/data/R3a-contract-invariants.test.ts']),
    'r4a': (KERNEL, ['node_modules/vitest/vitest.mjs', 'run',
        'tests/review/independent-r4a-session-recovery.test.ts',
        'tests/review/R4a-recovery-contract.test.ts',
        'tests/review/R4a-resume-environment.test.ts']),
    'r3a-regression': (CODE, ['node_modules/vitest/vitest.mjs', 'run',
        'tests/core', 'tests/data/R3a-goal-record-store.selfcheck.test.ts',
        'tests/integration/historical-ledger-compatibility.test.ts',
        'tests/integration/historical-host-compatibility.test.ts']),
    'r4a-regression': (KERNEL, ['node_modules/vitest/vitest.mjs', 'run']),
    'platform-types': (CODE, ['node_modules/typescript/bin/tsc', '--noEmit']),
    'kernel-types': (KERNEL, ['node_modules/typescript/bin/tsc', '--noEmit']),
    'platform-architecture': (CODE, ['scripts/check-module-boundaries.mjs']),
    'kernel-architecture': (KERNEL, ['scripts/check-architecture.mjs']),
}
if len(sys.argv) != 2 or sys.argv[1] not in checks:
    raise SystemExit('Choose one check: ' + ', '.join(checks))
cwd, args = checks[sys.argv[1]]
if 'vitest' in args[0]:
    args += ['--maxWorkers=1', '--no-cache', '--configLoader=native']
raise SystemExit(subprocess.run([str(NODE), *args], cwd=cwd).returncode)
