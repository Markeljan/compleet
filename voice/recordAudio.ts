import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getUserConfigPath, loadUserConfig } from "../src/user-config";

const CTRL_C = "\u0003";
const ENTER_KEY_REGEX = /[\r\n]/;
const LINE_SPLIT_REGEX = /\r?\n/;
const MACOS_DEVICE_REGEX = /\[(\d+)\]\s+(.*)$/;
const NONINTERACTIVE_MAX_RECORDING_SECONDS = 30;

export interface AudioBuffer {
  channels: number;
  data: Buffer;
  fileName: string;
  mimeType: "audio/wav";
  sampleRate: number;
}

export interface RecordingSupportStatus {
  available: boolean;
  guidance: string[];
  summary: string;
}

export async function recordAudio(): Promise<AudioBuffer> {
  const ffmpeg = await resolveFfmpegBinary();
  const tempDir = await mkdtemp(join(tmpdir(), "compleet-voice-"));
  const outputPath = join(tempDir, "recording.wav");
  const inputArgs = await resolveInputArgs(ffmpeg);

  try {
    await captureWithFfmpeg(ffmpeg, inputArgs, outputPath);
    const data = await readFile(outputPath);
    if (data.length === 0) {
      throw new Error("Recorded audio was empty.");
    }

    return {
      channels: 1,
      data,
      fileName: "recording.wav",
      mimeType: "audio/wav",
      sampleRate: 16_000,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function inspectRecordingSupport(): Promise<RecordingSupportStatus> {
  try {
    const ffmpeg = await resolveFfmpegBinary();
    await resolveInputArgs(ffmpeg);
    return {
      available: true,
      guidance: [],
      summary: "ffmpeg and a microphone input are available.",
    };
  } catch (error) {
    const summary = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      guidance: buildRecordingGuidance(summary),
      summary,
    };
  }
}

async function resolveFfmpegBinary(): Promise<string> {
  const config = await loadUserConfig();
  const configured =
    process.env.TC_FFMPEG_BIN?.trim() || config.voice?.ffmpegBin?.trim();
  if (configured) {
    return configured;
  }

  const detected = Bun.which("ffmpeg");
  if (detected) {
    return detected;
  }

  throw new Error(
    `Voice mode requires ffmpeg. Install ffmpeg or set voice.ffmpegBin in ${getUserConfigPath()}.`
  );
}

function buildRecordingGuidance(summary: string): string[] {
  const normalized = summary.toLowerCase();
  const ffmpegMissing =
    normalized.includes("requires ffmpeg") ||
    normalized.includes("voice.ffmpegbin");
  const deviceIssue =
    normalized.includes("audio input device") ||
    normalized.includes("no audio input devices") ||
    normalized.includes("microphone");

  if (process.platform === "darwin") {
    if (ffmpegMissing) {
      return ["Install ffmpeg: brew install ffmpeg"];
    }
    if (deviceIssue) {
      return [
        "Check Terminal microphone permission in macOS System Settings.",
        `If needed, set voice.audioInputDevice in ${getUserConfigPath()}.`,
      ];
    }
    return [
      "Install ffmpeg: brew install ffmpeg",
      `If the wrong microphone is selected, set voice.audioInputDevice in ${getUserConfigPath()}.`,
    ];
  }

  if (process.platform === "linux") {
    if (ffmpegMissing) {
      return [
        "Install ffmpeg with your package manager, for example: sudo apt install ffmpeg",
      ];
    }
    return [
      "Install ffmpeg with your package manager, for example: sudo apt install ffmpeg",
      `If PulseAudio is unavailable, set voice.audioInputDevice in ${getUserConfigPath()}.`,
    ];
  }

  return [
    "Install ffmpeg and configure an audio input device for this platform.",
  ];
}

async function resolveInputArgs(ffmpeg: string): Promise<string[]> {
  if (process.platform === "darwin") {
    const deviceId = await resolveMacOsAudioDeviceId(ffmpeg);
    return ["-f", "avfoundation", "-i", `:${deviceId}`];
  }

  if (process.platform === "linux") {
    const config = await loadUserConfig();
    const deviceName =
      process.env.TC_AUDIO_INPUT_DEVICE?.trim() ||
      config.voice?.audioInputDevice?.trim() ||
      "default";
    return ["-f", "pulse", "-i", deviceName];
  }

  throw new Error(
    `Voice recording is not supported on ${process.platform} yet.`
  );
}

async function resolveMacOsAudioDeviceId(ffmpeg: string): Promise<string> {
  const config = await loadUserConfig();
  const configured =
    process.env.TC_AUDIO_INPUT_DEVICE?.trim() ||
    config.voice?.audioInputDevice?.trim();
  const devices = await listMacOsAudioDevices(ffmpeg);
  if (devices.length === 0) {
    throw new Error("No audio input devices were detected by ffmpeg.");
  }

  if (configured) {
    const byId = devices.find((device) => device.id === configured);
    if (byId) {
      return byId.id;
    }

    const byName = devices.find((device) =>
      device.name.toLowerCase().includes(configured.toLowerCase())
    );
    if (byName) {
      return byName.id;
    }

    throw new Error(
      `Audio input device "${configured}" was not found. Available devices: ${devices
        .map((device) => `${device.id}:${device.name}`)
        .join(", ")}`
    );
  }

  return pickBestMacOsDevice(devices).id;
}

async function listMacOsAudioDevices(
  ffmpeg: string
): Promise<Array<{ id: string; name: string }>> {
  const { stderr } = await runCommand(ffmpeg, [
    "-f",
    "avfoundation",
    "-list_devices",
    "true",
    "-i",
    "",
  ]);

  const devices: Array<{ id: string; name: string }> = [];
  let readingAudioDevices = false;

  for (const line of stderr.split(LINE_SPLIT_REGEX)) {
    if (line.includes("AVFoundation audio devices:")) {
      readingAudioDevices = true;
      continue;
    }

    if (readingAudioDevices && line.includes("Error opening input")) {
      break;
    }

    if (!readingAudioDevices) {
      continue;
    }

    const match = line.match(MACOS_DEVICE_REGEX);
    if (!match) {
      continue;
    }

    devices.push({
      id: match[1],
      name: match[2].trim(),
    });
  }

  return devices;
}

function pickBestMacOsDevice(devices: Array<{ id: string; name: string }>): {
  id: string;
  name: string;
} {
  return (
    devices
      .map((device) => ({
        device,
        score: scoreMacOsDevice(device.name),
      }))
      .sort((left, right) => right.score - left.score)[0]?.device ?? devices[0]
  );
}

function scoreMacOsDevice(name: string): number {
  const normalized = name.toLowerCase();
  let score = 0;

  if (normalized.includes("microphone")) {
    score += 60;
  }
  if (
    normalized.includes("macbook") ||
    normalized.includes("built-in") ||
    normalized.includes("internal")
  ) {
    score += 40;
  }
  if (normalized.includes("iphone")) {
    score -= 10;
  }
  if (
    normalized.includes("webcam") ||
    normalized.includes("capture") ||
    normalized.includes("export")
  ) {
    score -= 25;
  }

  return score;
}

async function captureWithFfmpeg(
  ffmpeg: string,
  inputArgs: string[],
  outputPath: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      ...inputArgs,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
    ];

    if (!process.stdin.isTTY) {
      args.push("-t", String(NONINTERACTIVE_MAX_RECORDING_SECONDS));
    }

    args.push("-y", outputPath);

    const child = spawn(ffmpeg, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let interruptedManually = false;
    let interruptedByUser = false;
    let stderr = "";
    const cleanupManualStop = attachManualStopListener(
      () => {
        if (child.exitCode !== null || interruptedManually) {
          return;
        }
        interruptedManually = true;
        child.kill("SIGINT");
      },
      () => {
        if (child.exitCode !== null || interruptedByUser) {
          return;
        }
        interruptedByUser = true;
        child.kill("SIGINT");
      }
    );

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      cleanupManualStop?.();
      reject(error);
    });
    child.on("close", (code, signal) => {
      cleanupManualStop?.();
      if (interruptedByUser) {
        reject(new Error("Recording cancelled."));
        return;
      }

      const completedNormally = code === 0;
      const interrupted = interruptedManually || signal === "SIGINT";
      if (completedNormally || interrupted) {
        resolve();
        return;
      }

      reject(
        new Error(
          `ffmpeg recording failed (${code ?? signal ?? "unknown"}): ${stderr.trim()}`
        )
      );
    });
  });
}

interface ManualStopInput {
  isPaused: () => boolean;
  isRaw?: boolean;
  isTTY?: boolean;
  off: (eventName: "data", listener: (chunk: string) => void) => void;
  on: (eventName: "data", listener: (chunk: string) => void) => void;
  pause: () => void;
  resume: () => void;
  setEncoding: (encoding: BufferEncoding) => void;
  setRawMode?: (mode: boolean) => void;
}

export function attachManualStopListener(
  onEnter: () => void,
  onCancel: () => void,
  stdin: ManualStopInput = process.stdin
): (() => void) | null {
  if (!stdin.isTTY) {
    return null;
  }

  const canUseRawMode = typeof stdin.setRawMode === "function";
  const wasRaw = canUseRawMode ? stdin.isRaw : false;
  const setRawMode = stdin.setRawMode;

  stdin.setEncoding("utf8");
  if (setRawMode) {
    setRawMode.call(stdin, true);
  }
  stdin.resume();

  const onData = (chunk: string) => {
    if (chunk === CTRL_C) {
      onCancel();
      return;
    }

    if (ENTER_KEY_REGEX.test(chunk)) {
      onEnter();
    }
  };

  stdin.on("data", onData);

  return () => {
    stdin.off("data", onData);
    if (setRawMode) {
      setRawMode.call(stdin, Boolean(wasRaw));
    }
    if (!stdin.isPaused()) {
      stdin.pause();
    }
  };
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

      if (
        args.includes("-list_devices") &&
        stderr.includes("AVFoundation audio devices:")
      ) {
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
