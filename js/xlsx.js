/* ==========================================================================
   xlsx.js — Excel 简报导出

   为什么用表格：
     长图是固定宽度的纵向版式；Excel 可以用合并单元格、行高、底纹和浮动图片
     做「按像素排版」，同时保留目录跳转，适合在表格 / 在线文档里查找内容。

   版式：
     长图是 400px 宽。这里拆成 4 列（左边距 30 / 强调条 58 / 正文 282 /
     右边距 30），逐行写单元格；文字先按字符测量宽度、手工断行，
     再让「一行 = 一个固定行高」，以此复刻长图的 line-height。
   ========================================================================== */
(function (Folio) {
  'use strict';

  const U = Folio.Utils;
  const esc = U.esc;
  const CFG = (Folio.Config && Folio.Config.xlsx) || {};

  const EMU_PX = 9525;          // 96dpi 下 1px = 9525 EMU
  const PT_PX = 0.75;           // 1px = 0.75pt
  const COVER_W = 340;          // Excel 里封面的显示宽度（与长图整行封面一致）

  /* 长图版式参数：全部取自 css/editor.css 的 .folio 规则 */
  const POSTER = {
    width: 400,
    pad: 30,
    content: 340,
    cols: { margin: 30, accent: 58, main: 282, right: 30 }
  };

  const C = {
    ink: '23222A',
    body: '3D3C46',
    muted: '8C8B93',
    faint: 'A6A4AD',
    accent: '518FF4',
    quoteText: '2F5FAE',
    quoteBg: 'F1F3FA',
    line: 'EFF0F2',
    headLine: 'EDEDF0',
    dashed: 'D6D6D9',
    imgBorder: 'E4E4E9'
  };

  const FONT_DEFS = {
    sans: { name: 'Microsoft YaHei', css: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif' },
    serif: { name: 'Georgia', css: 'Georgia, "Noto Serif SC", "Songti SC", serif' },
    mono: { name: 'Consolas', css: 'Consolas, "Courier New", monospace' }
  };

  class XlsxError extends Error {
    constructor(code, message) {
      super(message || 'Excel 生成失败');
      this.name = 'XlsxError';
      this.code = code;
    }
  }

  /* ═══════════ XML 小工具 ═══════════ */
  function xmlText(value) {
    return String(value == null ? '' : value)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function num(value) {
    const rounded = Math.round(Number(value || 0) * 100) / 100;
    return String(rounded);
  }

  function colName(index) {
    let n = index + 1;
    let name = '';
    while (n > 0) {
      const mod = (n - 1) % 26;
      name = String.fromCharCode(65 + mod) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  /** 把 #rgb / #rrggbb / rgb() 统一成 #RRGGBB（sanitizeIntro 已处理大部分）。 */
  function normalizeColor(value) {
    if (!value) return '';
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
    return '';
  }

  function spaced(text) {
    const chars = Array.from(String(text == null ? '' : text));
    let out = '';
    chars.forEach((ch, index) => {
      out += ch;
      const next = chars[index + 1];
      if (next && ch !== ' ' && next !== ' ') out += ' ';
    });
    return out;
  }

  /* ═══════════ 文字测量与断行 ═══════════ */
  const measureCache = new Map();
  let measureCtx = null;

  function cssFont(props) {
    const def = FONT_DEFS[props.font] || FONT_DEFS.sans;
    const weight = props.bold ? '700' : '400';
    const style = props.italic ? 'italic ' : '';
    return `${style}${weight} ${props.px}px ${def.css}`;
  }

  function measure(text, props) {
    if (!measureCtx) {
      const canvas = document.createElement('canvas');
      measureCtx = canvas.getContext('2d');
    }
    const font = cssFont(props);
    const key = `${font}\u0001${text}`;
    const cached = measureCache.get(key);
    if (cached != null) return cached;
    measureCtx.font = font;
    const width = measureCtx.measureText(text).width;
    measureCache.set(key, width);
    return width;
  }

  function isCJK(ch) {
    return /[\u2E80-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch);
  }

  function sameProps(a, b) {
    return a.font === b.font && a.px === b.px && a.bold === b.bold &&
      a.italic === b.italic && a.underline === b.underline &&
      a.strike === b.strike && a.color === b.color;
  }

  function resolveProps(base, override) {
    const out = {
      font: base.font,
      px: base.px,
      color: base.color,
      bold: !!base.bold,
      italic: !!base.italic,
      underline: !!base.underline,
      strike: !!base.strike
    };
    if (override) {
      if (override.font) out.font = override.font;
      if (override.px) out.px = override.px;
      if (override.color) out.color = override.color;
      if (override.bold) out.bold = true;
      if (override.italic) out.italic = true;
      if (override.underline) out.underline = true;
      if (override.strike) out.strike = true;
    }
    return out;
  }

  /**
   * 把内联 token 排成若干行。
   * line 里存的是「单个字符 + 已解析样式」，断行点按字符计算，
   * 这样中英文混排也不会被整段 run 卡住。
   */
  function layoutTokens(tokens, maxWidth, base) {
    const lines = [];
    let line = [];
    let width = 0;
    let breakAt = -1;

    const trim = () => {
      while (line.length) {
        const last = line[line.length - 1];
        if (last.ch === ' ' || last.ch === '\u00A0') {
          line.pop();
          width -= measure(last.ch, last.props);
        } else {
          break;
        }
      }
    };

    const push = () => {
      trim();
      if (line.length) lines.push(line);
      line = [];
      width = 0;
      breakAt = -1;
    };

    for (let t = 0; t < tokens.length; t += 1) {
      const token = tokens[t];
      if (!token) continue;
      if (token.type === 'br') { push(); continue; }
      if (token.type !== 'text' || !token.text) continue;

      const props = resolveProps(base, token.props);
      const chars = Array.from(token.text);
      for (let i = 0; i < chars.length; i += 1) {
        const ch = chars[i];
        const isSpace = ch === ' ' || ch === '\u00A0';
        if (!line.length && isSpace) continue;

        const w = measure(ch, props);
        if (line.length && width + w > maxWidth) {
          if (breakAt > 0 && breakAt < line.length) {
            const rest = line.slice(breakAt);
            line = line.slice(0, breakAt);
            trim();
            if (line.length) lines.push(line);
            line = rest;
            width = line.reduce((sum, item) => sum + measure(item.ch, item.props), 0);
            while (line.length && (line[0].ch === ' ' || line[0].ch === '\u00A0')) {
              width -= measure(line[0].ch, line[0].props);
              line.shift();
            }
            breakAt = -1;
          } else {
            trim();
            if (line.length) lines.push(line);
            line = [];
            width = 0;
            breakAt = -1;
          }
        }

        line.push({ ch, props });
        width += w;
        if (isSpace || isCJK(ch) || ch === '-' || ch === '/') breakAt = line.length;
      }
    }
    push();
    if (!lines.length) lines.push([]);
    return lines;
  }

  /** 把逐字符的行合并成 run，减少 XML 体积。 */
  function collectRuns(line) {
    const runs = [];
    line.forEach((item) => {
      const last = runs[runs.length - 1];
      if (last && sameProps(last, item.props)) last.text += item.ch;
      else runs.push({ ...item.props, text: item.ch });
    });
    return runs;
  }

  /* ═══════════ HTML -> 段落 / 内联 token ═══════════ */
  const BLOCK_TAGS = new Set(['P', 'DIV', 'BLOCKQUOTE', 'FIGURE', 'HR', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

  function tokenize(node, props, out) {
    if (node.nodeType === 3) {
      const text = String(node.nodeValue || '').replace(/[ \t\r\n]+/g, ' ');
      if (text) out.push({ type: 'text', text, props });
      return;
    }
    if (node.nodeType !== 1) return;

    const el = node;
    const tag = el.tagName;
    if (tag === 'BR') { out.push({ type: 'br' }); return; }
    if (tag === 'IMG') {
      out.push({
        type: 'img',
        src: el.getAttribute('src') || '',
        alt: el.getAttribute('alt') || '',
        origSize: false
      });
      return;
    }
    if (tag === 'SPAN' && el.classList.contains('inline-fig')) {
      const img = el.querySelector('img');
      if (img) {
        out.push({
          type: 'img',
          src: img.getAttribute('src') || '',
          alt: img.getAttribute('alt') || '',
          origSize: el.classList.contains('orig-size')
        });
      }
      return;
    }

    const next = { ...props };
    if (tag === 'FONT') {
      const color = normalizeColor(el.getAttribute('color') || (el.style && el.style.color));
      if (color) next.color = color;
    } else if (el.style && el.style.color) {
      const color = normalizeColor(el.style.color);
      if (color) next.color = color;
    }
    if (tag === 'B' || tag === 'STRONG') next.bold = true;
    else if (tag === 'I' || tag === 'EM') next.italic = true;
    else if (tag === 'U') next.underline = true;
    else if (tag === 'S' || tag === 'STRIKE') next.strike = true;

    Array.from(el.childNodes).forEach((child) => tokenize(child, next, out));
  }

  function tokensOf(nodes) {
    const out = [];
    Array.from(nodes).forEach((node) => tokenize(node, {}, out));
    return out;
  }

  function figureBlock(el) {
    const img = el.querySelector('img');
    const caption = el.querySelector('figcaption');
    return {
      type: 'figure',
      src: img ? (img.getAttribute('src') || '') : '',
      alt: img ? (img.getAttribute('alt') || '') : '',
      caption: caption ? String(caption.textContent || '').trim() : ''
    };
  }

  function listItems(el) {
    return Array.from(el.children)
      .filter((child) => child.tagName === 'LI')
      .map((li) => tokensOf(li.childNodes));
  }

  function quoteParas(el) {
    const paras = [];
    let current = [];
    const flush = () => {
      if (current.length) {
        paras.push(current);
        current = [];
      }
    };

    const walk = (nodes) => {
      Array.from(nodes).forEach((node) => {
        if (node.nodeType === 3) {
          const text = String(node.nodeValue || '').replace(/[ \t\r\n]+/g, ' ');
          if (text.trim()) current.push({ type: 'text', text, props: {} });
          return;
        }
        if (node.nodeType !== 1) return;
        if (node.tagName === 'P' || node.tagName === 'DIV') {
          flush();
          walk(node.childNodes);
          flush();
          return;
        }
        tokenize(node, {}, current);
      });
    };

    walk(el.childNodes);
    flush();
    if (!paras.length) paras.push([]);
    return paras;
  }

  function parseBlocks(root) {
    const blocks = [];

    const walk = (nodes) => {
      let buffer = [];
      const flush = () => {
        if (!buffer.length) return;
        blocks.push({ type: 'p', tokens: buffer });
        buffer = [];
      };

      Array.from(nodes).forEach((node) => {
        if (node.nodeType === 3) {
          const text = String(node.nodeValue || '').replace(/[ \t\r\n]+/g, ' ');
          if (text.trim()) buffer.push({ type: 'text', text, props: {} });
          return;
        }
        if (node.nodeType !== 1) return;

        const tag = node.tagName;
        if (tag === 'FIGURE') { flush(); blocks.push(figureBlock(node)); return; }
        if (tag === 'HR') { flush(); blocks.push({ type: 'hr' }); return; }
        if (tag === 'UL' || tag === 'OL') {
          flush();
          blocks.push({ type: 'list', ordered: tag === 'OL', items: listItems(node) });
          return;
        }
        if (tag === 'BLOCKQUOTE') {
          flush();
          blocks.push({ type: 'quote', paras: quoteParas(node) });
          return;
        }
        if (/^H[1-6]$/.test(tag)) {
          flush();
          blocks.push({ type: 'h', level: Number(tag[1]), tokens: tokensOf(node.childNodes) });
          return;
        }
        if (tag === 'P' || tag === 'DIV') {
          const hasBlock = Array.from(node.children).some((child) => BLOCK_TAGS.has(child.tagName));
          if (hasBlock) {
            flush();
            walk(node.childNodes);
            return;
          }
          flush();
          blocks.push({ type: 'p', tokens: tokensOf(node.childNodes) });
          return;
        }
        tokenize(node, {}, buffer);
      });
      flush();
    };

    walk(root.childNodes);
    return blocks;
  }

  function htmlToRoot(html) {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');
    return template.content;
  }

  /* ═══════════ 样式表（按需注册 fill / border / xf） ═══════════ */
  function StyleBook() {
    this.fills = [
      '<fill><patternFill patternType="none"/></fill>',
      '<fill><patternFill patternType="gray125"/></fill>'
    ];
    this.borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
    this.xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
    this.fillKeys = new Map();
    this.borderKeys = new Map();
    this.xfKeys = new Map();
  }

  StyleBook.prototype.fill = function (hex) {
    if (!hex) return 0;
    const key = String(hex).toUpperCase();
    if (this.fillKeys.has(key)) return this.fillKeys.get(key);
    const id = this.fills.length;
    this.fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="FF${key}"/><bgColor indexed="64"/></patternFill></fill>`);
    this.fillKeys.set(key, id);
    return id;
  };

  StyleBook.prototype.border = function (spec) {
    if (!spec) return 0;
    const key = JSON.stringify(spec);
    if (this.borderKeys.has(key)) return this.borderKeys.get(key);
    const side = (name, def) => (def
      ? `<${name} style="${def.style}"><color rgb="FF${def.color}"/></${name}>`
      : `<${name}/>`);
    const id = this.borders.length;
    this.borders.push(`<border>${side('left', spec.left)}${side('right', spec.right)}${side('top', spec.top)}${side('bottom', spec.bottom)}<diagonal/></border>`);
    this.borderKeys.set(key, id);
    return id;
  };

  StyleBook.prototype.xf = function (opts) {
    const options = opts || {};
    const fillId = this.fill(options.fill);
    const borderId = this.border(options.border);
    const align = options.align || {};
    const key = `${fillId}|${borderId}|${JSON.stringify(align)}`;
    if (this.xfKeys.has(key)) return this.xfKeys.get(key);

    const attrs = ['numFmtId="0"', 'fontId="0"', `fillId="${fillId}"`, `borderId="${borderId}"`, 'xfId="0"', 'applyFont="0"'];
    if (fillId) attrs.push('applyFill="1"');
    if (borderId) attrs.push('applyBorder="1"');
    attrs.push('applyAlignment="1"');

    const alignment = [
      `horizontal="${align.horizontal || 'left'}"`,
      `vertical="${align.vertical || 'top'}"`,
      'wrapText="0"'
    ];
    if (align.indent) alignment.push(`indent="${align.indent}"`);

    const id = this.xfs.length;
    this.xfs.push(`<xf ${attrs.join(' ')}><alignment ${alignment.join(' ')}/></xf>`);
    this.xfKeys.set(key, id);
    return id;
  };

  /* ═══════════ 工作表模型 ═══════════ */
  function Sheet() {
    this.rows = [];
    this.merges = [];
    this.images = [];
    this.hyperlinks = [];
  }

  Sheet.prototype.row = function (htPx, cells) {
    const index = this.rows.length;
    this.rows.push({ ht: Math.max(1.5, htPx * PT_PX), cells: cells || [] });
    return index;
  };

  /** 目录条目：目标行在正文渲染完后才确定，这里先存对象引用。 */
  Sheet.prototype.link = function (row, col, target) {
    this.hyperlinks.push({ row, col, target });
  };

  Sheet.prototype.spacer = function (px) {
    return this.row(px, []);
  };

  Sheet.prototype.rule = function (style) {
    const cells = [0, 1, 2, 3].map((col) => ({ col, style }));
    return this.row(1.5, cells);
  };

  /** 一行文字：合并 B:C，长图正文宽度 340px。 */
  Sheet.prototype.textRow = function (htPx, runs, style) {
    const index = this.row(htPx, [{ col: 1, style, runs }]);
    this.merges.push(`B${index + 1}:C${index + 1}`);
    return index;
  };

  Sheet.prototype.paragraph = function (tokens, opts) {
    // Excel 按 pt 渲染，浏览器按 px 测量，同一字号会宽 1%~2%；
    // 合并单元格又会裁掉超出部分的文字，这里留 2.5% 余量避免最后一字被切。
    const budget = Math.floor((opts.width - (opts.indentPx || 0)) * 0.975);
    const lines = layoutTokens(tokens, budget, opts.base);
    lines.forEach((line, index) => {
      let ht = opts.lineHeightPx;
      if (index === 0) ht += opts.spaceBeforePx || 0;
      if (index === lines.length - 1) ht += opts.spaceAfterPx || 0;
      this.textRow(ht, collectRuns(line), opts.style);
    });
  };

  /**
   * 段落流：遇到内联图片时先排完前面的文字，再插一行图片，
   * 然后继续排后面的文字（Excel 不支持文字绕排，只能这样近似）。
   */
  Sheet.prototype.flow = function (tokens, opts, mediaByKey) {
    let segment = [];
    const emit = () => {
      if (!segment.length) return;
      this.paragraph(segment, opts);
      segment = [];
    };

    tokens.forEach((token) => {
      if (token && token.type === 'img') {
        emit();
        this.imageToken(token, opts, mediaByKey);
      } else {
        segment.push(token);
      }
    });
    emit();
  };

  Sheet.prototype.imageToken = function (token, opts, mediaByKey) {
    const media = token.src ? mediaByKey.get(`img:${token.src}`) : null;
    if (!media) {
      this.paragraph([{ type: 'text', text: '〔图〕', props: { italic: true, color: C.muted } }], opts);
      return;
    }

    let w;
    let h;
    if (token.origSize) {
      w = Math.min(POSTER.content, media.width);
      h = w * media.height / media.width;
      if (h > 300) {
        h = 300;
        w = h * media.width / media.height;
      }
    } else {
      // 长图里行内小图高 1.85em（≈27px）
      h = Math.min(27, media.height);
      w = h * media.width / media.height;
      if (w > POSTER.content) {
        w = POSTER.content;
        h = w * media.height / media.width;
      }
    }
    this.imageRow(media, { displayW: w, displayH: h, style: opts.imageStyle || opts.style, pad: 4 });
  };

  Sheet.prototype.imageRow = function (media, opts) {
    const displayW = Math.max(1, opts.displayW);
    const displayH = Math.max(1, opts.displayH);
    const pad = opts.pad || 0;
    const index = this.row(displayH + pad, [{ col: 1, style: opts.style }]);
    this.merges.push(`B${index + 1}:C${index + 1}`);
    this.images.push({
      row: index,
      col: 1,
      cx: Math.round(displayW * EMU_PX),
      cy: Math.round(displayH * EMU_PX),
      media: opts.media || media,
      alt: opts.alt || '',
      border: opts.border || ''
    });
    return index;
  };

  /* ═══════════ 图片：加载 / 转码 / 封面合成 ═══════════ */
  function loadHtmlImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image load failed'));
      img.src = src;
    });
  }

  async function loadMedia(src) {
    if (!src) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(src, {
        mode: 'cors',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller.signal
      });
      if (!response.ok) return null;
      const blob = await response.blob();
      if (!blob.type || !blob.type.startsWith('image/')) return null;

      const url = URL.createObjectURL(blob);
      try {
        const img = await loadHtmlImage(url);
        if (!img.naturalWidth || !img.naturalHeight) return null;
        return { img, blob, width: img.naturalWidth, height: img.naturalHeight };
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function canvasBytes(canvas, type) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.92));
    if (!blob) return null;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: type === 'image/png' ? 'png' : 'jpeg' };
  }

  /** 非 png/jpeg/gif 统一转 jpeg，避免部分 Excel / 在线文档不认 webp。 */
  async function plainMedia(loaded) {
    const type = String(loaded.blob.type || '').toLowerCase();
    if (type === 'image/png' || type === 'image/jpeg' || type === 'image/gif') {
      return {
        bytes: new Uint8Array(await loaded.blob.arrayBuffer()),
        ext: type === 'image/jpeg' ? 'jpeg' : type.split('/')[1],
        width: loaded.width,
        height: loaded.height
      };
    }
    const canvas = document.createElement('canvas');
    canvas.width = loaded.width;
    canvas.height = loaded.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(loaded.img, 0, 0);
    const out = await canvasBytes(canvas, 'image/jpeg');
    return out ? { ...out, width: loaded.width, height: loaded.height } : null;
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  /**
   * 封面在长图里有 13px 圆角和右下角时长徽标。
   * Excel 图片没法做圆角/角标，这里直接画进 PNG（2× 显示尺寸）。
   */
  async function composeCover(loaded, label) {
    const scale = Math.max(1, Number(CFG.coverScale) || 2);
    const width = Math.round(COVER_W * scale);
    const height = Math.max(1, Math.round(width * loaded.height / loaded.width));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    ctx.save();
    roundRect(ctx, 0, 0, width, height, 13 * scale);
    ctx.clip();
    ctx.drawImage(loaded.img, 0, 0, width, height);

    if (label) {
      const fontSize = Math.round(10 * scale);
      const padX = Math.round(8 * scale);
      const padY = Math.round(3 * scale);
      const margin = Math.round(8 * scale);
      ctx.font = `500 ${fontSize}px Consolas, "Courier New", monospace`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const textWidth = ctx.measureText(label).width;
      const boxW = textWidth + padX * 2;
      const boxH = Math.round(fontSize * 1.25) + padY * 2;
      const boxX = width - margin - boxW;
      const boxY = height - margin - boxH;
      roundRect(ctx, boxX, boxY, boxW, boxH, 6 * scale);
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, boxX + padX, boxY + boxH / 2);
    }
    ctx.restore();

    const out = await canvasBytes(canvas, 'image/png');
    return out ? { ...out, width, height } : null;
  }

  /* ═══════════ 文档版式 ═══════════ */
  const INTRO_BASE = { font: 'sans', px: 13.5, bold: false, color: C.body };
  const INTRO_OPTS = { base: INTRO_BASE, lineHeightPx: 24.5, spaceAfterPx: 8, width: POSTER.content };
  const QUOTE_BASE = { font: 'serif', px: 13.5, bold: false, color: C.quoteText };
  const QUOTE_OPTS = { base: QUOTE_BASE, lineHeightPx: 23.5, spaceAfterPx: 0, width: POSTER.content - 30, indentPx: 0 };

  function textToken(text, props) {
    return { type: 'text', text, props: props || {} };
  }

  /** 收藏夹卡片是 320 宽；长图用 640，Excel 需要更清晰的 960。 */
  function coverSrc(video) {
    const src = String((video && video.cover) || '');
    if (!src) return '';
    if (src.includes('@320w_200h_1c.webp')) return src.replace('@320w_200h_1c.webp', '@960w_600h_1c.webp');
    if (src.includes('/320/200')) return src.replace('/320/200', '/960/600');
    return src;
  }

  function coverKey(video) {
    return `cover:${coverSrc(video)}:${U.formatDuration(video.dur)}`;
  }

  function buildModel(input) {
    const folder = input.folder;
    const user = input.user || { name: '我', mid: '' };
    const options = input.options || {};
    const entries = input.entries;
    const mediaByKey = input.mediaByKey;
    const styles = input.styles;

    const STYLE = {
      text: styles.xf({ align: { horizontal: 'left', vertical: 'top' } }),
      center: styles.xf({ align: { horizontal: 'center', vertical: 'top' } }),
      quote: styles.xf({
        fill: C.quoteBg,
        border: { left: { style: 'thick', color: C.accent } },
        align: { horizontal: 'left', vertical: 'top', indent: 1 }
      }),
      accent: styles.xf({ fill: C.accent }),
      divider: styles.xf({ border: { bottom: { style: 'thin', color: C.line } } }),
      headDivider: styles.xf({ border: { bottom: { style: 'thin', color: C.headLine } } }),
      dashed: styles.xf({ border: { bottom: { style: 'dashed', color: C.dashed } } })
    };

    const sheet = new Sheet();
    sheet.mediaByKey = mediaByKey;

    /* ── 页头：品牌 / 标题 / 统计 / 强调线 ── */
    sheet.spacer(24);
    sheet.paragraph([
      textToken('■ ', { font: 'sans', px: 12, color: `#${C.accent}` }),
      textToken(spaced('雪哔 · BILITIME'), { font: 'sans', px: 10, bold: true, color: `#${C.accent}` })
    ], {
      base: { font: 'sans', px: 10, color: `#${C.accent}` },
      lineHeightPx: 16,
      width: POSTER.content,
      style: STYLE.text
    });
    sheet.spacer(12);

    sheet.paragraph([textToken(folder.title || '', { font: 'serif', px: 22, bold: true, color: `#${C.ink}` })], {
      base: { font: 'serif', px: 22, color: `#${C.ink}` },
      lineHeightPx: 34,
      width: POSTER.content,
      style: STYLE.text
    });
    sheet.spacer(10);

    const totalFirst = entries.reduce((sum, entry) => sum + U.firstDuration(entry.video), 0);
    const userName = user.name || '我';
    const userMid = user.mid ? `（UID ${user.mid}）` : '';
    sheet.paragraph([
      textToken(`整理人 ${userName}${userMid} ｜ 已写 ${entries.length}/${(folder.videos || []).length} 篇`)
    ], {
      base: { font: 'mono', px: 10.5, color: `#${C.muted}` },
      lineHeightPx: 14,
      width: POSTER.content,
      style: STYLE.text
    });
    sheet.paragraph([
      textToken('第一P '),
      textToken(U.formatDuration(totalFirst), { bold: true }),
      textToken(` ｜ ${U.today()}`)
    ], {
      base: { font: 'mono', px: 10.5, color: `#${C.muted}` },
      lineHeightPx: 14,
      width: POSTER.content,
      style: STYLE.text
    });
    sheet.spacer(14);
    sheet.row(3, [{ col: 1, style: STYLE.accent }]);
    sheet.spacer(18);
    sheet.rule(STYLE.headDivider);

    renderToc(sheet, entries, STYLE);

    /* ── 每支视频 ── */
    entries.forEach((entry) => {
      const video = entry.video;
      const multi = video.pages && video.pages.length > 1;

      sheet.spacer(18);
      entry.toc.targetRow = sheet.rows.length;
      sheet.paragraph([
        textToken(`№ ${U.pad2(entry.index + 1)} · VIDEO`, { font: 'mono', px: 10.5, bold: true, color: `#${C.accent}` })
      ], {
        base: { font: 'mono', px: 10.5, color: `#${C.accent}` },
        lineHeightPx: 13,
        width: POSTER.content,
        style: STYLE.text
      });
      sheet.spacer(10);

      const cover = mediaByKey.get(coverKey(video));
      if (cover) {
        sheet.imageRow(cover, {
          displayW: COVER_W,
          displayH: COVER_W * cover.height / cover.width,
          style: STYLE.text
        });
      }
      sheet.spacer(10);

      sheet.paragraph([textToken(video.title || '', { font: 'serif', px: 15, bold: true, color: `#${C.ink}` })], {
        base: { font: 'serif', px: 15, color: `#${C.ink}` },
        lineHeightPx: 23,
        width: POSTER.content,
        style: STYLE.text
      });
      sheet.spacer(5);

      const infoRuns = [];
      if (options.showUp !== false) infoRuns.push(textToken(`UP主 ${video.up || '—'} · `));
      infoRuns.push(textToken(
        `时长 ${U.formatDuration(video.dur)}` +
        (multi ? `（P1 ${U.formatDuration(video.pages[0].d)}）` : '') +
        ` · 播放 ${video.play || '—'}`
      ));
      sheet.paragraph(infoRuns, {
        base: { font: 'mono', px: 10.5, color: `#${C.muted}` },
        lineHeightPx: 13,
        width: POSTER.content,
        style: STYLE.text
      });
      sheet.spacer(9);

      renderBlocks(sheet, entry.blocks, mediaByKey, STYLE);

      sheet.spacer(18);
      sheet.rule(STYLE.divider);
    });

    /* ── 页脚 ── */
    sheet.spacer(22);
    [
      'CURATED WITH SNAWCAP · 雪哔',
      `BILIBILI FAVORITES · ${U.today()}`,
      options.allowRepost !== false ? '欢迎转载，请注明出处' : '未经允许，请勿转载'
    ].forEach((line) => {
      sheet.paragraph([textToken(line)], {
        base: { font: 'mono', px: 9.5, color: `#${C.faint}` },
        lineHeightPx: 18,
        width: POSTER.content,
        style: STYLE.center
      });
    });
    sheet.spacer(26);

    return sheet;
  }

  /** 目录放在页头下方，条目用内部超链接跳到对应视频。 */
  function renderToc(sheet, entries, STYLE) {
    sheet.spacer(16);
    sheet.paragraph([
      textToken('目录 · CONTENTS', { font: 'mono', px: 10.5, bold: true, color: `#${C.accent}` })
    ], {
      base: { font: 'mono', px: 10.5, color: `#${C.accent}` },
      lineHeightPx: 14,
      width: POSTER.content,
      style: STYLE.text
    });
    sheet.spacer(6);

    entries.forEach((entry) => {
      const row = sheet.rows.length;
      sheet.paragraph([
        textToken(`【${U.pad2(entry.index + 1)}】`, { bold: true }),
        textToken(entry.video.title || '', { underline: true })
      ], {
        base: { font: 'sans', px: 10.5, color: `#${C.accent}` },
        lineHeightPx: 16,
        spaceAfterPx: 3,
        width: POSTER.content,
        style: STYLE.text
      });
      sheet.link(row, 1, entry.toc);
    });

    sheet.spacer(8);
    sheet.rule(STYLE.divider);
  }

  function renderBlocks(sheet, blocks, mediaByKey, STYLE) {
    blocks.forEach((block) => {
      if (block.type === 'p') {
        sheet.flow(block.tokens, { ...INTRO_OPTS, style: STYLE.text }, mediaByKey);
        return;
      }

      if (block.type === 'h') {
        const px = Math.round(14.5 * (block.level <= 1 ? 1.4 : block.level === 2 ? 1.25 : 1.12) * 10) / 10;
        sheet.paragraph(block.tokens, {
          base: { font: 'sans', px, bold: true, color: `#${C.ink}` },
          lineHeightPx: px * 1.4,
          spaceBeforePx: 8,
          spaceAfterPx: 8,
          width: POSTER.content,
          style: STYLE.text
        });
        return;
      }

      if (block.type === 'quote') {
        sheet.spacer(10);
        sheet.textRow(10, [], STYLE.quote);
        block.paras.forEach((tokens, index) => {
          sheet.flow(tokens, {
            ...QUOTE_OPTS,
            style: STYLE.quote,
            imageStyle: STYLE.quote,
            spaceAfterPx: index === block.paras.length - 1 ? 0 : 8
          }, mediaByKey);
        });
        sheet.textRow(10, [], STYLE.quote);
        sheet.spacer(10);
        return;
      }

      if (block.type === 'list') {
        block.items.forEach((tokens, index) => {
          const prefix = block.ordered ? `${index + 1}. ` : '• ';
          sheet.flow([textToken(prefix), ...tokens], {
            ...INTRO_OPTS,
            indentPx: 22,
            spaceAfterPx: 4,
            style: STYLE.text
          }, mediaByKey);
        });
        return;
      }

      if (block.type === 'figure') {
        sheet.spacer(16);
        const media = block.src ? mediaByKey.get(`img:${block.src}`) : null;
        if (media) {
          let width = Math.min(POSTER.content, media.width);
          let height = width * media.height / media.width;
          if (height > 480) {
            height = 480;
            width = height * media.width / media.height;
          }
          sheet.imageRow(media, {
            displayW: width,
            displayH: height,
            style: STYLE.text,
            alt: block.alt,
            border: C.imgBorder
          });
          if (block.caption) {
            sheet.paragraph([textToken(block.caption)], {
              base: { font: 'sans', px: 10.5, color: `#${C.muted}` },
              lineHeightPx: 15,
              spaceBeforePx: 8,
              spaceAfterPx: 16,
              width: POSTER.content,
              style: STYLE.center
            });
          } else {
            sheet.spacer(16);
          }
        } else {
          sheet.paragraph([textToken(block.caption ? `〔配图：${block.caption}〕` : '〔配图〕', { italic: true })], {
            base: { font: 'sans', px: 10.5, color: `#${C.muted}` },
            lineHeightPx: 15,
            spaceAfterPx: 16,
            width: POSTER.content,
            style: STYLE.center
          });
        }
        return;
      }

      if (block.type === 'hr') {
        sheet.spacer(14);
        sheet.rule(STYLE.dashed);
        sheet.spacer(14);
      }
    });
  }

  /* ═══════════ OOXML 部件 ═══════════ */
  function roundHalf(value) {
    return Math.round(Number(value || 0) * 2) / 2;
  }

  function runXml(run) {
    const def = FONT_DEFS[run.font] || FONT_DEFS.sans;
    const parts = [`<rFont val="${xmlText(def.name)}"/>`];
    if (run.bold) parts.push('<b/>');
    if (run.italic) parts.push('<i/>');
    if (run.strike) parts.push('<strike/>');
    if (run.color) parts.push(`<color rgb="FF${String(run.color).replace('#', '')}"/>`);
    parts.push(`<sz val="${num(roundHalf(run.px * PT_PX))}"/>`);
    if (run.underline) parts.push('<u/>');
    return `<r><rPr>${parts.join('')}</rPr><t xml:space="preserve">${xmlText(run.text)}</t></r>`;
  }

  function cellRunsXml(runs) {
    if (!runs || !runs.length) return '';
    const valid = runs.filter((run) => run && run.text);
    if (!valid.length) return '';
    return `<is>${valid.map(runXml).join('')}</is>`;
  }

  function buildSheetXml(sheet) {
    const rows = sheet.rows.map((row, index) => {
      const r = index + 1;
      if (!row.cells || !row.cells.length) {
        return `<row r="${r}" ht="${num(row.ht)}" customHeight="1"/>`;
      }
      const cells = row.cells.map((cell) => {
        const ref = `${colName(cell.col)}${r}`;
        const inner = cellRunsXml(cell.runs);
        return inner
          ? `<c r="${ref}" s="${cell.style}" t="inlineStr">${inner}</c>`
          : `<c r="${ref}" s="${cell.style}"/>`;
      }).join('');
      return `<row r="${r}" ht="${num(row.ht)}" customHeight="1">${cells}</row>`;
    }).join('');

    const merges = sheet.merges.length
      ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`
      : '';

    const cols = [
      `<col min="1" max="1" width="${num(POSTER.cols.margin / 7)}" customWidth="1"/>`,
      `<col min="2" max="2" width="${num(POSTER.cols.accent / 7)}" customWidth="1"/>`,
      `<col min="3" max="3" width="${num(POSTER.cols.main / 7)}" customWidth="1"/>`,
      `<col min="4" max="4" width="${num(POSTER.cols.right / 7)}" customWidth="1"/>`
    ].join('');

    const links = sheet.hyperlinks.length
      ? `<hyperlinks>${sheet.hyperlinks.map((link) => `<hyperlink ref="${colName(link.col)}${link.row + 1}" location="A${Math.max(1, (link.target.targetRow || 0) + 1)}" tooltip="跳转到该视频"/>`).join('')}</hyperlinks>`
      : '';

    const last = Math.max(sheet.rows.length, 1);
    const drawing = sheet.images.length ? '<drawing r:id="rId1"/>' : '';

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:D${last}"/><sheetViews><sheetView showGridLines="0" tabSelected="1" zoomScale="100" zoomScaleNormal="100" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15" defaultColWidth="8.43"/><cols>${cols}</cols><sheetData>${rows}</sheetData>${merges}${links}<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.3" bottom="0.3" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0" horizontalDpi="96" verticalDpi="96"/>${drawing}</worksheet>`;
  }

  function buildStylesXml(styles) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="0"/><fonts count="1"><font><sz val="11"/><color rgb="FF${C.body}"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="${styles.fills.length}">${styles.fills.join('')}</fills><borders count="${styles.borders.length}">${styles.borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${styles.xfs.length}">${styles.xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;
  }

  function buildDrawingXml(images) {
    const anchors = images.map((image, index) => {
      const id = index + 2;
      const line = image.border
        ? `<a:ln w="9525"><a:solidFill><a:srgbClr val="${image.border}"/></a:solidFill></a:ln>`
        : '';
      return `<xdr:oneCellAnchor><xdr:from><xdr:col>${image.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${image.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${image.cx}" cy="${image.cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="Picture ${id}" descr="${xmlText(image.alt || '')}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${image.rId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${image.cx}" cy="${image.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${line}</xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors}</xdr:wsDr>`;
  }

  function buildDrawingRels(images) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${images.map((image) => `<Relationship Id="${image.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${image.fileName}"/>`).join('')}</Relationships>`;
  }

  function buildSheetRels() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`;
  }

  function buildWorkbookXml(sheetName) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="23426"/><workbookPr/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="20490" windowHeight="11760" tabRatio="600"/></bookViews><sheets><sheet name="${xmlText(sheetName)}" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029"/></workbook>`;
  }

  function buildWorkbookRels() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>`;
  }

  function buildRootRels() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  }

  function buildContentTypes(hasDrawing) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${hasDrawing ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ''}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  }

  function buildThemeXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Folio"><a:themeElements><a:clrScheme name="Folio"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="23222A"/></a:dk2><a:lt2><a:srgbClr val="F5F6FA"/></a:lt2><a:accent1><a:srgbClr val="518FF4"/></a:accent1><a:accent2><a:srgbClr val="7FB2F8"/></a:accent2><a:accent3><a:srgbClr val="22C3DD"/></a:accent3><a:accent4><a:srgbClr val="2F9E5F"/></a:accent4><a:accent5><a:srgbClr val="E58E2B"/></a:accent5><a:accent6><a:srgbClr val="D94A64"/></a:accent6><a:hlink><a:srgbClr val="518FF4"/></a:hlink><a:folHlink><a:srgbClr val="7C5CD6"/></a:folHlink></a:clrScheme><a:fontScheme name="Folio"><a:majorFont><a:latin typeface="Georgia"/><a:ea typeface="Noto Serif SC"/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Folio"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
  }

  function buildCoreXml(folder, user) {
    const date = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlText((folder.title || '') + ' · 雪哔简报')}</dc:title><dc:creator>${xmlText((user && user.name) || '雪哔')}</dc:creator><cp:lastModifiedBy>雪哔</cp:lastModifiedBy><cp:keywords>BILITIME-XLSX</cp:keywords><dc:description>由雪哔生成的 Excel 简报</dc:description><dcterms:created xsi:type="dcterms:W3CDTF">${date}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${date}</dcterms:modified></cp:coreProperties>`;
  }

  function buildAppXml(sheetName) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>雪哔</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>工作表</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>${xmlText(sheetName)}</vt:lpstr></vt:vector></TitlesOfParts><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0300</AppVersion></Properties>`;
  }

  function safeName(text, fallback) {
    const safe = String(text || '')
      .replace(/[\\/:*?"<>|\[\]\u0000-\u001F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    return safe || fallback;
  }

  /* ═══════════ 导出 ═══════════ */
  async function buildBrief(input) {
    if (!window.JSZip) {
      throw new XlsxError('NO_JSZIP', 'Excel 组件尚未加载，请刷新页面后重试。');
    }
    const folder = input && input.folder;
    if (!folder) throw new XlsxError('NO_FOLDER', '请先打开一个收藏夹。');

    const sanitize = Folio.Brief && Folio.Brief.sanitizeIntro
      ? Folio.Brief.sanitizeIntro
      : (html) => String(html || '');

    const allVideos = Array.isArray(input.videos) ? input.videos : (folder.videos || []);
    const entries = allVideos.map((video, index) => {
      const intro = sanitize(video.intro || '');
      return {
        video,
        index,
        intro,
        blocks: parseBlocks(htmlToRoot(intro)),
        toc: { targetRow: 0 }
      };
    }).filter((entry) => entry.video.done);

    if (!entries.length) {
      throw new XlsxError('EMPTY', '先为至少一支视频写下简报，再来生成 Excel。');
    }

    /* 1. 收集图片：封面按「地址 + 时长」区分，正文图按地址去重 */
    const requests = [];
    const seen = new Set();
    const addRequest = (key, request) => {
      if (!key || seen.has(key)) return;
      seen.add(key);
      requests.push({ key, ...request });
    };

    entries.forEach((entry) => {
      const src = coverSrc(entry.video);
      if (src) {
        addRequest(coverKey(entry.video), {
          kind: 'cover',
          src,
          label: U.formatDuration(entry.video.dur)
        });
      }
      entry.blocks.forEach((block) => {
        if (block.type === 'figure' && block.src) {
          addRequest(`img:${block.src}`, { kind: 'img', src: block.src });
          return;
        }
        const tokens = block.type === 'p' ? block.tokens
          : block.type === 'quote' ? block.paras.flat()
            : block.type === 'list' ? block.items.flat()
              : null;
        (tokens || []).forEach((token) => {
          if (token && token.type === 'img' && token.src) {
            addRequest(`img:${token.src}`, { kind: 'img', src: token.src });
          }
        });
      });
    });

    /* 2. 并发加载；封面额外合成圆角与时长角标 */
    const mediaByKey = new Map();
    let skipped = 0;
    const loaded = await Promise.all(requests.map((request) => loadMedia(request.src)));
    const mediaList = [];

    for (let i = 0; i < requests.length; i += 1) {
      const request = requests[i];
      const item = loaded[i];
      if (!item) { skipped += 1; continue; }

      let media;
      if (request.kind === 'cover') {
        media = await composeCover(item, request.label);
      } else {
        media = await plainMedia(item);
      }
      if (!media) { skipped += 1; continue; }

      const entry = { ...media, index: mediaList.length + 1 };
      entry.fileName = `image${entry.index}.${media.ext}`;
      entry.rId = `rIdImg${entry.index}`;
      mediaList.push(entry);
      mediaByKey.set(request.key, entry);
    }

    /* 3. 生成工作表 */
    const styles = new StyleBook();
    const sheet = buildModel({
      folder,
      user: input.user,
      options: input.options,
      entries,
      mediaByKey,
      styles
    });

    // 图片 rId 在排版阶段才被引用，这里回填
    sheet.images.forEach((image) => {
      image.rId = image.media.rId;
      image.fileName = image.media.fileName;
    });

    const sheetName = safeName(folder.title, '雪哔简报').slice(0, 31);
    const sheetXml = buildSheetXml(sheet);

    const zip = new window.JSZip();
    zip.file('[Content_Types].xml', buildContentTypes(sheet.images.length > 0));
    zip.file('_rels/.rels', buildRootRels());
    zip.file('xl/workbook.xml', buildWorkbookXml(sheetName));
    zip.file('xl/_rels/workbook.xml.rels', buildWorkbookRels());
    zip.file('xl/styles.xml', buildStylesXml(styles));
    zip.file('xl/theme/theme1.xml', buildThemeXml());
    zip.file('xl/worksheets/sheet1.xml', sheetXml);
    if (sheet.images.length) {
      zip.file('xl/worksheets/_rels/sheet1.xml.rels', buildSheetRels());
      zip.file('xl/drawings/drawing1.xml', buildDrawingXml(sheet.images));
      zip.file('xl/drawings/_rels/drawing1.xml.rels', buildDrawingRels(sheet.images));
    }
    zip.file('docProps/core.xml', buildCoreXml(folder, input.user));
    zip.file('docProps/app.xml', buildAppXml(sheetName));
    mediaList.forEach((media) => {
      zip.file(`xl/media/${media.fileName}`, media.bytes, { binary: true });
    });

    const blob = await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    return {
      blob,
      fileName: `${safeName(folder.title, '雪哔简报')} · 雪哔简报.xlsx`,
      videoCount: entries.length,
      mediaCount: sheet.images.length,
      skippedImages: skipped,
      rows: sheet.rows.length
    };
  }

  /* ═══════════ 页面入口 ═══════════ */
  function openModal() {
    const app = Folio.App.state;
    const folder = app.folder;
    if (!folder) return;
    const list = folder.videos.filter((video) => video.done);
    const imageCount = list.reduce((sum, video) => {
      const div = document.createElement('div');
      div.innerHTML = video.intro || '';
      return sum + div.querySelectorAll('img').length + (video.cover ? 1 : 0);
    }, 0);

    Folio.UI.openModal(`<div class="modal" style="width:660px">
      <header class="m-head"><div><p class="overline">OUTPUT 03 · EXCEL</p><h3>生成 Excel 简报</h3><p>用合并单元格、底纹与浮动图片重排简报；目录可点击跳转，适合在表格 / 在线文档里阅读。</p></div><button class="m-close" data-close>${Folio.Icons.x}</button></header>
      <div class="brief-body">
        <div class="brief-file">
          <span class="brief-file-icon">${Folio.Icons.layers}</span>
          <div><b>${esc(folder.title)} · 雪哔简报.xlsx</b><p>${list.length} 篇简报 · ${imageCount ? `含 ${imageCount} 张图片（含封面）` : '纯文字'}</p></div>
        </div>
        <ul class="brief-points">
          <li>顶部目录用【01】编号，点击条目可跳到对应视频。</li>
          <li>完整保留封面、配图、引用与文字颜色。</li>
          <li>暂不支持回导；继续编辑请用「导入 PDF」或本机草稿。</li>
        </ul>
        <p class="hint">文件在浏览器本地生成，不上传任何内容；图片较多时生成需要几秒。</p>
      </div>
      <footer class="m-foot"><span class="mono">XLSX · 目录可跳转</span><button class="btn btn-primary" id="btn-xlsx-download">${Folio.Icons.dl} 生成并下载</button></footer>
    </div>`);

    const button = document.getElementById('btn-xlsx-download');
    if (button) button.onclick = () => download(button);
  }

  async function download(button) {
    const app = Folio.App.state;
    if (!app.folder) return;
    if (button) Folio.UI.setButtonBusy(button, true, '正在生成…');

    try {
      const videos = app.folder.videos.map((video) => ({
        ...video,
        intro: Folio.Output && Folio.Output.introForExport
          ? Folio.Output.introForExport(video)
          : video.intro
      }));

      const result = await buildBrief({
        folder: app.folder,
        user: app.user,
        options: Folio.Output && Folio.Output.readOutputOptions
          ? Folio.Output.readOutputOptions()
          : readOptions(),
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

      Folio.UI.toast(`Excel 已生成：${result.videoCount} 篇简报${result.mediaCount ? `，嵌入 ${result.mediaCount} 张图片` : ''}`);
      if (result.skippedImages) {
        Folio.UI.toast(`有 ${result.skippedImages} 张图片无法嵌入，已跳过`, 'warn');
      }
    } catch (error) {
      Folio.UI.toast(error.message || 'Excel 生成失败，请重试', 'warn');
    } finally {
      if (button) Folio.UI.setButtonBusy(button, false);
    }
  }

  function readOptions() {
    const showUp = document.querySelector('[data-share="showUp"]');
    const allowRepost = document.querySelector('[data-share="allowRepost"]');
    return {
      showUp: showUp ? showUp.checked : true,
      allowRepost: allowRepost ? allowRepost.checked : true
    };
  }

  Folio.XlsxError = XlsxError;
  Folio.Xlsx = {
    buildBrief,
    openModal,
    /** 供调试/对比：只生成工作表模型，不打包。 */
    _buildModel: buildModel
  };
})(window.Folio = window.Folio || {});
