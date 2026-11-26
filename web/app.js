// 页面编排：五项测试并行发起，各自可中止；进度按已完成数递增。

import { TESTS } from './tests.js';
import { runTest } from './api.js';
import { createConfigPanel } from './config.js';
import { createResultBoard } from './results.js';
import { countCompleted, createRunCoordinator } from './runner.js';

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

let configState = { ready: false, reason: '正在读取配置。' };

const board = createResultBoard({
  root: cardsRoot,
  onRetest: function (testId) {
    coordinator.runOne(testId);
  }
});

const coordinator = createRunCoordinator({
  tests: TESTS,
  execute: runTestJob,
  onChange: function () {
    syncControls();
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
  progressLabel.textContent = '已完成 ' + countCompleted(board.getStatuses()) + ' / ' + TESTS.length;
}

function syncControls() {
  const running = coordinator.hasActiveRuns();
  startButton.disabled = running || !configState.ready;
  stopButton.disabled = !running;
  // 重新测试按卡片独立判断：该卡自己在跑时才不可用，其它卡的状态不影响它。
  board.setRetestEnabled(function (testId) {
    return configState.ready && !coordinator.isRunning(testId);
  });
  updateProgress();
}

async function runTestJob(job) {
  const test = TESTS.find(function (item) { return item.id === job.testId; });
  if (!test) throw new Error('未知的测试项。');
  board.begin(test.id);
  updateProgress();
  let terminal = null;
  try {
    terminal = await runTest({
      testId: test.id,
      prompt: test.prompt,
      signal: job.signal,
      onEvent: function (event) {
        if (!event || typeof event !== 'object') return;
        if (event.type === 'start') board.applyStart(test.id, event);
        else if (event.type === 'delta') board.append(test.id, event.text || '');
      }
    });
    if (terminal && terminal.type === 'done') board.complete(test.id, terminal);
    else if (terminal && terminal.type === 'error') board.fail(test.id, describeError(terminal));
    else board.fail(test.id, '测试连接中断，未能收到完整结果。');
  } catch (error) {
    if (error && error.code === 'aborted') board.fail(test.id, '已停止测试。');
    else board.fail(test.id, error && error.message ? error.message : '请求失败，请重试。');
  } finally {
    updateProgress();
  }
}

function startRun() {
  if (!configState.ready || coordinator.hasActiveRuns()) return;
  coordinator.runAll();
}

function stopRun() {
  if (!coordinator.hasActiveRuns()) return;
  coordinator.stopAll();
  syncControls();
}

async function clearResults() {
  if (coordinator.hasActiveRuns()) {
    coordinator.stopAll();
    await coordinator.whenIdle();
  }
  board.resetAll();
  updateProgress();
  syncControls();
}

startButton.addEventListener('click', startRun);
stopButton.addEventListener('click', stopRun);
clearButton.addEventListener('click', clearResults);

syncControls();
