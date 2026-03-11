import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installShellIntegration,
  isShellIntegrationInstalled,
  removeShellIntegration,
} from "../src/shell-install";

describe("installShellIntegration(zsh)", () => {
  const originalHome = process.env.HOME;
  const originalZdotdir = process.env.ZDOTDIR;
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  let sandboxDir = "";
  let xdgDir = "";

  beforeEach(async () => {
    sandboxDir = await mkdtemp(join(tmpdir(), "compleet-zshrc-"));
    xdgDir = join(sandboxDir, "xdg");
    process.env.HOME = sandboxDir;
    process.env.ZDOTDIR = sandboxDir;
    process.env.XDG_CONFIG_HOME = xdgDir;
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      Reflect.deleteProperty(process.env, "HOME");
    } else {
      process.env.HOME = originalHome;
    }

    if (originalZdotdir === undefined) {
      Reflect.deleteProperty(process.env, "ZDOTDIR");
    } else {
      process.env.ZDOTDIR = originalZdotdir;
    }

    if (originalXdgConfigHome === undefined) {
      Reflect.deleteProperty(process.env, "XDG_CONFIG_HOME");
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }

    if (sandboxDir) {
      await rm(sandboxDir, { recursive: true, force: true });
    }
  });

  test("writes a small rc loader and stores a single init script", async () => {
    const first = await installShellIntegration("zsh");
    expect(first.updated).toBe(true);
    expect(first.path).toBe(join(sandboxDir, ".zshrc"));

    const rcContent = await readFile(first.path, "utf8");
    expect(rcContent).toContain("# >>> compleet integration >>>");
    expect(rcContent).toContain(". '");
    expect(rcContent).not.toContain("_tc_find_bin");

    const initPath = join(xdgDir, "compleet", "shell", "zsh", "init.zsh");
    const initContent = await readFile(initPath, "utf8");
    expect(initContent).toContain("# Compleet zsh integration");
    expect(initContent).toContain("_tc_find_bin");
    expect(initContent).not.toContain("compdef _tc tc compleet");

    const second = await installShellIntegration("zsh");
    expect(second.updated).toBe(false);
    expect(await readFile(second.path, "utf8")).toBe(rcContent);
  });

  test("detects installation markers and the init script", async () => {
    expect(await isShellIntegrationInstalled("zsh")).toBe(false);
    await installShellIntegration("zsh");
    expect(await isShellIntegrationInstalled("zsh")).toBe(true);
  });

  test("removes the managed block and generated shell files", async () => {
    const installed = await installShellIntegration("zsh");
    expect(installed.updated).toBe(true);

    const removed = await removeShellIntegration("zsh");
    expect(removed.updated).toBe(true);

    const content = await readFile(removed.path, "utf8");
    expect(content).not.toContain("# >>> compleet integration >>>");
    expect(
      existsSync(join(xdgDir, "compleet", "shell", "zsh", "init.zsh"))
    ).toBe(false);
    expect(
      existsSync(join(xdgDir, "compleet", "shell", "zsh", "completions", "_tc"))
    ).toBe(false);
    expect(await isShellIntegrationInstalled("zsh")).toBe(false);
  });
});

describe("installShellIntegration(bash)", () => {
  const originalHome = process.env.HOME;
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
  let sandboxDir = "";
  let xdgDir = "";

  beforeEach(async () => {
    sandboxDir = await mkdtemp(join(tmpdir(), "compleet-bashrc-"));
    xdgDir = join(sandboxDir, "xdg");
    process.env.HOME = sandboxDir;
    process.env.XDG_CONFIG_HOME = xdgDir;
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      Reflect.deleteProperty(process.env, "HOME");
    } else {
      process.env.HOME = originalHome;
    }

    if (originalXdgConfigHome === undefined) {
      Reflect.deleteProperty(process.env, "XDG_CONFIG_HOME");
    } else {
      process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
    }

    if (sandboxDir) {
      await rm(sandboxDir, { recursive: true, force: true });
    }
  });

  test("writes a small rc loader and stores a single init script", async () => {
    const first = await installShellIntegration("bash");
    expect(first.updated).toBe(true);
    expect(first.path).toBe(join(sandboxDir, ".bashrc"));

    const rcContent = await readFile(first.path, "utf8");
    expect(rcContent).toContain("# >>> compleet integration >>>");
    expect(rcContent).toContain(". '");
    expect(rcContent).not.toContain("_tc_find_bin");

    const initPath = join(xdgDir, "compleet", "shell", "bash", "init.bash");
    const initContent = await readFile(initPath, "utf8");
    expect(initContent).toContain("# Compleet bash integration");
    expect(initContent).toContain("_tc_find_bin");
    expect(initContent).not.toContain("_TC_COMPLETION_FILE=");

    const second = await installShellIntegration("bash");
    expect(second.updated).toBe(false);
    expect(await readFile(second.path, "utf8")).toBe(rcContent);
  });

  test("detects installation markers and the init script", async () => {
    expect(await isShellIntegrationInstalled("bash")).toBe(false);
    await installShellIntegration("bash");
    expect(await isShellIntegrationInstalled("bash")).toBe(true);
  });

  test("removes the managed block and generated shell files", async () => {
    const installed = await installShellIntegration("bash");
    expect(installed.updated).toBe(true);

    const removed = await removeShellIntegration("bash");
    expect(removed.updated).toBe(true);

    const content = await readFile(removed.path, "utf8");
    expect(content).not.toContain("# >>> compleet integration >>>");
    expect(
      existsSync(join(xdgDir, "compleet", "shell", "bash", "init.bash"))
    ).toBe(false);
    expect(
      existsSync(
        join(xdgDir, "compleet", "shell", "bash", "completions", "tc.bash")
      )
    ).toBe(false);
    expect(await isShellIntegrationInstalled("bash")).toBe(false);
  });
});
