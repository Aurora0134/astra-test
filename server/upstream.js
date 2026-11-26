export const DEFAULT_TIMEOUT_MS = 600000;

/**
 * 推理强度降级阶梯：从配置档位开始逐级尝试，最后一级为不发送该字段（null）。
 */
export const REASONING_LADDER = {
  none: ['none', 'minimal', null],
  medium: ['medium', null],
  high: ['high', null],
  xhigh: ['xhigh', null],
  max: ['max', null]
};

const RETRYABLE_STATUS = new Set([400, 422]);
const EFFORT_REJECTION_PATTERN = /reasoning|effort|thinking|unsupported|invalid/i;
const ERROR_DETAIL_LIMIT = 500;
const JSON_BODY_READ_LIMIT = 5 * 1024 * 1024;

/**
 * 整体超时；环境变量 ASTRA_TIMEOUT_MS 可覆盖。
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
export function resolveTimeoutMs(env = process.env) {
  const raw = env.ASTRA_TIMEOUT_MS;
  if (typeof raw !== 'string' || !raw.trim()) {
    return DEFAULT_TIMEOUT_MS;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.floor(value);
}

/**
 * 对话补全地址：去尾部斜杠；已以 /chat/completions 结尾则原样使用。
 * @param {string} base
 * @returns {string}
 */
export function endpoint(base) {
  const trimmed = String(base == null ? '' : base).trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(trimmed)) {
    return trimmed;
  }
  return trimmed + '/chat/completions';
}

/**
 * 模型列表地址：去尾部斜杠；已以 /chat/completions 结尾则替换为 /models。
 * @param {string} base
 * @returns {string}
 */
export function modelsUrl(base) {
  const trimmed = String(base == null ? '' : base).trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(trimmed)) {
    return trimmed.replace(/\/chat\/completions$/i, '/models');
  }
  return trimmed + '/models';
}

/**
 * 从上游模型列表响应中提取 id，去重并保持顺序。
 * @param {unknown} data
 * @returns {string[]}
 */
export function extractModelIds(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.data)) {
    return [];
  }
  const seen = new Set();
  const ids = [];
  for (const item of data.data) {
    if (item && typeof item.id === 'string' && item.id && !seen.has(item.id)) {
      seen.add(item.id);
      ids.push(item.id);
    }
  }
  return ids;
}

function createAbortContext(externalSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => {
    controller.abort();
  };
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }
  }
  return {
    signal: controller.signal,
    isTimedOut: () => timedOut,
    isExternalAborted: () => Boolean(externalSignal && externalSignal.aborted),
    dispose: () => {
      clearTimeout(timer);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onAbort);
      }
    }
  };
}

function classifyFetchFailure(context, error) {
  if (context.isExternalAborted()) {
    return { code: 'aborted', message: '请求已中止', status: null, detail: null };
  }
  if (context.isTimedOut()) {
    return { code: 'timeout', message: '上游响应超时', status: null, detail: null };
  }
  if (error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return { code: 'aborted', message: '请求已中止', status: null, detail: null };
  }
  return {
    code: 'network_error',
    message: '无法连接上游服务，请检查服务地址与网络',
    status: null,
    detail: null
  };
}

function truncateText(value, limit) {
  const text = typeof value === 'string' ? value : '';
  return text.length <= limit ? text : text.slice(0, limit);
}

function textOfContent(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    let result = '';
    for (const part of value) {
      if (typeof part === 'string') {
        result += part;
      } else if (part && typeof part.text === 'string') {
        result += part.text;
      }
    }
    return result;
  }
  return '';
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return null;
  }
  const pick = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  return {
    prompt_tokens: pick(usage.prompt_tokens),
    completion_tokens: pick(usage.completion_tokens),
    total_tokens: pick(usage.total_tokens)
  };
}

async function readTextSafe(response, limit) {
  try {
    const text = await response.text();
    return text.length <= limit ? text : text.slice(0, limit);
  } catch {
    return '';
  }
}

/**
 * 读取并解析 SSE 流；思考内容只统计字符数，不进入正文。
 * @param {Response} response
 * @param {{ onText: (text: string) => void, onReasoning: (text: string) => void, onUsage: (usage: object) => void }} handlers
 */
async function consumeSse(response, handlers) {
  if (!response.body) {
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let dataLines = [];
  let finished = false;

  const handlePayload = (payload) => {
    if (payload.trim() === '[DONE]') {
      finished = true;
      return;
    }
    let data;
    try {
      data = JSON.parse(payload);
    } catch {
      return;
    }
    if (!data || typeof data !== 'object') {
      return;
    }
    const choice = Array.isArray(data.choices) ? data.choices[0] : null;
    const delta = choice && choice.delta ? choice.delta : null;
    const message = choice && choice.message ? choice.message : null;
    const content = textOfContent(delta && delta.content) || textOfContent(message && message.content) || textOfContent(choice && choice.text);
    if (content) {
      handlers.onText(content);
    }
    const reasoning = textOfContent(delta && delta.reasoning_content) ||
      textOfContent(delta && delta.reasoning) ||
      textOfContent(message && message.reasoning_content) ||
      textOfContent(message && message.reasoning);
    if (reasoning) {
      handlers.onReasoning(reasoning);
    }
    const usage = normalizeUsage(data.usage);
    if (usage) {
      handlers.onUsage(usage);
    }
  };

  const consumeLine = (line) => {
    if (line === '') {
      if (dataLines.length > 0) {
        const payload = dataLines.join('\n');
        dataLines = [];
        handlePayload(payload);
      }
      return;
    }
    if (line.startsWith(':')) {
      return;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }
    if (field === 'data') {
      dataLines.push(value);
    }
  };

  try {
    while (!finished) {
      const chunk = await reader.read();
      if (chunk.value) {
        buffer += decoder.decode(chunk.value, { stream: true });
      }
      let newlineIndex;
      while (!finished && (newlineIndex = buffer.indexOf('\n')) !== -1) {
        let line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.endsWith('\r')) {
          line = line.slice(0, -1);
        }
        consumeLine(line);
      }
      if (chunk.done) {
        buffer += decoder.decode();
        if (buffer.length > 0) {
          consumeLine(buffer);
          buffer = '';
        }
        if (!finished && dataLines.length > 0) {
          const payload = dataLines.join('\n');
          dataLines = [];
          handlePayload(payload);
        }
        break;
      }
    }
  } finally {
    if (finished) {
      try {
        await reader.cancel();
      } catch {
        // 流已结束时取消失败可以忽略。
      }
    } else {
      reader.releaseLock();
    }
  }
}

/**
 * 代理上游模型列表；HTTP 状态恒为 200，错误放在返回值里。
 * @param {{ baseUrl: string, apiKey: string, timeoutMs?: number, signal?: AbortSignal, fetchImpl?: typeof fetch }} options
 * @returns {Promise<{ ok: true, models: string[] } | { ok: false, error: { code: string, message: string } }>}
 */
export async function fetchModels({
  baseUrl,
  apiKey,
  timeoutMs = resolveTimeoutMs(),
  signal,
  fetchImpl = fetch
} = {}) {
  const base = typeof baseUrl === 'string' ? baseUrl.trim() : '';
  if (!base) {
    return { ok: false, error: { code: 'missing_base_url', message: '尚未配置服务地址' } };
  }
  if (!apiKey) {
    return { ok: false, error: { code: 'missing_api_key', message: '尚未配置 API Key' } };
  }
  const context = createAbortContext(signal, timeoutMs);
  try {
    const response = await fetchImpl(modelsUrl(base), {
      method: 'GET',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        Accept: 'application/json'
      },
      signal: context.signal
    });
    const bodyText = await readTextSafe(response, JSON_BODY_READ_LIMIT);
    if (!response.ok) {
      return {
        ok: false,
        error: { code: 'upstream_error', message: '上游模型列表请求失败（HTTP ' + response.status + '）' }
      };
    }
    let data;
    try {
      data = JSON.parse(bodyText);
    } catch {
      data = null;
    }
    return { ok: true, models: extractModelIds(data) };
  } catch (error) {
    if (context.isTimedOut()) {
      return { ok: false, error: { code: 'timeout', message: '上游模型列表请求超时' } };
    }
    if (context.isExternalAborted()) {
      return { ok: false, error: { code: 'upstream_error', message: '请求已中止' } };
    }
    if (error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      return { ok: false, error: { code: 'timeout', message: '上游模型列表请求超时' } };
    }
    return { ok: false, error: { code: 'upstream_error', message: '无法连接上游服务，请检查服务地址与网络' } };
  } finally {
    context.dispose();
  }
}

/**
 * 执行一次对话补全并把事件交给调用方（start / delta / done / error）。
 * @param {{
 *   baseUrl: string,
 *   apiKey: string,
 *   model?: string,
 *   reasoningEffort?: string,
 *   prompt: string,
 *   testId?: string,
 *   signal?: AbortSignal,
 *   timeoutMs?: number,
 *   onEvent?: (event: object) => void,
 *   fetchImpl?: typeof fetch
 * }} options
 * @returns {Promise<{ ok: boolean, code?: string, text?: string, usage?: object | null, effortSent?: string | null, degraded?: boolean, reasoningChars?: number }>}
 */
export async function runTest(options = {}) {
  const {
    baseUrl,
    apiKey,
    model: requestedModel,
    reasoningEffort: requestedEffort = 'high',
    prompt,
    testId = null,
    signal,
    timeoutMs = resolveTimeoutMs(),
    onEvent = () => {},
    fetchImpl = fetch
  } = options;

  const startedAt = Date.now();
  const reasoningEffort = Object.hasOwn(REASONING_LADDER, requestedEffort) ? requestedEffort : 'high';
  const ladder = REASONING_LADDER[reasoningEffort];
  const context = createAbortContext(signal, timeoutMs);
  const emit = (event) => {
    try {
      onEvent(event);
    } catch {
      // 事件消费者自身异常不应中断上游读取。
    }
  };
  const fail = (code, message, status = null, detail = null) => {
    emit({ type: 'error', code, message, status, detail });
    return { ok: false, code };
  };

  try {
    let model = typeof requestedModel === 'string' ? requestedModel.trim() : '';
    if (!model) {
      const list = await fetchModels({ baseUrl, apiKey, timeoutMs, signal: context.signal, fetchImpl });
      if (!list.ok || list.models.length === 0) {
        const message = list.ok
          ? '上游未返回可用模型，请手动填写模型名称'
          : '未配置模型，且无法获取上游模型列表：' + list.error.message;
        return fail('missing_model', message, null, null);
      }
      model = list.models[0];
    }

    emit({ type: 'start', testId, model, reasoningEffort });

    let text = '';
    let usage = null;
    let reasoningChars = 0;
    let lastRejectionStatus = null;
    let sent = null;
    let degraded = false;

    for (let index = 0; index < ladder.length; index += 1) {
      const effort = ladder[index];
      const payload = {
        model,
        messages: [{ role: 'user', content: typeof prompt === 'string' ? prompt : String(prompt == null ? '' : prompt) }],
        stream: true
      };
      if (effort !== null) {
        payload.reasoning_effort = effort;
      }

      let response;
      try {
        response = await fetchImpl(endpoint(baseUrl), {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + apiKey,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream'
          },
          body: JSON.stringify(payload),
          signal: context.signal
        });
      } catch (error) {
        const failure = classifyFetchFailure(context, error);
        return fail(failure.code, failure.message, failure.status, failure.detail);
      }

      if (!response.ok) {
        const bodyText = await readTextSafe(response, JSON_BODY_READ_LIMIT);
        if (
          RETRYABLE_STATUS.has(response.status) &&
          EFFORT_REJECTION_PATTERN.test(bodyText) &&
          index < ladder.length - 1
        ) {
          lastRejectionStatus = response.status;
          degraded = true;
          continue;
        }
        return fail(
          'upstream_error',
          '上游请求失败（HTTP ' + response.status + '）',
          response.status,
          truncateText(bodyText, ERROR_DETAIL_LIMIT) || null
        );
      }

      sent = effort;
      degraded = index > 0;
      text = '';
      usage = null;
      reasoningChars = 0;

      try {
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('text/event-stream')) {
          await consumeSse(response, {
            onText: (chunk) => {
              text += chunk;
              emit({ type: 'delta', text: chunk });
            },
            onReasoning: (chunk) => {
              reasoningChars += chunk.length;
            },
            onUsage: (value) => {
              usage = value;
            }
          });
        } else {
          const bodyText = await readTextSafe(response, JSON_BODY_READ_LIMIT);
          let data;
          try {
            data = JSON.parse(bodyText);
          } catch {
            return fail(
              'upstream_error',
              '上游返回了无法解析的响应',
              response.status,
              truncateText(bodyText, ERROR_DETAIL_LIMIT) || null
            );
          }
          const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
          const content = textOfContent(choice && choice.message && choice.message.content) || textOfContent(choice && choice.text);
          if (content) {
            text = content;
            emit({ type: 'delta', text: content });
          }
          usage = normalizeUsage(data && data.usage);
        }
      } catch (error) {
        const failure = classifyFetchFailure(context, error);
        return fail(failure.code, failure.message, failure.status, failure.detail);
      }

      if (!text) {
        return fail('empty_response', '上游未返回任何正文内容', response.status, null);
      }

      const degradedReason = degraded
        ? '上游拒绝推理强度 ' + reasoningEffort + '（HTTP ' + lastRejectionStatus + '），已' + (sent === null ? '改为不发送该参数' : '降级为 ' + sent)
        : null;

      emit({
        type: 'done',
        testId,
        text,
        durationMs: Date.now() - startedAt,
        usage: usage || null,
        model,
        reasoningEffort,
        effortSent: sent,
        degraded,
        degradedReason
      });
      return { ok: true, text, usage, effortSent: sent, degraded, reasoningChars };
    }

    return fail('upstream_error', '上游拒绝了所有推理强度参数', lastRejectionStatus, null);
  } finally {
    context.dispose();
  }
}
