// 测试项定义与纯函数判定，页面与 Node 用例共用。
// 提示词为契约原文，逐字保留，不得改动。

export const CANDY_EXPECTED = 21;

export const PELICAN_PROMPT = '用SVG画一只鹈鹕骑自行车的2d动画，只返回SVG code';

export const CANDY_PROMPT = [
  '袋子里有三种口味的糖——苹果、桃子、西瓜。每种口味又有两种形状，圆形和五角星。摸糖的时候，形状靠手感就能分辨。',
  '',
  '不同口味和形状的数量如下。',
  '',
  '苹果\t桃子\t西瓜',
  '圆形\t7\t9\t8',
  '五角星\t7\t6\t4',
  '',
  '问题是：最少取多少颗，能保证手里同时有一组「圆形苹果 + 五角星桃子」或者「五角星苹果 + 圆形桃子」？',
  '',
  '直接回答数字，禁止输出任何其他内容'
].join('\n');

export const TESTS = Object.freeze([
  Object.freeze({ id: 'pelican', title: '鹈鹕测试', kind: 'svg', prompt: PELICAN_PROMPT }),
  Object.freeze({ id: 'candy', title: '糖果测试', kind: 'candy', prompt: CANDY_PROMPT }),
  Object.freeze({ id: 'a', title: '问答 A · ciallo', kind: 'text', prompt: 'ciallo' }),
  Object.freeze({ id: 'b', title: '问答 B · 叮咚鸡', kind: 'text', prompt: '叮咚鸡' }),
  Object.freeze({ id: 'c', title: '问答 C · 现任日本首相', kind: 'text', prompt: '仅凭你的记忆，直接回答现在的日本首相是谁' })
]);

export const REASONING_EFFORTS = Object.freeze([
  Object.freeze({ value: 'none', label: '无（不思考）' }),
  Object.freeze({ value: 'medium', label: 'medium' }),
  Object.freeze({ value: 'high', label: 'high' }),
  Object.freeze({ value: 'xhigh', label: 'xhigh' }),
  Object.freeze({ value: 'max', label: 'max' })
]);

export function effortLabel(value) {
  const found = REASONING_EFFORTS.find(function (effort) { return effort.value === value; });
  return found ? found.label : String(value || '');
}

export function getTest(testId) {
  return TESTS.find(function (test) { return test.id === testId; }) || null;
}

export const STATUS = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  PASS: 'pass',
  FAIL: 'fail',
  OK: 'ok',
  ANOMALY: 'anomaly'
});

export const STATUS_LABELS = Object.freeze({
  idle: '待测试',
  running: '测试中',
  pass: '通过',
  fail: '未通过',
  ok: '已返回',
  anomaly: '输出异常'
});

const HIGHLIGHT_BY_STATUS = Object.freeze({
  idle: 'none',
  running: 'none',
  pass: 'pass',
  fail: 'fail',
  ok: 'none',
  anomaly: 'anomaly'
});

// 状态到卡片外框高光的映射：绿 / 红 / 黄，其余无高光。
export function highlightForStatus(status) {
  return HIGHLIGHT_BY_STATUS[status] || 'none';
}

function normalizeDigits(text) {
  return text.replace(/[０-９]/g, function (character) {
    return String(character.charCodeAt(0) - 0xFF10);
  });
}

// 从模型输出中提取糖果题的答案数字；取首个数字，识别不到返回 null。
export function extractCandyAnswer(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const matches = normalizeDigits(text).match(/\d+/g);
  if (!matches || matches.length === 0) return null;
  const value = Number.parseInt(matches[0], 10);
  return Number.isFinite(value) ? value : null;
}

export function judgeCandyAnswer(text) {
  return extractCandyAnswer(text) === CANDY_EXPECTED ? STATUS.PASS : STATUS.FAIL;
}

// 单项结束后的判定。svg 类型由调用方给出渲染结果，避免本模块依赖 DOM。
export function resolveStatus(kind, outcome) {
  const result = outcome || {};
  if (result.failed) return STATUS.ANOMALY;
  if (kind === 'candy') return judgeCandyAnswer(result.text);
  if (kind === 'svg') return result.svgRendered === true ? STATUS.OK : STATUS.ANOMALY;
  return typeof result.text === 'string' && result.text.trim() !== '' ? STATUS.OK : STATUS.ANOMALY;
}

export function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '';
  if (milliseconds < 1000) return Math.round(milliseconds) + ' 毫秒';
  const seconds = milliseconds / 1000;
  if (seconds < 60) return seconds.toFixed(1) + ' 秒';
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return minutes + ' 分 ' + String(rest).padStart(2, '0') + ' 秒';
}

export function formatTokens(usage) {
  if (!usage || typeof usage !== 'object') return '';
  if (!Number.isFinite(usage.total_tokens)) return '';
  return String(usage.total_tokens);
}
