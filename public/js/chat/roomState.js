(function (global) {
  const RoomState = {
    // ルームIDを安全な文字列に整形して未定義時のフォールバックを防ぐ。
    normalizeRoomId(roomId = 'general', fallback = 'general') {
      const normalized = roomId && String(roomId).trim() ? String(roomId).trim() : fallback;
      return normalized || fallback;
    },

    // 未読数マップを常に数値ベースで安全に正規化する。
    normalizeUnreadMap(unreadCounts = {}) {
      const normalized = {};

      for (const [roomId, value] of Object.entries(unreadCounts || {})) {
        const safeRoomId = this.normalizeRoomId(roomId, roomId);
        normalized[safeRoomId] = Number(value) || 0;
      }

      return normalized;
    },

    // 指定ルームの未読数を取得して、存在しない場合は 0 を返す。
    getUnreadCount(unreadCounts = {}, roomId = 'general') {
      const normalized = this.normalizeUnreadMap(unreadCounts);
      return Number(normalized[this.normalizeRoomId(roomId)] || 0);
    },

    // 指定ルームの未読数を更新して、保存後のマップを返す。
    setUnreadCount(unreadCounts = {}, roomId = 'general', count = 0) {
      const normalized = this.normalizeUnreadMap(unreadCounts);
      const safeRoomId = this.normalizeRoomId(roomId);
      normalized[safeRoomId] = Number(count) || 0;
      return normalized;
    },

    // ルームを既読にして未読数を 0 に戻す。
    clearUnreadCount(unreadCounts = {}, roomId = 'general') {
      return this.setUnreadCount(unreadCounts, roomId, 0);
    },

    // 既存の未読数と新しい未読数をマージして更新する。
    mergeUnreadCounts(baseUnreadCounts = {}, nextUnreadCounts = {}) {
      return {
        ...this.normalizeUnreadMap(baseUnreadCounts),
        ...this.normalizeUnreadMap(nextUnreadCounts),
      };
    },

    // ルーム一覧から未読数の初期値 0 を作成する。
    createRoomCounts(rooms = []) {
      const nextCounts = {};
      for (const room of rooms) {
        nextCounts[this.normalizeRoomId(room && room.id ? room.id : room)] = 0;
      }
      return nextCounts;
    },

    // 指定ルームの状態を取得し、存在しない場合は初期状態を返す。
    getRoomState(roomStates = {}, roomId = 'general') {
      const normalized = roomStates && typeof roomStates === 'object' ? roomStates : {};
      const safeRoomId = this.normalizeRoomId(roomId);
      return normalized[safeRoomId] || {
        lastMessageId: null,
        scrollPosition: 0,
      };
    },

    // ルームごとの状態を部分更新し、スクロール位置を安全に保持する。
    setRoomState(roomStates = {}, roomId = 'general', patch = {}) {
      const normalized = roomStates && typeof roomStates === 'object' ? { ...roomStates } : {};
      const safeRoomId = this.normalizeRoomId(roomId);
      const current = this.getRoomState(normalized, safeRoomId);

      normalized[safeRoomId] = {
        ...current,
        ...patch,
        scrollPosition: Number.isFinite(Number(patch.scrollPosition)) ? Number(patch.scrollPosition) : current.scrollPosition,
      };

      return normalized;
    },

    // メッセージ一覧から最新メッセージIDを取得する。
    getLatestMessageId(messages = []) {
      if (!Array.isArray(messages) || messages.length === 0) {
        return null;
      }

      const ids = messages
        .map((message) => Number(message.id ?? message.messageId))
        .filter((value) => Number.isFinite(value));

      return ids.length ? Math.max(...ids) : null;
    },
  };

  global.RoomState = RoomState;
})(window);
