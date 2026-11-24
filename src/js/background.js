importScripts("./config.js");

const { DEFAULT_SETTINGS } = self.XT_CONFIG;
const FETCH_TIMEOUT_MS = 45000;
const MAX_RETRIES = 2;

let tokenWriteChain = Promise.resolve();

async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  return { ...DEFAULT_SETTINGS, ...stored };
}

function normalizeBaseUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function buildPrompt(template, targetLang) {
  const base = (template || DEFAULT_SETTINGS.systemPrompt).trim();
  return base.replace(/\{\{\s*targetLang\s*\}\}/g, targetLang || "简体中文");
}

function recordTokenUsage(usage) {
  if (!usage) return Promise.resolve();
  tokenWriteChain = tokenWriteChain
    .then(async () => {
      const { tokenStats = { promptTokens: 0, completionTokens: 0, totalTokens: 0 } } =
        await chrome.storage.local.get("tokenStats");
      const updated = {
        promptTokens: (tokenStats.promptTokens || 0) + (usage.promptTokens || 0),
        completionTokens: (tokenStats.completionTokens || 0) + (usage.completionTokens || 0),
        totalTokens: (tokenStats.totalTokens || 0) + (usage.totalTokens || 0)
      };
      await chrome.storage.local.set({ tokenStats: updated });
    })
    .catch(() => {});
  return tokenWriteChain;
}

async function fetchWithRetry(url, options) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      });

      if ((response.status === 429 || response.status === 503) && attempt < MAX_RETRIES) {
        const delayMs = 800 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      return response;
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        const delayMs = 600 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
    }
  }
  if (lastError?.name === "TimeoutError") {
    throw new Error(`请求超时（超过 ${FETCH_TIMEOUT_MS / 1000} 秒）`);
  }
  throw lastError || new Error("网络请求失败");
}

async function callGemini({ baseUrl, apiKey, model, systemPrompt, userContent }) {
  const root = normalizeBaseUrl(baseUrl) || "https://generativelanguage.googleapis.com/v1beta";
  const endpoint = `${root}/models/${encodeURIComponent(model)}:generateContent`;

  const response = await fetchWithRetry(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userContent }]
        }
      ]
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data?.error?.message || `HTTP ${response.status}`;
    throw new Error(`Gemini API Error: ${msg}`);
  }

  const output = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text || "")
    .join("")
    .trim();

  if (!output) {
    throw new Error("Gemini API returned empty content.");
  }

  const meta = data?.usageMetadata || {};
  const promptTokens = Number(meta.promptTokenCount) || 0;
  const completionTokens = Number(meta.candidatesTokenCount) || 0;
  const totalTokens = Number(meta.totalTokenCount) || promptTokens + completionTokens;

  return {
    output,
    usage: { promptTokens, completionTokens, totalTokens }
  };
}

async function callOpenAICompatible({ baseUrl, apiKey, model, systemPrompt, userContent }) {
  const root = normalizeBaseUrl(baseUrl) || "https://api.openai.com/v1";
  const endpoint = root.endsWith("/chat/completions") ? root : `${root}/chat/completions`;

  const headers = {
    "Content-Type": "application/json"
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetchWithRetry(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ]
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data?.error?.message || data?.message || `HTTP ${response.status}`;
    throw new Error(`API Error: ${msg}`);
  }

  const output = data?.choices?.[0]?.message?.content?.trim();
  if (!output) {
    throw new Error("LLM API returned empty content.");
  }

  const u = data?.usage || {};
  const promptTokens = Number(u.prompt_tokens) || 0;
  const completionTokens = Number(u.completion_tokens) || 0;
  const totalTokens = Number(u.total_tokens) || promptTokens + completionTokens;

  return {
    output,
    usage: { promptTokens, completionTokens, totalTokens }
  };
}

function cleanSegmentText(text) {
  if (!text) return "";
  return String(text)
    .replace(/\[\/?SEG_?\d+[^\]]*\]/gi, "")
    .replace(/^\s*SEG_?\d+\s*[:：\-]?\s*/gim, "")
    .trim();
}

function parseSegments(rawOutput, expectedCount) {
  const results = new Array(expectedCount).fill(null);
  const fullRegex = /\[SEG_?(\d+)(?:\s+lang=["']?([^"'\]]+)["']?)?\]([\s\S]*?)\[\/SEG_?\1\]/gi;
  let match;
  let matchedCount = 0;

  while ((match = fullRegex.exec(rawOutput)) !== null) {
    const idx = Number(match[1]);
    if (idx >= 0 && idx < expectedCount) {
      const lang = (match[2] || "").trim();
      const text = cleanSegmentText(match[3]);
      results[idx] = { text, lang };
      matchedCount++;
    }
  }

  // Fallback 1: model used opening [SEG_N ...] tags without closing [/SEG_N]
  if (matchedCount === 0) {
    const openRegex = /\[SEG_?(\d+)(?:\s+lang=["']?([^"'\]]+)["']?)?\]/gi;
    const markers = [];
    let m;
    while ((m = openRegex.exec(rawOutput)) !== null) {
      markers.push({
        idx: Number(m[1]),
        lang: (m[2] || "").trim(),
        start: m.index,
        end: m.index + m[0].length
      });
    }
    for (let i = 0; i < markers.length; i++) {
      const cur = markers[i];
      const nextStart = i + 1 < markers.length ? markers[i + 1].start : rawOutput.length;
      if (cur.idx >= 0 && cur.idx < expectedCount) {
        const chunkText = cleanSegmentText(rawOutput.slice(cur.end, nextStart));
        results[cur.idx] = { text: chunkText, lang: cur.lang };
        matchedCount++;
      }
    }
  }

  // Fallback 2: single-segment plain output without any tags
  if (matchedCount === 0 && expectedCount === 1) {
    results[0] = { text: cleanSegmentText(rawOutput), lang: "" };
  }

  return results;
}

async function translateBatch({ segments, articleTitle }, overrideSettings) {
  const settings = overrideSettings
    ? { ...(await getSettings()), ...overrideSettings }
    : await getSettings();

  if (!settings.apiKey && settings.provider === "gemini") {
    throw new Error("未配置 API Key，请在扩展弹窗中填写。");
  }
  if (!settings.model) {
    throw new Error("未配置 Model 名称，请在扩展弹窗中填写。");
  }

  const systemPrompt = buildPrompt(settings.systemPrompt, settings.targetLang);
  const titleHeader = articleTitle ? `Article Title (for context): ${articleTitle}\n\n` : "";
  const body = segments
    .map((text, idx) => `[SEG_${idx}]\n${text}\n[/SEG_${idx}]`)
    .join("\n\n");
  const userContent = `${titleHeader}${body}`;

  const payload = {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    systemPrompt,
    userContent
  };

  const result =
    settings.provider === "gemini"
      ? await callGemini(payload)
      : await callOpenAICompatible(payload);

  await recordTokenUsage(result.usage);

  return {
    translations: parseSegments(result.output, segments.length),
    usage: result.usage
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "TRANSLATE_BATCH") {
    (async () => {
      try {
        const result = await translateBatch({
          segments: message.segments || [],
          articleTitle: message.articleTitle || ""
        });
        sendResponse({ ok: true, ...result });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  if (message.type === "TEST_CONNECTION") {
    (async () => {
      try {
        const result = await translateBatch(
          {
            segments: ["Hello world! Building awesome tools today."],
            articleTitle: "Test"
          },
          message.settings
        );
        sendResponse({
          ok: true,
          translation: result.translations[0]?.text || "",
          lang: result.translations[0]?.lang || "",
          usage: result.usage
        });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || String(err) });
      }
    })();
    return true;
  }

  return false;
});
