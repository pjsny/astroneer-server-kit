#!/bin/bash
# astroneer-server-kit — run Astroneer dedicated (AstroServer.exe) via Wine (Staging).
#
# Log file (always): Wine stdout/stderr are appended here via tee (works even if UE ignores -ABSLOG).
#   $GAME_ROOT/Astro/Saved/Logs/astroneer-fly.log
# Over SSH:  tail -f /data/astroneer-server-kit/Astro/Saved/Logs/astroneer-fly.log
# Also try:  lsof -p "$(pgrep -f AstroServer-Win64-Shipping)" 2>/dev/null | grep -i log
# If still empty:  find /data/astroneer-server-kit /home/astroneer -name '*.log' 2>/dev/null
# Optional env ASTRONEER_SERVER_ARGS — extra UE args (space-separated), e.g.:
#   -FullStdOutLogOutput          mirror more log lines to stdout (shows in `fly logs`)
#   -LogCmds="global Verbose, log LogNet Verbose"   (quote carefully in fly.toml [env])
set -euo pipefail
: "${GAME_ROOT:=/data/astroneer-server-kit}"
: "${WINEPREFIX:=/tmp/wine-prefix}"
export HOME="${HOME:-/home/astroneer}"
export WINEARCH="${WINEARCH:-win64}"
export WINEDLLOVERRIDES="${WINEDLLOVERRIDES:-winegstreamer=}"
cd "$GAME_ROOT"
if [ -f /etc/default/astroneer ]; then
  set -a
  # shellcheck disable=SC1091
  . /etc/default/astroneer
  set +a
fi

# Wine maps Z: to filesystem root; UE accepts -ABSLOG with a Windows path.
# Must be Z:\data\... (backslash after Z:), not Z:data\... or the log file is never created.
LOG_UNIX="$GAME_ROOT/Astro/Saved/Logs/astroneer-fly.log"
mkdir -p "$(dirname "$LOG_UNIX")"
ABSLOG_WIN="Z:\\$(printf '%s' "$LOG_UNIX" | sed 's#^/##;s#/#\\#g')"

args=(-log "-ABSLOG=$ABSLOG_WIN")
if [ -n "${ASTRONEER_SERVER_ARGS:-}" ]; then
  # shellcheck disable=SC2206
  read -r -a extra <<< "$ASTRONEER_SERVER_ARGS"
  args+=("${extra[@]}")
fi

touch "$LOG_UNIX"
# tee: capture everything Wine prints (and child stderr) to disk + stdout for fly logs.
wine "$GAME_ROOT/AstroServer.exe" "${args[@]}" 2>&1 | tee -a "$LOG_UNIX"
exit "${PIPESTATUS[0]}"
