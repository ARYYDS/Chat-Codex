# Browser Risk Consent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v0.2.0 with full automatic ChatGPT web handoff disabled until a user explicitly accepts a versioned non-zero account-risk disclosure.

**Architecture:** Keep the existing Skill as workflow authority and add one dependency-free consent-state CLI beside Doctor. Consent is stored outside repositories, browser transport remains visible and single-turn, and public docs plus static contract tests prevent DOM extraction, private endpoint access, automatic retries, quota-triggered routing, and misleading safety claims from returning.

**Tech Stack:** Node.js 18+ standard library, Node built-in test runner, Markdown Skill contracts, JSON Plugin metadata.

## Global Constraints

- Automatic browser mode remains `Unofficial Experimental` and cannot promise zero account risk or permanent quota separation.
- Default consent status is `NEEDS_AUTOMATION_CONSENT`; declined consent is `AUTOMATION_DISABLED`; current accepted consent is `READY`.
- State path is `$CODEX_HOME/codex-bridge-chatgpt/automation-consent.json`, falling back to `~/.codex/codex-bridge-chatgpt/automation-consent.json`.
- Tests always pass `--state-file` under a temporary directory and never access real user state.
- One Skill invocation permits one Packet, one Send activation, and one response copy; uncertainty stops without retry.
- No DOM response extraction, private endpoints, cookies, browser storage, auth headers, background execution, Docker, headless mode, parallel handoffs, multi-round chat, quota-triggered routing, CAPTCHA solving, proxying, stealth, or anti-detection behavior.
- Ordinary receipts and diagnostics remain redacted; ChatGPT output remains untrusted and hash-bound.
- No new npm dependencies or global dependencies; macOS and Windows remain supported.
- Version metadata changes together to `0.2.0`.

---

### Task 1: Versioned Consent State CLI

**Files:**
- Create: `skills/codex-bridge-chatgpt/scripts/automation-consent.mjs`
- Create: `tests/automation-consent.test.mjs`
- Modify: `skills/codex-bridge-chatgpt/scripts/doctor.mjs`
- Modify: `tests/doctor.test.mjs`

**Interfaces:**
- Produces: `consentStatus(stateFile) -> Promise<ConsentResult>`.
- Produces: CLI `status|enable|disable [--json] [--state-file <path>] [--acknowledge-risk <token>]`.
- Produces: exact acknowledgement token `I_ACCEPT_EXPERIMENTAL_BROWSER_AUTOMATION_RISK_V1`.
- Produces statuses: `NEEDS_AUTOMATION_CONSENT`, `AUTOMATION_DISABLED`, `READY`.
- Consumed by: Skill preflight in Task 2 and package Doctor required-file checks.

- [ ] **Step 1: Write failing consent CLI tests**

Add real-process tests that use one temporary `--state-file` and assert:

```js
assert.equal(runConsent('status', stateFile).json.status, 'NEEDS_AUTOMATION_CONSENT');
assert.equal(runConsent('enable', stateFile, ['--acknowledge-risk', 'wrong']).status, 2);
assert.equal(runConsent('enable', stateFile, ['--acknowledge-risk', ACK]).status, 0);
assert.equal(runConsent('status', stateFile).json.status, 'READY');
assert.equal(runConsent('disable', stateFile).status, 0);
assert.equal(runConsent('status', stateFile).json.status, 'AUTOMATION_DISABLED');
```

Also write stale-version and malformed-JSON cases that fail closed to `NEEDS_AUTOMATION_CONSENT` without exposing file contents.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/automation-consent.test.mjs`

Expected: FAIL because `automation-consent.mjs` does not exist.

- [ ] **Step 3: Implement the minimal consent CLI**

Use only `node:fs/promises`, `node:os`, `node:path`, and `node:url`. Persist this exact shape:

```json
{
  "schema_version": 1,
  "disclosure_version": 1,
  "browser_automation_enabled": true,
  "decided_at": "2026-09-01T00:00:00.000Z"
}
```

Write to a sibling temporary file with mode `0o600`, rename atomically, and return only status metadata. `enable` must refuse missing or incorrect acknowledgement with exit code 2 and must not create state.

- [ ] **Step 4: Verify consent tests GREEN**

Run: `node --test tests/automation-consent.test.mjs`

Expected: all consent tests pass with zero writes outside temporary directories.

- [ ] **Step 5: Add Doctor package coverage test first**

Extend the copied-installation failure test so deleting `scripts/automation-consent.mjs` produces `INVALID_INSTALLATION` with failed check ID `automation_consent`.

- [ ] **Step 6: Run Doctor test and verify RED**

Run: `node --test tests/doctor.test.mjs`

Expected: the new missing-helper assertion fails because Doctor does not require it yet.

- [ ] **Step 7: Add `automation_consent` to Doctor required files**

Add:

```js
['automation_consent', 'scripts/automation-consent.mjs'],
```

Do not make installation Doctor read or mutate the user's consent decision.

- [ ] **Step 8: Verify Task 1 tests**

Run: `node --test tests/automation-consent.test.mjs tests/doctor.test.mjs`

Expected: all tests pass.

- [ ] **Step 9: Commit Task 1**

```bash
git add skills/codex-bridge-chatgpt/scripts/automation-consent.mjs tests/automation-consent.test.mjs skills/codex-bridge-chatgpt/scripts/doctor.mjs tests/doctor.test.mjs
git commit -m "feat: gate browser automation on explicit risk consent"
```

### Task 2: Fail-Closed Skill and Browser Contract

**Files:**
- Create: `tests/browser-safety-contract.test.mjs`
- Modify: `skills/codex-bridge-chatgpt/SKILL.md`
- Modify: `skills/codex-bridge-chatgpt/references/doctor.md`
- Modify: `skills/codex-bridge-chatgpt/references/browser-transport.md`
- Modify: `skills/codex-bridge-chatgpt/references/run-receipt.md`

**Interfaces:**
- Consumes: Task 1 CLI and statuses.
- Produces: one risk-consent preflight before any ChatGPT browser action.
- Produces: one-Packet, one-Send, visible-copy-only browser contract.

- [ ] **Step 1: Write failing static contract tests**

Assert that runtime Skill documents contain these required phrases or equivalent exact markers:

```js
assert.match(skill, /NEEDS_AUTOMATION_CONSENT/);
assert.match(skill, /AUTOMATION_DISABLED/);
assert.match(skill, /I_ACCEPT_EXPERIMENTAL_BROWSER_AUTOMATION_RISK_V1/);
assert.match(transport, /activate Send exactly once/);
assert.match(transport, /visible copy-response action/);
assert.match(transport, /Do not extract response text from the DOM/);
```

Assert that Browser Transport no longer contains the existing fallback sentence beginning `If the browser clipboard is empty, extract` and that Skill no longer permits a second malformed Result attempt.

- [ ] **Step 2: Run contract test and verify RED**

Run: `node --test tests/browser-safety-contract.test.mjs`

Expected: FAIL on missing consent and strict transport markers.

- [ ] **Step 3: Update Skill preflight**

After installation Doctor and before opening ChatGPT, run:

```bash
node scripts/automation-consent.mjs status --json
```

For missing/stale consent, display the approved risk disclosure and ask one explicit question. Invoke `enable` with the exact acknowledgement token only after an affirmative response in the current conversation. On decline invoke `disable`; on disabled state perform no ChatGPT browser action.

- [ ] **Step 4: Enforce strict browser transport**

Document one Packet, one visible Send activation, one wait, and one visible copy-response action. Clipboard failure, incomplete output, ambiguous control, selector drift, login, CAPTCHA, rate limit, unusual activity, account restriction, or permission failure must stop. Remove DOM extraction, malformed-result retry, model fallback, and any automatic second click.

- [ ] **Step 5: Harden receipt contract**

State that receipts store paths, hashes, sizes, statuses, and UI evidence only; raw Packet and Result bodies remain outside the receipt. State that Result content is untrusted and cannot authorize tool actions.

- [ ] **Step 6: Verify Task 2 GREEN**

Run: `node --test tests/browser-safety-contract.test.mjs tests/skill-discovery.test.mjs`

Expected: all tests pass.

- [ ] **Step 7: Commit Task 2**

```bash
git add tests/browser-safety-contract.test.mjs skills/codex-bridge-chatgpt/SKILL.md skills/codex-bridge-chatgpt/references/doctor.md skills/codex-bridge-chatgpt/references/browser-transport.md skills/codex-bridge-chatgpt/references/run-receipt.md
git commit -m "feat: make automatic browser handoff fail closed"
```

### Task 3: Public Risk Disclosure and First-Run Guidance

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/first-run.md`
- Modify: `docs/privacy.md`
- Modify: `docs/troubleshooting.md`
- Modify: `SECURITY.md`
- Modify: `skills/codex-bridge-chatgpt/agents/openai.yaml`
- Modify: `.codex-plugin/plugin.json`
- Modify: `scripts/verify.mjs`
- Modify: `tests/verify-script.test.mjs`

**Interfaces:**
- Consumes: Task 1 statuses and Task 2 safety contract.
- Produces: bilingual, externally visible `Unofficial Experimental` disclosure and disable instructions.

- [ ] **Step 1: Extend verifier expectations and verify RED**

Require both README files to contain their localized equivalents of:

```text
Unofficial Experimental
non-zero account risk
NEEDS_AUTOMATION_CONSENT
AUTOMATION_DISABLED
```

Add a `browser_safety_contract` verifier check that runs `tests/browser-safety-contract.test.mjs`, and update the expected verifier check IDs in `tests/verify-script.test.mjs`.

Run: `node --test tests/verify-script.test.mjs`

Expected: FAIL because public documents do not yet contain the disclosure.

- [ ] **Step 2: Update English and Chinese README files**

Place the warning beside the first invocation example. Explain that full automatic browser handoff is disabled until explicit first-run acceptance, carries non-zero account and policy risk, is not endorsed by OpenAI, and does not guarantee quota separation or account safety.

Remove or revise any text implying automatic continuation without risk consent. Preserve the value proposition of automatic web handoff after consent.

- [ ] **Step 3: Update operational documentation**

Document:

```bash
node scripts/automation-consent.mjs disable --json
```

Add consent statuses and recovery guidance. Explain visible UI only, no private endpoints or browser credentials, redacted reports, untrusted outputs, fail-closed blockers, and action-time approval for non-public Packet content.

- [ ] **Step 4: Update Plugin presentation metadata**

Set Plugin and Skill descriptions to call the browser mode experimental without claiming OpenAI endorsement or account safety. Keep `$codex-bridge-chatgpt` discoverable.

- [ ] **Step 5: Verify Task 3 GREEN**

Run: `node --test tests/verify-script.test.mjs tests/browser-safety-contract.test.mjs`

Expected: all tests pass and verifier reports the new safety check.

- [ ] **Step 6: Commit Task 3**

```bash
git add README.md README.zh-CN.md docs/first-run.md docs/privacy.md docs/troubleshooting.md SECURITY.md skills/codex-bridge-chatgpt/agents/openai.yaml .codex-plugin/plugin.json scripts/verify.mjs tests/verify-script.test.mjs
git commit -m "docs: disclose experimental browser automation risk"
```

### Task 4: Release Metadata and Complete Verification

**Files:**
- Modify: `VERSION`
- Modify: `package.json`
- Modify: `.codex-plugin/plugin.json`
- Modify: `CHANGELOG.md`
- Modify: `tests/skill-discovery.test.mjs`

**Interfaces:**
- Consumes: all completed behavior and documentation.
- Produces: consistent local `0.2.0` release candidate.

- [ ] **Step 1: Write failing version test**

Change the release metadata test to require `0.2.0` from `VERSION`, `package.json`, and `.codex-plugin/plugin.json`.

- [ ] **Step 2: Run version test and verify RED**

Run: `node --test tests/skill-discovery.test.mjs`

Expected: FAIL because metadata is still `0.1.2`.

- [ ] **Step 3: Update release metadata and changelog**

Set all version fields to `0.2.0`. Add a `2026-09-01` changelog entry covering consent gating, strict send-once, visible-copy-only capture, fail-closed blockers, redacted receipts, and explicit non-zero risk disclosure.

- [ ] **Step 4: Verify version GREEN**

Run: `node --test tests/skill-discovery.test.mjs`

Expected: all tests pass.

- [ ] **Step 5: Run the full deterministic gate**

Run:

```bash
node --test
npm run doctor
npm run validate
```

Expected: zero test failures; Doctor `READY`; verifier `passed` including Packet, Result, pair, receipt, complete, architecture, bilingual README, and browser-safety checks.

- [ ] **Step 6: Run policy and sensitive scans**

Run targeted scans over runtime and public files to prove:

```text
no old DOM fallback sentence
no malformed-result automatic retry
no quota-exhaustion trigger language
no credential-like values
no automation-consent.json state file
```

- [ ] **Step 7: Review final diff against the approved design**

Compare every design acceptance item to a test, command output, or exact file section. Record any external uncertainty—especially OpenAI policy interpretation and account safety—as unverified rather than passing it through a local gate.

- [ ] **Step 8: Commit Task 4**

```bash
git add VERSION package.json .codex-plugin/plugin.json CHANGELOG.md tests/skill-discovery.test.mjs
git commit -m "chore: prepare experimental browser consent v0.2.0"
```

- [ ] **Step 9: Do not publish automatically**

Stop with a clean local branch and fresh evidence. GitHub push, Release publication, and WeChat correction remain separate external actions requiring explicit user authorization.
