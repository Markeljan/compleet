import { describe, expect, test } from "bun:test";
import {
  buildTranscriptionSetupMessage,
  hasAvailableTranscriptionBackend,
  type TranscriptionBackendStatus,
} from "../voice/transcribe";

const unavailableBackends: TranscriptionBackendStatus[] = [
  {
    available: false,
    guidance: ["Install whisper.cpp"],
    name: "whisper.cpp",
    summary: "whisper.cpp is not installed.",
  },
  {
    available: false,
    guidance: ["Install faster-whisper"],
    name: "faster-whisper",
    summary: "The faster_whisper Python package is not installed.",
  },
  {
    available: false,
    guidance: ['Optional paid fallback: run "tc config openai".'],
    name: "openai-api",
    summary: "Not configured.",
  },
];

describe("hasAvailableTranscriptionBackend", () => {
  test("returns false when every backend is unavailable", () => {
    expect(hasAvailableTranscriptionBackend(unavailableBackends)).toBe(false);
  });

  test("returns true when at least one backend is available", () => {
    expect(
      hasAvailableTranscriptionBackend([
        ...unavailableBackends,
        {
          available: true,
          guidance: [],
          name: "openai-api",
          summary: "OpenAI speech fallback is configured.",
        },
      ])
    ).toBe(true);
  });
});

describe("buildTranscriptionSetupMessage", () => {
  test("keeps the setup guidance short and whisper-first", () => {
    const message = buildTranscriptionSetupMessage(unavailableBackends);
    expect(message).toContain("Voice transcription is not ready yet.");
    expect(message).toContain("Recommended: whisper.cpp (free, local).");
    expect(message).toContain("Install faster-whisper");
    expect(message).not.toContain("Codex-generated OpenAI API key");
  });
});
