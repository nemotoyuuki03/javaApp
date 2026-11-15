(function (global) {
  class ChatState {
    // アプリ全体のユーザー情報と部屋状態を初期化する。
    constructor() {
      this.user = null;
      this.rooms = [];
      this.roomId = 'general';
      this.socket = null;
      this.lastView = { roomId: null, scrollPosition: 0 };
      this.unreadCounts = {};
      this.roomStates = {};
    }

    // 指定ルームの状態を取得し、未定義なら初期値を作成して返す。
    getRoomState(roomId = this.roomId) {
      const safeRoomId = RoomState.normalizeRoomId(roomId, 'general');
      if (!this.roomStates[safeRoomId]) {
        this.roomStates[safeRoomId] = { lastMessageId: null, scrollPosition: 0 };
      }
      return this.roomStates[safeRoomId];
    }

    // ルーム状態の一部だけを更新して、最新状態を返す。
    updateRoomState(roomId = this.roomId, patch = {}) {
      const safeRoomId = RoomState.normalizeRoomId(roomId, 'general');
      this.roomStates[safeRoomId] = {
        ...this.getRoomState(safeRoomId),
        ...patch,
      };
      return this.roomStates[safeRoomId];
    }

    // 指定ルームの未読数を返す。未設定なら 0 を返す。
    getUnreadCount(roomId = this.roomId) {
      return RoomState.getUnreadCount(this.unreadCounts, roomId);
    }

    // ルームごとの未読数を保存し、更新後の全体マップを返す。
    setUnreadCount(roomId, count) {
      this.unreadCounts = RoomState.setUnreadCount(this.unreadCounts, roomId, count);
      return this.unreadCounts;
    }

    // 指定ルームを既読として未読数を 0 に戻す。
    markRoomAsRead(roomId = this.roomId) {
      this.unreadCounts = RoomState.clearUnreadCount(this.unreadCounts, roomId);
      return this.unreadCounts;
    }

    // 現在の部屋一覧から未読数の初期マップを再生成する。
    resetUnreadCounts() {
      this.unreadCounts = RoomState.createRoomCounts(this.rooms);
      return this.unreadCounts;
    }

    // ルーム一覧に合わせて各部屋の描画用メモリ状態を初期化する。
    initializeRoomStates() {
      this.roomStates = {};
      for (const room of this.rooms) {
        const roomId = room && room.id ? room.id : 'general';
        this.roomStates[roomId] = {
          lastMessageId: null,
          scrollPosition: 0,
        };
      }
      return this.roomStates;
    }
  }

  global.ChatState = ChatState;
})(window);
