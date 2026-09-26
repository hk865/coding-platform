#!/usr/bin/env python3
"""Fixed standalone checks; historical next-* names are retained, not old paths."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

# Reuse pure root/Node/snapshot helpers without writing a cache into a RO lane.
sys.dont_write_bytecode = True
from harness import WORKSPACE, resolve_node, snapshot_ignore

checks = {
    'next-terminal-history': ['node_modules/vitest/vitest.mjs', 'run', 'tests/kernel/R4-terminal-history.test.ts', 'tests/runtime/R4-control-runtime.test.ts'],
    'next-kernel-patch': ['scripts/build-kernel-patch.mjs', '--check'],
    'next-role-platform': ['node_modules/vitest/vitest.mjs', 'run', 'tests/composition/R3d-R3g-platform.test.ts'],
    'next-initial-plan': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R5b-initial-plan.test.ts', 'tests/business/R5b-initial-planning-workflow.test.ts'],
    'next-query-execution': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R5b-query-execution.test.ts', 'tests/runtime/R5b-query-session-loop.test.ts'],
    'next-workflow-advancement': ['node_modules/vitest/vitest.mjs', 'run', 'tests/business/R5c-workflow.test.ts', 'tests/composition/R5c-workflow-platform.test.ts'],
    'next-completion': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R3e-completion.test.ts', 'tests/composition/R3e-completion-platform.test.ts'],
    'next-query-job': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R5b-query-job.test.ts', 'tests/composition/R5b-query-job-platform.test.ts'],
    'next-control-runtime': ['node_modules/vitest/vitest.mjs', 'run', 'tests/runtime/R4-control-runtime.test.ts', 'tests/composition/R4-control-runtime-platform.test.ts'],
    'next-r6-host': ['node_modules/vitest/vitest.mjs', 'run', 'tests/app/R6-host.test.ts', 'tests/app/R6-workbench.test.ts'],
    'next-ui-types': ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.ui.json'],
    'next-build': ['--run', 'build'],
    'next-evidence': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R3e-evidence.test.ts', 'tests/work-graph/R3e-evidence-coverage.test.ts', 'tests/composition/R3e-command-check-platform.test.ts'],
    'next-control-intent': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R4-control-intent.test.ts', 'tests/composition/R4-control-platform.test.ts'],
    'next-git-read': ['node_modules/vitest/vitest.mjs', 'run', 'tests/data/R2e-git-operations.test.ts', 'tests/runtime/R2e-git-source-loop.test.ts'],
    'next-git-read-neighbors': ['node_modules/vitest/vitest.mjs', 'run', 'tests/data/workspace-text-operations.test.ts', 'tests/data/R2e-text-boundaries.test.ts', 'tests/runtime/source-text-loop-migration.test.ts', 'tests/data/workspace-capture.test.ts', 'tests/data/workspace-capture-access.test.ts', 'tests/data/workspace-path-boundary.test.ts', 'tests/app/project-source-tool.test.ts', 'tests/context/verification-workspace-reader.test.ts'],
    'next-tool-group-barrier': ['node_modules/vitest/vitest.mjs', 'run', 'tests/kernel/R4-tool-group-barrier.test.ts'],
    'next-frozen-kernel': ['node_modules/vitest/vitest.mjs', 'run', 'tests/kernel/R4a-frozen-public.test.ts'],
    'next-bootstrap': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R5a-project-bootstrap.test.ts', 'tests/composition/R5a-project-bootstrap-platform.test.ts'],
    'next-future-intent': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/W2-future-intent.test.ts', 'tests/composition/W2-future-intent-platform.test.ts'],
    'next-runtime-platform-tools': ['node_modules/vitest/vitest.mjs', 'run', 'tests/runtime/C2-runtime-platform-tools.test.ts', 'tests/work-graph/C2-mailbox-admission.test.ts', 'tests/composition/C2-runtime-platform.test.ts'],
    'next-runtime-driver': ['node_modules/vitest/vitest.mjs', 'run', 'tests/runtime/B2-runtime-execution.test.ts'],
    'next-b2-composition': ['node_modules/vitest/vitest.mjs', 'run', 'tests/composition/B2-runtime-platform.test.ts', 'tests/composition/C1-M1-platform.test.ts'],
    'next-whiteboard-tools': ['node_modules/vitest/vitest.mjs', 'run', 'tests/runtime/W2-whiteboard-tools.test.ts', 'tests/runtime/W2-role-skills.test.ts'],
    'next-agent-whiteboard': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/W2-agent-whiteboard.test.ts'],
    'next-b2-material-admission': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/B2-material-admission.test.ts'],
    'next-material-facts': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/M2-material-read-facts.test.ts'],
    'next-runtime-execution': ['node_modules/vitest/vitest.mjs', 'run', 'tests/runtime/B2-runtime-execution.test.ts', 'tests/composition/B2-runtime-platform.test.ts'],
    'next-material-grants': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/M1-material-grants.test.ts', 'tests/data/M1-material-source-provider.test.ts'],
    'next-kernel-history-public': ['node_modules/vitest/vitest.mjs', 'run', 'tests/kernel/B2-history-public-export.test.ts'],
    'next-execution-state': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/B2-execution-entry.test.ts', 'tests/work-graph/B2-execution-result.test.ts', 'tests/work-graph/B2-model-request.test.ts'],
    'next-session-mailbox': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/C1-session-mailbox.test.ts', 'tests/runtime/C1-communication-tools.test.ts'],
    'next-future-plan': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/W1-future-plan.test.ts', 'tests/composition/W1-future-plan-platform.test.ts'],
    'next-kernel-assembly': ['node_modules/vitest/vitest.mjs', 'run', 'tests/runtime/B1-kernel-assembly.test.ts'],
    'next-catalog': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/A1-architecture-catalog.test.ts'],
    'next-catalog-platform': ['node_modules/vitest/vitest.mjs', 'run', 'tests/composition/A1-graph-session-platform.test.ts'],
    'next-graph-agent': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/A1-architecture-catalog.test.ts', 'tests/work-graph/A1-session-lifecycle.test.ts', 'tests/work-graph/A1-session-discovery.test.ts'],
    'next-source-authority': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R4c-source-authority-reader.test.ts', 'tests/runtime/R4c-source-authority-guards.test.ts', 'tests/runtime/source-binding-migration.test.ts'],
    'next-history-index': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R4c-execution-history-index.test.ts'],
    'next-history-range': ['node_modules/vitest/vitest.mjs', 'run', 'tests/runtime/R4c-kernel-history-range.test.ts'],
    'next-graph-history': ['node_modules/vitest/vitest.mjs', 'run', 'tests/runtime/R4c-graph-history.test.ts', 'tests/runtime/R4c-execution-history.test.ts', 'tests/runtime/R4b-session-operations.test.ts'],
    'next-execution-reads': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R4c-execution-read.test.ts'],
    'next-execution-history': ['node_modules/vitest/vitest.mjs', 'run', 'tests/runtime/R4c-execution-history.test.ts'],
    'next-task-claim': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R4c-task-claim.test.ts', 'tests/work-graph/R4c-task-claim-boundaries.test.ts', 'tests/work-graph/R4c-task-claim-concurrency.test.ts', 'tests/composition/R3c-R4b-platform.test.ts', 'tests/work-graph/R3c-canonical-task-state.test.ts', 'tests/work-graph/R4b-session-directory.test.ts', 'tests/work-graph/R3g-role-spec.test.ts'],
    'next-task-relations': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R3c-task-relations.test.ts', 'tests/work-graph/R3c-task-relations-boundaries.test.ts', 'tests/work-graph/R3c-task-inputs.test.ts', 'tests/work-graph/R3c-task-graph.test.ts', 'tests/work-graph/R3c-canonical-task-state.test.ts', 'tests/composition/R3c-R4b-platform.test.ts'],
    'next-session-continuity': ['node_modules/vitest/vitest.mjs', 'run', 'tests/runtime/R4c-session-continuity.test.ts', 'tests/runtime/source-tool-lifecycle.test.ts'],
    'next-roles': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R3g-role-spec.test.ts'],
    'next-observed': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R3d-observed-architecture.test.ts', 'tests/work-graph/R3d-observed-boundaries.test.ts', 'tests/work-graph/R3d-record-integrity.test.ts'],
    'next-store-extensions': ['node_modules/vitest/vitest.mjs', 'run', 'tests/record-store/transaction-extensions.test.ts'],
    'next-plan': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R3c-plan-entry.test.ts', 'tests/work-graph/R3c-plan-adoption.test.ts', 'tests/work-graph/R3c-task-graph.test.ts', 'tests/work-graph/R3c-canonical-task-state.test.ts'],
    'next-session-directory': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R4b-session-directory.test.ts', 'tests/work-graph/R4b-session-boundaries.test.ts'],
    'next-session-runtime': ['node_modules/vitest/vitest.mjs', 'run', 'tests/runtime/R4b-session-operations.test.ts', 'tests/runtime/R4b-session-skeleton.test.ts', 'tests/runtime/R4b-session-recovery.test.ts', 'tests/runtime/R4b-session-input-boundaries.test.ts'],
    'next-sessions': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/R4b-session-directory.test.ts', 'tests/runtime/R4b-session-operations.test.ts', 'tests/runtime/R4b-session-skeleton.test.ts', 'tests/runtime/R4b-session-recovery.test.ts', 'tests/runtime/R4b-session-input-boundaries.test.ts'],
    'next-store': ['node_modules/vitest/vitest.mjs', 'run', 'tests/record-store', 'tests/work-graph/goal-independent.test.ts'],
    'next-material-readers': ['node_modules/vitest/vitest.mjs', 'run', 'tests/work-graph/material-readers.test.ts'],
    'next-types': ['node_modules/typescript/bin/tsc', '--noEmit', '-p', 'tsconfig.json'],
    'next-architecture': ['scripts/check-boundaries.mjs'],
    'next-tests': ['node_modules/vitest/vitest.mjs', 'run'],
}


def main():
    names = sys.argv[1:]
    show = '--show' in names
    names = [name for name in names if name != '--show']
    if not names or any(name not in checks for name in names):
        raise ValueError('Choose registered checks (optional --show): ' + ', '.join(checks))
    selected = [checks[name] for name in dict.fromkeys(names)]
    args = list(selected[0])
    if len(selected) > 1:
        if any(command[:2] != ['node_modules/vitest/vitest.mjs', 'run']
               or any(path.startswith('-') for path in command[2:]) for command in selected):
            raise ValueError('Only unfiltered next test selections can be combined; other checks run separately')
        paths = list(dict.fromkeys(path for command in selected for path in command[2:]))
        if any(len(command) == 2 for command in selected):
            paths = []
        else:
            paths = [path for path in paths if not any(
                parent != path and (WORKSPACE / parent).is_dir() and Path(path).is_relative_to(parent)
                for parent in paths)]
        args = args[:2] + paths
    if 'vitest' in args[0]:
        args += ['--maxWorkers=1', '--no-cache', '--configLoader=native']
    node = resolve_node()
    isolated_build = set(names) == {'next-build'}
    if show:
        description = {'cwd': str(WORKSPACE), 'command': [str(node), *args], 'createsState': False}
        if isolated_build:
            description.update({
                'cwd': '/tmp/next-build-<temporary>/next',
                'preparation': 'physical standalone-root copy; exclude .git, node_modules, .toolchain, docs/refactor/reviews/evidence, root dist and caches; preserve vendor/coding-agent/dist',
                'dependencyLinks': [str(WORKSPACE / 'node_modules'), str(WORKSPACE / 'vendor/coding-agent/node_modules')],
                'cleanup': 'remove the complete temporary directory in finally',
            })
        print(json.dumps(description))
        return 0
    if isolated_build:
        temporary = Path(tempfile.mkdtemp(prefix='next-build-', dir='/tmp'))
        try:
            isolated = temporary / 'next'
            shutil.copytree(WORKSPACE, isolated, ignore=snapshot_ignore, symlinks=True)
            (isolated / 'node_modules').symlink_to(WORKSPACE / 'node_modules', target_is_directory=True)
            (isolated / 'vendor/coding-agent/node_modules').symlink_to(
                WORKSPACE / 'vendor/coding-agent/node_modules', target_is_directory=True)
            return subprocess.run([str(node), *args], cwd=isolated).returncode
        finally:
            shutil.rmtree(temporary)
    return subprocess.run([str(node), *args], cwd=WORKSPACE).returncode


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error))
