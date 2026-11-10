/* ==========================================================================
   utils.js — 通用工具（DOM / 格式化 / 存储 / 剪贴板）
   ========================================================================== */
(function (Folio) {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  const pad2 = (n) => String(n).padStart(2, '0');

  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
  };

  const formatDate = (unixSeconds) => {
    if (!unixSeconds) return '';
    const d = new Date(unixSeconds * 1000);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };

  /* ---------- 时间格式 ---------- */
  // 2:03 / 1:02:03
  const formatDuration = (seconds) => {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    return s >= 3600
      ? `${Math.floor(s / 3600)}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`
      : `${Math.floor(s / 60)}:${pad2(s % 60)}`;
  };

  // 01:02:03
  const formatHMS = (seconds) => {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
  };

  // 2 小时 3 分 4 秒
  const formatCn = (seconds) => {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rest = s % 60;
    return h ? `${h} 小时 ${m} 分 ${rest} 秒` : (m ? `${m} 分 ${rest} 秒` : `${rest} 秒`);
  };

  const formatCount = (n) => {
    const num = Number(n) || 0;
    if (num >= 100000000) return `${(num / 100000000).toFixed(1)}亿`;
    if (num >= 10000) return `${(num / 10000).toFixed(1)}万`;
    return String(num);
  };

  /* ---------- 视频时长模型 ----------
     video = { dur, pages:[{ d, ... }] }
     dur 为全部分 P 的秒数合计；pages 至少有一个元素（单 P 也归一化为 1 个）。
  ------------------------------------- */
  const firstDuration = (video) => {
    if (!video) return 0;
    return video.pages && video.pages.length ? Number(video.pages[0].d) || 0 : Number(video.dur) || 0;
  };

  const videoDuration = (video, mode) =>
    mode === 'first' ? firstDuration(video) : Number(video.dur) || 0;

  const folderStats = (folder, mode) => {
    const videos = (folder && folder.videos) || [];
    let total = 0;
    let multi = 0;
    videos.forEach((v) => {
      total += videoDuration(v, mode);
      if (v.pages && v.pages.length > 1) multi += 1;
    });
    return {
      total,
      multi,
      count: videos.length,
      avg: videos.length ? total / videos.length : 0
    };
  };

  /* ---------- 本地存储 ---------- */
  const storage = {
    get(key, fallback = null) {
      try {
        const value = localStorage.getItem(key);
        return value == null ? fallback : value;
      } catch (err) {
        return fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(key, value); return true; } catch (err) { return false; }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch (err) { /* ignore */ }
    },
    getJSON(key, fallback = null) {
      const raw = this.get(key);
      if (raw == null) return fallback;
      try { return JSON.parse(raw); } catch (err) { return fallback; }
    },
    setJSON(key, value) {
      return this.set(key, JSON.stringify(value));
    }
  };

  /* ---------- 剪贴板 ---------- */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  /* ---------- 其他 ---------- */
  const debounce = (fn, wait = 250) => {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  };

  const randomCode = (length = 6) => {
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < length; i += 1) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  };

  const icon = (name) => (Folio.Icons && Folio.Icons[name]) || '';

  const fillIcons = (root = document) => {
    $$('[data-ic]', root).forEach((el) => {
      const svg = icon(el.dataset.ic);
      if (svg) el.innerHTML = svg;
    });
  };

  const uidValid = (uid) => /^\d{1,12}$/.test(String(uid || '').trim());

  Folio.Utils = {
    $, $$, esc, pad2, today, formatDate,
    formatDuration, formatHMS, formatCn, formatCount,
    firstDuration, videoDuration, folderStats,
    storage, copyText, debounce, randomCode,
    icon, fillIcons, uidValid
  };
})(window.Folio = window.Folio || {});
