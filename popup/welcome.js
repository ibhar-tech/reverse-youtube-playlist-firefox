/*
 * YouTube Playlist Tools — welcome.js
 *
 * First-run page, opened by background.js on install and from the popup's
 * "Guide & shortcuts" button: language, a three-step guide, the current
 * keyboard shortcuts, and which toolbar buttons to show.
 */
(async () => {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;

  const BUTTON_KEYS = ["reverse", "shuffle", "sort", "reorder", "reset", "save", "myLists", "duration", "loadAll", "addVideo"];

  const TRANSLATIONS = {
    en: {
      pageTitle: "Welcome — Playlist Tools",
      title: "Welcome to Playlist Tools",
      lede: "Reverse, shuffle, sort and save any YouTube playlist — free, private, no login.",
      langHeading: "Language",
      stepsHeading: "How it works",
      step1Title: "Open any YouTube playlist",
      step1Body: "The toolbar appears at the top of the playlist panel, beside the video.",
      step2Title: "Pick an order",
      step2Body: "Reverse plays last to first, Shuffle keeps one random order, Sort goes by title, length, channel or watched.",
      step3Title: "Build your own lists",
      step3Body: "Click ＋ Add to Playlist under any video to collect it into a local playlist that lives only in your browser.",
      keysHeading: "Keyboard shortcuts",
      changeKeys: "Change shortcuts",
      keyUnset: "Not set",
      buttonsHeading: "Buttons to show",
      buttonsHint: "Untick the ones you never use. You can change this later in the popup's settings.",
      privacy: "Everything stays in your browser: no account, no YouTube API, no tracking.",
      openYouTube: "Open YouTube",
      reverse: "Reverse", shuffle: "Shuffle", sort: "Sort", reorder: "Reorder", reset: "Reset",
      save: "Save", myLists: "My Lists", duration: "Duration", loadAll: "Load All", addVideo: "Add to Playlist",
    },
    fr: {
      pageTitle: "Bienvenue — Outils Playlist",
      title: "Bienvenue dans Playlist Tools",
      lede: "Inversez, mélangez, triez et enregistrez n'importe quelle playlist YouTube — gratuit, privé, sans compte.",
      langHeading: "Langue",
      stepsHeading: "Comment ça marche",
      step1Title: "Ouvrez une playlist YouTube",
      step1Body: "La barre d'outils apparaît en haut du panneau de la playlist, à côté de la vidéo.",
      step2Title: "Choisissez un ordre",
      step2Body: "Inverser lit de la dernière à la première, Mélanger garde un ordre aléatoire, Trier classe par titre, durée, chaîne ou vu.",
      step3Title: "Créez vos propres listes",
      step3Body: "Cliquez sur ＋ Ajouter à la playlist sous une vidéo pour la ranger dans une playlist locale, gardée uniquement dans votre navigateur.",
      keysHeading: "Raccourcis clavier",
      changeKeys: "Modifier les raccourcis",
      keyUnset: "Non défini",
      buttonsHeading: "Boutons à afficher",
      buttonsHint: "Décochez ceux que vous n'utilisez jamais. Modifiable plus tard dans les paramètres du popup.",
      privacy: "Tout reste dans votre navigateur : aucun compte, aucune API YouTube, aucun suivi.",
      openYouTube: "Ouvrir YouTube",
      reverse: "Inverser", shuffle: "Mélanger", sort: "Trier", reorder: "Réorganiser", reset: "Réinitialiser",
      save: "Enregistrer", myLists: "Mes listes", duration: "Durée", loadAll: "Tout charger", addVideo: "Ajouter à la playlist",
    },
    ar: {
      pageTitle: "مرحبًا — أدوات قائمة التشغيل",
      title: "مرحبًا بك في أدوات قائمة التشغيل",
      lede: "اعكس واخلط ورتّب واحفظ أي قائمة تشغيل على يوتيوب — مجانًا، بخصوصية تامة، وبدون تسجيل.",
      langHeading: "اللغة",
      stepsHeading: "طريقة الاستخدام",
      step1Title: "افتح أي قائمة تشغيل على يوتيوب",
      step1Body: "يظهر شريط الأدوات أعلى لوحة قائمة التشغيل بجانب الفيديو.",
      step2Title: "اختر ترتيب التشغيل",
      step2Body: "العكس يشغّل من الأخير إلى الأول، والخلط يحفظ ترتيبًا عشوائيًا واحدًا، والفرز حسب العنوان أو المدة أو القناة أو المشاهدة.",
      step3Title: "أنشئ قوائمك الخاصة",
      step3Body: "اضغط ＋ إضافة إلى قائمة التشغيل أسفل أي فيديو لجمعه في قائمة محلية محفوظة في متصفحك فقط.",
      keysHeading: "اختصارات لوحة المفاتيح",
      changeKeys: "تغيير الاختصارات",
      keyUnset: "غير محدد",
      buttonsHeading: "الأزرار الظاهرة",
      buttonsHint: "ألغِ تحديد الأزرار التي لا تستخدمها. يمكنك تغيير ذلك لاحقًا من إعدادات النافذة المنبثقة.",
      privacy: "كل شيء يبقى في متصفحك: بلا حساب، بلا واجهة يوتيوب البرمجية، بلا تتبع.",
      openYouTube: "افتح يوتيوب",
      reverse: "عكس", shuffle: "خلط", sort: "فرز", reorder: "إعادة ترتيب", reset: "إعادة تعيين",
      save: "حفظ", myLists: "قوائمي", duration: "المدة", loadAll: "تحميل الكل", addVideo: "إضافة إلى قائمة التشغيل",
    },
  };

  const res = await api.storage.local.get("ryp_settings");
  let settings = res.ryp_settings || {};
  const ui = (api.i18n?.getUILanguage?.() || "en").toLowerCase();
  let lang = settings.lang || (ui.startsWith("ar") ? "ar" : ui.startsWith("fr") ? "fr" : "en");

  async function saveSettings(patch) {
    // Re-read so a change made in the popup meanwhile is not overwritten.
    const latest = (await api.storage.local.get("ryp_settings")).ryp_settings || {};
    settings = { ...latest, ...patch };
    await api.storage.local.set({ ryp_settings: settings });
  }

  function dict() {
    return TRANSLATIONS[lang] || TRANSLATIONS.en;
  }

  async function renderKeys() {
    const body = document.getElementById("keys-body");
    if (!body || !api.commands?.getAll) return;
    const commands = await api.commands.getAll();
    body.replaceChildren();
    for (const cmd of commands) {
      if (!cmd.description) continue;
      const tr = document.createElement("tr");
      const what = document.createElement("td");
      what.textContent = cmd.description;
      const key = document.createElement("td");
      if (cmd.shortcut) {
        const kbd = document.createElement("kbd");
        kbd.textContent = cmd.shortcut;
        key.appendChild(kbd);
      } else {
        const unset = document.createElement("span");
        unset.className = "unset";
        unset.textContent = dict().keyUnset;
        key.appendChild(unset);
      }
      tr.append(what, key);
      body.appendChild(tr);
    }
  }

  function renderButtons() {
    const grid = document.getElementById("btn-grid");
    const vis = settings.buttonVisibility || {};
    grid.replaceChildren();
    for (const key of BUTTON_KEYS) {
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = vis[key] !== false;
      box.addEventListener("change", async () => {
        // Build on the stored value, not this page's copy: the popup may
        // have changed other buttons while this tab was open.
        const latest = (await api.storage.local.get("ryp_settings")).ryp_settings || {};
        const next = { ...(latest.buttonVisibility || {}), [key]: box.checked };
        await saveSettings({ buttonVisibility: next });
      });
      const text = document.createElement("span");
      text.textContent = dict()[key];
      label.append(box, text);
      grid.appendChild(label);
    }
  }

  function render() {
    const d = dict();
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.title = d.pageTitle;
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      const text = d[node.getAttribute("data-i18n")];
      if (text) node.textContent = text;
    });
    document.querySelectorAll(".lang-btn").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.lang === lang));
    });
    renderButtons();
    renderKeys();
  }

  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      lang = btn.dataset.lang;
      await saveSettings({ lang });
      render();
    });
  });

  document.getElementById("change-keys").addEventListener("click", () => {
    if (api.commands?.openShortcutSettings) {
      api.commands.openShortcutSettings(); // Firefox 137+
      return;
    }
    const scheme = /\bEdg\//.test(navigator.userAgent) ? "edge" : "chrome";
    api.tabs.create({ url: `${scheme}://extensions/shortcuts` });
  });

  // Shortcut names come from the browser in its UI language; re-read them
  // when the page regains focus in case the user just rebound one.
  window.addEventListener("focus", renderKeys);

  render();
})();
