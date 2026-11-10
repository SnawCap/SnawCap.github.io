/* ==========================================================================
   ui.js — 通用页面交互：Toast / 模态框 / 收藏夹列表 / 时长统计面板
   ========================================================================== */
(function (Folio) {
  'use strict';

  const U = Folio.Utils;
  const $ = U.$;
  const $$ = U.$$;
  const esc = U.esc;
  const I = Folio.Icons;

  let statsMode = (Folio.Store && Folio.Store.getStatsMode()) || 'first';

  /* ═══════════ Toast ═══════════ */
  function toast(message, type = 'ok') {
    const root = $('#toast-root');
    if (!root) return;
    const el = document.createElement('div');
    el.className = `toast ${type === 'warn' ? 'warn' : ''}`;
    el.innerHTML = `${type === 'warn' ? I.alert : I.check}<span>${esc(message)}</span>`;
    root.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 320);
    }, 2600);
  }

  /* ═══════════ 模态框 ═══════════ */
  function rescueSidePanel() {
    const side = $('#modal-root .ed-side');
    const grid = $('#ed-grid');
    if (side && grid) grid.appendChild(side);
  }

  function openModal(inner) {
    rescueSidePanel();
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-mask" id="modal-mask">${inner}</div>`;
    root.querySelectorAll('[data-close]').forEach((btn) => { btn.onclick = closeModal; });
    const mask = $('#modal-mask');
    if (mask) mask.addEventListener('mousedown', (event) => {
      if (event.target.id === 'modal-mask') closeModal();
    });
    document.body.classList.add('modal-open');
  }

  function closeModal() {
    rescueSidePanel();
    const root = $('#modal-root');
    if (root) root.innerHTML = '';
    document.body.classList.remove('modal-open');
  }

  /* ═══════════ 按钮忙碌态 ═══════════ */
  function setButtonBusy(button, busy, busyText = '正在读取…') {
    if (!button) return;
    if (busy) {
      if (!button.dataset.idleHtml) button.dataset.idleHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<span class="spin"></span> ${esc(busyText)}`;
    } else {
      button.disabled = false;
      if (button.dataset.idleHtml) {
        button.innerHTML = button.dataset.idleHtml;
        delete button.dataset.idleHtml;
      }
    }
  }

  /* ═══════════ 用户卡片 ═══════════ */
  function renderUserChip(user, folderCount) {
    const el = $('#fav-user');
    if (!el) return;
    if (!user) { el.innerHTML = ''; return; }
    const fans = typeof user.fans === 'number' ? U.formatCount(user.fans) : user.fans;
    el.innerHTML = `
      <span class="uc-ava"><img src="${esc(user.avatar || '')}" alt="" referrerpolicy="no-referrer" onerror="this.style.visibility='hidden'"></span>
      <div>
        <b>${esc(user.name)}</b>
        <p class="uc-meta">UID ${esc(user.mid)} · LV${esc(user.level || 0)} · 粉丝 ${esc(fans || 0)}</p>
      </div>
      <span class="uc-tag">${folderCount} 个收藏夹</span>`;
  }

  /* ═══════════ 收藏夹列表 ═══════════ */
  function coversHTML(folder) {
    const list = (folder.videos && folder.videos.length)
      ? folder.videos.slice(0, 3).map((video) => video.cover)
      : (folder.covers || []);

    if (!list.length) {
      return `<div class="fc-cover-empty" aria-hidden="true">
        <span>${I.folder}</span><span>${I.folder}</span><span>${I.folder}</span>
      </div>`;
    }
    return list.map((cover) => `<img src="${esc(cover)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`).join('');
  }

  function renderFolders(folders, handlers) {
    const list = $('#folder-list');
    if (!list) return;

    if (!folders.length) {
      list.innerHTML = `
        <div class="state-card">
          <span class="state-icon">${I.folder}</span>
          <h3>没有找到公开收藏夹</h3>
          <p>请确认该用户已公开收藏夹，或换一个 UID 再试。</p>
        </div>`;
      return;
    }

    list.innerHTML = folders.map((folder) => {
      const count = (folder.videos && folder.videos.length) || folder.mediaCount || 0;
      return `
        <article class="folder-card" data-fid="${esc(folder.id)}" title="点击查看时长统计">
          <div class="fc-covers">${coversHTML(folder)}</div>
          <div class="fc-body"><h3>${esc(folder.title)}</h3></div>
          <div class="fc-foot">
            <span class="fc-count"><b>${U.pad2(count)}</b>支视频</span>
            <div class="fc-actions">
              <button class="fc-stat" data-stat="${esc(folder.id)}" title="时长统计与计价">${I.clock}时长统计</button>
              <button class="fc-edit" data-edit="${esc(folder.id)}" title="撰写 reaction 点播简报">${I.pen}写简报</button>
            </div>
          </div>
        </article>`;
    }).join('');

    $$('#folder-list .folder-card').forEach((card) => {
      card.onclick = () => handlers.onStats(findFolder(card.dataset.fid));
    });
    $$('#folder-list .fc-stat').forEach((btn) => {
      btn.onclick = (event) => {
        event.stopPropagation();
        handlers.onStats(findFolder(btn.dataset.stat));
      };
    });
    $$('#folder-list .fc-edit').forEach((btn) => {
      btn.onclick = (event) => {
        event.stopPropagation();
        handlers.onEdit(findFolder(btn.dataset.edit));
      };
    });
  }

  function findFolder(id) {
    const state = Folio.App && Folio.App.state;
    return state ? state.folders.find((folder) => String(folder.id) === String(id)) : null;
  }

  /** 真实收藏夹读取内容后，把卡片占位封面换成前 3 张真实封面 */
  function refreshFolderCard(folder) {
    if (!folder) return;
    const card = $(`#folder-list .folder-card[data-fid="${CSS.escape(String(folder.id))}"]`);
    if (!card) return;
    const covers = card.querySelector('.fc-covers');
    if (covers) covers.innerHTML = coversHTML(folder);
    const count = card.querySelector('.fc-count b');
    if (count) count.textContent = U.pad2((folder.videos && folder.videos.length) || folder.mediaCount || 0);
  }

  function renderFolderSkeleton(count = 4) {
    const list = $('#folder-list');
    if (!list) return;
    list.innerHTML = Array.from({ length: count }, () => `
      <article class="folder-card is-skeleton" aria-hidden="true">
        <div class="fc-covers"><div class="sk-block"></div></div>
        <div class="fc-body"><div class="sk-line"></div></div>
        <div class="fc-foot"><div class="sk-line short"></div><div class="sk-line tiny"></div></div>
      </article>`).join('');
  }

  function renderFolderError(message, handlers) {
    const list = $('#folder-list');
    if (!list) return;
    list.innerHTML = `
      <div class="state-card is-error">
        <span class="state-icon">${I.alert}</span>
        <h3>收藏夹读取失败</h3>
        <p>${esc(message || '接口暂时不可用，请稍后重试。')}</p>
        <div class="state-actions">
          <button class="btn btn-primary" id="state-retry">${I.refresh} 重新读取</button>
        </div>
        <p class="state-tip">提示：只能读取「公开的收藏夹」；前后端分域部署时，请确认 PHP 接口可跨域访问。</p>
      </div>`;
    const retry = $('#state-retry');
    if (retry && handlers && handlers.onRetry) retry.onclick = handlers.onRetry;
  }

  /* ═══════════ 时长统计 ═══════════ */
  // 计费口径：单价与加急都是 元/小时；未填写的项按 0 计，但只有至少一项 > 0 才算有价格
  function readRates() {
    const read = (key) => {
      const value = parseFloat(U.storage.get(key));
      return isFinite(value) && value > 0 ? value : null;
    };
    const rate = read(Folio.Config.storage.rate);
    const urgent = read(Folio.Config.storage.urgent);
    return { rate, urgent: urgent };
  }

  // 工时（小时），保留 4 位小数，避免 2.58 小时这种展示值参与计算
  function hoursOf(seconds) { return seconds / 3600; }

  function quoteOf(seconds, rates) {
    if (rates.rate == null && rates.urgent == null) return null;
    return (hoursOf(seconds) * ((rates.rate || 0) + (rates.urgent || 0)));
  }

  async function openStatsSheet(folder) {
    if (!folder) return;
    statsMode = (Folio.Store && Folio.Store.getStatsMode()) || 'first';

    openModal(`<div class="modal" style="width:720px">
      <header class="m-head">
        <div><p class="overline">STATS · 时长统计</p><h3>${esc(folder.title)}</h3><p>正在读取收藏夹内容，请稍候…</p></div>
        <button class="m-close" data-close>${I.x}</button>
      </header>
      <div class="st-body">
        <div class="loading-panel"><span class="loading-dot"></span><p id="stats-progress">正在读取视频列表…</p></div>
      </div>
    </div>`);

    try {
      await Folio.App.ensureFolderVideos(folder, (loaded, total) => {
        const el = $('#stats-progress');
        if (el) el.textContent = total ? `已读取 ${loaded} / ${total} 支视频…` : `已读取 ${loaded} 支视频…`;
      }, { force: true });
      renderStatsModal(folder);
    } catch (error) {
      openModal(`<div class="modal" style="width:560px">
        <header class="m-head">
          <div><p class="overline">STATS · 时长统计</p><h3>读取失败</h3><p>${esc(error.message || '接口暂时不可用')}</p></div>
          <button class="m-close" data-close>${I.x}</button>
        </header>
        <div class="st-body">
          <div class="empty-panel">${I.alert}<h4>没有拿到这个收藏夹的内容</h4><p>可能是收藏夹未公开、接口限流，或网络暂时异常。</p></div>
        </div>
        <footer class="m-foot">
          <span class="mono">${esc(folder.title)}</span>
          <button class="btn btn-primary" id="stats-retry">${I.refresh} 重试</button>
        </footer>
      </div>`);
      const retry = $('#stats-retry');
      if (retry) retry.onclick = () => openStatsSheet(folder);
    }
  }

  function renderStatsModal(folder) {
    openModal(`<div class="modal" style="width:720px">
      <header class="m-head">
        <div><p class="overline">STATS · 时长统计</p><h3>${esc(folder.title)}</h3><p>两种口径随时切换；数字可直接用于向 UP 主报价。</p></div>
        <button class="m-close" data-close>${I.x}</button>
      </header>
      <div class="st-body">
        <div class="seg st-seg" id="st-seg"><button class="${statsMode === 'first' ? 'on' : ''}" data-m="first">仅第一分P</button><button class="${statsMode === 'all' ? 'on' : ''}" data-m="all">全部分P</button></div>
        <p class="st-note" id="st-note"></p>
        <div class="st-hero" id="st-hero"></div>
        <div class="st-list" id="st-list"></div>
      </div>
      <footer class="m-foot">
        <span class="mono" id="st-foot-info"></span>
        <div class="st-foot-btns">
          <button class="btn btn-ghost" id="st-refresh" title="重新读取收藏夹，获取最新视频">${I.refresh} 刷新数据</button>
          <button class="btn btn-ghost" id="st-copy">${I.copy} 复制统计结果</button>
          <button class="btn btn-primary" id="st-edit">${I.pen} 去写简报</button>
        </div>
      </footer>
    </div>`);

    renderStats(folder);

    const seg = $('#st-seg');
    if (seg) seg.onclick = (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      statsMode = button.dataset.m;
      if (Folio.Store) Folio.Store.setStatsMode(statsMode);
      $$('#st-seg button').forEach((item) => item.classList.toggle('on', item === button));
      renderStats(folder);
    };

    const refresh = $('#st-refresh');
    if (refresh) refresh.onclick = () => {
      closeModal();
      openStatsSheet(folder);
    };

    const copy = $('#st-copy');
    if (copy) copy.onclick = () => {
      U.copyText(buildStatsText(folder)).then((ok) => {
        toast(ok ? '统计结果已复制' : '复制失败，请手动选择', ok ? 'ok' : 'warn');
      });
    };

    const edit = $('#st-edit');
    if (edit) edit.onclick = () => {
      closeModal();
      Folio.App.openFolder(folder);
    };
  }

  function renderStats(folder) {
    const stats = U.folderStats(folder, statsMode);
    const note = $('#st-note');
    const hero = $('#st-hero');
    const list = $('#st-list');
    const foot = $('#st-foot-info');
    if (!note || !hero || !list) return;

    note.textContent = (statsMode === 'first'
      ? '每支视频只计第 1 个分 P —— reaction 通常只看第一P，计价常用口径'
      : '计入每支视频全部分 P 的总和 —— 适合完整观看或多 P 逐一反应的场景')
      + ' · 新增视频后点「刷新数据」重新统计';

    const rates = readRates();
    const price = quoteOf(stats.total, rates);
    const fetched = folder._videosAt
      ? new Date(folder._videosAt).toLocaleTimeString('zh-CN', { hour12: false })
      : '';

    hero.innerHTML = `
      <div class="st-big">${U.formatHMS(stats.total)}</div>
      <p class="st-sub">共 <b>${U.formatCn(stats.total)}</b> ｜ 合计 <b>${(stats.total / 60).toFixed(1)}</b> 分钟 · <b>${hoursOf(stats.total).toFixed(2)}</b> 小时</p>
      <p class="st-sub2">${stats.count} 支视频 · 其中 ${stats.multi} 支多分P · 平均 ${(stats.avg / 60).toFixed(1)} 分钟 / 支${fetched ? ` · 数据 ${fetched}` : ''}</p>
      <div class="rate-row">
        <label class="rate-item"><span>计费单价</span>
          <span class="rate-box"><input id="st-rate" inputmode="decimal" placeholder="0.00" value="${rates.rate != null ? rates.rate : ''}"> 元 / 小时</span>
        </label>
        <label class="rate-item"><span>加急</span>
          <span class="rate-box"><input id="st-urgent" inputmode="decimal" placeholder="0.00" value="${rates.urgent != null ? rates.urgent : ''}"> 元 / 小时</span>
        </label>
        <b class="st-price${price != null ? '' : ' empty'}" id="st-price">${price != null ? `¥ ${(Math.round(price * 100) / 100).toFixed(2)}` : '输入单价自动计算'}</b>
      </div>`;

    const priceEl = $('#st-price');
    const refreshPrice = () => {
      const next = readRates();
      const total = quoteOf(stats.total, next);
      if (total == null) {
        priceEl.textContent = '输入单价自动计算';
        priceEl.classList.add('empty');
      } else {
        priceEl.textContent = `¥ ${(Math.round(total * 100) / 100).toFixed(2)}`;
        priceEl.classList.remove('empty');
      }
    };

    [['#st-rate', Folio.Config.storage.rate], ['#st-urgent', Folio.Config.storage.urgent]].forEach(([sel, key]) => {
      const input = $(sel);
      if (!input) return;
      input.addEventListener('input', () => {
        const value = parseFloat(input.value);
        if (isFinite(value) && value > 0) U.storage.set(key, value);
        else U.storage.remove(key);
        refreshPrice();
      });
    });

    list.innerHTML = folder.videos.map((video, index) => {
      const duration = U.videoDuration(video, statsMode);
      const multi = video.pages && video.pages.length > 1;
      const parts = multi
        ? `<span class="st-parts">${video.pages.length}P · P1 ${U.formatDuration(video.pages[0].d)}${statsMode === 'first' ? ` ｜ 全长 ${U.formatDuration(video.dur)}` : ''}</span>`
        : '<span class="st-parts">单P</span>';
      return `<div class="st-row">
        <span class="st-num">${U.pad2(index + 1)}</span>
        <img class="st-thumb" src="${esc(Folio.BiliApi.thumb(video.cover, 180, 112))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
        <div class="st-txt"><span class="st-title">${esc(video.title)}</span>${parts}</div>
        <b class="st-dur">${U.formatDuration(duration)}</b>
      </div>`;
    }).join('');

    if (foot) foot.textContent = `${statsMode === 'first' ? '仅第一分P' : '全部分P'} · ${U.formatHMS(stats.total)} · ${stats.count} 支`;
  }

  function buildStatsText(folder) {
    const stats = U.folderStats(folder, statsMode);
    const rates = readRates();
    const price = quoteOf(stats.total, rates);

    const billing = [];
    if (rates.rate != null) billing.push(`¥${rates.rate.toFixed(2)}/小时`);
    if (rates.urgent != null) billing.push(`加急 ¥${rates.urgent.toFixed(2)}/小时`);
    const hours = hoursOf(stats.total);

    return [
      `《${String(folder.title).replace(/[《》]/g, '')}》时长统计`,
      `视频数量 ${stats.count} 支`,
      `视频时长 ${U.formatHMS(stats.total)}（${(stats.total / 60).toFixed(1)} 分钟 · ${hours.toFixed(2)} 小时）`,
      `统计分P模式 ${statsMode === 'first' ? '仅第一分P' : '全部分P'}`,
      `计费方式 ${billing.length ? billing.join(' + ') : '未填写'}`,
      `预估价格 ${price != null ? `¥ ${(Math.round(price * 100) / 100).toFixed(2)}` : '—'}`,
      '—— 由「雪哔」统计'
    ].join('\n');
  }

  Folio.UI = {
    toast,
    openModal,
    closeModal,
    rescueSidePanel,
    setButtonBusy,
    renderUserChip,
    renderFolders,
    renderFolderSkeleton,
    renderFolderError,
    refreshFolderCard,
    openStatsSheet,
    buildStatsText,
    readRates
  };
})(window.Folio = window.Folio || {});
