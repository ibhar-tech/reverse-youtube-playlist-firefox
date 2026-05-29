/*
 * Reverse YouTube Playlist — content script
 *
 * Plays a YouTube playlist in reverse (last video -> first).
 *
 *  - Click the "Reverse" button: jumps to the LAST video of the playlist and
 *    plays backwards from there.
 *  - When a video ends (autoplay), it goes to the PREVIOUS item instead of the
 *    next one. As a fallback it also catches a forward "next"/Shift+N advance
 *    and bounces back one item.
 *  - At the first video, reverse playback stops (nothing before it).
 *
 * Navigation is done by clicking the playlist item's own link, so it stays an
 * in-app (single-page) navigation — no full page reload, no flash, and our
 * state survives.
 *
 * Nothing is changed on YouTube's servers — purely client-side, per playlist.
 * Registered for ALL youtube.com pages so it is present even when you reach a
 * watch page via an in-app "Play" navigation.
 */
(() => {
  "use strict";

  // Flip to false for a quiet console once everything is confirmed working.
  const DEBUG = false;
  const log = (...a) => DEBUG && console.log("[RYP]", ...a);

  const SEL = {
    panel: "ytd-playlist-panel-renderer",
    headerCandidates: [
      "ytd-playlist-panel-renderer #header-contents",
      "ytd-playlist-panel-renderer #header",
      "ytd-playlist-panel-renderer #playlist-actions",
    ],
    item: "ytd-playlist-panel-video-renderer",
    itemLink: "a#wc-endpoint, a",
  };

  const BTN_ID = "ryp-reverse-toggle";
  const STORAGE = (typeof browser !== "undefined" ? browser : chrome).storage
    .local;

  let reverseOn = false;
  let lastIndex = null; // last settled playlist index (1-based)
  let navigating = false; // true while we are performing a reverse jump
  let endHandled = false; // guards the near-end trigger to once per video

  const REVERSED_CLASS = "ryp-reversed"; // cosmetic sidebar reversal
  const END_LEAD = 0.35; // seconds before the true end to pre-empt autoplay

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const getPlaylistId = () =>
    new URLSearchParams(location.search).get("list");

  const isPlaylistWatchPage = () =>
    location.pathname === "/watch" && !!getPlaylistId();

  const storageKey = (listId) => `reverse:${listId}`;

  async function loadState(listId) {
    try {
      const res = await STORAGE.get(storageKey(listId));
      return !!res[storageKey(listId)];
    } catch (e) {
      return false;
    }
  }
  async function saveState(listId, on) {
    try {
      await STORAGE.set({ [storageKey(listId)]: on });
    } catch (e) {
      /* degrade gracefully */
    }
  }

  /** All playlist items as [{ index, anchor }], sorted by index ascending. */
  function readItems() {
    const panel = document.querySelector(SEL.panel);
    if (!panel) return [];
    const out = [];
    for (const item of panel.querySelectorAll(SEL.item)) {
      const anchor = item.querySelector(SEL.itemLink);
      const href = anchor && anchor.getAttribute("href");
      if (!href) continue;
      const index = parseInt(
        new URL(href, location.origin).searchParams.get("index") || "",
        10
      );
      if (Number.isFinite(index)) out.push({ index, anchor });
    }
    out.sort((a, b) => a.index - b.index);
    return out;
  }

  /** Current playlist index (1-based): from URL, else the selected item. */
  function currentIndex() {
    const i = parseInt(
      new URLSearchParams(location.search).get("index") || "",
      10
    );
    if (Number.isFinite(i)) return i;
    const panel = document.querySelector(SEL.panel);
    if (panel) {
      const items = Array.from(panel.querySelectorAll(SEL.item));
      const sel = items.findIndex((it) => it.hasAttribute("selected"));
      if (sel >= 0) return sel + 1;
    }
    return null;
  }

  /** In-app navigate to the playlist item with the given index. */
  function goToIndex(targetIndex) {
    const hit = readItems().find((it) => it.index === targetIndex);
    if (!hit) {
      log("goToIndex: no loaded item at index", targetIndex);
      return false;
    }
    navigating = true;
    log("goToIndex: clicking item index", targetIndex);
    hit.anchor.click();
    return true;
  }

  /** Step back one from the given position (1-based). */
  function stepBackFrom(pos) {
    if (navigating || pos === null) return false;
    if (pos - 1 < 1) {
      log("reverse: at the first video — reverse playback finished");
      return false;
    }
    return goToIndex(pos - 1);
  }

  // ---------------------------------------------------------------------------
  // Triggers
  // ---------------------------------------------------------------------------
  // Primary: step back a hair before the video ends, so YouTube never gets to
  // autoplay forward (this is what removes the forward "flicker").
  function onTimeUpdate(e) {
    if (!reverseOn || navigating || endHandled || !isPlaylistWatchPage()) return;
    const v = e.target;
    if (!v || !v.duration || !isFinite(v.duration) || v.duration < 1) return;
    if (v.duration - v.currentTime <= END_LEAD) {
      endHandled = true;
      log("near end -> step back (pre-empting autoplay)");
      stepBackFrom(currentIndex());
    }
  }
  document.addEventListener("timeupdate", onTimeUpdate, true);

  // Backup: if a video somehow ends without the near-end trigger firing.
  function onEnded() {
    if (!reverseOn || navigating || endHandled || !isPlaylistWatchPage()) return;
    endHandled = true;
    log("video ended -> step back");
    stepBackFrom(currentIndex());
  }
  document.addEventListener("ended", onEnded, true);

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  function reflectButton(btn) {
    if (!btn) return;
    btn.classList.toggle("ryp-active", reverseOn);
    btn.setAttribute("aria-pressed", String(reverseOn));
    btn.title = reverseOn
      ? "Reverse playback is ON — playing last to first"
      : "Play this playlist in reverse (last to first)";
    const label = btn.querySelector(".ryp-label");
    if (label) label.textContent = reverseOn ? "Reverse: ON" : "Reverse";
  }

  /** Cosmetic only: visually reverse the sidebar list via CSS column-reverse. */
  function applyVisualOrder() {
    const items = document.querySelector("ytd-playlist-panel-renderer #items");
    if (items) items.classList.toggle(REVERSED_CLASS, reverseOn);
  }

  function findHeaderContainer() {
    for (const sel of SEL.headerCandidates) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return document.querySelector(SEL.panel);
  }

  function injectButton() {
    if (document.getElementById(BTN_ID)) return true;
    const container = findHeaderContainer();
    if (!container) return false;

    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.className = "ryp-btn";
    btn.type = "button";

    const icon = document.createElement("span");
    icon.className = "ryp-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "⮃";

    const label = document.createElement("span");
    label.className = "ryp-label";
    label.textContent = "Reverse";

    btn.append(icon, label);
    reflectButton(btn);

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      reverseOn = !reverseOn;
      log("toggled reverse:", reverseOn);
      reflectButton(btn);
      applyVisualOrder();
      const listId = getPlaylistId();
      if (listId) await saveState(listId, reverseOn);

      // On enable, jump to the last video and play backwards from there.
      if (reverseOn) {
        const items = readItems();
        const last = items.length ? items[items.length - 1].index : null;
        const cur = currentIndex();
        log("enable: last =", last, "current =", cur);
        if (last !== null && cur !== null && cur < last) goToIndex(last);
      }
    });

    container.appendChild(btn);
    log("button injected");
    return true;
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------
  function handleNavigation() {
    if (!isPlaylistWatchPage()) {
      lastIndex = null;
      navigating = false;
      return;
    }
    const idx = currentIndex();
    endHandled = false; // new video settled — re-arm the near-end trigger
    log("nav: index =", idx, "| last =", lastIndex, "| reverseOn =", reverseOn);

    // Fallback: forward "next"/autoplay advance the near-end trigger missed.
    if (reverseOn && !navigating && lastIndex !== null && idx === lastIndex + 1) {
      log("forward-advance caught -> step back");
      if (stepBackFrom(lastIndex)) return;
    }
    navigating = false;
    lastIndex = idx;
  }

  async function onNavigate() {
    if (isPlaylistWatchPage()) {
      reverseOn = await loadState(getPlaylistId());
      injectButton();
      applyVisualOrder();
    }
    handleNavigation();
  }

  // Re-inject the button whenever YouTube removes it (panel re-render, resize,
  // devtools open, navigation).
  const ensureObserver = new MutationObserver(() => {
    if (!isPlaylistWatchPage()) return;
    if (!document.getElementById(BTN_ID)) injectButton();
    applyVisualOrder(); // keep the cosmetic order applied across re-renders
  });
  ensureObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  window.addEventListener("yt-navigate-finish", onNavigate);
  document.addEventListener("yt-navigate-finish", onNavigate);
  onNavigate();
  log("content script loaded on", location.href);
})();
