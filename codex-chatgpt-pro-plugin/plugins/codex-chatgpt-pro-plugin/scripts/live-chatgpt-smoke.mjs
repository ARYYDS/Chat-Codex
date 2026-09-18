import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  connectToPage,
  now,
  sleep,
} from "../src/cdp-client.mjs";
import {
  AUTH_LOGIN_REQUIRED,
  exitCodeForReceipt,
  loginRequiredMessage,
  pageProbe,
  redactedProbe,
} from "../src/chatgpt-page.mjs";
import { readChatGptChoices, setChatGptChoices } from "../src/chatgpt-choices.mjs";
import { acquireChatGptOperation } from "../src/chatgpt-operation.mjs";
import {
  inputPrompt,
  submitPrompt,
  waitForReadyProbe,
  waitForTokenOutput,
} from "../src/chatgpt-composer.mjs";
import { connectToChatGptSession } from "../src/chatgpt-sessions.mjs";
import {
  createRecorder,
  createRunState,
  startRunObserver,
  writeJson,
} from "../src/observe.mjs";
import {
  boolEnv,
  DEFAULT_CDP_PORT,
  DEFAULT_TARGET_URL,
  runDir as makeRunDir,
  runId as makeRunId,
} from "../src/runtime-config.mjs";
import { ensureProjectState } from "../src/project-state.mjs";

const TARGET_URL = process.env.BROWSER_TARGET_URL || DEFAULT_TARGET_URL;
const REQUESTED_LEVEL = process.env.CHATGPT_LEVEL || process.env.CHATGPT_INTELLIGENCE || "";
const REQUESTED_MODEL = process.env.CHATGPT_MODEL || "";
const RESPONSE_TIMEOUT_MS = Number(process.env.CHATGPT_RESPONSE_TIMEOUT_MS || 240_000);
const NEW_CHAT_SETTLE_MS = Number(process.env.CHATGPT_NEW_CHAT_SETTLE_MS || 20_000);
const SESSION = process.env.CHATGPT_SESSION || "";
const NEW_CHAT = boolEnv("CHATGPT_NEW_CHAT", !SESSION && TARGET_URL === DEFAULT_TARGET_URL);
const LOCK_TIMEOUT_MS = Number(process.env.CHATGPT_LOCK_TIMEOUT_MS || 600_000);
const STALE_LOCK_TTL_MS = Number(process.env.CHATGPT_STALE_LOCK_TTL_MS || 900_000);
const NO_WAIT = process.argv.includes("--no-wait");

async function step(receipt, name, fn) {
  const startedAt = now();
  try {
    const value = await fn();
    receipt.steps.push({ step: name, ok: true, ms: Math.round(now() - startedAt) });
    return value;
  } catch (error) {
    receipt.steps.push({
      step: name,
      ok: false,
      ms: Math.round(now() - startedAt),
      error: String(error?.message || error),
      ...(error?.errorCode ? { errorCode: error.errorCode } : {}),
      ...(error?.details ? { details: error.details } : {}),
    });
    throw error;
  }
}

async function main() {
  const port = Number(process.env.CHROME_REMOTE_DEBUGGING_PORT || DEFAULT_CDP_PORT);
  const runId = `${makeRunId()}-live-chatgpt`;
  const runDir = makeRunDir(runId);
  mkdirSync(runDir, { recursive: true });

  const runState = createRunState({
    runDir,
    runId,
    target: TARGET_URL,
    profileDir: ".devspace/chrome-profiles/chatgpt-pro",
    posture: "headed",
    cdpUrls: [`http://127.0.0.1:${port}`],
  });

  let observer = null;
  if (boolEnv("BROWSER_OBSERVER")) {
    observer = await startRunObserver({ runDir, runId });
    console.log(`Run Inspector: ${observer.url}`);
  }

  let cdp = null;
  let recorder = null;
  let operationHandle = null;
  const project = ensureProjectState();
  const receipt = {
    loop: "live-chatgpt-smoke",
    target: TARGET_URL,
    posture: "headed",
    newChat: NEW_CHAT,
    responseToken: `LIVE_SMOKE_OK_${Date.now()}`,
    runDir,
    startedAt: new Date().toISOString(),
    steps: [],
  };
  const prompt = `Reply with exactly ${receipt.responseToken} and no other text.`;
  const started = now();
  try {
    runState.update("waiting-for-lock");
    operationHandle = await step(receipt, "acquire-operation", () =>
      acquireChatGptOperation({
        name: "live.chatgpt",
        kind: "live-browser",
        runId,
        alias: SESSION,
        project,
        requiresBrowser: true,
        lockTimeoutMs: LOCK_TIMEOUT_MS,
        staleLockTtlMs: STALE_LOCK_TTL_MS,
        noWait: NO_WAIT,
      }),
    );
    Object.assign(receipt, operationHandle.receipt());
    runState.update("attaching");
    if (SESSION) {
      const connected = await connectToChatGptSession(port, SESSION);
      cdp = connected.cdp;
      receipt.session = {
        selector: SESSION,
        targetId: connected.target.id,
        title: connected.target.title,
        url: connected.target.url,
      };
    } else {
      cdp = await connectToPage(port, { matchUrl: TARGET_URL });
    }
    await cdp.send("Page.enable");
    await cdp.send("DOM.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    recorder = await createRecorder(cdp, {
      runDir,
      observerUrl: observer?.url || "",
      chromeDebugUrl: `http://127.0.0.1:${port}`,
    });

    let preselectedChoices = null;
    if (NEW_CHAT && (REQUESTED_LEVEL || REQUESTED_MODEL)) {
      runState.update("preselecting-choices");
      preselectedChoices = await step(receipt, "preselect-choices", () =>
        setChatGptChoices(cdp, {
          level: REQUESTED_LEVEL,
          model: REQUESTED_MODEL,
        }),
      );
    }

    if (NEW_CHAT) {
      runState.update("new-chat");
      await cdp.send("Page.navigate", { url: TARGET_URL });
      await sleep(NEW_CHAT_SETTLE_MS);
    }

    runState.update("probing");
    const initial = NEW_CHAT ? await waitForReadyProbe(cdp) : await pageProbe(cdp);
    writeJson(resolve(runDir, "initial-probe.json"), redactedProbe(initial));

    if (initial.isLoggedOut) {
      receipt.ok = false;
      receipt.errorCode = AUTH_LOGIN_REQUIRED;
      receipt.error = "not_logged_in";
      receipt.nextAction = "manual_login";
      receipt.message = loginRequiredMessage();
      runState.update("login-required", {
        ok: false,
        errorCode: receipt.errorCode,
        error: receipt.error,
      });
      throw new Error(receipt.error);
    }
    if (!initial.composer) {
      receipt.ok = false;
      receipt.error = "composer_not_found";
      receipt.message = "ChatGPT appears loaded, but no composer was discoverable.";
      runState.update("failed", { ok: false, error: receipt.error });
      throw new Error(receipt.error);
    }

    runState.update("reading-choices");
    receipt.chatgpt = preselectedChoices
      ? {
          preselected: preselectedChoices,
          afterNavigation: await step(receipt, "read-choices", () => readChatGptChoices(cdp)),
        }
      : REQUESTED_LEVEL || REQUESTED_MODEL
      ? await step(receipt, "set-choices", () =>
          setChatGptChoices(cdp, {
            level: REQUESTED_LEVEL,
            model: REQUESTED_MODEL,
          }),
        )
      : await step(receipt, "read-choices", () => readChatGptChoices(cdp));

    runState.update("typing");
    await step(receipt, "typed-prompt", () => inputPrompt(cdp, initial.composer, prompt));

    runState.update("sending");
    const beforeSend = await pageProbe(cdp);
    const sent = await step(receipt, "sent-prompt", () => {
      return submitPrompt(cdp, {
        composer: beforeSend.composer || initial.composer,
        initialUserCount: beforeSend.userTurns.length,
        responseToken: receipt.responseToken,
      });
    });
    receipt.steps.at(-1).method = sent.method;

    runState.update("waiting");
    const finalOutput = await step(
      receipt,
      "read-output",
      () => waitForTokenOutput(cdp, receipt.responseToken, initial.assistantTurns.length, RESPONSE_TIMEOUT_MS),
    );
    receipt.ok = true;
    receipt.outputFound = receipt.responseToken;
    receipt.finalAssistantText = finalOutput.exactAssistantText.slice(-1000);
    runState.update("finished", { ok: true });
  } catch (error) {
    receipt.ok = false;
    receipt.errorCode = receipt.errorCode || error?.errorCode;
    if (error?.details) receipt.failure = error.details;
    receipt.error = receipt.error || String(error?.message || error);
    runState.update("failed", { ok: false, error: receipt.error });
  } finally {
    receipt.totalMs = Math.round(now() - started);
    if (recorder) {
      await recorder.screenshot("final");
      await recorder.snapshot("snapshot");
      if (operationHandle) {
        try {
          Object.assign(receipt, await operationHandle.release());
        } catch (error) {
          const fallback = operationHandle.receipt();
          Object.assign(receipt, fallback);
          receipt.lockReleaseFailure = {
            errorCode: error?.errorCode || "lock.release_failed",
            error: String(error?.message || error),
            ...(error?.details ? { details: error.details } : {}),
          };
        } finally {
          operationHandle = null;
        }
      }
      const bundle = await recorder.finalize(receipt);
      runState.update(receipt.ok ? "finished" : runState.state.phase, {
        ok: receipt.ok,
        receipt: resolve(runDir, "receipt.json"),
        artifacts: bundle.artifacts,
      });
      console.log("\n" + bundle.summary);
    } else {
      if (operationHandle) {
        try {
          Object.assign(receipt, await operationHandle.release());
        } catch (error) {
          const fallback = operationHandle.receipt();
          Object.assign(receipt, fallback);
          receipt.lockReleaseFailure = {
            errorCode: error?.errorCode || "lock.release_failed",
            error: String(error?.message || error),
            ...(error?.details ? { details: error.details } : {}),
          };
        } finally {
          operationHandle = null;
        }
      }
      writeJson(resolve(runDir, "receipt.json"), receipt);
      writeFileSync(resolve(runDir, "receipt.md"), `# Live ChatGPT Smoke\\n\\n- verdict: ${receipt.ok ? "PASS" : "FAIL"}\\n- error: ${receipt.error || ""}\\n`);
    }
    if (cdp) await cdp.close().catch(() => {});
    if (observer && boolEnv("KEEP_OBSERVER")) {
      console.log(`Keeping Run Inspector alive: ${observer.url}`);
      await new Promise(() => {});
    }
    if (observer) await observer.close();
    console.log(`Live ChatGPT smoke receipt: ${resolve(runDir, "receipt.json")}`);
  }

  process.exit(exitCodeForReceipt(receipt));
}

main();
