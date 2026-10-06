import test from 'node:test';
import assert from 'node:assert/strict';
import { mountConversationScrollRail } from '../adapters/harness/scroll.mjs';

const SCROLL_SELECTOR = '[class$="_centerCol"] .ST7X_W_root[data-phase=active] > [data-conversation-content] > [data-conversation-scroll]';

class FakeEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback, options) {
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    const list = this.listeners.get(type) || [];
    if (!list.some(item => item.callback === callback && item.capture === capture)) {
      list.push({ callback, capture, once: !!options?.once });
    }
    this.listeners.set(type, list);
  }
  removeEventListener(type, callback, options) {
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item.callback !== callback || item.capture !== capture));
  }
  listenerCount(type) {
    if (type) return (this.listeners.get(type) || []).length;
    return [...this.listeners.values()].reduce((sum, list) => sum + list.length, 0);
  }
  dispatchEvent(event) {
    event.target ||= this;
    let target = this;
    do {
      event.currentTarget = target;
      for (const item of [...(target.listeners?.get(event.type) || [])]) {
        if (item.once) target.removeEventListener(event.type, item.callback, item.capture);
        if (typeof item.callback === 'function') item.callback.call(target, event);
        else item.callback.handleEvent(event);
        if (event.immediatePropagationStopped) break;
      }
      target = event.bubbles && !event.propagationStopped ? target.parentNode : null;
    } while (target);
    return !event.defaultPrevented;
  }
}

class FakeEvent {
  constructor(type, init = {}) {
    Object.assign(this, {
      type, bubbles: false, cancelable: true, defaultPrevented: false,
      button: 0, pointerId: 1, isPrimary: true, clientX: 0, clientY: 0,
      deltaY: 0, deltaX: 0, deltaMode: 0, key: '', ctrlKey: false, metaKey: false,
    }, init);
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this.propagationStopped = true; }
  stopImmediatePropagation() { this.immediatePropagationStopped = this.propagationStopped = true; }
}

function fakeStyle(element) {
  const values = new Map();
  const write = (name, value) => {
    const oldValue = values.get(name) || '';
    const next = String(value ?? '');
    if (next) values.set(name, next);
    else values.delete(name);
    if (next !== oldValue) element.env.notifyMutation({ type: 'attributes', target: element, attributeName: 'style', oldValue });
  };
  const style = {
    setProperty: (name, value) => write(name, value),
    getPropertyValue: name => values.get(name) || '',
    removeProperty(name) { const old = values.get(name) || ''; write(name, ''); return old; },
  };
  return new Proxy(style, {
    get(target, key) {
      if (key === 'cssText') return [...values].map(([name, value]) => `${name}: ${value};`).join(' ');
      return key in target ? target[key] : values.get(key) || '';
    },
    set(target, key, value) {
      if (key === 'cssText') {
        for (const name of [...values.keys()]) write(name, '');
        for (const item of String(value).split(';')) {
          const divider = item.indexOf(':');
          if (divider !== -1) write(item.slice(0, divider).trim(), item.slice(divider + 1).trim());
        }
      } else write(key, value);
      return true;
    },
  });
}

const dataAttribute = key => `data-${String(key).replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`;
const cssNumber = value => Number.parseFloat(value) || 0;

class FakeElement extends FakeEventTarget {
  constructor(env, tagName = 'div') {
    super();
    this.env = env;
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.style = fakeStyle(this);
    this._scrollTop = 0;
    this._clientHeight = undefined;
    this._scrollHeight = undefined;
    this._rect = undefined;
    this.capturedPointers = new Set();
    this.dataset = new Proxy({}, {
      get: (_, key) => this.getAttribute(dataAttribute(key)) ?? undefined,
      set: (_, key, value) => { this.setAttribute(dataAttribute(key), value); return true; },
      deleteProperty: (_, key) => { this.removeAttribute(dataAttribute(key)); return true; },
    });
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
      toggle: (name, force) => {
        const add = force === undefined ? !this.classList.contains(name) : !!force;
        this.classList[add ? 'add' : 'remove'](name);
        return add;
      },
    };
  }
  get ownerDocument() { return this.env.document; }
  get parentElement() { return this.parentNode instanceof FakeElement ? this.parentNode : null; }
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] || null; }
  get firstElementChild() { return this.firstChild; }
  get isConnected() { return !!this.env.document?.documentElement.contains(this); }
  get className() { return this.getAttribute('class') || ''; }
  set className(value) { this.setAttribute('class', value); }
  get id() { return this.getAttribute('id') || ''; }
  set id(value) { this.setAttribute('id', value); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(value) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get tabIndex() { return Number(this.getAttribute('tabindex') ?? -1); }
  set tabIndex(value) { this.setAttribute('tabindex', value); }
  get clientHeight() { return this._clientHeight ?? this.getBoundingClientRect().height; }
  set clientHeight(value) { this._clientHeight = value; }
  get clientWidth() { return this.getBoundingClientRect().width; }
  get scrollHeight() { return this._scrollHeight ?? this.clientHeight; }
  set scrollHeight(value) { this._scrollHeight = value; }
  get scrollTop() { return this._scrollTop; }
  set scrollTop(value) {
    this.onBeforeScrollTopWrite?.(value);
    this._scrollTop = Math.max(0, Math.min(Number(value) || 0, Math.max(0, this.scrollHeight - this.clientHeight)));
  }
  get offsetHeight() { return this.getBoundingClientRect().height; }
  get offsetTop() { return this.getBoundingClientRect().top - (this.parentElement?.getBoundingClientRect().top || 0); }
  setAttribute(name, value) {
    const oldValue = this.getAttribute(name);
    const next = String(value);
    this.attributes.set(name, next);
    if (next !== oldValue) this.env.notifyMutation({ type: 'attributes', target: this, attributeName: name, oldValue });
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) {
    const oldValue = this.getAttribute(name);
    this.attributes.delete(name);
    if (oldValue !== null) this.env.notifyMutation({ type: 'attributes', target: this, attributeName: name, oldValue });
  }
  toggleAttribute(name, force) {
    const present = force ?? !this.hasAttribute(name);
    if (present) this.setAttribute(name, ''); else this.removeAttribute(name);
    return present;
  }
  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
  }
  appendChild(node) {
    node.remove();
    node.parentNode = this;
    this.children.push(node);
    this.env.notifyMutation({ type: 'childList', target: this, addedNodes: [node], removedNodes: [] });
    return node;
  }
  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index === -1) throw new Error('Not a child');
    this.children.splice(index, 1);
    node.parentNode = null;
    this.env.notifyMutation({ type: 'childList', target: this, addedNodes: [], removedNodes: [node] });
    return node;
  }
  remove() { if (this.parentElement) this.parentElement.removeChild(this); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  matches(selector) {
    const attrs = [...selector.matchAll(/\[([^\]=\s]+)(?:\s*=\s*["']?([^\]"']*)["']?)?\]/g)];
    if (attrs.length && !attrs.every(([, name, value]) => this.hasAttribute(name) && (value === undefined || this.getAttribute(name) === value.trim()))) return false;
    const className = selector.match(/\.([\w-]+)/)?.[1];
    if (className && !this.classList.contains(className)) return false;
    const id = selector.match(/#([\w-]+)/)?.[1];
    if (id && this.id !== id) return false;
    const tagName = selector.match(/^[a-z][\w-]*/i)?.[0];
    if (tagName && this.tagName.toLowerCase() !== tagName.toLowerCase()) return false;
    return !!(attrs.length || className || id || tagName || selector === '*');
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const result = [];
    for (const child of this.children) {
      if (child.matches(selector)) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }
  getBoundingClientRect() {
    if (this.closest('[hidden]')) {
      return { top: 0, left: 0, width: 0, height: 0, x: 0, y: 0, right: 0, bottom: 0, toJSON() { return this; } };
    }
    let rect = this._rect || { top: 20, left: 300, width: 10, height: this.env.currentPort?._clientHeight || 200 };
    if (this.hasAttribute('data-dss-scroll-thumb')) {
      const parent = this.parentElement?.getBoundingClientRect() || rect;
      const transform = this.style.transform;
      const translateY = transform.match(/translateY\(\s*([-\d.]+)px\s*\)/)?.[1]
        ?? transform.match(/translate(?:3d)?\(\s*[-\d.]+(?:px)?\s*,\s*([-\d.]+)px/)?.[1]
        ?? 0;
      rect = { ...parent, top: parent.top + cssNumber(this.style.top) + Number(translateY), height: cssNumber(this.style.height) };
    }
    return { ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height, toJSON() { return this; } };
  }
  setPointerCapture(pointerId) { this.capturedPointers.add(pointerId); }
  releasePointerCapture(pointerId) { this.capturedPointers.delete(pointerId); }
  hasPointerCapture(pointerId) { return this.capturedPointers.has(pointerId); }
  scrollBy(options, y) { this.scrollTop += typeof options === 'object' ? options.top || 0 : y || 0; }
  scrollTo(options, y) { this.scrollTop = typeof options === 'object' ? options.top || 0 : y || 0; }
  focus() { this.env.document.activeElement = this; }
}

function createFixture() {
  const env = {
    rafQueue: new Map(), nextRafId: 1, mutationObservers: [], resizeObservers: [],
    queriedSelectors: [], rafCount: 0, currentPort: null,
    requestAnimationFrame(callback) { const id = this.nextRafId++; this.rafQueue.set(id, callback); return id; },
    cancelAnimationFrame(id) { this.rafQueue.delete(id); },
    notifyMutation(record) {
      for (const observer of this.mutationObservers) {
        const matches = observer.observed.some(({ target, options }) => {
          if (target !== record.target && !(options.subtree && target.contains?.(record.target))) return false;
          if (record.type === 'childList') return !!options.childList;
          return !!options.attributes && (!options.attributeFilter || options.attributeFilter.includes(record.attributeName));
        });
        if (matches) observer.pending.push(record);
      }
    },
    flush(limit = 30) {
      for (let turn = 0; turn < limit; turn++) {
        let work = false;
        for (const observer of this.mutationObservers) {
          if (observer.pending.length && observer.observed.length) {
            const records = observer.takeRecords();
            observer.callback(records, observer);
            work = true;
          }
        }
        const frames = [...this.rafQueue];
        this.rafQueue.clear();
        for (const [, callback] of frames) { this.rafCount++; callback(this.rafCount * 16); work = true; }
        if (!work && !this.rafQueue.size && this.mutationObservers.every(observer => !observer.pending.length)) return;
      }
      assert.fail('DOM mutation/RAF work did not settle; the rail may be observing its own updates');
    },
    resize() {
      for (const observer of this.resizeObservers) {
        if (observer.observed.size) observer.callback([...observer.observed].map(target => ({ target, contentRect: target.getBoundingClientRect() })), observer);
      }
    },
  };
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; this.observed = []; this.pending = []; env.mutationObservers.push(this); }
    observe(target, options) { this.observed.push({ target, options }); }
    disconnect() { this.observed = []; this.pending = []; }
    takeRecords() { const records = this.pending; this.pending = []; return records; }
  }
  class FakeResizeObserver {
    constructor(callback) { this.callback = callback; this.observed = new Set(); env.resizeObservers.push(this); }
    observe(target) { this.observed.add(target); }
    unobserve(target) { this.observed.delete(target); }
    disconnect() { this.observed.clear(); }
  }
  env.window = new FakeEventTarget();
  env.document = new FakeEventTarget();
  Object.assign(env.document, {
    nodeType: 9, readyState: 'complete', parentNode: env.window, defaultView: env.window,
    createElement: tagName => new FakeElement(env, tagName),
    querySelector(selector) {
      env.queriedSelectors.push(selector);
      if (selector === SCROLL_SELECTOR) return env.currentPort;
      if (selector.includes('data-conversation-scroll')) return null;
      return this.documentElement.querySelector(selector);
    },
    querySelectorAll(selector) {
      if (selector === SCROLL_SELECTOR) return env.currentPort ? [env.currentPort] : [];
      if (selector.includes('data-conversation-scroll')) return [];
      return this.documentElement.querySelectorAll(selector);
    },
  });
  env.document.documentElement = new FakeElement(env, 'html');
  env.document.documentElement.parentNode = env.document;
  env.document.body = new FakeElement(env, 'body');
  env.document.documentElement.append(env.document.body);
  env.document.head = new FakeElement(env, 'head');
  env.document.documentElement.append(env.document.head);
  env.centerCol = new FakeElement(env);
  env.centerCol.className = 'test_centerCol';
  env.activeRoot = new FakeElement(env);
  env.activeRoot.className = 'ST7X_W_root';
  env.activeRoot.setAttribute('data-phase', 'active');
  env.centerCol.append(env.activeRoot);
  env.document.body.append(env.centerCol);
  env.makePort = ({ clientHeight = 200, scrollHeight = 1000, scrollTop = 0 } = {}) => {
    const parent = new FakeElement(env);
    parent.setAttribute('data-conversation-content', '');
    const port = new FakeElement(env);
    port.setAttribute('data-conversation-scroll', '');
    port.clientHeight = clientHeight;
    port.scrollHeight = scrollHeight;
    port.scrollTop = scrollTop;
    port._rect = { top: 20, left: 280, width: 500, height: clientHeight };
    parent.append(port);
    return { port, parent };
  };
  env.replacePort = options => {
    const old = env.currentPort;
    old?.parentElement.remove();
    const { port, parent } = env.makePort(options);
    env.currentPort = port;
    env.activeRoot.append(parent);
    return { old, port, parent };
  };
  env.replacePort();
  Object.assign(env.window, {
    document: env.document, innerHeight: 900,
    requestAnimationFrame: callback => env.requestAnimationFrame(callback),
    cancelAnimationFrame: id => env.cancelAnimationFrame(id),
    getComputedStyle: () => ({ lineHeight: '16px', direction: 'ltr', position: 'relative' }),
    MutationObserver: FakeMutationObserver, ResizeObserver: FakeResizeObserver,
    Event: FakeEvent, PointerEvent: FakeEvent, KeyboardEvent: FakeEvent, WheelEvent: FakeEvent,
  });
  env.globals = {
    window: env.window, document: env.document, Element: FakeElement, HTMLElement: FakeElement,
    MutationObserver: FakeMutationObserver, ResizeObserver: FakeResizeObserver,
    requestAnimationFrame: callback => env.requestAnimationFrame(callback),
    cancelAnimationFrame: id => env.cancelAnimationFrame(id),
    getComputedStyle: env.window.getComputedStyle,
    Event: FakeEvent, PointerEvent: FakeEvent, KeyboardEvent: FakeEvent, WheelEvent: FakeEvent,
  };
  env.rail = () => env.document.querySelector('[data-dss-scroll-rail]');
  env.thumb = () => env.rail()?.querySelector('[data-dss-scroll-thumb]');
  env.emit = (target, type, init = {}) => {
    const event = new FakeEvent(type, { bubbles: type !== 'scroll', ...init });
    target.dispatchEvent(event);
    return event;
  };
  env.mount = () => {
    env.controller = mountConversationScrollRail();
    assert.equal(typeof env.controller?.update, 'function');
    assert.equal(typeof env.controller?.dispose, 'function');
    env.controller.update({ enabled: true });
    env.flush();
    return env.controller;
  };
  return env;
}

function fixtureTest(name, callback) {
  test(name, () => {
    const env = createFixture();
    const descriptors = new Map(Object.keys(env.globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    for (const [name, value] of Object.entries(env.globals)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    try { callback(env); }
    finally {
      env.controller?.dispose();
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    }
  });
}

function approximately(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 0.001, `${message || 'unexpected value'}: expected ${expected}, got ${actual}`);
}

fixtureTest('mount uses the scoped active-conversation selector and attaches one accessible rail', env => {
  env.mount();
  assert.ok(env.queriedSelectors.includes(SCROLL_SELECTOR));
  const rail = env.rail();
  assert.ok(rail);
  assert.equal(rail.parentElement, env.currentPort.parentElement);
  assert.equal(rail.getAttribute('role'), 'scrollbar');
  assert.ok(env.thumb());
  assert.ok(env.currentPort.hasAttribute('data-dss-scrollport'));
  env.controller.update({ enabled: true });
  env.flush();
  assert.equal(env.document.querySelectorAll('[data-dss-scroll-rail]').length, 1);
});

fixtureTest('thumb reflects viewport/content ratio and reaches both track endpoints', env => {
  env.mount();
  const rail = env.rail();
  const thumb = env.thumb();
  approximately(thumb.getBoundingClientRect().height, 40, 'thumb height');
  approximately(thumb.getBoundingClientRect().top, rail.getBoundingClientRect().top, 'top endpoint');
  env.currentPort.scrollTop = 800;
  env.emit(env.currentPort, 'scroll');
  env.flush();
  approximately(thumb.getBoundingClientRect().bottom, rail.getBoundingClientRect().bottom, 'bottom endpoint');
  assert.equal(Number(rail.getAttribute('aria-valuemin')), 0);
  assert.equal(Number(rail.getAttribute('aria-valuemax')), 100);
  assert.equal(Number(rail.getAttribute('aria-valuenow')), 100);
});

fixtureTest('small viewport/content ratios retain a 32px thumb without breaking the bottom endpoint', env => {
  env.currentPort.scrollHeight = 10000;
  env.mount();
  approximately(env.thumb().getBoundingClientRect().height, 32, 'minimum thumb height');
  env.currentPort.scrollTop = 9800;
  env.emit(env.currentPort, 'scroll');
  env.flush();
  approximately(env.thumb().getBoundingClientRect().bottom, env.rail().getBoundingClientRect().bottom);
});

fixtureTest('resize refreshes geometry and a non-overflowing conversation hides the rail', env => {
  env.mount();
  env.currentPort.scrollHeight = 400;
  env.resize();
  env.flush();
  approximately(env.thumb().getBoundingClientRect().height, 100);
  env.currentPort.scrollHeight = 200;
  env.resize();
  env.flush();
  const rail = env.rail();
  assert.ok(rail.hidden || rail.getAttribute('aria-hidden') === 'true' || rail.style.display === 'none');
  env.currentPort.scrollHeight = 1000;
  env.resize();
  env.flush();
  assert.equal(rail.hidden, false);
  assert.notEqual(rail.getAttribute('aria-hidden'), 'true');
  assert.notEqual(rail.style.display, 'none');
  approximately(env.thumb().getBoundingClientRect().height, 40);
});

fixtureTest('track clicks center the thumb, clamp at the endpoints, and ignore child targets', env => {
  env.mount();
  const rail = env.rail();
  const rect = rail.getBoundingClientRect();
  env.emit(rail, 'pointerdown', { clientY: rect.top + rect.height / 2 });
  env.flush();
  approximately(env.currentPort.scrollTop, 400, 'center track jump');
  env.emit(rail, 'pointerdown', { clientY: rect.top - 100 });
  env.flush();
  assert.equal(env.currentPort.scrollTop, 0);
  env.emit(rail, 'pointerdown', { clientY: rect.bottom + 100 });
  env.flush();
  assert.equal(env.currentPort.scrollTop, 800);
  const child = env.document.createElement('span');
  rail.append(child);
  env.emit(child, 'pointerdown', { clientY: rect.top });
  env.flush();
  assert.equal(env.currentPort.scrollTop, 800);
});

fixtureTest('thumb dragging translates pointer travel to content travel and releases pointer capture', env => {
  env.mount();
  const rail = env.rail();
  const thumb = env.thumb();
  const start = thumb.getBoundingClientRect().top + 10;
  env.emit(thumb, 'pointerdown', { pointerId: 17, clientY: start });
  assert.ok(rail.hasPointerCapture(17) || thumb.hasPointerCapture(17));
  assert.equal(env.currentPort.scrollTop, 0, 'starting a drag must not track-jump');
  env.emit(rail, 'pointermove', { pointerId: 17, clientY: start + 80 });
  env.flush();
  approximately(env.currentPort.scrollTop, 400);
  env.emit(rail, 'pointermove', { pointerId: 17, clientY: start + 1000 });
  env.flush();
  assert.equal(env.currentPort.scrollTop, 800);
  env.emit(rail, 'pointerup', { pointerId: 17, clientY: start + 1000 });
  assert.equal(rail.hasPointerCapture(17) || thumb.hasPointerCapture(17), false);
  env.emit(rail, 'pointermove', { pointerId: 17, clientY: start });
  env.flush();
  assert.equal(env.currentPort.scrollTop, 800, 'pointerup ends dragging');
});

fixtureTest('other pointers and lost capture cannot continue a thumb drag', env => {
  env.mount();
  const rail = env.rail();
  const start = env.thumb().getBoundingClientRect().top + 10;
  env.emit(env.thumb(), 'pointerdown', { pointerId: 5, clientY: start });
  env.emit(rail, 'pointermove', { pointerId: 9, clientY: start + 80 });
  env.flush();
  assert.equal(env.currentPort.scrollTop, 0);
  rail.releasePointerCapture(5);
  env.emit(rail, 'lostpointercapture', { pointerId: 5 });
  env.emit(rail, 'pointermove', { pointerId: 5, clientY: start + 80 });
  env.flush();
  assert.equal(env.currentPort.scrollTop, 0);
});

fixtureTest('wheel respects pixel, line, and page units and clamps scrolling', env => {
  env.mount();
  const rail = env.rail();
  const pixel = env.emit(rail, 'wheel', { deltaY: 40, deltaMode: 0 });
  env.flush();
  assert.equal(env.currentPort.scrollTop, 40);
  assert.equal(pixel.defaultPrevented, true);
  env.currentPort.scrollTop = 0;
  env.emit(rail, 'wheel', { deltaY: 2, deltaMode: 1 });
  env.flush();
  assert.equal(env.currentPort.scrollTop, 32, 'two 16px lines');
  env.currentPort.scrollTop = 0;
  env.emit(rail, 'wheel', { deltaY: 1, deltaMode: 2 });
  env.flush();
  assert.equal(env.currentPort.scrollTop, 200, 'one viewport page');
  env.emit(rail, 'wheel', { deltaY: -1000, deltaMode: 0 });
  env.flush();
  assert.equal(env.currentPort.scrollTop, 0);
  env.emit(rail, 'wheel', { deltaY: 10000, deltaMode: 0 });
  env.flush();
  assert.equal(env.currentPort.scrollTop, 800);
});

fixtureTest('keyboard supports arrows, pages, Home, and End while leaving other keys alone', env => {
  env.mount();
  const rail = env.rail();
  const arrow = env.emit(rail, 'keydown', { key: 'ArrowDown' });
  env.flush();
  const arrowDistance = env.currentPort.scrollTop;
  assert.ok(arrowDistance > 0 && arrowDistance < env.currentPort.clientHeight);
  assert.equal(arrow.defaultPrevented, true);
  env.emit(rail, 'keydown', { key: 'ArrowUp' });
  env.flush();
  assert.equal(env.currentPort.scrollTop, 0);
  env.emit(rail, 'keydown', { key: 'PageDown' });
  env.flush();
  assert.ok(env.currentPort.scrollTop > arrowDistance);
  env.emit(rail, 'keydown', { key: 'PageUp' });
  env.flush();
  assert.equal(env.currentPort.scrollTop, 0);
  env.emit(rail, 'keydown', { key: 'End' });
  env.flush();
  assert.equal(env.currentPort.scrollTop, 800);
  env.emit(rail, 'keydown', { key: 'Home' });
  env.flush();
  assert.equal(env.currentPort.scrollTop, 0);
  const unrelated = env.emit(rail, 'keydown', { key: 'a' });
  env.flush();
  assert.equal(env.currentPort.scrollTop, 0);
  assert.equal(unrelated.defaultPrevented, false);
});

fixtureTest('native scroll events refresh the thumb position', env => {
  env.mount();
  env.currentPort.scrollTop = 200;
  env.emit(env.currentPort, 'scroll');
  env.flush();
  approximately(env.thumb().getBoundingClientRect().top - env.rail().getBoundingClientRect().top, 40);
});

fixtureTest('session replacement cleans the old port and attaches exactly one rail to the new port', env => {
  env.mount();
  const previousRail = env.rail();
  const previousThumb = env.thumb();
  const { old, port, parent } = env.replacePort({ clientHeight: 300, scrollHeight: 1200 });
  env.flush();
  assert.equal(old.hasAttribute('data-dss-scrollport'), false);
  assert.equal(old.listenerCount('scroll'), 0);
  assert.ok(port.hasAttribute('data-dss-scrollport'));
  assert.equal(env.rail().parentElement, parent);
  assert.equal(env.document.querySelectorAll('[data-dss-scroll-rail]').length, 1);
  if (env.rail() !== previousRail) {
    assert.equal(previousRail.listenerCount(), 0);
    assert.equal(previousThumb.listenerCount(), 0);
  }
  approximately(env.thumb().getBoundingClientRect().height, 75);
  port.scrollTop = 450;
  env.emit(port, 'scroll');
  env.flush();
  const before = env.thumb().getBoundingClientRect().top;
  old.scrollTop = 800;
  env.emit(old, 'scroll');
  env.flush();
  approximately(env.thumb().getBoundingClientRect().top, before, 'detached port must not affect current rail');
});

fixtureTest('observing rail mutations settles instead of scheduling RAF forever', env => {
  env.mount();
  env.currentPort.scrollTop = 400;
  env.emit(env.currentPort, 'scroll');
  env.flush();
  env.thumb().setAttribute('data-fixture-change', 'one');
  env.flush();
  assert.equal(env.rafQueue.size, 0);
  assert.ok(env.mutationObservers.every(observer => !observer.pending.length));
});

fixtureTest('disable cancels pending work, disconnects observers, restores markers, and can be reenabled', env => {
  env.currentPort.setAttribute('data-dss-scrollport', 'previous');
  env.mount();
  env.emit(env.currentPort, 'scroll');
  env.controller.update({ enabled: false });
  assert.equal(env.rafQueue.size, 0);
  assert.equal(env.rail(), null);
  assert.equal(env.currentPort.getAttribute('data-dss-scrollport'), 'previous');
  assert.equal(env.currentPort.listenerCount('scroll'), 0);
  assert.ok(env.mutationObservers.every(observer => observer.observed.length === 0));
  assert.ok(env.resizeObservers.every(observer => observer.observed.size === 0));
  env.flush();
  env.controller.update({ enabled: true });
  env.flush();
  assert.ok(env.rail());
  assert.equal(env.currentPort.listenerCount('scroll'), 1);
});

fixtureTest('dispose removes all listeners and observers, cancels RAF, and is final and idempotent', env => {
  env.mount();
  const rail = env.rail();
  const thumb = env.thumb();
  env.emit(env.currentPort, 'scroll');
  env.controller.dispose();
  assert.equal(env.rafQueue.size, 0);
  assert.equal(env.rail(), null);
  assert.equal(env.currentPort.hasAttribute('data-dss-scrollport'), false);
  assert.equal(env.currentPort.listenerCount(), 0);
  assert.equal(rail.listenerCount(), 0);
  assert.equal(thumb.listenerCount(), 0);
  assert.equal(env.document.listenerCount(), 0);
  assert.equal(env.window.listenerCount(), 0);
  assert.ok(env.mutationObservers.every(observer => observer.observed.length === 0));
  assert.ok(env.resizeObservers.every(observer => observer.observed.size === 0));
  env.controller.dispose();
  env.controller.update({ enabled: true });
  env.flush();
  assert.equal(env.rail(), null);
});

fixtureTest('Ctrl+wheel preserves native browser zoom and does not scroll or consume the event', env => {
  env.mount();
  const event = env.emit(env.rail(), 'wheel', { deltaY: 120, deltaMode: 0, ctrlKey: true });
  env.flush();
  assert.equal(env.currentPort.scrollTop, 0);
  assert.equal(event.defaultPrevented, false);
});

fixtureTest('the full rail width starts a drag when the pointer is within the thumb height', env => {
  env.mount();
  const rail = env.rail();
  rail._rect = { top: 20, left: 300, width: 12, height: 200 };
  const startY = env.thumb().getBoundingClientRect().top + 10;
  env.emit(rail, 'pointerdown', { pointerId: 21, clientX: 301, clientY: startY });
  env.flush();
  assert.equal(env.currentPort.scrollTop, 0, 'pressing the rail beside the thin thumb must not jump');
  assert.equal(rail.hasPointerCapture(21), true);
  env.emit(rail, 'pointermove', { pointerId: 21, clientX: 301, clientY: startY + 160 });
  env.flush();
  assert.equal(env.currentPort.scrollTop, 800);
  approximately(env.thumb().getBoundingClientRect().bottom, rail.getBoundingClientRect().bottom);
});

fixtureTest('a second non-primary pointer and unrelated lost capture preserve the current drag', env => {
  env.mount();
  const rail = env.rail();
  const startY = env.thumb().getBoundingClientRect().top + 10;
  env.emit(env.thumb(), 'pointerdown', { pointerId: 11, clientY: startY });
  env.emit(env.thumb(), 'pointerdown', { pointerId: 12, clientY: startY + 5, isPrimary: false });
  assert.equal(rail.hasPointerCapture(11), true);
  assert.equal(rail.hasPointerCapture(12), false);
  env.emit(rail, 'lostpointercapture', { pointerId: 12, isPrimary: false });
  env.emit(rail, 'pointermove', { pointerId: 11, clientY: startY + 80 });
  env.flush();
  approximately(env.currentPort.scrollTop, 400);
  env.emit(rail, 'pointerup', { pointerId: 11, clientY: startY + 80 });
  assert.equal(rail.hasPointerCapture(11), false);
});

fixtureTest('native reader receives user intent before scrollTop writes, and automatic refresh sends no intent', env => {
  env.mount();
  const port = env.currentPort;
  const rail = env.rail();
  let pagingAnchor = { top: 0 };
  const order = [];
  const intentEvents = [];
  for (const type of ['wheel', 'pointerdown', 'keydown']) {
    port.addEventListener(type, event => {
      order.push(`intent:${event.type}`);
      intentEvents.push(event);
      pagingAnchor = null;
    }, { capture: true });
  }
  env.emit(port, 'scroll');
  env.resize();
  env.flush();
  assert.equal(intentEvents.length, 0, 'native scroll and geometry refresh are not user gestures');
  assert.notEqual(pagingAnchor, null);
  port.onBeforeScrollTopWrite = () => {
    order.push('write');
    assert.equal(pagingAnchor, null, 'the paging reader anchor must be cancelled before native scrolling');
  };
  const exercise = (type, target, init) => {
    pagingAnchor = { top: port.scrollTop };
    order.length = 0;
    intentEvents.length = 0;
    env.emit(target, type, init);
    env.flush();
    assert.equal(order[0], `intent:${type}`);
    assert.ok(order.includes('write'), `${type} must perform the requested scroll`);
    assert.ok(intentEvents.every(event => event.bubbles === false), 'reader-intent events remain local to the native port');
    if (type === 'wheel') assert.ok(intentEvents.every(event => event.deltaY === 0), 'intent wheel cannot scroll the port a second time');
  };
  exercise('wheel', rail, { deltaY: 40, deltaMode: 0 });
  exercise('keydown', rail, { key: 'End' });
  exercise('pointerdown', rail, { pointerId: 31, clientY: rail.getBoundingClientRect().top + 100 });
  pagingAnchor = { top: port.scrollTop };
  order.length = 0;
  intentEvents.length = 0;
  const startY = env.thumb().getBoundingClientRect().top + 10;
  env.emit(env.thumb(), 'pointerdown', { pointerId: 32, clientY: startY });
  assert.equal(order[0], 'intent:pointerdown', 'drag start must cancel the reader anchor');
  env.emit(rail, 'pointermove', { pointerId: 32, clientY: startY + 160 });
  env.flush();
  assert.ok(order.includes('write'));
  order.length = 0;
  intentEvents.length = 0;
  env.emit(port, 'scroll');
  env.resize();
  env.flush();
  assert.equal(intentEvents.length, 0);
  assert.equal(order.length, 0);
  port.onBeforeScrollTopWrite = undefined;
});

fixtureTest('a track no taller than the minimum thumb restores native scrolling until it grows', env => {
  env.mount();
  const rail = env.rail();
  rail._rect = { top: 20, left: 300, width: 12, height: 32 };
  env.resize();
  env.flush();
  assert.ok(env.currentPort.scrollHeight > env.currentPort.clientHeight, 'content remains scrollable');
  assert.equal(rail.hidden, true, 'a thumb filling the track cannot serve as a custom scrollbar');
  assert.equal(env.currentPort.hasAttribute('data-dss-scrollport'), false, 'native scrollbar must be restored while the rail is unusable');
  rail._rect.height = 200;
  env.resize();
  env.flush();
  assert.equal(rail.hidden, false);
  assert.equal(env.currentPort.hasAttribute('data-dss-scrollport'), true);
  approximately(env.thumb().getBoundingClientRect().height, 40);
});

fixtureTest('a drag ends safely if the track shrinks or overflow disappears before the next move', env => {
  env.mount();
  const rail = env.rail();
  const thumb = env.thumb();
  const start = thumb.getBoundingClientRect().top + 10;
  env.emit(thumb, 'pointerdown', { pointerId: 50, clientY: start });
  rail._rect = { top: 20, left: 300, width: 12, height: 32 };
  assert.doesNotThrow(() => env.emit(rail, 'pointermove', { pointerId: 50, clientY: start + 30 }));
  assert.equal(rail.hasPointerCapture(50), false);
  assert.equal(env.currentPort.scrollTop, 0);
  rail._rect.height = 200;
  env.resize(); env.flush();
  env.emit(thumb, 'pointerdown', { pointerId: 51, clientY: start });
  env.currentPort.scrollHeight = env.currentPort.clientHeight;
  assert.doesNotThrow(() => env.emit(rail, 'pointermove', { pointerId: 51, clientY: start + 30 }));
  assert.equal(rail.hasPointerCapture(51), false);
  env.flush();
  assert.equal(rail.hidden, true);
});
