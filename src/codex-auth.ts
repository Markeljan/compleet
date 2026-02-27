import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

interface RawCodexAuthFile {
  auth_mode?: unknown;
  tokens?: {
    access_token?: unknown;
    refresh_token?: unknown;
    account_id?: unknown;
  } | null;
}

export interface CodexChatGPTAuth {
  accessToken: string;
  accountId?: string;
}

export function getCodexHome(): string {
  return process.env.CODEX_HOME ?? join(homedir(), ".codex");
}

export function getCodexAuthPath(): string {
  return join(getCodexHome(), "auth.json");
}

export async function loadCodexChatGPTAuth(): Promise<CodexChatGPTAuth> {
  const authPath = getCodexAuthPath();

  let raw: string;
  try {
    raw = await readFile(authPath, "utf8");
  } catch (error) {
    if (isFileMissing(error)) {
      throw new Error(
        `Codex auth not found at ${authPath}. Run "tcomp config codex" or "tcomp setup" first.`,
      );
    }
    throw error;
  }

  let parsed: RawCodexAuthFile;
  try {
    parsed = JSON.parse(raw) as RawCodexAuthFile;
  } catch {
    throw new Error(`Codex auth file is not valid JSON: ${authPath}`);
  }

  if (parsed.auth_mode !== "chatgpt") {
    throw new Error(
      `Codex auth mode is not ChatGPT (found: ${String(parsed.auth_mode)}). Run "codex login" with ChatGPT auth.`,
    );
  }

  const accessToken = typeof parsed.tokens?.access_token === "string" ? parsed.tokens.access_token : "";
  const accountId = typeof parsed.tokens?.account_id === "string" ? parsed.tokens.account_id : undefined;

  if (!accessToken) {
    throw new Error(
      `Codex auth file does not contain a ChatGPT access token. Run "tcomp config codex" or "tcomp setup".`,
    );
  }

  return { accessToken, accountId };
}

export async function ensureCodexChatGPTAuth(interactive: boolean): Promise<CodexChatGPTAuth> {
  try {
    return await loadCodexChatGPTAuth();
  } catch (error) {
    if (!interactive) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    console.error('Starting Codex ChatGPT login flow via "codex login"...');
    const code = await runCodexCliAuthAction("login");
    if (code !== 0) {
      throw new Error(`codex login failed with exit code ${code}`);
    }
    return loadCodexChatGPTAuth();
  }
}

export async function runCodexCliAuthAction(action: "login" | "status" | "logout"): Promise<number> {
  const args =
    action === "login"
      ? ["login"]
      : action === "status"
        ? ["login", "status"]
        : ["logout"];

  return await new Promise<number>((resolve, reject) => {
    const child = spawn("codex", args, {
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error('Could not find "codex" in PATH. Install Codex CLI first.'));
        return;
      }
      reject(error);
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`codex ${args.join(" ")} terminated by signal ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

function isFileMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}
