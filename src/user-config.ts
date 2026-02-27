import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ProviderName } from "./types";

export interface UserConfig {
  provider?: ProviderName;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  codexBaseUrl?: string;
  codexModel?: string;
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
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const obj = parsed as Record<string, unknown>;
    return {
      provider: obj.provider === "codex" || obj.provider === "openai" ? obj.provider : undefined,
      apiKey: typeof obj.apiKey === "string" ? obj.apiKey : undefined,
      baseUrl: typeof obj.baseUrl === "string" ? obj.baseUrl : undefined,
      model: typeof obj.model === "string" ? obj.model : undefined,
      codexBaseUrl: typeof obj.codexBaseUrl === "string" ? obj.codexBaseUrl : undefined,
      codexModel: typeof obj.codexModel === "string" ? obj.codexModel : undefined,
    };
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

function isFileMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
