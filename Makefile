.PHONY: help install start dev test up down logs clean update restart refresh reset-db reset-logs

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

install:
	npm install

start:
	npm start

dev:
	npm run dev

test:
	npm test

up:
	docker compose up --build -d

update:
	docker compose up -d --no-deps --build chat-app

restart:
	docker compose restart chat-app

refresh: update

reset-db:
	node -e "const { db, initializeDatabase } = require('./db'); db.exec('BEGIN IMMEDIATE; DELETE FROM messages; DELETE FROM rooms; DELETE FROM users; DELETE FROM user_last_view; DELETE FROM sqlite_sequence WHERE name IN (\'users\', \'messages\'); COMMIT;'); initializeDatabase(); console.log('SQLite data reset complete. Tables preserved.');"

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
