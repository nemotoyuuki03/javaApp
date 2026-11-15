(function (global) {
  const ChatView = {
    elements: {
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
      usernameInput: document.getElementById('username'),
      passwordInput: document.getElementById('password'),
      logoutButton: document.getElementById('logout-button'),
      connectionStatus: document.getElementById('connection-status'),
      demoButtons: document.querySelectorAll('.demo-button'),
      scrollToLatestButton: document.getElementById('scroll-to-latest'),
    },

    // ログインエラー文を画面に表示する。
    setError(message) {
      this.elements.loginError.textContent = message || '';
    },

    // ログイン画面を表示してチャット画面を隠す。
    showLogin() {
      this.elements.loginPanel.classList.remove('hidden');
      this.elements.chatPanel.classList.add('hidden');
    },

    // チャット画面を表示して現在の利用者名を設定する。
    showChat(userName) {
      this.elements.loginPanel.classList.add('hidden');
      this.elements.chatPanel.classList.remove('hidden');
      this.elements.currentUser.textContent = userName || '-';
    },

    // WebSocket接続状態をラベルとドット色で更新する。
    setConnectionStatus(connected) {
      const dot = this.elements.connectionStatus.parentElement.querySelector('.status-dot');
      this.elements.connectionStatus.textContent = connected ? '接続中' : '切断';
      dot.classList.toggle('status-online', connected);
      dot.classList.toggle('status-offline', !connected);
    },

    // 現在選択中の部屋名をヘッダーに反映する。
    updateRoomLabel(state) {
      const selectedRoom = state.rooms.find((room) => room.id === state.roomId) || state.rooms[0];
      this.elements.currentRoomName.textContent = selectedRoom ? selectedRoom.name : 'General';
    },

    // メッセージがない場合の案内表示を追加する。
    renderEmptyState() {
      const empty = document.createElement('div');
      empty.className = 'message empty-state';
      empty.textContent = 'まだメッセージがありません。最初の一言を送ってみましょう。';
      this.elements.messageList.appendChild(empty);
    },

    // ルーム一覧を未読数付きで再描画する。
    updateRoomList(state) {
      if (!this.elements.roomList) {
        return;
      }

      this.elements.roomList.innerHTML = '';
      for (const room of state.rooms) {
        const unreadCount = state.getUnreadCount(room.id);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `room-item ${state.roomId === room.id ? 'active' : ''} ${unreadCount > 0 ? 'has-unread' : ''}`;
        button.dataset.roomId = room.id;
        button.innerHTML = `
          <span class='room-name-wrap'>
            <span class='room-name'>${room.name}</span>
            ${unreadCount > 0 ? '<span class="unread-dot" aria-label="未読メッセージあり"></span>' : ''}
          </span>
          ${unreadCount > 0 ? `<span class='unread-badge'>${unreadCount}</span>` : ''}
        `;
        button.addEventListener('click', () => {
          state.roomId = room.id;
          window.selectRoom(room.id);
        });
        this.elements.roomList.appendChild(button);
      }
    },

    // ルーム選択ドロップダウンに未読数サフィックスを付けて表示する。
    refreshRoomSelect(state) {
      if (!this.elements.roomSelect) {
        return;
      }

      this.elements.roomSelect.innerHTML = state.rooms
        .map((room) => {
          const unreadCount = state.getUnreadCount(room.id);
          const suffix = unreadCount > 0 ? `（${unreadCount}）` : '';
          return `<option value="${room.id}">${room.name}${suffix}</option>`;
        })
        .join('');

      if (state.roomId) {
        this.elements.roomSelect.value = state.roomId;
      }
    },

    // 一番下に近いときだけ最新メッセージ移動ボタンを表示する。
    updateLatestMessageButton() {
      if (!this.elements.messageList || !this.elements.scrollToLatestButton) {
        return;
      }

      const isNearBottom = this.elements.messageList.scrollHeight - this.elements.messageList.scrollTop - this.elements.messageList.clientHeight < 120;
      this.elements.scrollToLatestButton.classList.toggle('hidden', isNearBottom);
    },

    // 最新メッセージまでスクロールして見える位置を調整する。
    scrollToLatestMessage() {
      if (!this.elements.messageList) {
        return;
      }

      this.elements.messageList.scrollTop = this.elements.messageList.scrollHeight;
      this.updateLatestMessageButton();
    },

    // メッセージを1件追加して表示する。
    appendMessage(message, currentUserName) {
      const normalized = {
        ...message,
        user: message.user ?? message.username ?? message.senderName ?? 'unknown',
        createdAt: message.createdAt ?? message.created_at ?? new Date().toISOString(),
        content: message.content ?? '',
      };
      const username = normalized.user;
      const createdAt = normalized.createdAt;
      const item = document.createElement('div');
      item.className = `message ${username === currentUserName ? 'mine' : ''}`;
      item.innerHTML = `
        <div class="message-header">
          <span>${username}</span>
          <span>${new Date(createdAt).toLocaleString('ja-JP')}</span>
        </div>
        <div class="message-content">${normalized.content}</div>
      `;
      this.elements.messageList.appendChild(item);
      this.elements.messageList.scrollTop = this.elements.messageList.scrollHeight;
      this.updateLatestMessageButton();
    },

    // 履歴を初期化してメッセージ一覧として再描画する。
    renderHistory(messages, state) {
      this.elements.messageList.innerHTML = '';
      if (!messages.length) {
        this.renderEmptyState();
        this.updateLatestMessageButton();
        return;
      }

      messages.forEach((message) => {
        this.appendMessage({
          ...message,
          user: message.user ?? message.username ?? message.senderName ?? 'unknown',
        }, state.user?.username);
      });

      const scrollPosition = state.lastView.roomId === state.roomId ? state.lastView.scrollPosition : 0;
      this.restoreScrollPosition(scrollPosition);
      this.updateLatestMessageButton();
    },

    // 保存されたスクロール位置を安全に復元する。
    restoreScrollPosition(scrollPosition = 0) {
      if (!this.elements.messageList) {
        return;
      }

      const safePosition = Number.isFinite(Number(scrollPosition)) ? Number(scrollPosition) : 0;
      requestAnimationFrame(() => {
        this.elements.messageList.scrollTop = Math.max(0, safePosition);
      });
    },
  };

  global.ChatView = ChatView;
})(window);
