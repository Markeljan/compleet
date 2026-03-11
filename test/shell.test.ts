import { describe, expect, test } from "bun:test";
import { renderShellIntegration } from "../src/shell";

describe("renderShellIntegration(zsh)", () => {
  const script = renderShellIntegration("zsh");

  test("keeps shell staging without completion hooks", () => {
    expect(script).toContain("# Compleet zsh integration");
    expect(script).toContain('_tc_path="$(whence -p tc 2>/dev/null || true)"');
    expect(script).toContain('_TC_PENDING_BUFFER="$_tc_cmd"');
    expect(script).toContain('compleet() {\n  tc "$@"\n}');
    expect(script).not.toContain("compdef _tc tc compleet");
    expect(script).not.toContain("_arguments -C");
    expect(script).not.toContain("_TC_COMPLETION_DIR");
  });

  test("prefills BUFFER without printing generated command", () => {
    expect(script).not.toContain("--json");
    expect(script).not.toContain("printf '%s\\n' \"$_tc_cmd\"");
  });
});

describe("renderShellIntegration(bash)", () => {
  const script = renderShellIntegration("bash");

  test("supports editable prompt fallback without completion hooks", () => {
    expect(script).toContain("# Compleet bash integration");
    expect(script).toContain('_tc_path="$(type -P tc 2>/dev/null || true)"');
    expect(script).toContain('read -r -e -i "$_tc_cmd" -p "tc> " _tc_edit');
    expect(script).toContain('history -s "$_tc_cmd"');
    expect(script).toContain('compleet() {\n  tc "$@"\n}');
    expect(script).not.toContain("_TC_COMPLETION_FILE=");
    expect(script).not.toContain("complete -o default -F _tc_complete");
  });
});
