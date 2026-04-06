# Astroneer Server Kit
# Run 'make help' to see all commands.

-include .env
export

REPO_ROOT := $(shell pwd)
SSH_KEY   ?= $(HOME)/.ssh/astro-server

.PHONY: help setup preflight start stop ssh logs update ip

help:
	@echo ""
	@echo "  Astroneer Server Kit"
	@echo "  ────────────────────────────────────"
	@echo "  make setup      First-time setup wizard"
	@echo "  make preflight  Check everything is configured"
	@echo ""
	@echo "  make start      Start the server"
	@echo "  make stop       Stop the server"
	@echo "  make ip         Show the server's current IP"
	@echo "  make ssh        SSH into the running server"
	@echo "  make logs       Tail the Astroneer server logs"
	@echo "  make update     Update the game to the latest version"
	@echo ""

# ── Setup ──────────────────────────────────────────────────────────────────────

setup:
	@bash bin/setup

preflight:
	@bash bin/preflight

# ── Server control ─────────────────────────────────────────────────────────────

start:
	@echo "Starting server..."
	@gh workflow run start.yml
	@echo "Kicked off. Watch progress at: https://github.com/$$(gh repo view --json nameWithOwner -q .nameWithOwner)/actions"
	@echo "The IP will appear in the workflow summary once it's up (~3 min)."

stop:
	@echo "Stopping server..."
	@gh workflow run stop.yml
	@echo "Kicked off. World saves are safe."

# ── Info & access ──────────────────────────────────────────────────────────────

ip:
	@cd terraform && terraform output -raw server_ip 2>/dev/null || echo "Server is not running."

ssh: _require_ip
	@ssh -i $(SSH_KEY) -o StrictHostKeyChecking=no root@$$(make -s ip)

logs: _require_ip
	@ssh -i $(SSH_KEY) -o StrictHostKeyChecking=no root@$$(make -s ip) \
		"journalctl -u astroneer -f --no-pager"

update: _require_ip
	@ssh -i $(SSH_KEY) -o StrictHostKeyChecking=no root@$$(make -s ip) \
		"bash /opt/astro-setup/update.sh"

# ── Internal ───────────────────────────────────────────────────────────────────

_require_ip:
	@IP=$$(make -s ip); \
	if [ -z "$$IP" ] || [ "$$IP" = "Server is not running." ]; then \
		echo "Server is not running. Run 'make start' first."; \
		exit 1; \
	fi
