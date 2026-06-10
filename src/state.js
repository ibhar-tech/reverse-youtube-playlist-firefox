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
      try {
        const res = await STORAGE.get(key);
        return res[key];
      } catch {
        return undefined;
      }
    },

    async set(key, value) {
      try {
        await STORAGE.set({ [key]: value });
      } catch {
        /* degrade gracefully */
      }
    },

    async remove(key) {
      try {
        await STORAGE.remove(key);
      } catch {
        /* degrade gracefully */
      }
    },

    // Canonical storage key names — single source of truth.
    keys: {
      reverse: (id) => `reverse:${id}`,
      shuffle: (id) => `shuffle:${id}`,
      customOrder: (id) => `customOrder:${id}`,
      watched: (id) => `watched:${id}`,
      savedPlaylists: "savedPlaylists",
    },
  };
})();
