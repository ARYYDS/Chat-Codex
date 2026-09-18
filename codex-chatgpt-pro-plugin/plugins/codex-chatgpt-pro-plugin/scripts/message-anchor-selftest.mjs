import assert from "node:assert/strict";
import {
  assistantRunAfterUser,
  findAssistantAfterUser,
  findNewUserMessage,
  shapeConversationMessages,
} from "../src/chatgpt-messages.mjs";

const prompt = "Please review this patch and choose the next narrow implementation step.";

const before = shapeConversationMessages([
  { role: "user", text: "old prompt" },
  { role: "assistant", text: "old answer" },
]);

const afterHappy = shapeConversationMessages([
  { role: "user", text: "old prompt" },
  { role: "assistant", text: "old answer" },
  { role: "user", text: prompt },
  { role: "assistant", text: "new answer" },
]);

const userMatch = findNewUserMessage(before, afterHappy, prompt);
assert.equal(userMatch.promptEchoVerification, "exact");
assert.equal(userMatch.message.ordinal, 2);

const afterAttachmentEcho = shapeConversationMessages([
  { role: "user", text: "old prompt" },
  { role: "assistant", text: "old answer" },
  { role: "user", text: `upload-note.txt\nDocument\n${prompt}` },
  { role: "assistant", text: "new answer" },
]);

const attachmentEcho = findNewUserMessage(before, afterAttachmentEcho, prompt);
assert.equal(attachmentEcho.promptEchoVerification, "exact_with_attachment");
assert.equal(attachmentEcho.message.ordinal, 2);

const assistantMatch = findAssistantAfterUser(afterHappy, userMatch.message);
assert.equal(assistantMatch.ordinal, 3);
assert.equal(assistantMatch.text, "new answer");

const afterSplitAssistant = shapeConversationMessages([
  { role: "user", text: "old prompt" },
  { role: "assistant", text: "old answer" },
  { role: "user", text: prompt },
  { role: "assistant", text: "short preface" },
  { role: "assistant", text: "actual checklist body" },
]);

const splitUser = findNewUserMessage(before, afterSplitAssistant, prompt);
const splitRun = assistantRunAfterUser(afterSplitAssistant, splitUser.message);
assert.deepEqual(splitRun.assistantMessages.map((message) => message.ordinal), [3, 4]);
assert.equal(splitRun.text, "short preface\n\nactual checklist body");
assert.equal(splitRun.last.text, "actual checklist body");

const afterNoAssistant = shapeConversationMessages([
  { role: "user", text: "old prompt" },
  { role: "assistant", text: "old answer" },
  { role: "user", text: prompt },
]);

const userWithoutAssistant = findNewUserMessage(before, afterNoAssistant, prompt);
assert.equal(userWithoutAssistant.message.ordinal, 2);
assert.equal(findAssistantAfterUser(afterNoAssistant, userWithoutAssistant.message), null);

const afterCollapsedPrompt = shapeConversationMessages([
  { role: "user", text: "old prompt" },
  { role: "assistant", text: "old answer" },
  { role: "user", text: `${prompt.slice(0, 40)} Show more` },
  { role: "assistant", text: "new answer" },
]);

const collapsed = findNewUserMessage(before, afterCollapsedPrompt, prompt);
assert.equal(collapsed.promptEchoVerification, "partial");
assert.equal(collapsed.message.ordinal, 2);

const beforeLongSnapshot = shapeConversationMessages([
  { role: "user", text: "older prompt 1" },
  { role: "assistant", text: "older answer 1" },
  { role: "user", text: "older prompt 2" },
  { role: "assistant", text: "older answer 2" },
  { role: "user", text: "older prompt 3" },
  { role: "assistant", text: "older answer 3" },
]);

const afterVirtualizedSnapshot = shapeConversationMessages([
  { role: "assistant", text: "older answer 3" },
  { role: "user", text: `${prompt.slice(0, 45)} Show more` },
  { role: "assistant", text: "new answer" },
]);

const virtualized = findNewUserMessage(beforeLongSnapshot, afterVirtualizedSnapshot, prompt);
assert.equal(virtualized.isNew, true);
assert.equal(virtualized.promptEchoVerification, "partial");
assert.equal(virtualized.message.ordinal, 1);

console.log(JSON.stringify({ ok: true, tested: "message-anchor" }, null, 2));
