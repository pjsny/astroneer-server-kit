#!/bin/bash
# astroneer-server-kit — container entry (Fly.io volume → /data; chown when root).
# Wine prefix on the volume (`winepfx`), not ephemeral /tmp.
set -euo pipefail
DATA_DIR="${DATA_DIR:-/data}"
export DATA_DIR
export GAME_ROOT="$DATA_DIR/astroneer-server-kit"
export WINEPREFIX="${WINEPREFIX:-$DATA_DIR/winepfx}"

if [ "$(id -u)" = 0 ]; then
  mkdir -p \
    "$DATA_DIR/SaveGames" \
    "$GAME_ROOT" \
    "$WINEPREFIX" \
    /home/astroneer/logs
  # First boot: seed prefix from image when the skeleton includes a full prefix.
  if [ -f /opt/wine-prefix-skel/system.reg ] && [ ! -f "$WINEPREFIX/system.reg" ]; then
    echo "==> Seeding Wine prefix from image → $WINEPREFIX …"
    rm -rf "$WINEPREFIX"
    mkdir -p "$WINEPREFIX"
    cp -a /opt/wine-prefix-skel/. "$WINEPREFIX/"
  fi
  chown -R astroneer:astroneer "$DATA_DIR" /home/astroneer/logs 2>/dev/null || true
  exec gosu astroneer:astroneer /usr/local/bin/entrypoint-astroneer.sh
fi
exec /usr/local/bin/entrypoint-astroneer.sh
