import { connectToPage } from "../src/cdp-client.mjs";
import { withChatGptOperation } from "../src/chatgpt-operation.mjs";
import {
  AUTH_LOGIN_REQUIRED,
  LOGIN_REQUIRED_EXIT_CODE,
  loginRequiredMessage,
  pageProbe,
  redactedProbe,
} from "../src/chatgpt-page.mjs";
import { DEFAULT_CDP_PORT, DEFAULT_TARGET_URL } from "../src/runtime-config.mjs";
import { ensureProjectState } from "../src/project-state.mjs";

const port = Number(process.env.CHROME_REMOTE_DEBUGGING_PORT || DEFAULT_CDP_PORT);
const target = process.env.BROWSER_TARGET_URL || DEFAULT_TARGET_URL;
const lockTimeoutMs = Number(process.env.CHATGPT_LOCK_TIMEOUT_MS || 600_000);
const staleLockTtlMs = Number(process.env.CHATGPT_STALE_LOCK_TTL_MS || 900_000);
const noWait = process.argv.includes("--no-wait");
const project = ensureProjectState();

try {
  const operationResult = await withChatGptOperation({
    name: "login.check",
    kind: "live-browser",
    project,
    requiresBrowser: true,
    lockTimeoutMs,
    staleLockTtlMs,
    noWait,
  }, async () => {
    const cdp = await connectToPage(port, { matchUrl: target, retries: 5 });
    try {
      await cdp.send("Runtime.enable");
      return await pageProbe(cdp);
    } finally {
      await cdp.close().catch(() => {});
    }
  });
  const probe = operationResult.value;

  const result = {
    ok: !probe.isLoggedOut && !!probe.composer,
    errorCode: null,
    target,
    probe: redactedProbe(probe),
    operation: operationResult.operation,
    locks: operationResult.locks,
  };

  if (probe.isLoggedOut) {
    result.errorCode = AUTH_LOGIN_REQUIRED;
    result.error = "not_logged_in";
    result.nextAction = "manual_login";
    result.message = loginRequiredMessage();
    console.log(JSON.stringify(result, null, 2));
    process.exit(LOGIN_REQUIRED_EXIT_CODE);
  }

  if (!probe.composer) {
    result.errorCode = "chatgpt.composer_missing";
    result.error = "composer_not_found";
    result.message = "ChatGPT is reachable, but the composer is not visible. Inspect the visible browser window.";
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  result.message = "ChatGPT profile is logged in and ready.";
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        errorCode: "chrome.cdp_unavailable",
        error: String(error?.message || error),
        message: "Chrome CDP is not reachable. Run npm run setup:login first.",
        target,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
