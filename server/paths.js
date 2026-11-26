import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根目录（server/ 的上一级）。 */
export const repoRoot = path.resolve(serverDir, '..');
/** 前端静态资源目录。 */
export const webDir = path.join(repoRoot, 'web');
/** 本地 mock 上游脚本路径。 */
export const mockUpstreamScript = path.join(repoRoot, 'tools', 'mock-upstream.js');

/**
 * 解析配置目录：优先 %APPDATA%\astra-test，APPDATA 缺失时回落到用户主目录下的 .astra-test。
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveConfigDir(env = process.env) {
  const appData = typeof env.APPDATA === 'string' ? env.APPDATA.trim() : '';
  if (appData) {
    return path.join(appData, 'astra-test');
  }
  return path.join(os.homedir(), '.astra-test');
}

/**
 * 配置文件绝对路径。
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveConfigPath(env = process.env) {
  return path.join(resolveConfigDir(env), 'config.json');
}
