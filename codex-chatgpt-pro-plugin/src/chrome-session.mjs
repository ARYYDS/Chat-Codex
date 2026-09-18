import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  boolEnv,
  DEFAULT_CDP_PORT,
  DEFAULT_TARGET_URL,
  profilePath,
  stateRoot,
} from "./runtime-config.mjs";

function which(binary) {
  const result = spawnSync("which", [binary], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

export function findChromeExecutable() {
  const fromEnv = process.env.CHROME_PATH || process.env.GOOGLE_CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const candidates =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
      : process.platform === "win32"
        ? [
            `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
            `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
            `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
          ].filter(Boolean)
        : [
            which("google-chrome"),
            which("google-chrome-stable"),
            which("chromium"),
            which("chromium-browser"),
          ].filter(Boolean);

  const executable = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!executable) {
    throw new Error(
      "Could not find Google Chrome. Set CHROME_PATH to the Chrome executable path.",
    );
  }
  return executable;
}

export async function waitForCdp(port, timeoutMs = 10_000) {
  const url = `http://127.0.0.1:${port}/json/version`;
  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`CDP responded with ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
  }

  throw new Error(`Chrome CDP did not become available at ${url}: ${lastError}`);
}

async function cdpReachable(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

export function buildChromeArgs({
  port = DEFAULT_CDP_PORT,
  userDataDir = profilePath("chatgpt-pro"),
  startUrl = "about:blank",
  appWindow = false,
  headless = false,
  viewport = "1320,920",
} = {}) {
  const args = [
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-default-apps",
    "--disable-popup-blocking",
    `--window-size=${viewport}`,
  ];

  if (headless) args.push("--headless=new");
  if (startUrl) args.push(appWindow ? `--app=${startUrl}` : startUrl);
  return args;
}

export async function launchChrome({
  port = DEFAULT_CDP_PORT,
  userDataDir = profilePath("chatgpt-pro"),
  startUrl = "about:blank",
  appWindow = false,
  headless = false,
  viewport,
  detached = false,
  statePath = resolve(stateRoot, "chrome-session.json"),
  timeoutMs = 10_000,
} = {}) {
  mkdirSync(userDataDir, { recursive: true, mode: 0o700 });
  mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
  if (!process.env.CHROME_ALLOW_EXISTING_CDP && await cdpReachable(port)) {
    const error = new Error([
      `Chrome CDP is already reachable at http://127.0.0.1:${port}.`,
      "Refusing to launch against a pre-existing endpoint; stop the old browser, use another CHROME_REMOTE_DEBUGGING_PORT, or set CHROME_ALLOW_EXISTING_CDP=1.",
    ].join(" "));
    error.errorCode = "chrome.preexisting_cdp";
    throw error;
  }

  const executable = findChromeExecutable();
  const args = buildChromeArgs({
    port,
    userDataDir,
    startUrl,
    appWindow,
    headless,
    viewport,
  });

  const child = spawn(executable, args, {
    detached,
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (detached) child.unref();

  const version = await waitForCdp(port, timeoutMs);
  const state = {
    cdpUrl: `http://127.0.0.1:${port}`,
    executable,
    pid: child.pid,
    startUrl,
    userDataDir,
    webSocketDebuggerUrl: version.webSocketDebuggerUrl,
    launchedAt: new Date().toISOString(),
  };

  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  return { child, state, version };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name, fallback) => {
    const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };
  const posture = arg("posture", process.env.BROWSER_POSTURE || "headed");
  const profileName = arg("profile", process.env.BROWSER_PROFILE_NAME || "chatgpt-pro");
  const port = Number(
    arg("port", process.env.CHROME_REMOTE_DEBUGGING_PORT || String(DEFAULT_CDP_PORT)),
  );
  const userDataDir = resolve(process.env.CHROME_USER_DATA_DIR || profilePath(profileName));
  const startUrl = arg("target", process.env.BROWSER_TARGET_URL || DEFAULT_TARGET_URL);
  const headless = posture === "headless" || boolEnv("CHROME_HEADLESS");
  const appWindow = !headless && boolEnv("CHROME_APP_WINDOW");

  const { state } = await launchChrome({
    port,
    userDataDir,
    startUrl,
    appWindow,
    headless,
    detached: process.env.CHROME_DETACHED !== "0",
  });

  const output = {
    ...state,
    profileName,
    posture: headless ? "headless" : "headed",
    observerRequested: boolEnv("BROWSER_OBSERVER"),
  };
  console.log(JSON.stringify(output, null, 2));
  if (boolEnv("BROWSER_DEBUG")) {
    console.error(
      [
        "",
        "Chrome runtime",
        `- target: ${startUrl}`,
        `- profile: ${userDataDir}`,
        `- cdp: http://127.0.0.1:${port}`,
        `- posture: ${headless ? "headless" : "headed"}`,
      ].join("\n"),
    );
  }
}
