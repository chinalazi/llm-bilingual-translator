(function (global) {
  const DEFAULT_PROMPT = [
    "You are a professional translator for websites and social media.",
    "Read ALL numbered segments wrapped in [SEG_N]...[/SEG_N] to understand the full context, and translate ONLY non-Chinese content into {{targetLang}}.",
    "",
    "Strict Rules:",
    "1. SKIP Chinese: If a segment is written primarily in Chinese (Simplified or Traditional, including Chinese mixed with a few English terms/URLs), DO NOT translate or rephrase it — output exactly: [SEG_N]__SKIP__[/SEG_N]",
    "2. SKIP non-text: If a segment contains only symbols, numbers, emojis, URLs, @mentions, #hashtags, or {{CODE_N}} placeholders, output exactly: [SEG_N]__SKIP__[/SEG_N]",
    "3. ONLY translate non-Chinese segments into natural, idiomatic {{targetLang}}, preserving the original tone, slang, and context.",
    "4. Detect the source language of each translated segment as a 2-letter uppercase code (e.g. EN, JP, KR, FR, ES, DE, RU, AR, PT, IT) and put it in the tag attribute: [SEG_N lang=\"EN\"]译文[/SEG_N]",
    "5. Keep {{CODE_N}} placeholders, @mentions, #hashtags, URLs, and technical/code terms intact.",
    "6. Output ONLY the [SEG_N ...]...[/SEG_N] blocks matching the input numbers, with no extra explanations or quotes."
  ].join("\n");

  const PRESETS = {
    gemini: {
      label: "Google Gemini",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      model: "gemini-3.5-flash-lite",
      models: [
        { value: "gemini-3.5-flash-lite", label: "gemini-3.5-flash-lite (最快 · 推荐)" },
        { value: "gemini-3.1-flash-lite", label: "gemini-3.1-flash-lite (轻量极速)" },
        { value: "gemini-3.8-flash", label: "gemini-3.8-flash (最新均衡 · 质量更佳)" },
        { value: "gemini-3.6-flash", label: "gemini-3.6-flash (均衡)" },
        { value: "gemini-4-argon", label: "gemini-4-argon (旗舰推理)" },
        { value: "gemini-3.1-pro-preview", label: "gemini-3.1-pro-preview (Pro 预览)" }
      ]
    },
    openai: {
      label: "OpenAI Compatible",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      models: [
        { value: "gpt-4o-mini", label: "gpt-4o-mini" },
        { value: "gpt-4.1-mini", label: "gpt-4.1-mini" },
        { value: "deepseek-chat", label: "deepseek-chat" },
        { value: "qwen-plus", label: "qwen-plus" }
      ]
    }
  };

  const DEFAULT_SETTINGS = {
    enabled: true,
    mode: "auto", // "auto" | "manual"
    targetLang: "简体中文",
    provider: "gemini", // "gemini" | "openai"
    baseUrl: PRESETS.gemini.baseUrl,
    apiKey: "",
    model: PRESETS.gemini.model,
    systemPrompt: DEFAULT_PROMPT,
    accentColor: "#1d9bf0",
    mutedOpacity: 0.88,
    showFloatingBar: true,
    xReplaceOriginal: true,
    floatingPos: null,
    blacklist: [],
    tokenStats: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    }
  };

  const LANGUAGES = [
    "简体中文",
    "繁體中文",
    "English",
    "日本語",
    "한국어",
    "Français",
    "Deutsch",
    "Español",
    "Português",
    "Русский",
    "العربية"
  ];

  global.XT_CONFIG = {
    DEFAULT_PROMPT,
    PRESETS,
    DEFAULT_SETTINGS,
    LANGUAGES
  };
})(typeof self !== "undefined" ? self : window);
