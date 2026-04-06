#!/bin/bash
# Upload an existing save file to the server and activate it.
# Run this from your local machine.
#
# Usage:
#   bash upload-save.sh <server-ip> <path-to-save-file>
#
# Example:
#   bash upload-save.sh 123.45.67.89 ~/Desktop/SAVE_1.savegame

set -e

SERVER_IP="$1"
SAVE_FILE="$2"

if [ -z "$SERVER_IP" ] || [ -z "$SAVE_FILE" ]; then
  echo "Usage: bash upload-save.sh <server-ip> <path-to-save-file>"
  exit 1
fi

if [ ! -f "$SAVE_FILE" ]; then
  echo "Error: Save file not found: $SAVE_FILE"
  exit 1
fi

SAVE_NAME=$(basename "$SAVE_FILE" .savegame)
REMOTE_SAVES="/mnt/saves/SaveGames"
REMOTE_SETTINGS="/mnt/saves/AstroServerSettings.ini"

echo "==> Uploading $SAVE_FILE to server..."
scp "$SAVE_FILE" "root@$SERVER_IP:$REMOTE_SAVES/"

echo "==> Setting correct permissions..."
ssh root@$SERVER_IP "chmod 644 $REMOTE_SAVES/$SAVE_NAME.savegame && chown astroneer:astroneer $REMOTE_SAVES/$SAVE_NAME.savegame"

echo "==> Activating save: $SAVE_NAME"
ssh root@$SERVER_IP "
  systemctl stop astroneer
  # Update or add ActiveSaveFileDescriptiveName
  if grep -q 'ActiveSaveFileDescriptiveName' $REMOTE_SETTINGS; then
    sed -i 's/^ActiveSaveFileDescriptiveName=.*/ActiveSaveFileDescriptiveName=$SAVE_NAME/' $REMOTE_SETTINGS
  else
    echo 'ActiveSaveFileDescriptiveName=$SAVE_NAME' >> $REMOTE_SETTINGS
  fi
  systemctl start astroneer
"

echo ""
echo "Done! World '$SAVE_NAME' is now active on the server."
echo "Give the server ~30 seconds to start, then connect."
