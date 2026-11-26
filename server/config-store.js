import fsp from 'node:fs/promises';
import path from 'node:path';
import * as defaultDpapi from './dpapi.js';

export const CONFIG_VERSION = 1;
export const REASONING_EFFORTS = ['none', 'medium', 'high', 'xhigh', 'max'];
export const DEFAULT_REASONING_EFFORT = 'high';

/** 配置层的可预期错误，携带机器码与建议的 HTTP 状态。 */
export class ConfigError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {number} [status]
   * @param {{ cause?: unknown }} [options]
   */
  constructor(code, message, status = 400, options = {}) {
    super(message, options);
    this.name = 'ConfigError';
    this.code = code;
    this.status = status;
  }
}

/**
 * 服务地址归一化：去首尾空白，空串表示未配置，非空必须是可解析的 http/https 地址，并去掉末尾斜杠。
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeBaseUrl(value) {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value !== 'string') {
    throw new ConfigError('invalid_body', '服务地址必须是文本');
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new ConfigError('invalid_base_url', '服务地址必须以 http:// 或 https:// 开头');
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ConfigError('invalid_base_url', '服务地址无法解析为有效网址');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConfigError('invalid_base_url', '服务地址必须以 http:// 或 https:// 开头');
  }
  return trimmed.replace(/\/+$/, '');
}

/**
 * 推理强度归一化；缺省视为 high，其余必须落在枚举内。
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeReasoningEffort(value) {
  if (value === undefined || value === null) {
    return DEFAULT_REASONING_EFFORT;
  }
  if (typeof value !== 'string' || !REASONING_EFFORTS.includes(value)) {
    throw new ConfigError('invalid_reasoning_effort', '推理强度必须是 none、medium、high、xhigh、max 之一');
  }
  return value;
}

function normalizeModel(value) {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value !== 'string') {
    throw new ConfigError('invalid_body', '模型名称必须是文本');
  }
  return value.trim();
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeStoredApiKey(value) {
  if (isPlainObject(value) && value.scheme === 'dpapi' && typeof value.blob === 'string' && value.blob) {
    return { scheme: 'dpapi', scope: 'CurrentUser', blob: value.blob };
  }
  return null;
}

function normalizeStoredRecord(data) {
  if (!isPlainObject(data)) {
    return null;
  }
  return {
    version: Number.isInteger(data.version) ? data.version : CONFIG_VERSION,
    baseUrl: typeof data.baseUrl === 'string' ? data.baseUrl : '',
    model: typeof data.model === 'string' ? data.model : '',
    reasoningEffort: REASONING_EFFORTS.includes(data.reasoningEffort)
      ? data.reasoningEffort
      : DEFAULT_REASONING_EFFORT,
    apiKey: normalizeStoredApiKey(data.apiKey),
    apiKeyHint: typeof data.apiKeyHint === 'string' ? data.apiKeyHint : ''
  };
}

/**
 * 配置文件存储。读取时不解密 API Key，只有真正发请求前才调用 getApiKey() 解密。
 */
export class ConfigStore {
  /**
   * @param {{ configPath: string, dpapi?: typeof defaultDpapi, now?: () => Date }} options
   */
  constructor({ configPath, dpapi = defaultDpapi, now = () => new Date() }) {
    this.configPath = configPath;
    this.dpapi = dpapi;
    this.now = now;
  }

  /**
   * @returns {Promise<object | null>}
   */
  async readRecord() {
    let raw;
    try {
      raw = await fsp.readFile(this.configPath, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
    return normalizeStoredRecord(data);
  }

  /**
   * 对外快照，绝不包含明文 Key。
   * @param {object | null} [record]
   */
  toPublic(record) {
    const storage = this.dpapi.isAvailable() ? 'dpapi' : 'unavailable';
    if (!record) {
      return {
        baseUrl: '',
        model: '',
        reasoningEffort: DEFAULT_REASONING_EFFORT,
        hasApiKey: false,
        apiKeyHint: '',
        storage,
        configPath: this.configPath
      };
    }
    return {
      baseUrl: record.baseUrl,
      model: record.model,
      reasoningEffort: record.reasoningEffort,
      hasApiKey: Boolean(record.apiKey && record.apiKey.blob),
      apiKeyHint: record.apiKeyHint,
      storage,
      configPath: this.configPath
    };
  }

  /** @returns {Promise<object>} */
  async getSnapshot() {
    return this.toPublic(await this.readRecord());
  }

  /**
   * 保存配置并返回对外快照。
   * @param {unknown} input 已解析的 JSON 对象
   * @returns {Promise<object>}
   */
  async save(input) {
    if (!isPlainObject(input)) {
      throw new ConfigError('invalid_body', '请求体必须是 JSON 对象');
    }
    const current = await this.readRecord();
    const baseUrl = normalizeBaseUrl(Object.hasOwn(input, 'baseUrl') ? input.baseUrl : '');
    const model = normalizeModel(Object.hasOwn(input, 'model') ? input.model : '');
    const reasoningEffort = normalizeReasoningEffort(input.reasoningEffort);

    let apiKey = current ? current.apiKey : null;
    let apiKeyHint = current ? current.apiKeyHint : '';
    if (Object.hasOwn(input, 'apiKey')) {
      const value = input.apiKey;
      if (typeof value !== 'string') {
        throw new ConfigError('invalid_body', 'API Key 必须是文本');
      }
      if (value === '') {
        apiKey = null;
        apiKeyHint = '';
      } else {
        if (!this.dpapi.isAvailable()) {
          throw new ConfigError('dpapi_unavailable', '当前系统不支持 DPAPI 加密存储，无法保存 API Key', 503);
        }
        let cipher;
        try {
          cipher = await this.dpapi.protect(value);
        } catch (error) {
          throw new ConfigError('dpapi_encrypt_failed', '当前系统无法完成 API Key 加密，请稍后重试', 500, {
            cause: error
          });
        }
        apiKey = {
          scheme: 'dpapi',
          scope: 'CurrentUser',
          blob: Buffer.isBuffer(cipher) ? cipher.toString('base64') : String(cipher)
        };
        // 短 Key 的末 4 位可能等于完整明文，此时不写提示尾号。
        apiKeyHint = value.length > 8 ? value.slice(-4) : '';
      }
    }

    const record = {
      version: CONFIG_VERSION,
      baseUrl,
      model,
      reasoningEffort,
      apiKey,
      apiKeyHint,
      updatedAt: this.now().toISOString()
    };
    await this.writeRecord(record);
    return this.toPublic(record);
  }

  /**
   * 解密并返回已保存的 API Key；未保存时为 null。
   * @returns {Promise<string | null>}
   */
  async getApiKey() {
    const record = await this.readRecord();
    if (!record || !record.apiKey || !record.apiKey.blob) {
      return null;
    }
    if (!this.dpapi.isAvailable()) {
      throw new ConfigError('dpapi_unavailable', '已保存的 API Key 无法在当前系统解密，请重新配置', 503);
    }
    try {
      return await this.dpapi.unprotect(Buffer.from(record.apiKey.blob, 'base64'));
    } catch (error) {
      throw new ConfigError('dpapi_decrypt_failed', '已保存的 API Key 无法解密，请重新配置', 500, {
        cause: error
      });
    }
  }

  /** 删除配置文件。 */
  async clear() {
    await fsp.rm(this.configPath, { force: true });
  }

  /**
   * 原子写入：先写同目录临时文件，再重命名覆盖。
   * @param {object} record
   */
  async writeRecord(record) {
    const directory = path.dirname(this.configPath);
    await fsp.mkdir(directory, { recursive: true });
    const temporaryPath = this.configPath + '.tmp-' + process.pid + '-' + Date.now();
    const body = JSON.stringify(record, null, 2) + '\n';
    await fsp.writeFile(temporaryPath, body, 'utf8');
    try {
      await fsp.rename(temporaryPath, this.configPath);
    } catch (error) {
      await fsp.rm(temporaryPath, { force: true });
      throw error;
    }
  }
}

/**
 * @param {{ configPath: string, dpapi?: typeof defaultDpapi, now?: () => Date }} options
 * @returns {ConfigStore}
 */
export function createConfigStore(options) {
  return new ConfigStore(options);
}
