# Browser & Login Internals

Lower-level notes on how ChatGPT Pro Line drives the dedicated ChatGPT browser
profile. Day-to-day work goes through the `chatgpt-pro` CLI (see the
[README](../README.md) and [call contract](chatgpt-call-contract.md)); this
document is for understanding and debugging the transport itself.

## The dedicated profile

Every call shares one logged-in Chrome profile so your ChatGPT session persists
across runs:

```text
.devspace/chrome-profiles/chatgpt-pro
```

It is git-ignored and never committed. CDP is exposed on
`http://127.0.0.1:9222` for deterministic control.

## Bring-up

```bash
npm install
npm run chrome          # open chatgpt.com in the dedicated profile (CDP on :9222)
npm run login:check     # verify the profile is authenticated
npm run levels:list     # read account plan + available model/intelligence labels
npm run cdp:smoke       # verify /json/version and /json/list
```

`npm run chrome:headless` runs the same profile headless; `npm run chrome:debug`
adds verbose CDP/profile output. Set `BROWSER_OBSERVER=1` on any run to print a
temporary localhost run-inspector URL.

## Login boundary

The human completes login in the visible window. The automation must never enter
passwords or OTPs, solve CAPTCHA, or inspect cookies/session storage. When login
is required the run fails closed:

- receipt `errorCode`: `auth.login_required`
- process exit code: `20`
- next action: human finishes login in the window, then rerun

## Choice control

Do not hardcode model/intelligence labels — read them from the live site:

```bash
npm run levels:list
npm run levels:set -- --level=Pro
npm run choices:set -- --model=5.4
```

Receipts record the account plan, available choices, and the selected/current
choice. Treat `account.isPro` as subscription detection and
`intelligence.current` as the active level. Slower levels such as `High` or
`Pro` may need a larger `CHATGPT_RESPONSE_TIMEOUT_MS`.

## Run artifacts

Each live run writes a proof bundle under `.devspace/runs/<run-id>/`:
`receipt.json`, `receipt.md`, `transcript.md`, `run.json`, `final.png`,
`snapshot.json`, `console.json`, and `network.json`.

## Non-interference

The canonical message path is text-only and uses no OS-level input, voice, or
dictation — only DOM focus for the composer, CDP `Input.insertText` for the
text, and a DOM button click to send. `npm run test:non-interference` guards
this boundary.

Chrome DevTools MCP is available as an **optional** debugging aid
(`npm run mcp:chrome`, attached to the same `:9222` endpoint), but it is not part
of the canonical call path. Keep ChatGPT work in the dedicated profile and avoid
mixing unrelated browsing state into it.
