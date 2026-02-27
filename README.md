# terminal-complete

AI CLI for turning natural language into terminal commands with `tcomp`.

```bash
tcomp open zshrc using vscode
```

With zsh integration enabled, `tcomp ...` prefills your next prompt input so you can review/edit and press Enter manually.

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

## Quick setup

```bash
tcomp config           # interactive config wizard
tcomp auth             # interactive provider auth wizard
tcomp init --install   # auto-add zsh integration + completions
source ~/.zshrc
```

## Usage

```bash
tcomp find large files over 1GB in this folder
tcomp -e find large files over 1GB in this folder
tcomp --provider codex open zshrc using vscode
tcomp -p hey how are you
tcomp --json open zshrc using vscode
```

## Commands

- `tcomp auth` (interactive by default)
- `tcomp config` (interactive by default)
- `tcomp init` (prints init script)
- `tcomp init --install` (writes managed block to `~/.zshrc`)

## Providers

- `codex` (default): uses local Codex CLI ChatGPT login and calls ChatGPT Codex responses endpoint
- `openai`: uses API key auth

## Optional env overrides

- `TCOMP_PROVIDER`
- `OPENAI_API_KEY` / `TCOMP_API_KEY`

## npm publish checklist

```bash
bun test
npm pack --dry-run
npm publish --access public
```

If you also want standalone binaries for release artifacts, run `bun run build.ts` separately and upload `dist/tcomp` + `dist/terminal-complete`.
