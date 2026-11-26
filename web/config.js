// 顶置配置卡：字段绑定、校验、保存、清空与状态行。

import { REASONING_EFFORTS } from './tests.js';
import { loadConfig, saveConfig, clearConfig, loadModels } from './api.js';

// 开始测试的前置条件：配置已保存、无未保存修改、已填服务地址与 API Key。
export function evaluateConfigState(state) {
  const current = state || {};
  const saved = current.saved;
  if (!saved) return { ready: false, reason: '正在读取配置。' };
  if (saved.storage === 'unavailable') return { ready: false, reason: '当前系统不支持加密存储，配置无法保存。' };
  if (current.dirty) return { ready: false, reason: '配置有未保存的修改，请先保存。' };
  if (!saved.baseUrl) return { ready: false, reason: '尚未填写服务地址。' };
  if (!saved.hasApiKey) return { ready: false, reason: '尚未配置 API Key。' };
  return { ready: true, reason: '' };
}

export function createConfigPanel(options) {
  const settings = options || {};
  const root = settings.root;
  if (!root) throw new Error('缺少配置卡容器。');
  const onChange = typeof settings.onStateChange === 'function' ? settings.onStateChange : function () {};

  const form = root.querySelector('form');
  const baseUrlInput = root.querySelector('#base-url');
  const apiKeyInput = root.querySelector('#api-key');
  const toggleKeyButton = root.querySelector('#toggle-key');
  const keyHint = root.querySelector('#key-hint');
  const modelInput = root.querySelector('#model');
  const modelOptions = root.querySelector('#model-options');
  const fetchModelsButton = root.querySelector('#fetch-models');
  const effortGroup = root.querySelector('#effort-group');
  const saveButton = root.querySelector('#save-config');
  const clearButton = root.querySelector('#clear-config');
  const statusLine = root.querySelector('#config-status');
  const storageState = root.querySelector('#storage-state');

  let saved = null;
  let dirty = false;
  let busy = false;
  let message = '';
  let tone = 'info';

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === 'string') node.textContent = text;
    return node;
  }

  function buildEffortOptions() {
    const fragment = document.createDocumentFragment();
    REASONING_EFFORTS.forEach(function (effort) {
      const label = element('label', 'segmented-option');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'reasoningEffort';
      input.value = effort.value;
      input.id = 'effort-' + effort.value;
      const text = element('span', 'segmented-label', effort.label);
      label.appendChild(input);
      label.appendChild(text);
      input.addEventListener('change', refreshDirty);
      fragment.appendChild(label);
    });
    effortGroup.replaceChildren(fragment);
  }

  function currentEffort() {
    const checked = effortGroup.querySelector('input[name="reasoningEffort"]:checked');
    return checked ? checked.value : 'high';
  }

  function setEffort(value) {
    const input = effortGroup.querySelector('input[name="reasoningEffort"][value="' + value + '"]');
    if (input) input.checked = true;
  }

  function refreshDirty() {
    if (!saved) {
      dirty = false;
      render();
      return;
    }
    dirty = baseUrlInput.value.trim() !== saved.baseUrl ||
      modelInput.value.trim() !== saved.model ||
      currentEffort() !== saved.reasoningEffort ||
      apiKeyInput.value.trim() !== '';
    if (dirty) {
      message = '';
      tone = 'info';
    }
    render();
  }

  function renderKeyHint() {
    if (!saved) {
      keyHint.textContent = '正在读取配置。';
      return;
    }
    if (saved.storage === 'unavailable') {
      keyHint.textContent = '当前系统不支持加密存储，无法保存 API Key。';
      return;
    }
    if (saved.hasApiKey) {
      keyHint.textContent = '已加密保存，尾号 ' + (saved.apiKeyHint || '----') + '；输入框留空表示保持不变。';
      return;
    }
    keyHint.textContent = '尚未保存 API Key。';
  }

  function statusContent(state) {
    if (!saved) return { text: '正在读取配置…', tone: 'info' };
    if (busy) return { text: '正在处理配置…', tone: 'info' };
    if (saved.storage === 'unavailable') {
      return { text: '当前系统不支持加密存储，配置无法保存。', tone: 'error' };
    }
    if (message !== '' && tone === 'error') return { text: message, tone: 'error' };
    if (dirty) return { text: '配置有未保存的修改，请先保存。', tone: 'warn' };
    if (!saved.baseUrl) return { text: '尚未填写服务地址。', tone: 'info' };
    if (!saved.hasApiKey) return { text: '尚未配置 API Key。', tone: 'info' };
    if (message !== '') return { text: message, tone: tone };
    return { text: '配置已保存，可以开始测试。', tone: 'success' };
  }

  function renderStorageState() {
    if (!storageState) return;
    if (!saved) {
      storageState.textContent = '正在检查加密存储…';
      storageState.dataset.tone = 'info';
      return;
    }
    if (saved.storage === 'unavailable') {
      storageState.textContent = '本机加密存储不可用';
      storageState.dataset.tone = 'error';
      return;
    }
    storageState.textContent = '本机加密存储可用';
    storageState.dataset.tone = 'success';
  }

  function render() {
    renderStorageState();
    const state = evaluateConfigState({ saved: saved, dirty: dirty });
    const unavailable = Boolean(saved && saved.storage === 'unavailable');
    saveButton.disabled = busy || !saved || unavailable;
    clearButton.disabled = busy || !saved || unavailable;
    fetchModelsButton.disabled = busy || !saved || unavailable || !saved.hasApiKey;
    const line = statusContent(state);
    statusLine.textContent = line.text;
    statusLine.dataset.tone = line.tone;
    onChange({ ready: state.ready && !busy, reason: state.reason, saved: saved, dirty: dirty });
  }

  function setMessage(text, nextTone) {
    message = text;
    tone = nextTone || 'info';
    render();
  }

  function applyConfig(config) {
    saved = config;
    baseUrlInput.value = config.baseUrl;
    modelInput.value = config.model;
    setEffort(config.reasoningEffort);
    apiKeyInput.value = '';
    dirty = false;
    renderKeyHint();
    render();
  }

  function readError(error) {
    if (error && typeof error.message === 'string' && error.message !== '') return error.message;
    return '操作失败，请重试。';
  }

  async function handleSave(event) {
    if (event) event.preventDefault();
    if (busy || !saved) return;
    const baseUrlValue = baseUrlInput.value.trim();
    if (baseUrlValue !== '') {
      let parsed = null;
      try {
        parsed = new URL(baseUrlValue);
      } catch (error) {
        parsed = null;
      }
      if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
        setMessage('服务地址需以 http:// 或 https:// 开头，并且是完整地址。', 'error');
        return;
      }
    }
    const payload = {
      baseUrl: baseUrlValue,
      model: modelInput.value.trim(),
      reasoningEffort: currentEffort()
    };
    if (apiKeyInput.value.trim() !== '') payload.apiKey = apiKeyInput.value.trim();
    busy = true;
    render();
    try {
      const next = await saveConfig(payload);
      applyConfig(next);
      setMessage('配置已保存。', 'success');
    } catch (error) {
      setMessage(readError(error), 'error');
    } finally {
      busy = false;
      render();
    }
  }

  async function handleClear() {
    if (busy || !saved) return;
    const confirmed = window.confirm('清空配置将删除已保存的服务地址、模型与 API Key。确定清空？');
    if (!confirmed) {
      setMessage('已取消清空。', 'info');
      return;
    }
    busy = true;
    render();
    try {
      await clearConfig();
      const next = await loadConfig();
      applyConfig(next);
      setMessage('配置已清空。', 'success');
    } catch (error) {
      setMessage(readError(error), 'error');
    } finally {
      busy = false;
      render();
    }
  }

  function toggleKeyVisibility() {
    const showing = apiKeyInput.type === 'text';
    apiKeyInput.type = showing ? 'password' : 'text';
    toggleKeyButton.textContent = showing ? '显示' : '隐藏';
    toggleKeyButton.setAttribute('aria-pressed', showing ? 'false' : 'true');
    toggleKeyButton.setAttribute('aria-label', showing ? '显示 API Key' : '隐藏 API Key');
  }

  async function handleFetchModels() {
    if (busy || !saved) return;
    if (dirty) {
      setMessage('请先保存配置，再获取模型列表。', 'warn');
      return;
    }
    if (!saved.hasApiKey) {
      setMessage('请先保存 API Key，再获取模型列表。', 'info');
      return;
    }
    busy = true;
    fetchModelsButton.textContent = '获取中…';
    render();
    try {
      const models = await loadModels();
      modelOptions.replaceChildren();
      models.forEach(function (id) {
        const option = document.createElement('option');
        option.value = id;
        modelOptions.appendChild(option);
      });
      if (models.length === 0) {
        setMessage('上游未返回可用模型。', 'warn');
      } else {
        setMessage('已获取 ' + models.length + ' 个模型，可从列表中选择或直接输入。', 'success');
      }
    } catch (error) {
      setMessage(readError(error), 'error');
    } finally {
      busy = false;
      fetchModelsButton.textContent = '获取模型列表';
      render();
    }
  }

  function bindEvents() {
    form.addEventListener('submit', handleSave);
    baseUrlInput.addEventListener('input', refreshDirty);
    modelInput.addEventListener('input', refreshDirty);
    apiKeyInput.addEventListener('input', refreshDirty);
    toggleKeyButton.addEventListener('click', toggleKeyVisibility);
    fetchModelsButton.addEventListener('click', handleFetchModels);
    clearButton.addEventListener('click', handleClear);
  }

  async function init() {
    buildEffortOptions();
    bindEvents();
    setEffort('high');
    render();
    try {
      applyConfig(await loadConfig());
    } catch (error) {
      message = '读取配置失败：' + readError(error);
      tone = 'error';
      render();
    }
  }

  init();

  return {
    getState() {
      return evaluateConfigState({ saved: saved, dirty: dirty });
    },
    reload: init
  };
}
