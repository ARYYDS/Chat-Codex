import { createHash } from "node:crypto";
import { evaluate, now, sleep } from "./cdp-client.mjs";

export function sha256(text) {
  return createHash("sha256").update(String(text || "")).digest("hex");
}

export function normalizeMessageText(text) {
  return String(text || "")
    .replace(/\bShow more\b|\bShow less\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function shapeConversationMessages(rawMessages) {
  return rawMessages.map((message, index) => {
    const role = ["user", "assistant"].includes(message.role) ? message.role : "unknown";
    const text = String(message.text || "").trim();
    const normalizedText = normalizeMessageText(text);
    return {
      role,
      ordinal: index,
      text,
      textSha256: sha256(text),
      normalizedTextSha256: sha256(normalizedText),
      charCount: text.length,
      normalizedCharCount: normalizedText.length,
      domFingerprint: message.domFingerprint || `${role}:${index}:${sha256(normalizedText).slice(0, 12)}`,
    };
  });
}

export async function snapshotConversationMessages(cdp) {
  const rawMessages = await evaluate(
    cdp,
    `(() => [...document.querySelectorAll("[data-message-author-role]")].map((el, index) => ({
      role: el.getAttribute("data-message-author-role") || "unknown",
      text: el.innerText || "",
      domFingerprint: [
        el.getAttribute("data-message-id") || "",
        el.getAttribute("data-testid") || "",
        el.childElementCount,
        index,
      ].join(":"),
    })))()`,
  );
  return shapeConversationMessages(rawMessages);
}

export function countMessagesByRole(messages, role) {
  return messages.filter((message) => message.role === role).length;
}

function promptEchoVerification(message, prompt) {
  const expected = normalizeMessageText(prompt);
  const actual = normalizeMessageText(message?.text || "");
  if (!message) return "missing";
  if (actual && sha256(actual) === sha256(expected)) return "exact";
  if (actual.includes(expected)) return "exact_with_attachment";

  const prefix = expected.slice(0, Math.min(120, expected.length));
  const actualPrefix = actual.slice(0, prefix.length);
  const charRatio = expected.length ? actual.length / expected.length : 0;
  if (prefix && actualPrefix === prefix) return "partial";
  if (actual.length >= 30 && expected.startsWith(actual)) return "partial";
  if (charRatio > 0.65 && charRatio < 1.35) return "partial";
  return "observed_unverified";
}

export function findNewUserMessage(beforeSnapshot, afterSnapshot, prompt) {
  const beforeUserKeys = new Set(
    beforeSnapshot
      .filter((message) => message.role === "user")
      .flatMap((message) => [message.textSha256, message.normalizedTextSha256]),
  );
  const beforeLength = beforeSnapshot.length;
  const newUsers = afterSnapshot
    .filter((message) => message.role === "user")
    .filter((message) =>
      message.ordinal >= beforeLength
      || !beforeUserKeys.has(message.textSha256)
      || !beforeUserKeys.has(message.normalizedTextSha256),
    );
  const candidates = newUsers.length
    ? newUsers
    : afterSnapshot.filter((message) => message.role === "user").slice(-1);

  const ranked = candidates
    .map((message) => ({
      message,
      isNew: !beforeUserKeys.has(message.textSha256)
        || !beforeUserKeys.has(message.normalizedTextSha256)
        || message.ordinal >= beforeLength,
      promptEchoVerification: promptEchoVerification(message, prompt),
    }))
    .sort((a, b) => {
      const weight = { exact: 0, exact_with_attachment: 0, partial: 1, observed_unverified: 2, missing: 3 };
      return weight[a.promptEchoVerification] - weight[b.promptEchoVerification];
    });

  return ranked[0] || null;
}

export async function waitForNewUserMessage(cdp, beforeSnapshot, prompt, { timeoutMs = 10_000 } = {}) {
  const startedAt = now();
  let lastObserved = null;
  while (now() - startedAt < timeoutMs) {
    const snapshot = await snapshotConversationMessages(cdp);
    const match = findNewUserMessage(beforeSnapshot, snapshot, prompt);
    if (
      match
      && match.isNew
      && ["exact", "exact_with_attachment", "partial"].includes(match.promptEchoVerification)
    ) {
      return { ...match, snapshot };
    }
    if (match) lastObserved = { ...match, snapshot };
    await sleep(250);
  }

  if (lastObserved) {
    const error = new Error("A user message was observed, but it could not be proven to be newly sent.");
    error.errorCode = "send.prompt_echo_mismatch";
    error.details = {
      promptEchoVerification: lastObserved.promptEchoVerification,
      observedOrdinal: lastObserved.message.ordinal,
      observedCharCount: lastObserved.message.charCount,
    };
    throw error;
  }

  const error = new Error("No new user message appeared after sending the prompt.");
  error.errorCode = "send.no_user_message_observed";
  throw error;
}

export function findAssistantAfterUser(snapshot, userMessage) {
  return snapshot.find(
    (message) => message.role === "assistant" && message.ordinal > userMessage.ordinal,
  ) || null;
}

export function assistantRunAfterUser(snapshot, userMessage) {
  const messages = snapshot.filter((message) => message.ordinal > userMessage.ordinal);
  const nextUser = messages.find((message) => message.role === "user");
  const endOrdinal = nextUser ? nextUser.ordinal : Infinity;
  const assistantMessages = messages.filter(
    (message) => message.role === "assistant" && message.ordinal < endOrdinal,
  );
  const text = assistantMessages
    .map((message) => message.text)
    .filter(Boolean)
    .join("\n\n")
    .trim();
  return {
    assistantMessages,
    first: assistantMessages[0] || null,
    last: assistantMessages.at(-1) || null,
    text,
    textSha256: sha256(text),
    charCount: text.length,
    afterUserOrdinal: userMessage.ordinal,
    nextUserOrdinal: Number.isFinite(endOrdinal) ? endOrdinal : null,
  };
}

export async function waitForAssistantAfterUserMessage(cdp, userMessage, { timeoutMs = 240_000 } = {}) {
  const startedAt = now();
  let lastSnapshot = [];
  while (now() - startedAt < timeoutMs) {
    lastSnapshot = await snapshotConversationMessages(cdp);
    const assistant = findAssistantAfterUser(lastSnapshot, userMessage);
    if (assistant) return { assistant, snapshot: lastSnapshot };
    await sleep(750);
  }
  const error = new Error("No assistant message appeared after the newly sent user message.");
  error.errorCode = "response.no_assistant_after_user";
  error.details = {
    userOrdinal: userMessage.ordinal,
    messageCount: lastSnapshot.length,
  };
  throw error;
}
