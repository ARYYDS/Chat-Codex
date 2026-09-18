import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

function sha256(text) {
  return createHash("sha256").update(String(text || "")).digest("hex");
}

function roleCounts(messages) {
  return messages.reduce((counts, message) => {
    const role = message.role || "unknown";
    counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, {});
}

function historyCompleteness(last = 0) {
  return {
    claim: last ? "last_n_loaded_dom_messages" : "all_loaded_dom_messages",
    loadAllAttempted: false,
    absoluteConversationComplete: false,
    olderMessagesMayExist: true,
    honestLabel: last
      ? `last ${last} currently loaded visible ChatGPT DOM messages`
      : "all currently loaded visible ChatGPT DOM messages",
  };
}

export function historyMarkdown({ project, alias, target, roomTarget, messages, exportedAt, last = 0 }) {
  const transcriptText = messages
    .map((message) => `${message.role}:${message.ordinal}:${message.text || ""}`)
    .join("\n\n");
  const counts = roleCounts(messages);
  const completeness = historyCompleteness(last);
  const lines = [
    "# ChatGPT Conversation History",
    "",
    `Exported: ${exportedAt}`,
    `Project: ${project.displayName}`,
    `Project id: ${project.projectId}`,
    `Alias: ${alias}`,
    `Conversation URL: ${target.url}`,
    `Export scope: ${last ? `last ${last}` : "all visible"}`,
    `History claim: ${completeness.honestLabel}`,
    "Absolute conversation complete: false",
    `Messages exported: ${messages.length}`,
    `User messages: ${counts.user || 0}`,
    `Assistant messages: ${counts.assistant || 0}`,
    `Transcript sha256: ${sha256(transcriptText)}`,
    `Room target bound: ${roomTarget?.targetBoundToRoom === true}`,
    "",
  ];

  for (const message of messages) {
    lines.push(
      `## Message ${message.ordinal} - ${message.role}`,
      "",
      `sha256: ${message.textSha256}`,
      `normalized-sha256: ${message.normalizedTextSha256}`,
      `chars: ${message.charCount}`,
      "",
      message.text || "_empty_",
      "",
    );
  }

  return `${lines.join("\n")}\n`;
}

export function compileHistoryArtifact({ project, alias, target, roomTarget, messages, exportedAt, last = 0, outDir = "" }) {
  const counts = roleCounts(messages);
  const transcriptText = messages
    .map((message) => `${message.role}:${message.ordinal}:${message.text || ""}`)
    .join("\n\n");
  const markdown = historyMarkdown({ project, alias, target, roomTarget, messages, exportedAt, last });
  const json = {
    ok: true,
    exportedAt,
    project,
    alias,
    target,
    roomTarget,
    exportScope: last ? "last_n_visible" : "all_visible",
    requestedLast: last || null,
    historyCompleteness: historyCompleteness(last),
    messageCount: messages.length,
    roleCounts: counts,
    firstOrdinal: messages[0]?.ordinal ?? null,
    lastOrdinal: messages.at(-1)?.ordinal ?? null,
    transcriptSha256: sha256(transcriptText),
    markdownSha256: sha256(markdown),
    messages,
    artifacts: outDir
      ? {
          markdown: `${outDir}/chatgpt-history.md`,
          json: `${outDir}/history.json`,
        }
      : null,
  };
  return { markdown, json };
}

export function readHistoryArtifact(path) {
  const json = JSON.parse(readFileSync(path, "utf8"));
  return {
    ok: true,
    path,
    alias: json.alias || null,
    projectId: json.project?.projectId || null,
    conversationUrl: json.target?.url || null,
    exportScope: json.exportScope || null,
    historyCompleteness: json.historyCompleteness || null,
    messageCount: json.messageCount || json.messages?.length || 0,
    roleCounts: json.roleCounts || roleCounts(json.messages || []),
    firstOrdinal: json.firstOrdinal ?? json.messages?.[0]?.ordinal ?? null,
    lastOrdinal: json.lastOrdinal ?? json.messages?.at(-1)?.ordinal ?? null,
    transcriptSha256: json.transcriptSha256 || null,
    markdownSha256: json.markdownSha256 || null,
    messages: json.messages || [],
  };
}
