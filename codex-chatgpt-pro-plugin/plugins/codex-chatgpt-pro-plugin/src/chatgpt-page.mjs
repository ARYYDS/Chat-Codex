import { evaluate } from "./cdp-client.mjs";

export const AUTH_LOGIN_REQUIRED = "auth.login_required";
export const LOGIN_REQUIRED_EXIT_CODE = 20;

export function loginRequiredMessage() {
  return [
    "The dedicated chatgpt-pro Chrome profile is not logged in.",
    "Run chatgpt-pro doctor --warm, complete login in the visible Chrome window,",
    "then run chatgpt-pro doctor --live.",
  ].join(" ");
}

export function exitCodeForReceipt(receipt) {
  if (receipt?.ok) return 0;
  if (receipt?.errorCode === AUTH_LOGIN_REQUIRED || receipt?.error === "not_logged_in") {
    return LOGIN_REQUIRED_EXIT_CODE;
  }
  return 1;
}

export async function pageProbe(cdp) {
  return evaluate(
    cdp,
    `(() => {
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      };
      const composer =
        [...document.querySelectorAll('textarea[aria-label="Chat with ChatGPT"], textarea[placeholder], [contenteditable="true"][role="textbox"], [role="textbox"][aria-label="Chat with ChatGPT"]')]
          .find(visible) || null;
      const sendButton =
        [...document.querySelectorAll("button")]
          .find((button) => {
            const label = [button.innerText, button.getAttribute("aria-label"), button.title].filter(Boolean).join(" ");
            return visible(button) && !button.disabled && /send|submit/i.test(label);
          }) || null;
      const roleMessages = [...document.querySelectorAll("[data-message-author-role]")]
        .map((el) => ({
          role: el.getAttribute("data-message-author-role"),
          text: el.innerText || "",
        }))
        .filter((message) => message.text);
      const assistantTurns = roleMessages
        .filter((message) => message.role === "assistant")
        .map((message) => message.text);
      const userTurns = roleMessages
        .filter((message) => message.role === "user")
        .map((message) => message.text);
      const bodyText = document.body?.innerText || "";
      return {
        url: location.href,
        title: document.title,
        bodyText,
        isLoggedOut:
          (/\\bLog in\\b/i.test(bodyText) && /Log in to get answers based on saved chats/i.test(bodyText)) ||
          (/\\bLog in\\b/i.test(bodyText) && /\\bSign up\\b/i.test(bodyText) && !composer),
        composer: composer ? (() => {
          const r = composer.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), tag: composer.tagName, role: composer.getAttribute("role"), aria: composer.getAttribute("aria-label"), placeholder: composer.getAttribute("placeholder") };
        })() : null,
        sendButton: sendButton ? (() => {
          const r = sendButton.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), text: sendButton.innerText, aria: sendButton.getAttribute("aria-label") };
        })() : null,
        assistantTurns,
        userTurns,
      };
    })()`,
  );
}

export function redactedProbe(probe) {
  return {
    url: probe.url,
    title: probe.title,
    isLoggedOut: probe.isLoggedOut,
    composer: probe.composer,
    sendButton: probe.sendButton,
    assistantTurnCount: probe.assistantTurns.length,
    userTurnCount: probe.userTurns.length,
    bodyTextLength: probe.bodyText.length,
  };
}
