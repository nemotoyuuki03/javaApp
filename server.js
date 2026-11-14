const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');
const { WebSocketServer } = require('ws');
const {
  initializeDatabase,
  verifyUser,
  getUserByUsername,
  getUserById,
  getRooms,
  getRoomMessages,
  saveMessage,
  createUser,
  getUserLastView,
  saveUserLastView,
} = require('./db');
const logger = require('./logger');

initializeDatabase();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const sessions = new Map();
const roomClients = new Map();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  logger.http.info('HTTP request', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
  });

  res.on('finish', () => {
    if (res.statusCode >= 400 && res.statusCode !== 401) {
      logger.error.error('HTTP error response', {
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        ip: req.ip,
      });
    }

    logger.http.info('HTTP response', {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
    });
  });

  next();
});

app.use((err, req, res, next) => {
  logger.error.error('Unhandled application error', {
    method: req.method,
    url: req.originalUrl,
    message: err && err.message,
    stack: err && err.stack,
  });

  res.status(500).json({ error: 'サーバー内部エラーが発生しました。' });
});

function parseCookies(cookieHeader = '') {
  const cookies = {};
  cookieHeader.split(';').forEach((part) => {
    const trimmed = part.trim();
    if (!trimmed) {
      return;
    }
    const idx = trimmed.indexOf('=');
    if (idx === -1) {
      return;
    }
    const key = trimmed.slice(0, idx).trim();
    const value = decodeURIComponent(trimmed.slice(idx + 1).trim());
    cookies[key] = value;
  });
  return cookies;
}

function getSessionUserFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies.chat_session;
  if (!token) {
    return null;
  }
  const session = sessions.get(token);
  if (!session) {
    return null;
  }
  const user = getUserById(session.userId);
  if (!user) {
    return null;
  }
  return user;
}

function requireAuth(req, res, next) {
  const user = getSessionUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'ログインが必要です。' });
  }
  req.user = user;
  next();
}

app.post('/api/users', (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    const user = createUser(username, password);
    return res.status(201).json({
      success: true,
      user: { id: user.id, username: user.username },
    });
  } catch (error) {
    const message = error.message || 'ユーザー登録に失敗しました。';
    return res.status(400).json({ error: message });
  }
});

app.get('/api/session', (req, res) => {
  const user = getSessionUserFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: '未認証です。' });
  }

  const lastView = getUserLastView(user.id);
  return res.json({ user, lastView });
});

app.get('/api/last-view', requireAuth, (req, res) => {
  const lastView = getUserLastView(req.user.id);
  return res.json(lastView);
});

app.post('/api/last-view', requireAuth, (req, res) => {
  const roomId = String(req.body.roomId || '').trim() || null;
  const scrollPosition = Number(req.body.scrollPosition || 0);

  const lastView = saveUserLastView(req.user.id, roomId, scrollPosition);
  return res.json({ success: true, lastView });
});

app.post('/api/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!username || !password) {
    return res.status(400).json({ error: 'ユーザー名とパスワードを入力してください。' });
  }

  if (!verifyUser(username, password)) {
    logger.auth.warn('Login failed', { username });
    return res.status(401).json({ error: '認証に失敗しました。ユーザー名またはパスワードを確認してください。' });
  }

  const user = getUserByUsername(username);
  const token = crypto.randomBytes(32).toString('hex');
  const lastView = getUserLastView(user.id);
  sessions.set(token, { userId: user.id, username: user.username });

  logger.auth.info('User logged in', {
    userId: user.id,
    username: user.username,
    token,
    lastView,
  });

  res.setHeader('Set-Cookie', `chat_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
  return res.json({
    success: true,
    user: { id: user.id, username: user.username },
    lastView,
  });
});

app.post('/api/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies.chat_session;
  if (token) {
    const session = sessions.get(token);
    logger.auth.info('User logged out', {
      token,
      userId: session ? session.userId : null,
      username: session ? session.username : null,
    });
    sessions.delete(token);
  }
  res.setHeader('Set-Cookie', 'chat_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax');
  return res.json({ success: true });
});

app.get('/api/rooms', requireAuth, (_req, res) => {
  return res.json({ rooms: getRooms() });
});

app.get('/api/history', requireAuth, (req, res) => {
  const roomId = String(req.query.roomId || 'general');
  return res.json({ messages: getRoomMessages(roomId) });
});

app.get('/health', (_req, res) => {
  return res.json({ ok: true, status: 'healthy' });
});

function ensureRoom(roomId) {
  if (!roomClients.has(roomId)) {
    roomClients.set(roomId, new Set());
  }
}

function leaveRoom(ws) {
  if (!ws.roomId) {
    return;
  }
  const clients = roomClients.get(ws.roomId);
  if (!clients) {
    return;
  }
  clients.delete(ws);
  if (clients.size === 0) {
    roomClients.delete(ws.roomId);
  }
  ws.roomId = null;
}

function joinRoom(ws, roomId) {
  if (!roomId || typeof roomId !== 'string') {
    logger.auth.warn('Invalid room join request', { roomId, userId: ws.user?.id });
    return;
  }

  leaveRoom(ws);
  ensureRoom(roomId);
  roomClients.get(roomId).add(ws);
  ws.roomId = roomId;

  logger.auth.info('User joined room', {
    userId: ws.user?.id,
    username: ws.user?.username,
    roomId,
    clientCount: roomClients.get(roomId)?.size || 0,
  });

  const history = getRoomMessages(roomId);
  ws.send(JSON.stringify({ type: 'history', roomId, messages: history }));
  logger.message.info('History sent to client', {
    userId: ws.user?.id,
    roomId,
    messageCount: history.length,
  });
}

function broadcastToRoom(roomId, payload) {
  ensureRoom(roomId);
  const message = JSON.stringify(payload);
  for (const client of roomClients.get(roomId)) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }

  logger.message.info('Broadcasted room message', {
    roomId,
    sender: payload.user,
    contentLength: payload.content?.length || 0,
    recipients: roomClients.get(roomId)?.size || 0,
  });
}

wss.on('connection', (ws, req) => {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies.chat_session;
  const session = token ? sessions.get(token) : null;

  if (!session) {
    logger.auth.warn('WebSocket unauthorized connection', { ip: req.socket.remoteAddress });
    ws.close(1008, 'Unauthorized');
    return;
  }

  ws.user = { id: session.userId, username: session.username };
  ws.roomId = null;

  logger.auth.info('WebSocket connected', {
    userId: session.userId,
    username: session.username,
    ip: req.socket.remoteAddress,
  });

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      logger.message.info('WebSocket message received', {
        userId: ws.user?.id,
        username: ws.user?.username,
        type: data.type,
        roomId: data.roomId,
      });

      if (data.type === 'join-room') {
        joinRoom(ws, data.roomId);
        return;
      }

      if (data.type === 'message') {
        const roomId = String(data.roomId || 'general');
        const content = String(data.content || '').trim();

        if (!content) {
          logger.message.warn('Empty message rejected', {
            userId: ws.user?.id,
            roomId,
          });
          ws.send(JSON.stringify({ type: 'error', message: '空のメッセージは送信できません。' }));
          return;
        }

        const saved = saveMessage(roomId, ws.user.id, content);
        const payload = {
          type: 'message',
          roomId,
          user: ws.user.username,
          content: saved.content,
          createdAt: saved.createdAt,
        };

        logger.message.info('Message stored and broadcast', {
          userId: ws.user.id,
          username: ws.user.username,
          roomId,
          messageId: saved.id,
        });

        broadcastToRoom(roomId, payload);
        return;
      }

      if (data.type === 'history') {
        const roomId = String(data.roomId || 'general');
        const messages = getRoomMessages(roomId);
        ws.send(JSON.stringify({ type: 'history', roomId, messages }));
        logger.message.info('History requested by client', {
          userId: ws.user?.id,
          roomId,
          messageCount: messages.length,
        });
        return;
      }

      logger.message.warn('Invalid WebSocket payload', {
        userId: ws.user?.id,
        data,
      });
      ws.send(JSON.stringify({ type: 'error', message: '不正なデータ形式です。' }));
    } catch (error) {
      console.error('WebSocket message parse error:', error);
      logger.message.error('WebSocket message parse error', {
        userId: ws.user?.id,
        error: error.message,
      });
      ws.send(JSON.stringify({ type: 'error', message: 'メッセージの形式が不正です。' }));
    }
  });

  ws.on('close', () => {
    leaveRoom(ws);
    logger.auth.info('WebSocket disconnected', {
      userId: ws.user?.id,
      username: ws.user?.username,
      roomId: ws.roomId,
    });
    console.log(`[ws] ${ws.user.username} disconnected`);
  });

  ws.on('error', (error) => {
    logger.auth.error('WebSocket client error', {
      userId: ws.user?.id,
      username: ws.user?.username,
      error: error.message,
    });
    console.error('[ws] client error:', error.message);
  });

  ws.send(JSON.stringify({ type: 'system', message: `ようこそ、${ws.user.username} さん。` }));
  joinRoom(ws, 'general');
  console.log(`[ws] ${ws.user.username} connected`);
});

app.get(/^(?!\/api|\/health).+$/, (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`Chat app listening on http://localhost:${PORT}`);
});
