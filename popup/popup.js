(async () => {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;
  const listContainer = document.getElementById("playlist-list");
  const deleteAllBtn = document.getElementById("delete-all-btn");
  const saveSection = document.getElementById("save-current-section");
  const saveInput = document.getElementById("save-input-popup");
  const saveConfirmBtn = document.getElementById("save-confirm-popup");

  let activeTabId = null;

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
      const emptyIcon = el("div", { className: "empty-icon", textContent: "🎵" });
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
        textContent: "▶ Play",
      });

      const renameBtn = el("button", {
        className: "action-rename",
        title: "Rename snapshot",
        textContent: "✏️",
      });

      const deleteBtn = el("button", {
        className: "action-delete",
        title: "Delete snapshot",
        textContent: "✕",
      });

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
