import { connectToPage } from "../src/cdp-client.mjs";
import { readChatGptChoices, setChatGptChoices } from "../src/chatgpt-choices.mjs";
import { withChatGptOperation } from "../src/chatgpt-operation.mjs";
import {
  AUTH_LOGIN_REQUIRED,
  LOGIN_REQUIRED_EXIT_CODE,
  loginRequiredMessage,
  pageProbe,
} from "../src/chatgpt-page.mjs";
import { DEFAULT_CDP_PORT, DEFAULT_TARGET_URL } from "../src/runtime-config.mjs";
import { ensureProjectState } from "../src/project-state.mjs";

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const port = Number(process.env.CHROME_REMOTE_DEBUGGING_PORT || DEFAULT_CDP_PORT);
const target = process.env.BROWSER_TARGET_URL || DEFAULT_TARGET_URL;
const requestedLevel = arg("level") || arg("intelligence") || process.env.CHATGPT_LEVEL || null;
const requestedModel = arg("model") || process.env.CHATGPT_MODEL || null;
const lockTimeoutMs = Number(arg("lock-timeout-ms") || process.env.CHATGPT_LOCK_TIMEOUT_MS || 600_000);
const staleLockTtlMs = Number(arg("stale-lock-ttl-ms") || process.env.CHATGPT_STALE_LOCK_TTL_MS || 900_000);
const noWait = process.argv.includes("--no-wait");
const project = ensureProjectState();

try {
  const operationResult = await withChatGptOperation({
    name: requestedLevel || requestedModel ? "choices.set" : "choices.list",
    kind: "live-browser",
    project,
    requiresBrowser: true,
    lockTimeoutMs,
    staleLockTtlMs,
    noWait,
  }, async () => {
    const cdp = await connectToPage(port, { matchUrl: target });
    try {
      await cdp.send("Runtime.enable");
      const probe = await pageProbe(cdp);

      if (probe.isLoggedOut) {
        const error = new Error("not_logged_in");
        error.errorCode = AUTH_LOGIN_REQUIRED;
        error.details = {
          nextAction: "manual_login",
          message: loginRequiredMessage(),
          target,
        };
        throw error;
      }

      return requestedLevel || requestedModel
        ? await setChatGptChoices(cdp, { level: requestedLevel, model: requestedModel })
        : await readChatGptChoices(cdp);
    } finally {
      await cdp.close().catch(() => {});
    }
  });

  console.log(JSON.stringify({
    ok: true,
    target,
    ...operationResult.value,
    operation: operationResult.operation,
    locks: operationResult.locks,
  }, null, 2));
} catch (error) {
  const errorCode = error?.errorCode || "chatgpt.choice_control_failed";
  console.log(
    JSON.stringify(
      {
        ok: false,
        errorCode,
        error: String(error?.message || error),
        ...(error?.details?.nextAction ? { nextAction: error.details.nextAction } : {}),
        ...(error?.details?.message ? { message: error.details.message } : {}),
        ...(error?.details?.operation ? { operation: error.details.operation } : {}),
        ...(error?.details?.locks ? { locks: error.details.locks } : {}),
        target,
      },
      null,
      2,
    ),
  );
  process.exit(errorCode === AUTH_LOGIN_REQUIRED ? LOGIN_REQUIRED_EXIT_CODE : 1);
}
