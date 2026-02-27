import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AuthMethod } from "./types";

export interface UserConfig {
  authMethod?: AuthMethod;
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
  const authMethod = normalizeAuthMethod(obj.authMethod);
  const openaiApiKey = typeof obj.openaiApiKey === "string" ? obj.openaiApiKey : undefined;

  if (authMethod || openaiApiKey) {
    return {
      authMethod: authMethod ?? (openaiApiKey ? "openai-api-key" : undefined),
      openaiApiKey,
    };
  }

  // Backward-compatible migration from v0.1.0 provider schema.
  const legacyProvider = obj.provider;
  const legacyApiKey = typeof obj.apiKey === "string" ? obj.apiKey : undefined;

  if (legacyProvider === "codex") {
    return { authMethod: "codex-oauth" };
  }

  if (legacyProvider === "openai" || legacyApiKey) {
    return {
      authMethod: "openai-api-key",
      openaiApiKey: legacyApiKey,
    };
  }

  return {};
}

function normalizeAuthMethod(value: unknown): AuthMethod | undefined {
  if (value === "codex-oauth" || value === "openai-api-key") {
    return value;
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
