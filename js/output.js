/* ==========================================================================
   output.js — 输出：完整文本 / 介绍长图 / Excel / PDF，以及 PDF 回导入口

   分享页已移除：页面部署在静态主机上，没有服务器可保存数据。
   PDF 完全在浏览器本地生成，可下载、可回导继续编辑。
   ========================================================================== */
(function (Folio) {
  'use strict';

  const U = Folio.Utils;
  const $ = U.$;
  const $$ = U.$$;
  const esc = U.esc;
  const I = Folio.Icons;
  const toast = (message, type) => Folio.UI.toast(message, type);
  const state = () => Folio.App.state;

  /* ═══════════ 文本 ═══════════ */
  const TEXT_BLOCK_TAGS = new Set(['P', 'DIV', 'BLOCKQUOTE', 'FIGURE', 'HR', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

  function inlineToText(node) {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1) return '';
    const el = node;
    if (el.tagName === 'BR') return '\n';
    if (el.tagName === 'IMG') return '〔图〕';
    if (el.classList && el.classList.contains('inline-fig')) return '〔图〕';
    return Array.from(el.childNodes).map(inlineToText).join('');
  }

  /**
   * 把编辑器 HTML 转成适合粘贴的纯文本：
   *   段落 / 列表 / 引用各占一行，图片保留占位符，不丢换行。
   */
  function introToText(html) {
    const root = document.createElement('div');
    root.innerHTML = html || '';
    const blocks = [];

    const walk = (nodes) => {
      Array.from(nodes).forEach((node) => {
        if (node.nodeType === 3) {
          const text = String(node.nodeValue || '').replace(/\s+/g, ' ');
          if (text.trim()) blocks.push(text.trim());
          return;
        }
        if (node.nodeType !== 1) return;

        const el = node;
        const tag = el.tagName;
        if (tag === 'P' || tag === 'DIV') {
          const hasBlock = Array.from(el.children).some((child) => TEXT_BLOCK_TAGS.has(child.tagName));
          if (hasBlock) { walk(el.childNodes); return; }
          const text = inlineToText(el).trim();
          if (text) blocks.push(text);
          return;
        }
        if (tag === 'BLOCKQUOTE') { walk(el.childNodes); return; }
        if (tag === 'UL' || tag === 'OL') {
          Array.from(el.children).filter((child) => child.tagName === 'LI').forEach((li, index) => {
            const text = inlineToText(li).trim();
            if (text) blocks.push(`${tag === 'OL' ? `${index + 1}. ` : '• '}${text}`);
          });
          return;
        }
        if (tag === 'FIGURE') {
          const caption = (el.querySelector('figcaption') && el.querySelector('figcaption').textContent || '').trim();
          blocks.push(caption ? `〔配图：${caption}〕` : '〔配图〕');
          return;
        }
        if (tag === 'HR') { blocks.push('────────'); return; }
        if (tag === 'IMG') { blocks.push('〔图〕'); return; }
        const text = inlineToText(el).trim();
        if (text) blocks.push(text);
      });
    };

    walk(root.childNodes);
    return blocks.join('\n');
  }

  function textEntries() {
    const app = state();
    const folder = app.folder;
    const user = app.user || { name: '我', mid: '' };
    const options = readOutputOptions();
    const list = folder.videos.filter((video) => video.done);

    const entries = list.map((video) => {
      const index = folder.videos.indexOf(video) + 1;
      const lines = [`【${U.pad2(index)}】${String(video.title)}`];
      if (options.showUp && video.up) lines.push(`UP主 ${video.up}`);
      lines.push('');
      lines.push(introToText(video.intro));
      return lines.join('\n');
    });

    const head = [
      `《${folder.title}》`,
      `整理人：${user.name}${user.mid ? `（UID ${user.mid}）` : ''}`,
      `共 ${folder.videos.length} 支视频 · 已写 ${list.length} 篇 · ${U.today()}`
    ].join('\n');

    const tail = '—— 由「雪哔」整理';
    const parts = [head];
    entries.forEach((entry, index) => {
      if (index > 0) parts.push('────────────');
      parts.push(entry);
    });
    parts.push(tail);

    return {
      head,
      entries,
      tail,
      plain: parts.join('\n\n')
    };
  }

  function buildText() {
    return textEntries().plain;
  }

  function openTextModal() {
    const app = state();
    const folder = app.folder;
    const user = app.user || { name: '我' };
    const options = readOutputOptions();
    const list = folder.videos.filter((video) => video.done);
    const payload = textEntries();

    Folio.UI.openModal(`<div class="modal" style="width:740px">
      <header class="m-head"><div><p class="overline">OUTPUT 01 · 文本</p><h3>完整简报文本</h3><p>每支视频一段，标题与正文空一行；可直接粘贴给 UP 主或发群聊。</p></div><button class="m-close" data-close>${I.x}</button></header>
      <div class="tx-scroll">
        <div class="tx-doc">
          <div class="tx-title">《${esc(folder.title)}》</div>
          <p class="tx-sub">整理人 ${esc(user.name)} · 已写 ${list.length}/${folder.videos.length} 篇 · ${U.today()}</p>
          ${list.map((video) => {
            const index = folder.videos.indexOf(video) + 1;
            return `<div class="tx-entry">
              <p class="tx-no">【${U.pad2(index)}】</p>
              <h4>${esc(video.title)}</h4>
              ${options.showUp && video.up ? `<p class="tx-meta">UP主 ${esc(video.up)}</p>` : ''}
              <div class="tx-body">${esc(introToText(video.intro))}</div>
            </div>`;
          }).join('')}
        </div>
      </div>
      <footer class="m-foot"><span class="mono">${payload.plain.length} 字符 · ${list.length} 篇</span><button class="btn btn-primary" id="btn-copy-text">${I.copy} 复制全文</button></footer>
    </div>`);

    const copy = $('#btn-copy-text');
    if (copy) copy.onclick = () => U.copyText(payload.plain).then((ok) => toast(ok ? '全文已复制' : '复制失败，请手动选择', ok ? 'ok' : 'warn'));
  }

  /* ═══════════ 成册设置 ═══════════ */
  function readOutputOptions() {
    const showUp = $('[data-share="showUp"]');
    const allowRepost = $('[data-share="allowRepost"]');
    return {
      showUp: showUp ? showUp.checked : true,
      allowRepost: allowRepost ? allowRepost.checked : true
    };
  }

  /* ═══════════ 成品卡片（长图共用） ═══════════ */
  function buildFolio(folder, user, theme, options = {}) {
    const list = folder.videos.filter((video) => video.done);
    const firstTotal = list.reduce((sum, video) => sum + U.firstDuration(video), 0);
    const showUp = options.showUp !== false;
    const allowRepost = options.allowRepost !== false;

    const wrap = document.createElement('div');
    wrap.className = `folio${theme === 'dark' ? ' dark' : ''}`;
    wrap.innerHTML = `
      <div class="f-head">
        <div class="f-brand"><i></i><span>雪哔 · BILITIME</span></div>
        <h1>${esc(folder.title)}</h1>
        <div class="f-meta">整理人 ${esc(user.name)} ｜ 已写 ${list.length}/${folder.videos.length} 篇 ｜ 第一P <b>${U.formatDuration(firstTotal)}</b> ｜ ${U.today()}</div>
        <div class="f-acc"></div>
      </div>
      ${list.map((video) => {
        const index = U.pad2(folder.videos.indexOf(video) + 1);
        const multi = video.pages && video.pages.length > 1;
        const cover = video.cover && video.cover.includes('@320w_200h_1c.webp')
          ? video.cover.replace('@320w_200h_1c.webp', '@640w_400h_1c.webp')
          : (video.cover || '').replace('/320/200', '/640/400');
        return `<section class="f-block">
          <p class="f-no">№ ${index} · VIDEO</p>
          <div class="f-cover"><img src="${esc(cover)}" crossorigin="anonymous" alt="" referrerpolicy="no-referrer"><span class="f-dur">${U.formatDuration(video.dur)}</span></div>
          <h2>${esc(video.title)}</h2>
          <p class="f-info">${showUp ? `UP主 ${esc(video.up)} · ` : ''}时长 ${U.formatDuration(video.dur)}${multi ? `（P1 ${U.formatDuration(video.pages[0].d)}）` : ''} · 播放 ${esc(video.play)}</p>
          <div class="f-intro">${video.intro || ''}</div>
        </section>`;
      }).join('')}
      <div class="f-foot">CURATED WITH SNAWCAP · 雪哔<br>BILIBILI FAVORITES · ${U.today()}<br>${allowRepost ? '欢迎转载，请注明出处' : '未经允许，请勿转载'}</div>`;

    wrap.querySelectorAll('[contenteditable]').forEach((el) => el.setAttribute('contenteditable', 'false'));
    wrap.querySelectorAll('.inline-actions').forEach((node) => node.remove());
    // 正文里的图不一定带 crossorigin；B 站图床对无 CORS 的 img 会返回 CORP 拦截，
    // 统一补上，html2canvas 也才能读取像素。
    wrap.querySelectorAll('img').forEach((img) => {
      img.setAttribute('crossorigin', 'anonymous');
      img.setAttribute('referrerpolicy', 'no-referrer');
    });
    return wrap;
  }

  function whenImagesLoaded(root) {
    return Promise.all(Array.from(root.querySelectorAll('img')).map((img) => (
      img.complete ? Promise.resolve() : new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve;
      })
    )));
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  }

  /**
   * 批量把网络图换成 data URL 再渲染。
   * B 站图床的部分尺寸对「已缓存的 no-cors 响应」不返回 CORS 头，
   * html2canvas 在克隆文档里会画不出来；内联后就没有跨域问题了。
   */
  async function inlineImages(root) {
    const imgs = Array.from(root.querySelectorAll('img'));
    await Promise.all(imgs.map(async (img) => {
      const src = img.getAttribute('src') || '';
      if (!/^https?:\/\//i.test(src)) return;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(src, {
          mode: 'cors',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: controller.signal
        });
        if (!response.ok) return;
        const blob = await response.blob();
        if (!blob.type || !blob.type.startsWith('image/')) return;
        const dataUrl = await blobToDataUrl(blob);
        if (!dataUrl) return;
        await new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve;
          img.src = dataUrl;
        });
      } catch (error) {
        // 单张图失败就保留原地址，不影响整体导出
      } finally {
        clearTimeout(timer);
      }
    }));
  }

  /* ═══════════ 长图 ═══════════ */
  let longImageTheme = 'light';

  function openImageModal() {
    longImageTheme = 'light';
    Folio.UI.openModal(`<div class="modal">
      <header class="m-head"><div><p class="overline">OUTPUT 02 · 长图</p><h3>生成简报长图</h3><p>按 800px 宽度、2 倍分辨率本地渲染，含整行封面、完整简报与配图。</p></div><button class="m-close" data-close>${I.x}</button></header>
      <div class="lg-body">
        <div class="lg-stage" id="lg-stage"></div>
        <div class="lg-side">
          <p class="lg-dim" id="lg-dim">尺寸计算中…</p>
          <div class="seg" id="lg-seg"><button class="on" data-th="light">浅色</button><button data-th="dark">深色</button></div>
          <button class="btn btn-primary" id="btn-dl-long">${I.dl} 下载 PNG</button>
          <p class="hint">长图包含收藏夹标题、每支视频的整行封面、时长与你的完整简报（含配图与标注）。由浏览器本地渲染，无上传。</p>
        </div>
      </div>
    </div>`);
    mountLongImage();

    const seg = $('#lg-seg');
    if (seg) seg.onclick = (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      longImageTheme = button.dataset.th;
      $$('#lg-seg button').forEach((item) => item.classList.toggle('on', item === button));
      mountLongImage();
    };

    const download = $('#btn-dl-long');
    if (download) download.onclick = downloadLongImage;
  }

  function mountLongImage() {
    const stage = $('#lg-stage');
    if (!stage) return;
    const app = state();
    stage.innerHTML = '';
    stage.appendChild(buildFolio(
      { ...app.folder, videos: (app.folder.videos || []).map((video) => ({ ...video, intro: introForExport(video) })) },
      app.user || { name: '我' },
      longImageTheme,
      readOutputOptions()
    ));
    whenImagesLoaded(stage).then(() => {
      const node = stage.querySelector('.folio');
      const dim = $('#lg-dim');
      if (node && dim) dim.textContent = `${node.offsetWidth * 2} × ${node.offsetHeight * 2} px（2× 渲染）`;
    });
  }

  async function downloadLongImage() {
    const node = $('#lg-stage .folio');
    if (!node) return;
    if (typeof window.html2canvas !== 'function') {
      toast('长图组件尚未加载，请检查网络后刷新', 'warn');
      return;
    }
    const button = $('#btn-dl-long');
    if (button) button.disabled = true;
    toast('正在渲染 2× 分辨率长图，请稍候…');

    await Promise.all([whenImagesLoaded(node), document.fonts.ready]);
    await inlineImages(node);
    await whenImagesLoaded(node);
    try {
      const canvas = await window.html2canvas(node, {
        scale: 2,
        useCORS: true,
        backgroundColor: null,
        logging: false
      });
      const link = document.createElement('a');
      link.download = `${String(state().folder.title).replace(/[\\/:*?"<>|·]/g, ' ')} · 雪哔.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      toast('长图已生成并开始下载');
    } catch (err) {
      toast('渲染失败，请重试或改用文本输出', 'warn');
    }
    if (button) button.disabled = false;
  }

  /* ═══════════ 导出前快照（合并画布标注） ═══════════ */
  /**
   * 当前编辑器里的画布标注像素不会被 innerHTML 保存；
   * 导出前把当前视频的标注合并进图片，避免导出的成品丢标注。
   */
  function snapshotEditor(area) {
    const clone = area.cloneNode(true);
    const liveBlocks = Array.from(area.querySelectorAll('.media-block'));
    const cloneBlocks = Array.from(clone.querySelectorAll('.media-block'));

    cloneBlocks.forEach((block, index) => {
      const live = liveBlocks[index];
      if (!live || live.dataset.annoInit !== '1') return;
      const liveImg = live.querySelector('img');
      const liveCanvas = live.querySelector('.anno-canvas');
      const targetImg = block.querySelector('img');
      if (!liveImg || !liveCanvas || !targetImg || !liveImg.naturalWidth) return;

      const merged = document.createElement('canvas');
      merged.width = liveImg.naturalWidth;
      merged.height = liveImg.naturalHeight;
      const ctx = merged.getContext('2d');
      ctx.drawImage(liveImg, 0, 0, merged.width, merged.height);
      if (liveCanvas.width && liveCanvas.height) {
        ctx.drawImage(liveCanvas, 0, 0, merged.width, merged.height);
      }
      try {
        targetImg.src = merged.toDataURL('image/png');
      } catch (err) {
        // 跨域图片未授权 canvas 读取时保留原图，不让导出整体失败
      }
    });

    clone.querySelectorAll('.anno-bar,.media-actions,.inline-actions,.anno-canvas').forEach((node) => node.remove());
    return clone.innerHTML;
  }

  function introForExport(video) {
    const app = state();
    if (video.id === app.videoId) {
      const area = $('#editor-area');
      if (area) return snapshotEditor(area);
    }
    return video.intro || '';
  }

  /* ═══════════ 入口 ═══════════ */
  function doOutput(kind) {
    const app = state();
    if (!app.folder) return;
    Folio.Editor.commitCurrentIntro();

    if (app.folder.videos.filter((video) => video.done).length === 0) {
      toast('先为至少一支视频写下简报，再来生成', 'warn');
      return;
    }

    if (kind === 'text') openTextModal();
    else if (kind === 'image') openImageModal();
    else if (kind === 'xlsx' && Folio.Xlsx) Folio.Xlsx.openModal();
    else if (kind === 'pdf' && Folio.Pdf) Folio.Pdf.openModal();
  }

  Folio.Output = {
    doOutput,
    openTextModal,
    openImageModal,
    buildFolio,
    buildText,
    introToText,
    introForExport,
    readOutputOptions,
    inlineImages,
    whenImagesLoaded
  };
})(window.Folio = window.Folio || {});
