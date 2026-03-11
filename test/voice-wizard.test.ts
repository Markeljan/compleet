import { describe, expect, test } from "bun:test";
import { buildVoiceSetupOptionLabels } from "../voice/setup";

describe("buildVoiceSetupOptionLabels", () => {
  test("orders whisper.cpp as the main transcription option", () => {
    const labels = buildVoiceSetupOptionLabels(
      {
        recording: {
          available: false,
          guidance: ["Install ffmpeg"],
          summary: "ffmpeg is missing.",
        },
        transcriptionBackends: [
          {
            available: false,
            guidance: ["Set up whisper.cpp"],
            name: "whisper.cpp",
            summary: "Not installed.",
          },
          {
            available: false,
            guidance: ["tc config openai"],
            name: "openai-api",
            summary: "Not configured.",
          },
        ],
      },
      {
        canAutoInstallFfmpeg: true,
        canAutoInstallWhisperCpp: true,
      }
    );

    expect(labels[0]).toBe("Install ffmpeg now (Recommended)");
    expect(labels[1]).toBe("Set up whisper.cpp locally (Recommended)");
    expect(labels[2]).toBe("Use an OpenAI API key fallback");
    expect(labels).toHaveLength(5);
    expect(labels.at(-2)).toBe("Show setup details again");
    expect(labels.at(-1)).toBe("Cancel");
  });
});
