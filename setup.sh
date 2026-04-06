#!/bin/bash
# Astroneer Dedicated Server — DigitalOcean Setup Script
# This runs automatically via cloud-init on first boot.
# You can also run it manually: bash setup.sh

set -e

SAVES_MOUNT="/mnt/saves"
SERVER_DIR="/home/astroneer/astro-server"
SERVER_SAVES="$SERVER_DIR/Astro/Saved/SaveGames"
SERVER_CONFIG="$SERVER_DIR/Astro/Saved/Config/LinuxServer"

echo "==> Updating system..."
apt update && apt upgrade -y

echo "==> Installing dependencies..."
apt install -y lib32gcc-s1 steamcmd ufw curl

echo "==> Creating astroneer user..."
id -u astroneer &>/dev/null || useradd -m -s /bin/bash astroneer

echo "==> Formatting saves volume if needed..."
if ! blkid /dev/disk/by-id/scsi-0DO_Volume_astro-saves; then
  mkfs.ext4 /dev/disk/by-id/scsi-0DO_Volume_astro-saves
fi

echo "==> Mounting saves volume..."
mkdir -p "$SAVES_MOUNT"
mount -o discard,defaults /dev/disk/by-id/scsi-0DO_Volume_astro-saves "$SAVES_MOUNT" || true
grep -q astro-saves /etc/fstab || \
  echo '/dev/disk/by-id/scsi-0DO_Volume_astro-saves /mnt/saves ext4 defaults,nofail,discard 0 2' >> /etc/fstab

echo "==> Downloading Astroneer Dedicated Server via SteamCMD..."
sudo -u astroneer steamcmd \
  +login anonymous \
  +force_install_dir "$SERVER_DIR" \
  +app_update 728470 validate \
  +quit

echo "==> Running server once to generate config dirs..."
sudo -u astroneer "$SERVER_DIR/AstroServer.sh" &
SERVER_PID=$!
sleep 15
kill $SERVER_PID 2>/dev/null || true
sleep 3

echo "==> Linking saves directory to persistent volume..."
mkdir -p "$SAVES_MOUNT/SaveGames"
rm -rf "$SERVER_SAVES"
ln -sfn "$SAVES_MOUNT/SaveGames" "$SERVER_SAVES"
chown -R astroneer:astroneer "$SAVES_MOUNT"

echo "==> Applying config files..."
PUBLIC_IP=$(curl -s http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address || \
            curl -s https://api.ipify.org)

mkdir -p "$SERVER_CONFIG"

cat > "$SERVER_CONFIG/Engine.ini" << EOF
[URL]
Port=8777
EOF

# Only write AstroServerSettings.ini if it doesn't exist on the volume
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

# Link settings file so it persists across droplet recreations
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
echo "Done! Server is running."
echo "Public IP: $PUBLIC_IP"
echo "Connect to: $PUBLIC_IP:8777"
echo ""
echo "To edit server settings:"
echo "  $SAVES_MOUNT/AstroServerSettings.ini"
echo "  (then: systemctl restart astroneer)"
echo ""
echo "To upload a save file:"
echo "  scp SAVE_1.savegame root@$PUBLIC_IP:$SAVES_MOUNT/SaveGames/"
echo "  Then set ActiveSaveFileDescriptiveName=SAVE_1 in AstroServerSettings.ini"
