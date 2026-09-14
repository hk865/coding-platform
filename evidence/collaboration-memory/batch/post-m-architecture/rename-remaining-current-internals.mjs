import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const replacements = new Map([
  ["formalbuild", "canonicalBuild"],
  ["formalplan", "canonicalPlan"],
  ["formaluser", "canonicalUser"],
  ["formalgoal", "canonicalGoal"],
  ["readP108JsonRow", "readJsonProjectionRow"],
  ["writeP108JsonRow", "writeJsonProjectionRow"],
  ["scanP116Bindings", "scanWorkContextBindings"],
  ["readP116Notes", "readWorkContextNotes"],
  ["readP116Continuations", "readWorkContextContinuations"],
  ["readP108Matrix", "readConsolePlanMatrix"],
  ["writeP108Matrix", "writeConsolePlanMatrix"],
  ["scanP108Agent", "scanConsoleAgentRows"],
  ["readP108AgentRow", "readConsoleAgentRow"],
  ["writeP108AgentRow", "writeConsoleAgentRow"],
  ["readP108Evidence", "readConsoleEvidence"],
  ["writeP108Evidence", "writeConsoleEvidence"],
  ["readP108Timeline", "readConsoleTimeline"],
  ["writeP108Timeline", "writeConsoleTimeline"],
  ["validateP112CommandShape", "validateArchitectureCommandShape"],
  ["buildP113InstallCommit", "buildArchitectureEvolutionPolicyInstallCommit"],
  ["buildP113ActivateCommit", "buildArchitectureEvolutionPolicyActivateCommit"],
  ["buildP110IntentSnapshot", "buildControlIntentSnapshot"],
  ["buildP111PlanRevisionSnapshot", "buildGoalChangePlanRevisionSnapshot"],
  ["buildP113PlanPatchRecordCommit", "buildRemediationPlanPatchRecordCommit"],
  ["buildP113TaskRecordCommit", "buildRemediationTaskRecordCommit"],
  ["buildP113TaskAdvanceCommit", "buildRemediationTaskAdvanceCommit"],
  ["buildP114CandidateFold", "buildCandidateBaselineMaterializeCommit"],
  ["buildP114DecisionFold", "buildArchitectureChangeDecisionRecordCommit"],
  ["buildP114GateFold", "buildMigrationGateRecordCommit"],
  ["buildP114ActivationFold", "buildBaselineActivationRecordCommit"],
  ["buildP115ProposalFold", "buildInitialDesignProposalRecordCommit"],
  ["buildP115DecisionFold", "buildInitialDesignDecisionRecordCommit"],
  ["buildP115PolicyInstallFold", "buildCoordinationPolicyInstallRecordCommit"],
  ["buildP115PolicyActivateFold", "buildCoordinationPolicyActivateRecordCommit"],
  ["BuildP107ReadAcquireCommitDeps", "BuildWorkspaceReadLeaseAcquireCommitDeps"],
  ["BuildP107ReadReleaseCommitDeps", "BuildWorkspaceReadLeaseReleaseCommitDeps"],
  ["BuildP107WriteAcquireCommitDeps", "BuildWorkspaceWriteLeaseAcquireCommitDeps"],
  ["BuildP107WriteReleaseCommitDeps", "BuildWorkspaceWriteLeaseReleaseCommitDeps"],
  ["BuildP107IntegrationCommitDeps", "BuildWorkspaceIntegrationCommitDeps"],
  ["BuildP107PatchCommitDeps", "BuildWorkspacePatchCommitDeps"],
]);

const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "--", "src", "tests"], {
  encoding: "utf8",
}).split(/\r?\n/).filter((file) => /\.(?:ts|tsx|mjs)$/.test(file));

const changed = [];
for (const file of files) {
  if (!existsSync(file)) continue;
  const before = readFileSync(file, "utf8");
  let after = before;
  for (const [from, to] of replacements) after = after.replaceAll(from, to);
  if (after !== before) {
    writeFileSync(file, after);
    changed.push(file);
  }
}

process.stdout.write(JSON.stringify({ replacements: Object.fromEntries(replacements), changed }, null, 2) + "\n");
