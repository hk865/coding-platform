# lead-src-fix.py <copy root>: the lead's small source fixes after the slice-3 guided round (exact replacements,
# each asserted to hit exactly once). L1 Host duty/budget survive the Work snapshot; L2 the assembler derives the
# duty of a versioned legacy template Session; L3 admission compares the duty only where Role/template fix it;
# L4 consumed-source guards and the Workspace-revision comparison apply to the first binding only (CTX-01), not to
# the re-authorization of an already bound manifest (CTX-02).
import sys

root = sys.argv[1]


def edit(rel, pairs):
    path = f'{root}/{rel}'
    text = open(path, encoding='utf-8').read()
    for old, new in pairs:
        n = text.count(old)
        assert n == 1, (rel, n, old[:80])
        text = text.replace(old, new)
    open(path, 'w', encoding='utf-8', newline='\n').write(text)
    print('edited', rel)


# L1 --------------------------------------------------------------------------------------------
edit('src/core/agent-runtime/execution-preparation.ts', [(
    "    materialBasis: config.materialBasis === null ? null : structuredClone(config.materialBasis),\n  };\n}\n",
    "    materialBasis: config.materialBasis === null ? null : structuredClone(config.materialBasis),\n"
    "    // Slice 3 (§2.4 item 3): the Host's explicit duty and resident budget reach the assembler.\n"
    "    ...(config.platformDuty === undefined ? {} : { platformDuty: config.platformDuty }),\n"
    "    ...(config.contextResidentBytes === undefined ? {} : { contextResidentBytes: config.contextResidentBytes }),\n"
    "  };\n}\n",
)])

# L2 --------------------------------------------------------------------------------------------
edit('src/core/agent-runtime/context-assembler.ts', [
    (
        "import type { CoreCallContext } from '../../contracts/core/call-context.js';\n",
        "import type { CoreCallContext } from '../../contracts/core/call-context.js';\n"
        "import type { RoleConfigurationRef } from '../../contracts/core/identity.js';\n",
    ),
    (
        "function effectiveDuty(role: RoleSpecResolutionV1, configuration: ResolvedRuntimeConfiguration): { duty: PlatformDutyV1 } | { rejection: CoreRejection } {\n"
        "  const roleDuty = role.status === 'resolved' ? role.spec.platformDuty : undefined;\n"
        "  const hostDuty = configuration?.platformDuty;\n"
        "  if (roleDuty !== undefined && hostDuty !== undefined && roleDuty !== hostDuty) {\n"
        "    return { rejection: rejected('forbidden', 'the explicit Host duty disagrees with the resolved Role duty') };\n"
        "  }\n"
        "  return { duty: roleDuty ?? hostDuty ?? 'executor' };\n"
        "}\n",
        "const PLATFORM_DUTIES: readonly PlatformDutyV1[] = ['executor', 'secretary', 'adviser', 'scribe', 'reviewer'];\n"
        "\n"
        "/** §2.4 item 3 / §2.5: the duty a versioned legacy template Session role ref fixes, or none. */\n"
        "function templateDutyOf(sessionRole: RoleConfigurationRef | undefined): PlatformDutyV1 | undefined {\n"
        "  if (sessionRole === undefined || sessionRole.kind !== 'legacy_template') return undefined;\n"
        "  return PLATFORM_DUTIES.find((duty) => {\n"
        "    const template = platformRoleProfile(duty).template;\n"
        "    return template.templateId === sessionRole.templateId && template.templateRevision === sessionRole.templateRevision;\n"
        "  });\n"
        "}\n"
        "\n"
        "/** The Role's explicit duty, else the Host's, else the duty the Session's versioned legacy template fixes, else executor. */\n"
        "function effectiveDuty(\n"
        "  role: RoleSpecResolutionV1, configuration: ResolvedRuntimeConfiguration, sessionRole: RoleConfigurationRef | undefined,\n"
        "): { duty: PlatformDutyV1 } | { rejection: CoreRejection } {\n"
        "  const roleDuty = role.status === 'resolved' ? role.spec.platformDuty : undefined;\n"
        "  const hostDuty = configuration?.platformDuty;\n"
        "  const templateDuty = templateDutyOf(sessionRole);\n"
        "  if (roleDuty !== undefined && hostDuty !== undefined && roleDuty !== hostDuty) {\n"
        "    return { rejection: rejected('forbidden', 'the explicit Host duty disagrees with the resolved Role duty') };\n"
        "  }\n"
        "  if (templateDuty !== undefined && hostDuty !== undefined && templateDuty !== hostDuty) {\n"
        "    return { rejection: rejected('forbidden', 'the explicit Host duty disagrees with the Session legacy template') };\n"
        "  }\n"
        "  return { duty: roleDuty ?? hostDuty ?? templateDuty ?? 'executor' };\n"
        "}\n",
    ),
    (
        "    const dutyResult = effectiveDuty(input.role, input.configuration);\n",
        "    const dutyResult = effectiveDuty(input.role, input.configuration, session?.role);\n",
    ),
    (
        "    const roleDuty = input.role.status === 'resolved' ? input.role.spec.platformDuty : undefined;\n"
        "    const hostDuty = input.configuration?.platformDuty;\n"
        "    if (roleDuty !== undefined && hostDuty !== undefined && roleDuty !== hostDuty) {\n"
        "      return rejected('forbidden', 'the explicit Host duty disagrees with the resolved Role duty');\n"
        "    }\n"
        "    const duty: PlatformDutyV1 = roleDuty ?? hostDuty ?? 'executor';\n",
        "    const dutyResult = effectiveDuty(input.role, input.configuration, input.facts.record?.session?.role);\n"
        "    if ('rejection' in dutyResult) return dutyResult.rejection;\n"
        "    const duty: PlatformDutyV1 = dutyResult.duty;\n",
    ),
])

# L3 + L4 (Work admission) ----------------------------------------------------------------------
edit('src/core/work-graph/tasks/execution-entry-service.ts', [
    (
        "  scope: WorkspaceScope;\n"
        "  workspaceRevision: number;\n"
        "}): CoreRejection | null {\n"
        "  const binding = input.manifest.contextAssembly;\n"
        "  const duty = effectivePlatformDuty({\n"
        "    roleDuty: roleDutyOf(input.manifest.role),\n"
        "    hostDuty: legacyTemplateDutyOf(input.manifest.sessionRole),\n"
        "  });\n",
        "  scope: WorkspaceScope;\n"
        "  workspaceRevision: number;\n"
        "  /** CTX-02: re-authorizing an already bound manifest validates it, it does not re-pin its sources. */\n"
        "  rebinding: boolean;\n"
        "}): CoreRejection | null {\n"
        "  const binding = input.manifest.contextAssembly;\n"
        "  const roleDuty = roleDutyOf(input.manifest.role);\n"
        "  const templateDuty = legacyTemplateDutyOf(input.manifest.sessionRole);\n"
        "  const duty = effectivePlatformDuty({ roleDuty, hostDuty: templateDuty });\n",
    ),
    (
        "  if (binding.duty !== duty.value) {\n"
        "    return forbidden('the assembled context duty disagrees with the saved Work binding');\n"
        "  }\n",
        "  // Only a duty the Role or the Session's versioned template fixes is compared; otherwise the\n"
        "  // Host decided it, and the Host configuration revision of the manifest pins that choice.\n"
        "  if ((roleDuty !== undefined || templateDuty !== undefined) && binding.duty !== duty.value) {\n"
        "    return forbidden('the assembled context duty disagrees with the saved Work binding');\n"
        "  }\n",
    ),
    (
        "  for (const source of binding.sources) {\n"
        "    if (source.kind === 'record' && source.ref.aggregateType === 'Workspace'\n",
        "  for (const source of input.rebinding ? [] : binding.sources) {\n"
        "    if (source.kind === 'record' && source.ref.aggregateType === 'Workspace'\n",
    ),
    (
        "  const consumption = contextConsumptionProblem({\n"
        "    manifest, plan: facts.plan, claim, scope, workspaceRevision,\n"
        "  });\n"
        "  if (consumption !== null) return { ok: false, rejection: consumption };\n"
        "  return { ok: true, value: { ...admitted.value, consumptionGuards: contextConsumptionGuards(manifest.contextAssembly, claim.runRef) } };\n",
        "  // CTX-01 pins the sources the binding consumed; CTX-02 (an already bound manifest whose\n"
        "  // authorization was revoked) only validates it and never refuses for sources that moved on.\n"
        "  const rebinding = facts.run.executionAuthorization?.phase === 'revoked';\n"
        "  const consumption = contextConsumptionProblem({\n"
        "    manifest, plan: facts.plan, claim, scope, workspaceRevision, rebinding,\n"
        "  });\n"
        "  if (consumption !== null) return { ok: false, rejection: consumption };\n"
        "  return { ok: true, value: { ...admitted.value,\n"
        "    consumptionGuards: rebinding ? [] : contextConsumptionGuards(manifest.contextAssembly, claim.runRef) } };\n",
    ),
])

# L3 (Query admission) --------------------------------------------------------------------------
edit('src/core/work-graph/queries/query-execution.ts', [
    (
        "/** §4.3/G-CTX: the Query binding's duty from the Query's own resolved Role. */\n"
        "function expectedQueryDuty(manifest: PreparedQueryManifestV1): PlatformDutyV1 {\n"
        "  const roleDuty = manifest.role.status === 'resolved' ? manifest.role.spec.platformDuty : undefined;\n"
        "  return roleDuty ?? legacyTemplateDutyOf(manifest.sessionRole) ?? 'executor';\n"
        "}\n",
        "/**\n"
        " * §4.3/G-CTX: the duty the Query's resolved Role or its Session's versioned legacy template\n"
        " * fixes, or undefined when neither does (then the Host chose it and the manifest's Host\n"
        " * configuration revision pins that choice).\n"
        " */\n"
        "function expectedQueryDuty(manifest: PreparedQueryManifestV1): PlatformDutyV1 | undefined {\n"
        "  const roleDuty = manifest.role.status === 'resolved' ? manifest.role.spec.platformDuty : undefined;\n"
        "  return roleDuty ?? legacyTemplateDutyOf(manifest.sessionRole);\n"
        "}\n",
    ),
    (
        "      if (manifest.contextAssembly.duty !== expectedQueryDuty(manifest)) {\n",
        "      const fixedDuty = expectedQueryDuty(manifest);\n"
        "      if (fixedDuty !== undefined && manifest.contextAssembly.duty !== fixedDuty) {\n",
    ),
])
