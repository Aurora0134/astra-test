import { spawn, spawnSync } from 'node:child_process';

/** DPAPI 不可用（非 Windows 或 powershell.exe 不可执行）。 */
export const DPAPI_UNAVAILABLE = 'dpapi_unavailable';
/** 加密失败。 */
export const DPAPI_PROTECT_FAILED = 'dpapi_protect_failed';
/** 解密失败（密文损坏、来自其他用户或机器等）。 */
export const DPAPI_UNPROTECT_FAILED = 'dpapi_unprotect_failed';
/** 调用 powershell.exe 超时。 */
export const DPAPI_TIMEOUT = 'dpapi_timeout';

const POWERSHELL = 'powershell.exe';
const CALL_TIMEOUT_MS = 15000;
const ENTROPY_TEXT = 'astra-test';

/**
 * 以原样字符串传入 -Command；数据一律走 stdin/stdout 的 base64，不进入进程参数。
 * PowerShell 5.1 与 7.x 均可执行。
 */
const PROTECT_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName System.Security',
  '$raw=[Console]::In.ReadToEnd()',
  '$bytes=[Convert]::FromBase64String($raw.Trim())',
  `$entropy=[Text.Encoding]::UTF8.GetBytes('${ENTROPY_TEXT}')`,
  '$cipher=[System.Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($cipher))'
].join('; ');

const UNPROTECT_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName System.Security',
  '$raw=[Console]::In.ReadToEnd()',
  '$bytes=[Convert]::FromBase64String($raw.Trim())',
  `$entropy=[Text.Encoding]::UTF8.GetBytes('${ENTROPY_TEXT}')`,
  '$plain=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($plain))'
].join('; ');

/** DPAPI 相关错误，code 用于区分不可用、加密失败、解密失败与超时。 */
export class DpapiError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'DpapiError';
    this.code = code;
  }
}

let availabilityCache = null;

/**
 * 当前机器是否能调用 Windows DPAPI（同步探测，结果缓存）。
 * @returns {boolean}
 */
export function isAvailable() {
  if (process.platform !== 'win32') {
    return false;
  }
  if (availabilityCache !== null) {
    return availabilityCache;
  }
  const probe = spawnSync(
    POWERSHELL,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', 'exit 0'],
    { windowsHide: true, timeout: 10000 }
  );
  availabilityCache = !probe.error && probe.status === 0;
  return availabilityCache;
}

/**
 * DPAPI 加密。返回密文 Buffer。
 * @param {string} plainText
 * @returns {Promise<Buffer>}
 */
export async function protect(plainText) {
  if (typeof plainText !== 'string') {
    throw new TypeError('protect 的入参必须是字符串');
  }
  ensureAvailable();
  const input = Buffer.from(plainText, 'utf8').toString('base64');
  const output = await runPowerShell(PROTECT_SCRIPT, input, DPAPI_PROTECT_FAILED, 'DPAPI 加密失败');
  return Buffer.from(output, 'base64');
}

/**
 * DPAPI 解密（CurrentUser 作用域）。接受密文 Buffer 或 base64 字符串。
 * @param {Buffer | string} cipher
 * @returns {Promise<string>}
 */
export async function unprotect(cipher) {
  if (!Buffer.isBuffer(cipher) && typeof cipher !== 'string') {
    throw new TypeError('unprotect 的入参必须是 Buffer 或 base64 字符串');
  }
  ensureAvailable();
  const input = Buffer.isBuffer(cipher) ? cipher.toString('base64') : cipher;
  const output = await runPowerShell(UNPROTECT_SCRIPT, input, DPAPI_UNPROTECT_FAILED, 'DPAPI 解密失败');
  return Buffer.from(output, 'base64').toString('utf8');
}

function ensureAvailable() {
  if (!isAvailable()) {
    throw new DpapiError(DPAPI_UNAVAILABLE, '当前系统不支持 DPAPI 加密存储');
  }
}

/**
 * @param {string} script
 * @param {string} input
 * @param {string} code
 * @param {string} message
 * @returns {Promise<string>}
 */
function runPowerShell(script, input, code, message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    /** @param {Error} error */
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    /** @param {string} value */
    const succeed = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const child = spawn(
      POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const timer = setTimeout(() => {
      child.kill();
      fail(new DpapiError(DPAPI_TIMEOUT, 'DPAPI 调用超时'));
    }, CALL_TIMEOUT_MS);

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      fail(new DpapiError(code, message, { cause: error }));
    });
    child.on('close', (exitCode) => {
      if (settled) return;
      const output = stdout.trim();
      if (exitCode === 0 && output) {
        succeed(output);
        return;
      }
      // PowerShell 的 stderr 编码随系统代码页变化，只作为内部诊断字段保留，不拼进用户可见文案。
      const error = new DpapiError(code, message + '（退出码 ' + exitCode + '）');
      error.detail = stderr.trim().slice(0, 300);
      fail(error);
    });

    child.stdin.end(input);
  });
}
