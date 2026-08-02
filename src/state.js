/*
 * YouTube Playlist Tools — state.js
 *
 * Thin wrapper around browser.storage.local. All other modules read/write
 * playlist state through this single interface so that the storage key
 * structure is defined in exactly one place.
 */
(() => {
  "use strict";

  const STORAGE = (typeof browser !== "undefined" ? browser : chrome).storage
    .local;

  window.RYP = window.RYP || {};
  window.RYP.State = {
    async get(key) {
      const res = await STORAGE.get(key);
      return res[key];
    },

    async set(key, value) {
      await STORAGE.set({ [key]: value });
    },

    async remove(key) {
      await STORAGE.remove(key);
    },

    // Canonical storage key names — single source of truth.
    keys: {
      reverse: (id) => `reverse:${id}`,
      shuffle: (id) => `shuffle:${id}`,
      customOrder: (id) => `customOrder:${id}`,
      watched: (id) => `watched:${id}`,
      progress: (id) => `progress:${id}`,
      savedPlaylists: "savedPlaylists",
    },
  };
})();
