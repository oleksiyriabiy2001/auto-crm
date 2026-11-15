# Sourced by the git hook scripts. Not executable on its own.
#
# Git GUIs (VS Code, GitHub Desktop, ...) run hooks without the PATH your
# terminal gets from ~/.zshrc or ~/.bashrc, so pnpm and node installed via
# nvm, fnm, volta or pnpm's installer can be missing. If pnpm isn't found,
# borrow PATH from your login shell, the same way VS Code does for itself.

if ! command -v pnpm >/dev/null 2>&1; then
  # The marker keeps any output printed by shell startup files out of PATH.
  login_path=$("${SHELL:-/bin/sh}" -ilc 'printf "__HOOK_PATH__%s" "$PATH"' 2>/dev/null </dev/null \
    | sed -n 's/.*__HOOK_PATH__//p')
  if [ -n "$login_path" ]; then
    PATH="$login_path:$PATH"
    export PATH
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "git hook: pnpm not found on PATH, even from your login shell (\$SHELL=${SHELL:-unset})." >&2
  echo "Add pnpm's directory to PATH in ~/.zprofile (or ~/.profile), or commit with --no-verify." >&2
  exit 1
fi
