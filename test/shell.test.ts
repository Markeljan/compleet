import { describe, expect, test } from "bun:test";
import { renderShellIntegration } from "../src/shell";

describe("renderShellIntegration(zsh)", () => {
  test("includes command passthrough for setup/config/use/help/version", () => {
    const script = renderShellIntegration("zsh");
    expect(script).toContain("setup|config|use|auth|init|help|version|suggest|-h|--help|-v|--version");
  });

  test("prefills BUFFER without printing generated command", () => {
    const script = renderShellIntegration("zsh");
    expect(script).toContain('_TCOMP_PENDING_BUFFER="$_tcomp_cmd"');
    expect(script).not.toContain("--json");
    expect(script).not.toContain("printf '%s\\n' \"$_tcomp_cmd\"");
  });

  test("registers completion for tcomp and terminal-complete", () => {
    const script = renderShellIntegration("zsh");
    expect(script).toContain("compdef _tcomp_complete tcomp terminal-complete");
    expect(script).toContain("setup:run interactive onboarding");
    expect(script).toContain("config:show current config or rerun provider setup");
    expect(script).toContain("use:set active provider");
  });
});
