// SautiLink adapter for the pinned AnimateIcons vanilla runtime.
// Upstream files remain byte-for-byte intact; see app/assets/huge-icons/NOTICE.md.
import { attachIcon, createIdScope, play as playMotion, restingAttributes } from '../upstream/runtime.js';
import catalog from './catalog.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const resolve = name => {
  const data = typeof name === 'string' ? catalog[name] : name;
  if (!data || !['huge', 'lucide', 'sautilink'].includes(data.library)) throw new TypeError(`Unknown member icon: ${name}`);
  return data;
};

/** Render the upstream resting geometry with CSP-compatible CSSOM style writes. */
export function renderIcon(name, size = 24, doc = document) {
  const data = resolve(name);
  const scope = createIdScope();
  const render = (node, root = false) => {
    const element = doc.createElementNS(SVG_NS, node.tag);
    const attributes = restingAttributes(node, root, scope);
    for (const [key, value] of Object.entries(attributes)) {
      if (key === 'style') {
        for (const declaration of value.split(';')) {
          const colon = declaration.indexOf(':');
          if (colon < 0) continue;
          const property = declaration.slice(0, colon).trim();
          const setting = declaration.slice(colon + 1).trim();
          if (property) element.style.setProperty(property, setting);
        }
      } else element.setAttribute(key, value);
    }
    for (const child of node.children ?? []) element.appendChild(render(child));
    return element;
  };
  const svg = render(data, true);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  return svg;
}

/** Attach the original Huge motion to an existing SVG; lifecycle belongs to the caller. */
export function play(svg, name, options) {
  return playMotion(svg, resolve(name), options);
}

export function mountIcon(host, name, options = {}) {
  const data = resolve(name);
  host.style.position = 'relative';
  host.style.display = 'inline-flex';
  if (options.color) host.style.color = options.color;
  const svg = renderIcon(data, options.size ?? 24, host.ownerDocument);
  host.replaceChildren(svg);
  const controls = attachIcon(host, svg, data, options);
  return {
    startAnimation: controls.startAnimation,
    stopAnimation: controls.stopAnimation,
    destroy() { controls.destroy(); svg.remove(); },
  };
}

export function createIcon(name, options) {
  const host = document.createElement('span');
  return Object.assign(host, mountIcon(host, name, options));
}

export { catalog };
export const names = Object.freeze(Object.keys(catalog));
export const version = '@animateicons/vanilla@0.1.0';
