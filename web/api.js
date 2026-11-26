// 与本地服务通信的客户端：配置读写、模型列表、测试流式请求。

import { REASONING_EFFORTS } from './tests.js';

const EFFORT_VALUES = REASONING_EFFORTS.map(function (effort) { return effort.value; });

const HTTP_MESSAGES = {
  400: '请求内容不合法，请检查配置。',
  401: '上游拒绝了本次访问，请检查 API Key。',
  403: '请求被拒绝。',
  404: '请求的地址不存在。',
  500: '本地服务发生错误，请稍后重试。'
};

export class ApiError extends Error {
  constructor(code, message, status, detail) {
    super(message);
    this.name = 'ApiError';
    this.code = code || 'unknown_error';
    this.status = Number.isFinite(status) ? status : 0;
    this.detail = typeof detail === 'string' ? detail : '';
  }
}

function fallbackHttpMessage(status) {
  return HTTP_MESSAGES[status] || '请求失败（状态码 ' + status + '）。';
}

async function requestJson(path, options) {
  let response;
  try {
    response = await fetch(path, options);
  } catch (error) {
    throw new ApiError('network_error', '无法连接本地服务，请确认程序仍在运行。');
  }
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  let body = null;
  if (contentType.indexOf('application/json') !== -1) {
    try {
      body = await response.json();
    } catch (error) {
      body = null;
    }
  }
  if (!response.ok) {
    const payload = body && typeof body === 'object' ? body.error : null;
    const code = payload && payload.code ? payload.code : 'http_' + response.status;
    const message = payload && payload.message ? payload.message : fallbackHttpMessage(response.status);
    throw new ApiError(code, message, response.status, payload && payload.detail);
  }
  if (body === null) throw new ApiError('invalid_response', '服务返回了无法识别的响应内容。', response.status);
  return body;
}

export function normalizeConfig(value) {
  const source = value && typeof value === 'object' ? value : {};
  const effort = typeof source.reasoningEffort === 'string' ? source.reasoningEffort : 'high';
  return {
    baseUrl: typeof source.baseUrl === 'string' ? source.baseUrl : '',
    model: typeof source.model === 'string' ? source.model : '',
    reasoningEffort: EFFORT_VALUES.indexOf(effort) === -1 ? 'high' : effort,
    hasApiKey: source.hasApiKey === true,
    apiKeyHint: typeof source.apiKeyHint === 'string' ? source.apiKeyHint : '',
    storage: source.storage === 'unavailable' ? 'unavailable' : 'dpapi'
  };
}

export async function loadConfig() {
  const body = await requestJson('/api/config', { method: 'GET', headers: { Accept: 'application/json' } });
  return normalizeConfig(body);
}

export async function saveConfig(payload) {
  const body = await requestJson('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload)
  });
  return normalizeConfig(body);
}

export async function clearConfig() {
  await requestJson('/api/config', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
  });
}

export async function loadModels() {
  const body = await requestJson('/api/models', { method: 'GET', headers: { Accept: 'application/json' } });
  if (!body || body.ok !== true) {
    const payload = body && typeof body === 'object' ? body.error : null;
    throw new ApiError(
      payload && payload.code ? payload.code : 'upstream_error',
      payload && payload.message ? payload.message : '获取模型列表失败。'
    );
  }
  const models = Array.isArray(body.models) ? body.models : [];
  return models.filter(function (id) { return typeof id === 'string' && id !== ''; });
}

// 逐块解析 text/event-stream：按空行切分事件，只消费 data 行。
export function createSseParser(onEvent) {
  let buffer = '';
  let closed = false;

  function dispatch(block) {
    const dataLines = [];
    block.split(/\r?\n/).forEach(function (line) {
      if (line.charAt(0) === ':') return;
      if (line.indexOf('data:') === 0) dataLines.push(line.slice(5).replace(/^ /, ''));
    });
    if (dataLines.length === 0) return;
    let parsed = null;
    try {
      parsed = JSON.parse(dataLines.join('\n'));
    } catch (error) {
      return;
    }
    if (parsed && typeof parsed === 'object') onEvent(parsed);
  }

  return {
    push(text) {
      if (closed || typeof text !== 'string' || text === '') return;
      buffer += text;
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop();
      blocks.forEach(dispatch);
    },
    flush() {
      if (closed) return;
      if (buffer.trim() !== '') dispatch(buffer);
      buffer = '';
    },
    close() {
      closed = true;
      buffer = '';
    },
    isClosed() {
      return closed;
    }
  };
}

// 执行单个测试项，返回终止事件（done 或 error）。
export async function runTest(options) {
  const settings = options || {};
  let response;
  try {
    response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ testId: settings.testId, prompt: settings.prompt }),
      signal: settings.signal
    });
  } catch (error) {
    if (error && error.name === 'AbortError') throw new ApiError('aborted', '已停止测试。');
    throw new ApiError('network_error', '无法连接本地服务，请确认程序仍在运行。');
  }
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!response.ok) {
    let body = null;
    if (contentType.indexOf('application/json') !== -1) {
      try {
        body = await response.json();
      } catch (error) {
        body = null;
      }
    }
    const payload = body && typeof body === 'object' ? body.error : null;
    throw new ApiError(
      payload && payload.code ? payload.code : 'upstream_error',
      payload && payload.message ? payload.message : fallbackHttpMessage(response.status),
      response.status,
      payload && payload.detail
    );
  }
  if (contentType.indexOf('text/event-stream') === -1 || !response.body) {
    throw new ApiError('invalid_response', '服务返回了无法识别的响应格式。');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let terminal = null;
  const parser = createSseParser(function (event) {
    if (event.type === 'done' || event.type === 'error') terminal = event;
    if (typeof settings.onEvent === 'function') settings.onEvent(event);
  });
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      parser.push(decoder.decode(chunk.value, { stream: true }));
      chunk = await reader.read();
    }
    parser.push(decoder.decode());
    parser.flush();
  } catch (error) {
    if (error && error.name === 'AbortError') throw new ApiError('aborted', '已停止测试。');
    throw new ApiError('network_error', '测试连接中断，未能收到完整结果。');
  } finally {
    try {
      reader.releaseLock();
    } catch (error) {
      // 读取器已释放时无需处理。
    }
  }
  if (!terminal) throw new ApiError('network_error', '测试连接中断，未能收到完整结果。');
  return terminal;
}
