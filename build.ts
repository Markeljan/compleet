import { mkdir } from "node:fs/promises";
import { basename } from "node:path";

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
  target?: BuildTarget;
}

function parseBuildOptions(argv: string[]): BuildCliOptions {
  const options: BuildCliOptions = { debug: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--debug") {
      options.debug = true;
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
      // Keep runtime env/.env loading enabled for API keys in deployed binaries.
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

async function main() {
  const { target, debug } = parseBuildOptions(process.argv.slice(2));
  await mkdir("./dist", { recursive: true });

  const isWindows = target?.includes("windows") ?? process.platform === "win32";
  const suffix = isWindows ? ".exe" : "";

  await compileBinary(`./dist/terminal-complete${suffix}`, target, debug);
  await compileBinary(`./dist/tcomp${suffix}`, target, debug);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
