(async () => {
  // External dependencies and storage/config keys.
  const DEFUDDLE_URL = 'https://unpkg.com/defuddle@latest/dist/index.js';
  const STORAGE_KEY = 'paginateBookmarkletStyleV8';
  const NEWSREADER_CSS =
    'https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,200..800&display=swap';

  // Default reader settings. These are merged with any saved per-origin settings.
  const DEFAULTS = {
    columnWidth: 21,
    fontSize: 21,
    lineHeight: 1.55,
    padding: 32,
    scrollerInset: 0,
    fontFamily: 'original',
    theme: 'light',
    textAlign: 'left',
    hyphenation: 'off',
    suppressAnimations: 'on'
  };

  // Prevent duplicate activation.
  if (window.__PAGINATE_BOOKMARKLET_ACTIVE__) return;
  window.__PAGINATE_BOOKMARKLET_ACTIVE__ = true;

  // Dynamically load a script into the current page.
  const loadScript = (src) =>
    new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });

  // Wait for web fonts to finish loading before measuring layout.
  const waitForFonts = async () => {
    if (document.fonts && document.fonts.ready) {
      try {
        await document.fonts.ready;
      } catch (_) {}
    }
  };

  // Wait for all images inside a root node to load before measuring layout.
  const waitForImages = async (root) => {
    const imgs = [...root.querySelectorAll('img')];
    await Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((res) => {
              img.addEventListener('load', res, { once: true });
              img.addEventListener('error', res, { once: true });
            })
      )
    );
  };

  // Minimal HTML escaping for injected text fields.
  const escapeHtml = (s) =>
    String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');

  // Convert relative URLs in extracted content into absolute ones.
  const normalizeRelativeUrls = (doc, baseUrl) => {
    const attrs = [
      ['a', 'href'],
      ['img', 'src'],
      ['source', 'src'],
      ['video', 'src'],
      ['audio', 'src'],
      ['iframe', 'src'],
      ['link', 'href']
    ];

    for (const [selector, attr] of attrs) {
      doc.querySelectorAll(selector).forEach((el) => {
        const value = el.getAttribute(attr);
        if (!value) return;

        if (
          /^(https?:)?\/\//i.test(value) ||
          value.startsWith('data:') ||
          value.startsWith('blob:') ||
          value.startsWith('mailto:') ||
          value.startsWith('tel:')
        ) {
          return;
        }

        try {
          el.setAttribute(attr, new URL(value, baseUrl).href);
        } catch (_) {}
      });
    }
  };

  // Load saved style settings from localStorage, if available.
  const loadSavedSettings = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw);
      if (!v || typeof v !== 'object') return null;
      return v;
    } catch (_) {
      return null;
    }
  };

  // Persist current style settings to localStorage.
  const saveSettings = (v) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    } catch (_) {}
  };

  // Lazily load the Newsreader font only if selected.
  const ensureNewsreader = () => {
    if (document.getElementById('pg-newsreader-font')) return;
    const l = document.createElement('link');
    l.id = 'pg-newsreader-font';
    l.rel = 'stylesheet';
    l.href = NEWSREADER_CSS;
    document.head.appendChild(l);
  };

  // Merge defaults and saved settings.
  const mergeSettings = (base, extra) => Object.assign({}, base, extra || {});

  // Used to avoid hijacking taps/clicks on links and form controls.
  const isInteractiveTarget = (el) =>
    !!(
      el &&
      el.closest &&
      el.closest(
        'a[href],button,input,select,textarea,label,summary,[role="button"],audio,video'
      )
    );

  // Format article date metadata into a human-readable form when possible.
  const formatDate = (value) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);

    try {
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch (_) {
      return d.toISOString().slice(0, 10);
    }
  };

  try {
    // Load Defuddle only when needed.
    if (!window.Defuddle) await loadScript(DEFUDDLE_URL);

    // Snapshot the current document HTML before replacing the page.
    const html = document.documentElement.outerHTML;

    // Capture original body typography/colors for "original" theme/font mode.
    const originalComputed = window.getComputedStyle(
      document.body || document.documentElement
    );
    const originalFontFamily =
      (originalComputed && originalComputed.fontFamily) || 'serif';
    const originalBodyBg =
      (originalComputed && originalComputed.backgroundColor) || '#ffffff';
    const originalBodyColor =
      (originalComputed && originalComputed.color) || '#111111';

    // Parse a detached copy of the page for extraction.
    const parser = new DOMParser();
    const sourceDoc = parser.parseFromString(html, 'text/html');
    normalizeRelativeUrls(sourceDoc, location.href);

    // Run Defuddle. Support both constructor-style and parse-style exports.
    let article = null;
    const D = window.Defuddle || window.defuddle || window.default;

    if (typeof D === 'function') {
      try {
        const instance = new D(sourceDoc);
        article = typeof instance.parse === 'function' ? await instance.parse() : null;
      } catch (_) {
        article = null;
      }
    }

    if (!article && D && typeof D.parse === 'function') {
      try {
        article = await D.parse(sourceDoc, { url: location.href });
      } catch (_) {}
    }

    // Fall back to raw body HTML if extraction fails.
    const articleHtml = (article && article.content) || sourceDoc.body.innerHTML || '';
    const articleTitle = (article && article.title) || document.title || '';
    const articleAuthor = (article && (article.author || article.byline || '')) || '';
    const articlePublished = (article && (article.published || article.date || '')) || '';
    const articleDescription = (article && article.description) || '';

    // Build a richer article header from Defuddle metadata when present.
    const headerBits = [];
    if (articleAuthor) {
      headerBits.push(
        `<span class="pg-meta-author">${escapeHtml(articleAuthor)}</span>`
      );
    }
    if (articlePublished) {
      headerBits.push(
        `<time class="pg-meta-date">${escapeHtml(formatDate(articlePublished))}</time>`
      );
    }

    const articleHeaderHtml =
      `<header id="pg-article-header">` +
      `${
        articleTitle ? `<h1 id="pg-title">${escapeHtml(articleTitle)}</h1>` : ''
      }` +
      `${
        headerBits.length
          ? `<div id="pg-meta">${headerBits.join(
              '<span class="pg-meta-sep"> • </span>'
            )}</div>`
          : ''
      }` +
      `${
        articleDescription
          ? `<p id="pg-description">${escapeHtml(articleDescription)}</p>`
          : ''
      }` +
      `</header>`;

    // Preserve the original HTML so Esc/Exit can restore the page.
    const originalHtml = document.documentElement.innerHTML;

    // Replace the current document with the reader UI.
    document.documentElement.innerHTML = '';

    // Global reader styles.
    const style = document.createElement('style');
    style.textContent = `
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:var(--pg-bg);color:var(--pg-fg);font-family:var(--pg-font-family)}
#pg-root,#pg-viewport{width:100%;height:100%}
#pg-root{position:fixed;inset:0;z-index:2147483647;--pg-column-width:21em;--pg-font-size:21px;--pg-line-height:1.55;--pg-pad-x:32px;--pg-pad-y:24px;--pg-scroller-inset:0px;--pg-font-family:serif;--pg-bg:#ffffff;--pg-fg:#111111;--pg-link:#0645ad;--pg-panel-bg:rgba(255,255,255,.96);--pg-chip-bg:rgba(255,255,255,.88);--pg-text-align:left;--pg-hyphens:manual;background:var(--pg-bg);color:var(--pg-fg);font-family:var(--pg-font-family)}
#pg-root,*{box-sizing:border-box}
#pg-viewport{overflow-x:auto;overflow-y:hidden;scroll-behavior:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch;position:relative;touch-action:pan-y pinch-zoom}
#pg-viewport::-webkit-scrollbar{display:none}
#pg-track{height:100%;position:relative;width:100%}
#pg-scroller{height:100%;padding-top:var(--pg-scroller-inset);padding-bottom:var(--pg-scroller-inset);column-width:var(--pg-column-width);column-gap:0;column-fill:auto;overflow:visible}
#pg-content{min-height:100%;padding-left:var(--pg-pad-x);padding-right:var(--pg-pad-x);padding-top:calc(var(--pg-pad-y) + env(safe-area-inset-top,0px) + 10px);padding-bottom:calc(var(--pg-pad-y) + env(safe-area-inset-bottom,0px) + 22px);margin:0;font-size:var(--pg-font-size);line-height:var(--pg-line-height);font-family:var(--pg-font-family);color:var(--pg-fg);text-align:var(--pg-text-align);hyphens:var(--pg-hyphens);-webkit-hyphens:var(--pg-hyphens);overflow-wrap:break-word}
#pg-article-header{margin:0 0 1.25em 0;break-inside:avoid;page-break-inside:avoid;-webkit-column-break-inside:avoid}
#pg-title{margin:0 0 .35em 0}
#pg-meta{margin:0 0 .7em 0;font-size:.78em;line-height:1.35;font-style:italic;opacity:.8;text-align:center}
#pg-description{margin:.2em auto 0 auto;max-width:32em;font-size:.9em;line-height:1.45;text-align:center;opacity:.92}
.pg-meta-sep{opacity:.55}
#pg-content h1,#pg-content h2,#pg-content h3,#pg-content h4,#pg-content h5,#pg-content h6{text-align:center!important;line-height:1.1!important;hyphens:none!important;-webkit-hyphens:none!important}
#pg-content p,#pg-content li,#pg-content blockquote{hyphens:var(--pg-hyphens);-webkit-hyphens:var(--pg-hyphens);text-align:var(--pg-text-align)}
#pg-content,#pg-content p,#pg-content li,#pg-content blockquote,#pg-content figcaption,#pg-content td,#pg-content th,#pg-content pre,#pg-content code,#pg-content h1,#pg-content h2,#pg-content h3,#pg-content h4,#pg-content h5,#pg-content h6{color:var(--pg-fg)}
#pg-content a{color:var(--pg-link)}
#pg-content figure,#pg-content picture,#pg-content svg,#pg-content canvas,#pg-content video,#pg-content iframe{break-inside:avoid;page-break-inside:avoid;-webkit-column-break-inside:avoid;max-width:100%;height:auto}
#pg-content img{display:block;break-inside:avoid;page-break-inside:avoid;-webkit-column-break-inside:avoid;width:100%;max-width:100%;height:auto;max-height:80vh;object-fit:contain}
#pg-content figure img,#pg-content p img:only-child,#pg-content a img:only-child{width:100%;max-width:100%;height:auto;max-height:80vh;object-fit:contain}
#pg-content figure{margin:1em 0;max-width:100%}
#pg-content figcaption,#pg-content .caption,#pg-content .figcaption,#pg-content .image-caption,#pg-content .photo-caption,#pg-content .media-caption,#pg-content .wp-caption-text,#pg-content .credit,#pg-content .credits,#pg-content .byline,#pg-content .photo-credit,#pg-content .image-credit,#pg-content [class*="caption"],#pg-content [class*="credit"]{font-size:.7em!important;line-height:1.35!important;font-style:italic!important;opacity:.88;margin-top:.45em}
#pg-content table,#pg-content pre,#pg-content blockquote,#pg-content ul,#pg-content ol,#pg-content li{break-inside:avoid;page-break-inside:avoid;-webkit-column-break-inside:avoid}
#pg-content h1,#pg-content h2,#pg-content h3,#pg-content h4,#pg-content h5,#pg-content h6{break-inside:avoid;page-break-inside:avoid;-webkit-column-break-inside:avoid}
#pg-content table{width:100%;border-collapse:collapse;display:block;overflow-x:auto}
#pg-content pre{white-space:pre-wrap;overflow-wrap:anywhere;hyphens:none;-webkit-hyphens:none;text-align:left}
#pg-content code{overflow-wrap:anywhere;hyphens:none;-webkit-hyphens:none}
#pg-content p{orphans:2;widows:2}
#pg-tools-btn,#pg-page-info{position:fixed;bottom:calc(env(safe-area-inset-bottom,0px) + 5px);z-index:2147483647;background:var(--pg-chip-bg);backdrop-filter:blur(6px);color:var(--pg-fg);border:1px solid rgba(0,0,0,.14);border-radius:999px}
#pg-tools-btn{left:10px;appearance:none;padding:7px 9px;font:14px/1 system-ui,sans-serif;cursor:pointer;opacity:.78}
#pg-tools-btn:hover{opacity:1}
#pg-page-info{right:10px;padding:6px 10px;font:11px/1.1 system-ui,sans-serif;opacity:.82;pointer-events:none}
#pg-panel{position:fixed;left:10px;bottom:calc(env(safe-area-inset-bottom,0px) + 36px);z-index:2147483647;width:min(320px,calc(100vw - 20px));background:var(--pg-panel-bg);backdrop-filter:blur(10px);border:1px solid rgba(0,0,0,.12);border-radius:14px;padding:10px;box-shadow:0 8px 24px rgba(0,0,0,.10);font:12px/1.3 system-ui,sans-serif;color:var(--pg-fg);max-height:min(80vh,560px);overflow:auto}
#pg-panel[hidden]{display:none}
#pg-panel .pg-row{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;margin:0 0 8px 0}
#pg-panel .pg-row:last-child{margin-bottom:0}
#pg-panel input[type=range],#pg-panel select{width:150px}
#pg-panel select{padding:2px 4px;border:1px solid rgba(0,0,0,.14);border-radius:8px;background:#fff;color:#111}
#pg-panel .pg-actions{display:flex;gap:6px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap}
#pg-panel button{appearance:none;border:1px solid rgba(0,0,0,.14);background:#fff;color:#111;border-radius:999px;padding:5px 8px;font:inherit;cursor:pointer}
.pg-no-anim,.pg-no-anim *, .pg-no-anim *::before, .pg-no-anim *::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
`;
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    document.head.appendChild(style);

    // Main reader structure: viewport -> track -> multicol scroller -> article content.
    const root = document.createElement('div');
    root.id = 'pg-root';

    const viewport = document.createElement('div');
    viewport.id = 'pg-viewport';

    const track = document.createElement('div');
    track.id = 'pg-track';

    const scroller = document.createElement('div');
    scroller.id = 'pg-scroller';

    const content = document.createElement('article');
    content.id = 'pg-content';
    content.lang = document.documentElement.lang || navigator.language || 'en';
    content.innerHTML = articleHeaderHtml + articleHtml;

    // Minimal persistent controls: tools button and page indicator.
    const toolsBtn = document.createElement('button');
    toolsBtn.id = 'pg-tools-btn';
    toolsBtn.type = 'button';
    toolsBtn.textContent = '🔧';

    const pageInfo = document.createElement('div');
    pageInfo.id = 'pg-page-info';
    pageInfo.textContent = '1 / 1';

    // Settings panel UI.
    const panel = document.createElement('div');
    panel.id = 'pg-panel';
    panel.hidden = true;
    panel.innerHTML = `
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
<div class="pg-actions"><button type="button" id="pg-reset">Reset</button><button type="button" id="pg-close">Close</button><button type="button" id="pg-exit">Exit</button></div>
`;

    // Assemble reader DOM.
    scroller.appendChild(content);
    track.appendChild(scroller);
    viewport.appendChild(track);
    root.appendChild(viewport);
    root.appendChild(toolsBtn);
    root.appendChild(pageInfo);
    root.appendChild(panel);
    document.body.appendChild(root);

    // Wait until fonts and images are stable before measuring columns/pages.
    await waitForFonts();
    await waitForImages(root);

    // Runtime state.
    let currentIndex = 0;
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let moved = false;
    let horizontalGesture = false;
    let interactiveGesture = false;
    let resizeObserver = null;
    let reflowTimer = 0;

    // Grab settings controls.
    const colWidthInput = panel.querySelector('#pg-col-width');
    const fontSizeInput = panel.querySelector('#pg-font-size');
    const lineHeightInput = panel.querySelector('#pg-line-height');
    const paddingInput = panel.querySelector('#pg-padding');
    const scrollerInsetInput = panel.querySelector('#pg-scroller-inset');
    const fontFamilySelect = panel.querySelector('#pg-font-family');
    const themeSelect = panel.querySelector('#pg-theme');
    const textAlignSelect = panel.querySelector('#pg-text-align');
    const hyphenationSelect = panel.querySelector('#pg-hyphenation');
    const suppressAnimationsSelect = panel.querySelector('#pg-suppress-animations');
    const resetBtn = panel.querySelector('#pg-reset');
    const closeBtn = panel.querySelector('#pg-close');
    const exitBtn = panel.querySelector('#pg-exit');

    // Initialize controls from defaults + persisted settings.
    const saved = mergeSettings(DEFAULTS, loadSavedSettings());
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

    // Convenience predicate used for scroll/page-turn behavior.
    const animationsOff = () => suppressAnimationsSelect.value === 'on';

    // Use visualViewport when available to handle Safari/browser chrome correctly.
    const getPageWidth = () =>
      Math.max(
        1,
        Math.round(
          (window.visualViewport && window.visualViewport.width) ||
            viewport.clientWidth ||
            window.innerWidth ||
            1
        )
      );

    const getPageHeight = () =>
      Math.max(
        1,
        Math.round(
          (window.visualViewport && window.visualViewport.height) ||
            viewport.clientHeight ||
            window.innerHeight ||
            1
        )
      );

    // Serialize current settings for persistence.
    const currentSettings = () => ({
      columnWidth: parseFloat(colWidthInput.value),
      fontSize: parseFloat(fontSizeInput.value),
      lineHeight: parseFloat(lineHeightInput.value),
      padding: parseFloat(paddingInput.value),
      scrollerInset: parseFloat(scrollerInsetInput.value),
      fontFamily: fontFamilySelect.value,
      theme: themeSelect.value,
      textAlign: textAlignSelect.value,
      hyphenation: hyphenationSelect.value,
      suppressAnimations: suppressAnimationsSelect.value
    });

    // Apply the selected theme to CSS custom properties.
    const applyTheme = () => {
      const theme = themeSelect.value;

      if (theme === 'dark') {
        root.style.setProperty('--pg-bg', '#111111');
        root.style.setProperty('--pg-fg', '#f3f1eb');
        root.style.setProperty('--pg-link', '#8ab4ff');
        root.style.setProperty('--pg-panel-bg', 'rgba(28,28,28,.96)');
        root.style.setProperty('--pg-chip-bg', 'rgba(28,28,28,.88)');
      } else if (theme === 'sepia') {
        root.style.setProperty('--pg-bg', '#f4ecd8');
        root.style.setProperty('--pg-fg', '#3e2f1f');
        root.style.setProperty('--pg-link', '#7a4b17');
        root.style.setProperty('--pg-panel-bg', 'rgba(244,236,216,.96)');
        root.style.setProperty('--pg-chip-bg', 'rgba(244,236,216,.88)');
      } else if (theme === 'original') {
        root.style.setProperty('--pg-bg', originalBodyBg);
        root.style.setProperty('--pg-fg', originalBodyColor);
        root.style.setProperty('--pg-link', '#0645ad');
        root.style.setProperty('--pg-panel-bg', 'rgba(255,255,255,.96)');
        root.style.setProperty('--pg-chip-bg', 'rgba(255,255,255,.88)');
      } else {
        root.style.setProperty('--pg-bg', '#ffffff');
        root.style.setProperty('--pg-fg', '#111111');
        root.style.setProperty('--pg-link', '#0645ad');
        root.style.setProperty('--pg-panel-bg', 'rgba(255,255,255,.96)');
        root.style.setProperty('--pg-chip-bg', 'rgba(255,255,255,.88)');
      }
    };

    // Apply the selected font family to CSS custom properties.
    const applyFont = () => {
      const v = fontFamilySelect.value;

      if (v === 'original') {
        root.style.setProperty('--pg-font-family', originalFontFamily);
      } else if (v === 'sans') {
        root.style.setProperty(
          '--pg-font-family',
          'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif'
        );
      } else if (v === 'newsreader') {
        ensureNewsreader();
        root.style.setProperty(
          '--pg-font-family',
          '"Newsreader",Georgia,Cambria,"Times New Roman",Times,serif'
        );
      } else {
        root.style.setProperty(
          '--pg-font-family',
          'ui-serif,Georgia,Cambria,"Times New Roman",Times,serif'
        );
      }
    };

    // Apply text alignment and hyphenation behavior.
    const applyTextFlow = () => {
      root.style.setProperty(
        '--pg-text-align',
        textAlignSelect.value === 'justify' ? 'justify' : 'left'
      );
      root.style.setProperty(
        '--pg-hyphens',
        hyphenationSelect.value === 'auto' ? 'auto' : 'manual'
      );
    };

    // Disable animations/transitions globally inside the reader when requested.
    const applyAnimationSetting = () => {
      if (animationsOff()) root.classList.add('pg-no-anim');
      else root.classList.remove('pg-no-anim');
    };

    // Push current settings into CSS variables.
    const applySettings = () => {
      root.style.setProperty('--pg-column-width', colWidthInput.value + 'em');
      root.style.setProperty('--pg-font-size', fontSizeInput.value + 'px');
      root.style.setProperty('--pg-line-height', lineHeightInput.value);
      root.style.setProperty('--pg-pad-x', paddingInput.value + 'px');
      root.style.setProperty(
        '--pg-pad-y',
        Math.max(12, Math.round(paddingInput.value * 0.85)) + 'px'
      );
      root.style.setProperty('--pg-scroller-inset', scrollerInsetInput.value + 'px');

      applyFont();
      applyTheme();
      applyTextFlow();
      applyAnimationSetting();
    };

    // Page count is based on padded horizontal track width divided by viewport width.
    const getPageCount = () => Math.max(1, Math.ceil(track.scrollWidth / getPageWidth()));
    const clamp = (n) => Math.max(0, Math.min(n, getPageCount() - 1));

    // Update page indicator chip.
    const renderInfo = () => {
      pageInfo.textContent = `${currentIndex + 1} / ${getPageCount()}`;
    };

    // Snap to the current page index.
    const sync = () => {
      viewport.scrollTo({
        left: currentIndex * getPageWidth(),
        top: 0,
        behavior: animationsOff() ? 'auto' : 'smooth'
      });
      renderInfo();
    };

    // Recalculate page/track dimensions and normalize the current page index.
    const updateLayout = () => {
      const vw = getPageWidth();
      const vh = getPageHeight();

      root.style.width = vw + 'px';
      root.style.height = vh + 'px';
      viewport.style.width = vw + 'px';
      viewport.style.height = vh + 'px';
      track.style.height = vh + 'px';
      scroller.style.width = vw + 'px';
      scroller.style.height = vh + 'px';
      track.style.width = vw + 'px';

      // Compute content width created by multicol layout, then add tail padding
      // so the last page turn is always a full viewport width.
      const contentWidth = scroller.scrollWidth;
      const pad = (vw - (contentWidth % vw)) % vw;
      track.style.width = contentWidth + pad + 'px';

      currentIndex = clamp(currentIndex);
      sync();
    };

    // Debounced relayout helper for resize/orientation churn.
    const scheduleRelayout = () => {
      clearTimeout(reflowTimer);
      reflowTimer = setTimeout(updateLayout, 40);
    };

    // Explicit page navigation helpers.
    const goTo = (n) => {
      currentIndex = clamp(n);
      sync();
    };

    const next = () => goTo(currentIndex + 1);
    const prev = () => goTo(currentIndex - 1);

    // Called when the user changes settings in the panel.
    const relayoutFromControls = () => {
      applySettings();
      saveSettings(currentSettings());
      scheduleRelayout();
    };

    const onResize = () => scheduleRelayout();
    const onOrientationChange = () => scheduleRelayout();

    // Keyboard navigation.
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        prev();
      } else if (e.key === 'Home') {
        e.preventDefault();
        goTo(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        goTo(getPageCount() - 1);
      } else if (e.key === 'Escape') {
        if (panel.hidden) {
          e.preventDefault();
          exit();
        } else {
          e.preventDefault();
          panel.hidden = true;
        }
      }
    };

    // Touch gesture start: record origin point and whether this began on a link/control.
    const onTouchStart = (e) => {
      if (panel.hidden === false) return;
      if (e.touches.length !== 1) return;

      const t = e.touches[0];
      dragging = true;
      moved = false;
      horizontalGesture = false;
      interactiveGesture = isInteractiveTarget(e.target);
      startX = t.clientX;
      startY = t.clientY;
    };

    // Touch gesture move: determine whether this is a horizontal page-turn gesture.
    const onTouchMove = (e) => {
      if (!dragging || interactiveGesture) return;

      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;

      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) moved = true;

      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
        horizontalGesture = true;
        e.preventDefault();
      }
    };

    // Touch gesture end: swipe left/right to page, tap edges to page, preserve link taps.
    const onTouchEnd = (e) => {
      if (!dragging) return;
      dragging = false;

      const t = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : null;
      if (!t) return;

      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      const vw = getPageWidth();
      const threshold = Math.min(120, vw * 0.18);

      if (interactiveGesture) return;

      if (horizontalGesture && absX >= threshold && absX > absY) {
        if (dx < 0) next();
        else prev();
        return;
      }

      // Edge-tap page turns. Middle taps are ignored.
      if (absX < 12 && absY < 12) {
        const tapX = t.clientX;
        if (tapX < vw * 0.26) {
          prev();
          return;
        }
        if (tapX > vw * 0.74) {
          next();
          return;
        }
      }
    };

    // Restore the original page and remove all listeners.
    const exit = () => {
      clearTimeout(reflowTimer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onOrientationChange);

      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', onResize);
      }

      document.removeEventListener('keydown', onKey, true);
      viewport.removeEventListener('touchstart', onTouchStart);
      viewport.removeEventListener('touchmove', onTouchMove);
      viewport.removeEventListener('touchend', onTouchEnd);

      if (resizeObserver) resizeObserver.disconnect();

      document.documentElement.innerHTML = originalHtml;
      window.__PAGINATE_BOOKMARKLET_ACTIVE__ = false;
    };

    // Basic panel controls.
    toolsBtn.onclick = () => {
      panel.hidden = !panel.hidden;
    };
    closeBtn.onclick = () => {
      panel.hidden = true;
    };
    exitBtn.onclick = exit;

    // Reset panel controls back to defaults.
    resetBtn.onclick = () => {
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

    // Any settings change triggers save + relayout.
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

    // Initial render.
    applySettings();
    updateLayout();

    // Resize/orientation/layout observers.
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onOrientationChange, {
      passive: true
    });

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onResize, {
        passive: true
      });
    }

    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(() => scheduleRelayout());
      resizeObserver.observe(root);
      resizeObserver.observe(viewport);
    }

    // Interaction listeners.
    document.addEventListener('keydown', onKey, true);
    viewport.addEventListener('touchstart', onTouchStart, { passive: true });
    viewport.addEventListener('touchmove', onTouchMove, { passive: false });
    viewport.addEventListener('touchend', onTouchEnd, { passive: true });

    // Ensure page indicator is correct on first render.
    sync();
  } catch (err) {
    window.__PAGINATE_BOOKMARKLET_ACTIVE__ = false;
    alert('Paginate failed: ' + (err && err.message ? err.message : err));
  }
})();
