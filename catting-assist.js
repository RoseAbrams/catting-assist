// IMPORTANT This userscript is developed at github.com/RoseAbrams/catting-assist and is only copied manually to [[User:Rose Abrams/CattingAssist.js]] on Wikimedia Commons. If you are viewing this file on a WMF project, it may be outdated. Please check the GitHub repository for the latest version and report any issues there.
(function () {
  "use strict";

  if (
    mw.config.get("wgNamespaceNumber") !== 6 ||
    mw.config.get("wgAction") !== "view"
  ) {
    return;
  }

  var CONFIG = {
    aiEndpoint: "http://localhost:8787/v1/chat/completions",
    aiModel: "qwen2.5:7b-instruct",
    temperature: 0.1,
    maxTokens: 500,
  };

  var state = {
    mode: "generate",
    busy: false,
  };

  var api = new mw.Api();

  function injectStyles() {
    var style = document.createElement("style");
    style.textContent = [
      "#ai-categorizer-wrap{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap;}",
      "#ai-categorizer-panel{min-width:320px;max-width:420px;width:100%;padding:12px;border:1px solid #a2a9b1;background:#f8f9fa;border-radius:2px;box-sizing:border-box;}",
      "#ai-categorizer-panel .ai-cat-header{font-weight:700;margin-bottom:8px;}",
      "#ai-cat-text{width:100%;box-sizing:border-box;font-family:monospace;min-height:170px;}",
      "#ai-categorizer-panel .ai-cat-warning{margin-top:8px;font-size:12px;line-height:1.35;color:#202122;background:#fff3cd;border:1px solid #f1c40f;padding:6px 8px;border-radius:2px;font-weight:600;}",
      "#ai-categorizer-panel .ai-cat-actions{margin-top:10px;display:flex;gap:8px;align-items:center;}",
      "#ai-categorizer-panel #ai-cat-status{margin-top:8px;font-size:12px;color:#54595d;min-height:1em;}",
      "#ai-cat-spinner{display:none;width:14px;height:14px;border:2px solid #a2a9b1;border-top-color:#36c;border-radius:50%;animation:aiCatSpin 0.8s linear infinite;}",
      "#ai-cat-spinner.active{display:inline-block;}",
      "@keyframes aiCatSpin{to{transform:rotate(360deg);}}",
    ].join("");
    document.head.appendChild(style);
  }

  function buildUi() {
    var fileEl =
      document.getElementById("file") || document.querySelector(".fullMedia");
    var host =
      document.getElementById("mw-imagepage-content") ||
      document.getElementById("content") ||
      document.body;

    var panel = document.createElement("div");
    panel.id = "ai-categorizer-panel";
    panel.innerHTML = [
      '<div class="ai-cat-header">CattingAssist</div>',
      '<textarea id="ai-cat-text" rows="10" placeholder="Generated categories will appear here, one per line."></textarea>',
      '<div class="ai-cat-warning">AI-generated text may be incorrect or unsuitable. You take full responsibility for any action performed.</div>',
      '<div class="ai-cat-actions">',
      '  <button id="ai-cat-generate" type="button" class="mw-ui-button mw-ui-progressive">Generate</button>',
      '  <button id="ai-cat-next" type="button" class="mw-ui-button">Next</button>',
      '  <span id="ai-cat-spinner" aria-hidden="true"></span>',
      "</div>",
      '<div id="ai-cat-status" role="status" aria-live="polite"></div>',
    ].join("");

    if (fileEl && fileEl.parentNode) {
      var wrap = document.createElement("div");
      wrap.id = "ai-categorizer-wrap";
      fileEl.parentNode.insertBefore(wrap, fileEl);
      wrap.appendChild(fileEl);
      wrap.appendChild(panel);
    } else {
      host.insertBefore(panel, host.firstChild);
    }

    return {
      text: panel.querySelector("#ai-cat-text"),
      primary: panel.querySelector("#ai-cat-generate"),
      next: panel.querySelector("#ai-cat-next"),
      spinner: panel.querySelector("#ai-cat-spinner"),
      status: panel.querySelector("#ai-cat-status"),
    };
  }

  function setMode(ui, mode) {
    state.mode = mode;
    ui.primary.textContent = mode === "generate" ? "Generate" : "Submit";
  }

  function setWorking(ui, working, statusText) {
    state.busy = working;
    ui.primary.disabled = working;
    ui.spinner.classList.toggle("active", working);
    if (typeof statusText === "string") {
      ui.status.textContent = statusText;
    }
  }

  function randomUncategorizedUrl() {
    var year = new Date().getFullYear();
    return mw.util.getUrl(
      "Special:RandomInCategory/All media needing categories as of " + year,
    );
  }

  async function fetchCurrentPageWikitext() {
    var res = await api.get({
      action: "query",
      prop: "revisions",
      titles: mw.config.get("wgPageName"),
      rvprop: "ids|content",
      rvslots: "main",
      formatversion: 2,
    });

    var page = res && res.query && res.query.pages && res.query.pages[0];
    if (!page || page.missing) {
      throw new Error("Unable to load page wikitext.");
    }

    var rev = page.revisions && page.revisions[0];
    var content = rev && rev.slots && rev.slots.main && rev.slots.main.content;

    if (typeof content !== "string") {
      throw new Error("Page wikitext was empty or unavailable.");
    }

    return {
      title: page.title,
      revId: rev.revid,
      wikitext: content,
    };
  }

  function buildPrompt(title, wikitext) {
    return [
      "File title: " + title,
      "",
      "File page wikitext starts:",
      wikitext,
      "File page wikitext ends.",
    ].join("\n");
  }

  async function requestAiCategories(title, wikitext) {
    if (!CONFIG.aiEndpoint) {
      throw new Error(
        "AI endpoint not configured. Set CONFIG.aiEndpoint first.",
      );
    }

    var headers = {
      "Content-Type": "application/json",
    };
    if (CONFIG.aiApiKey) {
      headers.Authorization = "Bearer " + CONFIG.aiApiKey;
    }

    var body = {
      model: CONFIG.aiModel,
      messages: [
        {
          role: "system",
          content:
            "You are a Wikimedia Commons categorization assistant. Output only category wikimarkup lines.",
        },
        {
          role: "user",
          content: buildPrompt(title, wikitext),
        },
      ],
      temperature: CONFIG.temperature,
      max_tokens: CONFIG.maxTokens,
    };

    var resp = await fetch(CONFIG.aiEndpoint, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      throw new Error("AI request failed: HTTP " + resp.status);
    }

    var data = await resp.json();
    var content =
      data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;

    if (!content || typeof content !== "string") {
      throw new Error("AI response did not include text output.");
    }

    return content;
  }

  function normalizeAiOutputToCategoryLines(aiText) {
    var lines = (aiText || "").split(/\r?\n/);
    var cats = [];

    lines.forEach(function (line) {
      var m = line.match(/\[\[\s*Category\s*:\s*([^\]|]+)(?:\|[^\]]*)?\]\]/i);
      if (m && m[1]) {
        cats.push("[[Category:" + m[1].trim().replace(/_/g, " ") + "]]");
      }
    });

    if (!cats.length) {
      lines.forEach(function (line) {
        var plain = line
          .replace(/^[-*\d.\s]+/, "")
          .replace(/^Category\s*:\s*/i, "")
          .trim();
        if (plain) {
          cats.push("[[Category:" + plain + "]]");
        }
      });
    }

    var seen = Object.create(null);
    var out = [];
    cats.forEach(function (c) {
      var key = c.toLowerCase();
      if (!seen[key]) {
        seen[key] = true;
        out.push(c);
      }
    });

    return out.join("\n");
  }

  function removeUncategorizedTemplate(text) {
    return text
      .replace(/\{\{\s*[Uu]ncategorized\b(?:\|[\s\S]*?)?\}\}\s*/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd();
  }

  async function submitCategories(textareaValue) {
    var pageData = await fetchCurrentPageWikitext();
    var cleaned = removeUncategorizedTemplate(pageData.wikitext);
    var newText = cleaned + "\n\n" + textareaValue.trim() + "\n";

    await api.postWithEditToken({
      action: "edit",
      title: pageData.title,
      text: newText,
      summary:
        "Adding categories ([[User:Rose Abrams/CattingAssist|AI-assisted]])",
      baserevid: pageData.revId,
      nocreate: 1,
    });
  }

  async function onPrimaryClick(ui) {
    if (state.busy) {
      return;
    }

    if (state.mode === "generate") {
      setWorking(
        ui,
        true,
        "Collecting page wikitext and generating categories...",
      );
      try {
        var pageData = await fetchCurrentPageWikitext();
        var aiRaw = await requestAiCategories(
          pageData.title,
          pageData.wikitext,
        );
        var categoryLines = normalizeAiOutputToCategoryLines(aiRaw);
        if (!categoryLines) {
          throw new Error("AI response did not contain usable categories.");
        }

        ui.text.value = categoryLines;
        setMode(ui, "submit");
        setWorking(ui, false, "Review/edit the categories and click Submit.");
      } catch (err) {
        setWorking(
          ui,
          false,
          "Generate failed: " +
            (err && err.message ? err.message : String(err)),
        );
      }
      return;
    }

    var userText = ui.text.value.trim();
    if (!userText) {
      ui.status.textContent =
        "Nothing to submit. Add at least one category line.";
      return;
    }

    setWorking(ui, true, "Submitting edit...");
    try {
      await submitCategories(userText);
      setWorking(ui, false, "Saved successfully.");
      window.location.reload();
    } catch (err) {
      setWorking(
        ui,
        false,
        "Submit failed: " + (err && err.message ? err.message : String(err)),
      );
    }
  }

  function init() {
    injectStyles();
    var ui = buildUi();

    ui.primary.addEventListener("click", function () {
      onPrimaryClick(ui);
    });

    ui.next.addEventListener("click", function () {
      window.location.href = randomUncategorizedUrl();
    });
  }

  mw.loader.using(["mediawiki.api", "mediawiki.util"]).then(function () {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  });
})();
