import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installShellIntegration } from "../src/shell-install";

describe("installShellIntegration", () => {
  const originalZdotdir = process.env.ZDOTDIR;
  let sandboxDir = "";

  beforeEach(async () => {
    sandboxDir = await mkdtemp(join(tmpdir(), "tcomp-zshrc-"));
    process.env.ZDOTDIR = sandboxDir;
  });

  afterEach(async () => {
    if (originalZdotdir === undefined) {
      delete process.env.ZDOTDIR;
    } else {
      process.env.ZDOTDIR = originalZdotdir;
    }
    if (sandboxDir) {
      await rm(sandboxDir, { recursive: true, force: true });
    }
  });

  test("writes managed block and is idempotent", async () => {
    const first = await installShellIntegration("zsh", "tcomp");
    expect(first.updated).toBe(true);
    expect(first.path).toBe(join(sandboxDir, ".zshrc"));

    const firstContent = await readFile(first.path, "utf8");
    expect(firstContent).toContain("# >>> tcomp integration >>>");
    expect(firstContent).toContain('eval "$(tcomp init)"');
    expect(firstContent).toContain("# <<< tcomp integration <<<");

    const second = await installShellIntegration("zsh", "tcomp");
    expect(second.updated).toBe(false);

    const secondContent = await readFile(second.path, "utf8");
    expect(secondContent).toBe(firstContent);
  });

  test("replaces existing managed block in place", async () => {
    const zshrcPath = join(sandboxDir, ".zshrc");
    await writeFile(
      zshrcPath,
      [
        "export PATH=\"$HOME/bin:$PATH\"",
        "# >>> tcomp integration >>>",
        "eval \"$(old-command init)\"",
        "# <<< tcomp integration <<<",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await installShellIntegration("zsh", "tcomp");
    expect(result.updated).toBe(true);

    const content = await readFile(zshrcPath, "utf8");
    expect(content).toContain("export PATH=\"$HOME/bin:$PATH\"");
    expect(content).toContain('eval "$(tcomp init)"');

    const startMatches = content.match(/# >>> tcomp integration >>>/g) ?? [];
    const endMatches = content.match(/# <<< tcomp integration <<</g) ?? [];
    expect(startMatches.length).toBe(1);
    expect(endMatches.length).toBe(1);
  });
});
