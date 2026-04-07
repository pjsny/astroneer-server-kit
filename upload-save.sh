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
SSH_KEY="${SSH_KEY:-$HOME/.ssh/astro-server}"
SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=no"

if [ -z "$SERVER_IP" ] || [ -z "$SAVE_FILE" ]; then
  echo "Usage: bash upload-save.sh <server-ip> <path-to-save-file>"
  exit 1
fi

if [ ! -f "$SAVE_FILE" ]; then
  echo "Error: Save file not found: $SAVE_FILE"
  exit 1
fi

SAVE_NAME=$(basename "$SAVE_FILE" .savegame)

echo "==> Uploading $SAVE_FILE to server..."
# Windows OpenSSH accepts forward-slash paths for scp
scp $SSH_OPTS "$SAVE_FILE" "Administrator@$SERVER_IP:/D:/SaveGames/$SAVE_NAME.savegame"

echo "==> Activating save and restarting server..."
ssh $SSH_OPTS "Administrator@$SERVER_IP" "powershell -Command \"\
  Stop-Service astroneer; \
  \$settings = 'D:\\AstroServerSettings.ini'; \
  \$lines = Get-Content \$settings; \
  if (\$lines -match 'ActiveSaveFileDescriptiveName') { \
    \$lines = \$lines -replace 'ActiveSaveFileDescriptiveName=.*', 'ActiveSaveFileDescriptiveName=$SAVE_NAME'; \
  } else { \
    \$lines += 'ActiveSaveFileDescriptiveName=$SAVE_NAME'; \
  } \
  Set-Content -Path \$settings -Value \$lines -Encoding UTF8; \
  Start-Service astroneer\""

echo ""
echo "Done! World '$SAVE_NAME' is now active on the server."
echo "Give the server ~30 seconds to start, then connect."
