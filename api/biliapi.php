<?php
/**
 * 雪哔 SnawCap · Bilibili 公开接口后端（PHP v2）
 *
 * 作用：
 *   浏览器直连 api.bilibili.com 会被 CORS / Sec-Fetch 风控拦截；
 *   本文件在服务端用 cURL 转发白名单内的公开接口，返回原始 JSON。
 *
 * 用法：
 *   GET api/biliapi.php?path=/x/web-interface/card&mid=8047632
 *   GET api/biliapi.php?path=/x/v3/fav/folder/created/list-all&up_mid=8047632
 *   GET api/biliapi.php?path=/x/v2/medialist/resource/list&mobi_app=web&type=3&biz_id=...&ps=50&oid=&otype=
 *   GET api/biliapi.php?path=/x/web-interface/view&bvid=BV...
 *
 * 说明：
 *   - 允许任意来源的 CORS，处理 OPTIONS 预检；
 *   - 镜像 api.biliapi.net 优先，官方 api.bilibili.com 兜底；
 *   - 附带 Origin / Cookie(buvid3)，降低 medialist 等接口的 412 概率；
 *   - 收藏夹列表 / 视频列表不缓存，避免新增视频漏算时长与报价。
 */

declare(strict_types=1);

ini_set('display_errors', '0');
error_reporting(E_ALL);

const VERSION = 'php-v2';
const BUVID3 = '8F3C1D2A-6B4E-4F7A-9C21-5D8E0A1B2C3Dinfoc';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const UPSTREAMS = [
    'https://api.biliapi.net',
    'https://api.bilibili.com',
];

const RISK_CODES = [-352, -403, -412];

const ALLOWED_PATHS = [
    '/x/web-interface/card',
    '/x/v3/fav/folder/created/list-all',
    '/x/v2/medialist/resource/list',
    '/x/web-interface/view',
    '/x/tag/archive/tags',
];

const CACHEABLE_PATHS = [
    '/x/web-interface/card',
    '/x/web-interface/view',
];

// 跨域读取：公开数据，无需凭证，因此使用 * 而不是回显 Origin。
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Max-Age: 86400');
header('Access-Control-Expose-Headers: X-Folio-Upstream, X-Folio-Version');
header('X-Folio-Version: ' . VERSION);
header('Allow: GET, OPTIONS');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

// 预检请求可能声明自定义请求头；回显它们（去掉换行，避免头注入）。
$requestedHeaders = (string) ($_SERVER['HTTP_ACCESS_CONTROL_REQUEST_HEADERS'] ?? '');
$requestedHeaders = str_replace(["\r", "\n"], '', $requestedHeaders);
header('Access-Control-Allow-Headers: ' . ($requestedHeaders !== '' ? $requestedHeaders : 'Accept, Content-Type'));

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    respond(['code' => -405, 'message' => 'Method Not Allowed'], 405);
}

if (!function_exists('curl_init')) {
    respond(['code' => -500, 'message' => 'PHP curl extension is not enabled'], 500);
}

$path = isset($_GET['path']) ? trim((string) $_GET['path']) : '';
if ($path === '' || !in_array($path, ALLOWED_PATHS, true)) {
    respond(['code' => -400, 'message' => 'Invalid or disallowed path'], 400);
}

$params = $_GET;
unset($params['path'], $params['callback'], $params['jsonp']);
$query = http_build_query($params, '', '&', PHP_QUERY_RFC3986);

$cacheable = in_array($path, CACHEABLE_PATHS, true);
$errors = [];

foreach (UPSTREAMS as $base) {
    $result = fetch_upstream($base, $path, $query);

    if ($result['body'] === false || $result['errno'] !== 0) {
        $errors[] = $base . ': ' . ($result['error'] ?: 'curl failed');
        continue;
    }

    if ($result['status'] >= 400) {
        $errors[] = $base . ': HTTP ' . $result['status'];
        continue;
    }

    $data = json_decode((string) $result['body'], true);
    if (!is_array($data)) {
        $errors[] = $base . ': invalid JSON';
        continue;
    }

    if (isset($data['code']) && in_array((int) $data['code'], RISK_CODES, true)) {
        $errors[] = $base . ': code ' . $data['code'];
        continue;
    }

    if ($cacheable) {
        header('Cache-Control: public, max-age=300');
    }

    respond($data, 200, (string) parse_url($base, PHP_URL_HOST));
}

respond([
    'code' => -500,
    'message' => '[' . VERSION . '] All upstreams failed: ' . implode(' | ', $errors),
], 502);

/**
 * @return array{body:string|false,errno:int,error:string,status:int}
 */
function fetch_upstream(string $base, string $path, string $query): array
{
    $url = $base . $path . ($query !== '' ? '?' . $query : '');

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_CONNECTTIMEOUT => 6,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_ENCODING => '',
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER => [
            'Accept: application/json, text/plain, */*',
            'Accept-Language: zh-CN,zh;q=0.9',
            'Referer: https://www.bilibili.com/',
            'Origin: https://www.bilibili.com',
            'Cookie: buvid3=' . BUVID3 . '; b_nut=' . time(),
        ],
        CURLOPT_USERAGENT => UA,
    ]);

    $body = curl_exec($ch);
    $errno = curl_errno($ch);
    $error = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);

    return [
        'body' => $body,
        'errno' => $errno,
        'error' => $error,
        'status' => $status,
    ];
}

/**
 * 输出 JSON 并结束请求。
 *
 * @param array<string,mixed> $payload
 */
function respond(array $payload, int $status = 200, string $upstream = ''): void
{
    if ($upstream !== '') {
        header('X-Folio-Upstream: ' . $upstream);
    }
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
