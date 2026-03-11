import type { ProviderName } from "./types";

export interface SuggestModeArgs {
  explain: boolean;
  mode: "suggest";
  prompt: string;
  promptMode: boolean;
}

export interface SetupModeArgs {
  mode: "setup";
  provider?: ProviderName;
}

export interface ConfigModeArgs {
  mode: "config";
  provider?: ProviderName;
}

export interface UseModeArgs {
  mode: "use";
  provider: ProviderName;
}

export interface VoiceModeArgs {
  mode: "voice";
}

export interface ResetModeArgs {
  mode: "reset";
  yes: boolean;
}

export interface HelpModeArgs {
  mode: "help";
}

export interface VersionModeArgs {
  mode: "version";
}

export type ParsedArgs =
  | SuggestModeArgs
  | SetupModeArgs
  | ConfigModeArgs
  | UseModeArgs
  | VoiceModeArgs
  | ResetModeArgs
  | HelpModeArgs
  | VersionModeArgs;

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
  if (first === "setup") {
    return parseSetupArgs(argv.slice(1));
  }
  if (first === "config") {
    return parseConfigArgs(argv.slice(1));
  }
  if (first === "use") {
    return parseUseArgs(argv.slice(1));
  }
  if (first === "reset") {
    return parseResetArgs(argv.slice(1));
  }
  if (first === "voice") {
    return parseVoiceArgs(argv.slice(1));
  }

  const tokens = first === "suggest" ? argv.slice(1) : argv.slice();
  return parseSuggestArgs(tokens);
}

function parseSetupArgs(argv: string[]): SetupModeArgs | HelpModeArgs {
  if (argv.length === 0) {
    return { mode: "setup" };
  }

  if (
    argv.length === 1 &&
    (argv[0] === "-h" || argv[0] === "--help" || argv[0] === "help")
  ) {
    return { mode: "help" };
  }

  if (argv.length === 1) {
    return { mode: "setup", provider: parseProvider(argv[0]) };
  }

  throw new ArgParseError("Unknown setup option. Use: tc setup [codex|openai]");
}

function parseConfigArgs(argv: string[]): ConfigModeArgs | HelpModeArgs {
  if (argv.length === 0) {
    return { mode: "config" };
  }

  if (
    argv.length === 1 &&
    (argv[0] === "-h" || argv[0] === "--help" || argv[0] === "help")
  ) {
    return { mode: "help" };
  }

  if (argv.length === 1) {
    return { mode: "config", provider: parseProvider(argv[0]) };
  }

  throw new ArgParseError(
    "Unknown config option. Use: tc config [codex|openai]"
  );
}

function parseUseArgs(argv: string[]): UseModeArgs | HelpModeArgs {
  if (
    argv.length === 1 &&
    (argv[0] === "-h" || argv[0] === "--help" || argv[0] === "help")
  ) {
    return { mode: "help" };
  }

  if (argv.length !== 1) {
    throw new ArgParseError("Missing provider. Use: tc use <codex|openai>");
  }

  return {
    mode: "use",
    provider: parseProvider(argv[0]),
  };
}

function parseResetArgs(argv: string[]): ResetModeArgs | HelpModeArgs {
  if (argv.length === 0) {
    return { mode: "reset", yes: false };
  }

  if (
    argv.length === 1 &&
    (argv[0] === "-h" || argv[0] === "--help" || argv[0] === "help")
  ) {
    return { mode: "help" };
  }

  if (argv.length === 1 && argv[0] === "--yes") {
    return { mode: "reset", yes: true };
  }

  throw new ArgParseError("Unknown reset option. Use: tc reset [--yes]");
}

function parseVoiceArgs(argv: string[]): VoiceModeArgs | HelpModeArgs {
  if (argv.length === 0) {
    return { mode: "voice" };
  }

  if (
    argv.length === 1 &&
    (argv[0] === "-h" || argv[0] === "--help" || argv[0] === "help")
  ) {
    return { mode: "help" };
  }

  throw new ArgParseError("Unknown voice option. Use: tc voice");
}

function parseSuggestArgs(argv: string[]): SuggestModeArgs | HelpModeArgs {
  let explain = false;
  let promptMode = false;
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (arg === "--prompt" || arg === "-p") {
      promptMode = true;
      continue;
    }
    if (arg === "--explain" || arg === "-e") {
      explain = true;
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
    throw new ArgParseError(
      'Missing prompt. For general prompts, use "tc --prompt <question>" (or "tc -p <question>").'
    );
  }

  return {
    mode: "suggest",
    prompt,
    explain,
    promptMode,
  };
}

function parseProvider(input: string): ProviderName {
  const value = input.trim().toLowerCase();
  if (value === "codex" || value === "openai") {
    return value;
  }
  throw new ArgParseError(
    `Unsupported provider: ${input} (expected codex or openai)`
  );
}

export function helpText(): string {
  const name = "tc";

  return `${name} - Compleet AI prompt compiler

Usage:
  ${name} voice
  ${name} [flags] <request>
  ${name} setup [codex|openai]
  ${name} config [codex|openai]
  ${name} reset [--yes]
  ${name} use <codex|openai>
  ${name} --help

Practical examples:
  ${name} voice
  ${name} find all .env files modified in the last 24 hours
  ${name} create a tar.gz backup of src and save it to backups/
  ${name} -e safely delete node_modules folders older than 14 days
  ${name} -p summarize the difference between rsync and cp

Common flags (prompt mode):
  --prompt, -p        general response mode (no command prefill)
  --explain, -e       print explanation/risk to stderr
`;
}
