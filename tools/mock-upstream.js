import http from 'node:http';
import { pathToFileURL } from 'node:url';

export const DEFAULT_PORT = 8799;
export const MOCK_MODELS = ['mock-model-a', 'mock-model-b'];
const MODES = new Set(['good', 'bad-svg', 'wrong-candy', 'empty']);
const REASONING_TEXT = '【模拟思考】先判断提示词类型，再组织回答。';
const BODY_LIMIT = 1024 * 1024;
const CHUNK_SIZE = 120;
const CHUNK_DELAY_MS = 8;

export const PELICAN_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 220" width="320" height="220" role="img" aria-label="鹈鹕骑自行车动画">',
  '  <defs>',
  '    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">',
  '      <stop offset="0" stop-color="#dff1ff"/>',
  '      <stop offset="1" stop-color="#f7fcff"/>',
  '    </linearGradient>',
  '  </defs>',
  '  <rect width="320" height="220" fill="url(#sky)"/>',
  '  <ellipse cx="160" cy="204" rx="150" ry="10" fill="#c9dff2"/>',
  '  <g stroke-linecap="round" stroke-linejoin="round">',
  '    <g>',
  '      <circle cx="95" cy="160" r="34" fill="none" stroke="#33475b" stroke-width="6"/>',
  '      <g>',
  '        <animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0 95 160" to="360 95 160" dur="1.4s" repeatCount="indefinite"/>',
  '        <line x1="95" y1="126" x2="95" y2="194" stroke="#8aa4bb" stroke-width="2"/>',
  '        <line x1="61" y1="160" x2="129" y2="160" stroke="#8aa4bb" stroke-width="2"/>',
  '        <line x1="71" y1="136" x2="119" y2="184" stroke="#8aa4bb" stroke-width="2"/>',
  '        <line x1="119" y1="136" x2="71" y2="184" stroke="#8aa4bb" stroke-width="2"/>',
  '      </g>',
  '    </g>',
  '    <g>',
  '      <circle cx="225" cy="160" r="34" fill="none" stroke="#33475b" stroke-width="6"/>',
  '      <g>',
  '        <animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0 225 160" to="360 225 160" dur="1.4s" repeatCount="indefinite"/>',
  '        <line x1="225" y1="126" x2="225" y2="194" stroke="#8aa4bb" stroke-width="2"/>',
  '        <line x1="191" y1="160" x2="259" y2="160" stroke="#8aa4bb" stroke-width="2"/>',
  '        <line x1="201" y1="136" x2="249" y2="184" stroke="#8aa4bb" stroke-width="2"/>',
  '        <line x1="249" y1="136" x2="201" y2="184" stroke="#8aa4bb" stroke-width="2"/>',
  '      </g>',
  '    </g>',
  '    <line x1="95" y1="160" x2="160" y2="158" stroke="#e2603c" stroke-width="5"/>',
  '    <line x1="160" y1="158" x2="150" y2="120" stroke="#e2603c" stroke-width="5"/>',
  '    <line x1="150" y1="120" x2="210" y2="112" stroke="#e2603c" stroke-width="5"/>',
  '    <line x1="210" y1="112" x2="225" y2="160" stroke="#e2603c" stroke-width="5"/>',
  '    <line x1="160" y1="158" x2="225" y2="160" stroke="#c94e2f" stroke-width="4"/>',
  '    <line x1="150" y1="120" x2="95" y2="160" stroke="#c94e2f" stroke-width="4"/>',
  '    <line x1="210" y1="112" x2="216" y2="98" stroke="#33475b" stroke-width="4"/>',
  '    <line x1="208" y1="96" x2="230" y2="96" stroke="#33475b" stroke-width="4"/>',
  '    <line x1="150" y1="120" x2="144" y2="110" stroke="#33475b" stroke-width="4"/>',
  '    <line x1="132" y1="108" x2="156" y2="108" stroke="#33475b" stroke-width="6"/>',
  '    <g>',
  '      <animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0 160 158" to="360 160 158" dur="1.4s" repeatCount="indefinite"/>',
  '      <line x1="148" y1="158" x2="172" y2="158" stroke="#33475b" stroke-width="3"/>',
  '      <circle cx="160" cy="158" r="5" fill="#33475b"/>',
  '      <circle cx="148" cy="158" r="4" fill="#33475b"/>',
  '      <circle cx="172" cy="158" r="4" fill="#33475b"/>',
  '    </g>',
  '    <g>',
  '      <animateTransform attributeName="transform" attributeType="XML" type="translate" values="0 0; 0 -3; 0 0" dur="1.4s" repeatCount="indefinite"/>',
  '      <line x1="158" y1="128" x2="150" y2="152" stroke="#e8a33d" stroke-width="4"/>',
  '      <line x1="170" y1="128" x2="174" y2="152" stroke="#e8a33d" stroke-width="4"/>',
  '      <path d="M146 154 l8 -4 l2 6 z" fill="#e8a33d"/>',
  '      <path d="M170 154 l8 -4 l2 6 z" fill="#e8a33d"/>',
  '      <ellipse cx="162" cy="102" rx="32" ry="22" fill="#fdf6e8" stroke="#d9c9a8" stroke-width="2"/>',
  '      <path d="M132 96 l-12 -6 l4 12 z" fill="#f2e4c8" stroke="#d9c9a8" stroke-width="1.5"/>',
  '      <path d="M182 90 C 196 82, 198 70, 204 62 L 214 66 C 208 78, 206 88, 192 102 Z" fill="#fdf6e8" stroke="#d9c9a8" stroke-width="2"/>',
  '      <circle cx="208" cy="62" r="12" fill="#fdf6e8" stroke="#d9c9a8" stroke-width="2"/>',
  '      <circle cx="212" cy="59" r="2.2" fill="#33475b"/>',
  '      <path d="M218 60 L 252 66 L 220 72 Z" fill="#f0a63a" stroke="#cf8620" stroke-width="1.5"/>',
  '      <path d="M221 68 L 246 68" stroke="#cf8620" stroke-width="1.5"/>',
  '      <g>',
  '        <animateTransform attributeName="transform" attributeType="XML" type="rotate" values="-6 168 100; 8 168 100; -6 168 100" dur="0.7s" repeatCount="indefinite"/>',
  '        <path d="M150 94 C 166 84, 184 88, 190 100 C 178 110, 160 110, 150 102 Z" fill="#e8dcc0" stroke="#d9c9a8" stroke-width="2"/>',
  '      </g>',
  '    </g>',
  '  </g>',
  '</svg>'
].join('\n');

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        finish({ ok: false });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        finish(value && typeof value === 'object' && !Array.isArray(value) ? { ok: true, value } : { ok: false });
      } catch {
        finish({ ok: false });
      }
    });
    req.on('error', () => finish({ ok: false }));
  });
}

/**
 * 按提示词特征返回对应内容，便于前后端联调时覆盖 5 个测试项。
 * @param {{ prompt: string, mode: string }} options
 * @returns {string}
 */
export function buildContent({ prompt, mode }) {
  if (mode === 'empty') {
    return '';
  }
  if (/鹈鹕|pelican/i.test(prompt)) {
    if (mode === 'bad-svg') {
      return '本轮未能生成图形内容，请稍后重试。';
    }
    return PELICAN_SVG;
  }
  if (/袋子里有三种口味的糖|摸糖|糖果/.test(prompt)) {
    return mode === 'wrong-candy' ? '23' : '21';
  }
  if (/ciallo/i.test(prompt)) {
    return 'ciallo 是二次元社区常见的轻松问候语，用于打招呼。';
  }
  if (/叮咚鸡/.test(prompt)) {
    return '叮咚鸡是中文互联网上的谐音流行语，常用来制造节奏感。';
  }
  if (/日本首相/.test(prompt)) {
    return '仅凭记忆，现任日本首相来自日本主要执政党；该信息可能随政局变化，请以最新公开信息为准。';
  }
  return '这是本地 mock 上游的示例回复：' + prompt.slice(0, 40);
}

function splitChunks(text, size) {
  const chunks = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

async function streamCompletion(res, { model, content, prompt }) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  let closed = false;
  res.on('close', () => {
    closed = true;
  });
  const send = (payload) => {
    if (!closed && !res.destroyed) {
      res.write('data: ' + JSON.stringify(payload) + '\n\n');
    }
  };
  const sendRaw = (text) => {
    if (!closed && !res.destroyed) {
      res.write('data: ' + text + '\n\n');
    }
  };

  send({
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    model,
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]
  });
  send({
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    model,
    choices: [{ index: 0, delta: { reasoning_content: REASONING_TEXT }, finish_reason: null }]
  });

  for (const piece of splitChunks(content, CHUNK_SIZE)) {
    if (closed) break;
    send({
      id: 'chatcmpl-mock',
      object: 'chat.completion.chunk',
      model,
      choices: [{ index: 0, delta: { content: piece }, finish_reason: null }]
    });
    await delay(CHUNK_DELAY_MS);
  }

  const completionTokens = Math.ceil(content.length / 4);
  send({
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    model,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: Math.ceil(prompt.length / 4),
      completion_tokens: completionTokens,
      total_tokens: Math.ceil(prompt.length / 4) + completionTokens
    }
  });
  sendRaw('[DONE]');
  if (!closed) {
    res.end();
  }
}

/**
 * @param {{ mode?: string, rejectEffort?: boolean }} [options]
 * @returns {http.Server}
 */
export function createMockUpstream(options = {}) {
  const mode = options.mode || 'good';
  const rejectEffort = Boolean(options.rejectEffort);
  return http.createServer((req, res) => {
    const pathname = (req.url || '/').split('?')[0];
    if (req.method === 'GET' && /\/models$/i.test(pathname)) {
      if (!req.headers.authorization) {
        sendJson(res, 401, { error: { message: 'Missing Authorization header', type: 'invalid_request_error' } });
        return;
      }
      sendJson(res, 200, {
        object: 'list',
        data: MOCK_MODELS.map((id) => ({ id, object: 'model', owned_by: 'mock-upstream' }))
      });
      return;
    }
    if (req.method === 'POST' && /\/chat\/completions$/i.test(pathname)) {
      if (!req.headers.authorization) {
        sendJson(res, 401, { error: { message: 'Missing Authorization header', type: 'invalid_request_error' } });
        return;
      }
      readJsonBody(req).then((result) => {
        if (!result.ok) {
          sendJson(res, 400, { error: { message: 'invalid JSON body', type: 'invalid_request_error' } });
          return;
        }
        const body = result.value;
        if (rejectEffort && Object.hasOwn(body, 'reasoning_effort')) {
          sendJson(res, 400, {
            error: {
              message: 'reasoning_effort is not supported by this model',
              type: 'invalid_request_error',
              code: 'unsupported_parameter'
            }
          });
          return;
        }
        const messages = Array.isArray(body.messages) ? body.messages : [];
        const prompt = messages
          .map((message) => (message && typeof message.content === 'string' ? message.content : ''))
          .join('\n');
        const content = buildContent({ prompt, mode });
        const model = typeof body.model === 'string' && body.model ? body.model : MOCK_MODELS[0];
        streamCompletion(res, { model, content, prompt }).catch(() => {
          if (!res.destroyed) {
            res.destroy();
          }
        });
      });
      return;
    }
    sendJson(res, 404, { error: { message: 'not found', type: 'invalid_request_error' } });
  });
}

/**
 * @param {string[]} argv
 * @returns {{ port: number, mode: string, rejectEffort: boolean }}
 */
export function parseArgs(argv) {
  const options = { port: DEFAULT_PORT, mode: 'good', rejectEffort: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--port') {
      const value = argv[index + 1];
      index += 1;
      const port = Number(value);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error('--port 必须是 0-65535 之间的整数');
      }
      options.port = port;
    } else if (arg === '--mode') {
      const value = argv[index + 1];
      index += 1;
      if (!MODES.has(value)) {
        throw new Error('--mode 必须是 good、bad-svg、wrong-candy、empty 之一');
      }
      options.mode = value;
    } else if (arg === '--reject-effort') {
      options.rejectEffort = true;
    } else {
      throw new Error('未知参数：' + arg);
    }
  }
  return options;
}

/**
 * @param {http.Server} server
 * @param {number} port
 */
function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const server = createMockUpstream(options);
  await listen(server, options.port);
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : options.port;
  process.stdout.write('ASTRA_MOCK_READY http://127.0.0.1:' + port + '\n');
  return server;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    process.stderr.write('[mock-upstream] ' + (error && error.message ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  });
}
