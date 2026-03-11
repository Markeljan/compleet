import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ProviderName } from "./types";

export interface VoiceConfig {
  audioInputDevice?: string;
  fasterWhisperModel?: string;
  ffmpegBin?: string;
  openAiTranscribeModel?: string;
  pythonBin?: string;
  transcribeLanguage?: string;
  transcribePrompt?: string;
  whisperCppBin?: string;
  whisperCppModelPath?: string;
}

export interface UserConfig {
  activeProvider?: ProviderName;
  openaiApiKey?: string;
  voice?: VoiceConfig;
}

export function getUserConfigDir(): string {
  const home = homedir();

  if (process.platform === "win32") {
    const baseDir = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    return join(baseDir, "compleet");
  }

  const baseDir = process.env.XDG_CONFIG_HOME ?? join(home, ".config");
  return join(baseDir, "compleet");
}

export function getUserConfigPath(): string {
  return join(getUserConfigDir(), "config.json");
}

export async function loadUserConfig(): Promise<UserConfig> {
  try {
    const raw = await readFile(getUserConfigPath(), "utf8");
    return parseUserConfig(raw);
  } catch (error) {
    if (isFileMissing(error)) {
      return {};
    }
    throw error;
  }
}

export async function updateUserConfig(
  patch: Partial<UserConfig>
): Promise<string> {
  const current = await loadUserConfig();
  return saveUserConfig({
    ...current,
    ...patch,
    voice: {
      ...current.voice,
      ...patch.voice,
    },
  });
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
  const voiceObj =
    obj.voice && typeof obj.voice === "object"
      ? (obj.voice as Record<string, unknown>)
      : null;

  return {
    activeProvider: normalizeProviderName(obj.activeProvider),
    openaiApiKey: normalizeString(obj.openaiApiKey),
    voice: voiceObj
      ? {
          audioInputDevice: normalizeString(voiceObj.audioInputDevice),
          fasterWhisperModel: normalizeString(voiceObj.fasterWhisperModel),
          ffmpegBin: normalizeString(voiceObj.ffmpegBin),
          openAiTranscribeModel: normalizeString(
            voiceObj.openAiTranscribeModel
          ),
          pythonBin: normalizeString(voiceObj.pythonBin),
          transcribeLanguage: normalizeString(voiceObj.transcribeLanguage),
          transcribePrompt: normalizeString(voiceObj.transcribePrompt),
          whisperCppBin: normalizeString(voiceObj.whisperCppBin),
          whisperCppModelPath: normalizeString(voiceObj.whisperCppModelPath),
        }
      : undefined,
  };
}

function normalizeProviderName(value: unknown): ProviderName | undefined {
  if (value === "codex" || value === "openai") {
    return value;
  }
  return undefined;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isFileMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
