/* ==========================================================================
   bilibili-api.js — B 站接口调用与数据归一化
   已确认无需登录即可读取：
     · 用户名片      /x/web-interface/card
     · 收藏夹列表    /x/v3/fav/folder/created/list-all
     · 收藏夹内容    /x/v2/medialist/resource/list（分页）
     · 视频详情      /x/web-interface/view
   注意：视频标签接口在无 Cookie 时会 403，因此只作为可选能力保留。
   ========================================================================== */
(function (Folio) {
  'use strict';

  const Api = Folio.ApiClient;
  const U = Folio.Utils;
  const DEFAULT_AVATAR = 'https://i0.hdslb.com/bfs/face/member/noface.jpg';

  // 只传 path；域名与转发由后端负责（PHP 或 Cloudflare Worker）
  const url = (path) => path;

  /** B 站图片：补全 https，并按需追加 CDN 缩放参数 */
  function image(source, width, height) {
    if (!source) return '';
    let src = String(source);
    if (src.startsWith('//')) src = `https:${src}`;
    src = src.replace(/^http:/, 'https:');
    if (width && height && /hdslb\.com/.test(src) && !src.includes('@')) {
      src += `@${width}w_${height}h_1c.webp`;
    }
    return src;
  }

  /**
   * 列表缩略图：把已带 @WxH 参数的封面换成显示尺寸需要的小图。
   * 列表里缩略图只有 56×36 / 66×42，用 320×200 原图意味着手机上每行多解码 5~7 倍像素、
   * 多占 5~7 倍 GPU 纹理（2000 行时这是滚动掉帧的主要来源）。
   * 尺寸仍取显示尺寸 × 3（覆盖 dpr 3），所以肉眼不可辨。
   */
  function thumb(source, width, height) {
    if (!source) return '';
    const src = String(source);
    const resized = src.replace(/@\d+w_\d+h_1c\.webp$/, `@${width}w_${height}h_1c.webp`);
    if (resized !== src) return resized;
    return image(source, width, height);
  }

  /** 把接口返回的媒体项归一化为页面内部模型 */
  function normalizeVideo(media) {
    const rawPages = Array.isArray(media.pages) ? media.pages : [];
    const pages = rawPages.length
      ? rawPages.map((page, index) => ({
          id: page.id,
          title: page.title || `P${page.page || index + 1}`,
          d: Number(page.duration) || 0
        }))
      : [{ id: null, title: 'P1', d: Number(media.duration) || 0 }];

    const sum = pages.reduce((total, page) => total + page.d, 0);

    return {
      id: String(media.id || media.bv_id || media.bvid || ''),
      aid: String(media.id || ''),
      bvid: media.bv_id || media.bvid || '',
      title: media.title || '',
      cover: image(media.cover, 320, 200),
      dur: sum || Number(media.duration) || 0,
      pages,
      up: (media.upper && media.upper.name) || '',
      upMid: String((media.upper && media.upper.mid) || ''),
      play: (media.cnt_info && media.cnt_info.view_text_1) || U.formatCount((media.cnt_info && media.cnt_info.play) || 0),
      danmaku: U.formatCount((media.cnt_info && media.cnt_info.danmaku) || 0),
      pubtime: Number(media.pubtime) || 0,
      desc: media.intro || '',
      type: media.type || 2,
      done: false
    };
  }

  /** 用户名片（无需登录） */
  async function getUser(mid) {
    const response = await Api.get(url('/x/web-interface/card'), { mid });
    const data = response.data || {};
    const card = data.card || {};
    return {
      mid: String(card.mid || mid),
      name: card.name || `UID ${mid}`,
      avatar: image(card.face || DEFAULT_AVATAR, 96, 96),
      level: (card.level_info && card.level_info.current_level) || 0,
      fans: Number(data.follower || card.fans || 0),
      archiveCount: Number(data.archive_count || 0),
      sign: card.sign || ''
    };
  }

  /** 收藏夹列表（仅公开收藏夹） */
  async function getFavFolders(mid) {
    // 收藏夹列表决定数量和后续报价，禁用前端缓存，始终取最新
    const response = await Api.get(url('/x/v3/fav/folder/created/list-all'), {
      up_mid: mid,
      web_location: '333.1387'
    }, { cache: false });
    const data = response.data;
    if (!data || !Array.isArray(data.list)) return [];
    return data.list.map((folder) => ({
      id: String(folder.id),
      fid: String(folder.fid || ''),
      title: folder.title || '未命名收藏夹',
      mediaCount: Number(folder.media_count) || 0,
      attr: Number(folder.attr) || 0,
      videos: null
    }));
  }

  /**
   * 只取收藏夹前 3 个视频的封面，用于收藏夹卡片。
   * 独立于 getFavItems：不拉全量、不翻页，列表渲染后并发调用。
   */
  async function getFavCovers(bizId) {
    const response = await Api.get(url('/x/v2/medialist/resource/list'), {
      mobi_app: 'web',
      type: 3,
      biz_id: bizId,
      ps: 3,
      with_current: 'false'
    });
    const data = response.data;
    const list = data && Array.isArray(data.media_list) ? data.media_list : [];
    return list
      .slice(0, 3)
      .map((media) => image(media.cover, 320, 200))
      .filter(Boolean);
  }

  /**
   * 拉取收藏夹全部视频（自动翻页）。
   * @param {string} bizId 收藏夹 id
   * @param {{onProgress?: (loaded:number,total:number)=>void}} options
   * @returns {Promise<{videos:Array,total:number}>}
   */
  async function getFavItems(bizId, options = {}) {
    const limit = Folio.Config.api.maxPages;
    const pageSize = Folio.Config.api.pageSize;
    const videos = [];
    let oid = '';
    let otype = '';
    let total = 0;
    let page = 0;

    while (page < limit) {
      // 视频列表直接决定时长与报价，禁用前端缓存，新增视频必须能立刻读到
      const response = await Api.get(url('/x/v2/medialist/resource/list'), {
        mobi_app: 'web',
        type: 3,
        biz_id: bizId,
        ps: pageSize,
        with_current: 'false',
        oid,
        otype
      }, { cache: false });

      const data = response.data;
      if (!data) throw new Folio.ApiError('EMPTY_FOLDER', '这个收藏夹没有可读取的内容');

      if (page === 0) total = Number(data.total_count) || 0;

      const list = Array.isArray(data.media_list) ? data.media_list : [];
      list.forEach((media) => videos.push(normalizeVideo(media)));

      if (options.onProgress) options.onProgress(videos.length, total || videos.length);
      if (!data.has_more || !list.length) break;

      const last = list[list.length - 1];
      if (String(last.id) === String(oid) && String(last.type) === String(otype)) break;

      oid = last.id;
      otype = last.type;
      page += 1;
    }

    return { videos, total: total || videos.length };
  }

  /** 视频详情（简介 / 分 P / 统计），可用于编辑器的素材参考 */
  async function getVideoDetail(bvid) {
    const response = await Api.get(url('/x/web-interface/view'), { bvid });
    const data = response.data || {};
    return {
      bvid: data.bvid || bvid,
      aid: String(data.aid || ''),
      title: data.title || '',
      cover: image(data.pic, 480, 300),
      desc: data.desc || '',
      pubdate: Number(data.pubdate) || 0,
      duration: Number(data.duration) || 0,
      videos: Number(data.videos) || 1,
      owner: {
        mid: String((data.owner && data.owner.mid) || ''),
        name: (data.owner && data.owner.name) || '',
        avatar: image((data.owner && data.owner.face) || DEFAULT_AVATAR, 96, 96)
      },
      stat: {
        view: Number((data.stat && data.stat.view) || 0),
        danmaku: Number((data.stat && data.stat.danmaku) || 0),
        reply: Number((data.stat && data.stat.reply) || 0),
        favorite: Number((data.stat && data.stat.favorite) || 0),
        coin: Number((data.stat && data.stat.coin) || 0),
        like: Number((data.stat && data.stat.like) || 0)
      },
      pages: (Array.isArray(data.pages) ? data.pages : []).map((page) => ({
        cid: page.cid,
        page: page.page,
        title: page.part || `P${page.page}`,
        d: Number(page.duration) || 0
      }))
    };
  }

  /**
   * 视频标签（可选）。该接口在无 Cookie 时会返回 403，
   * 因此调用方必须自行捕获异常，不能把失败当成致命错误。
   */
  async function getVideoTags(aid) {
    const response = await Api.get(url('/x/tag/archive/tags'), { aid });
    return (response.data || []).map((tag) => tag.tag_name).filter(Boolean);
  }

  /** 一次读取用户名片 + 收藏夹列表；名片失败时降级，收藏夹失败才报错 */
  async function loadUserSpace(uid) {
    const [userResult, folderResult] = await Promise.allSettled([
      getUser(uid),
      getFavFolders(uid)
    ]);

    if (folderResult.status === 'rejected') throw folderResult.reason;

    const fallbackUser = {
      mid: String(uid),
      name: `UID ${uid}`,
      avatar: image(DEFAULT_AVATAR, 96, 96),
      level: 0,
      fans: 0,
      archiveCount: 0,
      sign: ''
    };

    return {
      user: userResult.status === 'fulfilled' ? userResult.value : fallbackUser,
      folders: folderResult.value,
      userFallback: userResult.status === 'rejected'
    };
  }

  const videoUrl = (bvid) => (bvid ? `https://www.bilibili.com/video/${bvid}` : '');
  const spaceUrl = (mid) => (mid ? `https://space.bilibili.com/${mid}` : '');

  Folio.BiliApi = {
    getUser,
    getFavFolders,
    getFavCovers,
    getFavItems,
    getVideoDetail,
    getVideoTags,
    loadUserSpace,
    normalizeVideo,
    image,
    thumb,
    videoUrl,
    spaceUrl
  };
})(window.Folio = window.Folio || {});
