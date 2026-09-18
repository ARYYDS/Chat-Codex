# Browser Architecture

Use this reference when the task involves launching, diagnosing, or safely driving the ChatGPT web surface through Chat-Codex.

## Fixed Paths And Ports

- Source root: `C:\code\Chat-Codex`
- Production core: `C:\code\Chat-Codex\handoff-core`
- Runtime root: `C:\GPT-Chat-codex-handoff`
- Worker 1 profile: `C:\code\Chat-Codex\sub-instance-1`, CDP port `9222`
- Worker 2 profile: `C:\code\Chat-Codex\sub-instance-2`, CDP port `9223`
- Master seed profile: `C:\GPT-Chat-codex-handoff\master-seed-profile`, CDP port `9225`
- Config: `C:\GPT-Chat-codex-handoff\runtime.local.json`

## L0/L1/L2 Rules

`L0 Master Seed`, port `9225`, is the credential source. It is for human login freshness and memory-only credential export. Do not send prompts, run tests, or automate ChatGPT turns through it.

`L1 Worker`, normally port `9222`, is the task carrier. It may receive memory-injected session cookies and can open ChatGPT web tabs for actual work.

`L2 Ephemeral Tab` is the per-task page. Chat-Codex opens a fresh tab by CDP, waits for the composer to hydrate, sends the prompt, waits for convergence, extracts the result, archives it, then closes the tab to release renderer memory.

## Preflight

Run:

```powershell
node C:\code\Chat-Codex\handoff-core\bin\handoff.js doctor --browser
```

If port `9222` is unavailable, start Worker 1:

```powershell
cmd /c C:\code\Chat-Codex\start_sub1.bat
```

If the result indicates login is required, stop automation and ask the user to complete login in the visible Worker browser. Do not ask for passwords, OTPs, cookies, session storage, or recovery codes in chat.

## Safety Boundaries

- Do not use backend API replay or external HTTP calls with copied cookies.
- Do not read or log raw cookies, local storage, session storage, or hidden auth data.
- Do not blindly replay writes after a CDP disconnect. Treat prompt submission and clicks as `UNKNOWN` until the remote conversation state is checked.
- Use Worker profiles only; never replace active browser profile directories.
- If Cloudflare, CAPTCHA, unusual-activity, permission, or account restriction states appear, stop and report the blocker.

## Why This Shape Exists

The project intentionally uses real Chrome CDP rather than direct API replay. The docs cite Chrome App-Bound encryption, Sentinel/Turnstile, JA4/TLS fingerprinting, and ProseMirror front-end behavior as reasons to keep the web workflow inside native Chrome with isolated user data directories.
