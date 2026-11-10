/* ==========================================================================
   pdf.js — PDF 简报导出 / 回导

   为什么用「长图分页」：
     浏览器里没有可用的中文字体子集化方案；直接画文字会缺字。
     这里把 .folio 长图按原样渲染成位图，再按 A4 高度切片分页，
     所以版式、颜色、配色与长图完全一致。

   为什么能回导：
     PDF 的 Info 里写入 FOLIO-BRIEF:<base64url>，同时把 JSON 作为附件
     folio-brief.json 嵌入；导入时优先读 Info，读不到再解附件。
     校验 magic / schema / checksum / folderId，非雪哔或错收藏夹直接拒绝。

   目录：
     用 pdf-lib 的低层 context 写 /Outlines，PDF 查看器左侧目录可跳转。
   ========================================================================== */
(function (Folio) {
  'use strict';

  const U = Folio.Utils;
  const esc = U.esc;
  const I = Folio.Icons;
  const toast = (message, type) => Folio.UI.toast(message, type);
  const state = () => Folio.App.state;

  const PAGE_W = 595.28;   // A4 pt
  const PAGE_H = 841.89;
  const MARGIN_X = 48;
  const MARGIN_TOP = 44;
  const MARGIN_BOTTOM = 52;
  const MAX_CANVAS_HEIGHT = 30000;

  const A4 = {
    pageW: PAGE_W,
    pageH: PAGE_H,
    marginX: MARGIN_X,
    marginTop: MARGIN_TOP,
    marginBottom: MARGIN_BOTTOM
  };

  function imagesReady(root) {
    return Promise.all(Array.from(root.querySelectorAll('img')).map((img) => (
      img.complete ? Promise.resolve() : new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve;
      })
    )));
  }

  function safeName(text) {
    return String(text || '雪哔简报')
      .replace(/[\\/:*?"<>|\u0000-\u001F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || '雪哔简报';
  }

  /* ═══════════ 画布切片 ═══════════ */
  /**
   * 在一页的切点附近找「最白」的一行，避免把正文/图片切一半。
   * 评分 = 暗像素数 × 1000 + 与目标位置的偏差，优先白行，其次靠近目标。
   */
  function findQuietCut(ctx, from, target, limit) {
    const width = ctx.canvas.width;
    const start = Math.max(from + 160, target - 220);
    const end = Math.min(limit, target + 40);
    let best = target;
    let bestScore = Infinity;

    for (let y = start; y <= end; y += 1) {
      const row = ctx.getImageData(0, y, width, 1).data;
      let dark = 0;
      for (let i = 0; i < row.length; i += 16) {
        if (row[i] < 244 || row[i + 1] < 244 || row[i + 2] < 244) dark += 1;
      }
      const score = dark * 1000 + Math.abs(y - target);
      if (score < bestScore) {
        bestScore = score;
        best = y;
      }
    }
    return best;
  }

  async function sliceCanvas(canvas, sliceHeight) {
    const ctx = canvas.getContext('2d');
    const slices = [];
    let y = 0;

    while (y < canvas.height) {
      let end = Math.min(canvas.height, y + sliceHeight);
      if (end < canvas.height) {
        const cut = findQuietCut(ctx, y, end, canvas.height);
        if (cut > y + 200) end = cut;
      }

      const part = document.createElement('canvas');
      part.width = canvas.width;
      part.height = end - y;
      part.getContext('2d').drawImage(canvas, 0, y, canvas.width, end - y, 0, 0, canvas.width, end - y);

      const blob = await new Promise((resolve) => part.toBlob(resolve, 'image/jpeg', 0.9));
      slices.push({ y, h: end - y, bytes: new Uint8Array(await blob.arrayBuffer()) });
      y = end;
    }
    return slices;
  }

  /* ═══════════ PDF 目录 ═══════════ */
  function addOutlines(pdfDoc, items) {
    const { PDFName, PDFHexString } = window.PDFLib;
    if (!items.length) return;

    const pages = pdfDoc.getPages();
    const context = pdfDoc.context;
    const rootRef = context.nextRef();
    const itemRefs = items.map(() => context.nextRef());

    items.forEach((item, index) => {
      const page = pages[Math.min(item.page, pages.length - 1)];
      const dict = context.obj({
        Title: PDFHexString.fromText(item.title),
        Parent: rootRef,
        Dest: [page.ref, PDFName.of('FitH'), page.getHeight()]
      });
      if (index > 0) dict.set(PDFName.of('Prev'), itemRefs[index - 1]);
      if (index < items.length - 1) dict.set(PDFName.of('Next'), itemRefs[index + 1]);
      context.assign(itemRefs[index], dict);
    });

    context.assign(rootRef, context.obj({
      Type: PDFName.of('Outlines'),
      First: itemRefs[0],
      Last: itemRefs[itemRefs.length - 1],
      Count: items.length
    }));

    pdfDoc.catalog.set(PDFName.of('Outlines'), rootRef);
    pdfDoc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
  }

  /* ═══════════ 导出 ═══════════ */
  async function buildPdf(input) {
    if (!window.PDFLib) throw new Folio.BriefError('NO_PDFLIB', 'PDF 组件尚未加载，请刷新页面后重试。');
    if (typeof window.html2canvas !== 'function') {
      throw new Folio.BriefError('NO_CANVAS', '长图渲染组件尚未加载，请刷新页面后重试。');
    }
    const folder = input && input.folder;
    if (!folder) throw new Folio.BriefError('NO_FOLDER', '请先打开一个收藏夹。');

    const { PDFDocument, StandardFonts, rgb, PDFName, PDFString } = window.PDFLib;
    const allVideos = input.videos || folder.videos || [];
    const entries = allVideos
      .map((video, index) => ({ video, index }))
      .filter((entry) => entry.video.done);
    if (!entries.length) throw new Folio.BriefError('EMPTY', '先为至少一支视频写下简报，再来生成 PDF。');

    const node = Folio.Output.buildFolio(
      { ...folder, videos: allVideos },
      input.user || { name: '我' },
      'light',
      input.options || {}
    );

    const stage = document.createElement('div');
    stage.id = 'pdf-render-stage';
    stage.style.cssText = 'position:fixed;left:0;top:0;width:400px;background:#ffffff;z-index:1;pointer-events:none;';
    stage.appendChild(node);
    document.body.appendChild(stage);

    let canvas;
    let nodeHeight = 0;
    let blockOffsets = [];
    try {
      await Promise.all([imagesReady(node), document.fonts.ready]);
      await Folio.Output.inlineImages(node);
      await imagesReady(node);
      nodeHeight = node.offsetHeight;
      const nodeTop = node.getBoundingClientRect().top;
      blockOffsets = Array.from(node.querySelectorAll('.f-block')).map((block) => (
        Math.max(0, block.getBoundingClientRect().top - nodeTop)
      ));
      const scale = Math.min(2, MAX_CANVAS_HEIGHT / Math.max(nodeHeight, 1));
      canvas = await window.html2canvas(node, {
        scale: Math.max(1, scale),
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        width: 400,
        height: nodeHeight
      });
    } finally {
      stage.remove();
    }

    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle(`${folder.title || '雪哔简报'} · 雪哔简报`);
    pdfDoc.setAuthor((input.user && input.user.name) || '雪哔');
    pdfDoc.setCreator('雪哔 SnawCap');
    pdfDoc.setProducer('雪哔 SnawCap');
    pdfDoc.setSubject('BILITIME · B 站收藏夹 reaction 点播简报');
    pdfDoc.setCreationDate(new Date());
    pdfDoc.setModificationDate(new Date());

    const contentW = PAGE_W - MARGIN_X * 2;
    const contentH = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM;
    const drawScale = contentW / canvas.width;
    const sliceH = Math.floor(contentH / drawScale);
    const slices = await sliceCanvas(canvas, sliceH);

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < slices.length; i += 1) {
      const image = await pdfDoc.embedJpg(slices[i].bytes);
      const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      const drawH = slices[i].h * drawScale;
      page.drawImage(image, {
        x: MARGIN_X,
        y: PAGE_H - MARGIN_TOP - drawH,
        width: contentW,
        height: drawH
      });
      page.drawText(`BILITIME · ${String(i + 1).padStart(2, '0')} / ${String(slices.length).padStart(2, '0')}`, {
        x: MARGIN_X,
        y: 24,
        size: 7.5,
        font,
        color: rgb(0.64, 0.63, 0.67)
      });
    }

    /* 目录：按 .f-block 在长图中的位置换算到页 */
    const scaleY = canvas.height / Math.max(1, nodeHeight);
    const items = [{ title: `封面 · 《${folder.title || ''}》`, page: 0 }];
    entries.forEach((entry, index) => {
      const video = entry.video;
      const offset = (blockOffsets[index] || 0) * scaleY;
      let pageIndex = slices.findIndex((slice) => offset >= slice.y && offset < slice.y + slice.h);
      if (pageIndex < 0) pageIndex = slices.length - 1;
      items.push({
        title: `【${U.pad2(entry.index + 1)}】${String(video.title || '').slice(0, 80)}`,
        page: pageIndex
      });
    });
    addOutlines(pdfDoc, items);

    /* 回导载荷：Info（小体积）+ 附件（标准通道） */
    const payload = Folio.Brief.buildPayload(
      folder,
      input.user,
      input.options || {},
      (input.videos || folder.videos).filter((video) => video.done).map((video, index) => ({ video, index, intro: video.intro || '' }))
    );
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    // Info 是纯文本通道，太大就别塞（本地图片很多时 JSON 会到几 MB）；
    // 附件通道始终写入，导入时按 Info → 附件 的顺序读取。
    const encoded = Folio.Brief.encodePayload(payload);
    if (encoded.length <= 200000) {
      pdfDoc.getInfoDict().set(PDFName.of('FolioBrief'), PDFString.of(encoded));
    }
    await pdfDoc.attach(payloadBytes, 'folio-brief.json', {
      mimeType: 'application/json',
      description: '雪哔 SnawCap brief payload'
    });

    const bytes = await pdfDoc.save();
    return {
      blob: new Blob([bytes], { type: 'application/pdf' }),
      fileName: `${safeName(folder.title)} · 雪哔简报.pdf`,
      pages: slices.length,
      videoCount: entries.length,
      payload
    };
  }

  /* ═══════════ 弹窗 ═══════════ */
  function openModal() {
    const app = state();
    const folder = app.folder;
    if (!folder) return;
    const list = folder.videos.filter((video) => video.done);
    const imageCount = list.reduce((sum, video) => {
      const div = document.createElement('div');
      div.innerHTML = video.intro || '';
      return sum + div.querySelectorAll('img').length + (video.cover ? 1 : 0);
    }, 0);

    Folio.UI.openModal(`<div class="modal" style="width:660px">
      <header class="m-head"><div><p class="overline">OUTPUT 04 · PDF</p><h3>生成 PDF 简报</h3><p>按长图版式 A4 分页，带 PDF 目录书签；文件内嵌雪哔数据，可回导继续编辑。</p></div><button class="m-close" data-close>${I.x}</button></header>
      <div class="brief-body">
        <div class="brief-file">
          <span class="brief-file-icon">${I.doc}</span>
          <div><b>${esc(folder.title)} · 雪哔简报.pdf</b><p>${list.length} 篇简报 · ${imageCount ? `含 ${imageCount} 张图片（含封面）` : '纯文字'}</p></div>
        </div>
        <ul class="brief-points">
          <li>版式与介绍长图一致，A4 分页，适合打印与在线阅读。</li>
          <li>PDF 目录（书签）按视频生成，查看器左侧可直接跳转。</li>
          <li>文件内嵌完整简报数据，用「导入 PDF」即可继续编辑。</li>
        </ul>
        <p class="hint">文件在浏览器本地生成，不上传任何内容；图片较多时需要几秒。</p>
      </div>
      <footer class="m-foot"><span class="mono">PDF · A4</span><button class="btn btn-primary" id="btn-pdf-download">${I.dl} 生成并下载</button></footer>
    </div>`);

    const button = document.getElementById('btn-pdf-download');
    if (button) button.onclick = () => download(button);
  }

  async function download(button) {
    const app = state();
    if (!app.folder) return;
    if (button) Folio.UI.setButtonBusy(button, true, '正在排版…');

    try {
      const videos = app.folder.videos.map((video) => ({
        ...video,
        intro: Folio.Output.introForExport(video)
      }));
      const result = await buildPdf({
        folder: app.folder,
        user: app.user,
        options: Folio.Output.readOutputOptions(),
        videos
      });

      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.fileName;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);

      toast(`PDF 已生成：${result.videoCount} 篇简报 · ${result.pages} 页`);
    } catch (error) {
      console.error('[Folio] pdf export failed', error);
      toast(error.message || 'PDF 生成失败，请重试', 'warn');
    } finally {
      if (button) Folio.UI.setButtonBusy(button, false);
    }
  }

  /* ═══════════ 回导 ═══════════ */
  async function inflate(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Folio.BriefError('NO_INFLATE', '当前浏览器不支持解压 PDF 内嵌数据，请使用 Chrome / Edge 打开。');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function readAttachment(doc) {
    const { PDFName } = window.PDFLib;
    const names = doc.catalog.lookup(PDFName.of('Names'));
    if (!names) return null;
    const embedded = names.lookup(PDFName.of('EmbeddedFiles'));
    if (!embedded) return null;
    const arr = embedded.lookup(PDFName.of('Names'));
    if (!arr || typeof arr.size !== 'function') return null;

    for (let i = 0; i + 1 < arr.size(); i += 2) {
      const nameObj = arr.lookup(i);
      const name = nameObj && (nameObj.decodeText ? nameObj.decodeText() : nameObj.asString());
      if (name !== 'folio-brief.json') continue;

      const spec = arr.lookup(i + 1);
      const ef = spec.lookup(PDFName.of('EF'));
      const stream = ef && ef.lookup(PDFName.of('F'));
      if (!stream) return null;

      let bytes = stream.contents;
      if (typeof bytes === 'string') bytes = new TextEncoder().encode(bytes);
      else bytes = new Uint8Array(bytes);

      const filter = stream.dict && stream.dict.lookup(PDFName.of('Filter'));
      const filterText = filter ? String(filter.asString ? filter.asString() : filter.toString()) : '';
      if (filterText.includes('FlateDecode')) bytes = await inflate(bytes);
      return new TextDecoder().decode(bytes);
    }
    return null;
  }

  async function readPdf(file, expectedFolder) {
    if (!window.PDFLib) {
      throw new Folio.BriefError('NO_PDFLIB', 'PDF 组件尚未加载，请刷新页面后重试。');
    }
    if (!file) throw new Folio.BriefError('NO_FILE', '请选择要导入的 PDF 文件。');
    if (!/\.pdf$/i.test(file.name || '')) {
      throw new Folio.BriefError('NOT_PDF', '请选择 .pdf 格式的文件。');
    }
    if (file.size > Folio.Brief.MAX_FILE) {
      throw new Folio.BriefError('TOO_LARGE', `PDF 文件超过 ${Math.round(Folio.Brief.MAX_FILE / 1024 / 1024)}MB，无法导入。`);
    }

    let doc;
    try {
      doc = await window.PDFLib.PDFDocument.load(await file.arrayBuffer());
    } catch (error) {
      throw new Folio.BriefError('NOT_PDF', '无法读取这个 PDF，请确认它是有效的 PDF 文件。');
    }

    let json = null;
    try {
      const raw = doc.getInfoDict().lookup(window.PDFLib.PDFName.of('FolioBrief'));
      if (raw && typeof raw.asString === 'function') {
        const text = raw.asString();
        if (text) json = new TextDecoder().decode(Folio.Brief.base64UrlToBytes(text));
      }
    } catch (error) {
      json = null;
    }

    if (!json) {
      try {
        json = await readAttachment(doc);
      } catch (error) {
        if (error instanceof Folio.BriefError) throw error;
        json = null;
      }
    }

    if (!json) {
      throw new Folio.BriefError('NOT_FOLIO', '这个 PDF 不是由雪哔生成的，已拒绝导入。');
    }

    let payload;
    try {
      payload = JSON.parse(json);
    } catch (error) {
      throw new Folio.BriefError('BAD_PAYLOAD', 'PDF 中的雪哔数据已损坏，已拒绝导入。');
    }

    Folio.Brief.validatePayload(payload, expectedFolder);
    return payload;
  }

  function openImportError(error) {
    const code = error && error.code;
    const message = (error && error.message) || '导入失败，请重试。';
    const hints = {
      NOT_FOLIO: '请选择由雪哔导出的 PDF 文件。',
      FOLDER_MISMATCH: '请先打开这份 PDF 对应的收藏夹，再导入。',
      CORRUPTED: '文件可能被重新保存或压缩过；请使用最初由雪哔生成的原始 PDF。',
      NOT_PDF: '只支持 .pdf 格式的文件。',
      SCHEMA: '请用与当前页面相同版本的雪哔重新导出后再导入。',
      NO_MATCH: '收藏夹内容可能已变化，请重新读取收藏夹后再试。',
      NO_INFLATE: '请使用 Chrome / Edge 打开页面后再导入。'
    };
    if (window.console && console.warn) console.warn('[Folio] pdf import rejected:', error);

    Folio.UI.openModal(`<div class="modal" style="width:560px">
      <header class="m-head"><div><p class="overline">IMPORT · 导入失败</p><h3>无法导入这个 PDF</h3></div><button class="m-close" data-close>${I.x}</button></header>
      <div class="brief-body">
        <p class="brief-error">${esc(message)}</p>
        ${hints[code] ? `<p class="hint">${esc(hints[code])}</p>` : ''}
      </div>
      <footer class="m-foot"><span class="mono">PDF</span><button class="btn btn-primary" data-close>知道了</button></footer>
    </div>`);
  }

  function openImportConfirm(payload, file) {
    const doneCount = payload.videos.filter((video) => video.done).length;
    const date = payload.createdAt ? new Date(payload.createdAt).toLocaleString('zh-CN') : '未知';

    Folio.UI.openModal(`<div class="modal" style="width:620px">
      <header class="m-head"><div><p class="overline">IMPORT · 导入 PDF</p><h3>继续编辑这份简报</h3></div><button class="m-close" data-close>${I.x}</button></header>
      <div class="brief-body">
        <div class="brief-file">
          <span class="brief-file-icon">${I.doc}</span>
          <div><b>${esc(file.name)}</b><p>雪哔 · ${esc(date)}</p></div>
        </div>
        <ul class="brief-points">
          <li>收藏夹：<b>${esc(payload.folder.title || '')}</b>（与当前收藏夹匹配）</li>
          <li>文件内 ${payload.videos.length} 支视频 · 已写 ${doneCount} 篇简报</li>
          <li>只导入有简报内容的视频，并覆盖它们在当前收藏夹里的本地草稿；其他视频保持不变。</li>
          <li>恢复的是生成 PDF 时写入的雪哔数据；PDF 页面本身是图片，不参与回写。</li>
        </ul>
      </div>
      <footer class="m-foot"><span class="mono">PDF · VALID</span><div class="st-foot-btns"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="btn-pdf-import-confirm">${I.upload} 导入并继续编辑</button></div></footer>
    </div>`);

    const confirm = document.getElementById('btn-pdf-import-confirm');
    if (!confirm) return;
    confirm.onclick = () => {
      Folio.Editor.commitCurrentIntro();
      const result = Folio.Editor.applyImportedBrief(payload);
      Folio.UI.closeModal();

      if (result.applied) {
        toast(`已导入 ${result.applied} 篇简报${result.skipped ? `，跳过 ${result.skipped} 支不匹配视频` : ''}`);
      } else {
        toast('没有可导入的简报', 'warn');
      }
      if (result.storageFailed) {
        toast('部分草稿因图片过大保存失败，请减少配图后重试', 'warn');
      }
    };
  }

  async function importFile(file) {
    const app = state();
    if (!app.folder) {
      toast('请先打开一个收藏夹', 'warn');
      return;
    }
    if (!file) return;

    Folio.Editor.commitCurrentIntro();
    toast('正在校验 PDF 文件…');
    try {
      const payload = await readPdf(file, app.folder);
      openImportConfirm(payload, file);
    } catch (error) {
      openImportError(error);
    }
  }

  Folio.Pdf = {
    A4,
    buildPdf,
    openModal,
    readPdf,
    importFile
  };
})(window.Folio = window.Folio || {});
