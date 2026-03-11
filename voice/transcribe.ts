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
  name: "faster-whisper" | "openai-api" | "whisper.cpp";
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
      return await transcribeWithFasterWhisper(audioPath, tempDir);
    } catch (error) {
      failures.push(describeFailure("faster-whisper", error));
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
  const [whisperCpp, fasterWhisper, openAi] = await Promise.all([
    inspectWhisperCpp(),
    inspectFasterWhisper(),
    inspectOpenAiFallback(),
  ]);

  return [whisperCpp, fasterWhisper, openAi];
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
          'Wizard: choose "Set up whisper.cpp locally", or install whisper.cpp manually.',
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

async function inspectFasterWhisper(): Promise<TranscriptionBackendStatus> {
  const config = await loadUserConfig();
  const python =
    process.env.TC_PYTHON_BIN?.trim() ||
    process.env.PYTHON_BIN?.trim() ||
    config.voice?.pythonBin?.trim() ||
    Bun.which("python3");
  if (!python) {
    return {
      available: false,
      guidance: [
        "Install python3, then run: python3 -m pip install --user faster-whisper",
      ],
      name: "faster-whisper",
      summary: "python3 is not available.",
    };
  }

  const { stdout } = await runCommand(python, [
    "-c",
    "import importlib.util; print('1' if importlib.util.find_spec('faster_whisper') else '0')",
  ]);
  if (stdout.trim() === "1") {
    return {
      available: true,
      guidance: [],
      name: "faster-whisper",
      summary: "Local faster-whisper transcription is configured.",
    };
  }

  return {
    available: false,
    guidance: [
      "Optional local fallback: python3 -m pip install --user faster-whisper",
    ],
    name: "faster-whisper",
    summary: "Not installed.",
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

async function transcribeWithFasterWhisper(
  audioPath: string,
  tempDir: string
): Promise<string> {
  const config = await loadUserConfig();
  const python =
    process.env.TC_PYTHON_BIN?.trim() ||
    process.env.PYTHON_BIN?.trim() ||
    config.voice?.pythonBin?.trim() ||
    Bun.which("python3");
  if (!python) {
    throw new Error("python3 is not available for faster-whisper.");
  }

  const scriptPath = join(tempDir, "faster-whisper.py");
  const language =
    process.env.TC_TRANSCRIBE_LANGUAGE?.trim() ||
    config.voice?.transcribeLanguage?.trim();
  const fasterWhisperModel =
    process.env.TC_FASTER_WHISPER_MODEL?.trim() ||
    config.voice?.fasterWhisperModel?.trim() ||
    "base.en";
  const script = [
    "import json",
    "from faster_whisper import WhisperModel",
    "import sys",
    "",
    "audio_path = sys.argv[1]",
    "model_name = sys.argv[2]",
    "language = sys.argv[3] or None",
    "model = WhisperModel(model_name, device='cpu')",
    "segments, _ = model.transcribe(audio_path, vad_filter=True, language=language, beam_size=1)",
    "text = ' '.join(segment.text.strip() for segment in segments if segment.text).strip()",
    "print(json.dumps({'text': text}))",
  ].join("\n");

  await writeFile(scriptPath, script, "utf8");
  const { stdout } = await runCommand(python, [
    scriptPath,
    audioPath,
    fasterWhisperModel,
    language ?? inferLanguageFromModel(fasterWhisperModel),
  ]);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    throw new Error("faster-whisper returned invalid JSON.");
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { text?: unknown }).text !== "string"
  ) {
    throw new Error("faster-whisper did not return transcript text.");
  }

  return normalizeTranscript((parsed as { text: string }).text);
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

function inferLanguageFromModel(modelName: string): string {
  return modelName.endsWith(".en") ? "en" : "";
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
