(async () => {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;
  const listContainer = document.getElementById("playlist-list");

  // DOM creation helper (safe from XSS)
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "className") node.className = v;
      else if (k === "textContent") node.textContent = v;
      else node.setAttribute(k, v);
    }
    for (const child of children) {
      if (typeof child === "string") node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  async function renderPlaylists() {
    listContainer.replaceChildren();

    const data = await new Promise((resolve) => {
      api.storage.local.get("savedPlaylists", (res) => {
        resolve(res.savedPlaylists || []);
      });
    });

    if (data.length === 0) {
      const emptyIcon = el("div", { className: "empty-icon", textContent: "🎵" });
      const emptyText = el("p", { className: "empty-text", textContent: "No snapshots saved yet." });
      const emptyHint = el("p", { className: "empty-hint", textContent: "Open a YouTube playlist and use the My Lists panel to save one." });
      listContainer.appendChild(el("div", { className: "empty-state" }, [emptyIcon, emptyText, emptyHint]));
      return;
    }

    for (const pl of data) {
      const date = new Date(pl.savedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

      const nameEl = el("div", { className: "playlist-name", textContent: pl.name });
      nameEl.title = pl.name;
      const metaEl = el("div", {
        className: "playlist-meta",
        textContent: `${pl.order.length} videos · ${date}`,
      });
      const infoCol = el("div", { className: "playlist-info" }, [nameEl, metaEl]);

      const playBtn = el("button", {
        className: "action-play",
        title: "Play this playlist",
        textContent: "▶ Play",
      });

      const deleteBtn = el("button", {
        className: "action-delete",
        title: "Delete snapshot",
        textContent: "✕",
      });

      const actionsCol = el("div", { className: "playlist-actions" }, [playBtn, deleteBtn]);
      const card = el("div", { className: "playlist-card" }, [infoCol, actionsCol]);

      playBtn.addEventListener("click", () => {
        if (!pl.order || pl.order.length === 0) return;
        const firstIndex = pl.order[0];
        const firstVideo = pl.videos.find((v) => v.index === firstIndex);
        if (!firstVideo) return;

        // Custom order configuration is loaded by state.js upon loading the playlist watch page
        const url = `https://www.youtube.com/watch?v=${firstVideo.videoId}&list=${pl.sourceListId}&index=${firstIndex}`;

        api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const activeTab = tabs[0];
          if (
            activeTab &&
            (activeTab.url === "about:blank" ||
              activeTab.url === "about:newtab" ||
              activeTab.url.includes("youtube.com/"))
          ) {
            api.tabs.update(activeTab.id, { url: url });
          } else {
            api.tabs.create({ url: url });
          }
          window.close(); // Close popup
        });
      });

      deleteBtn.addEventListener("click", async () => {
        if (confirm(`Delete "${pl.name}"?`)) {
          api.storage.local.get("savedPlaylists", (res) => {
            let saved = res.savedPlaylists || [];
            saved = saved.filter((p) => p.id !== pl.id);
            api.storage.local.set({ savedPlaylists: saved }, () => {
              renderPlaylists();
            });
          });
        }
      });

      listContainer.appendChild(card);
    }
  }

  renderPlaylists();
})();
