(async () => {
  /*
   * External resources
   */
  const DEFUDDLE_URL = "https://unpkg.com/defuddle@latest/dist/index.js";
  const SCRIPT_URL = "https://example.com/paginate-reader.js";
  const STORAGE_KEY = "paginateReaderStyleV12";
  const NEWSREADER_CSS =
    "https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400..700&display=swap";

  /*
   * Default reader settings
   */
  const DEFAULTS = {
    frameMode: "centered",
    columnWidth: 21,
    fontSize: 21,
    lineHeight: 1.55,
    padding: 32,
    scrollerInset: 0,
    fontFamily: "original",
    theme: "light",
    textAlign: "left",
    hyphenation: "off",
    suppressAnimations: "on",
  };

  /*
   * Theme palette model
   * Everything visual should derive from these values.
   */
  const THEMES = {
    light: {
      bg: "#ffffff",
      fg: "#111111",
      link: "#0645ad",
      panelBg: "#ffffff",
      chipBg: "#ffffff",
      controlBg: "#ffffff",
      controlFg: "#111111",
      shellBg: "#ffffff",
      themeColor: "#ffffff",
    },
    sepia: {
      bg: "#f4ecd8",
      fg: "#3e2f1f",
      link: "#7a4b17",
      panelBg: "#f4ecd8",
      chipBg: "#f4ecd8",
      controlBg: "#f4ecd8",
      controlFg: "#3e2f1f",
      shellBg: "#f4ecd8",
      themeColor: "#f4ecd8",
    },
    dark: {
      bg: "#111111",
      fg: "#f3f1eb",
      link: "#8ab4ff",
      panelBg: "#111111",
      chipBg: "#111111",
      controlBg: "#1c1c1c",
      controlFg: "#f3f1eb",
      shellBg: "#111111",
      themeColor: "#111111",
    },
  };

  /*
   * Prevent running twice on the same page.
   */
  if (window.__PAGINATE_BOOKMARKLET_ACTIVE__) return;
  window.__PAGINATE_BOOKMARKLET_ACTIVE__ = true;

  /*
   * Utility: dynamically load a script.
   */
  const loadScript = (src) =>
    new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Failed to load " + src));
      document.head.appendChild(s);
    });

  /*
   * Utility: wait until fonts are ready before measuring layout.
   */
  const waitForFonts = async () => {
    if (document.fonts?.ready) {
      try {
        await document.fonts.ready;
      } catch {}
    }
  };

  /*
   * Utility: wait until images are ready before measuring layout.
   */
  const waitForImages = async (root) => {
    const imgs = [...root.querySelectorAll("img")];
    await Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              img.addEventListener("load", resolve, { once: true });
              img.addEventListener("error", resolve, { once: true });
            })
      )
    );
  };

  /*
   * Utility: escape text before injecting into HTML strings.
   */
  const escapeHtml = (s) =>
    String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  /*
   * Utility: absolutize links/src attributes in extracted content.
   */
  const normalizeRelativeUrls = (doc, baseUrl) => {
    const attrs = [
      ["a", "href"],
      ["img", "src"],
      ["source", "src"],
      ["video", "src"],
      ["audio", "src"],
      ["iframe", "src"],
      ["link", "href"],
    ];

    for (const [selector, attr] of attrs) {
      doc.querySelectorAll(selector).forEach((el) => {
        const value = el.getAttribute(attr);
        if (!value) return;

        if (
          /^(https?:)?\/\//i.test(value) ||
          value.startsWith("data:") ||
          value.startsWith("blob:") ||
          value.startsWith("mailto:") ||
          value.startsWith("tel:")
        ) {
          return;
        }

        try {
          el.setAttribute(attr, new URL(value, baseUrl).href);
        } catch {}
      });
    }
  };

  /*
   * Persistence helpers
   */
  const loadSavedSettings = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  };

  const saveSettings = (settings) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {}
  };

  /*
   * Lazily load Newsreader only when selected.
   */
  const ensureNewsreader = () => {
    if (document.getElementById("pg-newsreader-font")) return;

    const link = document.createElement("link");
    link.id = "pg-newsreader-font";
    link.rel = "stylesheet";
    link.href = NEWSREADER_CSS;
    document.head.appendChild(link);
  };

  /*
   * Small helpers
   */
  const mergeSettings = (base, extra) => ({ ...base, ...(extra || {}) });

  const isInteractiveTarget = (el) =>
    !!el?.closest?.(
      'a[href],button,input,select,textarea,label,summary,[role="button"],audio,video'
    );

  const formatDate = (value) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);

    try {
      return d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return d.toISOString().slice(0, 10);
    }
  };

  /*
   * Export helper: generate a bookmarklet that reloads this script with settings.
   */
  const makeBookmarkletUrl = (settings) => {
    const encoded = encodeURIComponent(JSON.stringify(settings));
    return `javascript:(()=>{var s=document.createElement('script');s.src='${SCRIPT_URL}?settings=${encoded}';document.head.appendChild(s)})()`;
  };

  const copyText = async (text) => {
    if (!navigator.clipboard?.writeText) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  try {
    /*
     * 1. Load Defuddle if not present
     */
    if (!window.Defuddle) {
      await loadScript(DEFUDDLE_URL);
    }

    /*
     * 2. Snapshot the page and capture original colors/fonts
     */
    const html = document.documentElement.outerHTML;
    const originalComputed = window.getComputedStyle(
      document.body || document.documentElement
    );
    const originalFontFamily = originalComputed.fontFamily || "serif";
    const originalBodyBg = originalComputed.backgroundColor || "#ffffff";
    const originalBodyColor = originalComputed.color || "#111111";

    /*
     * 3. Parse a detached copy and normalize URLs
     */
    const parser = new DOMParser();
    const sourceDoc = parser.parseFromString(html, "text/html");
    normalizeRelativeUrls(sourceDoc, location.href);

    /*
     * 4. Extract main article via Defuddle
     */
    let article = null;
    const DefuddleExport = window.Defuddle || window.defuddle || window.default;

    if (typeof DefuddleExport === "function") {
      try {
        const instance = new DefuddleExport(sourceDoc);
        article =
          typeof instance.parse === "function" ? await instance.parse() : null;
      } catch {
        article = null;
      }
    }

    if (!article && typeof DefuddleExport?.parse === "function") {
      try {
        article = await DefuddleExport.parse(sourceDoc, { url: location.href });
      } catch {}
    }

    /*
     * 5. Fall back to raw body HTML if extraction is incomplete
     */
    const articleHtml = article?.content || sourceDoc.body.innerHTML || "";
    const articleTitle = article?.title || document.title || "";
    const articleAuthor = article?.author || article?.byline || "";
    const articlePublished = article?.published || article?.date || "";
    const articleDescription = article?.description || "";

    /*
     * 6. Build rich article header
     */
    const metaBits = [];
    if (articleAuthor) {
      metaBits.push(
        `<span class="pg-meta-author">${escapeHtml(articleAuthor)}</span>`
      );
    }
    if (articlePublished) {
      metaBits.push(
        `<time class="pg-meta-date">${escapeHtml(
          formatDate(articlePublished)
        )}</time>`
      );
    }

    const articleHeaderHtml = `
      <header id="pg-article-header">
        ${articleTitle ? `<h1 id="pg-title">${escapeHtml(articleTitle)}</h1>` : ""}
        ${
          metaBits.length
            ? `<div id="pg-meta">${metaBits.join(
                '<span class="pg-meta-sep"> • </span>'
              )}</div>`
            : ""
        }
        ${
          articleDescription
            ? `<p id="pg-description">${escapeHtml(articleDescription)}</p>`
            : ""
        }
      </header>
    `;

    /*
     * 7. Preserve original page so Exit/Escape can restore it
     */
    const originalHtml = document.documentElement.innerHTML;

    /*
     * 8. Clear page and replace with reader app
     */
    document.documentElement.innerHTML = "";

    /*
     * 9. CSS for the whole reader
     */
    const style = document.createElement("style");
    style.textContent = `
html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--pg-shell-bg);
  color: var(--pg-fg);
  font-family: var(--pg-font-family);
}

#pg-root, #pg-shell {
  width: 100%;
  height: 100%;
}

#pg-root {
  position: fixed;
  inset: 0;
  z-index: 2147483647;

  --pg-column-width: 21em;
  --pg-font-size: 21px;
  --pg-line-height: 1.55;
  --pg-pad-x: 32px;
  --pg-pad-y: 24px;
  --pg-scroller-inset: 0px;

  --pg-font-family: serif;
  --pg-text-align: left;
  --pg-hyphens: manual;

  --pg-bg: #ffffff;
  --pg-fg: #111111;
  --pg-link: #0645ad;

  --pg-shell-bg: #ffffff;
  --pg-panel-bg: #ffffff;
  --pg-chip-bg: #ffffff;
  --pg-control-bg: #ffffff;
  --pg-control-fg: #111111;

  --pg-frame-radius: 0px;
  --pg-frame-shadow: none;
  --pg-frame-border: 0;
  --pg-frame-width: 100vw;

  background: var(--pg-shell-bg);
  color: var(--pg-fg);
  font-family: var(--pg-font-family);
}

#pg-root * {
  box-sizing: border-box;
}

#pg-shell {
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--pg-shell-bg);
}

#pg-frame {
  position: relative;
  width: var(--pg-frame-width);
  height: 100%;
  background: var(--pg-bg);
  border-radius: var(--pg-frame-radius);
  box-shadow: var(--pg-frame-shadow);
  border: var(--pg-frame-border);
  overflow: hidden;
}

#pg-viewport {
  width: 100%;
  height: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-behavior: auto;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  position: relative;
  touch-action: pan-y pinch-zoom;
}

#pg-viewport::-webkit-scrollbar {
  display: none;
}

#pg-track {
  height: 100%;
  position: relative;
  width: 100%;
}

#pg-scroller {
  height: 100%;
  padding-top: var(--pg-scroller-inset);
  padding-bottom: var(--pg-scroller-inset);
  column-width: var(--pg-column-width);
  column-gap: 0;
  column-fill: auto;
  overflow: visible;
}

#pg-content {
  min-height: 100%;
  margin: 0;
  padding-left: var(--pg-pad-x);
  padding-right: var(--pg-pad-x);
  padding-top: calc(var(--pg-pad-y) + env(safe-area-inset-top, 0px) + 10px);
  padding-bottom: calc(var(--pg-pad-y) + env(safe-area-inset-bottom, 0px) + 22px);

  font-size: var(--pg-font-size);
  line-height: var(--pg-line-height);
  font-family: var(--pg-font-family);
  font-weight: 450;
  text-align: var(--pg-text-align);
  hyphens: var(--pg-hyphens);
  -webkit-hyphens: var(--pg-hyphens);
  overflow-wrap: break-word;

  color: var(--pg-fg);
  background: var(--pg-bg);
}

#pg-article-header {
  margin: 0 0 1.25em 0;
  break-inside: avoid;
  page-break-inside: avoid;
  -webkit-column-break-inside: avoid;
}

#pg-title {
  margin: 0 0 .35em 0;
}

#pg-meta {
  margin: 0 0 .7em 0;
  font-size: .78em;
  line-height: 1.35;
  font-style: italic;
  opacity: .8;
  text-align: center;
}

#pg-description {
  margin: .2em auto 0 auto;
  max-width: 32em;
  font-size: .9em;
  line-height: 1.45;
  text-align: center;
  opacity: .92;
}

.pg-meta-sep {
  opacity: .55;
}

#pg-content,
#pg-content p,
#pg-content li,
#pg-content blockquote,
#pg-content figcaption,
#pg-content td,
#pg-content th,
#pg-content pre,
#pg-content code,
#pg-content h1,
#pg-content h2,
#pg-content h3,
#pg-content h4,
#pg-content h5,
#pg-content h6 {
  color: var(--pg-fg);
}

#pg-content h1,
#pg-content h2,
#pg-content h3,
#pg-content h4,
#pg-content h5,
#pg-content h6 {
  text-align: center !important;
  line-height: 1.1 !important;
  hyphens: none !important;
  -webkit-hyphens: none !important;
  break-inside: avoid;
  page-break-inside: avoid;
  -webkit-column-break-inside: avoid;
}

#pg-content p,
#pg-content li,
#pg-content blockquote {
  hyphens: var(--pg-hyphens);
  -webkit-hyphens: var(--pg-hyphens);
  text-align: var(--pg-text-align);
}

#pg-content a {
  color: var(--pg-link);
}

#pg-content figure,
#pg-content picture,
#pg-content svg,
#pg-content canvas,
#pg-content video,
#pg-content iframe,
#pg-content table,
#pg-content pre,
#pg-content blockquote,
#pg-content ul,
#pg-content ol,
#pg-content li {
  break-inside: avoid;
  page-break-inside: avoid;
  -webkit-column-break-inside: avoid;
}

#pg-content img {
  display: block;
  width: 100%;
  max-width: 100%;
  height: auto;
  max-height: 80vh;
  object-fit: contain;
  break-inside: avoid;
  page-break-inside: avoid;
  -webkit-column-break-inside: avoid;
}

#pg-content figure img,
#pg-content p img:only-child,
#pg-content a img:only-child {
  width: 100%;
  max-width: 100%;
  height: auto;
  max-height: 80vh;
  object-fit: contain;
}

#pg-content figure {
  margin: 1em 0;
  max-width: 100%;
}

#pg-content figcaption,
#pg-content .caption,
#pg-content .figcaption,
#pg-content .image-caption,
#pg-content .photo-caption,
#pg-content .media-caption,
#pg-content .wp-caption-text,
#pg-content .credit,
#pg-content .credits,
#pg-content .byline,
#pg-content .photo-credit,
#pg-content .image-credit,
#pg-content [class*="caption"],
#pg-content [class*="credit"] {
  margin-top: .45em;
  font-size: .7em !important;
  line-height: 1.35 !important;
  font-style: italic !important;
  opacity: .88;
}

#pg-content table {
  width: 100%;
  border-collapse: collapse;
  display: block;
  overflow-x: auto;
}

#pg-content pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  hyphens: none;
  -webkit-hyphens: none;
  text-align: left;
}

#pg-content code {
  overflow-wrap: anywhere;
  hyphens: none;
  -webkit-hyphens: none;
}

#pg-content p {
  orphans: 2;
  widows: 2;
}

#pg-tools-btn,
#pg-page-info {
  position: fixed;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 5px);
  z-index: 2147483647;
  background: var(--pg-chip-bg);
  color: var(--pg-fg);
  border: 1px solid rgba(0, 0, 0, .14);
  border-radius: 999px;
  backdrop-filter: blur(6px);
}

#pg-tools-btn {
  left: 10px;
  appearance: none;
  padding: 7px 9px;
  font: 14px/1 system-ui, sans-serif;
  cursor: pointer;
  opacity: .78;
}

#pg-tools-btn:hover {
  opacity: 1;
}

#pg-page-info {
  right: 10px;
  padding: 6px 10px;
  font: 11px/1.1 system-ui, sans-serif;
  opacity: .82;
  pointer-events: none;
}

#pg-panel {
  position: fixed;
  left: 10px;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 36px);
  z-index: 2147483647;
  width: min(360px, calc(100vw - 20px));
  max-height: min(80vh, 680px);
  overflow: auto;
  padding: 10px;

  background: var(--pg-panel-bg);
  color: var(--pg-fg);
  border: 1px solid rgba(0, 0, 0, .12);
  border-radius: 14px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, .10);
  backdrop-filter: blur(10px);

  font: 12px/1.3 system-ui, sans-serif;
}

#pg-panel[hidden] {
  display: none;
}

#pg-panel .pg-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
  margin: 0 0 8px 0;
}

#pg-panel .pg-row:last-child {
  margin-bottom: 0;
}

#pg-panel input[type="range"],
#pg-panel select {
  width: 150px;
}

#pg-panel select,
#pg-panel button {
  background: var(--pg-control-bg);
  color: var(--pg-control-fg);
}

#pg-panel select {
  padding: 2px 4px;
  border: 1px solid rgba(0, 0, 0, .14);
  border-radius: 8px;
}

#pg-panel .pg-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  margin-top: 10px;
  flex-wrap: wrap;
}

#pg-panel button {
  appearance: none;
  border: 1px solid rgba(0, 0, 0, .14);
  border-radius: 999px;
  padding: 5px 8px;
  font: inherit;
  cursor: pointer;
}

.pg-no-anim,
.pg-no-anim *,
.pg-no-anim *::before,
.pg-no-anim *::after {
  animation: none !important;
  transition: none !important;
  scroll-behavior: auto !important;
}
`;
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    document.head.appendChild(style);

    /*
     * 10. Build reader DOM
     */
    const root = document.createElement("div");
    root.id = "pg-root";

    const shell = document.createElement("div");
    shell.id = "pg-shell";

    const frame = document.createElement("div");
    frame.id = "pg-frame";

    const viewport = document.createElement("div");
    viewport.id = "pg-viewport";

    const track = document.createElement("div");
    track.id = "pg-track";

    const scroller = document.createElement("div");
    scroller.id = "pg-scroller";

    const content = document.createElement("article");
    content.id = "pg-content";
    content.lang = document.documentElement.lang || navigator.language || "en";
    content.innerHTML = articleHeaderHtml + articleHtml;

    const toolsBtn = document.createElement("button");
    toolsBtn.id = "pg-tools-btn";
    toolsBtn.type = "button";
    toolsBtn.textContent = "🔧";

    const pageInfo = document.createElement("div");
    pageInfo.id = "pg-page-info";
    pageInfo.textContent = "1 / 1";

    const panel = document.createElement("div");
    panel.id = "pg-panel";
    panel.hidden = true;
    panel.innerHTML = `
      <div class="pg-row"><label for="pg-frame-mode">Frame</label><select id="pg-frame-mode"><option value="full">Full width</option><option value="centered">Centered</option></select></div>
      <div class="pg-row"><label for="pg-col-width">Column width</label><input id="pg-col-width" type="range" min="14" max="32" step="0.5"></div>
      <div class="pg-row"><label for="pg-font-size">Font size</label><input id="pg-font-size" type="range" min="14" max="34" step="1"></div>
      <div class="pg-row"><label for="pg-line-height">Line height</label><input id="pg-line-height" type="range" min="1.2" max="2" step="0.05"></div>
      <div class="pg-row"><label for="pg-padding">Page padding</label><input id="pg-padding" type="range" min="8" max="64" step="2"></div>
      <div class="pg-row"><label for="pg-scroller-inset">Top/bottom inset</label><input id="pg-scroller-inset" type="range" min="0" max="64" step="2"></div>
      <div class="pg-row"><label for="pg-font-family">Font</label><select id="pg-font-family"><option value="original">Original</option><option value="serif">System serif</option><option value="sans">System sans</option><option value="newsreader">Newsreader</option></select></div>
      <div class="pg-row"><label for="pg-theme">Theme</label><select id="pg-theme"><option value="original">Original</option><option value="light">Light</option><option value="sepia">Sepia</option><option value="dark">Dark</option></select></div>
      <div class="pg-row"><label for="pg-text-align">Text align</label><select id="pg-text-align"><option value="left">Left</option><option value="justify">Justify</option></select></div>
      <div class="pg-row"><label for="pg-hyphenation">Hyphenation</label><select id="pg-hyphenation"><option value="off">Off</option><option value="auto">Auto</option></select></div>
      <div class="pg-row"><label for="pg-suppress-animations">Suppress animations</label><select id="pg-suppress-animations"><option value="on">On</option><option value="off">Off</option></select></div>
      <div class="pg-actions">
        <button type="button" id="pg-export">Export</button>
        <button type="button" id="pg-reset">Reset</button>
        <button type="button" id="pg-close">Close</button>
        <button type="button" id="pg-exit">Exit</button>
      </div>
    `;

    scroller.appendChild(content);
    track.appendChild(scroller);
    viewport.appendChild(track);
    frame.appendChild(viewport);
    shell.appendChild(frame);
    root.appendChild(shell);
    root.appendChild(toolsBtn);
    root.appendChild(pageInfo);
    root.appendChild(panel);
    document.body.appendChild(root);

    /*
     * 11. Wait for layout-sensitive assets
     */
    await waitForFonts();
    await waitForImages(root);

    /*
     * 12. Mutable runtime state
     */
    let currentIndex = 0;
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let horizontalGesture = false;
    let verticalGesture = false;
    let startTarget = null;
    let resizeObserver = null;
    let reflowTimer = 0;
    let wheelLock = false;
    let previousThemeMetaContent = null;

    /*
     * 13. Panel controls
     */
    const frameModeSelect = panel.querySelector("#pg-frame-mode");
    const colWidthInput = panel.querySelector("#pg-col-width");
    const fontSizeInput = panel.querySelector("#pg-font-size");
    const lineHeightInput = panel.querySelector("#pg-line-height");
    const paddingInput = panel.querySelector("#pg-padding");
    const scrollerInsetInput = panel.querySelector("#pg-scroller-inset");
    const fontFamilySelect = panel.querySelector("#pg-font-family");
    const themeSelect = panel.querySelector("#pg-theme");
    const textAlignSelect = panel.querySelector("#pg-text-align");
    const hyphenationSelect = panel.querySelector("#pg-hyphenation");
    const suppressAnimationsSelect = panel.querySelector("#pg-suppress-animations");
    const exportBtn = panel.querySelector("#pg-export");
    const resetBtn = panel.querySelector("#pg-reset");
    const closeBtn = panel.querySelector("#pg-close");
    const exitBtn = panel.querySelector("#pg-exit");

    /*
     * 14. Initialize settings
     */
    const saved = mergeSettings(DEFAULTS, loadSavedSettings());
    frameModeSelect.value = String(saved.frameMode);
    colWidthInput.value = String(saved.columnWidth);
    fontSizeInput.value = String(saved.fontSize);
    lineHeightInput.value = String(saved.lineHeight);
    paddingInput.value = String(saved.padding);
    scrollerInsetInput.value = String(saved.scrollerInset);
    fontFamilySelect.value = String(saved.fontFamily);
    themeSelect.value = String(saved.theme);
    textAlignSelect.value = String(saved.textAlign);
    hyphenationSelect.value = String(saved.hyphenation);
    suppressAnimationsSelect.value = String(saved.suppressAnimations);

    /*
     * 15. Layout and settings helpers
     */
    const animationsOff = () => suppressAnimationsSelect.value === "on";

    const getShellWidth = () =>
      Math.max(
        1,
        Math.round(
          (window.visualViewport && window.visualViewport.width) ||
            window.innerWidth ||
            document.documentElement.clientWidth ||
            1
        )
      );

    const getShellHeight = () =>
      Math.max(
        1,
        Math.round(
          (window.visualViewport && window.visualViewport.height) ||
            window.innerHeight ||
            document.documentElement.clientHeight ||
            1
        )
      );

    const getFrameWidth = () => frame.clientWidth || getShellWidth();

    const currentSettings = () => ({
      frameMode: frameModeSelect.value,
      columnWidth: parseFloat(colWidthInput.value),
      fontSize: parseFloat(fontSizeInput.value),
      lineHeight: parseFloat(lineHeightInput.value),
      padding: parseFloat(paddingInput.value),
      scrollerInset: parseFloat(scrollerInsetInput.value),
      fontFamily: fontFamilySelect.value,
      theme: themeSelect.value,
      textAlign: textAlignSelect.value,
      hyphenation: hyphenationSelect.value,
      suppressAnimations: suppressAnimationsSelect.value,
    });

    /*
     * Theme resolution
     */
    const getThemePalette = (themeName) => {
      if (themeName === "original") {
        return {
          bg: originalBodyBg,
          fg: originalBodyColor,
          link: "#0645ad",
          panelBg: originalBodyBg,
          chipBg: originalBodyBg,
          controlBg: originalBodyBg,
          controlFg: originalBodyColor,
          shellBg: originalBodyBg,
          themeColor: originalBodyBg,
        };
      }

      return THEMES[themeName] || THEMES.light;
    };

    const applyBrowserThemeColor = (color) => {
      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = "theme-color";
        document.head.appendChild(meta);
      }

      if (previousThemeMetaContent === null) {
        previousThemeMetaContent = meta.getAttribute("content");
      }

      meta.setAttribute("content", color);
    };

    const applyPalette = (palette) => {
      root.style.setProperty("--pg-bg", palette.bg);
      root.style.setProperty("--pg-fg", palette.fg);
      root.style.setProperty("--pg-link", palette.link);
      root.style.setProperty("--pg-shell-bg", palette.shellBg);
      root.style.setProperty("--pg-panel-bg", palette.panelBg);
      root.style.setProperty("--pg-chip-bg", palette.chipBg);
      root.style.setProperty("--pg-control-bg", palette.controlBg);
      root.style.setProperty("--pg-control-fg", palette.controlFg);
      applyBrowserThemeColor(palette.themeColor || palette.bg);
    };

    const applyTheme = () => {
      applyPalette(getThemePalette(themeSelect.value));
    };

    /*
     * Font resolution
     */
    const applyFont = () => {
      switch (fontFamilySelect.value) {
        case "original":
          root.style.setProperty("--pg-font-family", originalFontFamily);
          break;
        case "sans":
          root.style.setProperty(
            "--pg-font-family",
            'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'
          );
          break;
        case "newsreader":
          ensureNewsreader();
          root.style.setProperty(
            "--pg-font-family",
            '"Newsreader",Georgia,Cambria,"Times New Roman",Times,serif'
          );
          break;
        default:
          root.style.setProperty(
            "--pg-font-family",
            'ui-serif,Georgia,Cambria,"Times New Roman",Times,serif'
          );
      }
    };

    const applyTextFlow = () => {
      root.style.setProperty(
        "--pg-text-align",
        textAlignSelect.value === "justify" ? "justify" : "left"
      );
      root.style.setProperty(
        "--pg-hyphens",
        hyphenationSelect.value === "auto" ? "auto" : "manual"
      );
    };

    const applyAnimationSetting = () => {
      root.classList.toggle("pg-no-anim", animationsOff());
    };

    const applyFrameMode = () => {
      /*
       * Currently frame styling is intentionally invisible.
       * Only width behavior changes between modes.
       */
      root.style.setProperty("--pg-frame-radius", "0px");
      root.style.setProperty("--pg-frame-shadow", "none");
      root.style.setProperty("--pg-frame-border", "0");
    };

    const applySettings = () => {
      root.style.setProperty("--pg-column-width", colWidthInput.value + "em");
      root.style.setProperty("--pg-font-size", fontSizeInput.value + "px");
      root.style.setProperty("--pg-line-height", lineHeightInput.value);
      root.style.setProperty("--pg-pad-x", paddingInput.value + "px");
      root.style.setProperty(
        "--pg-pad-y",
        Math.max(12, Math.round(Number(paddingInput.value) * 0.85)) + "px"
      );
      root.style.setProperty("--pg-scroller-inset", scrollerInsetInput.value + "px");

      applyFrameMode();
      applyFont();
      applyTheme();
      applyTextFlow();
      applyAnimationSetting();
    };

    /*
     * 16. Pagination math
     */
    const getPageCount = () =>
      Math.max(1, Math.ceil(track.scrollWidth / getFrameWidth()));

    const clamp = (n) => Math.max(0, Math.min(n, getPageCount() - 1));

    const renderInfo = () => {
      pageInfo.textContent = `${currentIndex + 1} / ${getPageCount()}`;
    };

    const sync = () => {
      viewport.scrollTo({
        left: currentIndex * getFrameWidth(),
        top: 0,
        behavior: animationsOff() ? "auto" : "smooth",
      });
      renderInfo();
    };

    const updateLayout = () => {
      const shellWidth = getShellWidth();
      const shellHeight = getShellHeight();

      root.style.width = shellWidth + "px";
      root.style.height = shellHeight + "px";
      shell.style.width = shellWidth + "px";
      shell.style.height = shellHeight + "px";

      let frameWidth = shellWidth;
      if (frameModeSelect.value === "centered" && shellWidth > 900) {
        frameWidth = Math.min(shellWidth - 48, 1200);
      }

      frame.style.width = frameWidth + "px";
      frame.style.height = shellHeight + "px";
      viewport.style.width = frameWidth + "px";
      viewport.style.height = shellHeight + "px";
      track.style.height = shellHeight + "px";
      scroller.style.width = frameWidth + "px";
      scroller.style.height = shellHeight + "px";
      track.style.width = frameWidth + "px";

      /*
       * Pad the track so last page turn is always a full page width.
       */
      const contentWidth = scroller.scrollWidth;
      const pad = (frameWidth - (contentWidth % frameWidth)) % frameWidth;
      track.style.width = contentWidth + pad + "px";

      currentIndex = clamp(currentIndex);
      sync();
    };

    const scheduleRelayout = () => {
      clearTimeout(reflowTimer);
      reflowTimer = setTimeout(updateLayout, 40);
    };

    const goTo = (n) => {
      currentIndex = clamp(n);
      sync();
    };

    const next = () => goTo(currentIndex + 1);
    const prev = () => goTo(currentIndex - 1);

    const relayoutFromControls = () => {
      applySettings();
      saveSettings(currentSettings());
      scheduleRelayout();
    };

    const onResize = () => scheduleRelayout();

    /*
     * 17. Keyboard navigation
     */
    const onKey = (e) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        next();
        return;
      }

      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        prev();
        return;
      }

      if (e.key === "Home") {
        e.preventDefault();
        goTo(0);
        return;
      }

      if (e.key === "End") {
        e.preventDefault();
        goTo(getPageCount() - 1);
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        if (panel.hidden) exit();
        else panel.hidden = true;
      }
    };

    /*
     * 18. Wheel navigation
     * Vertical or horizontal wheel movement flips pages.
     */
    const onWheel = (e) => {
      if (!panel.hidden) return;
      if (wheelLock) {
        e.preventDefault();
        return;
      }

      const absX = Math.abs(e.deltaX);
      const absY = Math.abs(e.deltaY);
      const dominant = absY >= absX ? e.deltaY : e.deltaX;

      if (Math.abs(dominant) < 18) return;

      e.preventDefault();
      wheelLock = true;

      if (dominant > 0) next();
      else prev();

      setTimeout(() => {
        wheelLock = false;
      }, animationsOff() ? 120 : 280);
    };

    /*
     * 19. Touch navigation
     * Important rule:
     * - Swipes should work even if they start on links/images wrapped in links.
     * - Tiny taps on links should still activate the link.
     */
    const onTouchStart = (e) => {
      if (!panel.hidden) return;
      if (e.touches.length !== 1) return;

      const t = e.touches[0];
      dragging = true;
      horizontalGesture = false;
      verticalGesture = false;
      startTarget = e.target;
      startX = t.clientX;
      startY = t.clientY;
    };

    const onTouchMove = (e) => {
      if (!dragging) return;

      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
        horizontalGesture = true;
        e.preventDefault();
      } else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
        verticalGesture = true;
        e.preventDefault();
      }
    };

    const onTouchEnd = (e) => {
      if (!dragging) return;
      dragging = false;

      const t = e.changedTouches?.[0];
      if (!t) return;

      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      const frameWidth = getFrameWidth();
      const frameRect = frame.getBoundingClientRect();
      const swipeThreshold = Math.min(120, frameWidth * 0.18);
      const tapThreshold = 12;
      const startedOnInteractive = isInteractiveTarget(startTarget);

      /*
       * Horizontal swipe/flick
       */
      if (horizontalGesture && absX >= swipeThreshold && absX > absY) {
        if (dx < 0) next();
        else prev();
        return;
      }

      /*
       * Vertical swipe/flick
       * Up = next page, down = previous page
       */
      if (verticalGesture && absY >= swipeThreshold && absY > absX) {
        if (dy < 0) next();
        else prev();
        return;
      }

      /*
       * Edge taps only when it was a true tap and did not start on a link/control.
       */
      if (
        absX < tapThreshold &&
        absY < tapThreshold &&
        t.clientX >= frameRect.left &&
        t.clientX <= frameRect.right
      ) {
        if (startedOnInteractive) {
          return;
        }

        const localX = t.clientX - frameRect.left;
        if (localX < frameWidth * 0.26) {
          prev();
          return;
        }
        if (localX > frameWidth * 0.74) {
          next();
        }
      }
    };

    /*
     * 20. Export current settings as bookmarklet
     */
    const onExport = async () => {
      const url = makeBookmarkletUrl(currentSettings());
      const copied = await copyText(url);

      if (copied) {
        exportBtn.textContent = "Copied";
        setTimeout(() => {
          exportBtn.textContent = "Export";
        }, 1200);
      } else {
        prompt("Copy this bookmarklet URL:", url);
      }
    };

    /*
     * 21. Exit and restore original page
     */
    const exit = () => {
      clearTimeout(reflowTimer);

      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);

      document.removeEventListener("keydown", onKey, true);
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("touchstart", onTouchStart);
      viewport.removeEventListener("touchmove", onTouchMove);
      viewport.removeEventListener("touchend", onTouchEnd);

      resizeObserver?.disconnect();

      const themeMeta = document.querySelector('meta[name="theme-color"]');
      if (themeMeta && previousThemeMetaContent !== null) {
        themeMeta.setAttribute("content", previousThemeMetaContent);
      }

      document.documentElement.innerHTML = originalHtml;
      window.__PAGINATE_BOOKMARKLET_ACTIVE__ = false;
    };

    /*
     * 22. Wire UI controls
     */
    toolsBtn.onclick = () => {
      panel.hidden = !panel.hidden;
    };

    closeBtn.onclick = () => {
      panel.hidden = true;
    };

    exitBtn.onclick = exit;
    exportBtn.onclick = onExport;

    resetBtn.onclick = () => {
      frameModeSelect.value = String(DEFAULTS.frameMode);
      colWidthInput.value = String(DEFAULTS.columnWidth);
      fontSizeInput.value = String(DEFAULTS.fontSize);
      lineHeightInput.value = String(DEFAULTS.lineHeight);
      paddingInput.value = String(DEFAULTS.padding);
      scrollerInsetInput.value = String(DEFAULTS.scrollerInset);
      fontFamilySelect.value = String(DEFAULTS.fontFamily);
      themeSelect.value = String(DEFAULTS.theme);
      textAlignSelect.value = String(DEFAULTS.textAlign);
      hyphenationSelect.value = String(DEFAULTS.hyphenation);
      suppressAnimationsSelect.value = String(DEFAULTS.suppressAnimations);
      relayoutFromControls();
    };

    frameModeSelect.onchange = relayoutFromControls;
    colWidthInput.oninput = relayoutFromControls;
    fontSizeInput.oninput = relayoutFromControls;
    lineHeightInput.oninput = relayoutFromControls;
    paddingInput.oninput = relayoutFromControls;
    scrollerInsetInput.oninput = relayoutFromControls;
    fontFamilySelect.onchange = relayoutFromControls;
    themeSelect.onchange = relayoutFromControls;
    textAlignSelect.onchange = relayoutFromControls;
    hyphenationSelect.onchange = relayoutFromControls;
    suppressAnimationsSelect.onchange = relayoutFromControls;

    /*
     * 23. Initial render
     */
    applySettings();
    updateLayout();

    /*
     * 24. Observers and listeners
     */
    window.addEventListener("resize", onResize, { passive: true });
    window.addEventListener("orientationchange", onResize, { passive: true });
    window.visualViewport?.addEventListener("resize", onResize, {
      passive: true,
    });

    if ("ResizeObserver" in window) {
      resizeObserver = new ResizeObserver(() => scheduleRelayout());
      resizeObserver.observe(root);
      resizeObserver.observe(shell);
      resizeObserver.observe(frame);
      resizeObserver.observe(viewport);
    }

    document.addEventListener("keydown", onKey, true);
    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("touchstart", onTouchStart, { passive: true });
    viewport.addEventListener("touchmove", onTouchMove, { passive: false });
    viewport.addEventListener("touchend", onTouchEnd, { passive: true });

    /*
     * 25. Final sync
     */
    sync();
  } catch (err) {
    window.__PAGINATE_BOOKMARKLET_ACTIVE__ = false;
    alert("Paginate failed: " + (err && err.message ? err.message : err));
  }
})();