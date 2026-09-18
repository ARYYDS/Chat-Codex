import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CdpSession, connectToPage, now, sleep } from "../src/cdp-client.mjs";
import {
  AUTH_LOGIN_REQUIRED,
  exitCodeForReceipt,
  loginRequiredMessage,
  pageProbe,
  redactedProbe,
} from "../src/chatgpt-page.mjs";
import { readChatGptChoices, setChatGptChoices } from "../src/chatgpt-choices.mjs";
import {
  inputPrompt,
  submitPrompt,
  waitForAssistantResponseAfterUser,
  waitForReadyProbe,
} from "../src/chatgpt-composer.mjs";
import { composeContextEnvelope } from "../src/context-envelope.mjs";
import { buildRepoContextBundle } from "../src/repo-context-bundle.mjs";
import { decideRepoContextMode } from "../src/repo-context-policy.mjs";
import { uploadFiles as uploadChatGptFiles } from "../src/chatgpt-upload.mjs";
import {
  countMessagesByRole,
  findAssistantAfterUser,
  sha256,
  snapshotConversationMessages,
  waitForAssistantAfterUserMessage,
  waitForNewUserMessage,
} from "../src/chatgpt-messages.mjs";
import {
  connectToChatGptSession,
  newChatGptSession,
  recordChatGptAliasUse,
  recordFreshThread,
} from "../src/chatgpt-sessions.mjs";
import { sealRunEnvelope, threadEchoMode } from "../src/chatgpt/run-envelope.mjs";
import { acquireChatGptOperation } from "../src/chatgpt-operation.mjs";
import {
  createRecorder,
  createRunState,
  startRunObserver,
  writeJson,
} from "../src/observe.mjs";
import { ensureProjectState } from "../src/project-state.mjs";
import {
  boolEnv,
  DEFAULT_CDP_PORT,
  DEFAULT_TARGET_URL,
  runDir as makeRunDir,
  runId as makeRunId,
} from "../src/runtime-config.mjs";

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((value) => value.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function args(name) {
  const prefix = `--${name}=`;
  return process.argv
    .filter((value) => value.startsWith(prefix))
    .map((value) => value.slice(prefix.length));
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function readTextFile(path) {
  return readFileSync(resolve(path), "utf8");
}

function buildPrompt() {
  const promptFile = arg("prompt-file") || arg("message-file") || process.env.CHATGPT_PROMPT_FILE || "";
  const prompt = arg("prompt") || process.env.CHATGPT_PROMPT || "";
  const contextFile = arg("context-file") || process.env.CHATGPT_CONTEXT_FILE || "";
  let contextDir = arg("context-dir") || process.env.CHATGPT_CONTEXT_DIR || "";
  const contextLabel = arg("context-label") || process.env.CHATGPT_CONTEXT_LABEL || contextFile;
  const uploadFiles = [
    ...args("upload-file"),
    ...String(process.env.CHATGPT_UPLOAD_FILES || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ];
  const requestedRepoContextMode = flag("no-repo-context")
    ? "off"
    : (arg("repo-context") || process.env.CHATGPT_REPO_CONTEXT_MODE || (boolEnv("CHATGPT_ATTACH_REPO_CONTEXT", true) ? "auto" : "off"));
  const repoContextConfirmed = flag("confirm-repo-context-upload")
    || boolEnv("CHATGPT_CONFIRM_REPO_CONTEXT_UPLOAD");

  const base = promptFile ? readTextFile(promptFile) : prompt;
  if (!base.trim()) {
    throw new Error("Provide --prompt, --prompt-file, CHATGPT_PROMPT, or CHATGPT_PROMPT_FILE.");
  }

  let composed = base;
  if (contextFile) {
    const context = readTextFile(contextFile);
    composed = [
      base.trim(),
      "",
      "---",
      "",
      `Attached context: ${contextLabel}`,
      "",
      "```text",
      context.replaceAll("```", "``\\`"),
      "```",
      "",
    ].join("\n");
  }

  let autoContextBundle = null;
  const repoContextDecision = decideRepoContextMode({
    requestedMode: requestedRepoContextMode,
    prompt: base,
    contextDir,
    contextFile,
    uploadFileCount: uploadFiles.length,
  });
  const repoContextMode = repoContextDecision.effectiveMode;
  if (!contextDir && repoContextMode !== "off") {
    if (!repoContextConfirmed) {
      const error = new Error([
        "Generated repo context upload requires explicit confirmation.",
        "Re-run with --confirm-repo-context-upload, set CHATGPT_CONFIRM_REPO_CONTEXT_UPLOAD=1,",
        "or use --no-repo-context / explicit scrubbed --upload-file artifacts.",
      ].join(" "));
      error.errorCode = "repo_context.upload_confirmation_required";
      error.details = {
        requestedRepoContextMode,
        repoContextMode,
        repoContextDecision,
      };
      throw error;
    }
    autoContextBundle = buildRepoContextBundle({ name: "auto-call" });
    if (repoContextMode === "inline") contextDir = autoContextBundle.dir;
    else uploadFiles.push(autoContextBundle.context);
  }

  const envelope = composeContextEnvelope({ prompt: composed, contextDir });
  return {
    prompt: envelope.prompt,
    promptFile,
    contextFile,
    contextDir,
    uploadFiles,
    repoContextMode,
    requestedRepoContextMode,
    repoContextConfirmed,
    repoContextDecision,
    autoContextBundle,
    contextEnvelope: envelope.context,
  };
}

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
  const targetUrl = process.env.BROWSER_TARGET_URL || DEFAULT_TARGET_URL;
  const session = arg("session") || arg("alias") || process.env.CHATGPT_SESSION || "";
  const freshThread = flag("fresh");
  const newBoundThread = flag("new") || flag("new-thread");
  const conversationUrl = arg("conversation-url") || "";
  const threadMode = freshThread
    ? "fresh"
    : newBoundThread
      ? "new_bound"
      : flag("rebind-alias")
        ? "rebind"
        : "continue";
  const newChat = freshThread
    || newBoundThread
    || boolEnv("CHATGPT_NEW_CHAT", !session && targetUrl === DEFAULT_TARGET_URL);
  const responseTimeoutMs = Number(process.env.CHATGPT_RESPONSE_TIMEOUT_MS || 300_000);
  const stableMs = Number(process.env.CHATGPT_RESPONSE_STABLE_MS || 4_000);
  const explicitLevel = arg("level") || arg("intelligence") || process.env.CHATGPT_LEVEL || process.env.CHATGPT_INTELLIGENCE || "";
  const requestedLevel = explicitLevel || (flag("no-default-pro") ? "" : (process.env.CHATGPT_DEFAULT_LEVEL || "Pro"));
  const requestedModel = process.env.CHATGPT_MODEL || "";
  const responseMode = arg("response-mode") || process.env.CHATGPT_RESPONSE_MODE || "blocking";
  const rebindAlias = flag("rebind-alias");
  const lockTimeoutMs = Number(arg("lock-timeout-ms") || process.env.CHATGPT_LOCK_TIMEOUT_MS || 600_000);
  const noWaitForLock = flag("no-wait");
  const staleLockTtlMs = Number(arg("stale-lock-ttl-ms") || process.env.CHATGPT_STALE_LOCK_TTL_MS || 900_000);
  const port = Number(process.env.CHROME_REMOTE_DEBUGGING_PORT || DEFAULT_CDP_PORT);
  const promptInput = buildPrompt();
  const project = ensureProjectState();

  const runId = `${makeRunId()}-chatgpt-call`;
  const runDir = makeRunDir(runId);
  mkdirSync(runDir, { recursive: true, mode: 0o700 });

  const runState = createRunState({
    runDir,
    runId,
    target: targetUrl,
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
  let assistantText = "";
  let connectedTarget = null;
  let finalConversationUrl = null;
  let envelope = null;
  const stdoutThreadEcho = threadEchoMode() === "enabled";
  const started = now();
  const receipt = {
    loop: "chatgpt-call",
    target: targetUrl,
    posture: "headed",
    newChat,
    session: session || null,
    room: {
      alias: session || null,
      threadMode,
      aliasBound: Boolean(session && !freshThread),
      conversationUrl: conversationUrl || null,
    },
    automation: {
      inputMode: "text",
      voiceControlsAllowed: false,
    },
    project,
    rebindAlias,
    promptFile: promptInput.promptFile || null,
    contextFile: promptInput.contextFile || null,
    contextDir: promptInput.contextDir || null,
    uploadFiles: promptInput.uploadFiles,
    requestedRepoContextMode: promptInput.requestedRepoContextMode,
    repoContextMode: promptInput.repoContextMode,
    repoContextDecision: promptInput.repoContextDecision,
    autoContextBundle: promptInput.autoContextBundle,
    responseMode,
    desiredChatGpt: {
      intelligence: requestedLevel || null,
      model: requestedModel || null,
      defaultedToPro: !explicitLevel && requestedLevel === "Pro",
    },
    promptLength: promptInput.prompt.length,
    input: {
      promptSha256: sha256(promptInput.prompt),
      promptCharCount: promptInput.prompt.length,
      contextFile: promptInput.contextFile || null,
      contextDir: promptInput.contextDir || null,
      contextEnvelope: promptInput.contextEnvelope,
    },
    responseTimeoutMs,
    startedAt: new Date().toISOString(),
    runDir,
    steps: [],
  };

  try {
    if (responseMode !== "blocking") {
      const error = new Error(`Unsupported ChatGPT response mode: ${responseMode}. Only blocking is implemented.`);
      error.errorCode = "mode.unsupported";
      throw error;
    }
    if (freshThread && newBoundThread) {
      const error = new Error("Use only one of --fresh or --new.");
      error.errorCode = "session.thread_mode_conflict";
      throw error;
    }
    if (newBoundThread && !session) {
      const error = new Error("--new requires --alias=<name> so the new thread can be bound deliberately.");
      error.errorCode = "session.alias_required";
      throw error;
    }
    if (rebindAlias && !session) {
      const error = new Error("--rebind-alias requires --alias=<name>.");
      error.errorCode = "session.alias_required";
      throw error;
    }
    writeFileSync(resolve(runDir, "prompt.md"), promptInput.prompt, { mode: 0o600 });
    writeFileSync(resolve(runDir, "input.md"), promptInput.prompt, { mode: 0o600 });

    runState.update("waiting-for-lock");
    operationHandle = await step(receipt, "acquire-operation", () =>
      acquireChatGptOperation({
        name: "call",
        kind: "live-browser",
        runId,
        alias: session,
        project,
        requiresBrowser: true,
        lockTimeoutMs,
        noWait: noWaitForLock,
        staleLockTtlMs,
      }),
    );
    Object.assign(receipt, operationHandle.receipt());
    receipt.owner = receipt.locks.browser.owner;
    receipt.lock = receipt.locks.browser.receipt;

    runState.update("attaching");
    if (freshThread) {
      const target = await step(receipt, "open-fresh-thread", () =>
        newChatGptSession(port, { name: session || null, url: targetUrl, bind: false }),
      );
      cdp = await CdpSession.open(target.webSocketDebuggerUrl);
      connectedTarget = target;
      receipt.sessionTarget = {
        targetId: target.id,
        title: target.title,
        url: target.url,
      };
      receipt.room.conversationUrl = target.url;
    } else if (newBoundThread) {
      const target = await step(receipt, "open-bound-thread", () =>
        newChatGptSession(port, { name: session, url: targetUrl, bind: true }),
      );
      const connected = await connectToChatGptSession(port, session);
      cdp = connected.cdp;
      connectedTarget = connected.target || target;
      receipt.sessionTarget = {
        targetId: connectedTarget.id,
        title: connectedTarget.title,
        url: connectedTarget.url,
      };
      receipt.room.conversationUrl = connectedTarget.url;
    } else if (session) {
      const connected = await connectToChatGptSession(port, session, { allowRebind: rebindAlias, conversationUrl });
      cdp = connected.cdp;
      connectedTarget = connected.target;
      receipt.sessionTarget = {
        targetId: connected.target.id,
        title: connected.target.title,
        url: connected.target.url,
      };
      receipt.roomTarget = connected.roomTarget || null;
      receipt.room.conversationUrl = connected.target.url;
    } else {
      cdp = await connectToPage(port, { matchUrl: targetUrl });
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

    if (newChat) {
      runState.update("new-chat");
      await cdp.send("Page.navigate", { url: targetUrl });
      await sleep(Number(process.env.CHATGPT_NEW_CHAT_SETTLE_MS || 20_000));
    }

    runState.update("probing");
    const initial = newChat ? await waitForReadyProbe(cdp) : await pageProbe(cdp);
    writeJson(resolve(runDir, "initial-probe.json"), redactedProbe(initial));

    if (initial.isLoggedOut) {
      receipt.ok = false;
      receipt.errorCode = AUTH_LOGIN_REQUIRED;
      receipt.error = "not_logged_in";
      receipt.nextAction = "manual_login";
      receipt.message = loginRequiredMessage();
      runState.update("login-required", { ok: false, errorCode: receipt.errorCode });
      throw new Error(receipt.error);
    }
    if (!initial.composer) {
      receipt.ok = false;
      receipt.errorCode = "chatgpt.composer_missing";
      receipt.error = "composer_not_found";
      receipt.message = "ChatGPT appears loaded, but no composer was discoverable.";
      runState.update("failed", { ok: false, errorCode: receipt.errorCode });
      throw new Error(receipt.error);
    }

    runState.update("reading-choices");
    receipt.chatgpt = requestedLevel || requestedModel
      ? await step(receipt, "set-choices", () =>
          setChatGptChoices(cdp, { level: requestedLevel, model: requestedModel }),
        )
      : await step(receipt, "read-choices", () => readChatGptChoices(cdp));

    if (promptInput.uploadFiles.length) {
      runState.update("uploading");
      receipt.upload = await step(receipt, "uploaded-files", () =>
        uploadChatGptFiles(cdp, promptInput.uploadFiles, { stageDir: resolve(runDir, "uploads") }),
      );
    }

    const beforeMessages = await step(receipt, "snapshot-before-send", () =>
      snapshotConversationMessages(cdp),
    );
    receipt.messageAnchor = {
      beforeUserMessageCount: countMessagesByRole(beforeMessages, "user"),
      beforeAssistantMessageCount: countMessagesByRole(beforeMessages, "assistant"),
      responseBoundToSentPrompt: false,
    };

    runState.update("typing");
    await step(receipt, "typed-prompt", () => inputPrompt(cdp, initial.composer, promptInput.prompt));

    runState.update("sending");
    const beforeSend = await pageProbe(cdp);
    const sent = await step(receipt, "sent-prompt", () =>
      submitPrompt(cdp, {
        composer: beforeSend.composer || initial.composer,
        initialUserCount: beforeSend.userTurns.length,
      }),
    );
    receipt.steps.at(-1).method = sent.method;

    runState.update("verifying-user-message");
    const sentUser = await step(receipt, "verified-user-message", () =>
      waitForNewUserMessage(cdp, beforeMessages, promptInput.prompt),
    );
    receipt.messageAnchor.sentUserMessage = {
      ordinal: sentUser.message.ordinal,
      textSha256: sentUser.message.textSha256,
      normalizedTextSha256: sentUser.message.normalizedTextSha256,
      charCount: sentUser.message.charCount,
      promptEchoVerification: sentUser.promptEchoVerification,
    };

    runState.update("waiting-for-assistant-start");
    const startedAssistant = await step(receipt, "assistant-started", () =>
      waitForAssistantAfterUserMessage(cdp, sentUser.message, { timeoutMs: responseTimeoutMs }),
    );
    receipt.messageAnchor.assistantStarted = {
      ordinal: startedAssistant.assistant.ordinal,
      afterUserOrdinal: sentUser.message.ordinal,
    };

    runState.update("waiting");
    const response = await step(receipt, "read-output", () =>
      waitForAssistantResponseAfterUser(cdp, sentUser.message, {
        timeoutMs: responseTimeoutMs,
        stableMs,
      }),
    );
    const finalMessages = response.snapshot || await snapshotConversationMessages(cdp);
    const assistantMessage = response.assistantMessage || findAssistantAfterUser(finalMessages, sentUser.message);
    if (!assistantMessage) {
      const error = new Error("The extracted assistant response could not be bound to the sent prompt.");
      error.errorCode = "response.possibly_stale";
      throw error;
    }
    assistantText = response.assistantText;
    writeFileSync(resolve(runDir, "assistant.md"), assistantText, { mode: 0o600 });
    receipt.ok = true;
    receipt.assistantTextLength = assistantText.length;
    receipt.assistantTextPreview = assistantText.slice(0, 1200);
    receipt.response = {
      textSha256: sha256(assistantText),
      charCount: assistantText.length,
      finishDetectedBy: response.finishDetectedBy,
      conversationUrl: response.probe?.url || null,
    };
    finalConversationUrl = response.probe?.url || null;
    if (connectedTarget && finalConversationUrl) {
      connectedTarget = { ...connectedTarget, url: finalConversationUrl };
      receipt.room.conversationUrl = finalConversationUrl;
      if (receipt.sessionTarget) receipt.sessionTarget.url = finalConversationUrl;
    }
    receipt.messageAnchor.assistantMessage = {
      ordinal: assistantMessage.ordinal,
      textSha256: assistantMessage.textSha256,
      normalizedTextSha256: assistantMessage.normalizedTextSha256,
      charCount: assistantMessage.charCount,
      afterUserOrdinal: sentUser.message.ordinal,
    };
    if (response.assistantRun) {
      receipt.messageAnchor.assistantRun = {
        ordinals: response.assistantRun.assistantMessages.map((message) => message.ordinal),
        textSha256: response.assistantRun.textSha256,
        charCount: response.assistantRun.charCount,
        afterUserOrdinal: response.assistantRun.afterUserOrdinal,
        nextUserOrdinal: response.assistantRun.nextUserOrdinal,
      };
    }
    receipt.messageAnchor.responseBoundToSentPrompt = true;
    receipt.stableMs = response.stableMs;
    runState.update("finished", { ok: true });
  } catch (error) {
    receipt.ok = false;
    receipt.errorCode = receipt.errorCode || error?.errorCode;
    if (error?.details) receipt.failure = error.details;
    if (error?.details?.owner && !receipt.owner) receipt.owner = error.details.owner;
    if (error?.details?.lock && !receipt.lock) receipt.lock = error.details.lock;
    if (error?.details?.operation && !receipt.operation) receipt.operation = error.details.operation;
    if (error?.details?.locks && !receipt.locks) receipt.locks = error.details.locks;
    receipt.error = receipt.error || String(error?.message || error);
    runState.update("failed", { ok: false, error: receipt.error, errorCode: receipt.errorCode });
  } finally {
    receipt.totalMs = Math.round(now() - started);
    envelope = sealRunEnvelope({
      kind: "call",
      runDir,
      receipt,
      sentMarkdown: promptInput.prompt,
      receivedMarkdown: assistantText,
      stdoutRendered: stdoutThreadEcho,
    });
    let aliasRecord = null;
    if (receipt.ok && freshThread) {
      try {
        const freshRecord = recordFreshThread({
          aliasHint: session || null,
          target: connectedTarget,
          runId,
          receiptPath: resolve(runDir, "receipt.json"),
          transcriptPath: resolve(runDir, "transcript.md"),
        });
        receipt.freshThreadRecord = freshRecord;
      } catch (error) {
        receipt.freshThreadRecordError = {
          errorCode: error?.errorCode || "session.fresh_thread_record_failed",
          error: String(error?.message || error),
          ...(error?.details ? { details: error.details } : {}),
        };
      }
    } else if (receipt.ok && session) {
      try {
        aliasRecord = recordChatGptAliasUse({
          name: session,
          target: connectedTarget,
          runId,
          receiptPath: resolve(runDir, "receipt.json"),
          transcriptPath: resolve(runDir, "transcript.md"),
        });
        receipt.aliasRecord = aliasRecord;
      } catch (error) {
        receipt.aliasRecordError = {
          errorCode: error?.errorCode || "session.alias_update_failed",
          error: String(error?.message || error),
          ...(error?.details ? { details: error.details } : {}),
        };
      }
    }
    if (recorder) {
      await recorder.screenshot("final");
      await recorder.snapshot("snapshot");
      if (operationHandle) {
        try {
          Object.assign(receipt, await operationHandle.release());
          receipt.lock = receipt.locks.browser.receipt;
        } catch (error) {
          const fallback = operationHandle.receipt();
          Object.assign(receipt, fallback);
          receipt.lock = {
            ...(fallback.locks.browser.receipt || receipt.lock || {}),
            releaseErrorCode: error?.errorCode || "lock.release_failed",
            releaseError: String(error?.message || error),
          };
          receipt.lockReleaseFailure = error?.details || null;
        } finally {
          operationHandle = null;
        }
      }
      const bundle = await recorder.finalize(receipt);
      runState.update(receipt.ok ? "finished" : runState.state.phase, {
        ok: receipt.ok,
        receipt: resolve(runDir, "receipt.json"),
        ...(aliasRecord ? { aliasRecord } : {}),
        artifacts: {
          ...bundle.artifacts,
          input: resolve(runDir, "input.md"),
          prompt: resolve(runDir, "prompt.md"),
          assistant: resolve(runDir, "assistant.md"),
          transcript: resolve(runDir, "transcript.md"),
        },
      });
      console.log("\n" + bundle.summary);
    } else {
      if (operationHandle) {
        try {
          Object.assign(receipt, await operationHandle.release());
          receipt.lock = receipt.locks.browser.receipt;
        } catch (error) {
          const fallback = operationHandle.receipt();
          Object.assign(receipt, fallback);
          receipt.lock = {
            ...(fallback.locks.browser.receipt || receipt.lock || {}),
            releaseErrorCode: error?.errorCode || "lock.release_failed",
            releaseError: String(error?.message || error),
          };
          receipt.lockReleaseFailure = error?.details || null;
        } finally {
          operationHandle = null;
        }
      }
      writeJson(resolve(runDir, "receipt.json"), receipt);
      writeFileSync(resolve(runDir, "receipt.md"), `# ChatGPT Call\n\n- verdict: ${receipt.ok ? "PASS" : "FAIL"}\n- error: ${receipt.error || ""}\n`, { mode: 0o600 });
    }
    if (cdp) await cdp.close().catch(() => {});
    if (observer && boolEnv("KEEP_OBSERVER")) {
      console.log(`Keeping Run Inspector alive: ${observer.url}`);
      await new Promise(() => {});
    }
    if (observer) await observer.close();
    console.log(`ChatGPT call receipt: ${resolve(runDir, "receipt.json")}`);
    console.log(`ChatGPT answer: ${resolve(runDir, "assistant.md")}`);
    console.log(`ChatGPT transcript: ${resolve(runDir, "transcript.md")}`);
    if (stdoutThreadEcho) {
      console.log("");
      console.log(envelope.transcriptMarkdown.trimEnd());
    }
  }

  process.exit(exitCodeForReceipt(receipt));
}

main();
