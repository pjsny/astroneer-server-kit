# Astroneer Server Kit
# Run 'make help' to see all commands.

-include .env
export

SSH_KEY ?= $(HOME)/.ssh/astro-server

.PHONY: help setup preflight start stop ssh logs update ip

help:
	@echo ""
	@echo "  Astroneer Server Kit"
	@echo "  ──────────────────────────────────"
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

setup:
	@bun run scripts/setup.ts

preflight:
	@bun run scripts/preflight.ts

start:
	@bun run scripts/start.ts

stop:
	@bun run scripts/stop.ts

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

_require_ip:
	@IP=$$(make -s ip); \
	if [ -z "$$IP" ] || [ "$$IP" = "Server is not running." ]; then \
		echo "Server is not running. Run 'make start' first."; \
		exit 1; \
	fi
