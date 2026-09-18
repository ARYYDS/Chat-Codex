# Codex Bridge to ChatGPT

**English** | [简体中文](README.zh-CN.md)

[![CI](https://github.com/anightmonarch/codex-bridge-chatgpt/actions/workflows/ci.yml/badge.svg)](https://github.com/anightmonarch/codex-bridge-chatgpt/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-0.2.0-10a37f)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-43853d)](package.json)

An open-source Codex Skill and Plugin-ready package that delegates difficult repository reasoning to ChatGPT Web while keeping evidence collection, file edits, tests, and the final decision inside Codex.

```text
$codex-bridge-chatgpt Diagnose this complex bug, implement the fix, and verify it locally.
```

No separate setup command. No OpenAI API key. No background service. The first task pauses for one explicit browser-risk decision, then accepted installations enter the automatic handoff workflow.

> **Unofficial Experimental:** automatic ChatGPT web control carries non-zero account risk and may trigger safeguards, temporary restrictions, or account action. This project is not affiliated with or endorsed by OpenAI. It cannot guarantee policy compliance, account safety, model availability, or permanent separation between ChatGPT and Codex allowances. Full automation remains disabled until the user explicitly accepts this disclosure.

![Codex Bridge to ChatGPT architecture](assets/codex-bridge-chatgpt-architecture.en.png)

Maintained diagram source: [docs/architecture/codex-bridge-chatgpt-v1.en.architecture.json](docs/architecture/codex-bridge-chatgpt-v1.en.architecture.json).

## Why this project exists

Complex debugging, architecture decisions, and multi-option trade-offs often benefit from a stronger reasoning pass. Repository inspection and execution, however, should remain close to the working tree where facts can be checked and changes can be tested.

Codex Bridge to ChatGPT separates those responsibilities:

| Responsibility | Owner |
|---|---|
| Read repository rules, code, tests, and working-tree state | Codex |
| Minimize and sanitize the evidence | Codex |
| Perform the expensive reasoning pass | ChatGPT Web |
| Decide which recommendations are trustworthy | Codex |
| Edit files and run commands | Codex |
| Validate tests and declare completion | Codex |

ChatGPT proposes. Codex verifies and executes.

## What it does

- Starts from one natural-language task.
- Runs Automatic Doctor before the first handoff.
- Requires versioned risk consent before any ChatGPT browser action.
- Checks the supported desktop surface, in-app Browser, ChatGPT login, and requested model.
- Compresses decisive repository evidence into a bounded 1–3K approximate-token Context Packet.
- Removes likely credentials and unrelated repository context before transmission.
- Uses the Codex in-app Browser instead of an ordinary browser profile.
- Requires ChatGPT to return a structured Reasoning Result.
- Treats all web output as untrusted data.
- Records every recommendation as `accepted`, `rejected`, or `deferred`.
- Reconstructs edits and test commands from current local repository state.
- Binds Packet, Result, browser evidence, and run status with SHA-256 receipts.
- Declares completion only after the deterministic `complete` gate passes.

## Workflow

1. **Invoke** — the user names `$codex-bridge-chatgpt` in a real repository task.
2. **Preflight** — Automatic Doctor validates the installed package and runtime.
3. **Risk decision** — the Skill explains the non-zero risk and continues only after explicit versioned consent.
4. **Browser check** — Codex checks the desktop surface, in-app Browser, ChatGPT login, and requested model.
5. **Local evidence** — Codex reads project instructions, status, relevant code, and tests.
6. **Context Packet** — Codex produces one bounded, sanitized handoff contract.
7. **Web reasoning** — one visible Send activation produces one structured proposal.
8. **Visible copy** — the Skill imports the completed answer through ChatGPT's visible copy-response action; uncertainty stops.
9. **Local adoption gate** — Codex independently verifies each proposed change.
10. **Edit and test** — Codex reconstructs the implementation and runs local validation.
11. **Receipt and completion** — redacted hashes and statuses are recorded before the complete gate.

## How it works

### Context Packet

The outbound Packet contains only the information needed to change the decision:

- objective;
- acceptance criteria;
- relevant repository state;
- decisive evidence;
- constraints;
- explicit questions for the reasoner.

The validator rejects malformed markers, missing sections, duplicate fields, oversized Packets, and common credential patterns.

### Reasoning Result

ChatGPT must separate evidence from inference and return a fixed result contract containing a verdict, assumptions, evidence used, proposed changes, tests, risks, and unknowns. A matching `packet_id` binds the answer to the request.

### Local adoption gate

A valid Result is not permission to execute it. Codex reopens the relevant local files and symbols, verifies every accepted recommendation, and reconstructs commands or patches itself. Commands, paths, patches, and test strings from the webpage are never passed directly to tools.

### Run receipt

The final receipt records:

- Packet, Result, and browser-evidence SHA-256 hashes;
- observed Codex and ChatGPT model UI evidence;
- privacy-review fields;
- accepted, rejected, and deferred recommendations;
- local modification and test status.

Hashes bind local artifacts. They do not cryptographically attest the remote backend model.

## Requirements and support

- Node.js 18 or newer.
- A Mac or Windows ChatGPT desktop App environment with Codex.
- The Codex in-app Browser capability and `browser:control-in-app-browser` Skill.
- A ChatGPT Web session that can visibly access the requested model.

| Surface | V1 status |
|---|---|
| macOS ChatGPT desktop App + Codex | Supported target; locally exercised |
| Windows ChatGPT desktop App + Codex | Supported target; package gates run in Windows CI |
| Codex CLI | No in-app Browser bridge |
| Codex IDE extension | No in-app Browser bridge |
| Linux | Not supported by the V1 desktop workflow |

The deterministic package is tested on both macOS and Windows. End-to-end web transport still depends on the Browser capabilities exposed by the user's desktop App version.

## Installation

### Recommended: Skill Installer

If your Codex installation includes `$skill-installer`, send this in Codex:

```text
$skill-installer Install codex-bridge-chatgpt from https://github.com/anightmonarch/codex-bridge-chatgpt/tree/main/skills/codex-bridge-chatgpt
```

Open a new Codex task after installation so the Skill list is reloaded.

### Manual installation on macOS

```bash
git clone --depth 1 https://github.com/anightmonarch/codex-bridge-chatgpt.git
mkdir -p "$HOME/.codex/skills"
cp -R codex-bridge-chatgpt/skills/codex-bridge-chatgpt "$HOME/.codex/skills/"
```

### Manual installation on Windows PowerShell

```powershell
git clone --depth 1 https://github.com/anightmonarch/codex-bridge-chatgpt.git
New-Item -ItemType Directory -Force "$HOME\.codex\skills" | Out-Null
Copy-Item -Recurse "codex-bridge-chatgpt\skills\codex-bridge-chatgpt" "$HOME\.codex\skills\"
```

If the destination already exists, back it up and compare versions instead of overwriting it blindly.

The repository also includes a validated [Codex Plugin manifest](.codex-plugin/plugin.json). The Skill directory is the canonical workflow; the Plugin is its distribution wrapper.

## Quick start

Open a repository in Codex and send one task:

```text
$codex-bridge-chatgpt Find the root cause of this intermittent failure, implement the smallest safe fix, and run the relevant tests.
```

Other useful prompts:

```text
$codex-bridge-chatgpt Review this architecture decision and implement the locally verified option.

$codex-bridge-chatgpt Diagnose this performance regression from first principles and verify the fix.

$codex-bridge-chatgpt Compare the plausible designs, choose one with evidence, then modify and test the repository.
```

Use the bridge for unclear root causes, multiple plausible designs, or high-cost technical decisions. Keep mechanical edits, simple lookups, and already-decided plans local.

## First-run Doctor

Users do not run a separate setup command. The Skill checks installation, then the persistent browser-risk decision, then volatile browser state:

| Status | Meaning | Recovery |
|---|---|---|
| `NEEDS_AUTOMATION_CONSENT` | No current browser-risk decision exists | Read the disclosure and explicitly enable or decline automation |
| `AUTOMATION_DISABLED` | Automatic browser handoff was declined or revoked | Keep work local, or explicitly enable it later |
| `READY` | Current consent and the relevant preflight layer are ready | Continue to the next preflight layer or handoff |
| `MISSING_RUNTIME` | Node.js 18+ is unavailable | Install Node.js 18+ and retry |
| `INVALID_INSTALLATION` | Required Skill files are missing or mismatched | Reinstall the Skill directory |
| `NEEDS_DESKTOP_APP` | The current Codex surface does not support this bridge | Use the Mac/Windows ChatGPT desktop App |
| `NEEDS_BROWSER` | The in-app Browser capability is unavailable | Update or enable the required Browser capability |
| `NEEDS_CHATGPT_LOGIN` | ChatGPT is visibly logged out in the in-app Browser | Take over the page, log in, then reply that login is complete |
| `NEEDS_MODEL_SELECTION` | The requested model is not visible or selected | Select it; the Skill does not substitute another model |
| `NEEDS_SITE_PERMISSION` | Access to `chatgpt.com` needs user permission | Approve access in the desktop App |

The original repository task is preserved across human takeover. Passwords, verification codes, cookies, and recovery codes must never be sent to Codex.

Revoke automatic browser handoff at any time from the installed Skill directory:

```bash
node scripts/automation-consent.mjs disable --json
```

## Privacy and security

After consent, the Skill sends one minimized Context Packet to `https://chatgpt.com/` through visible in-app Browser controls. It does not use private ChatGPT endpoints, read cookies or browser storage, require an API key, run a hosted service, or collect telemetry. Ordinary receipts are redacted, and imported output remains untrusted until Codex revalidates it locally.

It is designed not to send:

- passwords, tokens, API keys, private keys, cookies, or verification codes;
- `.env` files or raw credential stores;
- complete private repositories or complete uncommitted diffs;
- unrelated source files;
- personal, customer, financial, medical, or organizational data without explicit action-time approval.

Regex scanning cannot understand every business secret, so the workflow also requires a semantic privacy review before transmission.

This project does not bypass ChatGPT plans, model entitlements, login, workspace policy, rate limits, or site security. It cannot turn a Plus account into Pro. Any token or cost savings depend on the user's actual Codex and ChatGPT plans and workload; they are not guaranteed by the Skill.

Risk disclosure reduces surprise; it does not remove risk. Automatic submission and response capture may still be interpreted under applicable service terms or trigger abuse-prevention systems.

See [docs/privacy.md](docs/privacy.md) and [SECURITY.md](SECURITY.md).

## Local verification

The project has no npm dependencies:

```bash
npm test
npm run doctor
npm run validate
```

The verification suite covers Doctor states, portable copied installation, Packet/Result validation, secret rejection, hash binding, model evidence, privacy fields, receipt completion, and the architecture asset.

## Repository layout

```text
.
├── .codex-plugin/plugin.json         # Plugin distribution manifest
├── assets/                           # English and Chinese architecture images
├── docs/                             # Installation, first-run, privacy, and design docs
├── scripts/verify.mjs                # Portable package verification
├── skills/codex-bridge-chatgpt/
│   ├── SKILL.md                      # Canonical workflow entrypoint
│   ├── agents/openai.yaml            # Codex interface metadata
│   ├── references/                   # Conditional workflow contracts
│   └── scripts/                      # Doctor, consent state, and handoff validator
└── tests/                            # Unit, contract, portability, and E2E artifacts
```

## Limitations

- V0.2 requires the supported ChatGPT desktop App workflow; it is not a generic CLI bridge.
- Login, CAPTCHA, two-factor authentication, permissions, and model selection remain human actions.
- Visible model UI is auditable evidence, not cryptographic remote-model attestation.
- ChatGPT page changes can make visible Send or Copy controls uncertain; the Skill stops without DOM response extraction or automatic retry.
- Private repository evidence may require explicit confirmation before transmission.
- A valid Result can still be wrong; local verification remains mandatory.

## Development and contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing workflow behavior. Preserve the central boundary: ChatGPT proposes; Codex verifies, edits, and tests locally.

For model-family terminology, see the [official OpenAI model guidance](https://developers.openai.com/api/docs/guides/latest-model).

## License

[MIT](LICENSE)
