# Login shells (`bash -l`) reset PATH from /etc/profile; keep agent binaries installed into
# ~/.local (npm global prefix, Claude's native installer) reachable.
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH" ;;
esac
export PATH
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-$HOME/.local}"
