#!/usr/bin/env python3
"""Read-only, fixed test entry points exposed to the implementation sessions."""
import subprocess
import shutil
import tempfile
import sys
import json
from pathlib import Path

WORKSPACE = Path('/home/hyh001/projects/coding-platform')
CODE = WORKSPACE / 'coding-platform'
NODE = WORKSPACE / '.toolchain/node-v24.21.0-linux-x64/bin/node'
KERNEL = CODE / 'vendor/coding-agent'
NEXT = CODE / 'next'

checks = {
    'next-terminal-history': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/kernel/R4-terminal-history.test.ts', 'tests/runtime/R4-control-runtime.test.ts']),
    'next-kernel-patch': (NEXT, ['scripts/build-kernel-patch.mjs', '--check']),
    'next-role-platform': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/composition/R3d-R3g-platform.test.ts']),
    'next-initial-plan': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R5b-initial-plan.test.ts', 'tests/business/R5b-initial-planning-workflow.test.ts']),
    'next-query-execution': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R5b-query-execution.test.ts', 'tests/runtime/R5b-query-session-loop.test.ts']),
    'next-workflow-advancement': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/business/R5c-workflow.test.ts', 'tests/composition/R5c-workflow-platform.test.ts']),
    'next-completion': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R3e-completion.test.ts', 'tests/composition/R3e-completion-platform.test.ts']),
    'next-query-job': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R5b-query-job.test.ts', 'tests/composition/R5b-query-job-platform.test.ts']),
    'next-control-runtime': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/runtime/R4-control-runtime.test.ts', 'tests/composition/R4-control-runtime-platform.test.ts']),
    'next-r6-host': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/app/R6-host.test.ts', 'tests/app/R6-workbench.test.ts']),
    'next-ui-types': (NEXT, ['../node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.ui.json']),
    'next-build': (NEXT, ['--run', 'build']),
    'next-evidence': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R3e-evidence.test.ts', 'tests/work-graph/R3e-evidence-coverage.test.ts', 'tests/composition/R3e-command-check-platform.test.ts']),
    'next-control-intent': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R4-control-intent.test.ts', 'tests/composition/R4-control-platform.test.ts']),
    'next-git-read': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/data/R2e-git-operations.test.ts', 'tests/runtime/R2e-git-source-loop.test.ts']),
    'next-git-read-neighbors': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/data/workspace-text-operations.test.ts', 'tests/data/R2e-text-boundaries.test.ts', 'tests/runtime/source-text-loop-migration.test.ts', 'tests/data/workspace-capture.test.ts', 'tests/data/workspace-capture-access.test.ts', 'tests/data/workspace-path-boundary.test.ts', 'tests/app/project-source-tool.test.ts', 'tests/context/verification-workspace-reader.test.ts']),
    'next-tool-group-barrier': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/kernel/R4-tool-group-barrier.test.ts']),
    'next-frozen-kernel': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/kernel/R4a-frozen-public.test.ts']),
    'next-bootstrap': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R5a-project-bootstrap.test.ts', 'tests/composition/R5a-project-bootstrap-platform.test.ts']),
    'next-future-intent': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/W2-future-intent.test.ts', 'tests/composition/W2-future-intent-platform.test.ts']),
    'next-runtime-platform-tools': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/runtime/C2-runtime-platform-tools.test.ts', 'tests/work-graph/C2-mailbox-admission.test.ts', 'tests/composition/C2-runtime-platform.test.ts']),
    'next-runtime-driver': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/runtime/B2-runtime-execution.test.ts']),
    'next-b2-composition': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/composition/B2-runtime-platform.test.ts', 'tests/composition/C1-M1-platform.test.ts']),
    'next-whiteboard-tools': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/runtime/W2-whiteboard-tools.test.ts', 'tests/runtime/W2-role-skills.test.ts']),
    'next-agent-whiteboard': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/W2-agent-whiteboard.test.ts']),
    'next-b2-material-admission': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/B2-material-admission.test.ts']),
    'next-material-facts': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/M2-material-read-facts.test.ts']),
    'next-runtime-execution': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/runtime/B2-runtime-execution.test.ts', 'tests/composition/B2-runtime-platform.test.ts']),
    'next-material-grants': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/M1-material-grants.test.ts', 'tests/data/M1-material-source-provider.test.ts']),
    'next-kernel-history-public': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/kernel/B2-history-public-export.test.ts']),
    'next-execution-state': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/B2-execution-entry.test.ts', 'tests/work-graph/B2-execution-result.test.ts', 'tests/work-graph/B2-model-request.test.ts']),
    'next-session-mailbox': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/C1-session-mailbox.test.ts', 'tests/runtime/C1-communication-tools.test.ts']),
    'next-future-plan': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/W1-future-plan.test.ts', 'tests/composition/W1-future-plan-platform.test.ts']),
    'next-kernel-assembly': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/runtime/B1-kernel-assembly.test.ts']),
    'next-catalog': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/A1-architecture-catalog.test.ts']),
    'next-catalog-platform': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/composition/A1-graph-session-platform.test.ts']),
    'next-graph-agent': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/A1-architecture-catalog.test.ts', 'tests/work-graph/A1-session-lifecycle.test.ts', 'tests/work-graph/A1-session-discovery.test.ts']),
    'next-source-authority': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R4c-source-authority-reader.test.ts', 'tests/runtime/R4c-source-authority-guards.test.ts', 'tests/runtime/source-binding-migration.test.ts']),
    'next-history-index': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R4c-execution-history-index.test.ts']),
    'next-history-range': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/runtime/R4c-kernel-history-range.test.ts']),
    'next-graph-history': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/runtime/R4c-graph-history.test.ts', 'tests/runtime/R4c-execution-history.test.ts', 'tests/runtime/R4b-session-operations.test.ts']),
    'next-execution-reads': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R4c-execution-read.test.ts']),
    'next-execution-history': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/runtime/R4c-execution-history.test.ts']),
    'next-task-claim': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R4c-task-claim.test.ts', 'tests/work-graph/R4c-task-claim-boundaries.test.ts', 'tests/work-graph/R4c-task-claim-concurrency.test.ts', 'tests/composition/R3c-R4b-platform.test.ts', 'tests/work-graph/R3c-canonical-task-state.test.ts', 'tests/work-graph/R4b-session-directory.test.ts', 'tests/work-graph/R3g-role-spec.test.ts']),
    'next-task-relations': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R3c-task-relations.test.ts', 'tests/work-graph/R3c-task-relations-boundaries.test.ts', 'tests/work-graph/R3c-task-inputs.test.ts', 'tests/work-graph/R3c-task-graph.test.ts', 'tests/work-graph/R3c-canonical-task-state.test.ts', 'tests/composition/R3c-R4b-platform.test.ts']),
    'next-session-continuity': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/runtime/R4c-session-continuity.test.ts', 'tests/runtime/source-tool-lifecycle.test.ts']),
    'next-roles': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R3g-role-spec.test.ts']),
    'next-observed': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R3d-observed-architecture.test.ts', 'tests/work-graph/R3d-observed-boundaries.test.ts', 'tests/work-graph/R3d-record-integrity.test.ts']),
    'next-store-extensions': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/record-store/transaction-extensions.test.ts']),
    'next-plan': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R3c-plan-entry.test.ts', 'tests/work-graph/R3c-plan-adoption.test.ts', 'tests/work-graph/R3c-task-graph.test.ts', 'tests/work-graph/R3c-canonical-task-state.test.ts']),
    'next-session-directory': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R4b-session-directory.test.ts', 'tests/work-graph/R4b-session-boundaries.test.ts']),
    'next-session-runtime': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/runtime/R4b-session-operations.test.ts', 'tests/runtime/R4b-session-skeleton.test.ts', 'tests/runtime/R4b-session-recovery.test.ts', 'tests/runtime/R4b-session-input-boundaries.test.ts']),
    'next-sessions': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R4b-session-directory.test.ts', 'tests/runtime/R4b-session-operations.test.ts', 'tests/runtime/R4b-session-skeleton.test.ts', 'tests/runtime/R4b-session-recovery.test.ts', 'tests/runtime/R4b-session-input-boundaries.test.ts']),
    'next-store': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/record-store', 'tests/work-graph/goal-independent.test.ts']),
    'next-material-readers': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/material-readers.test.ts']),
    'next-types': (NEXT, ['../node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.json']),
    'next-architecture': (NEXT, ['scripts/check-boundaries.mjs']),
    'next-tests': (NEXT, ['../node_modules/vitest/vitest.mjs', 'run']),
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
# Multiple next test selections share one Vitest process and one file set.
# Existing single checks, including historical filtered suites, retain behavior.
names = sys.argv[1:]
show = '--show' in names
names = [name for name in names if name != '--show']
if not names or any(name not in checks for name in names):
    raise SystemExit('Choose registered checks (optional --show): ' + ', '.join(checks))
selected = [checks[name] for name in dict.fromkeys(names)]
cwd, original = selected[0]
args = list(original)
if len(selected) > 1:
    if any(folder != NEXT or command[:2] != ['../node_modules/vitest/vitest.mjs', 'run']
           or any(path.startswith('-') for path in command[2:])
           for folder, command in selected):
        raise SystemExit('Only unfiltered next test selections can be combined; other checks run separately.')
    paths = list(dict.fromkeys(path for _, command in selected for path in command[2:]))
    if any(len(command) == 2 for _, command in selected):
        paths = []  # Full next suite already includes all individual selections.
    else:
        paths = [path for path in paths if not any(
            parent != path and (NEXT / parent).is_dir() and Path(path).is_relative_to(parent)
            for parent in paths)]
    args = args[:2] + paths
if 'vitest' in args[0]:
    args += ['--maxWorkers=1', '--no-cache', '--configLoader=native']
isolated_build = set(names) == {'next-build'}
if show:
    description = {'cwd': str(cwd), 'command': [str(NODE), *args]}
    if isolated_build:
        description.update({
            'cwd': '/tmp/next-build-<temporary>/next',
            'preparation': 'physical next copy; exclude root dist, node_modules and caches; preserve vendor/coding-agent/dist',
            'dependencyLinks': [str(CODE / 'node_modules'), str(KERNEL / 'node_modules')],
            'cleanup': 'remove the complete temporary directory in finally',
        })
    print(json.dumps(description))
    raise SystemExit(0)
if isolated_build:
    # The harness mounts next read-only except for the exact source scope.
    # Mirror verify-isolated's physical product / third-party-only link boundary;
    # this check builds only, without running tests or Kernel reproduction.
    temporary = Path(tempfile.mkdtemp(prefix='next-build-', dir='/tmp'))
    try:
        isolated = temporary / 'next'
        def excluded(directory, children):
            return [name for name in children if name in {
                'node_modules', '.cache', '.vite', '.vite-temp', '__pycache__',
            } or name.endswith('.tsbuildinfo')
                or (Path(directory) == NEXT and name == 'dist')]
        shutil.copytree(NEXT, isolated, ignore=excluded)
        (isolated / 'node_modules').symlink_to(CODE / 'node_modules', target_is_directory=True)
        (isolated / 'vendor/coding-agent/node_modules').symlink_to(
            KERNEL / 'node_modules', target_is_directory=True)
        result = subprocess.run([str(NODE), *args], cwd=isolated)
    finally:
        shutil.rmtree(temporary)
    raise SystemExit(result.returncode)
raise SystemExit(subprocess.run([str(NODE), *args], cwd=cwd).returncode)
