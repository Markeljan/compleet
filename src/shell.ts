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
    default:
      return exhaustiveShell(shell);
  }
}

function renderZshIntegration(): string {
  return `# Compleet zsh integration
# Loader only. Wrapper lives in Compleet's config directory.

_tc_find_bin() {
  local _tc_path
  _tc_path="$(whence -p tc 2>/dev/null || true)"
  if [[ -n "$_tc_path" ]]; then
    printf '%s' "$_tc_path"
    return 0
  fi
  _tc_path="$(whence -p compleet 2>/dev/null || true)"
  if [[ -n "$_tc_path" ]]; then
    printf '%s' "$_tc_path"
    return 0
  fi
  printf '%s\\n' 'Compleet binary not found in PATH' >&2
  return 1
}

typeset -g _TC_PENDING_BUFFER=""

_tc_apply_pending_buffer() {
  [[ -n "$_TC_PENDING_BUFFER" ]] || return 0
  BUFFER="$_TC_PENDING_BUFFER"
  CURSOR=$#BUFFER
  _TC_PENDING_BUFFER=""
}

if [[ -o interactive ]]; then
  # Install line-init hook so tc "..." can prefill the next prompt buffer.
  if autoload -Uz add-zle-hook-widget 2>/dev/null; then
    if [[ -z "$_TC_ZLE_HOOK_INSTALLED" ]]; then
      add-zle-hook-widget line-init _tc_apply_pending_buffer
      typeset -g _TC_ZLE_HOOK_INSTALLED=1
    fi
  else
    if [[ -z "$_TC_ZLE_FALLBACK_INSTALLED" ]]; then
      if zle -l | grep -qx "zle-line-init"; then
        zle -A zle-line-init _tc_prev_line_init
        _tc_line_init_wrapper() {
          zle _tc_prev_line_init
          _tc_apply_pending_buffer
        }
        zle -N zle-line-init _tc_line_init_wrapper
      else
        zle -N zle-line-init _tc_apply_pending_buffer
      fi
      typeset -g _TC_ZLE_FALLBACK_INSTALLED=1
    fi
  fi
fi

tc() {
  local _tc_bin _tc_cmd arg
  _tc_bin="$(_tc_find_bin)" || return 1

  if [[ $# -eq 0 ]]; then
    command "$_tc_bin"
    return $?
  fi

  case "$1" in
    setup|config|reset|use|help|version|suggest|-h|--help|-v|--version)
      command "$_tc_bin" "$@"
      return $?
      ;;
  esac

  # Passthrough modes that should print output directly.
  for arg in "$@"; do
    case "$arg" in
      --prompt|-p)
        command "$_tc_bin" "$@"
        return $?
        ;;
    esac
  done

  _tc_cmd="$(command "$_tc_bin" "$@")" || return $?

  if [[ -z "$_tc_cmd" ]]; then
    printf '%s\\n' 'No command generated.' >&2
    return 1
  fi

  _TC_PENDING_BUFFER="$_tc_cmd"
}

compleet() {
  tc "$@"
}
`;
}

function renderBashIntegration(): string {
  return `# Compleet bash integration
# Loader only. Wrapper lives in Compleet's config directory.

_tc_find_bin() {
  local _tc_path
  _tc_path="$(type -P tc 2>/dev/null || true)"
  if [[ -n "$_tc_path" ]]; then
    printf '%s' "$_tc_path"
    return 0
  fi
  _tc_path="$(type -P compleet 2>/dev/null || true)"
  if [[ -n "$_tc_path" ]]; then
    printf '%s' "$_tc_path"
    return 0
  fi
  printf '%s\\n' 'Compleet binary not found in PATH' >&2
  return 1
}

_TC_BASH_READ_INITIAL_SUPPORTED=0
if help read 2>/dev/null | grep -q -- "-i"; then
  _TC_BASH_READ_INITIAL_SUPPORTED=1
fi

tc() {
  local _tc_bin _tc_cmd arg _tc_edit
  _tc_bin="$(_tc_find_bin)" || return 1

  if [[ $# -eq 0 ]]; then
    command "$_tc_bin"
    return $?
  fi

  case "$1" in
    setup|config|reset|use|help|version|suggest|-h|--help|-v|--version)
      command "$_tc_bin" "$@"
      return $?
      ;;
  esac

  # Passthrough modes that should print output directly.
  for arg in "$@"; do
    case "$arg" in
      --prompt|-p)
        command "$_tc_bin" "$@"
        return $?
        ;;
    esac
  done

  _tc_cmd="$(command "$_tc_bin" "$@")" || return $?

  if [[ -z "$_tc_cmd" ]]; then
    printf '%s\\n' 'No command generated.' >&2
    return 1
  fi

  if [[ -t 0 && -t 1 && "$_TC_BASH_READ_INITIAL_SUPPORTED" -eq 1 ]]; then
    if read -r -e -i "$_tc_cmd" -p "tc> " _tc_edit; then
      if [[ -n "$_tc_edit" ]]; then
        history -s "$_tc_edit"
        printf '%s\\n' "$_tc_edit"
      fi
      return 0
    fi
    return 1
  fi

  if [[ -t 1 ]]; then
    history -s "$_tc_cmd"
  fi
  printf '%s\\n' "$_tc_cmd"
}

compleet() {
  tc "$@"
}
`;
}

function exhaustiveShell(value: never): never {
  throw new Error(`Unsupported shell: ${value}`);
}
