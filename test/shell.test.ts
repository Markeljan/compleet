import { describe, expect, test } from "bun:test";
import { renderShellInit } from "../src/shell";

describe("renderShellInit(zsh)", () => {
  test("includes command passthrough for control commands", () => {
    const script = renderShellInit("zsh");
    expect(script).toContain("init|auth|config|help|version|suggest|-h|--help|-v|--version");
  });

  test("prefills BUFFER without printing generated command", () => {
    const script = renderShellInit("zsh");
    expect(script).toContain('_TCOMP_PENDING_BUFFER="$_tcomp_cmd"');
    expect(script).not.toContain("printf '%s\\n' \"$_tcomp_cmd\"");
  });

  test("registers completion for tcomp and terminal-complete", () => {
    const script = renderShellInit("zsh");
    expect(script).toContain("compdef _tcomp_complete tcomp terminal-complete");
  });
});
