# lead-src-fix2.py <copy root>: L5. readContextFacts' `sources` listed every Run, Round and Session of the Goal
# (the G4.4 change to baseSources), so a Work binding "consumed" the Runs of sibling Tasks and the new §3.6 guards
# refused a parallel same-Goal entry (orchestration-mechanism "two ... same-Goal Tasks ... overlapping" got 1 entered,
# not 2). The facts are built from the Goal, the Plan, the architecture baseline and the focus Tasks' executions;
# those are the sources.
import sys

root = sys.argv[1]
rel = 'src/core/work-graph/views/graph-context-reader.ts'
path = f'{root}/{rel}'
text = open(path, encoding='utf-8').read()
pairs = [
    (
        "  function baseSources(universe: Universe): ContextSourceV1[] {\n",
        "  /** The records `readContextFacts` is built from: Goal, Plan, architecture baseline and the\n"
        "   * focus Tasks' selected Runs. Runs/Rounds/Sessions of other Tasks are not this context's\n"
        "   * sources (they would make a Work binding depend on, and its entry guard on, sibling Tasks). */\n"
        "  function baseSources(universe: Universe, executions: readonly TaskExecutionRecord[]): ContextSourceV1[] {\n",
    ),
    (
        "    for (const run of [...universe.runCache.values()]\n"
        "      .filter((candidate): candidate is RunSnapshot => candidate !== null)\n"
        "      .sort((left, right) => compareRefKeys(left, right))) {\n"
        "      sources.push({ kind: 'record', ref: run.ref, revision: run.revision, digest: null });\n"
        "    }\n"
        "    for (const round of [...universe.roundCache.values()]\n"
        "      .sort((left, right) => compareRefKeys(left, right))) {\n"
        "      sources.push({ kind: 'record', ref: round.ref, revision: round.revision, digest: null });\n"
        "    }\n"
        "    for (const card of [...universe.sessionCards].sort((left, right) => compareRefKeys(left.record, right.record))) {\n"
        "      sources.push({ kind: 'record', ref: card.record.ref, revision: card.record.revision, digest: null });\n"
        "    }\n"
        "    return sources;\n"
        "  }\n",
        "    for (const run of executions.map(record => record.run).sort((left, right) => compareRefKeys(left, right))) {\n"
        "      sources.push({ kind: 'record', ref: run.ref, revision: run.revision, digest: null });\n"
        "    }\n"
        "    return sources;\n"
        "  }\n",
    ),
    (
        "        sources: baseSources(universe),\n",
        "        sources: baseSources(universe, executions),\n",
    ),
]
for old, new in pairs:
    n = text.count(old)
    assert n == 1, (n, old[:80])
    text = text.replace(old, new)
open(path, 'w', encoding='utf-8', newline='\n').write(text)
print('edited', rel)
