// cdp:smoke — verify the CDP endpoint is reachable and report targets.
// Checks both /json/version and /json/list (the two things a fresh Codex
// session / MCP attach need to succeed).

import { DEFAULT_CDP_PORT } from "./runtime-config.mjs";

const port = Number(process.env.CHROME_REMOTE_DEBUGGING_PORT || DEFAULT_CDP_PORT);

try {
  const versionRes = await fetch(`http://127.0.0.1:${port}/json/version`);
  if (!versionRes.ok) throw new Error(`/json/version -> ${versionRes.status}`);
  const version = await versionRes.json();
  const listRes = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!listRes.ok) throw new Error(`/json/list -> ${listRes.status}`);
  const targets = await listRes.json();
  const pages = targets.filter((t) => t.type === "page");

  console.log(
    JSON.stringify(
      {
        ok: true,
        port,
        browser: version.Browser,
        webSocketDebuggerUrl: version.webSocketDebuggerUrl,
        pageTargets: pages.length,
        pages: pages.map((p) => ({ title: p.title, url: p.url })),
      },
      null,
      2,
    ),
  );
} catch (err) {
  console.error(
    JSON.stringify(
      { ok: false, port, error: String(err?.message || err), hint: "run `npm run chrome` first" },
      null,
      2,
    ),
  );
  process.exit(1);
}
