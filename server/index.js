import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as defaultDpapi from './dpapi.js';
import { ConfigError, createConfigStore } from './config-store.js';
import { fetchModels, runTest, resolveTimeoutMs } from './upstream.js';
import { webDir as defaultWebDir, resolveConfigPath } from './paths.js';

export const APP_VERSION = '0.1.0';
const HOST = '127.0.0.1';
const DEFAULT_PORT = 8791;
const PORT_FALLBACK_RANGE = 10;
const BODY_LIMIT = 1024 * 1024;
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json'
};

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

function sendJson(res, status, payload) {
  if (res.headersSent || res.writableEnded) {
    return;
  }
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

function sendText(res, status, message) {
  if (res.headersSent || res.writableEnded) {
    return;
  }
  const body = Buffer.from(message, 'utf8');
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function methodNotAllowed(res) {
  sendError(res, 405, 'method_not_allowed', '不支持的请求方法');
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) {
      throw new HttpError(413, 'payload_too_large', '请求体过大');
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) {
    throw new HttpError(400, 'invalid_body', '请求体必须是 JSON 对象');
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_body', '请求体不是合法的 JSON');
  }
  if (!isPlainObject(parsed)) {
    throw new HttpError(400, 'invalid_body', '请求体必须是 JSON 对象');
  }
  return parsed;
}

function listeningPort(server) {
  const address = server.address();
  return address && typeof address === 'object' ? address.port : null;
}

/**
 * 变更类请求护栏：Sec-Fetch-Site 跨站、Origin 不匹配、Content-Type 非 JSON 时拒绝。
 * @returns {boolean} 已拒绝时为 true
 */
function checkMutationGuard(req, res, port) {
  if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') {
    sendError(res, 403, 'forbidden', '不允许来自其他站点的请求');
    return true;
  }
  const origin = req.headers.origin;
  if (origin !== undefined) {
    const allowed = ['http://127.0.0.1:' + port, 'http://localhost:' + port];
    if (!allowed.includes(String(origin))) {
      sendError(res, 403, 'forbidden', '请求来源不受信任');
      return true;
    }
  }
  const contentType = String(req.headers['content-type'] || '');
  const mediaType = contentType.split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    sendError(res, 415, 'unsupported_media_type', '变更类请求必须使用 application/json');
    return true;
  }
  return false;
}

async function handleApi(req, res, pathname, context) {
  const method = req.method || 'GET';
  const { configStore } = context;

  if (pathname === '/api/health') {
    if (method !== 'GET') {
      methodNotAllowed(res);
      return;
    }
    sendJson(res, 200, {
      ok: true,
      version: APP_VERSION,
      platform: process.platform,
      dpapi: configStore.dpapi.isAvailable(),
      configPath: configStore.configPath
    });
    return;
  }

  if (pathname === '/api/config') {
    if (method === 'GET') {
      sendJson(res, 200, await configStore.getSnapshot());
      return;
    }
    if (method === 'PUT' || method === 'DELETE') {
      if (checkMutationGuard(req, res, listeningPort(context.server))) {
        return;
      }
      if (method === 'DELETE') {
        await configStore.clear();
        sendJson(res, 200, { ok: true });
        return;
      }
      const body = await readJsonBody(req);
      sendJson(res, 200, await configStore.save(body));
      return;
    }
    methodNotAllowed(res);
    return;
  }

  if (pathname === '/api/models') {
    if (method !== 'GET') {
      methodNotAllowed(res);
      return;
    }
    await handleModels(res, context);
    return;
  }

  if (pathname === '/api/run') {
    if (method !== 'POST') {
      methodNotAllowed(res);
      return;
    }
    if (checkMutationGuard(req, res, listeningPort(context.server))) {
      return;
    }
    await handleRun(req, res, context);
    return;
  }

  sendError(res, 404, 'not_found', '接口不存在');
}

async function handleModels(res, context) {
  const { configStore } = context;
  const snapshot = await configStore.getSnapshot();
  if (!snapshot.baseUrl) {
    sendJson(res, 200, { ok: false, error: { code: 'missing_base_url', message: '尚未配置服务地址' } });
    return;
  }
  let apiKey;
  try {
    apiKey = await configStore.getApiKey();
  } catch (error) {
    sendJson(res, 200, {
      ok: false,
      error: { code: 'missing_api_key', message: '已保存的 API Key 无法解密，请重新配置' }
    });
    return;
  }
  if (!apiKey) {
    sendJson(res, 200, { ok: false, error: { code: 'missing_api_key', message: '尚未配置 API Key' } });
    return;
  }
  const result = await fetchModels({
    baseUrl: snapshot.baseUrl,
    apiKey,
    timeoutMs: resolveTimeoutMs(),
    fetchImpl: context.fetchImpl
  });
  if (result.ok) {
    sendJson(res, 200, { ok: true, models: result.models });
    return;
  }
  sendJson(res, 200, { ok: false, error: result.error });
}

async function handleRun(req, res, context) {
  const { configStore } = context;
  const body = await readJsonBody(req);
  const testId = body.testId;
  const prompt = body.prompt;
  if (typeof testId !== 'string' || !testId || typeof prompt !== 'string') {
    throw new HttpError(400, 'invalid_body', '请求体必须包含 testId 与 prompt');
  }

  const snapshot = await configStore.getSnapshot();
  if (!snapshot.baseUrl) {
    sendError(res, 400, 'missing_base_url', '尚未配置服务地址');
    return;
  }
  let apiKey;
  try {
    apiKey = await configStore.getApiKey();
  } catch {
    sendError(res, 400, 'missing_api_key', '已保存的 API Key 无法解密，请重新配置');
    return;
  }
  if (!apiKey) {
    sendError(res, 400, 'missing_api_key', '尚未配置 API Key');
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff'
  });
  res.flushHeaders();
  if (res.socket) {
    res.socket.setNoDelay(true);
  }

  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  };
  res.on('close', onClose);

  const writeEvent = (event) => {
    if (res.writableEnded || res.destroyed) {
      return;
    }
    res.write('data: ' + JSON.stringify(event) + '\n\n');
  };

  try {
    await runTest({
      baseUrl: snapshot.baseUrl,
      apiKey,
      model: snapshot.model,
      reasoningEffort: snapshot.reasoningEffort,
      prompt,
      testId,
      signal: controller.signal,
      timeoutMs: resolveTimeoutMs(),
      onEvent: writeEvent,
      fetchImpl: context.fetchImpl
    });
  } catch {
    writeEvent({
      type: 'error',
      code: 'upstream_error',
      message: '测试请求执行失败，请稍后重试',
      status: null,
      detail: null
    });
  } finally {
    res.off('close', onClose);
    if (!res.writableEnded && !res.destroyed) {
      res.end();
    }
  }
}

async function handleStatic(req, res, context) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    methodNotAllowed(res);
    return;
  }
  const rawPath = (req.url || '/').split('?')[0];
  let pathname;
  try {
    pathname = decodeURIComponent(rawPath);
  } catch {
    sendText(res, 400, '请求路径不合法');
    return;
  }
  if (pathname.includes('\0')) {
    sendText(res, 400, '请求路径不合法');
    return;
  }
  if (pathname === '') {
    pathname = '/';
  }
  if (pathname.endsWith('/')) {
    pathname += 'index.html';
  }

  const root = path.resolve(context.webDir);
  const relative = pathname.replace(/^\/+/, '').split('/').join(path.sep);
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) {
    sendText(res, 404, '未找到请求的资源');
    return;
  }

  let stats;
  try {
    stats = await fsp.stat(target);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) {
      sendText(res, 404, '未找到请求的资源');
      return;
    }
    throw error;
  }
  if (!stats.isFile()) {
    sendText(res, 404, '未找到请求的资源');
    return;
  }

  const extension = path.extname(target).toLowerCase();
  const headers = {
    'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
    'Content-Length': stats.size,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  };
  if (extension === '.html' || extension === '.htm') {
    headers['Content-Security-Policy'] = CSP;
  }
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  try {
    const body = await fsp.readFile(target);
    res.end(body);
  } catch {
    res.destroy();
  }
}

async function handleRequest(req, res, context) {
  const pathname = (req.url || '/').split('?')[0];
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    await handleApi(req, res, pathname, context);
    return;
  }
  await handleStatic(req, res, context);
}

/**
 * 创建 HTTP 服务（不监听）。默认托管仓库内 web/ 目录。
 * @param {{ configStore: ReturnType<typeof createConfigStore>, webDir?: string, fetchImpl?: typeof fetch }} options
 * @returns {http.Server}
 */
export function createAppServer({ configStore, webDir = defaultWebDir, fetchImpl } = {}) {
  if (!configStore) {
    throw new Error('createAppServer 需要 configStore');
  }
  const context = { configStore, webDir, fetchImpl };
  const server = http.createServer((req, res) => {
    context.server = server;
    handleRequest(req, res, context).catch((error) => {
      if (res.headersSent) {
        if (!res.writableEnded) {
          try {
            res.end();
          } catch {
            // 连接已断开时忽略。
          }
        }
        return;
      }
      if (error instanceof HttpError) {
        sendError(res, error.status, error.code, error.message);
        return;
      }
      if (error instanceof ConfigError) {
        sendError(res, error.status || 400, error.code, error.message);
        return;
      }
      process.stderr.write(
        '[astra-test] 请求处理失败：' + (error && error.message ? error.message : String(error)) + '\n'
      );
      sendError(res, 500, 'internal_error', '服务器内部错误');
    });
  });
  server.on('clientError', (error, socket) => {
    if (socket && !socket.destroyed) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    }
  });
  return server;
}

/**
 * @param {string | undefined} raw
 * @returns {number}
 */
export function parsePort(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return DEFAULT_PORT;
  }
  const value = Number(String(raw).trim());
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error('ASTRA_PORT 必须是 0-65535 之间的整数');
  }
  return value;
}

/**
 * @param {http.Server} server
 * @param {number} port
 * @returns {Promise<number>}
 */
function listenOnce(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(listeningPort(server));
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
}

/**
 * 端口被占用或被系统保留时顺延尝试后续端口（默认 10 个）；端口 0 交给系统分配。
 * @param {http.Server} server
 * @param {number} basePort
 * @param {number} [fallbackCount]
 * @returns {Promise<number>}
 */
export async function listenWithFallback(server, basePort, fallbackCount = PORT_FALLBACK_RANGE) {
  if (basePort === 0) {
    return listenOnce(server, 0);
  }
  for (let offset = 0; offset <= fallbackCount; offset += 1) {
    const candidate = basePort + offset;
    if (candidate > 65535) {
      break;
    }
    try {
      return await listenOnce(server, candidate);
    } catch (error) {
      if (!error || (error.code !== 'EADDRINUSE' && error.code !== 'EACCES')) {
        throw error;
      }
    }
  }
  throw new Error('端口 ' + basePort + ' 及其后 ' + fallbackCount + ' 个端口均被占用，无法启动服务');
}

function openBrowser(url) {
  if (process.platform !== 'win32') {
    return;
  }
  try {
    const child = spawn('explorer.exe', [url], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {
      // 打开浏览器失败不影响服务本身。
    });
    child.unref();
  } catch {
    // 忽略打开浏览器时的异常。
  }
}

/**
 * @param {string[]} argv
 * @returns {{ noOpen: boolean }}
 */
export function parseCliOptions(argv) {
  const options = { noOpen: false };
  for (const arg of argv) {
    if (arg === '--no-open') {
      options.noOpen = true;
    } else {
      throw new Error('未知参数：' + arg);
    }
  }
  return options;
}

/**
 * 启动入口：监听 127.0.0.1、打印唯一的就绪行、按需打开浏览器。
 * @param {string[]} [argv]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<http.Server>}
 */
export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseCliOptions(argv);
  const basePort = parsePort(env.ASTRA_PORT);
  const configStore = createConfigStore({ configPath: resolveConfigPath(env) });
  const server = createAppServer({ configStore });
  const port = await listenWithFallback(server, basePort);
  const url = 'http://' + HOST + ':' + port;
  process.stdout.write('ASTRA_READY ' + url + '\n');
  const noOpen = options.noOpen || env.ASTRA_NO_OPEN === '1';
  if (!noOpen) {
    openBrowser(url);
  }
  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(
      '[astra-test] ' + (error && error.message ? error.message : String(error)) + '\n'
    );
    process.exitCode = 1;
  });
}
