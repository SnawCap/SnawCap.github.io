/* ==========================================================================
   brief.js — 简报数据、HTML 清理、载荷校验（PDF 导出/导入共用）

   为什么单独抽出来：
     Word 导出已移除；PDF 导出与回导仍需要同一套
     sanitize / checksum / 校验逻辑，放在这里避免复制两份。
   ========================================================================== */
(function (Folio) {
  'use strict';

  const CFG = (Folio.Config && Folio.Config.brief) || {};
  const MARKER = CFG.marker || 'FOLIO-BRIEF';
  const SCHEMA = Number(CFG.schemaVersion) || 1;
  const MAX_FILE = Number(CFG.maxFileSize) || 80 * 1024 * 1024;

  // 品牌从「藏册 Folio」改为「雪哔」后，旧版导出的 PDF 仍要能导入
  const GENERATORS = ['雪哔', '藏册 Folio'];

  const ALLOWED_TAGS = new Set([
    'P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'FONT',
    'BLOCKQUOTE', 'HR', 'UL', 'OL', 'LI',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'FIGURE', 'FIGCAPTION', 'SPAN', 'IMG'
  ]);
  const DROP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META',
    'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT',
    'CANVAS', 'VIDEO', 'AUDIO', 'SOURCE', 'BASE'
  ]);
  const KEEP_CLASSES = new Set(['media-block', 'media-wrap', 'inline-fig', 'orig-size']);

  class BriefError extends Error {
    constructor(code, message) {
      super(message || '简报文件处理失败');
      this.name = 'BriefError';
      this.code = code;
    }
  }

  /* ═══════════ base64url / 校验和 ═══════════ */
  function bytesToBase64Url(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function base64UrlToBytes(code) {
    const base64 = String(code || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function encodePayload(payload) {
    return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  }

  function decodePayload(code) {
    return new TextDecoder().decode(base64UrlToBytes(code));
  }

  /** FNV-1a 32 位：用于发现载荷被改动/截断，不承担密码学安全。 */
  function checksumOf(payload) {
    const clone = {};
    Object.keys(payload || {}).forEach((key) => {
      if (key !== 'checksum') clone[key] = payload[key];
    });
    const text = JSON.stringify(clone);
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  /* ═══════════ HTML 清理 ═══════════ */
  function normalizeColor(value) {
    if (!value) return null;
    const text = String(value).trim();
    if (/^#[0-9a-f]{6}$/i.test(text)) return text.toUpperCase();
    if (/^#[0-9a-f]{3}$/i.test(text)) {
      return `#${text.slice(1).split('').map((ch) => ch + ch).join('')}`.toUpperCase();
    }
    const match = text.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
    if (match) {
      const hex = match.slice(1, 4).map((part) => (
        Math.min(255, Number(part)).toString(16).padStart(2, '0')
      )).join('');
      return `#${hex}`.toUpperCase();
    }
    return null;
  }

  /**
   * 导出和导入共用：只保留编辑器实际产生的结构。
   * 导入文件来自用户本机，必须按白名单清理，避免把 script / 事件属性写回编辑器。
   */
  function sanitizeIntro(html) {
    // 用临时 div 而不是 template.content：DocumentFragment 没有 innerHTML。
    const container = document.createElement('div');
    container.innerHTML = String(html || '');
    const content = container;

    content.querySelectorAll(Array.from(DROP_TAGS).join(',')).forEach((node) => node.remove());
    content.querySelectorAll('.anno-bar,.media-actions,.inline-actions').forEach((node) => node.remove());

    Array.from(content.querySelectorAll('*')).forEach((el) => {
      const tag = el.tagName;
      if (!ALLOWED_TAGS.has(tag)) {
        el.replaceWith(document.createTextNode(el.textContent || ''));
        return;
      }

      Array.from(el.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        if (name === 'class') {
          const kept = attr.value.split(/\s+/).filter((token) => KEEP_CLASSES.has(token));
          if (kept.length) el.setAttribute('class', kept.join(' '));
          else el.removeAttribute('class');
        } else if (name === 'src' && tag === 'IMG') {
          if (!/^(data:image\/(?:png|jpe?g|gif|webp);base64,|https?:\/\/)/i.test(attr.value)) {
            el.removeAttribute('src');
          }
        } else if (name === 'alt' || name === 'title') {
          // 保留
        } else if (name === 'color' && tag === 'FONT') {
          const color = normalizeColor(attr.value);
          if (color) el.setAttribute('color', color);
          else el.removeAttribute('color');
        } else if (name === 'style') {
          const color = normalizeColor(el.style && el.style.color);
          if (color) el.setAttribute('style', `color:${color}`);
          else el.removeAttribute('style');
        } else if (name === 'contenteditable') {
          if (tag === 'FIGURE' || (tag === 'SPAN' && el.classList.contains('inline-fig'))) {
            el.setAttribute('contenteditable', 'false');
          } else {
            el.removeAttribute('contenteditable');
          }
        } else {
          el.removeAttribute(attr.name);
        }
      });

      if (tag === 'IMG' && !el.getAttribute('src')) el.remove();
    });

    content.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || '';
      if (/^https?:\/\//i.test(src)) img.setAttribute('crossorigin', 'anonymous');
      img.setAttribute('referrerpolicy', 'no-referrer');
    });
    content.querySelectorAll('figure').forEach((fig) => {
      if (fig.querySelector('img')) fig.classList.add('media-block');
    });
    content.querySelectorAll('.anno-canvas').forEach((node) => node.remove());
    return content.innerHTML;
  }

  /* ═══════════ 载荷 ═══════════ */
  function buildPayload(folder, user, options, entries) {
    const payload = {
      magic: MARKER,
      schema: SCHEMA,
      generator: '雪哔',
      createdAt: Date.now(),
      folder: {
        id: String(folder.id || ''),
        title: folder.title || ''
      },
      user: {
        mid: String((user && user.mid) || ''),
        name: (user && user.name) || ''
      },
      options: {
        showUp: options.showUp !== false,
        allowRepost: options.allowRepost !== false
      },
      videos: entries.map(({ video, intro }) => ({
        id: String(video.id || ''),
        bvid: String(video.bvid || ''),
        title: video.title || '',
        up: video.up || '',
        dur: Number(video.dur) || 0,
        play: video.play || '',
        pages: (video.pages || []).map((page) => ({
          title: page.title || page.t || 'P1',
          d: Number(page.d) || 0
        })),
        done: !!video.done,
        intro: intro || ''
      }))
    };
    payload.checksum = checksumOf(payload);
    return payload;
  }

  function findVideo(videos, item) {
    if (!item || typeof item !== 'object') return null;
    const bvid = String(item.bvid || '').toLowerCase();
    const id = String(item.id || '');
    return (videos || []).find((video) => (
      (bvid && String(video.bvid || '').toLowerCase() === bvid) ||
      (id && String(video.id || '') === id)
    )) || null;
  }

  function validatePayload(payload, expectedFolder) {
    if (!payload || typeof payload !== 'object') {
      throw new BriefError('BAD_PAYLOAD', '文件中的雪哔数据格式异常，已拒绝导入。');
    }
    if (payload.magic !== MARKER || !GENERATORS.includes(String(payload.generator || ''))) {
      throw new BriefError('NOT_FOLIO', '这个文件不是由雪哔生成的，已拒绝导入。');
    }
    if (Number(payload.schema) !== SCHEMA) {
      throw new BriefError('SCHEMA', `文件的格式版本（${payload.schema}）与当前页面不一致，请使用同一版本的雪哔导入。`);
    }
    if (!payload.checksum || payload.checksum !== checksumOf(payload)) {
      throw new BriefError('CORRUPTED', '文件中的雪哔数据已损坏或被修改，已拒绝导入。');
    }
    if (!payload.folder || !String(payload.folder.id || '')) {
      throw new BriefError('NOT_FOLIO', '这个文件缺少收藏夹信息，不是有效的雪哔文件。');
    }
    if (!Array.isArray(payload.videos)) {
      throw new BriefError('BAD_PAYLOAD', '文件中的简报列表格式异常，已拒绝导入。');
    }
    if (expectedFolder) {
      if (String(payload.folder.id) !== String(expectedFolder.id)) {
        throw new BriefError(
          'FOLDER_MISMATCH',
          `这个文件属于《${payload.folder.title || '未知收藏夹'}》（收藏夹 ${payload.folder.id}），` +
          `不是当前收藏夹《${expectedFolder.title}》（收藏夹 ${expectedFolder.id}），已拒绝导入。`
        );
      }
      const currentVideos = expectedFolder.videos || [];
      const matched = payload.videos.filter((item) => findVideo(currentVideos, item));
      if (!matched.length) {
        throw new BriefError('NO_MATCH', '文件里的视频与当前收藏夹没有匹配项，可能收藏夹内容已变化，已拒绝导入。');
      }
    }
    return true;
  }

  Folio.BriefError = BriefError;
  Folio.Brief = {
    MARKER,
    SCHEMA,
    MAX_FILE,
    sanitizeIntro,
    normalizeColor,
    checksumOf,
    encodePayload,
    decodePayload,
    bytesToBase64Url,
    base64UrlToBytes,
    buildPayload,
    validatePayload,
    findVideo
  };
})(window.Folio = window.Folio || {});
