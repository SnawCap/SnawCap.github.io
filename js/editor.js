/* ==========================================================================
   editor.js — 编辑器交互：视频切换 / 简报草稿 / 富文本 / 配图 / 画布标注
   ========================================================================== */
(function (Folio) {
  'use strict';

  const U = Folio.Utils;
  const $ = U.$;
  const $$ = U.$$;
  const esc = U.esc;
  const I = Folio.Icons;
  const FINE = window.matchMedia('(hover:hover) and (pointer:fine)').matches;
  const toast = (message, type) => Folio.UI.toast(message, type);

  const state = () => Folio.App.state;
  const currentVideo = () => {
    const app = state();
    return app.folder ? app.folder.videos.find((video) => video.id === app.videoId) : null;
  };
  const doneCount = () => {
    const app = state();
    return app.folder ? app.folder.videos.filter((video) => video.done).length : 0;
  };

  /* ═══════════ 草稿 ═══════════ */
  function draftKey(video) {
    const app = state();
    return `${Folio.Config.storage.draftPrefix}${app.folder.id}:${video.bvid || video.id}`;
  }

  function hydrateDrafts(folder) {
    folder.videos.forEach((video) => {
      const saved = U.storage.get(draftKey(video));
      if (saved && saved.trim()) {
        video.done = true;
        // 同步到内存模型，保证未打开过的视频也能进入文本/长图/分享输出
        video.intro = saved;
      }
    });
  }

  function saveDraft(video) {
    if (!video) return;
    const html = $('#editor-area').innerHTML;
    const key = draftKey(video);
    if (!html.trim()) {
      U.storage.remove(key);
      return;
    }
    const ok = U.storage.set(key, html);
    if (!ok) toast('草稿过大，本地自动保存失败；请先导出文本', 'warn');
  }

  const saveDraftSoon = U.debounce(() => {
    const video = currentVideo();
    if (video) saveDraft(video);
  }, 600);

  /* ═══════════ 打开收藏夹 ═══════════ */
  function open(folder, preferredVideoId) {
    const app = state();
    app.folder = folder;
    const wanted = preferredVideoId && folder.videos.some((video) => video.id === preferredVideoId)
      ? preferredVideoId
      : null;
    app.videoId = wanted || (folder.videos.length ? folder.videos[0].id : null);
    app.savedRange = null;

    hydrateDrafts(folder);

    const crumb = $('#crumb');
    if (crumb) {
      crumb.innerHTML = `<span class="cb-brand"><i></i>雪哔</span><span class="sep">/</span><span class="cb-user">${esc(app.user ? app.user.name : '')}</span><span class="sep">/</span><b>${esc(folder.title)}</b>`;
    }

    renderVideoList();
    if (app.videoId) loadVideo(app.videoId, false);
    else showEmptyEditor();
    updateProgress();
  }

  function showEmptyEditor() {
    const meta = $('#video-meta');
    const area = $('#editor-area');
    if (meta) meta.innerHTML = '';
    if (area) {
      area.innerHTML = '';
      area.setAttribute('contenteditable', 'false');
      area.dataset.ph = '这个收藏夹还没有可读取的视频。';
    }
  }

  /* ═══════════ 视频列表 ═══════════ */
  function renderVideoList() {
    const app = state();
    const folder = app.folder;
    const count = $('#vl-count');
    if (count) count.textContent = `${folder.videos.length} 支`;

    const root = $('#vl-items');
    if (!root) return;

    root.innerHTML = folder.videos.map((video, index) => {
      const multi = video.pages && video.pages.length > 1;
      return `<div class="v-item ${video.id === app.videoId ? 'active' : ''}" data-vid="${esc(video.id)}">
        <span class="v-num">${U.pad2(index + 1)}</span>
        <img class="v-thumb" src="${esc(Folio.BiliApi.thumb(video.cover, 200, 125))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">
        <div class="v-txt">
          <span class="v-title">${esc(video.title)}</span>
          <span class="v-up">${esc(video.up)} · ${U.formatDuration(video.dur)}${multi ? ` · ${video.pages.length}P` : ''}</span>
        </div>
        <span class="v-done ${video.done ? 'show' : ''}">${I.check}</span>
      </div>`;
    }).join('');

    $$('#vl-items .v-item').forEach((item) => {
      item.onclick = () => loadVideo(item.dataset.vid, true);
    });
  }

  function bigCover(video) {
    const src = video.cover || '';
    if (src.includes('@320w_200h_1c.webp')) return src.replace('@320w_200h_1c.webp', '@480w_300h_1c.webp');
    if (src.includes('picsum.photos')) return src.replace('/320/200', '/480/300');
    return Folio.BiliApi.image(src, 480, 300);
  }

  function metaHTML(video) {
    const app = state();
    const list = app.folder.videos;
    const index = U.pad2(list.indexOf(video) + 1);
    const multi = video.pages && video.pages.length > 1;
    const link = Folio.BiliApi.videoUrl(video.bvid);
    const desc = (video.desc || '').trim();

    return `<div class="v-head">
      <div class="vh-cover">
        <img src="${esc(bigCover(video))}" alt="" referrerpolicy="no-referrer">
        <span class="vh-dur">${U.formatDuration(video.dur)}</span>
      </div>
      <div class="vh-info">
        <p class="vh-no">№ ${index} / ${U.pad2(list.length)} · ${esc(video.bvid || '')}</p>
        <h2>${esc(video.title)}</h2>
        <div class="vh-meta">
          <span>${I.user} ${esc(video.up)}</span>
          <span>${I.play} ${esc(video.play)}</span>
          <span>${I.dm} ${esc(video.danmaku)}</span>
          <span>${I.clock} ${U.formatDuration(video.dur)}</span>
          ${multi ? `<span class="p-badge">${I.layers} 全 ${video.pages.length}P（P1 ${U.formatDuration(video.pages[0].d)}）</span>` : ''}
        </div>
        ${desc ? `<details class="vh-desc"><summary>B 站简介 · 写作素材</summary><p>${esc(desc)}</p></details>` : ''}
        ${link ? `<a class="vh-link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">在哔哩哔哩观看 ${I.arrUR}</a>` : ''}
      </div>
    </div>`;
  }

  function loadVideo(id, commit = true) {
    const app = state();
    if (commit) commitCurrentIntro();
    if (app.annotating) finishAnno(app.annotating);

    app.videoId = id;
    app.savedRange = null;
    setDrawer(false);

    const video = currentVideo();
    if (!video) return;

    const meta = $('#video-meta');
    if (meta) meta.innerHTML = metaHTML(video);

    const area = $('#editor-area');
    area.setAttribute('contenteditable', 'true');
    const saved = U.storage.get(draftKey(video));
    area.innerHTML = video._forceIntro != null ? video._forceIntro : (saved != null ? saved : (video.intro || ''));
    delete video._forceIntro;

    const doc = $('#doc');
    if (doc) {
      doc.classList.remove('doc-in');
      void doc.offsetWidth;
      doc.classList.add('doc-in');
    }

    updateWordCount();
    $$('#vl-items .v-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.vid === id);
    });
    const active = $('#vl-items .v-item.active');
    if (active) active.scrollIntoView({ block: 'nearest' });

    if (Folio.App && Folio.App.noteVideoChanged) Folio.App.noteVideoChanged(video);
  }

  function commitCurrentIntro() {
    const app = state();
    const video = currentVideo();
    if (!video) return;
    const area = $('#editor-area');
    if (!area) return;

    video.intro = area.innerHTML;
    saveDraft(video);

    const text = area.textContent.replace(/\s/g, '');
    const hasImage = !!area.querySelector('figure,img,.inline-fig');
    const wasDone = video.done;
    video.done = text.length > 4 || (hasImage && text.length > 0);

    if (wasDone !== video.done) {
      const item = $(`#vl-items .v-item[data-vid="${video.id}"]`);
      if (item) item.querySelector('.v-done').classList.toggle('show', video.done);
      updateProgress();
    }
  }

  function updateWordCount() {
    const area = $('#editor-area');
    if (!area) return;
    const count = $('#tb-count');
    if (count) count.textContent = `${area.textContent.replace(/\s/g, '').length} 字`;
    area.classList.toggle('blank', !area.textContent.trim() && !area.querySelector('figure,img,.inline-fig'));
  }

  /**
   * 导入 PDF 后恢复简报：
   *   只覆盖当前收藏夹里能按 BVID / id 匹配到的视频；
   *   同时写回 localStorage，保证刷新后仍能继续编辑。
   */
  function applyImportedBrief(payload) {
    const app = state();
    if (!app.folder || !payload || !Array.isArray(payload.videos)) {
      return { applied: 0, skipped: 0, storageFailed: 0 };
    }

    const byBvid = new Map();
    const byId = new Map();
    app.folder.videos.forEach((video) => {
      if (video.bvid) byBvid.set(String(video.bvid).toLowerCase(), video);
      if (video.id) byId.set(String(video.id), video);
    });

    let applied = 0;
    let skipped = 0;
    let storageFailed = 0;

    payload.videos.forEach((item) => {
      if (!item || typeof item !== 'object') {
        skipped += 1;
        return;
      }

      const intro = Folio.Brief && Folio.Brief.sanitizeIntro
        ? Folio.Brief.sanitizeIntro(item.intro || '')
        : String(item.intro || '');
      // 只恢复文件里确实有简报内容的视频，避免把其他视频的新草稿清空
      if (!intro.trim()) return;

      const bvid = String(item.bvid || '').toLowerCase();
      const id = String(item.id || '');
      const video = (bvid && byBvid.get(bvid)) || (id && byId.get(id));
      if (!video) {
        skipped += 1;
        return;
      }

      video.intro = intro;
      video.done = typeof item.done === 'boolean'
        ? item.done
        : intro.replace(/<[^>]+>/g, '').trim().length > 4;
      video._forceIntro = intro;

      const ok = U.storage.set(draftKey(video), intro);
      if (!ok) storageFailed += 1;
      applied += 1;
    });

    if (applied) {
      renderVideoList();
      if (app.videoId) loadVideo(app.videoId, false);
      updateProgress();
      updateWordCount();
    }

    return { applied, skipped, storageFailed };
  }

  function updateProgress() {
    const app = state();
    if (!app.folder) return;
    const total = app.folder.videos.length;
    const done = doneCount();
    const circumference = 226.2;

    const ringDone = $('#ring-done');
    const ringTotal = $('#ring-total');
    const ringFg = $('#ring-fg');
    const chip = $('#chip-prog');
    const tip = $('#ring-tip');

    if (ringDone) ringDone.textContent = done;
    if (ringTotal) ringTotal.textContent = `/${total}`;
    if (ringFg) ringFg.style.strokeDashoffset = total ? circumference * (1 - done / total) : circumference;
    if (chip) chip.textContent = `${done}/${total}`;
    if (tip) {
      tip.textContent = done === 0 ? '还没开始，第一篇最难，也最好写。'
        : done < total / 2 ? '开了一个好头，继续保持。'
        : done < total ? '已过半程，胜利在望。'
        : '全部完成，随时可以成册。';
    }
  }

  /* ═══════════ 左侧抽屉（移动端） ═══════════ */
  function setDrawer(open) {
    const list = $('#ed-list');
    const scrim = $('#drawer-scrim');
    if (list) list.classList.toggle('open', !!open);
    if (scrim) scrim.classList.toggle('show', !!open);
  }

  /* ═══════════ 工具栏 ═══════════ */
  function setupColorPalette() {
    const trigger = $('#tb-color');
    const palette = $('#tb-palette');
    const bar = $('#tb-color-bar');
    const area = $('#editor-area');
    if (!trigger || !palette || !area) return;

    const setBar = (color) => {
      if (bar && color) bar.style.background = color;
    };

    trigger.onclick = (event) => {
      event.stopPropagation();
      palette.classList.toggle('open');
    };

    palette.querySelectorAll('[data-color]').forEach((swatch) => {
      swatch.addEventListener('mousedown', (event) => event.preventDefault());
      swatch.onclick = (event) => {
        event.stopPropagation();
        area.focus();
        let color = swatch.dataset.color;
        if (color === 'default') color = getComputedStyle(area).color || 'rgb(60,60,67)';
        document.execCommand('foreColor', false, color);
        setBar(color);
        palette.classList.remove('open');
        saveDraftSoon();
      };
    });

    document.addEventListener('click', (event) => {
      if (!event.target.closest('#tb-color-wrap')) palette.classList.remove('open');
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') palette.classList.remove('open');
    });
  }

  function bindToolbar() {
    setupColorPalette();

    $$('#toolbar .tb-btn').forEach((button) => {
      button.addEventListener('mousedown', (event) => { if (FINE) event.preventDefault(); });
      // 颜色按钮由 setupColorPalette 处理，不要被通用按钮逻辑覆盖
      if (button.id === 'tb-color') return;
      button.onclick = () => {
        const area = $('#editor-area');
        area.focus();
        if (button.dataset.cmd) {
          document.execCommand(button.dataset.cmd, false, null);
        } else if (button.dataset.block) {
          let node = getSelection().anchorNode;
          while (node && node !== area) {
            if (node.nodeName === 'BLOCKQUOTE') {
              document.execCommand('formatBlock', false, '<p>');
              return;
            }
            node = node.parentNode;
          }
          document.execCommand('formatBlock', false, '<blockquote>');
        } else if (button.dataset.hr) {
          document.execCommand('insertHorizontalRule', false, null);
        } else if (button.dataset.insimg) {
          openInsertPanel();
        }
      };
    });

    document.addEventListener('selectionchange', () => {
      const app = state();
      const selection = getSelection();
      const area = $('#editor-area');
      if (selection.rangeCount && area && area.contains(selection.anchorNode)) {
        app.savedRange = selection.getRangeAt(0).cloneRange();
      }
    });

    const area = $('#editor-area');
    if (!area) return;

    area.addEventListener('input', () => {
      updateWordCount();
      saveDraftSoon();
    });

    area.addEventListener('blur', () => {
      const video = currentVideo();
      if (video) saveDraft(video);
    });

    area.addEventListener('paste', (event) => {
      const items = Array.from((event.clipboardData && event.clipboardData.items) || []);
      const imageItem = items.find((item) => item.type.startsWith('image/'));
      if (!imageItem) return;

      event.preventDefault();
      const reader = new FileReader();
      reader.onload = () => {
        const probe = new Image();
        probe.onload = () => {
          const inline = probe.naturalWidth <= 260 && probe.naturalHeight <= 260;
          insertMediaHTML(inline ? inlineFigHTML(reader.result) : mediaBlockHTML(reader.result));
          toast(inline ? '已插入行内小图（小尺寸图片自动嵌入文字中）' : '已插入整行配图，点击图上铅笔可添加标注');
        };
        probe.onerror = () => {
          insertMediaHTML(mediaBlockHTML(reader.result));
          toast('已插入配图');
        };
        probe.src = reader.result;
      };
      reader.readAsDataURL(imageItem.getAsFile());
    });

    area.addEventListener('click', (event) => {
      const inlineButton = event.target.closest('[data-iact]');
      if (inlineButton) {
        const fig = inlineButton.closest('.inline-fig');
        if (fig) {
          if (inlineButton.dataset.iact === 'del') {
            fig.remove();
            toast('已删除行内小图');
          } else if (inlineButton.dataset.iact === 'size') {
            const orig = fig.classList.toggle('orig-size');
            inlineButton.title = orig ? '恢复贴合文字' : '使用原始尺寸';
            saveDraftSoon();
            toast(orig ? '行内图已按原始尺寸显示' : '行内图已贴合文字');
          } else if (inlineButton.dataset.iact === 'grow') {
            const src = fig.querySelector('img') && fig.querySelector('img').src;
            if (src) {
              fig.replaceWith(elementFromHTML(mediaBlockHTML(src)));
              toast('已放大为整行配图，点击铅笔可添加标注');
            }
          }
        }
        return;
      }

      const mediaButton = event.target.closest('[data-mact]');
      if (!mediaButton) return;
      const block = mediaButton.closest('.media-block');
      const action = mediaButton.dataset.mact;

      if (action === 'anno') toggleAnno(block);
      else if (action === 'del') { block.remove(); toast('已删除配图'); }
      else if (action === 'dl') exportBlock(block, true);
      else if (action === 'copy') exportBlock(block, false);
      else if (action === 'shrink') {
        const canvas = blockCanvas(block);
        if (!canvas) return;
        block.replaceWith(elementFromHTML(inlineFigHTML(canvas.toDataURL('image/png'))));
        toast('已转为行内小图，标注已合并进图片');
      }
    });
  }

  /* ═══════════ 配图 HTML ═══════════ */
  function mediaBlockHTML(src) {
    return `<figure class="media-block" contenteditable="false"><div class="media-wrap">
      <img src="${src}" crossorigin="anonymous" alt="配图"><canvas class="anno-canvas"></canvas>
      <div class="anno-bar">
        <div class="ab-group ab-tools"><button type="button" data-anno="pen" class="on">${I.pen}</button><button type="button" data-anno="rect">${I.rect}</button><button type="button" data-anno="arrow">${I.arrowT}</button><button type="button" data-anno="text">${I.type}</button></div>
        <div class="ab-group ab-colors"><button type="button" data-color="#518FF4" class="on" style="--c:#518FF4"></button><button type="button" data-color="#22C3DD" style="--c:#22C3DD"></button><button type="button" data-color="#FBBF24" style="--c:#FBBF24"></button><button type="button" data-color="#FFFFFF" style="--c:#FFFFFF"></button></div>
        <span class="ab-sep"></span>
        <div class="ab-group ab-ops"><button type="button" data-anno="undo">${I.undo}</button><button type="button" data-anno="clear">${I.trash}</button><button type="button" data-anno="done" class="ab-done">${I.check}<span>完成</span></button></div>
      </div>
      <div class="media-actions"><button type="button" data-mact="anno" title="添加标注">${I.pen}</button><button type="button" data-mact="shrink" title="转为行内小图">${I.shrink}</button><button type="button" data-mact="copy" title="复制图片">${I.copy}</button><button type="button" data-mact="dl" title="下载标注图">${I.dl}</button><button type="button" data-mact="del" title="删除配图">${I.trash}</button></div>
    </div><figcaption contenteditable="true"></figcaption></figure>`;
  }

  function inlineFigHTML(src, origSize = false) {
    return `<span class="inline-fig${origSize ? ' orig-size' : ''}" contenteditable="false"><img src="${src}" crossorigin="anonymous" alt="行内小图"><span class="inline-actions"><button type="button" data-iact="size" title="${origSize ? '恢复贴合文字' : '使用原始尺寸'}">${I.rect}</button><button type="button" data-iact="grow" title="放大为整行配图">${I.expand}</button><button type="button" data-iact="del" title="删除">${I.trash}</button></span></span>`;
  }

  function elementFromHTML(html) {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    return template.content.firstElementChild;
  }

  function insertMediaHTML(html) {
    const app = state();
    const area = $('#editor-area');
    if (app.savedRange) {
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(app.savedRange);
      document.execCommand('insertHTML', false, html);
    } else {
      area.insertAdjacentHTML('beforeend', html);
    }
    area.focus();
  }

  /* ═══════════ 插入配图面板 ═══════════ */
  let pickMode = 'block';
  let pickOrigSize = false;

  function openInsertPanel() {
    pickMode = 'block';
    pickOrigSize = false;
    const video = currentVideo();
    const cover = video ? bigCover(video) : '';
    Folio.UI.openModal(`<div class="modal" style="width:640px">
      <header class="m-head"><div><p class="overline">INSERT · 配图</p><h3>插入一张配图</h3><p>选择排版方式，再点击图片插入当前光标处。</p></div><button class="m-close" data-close>${I.x}</button></header>
      <div class="pick-mode-row">
        <div class="seg" id="pick-seg"><button class="on" data-mode="block">整行配图</button><button data-mode="inline">行内小图</button></div>
        <p class="pick-mode-tip" id="pick-tip"></p>
      </div>
      <div class="pick-mode-row pick-size-row" id="pick-size-row" style="display:none">
        <div class="seg" id="pick-size"><button class="on" data-size="compact">贴合文字</button><button data-size="orig">原始尺寸</button></div>
        <p class="pick-mode-tip">原始尺寸适合截图和细节图；过大的图片会自动限制在编辑区内。</p>
      </div>
      <div class="pick-grid" id="pick-grid"></div>
      <p class="hint center">整行配图独占一行、可自由标注；行内小图像贴纸一样嵌在文字中间。也可以直接粘贴图片，或从本机上传。</p>
    </div>`);

    const render = () => {
      const tip = $('#pick-tip');
      if (tip) {
        tip.textContent = pickMode === 'block'
          ? '独占一行 · 适合截图、大图与自由标注'
          : '嵌入文字 · 像贴纸一样跟随文字流动';
      }
      const sizeRow = $('#pick-size-row');
      if (sizeRow) sizeRow.style.display = pickMode === 'inline' ? '' : 'none';

      const grid = $('#pick-grid');
      if (!grid) return;
      grid.classList.toggle('sq', pickMode === 'inline');
      grid.innerHTML = `
        ${cover ? `<button class="pick-opt" data-src="${esc(cover)}"><img src="${esc(cover)}" alt="" referrerpolicy="no-referrer"></button>` : ''}
        <button class="pick-opt pick-upload" data-upload="1">
          <span class="pick-upload-icon">${I.upload}</span>
          <span>从本机上传</span>
          <input type="file" accept="image/*" hidden>
        </button>`;

      grid.querySelectorAll('.pick-opt[data-src]').forEach((button) => {
        button.onclick = () => {
          insertMediaHTML(pickMode === 'block' ? mediaBlockHTML(button.dataset.src) : inlineFigHTML(button.dataset.src, pickOrigSize));
          Folio.UI.closeModal();
          toast(pickMode === 'block' ? '已插入整行配图，点击图上的铅笔可添加标注' : '已插入行内小图，随文字流动');
        };
      });

      const upload = grid.querySelector('[data-upload]');
      if (upload) {
        const input = upload.querySelector('input');
        upload.onclick = (event) => {
          if (event.target !== input) input.click();
        };
        input.onchange = () => {
          const file = input.files && input.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            insertMediaHTML(pickMode === 'block' ? mediaBlockHTML(reader.result) : inlineFigHTML(reader.result, pickOrigSize));
            Folio.UI.closeModal();
            toast('已插入本地图片');
          };
          reader.readAsDataURL(file);
        };
      }
    };

    const seg = $('#pick-seg');
    if (seg) seg.onclick = (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      pickMode = button.dataset.mode;
      $$('#pick-seg button').forEach((item) => item.classList.toggle('on', item === button));
      render();
    };

    const sizeSeg = $('#pick-size');
    if (sizeSeg) sizeSeg.onclick = (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      pickOrigSize = button.dataset.size === 'orig';
      $$('#pick-size button').forEach((item) => item.classList.toggle('on', item === button));
    };

    render();
  }

  /* ═══════════ 图片导出 ═══════════ */
  function blockCanvas(block) {
    const img = block.querySelector('img');
    if (!img || !img.naturalWidth) {
      toast('图片还在加载，稍等片刻再试', 'warn');
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const anno = block.querySelector('.anno-canvas');
    if (anno && block.dataset.annoInit === '1') ctx.drawImage(anno, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function exportBlock(block, download) {
    const canvas = blockCanvas(block);
    if (!canvas) return;
    if (download) {
      const link = document.createElement('a');
      link.download = 'folio-image.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      toast('已导出含标注的图片');
      return;
    }
    try {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('图片已复制到剪贴板');
    } catch (err) {
      toast('当前浏览器不支持复制图片，可改用下载', 'warn');
    }
  }

  /* ═══════════ 画布标注 ═══════════ */
  function toggleAnno(block) {
    const app = state();
    if (app.annotating === block) { finishAnno(block); return; }
    if (app.annotating) finishAnno(app.annotating);
    startAnno(block);
  }

  function finishAnno(block) {
    const app = state();
    if (!block) return;
    block.classList.remove('annotating');
    document.body.classList.remove('is-annotating');
    if (app.annotating === block) app.annotating = null;
  }

  function startAnno(block) {
    const app = state();
    block.classList.add('annotating');
    app.annotating = block;
    document.body.classList.add('is-annotating');
    if (!FINE) setTimeout(() => block.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120);

    const canvas = block.querySelector('.anno-canvas');
    if (block.dataset.annoInit !== '1') {
      const initCanvas = () => {
        // 图片加载完成前 .media-wrap 高度≈0，此时按 offsetHeight 初始化会得到 2px 高的画布且永不修正；
        // 因此等图片就绪再初始化（重新初始化会清空画布，所以仍只在第一次进入时做）。
        const dpr = window.devicePixelRatio || 1;
        canvas.width = canvas.offsetWidth * dpr;
        canvas.height = canvas.offsetHeight * dpr;
        block.dataset.annoInit = '1';
        block.dataset.dpr = dpr;
        const context = canvas.getContext('2d');
        context.scale(dpr, dpr);
        context.lineWidth = 3.5;
        context.lineCap = 'round';
        context.lineJoin = 'round';
      };
      const img = block.querySelector('img');
      if (img && img.complete && img.naturalWidth) initCanvas();
      else if (img) img.addEventListener('load', initCanvas, { once: true });
      else initCanvas();
    }

    const ctx = canvas.getContext('2d');
    let tool = 'pen';
    let color = '#518FF4';
    // 快照用离屏 canvas 而不是 getImageData：
    //   · getImageData 每次都做 GPU→CPU 回读，笔画起步会顿一下，撤销栈还会占大量 CPU 内存；
    //   · 矩形/箭头预览原来每帧 putImageData 整幅回拷，同样很重；离屏 canvas + drawImage 走 GPU 路径。
    //   · 恢复 = identity 变换下 clearRect + drawImage，像素结果与 putImageData 完全一致；撤销语义不变。
    const makeSnapshot = () => {
      const snap = document.createElement('canvas');
      snap.width = canvas.width;
      snap.height = canvas.height;
      snap.getContext('2d').drawImage(canvas, 0, 0);
      return snap;
    };
    const restoreSnapshot = (snap) => {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(snap, 0, 0);
      ctx.restore();
    };
    const snapshots = [];
    const push = () => snapshots.push(makeSnapshot());
    const position = (event) => {
      const rect = canvas.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };

    let drawing = false;
    let lastX = 0;
    let lastY = 0;
    let snapshotBefore = null;

    const arrow = (x1, y1, x2, y2) => {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const len = Math.min(20, Math.hypot(x2 - x1, y2 - y1) / 2.5);
      ctx.moveTo(x2, y2); ctx.lineTo(x2 - len * Math.cos(angle - 0.45), y2 - len * Math.sin(angle - 0.45));
      ctx.moveTo(x2, y2); ctx.lineTo(x2 - len * Math.cos(angle + 0.45), y2 - len * Math.sin(angle + 0.45));
      ctx.stroke();
    };

    canvas.onpointerdown = (event) => {
      event.preventDefault();
      if (tool === 'text') { placeText(event); return; }
      drawing = true;
      canvas.setPointerCapture(event.pointerId);
      [lastX, lastY] = position(event);
      push();
      if (tool !== 'pen') snapshotBefore = makeSnapshot();
      if (tool === 'pen') {
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(lastX, lastY, ctx.lineWidth / 2, 0, 7);
        ctx.fillStyle = color;
        ctx.fill();
      }
    };

    canvas.onpointermove = (event) => {
      if (!drawing) return;
      const [x, y] = position(event);
      if (tool === 'pen') {
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(x, y);
        ctx.stroke();
        lastX = x;
        lastY = y;
      } else if (tool === 'rect') {
        restoreSnapshot(snapshotBefore);
        ctx.strokeStyle = color;
        ctx.strokeRect(lastX, lastY, x - lastX, y - lastY);
      } else if (tool === 'arrow') {
        restoreSnapshot(snapshotBefore);
        ctx.strokeStyle = color;
        arrow(lastX, lastY, x, y);
      }
    };

    canvas.onpointerup = () => { drawing = false; snapshotBefore = null; };

    function placeText(event) {
      const [x, y] = position(event);
      const wrap = block.querySelector('.media-wrap');
      const input = document.createElement('input');
      input.className = 'anno-text-input';
      input.placeholder = '输入文字，回车确认';
      input.style.left = `${Math.min(x, Math.max(wrap.clientWidth - 170, 0))}px`;
      input.style.top = `${Math.max(y - 16, 2)}px`;
      wrap.appendChild(input);
      input.focus();

      let closed = false;
      const commit = () => {
        if (closed) return;
        closed = true;
        const value = input.value.trim();
        input.remove();
        if (!value) return;
        push();
        ctx.font = `600 16px ${getComputedStyle(document.body).fontFamily}`;
        ctx.lineWidth = 4;
        ctx.strokeStyle = document.body.dataset.theme === 'dark' ? 'rgba(0,0,0,.75)' : 'rgba(255,255,255,.92)';
        ctx.strokeText(value, x, y + 5);
        ctx.fillStyle = color;
        ctx.fillText(value, x, y + 5);
      };

      input.addEventListener('keydown', (keyEvent) => {
        if (keyEvent.key === 'Enter') { keyEvent.preventDefault(); commit(); }
        if (keyEvent.key === 'Escape') { closed = true; input.remove(); }
      });
      input.addEventListener('blur', commit);
    }

    block.querySelector('.anno-bar').onclick = (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      const action = button.dataset.anno;
      if (action === 'undo') {
        const snapshot = snapshots.pop();
        if (snapshot) restoreSnapshot(snapshot);
      } else if (action === 'clear') {
        push();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      } else if (action === 'done') {
        finishAnno(block);
        toast('标注已保存，会随长图一起导出');
      } else if (action) {
        tool = action;
        block.querySelectorAll('.ab-tools button').forEach((item) => item.classList.toggle('on', item === button));
      }
      if (button.dataset.color) {
        color = button.dataset.color;
        block.querySelectorAll('.ab-colors button').forEach((item) => item.classList.toggle('on', item === button));
      }
    };

    toast('标注模式：选择工具与颜色在图上绘制，完成后点「完成」');
  }

  /* ═══════════ 初始化 ═══════════ */
  function init() {
    bindToolbar();

    window.addEventListener('resize', () => {
      const app = state();
      if (app.annotating) finishAnno(app.annotating);
    });

    window.addEventListener('beforeunload', () => {
      const video = currentVideo();
      if (video) saveDraft(video);
    });
  }

  Folio.Editor = {
    init,
    open,
    setDrawer,
    loadVideo,
    commitCurrentIntro,
    applyImportedBrief,
    updateProgress,
    updateWordCount,
    currentVideo
  };
})(window.Folio = window.Folio || {});
