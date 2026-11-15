.PHONY: help install start dev test up down logs clean update restart refresh reset-db reset-logs ensure-port-free

help:
	@printf "Usage:\n"
	@printf "  make install    - 依存パッケージをインストール\n"
	@printf "  make start      - アプリを起動\n"
	@printf "  make dev        - 開発モードで起動\n"
	@printf "  make test       - テスト実行\n"
	@printf "  make up         - Docker Compose で起動\n"
	@printf "  make update     - アプリ更新を反映して再起動\n"
	@printf "  make restart    - コンテナを再起動\n"
	@printf "  make refresh    - update と同じく更新を反映\n"
	@printf "  make down       - Docker Compose を停止\n"
	@printf "  make logs       - Docker のログを表示\n"
	@printf "  make clean      - SQLiteデータと生成物を削除\n"
	@printf "  make reset-db   - SQLiteのデータを初期化（テーブルは保持）\n"
	@printf "  make reset-logs - アプリのログファイルをリセット\n"

ensure-port-free:
	@set -e; \
	if command -v fuser >/dev/null 2>&1; then \
		if fuser 3001/tcp >/dev/null 2>&1; then \
			echo "Port 3001 is occupied; stopping local processes..."; \
			fuser -k 3001/tcp || true; \
		fi; \
	fi; \
	if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'chat-app'; then \
		echo "Stopping running chat-app container on port 3001..."; \
		docker compose down --remove-orphans >/dev/null 2>&1 || docker stop chat-app >/dev/null 2>&1 || true; \
	fi; \
	sleep 1; \
	if ss -lnt | grep -q ':3001 '; then \
		echo "Port 3001 is still in use after cleanup."; \
		echo "Check with: ss -lntp | grep 3001"; \
		exit 1; \
	fi

install:
	npm install

start: ensure-port-free
	npm start

dev: ensure-port-free
	npm run dev

test:
	npm test

up: ensure-port-free
	docker compose up --build -d

update: ensure-port-free
	@echo "Rebuilding and restarting chat-app...";
	docker compose up -d --no-deps --build chat-app

restart:
	docker compose restart chat-app

refresh: update

reset-db:
	node -e "const { db, initializeDatabase } = require('./db'); db.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE; DELETE FROM messages; DELETE FROM user_last_view; DELETE FROM users; DELETE FROM rooms; DELETE FROM sqlite_sequence WHERE name IN (\'users\', \'messages\'); COMMIT; PRAGMA foreign_keys = ON;'); initializeDatabase(); console.log('SQLite data reset complete. Tables preserved.');"

reset-logs:
	@rm -f data/logs/auth.log data/logs/http.log data/logs/message.log data/logs/error.log
	@echo "Application logs reset."

down:
	docker compose down -v

logs:
	docker compose logs -f

clean:
	rm -rf data/*.db data/*.db-wal data/*.db-shm
	find . -type d -name node_modules -prune -exec rm -rf {} +
	find . -type f \( -name '*.log' -o -name '.DS_Store' \) -delete
