// 页面编排：串行执行 5 项测试、停止、清除结果与进度文案。

import { TESTS, STATUS } from './tests.js';
import { runTest } from './api.js';
import { createConfigPanel } from './config.js';
import { createResultBoard } from './results.js';

const startButton = document.getElementById('start-run');
const stopButton = document.getElementById('stop-run');
const clearButton = document.getElementById('clear-results');
const progressLabel = document.getElementById('run-progress');
const configRoot = document.getElementById('config-card');
const cardsRoot = document.getElementById('result-cards');

const TERMINAL_MESSAGES = {
  timeout: '请求超时。',
  network_error: '网络连接异常。',
  missing_model: '上游未提供可用模型。',
  aborted: '已停止测试。',
  empty_response: '上游返回空内容。'
};

let busy = false;
let stopRequested = false;
let controller = null;
let configState = { ready: false, reason: '正在读取配置。' };
let idleWaiters = [];

const board = createResultBoard({
  root: cardsRoot,
  onRetest: function (testId) {
    retest(testId);
  }
});

createConfigPanel({
  root: configRoot,
  onStateChange: function (state) {
    configState = state;
    syncControls();
  }
});

function describeError(event) {
  const payload = event || {};
  let message = typeof payload.message === 'string' && payload.message !== ''
    ? payload.message
    : (TERMINAL_MESSAGES[payload.code] || '测试失败。');
  if (Number.isFinite(payload.status) && payload.status > 0 && message.indexOf(String(payload.status)) === -1) {
    message = message.replace(/。$/, '') + '（状态码 ' + payload.status + '）。';
  }
  return message;
}

function updateProgress() {
  const statuses = board.getStatuses();
  const completed = statuses.filter(function (status) {
    return status !== STATUS.IDLE && status !== STATUS.RUNNING;
  }).length;
  progressLabel.textContent = '已完成 ' + completed + ' / ' + TESTS.length;
}

function syncControls() {
  startButton.disabled = busy || !configState.ready;
  stopButton.disabled = !busy;
  board.setRetestEnabled(!busy && configState.ready);
  updateProgress();
}

function waitForIdle() {
  if (!busy) return Promise.resolve();
  return new Promise(function (resolve) {
    idleWaiters.push(resolve);
  });
}

function flushIdleWaiters() {
  const waiters = idleWaiters;
  idleWaiters = [];
  waiters.forEach(function (resolve) { resolve(); });
}

async function runOne(testId) {
  const test = TESTS.find(function (item) { return item.id === testId; });
  if (!test) return;
  controller = new AbortController();
  board.begin(testId);
  updateProgress();
  let terminal = null;
  try {
    terminal = await runTest({
      testId: test.id,
      prompt: test.prompt,
      signal: controller.signal,
      onEvent: function (event) {
        if (!event || typeof event !== 'object') return;
        if (event.type === 'start') board.applyStart(testId, event);
        else if (event.type === 'delta') board.append(testId, event.text || '');
      }
    });
    if (terminal && terminal.type === 'done') board.complete(testId, terminal);
    else if (terminal && terminal.type === 'error') board.fail(testId, describeError(terminal));
    else board.fail(testId, '测试连接中断，未能收到完整结果。');
  } catch (error) {
    if (error && error.code === 'aborted') board.fail(testId, '已停止测试。');
    else board.fail(testId, error && error.message ? error.message : '请求失败，请重试。');
  } finally {
    controller = null;
    updateProgress();
  }
}

async function startSequence() {
  if (busy || !configState.ready) return;
  busy = true;
  stopRequested = false;
  syncControls();
  try {
    for (let index = 0; index < TESTS.length; index += 1) {
      if (stopRequested) break;
      await runOne(TESTS[index].id);
    }
  } finally {
    busy = false;
    stopRequested = false;
    controller = null;
    syncControls();
    flushIdleWaiters();
  }
}

async function retest(testId) {
  if (busy || !configState.ready) return;
  busy = true;
  stopRequested = false;
  syncControls();
  try {
    await runOne(testId);
  } finally {
    busy = false;
    stopRequested = false;
    controller = null;
    syncControls();
    flushIdleWaiters();
  }
}

function stopRun() {
  if (!busy) return;
  stopRequested = true;
  if (controller) controller.abort();
  syncControls();
}

async function clearResults() {
  if (busy) {
    stopRequested = true;
    if (controller) controller.abort();
    await waitForIdle();
  }
  board.resetAll();
  updateProgress();
  syncControls();
}

startButton.addEventListener('click', startSequence);
stopButton.addEventListener('click', stopRun);
clearButton.addEventListener('click', clearResults);

syncControls();
