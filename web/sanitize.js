// SVG 提取、解析、净化与内联渲染。
// 提取逻辑为纯函数；解析与渲染依赖浏览器 DOM。

const BACKTICK = String.fromCharCode(96);
const FENCE = BACKTICK + BACKTICK + BACKTICK;
const SVG_FENCE = new RegExp(FENCE + '[ \\t]*(?:svg|html)[^\\r\\n]*\\r?\\n([\\s\\S]*?)' + FENCE, 'gi');
const SVG_CLOSE = '</svg>';
const DANGEROUS_SELECTOR = 'script, foreignObject, iframe, object, embed, audio, video';
const EXTERNAL_CSS_URL = /url\(\s*(['"]?)\s*(?:https?:)?\/\/[^)]*\)/gi;
const CSS_IMPORT = /@import[^;]*(?:;|$)/gi;

function firstSvgElement(text) {
  if (typeof text !== 'string') return null;
  const lower = text.toLowerCase();
  const start = lower.indexOf('<svg');
  const end = lower.lastIndexOf(SVG_CLOSE);
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start, end + SVG_CLOSE.length);
}

// 优先取 svg / html 代码块内的 SVG，否则取首个 <svg 到最后一个 </svg>。
export function extractSvg(source) {
  if (typeof source !== 'string' || source.trim() === '') return null;
  SVG_FENCE.lastIndex = 0;
  let match = SVG_FENCE.exec(source);
  while (match !== null) {
    const candidate = firstSvgElement(match[1]);
    if (candidate) return candidate;
    match = SVG_FENCE.exec(source);
  }
  return firstSvgElement(source);
}

export function parseSvg(markup) {
  if (typeof markup !== 'string' || markup.trim() === '') return null;
  if (typeof DOMParser !== 'function') return null;
  let documentNode = null;
  try {
    documentNode = new DOMParser().parseFromString(markup, 'image/svg+xml');
  } catch (error) {
    return null;
  }
  if (!documentNode) return null;
  if (documentNode.getElementsByTagName('parsererror').length > 0) return null;
  const root = documentNode.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg') return null;
  return root;
}

export function sanitizeSvg(svgElement) {
  if (!svgElement) return null;
  Array.from(svgElement.querySelectorAll(DANGEROUS_SELECTOR)).forEach(function (node) {
    node.remove();
  });
  const elements = [svgElement].concat(Array.from(svgElement.querySelectorAll('*')));
  elements.forEach(function (element) {
    if (!element || element.nodeType !== 1) return;
    Array.from(element.attributes || []).forEach(function (attribute) {
      const name = attribute.name.toLowerCase();
      if (name.indexOf('on') === 0) {
        element.removeAttribute(attribute.name);
        return;
      }
      if (name === 'href' || name === 'xlink:href') {
        if (attribute.value.trim().charAt(0) !== '#') element.removeAttribute(attribute.name);
        return;
      }
      if (name === 'target' && element.nodeName.toLowerCase() === 'a') {
        element.removeAttribute(attribute.name);
      }
    });
    if (element.nodeName.toLowerCase() === 'style') {
      const original = element.textContent || '';
      const cleaned = original.replace(CSS_IMPORT, '').replace(EXTERNAL_CSS_URL, 'none');
      if (cleaned !== original) element.textContent = cleaned;
    }
  });
  return svgElement;
}

function parseLength(value) {
  if (typeof value !== 'string') return null;
  const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(?:px)?\s*$/i.exec(value);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// 无 viewBox 但带数值 width/height 时，据此生成 viewBox，交给容器自适应缩放。
export function ensureViewBox(svgElement) {
  if (!svgElement || svgElement.hasAttribute('viewBox')) return svgElement;
  const width = parseLength(svgElement.getAttribute('width'));
  const height = parseLength(svgElement.getAttribute('height'));
  if (width === null || height === null) return svgElement;
  svgElement.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  svgElement.removeAttribute('width');
  svgElement.removeAttribute('height');
  return svgElement;
}

// 净化后内联注入容器，保留 SMIL 与内联样式动画。
export function renderSvgInto(container, source) {
  if (!container) return { ok: false, reason: '缺少可用的展示区域。' };
  container.replaceChildren();
  const extracted = extractSvg(source);
  if (!extracted) return { ok: false, reason: '未找到可识别的 SVG 内容。' };
  const parsed = parseSvg(extracted);
  if (!parsed) return { ok: false, reason: 'SVG 内容无法解析。' };
  const cleaned = sanitizeSvg(parsed);
  ensureViewBox(cleaned);
  cleaned.setAttribute('focusable', 'false');
  cleaned.classList.add('svg-figure');
  container.appendChild(document.importNode(cleaned, true));
  return { ok: true };
}
