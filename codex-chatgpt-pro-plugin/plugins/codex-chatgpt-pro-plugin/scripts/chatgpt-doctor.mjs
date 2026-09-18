import { doctorLive, doctorWarm } from "../src/chatgpt-doctor.mjs";
import { withChatGptOperation } from "../src/chatgpt-operation.mjs";
import { AUTH_LOGIN_REQUIRED, LOGIN_REQUIRED_EXIT_CODE } from "../src/chatgpt-page.mjs";
import { ensureProjectState } from "../src/project-state.mjs";
import { DEFAULT_CDP_PORT, DEFAULT_TARGET_URL } from "../src/runtime-config.mjs";

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

const mode = flag("warm") ? "warm" : "live";
const port = Number(arg("port") || process.env.CHROME_REMOTE_DEBUGGING_PORT || DEFAULT_CDP_PORT);
const targetUrl = arg("target") || process.env.BROWSER_TARGET_URL || DEFAULT_TARGET_URL;
const project = ensureProjectState();
const lockTimeoutMs = Number(arg("lock-timeout-ms") || process.env.CHATGPT_LOCK_TIMEOUT_MS || 600_000);
const staleLockTtlMs = Number(arg("stale-lock-ttl-ms") || process.env.CHATGPT_STALE_LOCK_TTL_MS || 900_000);
const noWait = flag("no-wait");

try {
  const operationResult = await withChatGptOperation({
    name: `doctor.${mode}`,
    kind: "live-browser",
    project,
    requiresBrowser: true,
    lockTimeoutMs,
    staleLockTtlMs,
    noWait,
  }, async () => mode === "warm"
    ? await doctorWarm({ port, targetUrl })
    : await doctorLive({ port, targetUrl }));

  console.log(JSON.stringify({
    ...operationResult.value,
    operation: operationResult.operation,
    locks: operationResult.locks,
  }, null, 2));
} catch (error) {
  const errorCode = error?.errorCode || "doctor.failed";
  console.log(JSON.stringify({
    ok: false,
    command: "doctor",
    mode,
    errorCode,
    error: String(error?.message || error),
    ...(error?.details?.nextAction ? { nextAction: error.details.nextAction } : {}),
    ...(error?.details?.message ? { message: error.details.message } : {}),
    ...(error?.details?.probe ? { probe: error.details.probe } : {}),
    ...(error?.details?.operation ? { operation: error.details.operation } : {}),
    ...(error?.details?.locks ? { locks: error.details.locks } : {}),
  }, null, 2));
  process.exit(errorCode === AUTH_LOGIN_REQUIRED ? LOGIN_REQUIRED_EXIT_CODE : 1);
}
