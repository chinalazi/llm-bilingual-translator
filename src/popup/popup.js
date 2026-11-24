const { DEFAULT_SETTINGS, DEFAULT_PROMPT, PRESETS, LANGUAGES } = window.XT_CONFIG;

const els = {
  mainView: document.getElementById("mainView"),
  apiView: document.getElementById("apiView"),
  backBtn: document.getElementById("backBtn"),
  headerTitle: document.getElementById("headerTitle"),
  versionBadge: document.getElementById("versionBadge"),
  openApiConfigBtn: document.getElementById("openApiConfigBtn"),
  apiSummary: document.getElementById("apiSummary"),
  enabled: document.getElementById("enabled"),
  provider: document.getElementById("provider"),
  baseUrl: document.getElementById("baseUrl"),
  apiKey: document.getElementById("apiKey"),
  toggleKey: document.getElementById("toggleKey"),
  modelPreset: document.getElementById("modelPreset"),
  model: document.getElementById("model"),
  systemPrompt: document.getElementById("systemPrompt"),
  resetPromptBtn: document.getElementById("resetPromptBtn"),
  mode: document.getElementById("mode"),
  targetLang: document.getElementById("targetLang"),
  accentColor: document.getElementById("accentColor"),
  mutedOpacity: document.getElementById("mutedOpacity"),
  xReplaceOriginal: document.getElementById("xReplaceOriginal"),
  showFloatingBar: document.getElementById("showFloatingBar"),
  testBtn: document.getElementById("testBtn"),
  saveBtn: document.getElementById("saveBtn"),
  statusMsg: document.getElementById("statusMsg"),
  tokenSummary: document.getElementById("tokenSummary"),
  resetTokensBtn: document.getElementById("resetTokensBtn")
};

function showView(viewName) {
  const isApi = viewName === "api";
  els.mainView.classList.toggle("hidden", isApi);
  els.apiView.classList.toggle("hidden", !isApi);
  els.backBtn.classList.toggle("hidden", !isApi);
  els.versionBadge.classList.toggle("hidden", isApi);
  els.headerTitle.textContent = isApi ? "LLM API 接口配置" : "全网页 LLM 翻译器";
  if (!isApi) {
    setStatus("");
  }
}

function setStatus(text, isError = false) {
  els.statusMsg.textContent = text;
  els.statusMsg.className = `status-msg ${isError ? "err" : "ok"}`;
}

function updateApiSummary(s) {
  const providerLabel = PRESETS[s.provider]?.label || s.provider;
  if (!s.apiKey && s.provider === "gemini") {
    els.apiSummary.textContent = `${providerLabel} · 未填写 API Key`;
    els.apiSummary.classList.add("warn");
  } else {
    els.apiSummary.textContent = `${providerLabel} · ${s.model || "未填模型"}`;
    els.apiSummary.classList.remove("warn");
  }
}

function populateLanguages() {
  LANGUAGES.forEach((lang) => {
    const opt = document.createElement("option");
    opt.value = lang;
    opt.textContent = lang;
    els.targetLang.appendChild(opt);
  });
}

function populateModelPresets(provider, currentModel) {
  const models = PRESETS[provider]?.models || [];
  els.modelPreset.textContent = "";

  models.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item.value;
    opt.textContent = item.label;
    els.modelPreset.appendChild(opt);
  });

  const customOpt = document.createElement("option");
  customOpt.value = "__custom__";
  customOpt.textContent = "自定义模型 (在下方手动输入)";
  els.modelPreset.appendChild(customOpt);

  const matched = models.some((m) => m.value === currentModel);
  els.modelPreset.value = matched ? currentModel : "__custom__";
}

function renderTokenStats(stats = {}) {
  const p = Number(stats.promptTokens || 0).toLocaleString("en-US");
  const c = Number(stats.completionTokens || 0).toLocaleString("en-US");
  const t = Number(stats.totalTokens || 0).toLocaleString("en-US");
  els.tokenSummary.textContent = `输入 ${p} / 输出 ${c} / 总计 ${t}`;
}

function collectApiFormValues() {
  return {
    provider: els.provider.value,
    baseUrl: els.baseUrl.value.trim(),
    apiKey: els.apiKey.value.trim(),
    model: els.model.value.trim(),
    systemPrompt: els.systemPrompt.value,
    targetLang: els.targetLang.value
  };
}

async function loadSettings() {
  els.versionBadge.textContent = `v${chrome.runtime.getManifest().version}`;
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const s = { ...DEFAULT_SETTINGS, ...stored };

  els.enabled.checked = Boolean(s.enabled);
  els.provider.value = s.provider;
  els.baseUrl.value = s.baseUrl;
  els.apiKey.value = s.apiKey;
  els.model.value = s.model;
  populateModelPresets(s.provider, s.model);
  els.systemPrompt.value = s.systemPrompt;
  els.mode.value = s.mode;
  els.targetLang.value = s.targetLang;
  els.accentColor.value = s.accentColor;
  els.mutedOpacity.value = String(s.mutedOpacity);
  els.xReplaceOriginal.checked = Boolean(s.xReplaceOriginal);
  els.showFloatingBar.checked = Boolean(s.showFloatingBar);
  renderTokenStats(s.tokenStats);
  updateApiSummary(s);
}

els.openApiConfigBtn.addEventListener("click", () => showView("api"));
els.backBtn.addEventListener("click", () => showView("main"));

els.provider.addEventListener("change", () => {
  const preset = PRESETS[els.provider.value];
  if (!preset) return;
  const currentBase = els.baseUrl.value.trim();
  const isDefaultBase = Object.values(PRESETS).some((p) => p.baseUrl === currentBase) || !currentBase;
  if (isDefaultBase) {
    els.baseUrl.value = preset.baseUrl;
  }
  const currentModel = els.model.value.trim();
  const isDefaultModel =
    Object.values(PRESETS).some((p) => p.model === currentModel || p.models?.some((m) => m.value === currentModel)) ||
    !currentModel;
  if (isDefaultModel) {
    els.model.value = preset.model;
  }
  populateModelPresets(els.provider.value, els.model.value.trim());
});

els.modelPreset.addEventListener("change", () => {
  if (els.modelPreset.value === "__custom__") {
    els.model.focus();
    return;
  }
  els.model.value = els.modelPreset.value;
});

els.model.addEventListener("input", () => {
  const models = PRESETS[els.provider.value]?.models || [];
  const val = els.model.value.trim();
  els.modelPreset.value = models.some((m) => m.value === val) ? val : "__custom__";
});

els.toggleKey.addEventListener("click", () => {
  const isPwd = els.apiKey.type === "password";
  els.apiKey.type = isPwd ? "text" : "password";
  els.toggleKey.textContent = isPwd ? "隐藏" : "显示";
});

els.resetPromptBtn.addEventListener("click", () => {
  els.systemPrompt.value = DEFAULT_PROMPT;
  setStatus("已恢复默认提示词，请点击「保存配置」生效。");
});

els.saveBtn.addEventListener("click", async () => {
  const vals = collectApiFormValues();
  await chrome.storage.local.set(vals);
  updateApiSummary(vals);
  setStatus("API 配置已保存。");
});

els.enabled.addEventListener("change", () => chrome.storage.local.set({ enabled: els.enabled.checked }));
els.mode.addEventListener("change", () => chrome.storage.local.set({ mode: els.mode.value }));
els.targetLang.addEventListener("change", () => chrome.storage.local.set({ targetLang: els.targetLang.value }));
els.accentColor.addEventListener("change", () => chrome.storage.local.set({ accentColor: els.accentColor.value }));
els.mutedOpacity.addEventListener("change", () =>
  chrome.storage.local.set({ mutedOpacity: Number(els.mutedOpacity.value) || 0.88 })
);
els.xReplaceOriginal.addEventListener("change", () =>
  chrome.storage.local.set({ xReplaceOriginal: els.xReplaceOriginal.checked })
);
els.showFloatingBar.addEventListener("change", () =>
  chrome.storage.local.set({ showFloatingBar: els.showFloatingBar.checked })
);

els.resetTokensBtn.addEventListener("click", async () => {
  const zero = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  await chrome.storage.local.set({ tokenStats: zero });
  renderTokenStats(zero);
});

els.testBtn.addEventListener("click", async () => {
  els.testBtn.disabled = true;
  setStatus("正在测试 API 连接...");
  try {
    const draft = collectApiFormValues();
    const res = await chrome.runtime.sendMessage({
      type: "TEST_CONNECTION",
      settings: draft
    });
    if (!res || !res.ok) {
      throw new Error(res?.error || "连接失败");
    }
    setStatus(`连接成功！示例译文：${res.translation} (Token: ${res.usage?.totalTokens || 0})`);
    const { tokenStats } = await chrome.storage.local.get("tokenStats");
    renderTokenStats(tokenStats);
  } catch (err) {
    setStatus(`测试失败：${err?.message || String(err)}`, true);
  } finally {
    els.testBtn.disabled = false;
  }
});

populateLanguages();
loadSettings();
