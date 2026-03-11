import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getUserConfigPath,
  loadUserConfig,
  updateUserConfig,
} from "../src/user-config";
import type { AudioBuffer } from "./recordAudio";

const OPENAI_TRANSCRIPTIONS_URL =
  "https://api.openai.com/v1/audio/transcriptions";

export interface TranscriptionBackendStatus {
  available: boolean;
  guidance: string[];
  name: "openai-api" | "whisper.cpp";
  summary: string;
}

export async function transcribe(audio: AudioBuffer): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "compleet-transcribe-"));
  const audioPath = join(tempDir, audio.fileName);
  await writeFile(audioPath, audio.data);

  const failures: string[] = [];

  try {
    try {
      return await transcribeWithWhisperCpp(audioPath, tempDir);
    } catch (error) {
      failures.push(describeFailure("whisper.cpp", error));
    }

    try {
      return await transcribeWithOpenAI(audio);
    } catch (error) {
      failures.push(describeFailure("OpenAI speech API", error));
    }

    throw new Error(failures.join(" | "));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function inspectTranscriptionBackends(): Promise<
  TranscriptionBackendStatus[]
> {
  const [whisperCpp, openAi] = await Promise.all([
    inspectWhisperCpp(),
    inspectOpenAiFallback(),
  ]);

  return [whisperCpp, openAi];
}

export function buildTranscriptionSetupMessage(
  backends: TranscriptionBackendStatus[]
): string {
  const lines = [
    "Voice transcription is not ready yet.",
    "Recommended: whisper.cpp (free, local).",
    "",
    ...backends.flatMap((backend) => [
      `${backend.name}: ${backend.available ? "ready" : backend.summary}`,
      ...backend.guidance.map((line) => `  ${line}`),
      "",
    ]),
  ];

  return lines.join("\n").trim();
}

export function hasAvailableTranscriptionBackend(
  backends: TranscriptionBackendStatus[]
): boolean {
  return backends.some((backend) => backend.available);
}

export async function saveOpenAIFallbackApiKey(
  apiKey: string
): Promise<string> {
  return await updateUserConfig({
    openaiApiKey: apiKey,
  });
}

export async function saveWhisperCppModelPath(
  modelPath: string
): Promise<string> {
  return await updateUserConfig({
    voice: {
      whisperCppModelPath: modelPath,
    },
  });
}

async function inspectWhisperCpp(): Promise<TranscriptionBackendStatus> {
  const config = await loadUserConfig();
  const binary =
    process.env.TC_WHISPER_CPP_BIN?.trim() ||
    process.env.WHISPER_CPP_BIN?.trim() ||
    config.voice?.whisperCppBin?.trim() ||
    Bun.which("whisper-cli");
  const modelPath =
    process.env.TC_WHISPER_CPP_MODEL?.trim() ||
    process.env.WHISPER_CPP_MODEL?.trim() ||
    config.voice?.whisperCppModelPath?.trim();

  if (binary && modelPath) {
    return {
      available: true,
      guidance: [],
      name: "whisper.cpp",
      summary: "Local whisper.cpp transcription is configured.",
    };
  }

  const guidance =
    process.platform === "darwin"
      ? [
          'Wizard: choose "Set up whisper.cpp locally".',
          "Manual: brew install whisper-cpp",
        ]
      : [
          `Manual: install whisper.cpp, then set voice.whisperCppBin and voice.whisperCppModelPath in ${getUserConfigPath()}.`,
        ];

  return {
    available: false,
    guidance,
    name: "whisper.cpp",
    summary: binary
      ? "Installed, but no model is configured."
      : "Not installed.",
  };
}

async function inspectOpenAiFallback(): Promise<TranscriptionBackendStatus> {
  const resolved = await resolveOpenAIApiKey();
  if (resolved.apiKey) {
    return {
      available: true,
      guidance: [],
      name: "openai-api",
      summary: "Configured.",
    };
  }

  return {
    available: false,
    guidance: ['Optional paid fallback: run "tc config openai".'],
    name: "openai-api",
    summary: "Not configured.",
  };
}

async function transcribeWithWhisperCpp(
  audioPath: string,
  tempDir: string
): Promise<string> {
  const config = await loadUserConfig();
  const binary =
    process.env.TC_WHISPER_CPP_BIN?.trim() ||
    process.env.WHISPER_CPP_BIN?.trim() ||
    config.voice?.whisperCppBin?.trim() ||
    Bun.which("whisper-cli");
  if (!binary) {
    throw new Error(
      `whisper.cpp binary not found. Install whisper-cli or set voice.whisperCppBin in ${getUserConfigPath()}.`
    );
  }

  const modelPath =
    process.env.TC_WHISPER_CPP_MODEL?.trim() ||
    process.env.WHISPER_CPP_MODEL?.trim() ||
    config.voice?.whisperCppModelPath?.trim();
  if (!modelPath) {
    throw new Error(
      `whisper.cpp model path is not configured. Run the voice setup wizard or set voice.whisperCppModelPath in ${getUserConfigPath()}.`
    );
  }

  const outputBase = join(tempDir, "whisper-output");
  await runCommand(binary, [
    "-m",
    modelPath,
    "-f",
    audioPath,
    "-of",
    outputBase,
    "-otxt",
    "-np",
  ]);

  const transcript = await readFile(`${outputBase}.txt`, "utf8");
  return normalizeTranscript(transcript);
}

async function transcribeWithOpenAI(audio: AudioBuffer): Promise<string> {
  const resolved = await resolveOpenAIApiKey();
  if (!resolved.apiKey) {
    throw new Error(
      'OpenAI API key is missing. Configure one with "tc config openai".'
    );
  }

  const config = await loadUserConfig();
  const openAiTranscribeModel =
    process.env.TC_OPENAI_TRANSCRIBE_MODEL?.trim() ||
    config.voice?.openAiTranscribeModel?.trim() ||
    "gpt-4o-mini-transcribe";
  const form = new FormData();
  const fileBytes = Uint8Array.from(audio.data);
  form.set(
    "file",
    new File([fileBytes], audio.fileName, { type: audio.mimeType })
  );
  form.set("model", openAiTranscribeModel);
  form.set("response_format", "text");

  const prompt =
    process.env.TC_TRANSCRIBE_PROMPT?.trim() ||
    config.voice?.transcribePrompt?.trim();
  if (prompt) {
    form.set("prompt", prompt);
  }

  const response = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resolved.apiKey}`,
    },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `OpenAI transcription failed (${response.status}): ${text}`
    );
  }

  return normalizeTranscript(text);
}

async function resolveOpenAIApiKey(): Promise<{
  apiKey: string;
  source: "config" | "env" | "none";
}> {
  const envKey = process.env.OPENAI_API_KEY?.trim();
  if (envKey) {
    return { apiKey: envKey, source: "env" };
  }

  const config = await loadUserConfig();
  const configKey = config.openaiApiKey?.trim() ?? "";
  if (configKey) {
    return { apiKey: configKey, source: "config" };
  }

  return { apiKey: "", source: "none" };
}

function normalizeTranscript(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function describeFailure(label: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${label}: ${message}`;
}

async function runCommand(
  command: string,
  args: string[]
): Promise<{ stderr: string; stdout: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          `Command failed (${code ?? "unknown"}): ${command} ${args.join(" ")}\n${stderr.trim()}`
        )
      );
    });
  });
}
