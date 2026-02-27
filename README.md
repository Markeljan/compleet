# terminal-complete

AI CLI for turning natural language into terminal commands with `tcomp`.

## Requirements

- `zsh`
- `bun` (runtime required by npm-installed `tcomp` launcher)

## Build binary

```bash
bun run build.ts
```

Outputs:

- `dist/terminal-complete`
- `dist/tcomp`

## Run tests

```bash
bun test
```

## Local install for testing

Option A (npm-style):

```bash
npm link
tcomp --help
```

Option B (binary symlink):

```bash
mkdir -p "$HOME/bin"
ln -sf "$(pwd)/dist/tcomp" "$HOME/bin/tcomp"
ln -sf "$(pwd)/dist/terminal-complete" "$HOME/bin/terminal-complete"
export PATH="$HOME/bin:$PATH"
```

## First run

On first install, running `tcomp` (or any `tcomp <request>`) starts setup automatically.

```bash
tcomp
```

Setup flow:

- Shows welcome and requirement checks.
- Offers zsh integration install first (`Y/n`, default is `Yes`).
- Lets you choose provider auth:
  - `codex` (OAuth via Codex CLI login)
  - `openai` (API key)

After shell integration install, `tcomp` prints exactly what to run to activate it in your current shell:

```bash
source ~/.zshrc
```

## Practical usage examples

```bash
tcomp find all files larger than 500MB under this directory
tcomp generate a command to sync ./dist to s3://my-bucket/releases
tcomp show git commits from last 7 days grouped by author
tcomp -e safely remove docker images that are dangling
```

General assistant mode:

```bash
tcomp -p explain when to use rsync vs scp
```

## Provider management

Show active provider and available actions:

```bash
tcomp config
```

Run setup for a specific provider:

```bash
tcomp config codex
tcomp config openai
```

Switch active provider:

```bash
tcomp use codex
tcomp use openai
```

## Commands

- `tcomp setup [codex|openai]`
- `tcomp config [codex|openai]`
- `tcomp use <codex|openai>`
- `tcomp help`
- `tcomp version`

## npm publish checklist

```bash
bun test
npm pack --dry-run
npm publish --access public
```

If you also want standalone binaries for release artifacts, run `bun run build.ts` separately and upload `dist/tcomp` + `dist/terminal-complete`.
