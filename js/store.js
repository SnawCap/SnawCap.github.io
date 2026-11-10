/* ==========================================================================
   store.js — 本机记忆与会话缓存
   说明：
     · localStorage 记住「用户偏好」：UID、上次收藏夹/视频、统计口径、成册设置；
     · sessionStorage 缓存「接口数据」：用户+收藏夹列表、收藏夹视频，5 分钟内跨页面复用；
     · 不向服务器写入任何内容。
   ========================================================================== */
(function (Folio) {
  'use strict';

  const U = Folio.Utils;
  const keys = () => Folio.Config.storage;

  const CACHE_TTL = 5 * 60 * 1000;   // 接口缓存有效期
  const CACHE_MAX_BYTES = 2 * 1024 * 1024; // 单条缓存上限，超出放弃缓存

  const session = {
    get(key) {
      try { return sessionStorage.getItem(key); } catch (err) { return null; }
    },
    set(key, value) {
      try { sessionStorage.setItem(key, value); return true; } catch (err) { return false; }
    },
    remove(key) {
      try { sessionStorage.removeItem(key); } catch (err) { /* ignore */ }
    }
  };

  function cacheKey(name) {
    return `${keys().cachePrefix}${name}`;
  }

  function readCache(name) {
    const raw = session.get(cacheKey(name));
    if (!raw) return null;
    try {
      const entry = JSON.parse(raw);
      if (!entry || typeof entry.at !== 'number') return null;
      if (Date.now() - entry.at > CACHE_TTL) {
        session.remove(cacheKey(name));
        return null;
      }
      return entry.data;
    } catch (err) {
      return null;
    }
  }

  function writeCache(name, data) {
    try {
      const raw = JSON.stringify({ at: Date.now(), data });
      if (raw.length > CACHE_MAX_BYTES) return false;
      return session.set(cacheKey(name), raw);
    } catch (err) {
      return false;
    }
  }

  const Store = {
    cacheTtl: CACHE_TTL,

    /* ---------- 长期记忆 ---------- */
    getUid() {
      const uid = U.storage.get(keys().uid);
      return uid && U.uidValid(uid) ? String(uid) : '';
    },
    setUid(uid) {
      if (uid) U.storage.set(keys().uid, String(uid));
    },

    // { uid, id, title, at }
    getLastFolder() {
      const saved = U.storage.getJSON(keys().lastFolder, null);
      return saved && saved.id ? saved : null;
    },
    setLastFolder(info) {
      if (!info || !info.id) return;
      U.storage.setJSON(keys().lastFolder, {
        uid: String(info.uid || ''),
        id: String(info.id),
        title: String(info.title || ''),
        at: Date.now()
      });
    },

    // 每本收藏夹单独记一个「上次看到哪支视频」，值优先用 BVID
    getLastVideo(folderId) {
      return U.storage.get(`${keys().lastVideoPrefix}${folderId}`) || '';
    },
    setLastVideo(folderId, key) {
      if (folderId && key) U.storage.set(`${keys().lastVideoPrefix}${folderId}`, String(key));
    },

    getStatsMode() {
      return U.storage.get(keys().statsMode) === 'all' ? 'all' : 'first';
    },
    setStatsMode(mode) {
      U.storage.set(keys().statsMode, mode === 'all' ? 'all' : 'first');
    },

    getOutputs() {
      const saved = U.storage.getJSON(keys().outputs, null) || {};
      return {
        showUp: saved.showUp !== false,
        allowRepost: saved.allowRepost !== false
      };
    },
    setOutputs(next) {
      const saved = Object.assign({ showUp: true, allowRepost: true }, Store.getOutputs(), next || {});
      U.storage.setJSON(keys().outputs, {
        showUp: saved.showUp !== false,
        allowRepost: saved.allowRepost !== false
      });
    },

    /* ---------- 会话缓存 ---------- */
    cacheSpace(uid, data) {
      if (!uid || !data) return false;
      const folders = (data.folders || []).map((folder) => ({
        id: String(folder.id),
        fid: String(folder.fid || ''),
        title: folder.title || '',
        mediaCount: Number(folder.mediaCount) || 0,
        attr: Number(folder.attr) || 0,
        covers: Array.isArray(folder.covers) ? folder.covers.slice(0, 3) : null,
        videos: null
      }));
      return writeCache(`space:${uid}`, { user: data.user || null, folders });
    },
    readSpace(uid) {
      return uid ? readCache(`space:${uid}`) : null;
    }
  };

  Folio.Store = Store;
})(window.Folio = window.Folio || {});
