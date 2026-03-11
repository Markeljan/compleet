import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  askLine,
  canPromptInteractively,
  selectWithArrows,
} from "../src/interactive";
import { getUserConfigDir, loadUserConfig } from "../src/user-config";
import {
  inspectRecordingSupport,
  type RecordingSupportStatus,
} from "./recordAudio";
import {
  buildTranscriptionSetupMessage,
  hasAvailableTranscriptionBackend,
  inspectTranscriptionBackends,
  saveOpenAIFallbackApiKey,
  saveWhisperCppModelPath,
  type TranscriptionBackendStatus,
} from "./transcribe";

const DEFAULT_WHISPER_CPP_MODEL_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";

type VoiceSetupAction =
  | "cancel"
  | "enter-openai-key"
  | "install-faster-whisper"
  | "install-ffmpeg"
  | "manual-summary"
  | "setup-whisper-cpp";

interface VoiceSetupState {
  recording: RecordingSupportStatus;
  transcriptionBackends: TranscriptionBackendStatus[];
}

interface VoiceSetupCapabilities {
  canAutoInstallFasterWhisper: boolean;
  canAutoInstallFfmpeg: boolean;
  canAutoInstallWhisperCpp: boolean;
}

interface VoiceSetupOption {
  action: VoiceSetupAction;
  label: string;
}

export async function ensureVoiceModeReady(
  log: (message: string) => void
): Promise<void> {
  while (true) {
    const state = await inspectVoiceSetupState();
    if (
      state.recording.available &&
      hasAvailableTranscriptionBackend(state.transcriptionBackends)
    ) {
      return;
    }

    const summary = buildVoiceSetupSummary(state);
    if (!canPromptInteractively()) {
      throw new Error(summary);
    }

    log(summary);
    const capabilities = await detectVoiceSetupCapabilities();
    const options = buildVoiceSetupOptions(state, capabilities);
    const selectedAction = await selectWithArrows(
      "Voice setup wizard:",
      options.map((option) => ({
        label: option.label,
        value: option.action,
      })),
      0
    );

    if (selectedAction === "cancel") {
      throw new Error("Voice setup cancelled.");
    }

    if (selectedAction === "manual-summary") {
      continue;
    }

    try {
      await runVoiceSetupAction(selectedAction, log);
    } catch (error) {
      log(error instanceof Error ? error.message : String(error));
    }
  }
}

export async function isVoiceModeReady(): Promise<boolean> {
  const state = await inspectVoiceSetupState();
  return (
    state.recording.available &&
    hasAvailableTranscriptionBackend(state.transcriptionBackends)
  );
}

export function buildVoiceSetupOptionLabels(
  state: VoiceSetupState,
  capabilities: VoiceSetupCapabilities
): string[] {
  return buildVoiceSetupOptions(state, capabilities).map(
    (option) => option.label
  );
}

function buildVoiceSetupOptions(
  state: VoiceSetupState,
  capabilities: VoiceSetupCapabilities
): VoiceSetupOption[] {
  const options: VoiceSetupOption[] = [];
  const hasTranscriptionBackend = hasAvailableTranscriptionBackend(
    state.transcriptionBackends
  );

  if (!state.recording.available && capabilities.canAutoInstallFfmpeg) {
    options.push({
      action: "install-ffmpeg",
      label: "Install ffmpeg now (Recommended)",
    });
  }

  if (!hasTranscriptionBackend) {
    if (capabilities.canAutoInstallWhisperCpp) {
      options.push({
        action: "setup-whisper-cpp",
        label: "Set up whisper.cpp locally (Recommended)",
      });
    }

    if (capabilities.canAutoInstallFasterWhisper) {
      options.push({
        action: "install-faster-whisper",
        label: "Install faster-whisper locally",
      });
    }

    options.push({
      action: "enter-openai-key",
      label: "Use an OpenAI API key fallback",
    });
  }

  options.push({
    action: "manual-summary",
    label: "Show setup details again",
  });
  options.push({
    action: "cancel",
    label: "Cancel",
  });

  return options;
}

function buildVoiceSetupSummary(state: VoiceSetupState): string {
  const lines = [
    "Voice mode needs a quick setup.",
    "",
    `Recording: ${state.recording.available ? "ready" : state.recording.summary}`,
    ...state.recording.guidance.map((line) => `  ${line}`),
    "",
    buildTranscriptionSetupMessage(state.transcriptionBackends),
  ];

  return lines.join("\n").trim();
}

async function inspectVoiceSetupState(): Promise<VoiceSetupState> {
  const [recording, transcriptionBackends] = await Promise.all([
    inspectRecordingSupport(),
    inspectTranscriptionBackends(),
  ]);

  return {
    recording,
    transcriptionBackends,
  };
}

async function detectVoiceSetupCapabilities(): Promise<VoiceSetupCapabilities> {
  const config = await loadUserConfig();
  const python =
    process.env.TC_PYTHON_BIN?.trim() ||
    process.env.PYTHON_BIN?.trim() ||
    config.voice?.pythonBin?.trim() ||
    Bun.which("python3");
  const brew = Bun.which("brew");

  return {
    canAutoInstallFasterWhisper: Boolean(python),
    canAutoInstallFfmpeg: process.platform === "darwin" && Boolean(brew),
    canAutoInstallWhisperCpp: process.platform === "darwin" && Boolean(brew),
  };
}

async function runVoiceSetupAction(
  action: VoiceSetupAction,
  log: (message: string) => void
): Promise<void> {
  switch (action) {
    case "install-ffmpeg":
      await installFfmpeg(log);
      return;
    case "install-faster-whisper":
      await installFasterWhisper(log);
      return;
    case "setup-whisper-cpp":
      await setupWhisperCpp(log);
      return;
    case "enter-openai-key":
      await promptForOpenAIApiKey(log);
      return;
    case "manual-summary":
    case "cancel":
      return;
    default:
      return exhaustiveAction(action);
  }
}

async function installFfmpeg(log: (message: string) => void): Promise<void> {
  log("Installing ffmpeg with Homebrew...");
  await runCommandWithInheritedOutput("brew", ["install", "ffmpeg"]);
}

async function installFasterWhisper(
  log: (message: string) => void
): Promise<void> {
  const config = await loadUserConfig();
  const python =
    process.env.TC_PYTHON_BIN?.trim() ||
    process.env.PYTHON_BIN?.trim() ||
    config.voice?.pythonBin?.trim() ||
    Bun.which("python3");
  if (!python) {
    throw new Error("python3 is not available for faster-whisper install.");
  }

  log("Installing faster-whisper...");
  await runCommandWithInheritedOutput(python, [
    "-m",
    "pip",
    "install",
    "--user",
    "faster-whisper",
  ]);
}

async function setupWhisperCpp(log: (message: string) => void): Promise<void> {
  log("Installing whisper.cpp with Homebrew...");
  await runCommandWithInheritedOutput("brew", ["install", "whisper-cpp"]);

  const modelPath = join(
    getUserConfigDir(),
    "voice",
    "models",
    "ggml-base.en.bin"
  );
  await mkdir(join(getUserConfigDir(), "voice", "models"), {
    recursive: true,
  });

  log("Downloading the default whisper.cpp model...");
  const response = await fetch(DEFAULT_WHISPER_CPP_MODEL_URL, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to download whisper.cpp model (${response.status}).`
    );
  }

  await Bun.write(modelPath, Buffer.from(await response.arrayBuffer()));
  const path = await saveWhisperCppModelPath(modelPath);
  log(`Saved whisper.cpp model path in ${path}`);
}

async function promptForOpenAIApiKey(
  log: (message: string) => void
): Promise<void> {
  const apiKey = (
    await askLine("Enter OpenAI API key (input visible): ")
  ).trim();
  if (!apiKey) {
    throw new Error("No OpenAI API key was provided.");
  }

  const path = await saveOpenAIFallbackApiKey(apiKey);
  log(`Saved OpenAI speech fallback key in ${path}`);
}

async function runCommandWithInheritedOutput(
  command: string,
  args: string[]
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal) {
        reject(
          new Error(`${command} ${args.join(" ")} terminated by ${signal}`)
        );
        return;
      }

      if (code !== 0) {
        reject(
          new Error(
            `${command} ${args.join(" ")} failed with exit code ${code}`
          )
        );
        return;
      }

      resolve();
    });
  });
}

function exhaustiveAction(value: never): never {
  throw new Error(`Unsupported voice setup action: ${value}`);
}
