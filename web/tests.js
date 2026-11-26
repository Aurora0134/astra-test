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

// 问答项的关键词判定配置：口径来自产品定义，逐条对应一条用户规则。
export const KEYWORD_MODES = Object.freeze({
  SEQUENCE: 'sequence',
  CHARACTERS: 'characters'
});

// 问答 A 的约定问候语，字符逐字固定（含全角波浪线、∠、・、ω、⌒、☆ 与括号内的半角空格）。
export const CIALLO_KEYWORD = 'Ciallo～(∠・ω< )⌒☆';

// 问答 C 的约定姓名。
export const PRIME_MINISTER_KEYWORD = '高市早苗';

// 问答 B 要求同时出现的三个字，不要求连续，也不要求成词。
export const DINGDONG_CHARACTERS = Object.freeze(['大', '狗', '叫']);

// 只有问答 A 的两段式匹配容忍空白差异；问答 C 按原文包含判断。
const CIALLO_EXPECTATION = Object.freeze({
  mode: KEYWORD_MODES.SEQUENCE,
  keyword: CIALLO_KEYWORD,
  ignoreWhitespace: true
});

const DINGDONG_EXPECTATION = Object.freeze({
  mode: KEYWORD_MODES.CHARACTERS,
  characters: DINGDONG_CHARACTERS
});

const PRIME_MINISTER_EXPECTATION = Object.freeze({
  mode: KEYWORD_MODES.SEQUENCE,
  keyword: PRIME_MINISTER_KEYWORD,
  ignoreWhitespace: false
});

export const TESTS = Object.freeze([
  Object.freeze({ id: 'pelican', title: '鹈鹕测试', kind: 'svg', prompt: PELICAN_PROMPT }),
  Object.freeze({ id: 'candy', title: '糖果测试', kind: 'candy', prompt: CANDY_PROMPT }),
  Object.freeze({ id: 'a', title: '问答 A · ciallo', kind: 'text', prompt: 'ciallo', expect: CIALLO_EXPECTATION }),
  Object.freeze({ id: 'b', title: '问答 B · 叮咚鸡', kind: 'text', prompt: '叮咚鸡', expect: DINGDONG_EXPECTATION }),
  Object.freeze({ id: 'c', title: '问答 C · 现任日本首相', kind: 'text', prompt: '仅凭你的记忆，直接回答现在的日本首相是谁', expect: PRIME_MINISTER_EXPECTATION })
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

// 去掉全部空白字符（含全角空格、制表符、换行），供忽略空白差异的匹配使用。
export function stripWhitespace(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\s+/g, '');
}

// 关键词命中判断，只按配置的规则判定，不做任何字面归一化（不做大小写、全半角、繁简转换）。
// sequence：包含判断；ignoreWhitespace 为真时，未命中再对「去掉全部空白」的两侧做包含判断。
// characters：要求每个字都出现，不要求连续、不要求成词。
export function matchesExpectation(text, expectation) {
  if (typeof text !== 'string' || text === '') return false;
  const expect = expectation || null;
  if (!expect) return false;
  if (expect.mode === KEYWORD_MODES.CHARACTERS) {
    const characters = Array.isArray(expect.characters) ? expect.characters : [];
    if (characters.length === 0) return false;
    return characters.every(function (character) {
      return typeof character === 'string' && character !== '' && text.indexOf(character) !== -1;
    });
  }
  const keyword = typeof expect.keyword === 'string' ? expect.keyword : '';
  if (keyword === '') return false;
  if (text.indexOf(keyword) !== -1) return true;
  if (expect.ignoreWhitespace !== true) return false;
  const compactKeyword = stripWhitespace(keyword);
  if (compactKeyword === '') return false;
  return stripWhitespace(text).indexOf(compactKeyword) !== -1;
}

// 问答项判定：命中为通过，未命中为未通过。正文为空属于输出异常，由 resolveStatus 先行拦截。
export function judgeKeywordAnswer(text, expectation) {
  return matchesExpectation(text, expectation) ? STATUS.PASS : STATUS.FAIL;
}

// 单项结束后的判定。svg 类型由调用方给出渲染结果，避免本模块依赖 DOM。
// text 类型传入 expect 时按关键词规则判通过/未通过；空正文与请求失败仍是输出异常。
export function resolveStatus(kind, outcome, expectation) {
  const result = outcome || {};
  if (result.failed) return STATUS.ANOMALY;
  if (kind === 'candy') return judgeCandyAnswer(result.text);
  if (kind === 'svg') return result.svgRendered === true ? STATUS.OK : STATUS.ANOMALY;
  const text = typeof result.text === 'string' ? result.text : '';
  if (text.trim() === '') return STATUS.ANOMALY;
  if (expectation) return judgeKeywordAnswer(text, expectation);
  return STATUS.OK;
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
