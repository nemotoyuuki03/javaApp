const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'chat.db');
const DATA_DIR = path.dirname(DB_PATH);

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

migrateLegacyTables();

function migrateLegacyTables() {
  // 既存DBの古い user_last_view / user_room_last_opened を新しい room 単位の last_opened_at 形式へ移行する。
  const userLastViewInfo = db.prepare("PRAGMA table_info(user_last_view)").all();
  const hasLastOpened = userLastViewInfo.some((column) => column.name === 'last_opened_at');

  // 旧スキーマの `user_last_view` が存在し、`last_opened_at` を持っていない場合だけ移行を実施する。
  if (userLastViewInfo.length > 0 && !hasLastOpened) {
    const legacyRows = db.prepare(`
      SELECT user_id, room_id, scroll_position, updated_at
      FROM user_last_view
    `).all();

    // 既存データをバックアップしてから、長期的に扱いやすい新形式へ変換する。
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_last_view_legacy (
        user_id INTEGER NOT NULL,
        room_id TEXT NOT NULL,
        scroll_position REAL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, room_id)
      );
    `);

    db.prepare(`
      INSERT OR REPLACE INTO user_last_view_legacy (user_id, room_id, scroll_position, updated_at)
      SELECT user_id, room_id, scroll_position, updated_at
      FROM user_last_view
    `).run();

    db.exec(`DROP TABLE user_last_view`);
    db.exec(`
      CREATE TABLE user_last_view (
        user_id INTEGER NOT NULL,
        room_id TEXT NOT NULL,
        scroll_position REAL DEFAULT 0,
        last_opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, room_id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (room_id) REFERENCES rooms(id)
      );
    `);

    // 旧データの `updated_at` を新しい `last_opened_at` にそのまま引き継いで既読判定を継続する。
    for (const row of legacyRows) {
      db.prepare(`
        INSERT OR REPLACE INTO user_last_view (user_id, room_id, scroll_position, last_opened_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(row.user_id, row.room_id, row.scroll_position ?? 0, row.updated_at || new Date().toISOString(), row.updated_at || new Date().toISOString());
    }

    db.exec(`DROP TABLE user_last_view_legacy`);
  }

  // 旧 `user_room_last_opened` も同様に、ユーザー × ルームの最終閲覧時刻として統合する。
  const legacyRoomOpened = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_room_last_opened'").get();
  if (legacyRoomOpened) {
    const rows = db.prepare(`
      SELECT user_id, room_id, last_opened_at, updated_at
      FROM user_room_last_opened
    `).all();

    for (const row of rows) {
      db.prepare(`
        INSERT INTO user_last_view (user_id, room_id, scroll_position, last_opened_at, updated_at)
        VALUES (?, ?, 0, ?, ?)
        ON CONFLICT(user_id, room_id) DO UPDATE SET
          last_opened_at = excluded.last_opened_at,
          updated_at = excluded.updated_at
      `).run(row.user_id, row.room_id, row.last_opened_at || row.updated_at || new Date().toISOString(), row.updated_at || new Date().toISOString());
    }

    db.exec('DROP TABLE user_room_last_opened');
  }
}

// アプリ起動時にテーブルと初期データを作成し、既存DBの互換性も担保する。
function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES rooms(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS user_last_view (
      user_id INTEGER NOT NULL,
      room_id TEXT NOT NULL,
      scroll_position REAL DEFAULT 0,
      last_opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, room_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (room_id) REFERENCES rooms(id)
    );
  `);

  // 新しいスキーマを確定した後に、古い保存形式を安全に移行する。
  migrateLegacyTables();

  const defaultUsers = [
    { username: 'admin', password: 'admin123' },
    { username: 'guest', password: 'guest123' },
    { username: 'test',  password: '123456' },
  ];

  for (const user of defaultUsers) {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(user.username);
    if (!existing) {
      db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(
        user.username,
        bcrypt.hashSync(user.password, 10)
      );
    }
  }

  const defaultRooms = [
    { id: 'general', name: 'General' },
    { id: 'random', name: 'Random' },
    { id: 'support', name: 'Support' },
    { id: 'test', name: 'Test' },
  ];

  for (const room of defaultRooms) {
    db.prepare('INSERT OR IGNORE INTO rooms (id, name) VALUES (?, ?)').run(room.id, room.name);
  }

  return db;
}

// 指定ルームで最後に開いた時刻を使って、未読数を計算する。
function getUnreadCountByRoom(userId, roomId, openedAt = null) {
  const targetOpenedAt = openedAt || getUserRoomLastOpened(userId, roomId).lastOpenedAt;
  if (!targetOpenedAt) {
    return getRoomMessages(roomId).filter((message) => Number(message.userId || message.user_id) !== Number(userId)).length;
  }

  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM messages
    WHERE room_id = ?
      AND user_id != ?
      AND created_at > ?
  `).get(roomId, userId, targetOpenedAt);

  return Number(row?.count || 0);
}

// 全ルームに対してユーザーの未読数をまとめて取得する。
function getUnreadCountsForUser(userId) {
  const rooms = getRooms();
  const result = {};

  for (const room of rooms) {
    result[room.id] = getUnreadCountByRoom(userId, room.id);
  }

  return result;
}

// ユーザー名から認証対象ユーザーを取得する。
function getUserByUsername(username) {
  return db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
}

// IDからユーザー情報を取り出してセッション管理に使う。
function getUserById(userId) {
  return db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
}

// パスワードを照合してログイン可否を判定する。
function verifyUser(username, password) {
  const user = getUserByUsername(username);
  if (!user) {
    return false;
  }
  return bcrypt.compareSync(password, user.password_hash);
}

// ルーム一覧をID順で取得し、部屋選択UIの元データにする。
function getRooms() {
  return db.prepare('SELECT id, name FROM rooms ORDER BY id ASC').all();
}

// 指定ルームの履歴を送信者名付きで取得する。
function getRoomMessages(roomId) {
  return db.prepare(`
    SELECT m.id, m.room_id AS roomId, m.content, m.created_at AS createdAt, u.username AS username
    FROM messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.room_id = ?
    ORDER BY m.created_at ASC
  `).all(roomId);
}

// 指定ルームにメッセージを保存し、保存後の全情報を返す。
function saveMessage(roomId, userId, content) {
  const now = new Date().toISOString();
  const result = db.prepare(
    'INSERT INTO messages (room_id, user_id, content, created_at) VALUES (?, ?, ?, ?)'
  ).run(roomId, userId, content, now);

  const saved = db.prepare(`
    SELECT m.id, m.room_id AS roomId, m.content, m.created_at AS createdAt, u.username AS username
    FROM messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.id = ?
  `).get(result.lastInsertRowid);

  return saved;
}

// 新規ユーザーを作成し、入力バリデーションもここで行う。
function createUser(username, password) {
  const trimmedUsername = String(username || '').trim();
  const trimmedPassword = String(password || '');

  if (!trimmedUsername) {
    throw new Error('ユーザー名を入力してください。');
  }

  if (trimmedUsername.length < 3 || trimmedUsername.length > 20) {
    throw new Error('ユーザー名は3文字以上20文字以下で入力してください。');
  }

  if (!trimmedPassword || trimmedPassword.length < 6) {
    throw new Error('パスワードは6文字以上で入力してください。');
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(trimmedUsername);
  if (existing) {
    throw new Error('そのユーザー名は既に使用されています。');
  }

  const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(
    trimmedUsername,
    bcrypt.hashSync(trimmedPassword, 10)
  );

  return getUserById(result.lastInsertRowid);
}

// ルームIDの空白除去をして、null/空文字を防ぐ。
function normalizeRoomId(roomId) {
  return roomId && String(roomId).trim() ? String(roomId).trim() : null;
}

// 指定ユーザーの最後に見たルームとスクロール位置を取得する。
function getUserLastView(userId, roomId = null) {
  const normalizedRoomId = normalizeRoomId(roomId);

  if (normalizedRoomId) {
    const row = db.prepare(`
      SELECT user_id AS userId, room_id AS roomId, scroll_position AS scrollPosition, last_opened_at AS lastOpenedAt, updated_at AS updatedAt
      FROM user_last_view
      WHERE user_id = ? AND room_id = ?
    `).get(userId, normalizedRoomId);

    return row || {
      userId,
      roomId: normalizedRoomId,
      scrollPosition: 0,
      lastOpenedAt: null,
      updatedAt: null,
    };
  }

  const row = db.prepare(`
    SELECT user_id AS userId, room_id AS roomId, scroll_position AS scrollPosition, last_opened_at AS lastOpenedAt, updated_at AS updatedAt
    FROM user_last_view
    WHERE user_id = ?
    ORDER BY updated_at DESC, room_id ASC
    LIMIT 1
  `).get(userId);

  return row || {
    userId,
    roomId: null,
    scrollPosition: 0,
    lastOpenedAt: null,
    updatedAt: null,
  };
}

// ルームごとの閲覧状態を保存し、最後に開いた時刻も同時に更新する。
function saveUserLastView(userId, roomId, scrollPosition, openedAt = new Date().toISOString()) {
  const normalizedRoomId = normalizeRoomId(roomId);
  if (!normalizedRoomId) {
    return getUserLastView(userId);
  }

  const normalizedScrollPosition = Number.isFinite(Number(scrollPosition)) ? Number(scrollPosition) : 0;
  const currentRow = getUserLastView(userId, normalizedRoomId);
  const targetOpenedAt = openedAt || currentRow.lastOpenedAt || new Date().toISOString();

  db.prepare(`
    INSERT INTO user_last_view (user_id, room_id, scroll_position, last_opened_at, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, room_id) DO UPDATE SET
      scroll_position = excluded.scroll_position,
      last_opened_at = excluded.last_opened_at,
      updated_at = CURRENT_TIMESTAMP
  `).run(userId, normalizedRoomId, normalizedScrollPosition, targetOpenedAt);

  return getUserLastView(userId, normalizedRoomId);
}

// そのユーザーの指定ルームに対する最終Open時刻を取得する。
function getUserRoomLastOpened(userId, roomId) {
  return getUserLastView(userId, roomId);
}

// ルームを開いたタイムスタンプを保存し、未読計算の基準にする。
function saveUserRoomLastOpened(userId, roomId, openedAt = new Date().toISOString()) {
  const normalizedRoomId = normalizeRoomId(roomId);
  if (!normalizedRoomId) {
    return getUserLastView(userId);
  }

  const currentRow = getUserLastView(userId, normalizedRoomId);
  const persisted = saveUserLastView(
    userId,
    normalizedRoomId,
    Number.isFinite(Number(currentRow.scrollPosition)) ? Number(currentRow.scrollPosition) : 0,
    openedAt || currentRow.lastOpenedAt || new Date().toISOString()
  );

  return persisted;
}

module.exports = {
  db,
  initializeDatabase,
  getUserByUsername,
  getUserById,
  verifyUser,
  getRooms,
  getRoomMessages,
  saveMessage,
  createUser,
  getUserLastView,
  saveUserLastView,
  getUserRoomLastOpened,
  saveUserRoomLastOpened,
  getUnreadCountByRoom,
  getUnreadCountsForUser,
};
