import type { ConfigModeArgs } from "./args";
import { canPromptInteractively, selectWithArrows, type SelectOption } from "./interactive";
import { getUserConfigPath, loadUserConfig, saveUserConfig, type UserConfig } from "./user-config";

type CanonicalConfigKey =
  | "provider"
  | "apiKey"
  | "baseUrl"
  | "model"
  | "codexBaseUrl"
  | "codexModel";

const KEY_ALIASES: Record<string, CanonicalConfigKey> = {
  provider: "provider",
  apiKey: "apiKey",
  "openai.apiKey": "apiKey",
  baseUrl: "baseUrl",
  "openai.baseUrl": "baseUrl",
  model: "model",
  "openai.model": "model",
  "codex.baseUrl": "codexBaseUrl",
  "codex.model": "codexModel",
};

const SENSITIVE_KEYS = new Set<CanonicalConfigKey>(["apiKey"]);

export async function handleConfigCommand(args: ConfigModeArgs): Promise<number> {
  switch (args.action) {
    case "path":
      console.log(getUserConfigPath());
      return 0;
    case "show":
      return await handleShow();
    case "reset":
      return await handleReset();
    case "apply":
      return await handleApply(args);
    case "wizard":
      return await handleWizard();
    case "get":
      return await handleGet(args.key ?? "");
    case "set":
      return await handleSet(args.key ?? "", args.value ?? "");
    case "unset":
      return await handleUnset(args.key ?? "");
  }
}

async function handleWizard(): Promise<number> {
  const config = await loadUserConfig();
  const configPath = getUserConfigPath();

  if (!canPromptInteractively()) {
    console.error("Config wizard requires an interactive terminal.");
    console.error(`Use "tcomp config --show" or "tcomp config --provider <openai|codex>".`);
    console.error(`Config path: ${configPath}`);
    return 1;
  }

  console.log(`Config file: ${configPath}`);
  console.log(JSON.stringify(redactConfig(config), null, 2));

  const options: Array<SelectOption<"keep" | "openai" | "codex">> = [
    { label: `Keep current (${config.provider ?? "unset"})`, value: "keep" },
    { label: "Set default provider: codex", value: "codex" },
    { label: "Set default provider: openai", value: "openai" },
  ];
  const defaultIndex =
    config.provider === "codex" ? 1 : config.provider === "openai" ? 2 : 0;
  const choice = await selectWithArrows("Config action:", options, defaultIndex);

  if (choice === "keep") {
    console.log("No config changes made.");
    return 0;
  }

  const next: UserConfig = { ...config, provider: choice };
  const path = await saveUserConfig(next);
  console.log(`Saved default provider "${choice}" to ${path}`);
  console.log(`Next step: run "tcomp auth" to complete provider setup if needed.`);
  return 0;
}

async function handleShow(): Promise<number> {
  const config = await loadUserConfig();
  const redacted = redactConfig(config);
  console.log(JSON.stringify(redacted, null, 2));
  return 0;
}

async function handleApply(args: ConfigModeArgs): Promise<number> {
  const current = await loadUserConfig();
  const next: UserConfig = { ...current };

  if (args.provider) {
    next.provider = args.provider;
  }

  const path = await saveUserConfig(next);
  if (args.provider) {
    console.log(`Saved default provider to ${path}`);
    console.log(args.provider);
    return 0;
  }

  console.error("No config changes requested.");
  return 1;
}

async function handleReset(): Promise<number> {
  const path = await saveUserConfig({});
  console.log(`Reset config: ${path}`);
  return 0;
}

async function handleGet(keyInput: string): Promise<number> {
  const key = normalizeConfigKey(keyInput);
  const config = await loadUserConfig();
  const value = config[key];

  if (value === undefined) {
    console.error(`Config key is not set: ${keyInput}`);
    return 1;
  }

  if (SENSITIVE_KEYS.has(key)) {
    console.log(redactString(String(value)));
    return 0;
  }

  console.log(String(value));
  return 0;
}

async function handleSet(keyInput: string, rawValue: string): Promise<number> {
  const key = normalizeConfigKey(keyInput);
  const value = normalizeConfigValue(key, rawValue);

  const current = await loadUserConfig();
  const next: UserConfig = { ...current, [key]: value };
  const path = await saveUserConfig(next);

  console.log(`Saved ${keyInput} in ${path}`);
  if (SENSITIVE_KEYS.has(key)) {
    console.log(redactString(String(value)));
  } else {
    console.log(String(value));
  }
  return 0;
}

async function handleUnset(keyInput: string): Promise<number> {
  const key = normalizeConfigKey(keyInput);
  const current = await loadUserConfig();
  const next: UserConfig = { ...current };

  if (next[key] === undefined) {
    console.error(`Config key is not set: ${keyInput}`);
    return 1;
  }

  delete next[key];
  const path = await saveUserConfig(next);
  console.log(`Unset ${keyInput} in ${path}`);
  return 0;
}

function normalizeConfigKey(input: string): CanonicalConfigKey {
  const key = KEY_ALIASES[input];
  if (!key) {
    const supported = Object.keys(KEY_ALIASES).join(", ");
    throw new Error(`Unsupported config key: ${input}. Supported keys: ${supported}`);
  }
  return key;
}

function normalizeConfigValue(key: CanonicalConfigKey, value: string): string | UserConfig["provider"] {
  const trimmed = value.trim();

  if (key === "provider") {
    if (trimmed !== "openai" && trimmed !== "codex") {
      throw new Error(`Invalid provider: ${trimmed}. Expected "openai" or "codex".`);
    }
    return trimmed;
  }

  if (key === "baseUrl" || key === "codexBaseUrl") {
    return trimmed.replace(/\/+$/, "");
  }

  return trimmed;
}

function redactConfig(config: UserConfig): UserConfig {
  return {
    ...config,
    ...(typeof config.apiKey === "string" ? { apiKey: redactString(config.apiKey) } : {}),
  };
}

function redactString(input: string): string {
  if (input.length <= 10) {
    return "***";
  }
  return `${input.slice(0, 6)}...${input.slice(-4)}`;
}
