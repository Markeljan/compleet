type SupportedShell = "zsh";

export function isSupportedInitShell(value: string): value is SupportedShell {
  return value === "zsh";
}

export function renderShellInit(shell: SupportedShell): string {
  switch (shell) {
    case "zsh":
      return renderZshInit();
  }
}

function renderZshInit(): string {
  return String.raw`# tcomp zsh integration
# Usage:
#   eval "$(tcomp init)"
# Then run:
#   tcomp open zshrc using vscode
#
# Commands are prefilled into your next zsh prompt (BUFFER) so you can
# inspect/edit and press Enter manually. They are not auto-executed.

_tcomp_find_bin() {
  if command -v tcomp >/dev/null 2>&1; then
    printf '%s' 'tcomp'
    return 0
  fi
  if command -v terminal-complete >/dev/null 2>&1; then
    printf '%s' 'terminal-complete'
    return 0
  fi
  printf '%s\n' 'tcomp binary not found in PATH' >&2
  return 1
}

typeset -g _TCOMP_PENDING_BUFFER=""

_tcomp_apply_pending_buffer() {
  [[ -n "$_TCOMP_PENDING_BUFFER" ]] || return 0
  BUFFER="$_TCOMP_PENDING_BUFFER"
  CURSOR=$#BUFFER
  _TCOMP_PENDING_BUFFER=""
}

if [[ -o interactive ]]; then
  # Install line-init hook so tcomp "..." can prefill the next prompt buffer.
  if autoload -Uz add-zle-hook-widget 2>/dev/null; then
    if [[ -z "$_TCOMP_ZLE_HOOK_INSTALLED" ]]; then
      add-zle-hook-widget line-init _tcomp_apply_pending_buffer
      typeset -g _TCOMP_ZLE_HOOK_INSTALLED=1
    fi
  else
    if [[ -z "$_TCOMP_ZLE_FALLBACK_INSTALLED" ]]; then
      if zle -l | grep -qx "zle-line-init"; then
        zle -A zle-line-init _tcomp_prev_line_init
        _tcomp_line_init_wrapper() {
          zle _tcomp_prev_line_init
          _tcomp_apply_pending_buffer
        }
        zle -N zle-line-init _tcomp_line_init_wrapper
      else
        zle -N zle-line-init _tcomp_apply_pending_buffer
      fi
      typeset -g _TCOMP_ZLE_FALLBACK_INSTALLED=1
    fi
  fi
fi

_tcomp_complete() {
  local state
  local -a commands
  commands=(
    'auth:authentication wizard/status'
    'config:configuration wizard/defaults'
    'init:print or install shell integration'
    'help:show help'
    'version:show version'
  )

  _arguments -C \
    '1:command:->command' \
    '*::arg:->args'

  case $state in
    command)
      _describe -t commands 'tcomp commands' commands
      return
      ;;
    args)
      case $words[2] in
        auth)
          _arguments \
            '--provider[provider]:provider:(codex openai)' \
            '--status[show provider status]' \
            '--login[start login flow]' \
            '--logout[logout codex auth]' \
            '--api-key[OpenAI API key]:api key:' \
            '--model[override model]:model:' \
            '--base-url[override base URL]:url:' \
            '--no-default[do not change default provider]'
          return
          ;;
        config)
          _arguments \
            '--show[show config]' \
            '--path[show config file path]' \
            '--reset[reset config]' \
            '--provider[set default provider]:provider:(codex openai)'
          return
          ;;
        init)
          _arguments \
            '--shell[shell]:shell:(zsh)' \
            '--install[write init block to ~/.zshrc]'
          return
          ;;
      esac
      _arguments -s \
        '--provider[inference provider]:provider:(codex openai)' \
        '--prompt[general assistant response]' \
        '-p[general assistant response]' \
        '--explain[show command explanation]' \
        '-e[show command explanation]' \
        '--json[print JSON output]' \
        '--model[override model]:model:' \
        '--base-url[override base URL]:url:' \
        '--api-key[override API key]:api key:'
      return
      ;;
  esac
}

if [[ -o interactive ]] && command -v compdef >/dev/null 2>&1; then
  compdef _tcomp_complete tcomp terminal-complete
fi

tcomp() {
  local _tcomp_bin _tcomp_cmd arg
  _tcomp_bin="$(_tcomp_find_bin)" || return 1

  if [[ $# -eq 0 ]]; then
    command "$_tcomp_bin"
    return $?
  fi

  case "$1" in
    init|auth|config|help|version|suggest|-h|--help|-v|--version)
      command "$_tcomp_bin" "$@"
      return $?
      ;;
  esac

  # Passthrough modes that should print output directly.
  for arg in "$@"; do
    case "$arg" in
      --prompt|-p|--json)
        command "$_tcomp_bin" "$@"
        return $?
        ;;
    esac
  done

  _tcomp_cmd="$(command "$_tcomp_bin" "$@")" || return $?

  if [[ -z "$_tcomp_cmd" ]]; then
    printf '%s\n' 'No command generated.' >&2
    return 1
  fi

  _TCOMP_PENDING_BUFFER="$_tcomp_cmd"
}
`;
}
