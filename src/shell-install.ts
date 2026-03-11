import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { renderShellIntegration, type SupportedShell } from "./shell";
import { getUserConfigDir } from "./user-config";

const MARKER_START = "# >>> compleet integration >>>";
const MARKER_END = "# <<< compleet integration <<<";

interface InstallResult {
  path: string;
  updated: boolean;
}

export async function installShellIntegration(
  shell: SupportedShell
): Promise<InstallResult> {
  const rcPath = getRcPath(shell);
  const initPath = getShellInitPath(shell);
  const block = renderRcLoaderBlock(initPath);
  const integration = renderShellIntegration(shell).trimEnd();

  let existing = "";
  try {
    existing = await readFile(rcPath, "utf8");
  } catch (error) {
    if (!isFileMissing(error)) {
      throw error;
    }
  }

  const next = upsertManagedBlock(existing, block);
  const rcUpdated = next !== existing;
  const initUpdated = await writeFileIfChanged(initPath, `${integration}\n`);

  if (rcUpdated) {
    await mkdir(dirname(rcPath), { recursive: true });
    await writeFile(rcPath, normalizeTrailingNewline(next), "utf8");
  }

  return {
    path: rcPath,
    updated: rcUpdated || initUpdated,
  };
}

export async function isShellIntegrationInstalled(
  shell: SupportedShell
): Promise<boolean> {
  const rcPath = getRcPath(shell);

  let existing = "";
  try {
    existing = await readFile(rcPath, "utf8");
  } catch (error) {
    if (isFileMissing(error)) {
      return false;
    }
    throw error;
  }

  if (findManagedBlock(existing) === null) {
    return false;
  }

  return await pathExists(getShellInitPath(shell));
}

export async function removeShellIntegration(
  shell: SupportedShell
): Promise<InstallResult> {
  const rcPath = getRcPath(shell);

  let existing = "";
  try {
    existing = await readFile(rcPath, "utf8");
  } catch (error) {
    if (!isFileMissing(error)) {
      throw error;
    }
  }

  let rcUpdated = false;
  const managedBlock = findManagedBlock(existing);
  if (managedBlock) {
    const next = removeManagedBlock(existing, managedBlock);
    await mkdir(dirname(rcPath), { recursive: true });
    await writeFile(rcPath, normalizeTrailingNewline(next), "utf8");
    rcUpdated = true;
  }

  const shellDir = getShellInstallDir(shell);
  const shellDirExists = await pathExists(shellDir);
  if (shellDirExists) {
    await rm(shellDir, { recursive: true, force: true });
  }

  return {
    path: rcPath,
    updated: rcUpdated || shellDirExists,
  };
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
    default:
      return exhaustiveShell(shell);
  }
}

function getShellInstallDir(shell: SupportedShell): string {
  return join(getUserConfigDir(), "shell", shell);
}

function getShellInitPath(shell: SupportedShell): string {
  switch (shell) {
    case "zsh":
      return join(getShellInstallDir(shell), "init.zsh");
    case "bash":
      return join(getShellInstallDir(shell), "init.bash");
    default:
      return exhaustiveShell(shell);
  }
}

function renderRcLoaderBlock(initPath: string): string {
  const quotedPath = shellQuote(initPath);
  return `${MARKER_START}\n[ -r ${quotedPath} ] && . ${quotedPath}\n${MARKER_END}`;
}

function upsertManagedBlock(existing: string, block: string): string {
  const managedBlock = findManagedBlock(existing);
  if (managedBlock) {
    return `${existing.slice(0, managedBlock.startIndex)}${block}${existing.slice(
      managedBlock.replaceEnd
    )}`;
  }

  const trimmed = existing.trimEnd();
  if (!trimmed) {
    return `${block}\n`;
  }
  return `${trimmed}\n\n${block}\n`;
}

function findManagedBlock(
  existing: string
): { replaceEnd: number; startIndex: number } | null {
  const startIndex = existing.indexOf(MARKER_START);
  const endIndex = existing.indexOf(MARKER_END);
  if (startIndex >= 0 && endIndex > startIndex) {
    return {
      startIndex,
      replaceEnd: endIndex + MARKER_END.length,
    };
  }

  return null;
}

function removeManagedBlock(
  existing: string,
  managedBlock: { replaceEnd: number; startIndex: number }
): string {
  return `${existing.slice(0, managedBlock.startIndex)}${existing.slice(
    managedBlock.replaceEnd
  )}`.replace(/\n{3,}/g, "\n\n");
}

function normalizeTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

async function writeFileIfChanged(
  path: string,
  content: string
): Promise<boolean> {
  let existing: string | null = null;
  try {
    existing = await readFile(path, "utf8");
  } catch (error) {
    if (!isFileMissing(error)) {
      throw error;
    }
  }

  if (existing === content) {
    return false;
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  return true;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
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

function exhaustiveShell(value: never): never {
  throw new Error(`Unsupported shell: ${value}`);
}
