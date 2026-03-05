import { describe, expect, test } from "bun:test";
import { ArgParseError, helpText, parseArgs } from "../src/args";

function expectSuggest(args: ReturnType<typeof parseArgs>) {
  if (args.mode !== "suggest") {
    throw new Error(`Expected suggest mode, got ${args.mode}`);
  }
  return args;
}

describe("parseArgs", () => {
  test("treats unquoted words as a single prompt", () => {
    const parsed = expectSuggest(
      parseArgs(["hey", "this", "is", "a", "prompt"])
    );
    expect(parsed.prompt).toBe("hey this is a prompt");
  });

  test("supports explain flag before prompt", () => {
    const parsed = expectSuggest(parseArgs(["-e", "find", "big", "files"]));
    expect(parsed.explain).toBe(true);
    expect(parsed.prompt).toBe("find big files");
  });

  test("supports explain flag after prompt", () => {
    const parsed = expectSuggest(
      parseArgs(["find", "big", "files", "--explain"])
    );
    expect(parsed.explain).toBe(true);
    expect(parsed.prompt).toBe("find big files");
  });

  test("supports prompt mode short flag", () => {
    const parsed = expectSuggest(parseArgs(["-p", "hey", "how", "are", "you"]));
    expect(parsed.promptMode).toBe(true);
    expect(parsed.prompt).toBe("hey how are you");
  });

  test("supports prompt mode trailing short flag", () => {
    const parsed = expectSuggest(parseArgs(["hey", "how", "are", "you", "-p"]));
    expect(parsed.promptMode).toBe(true);
    expect(parsed.prompt).toBe("hey how are you");
  });

  test("parses setup command with optional provider", () => {
    const parsed = parseArgs(["setup", "codex"]);
    expect(parsed.mode).toBe("setup");
    if (parsed.mode === "setup") {
      expect(parsed.provider).toBe("codex");
    }
  });

  test("parses config command", () => {
    const parsed = parseArgs(["config", "openai"]);
    expect(parsed.mode).toBe("config");
    if (parsed.mode === "config") {
      expect(parsed.provider).toBe("openai");
    }
  });

  test("parses use command", () => {
    const parsed = parseArgs(["use", "codex"]);
    expect(parsed.mode).toBe("use");
    if (parsed.mode === "use") {
      expect(parsed.provider).toBe("codex");
    }
  });

  test("maps legacy setup aliases", () => {
    const parsed = parseArgs(["auth"]);
    expect(parsed.mode).toBe("setup");
    if (parsed.mode === "setup") {
      expect(parsed.legacyAlias).toBe("auth");
    }
  });

  test("rejects removed json flag", () => {
    expect(() => parseArgs(["--json", "hello"])).toThrow(ArgParseError);
  });

  test("shows prompt mode tip for missing prompt", () => {
    expect(() => parseArgs(["-p"])).toThrow("For general prompts");
  });

  test("throws on unknown options", () => {
    expect(() => parseArgs(["--does-not-exist", "hello"])).toThrow(
      ArgParseError
    );
  });
});

describe("helpText", () => {
  test("uses tcomp branding with practical examples", () => {
    const help = helpText();
    expect(help).toContain("tcomp - AI terminal command helper");
    expect(help).toContain("tcomp config [codex|openai]");
    expect(help).toContain("tcomp use <codex|openai>");
    expect(help).toContain("Practical examples:");
    expect(help).not.toContain("--json");
    expect(help).not.toContain("cli.js");
  });
});
