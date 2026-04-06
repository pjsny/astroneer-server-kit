#!/bin/bash
# Update Astroneer server to latest version
set -e

echo "==> Stopping server..."
systemctl stop astroneer

echo "==> Updating server files..."
sudo -u astroneer steamcmd \
  +login anonymous \
  +force_install_dir /home/astroneer/astro-server \
  +app_update 728470 validate \
  +quit

echo "==> Starting server..."
systemctl start astroneer

echo "Done! Server updated and running."
