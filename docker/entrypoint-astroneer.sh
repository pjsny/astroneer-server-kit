#!/bin/bash
# astroneer-server-kit — Astroneer dedicated (728470) via DepotDownloader + Wine + GnuTLS (Fly.io).
set -euo pipefail

export HOME=/home/astroneer
export DEBIAN_FRONTEND=noninteractive

: "${DATA_DIR:=/data}"
: "${GAME_ROOT:=$DATA_DIR/astroneer-server-kit}"
: "${WINEPREFIX:=$DATA_DIR/winepfx}"

log() { echo "==> $*"; }

# DepotDownloader: app 728470, Windows depot (see depot_fetch).
depot_fetch() {
  mkdir -p "$GAME_ROOT"
  local dd=/opt/depotdownloader/DepotDownloader
  if [ ! -x "$dd" ]; then
    log "ERROR: DepotDownloader not found at $dd"
    return 1
  fi
  local dest
  dest="$(cd "$GAME_ROOT" && pwd)"
  log "DepotDownloader: app 728470 -os windows -dir $dest -validate …"
  local attempt=1 max=4
  while [ "$attempt" -le "$max" ]; do
    if "$dd" -app 728470 -os windows -dir "$dest" -validate; then
      break
    fi
    if [ "$attempt" -eq "$max" ]; then
      log "ERROR: DepotDownloader 728470 failed after $max attempts"
      return 1
    fi
    log "retry DepotDownloader 728470 ($attempt/$max)…"
    sleep 15
    attempt=$((attempt + 1))
  done

  if [ ! -f "$GAME_ROOT/AstroServer.exe" ]; then
    log "ERROR: AstroServer.exe missing under $GAME_ROOT"
    return 1
  fi
}

ensure_wine_prefix() {
  if [ -f "$WINEPREFIX/system.reg" ]; then
    return 0
  fi
  log "Initializing Wine prefix at $WINEPREFIX (wineboot fallback — image should seed from /opt/wine-prefix-skel)…"
  mkdir -p "$WINEPREFIX"
  export WINEDLLOVERRIDES="${WINEDLLOVERRIDES:-mscoree=;mshtml=;winegstreamer=}"
  WINEDEBUG=-all xvfb-run -a sh -c 'wineboot -u && wineserver -w'
}

install_game_cacerts() {
  local url=https://curl.se/ca/cacert.pem
  local tmp
  tmp="$(mktemp)"
  if ! curl -fsSL --connect-timeout 25 --retry 3 "$url" -o "$tmp" || [ ! -s "$tmp" ]; then
    log "WARN: could not fetch cacert.pem"
    rm -f "$tmp"
    return 0
  fi
  local d
  for d in \
    "$GAME_ROOT/Astro/Content/Certificates/Windows" \
    "$GAME_ROOT/Astro/Content/Certificates" \
    "$GAME_ROOT/Engine/Content/Certificates/ThirdParty"; do
    mkdir -p "$d"
    [ ! -s "$d/cacert.pem" ] && cp -f "$tmp" "$d/cacert.pem"
  done
  rm -f "$tmp"
}

configure_ini() {
  local cfg="$GAME_ROOT/Astro/Saved/Config/WindowsServer"
  local game_port="${ASTRONEER_GAME_PORT:-8777}"
  local console_port="${ASTRONEER_CONSOLE_PORT:-8779}"
  local console_password="${ASTRONEER_CONSOLE_PASSWORD:-lol123}"
  local pub="${ASTRONEER_PUBLIC_IP:-}"
  if [ -z "$pub" ]; then
    pub=$(curl -fsSL --connect-timeout 15 https://api.ipify.org || echo "127.0.0.1")
  fi

  local server_display="${ASTRONEER_SERVER_NAME:-My Astroneer Server}"

  mkdir -p "$cfg"
  cat > "$cfg/Engine.ini" << ENGINI
[URL]
Port=${game_port}

[SystemSettings]
net.AllowEncryption=True

[/Script/OnlineSubsystemUtils.IpNetDriver]
MaxClientRate=1048576
MaxInternetClientRate=1048576
ENGINI

  local settings="$DATA_DIR/AstroServerSettings.ini"
  if [ ! -f "$settings" ]; then
    {
      echo '[/Script/Astro.AstroServerSettings]'
      echo "PublicIP=$pub"
      echo "ConsolePort=$console_port"
      echo "ConsolePassword=$console_password"
      echo 'OwnerName=YOUR_STEAM_NAME'
      echo 'OwnerGuid=0'
      printf 'ServerName=%s\n' "$server_display"
      echo 'ServerPassword='
      echo 'MaximumPlayerCount=8'
    } > "$settings"
  else
    if grep -qE '^PublicIP=' "$settings"; then
      sed -i "s/^PublicIP=.*/PublicIP=$pub/" "$settings"
    fi
    if grep -qE '^ConsolePort=' "$settings"; then
      sed -i "s/^ConsolePort=.*/ConsolePort=$console_port/" "$settings"
    else
      echo "ConsolePort=$console_port" >> "$settings"
    fi
    if grep -qE '^ConsolePassword=' "$settings"; then
      sed -i "s/^ConsolePassword=.*/ConsolePassword=$console_password/" "$settings"
    else
      echo "ConsolePassword=$console_password" >> "$settings"
    fi
    if grep -qE '^MaxPlayers=' "$settings"; then
      if grep -qE '^MaximumPlayerCount=' "$settings"; then
        sed -i '/^MaxPlayers=/d' "$settings"
      else
        sed -i 's/^MaxPlayers=/MaximumPlayerCount=/' "$settings"
      fi
    fi
    if grep -qE '^MaxPlayerCount=' "$settings"; then
      if grep -qE '^MaximumPlayerCount=' "$settings"; then
        sed -i '/^MaxPlayerCount=/d' "$settings"
      else
        sed -i 's/^MaxPlayerCount=/MaximumPlayerCount=/' "$settings"
      fi
    fi
    if ! grep -qE '^MaximumPlayerCount=' "$settings"; then
      echo 'MaximumPlayerCount=8' >> "$settings"
    fi
  fi

  ln -sfn "$settings" "$cfg/AstroServerSettings.ini"
  mkdir -p "$GAME_ROOT/Astro/Saved"
  rm -rf "$GAME_ROOT/Astro/Saved/SaveGames" 2>/dev/null || true
  ln -sfn "$DATA_DIR/SaveGames" "$GAME_ROOT/Astro/Saved/SaveGames"
}

# /etc/default/astroneer is baked into the image (non-root cannot create it at runtime).

if [ ! -f "$GAME_ROOT/AstroServer.exe" ]; then
  depot_fetch
fi

wine --version >/dev/null 2>&1 || { log "ERROR: wine not on PATH"; exit 1; }
ensure_wine_prefix
install_game_cacerts
configure_ini

log "Starting AstroServer under Wine…"
log "UE log file: $GAME_ROOT/Astro/Saved/Logs/astroneer-fly.log (tail -f over SSH). fly logs = Wine stdout (use ASTRONEER_SERVER_ARGS=-FullStdOutLogOutput for more there)."
exec /usr/bin/xvfb-run -a -s "-screen 0 1024x768x24" /usr/local/bin/astroneer-server-run
