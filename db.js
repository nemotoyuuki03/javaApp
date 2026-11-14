const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'chat.db');
const DATA_DIR = path.dirname(DB_PATH);

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

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
      user_id INTEGER PRIMARY KEY,
      room_id TEXT,
      scroll_position REAL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

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

function getUserByUsername(username) {
  return db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
}

function getUserById(userId) {
  return db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
}

function verifyUser(username, password) {
  const user = getUserByUsername(username);
  if (!user) {
    return false;
  }
  return bcrypt.compareSync(password, user.password_hash);
}

function getRooms() {
  return db.prepare('SELECT id, name FROM rooms ORDER BY id ASC').all();
}

function getRoomMessages(roomId) {
  return db.prepare(`
    SELECT m.id, m.room_id AS roomId, m.content, m.created_at AS createdAt, u.username AS username
    FROM messages m
    JOIN users u ON u.id = m.user_id
    WHERE m.room_id = ?
    ORDER BY m.created_at ASC
  `).all(roomId);
}

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

function getUserLastView(userId) {
  const row = db.prepare(`
    SELECT room_id AS roomId, scroll_position AS scrollPosition
    FROM user_last_view
    WHERE user_id = ?
  `).get(userId);

  return row || { roomId: null, scrollPosition: 0 };
}

function saveUserLastView(userId, roomId, scrollPosition) {
  const normalizedRoomId = roomId && String(roomId).trim() ? String(roomId) : null;
  const normalizedScrollPosition = Number.isFinite(Number(scrollPosition)) ? Number(scrollPosition) : 0;

  db.prepare(`
    INSERT INTO user_last_view (user_id, room_id, scroll_position, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET
      room_id = excluded.room_id,
      scroll_position = excluded.scroll_position,
      updated_at = CURRENT_TIMESTAMP
  `).run(userId, normalizedRoomId, normalizedScrollPosition);

  return getUserLastView(userId);
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
};
