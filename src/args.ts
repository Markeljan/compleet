export interface SuggestModeArgs {
  mode: "suggest";
  prompt: string;
  explain: boolean;
  promptMode: boolean;
}

export interface SetupModeArgs {
  mode: "setup";
  legacyAlias?: "auth" | "config" | "init";
}

export interface HelpModeArgs {
  mode: "help";
}

export interface VersionModeArgs {
  mode: "version";
}

export type ParsedArgs = SuggestModeArgs | SetupModeArgs | HelpModeArgs | VersionModeArgs;

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
  if (first === "init" || first === "auth" || first === "config") {
    return parseSetupArgs(argv.slice(1), first);
  }

  const tokens = first === "suggest" ? argv.slice(1) : argv.slice();
  return parseSuggestArgs(tokens);
}

function parseSetupArgs(
  argv: string[],
  legacyAlias?: SetupModeArgs["legacyAlias"],
): SetupModeArgs | HelpModeArgs {
  if (argv.length === 0) {
    return { mode: "setup", legacyAlias };
  }

  if (argv.length === 1 && (argv[0] === "-h" || argv[0] === "--help" || argv[0] === "help")) {
    return { mode: "help" };
  }

  throw new ArgParseError("Unknown setup option. Use: tcomp setup");
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
    throw new ArgParseError("Missing prompt. Example: tcomp 'open zshrc using vscode'");
  }

  return {
    mode: "suggest",
    prompt,
    explain,
    promptMode,
  };
}

export function helpText(): string {
  const name = "tcomp";

  return `${name} - AI terminal command helper

Usage:
  ${name} [flags] prompt text
  ${name} setup
  ${name} --help

Examples:
  ${name} open zshrc using vscode
  ${name} -e find large files over 1GB in this folder
  ${name} -p hey how are you
  ${name} setup

Common flags (prompt mode):
  --prompt, -p        general model response (no command prefill)
  --explain, -e       print explanation/risk to stderr
`;
}
