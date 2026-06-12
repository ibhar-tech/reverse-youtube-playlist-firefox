/*
 * YouTube Playlist Tools — import.js
 *
 * Dedicated import page, opened in a tab by the popup. A real tab is
 * required because Firefox closes browser-action popups as soon as the
 * OS file picker takes focus, so a file chosen from the popup never
 * arrives. Parsing/merging is shared with the popup and the in-page
 * panel via window.RYP.Backup (src/backup.js).
 */
(async () => {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;
  const Backup = window.RYP.Backup;

  const TRANSLATIONS = {
    en: {
      pageTitle: "Import — Playlist Tools",
      title: "Import saved playlists",
      hint: "Choose a backup file (.json) exported from Playlist Tools. Imported lists are merged with your existing ones — exact duplicates are skipped.",
      dropLabel: "Drop your backup file here, or click to browse",
      importDone: "✓ Imported {added} playlist(s), skipped {skipped} duplicate(s).",
      importInvalid: "Invalid backup file — nothing imported. Make sure you selected a .json file exported from Playlist Tools.",
      done: "Done"
    },
    fr: {
      pageTitle: "Importer — Outils Playlist",
      title: "Importer des playlists sauvegardées",
      hint: "Choisissez un fichier de sauvegarde (.json) exporté depuis Playlist Tools. Les listes importées sont fusionnées avec les vôtres — les doublons exacts sont ignorés.",
      dropLabel: "Déposez votre fichier ici, ou cliquez pour parcourir",
      importDone: "✓ {added} playlist(s) importée(s), {skipped} doublon(s) ignoré(s).",
      importInvalid: "Fichier de sauvegarde invalide — rien n'a été importé. Vérifiez qu'il s'agit d'un fichier .json exporté depuis Playlist Tools.",
      done: "Terminé"
    },
    ar: {
      pageTitle: "استيراد — أدوات قائمة التشغيل",
      title: "استيراد قوائم التشغيل المحفوظة",
      hint: "اختر ملف نسخ احتياطي (.json) تم تصديره من أدوات قائمة التشغيل. تُدمج القوائم المستوردة مع قوائمك الحالية — ويتم تخطي المكررات.",
      dropLabel: "أسقط ملف النسخ الاحتياطي هنا، أو انقر للاختيار",
      importDone: "✓ تم استيراد {added} قائمة، وتخطي {skipped} مكررة.",
      importInvalid: "ملف نسخ احتياطي غير صالح — لم يتم استيراد أي شيء. تأكد من اختيار ملف ‎.json تم تصديره من أدوات قائمة التشغيل.",
      done: "تم"
    }
  };

  const settings = (await api.storage.local.get("ryp_settings")).ryp_settings || {};
  const lang = settings.lang || "en";
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;

  // Apply language and direction
  document.documentElement.lang = lang;
  document.body.dir = lang === "ar" ? "rtl" : "ltr";
  document.title = dict.pageTitle;
  document.getElementById("import-title").textContent = dict.title;
  document.getElementById("import-hint").textContent = dict.hint;
  document.getElementById("drop-zone-label").textContent = dict.dropLabel;

  // Upload icon (matches the popup's icon set)
  const ns = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(ns, "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");
  icon.setAttribute("stroke-linecap", "round");
  icon.setAttribute("stroke-linejoin", "round");
  for (const [tag, attrs] of [
    ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }],
    ["polyline", { points: "17 8 12 3 7 8" }],
    ["line", { x1: "12", y1: "3", x2: "12", y2: "15" }],
  ]) {
    const node = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    icon.appendChild(node);
  }
  document.getElementById("import-icon").appendChild(icon);

  const dropZone = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");
  const successEl = document.getElementById("result-success");
  const errorEl = document.getElementById("result-error");
  const doneBtn = document.getElementById("done-btn");
  doneBtn.textContent = dict.done;

  async function importFile(file) {
    successEl.style.display = "none";
    errorEl.style.display = "none";
    try {
      const incoming = Backup.parseImport(await file.text());
      const res = await api.storage.local.get("savedPlaylists");
      const { merged, added, skipped } = Backup.mergeSnapshots(
        res.savedPlaylists || [],
        incoming
      );
      await api.storage.local.set({ savedPlaylists: merged });
      successEl.textContent = dict.importDone
        .replace("{added}", String(added))
        .replace("{skipped}", String(skipped));
      successEl.style.display = "block";
      doneBtn.style.display = "inline-flex";
    } catch (err) {
      console.warn("Import failed:", err);
      errorEl.textContent = dict.importInvalid;
      errorEl.style.display = "block";
    }
  }

  dropZone.addEventListener("click", () => fileInput.click());
  dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") fileInput.click();
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = ""; // allow re-selecting the same file
    if (file) importFile(file);
  });

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drop-zone-over");
  });
  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drop-zone-over");
  });
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drop-zone-over");
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) importFile(file);
  });

  doneBtn.addEventListener("click", () => window.close());
})();
