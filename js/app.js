/* ==========================================================================
   app.js — 页面控制：三页（主页 / 收藏夹 / 编辑器）启动、导航与数据记忆
   页面通过 <body data-page="home|folders|editor"> 区分，共用本文件。
   ========================================================================== */
(function (Folio) {
  'use strict';

  const U = Folio.Utils;
  const $ = U.$;
  const $$ = U.$$;
  const I = Folio.Icons;
  const UI = Folio.UI;
  const Bili = Folio.BiliApi;
  const Store = Folio.Store;

  const PAGE = document.body.dataset.page || 'home';
  const FINE = window.matchMedia('(hover:hover) and (pointer:fine)').matches;

  const state = {
    uid: '',
    user: null,
    folders: [],
    folder: null,
    videoId: null,
    annotating: null,
    savedRange: null
  };

  /* ═══════════ 地址与导航 ═══════════ */
  const param = (name) => {
    try { return new URLSearchParams(window.location.search).get(name) || ''; } catch (err) { return ''; }
  };
  const foldersUrl = (uid) => `folders.html${uid ? `?uid=${encodeURIComponent(uid)}` : ''}`;
  const editorUrl = (uid, folderId, bvid) => {
    const query = new URLSearchParams();
    if (uid) query.set('uid', uid);
    if (folderId) query.set('folder', String(folderId));
    if (bvid) query.set('bvid', String(bvid));
    return `editor.html${query.toString() ? `?${query.toString()}` : ''}`;
  };
  const go = (url) => window.location.assign(url);
  const replaceUrl = (url) => {
    try { window.history.replaceState(null, '', url); } catch (err) { /* ignore */ }
  };
  const leaveEditor = () => {
    if (PAGE === 'editor' && Folio.Editor) Folio.Editor.commitCurrentIntro();
  };

  /* ═══════════ 收藏夹封面懒加载：卡片进入视口后才请求 ps=3，最多 3 个并发 ═══════════ */
  const MAX_COVER_REQUESTS = 3;
  const folderCoverQueue = [];
  let activeCoverRequests = 0;
  let folderCoverObserver = null;

  /* ═══════════ 主题 ═══════════ */
  function applyTheme(theme) {
    // 切换瞬间完成：先挂 theme-switching 禁掉全局过渡（避免全页逐帧重绘风暴），两帧后恢复
    const root = document.documentElement;
    root.classList.add('theme-switching');
    document.body.dataset.theme = theme;
    U.storage.set(Folio.Config.storage.theme, theme);
    const switchButton = $('#theme-switch');
    if (switchButton) {
      switchButton.setAttribute('aria-checked', theme === 'dark' ? 'true' : 'false');
      switchButton.title = theme === 'dark' ? '切换到明亮模式' : '切换到深色模式';
    }
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
  }

  function initTheme() {
    const saved = U.storage.get(Folio.Config.storage.theme) || 'light';
    applyTheme(saved === 'dark' ? 'dark' : 'light');
    const switchButton = $('#theme-switch');
    if (switchButton) switchButton.onclick = () => applyTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark');
  }

  /* ═══════════ 错误文案 ═══════════ */
  function friendlyError(error) {
    if (!error) return '未知错误';
    if (error.code === 'TIMEOUT') return '后端响应超时，请检查服务器网络后重试。';
    if (error.code === 'BACKEND_HTTP') return error.message || '后端返回异常状态码，请检查服务器。';
    if (error.code === 'BACKEND_BAD_JSON') {
      return '后端返回的不是 JSON：请确认 api/biliapi.php 已由 PHP 执行（GitHub Pages 不会执行 PHP），或检查后端地址。';
    }
    if (error.code === 'HOST_CHALLENGE') {
      return '后端主机启用了人机验证（aes.js 验证页），接口被 HTML 验证页拦截。请把前端部署到与 PHP 相同的域名，或换一个不启用该验证的 PHP 主机。';
    }
    if (error.code === 'BACKEND_NETWORK') {
      return '无法连接 后端，请检查地址、CORS、服务器状态与网络。若后端在免费主机上，可能被主机的人机验证（aes.js）拦截跨域请求。';
    }
    if (error.code === 'NO_BACKEND') {
      return '未配置 后端：请在 js/config.js 的 api.backend 填写地址，或调用 Folio.ApiClient.setBackend()。';
    }
    if (error.code === -403) return '访问被拒绝（可能触发了风控），请稍后重试。只能读取公开收藏夹。';
    if (error.code === -404) return '这个 UID 不存在，或用户没有公开收藏夹。';
    if (error.code === -352) return 'B 站风控校验未通过，请稍后重试。';
    return error.message || '接口请求失败';
  }

  /* ═══════════ 收藏夹数据 ═══════════ */
  async function ensureFolderVideos(folder, onProgress, options = {}) {
    if (!folder) return Promise.resolve([]);
    if (folder._loading) return folder._loading;
    // force：忽略内存 / 会话缓存，重新拉取（报价、编辑器必须拿到最新视频）
    if (!options.force && Array.isArray(folder.videos)) return Promise.resolve(folder.videos);

    if (!folder.id) {
      folder.videos = folder.videos || [];
      return Promise.resolve(folder.videos);
    }

    folder._loading = Bili.getFavItems(folder.id, { onProgress })
      .then((result) => {
        folder.videos = result.videos;
        folder.mediaCount = result.total || result.videos.length;
        folder._videosAt = Date.now();
        delete folder._loading;
        refreshFolderCount(folder);
        return folder.videos;
      })
      .catch((error) => {
        delete folder._loading;
        throw error;
      });

    return folder._loading;
  }

  function refreshFolderCount(folder) {
    UI.refreshFolderCard(folder);
  }

  function queueFolderCover(folder) {
    if (!folder || folder.videos || folder._coversQueued) return;
    if (folder.covers && folder.covers.length) return;

    folder._coversQueued = true;
    folderCoverQueue.push(folder);
    pumpFolderCoverQueue();
  }

  function pumpFolderCoverQueue() {
    while (activeCoverRequests < MAX_COVER_REQUESTS && folderCoverQueue.length) {
      const folder = folderCoverQueue.shift();
      activeCoverRequests += 1;

      Bili.getFavCovers(folder.id)
        .then((covers) => {
          if (!folder.videos && covers.length) {
            folder.covers = covers;
            UI.refreshFolderCard(folder);
          }
        })
        .catch(() => {
          // 封面只是装饰，失败保持占位，不打断列表
        })
        .finally(() => {
          folder._coversQueued = false;
          activeCoverRequests -= 1;
          pumpFolderCoverQueue();
        });
    }
  }

  function observeFolderCovers(folders) {
    if (folderCoverObserver) {
      folderCoverObserver.disconnect();
      folderCoverObserver = null;
    }

    folderCoverQueue.forEach((folder) => { folder._coversQueued = false; });
    folderCoverQueue.length = 0;

    const cards = $$('#folder-list .folder-card');
    if (!cards.length) return;

    if (!('IntersectionObserver' in window)) {
      folders.forEach(queueFolderCover);
      return;
    }

    folderCoverObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        const id = entry.target.dataset.fid;
        const folder = folders.find((item) => String(item.id) === id);
        if (folderCoverObserver) folderCoverObserver.unobserve(entry.target);
        if (folder) queueFolderCover(folder);
      });
    }, { threshold: 0.01, root: null, rootMargin: '0px' });

    cards.forEach((card) => folderCoverObserver.observe(card));
  }

  function rememberSpace() {
    if (!state.uid) return;
    if (!state.user && !state.folders.length) return;
    Store.cacheSpace(state.uid, { user: state.user, folders: state.folders });
  }

  /* ═══════════ 打开统计 / 编辑器 ═══════════ */
  function openStats(folder) {
    if (!folder) return;
    UI.openStatsSheet(folder);
  }

  function openFolder(folder) {
    if (!folder) return;
    Store.setLastFolder({ uid: state.uid, id: folder.id, title: folder.title });
    go(editorUrl(state.uid, folder.id));
  }

  // 编辑器切换视频时调用：记住上次视频，并把 URL 同步成可刷新的深链接
  function noteVideoChanged(video) {
    if (!video || !state.folder) return;
    const key = video.bvid || video.id;
    Store.setLastVideo(state.folder.id, key);
    replaceUrl(editorUrl(state.uid, state.folder.id, key));
  }

  /* ═══════════ 主页 ═══════════ */
  function initHomePage() {
    const input = $('#uid-input');
    const savedUID = Store.getUid();
    if (input && savedUID) input.value = savedUID;

    renderResume();

    const submit = () => {
      const value = String(input ? input.value : '').trim();
      if (!U.uidValid(value)) {
        UI.toast('请输入纯数字的 B 站 UID', 'warn');
        if (input) input.focus();
        return;
      }
      Store.setUid(value);
      go(foldersUrl(value));
    };

    const queryButton = $('#btn-query');
    if (queryButton) queryButton.onclick = submit;
    if (input) input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });

    initHeroTilt();
  }

  function renderResume() {
    const button = $('#btn-resume');
    if (!button) return;
    const last = Store.getLastFolder();
    if (!last || !last.id || !last.title) { button.hidden = true; return; }
    button.hidden = false;
    button.innerHTML = `${I.clock}<span>继续上次 · <b>${U.esc(last.title)}</b></span>${I.arrR}`;
    button.onclick = () => go(editorUrl(last.uid || Store.getUid(), last.id));
  }

  /* ═══════════ 收藏夹列表页 ═══════════ */
  async function initFoldersPage() {
    const urlUID = String(param('uid') || '').trim();
    const uid = U.uidValid(urlUID) ? urlUID : Store.getUid();
    if (!uid) { go('index.html'); return; }

    state.uid = uid;
    Store.setUid(uid);
    if (urlUID !== uid) replaceUrl(foldersUrl(uid));

    const reUid = $('#btn-re-uid');
    if (reUid) reUid.onclick = () => go('index.html');

    const cached = Store.readSpace(uid);
    if (cached) applySpace(cached);
    else UI.renderFolderSkeleton(4);

    try {
      const result = await Bili.loadUserSpace(uid);
      applySpace(result);
      rememberSpace();

      if (result.userFallback) UI.toast('用户资料读取失败，已使用 UID 占位', 'warn');
      else if (state.folders.length === 0) UI.toast('这个用户没有公开收藏夹', 'warn');
      else if (!cached) UI.toast(`已读取 ${state.folders.length} 个公开收藏夹`);
    } catch (error) {
      UI.renderUserChip(state.user, state.folders.length);
      if (cached) {
        UI.toast('刷新失败，当前显示上次读取的收藏夹', 'warn');
      } else {
        UI.renderFolderError(friendlyError(error), { onRetry: () => window.location.reload() });
        UI.toast(friendlyError(error), 'warn');
      }
    }

    // 离开页面时把最新封面一起记下来，下次回来不再重复请求
    window.addEventListener('pagehide', rememberSpace);
  }

  function applySpace(result) {
    const user = result.user || null;
    const folders = (result.folders || []).map((folder) => ({
      id: String(folder.id),
      fid: String(folder.fid || ''),
      title: folder.title || '',
      mediaCount: Number(folder.mediaCount) || 0,
      attr: Number(folder.attr) || 0,
      videos: folder.videos || null,
      covers: folder.covers || null
    }));

    state.user = user;
    state.folders = folders;

    UI.renderUserChip(user, folders.length);
    UI.renderFolders(folders, { onStats: openStats, onEdit: openFolder });
    observeFolderCovers(folders);

    if (user && user.name) {
      document.title = `${user.name}的收藏夹 · 雪哔`;
    }
  }

  /* ═══════════ 编辑器页 ═══════════ */
  async function initEditorPage() {
    const last = Store.getLastFolder();
    const urlUID = String(param('uid') || '').trim();
    const uid = U.uidValid(urlUID) ? urlUID : (Store.getUid() || (last && last.uid) || '');
    // 只有上次收藏夹属于当前 UID 时才用它兜底，避免 A 的收藏夹挂到 B 名下
    const lastForUid = last && (!last.uid || last.uid === uid) ? last : null;
    const folderId = String(param('folder') || (lastForUid && lastForUid.id) || '').trim();

    if (!uid) { go('index.html'); return; }
    if (!folderId) { go(foldersUrl(uid)); return; }

    state.uid = uid;
    Store.setUid(uid);
    if (urlUID !== uid || param('folder') !== folderId) {
      replaceUrl(editorUrl(uid, folderId, param('bvid')));
    }

    Folio.Editor.init();
    bindEditorChrome();

    const cachedSpace = Store.readSpace(uid);
    if (cachedSpace) {
      state.user = cachedSpace.user || null;
      state.folders = cachedSpace.folders || [];
    }

    let folder = state.folders.find((item) => String(item.id) === folderId) || null;

    if (!folder) {
      renderEditorLoading(null, '正在读取收藏夹…');
      try {
        const result = await Bili.loadUserSpace(uid);
        state.user = result.user;
        state.folders = result.folders;
        Store.cacheSpace(uid, { user: result.user, folders: result.folders });
        folder = state.folders.find((item) => String(item.id) === folderId) || null;
      } catch (error) {
        renderEditorFailure(friendlyError(error));
        return;
      }
    }

    if (!folder) {
      UI.toast('这个收藏夹不存在或未公开', 'warn');
      go(foldersUrl(uid));
      return;
    }

    Store.setLastFolder({ uid: uid, id: folder.id, title: folder.title });
    renderEditorLoading(folder, '正在读取视频列表…');

    try {
      await ensureFolderVideos(folder, (loaded, total) => {
        const progress = $('#ed-progress');
        if (progress) progress.textContent = total ? `已读取 ${loaded} / ${total} 支视频…` : `已读取 ${loaded} 支视频…`;
      }, { force: true });
    } catch (error) {
      renderEditorFailure(friendlyError(error), folder);
      return;
    }

    const lookup = String(param('bvid') || Store.getLastVideo(folder.id) || '');
    const wanted = lookup
      ? folder.videos.find((video) => video.id === lookup || video.bvid === lookup)
      : null;

    Folio.Editor.open(folder, wanted ? wanted.id : null);
    document.title = `《${folder.title}》 · 写简报 · 雪哔`;
  }

  function crumbHTML(folder) {
    const userName = state.user ? state.user.name : '';
    return `<span class="cb-brand"><i></i>雪哔</span><span class="sep">/</span><span class="cb-user">${U.esc(userName)}</span><span class="sep">/</span><b>${U.esc(folder ? folder.title : '读取中…')}</b>`;
  }

  function renderEditorLoading(folder, message) {
    const crumb = $('#crumb');
    if (crumb) crumb.innerHTML = crumbHTML(folder);

    const count = $('#vl-count');
    if (count) count.textContent = '';

    const items = $('#vl-items');
    if (items) items.innerHTML = `<div class="loading-panel"><span class="loading-dot"></span><p id="ed-progress">${U.esc(message || '正在读取…')}</p></div>`;

    const meta = $('#video-meta');
    if (meta) meta.innerHTML = '';
    const area = $('#editor-area');
    if (area) {
      area.innerHTML = '';
      area.setAttribute('contenteditable', 'false');
    }
  }

  function renderEditorFailure(message, folder) {
    const crumb = $('#crumb');
    if (crumb) crumb.innerHTML = crumbHTML(folder);

    const items = $('#vl-items');
    if (items) items.innerHTML = '';

    const meta = $('#video-meta');
    if (meta) {
      meta.innerHTML = `<div class="state-card is-error">
        <span class="state-icon">${I.alert}</span>
        <h3>收藏夹读取失败</h3>
        <p>${U.esc(message || '接口暂时不可用，请稍后重试。')}</p>
        <div class="state-actions">
          <button class="btn btn-primary" id="ed-retry">${I.refresh} 重新读取</button>
          <button class="btn btn-ghost" id="ed-back">${I.chevL} 返回收藏夹</button>
        </div>
        <p class="state-tip">提示：只能读取「公开的收藏夹」；前后端分域部署时，请确认 PHP 接口可跨域访问。</p>
      </div>`;
    }

    const retry = $('#ed-retry');
    if (retry) retry.onclick = () => window.location.reload();
    const back = $('#ed-back');
    if (back) back.onclick = () => go(foldersUrl(state.uid));

    const area = $('#editor-area');
    if (area) {
      area.innerHTML = '';
      area.setAttribute('contenteditable', 'false');
    }
  }

  function bindEditorChrome() {
    const back = $('#btn-back');
    if (back) {
      back.title = '返回收藏夹';
      back.onclick = () => {
        leaveEditor();
        go(foldersUrl(state.uid));
      };
    }

    const burger = $('#btn-burger');
    if (burger) burger.onclick = () => Folio.Editor.setDrawer(!$('#ed-list').classList.contains('open'));

    const scrim = $('#drawer-scrim');
    if (scrim) scrim.onclick = () => Folio.Editor.setDrawer(false);

    const main = $('.ed-main');
    if (main) main.addEventListener('click', () => Folio.Editor.setDrawer(false));

    const sideFab = $('#side-fab');
    if (sideFab) sideFab.onclick = openSideSheet;

    const gen = $('#btn-gen');
    if (gen) gen.onclick = (event) => {
      event.stopPropagation();
      if (!FINE || window.innerWidth <= 920) { openGenSheet(); return; }
      const menu = $('#gen-menu');
      if (menu) menu.classList.toggle('open');
    };

    // 成册设置：从本机恢复，并记住每次修改
    const outputs = Store.getOutputs();
    $$('[data-share]').forEach((input) => {
      const key = input.dataset.share;
      if (key === 'showUp') input.checked = outputs.showUp !== false;
      if (key === 'allowRepost') input.checked = outputs.allowRepost !== false;
    });

    const side = $('.ed-side');
    if (side) side.addEventListener('change', (event) => {
      if (!event.target.matches('[data-share]')) return;
      const showUp = $('[data-share="showUp"]');
      const allowRepost = $('[data-share="allowRepost"]');
      Store.setOutputs({
        showUp: showUp ? showUp.checked : true,
        allowRepost: allowRepost ? allowRepost.checked : true
      });
      UI.toast('成册设置已更新');
    });

    const importInput = $('#pdf-import');
    if (importInput) importInput.onchange = () => {
      const file = importInput.files && importInput.files[0];
      importInput.value = '';
      if (file) Folio.Pdf.importFile(file);
    };

    document.addEventListener('click', (event) => {
      const output = event.target.closest('[data-out]');
      if (output) {
        closeGenMenu();
        Folio.Output.doOutput(output.dataset.out);
        return;
      }

      const importTrigger = event.target.closest('[data-import]');
      if (importTrigger) {
        if (!state.folder) {
          UI.toast('请先打开一个收藏夹', 'warn');
          return;
        }
        Folio.Editor.commitCurrentIntro();
        const fileInput = $('#pdf-import');
        if (fileInput) {
          fileInput.value = '';
          fileInput.click();
        }
        return;
      }

      if (!event.target.closest('.menu-wrap')) closeGenMenu();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 920) Folio.Editor.setDrawer(false);
    });
  }

  /* ═══════════ 输出菜单（编辑器页） ═══════════ */
  function closeGenMenu() {
    const menu = $('#gen-menu');
    if (menu) menu.classList.remove('open');
  }

  function openGenSheet() {
    UI.openModal(`<div class="modal sheet">
      <header class="m-head"><div><p class="overline">OUTPUT · 生成成册</p><h3>选择生成方式</h3></div><button class="m-close" data-close>${I.x}</button></header>
      <div class="gen-sheet-body">
        <button class="out-card" data-out="text"><span class="oc-no">01</span><span class="oc-icon">${I.doc}</span><span class="oc-txt"><b>完整文本</b><span>整册简报文本，一键复制</span></span><span class="oc-arrow">${I.arrR}</span></button>
        <button class="out-card" data-out="image"><span class="oc-no">02</span><span class="oc-icon">${I.layers}</span><span class="oc-txt"><b>介绍长图</b><span>适合发微信、群聊与评论区</span></span><span class="oc-arrow">${I.arrR}</span></button>
        <button class="out-card" data-out="xlsx"><span class="oc-no">03</span><span class="oc-icon">${I.layers}</span><span class="oc-txt"><b>Excel 简报</b><span>目录可跳转，适合在线表格阅读</span></span><span class="oc-arrow">${I.arrR}</span></button>
        <button class="out-card" data-out="pdf"><span class="oc-no">04</span><span class="oc-icon">${I.doc}</span><span class="oc-txt"><b>PDF 简报</b><span>长图版式 + 目录书签，可回导</span></span><span class="oc-arrow">${I.arrR}</span></button>
      </div>
    </div>`);
  }

  function openSideSheet() {
    UI.openModal(`<div class="modal sheet">
      <header class="m-head"><div><p class="overline">PANEL · 输出与设置</p><h3>输出与分享</h3><p>生成四种成品，或调整成册设置。</p></div><button class="m-close" data-close>${I.x}</button></header>
      <div class="sheet-body" id="sheet-body"></div>
    </div>`);
    const body = $('#sheet-body');
    const side = $('.ed-side');
    if (body && side) body.appendChild(side);
  }

  /* ═══════════ 关于 ═══════════ */
  function openAbout() {
    UI.openModal(`<div class="modal" style="width:600px">
      <header class="m-head"><div><p class="overline">ABOUT · 关于雪哔</p><h3>计算、统计、管理收藏夹</h3><p>雪哔 SnawCap · BILITIME · reaction 点播工具</p></div><button class="m-close" data-close>${I.x}</button></header>
      <div style="padding:6px 26px 24px;font-size:14px;line-height:2.1;color:var(--ink-2);font-weight:300">
        <p><b style="color:var(--ink);font-weight:600">三步成册 ——</b></p>
        <p>① 输入 UID 进入收藏夹（数据由 PHP 接口读取公开收藏夹），<b style="color:var(--accent);font-weight:600">点击卡片即可做分 P 时长统计与计价</b>（仅第一P / 全部P 两种口径）；<br>
        ② 点「写简报」进入编辑器，为每支视频<b style="color:var(--accent);font-weight:600">手动撰写 reaction 点播简报</b>（概要 / 看点 / 注意），配图支持整行或行内、可自由标注，也可直接粘贴图片；<br>
        ③ 生成<b style="color:var(--accent);font-weight:600">完整文本</b>、<b style="color:var(--accent);font-weight:600">可下载的长图</b>、<b style="color:var(--accent);font-weight:600">Excel 简报</b>或<b style="color:var(--accent);font-weight:600">PDF 简报</b>；PDF 带目录书签，可下载、打印，也可以导回继续编辑。</p>
        <p style="margin-top:14px;padding-top:14px;border-top:1px solid var(--stroke);font-size:12.5px;color:var(--ink-2)">
          作者：<b style="color:var(--ink);font-weight:600">山顶小雪球（SnawCap）</b><br>
          关键词：雪哔 · SnawCap · BILITIME
        </p>
        <p style="margin-top:12px;font-size:12.5px;color:var(--ink-3)">数据由后端代理读取公开收藏夹（默认 Cloudflare Worker，也支持同域 PHP）；页面本身是静态文件。接口地址在 <code>js/config.js</code> 的 <code>api.backend</code> 中配置，也可调用 <code>Folio.ApiClient.setBackend('https://...')</code> 覆盖（保存在本机）。简报草稿与 Excel / PDF 文件都在浏览器本机处理，不会上传到任何服务器。</p>
      </div>
    </div>`);
  }

  /* ═══════════ 公共初始化 ═══════════ */
  function bindCommon() {
    const about = $('#btn-about');
    if (about) about.onclick = openAbout;

    const navHome = $('#nav-home');
    if (navHome) {
      navHome.onclick = () => {
        leaveEditor();
        if (PAGE === 'home') window.scrollTo({ top: 0, behavior: 'smooth' });
        else go('index.html');
      };
    }

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        UI.closeModal();
        closeGenMenu();
        if (PAGE === 'editor') Folio.Editor.setDrawer(false);
      }
      if (PAGE === 'editor' && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (state.videoId) {
          Folio.Editor.commitCurrentIntro();
          UI.toast('草稿已保存到本机');
        }
      }
    });

    window.addEventListener('pagehide', () => {
      if (PAGE === 'editor') leaveEditor();
    });
  }

  function init() {
    U.fillIcons(document);
    initTheme();
    bindCommon();

    if (PAGE === 'folders') initFoldersPage();
    else if (PAGE === 'editor') initEditorPage();
    else initHomePage();
  }

  /* ═══════════ Hero 视差（仅主页） ═══════════ */
  function initHeroTilt() {
    if (!FINE) return;
    const visual = $('#hero-visual');
    const tilt = $('#tilt');
    if (!visual || !tilt) return;

    visual.addEventListener('mousemove', (event) => {
      const rect = visual.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      tilt.style.transform = `rotateY(${x * 9}deg) rotateX(${-y * 7}deg)`;
    });
    visual.addEventListener('mouseleave', () => { tilt.style.transform = ''; });
  }

  Folio.App = {
    page: PAGE,
    state,
    foldersUrl,
    editorUrl,
    queryUID: (uid) => {
      const value = String(uid || '').trim();
      if (!U.uidValid(value)) return false;
      Store.setUid(value);
      go(foldersUrl(value));
      return true;
    },
    ensureFolderVideos,
    openStats,
    openFolder,
    noteVideoChanged,
    init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window.Folio = window.Folio || {});
