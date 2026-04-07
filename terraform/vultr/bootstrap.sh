#!/bin/bash
# Astroneer Dedicated Server on Linux via Wine + SteamCMD (Windows depot 728470).
# Persisted data: Vultr block volume → /mnt/saves

set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

log() { echo "==> $*"; }

# After enabling i386, apt can hit a transient mirror mismatch on security.ubuntu.com
# ("File has unexpected size ... Mirror sync in progress?") and exit non-zero — that
# aborts this whole script under set -e before astroneer.service is ever installed.
apt_update_retry() {
  local attempt=1 max=8 delay=20
  while [ "$attempt" -le "$max" ]; do
    if apt-get update -y; then
      return 0
    fi
    if [ "$attempt" -eq "$max" ]; then
      log "ERROR: apt-get update failed after $max attempts"
      return 1
    fi
    log "apt-get update failed (attempt $attempt/$max), retrying in ${delay}s..."
    sleep "$delay"
    attempt=$((attempt + 1))
  done
}

# curl | gpg yields "Failed writing body" (exit 23) if gpg exits first; a leftover
# keyring file can make dearmor fail with "File exists". Write to a temp file, use
# --yes, and remove stale outputs.
configure_winehq_apt() {
  mkdir -p /etc/apt/keyrings
  rm -f /etc/apt/keyrings/winehq-archive.key

  local tmp ok=0
  tmp="$(mktemp)"
  local i
  for i in $(seq 1 5); do
    if curl -fsSL --connect-timeout 25 --retry 3 --retry-delay 2 \
      https://dl.winehq.org/wine-builds/winehq.key -o "$tmp" && [ -s "$tmp" ]; then
      if gpg --batch --yes --dearmor -o /etc/apt/keyrings/winehq-archive.key "$tmp"; then
        ok=1
        break
      fi
    fi
    log "WineHQ key fetch/dearmor failed (try $i/5), retrying..."
    sleep 3
  done

  if [ "$ok" != 1 ]; then
    if wget -qO "$tmp" https://dl.winehq.org/wine-builds/winehq.key && [ -s "$tmp" ] &&
      gpg --batch --yes --dearmor -o /etc/apt/keyrings/winehq-archive.key "$tmp"; then
      ok=1
    fi
  fi
  rm -f "$tmp"

  if [ "$ok" != 1 ]; then
    log "WARN: WineHQ GPG key not installed; will use distro wine if WineHQ is unavailable"
    rm -f /etc/apt/keyrings/winehq-archive.key /etc/apt/sources.list.d/winehq-jammy.sources
    apt_update_retry
    return 0
  fi

  wget -qO /etc/apt/sources.list.d/winehq-jammy.sources \
    https://dl.winehq.org/wine-builds/ubuntu/dists/jammy/winehq-jammy.sources || true
  apt_update_retry
}

# Many VPS images enable UFW with default deny and only 22/tcp — provider firewall
# is not enough; clients need 8777/tcp+udp on the instance too.
ufw_allow_game_port() {
  command -v ufw >/dev/null 2>&1 || return 0
  ufw allow 8777/tcp comment 'Astroneer dedicated' 2>/dev/null || true
  ufw allow 8777/udp comment 'Astroneer dedicated' 2>/dev/null || true
  if ufw status 2>/dev/null | grep -qi '^Status: active'; then
    log "UFW active — opened 8777/tcp and 8777/udp for Astroneer"
  fi
}

wait_dev() {
  local d=/dev/vdb
  for _ in $(seq 1 60); do
    [ -b "$d" ] && return 0
    sleep 2
  done
  return 1
}

mount_saves() {
  mkdir -p /mnt/saves/SaveGames
  if ! wait_dev; then
    log "WARN: /dev/vdb not available — saves on root disk only (ephemeral)"
    return 0
  fi
  if ! blkid /dev/vdb &>/dev/null; then
    log "Formatting /dev/vdb as ext4..."
    mkfs.ext4 -F /dev/vdb
  fi
  mount /dev/vdb /mnt/saves || true
  grep -q '/dev/vdb /mnt/saves' /etc/fstab || echo '/dev/vdb /mnt/saves ext4 defaults,nofail 0 2' >> /etc/fstab
}

install_deps() {
  log "Installing packages..."
  # Refresh indexes for amd64 first. Enabling i386 before update pulls jammy-security's
  # binary-i386 Packages, which often flakes during Ubuntu mirror sync; that used to
  # abort the whole bootstrap before any retry could help.
  apt_update_retry
  dpkg --add-architecture i386 || true
  apt_update_retry
  apt-get install -y curl ca-certificates gnupg software-properties-common apt-transport-https \
    xvfb cabextract unzip jq wget
  add-apt-repository -y universe || true
  apt_update_retry

  log "Wine (WineHQ stable for Ubuntu 22.04)..."
  configure_winehq_apt
  apt-get install -y --install-recommends winehq-stable || {
    log "WineHQ failed; trying distro wine..."
    apt-get install -y wine64 wine32 || apt-get install -y wine64
  }

  log "steamcmd + winetricks..."
  # steamcmd's preinst fails in cloud-init without accepting the Steam EULA via debconf.
  echo steam steam/license note '' | debconf-set-selections
  echo steam steam/question select "I AGREE" | debconf-set-selections
  apt-get install -y -f || true
  apt-get install -y steamcmd winetricks || apt-get install -y steamcmd
}

astron_user() {
  id -u astroneer &>/dev/null || useradd -m -s /bin/bash astroneer
  sudo -u astroneer mkdir -p /home/astroneer/logs
}

steam_fetch() {
  local root=/home/astroneer/astro-server
  mkdir -p "$root" \
    /home/astroneer/.steam \
    /home/astroneer/Steam \
    /home/astroneer/.local/share/Steam
  chown -R astroneer:astroneer /home/astroneer

  local sc=/usr/games/steamcmd
  [ -x "$sc" ] || sc=steamcmd

  # steamcmd often self-updates and execs itself ("Restarting steamcmd by request").
  # Running app_update in the *same* invocation after that restart frequently yields
  # ERROR! Failed to install app '728470' (Missing configuration). A dedicated +quit
  # pass finishes the bootstrap/restart cycle; the next run owns app_update cleanly.
  log "SteamCMD warm-up (+quit, may self-update)..."
  sudo -u astroneer HOME=/home/astroneer "$sc" +quit || true

  log "Downloading Astroneer dedicated server (Steam 728470, Windows depot)..."
  local attempt=1 max=4
  while [ "$attempt" -le "$max" ]; do
    if sudo -u astroneer HOME=/home/astroneer "$sc" \
      +@sSteamCmdForcePlatformType windows \
      +@sSteamCmdForcePlatformBitness 64 \
      +force_install_dir "$root" \
      +login anonymous \
      +app_info_update 1 \
      +app_update 728470 validate \
      +quit; then
      break
    fi
    if [ "$attempt" -eq "$max" ]; then
      log "ERROR: app_update 728470 failed after $max attempts"
      return 1
    fi
    log "app_update 728470 failed (attempt $attempt/$max), retrying in 15s..."
    sleep 15
    attempt=$((attempt + 1))
  done

  if [ ! -f "$root/AstroServer.exe" ]; then
    log "ERROR: AstroServer.exe missing under $root after Steam download"
    return 1
  fi
}

wine_prefix() {
  log "Initializing Wine prefix (64-bit)..."
  sudo -u astroneer mkdir -p /home/astroneer/.wine
  sudo -u astroneer WINEARCH=win64 WINEPREFIX=/home/astroneer/.wine WINEDEBUG=-all wineboot -u || true
  sudo -u astroneer WINEARCH=win64 WINEPREFIX=/home/astroneer/.wine WINEDEBUG=-all winetricks -q \
    vcrun2019 corefonts || true
}

configure_ini() {
  local root=/home/astroneer/astro-server
  local cfg="$root/Astro/Saved/Config/WindowsServer"
  local pub
  pub=$(curl -fsSL https://api.ipify.org || echo "127.0.0.1")

  local server_display="My Astroneer Server"
  if [ -f /run/astro-server-name ]; then
    server_display=$(tr -d '\r' < /run/astro-server-name | head -1)
    [ -z "$server_display" ] && server_display="My Astroneer Server"
  fi

  mkdir -p "$cfg"
  chown -R astroneer:astroneer "$root"

  # net.AllowEncryption must match every client (WindowsNoEditor Engine.ini). On Wine, True
  # can break joins; if so set False here and on clients.
  # %LocalAppData%\\Astro\\Saved\\Config\\WindowsNoEditor\\Engine.ini → same value
  cat > "$cfg/Engine.ini" << 'ENGINI'
[URL]
Port=8777

[SystemSettings]
net.AllowEncryption=True

[/Script/OnlineSubsystemUtils.IpNetDriver]
MaxClientRate=1048576
MaxInternetClientRate=1048576
ENGINI
  chown astroneer:astroneer "$cfg/Engine.ini"

  local settings=/mnt/saves/AstroServerSettings.ini
  if [ ! -f "$settings" ]; then
    {
      echo '[/Script/Astro.AstroServerSettings]'
      echo "PublicIP=$pub"
      echo 'OwnerName=YOUR_STEAM_NAME'
      echo 'OwnerGuid=0'
      printf 'ServerName=%s\n' "$server_display"
      echo 'ServerPassword='
      echo 'MaximumPlayerCount=8'
    } > "$settings"
  else
    # Saves volume survives make stop/start — old PublicIP breaks joins after a new Vultr IP is assigned.
    if grep -qE '^PublicIP=' "$settings"; then
      log "Refreshing PublicIP in $settings → $pub"
      sed -i "s/^PublicIP=.*/PublicIP=$pub/" "$settings"
    else
      log "WARN: $settings has no PublicIP= line — add PublicIP=$pub (clients may not connect)."
    fi
    # Unreal/Astro schema matches AstroTuxLauncher: MaximumPlayerCount. Older kit used MaxPlayers=/MaxPlayerCount= —
    # those are ignored; missing cap can look like "server full" at 0/8.
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
  chown astroneer:astroneer "$settings" 2>/dev/null || true

  ln -sfn "$settings" "$cfg/AstroServerSettings.ini"
  mkdir -p "$root/Astro/Saved"
  rm -rf "$root/Astro/Saved/SaveGames" 2>/dev/null || true
  ln -sfn /mnt/saves/SaveGames "$root/Astro/Saved/SaveGames"
}

install_wine_bugpack_script() {
  cat > /usr/local/bin/astro-wine-bugpack << 'BUGEOF'
#!/bin/bash
# One-shot bundle for WineHQ bugs or hacking secur32/gnutls: versions, unit, env, log tails.
# Usage: sudo astro-wine-bugpack | tee ~/astro-wine-bugpack.txt
set -euo pipefail
echo "========== astro-wine-bugpack $(date -u +%Y-%m-%dT%H:%M:%SZ) =========="
echo "--- uname ---"
uname -a
echo "--- os-release ---"
test -f /etc/os-release && cat /etc/os-release || true
echo "--- wine ---"
command -v wine64 >/dev/null && wine64 --version || true
command -v wine >/dev/null && wine --version || true
echo "--- libgnutls (dpkg) ---"
dpkg -l 'libgnutls*' 2>/dev/null || true
echo "--- astroneer.service (snippet) ---"
systemctl cat astroneer 2>/dev/null | sed -n '1,45p' || true
echo "--- /etc/default/astroneer ---"
test -f /etc/default/astroneer && cat /etc/default/astroneer || echo "(missing)"
echo "--- tail /home/astroneer/logs/service.log (500 lines) ---"
tail -500 /home/astroneer/logs/service.log 2>/dev/null || echo "(no service.log yet)"
newest=""
if compgen -G "/home/astroneer/astro-server/Astro/Saved/Logs/*.log" >/dev/null 2>&1; then
  newest=$(ls -1t /home/astroneer/astro-server/Astro/Saved/Logs/*.log | head -1)
fi
if [[ -n "${newest:-}" ]]; then
  echo "--- tail newest Unreal log: $newest (200 lines) ---"
  tail -200 "$newest"
else
  echo "--- (no Unreal Astro/Saved/Logs/*.log yet) ---"
fi
echo "========== end =========="
echo ""
echo "Next: set aggressive WINEDEBUG in /etc/default/astroneer, restart astroneer, reproduce once, re-run this script."
BUGEOF
  chmod +x /usr/local/bin/astro-wine-bugpack
}

install_update_helper() {
  cat > /usr/local/bin/astro-update << 'EOF'
#!/bin/bash
set -euo pipefail
systemctl stop astroneer
sudo -u astroneer HOME=/home/astroneer /usr/games/steamcmd +quit || true
sudo -u astroneer HOME=/home/astroneer /usr/games/steamcmd \
  +@sSteamCmdForcePlatformType windows \
  +@sSteamCmdForcePlatformBitness 64 \
  +force_install_dir /home/astroneer/astro-server \
  +login anonymous \
  +app_info_update 1 \
  +app_update 728470 validate \
  +quit
systemctl start astroneer
EOF
  chmod +x /usr/local/bin/astro-update
}

install_astroneer_default_env() {
  # Single place for WINEDEBUG so operators can crank TLS tracing without editing the unit.
  # Precedence: systemd merges EnvironmentFile into the service; we do not set WINEDEBUG= in the unit.
  if [ -f /etc/default/astroneer ]; then
    return 0
  fi
  cat > /etc/default/astroneer << 'DEFENV'
# Astroneer (Wine): after edits, `systemctl restart astroneer`. Output goes to
# /home/astroneer/logs/service.log (and Unreal under Astro/Saved/Logs/).
#
# TLS/Schannel (for Wine patches / WineHQ): errors often come from secur32 → libgnutls.
#   • WINEDEBUG=+secur32,+gnutls — noisy
#   • WINEDEBUG=trace+secur32,trace+gnutls,warn+all — finer Wine traces (very large logs)
#   • GNUTLS_DEBUG_LEVEL=9 — libgnutls stderr (can include handshake detail; treat as sensitive)
# Nuclear short captures only: WINEDEBUG=+relay (massive; seconds of runtime otherwise disks fill)
#
# Bundle versions + logs for a bug report: sudo astro-wine-bugpack | tee ~/astro-wine-bugpack.txt
# Building Wine with symbols: https://wiki.winehq.org/Building_Wine
WINEDEBUG=-all
#GNUTLS_DEBUG_LEVEL=9
DEFENV
  chmod 644 /etc/default/astroneer
}

systemd_unit() {
  install_update_helper
  install_wine_bugpack_script
  install_astroneer_default_env
  # Distro / WineHQ differ: some ships only `wine`, not `wine64`. systemd also uses a minimal PATH.
  local wine_bin
  wine_bin="$(command -v wine64 2>/dev/null || command -v wine 2>/dev/null || true)"
  if [ -z "$wine_bin" ]; then
    log "WARN: wine not in PATH; using /usr/bin/wine — fix Wine install if service fails"
    wine_bin=/usr/bin/wine
  fi
  log "systemd ExecStart wine binary: $wine_bin"

  # If the unit was ever masked, /etc/systemd/system/astroneer.service → /dev/null; `cat >` would
  # only write to the sink and the real unit would never be installed.
  systemctl stop astroneer 2>/dev/null || true
  systemctl unmask astroneer 2>/dev/null || true

  touch /home/astroneer/logs/service.log
  chown astroneer:astroneer /home/astroneer/logs/service.log

  cat > /etc/systemd/system/astroneer.service << UNIT
[Unit]
Description=Astroneer Dedicated Server (Wine)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=astroneer
Group=astroneer
WorkingDirectory=/home/astroneer/astro-server
EnvironmentFile=-/etc/default/astroneer
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=WINEPREFIX=/home/astroneer/.wine
Environment=WINEDLLOVERRIDES=winemenubuilder.exe=d
# -log: Unreal writes Astro/Saved/Logs/*.log under astro-server. These captures add Wine/stderr (e.g. GnuTLS) to disk;
# they replace process streams in journald — use `tail -f /home/astroneer/logs/service.log` or `make logs`.
StandardOutput=append:/home/astroneer/logs/service.log
StandardError=append:/home/astroneer/logs/service.log
ExecStart=/usr/bin/xvfb-run -a -s "-screen 0 1024x768x24" $wine_bin /home/astroneer/astro-server/AstroServer.exe -log
Restart=on-failure
RestartSec=15
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
UNIT
  ufw_allow_game_port
  systemctl daemon-reload
  systemctl enable astroneer
  systemctl start astroneer
}

mount_saves
install_deps
astron_user
steam_fetch
wine_prefix
configure_ini
systemd_unit

log "Bootstrap complete."
