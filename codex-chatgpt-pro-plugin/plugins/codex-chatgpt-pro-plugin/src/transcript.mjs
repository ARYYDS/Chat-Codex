export const SENT_HEADING = "Message Sent To ChatGPT Pro";
export const RECEIVED_HEADING = "Message Received From ChatGPT Pro";
export const THREAD_ECHO_DISABLE_ENV = "CHATGPT_THREAD_ECHO";

export function renderChatGptTranscript({ sentMarkdown, receivedMarkdown = "" }) {
  return renderLiveExchange({ sentMarkdown, receivedMarkdown });
}

export function renderLiveExchange({ sentMarkdown, receivedMarkdown }) {
  return [
    `## ${SENT_HEADING}`,
    "",
    String(sentMarkdown || "").trim(),
    "",
    `## ${RECEIVED_HEADING}`,
    "",
    String(receivedMarkdown || "").trim() || "_No assistant message captured._",
    "",
  ].join("\n");
}

export function renderReceivedEcho({ receivedMarkdown }) {
  return [
    `## ${RECEIVED_HEADING}`,
    "",
    String(receivedMarkdown || "").trim() || "_No assistant message captured._",
    "",
  ].join("\n");
}

export function shouldPrintThreadEcho(env = process.env) {
  return !["0", "false", "no", "off"].includes(String(env[THREAD_ECHO_DISABLE_ENV] || "").toLowerCase());
}
