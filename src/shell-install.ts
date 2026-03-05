import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { renderShellIntegration, type SupportedShell } from "./shell";

interface InstallResult {
  path: string;
  updated: boolean;
}

export async function installShellIntegration(shell: SupportedShell): Promise<InstallResult> {
  const rcPath = getRcPath(shell);
  const markerStart = "# >>> tcomp integration >>>";
  const markerEnd = "# <<< tcomp integration <<<";
  const integration = renderShellIntegration(shell).trimEnd();
  const block = `${markerStart}\n${integration}\n${markerEnd}`;

  let existing = "";
  try {
    existing = await readFile(rcPath, "utf8");
  } catch (error) {
    if (!isFileMissing(error)) {
      throw error;
    }
  }

  const next = upsertManagedBlock(existing, markerStart, markerEnd, block);
  if (next === existing) {
    return { path: rcPath, updated: false };
  }

  await mkdir(dirname(rcPath), { recursive: true });
  await writeFile(rcPath, normalizeTrailingNewline(next), "utf8");
  return { path: rcPath, updated: true };
}

export async function isShellIntegrationInstalled(shell: SupportedShell): Promise<boolean> {
  const rcPath = getRcPath(shell);
  const markerStart = "# >>> tcomp integration >>>";
  const markerEnd = "# <<< tcomp integration <<<";

  let existing = "";
  try {
    existing = await readFile(rcPath, "utf8");
  } catch (error) {
    if (isFileMissing(error)) {
      return false;
    }
    throw error;
  }

  const startIndex = existing.indexOf(markerStart);
  const endIndex = existing.indexOf(markerEnd);
  return startIndex >= 0 && endIndex > startIndex;
}

function getZshRcPath(): string {
  const home = resolveHomeDir();
  const zdotdir = process.env.ZDOTDIR?.trim();
  if (zdotdir) {
    return join(zdotdir, ".zshrc");
  }
  return join(home, ".zshrc");
}

function getBashRcPath(): string {
  return join(resolveHomeDir(), ".bashrc");
}

function getRcPath(shell: SupportedShell): string {
  switch (shell) {
    case "zsh":
      return getZshRcPath();
    case "bash":
      return getBashRcPath();
  }
}

function upsertManagedBlock(existing: string, start: string, end: string, block: string): string {
  const startIndex = existing.indexOf(start);
  const endIndex = existing.indexOf(end);

  if (startIndex >= 0 && endIndex > startIndex) {
    const replaceEnd = endIndex + end.length;
    return `${existing.slice(0, startIndex)}${block}${existing.slice(replaceEnd)}`;
  }

  const trimmed = existing.trimEnd();
  if (!trimmed) {
    return `${block}\n`;
  }
  return `${trimmed}\n\n${block}\n`;
}

function normalizeTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function isFileMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function resolveHomeDir(): string {
  const envHome = process.env.HOME?.trim() || process.env.USERPROFILE?.trim();
  if (envHome) {
    return envHome;
  }
  return homedir();
}
