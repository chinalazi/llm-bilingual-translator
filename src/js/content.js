(() => {
  const { DEFAULT_SETTINGS } = window.XT_CONFIG;

  const STYLE_ID = "xt-bilingual-style";
  const BLOCK_CLASS = "xt-bilingual-block";
  const X_ORIG_HIDDEN_CLASS = "xt-x-replaced-orig";
  const X_NATIVE_CLASS = "xt-x-native";
  const HOST_ID = "xt-floating-host";
  const SKIP_ANCESTOR_SELECTOR =
    "nav, header, footer, aside, pre, code, script, style, noscript, svg, button, input, textarea, select, [contenteditable='true'], .xt-bilingual-block";

  let settings = { ...DEFAULT_SETTINGS };
  let isRestored = false;
  let activeRequests = 0;
  let runId = 0;
  let pageUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let statusText = "就绪";
  let lastErrorText = "";
  let currentHref = location.href;

  const cache = new Map();
  let shadowRoot = null;
  let uiRefs = null;
  let mutationObserver = null;
  let intersectionObserver = null;
  let routeTimer = null;
  let dynamicQueue = [];
  let dynamicTimer = null;

  function isXSite() {
    return location.hostname === "x.com" || location.hostname === "pro.x.com";
  }

  function shouldReplaceOnX() {
    return isXSite() && Boolean(settings.xReplaceOriginal);
  }

  function isBlacklisted() {
    return Array.isArray(settings.blacklist) && settings.blacklist.includes(location.hostname);
  }

  function isChineseSegment(text) {
    if (!text) return false;
    const cleaned = text
      .replace(/\{\{CODE_\d+\}\}/g, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/@\w+/g, "")
      .replace(/#\S+/g, "")
      .trim();
    const letters = cleaned.match(/\p{L}/gu) || [];
    if (letters.length === 0) return false;
    const han = cleaned.match(/[\u4e00-\u9fff]/g) || [];
    return han.length / letters.length >= 0.35;
  }

  function isChinesePage() {
    if (isXSite()) return false; // X feeds mix languages; filter per tweet instead
    const lang = (document.documentElement.lang || "").toLowerCase();
    if (lang.startsWith("zh")) return true;

    const root = document.querySelector("article, main, [role='main']") || document.body;
    const sample = (root?.innerText || "").slice(0, 1500);
    const letters = sample.match(/\p{L}/gu) || [];
    if (letters.length < 20) return false;
    const han = sample.match(/[\u4e00-\u9fff]/g) || [];
    return han.length / letters.length > 0.25;
  }

  function getTranslatedCount() {
    return document.querySelectorAll(`.${BLOCK_CLASS}:not(.xt-error)`).length;
  }

  function detectFallbackLang(text) {
    if (!text) return "FL";
    if (/[\u3040-\u30ff]/.test(text)) return "JP";
    if (/[\uac00-\ud7af\u1100-\u11ff]/.test(text)) return "KR";
    if (/[\u0400-\u04ff]/.test(text)) return "RU";
    if (/[\u0600-\u06ff]/.test(text)) return "AR";
    if (/[\u0e00-\u0e7f]/.test(text)) return "TH";
    if (/[\u0900-\u097f]/.test(text)) return "HI";
    if (/[áéíóúñ¿¡]/i.test(text)) return "ES";
    if (/[àâçéèêëîïôùûüÿœ]/i.test(text)) return "FR";
    if (/[äöüß]/i.test(text)) return "DE";
    if (/[A-Za-z]/.test(text)) return "EN";
    return "FL";
  }

  function normalizeLangCode(raw, fallbackText = "") {
    const v = String(raw || "").trim();
    if (!v) return detectFallbackLang(fallbackText);
    const map = {
      英语: "EN", 英文: "EN", english: "EN", en: "EN",
      日语: "JP", 日文: "JP", japanese: "JP", ja: "JP", jp: "JP",
      韩语: "KR", 韩文: "KR", korean: "KR", ko: "KR", kr: "KR",
      法语: "FR", 法文: "FR", french: "FR", fr: "FR",
      西班牙语: "ES", 西语: "ES", spanish: "ES", es: "ES",
      德语: "DE", 德文: "DE", german: "DE", de: "DE",
      俄语: "RU", 俄文: "RU", russian: "RU", ru: "RU",
      阿拉伯语: "AR", arabic: "AR", ar: "AR",
      葡萄牙语: "PT", 葡语: "PT", portuguese: "PT", pt: "PT",
      意大利语: "IT", italian: "IT", it: "IT",
      泰语: "TH", thai: "TH", th: "TH",
      印地语: "HI", hindi: "HI", hi: "HI",
      越南语: "VI", vietnamese: "VI", vi: "VI",
      印尼语: "ID", indonesian: "ID", id: "ID",
      中文: "CH", 汉语: "CH", chinese: "CH", zh: "CH", ch: "CH"
    };
    const key = v.toLowerCase();
    if (map[key]) return map[key];
    if (map[v]) return map[v];
    if (/^[a-z]{2,3}$/i.test(v)) return v.toUpperCase();
    return detectFallbackLang(fallbackText);
  }

  function cleanRenderedText(text) {
    return String(text || "")
      .replace(/\[\/?SEG_?\d+[^\]]*\]/gi, "")
      .replace(/^\s*SEG_?\d+\s*[:：\-]?\s*/gim, "")
      .trim();
  }

  function injectPageStyles() {
    let styleEl = document.getElementById(STYLE_ID);
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = STYLE_ID;
      document.head.appendChild(styleEl);
    }
    const accent = settings.accentColor || "#1d9bf0";
    styleEl.textContent = `
      .${BLOCK_CLASS} {
        display: block;
        margin-top: 8px;
        margin-bottom: 12px;
        padding: 8px 12px;
        border-radius: 0 10px 10px 0;
        border-left: 3px solid ${accent};
        border-top: 1px solid color-mix(in srgb, ${accent} 16%, transparent);
        border-right: 1px solid color-mix(in srgb, ${accent} 16%, transparent);
        border-bottom: 1px solid color-mix(in srgb, ${accent} 16%, transparent);
        background: color-mix(in srgb, ${accent} 7%, transparent);
        color: inherit;
        opacity: ${settings.mutedOpacity ?? 0.88};
        white-space: pre-wrap;
        word-break: break-word;
        box-sizing: border-box;
      }
      .${BLOCK_CLASS}.${X_NATIVE_CLASS} {
        margin-top: 2px;
        margin-bottom: 2px;
        padding: 7px 11px;
        border-radius: 10px;
        border: 1px solid color-mix(in srgb, ${accent} 16%, transparent);
        border-left: 3px solid color-mix(in srgb, ${accent} 70%, transparent);
        background: color-mix(in srgb, ${accent} 6%, transparent);
        opacity: 1;
      }
      .xt-lang-badge {
        display: inline-block;
        margin-left: 5px;
        padding: 0 4px;
        border-radius: 3px;
        font-size: 9px;
        font-weight: 500;
        line-height: 1.35;
        vertical-align: 1px;
        letter-spacing: 0.04em;
        color: ${accent};
        background: color-mix(in srgb, ${accent} 10%, transparent);
        border: 1px solid color-mix(in srgb, ${accent} 20%, transparent);
        opacity: 0.55;
        cursor: pointer;
        user-select: none;
        transition: opacity 0.15s ease, background 0.15s ease;
      }
      .xt-lang-badge:hover {
        opacity: 1;
        background: color-mix(in srgb, ${accent} 20%, transparent);
      }
      .${X_ORIG_HIDDEN_CLASS} {
        display: none !important;
      }
      .${BLOCK_CLASS}.xt-hidden {
        display: none !important;
      }
      .${BLOCK_CLASS}.xt-error {
        color: #e5484d;
        background: rgba(229, 72, 77, 0.08);
        border: 1px solid rgba(229, 72, 77, 0.25);
        border-left: 3px solid #e5484d;
        border-radius: 8px;
        padding: 6px 10px;
        opacity: 1;
        font-size: 13px !important;
      }
      .${BLOCK_CLASS} code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        font-size: 0.9em;
        padding: 1px 5px;
        border-radius: 4px;
        background: color-mix(in srgb, ${accent} 12%, rgba(128, 128, 128, 0.14));
      }
    `;
  }

  function applyFloatingPosition(host) {
    const pos = settings.floatingPos;
    if (pos && typeof pos.top === "number" && typeof pos.right === "number") {
      const top = Math.min(Math.max(8, pos.top), Math.max(8, window.innerHeight - 56));
      const right = Math.min(Math.max(8, pos.right), Math.max(8, window.innerWidth - 120));
      host.style.top = `${top}px`;
      host.style.right = `${right}px`;
    } else {
      host.style.top = "16px";
      host.style.right = "16px";
    }
  }

  function createFloatingCapsule() {
    if (!settings.showFloatingBar) {
      document.getElementById(HOST_ID)?.remove();
      shadowRoot = null;
      uiRefs = null;
      return;
    }
    const existing = document.getElementById(HOST_ID);
    if (existing) {
      applyFloatingPosition(existing);
      return;
    }

    const host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText = "position:fixed;z-index:2147483647;";
    applyFloatingPosition(host);
    shadowRoot = host.attachShadow({ mode: "open" });

    shadowRoot.innerHTML = `
      <style>
        :host {
          all: initial;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        .capsule {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 12px 14px;
          width: 268px;
          border-radius: 16px;
          background: linear-gradient(145deg, rgba(255, 255, 255, 0.92), rgba(246, 248, 252, 0.86));
          backdrop-filter: blur(18px) saturate(180%);
          -webkit-backdrop-filter: blur(18px) saturate(180%);
          border: 1px solid rgba(15, 20, 25, 0.1);
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.8);
          color: #0f1419;
          font-size: 12px;
          line-height: 1.4;
          transition: border-radius 0.2s ease, padding 0.2s ease;
        }
        @media (prefers-color-scheme: dark) {
          .capsule {
            background: linear-gradient(145deg, rgba(24, 27, 34, 0.92), rgba(16, 18, 23, 0.88));
            border-color: rgba(255, 255, 255, 0.14);
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.08);
            color: #f0f3f6;
          }
        }
        .capsule.collapsed {
          width: auto;
          padding: 6px 10px;
          border-radius: 999px;
          gap: 0;
        }
        .capsule.collapsed .body {
          display: none;
        }
        .top-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          cursor: grab;
          user-select: none;
        }
        .top-row:active {
          cursor: grabbing;
        }
        .status-wrap {
          display: flex;
          align-items: center;
          gap: 7px;
          font-weight: 600;
          font-size: 12px;
        }
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #1d9bf0;
          box-shadow: 0 0 0 3px rgba(29, 155, 240, 0.2);
          flex-shrink: 0;
        }
        .dot.busy {
          background: #f59e0b;
          box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.22);
          animation: pulse 1.1s infinite;
        }
        .dot.err {
          background: #e5484d;
          box-shadow: 0 0 0 3px rgba(229, 72, 77, 0.22);
        }
        .dot.off {
          background: #8b949e;
          box-shadow: none;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.45; transform: scale(0.9); }
        }
        .mini-right {
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .mini-token {
          font-size: 11px;
          font-weight: 500;
          padding: 2px 7px;
          border-radius: 999px;
          background: rgba(29, 155, 240, 0.12);
          color: #1d9bf0;
          font-variant-numeric: tabular-nums;
        }
        .capsule:not(.collapsed) .mini-token {
          display: none;
        }
        .icon-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          border: none;
          background: rgba(128, 128, 128, 0.12);
          color: inherit;
          cursor: pointer;
          font-size: 11px;
          padding: 0;
          transition: background 0.15s;
        }
        .icon-btn:hover {
          background: rgba(29, 155, 240, 0.2);
        }
        .body {
          display: flex;
          flex-direction: column;
          gap: 9px;
          padding-top: 2px;
        }
        .err-banner {
          display: none;
          font-size: 11px;
          color: #e5484d;
          background: rgba(229, 72, 77, 0.1);
          border-radius: 8px;
          padding: 5px 8px;
          word-break: break-word;
        }
        .err-banner.visible {
          display: block;
        }
        .token-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 6px;
        }
        .stat-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 6px 4px;
          border-radius: 10px;
          background: rgba(128, 128, 128, 0.08);
          border: 1px solid rgba(128, 128, 128, 0.1);
        }
        .stat-label {
          font-size: 10px;
          opacity: 0.65;
        }
        .stat-val {
          font-size: 12px;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          margin-top: 1px;
        }
        .actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }
        button.action {
          padding: 6px 10px;
          border-radius: 9px;
          border: 1px solid rgba(128, 128, 128, 0.22);
          background: rgba(128, 128, 128, 0.08);
          color: inherit;
          font-size: 11.5px;
          font-weight: 500;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.15s;
        }
        button.action:hover {
          background: rgba(29, 155, 240, 0.14);
          border-color: rgba(29, 155, 240, 0.45);
        }
        button.action.primary {
          grid-column: span 2;
          background: linear-gradient(135deg, #1d9bf0, #0d74c4);
          color: #ffffff;
          border: none;
          font-weight: 600;
          box-shadow: 0 3px 10px rgba(29, 155, 240, 0.28);
        }
        button.action.primary:hover {
          filter: brightness(1.06);
        }
      </style>
      <div class="capsule collapsed" id="capsule">
        <div class="top-row" id="dragHandle" title="拖动可移动位置，点击展开/收起">
          <div class="status-wrap" id="toggleExpand">
            <span class="dot" id="dot"></span>
            <span id="status">双语翻译</span>
          </div>
          <div class="mini-right">
            <span class="mini-token" id="miniToken">0 tok</span>
            <button class="icon-btn" id="quickRestoreBtn" title="一键还原/恢复译文">⇄</button>
            <button class="icon-btn" id="collapseBtn" title="展开/收起">▸</button>
          </div>
        </div>
        <div class="body">
          <div class="err-banner" id="errBanner"></div>
          <div class="token-grid">
            <div class="stat-box">
              <span class="stat-label">输入</span>
              <span class="stat-val" id="tokIn">0</span>
            </div>
            <div class="stat-box">
              <span class="stat-label">输出</span>
              <span class="stat-val" id="tokOut">0</span>
            </div>
            <div class="stat-box">
              <span class="stat-label">总计</span>
              <span class="stat-val" id="tokTotal">0</span>
            </div>
          </div>
          <div class="actions">
            <button class="action primary" id="restoreBtn">还原原文</button>
            <button class="action" id="translateBtn">翻译本页</button>
            <button class="action" id="blacklistBtn">停用本站</button>
          </div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(host);
    uiRefs = {
      host,
      capsule: shadowRoot.getElementById("capsule"),
      dragHandle: shadowRoot.getElementById("dragHandle"),
      dot: shadowRoot.getElementById("dot"),
      status: shadowRoot.getElementById("status"),
      miniToken: shadowRoot.getElementById("miniToken"),
      errBanner: shadowRoot.getElementById("errBanner"),
      tokIn: shadowRoot.getElementById("tokIn"),
      tokOut: shadowRoot.getElementById("tokOut"),
      tokTotal: shadowRoot.getElementById("tokTotal"),
      toggleExpand: shadowRoot.getElementById("toggleExpand"),
      quickRestoreBtn: shadowRoot.getElementById("quickRestoreBtn"),
      collapseBtn: shadowRoot.getElementById("collapseBtn"),
      restoreBtn: shadowRoot.getElementById("restoreBtn"),
      translateBtn: shadowRoot.getElementById("translateBtn"),
      blacklistBtn: shadowRoot.getElementById("blacklistBtn")
    };

    const toggleCollapse = () => {
      const collapsed = uiRefs.capsule.classList.toggle("collapsed");
      uiRefs.collapseBtn.textContent = collapsed ? "▸" : "▾";
    };

    // Drag support on top-row (distinguish click vs drag)
    let dragState = null;
    uiRefs.dragHandle.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      const rect = host.getBoundingClientRect();
      dragState = {
        startX: e.clientX,
        startY: e.clientY,
        origTop: rect.top,
        origRight: window.innerWidth - rect.right,
        moved: false
      };
      uiRefs.dragHandle.setPointerCapture(e.pointerId);
    });

    uiRefs.dragHandle.addEventListener("pointermove", (e) => {
      if (!dragState) return;
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        dragState.moved = true;
      }
      if (!dragState.moved) return;
      const newTop = Math.min(Math.max(8, dragState.origTop + dy), Math.max(8, window.innerHeight - 56));
      const newRight = Math.min(Math.max(8, dragState.origRight - dx), Math.max(8, window.innerWidth - 120));
      host.style.top = `${newTop}px`;
      host.style.right = `${newRight}px`;
    });

    uiRefs.dragHandle.addEventListener("pointerup", (e) => {
      if (!dragState) return;
      const wasMoved = dragState.moved;
      dragState = null;
      if (wasMoved) {
        const rect = host.getBoundingClientRect();
        const pos = {
          top: Math.round(rect.top),
          right: Math.round(window.innerWidth - rect.right)
        };
        settings.floatingPos = pos;
        chrome.storage.local.set({ floatingPos: pos });
      } else if (e.target.closest("#toggleExpand")) {
        toggleCollapse();
      }
    });

    uiRefs.collapseBtn.addEventListener("click", toggleCollapse);
    uiRefs.quickRestoreBtn.addEventListener("click", toggleRestore);
    uiRefs.restoreBtn.addEventListener("click", toggleRestore);

    uiRefs.translateBtn.addEventListener("click", () => {
      isRestored = false;
      syncVisibilityAndXReplace();
      translateWholePage(true);
    });

    uiRefs.blacklistBtn.addEventListener("click", async () => {
      const hostName = location.hostname;
      const list = Array.isArray(settings.blacklist) ? [...settings.blacklist] : [];
      const idx = list.indexOf(hostName);
      if (idx >= 0) {
        list.splice(idx, 1);
      } else {
        list.push(hostName);
      }
      await chrome.storage.local.set({ blacklist: list });
    });

    updateFloatingUI();
  }

  function formatNum(n) {
    return Number(n || 0).toLocaleString("en-US");
  }

  function updateFloatingUI() {
    if (!uiRefs) return;
    uiRefs.status.textContent = statusText;
    uiRefs.dot.className = "dot";
    if (activeRequests > 0) {
      uiRefs.dot.classList.add("busy");
    } else if (lastErrorText) {
      uiRefs.dot.classList.add("err");
    } else if (!settings.enabled || isBlacklisted() || isRestored) {
      uiRefs.dot.classList.add("off");
    }

    if (lastErrorText) {
      uiRefs.errBanner.textContent = lastErrorText;
      uiRefs.errBanner.classList.add("visible");
    } else {
      uiRefs.errBanner.textContent = "";
      uiRefs.errBanner.classList.remove("visible");
    }

    uiRefs.miniToken.textContent = `${formatNum(pageUsage.totalTokens)} tok`;
    uiRefs.tokIn.textContent = formatNum(pageUsage.promptTokens);
    uiRefs.tokOut.textContent = formatNum(pageUsage.completionTokens);
    uiRefs.tokTotal.textContent = formatNum(pageUsage.totalTokens);

    uiRefs.restoreBtn.textContent = isRestored ? (shouldReplaceOnX() ? "恢复译文" : "恢复双语") : "还原原文";
    uiRefs.blacklistBtn.textContent = isBlacklisted() ? "启用本站" : "停用本站";
  }

  function syncVisibilityAndXReplace() {
    const replaceMode = shouldReplaceOnX();
    document.querySelectorAll(`.${BLOCK_CLASS}`).forEach((box) => {
      const isErr = box.classList.contains("xt-error");
      box.classList.toggle("xt-hidden", isRestored);
      box.classList.toggle(X_NATIVE_CLASS, replaceMode && !isErr);
    });

    if (isXSite()) {
      document.querySelectorAll("div[data-testid='tweetText'][data-xt-done='1']").forEach((el) => {
        el.classList.toggle(X_ORIG_HIDDEN_CLASS, replaceMode && !isRestored);
      });
    }

    const count = getTranslatedCount();
    if (isRestored) {
      statusText = "已还原原文";
    } else if (count > 0 && activeRequests === 0) {
      statusText = `已翻译 ${count} 段`;
    }
    updateFloatingUI();
  }

  function toggleRestore() {
    isRestored = !isRestored;
    syncVisibilityAndXReplace();
  }

  function extractWithCodePlaceholders(el) {
    const clone = el.cloneNode(true);
    const codes = [];

    clone.querySelectorAll("img").forEach((img) => {
      const alt = img.getAttribute("alt") || "";
      img.replaceWith(document.createTextNode(alt));
    });

    clone.querySelectorAll("code").forEach((codeEl) => {
      const raw = (codeEl.textContent || "").trim();
      if (!raw || raw.length > 80) return;
      const idx = codes.length;
      codes.push(raw);
      codeEl.replaceWith(document.createTextNode(`{{CODE_${idx}}}`));
    });

    const text = (clone.innerText || clone.textContent || "").replace(/\s+\n/g, "\n").trim();
    return { text, codes };
  }

  function hasTranslatableText(text) {
    if (!text || text.length < 2) return false;
    if (isChineseSegment(text)) return false;
    const cleaned = text
      .replace(/\{\{CODE_\d+\}\}/g, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/@\w+/g, "")
      .replace(/#\S+/g, "")
      .trim();
    return /\p{L}/u.test(cleaned);
  }

  function collectPageBlocks() {
    if (isXSite()) {
      return Array.from(document.querySelectorAll("div[data-testid='tweetText']"));
    }

    const container =
      document.querySelector("article, main, [role='main'], .post-content, .article-content, .markdown-body") ||
      document.body;
    if (!container) return [];

    const candidates = Array.from(
      container.querySelectorAll("h1, h2, h3, h4, p, li, blockquote, figcaption, td, th")
    );

    const candidateSet = new Set(candidates);
    return candidates.filter((el) => {
      if (el.closest(SKIP_ANCESTOR_SELECTOR)) return false;
      let p = el.parentElement;
      while (p && p !== container) {
        if (candidateSet.has(p)) return false;
        p = p.parentElement;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      return true;
    });
  }

  function shouldInsertInside(targetEl) {
    if (isXSite()) return false; // Never mutate React children inside tweetText
    const tag = targetEl.tagName;
    if (tag === "LI" || tag === "BLOCKQUOTE" || tag === "TD" || tag === "TH" || tag === "FIGCAPTION") {
      return true;
    }
    const parent = targetEl.parentElement;
    if (!parent) return false;
    const pcs = window.getComputedStyle(parent);
    const isRowFlex =
      (pcs.display === "flex" || pcs.display === "inline-flex") &&
      (pcs.flexDirection === "row" || pcs.flexDirection === "row-reverse");
    const isGrid = pcs.display === "grid" || pcs.display === "inline-grid";
    return isRowFlex || isGrid;
  }

  function insertTranslationBlock(targetEl, translatedText, codes = [], isError = false, sourceLang = "") {
    const inside = shouldInsertInside(targetEl);
    const hostParent = inside ? targetEl : targetEl.parentElement;
    if (!hostParent) return;

    let box = inside
      ? targetEl.querySelector(`:scope > .${BLOCK_CLASS}`)
      : targetEl.nextElementSibling?.classList?.contains(BLOCK_CLASS)
      ? targetEl.nextElementSibling
      : null;

    // Never overwrite an already successful translation with a batch error
    if (isError && box && !box.classList.contains("xt-error")) {
      return;
    }

    if (!box) {
      box = document.createElement("div");
      box.className = BLOCK_CLASS;
      if (inside) {
        targetEl.appendChild(box);
      } else {
        targetEl.insertAdjacentElement("afterend", box);
      }
    }

    const cs = window.getComputedStyle(targetEl);
    box.style.fontFamily = cs.fontFamily;
    box.style.fontSize = cs.fontSize;
    box.style.lineHeight = cs.lineHeight;
    box.style.textAlign = cs.textAlign;
    if (shouldReplaceOnX() && !isError) {
      box.style.color = cs.color;
    } else {
      box.style.color = "";
    }

    box.classList.toggle("xt-error", isError);
    box.classList.toggle(X_NATIVE_CLASS, shouldReplaceOnX() && !isError);
    box.classList.toggle("xt-hidden", isRestored);

    if (isXSite() && !isError) {
      targetEl.classList.toggle(X_ORIG_HIDDEN_CLASS, shouldReplaceOnX() && !isRestored);
    }

    box.textContent = "";

    const cleanText = cleanRenderedText(translatedText);
    const parts = cleanText.split(/(\{\{CODE_\d+\}\})/g);
    for (const part of parts) {
      const m = /^\{\{CODE_(\d+)\}\}$/.exec(part);
      if (m) {
        const idx = Number(m[1]);
        if (idx >= 0 && idx < codes.length) {
          const codeNode = document.createElement("code");
          codeNode.textContent = codes[idx];
          box.appendChild(codeNode);
          continue;
        }
      }
      if (part) {
        box.appendChild(document.createTextNode(part));
      }
    }

    // On X / Twitter, append a subtle tiny language code badge at the end (click to toggle original)
    if (isXSite() && !isError) {
      const badge = document.createElement("span");
      badge.className = "xt-lang-badge";
      const code = normalizeLangCode(sourceLang);
      badge.textContent = code;
      badge.title = `译自 ${code} · 点击可显示/隐藏该条原文`;
      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        targetEl.classList.toggle(X_ORIG_HIDDEN_CLASS);
      });
      box.appendChild(badge);
    }
  }

  function buildContextChunks(items, maxBlocks = 22, maxChars = 5500) {
    const chunks = [];
    let current = [];
    let chars = 0;

    for (const item of items) {
      if (current.length > 0 && (current.length >= maxBlocks || chars + item.text.length > maxChars)) {
        chunks.push(current);
        current = [];
        chars = 0;
      }
      current.push(item);
      chars += item.text.length;
    }
    if (current.length > 0) {
      chunks.push(current);
    }
    return chunks;
  }

  async function translateItems(items) {
    if (!items.length) return;
    const myRunId = runId;

    const toFetch = [];
    for (const item of items) {
      const key = `${settings.provider}|${settings.model}|${settings.targetLang}|${item.text}`;
      if (cache.has(key)) {
        const cached = cache.get(key);
        if (cached && cached.text && cached.text !== "__SKIP__") {
          item.el.dataset.xtDone = "1";
          insertTranslationBlock(item.el, cached.text, item.codes, false, cached.lang);
        } else {
          item.el.dataset.xtDone = "skip";
        }
      } else {
        toFetch.push({ ...item, cacheKey: key });
      }
    }

    if (!toFetch.length) {
      const count = getTranslatedCount();
      statusText = isRestored ? "已还原原文" : `已翻译 ${count} 段`;
      updateFloatingUI();
      return;
    }

    const articleTitle = document.querySelector("h1")?.innerText?.trim() || document.title || "";
    const chunks = buildContextChunks(toFetch);

    activeRequests++;
    lastErrorText = "";
    statusText = chunks.length > 1 ? `整篇翻译中 (1/${chunks.length})...` : "整篇翻译中...";
    updateFloatingUI();

    try {
      for (let i = 0; i < chunks.length; i++) {
        if (myRunId !== runId) return;

        const chunk = chunks[i];
        statusText = chunks.length > 1 ? `翻译中 (${i + 1}/${chunks.length})...` : "整篇翻译中...";
        updateFloatingUI();

        const res = await chrome.runtime.sendMessage({
          type: "TRANSLATE_BATCH",
          articleTitle,
          segments: chunk.map((c) => c.text)
        });

        if (myRunId !== runId) return;

        if (!res || !res.ok) {
          throw new Error(res?.error || "翻译请求失败");
        }

        if (res.usage) {
          pageUsage.promptTokens += res.usage.promptTokens || 0;
          pageUsage.completionTokens += res.usage.completionTokens || 0;
          pageUsage.totalTokens += res.usage.totalTokens || 0;
        }

        const outputs = res.translations || [];
        chunk.forEach((item, idx) => {
          if (!document.contains(item.el)) return;
          const entry = outputs[idx];
          const trText = cleanRenderedText(typeof entry === "string" ? entry : entry?.text || "");
          const trLang = normalizeLangCode(typeof entry === "object" ? entry?.lang : "", item.text);

          if (!trText || trText === "__SKIP__") {
            cache.set(item.cacheKey, { text: "__SKIP__", lang: "" });
            item.el.dataset.xtDone = "skip";
          } else {
            cache.set(item.cacheKey, { text: trText, lang: trLang });
            item.el.dataset.xtDone = "1";
            insertTranslationBlock(item.el, trText, item.codes, false, trLang);
          }
        });
      }

      if (myRunId === runId) {
        const count = getTranslatedCount();
        statusText = isRestored ? "已还原原文" : count > 0 ? `已翻译 ${count} 段` : "无需翻译";
      }
    } catch (err) {
      if (myRunId === runId) {
        lastErrorText = err?.message || String(err);
        statusText = "翻译出错";
      }
    } finally {
      activeRequests = Math.max(0, activeRequests - 1);
      updateFloatingUI();
    }
  }

  async function translateWholePage(force = false) {
    if (!force && (!settings.enabled || isBlacklisted())) return;
    if (!force && isChinesePage()) {
      statusText = "中文页面已跳过";
      updateFloatingUI();
      return;
    }

    const blocks = collectPageBlocks();
    const items = [];
    for (const el of blocks) {
      if (!force && el.dataset.xtDone) continue;
      const { text, codes } = extractWithCodePlaceholders(el);
      if (!hasTranslatableText(text)) {
        el.dataset.xtDone = "skip";
        continue;
      }
      items.push({ el, text, codes });
    }

    if (items.length > 0) {
      await translateItems(items);
    } else if (getTranslatedCount() === 0) {
      statusText = "无可翻译正文";
      updateFloatingUI();
    }
  }

  function flushDynamicQueue() {
    dynamicTimer = null;
    if (!settings.enabled || isBlacklisted() || settings.mode !== "auto") {
      dynamicQueue = [];
      return;
    }
    const batch = dynamicQueue.splice(0, 20);
    if (batch.length > 0) {
      translateItems(batch);
    }
  }

  function setupDynamicObservers() {
    if (intersectionObserver) intersectionObserver.disconnect();
    if (mutationObserver) mutationObserver.disconnect();

    if (!isXSite()) return;

    intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            intersectionObserver.unobserve(entry.target);
            const el = entry.target;
            if (el.dataset.xtDone) continue;
            const { text, codes } = extractWithCodePlaceholders(el);
            if (!hasTranslatableText(text)) {
              el.dataset.xtDone = "skip";
              continue;
            }
            dynamicQueue.push({ el, text, codes });
            if (!dynamicTimer) {
              dynamicTimer = setTimeout(flushDynamicQueue, 300);
            }
          }
        }
      },
      { rootMargin: "200px 0px" }
    );

    const scanX = () => {
      if (!settings.enabled || isBlacklisted() || settings.mode !== "auto") return;
      document.querySelectorAll("div[data-testid='tweetText']").forEach((el) => {
        if (el.dataset.xtObserved === "1" || el.dataset.xtDone) return;
        el.dataset.xtObserved = "1";
        intersectionObserver.observe(el);
      });
    };

    mutationObserver = new MutationObserver(scanX);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    scanX();
  }

  function clearAllTranslations() {
    runId++;
    dynamicQueue = [];
    if (dynamicTimer) {
      clearTimeout(dynamicTimer);
      dynamicTimer = null;
    }
    document.querySelectorAll(`.${BLOCK_CLASS}`).forEach((el) => el.remove());
    document.querySelectorAll(`.${X_ORIG_HIDDEN_CLASS}`).forEach((el) => el.classList.remove(X_ORIG_HIDDEN_CLASS));
    document.querySelectorAll("[data-xt-done], [data-xt-observed]").forEach((el) => {
      delete el.dataset.xtDone;
      delete el.dataset.xtObserved;
    });
    pageUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    lastErrorText = "";
  }

  function startForCurrentState() {
    if (isBlacklisted()) {
      statusText = "本站已停用";
      updateFloatingUI();
    } else if (!settings.enabled) {
      statusText = "已暂停";
      updateFloatingUI();
    } else if (settings.mode === "auto") {
      if (isXSite()) {
        setupDynamicObservers();
      } else {
        translateWholePage(false);
      }
    } else {
      statusText = "手动模式";
      updateFloatingUI();
    }
  }

  function setupRouteWatcher() {
    const onUrlChange = () => {
      if (location.href === currentHref) return;
      currentHref = location.href;
      isRestored = false;
      clearAllTranslations();
      setTimeout(() => {
        startForCurrentState();
      }, 450);
    };

    window.addEventListener("popstate", onUrlChange);
    routeTimer = setInterval(onUrlChange, 1200);
  }

  async function init() {
    const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
    settings = { ...DEFAULT_SETTINGS, ...stored };

    injectPageStyles();
    createFloatingCapsule();
    startForCurrentState();
    setupRouteWatcher();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      let styleChanged = false;
      let resetNeeded = false;
      let xReplaceChanged = false;

      for (const [key, { newValue }] of Object.entries(changes)) {
        settings[key] = newValue;
        if (key === "accentColor" || key === "mutedOpacity") styleChanged = true;
        if (key === "showFloatingBar" || key === "floatingPos") createFloatingCapsule();
        if (key === "xReplaceOriginal") xReplaceChanged = true;
        if (["enabled", "mode", "provider", "model", "targetLang", "systemPrompt", "baseUrl", "apiKey", "blacklist"].includes(key)) {
          resetNeeded = true;
        }
      }

      if (styleChanged) injectPageStyles();
      if (xReplaceChanged && !resetNeeded) {
        syncVisibilityAndXReplace();
      }
      if (resetNeeded) {
        cache.clear();
        clearAllTranslations();
        startForCurrentState();
      }
    });
  }

  init();
})();
