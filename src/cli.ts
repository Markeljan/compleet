#!/usr/bin/env bun
import { rm } from "node:fs/promises";
import { basename } from "node:path";
import { ensureVoiceModeReady, isVoiceModeReady } from "../voice/setup";
import { runVoiceMode } from "../voice/voiceMode";
import {
  ArgParseError,
  type ConfigModeArgs,
  helpText,
  type ParsedArgs,
  parseArgs,
  type UseModeArgs,
} from "./args";
import { loadCodexChatGPTAuth, runCodexCliAuthAction } from "./codex-auth";
import type { SelectOption } from "./interactive";
import {
  askLine,
  canPromptInteractively,
  confirm,
  selectWithArrows,
} from "./interactive";
import { generatePromptResponse, generateSuggestion } from "./openai";
import { buildProviderSelectionOptions } from "./setup-flow";
import { isSupportedShell, type SupportedShell } from "./shell";
import {
  installShellIntegration,
  isShellIntegrationInstalled,
  removeShellIntegration,
} from "./shell-install";
import type { ProviderName, RuntimeContext, Suggestion } from "./types";
import {
  getUserConfigDir,
  getUserConfigPath,
  loadUserConfig,
  saveUserConfig,
} from "./user-config";
import { APP_BUILD_TIME, VERSION } from "./version";

const COLOR_ENABLED =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== "dumb" &&
  Boolean(process.stdout.isTTY || process.stderr.isTTY);
const HELP_HEADER_REGEX =
  /^(Usage:|Practical examples:|Common flags \(prompt mode\):)$/;

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
      if (HELP_HEADER_REGEX.test(line)) {
        return heading(line);
      }
      if (line.startsWith("  tc ")) {
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
      `For general prompts, use ${commandText("tc --prompt <question>")} (or ${commandText(
        "tc -p <question>"
      )}).`
    );
    process.exit(2);
  }

  if (explain) {
    if (suggestion.explanation) {
      console.error(`${label("explanation:")} ${suggestion.explanation}`);
    }
    if (suggestion.risk !== "low" || suggestion.needsConfirmation) {
      console.error(
        `${label("risk:")} ${suggestion.risk}${suggestion.needsConfirmation ? " (confirm before running)" : ""}`
      );
    }
  }

  process.stdout.write(`${suggestion.command}\n`);
}

function setupRequirementErrors(): string[] {
  const errors: string[] = [];

  if (!process.versions.bun) {
    errors.push(
      "Bun runtime is required. Install Bun: https://bun.sh/docs/installation"
    );
  }

  const shell = shellNameFromEnv();
  if (!isSupportedShell(shell)) {
    errors.push(
      `zsh or bash is required for setup. Detected SHELL="${shell}".`
    );
  }

  return errors;
}

function defaultProvider(
  config: Awaited<ReturnType<typeof loadUserConfig>>
): ProviderName {
  if (config.activeProvider === "openai" || config.activeProvider === "codex") {
    return config.activeProvider;
  }
  return "codex";
}

type OAuthLoginMethod = "browser" | "device";

async function chooseOAuthLoginMethod(): Promise<OAuthLoginMethod> {
  const options: SelectOption<OAuthLoginMethod>[] = [
    { label: "Browser login", value: "browser" },
    { label: "Device login (code entry)", value: "device" },
  ];
  return await selectWithArrows(
    "Select OpenAI OAuth login method:",
    options,
    0
  );
}

function printSourceInstructions(path: string) {
  printInfo(
    `Automatic ${commandText("source")} is not possible from a child CLI process. Run ${commandText(
      `source ${path}`
    )} in your current shell.`
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
    printSuccess(`Saved active provider "codex" to ${path}`);
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
  printSuccess(`Saved active provider "openai" to ${path}`);
  return 0;
}

async function maybeOfferShellInstall(
  setupShell: SupportedShell,
  offerShellInstall: boolean
): Promise<void> {
  if (!offerShellInstall) {
    return;
  }

  const shellInstalled = await isShellIntegrationInstalled(setupShell);
  const shouldInstallShell = await confirm(
    `${
      shellInstalled ? "Refresh" : "Install"
    } ${setupShell} shell integration now?`,
    true
  );

  if (!shouldInstallShell) {
    printWarning(
      `Skipped shell integration ${shellInstalled ? "refresh" : "install"}.`
    );
    return;
  }

  const installResult = await installShellIntegration(setupShell);
  const installMessage = installResult.updated
    ? `Installed tc shell integration in ${installResult.path}`
    : `tc shell integration already installed in ${installResult.path}`;
  printSuccess(installMessage);
  printSourceInstructions(installResult.path);
}

async function maybeOfferVoiceSetup(): Promise<void> {
  if (!canPromptInteractively()) {
    return;
  }

  if (await isVoiceModeReady()) {
    printSuccess("Voice mode is already ready.");
    return;
  }

  const shouldSetupVoice = await confirm(
    "Set up voice mode now? This checks ffmpeg and transcription backends.",
    true
  );
  if (!shouldSetupVoice) {
    printWarning(
      "Skipped voice setup for now. Run tc voice later to finish it."
    );
    return;
  }

  await ensureVoiceModeReady((message) => {
    console.log(message);
  });
  printSuccess("Voice mode is ready.");
}

async function runProviderSetupStep(
  config: Awaited<ReturnType<typeof loadUserConfig>>,
  explicitProvider?: ProviderName
): Promise<{ activeProvider: ProviderName; code: number }> {
  const configuredProvider = await resolveConfiguredProvider(config);

  if (explicitProvider) {
    return {
      activeProvider: explicitProvider,
      code: await runProviderSetup(explicitProvider),
    };
  }

  const { defaultIndex, options: providerOptions } =
    buildProviderSelectionOptions(defaultProvider(config), configuredProvider);
  const selection = await selectWithArrows(
    "Select provider:",
    providerOptions,
    defaultIndex
  );

  if (selection === "skip") {
    const activeProvider = configuredProvider ?? defaultProvider(config);
    if (configuredProvider && config.activeProvider !== configuredProvider) {
      const path = await saveUserConfig({
        ...config,
        activeProvider: configuredProvider,
      });
      printSuccess(
        `Keeping existing provider "${configuredProvider}" in ${path}`
      );
    } else if (configuredProvider) {
      printSuccess(`Keeping existing provider "${configuredProvider}"`);
    }

    return {
      activeProvider,
      code: 0,
    };
  }

  return {
    activeProvider: selection,
    code: await runProviderSetup(selection),
  };
}

async function runSetupFlow(options: {
  showWelcome: boolean;
  provider?: ProviderName;
  offerShellInstall?: boolean;
}): Promise<number> {
  if (!canPromptInteractively()) {
    printFailure(
      `Setup requires an interactive terminal. Run ${commandText("tc setup")} in a TTY.`
    );
    return 1;
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
    printFailure(
      "Could not detect a supported shell from SHELL. Expected zsh or bash."
    );
    return 1;
  }

  if (options.showWelcome) {
    console.log(heading("tc setup"));
    printInfo(
      `Welcome. Setup configures provider auth and optional ${setupShell} integration.`
    );
  }

  await maybeOfferShellInstall(setupShell, options.offerShellInstall !== false);

  const config = await loadUserConfig();
  const { activeProvider, code } = await runProviderSetupStep(
    config,
    options.provider
  );

  if (code === 0) {
    await maybeOfferVoiceSetup();
    printSuccess(
      `Setup complete. Active provider: ${providerLabel(activeProvider)}`
    );
  }
  return code;
}

async function resolveConfiguredProvider(
  config: Awaited<ReturnType<typeof loadUserConfig>>
): Promise<ProviderName | null> {
  const openaiConfigured = Boolean(config.openaiApiKey?.trim());
  const codexConfigured = await isCodexConfigured();

  if (config.activeProvider === "codex" && codexConfigured) {
    return "codex";
  }

  if (config.activeProvider === "openai" && openaiConfigured) {
    return "openai";
  }

  if (codexConfigured) {
    return "codex";
  }

  if (openaiConfigured) {
    return "openai";
  }

  return null;
}

async function hasCompletedSetup(): Promise<boolean> {
  const config = await loadUserConfig();
  if (config.activeProvider === "codex") {
    return true;
  }

  if (
    config.activeProvider === "openai" &&
    Boolean(config.openaiApiKey?.trim())
  ) {
    return true;
  }

  return false;
}

async function ensureSetupBeforeSuggestion(): Promise<void> {
  if (await hasCompletedSetup()) {
    return;
  }

  const code = await runSetupFlow({
    showWelcome: true,
    offerShellInstall: true,
  });
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

  console.log(heading("tc config"));
  console.log(`${label("Config file:")} ${getUserConfigPath()}`);
  console.log(`${label("Active provider:")} ${commandText(activeProvider)}`);
  console.log(
    `${label("OpenAI OAuth:")} ${codexConfigured ? statusOk("configured") : statusWarn("not configured")}`
  );
  console.log(
    `${label("OpenAI API key:")} ${openaiConfigured ? statusOk("configured") : statusWarn("not configured")}`
  );
  console.log("");
  printInfo(
    `Run ${commandText("tc config codex")} to run OpenAI OAuth setup (browser or device login).`
  );
  printInfo(
    `Run ${commandText("tc config openai")} to set/update your OpenAI API key.`
  );
  printInfo(
    `Voice settings are stored in ${commandText(getUserConfigPath())}.`
  );
  printInfo(
    `Run ${commandText("tc use codex")} or ${commandText("tc use openai")} to switch providers.`
  );
  printInfo(`Run ${commandText("tc setup")} to run full onboarding again.`);
  return 0;
}

async function handleResetCommand(yes: boolean): Promise<number> {
  if (!yes) {
    if (!canPromptInteractively()) {
      printFailure(
        `Reset requires confirmation. Re-run ${commandText("tc reset --yes")} in non-interactive mode.`
      );
      return 1;
    }

    console.log(heading("tc reset"));
    printInfo(
      `This removes Compleet data in ${getUserConfigDir()} and strips Compleet shell integration from supported shell rc files.`
    );
    printInfo("Codex auth is not touched.");
    printInfo("Installed binaries are not removed.");

    const confirmed = await confirm("Continue?", false);
    if (!confirmed) {
      printWarning("Reset cancelled.");
      return 1;
    }
  }

  const removedShellPaths: string[] = [];
  for (const shell of ["zsh", "bash"] as const) {
    const result = await removeShellIntegration(shell);
    if (result.updated) {
      removedShellPaths.push(result.path);
    }
  }

  await rm(getUserConfigDir(), { recursive: true, force: true });

  printSuccess(
    `Removed Compleet config and voice data from ${getUserConfigDir()}`
  );
  if (removedShellPaths.length > 0) {
    printSuccess(
      `Removed Compleet shell integration from ${removedShellPaths.join(", ")}`
    );
    for (const path of removedShellPaths) {
      printInfo(
        `Reload your shell with ${commandText(`source ${path}`)} or open a new terminal session.`
      );
    }
  } else {
    printInfo("No Compleet shell integration block was found to remove.");
  }
  printInfo("Codex auth was left unchanged.");
  return 0;
}

async function handleUseCommand(args: UseModeArgs): Promise<number> {
  const config = await loadUserConfig();
  const path = await saveUserConfig({
    ...config,
    activeProvider: args.provider,
  });

  printSuccess(
    `Active provider set to ${providerLabel(args.provider)} in ${path}`
  );

  if (args.provider === "openai" && !config.openaiApiKey?.trim()) {
    printWarning(
      `OpenAI API key is not configured. Run ${commandText("tc config openai")} or ${commandText(
        "tc setup"
      )}.`
    );
  }

  if (args.provider === "codex") {
    const codexReady = await isCodexConfigured();
    if (!codexReady) {
      printWarning(
        `Codex auth not configured yet. Run ${commandText("tc config codex")} if needed.`
      );
    }
  }

  return 0;
}

async function main() {
  const rawArgv = process.argv.slice(2);
  if (rawArgv.length === 0) {
    if (!(await hasCompletedSetup())) {
      const code = await runSetupFlow({
        showWelcome: true,
        offerShellInstall: true,
      });
      process.exit(code);
    }

    console.log(colorizeHelp(helpText()));
    return;
  }

  let args: ParsedArgs;
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

  if (args.mode === "reset") {
    const code = await handleResetCommand(args.yes);
    process.exit(code);
  }

  if (args.mode === "voice") {
    await ensureSetupBeforeSuggestion();
    const context = buildRuntimeContext();
    await runVoiceMode(context);
    return;
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
