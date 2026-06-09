import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

const defaultConfig = {
  listenHost: "127.0.0.1",
  listenPort: 8787,
  ollamaBaseUrl: "http://127.0.0.1:11434",
  defaultModel: "qwen2.5:7b-instruct",
  allowOrigins: ["https://commons.wikimedia.org"],
  requestTimeoutMs: 90000,
};

const defaultPrompt =
  "Task: Suggest suitable Wikimedia Commons categories for this file page.\n" +
  "Use only the provided title and page wikitext. The most useful information is often in the title and the file description.\n" +
  //"Do not browse the internet and do not assume external facts.\n"+
  "Do not add categories based on the templates, since those often automatically add categories.\n" +
  "Make the categories as narrow as possible, many specific categories are better than a few broad ones.\n" +
  "Input may be in any major language.\n" +
  "Return only category wikimarkup lines in this exact format:\n" +
  "[[Category:Category name]]\n" +
  "No explanations. One category per line.\n";

function loadConfig() {
  const cfgPath = process.env.AI_CONFIG_PATH || "./ai-config.json";
  if (!existsSync(cfgPath)) {
    return defaultConfig;
  }

  const parsed = JSON.parse(readFileSync(cfgPath, "utf8"));
  return {
    ...defaultConfig,
    ...parsed,
  };
}

const config = loadConfig();

function isAllowedOrigin(origin) {
  if (!origin) {
    return false;
  }
  if (config.allowOrigins.includes("*")) {
    return true;
  }
  return config.allowOrigins.includes(origin);
}

function withCors(req, res) {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 2 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

async function callOllama(chatCompletionRequest) {
  const model = chatCompletionRequest.model || config.defaultModel;
  const messages = Array.isArray(chatCompletionRequest.messages)
    ? chatCompletionRequest.messages
    : [];
  messages[1].content = defaultPrompt + (messages[1]?.content || "");
  console.log(messages);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const ollamaResp = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          temperature:
            typeof chatCompletionRequest.temperature === "number"
              ? chatCompletionRequest.temperature
              : 0.1,
          num_predict: Number.isFinite(chatCompletionRequest.max_tokens)
            ? chatCompletionRequest.max_tokens
            : 500,
        },
      }),
      signal: controller.signal,
    });

    if (!ollamaResp.ok) {
      const errText = await ollamaResp.text();
      throw new Error(
        `Ollama error ${ollamaResp.status}: ${errText.slice(0, 300)}`,
      );
    }

    const data = await ollamaResp.json();
    const content = data?.message?.content || "";

    return {
      id: `chatcmpl-${randomUUID()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

const server = http.createServer(async (req, res) => {
  withCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, {
      ok: true,
      model: config.defaultModel,
      ollamaBaseUrl: config.ollamaBaseUrl,
    });
    return;
  }

  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    try {
      const body = await readJsonBody(req);
      const out = await callOllama(body);
      sendJson(res, 200, out);
    } catch (err) {
      sendJson(res, 500, {
        error: {
          message: err?.message || String(err),
        },
      });
    }
    return;
  }

  sendJson(res, 404, {
    error: {
      message: "Not found",
    },
  });
});

server.listen(config.listenPort, config.listenHost, () => {
  console.log(
    `AI gateway listening on http://${config.listenHost}:${config.listenPort}`,
  );
  console.log(
    `Forwarding to Ollama at ${config.ollamaBaseUrl} using default model ${config.defaultModel}`,
  );
});
