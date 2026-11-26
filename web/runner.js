// 并行编排：五项测试各自持有独立的中止器，进度按已完成数统计。
// 本模块不触碰 DOM，只保留可被 Node 用例直接覆盖的并发逻辑。

import { STATUS } from './tests.js';

// 进度只统计已有结果的卡片；待测试与测试中的卡都不计入。
export function countCompleted(statuses) {
  if (!Array.isArray(statuses)) return 0;
  return statuses.filter(function (status) {
    return status !== STATUS.IDLE && status !== STATUS.RUNNING;
  }).length;
}

// 创建并行编排器。execute 由调用方提供：接收 { testId, signal }，负责单次请求与渲染。
export function createRunCoordinator(options) {
  const settings = options || {};
  const tests = Array.isArray(settings.tests) ? settings.tests : [];
  const execute = typeof settings.execute === 'function' ? settings.execute : null;
  const onChange = typeof settings.onChange === 'function' ? settings.onChange : function () {};
  if (!execute) throw new Error('缺少测试执行函数。');

  const active = new Map();
  let idleWaiters = [];

  function isRunning(testId) {
    return active.has(testId);
  }

  function hasActiveRuns() {
    return active.size > 0;
  }

  function activeCount() {
    return active.size;
  }

  function flushIdleWaiters() {
    if (active.size > 0) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    waiters.forEach(function (resolve) { resolve(); });
  }

  function whenIdle() {
    if (active.size === 0) return Promise.resolve();
    return new Promise(function (resolve) {
      idleWaiters.push(resolve);
    });
  }

  // 同一张卡同时只允许一个在跑请求：重复发起直接返回，不打断已有请求。
  async function runOne(testId) {
    if (active.has(testId)) return { testId: testId, started: false };
    const controller = new AbortController();
    active.set(testId, controller);
    onChange();
    let result;
    let failure = null;
    let aborted = false;
    try {
      result = await execute({ testId: testId, signal: controller.signal });
    } catch (error) {
      failure = error || new Error('测试执行失败。');
      aborted = controller.signal.aborted || Boolean(failure && failure.code === 'aborted');
    } finally {
      if (active.get(testId) === controller) active.delete(testId);
      onChange();
      flushIdleWaiters();
    }
    return {
      testId: testId,
      started: true,
      ok: failure === null,
      aborted: aborted,
      result: result,
      error: failure
    };
  }

  // 五项同时发起，不等待任何一项结束；单项失败不中断其它项。
  function runAll() {
    return Promise.all(tests.map(function (test) { return runOne(test.id); }));
  }

  // 中止当前全部在跑项（含单卡重测），返回被中止的数量。
  function stopAll() {
    const controllers = Array.from(active.values());
    controllers.forEach(function (controller) { controller.abort(); });
    return controllers.length;
  }

  return {
    runOne: runOne,
    runAll: runAll,
    stopAll: stopAll,
    whenIdle: whenIdle,
    isRunning: isRunning,
    hasActiveRuns: hasActiveRuns,
    activeCount: activeCount
  };
}
