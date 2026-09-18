# Browser Transport

Use only the Codex in-app Browser in the Mac or Windows ChatGPT desktop app. Keep the same claimed ChatGPT tab through one submission and one visible response copy. The transport is Unofficial Experimental.

Automatic preflight returns exactly one status:

- `NEEDS_DESKTOP_APP`: the runtime explicitly identifies CLI, IDE, cloud, Linux, or another unsupported surface.
- `NEEDS_BROWSER`: a supported Mac or Windows desktop surface lacks the required Browser Skill or capability.
- `NEEDS_CHATGPT_LOGIN`: the ChatGPT page visibly shows a logged-out state.
- `NEEDS_MODEL_SELECTION`: the requested model is not visibly selected or available.
- `NEEDS_SITE_PERMISSION`: browser access to ChatGPT is blocked pending user action.
- `READY`: authentication, requested model, and transport capability are visibly available.

When human takeover is needed, keep the original repository task and current Packet draft local. Ask the user to finish the visible login, model, or permission step without sending credentials in chat. On their next message, recheck only the volatile browser state and continue the original task.

Before sending, record a local UI summary showing the ChatGPT origin, authenticated account UI, requested model, and absence of blockers. After completion, capture the same facts again. DOM inspection may verify visible UI state, but it must not capture response content. These are UI-level observations, not cryptographic backend-model proof.

Fill the visible composer and activate Send exactly once. Observe whether the user turn appeared, but never activate Send again. An indeterminate submission is a terminal blocker for this handoff.

Wait for one completed answer, then use ChatGPT's visible copy-response action exactly once. If the clipboard does not change, the response is incomplete, or markers/headings are invalid, stop. Do not extract response text from the DOM. Do not retry, refresh, resubmit, continue the conversation, or substitute a model.

Stop on login, CAPTCHA, rate-limit, unusual-activity, account restriction, permission, ambiguous-control, or selector-drift states. Do not work around them. Never call private endpoints, replay network requests, inspect cookies, local storage, session storage, or hidden auth data, and never use background, scheduled, Dockerized, headless, parallel, proxy, stealth, CAPTCHA-solving, or anti-detection execution.
