import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCodexAuthPath, loadCodexChatGPTAuth } from "../src/codex-auth";
import {
  getUserConfigPath,
  loadUserConfig,
  saveUserConfig,
} from "../src/user-config";

describe("user config and codex auth paths", () => {
  const originalXdg = process.env.XDG_CONFIG_HOME;
  const originalCodexHome = process.env.CODEX_HOME;
  let sandboxDir = "";

  beforeEach(async () => {
    sandboxDir = await mkdtemp(join(tmpdir(), "tcomp-config-"));
    process.env.XDG_CONFIG_HOME = join(sandboxDir, "xdg");
    process.env.CODEX_HOME = join(sandboxDir, "codex-home");
  });

  afterEach(async () => {
    if (originalXdg === undefined) {
      Reflect.deleteProperty(process.env, "XDG_CONFIG_HOME");
    } else {
      process.env.XDG_CONFIG_HOME = originalXdg;
    }
    if (originalCodexHome === undefined) {
      Reflect.deleteProperty(process.env, "CODEX_HOME");
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
    if (sandboxDir) {
      await rm(sandboxDir, { recursive: true, force: true });
    }
  });

  test("saveUserConfig and loadUserConfig round-trip", async () => {
    const savedPath = await saveUserConfig({
      activeProvider: "codex",
    });

    expect(savedPath).toBe(getUserConfigPath());
    expect(savedPath).toContain(
      join("xdg", "terminal-complete", "config.json")
    );

    const loaded = await loadUserConfig();
    expect(loaded.activeProvider).toBe("codex");
    expect(loaded.openaiApiKey).toBeUndefined();
  });

  test("loadUserConfig migrates legacy openai fields", async () => {
    const configPath = getUserConfigPath();
    await mkdir(join(sandboxDir, "xdg", "terminal-complete"), {
      recursive: true,
    });
    await writeFile(
      configPath,
      JSON.stringify(
        {
          provider: "openai",
          apiKey: "legacy-key",
        },
        null,
        2
      ),
      "utf8"
    );

    const loaded = await loadUserConfig();
    expect(loaded.activeProvider).toBe("openai");
    expect(loaded.openaiApiKey).toBe("legacy-key");
  });

  test("loadUserConfig migrates authMethod field", async () => {
    const configPath = getUserConfigPath();
    await mkdir(join(sandboxDir, "xdg", "terminal-complete"), {
      recursive: true,
    });
    await writeFile(
      configPath,
      JSON.stringify(
        {
          authMethod: "codex-oauth",
        },
        null,
        2
      ),
      "utf8"
    );

    const loaded = await loadUserConfig();
    expect(loaded.activeProvider).toBe("codex");
  });

  test("loadUserConfig infers provider when only openaiApiKey is set", async () => {
    const configPath = getUserConfigPath();
    await mkdir(join(sandboxDir, "xdg", "terminal-complete"), {
      recursive: true,
    });
    await writeFile(
      configPath,
      JSON.stringify(
        {
          openaiApiKey: "key-only",
        },
        null,
        2
      ),
      "utf8"
    );

    const loaded = await loadUserConfig();
    expect(loaded.activeProvider).toBe("openai");
    expect(loaded.openaiApiKey).toBe("key-only");
  });

  test("loadUserConfig returns empty object when config file is missing", async () => {
    const loaded = await loadUserConfig();
    expect(loaded).toEqual({});
  });

  test("loadCodexChatGPTAuth reads CODEX_HOME/auth.json", async () => {
    const authPath = getCodexAuthPath();
    await mkdir(join(sandboxDir, "codex-home"), { recursive: true });
    await writeFile(
      authPath,
      JSON.stringify(
        {
          auth_mode: "chatgpt",
          tokens: {
            access_token: "token-123",
            account_id: "acct-abc",
          },
        },
        null,
        2
      ),
      "utf8"
    );

    const auth = await loadCodexChatGPTAuth();
    expect(auth.accessToken).toBe("token-123");
    expect(auth.accountId).toBe("acct-abc");
  });

  test("loadCodexChatGPTAuth rejects invalid auth mode", async () => {
    const authPath = getCodexAuthPath();
    await mkdir(join(sandboxDir, "codex-home"), { recursive: true });
    await writeFile(
      authPath,
      JSON.stringify(
        {
          auth_mode: "api_key",
          tokens: {
            access_token: "token-123",
          },
        },
        null,
        2
      ),
      "utf8"
    );

    await expect(loadCodexChatGPTAuth()).rejects.toThrow(
      "Codex auth mode is not ChatGPT"
    );
  });
});
