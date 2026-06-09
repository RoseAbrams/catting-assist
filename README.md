# CattingAssist

This repository contains:

- `catting-assist.js`: Wikimedia Commons user script UI + Generate/Submit/Next flow.
- `ai-gateway.mjs`: Local API gateway that exposes OpenAI-compatible chat completions and forwards to Ollama.
- `ai-config.json`: Local gateway configuration.

## Chosen AI

This setup uses **Ollama** (FOSS-friendly local model runner) with the default model:

- `qwen2.5:7b-instruct`

You can change model names in `ai-config.json` and in `catting-assist.js`.

## Quick setup (Windows/macOS/Linux)

1. Install Ollama: https://ollama.com
2. Pull the default model:

```bash
ollama pull qwen2.5:7b-instruct
```

3. Start Ollama (if not already running).
4. Start the local gateway from this folder:

```bash
npm start
```

5. Add `catting-assist.js` to your Commons user JavaScript page (`User:<name>/common.js`) or import it.

## Userscript endpoint

The userscript is preconfigured to call:

- `http://127.0.0.1:8787/v1/chat/completions`

If you change gateway host/port, update `CONFIG.aiEndpoint` in `catting-assist.js`.

## Config reference (`ai-config.json`)

- `listenHost`: Interface to bind the gateway (`127.0.0.1` by default).
- `listenPort`: Gateway port (`8787` by default).
- `ollamaBaseUrl`: Ollama API URL.
- `defaultModel`: Model name used when request model is empty.
- `allowOrigins`: Allowed browser origins for CORS.
- `requestTimeoutMs`: Timeout for a single AI request.

## Notes

- The gateway does not add web-browsing tools; prompts are sent as plain text and responses come only from the model.
- If your browser blocks insecure localhost calls from HTTPS pages, run the gateway behind HTTPS and set `CONFIG.aiEndpoint` accordingly.
