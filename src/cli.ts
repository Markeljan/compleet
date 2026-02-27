#!/usr/bin/env bun
import { basename } from "node:path";
import { parseArgs, ArgParseError, helpText, type SetupModeArgs } from "./args";
import { runCodexCliAuthAction } from "./codex-auth";
import { askLine, canPromptInteractively, confirm, selectWithArrows, type SelectOption } from "./interactive";
import { generatePromptResponse, generateSuggestion } from "./openai";
import { installShellIntegration, isShellIntegrationInstalled } from "./shell-install";
import type { AuthMethod, RuntimeContext, Suggestion } from "./types";
import { loadUserConfig, saveUserConfig } from "./user-config";
import { APP_BUILD_TIME, VERSION } from "./version";

function shellNameFromEnv(): string {
  const shell = process.env.SHELL;
  if (!shell) {
    return "unknown";
  }
  return basename(shell);
}

function buildRuntimeContext(): RuntimeContext {
  return {
    cwd: process.cwd(),
    shell: shellNameFromEnv(),
    platform: process.platform,
    homeDir: process.env.HOME ?? process.env.USERPROFILE ?? "",
  };
}

function printSuggestionHuman(suggestion: Suggestion, explain: boolean) {
  if (!suggestion.command) {
    const reason = suggestion.explanation || "No command could be generated.";
    console.error(reason);
    process.exit(2);
  }

  if (explain) {
    if (suggestion.explanation) {
      console.error(`explanation: ${suggestion.explanation}`);
    }
    if (suggestion.risk !== "low" || suggestion.needsConfirmation) {
      console.error(
        `risk: ${suggestion.risk}${suggestion.needsConfirmation ? " (confirm before running)" : ""}`,
      );
    }
  }

  process.stdout.write(`${suggestion.command}\n`);
}

function printSuccess(message: string) {
  if (process.stdout.isTTY) {
    console.log(`\x1b[32m${message}\x1b[0m`);
    return;
  }
  console.log(message);
}

function setupRequirementErrors(): string[] {
  const errors: string[] = [];

  if (!process.versions.bun) {
    errors.push("Bun runtime is required. Install Bun: https://bun.sh/docs/installation");
  }

  const shell = shellNameFromEnv();
  if (shell !== "zsh") {
    errors.push(`zsh is required for tcomp setup and shell integration. Detected SHELL=\"${shell}\".`);
  }

  return errors;
}

function defaultAuthMethod(config: Awaited<ReturnType<typeof loadUserConfig>>): AuthMethod {
  if (config.authMethod === "openai-api-key" || config.authMethod === "codex-oauth") {
    return config.authMethod;
  }
  return "codex-oauth";
}

async function chooseAuthMethod(current: AuthMethod): Promise<AuthMethod> {
  const options: Array<SelectOption<AuthMethod>> = [
    { label: "Codex OAuth", value: "codex-oauth" },
    { label: "OpenAI API key", value: "openai-api-key" },
  ];

  const defaultIndex = current === "openai-api-key" ? 1 : 0;
  return await selectWithArrows("Setup authentication:", options, defaultIndex);
}

async function runSetupFlow(options: {
  showWelcome: boolean;
  legacyAlias?: SetupModeArgs["legacyAlias"];
}): Promise<number> {
  if (!canPromptInteractively()) {
    console.error("Setup requires an interactive terminal. Run `tcomp setup` in a TTY.");
    return 1;
  }

  if (options.legacyAlias) {
    console.error(`"${options.legacyAlias}" has been replaced by "tcomp setup".`);
  }

  const requirementErrors = setupRequirementErrors();
  if (requirementErrors.length > 0) {
    for (const message of requirementErrors) {
      console.error(message);
    }
    return 1;
  }

  if (options.showWelcome) {
    console.log("Welcome to tcomp.");
    console.log("First-time setup configures auth and optional zsh shell integration.");
  }

  const shellInstalled = await isShellIntegrationInstalled("zsh");
  if (!shellInstalled) {
    const shouldInstallShell = await confirm(
      "Install zsh shell integration + completions now? (recommended)",
      true,
    );

    if (shouldInstallShell) {
      const installResult = await installShellIntegration("zsh");
      if (installResult.updated) {
        printSuccess(`Installed tcomp shell integration in ${installResult.path}`);
      } else {
        printSuccess(`tcomp shell integration already installed in ${installResult.path}`);
      }
      console.log(`Run: source ${installResult.path}`);
    } else {
      console.log("Skipped shell integration install.");
    }
  }

  const config = await loadUserConfig();
  const method = await chooseAuthMethod(defaultAuthMethod(config));

  if (method === "codex-oauth") {
    const code = await runCodexCliAuthAction("login");
    if (code !== 0) {
      return code;
    }

    const path = await saveUserConfig({ authMethod: "codex-oauth" });
    printSuccess(`Saved setup to ${path}`);
    printSuccess("Setup complete.");
    return 0;
  }

  const apiKey = (await askLine("Enter OpenAI API key (input visible): ")).trim();
  if (!apiKey) {
    console.error("No API key provided.");
    return 1;
  }

  const path = await saveUserConfig({
    authMethod: "openai-api-key",
    openaiApiKey: apiKey,
  });
  printSuccess(`Saved setup to ${path}`);
  printSuccess("Setup complete.");
  return 0;
}

async function hasCompletedSetup(): Promise<boolean> {
  const config = await loadUserConfig();
  if (config.authMethod === "codex-oauth") {
    return true;
  }

  if (config.authMethod === "openai-api-key" && Boolean(config.openaiApiKey?.trim())) {
    return true;
  }

  return false;
}

async function ensureSetupBeforeSuggestion(): Promise<void> {
  if (await hasCompletedSetup()) {
    return;
  }

  const code = await runSetupFlow({ showWelcome: true });
  if (code !== 0) {
    process.exit(code);
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof ArgParseError) {
      console.error(error.message);
      console.error("");
      console.error(helpText());
      process.exit(1);
    }
    throw error;
  }

  if (args.mode === "help") {
    console.log(helpText());
    return;
  }

  if (args.mode === "version") {
    console.log(VERSION);
    if (APP_BUILD_TIME) {
      console.error(`built: ${APP_BUILD_TIME}`);
    }
    return;
  }

  if (args.mode === "setup") {
    const code = await runSetupFlow({
      showWelcome: true,
      legacyAlias: args.legacyAlias,
    });
    process.exit(code);
  }

  await ensureSetupBeforeSuggestion();

  const context = buildRuntimeContext();
  if (args.promptMode) {
    const response = await generatePromptResponse(args.prompt, context);
    console.log(response);
    return;
  }

  const suggestion = await generateSuggestion(args.prompt, context);
  printSuggestionHuman(suggestion, args.explain);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
