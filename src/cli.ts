#!/usr/bin/env bun
import { basename } from "node:path";
import type { AuthModeArgs } from "./args";
import { parseArgs, ArgParseError, helpText } from "./args";
import { runCodexCliAuthAction } from "./codex-auth";
import { handleConfigCommand } from "./config-command";
import { askChoice, askLine, canPromptInteractively, confirm } from "./interactive";
import { generatePromptResponse, generateSuggestion } from "./openai";
import { isSupportedInitShell, renderShellInit } from "./shell";
import { installShellIntegration } from "./shell-install";
import type { RuntimeContext, Suggestion } from "./types";
import { loadUserConfig, updateUserConfig } from "./user-config";
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

async function resolveInitShell(explicitShell?: string): Promise<"zsh"> {
  if (explicitShell) {
    if (!isSupportedInitShell(explicitShell)) {
      throw new Error(`Unsupported shell for init: ${explicitShell}. Supported: zsh`);
    }
    return explicitShell;
  }

  const detected = shellNameFromEnv();
  if (isSupportedInitShell(detected)) {
    return detected;
  }

  if (!canPromptInteractively()) {
    throw new Error(`Could not auto-detect a supported shell from SHELL="${detected}". Use: tcomp init --shell zsh`);
  }

  return (await askChoice("Shell integration to print", ["zsh"], "zsh")) as "zsh";
}

async function handleAuthCommand(args: AuthModeArgs): Promise<number> {
  if (args.interactive) {
    return await runAuthWizard(args.provider);
  }

  if (!args.provider) {
    if (!canPromptInteractively()) {
      console.error("Auth setup needs a provider. Use --provider codex|openai, or run `tcomp auth` interactively.");
      return 1;
    }
    return await runAuthWizard(undefined);
  }

  if (args.provider === "codex") {
    return await handleCodexAuth(args);
  }

  return await handleOpenAIAuth(args);
}

async function runAuthWizard(initialProvider?: "openai" | "codex"): Promise<number> {
  if (!canPromptInteractively()) {
    console.error("Auth wizard requires an interactive terminal.");
    console.error("Examples:");
    console.error("  tcomp auth --provider codex");
    console.error("  tcomp auth --provider openai --api-key <key>");
    return 1;
  }

  const config = await loadUserConfig();
  const provider = (await askChoice(
    "Auth provider",
    ["codex", "openai"],
    initialProvider ?? config.provider ?? "codex",
  )) as "codex" | "openai";

  if (provider === "codex") {
    const action = (await askChoice("Codex auth action", ["login", "status", "logout"], "login")) as
      | "login"
      | "status"
      | "logout";

    return await handleCodexAuth({
      mode: "auth",
      provider,
      action,
      interactive: false,
      setDefault: true,
    });
  }

  const apiKey = (await askLine("OpenAI API key (input visible): ")).trim();
  if (!apiKey) {
    console.error("No API key provided.");
    return 1;
  }

  const setDefault = await confirm("Set OpenAI as default provider?", config.provider !== "codex");
  return await handleOpenAIAuth({
    mode: "auth",
    provider: "openai",
    apiKey,
    interactive: false,
    setDefault,
  });
}

async function handleCodexAuth(args: AuthModeArgs): Promise<number> {
  const action = args.action ?? "login";
  const code = await runCodexCliAuthAction(action);

  if (code !== 0) {
    return code;
  }

  const patch: Parameters<typeof updateUserConfig>[0] = {};
  if (args.setDefault !== false) {
    patch.provider = "codex";
  }
  if (args.model) {
    patch.codexModel = args.model.trim();
  }
  if (args.baseUrl) {
    patch.codexBaseUrl = args.baseUrl.trim().replace(/\/+$/, "");
  }

  if (Object.keys(patch).length > 0) {
    try {
      const path = await updateUserConfig(patch);
      if (action === "login" && args.setDefault !== false) {
        console.error(`Saved Codex defaults in ${path}`);
      }
    } catch {
      // best effort
    }
  }

  return 0;
}

async function handleOpenAIAuth(args: AuthModeArgs): Promise<number> {
  if (args.action === "status" || args.action === "logout") {
    console.error(`OpenAI auth does not support "${args.action}" here. Use "tcomp auth" or pass --api-key.`);
    return 1;
  }

  let apiKey = args.apiKey?.trim();
  if (!apiKey) {
    if (!canPromptInteractively()) {
      console.error("Missing OpenAI API key. Use `tcomp auth --provider openai --api-key <key>`.");
      return 1;
    }
    apiKey = (await askLine("OpenAI API key (input visible): ")).trim();
  }

  if (!apiKey) {
    console.error("No API key provided.");
    return 1;
  }

  const patch: Parameters<typeof updateUserConfig>[0] = {
    apiKey,
  };

  if (args.setDefault !== false) {
    patch.provider = "openai";
  }
  if (args.model) {
    patch.model = args.model.trim();
  }
  if (args.baseUrl) {
    patch.baseUrl = args.baseUrl.trim().replace(/\/+$/, "");
  }

  const path = await updateUserConfig(patch);
  console.error(`Saved OpenAI auth in ${path}`);
  return 0;
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

  if (args.mode === "init") {
    const shell = await resolveInitShell(args.shell);
    if (args.install) {
      const result = await installShellIntegration(shell, "tcomp");
      if (result.updated) {
        console.log(`Installed tcomp shell integration in ${result.path}`);
        console.log(`Run: source ${result.path}`);
      } else {
        console.log(`tcomp shell integration already installed in ${result.path}`);
      }
      return;
    }
    process.stdout.write(renderShellInit(shell));
    return;
  }

  if (args.mode === "auth") {
    const code = await handleAuthCommand(args);
    process.exit(code);
  }

  if (args.mode === "config") {
    const code = await handleConfigCommand(args);
    process.exit(code);
  }

  const context = buildRuntimeContext();
  if (args.promptMode) {
    const response = await generatePromptResponse(args.prompt, context, {
      provider: args.provider,
      model: args.model,
      baseUrl: args.baseUrl,
      apiKey: args.apiKey,
    });

    if (args.json) {
      console.log(JSON.stringify({ response }, null, 2));
      return;
    }

    console.log(response);
    return;
  }

  const suggestion = await generateSuggestion(args.prompt, context, {
    provider: args.provider,
    model: args.model,
    baseUrl: args.baseUrl,
    apiKey: args.apiKey,
  });

  if (args.json) {
    console.log(JSON.stringify(suggestion, null, 2));
    return;
  }

  printSuggestionHuman(suggestion, args.explain);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
