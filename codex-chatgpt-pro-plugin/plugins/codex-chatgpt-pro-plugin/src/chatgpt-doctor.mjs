import { resolve } from "node:path";
import { chatGptProHome } from "./browser-lock.mjs";
import { connectToPage, listTargets } from "./cdp-client.mjs";
import { readChatGptChoices } from "./chatgpt-choices.mjs";
import { AUTH_LOGIN_REQUIRED, loginRequiredMessage, pageProbe, redactedProbe } from "./chatgpt-page.mjs";
import { launchChrome, waitForCdp } from "./chrome-session.mjs";
import { buildModelStateCache, writeModelStateCache } from "./model-state-cache.mjs";
import { DEFAULT_CDP_PORT, DEFAULT_TARGET_URL } from "./runtime-config.mjs";

export function packageProfilePath(root = chatGptProHome()) {
  return resolve(root, "chrome-profile");
}

async function cdpReachable(port, timeoutMs = 500) {
  try {
    const version = await waitForCdp(port, timeoutMs);
    return { ok: true, version };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  }
}

async function ensureChatGptTarget(port, targetUrl = DEFAULT_TARGET_URL) {
  const targets = await listTargets(port).catch(() => []);
  const pages = targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl);
  const existing = pages.find((target) => String(target.url || "").startsWith(targetUrl))
    || pages.find((target) => String(target.url || "").includes("chatgpt.com"));
  if (existing) return { target: existing, opened: false };

  let target;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(targetUrl)}`, { method: "PUT" });
    if (!response.ok) throw new Error(`CDP /json/new -> ${response.status}`);
    target = await response.json();
  } catch {
    const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(targetUrl)}`);
    if (!response.ok) throw new Error(`CDP /json/new -> ${response.status}`);
    target = await response.json();
  }
  return { target, opened: true };
}

export async function doctorWarm({
  port = DEFAULT_CDP_PORT,
  targetUrl = DEFAULT_TARGET_URL,
  root = chatGptProHome(),
} = {}) {
  const cdpBefore = await cdpReachable(port);
  const profilePath = packageProfilePath(root);
  let launched = false;
  let launchState = null;
  if (!cdpBefore.ok) {
    const launchedChrome = await launchChrome({
      port,
      userDataDir: profilePath,
      startUrl: targetUrl,
      appWindow: false,
      headless: false,
      detached: true,
      statePath: resolve(root, "state", "chrome-session.json"),
    });
    launched = true;
    launchState = launchedChrome.state;
  }
  const cdpAfter = await cdpReachable(port, 10_000);
  if (!cdpAfter.ok) {
    const error = new Error(`Chrome CDP is not reachable at http://127.0.0.1:${port}.`);
    error.errorCode = "browser.cdp_unreachable";
    error.details = { cdpBefore, cdpAfter };
    throw error;
  }

  const target = await ensureChatGptTarget(port, targetUrl).catch((error) => ({
    target: null,
    opened: false,
    error: String(error?.message || error),
  }));

  return {
    ok: true,
    command: "doctor",
    mode: "warm",
    browser: {
      cdpReachableBefore: cdpBefore.ok,
      cdpReachableAfter: cdpAfter.ok,
      launched,
      reused: !launched,
      cdpEndpoint: `http://127.0.0.1:${port}`,
      profilePath,
      targetUrl,
      targetFound: Boolean(target.target),
      targetOpened: Boolean(target.opened),
      launchState,
      error: target.error || null,
    },
    auth: {
      state: "unknown",
    },
    nextAction: "Complete visible login if prompted, then run chatgpt-pro doctor --live.",
  };
}

export async function doctorLive({
  port = DEFAULT_CDP_PORT,
  targetUrl = DEFAULT_TARGET_URL,
  root = chatGptProHome(),
} = {}) {
  const profilePath = packageProfilePath(root);
  const cdp = await connectToPage(port, { matchUrl: targetUrl, retries: 5 });
  try {
    await cdp.send("Runtime.enable");
    const probe = await pageProbe(cdp);
    if (probe.isLoggedOut) {
      const error = new Error("not_logged_in");
      error.errorCode = AUTH_LOGIN_REQUIRED;
      error.details = {
        nextAction: "manual_login",
        message: loginRequiredMessage(),
        probe: redactedProbe(probe),
      };
      throw error;
    }
    if (!probe.composer) {
      const error = new Error("composer_not_found");
      error.errorCode = "page.composer_not_found";
      error.details = { probe: redactedProbe(probe) };
      throw error;
    }

    const choices = await readChatGptChoices(cdp);
    const cache = buildModelStateCache({
      choices,
      source: "doctor.live",
      cdpEndpoint: `http://127.0.0.1:${port}`,
      profilePath,
      targetUrl,
    });
    const written = writeModelStateCache(cache, { root });
    return {
      ok: true,
      command: "doctor",
      mode: "live",
      browser: {
        cdpEndpoint: `http://127.0.0.1:${port}`,
        profilePath,
        targetUrl,
        targetFound: true,
      },
      page: {
        url: probe.url,
        title: probe.title,
        composerFound: Boolean(probe.composer),
        loggedOut: false,
        probe: redactedProbe(probe),
      },
      choices,
      modelState: {
        cacheWritten: true,
        cachePath: written.path,
        plan: choices.account?.planLabel || null,
        modelRoot: choices.model?.rootLabel || null,
        modelOption: choices.model?.current || null,
        intelligenceSelected: choices.intelligence?.current || null,
        source: "doctor.live",
      },
      nextAction: "ready_to_call",
    };
  } finally {
    await cdp.close().catch(() => {});
  }
}
