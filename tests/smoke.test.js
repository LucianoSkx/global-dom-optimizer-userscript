import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert';

const ATTR = 'data-gdo-contained';

class FakeStyle {
  constructor() { this.map = new Map(); }
  getPropertyValue(k) { return this.map.get(k)?.value ?? ''; }
  getPropertyPriority(k) { return this.map.get(k)?.priority ?? ''; }
  setProperty(k, v, p = '') { this.map.set(k, { value: String(v), priority: p }); }
  removeProperty(k) { this.map.delete(k); }
}

let elCount = 0;
class FakeEl {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.id = '';
    this.children = [];
    this.parentElement = null;
    this.isConnected = true;
    this.childElementCount = 0;
    this.textContent = '';
    this._attrs = new Map();
    this.style = new FakeStyle();
    this.clientHeight = 0;
    this.scrollHeight = 0;
    this.scrollTop = 0;
    this._rect = { width: 600, height: 80, top: 1200, left: 0, bottom: 1280 };
    this._id = ++elCount;
  }
  appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
  append(...cs) { for (const c of cs) this.appendChild(c); }
  matches(sel) {
    const t = this.tagName.toLowerCase();
    return sel.split(',').some(s => s.trim().toLowerCase().split(/[\s.#\[]/)[0] === t);
  }
  querySelectorAll(sel) {
    const tags = new Set(sel.split(',').map(s => s.trim().toLowerCase().split(/[\s.#\[]/)[0]).filter(Boolean));
    const out = [];
    const walk = el => { for (const c of el.children) { if (c.nodeType === 1 || c.tagName) { if (tags.has(c.tagName?.toLowerCase())) out.push(c); walk(c); } } };
    walk(this);
    return out;
  }
  closest() { return null; }
  contains(other) { return other === this; }
  querySelector() { return null; }
  getBoundingClientRect() { return { ...this._rect }; }
  setAttribute(k, v) { this._attrs.set(k, String(v)); }
  getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; }
  hasAttribute(k) { return this._attrs.has(k); }
  removeAttribute(k) { this._attrs.delete(k); }
  toggleAttribute(k, force) { const want = force ?? !this._attrs.has(k); if (want) this._attrs.set(k, '1'); else this._attrs.delete(k); return want; }
  attachShadow() {
    const shadow = {
      _els: new Map(),
      append(...nodes) { for (const n of nodes) this._els.set(n, true); },
      querySelector(sel) { if (!this._els.has(sel)) { const el = new FakeEl('div'); el.classList = { toggle() {} }; this._els.set(sel, el); } return this._els.get(sel); },
    };
    this.shadowRoot = shadow;
    return shadow;
  }
  set innerHTML(v) { this._innerHTML = v; }
  get innerHTML() { return this._innerHTML ?? ''; }
  setAttributeNS() {}
  addEventListener() {}
  removeEventListener() {}
  focus() {}
}

const documentEl = new FakeEl('html');
const head = new FakeEl('head');
const body = new FakeEl('body');
const article = new FakeEl('article');
documentEl.appendChild(head);
documentEl.appendChild(body);
body.appendChild(article);

const para = new FakeEl('p');
para.textContent = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit sed do eiusmod tempor.';
para.parentElement = article;
article.appendChild(para);

const scrollingElement = new FakeEl('html');
scrollingElement.scrollHeight = 5000;
scrollingElement.clientHeight = 800;
scrollingElement.scrollTop = 0;

const observed = [];
class FakeIO {
  constructor(cb, opts) { this.cb = cb; this.opts = opts; }
  observe(e) { observed.push(e); }
  unobserve() {}
  disconnect() {}
}
class FakeMO {
  constructor(cb) { this.cb = cb; }
  observe() {}
}

const store = { enabled: true, excludedHosts: [] };
const menu = [];
const sandbox = {
  console, Intl, performance, setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: cb => setTimeout(cb, 0),
  cancelAnimationFrame: clearTimeout,
  addEventListener() {},
  innerHeight: 800,
  location: { hostname: 'example.com', href: 'https://example.com/' },
  CSS: { supports: () => true },
  document: {
    head, body, documentElement: documentEl, scrollingElement, activeElement: null,
    createElement: () => new FakeEl('div'),
    querySelectorAll: () => [],
    addEventListener() {},
  },
  getComputedStyle: () => ({
    display: 'block', position: 'static', float: 'none', visibility: 'visible',
    contentVisibility: 'visible', animationName: 'none', transform: 'none', filter: 'none',
    columnCount: 'auto', overflowY: 'visible', overflowX: 'visible', flexDirection: 'row',
    gridTemplateColumns: '', paddingTop: '0px', paddingBottom: '0px',
    borderTopWidth: '0px', borderBottomWidth: '0px', marginTop: '0px', marginBottom: '0px',
  }),
  MutationObserver: FakeMO,
  IntersectionObserver: FakeIO,
  GM_getValue: (k, def) => (k in store ? store[k] : def),
  GM_setValue: (k, v) => { store[k] = v; },
  GM_registerMenuCommand: (label, fn) => menu.push({ label, fn }),
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../global-dom-optimizer.user.js', import.meta.url), 'utf8'), sandbox, { filename: 'global-dom-optimizer.user.js' });

await new Promise(r => setTimeout(r, 400));

assert.equal(para.getAttribute(ATTR), '1', 'eligible paragraph must be contained');
assert.ok(observed.includes(para), 'IntersectionObserver must observe the block');
assert.equal(menu.length, 3, 'three menu commands registered');

const toggleSite = menu.find(m => m.label.includes('este site'));
toggleSite.fn();
assert.deepEqual(store.excludedHosts, ['example.com'], 'site exclusion persisted');
assert.equal(para.getAttribute(ATTR), null, 'containment removed on site exclusion');

toggleSite.fn();
assert.deepEqual(store.excludedHosts, [], 'site re-included');

const toggleGlobal = menu.find(m => m.label.includes('Pausar'));
toggleGlobal.fn();
assert.equal(store.enabled, false, 'global paused');

console.log('SMOKE OK: containment applied, exclusion/pause persisted, 3 menu commands registered');
process.exit(0);
