import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

type SupportedShell = "zsh";

interface InstallResult {
  path: string;
  updated: boolean;
}

export async function installShellIntegration(shell: SupportedShell, command = "tcomp"): Promise<InstallResult> {
  if (shell !== "zsh") {
    throw new Error(`Unsupported shell for install: ${shell}`);
  }

  const rcPath = getZshRcPath();
  const markerStart = "# >>> tcomp integration >>>";
  const markerEnd = "# <<< tcomp integration <<<";
  const block = `${markerStart}
eval "$(${command} init)"
${markerEnd}`;

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

function getZshRcPath(): string {
  const home = homedir();
  const zdotdir = process.env.ZDOTDIR?.trim();
  if (zdotdir) {
    return join(zdotdir, ".zshrc");
  }
  return join(home, ".zshrc");
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

