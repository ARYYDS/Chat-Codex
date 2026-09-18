# Automatic Doctor

Run the local installation check before opening ChatGPT:

```bash
node scripts/doctor.mjs --json
```

Continue only when it returns `READY`. Report `MISSING_RUNTIME` when Node.js 18 or newer is unavailable. Report `INVALID_INSTALLATION` with the failed check IDs when required Skill files are missing or the installed package name is wrong.

Before opening or claiming ChatGPT, check the versioned automation decision:

```bash
node scripts/automation-consent.mjs status --json
```

Possible statuses:

- `NEEDS_AUTOMATION_CONSENT`: no current decision exists, the file is invalid, or the disclosure changed.
- `AUTOMATION_DISABLED`: the user declined or revoked automatic browser handoff.
- `READY`: the current disclosure was explicitly accepted.

For `NEEDS_AUTOMATION_CONSENT`, show this disclosure without softening it:

> Unofficial Experimental browser automation submits prompts to and retrieves outputs from ChatGPT web using your signed-in session. This carries non-zero account and policy risk and may trigger safeguards, temporary restrictions, or account action. The project cannot guarantee account safety, policy compliance, or permanent quota separation. It is not intended to bypass limits. Enable it only if you understand and accept this risk.

Ask whether to enable full automatic browser handoff. An affirmative response must be explicit and present in the current conversation. Silence, invoking the Skill, or an unrelated reply is not consent. Only then run:

```bash
node scripts/automation-consent.mjs enable --acknowledge-risk I_ACCEPT_EXPERIMENTAL_BROWSER_AUTOMATION_RISK_V1 --json
```

On decline run `node scripts/automation-consent.mjs disable --json`. For `AUTOMATION_DISABLED`, do not open, claim, inspect, or control ChatGPT.

Then perform the volatile browser checks on every handoff:

1. Inspect the runtime surface. Return `NEEDS_DESKTOP_APP` only when it explicitly identifies CLI, IDE, cloud, Linux, or another unsupported surface.
2. On a supported Mac or Windows desktop surface, return `NEEDS_BROWSER` when the `browser:control-in-app-browser` Skill or in-app Browser capability is unavailable.
3. Open or claim `https://chatgpt.com/` only in the in-app Browser.
4. Check visible account UI. If logged out, report `NEEDS_CHATGPT_LOGIN`, ask the user to take over the page, and preserve the original task for resume.
5. Check the user-requested model in visible UI. If unavailable, report `NEEDS_MODEL_SELECTION`; never silently substitute another model.
6. If site access is blocked, report `NEEDS_SITE_PERMISSION` and follow the Browser Skill's permission flow.
7. Return `READY` only after authentication and model checks are visibly satisfied.

Never call private ChatGPT endpoints or inspect cookies, local storage, session storage, hidden authentication headers, browser profiles, passwords, verification codes, or credential files. Human login is a takeover step, not an automation step.
