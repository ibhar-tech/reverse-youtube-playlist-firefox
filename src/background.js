/*
 * YouTube Playlist Tools — background.js
 *
 * Two jobs only: forward keyboard shortcuts (manifest `commands`, rebindable
 * by the user) to the YouTube tab, and open the welcome page on first
 * install. Runs as an event page in Firefox and a service worker in
 * Chrome/Edge (see build-chrome.sh), so it keeps no state.
 */
const api = typeof browser !== "undefined" ? browser : chrome;

api.commands.onCommand.addListener(async (command, tab) => {
  let target = tab;
  if (!target?.id) {
    const [active] = await api.tabs.query({ active: true, currentWindow: true });
    target = active;
  }
  if (!target?.id) return;
  try {
    await api.tabs.sendMessage(target.id, { action: "RUN_COMMAND", command });
  } catch (_) {
    // Not a YouTube tab (no content script there) — nothing to do.
  }
});

api.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") {
    api.tabs.create({ url: api.runtime.getURL("popup/welcome.html") });
  }
});
