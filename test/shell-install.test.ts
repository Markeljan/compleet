import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installShellIntegration,
  isShellIntegrationInstalled,
} from "../src/shell-install";

describe("installShellIntegration(zsh)", () => {
  const originalZdotdir = process.env.ZDOTDIR;
  let sandboxDir = "";

  beforeEach(async () => {
    sandboxDir = await mkdtemp(join(tmpdir(), "tcomp-zshrc-"));
    process.env.ZDOTDIR = sandboxDir;
  });

  afterEach(async () => {
    if (originalZdotdir === undefined) {
      Reflect.deleteProperty(process.env, "ZDOTDIR");
    } else {
      process.env.ZDOTDIR = originalZdotdir;
    }
    if (sandboxDir) {
      await rm(sandboxDir, { recursive: true, force: true });
    }
  });

  test("writes managed block and is idempotent", async () => {
    const first = await installShellIntegration("zsh");
    expect(first.updated).toBe(true);
    expect(first.path).toBe(join(sandboxDir, ".zshrc"));

    const firstContent = await readFile(first.path, "utf8");
    expect(firstContent).toContain("# >>> tcomp integration >>>");
    expect(firstContent).toContain("# tcomp zsh integration");
    expect(firstContent).toContain("_tcomp_find_bin");
    expect(firstContent).toContain("# <<< tcomp integration <<<");

    const second = await installShellIntegration("zsh");
    expect(second.updated).toBe(false);

    const secondContent = await readFile(second.path, "utf8");
    expect(secondContent).toBe(firstContent);
  });

  test("replaces existing managed block in place", async () => {
    const zshrcPath = join(sandboxDir, ".zshrc");
    await writeFile(
      zshrcPath,
      [
        'export PATH="$HOME/bin:$PATH"',
        "# >>> tcomp integration >>>",
        "echo legacy block",
        "# <<< tcomp integration <<<",
        "",
      ].join("\n"),
      "utf8"
    );

    const result = await installShellIntegration("zsh");
    expect(result.updated).toBe(true);

    const content = await readFile(zshrcPath, "utf8");
    expect(content).toContain('export PATH="$HOME/bin:$PATH"');
    expect(content).toContain("# tcomp zsh integration");

    const startMatches = content.match(/# >>> tcomp integration >>>/g) ?? [];
    const endMatches = content.match(/# <<< tcomp integration <<</g) ?? [];
    expect(startMatches.length).toBe(1);
    expect(endMatches.length).toBe(1);
  });

  test("detects installation markers", async () => {
    expect(await isShellIntegrationInstalled("zsh")).toBe(false);
    await installShellIntegration("zsh");
    expect(await isShellIntegrationInstalled("zsh")).toBe(true);
  });
});

describe("installShellIntegration(bash)", () => {
  const originalHome = process.env.HOME;
  let sandboxDir = "";

  beforeEach(async () => {
    sandboxDir = await mkdtemp(join(tmpdir(), "tcomp-bashrc-"));
    process.env.HOME = sandboxDir;
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      Reflect.deleteProperty(process.env, "HOME");
    } else {
      process.env.HOME = originalHome;
    }
    if (sandboxDir) {
      await rm(sandboxDir, { recursive: true, force: true });
    }
  });

  test("writes managed block and is idempotent", async () => {
    const first = await installShellIntegration("bash");
    expect(first.updated).toBe(true);
    expect(first.path).toBe(join(sandboxDir, ".bashrc"));

    const firstContent = await readFile(first.path, "utf8");
    expect(firstContent).toContain("# >>> tcomp integration >>>");
    expect(firstContent).toContain("# tcomp bash integration");
    expect(firstContent).toContain("_tcomp_find_bin");
    expect(firstContent).toContain("# <<< tcomp integration <<<");

    const second = await installShellIntegration("bash");
    expect(second.updated).toBe(false);

    const secondContent = await readFile(second.path, "utf8");
    expect(secondContent).toBe(firstContent);
  });

  test("replaces existing managed block in place", async () => {
    const bashrcPath = join(sandboxDir, ".bashrc");
    await writeFile(
      bashrcPath,
      [
        'export PATH="$HOME/bin:$PATH"',
        "# >>> tcomp integration >>>",
        "echo legacy block",
        "# <<< tcomp integration <<<",
        "",
      ].join("\n"),
      "utf8"
    );

    const result = await installShellIntegration("bash");
    expect(result.updated).toBe(true);

    const content = await readFile(bashrcPath, "utf8");
    expect(content).toContain('export PATH="$HOME/bin:$PATH"');
    expect(content).toContain("# tcomp bash integration");

    const startMatches = content.match(/# >>> tcomp integration >>>/g) ?? [];
    const endMatches = content.match(/# <<< tcomp integration <<</g) ?? [];
    expect(startMatches.length).toBe(1);
    expect(endMatches.length).toBe(1);
  });

  test("detects installation markers", async () => {
    expect(await isShellIntegrationInstalled("bash")).toBe(false);
    await installShellIntegration("bash");
    expect(await isShellIntegrationInstalled("bash")).toBe(true);
  });
});
