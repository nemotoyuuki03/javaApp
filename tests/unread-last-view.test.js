const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function loadDbModule() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-unread-'));
  const tempDbPath = path.join(tempDir, 'chat.db');
  process.env.DB_PATH = tempDbPath;

  delete require.cache[require.resolve('../db.js')];
  return require('../db.js');
}

test('initializeDatabase creates default users and rooms', () => {
  const dbModule = loadDbModule();
  dbModule.initializeDatabase();

  const admin = dbModule.getUserByUsername('admin');
  const guest = dbModule.getUserByUsername('guest');
  const rooms = dbModule.getRooms();

  assert.ok(admin);
  assert.ok(guest);
  assert.equal(admin.username, 'admin');
  assert.ok(rooms.some((room) => room.id === 'general'));
  assert.ok(rooms.some((room) => room.id === 'random'));
});

test('createUser validates username/password and stores the user', () => {
  const dbModule = loadDbModule();
  dbModule.initializeDatabase();

  const created = dbModule.createUser('alpha_user', 'secret123');
  const lookup = dbModule.getUserById(created.id);

  assert.equal(created.username, 'alpha_user');
  assert.equal(lookup.username, 'alpha_user');
  assert.equal(dbModule.verifyUser('alpha_user', 'secret123'), true);

  assert.throws(() => dbModule.createUser('', 'secret123'), /ユーザー名を入力してください/);
  assert.throws(() => dbModule.createUser('ab', 'secret123'), /3文字以上/);
  assert.throws(() => dbModule.createUser('alpha_user', '123'), /6文字以上/);
});

test('saveMessage persists a chat message with sender metadata', () => {
  const dbModule = loadDbModule();
  dbModule.initializeDatabase();

  const user = dbModule.createUser('msg_user', 'secret123');
  const saved = dbModule.saveMessage('general', user.id, 'hello world');
  const history = dbModule.getRoomMessages('general');

  assert.equal(saved.roomId, 'general');
  assert.equal(saved.username, 'msg_user');
  assert.equal(saved.content, 'hello world');
  assert.ok(history.some((message) => message.content === 'hello world'));
});

test('saveUserLastView persists scroll position and lastOpenedAt for each room', () => {
  const dbModule = loadDbModule();
  dbModule.initializeDatabase();

  const user = dbModule.createUser('view_user', 'secret123');
  const openedAt = '2025-01-01T00:00:00.000Z';

  const savedView = dbModule.saveUserLastView(user.id, 'general', 320, openedAt);
  const reopened = dbModule.saveUserRoomLastOpened(user.id, 'general', '2025-01-02T10:00:00.000Z');

  assert.equal(savedView.roomId, 'general');
  assert.equal(savedView.scrollPosition, 320);
  assert.equal(savedView.lastOpenedAt, openedAt);
  assert.equal(reopened.roomId, 'general');
  assert.equal(reopened.lastOpenedAt, '2025-01-02T10:00:00.000Z');
  assert.equal(dbModule.getUserLastView(user.id, 'general').scrollPosition, 320);
});

test('getUnreadCountByRoom counts messages after the room last-open time', () => {
  const dbModule = loadDbModule();
  dbModule.initializeDatabase();

  const user = dbModule.createUser('unread_user', 'secret123');
  const otherUser = dbModule.createUser('other_user', 'secret123');
  const openedAt = '2025-01-01T00:00:00.000Z';

  dbModule.saveUserLastView(user.id, 'general', 0, openedAt);
  dbModule.saveMessage('general', user.id, 'my own message');
  dbModule.saveMessage('general', otherUser.id, 'message from other user after open');
  dbModule.saveMessage('general', otherUser.id, 'second message from other user');

  const count = dbModule.getUnreadCountByRoom(user.id, 'general', openedAt);
  assert.equal(count, 2);

  const reopened = dbModule.saveUserRoomLastOpened(user.id, 'general', new Date(Date.now() + 60000).toISOString());
  const countAfterReopen = dbModule.getUnreadCountByRoom(user.id, 'general', reopened.lastOpenedAt);
  assert.equal(countAfterReopen, 0);
});

test('getUnreadCountsForUser returns per-room unread totals for the current user', () => {
  const dbModule = loadDbModule();
  dbModule.initializeDatabase();

  const user = dbModule.createUser('stats_user', 'secret123');
  const otherUser = dbModule.createUser('stats_other', 'secret123');
  const openedAt = '2025-01-02T00:00:00.000Z';

  dbModule.saveUserLastView(user.id, 'random', 0, openedAt);
  dbModule.saveMessage('random', otherUser.id, 'random message 1');
  dbModule.saveMessage('random', otherUser.id, 'random message 2');

  dbModule.saveUserLastView(user.id, 'support', 0, '2025-01-03T00:00:00.000Z');
  dbModule.saveMessage('support', otherUser.id, 'support message 1');

  const counts = dbModule.getUnreadCountsForUser(user.id);

  assert.equal(Number(counts.random || 0), 2);
  assert.equal(Number(counts.support || 0), 1);
  assert.equal(Number(counts.general || 0), 0);
});
