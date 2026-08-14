/*
 * YouTube Playlist Tools — setup.js
 * Test environment mock for browser extension & DOM
 */
globalThis.window = globalThis;
globalThis.getComputedStyle = (el) => ({ overflowY: "auto", display: "block" });
window.getComputedStyle = globalThis.getComputedStyle;

globalThis.browser = {
  storage: {
    local: {
      data: {},
      get: async (keys) => {
        if (!keys) return { ...globalThis.browser.storage.local.data };
        if (typeof keys === "string") return { [keys]: globalThis.browser.storage.local.data[keys] };
        if (Array.isArray(keys)) {
          const res = {};
          keys.forEach(k => res[k] = globalThis.browser.storage.local.data[k]);
          return res;
        }
        if (typeof keys === "object") {
          const res = {};
          for (const [k, defaultVal] of Object.entries(keys)) {
            res[k] = globalThis.browser.storage.local.data[k] !== undefined ? globalThis.browser.storage.local.data[k] : defaultVal;
          }
          return res;
        }
        return { ...globalThis.browser.storage.local.data };
      },
      set: async (obj) => {
        Object.assign(globalThis.browser.storage.local.data, obj);
      },
      remove: async (keys) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        arr.forEach(k => delete globalThis.browser.storage.local.data[k]);
      }
    },
    onChanged: {
      addListener: () => {}
    }
  },
  runtime: {
    onMessage: {
      addListener: () => {}
    },
    sendMessage: async () => ({ success: true })
  },
  i18n: {
    getUILanguage: () => "en"
  }
};

globalThis.chrome = globalThis.browser;

// Minimal DOM mock if needed
if (!globalThis.document) {
  globalThis.document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: (tag) => {
      const children = [];
      const listeners = {};
      const classList = new Set();
      return {
        tagName: tag.toUpperCase(),
        className: "",
        classList: {
          add: (c) => classList.add(c),
          remove: (c) => classList.delete(c),
          toggle: (c, force) => force !== undefined ? (force ? classList.add(c) : classList.delete(c)) : (classList.has(c) ? classList.delete(c) : classList.add(c)),
          contains: (c) => classList.has(c)
        },
        children,
        appendChild: (child) => children.push(child),
        append: (...items) => children.push(...items),
        replaceChildren: (...items) => { children.length = 0; children.push(...items); },
        setAttribute: () => {},
        getAttribute: () => null,
        addEventListener: (event, handler) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(handler);
        },
        dispatchEvent: (event) => {
          (listeners[event.type] || []).forEach(cb => cb(event));
        }
      };
    },
    documentElement: {
      addEventListener: () => {}
    },
    body: {
      appendChild: () => {},
      classList: {
        add: () => {},
        remove: () => {},
        toggle: () => {}
      }
    }
  };
}

if (!globalThis.location) {
  globalThis.location = {
    origin: "https://www.youtube.com",
    pathname: "/watch",
    search: "?v=testVideo1&list=PLtestList",
    hash: ""
  };
}
