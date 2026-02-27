# terminal-complete

AI CLI for turning natural language into terminal commands with `tcomp`.

```bash
tcomp open zshrc using vscode
```

With zsh integration enabled, `tcomp ...` prefills your next prompt input so you can review/edit and press Enter manually.

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

Option A (npm-style, recommended for publish testing):

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

## Setup

Run setup directly:

```bash
tcomp setup
```

What setup does:

- Shows first-run welcome guidance.
- Offers shell integration install first (`Y/n`, default is `Yes`).
- Lets you choose one auth method:
  - `Codex OAuth`
  - `OpenAI API key`

If setup prerequisites are missing, it exits with an error (for example non-zsh shell or missing Bun runtime).

## First-run onboarding

If you run `tcomp <prompt>` before setup is completed, onboarding automatically launches the same `tcomp setup` flow.

## Usage

```bash
tcomp find large files over 1GB in this folder
tcomp -e find large files over 1GB in this folder
tcomp -p hey how are you
```

## Commands

- `tcomp setup`
- `tcomp help`
- `tcomp version`

## Breaking changes from v0.1.x

- Removed provider/model selection from CLI and setup.
- Removed `tcomp auth`, `tcomp config`, and `tcomp init` command surfaces in favor of `tcomp setup`.
- Removed `--json` output mode.
- Removed API key/provider environment variable overrides.

## npm publish checklist

```bash
bun test
npm pack --dry-run
npm publish --access public
```

If you also want standalone binaries for release artifacts, run `bun run build.ts` separately and upload `dist/tcomp` + `dist/terminal-complete`.
