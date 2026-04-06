#!/bin/bash
# Astroneer Dedicated Server — Server Setup Script
# Runs automatically via cloud-init on first boot.
# Can also be run manually: bash setup.sh

set -e

SAVES_MOUNT="/mnt/saves"
SERVER_DIR="/home/astroneer/astro-server"
SERVER_SAVES="$SERVER_DIR/Astro/Saved/SaveGames"
SERVER_CONFIG="$SERVER_DIR/Astro/Saved/Config/LinuxServer"
VOLUME_DEVICE="/dev/disk/by-id/scsi-0HC_Volume_astro-saves"

echo "==> Updating system..."
apt update && apt upgrade -y

echo "==> Installing dependencies..."
apt install -y lib32gcc-s1 steamcmd ufw curl

echo "==> Creating astroneer user..."
id -u astroneer &>/dev/null || useradd -m -s /bin/bash astroneer

echo "==> Waiting for saves volume to be attached..."
for i in $(seq 1 30); do
  [ -e "$VOLUME_DEVICE" ] && break
  echo "  Waiting... ($i/30)"
  sleep 5
done

if [ ! -e "$VOLUME_DEVICE" ]; then
  echo "WARNING: Saves volume not found at $VOLUME_DEVICE, proceeding without it"
else
  echo "==> Mounting saves volume..."
  mkdir -p "$SAVES_MOUNT"
  mount -o discard,defaults "$VOLUME_DEVICE" "$SAVES_MOUNT" || true
  grep -q "scsi-0HC_Volume_astro-saves" /etc/fstab || \
    echo "$VOLUME_DEVICE $SAVES_MOUNT ext4 defaults,nofail,discard 0 2" >> /etc/fstab
fi

echo "==> Downloading Astroneer Dedicated Server via SteamCMD..."
sudo -u astroneer steamcmd \
  +force_install_dir "$SERVER_DIR" \
  +login anonymous \
  +app_update 728470 validate \
  +quit

echo "==> Running server once to generate config dirs..."
sudo -u astroneer "$SERVER_DIR/AstroServer.sh" &
SERVER_PID=$!
sleep 15
kill $SERVER_PID 2>/dev/null || true
sleep 3

echo "==> Linking saves to persistent volume..."
mkdir -p "$SAVES_MOUNT/SaveGames"
rm -rf "$SERVER_SAVES"
ln -sfn "$SAVES_MOUNT/SaveGames" "$SERVER_SAVES"
chown -R astroneer:astroneer "$SAVES_MOUNT"

echo "==> Applying config..."
PUBLIC_IP=$(curl -s http://169.254.169.254/hetzner/v1/metadata/public-ipv4 || \
            curl -s https://api.ipify.org)

mkdir -p "$SERVER_CONFIG"

cat > "$SERVER_CONFIG/Engine.ini" << EOF
[URL]
Port=8777
EOF

if [ ! -f "$SAVES_MOUNT/AstroServerSettings.ini" ]; then
  cat > "$SAVES_MOUNT/AstroServerSettings.ini" << EOF
[/Script/Astro.AstroServerSettings]
PublicIP=$PUBLIC_IP
OwnerName=YOUR_STEAM_NAME
OwnerGuid=0
ServerName=My Astroneer Server
ServerPassword=
MaxPlayers=8
EOF
fi

ln -sfn "$SAVES_MOUNT/AstroServerSettings.ini" "$SERVER_CONFIG/AstroServerSettings.ini"

echo "==> Installing systemd service..."
cat > /etc/systemd/system/astroneer.service << EOF
[Unit]
Description=Astroneer Dedicated Server
After=network.target

[Service]
Type=simple
User=astroneer
WorkingDirectory=$SERVER_DIR
ExecStart=$SERVER_DIR/AstroServer.sh
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable astroneer

echo "==> Configuring firewall..."
ufw allow OpenSSH
ufw allow 8777/udp
ufw allow 8777/tcp
ufw --force enable

echo "==> Starting Astroneer server..."
systemctl start astroneer

echo ""
echo "Done! Server is running at $PUBLIC_IP:8777"
