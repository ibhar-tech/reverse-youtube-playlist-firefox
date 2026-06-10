(async () => {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;
  const listContainer = document.getElementById("playlist-list");
  const deleteAllBtn = document.getElementById("delete-all-btn");
  const saveSection = document.getElementById("save-current-section");
  const saveInput = document.getElementById("save-input-popup");
  const saveConfirmBtn = document.getElementById("save-confirm-popup");
  const logoContainer = document.getElementById("popup-title-icon");

  let activeTabId = null;

  // ── SVG Helper & Icons ────────────────────────────────────────────────────
  function svg(className, viewBox, strokeWidth, paths) {
    const ns = "http://www.w3.org/2000/svg";
    const node = document.createElementNS(ns, "svg");
    node.setAttribute("class", className);
    node.setAttribute("viewBox", viewBox);
    node.setAttribute("fill", "none");
    node.setAttribute("stroke", "currentColor");
    node.setAttribute("stroke-width", String(strokeWidth));
    node.setAttribute("stroke-linecap", "round");
    node.setAttribute("stroke-linejoin", "round");
    
    for (const p of paths) {
      const pNode = document.createElementNS(ns, p.tag);
      for (const [attr, val] of Object.entries(p.attrs)) {
        pNode.setAttribute(attr, val);
      }
      node.appendChild(pNode);
    }
    return node;
  }

  const ICONS = {
    logo: () => svg("popup-icon-svg", "0 0 24 24", 2.2, [
      { tag: "polyline", attrs: { points: "17 1 21 5 17 9" } },
      { tag: "path", attrs: { d: "M3 11V9a4 4 0 0 1 4-4h14" } },
      { tag: "polyline", attrs: { points: "7 23 3 19 7 15" } },
      { tag: "path", attrs: { d: "M21 13v2a4 4 0 0 1-4 4H3" } }
    ]),
    save: () => svg("save-icon-svg", "0 0 24 24", 2.2, [
      { tag: "path", attrs: { d: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" } },
      { tag: "polyline", attrs: { points: "17 21 17 13 7 13 7 21" } },
      { tag: "polyline", attrs: { points: "7 3 7 8 15 8" } }
    ]),
    folder: () => svg("folder-icon-svg", "0 0 24 24", 2, [
      { tag: "path", attrs: { d: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" } }
    ]),
    play: () => svg("play-icon-svg", "0 0 24 24", 2, [
      { tag: "polygon", attrs: { points: "5 3 19 12 5 21 5 3" } }
    ]),
    edit: () => svg("edit-icon-svg", "0 0 24 24", 2, [
      { tag: "path", attrs: { d: "M12 20h9" } },
      { tag: "path", attrs: { d: "M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" } }
    ]),
    trash: () => svg("trash-icon-svg", "0 0 24 24", 2, [
      { tag: "polyline", attrs: { points: "3 6 5 6 21 6" } },
      { tag: "path", attrs: { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" } },
      { tag: "line", attrs: { x1: "10", y1: "11", x2: "10", y2: "17" } },
      { tag: "line", attrs: { x1: "14", y1: "11", x2: "14", y2: "17" } }
    ])
  };

  // Initialize static layout elements
  if (logoContainer) logoContainer.appendChild(ICONS.logo());
  if (saveConfirmBtn) {
    saveConfirmBtn.appendChild(ICONS.save());
    saveConfirmBtn.appendChild(document.createTextNode(" Save"));
  }

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

  // Check if active tab is a YouTube playlist page and show the save section
  api.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (activeTab && activeTab.url) {
      const url = activeTab.url;
      if (url.includes("youtube.com/") && (url.includes("list=") || url.includes("playlist?"))) {
        activeTabId = activeTab.id;
        saveSection.style.display = "block";
      }
    }
  });

  // Save current playlist state via message to content script (Create)
  saveConfirmBtn.addEventListener("click", () => {
    if (!activeTabId) return;
    const name = saveInput.value.trim();
    if (!name) {
      saveInput.classList.add("input-error");
      saveInput.focus();
      setTimeout(() => saveInput.classList.remove("input-error"), 1200);
      return;
    }

    api.tabs.sendMessage(activeTabId, { action: "SAVE_PLAYLIST", name: name }, (response) => {
      if (api.runtime.lastError) {
        alert("Cannot communicate with the YouTube tab. Please refresh the page and try again.");
        return;
      }
      if (response && response.success) {
        saveInput.value = "";
        renderPlaylists();
      } else {
        alert(response?.error || "Failed to save playlist state.");
      }
    });
  });

  // Render playlists list (Read)
  async function renderPlaylists() {
    listContainer.replaceChildren();

    const data = await new Promise((resolve) => {
      api.storage.local.get("savedPlaylists", (res) => {
        resolve(res.savedPlaylists || []);
      });
    });

    if (data.length === 0) {
      deleteAllBtn.style.display = "none";
      const emptyIcon = el("div", { className: "empty-icon" });
      emptyIcon.appendChild(ICONS.folder());
      const emptyText = el("p", { className: "empty-text", textContent: "No snapshots saved yet." });
      const emptyHint = el("p", { className: "empty-hint", textContent: "Open a YouTube playlist and use the Save button or panel to add one." });
      listContainer.appendChild(el("div", { className: "empty-state" }, [emptyIcon, emptyText, emptyHint]));
      return;
    }

    deleteAllBtn.style.display = "block";

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
      });
      playBtn.appendChild(ICONS.play());
      playBtn.appendChild(document.createTextNode(" Play"));

      const renameBtn = el("button", {
        className: "action-rename",
        title: "Rename snapshot",
      });
      renameBtn.appendChild(ICONS.edit());

      const deleteBtn = el("button", {
        className: "action-delete",
        title: "Delete snapshot",
      });
      deleteBtn.appendChild(ICONS.trash());

      const actionsCol = el("div", { className: "playlist-actions" }, [playBtn, renameBtn, deleteBtn]);
      const card = el("div", { className: "playlist-card" }, [infoCol, actionsCol]);

      // Play action
      playBtn.addEventListener("click", () => {
        if (!pl.order || pl.order.length === 0) return;
        const firstIndex = pl.order[0];
        const firstVideo = pl.videos.find((v) => v.index === firstIndex);
        if (!firstVideo) return;

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
          window.close();
        });
      });

      // Rename action (Update)
      renameBtn.addEventListener("click", () => {
        const newName = prompt("Rename this playlist snapshot to:", pl.name);
        if (newName === null) return; // cancelled
        const trimmed = newName.trim();
        if (!trimmed) {
          alert("Playlist name cannot be empty.");
          return;
        }

        api.storage.local.get("savedPlaylists", (res) => {
          const saved = res.savedPlaylists || [];
          const index = saved.findIndex((p) => p.id === pl.id);
          if (index !== -1) {
            saved[index].name = trimmed;
            api.storage.local.set({ savedPlaylists: saved }, () => {
              renderPlaylists();
            });
          }
        });
      });

      // Delete action (Delete)
      deleteBtn.addEventListener("click", () => {
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

  // Delete all action (Delete All)
  deleteAllBtn.addEventListener("click", () => {
    if (confirm("Are you sure you want to delete all saved playlist snapshots? This cannot be undone.")) {
      api.storage.local.set({ savedPlaylists: [] }, () => {
        renderPlaylists();
      });
    }
  });

  renderPlaylists();
})();
