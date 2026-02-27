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
    const parsed = expectSuggest(parseArgs(["hey", "this", "is", "a", "prompt"]));
    expect(parsed.prompt).toBe("hey this is a prompt");
  });

  test("supports explain flag before prompt", () => {
    const parsed = expectSuggest(parseArgs(["-e", "find", "big", "files"]));
    expect(parsed.explain).toBe(true);
    expect(parsed.prompt).toBe("find big files");
  });

  test("supports explain flag after prompt", () => {
    const parsed = expectSuggest(parseArgs(["find", "big", "files", "--explain"]));
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

  test("parses control commands only when first token matches", () => {
    const initParsed = parseArgs(["init"]);
    expect(initParsed.mode).toBe("init");

    const promptParsed = expectSuggest(parseArgs(["hey", "init"]));
    expect(promptParsed.prompt).toBe("hey init");
  });

  test("returns config wizard when no config args are provided", () => {
    const parsed = parseArgs(["config"]);
    expect(parsed.mode).toBe("config");
    if (parsed.mode === "config") {
      expect(parsed.action).toBe("wizard");
    }
  });

  test("returns interactive auth mode by default", () => {
    const parsed = parseArgs(["auth"]);
    expect(parsed.mode).toBe("auth");
    if (parsed.mode === "auth") {
      expect(parsed.interactive).toBe(true);
    }
  });

  test("throws on unknown options", () => {
    expect(() => parseArgs(["--does-not-exist", "hello"])).toThrow(ArgParseError);
  });
});

describe("helpText", () => {
  test("uses tcomp branding and no cli.js references", () => {
    const help = helpText();
    expect(help).toContain("tcomp - AI terminal command helper");
    expect(help).not.toContain("cli.js");
  });
});
