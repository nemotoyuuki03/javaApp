const state = {
  user: null,
  rooms: [],
  roomId: 'general',
  socket: null,
  lastView: { roomId: null, scrollPosition: 0 },
  unreadCounts: {},
};

const pendingScrollSave = { timer: null };

const elements = {
  loginPanel: document.getElementById('login-panel'),
  chatPanel: document.getElementById('chat-panel'),
  loginForm: document.getElementById('login-form'),
  loginError: document.getElementById('login-error'),
  currentUser: document.getElementById('current-user'),
  roomSelect: document.getElementById('room-select'),
  roomList: document.getElementById('room-list'),
  currentRoomName: document.getElementById('current-room-name'),
  messageList: document.getElementById('message-list'),
  messageForm: document.getElementById('message-form'),
  messageInput: document.getElementById('message-input'),
  logoutButton: document.getElementById('logout-button'),
  connectionStatus: document.getElementById('connection-status'),
  demoButtons: document.querySelectorAll('.demo-button'),
  scrollToLatestButton: document.getElementById('scroll-to-latest'),
};

function setError(message) {
  elements.loginError.textContent = message || '';
}

function showLogin() {
  elements.loginPanel.classList.remove('hidden');
  elements.chatPanel.classList.add('hidden');
}

function showChat() {
  elements.loginPanel.classList.add('hidden');
  elements.chatPanel.classList.remove('hidden');
  elements.currentUser.textContent = state.user ? state.user.username : '-';
}

function setConnectionStatus(connected) {
  const dot = elements.connectionStatus.parentElement.querySelector('.status-dot');
  elements.connectionStatus.textContent = connected ? '接続中' : '切断';
  dot.classList.toggle('status-online', connected);
  dot.classList.toggle('status-offline', !connected);
}

function setLastView(roomId, scrollPosition) {
  state.lastView = {
    roomId: roomId || null,
    scrollPosition: Number.isFinite(Number(scrollPosition)) ? Number(scrollPosition) : 0,
  };
}

async function saveLastView(roomId = state.roomId, scrollPosition = elements.messageList?.scrollTop || 0) {
  if (!state.user) {
    return;
  }

  const normalizedRoomId = roomId || state.roomId;
  const normalizedScrollPosition = Number.isFinite(Number(scrollPosition)) ? Number(scrollPosition) : 0;
  setLastView(normalizedRoomId, normalizedScrollPosition);

  try {
    await fetchJson('/api/last-view', {
      method: 'POST',
      body: JSON.stringify({ roomId: normalizedRoomId, scrollPosition: normalizedScrollPosition }),
    });
  } catch (error) {
    console.error('Last view save failed:', error);
  }
}

function saveScrollPositionDebounced() {
  if (!state.user) {
    return;
  }

  const scrollTop = Number(elements.messageList.scrollTop || 0);
  clearTimeout(pendingScrollSave.timer);
  pendingScrollSave.timer = setTimeout(() => {
    saveLastView(state.roomId, scrollTop);
  }, 200);
}

function restoreScrollPosition(scrollPosition = state.lastView.scrollPosition) {
  if (!elements.messageList) {
    return;
  }

  const safePosition = Number.isFinite(Number(scrollPosition)) ? Number(scrollPosition) : 0;
  requestAnimationFrame(() => {
    elements.messageList.scrollTop = Math.max(0, safePosition);
  });
}

function updateRoomLabel() {
  const selectedRoom = state.rooms.find((room) => room.id === state.roomId) || state.rooms[0];
  elements.currentRoomName.textContent = selectedRoom ? selectedRoom.name : 'General';
}

function renderEmptyState() {
  const empty = document.createElement('div');
  empty.className = 'message empty-state';
  empty.textContent = 'まだメッセージがありません。最初の一言を送ってみましょう。';
  elements.messageList.appendChild(empty);
}

function normalizeMessagePayload(message = {}) {
  const username = message.user ?? message.username ?? message.senderName ?? 'unknown';
  const createdAt = message.createdAt ?? message.created_at ?? new Date().toISOString();
  return {
    ...message,
    user: username,
    createdAt,
    content: message.content ?? '',
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    if (url === '/api/session' || url === '/api/last-view' || url === '/api/rooms' || url === '/api/history') {
      return { ok: false, error: data.error || '未認証です。', user: null, lastView: null, rooms: [] };
    }
  }

  if (!response.ok) {
    throw new Error(data.error || 'リクエストに失敗しました。');
  }
  return data;
}

function updateRoomList() {
  if (!elements.roomList) {
    return;
  }

  elements.roomList.innerHTML = '';
  for (const room of state.rooms) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `room-item ${state.roomId === room.id ? 'active' : ''}`;
    button.dataset.roomId = room.id;
    button.innerHTML = `
      <span class="room-name">${room.name}</span>
      ${state.unreadCounts[room.id] ? `<span class="unread-badge">${state.unreadCounts[room.id]}</span>` : ''}
    `;
    button.addEventListener('click', () => {
      selectRoom(room.id);
    });
    elements.roomList.appendChild(button);
  }
}

function refreshRoomSelect() {
  if (!elements.roomSelect) {
    return;
  }

  elements.roomSelect.innerHTML = state.rooms
    .map((room) => `<option value="${room.id}">${room.name}${state.unreadCounts[room.id] ? ` (${state.unreadCounts[room.id]})` : ''}</option>`)
    .join('');

  if (state.roomId) {
    elements.roomSelect.value = state.roomId;
  }
}

async function selectRoom(roomId) {
  if (!state.rooms.some((room) => room.id === roomId)) {
    return;
  }

  const previousRoomId = state.roomId;
  const previousScroll = elements.messageList ? elements.messageList.scrollTop : 0;

  state.roomId = roomId;
  state.unreadCounts[roomId] = 0;
  updateRoomLabel();
  refreshRoomSelect();
  updateRoomList();

  if (state.user && previousRoomId !== roomId) {
    await saveLastView(previousRoomId, previousScroll);
  }

  setLastView(roomId, 0);
  await saveLastView(roomId, 0);

  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    sendSocketMessage({ type: 'join-room', roomId });
  }
}

async function loadRooms() {
  const data = await fetchJson('/api/rooms');
  state.rooms = data.rooms || [];

  state.unreadCounts = {};
  for (const room of state.rooms) {
    state.unreadCounts[room.id] = 0;
  }

  refreshRoomSelect();
  updateRoomList();

  const preferredRoomId = state.lastView.roomId && state.rooms.some((room) => room.id === state.lastView.roomId)
    ? state.lastView.roomId
    : state.rooms[0]?.id || 'general';

  state.roomId = preferredRoomId;
  state.unreadCounts[preferredRoomId] = 0;
  elements.roomSelect.value = state.roomId;
  updateRoomLabel();
  updateRoomList();
}

function updateLatestMessageButton() {
  if (!elements.messageList || !elements.scrollToLatestButton) {
    return;
  }

  const isNearBottom = elements.messageList.scrollHeight - elements.messageList.scrollTop - elements.messageList.clientHeight < 120;
  elements.scrollToLatestButton.classList.toggle('hidden', isNearBottom);
}

function scrollToLatestMessage() {
  if (!elements.messageList) {
    return;
  }

  elements.messageList.scrollTop = elements.messageList.scrollHeight;
  updateLatestMessageButton();
}

function appendMessage(message) {
  const normalized = normalizeMessagePayload(message);
  const username = normalized.user;
  const item = document.createElement('div');
  item.className = `message ${username === state.user?.username ? 'mine' : ''}`;
  item.innerHTML = `
    <div class="message-header">
      <span>${username}</span>
      <span>${new Date(normalized.createdAt).toLocaleString('ja-JP')}</span>
    </div>
    <div class="message-content">${normalized.content}</div>
  `;
  elements.messageList.appendChild(item);
  elements.messageList.scrollTop = elements.messageList.scrollHeight;
  updateLatestMessageButton();
}

function renderHistory(messages = []) {
  elements.messageList.innerHTML = '';
  if (!messages.length) {
    renderEmptyState();
    updateLatestMessageButton();
    return;
  }

  messages.forEach((message) => appendMessage(normalizeMessagePayload(message)));
  restoreScrollPosition(state.lastView.roomId === state.roomId ? state.lastView.scrollPosition : 0);
  updateLatestMessageButton();
}

function sendSocketMessage(payload) {
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    state.socket.send(JSON.stringify(payload));
  }
}

function connectSocket() {
  if (state.socket) {
    state.socket.close();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  state.socket = new WebSocket(`${protocol}://${window.location.host}`);

  state.socket.addEventListener('open', () => {
    setConnectionStatus(true);
    sendSocketMessage({ type: 'join-room', roomId: state.roomId });
  });

  state.socket.addEventListener('close', () => {
    setConnectionStatus(false);
  });

  state.socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'history') {
      renderHistory(data.messages || []);
      return;
    }

    if (data.type === 'message') {
      if (data.roomId === state.roomId) {
        appendMessage(normalizeMessagePayload(data));
      } else {
        const currentCount = Number(state.unreadCounts[data.roomId] || 0) + 1;
        state.unreadCounts[data.roomId] = currentCount;
        refreshRoomSelect();
        updateRoomList();
      }
      return;
    }

    if (data.type === 'system') {
      console.log(data.message);
      return;
    }

    if (data.type === 'error') {
      alert(data.message);
    }
  });
}

async function checkSession() {
  try {
    const response = await fetch('/api/session', {
      headers: { 'Content-Type': 'application/json' },
    });

    if (response.status === 401) {
      showLogin();
      return;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'セッション確認に失敗しました。');
    }

    if (!data || !data.user) {
      showLogin();
      return;
    }

    state.user = data.user;
    state.lastView = data.lastView || { roomId: null, scrollPosition: 0 };
    showChat();
    await loadRooms();
    connectSocket();
  } catch (error) {
    showLogin();
  }
}

function resetUnreadCounts() {
  state.unreadCounts = {};
  for (const room of state.rooms) {
    state.unreadCounts[room.id] = 0;
  }
}

async function loginWithCredentials(username, password) {
  setError('');

  const previousUserId = state.user?.id;
  if (previousUserId) {
    state.roomId = 'general';
    state.lastView = { roomId: null, scrollPosition: 0 };
  }

  const data = await fetchJson('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

  if (!data || !data.user) {
    throw new Error(data?.error || 'ログインに失敗しました。');
  }

  const isDifferentUser = previousUserId && previousUserId !== data.user.id;
  if (isDifferentUser) {
    state.roomId = 'general';
    state.lastView = { roomId: null, scrollPosition: 0 };
  }

  state.user = data.user;
  state.lastView = data.lastView || { roomId: null, scrollPosition: 0 };
  resetUnreadCounts();

  showChat();
  await loadRooms();
  connectSocket();
}

for (const demoButton of elements.demoButtons) {
  demoButton.addEventListener('click', () => {
    const username = demoButton.dataset.username;
    const password = demoButton.dataset.password;
    document.getElementById('username').value = username;
    document.getElementById('password').value = password;
    loginWithCredentials(username, password).catch((error) => {
      setError(error.message);
    });
  });
}

elements.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    await loginWithCredentials(username, password);
    elements.loginForm.reset();
  } catch (error) {
    setError(error.message);
  }
});

elements.roomSelect.addEventListener('change', () => {
  selectRoom(elements.roomSelect.value);
});

elements.messageList.addEventListener('scroll', () => {
  saveScrollPositionDebounced();
  updateLatestMessageButton();
});

elements.scrollToLatestButton.addEventListener('click', () => {
  scrollToLatestMessage();
});

elements.logoutButton.addEventListener('click', async () => {
  try {
    if (state.user) {
      const currentScroll = elements.messageList ? elements.messageList.scrollTop : 0;
      await saveLastView(state.roomId, currentScroll);
    }
    await fetchJson('/api/logout', { method: 'POST' });
    state.user = null;
    if (state.socket) {
      state.socket.close();
      state.socket = null;
    }
    showLogin();
  } catch (error) {
    console.error(error);
  }
});

elements.messageForm.addEventListener('submit', (event) => {
  event.preventDefault();

  if (!state.user) {
    showLogin();
    return;
  }

  const content = elements.messageInput.value.trim();
  if (!content) {
    return;
  }

  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    console.warn('WebSocket is not connected yet.');
    return;
  }

  sendSocketMessage({ type: 'message', roomId: state.roomId, content });
  elements.messageInput.value = '';
});

checkSession();
