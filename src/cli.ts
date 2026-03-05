#!/usr/bin/env bun
import { basename } from "node:path";
import {
  parseArgs,
  ArgParseError,
  helpText,
  type ConfigModeArgs,
  type SetupModeArgs,
  type UseModeArgs,
} from "./args";
import { loadCodexChatGPTAuth, runCodexCliAuthAction } from "./codex-auth";
import { askLine, canPromptInteractively, confirm, selectWithArrows, type SelectOption } from "./interactive";
import { generatePromptResponse, generateSuggestion } from "./openai";
import { isSupportedShell, type SupportedShell } from "./shell";
import { installShellIntegration, isShellIntegrationInstalled } from "./shell-install";
import type { ProviderName, RuntimeContext, Suggestion } from "./types";
import { loadUserConfig, saveUserConfig } from "./user-config";
import { APP_BUILD_TIME, VERSION } from "./version";

const COLOR_ENABLED =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== "dumb" &&
  Boolean(process.stdout.isTTY || process.stderr.isTTY);

function color(text: string, ansiCode: string): string {
  if (!COLOR_ENABLED) {
    return text;
  }
  return `\x1b[${ansiCode}m${text}\x1b[0m`;
}

function heading(text: string): string {
  return color(text, "1;36");
}

function commandText(text: string): string {
  return color(text, "1;37");
}

function label(text: string): string {
  return color(text, "1;34");
}

function statusOk(text: string): string {
  return color(text, "32");
}

function statusWarn(text: string): string {
  return color(text, "33");
}

function statusError(text: string): string {
  return color(text, "31");
}

function printInfo(message: string) {
  console.log(`${label("[info]")} ${message}`);
}

function printSuccess(message: string) {
  console.log(`${statusOk("[ok]")} ${message}`);
}

function printWarning(message: string) {
  console.error(`${statusWarn("[warn]")} ${message}`);
}

function printFailure(message: string) {
  console.error(`${statusError("[error]")} ${message}`);
}

function shellNameFromEnv(): string {
  const shell = process.env.SHELL;
  if (!shell) {
    return "unknown";
  }
  return basename(shell);
}

function setupShellFromEnv(): SupportedShell | null {
  const shell = shellNameFromEnv();
  if (isSupportedShell(shell)) {
    return shell;
  }
  return null;
}

function buildRuntimeContext(): RuntimeContext {
  return {
    cwd: process.cwd(),
    shell: shellNameFromEnv(),
    platform: process.platform,
    homeDir: process.env.HOME ?? process.env.USERPROFILE ?? "",
  };
}

function providerLabel(provider: ProviderName): string {
  return provider === "codex" ? "codex" : "openai";
}

function colorizeHelp(text: string): string {
  if (!COLOR_ENABLED) {
    return text;
  }

  return text
    .split("\n")
    .map((line) => {
      if (/^(Usage:|Practical examples:|Common flags \(prompt mode\):)$/.test(line)) {
        return heading(line);
      }
      if (line.startsWith("  tcomp ")) {
        return commandText(line);
      }
      if (line.trimStart().startsWith("--")) {
        return color(line, "36");
      }
      return line;
    })
    .join("\n");
}

function printSuggestionHuman(suggestion: Suggestion, explain: boolean) {
  if (!suggestion.command) {
    const reason = suggestion.explanation || "No command could be generated.";
    printFailure(reason);
    printInfo(
      `For general prompts, use ${commandText("tcomp --prompt <question>")} (or ${commandText(
        "tcomp -p <question>",
      )}).`,
    );
    process.exit(2);
  }

  if (explain) {
    if (suggestion.explanation) {
      console.error(`${label("explanation:")} ${suggestion.explanation}`);
    }
    if (suggestion.risk !== "low" || suggestion.needsConfirmation) {
      console.error(
        `${label("risk:")} ${suggestion.risk}${suggestion.needsConfirmation ? " (confirm before running)" : ""}`,
      );
    }
  }

  process.stdout.write(`${suggestion.command}\n`);
}

function setupRequirementErrors(): string[] {
  const errors: string[] = [];

  if (!process.versions.bun) {
    errors.push("Bun runtime is required. Install Bun: https://bun.sh/docs/installation");
  }

  const shell = shellNameFromEnv();
  if (!isSupportedShell(shell)) {
    errors.push(`zsh or bash is required for setup. Detected SHELL=\"${shell}\".`);
  }

  return errors;
}

function defaultProvider(config: Awaited<ReturnType<typeof loadUserConfig>>): ProviderName {
  if (config.activeProvider === "openai" || config.activeProvider === "codex") {
    return config.activeProvider;
  }
  return "codex";
}

async function chooseProvider(current: ProviderName): Promise<ProviderName> {
  const options: Array<SelectOption<ProviderName>> = [
    { label: "OpenAI OAuth (via Codex CLI)", value: "codex" },
    { label: "OpenAI API key", value: "openai" },
  ];

  const defaultIndex = current === "openai" ? 1 : 0;
  return await selectWithArrows("Select provider:", options, defaultIndex);
}

type OAuthLoginMethod = "browser" | "device";

async function chooseOAuthLoginMethod(): Promise<OAuthLoginMethod> {
  const options: Array<SelectOption<OAuthLoginMethod>> = [
    { label: "Browser login", value: "browser" },
    { label: "Device login (code entry)", value: "device" },
  ];
  return await selectWithArrows("Select OpenAI OAuth login method:", options, 0);
}

function printSourceInstructions(path: string) {
  printInfo(
    `Automatic ${commandText("source")} is not possible from a child CLI process. Run ${commandText(
      `source ${path}`,
    )} in your current shell.`,
  );
}

async function runProviderSetup(provider: ProviderName): Promise<number> {
  const config = await loadUserConfig();

  if (provider === "codex") {
    const loginMethod = await chooseOAuthLoginMethod();
    const deviceAuth = loginMethod === "device";

    if (deviceAuth) {
      printInfo("Starting OpenAI OAuth device login flow...");
    } else {
      printInfo("Starting OpenAI OAuth browser login flow...");
    }

    const code = await runCodexCliAuthAction("login", { deviceAuth });
    if (code !== 0) {
      return code;
    }

    const path = await saveUserConfig({
      ...config,
      activeProvider: "codex",
    });
    printSuccess(`Saved active provider \"codex\" to ${path}`);
    return 0;
  }

  const existingApiKey = config.openaiApiKey?.trim() ?? "";
  const prompt = existingApiKey
    ? "Enter OpenAI API key (press Enter to keep existing): "
    : "Enter OpenAI API key (input visible): ";
  const entered = (await askLine(prompt)).trim();
  const apiKey = entered || existingApiKey;

  if (!apiKey) {
    printFailure("No API key provided.");
    return 1;
  }

  const path = await saveUserConfig({
    ...config,
    activeProvider: "openai",
    openaiApiKey: apiKey,
  });
  printSuccess(`Saved active provider \"openai\" to ${path}`);
  return 0;
}

async function runSetupFlow(options: {
  showWelcome: boolean;
  provider?: ProviderName;
  legacyAlias?: SetupModeArgs["legacyAlias"];
  offerShellInstall?: boolean;
}): Promise<number> {
  if (!canPromptInteractively()) {
    printFailure(`Setup requires an interactive terminal. Run ${commandText("tcomp setup")} in a TTY.`);
    return 1;
  }

  if (options.legacyAlias) {
    printWarning(`\"${options.legacyAlias}\" has been replaced by ${commandText("tcomp setup")}.`);
  }

  const requirementErrors = setupRequirementErrors();
  if (requirementErrors.length > 0) {
    for (const message of requirementErrors) {
      printFailure(message);
    }
    return 1;
  }

  const setupShell = setupShellFromEnv();
  if (!setupShell) {
    printFailure("Could not detect a supported shell from SHELL. Expected zsh or bash.");
    return 1;
  }

  if (options.showWelcome) {
    console.log(heading("tcomp setup"));
    printInfo(`Welcome. Setup configures provider auth and optional ${setupShell} integration.`);
  }

  if (options.offerShellInstall !== false) {
    const shellInstalled = await isShellIntegrationInstalled(setupShell);
    if (!shellInstalled) {
      const shouldInstallShell = await confirm(`Install ${setupShell} shell integration + completions now?`, true);

      if (shouldInstallShell) {
        const installResult = await installShellIntegration(setupShell);
        if (installResult.updated) {
          printSuccess(`Installed tcomp shell integration in ${installResult.path}`);
        } else {
          printSuccess(`tcomp shell integration already installed in ${installResult.path}`);
        }
        printSourceInstructions(installResult.path);
      } else {
        printWarning("Skipped shell integration install.");
      }
    }
  }

  const config = await loadUserConfig();
  const provider = options.provider ?? (await chooseProvider(defaultProvider(config)));
  const code = await runProviderSetup(provider);
  if (code === 0) {
    printSuccess(`Setup complete. Active provider: ${providerLabel(provider)}`);
  }
  return code;
}

async function hasCompletedSetup(): Promise<boolean> {
  const config = await loadUserConfig();
  if (config.activeProvider === "codex") {
    return true;
  }

  if (config.activeProvider === "openai" && Boolean(config.openaiApiKey?.trim())) {
    return true;
  }

  return false;
}

async function ensureSetupBeforeSuggestion(): Promise<void> {
  if (await hasCompletedSetup()) {
    return;
  }

  const code = await runSetupFlow({ showWelcome: true, offerShellInstall: true });
  if (code !== 0) {
    process.exit(code);
  }
}

async function isCodexConfigured(): Promise<boolean> {
  try {
    await loadCodexChatGPTAuth();
    return true;
  } catch {
    return false;
  }
}

async function handleConfigCommand(args: ConfigModeArgs): Promise<number> {
  if (args.provider) {
    return await runSetupFlow({
      showWelcome: false,
      provider: args.provider,
      offerShellInstall: false,
    });
  }

  const config = await loadUserConfig();
  const activeProvider = config.activeProvider ?? "not configured";
  const openaiConfigured = Boolean(config.openaiApiKey?.trim());
  const codexConfigured = await isCodexConfigured();

  console.log(heading("tcomp config"));
  console.log(`${label("Active provider:")} ${commandText(activeProvider)}`);
  console.log(
    `${label("OpenAI OAuth:")} ${codexConfigured ? statusOk("configured") : statusWarn("not configured")}`,
  );
  console.log(
    `${label("OpenAI API key:")} ${openaiConfigured ? statusOk("configured") : statusWarn("not configured")}`,
  );
  console.log("");
  printInfo(`Run ${commandText("tcomp config codex")} to run OpenAI OAuth setup (browser or device login).`);
  printInfo(`Run ${commandText("tcomp config openai")} to set/update your OpenAI API key.`);
  printInfo(`Run ${commandText("tcomp use codex")} or ${commandText("tcomp use openai")} to switch providers.`);
  printInfo(`Run ${commandText("tcomp setup")} to run full onboarding again.`);
  return 0;
}

async function handleUseCommand(args: UseModeArgs): Promise<number> {
  const config = await loadUserConfig();
  const path = await saveUserConfig({
    ...config,
    activeProvider: args.provider,
  });

  printSuccess(`Active provider set to ${providerLabel(args.provider)} in ${path}`);

  if (args.provider === "openai" && !config.openaiApiKey?.trim()) {
    printWarning(
      `OpenAI API key is not configured. Run ${commandText("tcomp config openai")} or ${commandText(
        "tcomp setup",
      )}.`,
    );
  }

  if (args.provider === "codex") {
    const codexReady = await isCodexConfigured();
    if (!codexReady) {
      printWarning(`Codex auth not configured yet. Run ${commandText("tcomp config codex")} if needed.`);
    }
  }

  return 0;
}

async function main() {
  const rawArgv = process.argv.slice(2);
  if (rawArgv.length === 0) {
    if (!(await hasCompletedSetup())) {
      const code = await runSetupFlow({ showWelcome: true, offerShellInstall: true });
      process.exit(code);
    }

    console.log(colorizeHelp(helpText()));
    return;
  }

  let args;
  try {
    args = parseArgs(rawArgv);
  } catch (error) {
    if (error instanceof ArgParseError) {
      printFailure(error.message);
      console.error("");
      console.error(colorizeHelp(helpText()));
      process.exit(1);
    }
    throw error;
  }

  if (args.mode === "help") {
    console.log(colorizeHelp(helpText()));
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
      provider: args.provider,
      legacyAlias: args.legacyAlias,
      offerShellInstall: true,
    });
    process.exit(code);
  }

  if (args.mode === "config") {
    const code = await handleConfigCommand(args);
    process.exit(code);
  }

  if (args.mode === "use") {
    const code = await handleUseCommand(args);
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
  printFailure(message);
  process.exit(1);
});
