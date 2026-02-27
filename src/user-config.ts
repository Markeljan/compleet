import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ProviderName } from "./types";

export interface UserConfig {
  activeProvider?: ProviderName;
  openaiApiKey?: string;
}

export function getUserConfigPath(): string {
  const home = homedir();

  if (process.platform === "win32") {
    const baseDir = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    return join(baseDir, "terminal-complete", "config.json");
  }

  const baseDir = process.env.XDG_CONFIG_HOME ?? join(home, ".config");
  return join(baseDir, "terminal-complete", "config.json");
}

export async function loadUserConfig(): Promise<UserConfig> {
  const path = getUserConfigPath();

  try {
    const raw = await readFile(path, "utf8");
    return parseUserConfig(raw);
  } catch (error) {
    if (isFileMissing(error)) {
      return {};
    }
    throw error;
  }
}

export async function updateUserConfig(patch: Partial<UserConfig>): Promise<string> {
  const current = await loadUserConfig();
  return saveUserConfig({ ...current, ...patch });
}

export async function saveUserConfig(config: UserConfig): Promise<string> {
  const path = getUserConfigPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  if (process.platform !== "win32") {
    try {
      await chmod(path, 0o600);
    } catch {
      // Best-effort file permissions.
    }
  }

  return path;
}

function parseUserConfig(raw: string): UserConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== "object") {
    return {};
  }

  const obj = parsed as Record<string, unknown>;

  const openaiApiKey =
    typeof obj.openaiApiKey === "string"
      ? obj.openaiApiKey
      : typeof obj.apiKey === "string"
        ? obj.apiKey
        : undefined;

  const activeProvider =
    normalizeProviderName(obj.activeProvider) ??
    normalizeProviderName(obj.provider) ??
    normalizeProviderFromAuthMethod(obj.authMethod) ??
    (openaiApiKey ? "openai" : undefined);

  return {
    activeProvider,
    openaiApiKey,
  };
}

function normalizeProviderName(value: unknown): ProviderName | undefined {
  if (value === "codex" || value === "openai") {
    return value;
  }
  return undefined;
}

function normalizeProviderFromAuthMethod(value: unknown): ProviderName | undefined {
  if (value === "codex-oauth") {
    return "codex";
  }
  if (value === "openai-api-key") {
    return "openai";
  }
  return undefined;
}

function isFileMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
