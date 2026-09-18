# AGENTS.md

## Purpose

This repository contains one Plugin-ready Codex Skill for handing bounded reasoning work to ChatGPT in the Codex in-app Browser.

## Boundaries

- Treat local repository contents as private by default. Send only the minimum sanitized packet required for the task.
- Never include credentials, tokens, private keys, personal data, raw environment files, or unrelated source code in a browser prompt.
- ChatGPT proposes; Codex verifies against the live repository, edits, and tests.
- Do not claim a ChatGPT account tier or model unless the visible page proves it for the current run.
- Do not install global dependencies. Validation must use the bundled Node.js runtime or the system `node` command.

## Structure

- `.codex-plugin/plugin.json`: Plugin distribution metadata.
- `skills/codex-bridge-chatgpt/SKILL.md`: concise routing and workflow.
- `skills/codex-bridge-chatgpt/references/`: Doctor, browser, packet, result, and receipt contracts.
- `skills/codex-bridge-chatgpt/scripts/`: deterministic local Doctor and validators.
- `tests/`: Node built-in tests and sanitized fixtures.
- `assets/`: README and Plugin presentation assets.
- `docs/`: installation, first-run, privacy, troubleshooting, design, and plans.
- `docs/superpowers/specs/`: approved design record.

## Verification

Run:

```bash
node --test tests/*.test.mjs
npm run doctor
npm run validate
```

Before any commit, scan the diff for secrets. Never push or publish without explicit user approval.
