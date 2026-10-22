/**
 * PC-1b ruling 22: argument plumbing for direct `runObservedModel` callers.
 *
 * Mirrors the frozen fixture's `frozenPromptInputs` (tests/helpers/PC-platform-fixture.ts
 * ~609) with one correction: the frozen helper opens its Work fixture with
 * `tools: []`, and WP2's Role install rejects an empty tool list, so the frozen
 * helper throws before it can prepare. Production preparation resolves, renders,
 * merges and selects the Skill; `readPromptTexts` reconstructs the frozen inputs.
 * No expected system text is computed here.
 */
import { resolve } from 'node:path';
import type { PromptPackSourcePort } from '../../src/contracts/prompts/prompt-pack.js';
import type { ResolvedRuntimeConfiguration } from '../../src/core/agent-runtime/execution-contracts.js';
import type { ObservedModelRunOptions } from '../../src/core/agent-runtime/observed-model-run.js';
import { openPCWorkFixture, scriptedModel } from '../helpers/PC-platform-fixture.js';

type SkillSelection = ResolvedRuntimeConfiguration['skills'];

export async function frozenPromptInputs(options: {
  skills?: SkillSelection;
  systemInstruction?: string;
  promptPacks?: PromptPackSourcePort;
  promptPack?: string;
  reasoningReplay?: 'current_run' | 'none';
} = {}): Promise<ObservedModelRunOptions['prompt']> {
  const fixture = await openPCWorkFixture({
    model: scriptedModel([]), tools: ['read'],
    skills: options.skills ?? {
      resourceRoot: resolve(import.meta.dirname, '../../vendor/coding-agent/resources/skills'),
      enabledIds: ['coding-safety'],
    },
    systemInstruction: options.systemInstruction ?? null,
    selection: {
      promptPack: options.promptPack ?? 'platform',
      reasoningReplay: options.reasoningReplay ?? 'current_run',
    },
    ...(options.promptPacks === undefined ? {} : { promptPacks: options.promptPacks }),
  });
  try {
    await fixture.work.prepare();
    return (await fixture.work.preparedTexts()).prompt;
  } finally {
    await fixture.close();
  }
}
