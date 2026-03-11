import { chmod, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

type BuildTarget =
  | "bun-darwin-x64"
  | "bun-darwin-x64-baseline"
  | "bun-darwin-arm64"
  | "bun-linux-x64"
  | "bun-linux-x64-baseline"
  | "bun-linux-x64-modern"
  | "bun-linux-arm64"
  | "bun-linux-x64-musl"
  | "bun-linux-arm64-musl"
  | "bun-windows-x64"
  | "bun-windows-x64-baseline"
  | "bun-windows-x64-modern"
  | "bun-windows-arm64";

interface BuildCliOptions {
  debug: boolean;
  exportBundle: boolean;
  target?: BuildTarget;
}

export function parseBuildOptions(argv: string[]): BuildCliOptions {
  const options: BuildCliOptions = {
    debug: false,
    exportBundle: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--debug") {
      options.debug = true;
      continue;
    }
    if (arg === "--export") {
      options.exportBundle = true;
      continue;
    }
    if (arg === "--target") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("Missing value for --target");
      }
      options.target = value as BuildTarget;
      i += 1;
      continue;
    }
    throw new Error(`Unknown build option: ${arg}`);
  }

  return options;
}

async function compileBinary(
  outfile: string,
  target: BuildTarget | undefined,
  debug: boolean
) {
  const pkg = (await Bun.file("./package.json").json()) as { version?: string };
  const version = pkg.version ?? "0.0.0-dev";
  const buildTime = new Date().toISOString();

  const result = await Bun.build({
    entrypoints: ["./src/cli.ts"],
    compile: {
      outfile,
      ...(target ? { target } : {}),
      autoloadDotenv: true,
      autoloadBunfig: true,
    },
    minify: !debug,
    bytecode: !debug,
    sourcemap: debug ? "linked" : "none",
    define: {
      BUILD_VERSION: JSON.stringify(version),
      BUILD_TIME: JSON.stringify(buildTime),
    },
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log.message);
    }
    throw new Error(`Build failed for ${basename(outfile)}`);
  }

  console.log(`Built ${outfile}`);
}

async function createExportBundle(options: {
  target?: BuildTarget;
  windows: boolean;
}): Promise<void> {
  const suffix = options.windows ? ".exe" : "";
  const bundleName = options.target ?? `${process.platform}-${process.arch}`;
  const exportDir = join("dist", "export", bundleName);

  await rm(exportDir, { recursive: true, force: true });
  await mkdir(exportDir, { recursive: true });

  await copyFile(`./dist/tc${suffix}`, join(exportDir, `tc${suffix}`));
  await copyFile(
    `./dist/compleet${suffix}`,
    join(exportDir, `compleet${suffix}`)
  );
  await copyFile("./README.md", join(exportDir, "README.md"));
  await copyFile("./LICENSE", join(exportDir, "LICENSE"));

  if (options.windows) {
    await writeFile(
      join(exportDir, "install.cmd"),
      renderWindowsInstallScript(),
      "utf8"
    );
  } else {
    const installPath = join(exportDir, "install.sh");
    await writeFile(installPath, renderUnixInstallScript(), "utf8");
    await chmod(installPath, 0o755);
  }

  console.log(`Exported bundle to ${exportDir}`);
}

export function renderUnixInstallScript(): string {
  return `#!/usr/bin/env sh
set -eu

TARGET_DIR="\${1:-$HOME/.local/bin}"
BUNDLE_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"

mkdir -p "$TARGET_DIR"
install -m 755 "$BUNDLE_DIR/tc" "$TARGET_DIR/tc"
install -m 755 "$BUNDLE_DIR/compleet" "$TARGET_DIR/compleet"

printf 'Installed tc and compleet to %s\n' "$TARGET_DIR"
printf 'Add this directory to PATH if needed:\n  export PATH="%s:$PATH"\n' "$TARGET_DIR"
`;
}

export function renderWindowsInstallScript(): string {
  return `@echo off
setlocal

set "TARGET_DIR=%~1"
if "%TARGET_DIR%"=="" set "TARGET_DIR=%USERPROFILE%\\bin"

if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"
copy /Y "%~dp0tc.exe" "%TARGET_DIR%\\tc.exe" >nul
copy /Y "%~dp0compleet.exe" "%TARGET_DIR%\\compleet.exe" >nul

echo Installed tc and compleet to %TARGET_DIR%
echo Add this directory to PATH if needed.
`;
}

async function main() {
  const { target, debug, exportBundle } = parseBuildOptions(
    process.argv.slice(2)
  );
  await mkdir("./dist", { recursive: true });

  const isWindows = target?.includes("windows") ?? process.platform === "win32";
  const suffix = isWindows ? ".exe" : "";

  await compileBinary(`./dist/compleet${suffix}`, target, debug);
  await compileBinary(`./dist/tc${suffix}`, target, debug);

  if (exportBundle) {
    await createExportBundle({
      target,
      windows: isWindows,
    });
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
