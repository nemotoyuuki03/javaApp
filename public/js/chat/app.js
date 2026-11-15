const state = new ChatState();
const pendingScrollSave = { timer: null };
const elements = ChatView.elements;

// エラー表示を共通UIに転送する。
function setError(message) {
  ChatView.setError(message);
}

// ログイン画面を表示してフォームを見せる。
function showLogin() {
  ChatView.showLogin();
}

// チャット画面を表示して現在ユーザー名を更新する。
function showChat() {
  ChatView.showChat(state.user ? state.user.username : '-');
}

// WebSocket接続状態をUIに反映する。
function setConnectionStatus(connected) {
  ChatView.setConnectionStatus(connected);
}

// 最後に見たスクロール位置をアプリ状態に保持する。
function setLastView(roomId, scrollPosition) {
  state.lastView = {
    roomId: roomId || null,
    scrollPosition: Number.isFinite(Number(scrollPosition)) ? Number(scrollPosition) : 0,
  };
}

// サーバーから未読数を取得して画面と状態を更新する。
async function refreshUnreadCounts() {
  if (!state.user) {
    state.resetUnreadCounts();
    ChatView.updateRoomList(state);
    ChatView.refreshRoomSelect(state);
    return;
  }

  try {
    const data = await HttpClient.fetchJson('/api/unread-counts');
    const nextCounts = {};
    for (const room of state.rooms) {
      nextCounts[room.id] = Number(data?.unreadCounts?.[room.id] || 0);
    }
    state.unreadCounts = nextCounts;
  } catch (error) {
    console.error('Unread counts refresh failed:', error);
  }

  ChatView.updateRoomList(state);
  ChatView.refreshRoomSelect(state);
}

// ルームを開いたことをバックエンドに通知して未読数を再計算する。
async function markRoomOpened(roomId) {
  if (!state.user) {
    return;
  }

  const normalizedRoomId = roomId || state.roomId;
  if (!normalizedRoomId) {
    return;
  }

  try {
    const response = await HttpClient.fetchJson('/api/room-opened', {
      method: 'POST',
      body: JSON.stringify({ roomId: normalizedRoomId }),
    });

    if (response && response.roomOpened) {
      state.lastView = {
        roomId: normalizedRoomId,
        scrollPosition: 0,
      };
    }

    await refreshUnreadCounts();
  } catch (error) {
    console.error('Room open update failed:', error);
  }
}

// 現在のスクロール位置をサーバー側の閲覧状態として保存する。
async function saveLastView(roomId = state.roomId, scrollPosition = elements.messageList?.scrollTop || 0) {
  if (!state.user) {
    return;
  }

  const normalizedRoomId = roomId || state.roomId;
  const normalizedScrollPosition = Number.isFinite(Number(scrollPosition)) ? Number(scrollPosition) : 0;
  setLastView(normalizedRoomId, normalizedScrollPosition);

  try {
    await HttpClient.fetchJson('/api/last-view', {
      method: 'POST',
      body: JSON.stringify({ roomId: normalizedRoomId, scrollPosition: normalizedScrollPosition }),
    });
  } catch (error) {
    console.error('Last view save failed:', error);
  }
}

// スクロール位置を遅延保存して無駄な通信を減らす。
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

// 保存済みスクロール位置を元に画面位置を復元する。
function restoreScrollPosition(scrollPosition = state.lastView.scrollPosition) {
  ChatView.restoreScrollPosition(scrollPosition);
}

// 表示中のルーム名を現在選択中の部屋に合わせて更新する。
function updateRoomLabel() {
  ChatView.updateRoomLabel(state);
}

// メッセージがない場合の空状態を描画する。
function renderEmptyState() {
  ChatView.renderEmptyState();
}

// サーバーとブラウザのメッセージ形式差分を正規化する。
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

// ルーム一覧を状態に応じて描画し直す。
function updateRoomList() {
  ChatView.updateRoomList(state);
}

// ルーム選択ドロップダウンの内容を更新する。
function refreshRoomSelect() {
  ChatView.refreshRoomSelect(state);
}

// サーバーからの履歴を汎用のビュー関数に委譲する。
function renderHistory(messages) {
  ChatView.renderHistory(messages, state);
}

// 画面にメッセージを1件追加するためのラッパー関数。
function appendMessage(message) {
  ChatView.appendMessage(message, state.user?.username);
}

// WebSocket にJSONメッセージを送る共通関数。
function sendSocketMessage(payload) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    console.warn('WebSocket is not connected yet.');
    return;
  }

  state.socket.send(JSON.stringify(payload));
}

// 画面の最新メッセージまでスクロールする。
function scrollToLatestMessage() {
  ChatView.scrollToLatestMessage();
}

// 最新メッセージ移動ボタンの表示状態を更新する。
function updateLatestMessageButton() {
  ChatView.updateLatestMessageButton();
}

// ルーム切替時に既読化・保存・再描画・Socket再joinをまとめて実行する。
async function selectRoom(roomId) {
  if (!state.rooms.some((room) => room.id === roomId)) {
    return;
  }

  const previousRoomId = state.roomId;
  const previousScroll = elements.messageList ? elements.messageList.scrollTop : 0;

  // 現在の画面状態を新しいルームへ切り替える前に、以前のルームのスクロール位置を確保する。
  state.roomId = roomId;
  state.markRoomAsRead(roomId);
  updateRoomLabel();
  refreshRoomSelect();
  updateRoomList();

  // 別ルームから移動した場合だけ、前のルームのスクロール位置をバックエンドへ保存する。
  if (state.user && previousRoomId !== roomId) {
    await saveLastView(previousRoomId, previousScroll);
  }

  // 新しいルームの閲覧時刻を0に戻して、ルーム開封時刻を更新する。
  setLastView(roomId, 0);
  await saveLastView(roomId, 0);
  await markRoomOpened(roomId);

  // WebSocket 側でも参加ルームを切り替えて、他のユーザーへ最新状態を反映する。
  if (state.socket && state.socket.readyState === WebSocket.OPEN) {
    sendSocketMessage({ type: 'join-room', roomId });
  }
}

// サーバーから部屋一覧を取得し、初期ルーム選択・未読数・表示状態をセットアップする。
async function loadRooms() {
  const data = await HttpClient.fetchJson('/api/rooms');
  state.rooms = data.rooms || [];
  state.initializeRoomStates();
  state.resetUnreadCounts();

  refreshRoomSelect();
  updateRoomList();

  // 最後に開いていた部屋が存在するならそこを優先し、なければ最初の部屋を選ぶ。
  const preferredRoomId = state.lastView.roomId && state.rooms.some((room) => room.id === state.lastView.roomId)
    ? state.lastView.roomId
    : state.rooms[0]?.id || 'general';

  // 初期表示時には未読数を消し、開封時刻を更新して未読数を再計算する。
  state.roomId = preferredRoomId;
  state.markRoomAsRead(preferredRoomId);
  setLastView(preferredRoomId, 0);
  await markRoomOpened(preferredRoomId);
  await refreshUnreadCounts();
  elements.roomSelect.value = state.roomId;
  updateRoomLabel();
  updateRoomList();
}

// WebSocket のイベントに応じて履歴・メッセージ受信・未読更新を分岐する。
function connectSocket() {
  if (state.socket) {
    state.socket.close();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  state.socket = new WebSocket(`${protocol}://${window.location.host}`);

  // 接続時に現在のルームへ参加して、接続状態インジケータを有効化する。
  state.socket.addEventListener('open', () => {
    setConnectionStatus(true);
    sendSocketMessage({ type: 'join-room', roomId: state.roomId });
  });

  // 切断時は UI の状態を切断扱いに戻す。
  state.socket.addEventListener('close', () => {
    setConnectionStatus(false);
  });

  // 履歴とメッセージイベントを受けて、現在のルームか否かで処理を分ける。
  state.socket.addEventListener('message', (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'history') {
      renderHistory(data.messages || []);
      return;
    }

    // サーバーから未読数更新イベントが来たら、再ログインなしで状態を更新する。
    if (data.type === 'unread-update') {
      state.unreadCounts = { ...data.unreadCounts };
      updateRoomList();
      refreshRoomSelect();
      return;
    }

    if (data.type === 'message') {
      if (data.roomId === state.roomId) {
        appendMessage(normalizeMessagePayload(data));
      } else {
        refreshUnreadCounts().catch((error) => {
          console.error('Unread refresh after message failed:', error);
        });
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

// セッション状態を確認し、ログイン済みならチャット画面を起動する。
async function checkSession() {
  try {
    const response = await fetch('/api/session', {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    });

    if (response.status === 401) {
      showLogin();
      return;
    }

    // HTTP エラー時はログイン画面に戻し、失敗した理由は握りつぶす。
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'セッション確認に失敗しました。');
    }

    if (!data || !data.user) {
      showLogin();
      return;
    }

    // セッション情報が有効なら現在ユーザーと最後の閲覧状態を復元する。
    state.user = data.user;
    state.lastView = data.lastView || { roomId: null, scrollPosition: 0 };
    showChat();
    await loadRooms();
    connectSocket();
  } catch (error) {
    showLogin();
  }
}

// ログイン成功後にユーザー情報と閲覧状態を初期化し、チャット画面へ遷移する。
async function loginWithCredentials(username, password) {
  setError('');

  // 前回のユーザーと違う場合、状態をリセットして別ユーザーの未読情報が混ざらないようにする。
  const previousUserId = state.user?.id;
  if (previousUserId) {
    state.roomId = 'general';
    state.lastView = { roomId: null, scrollPosition: 0 };
  }

  const data = await HttpClient.fetchJson('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

  if (!data || !data.user) {
    throw new Error(data?.error || 'ログインに失敗しました。');
  }

  // 別ユーザーに切り替わった場合は部屋状態とスクロール位置を破棄する。
  const isDifferentUser = previousUserId && previousUserId !== data.user.id;
  if (isDifferentUser) {
    state.roomId = 'general';
    state.lastView = { roomId: null, scrollPosition: 0 };
  }

  // 認証成功後に画面状態を入れ替えて、未読数だけをリセットする。
  state.user = data.user;
  state.lastView = data.lastView || { roomId: null, scrollPosition: 0 };
  state.resetUnreadCounts();

  showChat();
  await loadRooms();
  connectSocket();
}

for (const demoButton of elements.demoButtons) {
  demoButton.addEventListener('click', () => {
    const username = demoButton.dataset.username;
    const password = demoButton.dataset.password;
    elements.usernameInput.value = username;
    elements.passwordInput.value = password;
    loginWithCredentials(username, password).catch((error) => {
      setError(error.message);
    });
  });
}

elements.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = elements.usernameInput.value.trim();
  const password = elements.passwordInput.value;

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
    await HttpClient.fetchJson('/api/logout', { method: 'POST' });
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
