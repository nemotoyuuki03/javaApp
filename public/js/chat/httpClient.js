(function (global) {
  class HttpClient {
    static async fetchJson(url, options = {}) {
      const response = await fetch(url, {
        credentials: 'same-origin',
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
  }

  global.HttpClient = HttpClient;
})(window);
