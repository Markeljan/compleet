import type { ProviderName } from "./types";

export interface SuggestModeArgs {
  mode: "suggest";
  prompt: string;
  json: boolean;
  explain: boolean;
  promptMode: boolean;
  provider?: ProviderName;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface InitModeArgs {
  mode: "init";
  shell?: string;
  install: boolean;
}

export interface HelpModeArgs {
  mode: "help";
}

export interface VersionModeArgs {
  mode: "version";
}

export interface AuthModeArgs {
  mode: "auth";
  provider?: ProviderName;
  action?: "login" | "status" | "logout";
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  setDefault?: boolean;
  interactive: boolean;
}

export interface ConfigModeArgs {
  mode: "config";
  action: "wizard" | "show" | "path" | "reset" | "apply" | "get" | "set" | "unset";
  provider?: ProviderName;
  key?: string;
  value?: string;
}

export type ParsedArgs =
  | SuggestModeArgs
  | InitModeArgs
  | HelpModeArgs
  | VersionModeArgs
  | AuthModeArgs
  | ConfigModeArgs;

export class ArgParseError extends Error {}

export function parseArgs(argv: string[]): ParsedArgs {
  if (argv.length === 0) {
    return { mode: "help" };
  }

  const first = argv[0];
  if (first === "-h" || first === "--help" || first === "help") {
    return { mode: "help" };
  }
  if (first === "-v" || first === "--version" || first === "version") {
    return { mode: "version" };
  }
  if (first === "init") {
    return parseInitArgs(argv.slice(1));
  }
  if (first === "auth") {
    return parseAuthArgs(argv.slice(1));
  }
  if (first === "config") {
    return parseConfigArgs(argv.slice(1));
  }

  const tokens = first === "suggest" ? argv.slice(1) : argv.slice();
  return parseSuggestArgs(tokens);
}

function parseInitArgs(argv: string[]): InitModeArgs | HelpModeArgs {
  if (argv.length === 0) {
    return { mode: "init", install: false };
  }

  if (argv.length === 1 && (argv[0] === "-h" || argv[0] === "--help" || argv[0] === "help")) {
    return { mode: "help" };
  }

  let shell: string | undefined;
  let install = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--install") {
      install = true;
      continue;
    }

    if (arg === "--shell") {
      shell = readValue(argv, ++i, "--shell");
      continue;
    }

    // Legacy form: `tcomp init zsh`
    if (!arg.startsWith("-") && !shell) {
      shell = arg;
      continue;
    }

    throw new ArgParseError(`Unknown init option: ${arg}`);
  }

  return { mode: "init", shell, install };
}

function parseSuggestArgs(argv: string[]): SuggestModeArgs | HelpModeArgs {
  let json = false;
  let explain = false;
  let promptMode = false;
  let provider: ProviderName | undefined;
  let model: string | undefined;
  let baseUrl: string | undefined;
  let apiKey: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--prompt" || arg === "-p") {
      promptMode = true;
      continue;
    }
    if (arg === "--explain") {
      explain = true;
      continue;
    }
    if (arg === "-e") {
      explain = true;
      continue;
    }
    if (arg === "--provider") {
      provider = parseProvider(readValue(argv, ++i, "--provider"));
      continue;
    }
    if (arg === "--model") {
      model = readValue(argv, ++i, "--model");
      continue;
    }
    if (arg === "--base-url") {
      baseUrl = readValue(argv, ++i, "--base-url");
      continue;
    }
    if (arg === "--api-key") {
      apiKey = readValue(argv, ++i, "--api-key");
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      return { mode: "help" };
    }
    if (arg.startsWith("-")) {
      throw new ArgParseError(`Unknown option: ${arg}`);
    }
    positionals.push(arg);
  }

  const prompt = positionals.join(" ").trim();
  if (!prompt) {
    throw new ArgParseError("Missing prompt. Example: tcomp 'open zshrc using vscode'");
  }

  return {
    mode: "suggest",
    prompt,
    json,
    explain,
    promptMode,
    provider,
    model,
    baseUrl,
    apiKey,
  };
}

function parseAuthArgs(argv: string[]): AuthModeArgs | HelpModeArgs {
  if (argv.length === 0) {
    return { mode: "auth", interactive: true };
  }

  if (argv.length === 1 && (argv[0] === "-h" || argv[0] === "--help" || argv[0] === "help")) {
    return { mode: "help" };
  }

  // Legacy form: `auth codex login`
  if (!argv[0]?.startsWith("-")) {
    const provider = parseProvider(argv[0]);
    const actionToken = argv[1];
    if (provider === "codex") {
      if (actionToken !== "login" && actionToken !== "status" && actionToken !== "logout") {
        throw new ArgParseError(
          'Invalid auth action. Use "login", "status", or "logout" (example: tcomp auth codex login)',
        );
      }
      return {
        mode: "auth",
        provider,
        action: actionToken,
        interactive: false,
        setDefault: true,
      };
    }

    // Legacy-ish `auth openai` falls into interactive setup for OpenAI.
    if (argv.length > 1) {
      throw new ArgParseError(`Unexpected auth arguments after provider "${provider}"`);
    }
    return { mode: "auth", provider, interactive: true, setDefault: true };
  }

  let provider: ProviderName | undefined;
  let action: AuthModeArgs["action"];
  let apiKey: string | undefined;
  let model: string | undefined;
  let baseUrl: string | undefined;
  let setDefault = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--provider") {
      provider = parseProvider(readValue(argv, ++i, "--provider"));
      continue;
    }
    if (arg === "--status") {
      action = "status";
      continue;
    }
    if (arg === "--logout") {
      action = "logout";
      continue;
    }
    if (arg === "--login") {
      action = "login";
      continue;
    }
    if (arg === "--api-key") {
      apiKey = readValue(argv, ++i, "--api-key");
      continue;
    }
    if (arg === "--model") {
      model = readValue(argv, ++i, "--model");
      continue;
    }
    if (arg === "--base-url") {
      baseUrl = readValue(argv, ++i, "--base-url");
      continue;
    }
    if (arg === "--no-default") {
      setDefault = false;
      continue;
    }
    throw new ArgParseError(`Unknown auth option: ${arg}`);
  }

  if (!provider) {
    if (apiKey) {
      provider = "openai";
    } else if (action) {
      provider = "codex";
    }
  }

  if (provider === "codex" && !action) {
    action = "login";
  }

  return {
    mode: "auth",
    provider,
    action,
    apiKey,
    model,
    baseUrl,
    setDefault,
    interactive: false,
  };
}

function parseConfigArgs(argv: string[]): ConfigModeArgs | HelpModeArgs {
  if (argv.length === 0) {
    return { mode: "config", action: "wizard" };
  }

  if (argv.length === 1 && (argv[0] === "-h" || argv[0] === "--help" || argv[0] === "help")) {
    return { mode: "help" };
  }

  const first = argv[0];
  if (first === "show" || first === "path") {
    if (argv.length > 1) {
      throw new ArgParseError(`Unexpected arguments for config ${first}`);
    }
    return { mode: "config", action: first };
  }
  if (first === "get" || first === "unset") {
    const key = argv[1];
    if (!key) {
      throw new ArgParseError(`Missing key. Example: tcomp config ${first} provider`);
    }
    if (argv.length > 2) {
      throw new ArgParseError(`Unexpected extra arguments for config ${first}`);
    }
    return { mode: "config", action: first, key };
  }
  if (first === "set") {
    const key = argv[1];
    const value = argv.slice(2).join(" ").trim();
    if (!key) {
      throw new ArgParseError("Missing key. Example: tcomp config set provider codex");
    }
    if (!value) {
      throw new ArgParseError(`Missing value. Example: tcomp config set ${key} <value>`);
    }
    return { mode: "config", action: "set", key, value };
  }

  let provider: ProviderName | undefined;
  let action: ConfigModeArgs["action"] | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--show") {
      action = "show";
      continue;
    }
    if (arg === "--path") {
      action = "path";
      continue;
    }
    if (arg === "--reset") {
      action = "reset";
      continue;
    }
    if (arg === "--provider") {
      provider = parseProvider(readValue(argv, ++i, "--provider"));
      continue;
    }

    throw new ArgParseError(`Unknown config option: ${arg}`);
  }

  if (provider) {
    if (action && action !== "apply") {
      throw new ArgParseError("Cannot combine --provider with --show/--path/--reset");
    }
    return { mode: "config", action: "apply", provider };
  }

  if (action) {
    return { mode: "config", action };
  }

  return { mode: "config", action: "wizard" };
}

function parseProvider(value: string): ProviderName {
  if (value === "openai" || value === "codex") {
    return value;
  }
  throw new ArgParseError(`Unsupported provider: ${value} (expected openai or codex)`);
}

function readValue(argv: string[], index: number, flagName: string): string {
  const value = argv[index];
  if (!value) {
    throw new ArgParseError(`Missing value for ${flagName}`);
  }
  return value;
}

export function helpText(): string {
  const name = "tcomp";

  return `${name} - AI terminal command helper

Usage:
  ${name} [flags] prompt text
  ${name} auth [flags]
  ${name} config [flags]
  ${name} init [--shell zsh] [--install]
  ${name} --help

Examples:
  ${name} open zshrc using vscode
  ${name} --provider codex find large files over 1GB in this folder
  ${name} -e find large files over 1GB in this folder
  ${name} -p hey how are you
  ${name} auth
  ${name} auth --provider codex --status
  ${name} config --provider codex
  ${name} init --install

Common flags (prompt mode):
  --provider <name>   openai | codex
  --prompt, -p        general model response (no command prefill)
  --json              print structured output
  --explain, -e       print explanation/risk to stderr

Optional env overrides:
  TCOMP_PROVIDER
  OPENAI_API_KEY / TCOMP_API_KEY
`;
}
