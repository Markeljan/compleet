#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const { join } = require("node:path");

const cliEntrypoint = join(__dirname, "..", "src", "cli.ts");
const args = process.argv.slice(2);

const result = spawnSync("bun", [cliEntrypoint, ...args], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  if (result.error.code === "ENOENT") {
    console.error(
      "tcomp requires Bun runtime. Install Bun: https://bun.sh/docs/installation"
    );
    process.exit(1);
  }
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
