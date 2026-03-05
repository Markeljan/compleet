export type SupportedShell = "zsh" | "bash";

export function isSupportedShell(value: string): value is SupportedShell {
  return value === "zsh" || value === "bash";
}

export function renderShellIntegration(shell: SupportedShell): string {
  switch (shell) {
    case "zsh":
      return renderZshIntegration();
    case "bash":
      return renderBashIntegration();
  }
}

function renderZshIntegration(): string {
  return String.raw`# tcomp zsh integration
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
    'setup:run interactive onboarding'
    'config:show current config or rerun provider setup'
    'use:set active provider'
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
        setup|config|use)
          _arguments \
            '1:provider:(codex openai)'
          return
          ;;
      esac
      _arguments -s \
        '--prompt[general assistant response]' \
        '-p[general assistant response]' \
        '--explain[show command explanation]' \
        '-e[show command explanation]'
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
    setup|config|use|auth|init|help|version|suggest|-h|--help|-v|--version)
      command "$_tcomp_bin" "$@"
      return $?
      ;;
  esac

  # Passthrough modes that should print output directly.
  for arg in "$@"; do
    case "$arg" in
      --prompt|-p)
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

function renderBashIntegration(): string {
  return String.raw`# tcomp bash integration
# Commands are shown in an editable prompt when supported by your Bash
# version. They are not auto-executed.

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

_TCOMP_BASH_READ_INITIAL_SUPPORTED=0
if help read 2>/dev/null | grep -q -- "-i"; then
  _TCOMP_BASH_READ_INITIAL_SUPPORTED=1
fi

_tcomp_complete() {
  local cur
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"

  if [[ $COMP_CWORD -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "setup config use help version" -- "$cur") )
    return 0
  fi

  case "\${COMP_WORDS[1]}" in
    setup|config|use)
      COMPREPLY=( $(compgen -W "codex openai" -- "$cur") )
      return 0
      ;;
  esac

  COMPREPLY=( $(compgen -W "--prompt -p --explain -e" -- "$cur") )
}

if [[ $- == *i* ]]; then
  complete -o default -F _tcomp_complete tcomp terminal-complete 2>/dev/null || true
fi

tcomp() {
  local _tcomp_bin _tcomp_cmd arg _tcomp_edit
  _tcomp_bin="$(_tcomp_find_bin)" || return 1

  if [[ $# -eq 0 ]]; then
    command "$_tcomp_bin"
    return $?
  fi

  case "$1" in
    setup|config|use|auth|init|help|version|suggest|-h|--help|-v|--version)
      command "$_tcomp_bin" "$@"
      return $?
      ;;
  esac

  # Passthrough modes that should print output directly.
  for arg in "$@"; do
    case "$arg" in
      --prompt|-p)
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

  if [[ -t 0 && -t 1 && "$_TCOMP_BASH_READ_INITIAL_SUPPORTED" -eq 1 ]]; then
    if read -r -e -i "$_tcomp_cmd" -p "tcomp> " _tcomp_edit; then
      if [[ -n "$_tcomp_edit" ]]; then
        history -s "$_tcomp_edit"
        printf '%s\n' "$_tcomp_edit"
      fi
      return 0
    fi
    return 1
  fi

  if [[ -t 1 ]]; then
    history -s "$_tcomp_cmd"
  fi
  printf '%s\n' "$_tcomp_cmd"
}
`;
}
