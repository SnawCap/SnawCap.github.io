/* ==========================================================================
   api-client.js — API 传输层（后端 / 超时 / 错误 / 内存缓存）

   浏览器不再直连 B 站：
     bilibili-api.js 只传 path + 参数；
     这里请求 后端（默认 ./api/biliapi.php）?path=...，由 PHP 在服务端转发；
     PHP 返回 B 站原始 JSON（code/message/data），本层负责校验 code。

   数据源只在 JS 中配置，页面上没有设置入口：
     - 静态配置：js/config.js 的 api.backend；
     - 运行期覆盖：Folio.ApiClient.setBackend('https://host/api/biliapi.php')，
       写入 localStorage（folio-api-backend），对跨域部署同样有效。
   ========================================================================== */
(function (Folio) {
  'use strict';

  const DEFAULT_TIMEOUT = Folio.Config.api.backendTimeout;
  const DEFAULT_TTL = Folio.Config.api.cacheTtl;

  class ApiError extends Error {
    constructor(code, message, detail) {
      super(message || '接口请求失败');
      this.name = 'ApiError';
      this.code = code;
      this.detail = detail || null;
    }
  }

  const cache = new Map();

  /* ═══════════ 后端地址 ═══════════ */
  function readBackend() {
    const fallback = (Folio.Config.api.backend || '').trim();
    try {
      const stored = window.localStorage.getItem(Folio.Config.storage.backend);
      // 显式保存过的非空地址优先；空值（含旧版演示模式的空字符串）回落到 config.js
      if (stored !== null && stored.trim() !== '') return stored.trim();
      return fallback;
    } catch (err) {
      return fallback;
    }
  }

  function setBackend(value) {
    const backend = String(value || '').trim();
    try {
      // 空值表示恢复 config.js 中的默认地址，而不是关闭后端
      if (backend) window.localStorage.setItem(Folio.Config.storage.backend, backend);
      else window.localStorage.removeItem(Folio.Config.storage.backend);
    } catch (err) { /* 隐私模式下忽略 */ }
    clearCache();
    return readBackend();
  }

  /* ═══════════ 请求 ═══════════ */
  function buildRequest(path, params) {
    const backend = readBackend();
    if (!backend) {
      throw new ApiError(
        'NO_BACKEND',
        '未配置 后端：请在 js/config.js 的 api.backend 填写地址，或调用 Folio.ApiClient.setBackend(\'https://.../api/biliapi.php\')'
      );
    }

    const target = new URL(backend, window.location.href);
    target.searchParams.set('path', path);
    Object.keys(params || {}).forEach((key) => {
      const value = params[key];
      if (value === undefined || value === null) return;
      target.searchParams.set(key, String(value));
    });
    return target;
  }

  async function get(path, params = {}, options = {}) {
    const target = buildRequest(path, params);
    const cacheKey = target.toString();
    const ttl = options.ttl === undefined ? DEFAULT_TTL : options.ttl;
    const useCache = options.cache !== false;
    const timeout = options.timeout || DEFAULT_TIMEOUT;

    if (useCache && cache.has(cacheKey)) {
      const hit = cache.get(cacheKey);
      if (Date.now() - hit.at < ttl) return validate(hit.data);
      cache.delete(cacheKey);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(target.toString(), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
        referrerPolicy: 'no-referrer'
      });

      if (!response.ok) {
        let detail = '';
        try {
          const errorBody = await response.json();
          detail = errorBody && errorBody.message ? `：${errorBody.message}` : '';
        } catch (err) { /* 忽略非 JSON 错误体 */ }
        throw new ApiError('BACKEND_HTTP', `后端返回 HTTP ${response.status}${detail}`);
      }

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (err) {
        // 部分免费主机（InfinityFree / ct.ws 等）会先返回 aes.js 人机验证页
        if (/aes\.js|__test|requires\s+Javascript/i.test(text.slice(0, 1500))) {
          throw new ApiError(
            'HOST_CHALLENGE',
            '后端主机启用了人机验证（aes.js 验证页），接口被 HTML 验证页拦截。请把前端部署到与 PHP 相同的域名，或换一个不启用该验证的 PHP 主机。'
          );
        }
        throw new ApiError(
          'BACKEND_BAD_JSON',
          '后端返回的不是 JSON。请确认 api/biliapi.php 已由 PHP 执行（GitHub Pages 不会执行 PHP）。'
        );
      }

      if (useCache) cache.set(cacheKey, { at: Date.now(), data });
      return validate(data);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error && error.name === 'AbortError') {
        throw new ApiError('TIMEOUT', '后端响应超时，请稍后重试');
      }
      throw new ApiError(
        'BACKEND_NETWORK',
        '无法连接 后端：请检查地址、CORS、服务器状态与网络。部分免费主机会用 aes.js 人机验证拦截跨域 fetch，此时需把前端部署到同一域名或更换主机。'
      );
    } finally {
      clearTimeout(timer);
    }
  }

  function validate(response) {
    if (!response || typeof response !== 'object') {
      throw new ApiError('BAD_RESPONSE', '接口返回格式异常');
    }
    if (response.code !== 0) {
      throw new ApiError(
        response.code,
        response.message || `接口返回错误（code ${response.code}）`,
        response
      );
    }
    return response;
  }

  function clearCache() {
    cache.clear();
  }

  Folio.ApiError = ApiError;
  Folio.ApiClient = {
    get,
    clearCache,
    readBackend,
    setBackend
  };
})(window.Folio = window.Folio || {});
