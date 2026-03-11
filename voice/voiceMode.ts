import { optimizePrompt } from "../src/prompt-optimizer";
import type { RuntimeContext } from "../src/types";
import { type AudioBuffer, recordAudio } from "./recordAudio";
import { ensureVoiceModeReady } from "./setup";
import { transcribe } from "./transcribe";

const RECORDING_SPINNER_FRAMES = ["-", "\\", "|", "/"];
const RECORDING_SPINNER_INTERVAL_MS = 120;
const noop = () => {
  // Intentionally empty.
};

interface RecordingIndicator {
  stop: () => void;
}

export async function runVoiceMode(context: RuntimeContext): Promise<void> {
  await ensureVoiceModeReady(printStatus);

  const audio = await captureVoiceNote();

  printStatus("Transcribing...");
  const speech = await transcribe(audio);
  if (!speech) {
    throw new Error(
      "No speech was detected. Try speaking closer to the microphone."
    );
  }

  if (isDebugRawEnabled()) {
    printStatus(`Speech recognized: "${speech}"`);
  }

  printStatus("Compiling...");
  const prompt = await optimizePrompt(speech, context);
  process.stdout.write(`${prompt}\n`);
}

async function captureVoiceNote(): Promise<AudioBuffer> {
  const indicator = startRecordingIndicator();
  try {
    return await recordAudio();
  } finally {
    indicator.stop();
  }
}

function startRecordingIndicator(): RecordingIndicator {
  const showStopHint = Boolean(process.stdin.isTTY);
  if (!process.stderr.isTTY) {
    printStatus(
      showStopHint ? "Listening... Press Enter to stop." : "Listening..."
    );
    return {
      stop: noop,
    };
  }

  let frameIndex = 0;
  let widestLine = 0;
  const startAt = Date.now();

  const render = () => {
    const elapsedSeconds = ((Date.now() - startAt) / 1000).toFixed(1);
    const suffix = showStopHint ? " | Enter to stop" : "";
    const line = `Listening ${RECORDING_SPINNER_FRAMES[frameIndex]} ${elapsedSeconds}s${suffix}`;
    frameIndex = (frameIndex + 1) % RECORDING_SPINNER_FRAMES.length;
    widestLine = Math.max(widestLine, line.length);
    process.stderr.write(`\r${line.padEnd(widestLine)}`);
  };

  render();
  const interval = setInterval(render, RECORDING_SPINNER_INTERVAL_MS);
  interval.unref?.();

  return {
    stop: () => {
      clearInterval(interval);
      if (widestLine > 0) {
        process.stderr.write(`\r${" ".repeat(widestLine)}\r`);
      }
    },
  };
}

function isDebugRawEnabled(): boolean {
  return process.env.TC_DEBUG_RAW?.trim() === "1";
}

function printStatus(message: string): void {
  process.stderr.write(`${message}\n`);
}
