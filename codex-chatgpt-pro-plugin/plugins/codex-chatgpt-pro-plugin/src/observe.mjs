import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

export function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export function createRunState({ runDir, runId, target, profileDir, posture, cdpUrls = [] }) {
  const statePath = resolve(runDir, "run.json");
  const state = {
    runId,
    target,
    profileDir,
    posture,
    cdpUrls,
    phase: "created",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  function update(phase, extra = {}) {
    Object.assign(state, extra, {
      phase,
      updatedAt: new Date().toISOString(),
    });
    writeJson(statePath, state);
    return state;
  }

  update("created");
  return { state, statePath, update };
}

export function startRunObserver({ runDir, runId, host = "127.0.0.1", port = 0 }) {
  const contentTypes = new Map([
    [".html", "text/html; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".md", "text/markdown; charset=utf-8"],
    [".png", "image/png"],
  ]);

  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || host}`);
    const path = url.pathname;

    if (path === "/" || path === `/runs/${runId}` || path === `/runs/${runId}/`) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderObserverPage(runId));
      return;
    }

    if (path === `/runs/${runId}/files`) {
      const files = [
        "run.json",
        "receipt.json",
        "receipt.md",
        "snapshot.json",
        "console.json",
        "network.json",
      ];
      res.writeHead(200, jsonHeaders);
      res.end(JSON.stringify({ files: files.filter((file) => existsSync(resolve(runDir, file))) }));
      return;
    }

    const prefix = `/runs/${runId}/files/`;
    if (path.startsWith(prefix)) {
      const file = path.slice(prefix.length);
      if (file.includes("/") || file.includes("..")) {
        res.writeHead(400).end("Bad request");
        return;
      }
      const filePath = resolve(runDir, file);
      if (!existsSync(filePath)) {
        res.writeHead(404).end("Not found");
        return;
      }
      res.writeHead(200, {
        "content-type": contentTypes.get(extname(filePath)) || "text/plain; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(readFileSync(filePath));
      return;
    }

    res.writeHead(404).end("Not found");
  });

  return new Promise((resolveStart, rejectStart) => {
    server.once("error", rejectStart);
    server.listen(port, host, () => {
      server.off("error", rejectStart);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolveStart({
        url: `http://${host}:${actualPort}/runs/${runId}`,
        close: () => new Promise((resolveClose) => server.close(resolveClose)),
      });
    });
  });
}

export async function createRecorder(cdp, { runDir, observerUrl = "", chromeDebugUrl = "" }) {
  const consoleEntries = [];
  const network = [];
  const requestsById = new Map();

  await cdp.send("Network.enable").catch(() => {});
  await cdp.send("Runtime.enable").catch(() => {});
  await cdp.send("Log.enable").catch(() => {});

  cdp.on("Runtime.consoleAPICalled", (p) => {
    const text = (p.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
    consoleEntries.push({ source: "console", level: p.type, text });
  });
  cdp.on("Log.entryAdded", (p) => {
    consoleEntries.push({ source: "log", level: p.entry.level, text: p.entry.text });
  });
  cdp.on("Network.requestWillBeSent", (p) => {
    requestsById.set(p.requestId, p.request.url);
    network.push({ phase: "request", method: p.request.method, url: p.request.url });
  });
  cdp.on("Network.responseReceived", (p) => {
    network.push({ phase: "response", status: p.response.status, url: p.response.url });
  });
  cdp.on("Network.loadingFailed", (p) => {
    network.push({ phase: "failed", error: p.errorText, url: requestsById.get(p.requestId) || "" });
  });

  async function screenshot(name) {
    try {
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(resolve(runDir, `${name}.png`), Buffer.from(data, "base64"), { mode: 0o600 });
    } catch {
      // headless w/o a surface, or page gone — skip rather than fail the run
    }
  }

  async function snapshot(name) {
    try {
      const { result } = await cdp.send("Runtime.evaluate", {
        expression: `(() => ({
          url: location.href,
          title: document.title,
          bodyTextLength: document.body?.innerText?.length || 0,
          roleCounts: [...document.querySelectorAll("[data-message-author-role]")]
            .reduce((counts, el) => {
              const role = el.getAttribute("data-message-author-role") || "unknown";
              counts[role] = (counts[role] || 0) + 1;
              return counts;
            }, {}),
          composerPresent: !!document.querySelector('textarea, [contenteditable="true"][role="textbox"], [role="textbox"]')
        }))()`,
        returnByValue: true,
      });
      writeJson(resolve(runDir, `${name}.json`), result.value || {});
    } catch {
      // ignore
    }
  }

  async function finalize(receipt) {
    const errors = consoleEntries.filter((c) => /error|warning|severe/i.test(c.level));
    const failed = network.filter((n) => n.phase === "failed" || (n.status && n.status >= 400));

    writeJson(resolve(runDir, "console.json"), consoleEntries);
    writeJson(resolve(runDir, "network.json"), network);

    const artifacts = {
      receiptJson: resolve(runDir, "receipt.json"),
      receiptMd: resolve(runDir, "receipt.md"),
      screenshot: resolve(runDir, "final.png"),
      snapshot: resolve(runDir, "snapshot.json"),
      console: resolve(runDir, "console.json"),
      network: resolve(runDir, "network.json"),
      observer: observerUrl,
      chromeDebug: chromeDebugUrl,
    };
    for (const file of ["input.md", "prompt.md", "assistant.md", "transcript.md"]) {
      const path = resolve(runDir, file);
      if (existsSync(path)) artifacts[file.replace(".md", "")] = path;
    }

    const fullArtifacts = {
      ...(receipt.artifacts || {}),
      ...artifacts,
    };
    const full = {
      ...receipt,
      artifacts: fullArtifacts,
      diagnostics: { consoleErrors: errors.length, failedRequests: failed.length },
    };
    const md = renderMarkdown(full, { errors, failed });

    writeJson(resolve(runDir, "receipt.json"), full);
    writeFileSync(resolve(runDir, "receipt.md"), md, { mode: 0o600 });
    return { artifacts, summary: md };
  }

  return { screenshot, snapshot, finalize };
}

function renderObserverPage(runId) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Browser Run ${escapeHtml(runId)}</title>
    <style>
      body { margin: 0; font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #17191f; background: #f6f7fa; }
      main { max-width: 1040px; margin: 28px auto; padding: 0 18px; }
      h1 { margin: 0 0 8px; font-size: 24px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin: 16px 0; }
      section { border: 1px solid #d9deea; border-radius: 8px; padding: 14px; background: #fff; }
      pre { overflow: auto; max-height: 420px; padding: 12px; border-radius: 6px; background: #10141f; color: #f2f5ff; }
      img { max-width: 100%; border: 1px solid #d9deea; border-radius: 8px; background: #fff; }
      a { color: #175edc; }
      .phase { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #e7eefc; color: #17448f; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <h1>Browser Run</h1>
      <p>Run id: <code>${escapeHtml(runId)}</code> <span id="phase" class="phase">loading</span></p>
      <div class="grid">
        <section><h2>Run State</h2><pre id="run">loading...</pre></section>
        <section><h2>Receipt</h2><pre id="receipt">waiting...</pre></section>
      </div>
      <section><h2>Final Screenshot</h2><img id="screenshot" alt="Final screenshot will appear when captured" /></section>
      <div class="grid">
        <section><h2>Console</h2><pre id="console">waiting...</pre></section>
        <section><h2>Network</h2><pre id="network">waiting...</pre></section>
      </div>
    </main>
    <script>
      const base = "/runs/${encodeURIComponent(runId)}/files/";
      async function readJson(file) {
        const res = await fetch(base + file, { cache: "no-store" });
        if (!res.ok) return null;
        return res.json();
      }
      async function refresh() {
        const run = await readJson("run.json");
        if (run) {
          document.querySelector("#run").textContent = JSON.stringify(run, null, 2);
          document.querySelector("#phase").textContent = run.phase || "unknown";
        }
        const receipt = await readJson("receipt.json");
        if (receipt) document.querySelector("#receipt").textContent = JSON.stringify(receipt, null, 2);
        const consoleData = await readJson("console.json");
        if (consoleData) document.querySelector("#console").textContent = JSON.stringify(consoleData, null, 2);
        const network = await readJson("network.json");
        if (network) document.querySelector("#network").textContent = JSON.stringify(network, null, 2);
        document.querySelector("#screenshot").src = base + "final.png?ts=" + Date.now();
      }
      refresh();
      setInterval(refresh, 1000);
    </script>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderMarkdown(receipt, { errors, failed }) {
  const a = receipt.artifacts;
  const lines = [
    `# Run Receipt — ${receipt.loop || receipt.driver || "run"}`,
    "",
    `- verdict: **${receipt.ok ? "PASS ✅" : "FAIL ❌"}**`,
    `- posture: ${receipt.posture}`,
    `- target: ${receipt.target}`,
    `- total: ${receipt.totalMs ?? "?"}ms`,
  ];
  if (receipt.error) lines.push(`- error: \`${receipt.error}\``);
  if (receipt.errorCode) lines.push(`- error code: \`${receipt.errorCode}\``);
  if (receipt.nextAction) lines.push(`- next action: \`${receipt.nextAction}\``);
  if (receipt.message) lines.push(`- message: ${receipt.message}`);
  lines.push("", "## Steps");
  for (const s of receipt.steps || []) {
    lines.push(`- ${s.ok ? "✅" : "❌"} ${s.step} — ${s.ms}ms${s.error ? ` — \`${s.error}\`` : ""}`);
  }
  lines.push("", "## Diagnostics");
  lines.push(`- console errors/warnings: ${errors.length}`);
  lines.push(`- failed requests: ${failed.length}`);
  if (failed.length) for (const f of failed.slice(0, 10)) lines.push(`  - ${f.status || f.error} ${f.url}`);
  lines.push("", "## Artifacts");
  if (a.observer) lines.push(`- run inspector: ${a.observer}`);
  if (a.chromeDebug) lines.push(`- Chrome DevTools targets: ${a.chromeDebug}`);
  lines.push(`- screenshot: ${a.screenshot}`);
  lines.push(`- snapshot: ${a.snapshot}`);
  lines.push(`- console: ${a.console}`);
  lines.push(`- network: ${a.network}`);
  return lines.join("\n") + "\n";
}
