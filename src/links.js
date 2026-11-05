/*
 * YouTube Playlist Tools — links.js
 *
 * Store links for the browser this copy runs in. Loaded by the content
 * scripts, the popup and the welcome page, so a Chrome user is never sent to
 * the Firefox listing to leave a review (and vice versa).
 */
(() => {
  "use strict";

  window.RYP = window.RYP || {};

  const AMO = "https://addons.mozilla.org/firefox/addon/reverse-youtube-playlist-order/";
  const CHROME = "https://chromewebstore.google.com/detail/gbdcdgleohhjajeabaebidlfhenlgmgo";

  function browserKind() {
    const api = typeof browser !== "undefined" ? browser : (typeof chrome !== "undefined" ? chrome : null);
    let base = "";
    try {
      base = api?.runtime?.getURL?.("") || "";
    } catch (_) {}
    if (base.startsWith("moz-extension:")) return "firefox";
    const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
    return /\bEdg\//.test(ua) ? "edge" : "chrome";
  }

  // No Edge Add-ons listing is confirmed yet; Edge installs Chrome Web Store
  // extensions, so the Chrome listing is the safe target there.
  function storeUrl(kind = browserKind()) {
    return kind === "firefox" ? AMO : CHROME;
  }

  function reviewUrl(kind = browserKind()) {
    return kind === "firefox" ? `${AMO}reviews/` : `${CHROME}/reviews`;
  }

  window.RYP.Links = { browserKind, storeUrl, reviewUrl };
})();
