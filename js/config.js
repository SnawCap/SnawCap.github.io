/* ==========================================================================
   config.js — 全局配置与图标库
   说明：只放常量，不放业务逻辑；所有模块通过 window.Folio 命名空间通信。
   ========================================================================== */
(function (Folio) {
  'use strict';

  Folio.Config = {
    appName: '雪哔',
    appEn: 'SnawCap',
    author: '山顶小雪球',
    keywords: ['SnawCap', 'BILITIME'],
    version: '0.9.3',

    // localStorage 键名统一收口，避免散落在业务代码里
    storage: {
      theme: 'folio-theme',
      uid: 'folio-uid',
      rate: 'folio-rate-hour',
      urgent: 'folio-urgent-hour',
      draftPrefix: 'folio-draft:',
      backend: 'folio-api-backend',
      lastFolder: 'folio-last-folder',
      lastVideoPrefix: 'folio-last-video:',
      statsMode: 'folio-stats-mode',
      outputs: 'folio-output-options',
      cachePrefix: 'folio-cache:'
    },

    api: {
      // 后端地址：同域 PHP 用 './api/biliapi.php'；Cloudflare Worker 可填完整地址。
      // 运行期也可用 Folio.ApiClient.setBackend('https://...') 覆盖（保存在 localStorage）。
      // 当前改为本地同域 PHP：手机/局域网访问时接口也走本机，不依赖外网 Worker。
      // 上线部署到静态主机时：改回 'https://bbtime.snawcap.cc.cd/'（或 setBackend 覆盖）。
      backend: './api/biliapi.php',
      backendTimeout: 20000, // 后端请求超时（毫秒）
      cacheTtl: 5 * 60 * 1000, // 内存缓存 5 分钟
      pageSize: 50,         // 收藏夹内容每页数量
      maxPages: 40          // 单个收藏夹最多拉取 40 页（约 2000 条）
    },

    // PDF 简报：导入时校验 magic / schema / checksum / folderId
    brief: {
      schemaVersion: 1,
      marker: 'FOLIO-BRIEF',
      maxFileSize: 80 * 1024 * 1024
    }
  };

  const ic = (path) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

  Folio.Icons = {
    star: ic('<path d="M12 2.5l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2-5.6-3.1-5.6 3.1 1.2-6.2L3 9.1l6.3-.8z"/>'),
    starF: ic('<path fill="currentColor" stroke="none" d="M12 2.5l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2-5.6-3.1-5.6 3.1 1.2-6.2L3 9.1l6.3-.8z"/>'),
    arrR: ic('<path d="M4 12h15M13 6l6 6-6 6"/>'),
    arrUR: ic('<path d="M7 17L17 7M8 7h9v9"/>'),
    user: ic('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.4-3.6 4.4-5.5 8-5.5s6.6 1.9 8 5.5"/>'),
    play: ic('<path d="M8 5.5v13l11-6.5z"/>'),
    dm: ic('<path d="M4 6a3 3 0 013-3h10a3 3 0 013 3v7a3 3 0 01-3 3H10l-5 4v-4H7a3 3 0 01-3-3z"/>'),
    clock: ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    pen: ic('<path d="M4 20l1.2-4.2L16.5 4.5a2.12 2.12 0 013 3L8.2 18.8 4 20z"/><path d="M13.5 7.5l3 3"/>'),
    rect: ic('<rect x="4" y="5" width="16" height="14" rx="2"/>'),
    arrowT: ic('<path d="M5 19L15 9M15 9h-5.2M15 9v5.2"/>'),
    type: ic('<path d="M5 7V5h14v2M12 5v14M9.5 19h5"/>'),
    undo: ic('<path d="M8 5L4 9l4 4M4 9h11a5 5 0 015 5v1"/>'),
    trash: ic('<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>'),
    check: ic('<path d="M4 12.5l5 5L20 6.5"/>'),
    x: ic('<path d="M6 6l12 12M18 6L6 18"/>'),
    dl: ic('<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>'),
    copy: ic('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 011-1h10"/>'),
    link: ic('<path d="M10 14a4 4 0 006 0l3-3a4 4 0 00-6-6l-1.5 1.5M14 10a4 4 0 00-6 0l-3 3a4 4 0 006 6l1.5-1.5"/>'),
    image: ic('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M3.5 16.5l5-5 4 4 3-3 5 5"/>'),
    doc: ic('<path d="M6 3h9l4 4v14H6zM15 3v4h4M9.5 12.5h5M9.5 16.5h5"/>'),
    layers: ic('<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h3.5"/>'),
    heart: ic('<path d="M12 20s-7.6-4.9-9.4-9A5.2 5.2 0 0112 6.3 5.2 5.2 0 0121.4 11c-1.8 4.1-9.4 9-9.4 9z"/>'),
    chevL: ic('<path d="M14.5 6l-6 6 6 6"/>'),
    quote: ic('<path fill="currentColor" stroke="none" d="M9.5 7.5c-3 1.2-4.5 3.2-4.5 6.4V17h5v-5H6.7c.1-1.9 1.1-3.1 2.8-3.9zM18 7.5c-3 1.2-4.5 3.2-4.5 6.4V17h5v-5h-3.3c.1-1.9 1.1-3.1 2.8-3.9z"/>'),
    hr: ic('<path d="M4 12h16"/><circle cx="12" cy="12" r="2.2" fill="currentColor" stroke="none"/>'),
    eye: ic('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
    menu: ic('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    lock: ic('<rect x="6" y="10.5" width="12" height="9" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5"/>'),
    sun: ic('<circle cx="12" cy="12" r="4.3"/><path d="M12 2.6v2.1M12 19.3v2.1M2.6 12h2.1M19.3 12h2.1M5.2 5.2l1.5 1.5M17.3 17.3l1.5 1.5M18.8 5.2l-1.5 1.5M6.7 17.3l-1.5 1.5"/>'),
    moon: ic('<path d="M20.6 13.4A8.4 8.4 0 1110.6 3.4a7 7 0 0010 10z"/>'),
    expand: ic('<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>'),
    shrink: ic('<path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5"/>'),
    sliders: ic('<path d="M6 4v5M6 13v7M12 4v9M12 17v3M18 4v2M18 10v10"/><circle cx="6" cy="11" r="2.2"/><circle cx="12" cy="15" r="2.2"/><circle cx="18" cy="8" r="2.2"/>'),
    folder: ic('<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>'),
    alert: ic('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>'),
    refresh: ic('<path d="M20 11a8 8 0 10.5 4M20 5v6h-6"/>'),
    upload: ic('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>')
  };
})(window.Folio = window.Folio || {});
