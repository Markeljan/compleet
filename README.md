# terminal-complete

AI CLI for turning natural language into terminal commands with `tcomp`.

[![npm version](https://img.shields.io/npm/v/terminal-complete)](https://www.npmjs.com/package/terminal-complete)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/license/mit/)
[![CI](https://github.com/Markeljan/terminal-complete/actions/workflows/ci.yml/badge.svg)](https://github.com/Markeljan/terminal-complete/actions/workflows/ci.yml)

## Install (Bun)

Global install:

```bash
bun add -g terminal-complete
tcomp --help
```

One-off usage without install:

```bash
bunx terminal-complete --help
```

## Links

- npm package: https://www.npmjs.com/package/terminal-complete
- GitHub repository: https://github.com/Markeljan/terminal-complete
- Issue tracker: https://github.com/Markeljan/terminal-complete/issues

## Requirements

- `zsh` or `bash`
- `bun`

## Quick Start

First run setup:

```bash
tcomp
```

Or run setup directly:

```bash
tcomp setup
```

Setup flow:

- checks environment and shell support
- offers shell integration install
- sets up provider auth:
  - `codex`: OpenAI OAuth via Codex CLI (browser or device flow)
  - `openai`: OpenAI API key

After shell integration install, run:

```bash
# zsh
source ~/.zshrc

# bash
source ~/.bashrc
```

## Common Usage

```bash
tcomp find all files larger than 500MB under this directory
tcomp generate a command to sync ./dist to s3://my-bucket/releases
tcomp show git commits from last 7 days grouped by author
tcomp -e safely remove docker images that are dangling
```

General assistant (non-command) mode:

```bash
tcomp -p explain when to use rsync vs scp
```

## Setup and Config Commands

Run full onboarding:

```bash
tcomp setup
```

Run onboarding for a specific provider:

```bash
tcomp setup codex
tcomp setup openai
```

Show current configuration/status:

```bash
tcomp config
```

Re-run provider auth/config:

```bash
tcomp config codex
tcomp config openai
```

Switch active provider:

```bash
tcomp use codex
tcomp use openai
```

## Common Flags

- `--explain`, `-e`: print explanation/risk to stderr
- `--prompt`, `-p`: general assistant mode (not command generation)
- `--help`, `-h`: show help
- `--version`, `-v`: show version

## Commands

- `tcomp <request>`
- `tcomp setup [codex|openai]`
- `tcomp config [codex|openai]`
- `tcomp use <codex|openai>`
- `tcomp help`
- `tcomp version`

## Maintainers

Release and npm publishing docs: `docs/releasing.md`
