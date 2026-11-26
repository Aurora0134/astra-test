// 结果区：5 张测试卡的构建、状态更新与判定高光。

import {
  TESTS,
  STATUS,
  STATUS_LABELS,
  CANDY_EXPECTED,
  highlightForStatus,
  extractCandyAnswer,
  judgeKeywordAnswer,
  effortLabel,
  formatDuration,
  formatTokens
} from './tests.js';
import { renderSvgInto } from './sanitize.js';

// 推理强度的展示文案：降级时注明实际发送值，未降级只显示配置档位。
export function formatEffortMeta(done) {
  if (!done || typeof done.reasoningEffort !== 'string' || done.reasoningEffort === '') return '';
  const level = effortLabel(done.reasoningEffort);
  if (done.degraded !== true) return '推理强度 ' + level;
  const sent = typeof done.effortSent === 'string' ? done.effortSent.trim() : '';
  if (sent !== '') return '推理强度 ' + level + '（已降级·实际发送 ' + sent + '）';
  return '推理强度 ' + level + '（已降级·未发送该参数）';
}

// 问答项的判定文案，与糖果卡使用同一句式和同一套配色语义。
export function describeKeywordVerdict(passed) {
  return passed ? '判定：通过' : '判定：未通过';
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (typeof text === 'string') node.textContent = text;
  return node;
}

export function createResultBoard(options) {
  const settings = options || {};
  const root = settings.root;
  if (!root) throw new Error('缺少结果区容器。');
  const onRetest = typeof settings.onRetest === 'function' ? settings.onRetest : function () {};
  const cards = new Map();

  function buildCard(test) {
    const node = element('article', 'result-card');
    node.dataset.test = test.id;
    node.dataset.status = STATUS.IDLE;
    node.dataset.highlight = 'none';

    const head = element('header', 'card-head');
    const heading = element('div', 'card-heading');
    const title = element('h3', 'card-title', test.title);
    const badge = element('span', 'status-badge', STATUS_LABELS.idle);
    badge.setAttribute('role', 'status');
    heading.appendChild(title);
    heading.appendChild(badge);
    const meta = element('p', 'card-meta', '尚未测试');
    head.appendChild(heading);
    head.appendChild(meta);
    node.appendChild(head);

    const promptBlock = element('div', 'prompt-block');
    promptBlock.appendChild(element('span', 'prompt-label', '提示词原文'));
    promptBlock.appendChild(element('pre', 'prompt-text', test.prompt));
    node.appendChild(promptBlock);

    const answer = element('div', 'answer-area');
    answer.appendChild(element('p', 'answer-placeholder', '等待测试。'));
    node.appendChild(answer);

    const rawBlock = element('details', 'raw-block');
    rawBlock.appendChild(element('summary', 'raw-summary', '原始输出'));
    const rawText = element('pre', 'raw-text', '');
    rawBlock.appendChild(rawText);
    node.appendChild(rawBlock);

    const actions = element('div', 'card-actions');
    const retestButton = element('button', 'btn btn-ghost btn-small', '重新测试');
    retestButton.type = 'button';
    retestButton.addEventListener('click', function () {
      onRetest(test.id);
    });
    actions.appendChild(retestButton);
    node.appendChild(actions);

    return {
      test: test,
      node: node,
      badge: badge,
      meta: meta,
      answer: answer,
      rawBlock: rawBlock,
      rawText: rawText,
      retestButton: retestButton,
      state: { status: STATUS.IDLE, text: '', metaInfo: { model: '', effort: '' } }
    };
  }

  TESTS.forEach(function (test) {
    cards.set(test.id, buildCard(test));
  });
  root.replaceChildren.apply(root, Array.from(cards.values()).map(function (card) { return card.node; }));

  function setStatus(card, status) {
    card.state.status = status;
    card.node.dataset.status = status;
    card.node.dataset.highlight = highlightForStatus(status);
    card.badge.textContent = STATUS_LABELS[status] || STATUS_LABELS.idle;
  }

  function setMeta(card, done) {
    const parts = [];
    if (done && typeof done.model === 'string' && done.model !== '') parts.push('模型 ' + done.model);
    const effortText = formatEffortMeta(done);
    if (effortText !== '') parts.push(effortText);
    if (done && Number.isFinite(done.durationMs)) parts.push('耗时 ' + formatDuration(done.durationMs));
    const tokens = done ? formatTokens(done.usage) : '';
    if (tokens !== '') parts.push('Token ' + tokens);
    card.meta.textContent = parts.length > 0 ? parts.join(' · ') : '测试完成';
    if (done && done.degraded && typeof done.degradedReason === 'string' && done.degradedReason !== '') {
      card.meta.title = done.degradedReason;
    } else {
      card.meta.removeAttribute('title');
    }
  }

  function resetCard(card) {
    card.state.text = '';
    card.state.status = STATUS.IDLE;
    card.state.metaInfo = { model: '', effort: '' };
    card.node.dataset.status = STATUS.IDLE;
    card.node.dataset.highlight = 'none';
    card.badge.textContent = STATUS_LABELS.idle;
    card.meta.textContent = '尚未测试';
    card.meta.removeAttribute('title');
    card.answer.replaceChildren(element('p', 'answer-placeholder', '等待测试。'));
    card.rawText.textContent = '';
    card.rawBlock.open = false;
    card.node.classList.remove('is-streaming');
  }

  function begin(testId) {
    const card = cards.get(testId);
    if (!card) return;
    resetCard(card);
    setStatus(card, STATUS.RUNNING);
    card.meta.textContent = '正在请求上游…';
    card.answer.replaceChildren(element('p', 'answer-placeholder', '正在接收输出…'));
  }

  function applyStart(testId, event) {
    const card = cards.get(testId);
    if (!card || !event) return;
    card.state.metaInfo = {
      model: typeof event.model === 'string' ? event.model : '',
      effort: typeof event.reasoningEffort === 'string' ? event.reasoningEffort : ''
    };
    const parts = [];
    if (typeof event.model === 'string' && event.model !== '') parts.push('模型 ' + event.model);
    if (typeof event.reasoningEffort === 'string' && event.reasoningEffort !== '') {
      parts.push('推理强度 ' + effortLabel(event.reasoningEffort));
    }
    if (parts.length > 0) card.meta.textContent = parts.join(' · ') + ' · 进行中';
  }

  function append(testId, text) {
    const card = cards.get(testId);
    if (!card || typeof text !== 'string' || text === '') return;
    card.state.text += text;
    card.node.classList.add('is-streaming');
    card.rawText.textContent = card.state.text;
    if (card.test.kind === 'svg') {
      card.answer.replaceChildren(element('p', 'answer-placeholder', '正在接收 SVG 输出，已接收 ' + card.state.text.length + ' 个字符…'));
      return;
    }
    card.answer.replaceChildren(element('pre', 'answer-stream', card.state.text));
  }

  function buildCandyAnswer(value, passed) {
    const wrapper = element('div', 'candy-answer');
    const compare = element('div', 'candy-compare');
    compare.appendChild(element('span', 'candy-value', value === null ? '—' : String(value)));
    compare.appendChild(element('span', 'candy-expected', '期望值 ' + CANDY_EXPECTED));
    wrapper.appendChild(compare);
    const verdict = element('p', 'candy-verdict', passed ? '判定：通过' : '判定：未通过');
    verdict.dataset.tone = passed ? 'pass' : 'fail';
    wrapper.appendChild(verdict);
    if (!passed) {
      wrapper.appendChild(element('p', 'answer-hint', value === null ? '答案中未包含可识别的数字。' : '答案数字与期望值不一致。'));
    }
    return wrapper;
  }

  // 问答卡的答案区：正文原文 + 判定行；未通过时补一句规则说明。
  function buildKeywordAnswer(text, passed) {
    const wrapper = element('div', 'candy-answer');
    wrapper.appendChild(element('pre', 'answer-text', text));
    const verdict = element('p', 'candy-verdict', describeKeywordVerdict(passed));
    verdict.dataset.tone = passed ? 'pass' : 'fail';
    wrapper.appendChild(verdict);
    if (!passed) {
      wrapper.appendChild(element('p', 'answer-hint', '答案未满足该项判定规则。'));
    }
    return wrapper;
  }

  function complete(testId, done) {
    const card = cards.get(testId);
    if (!card) return;
    const payload = done || {};
    const text = typeof payload.text === 'string' && payload.text !== '' ? payload.text : card.state.text;
    card.state.text = text;
    card.rawText.textContent = text;
    setMeta(card, payload);
    if (card.test.kind === 'svg') {
      const stage = element('div', 'svg-stage');
      const rendered = renderSvgInto(stage, text);
      if (rendered.ok) {
        card.answer.replaceChildren(stage);
        setStatus(card, STATUS.OK);
      } else {
        card.answer.replaceChildren(element('p', 'answer-note answer-note--warn', rendered.reason), element('p', 'answer-hint', '可在原始输出中查看上游返回内容。'));
        setStatus(card, STATUS.ANOMALY);
        card.rawBlock.open = true;
      }
    } else if (card.test.kind === 'candy') {
      const value = extractCandyAnswer(text);
      const passed = value === CANDY_EXPECTED;
      card.answer.replaceChildren(buildCandyAnswer(value, passed));
      setStatus(card, passed ? STATUS.PASS : STATUS.FAIL);
    } else if (text.trim() === '') {
      card.answer.replaceChildren(element('p', 'answer-note answer-note--warn', '上游未返回正文。'));
      setStatus(card, STATUS.ANOMALY);
      card.rawBlock.open = true;
    } else if (card.test.expect) {
      const passed = judgeKeywordAnswer(text, card.test.expect) === STATUS.PASS;
      card.answer.replaceChildren(buildKeywordAnswer(text, passed));
      setStatus(card, passed ? STATUS.PASS : STATUS.FAIL);
    } else {
      card.answer.replaceChildren(element('pre', 'answer-text', text));
      setStatus(card, STATUS.OK);
    }
    card.node.classList.remove('is-streaming');
  }

  function fail(testId, messageText) {
    const card = cards.get(testId);
    if (!card) return;
    const text = typeof messageText === 'string' && messageText !== '' ? messageText : '测试失败。';
    const metaParts = [];
    if (card.state.metaInfo.model !== '') metaParts.push('模型 ' + card.state.metaInfo.model);
    if (card.state.metaInfo.effort !== '') metaParts.push('推理强度 ' + effortLabel(card.state.metaInfo.effort));
    metaParts.push(text.indexOf('已停止') !== -1 ? '已停止' : '测试失败');
    card.meta.textContent = metaParts.join(' · ');
    card.meta.removeAttribute('title');
    setStatus(card, STATUS.ANOMALY);
    card.answer.replaceChildren(element('p', 'answer-note answer-note--warn', text));
    card.rawText.textContent = card.state.text;
    card.node.classList.remove('is-streaming');
    if (card.state.text !== '') card.rawBlock.open = true;
  }

  function resetAll() {
    cards.forEach(resetCard);
  }

  function getStatuses() {
    return Array.from(cards.values()).map(function (card) { return card.state.status; });
  }

  // 重新测试按卡片独立启用：只有该卡自身在跑时才不可用。
  function setRetestEnabled(isEnabled) {
    const check = typeof isEnabled === 'function'
      ? isEnabled
      : function () { return Boolean(isEnabled); };
    cards.forEach(function (card) {
      card.retestButton.disabled = !check(card.test.id, card.state.status);
    });
  }

  return {
    begin: begin,
    applyStart: applyStart,
    append: append,
    complete: complete,
    fail: fail,
    resetAll: resetAll,
    getStatuses: getStatuses,
    setRetestEnabled: setRetestEnabled
  };
}
