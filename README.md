# Universal LLM Bilingual Translator

A lightweight Manifest V3 Chrome extension that translates any non-Chinese webpage (and X / Twitter feeds) using configurable LLM APIs (**Google Gemini**, **OpenAI-compatible**, **DeepSeek**, **OpenRouter**, **Ollama**, etc.) with whole-article context.

## Features

- **Whole-Article Context Translation**: Batches paragraphs with the article title so the LLM understands full context and terminology before outputting per-paragraph translations.
- **Preserves Original Layout**: Inherits paragraph typography (`font-family`, `font-size`, `line-height`, `text-align`) with subtle tinted cards and automatic light/dark theme adaptation.
- **Smart Non-Chinese Filtering**: Skips Chinese pages and Chinese paragraphs locally before calling the API to save tokens.
- **Inline Code Protection**: Preserves inline `<code>` tags without mangling variable names or commands.
- **X / Twitter Dedicated Mode**: Option to directly replace foreign tweets with translations (React-safe), with a tiny trailing source-language code badge (`EN`, `JP`, `FR`, `ES`, etc.). Click any badge to toggle that tweet's original text.
- **One-Click Restore & Draggable Floating Capsule**: Shadow DOM isolated control pill (minimized by default, draggable) with instant original-page restore, domain blacklist, and live page token usage.
- **Bring Your Own LLM API**: Supports Google Gemini native API (`gemini-3.5-flash-lite`, `gemini-3.8-flash`, etc.) and any OpenAI-compatible `/v1/chat/completions` endpoint, plus custom prompts and a built-in connection tester.

## Build & Install

### 1. Build unpacked extension & ZIP
Requires Python 3:
```bash
python build.py
```
This generates icons, validates `src/manifest.json`, outputs the unpacked extension to `dist/`, and packages `x-llm-translator-v<version>.zip`.

### 2. Load in Chrome
1. Open `chrome://extensions/` and enable **Developer mode**.
2. Click **Load unpacked** and select the `dist/` directory.
3. Click the extension icon → **LLM API 接口配置**, enter your API Base URL, API Key, and Model, then click **测试连接** and **保存配置**.

## Privacy

- All settings and API keys are stored strictly locally in `chrome.storage.local`.
- Page text is sent only to the LLM API endpoint you configure. No telemetry, analytics, or third-party servers are used.
