# Changelog

## 0.2.0 - 2026-09-01

- Added versioned, persistent user consent before any automatic ChatGPT browser action.
- Marked automatic web handoff as Unofficial Experimental with explicit non-zero account and policy risk.
- Restricted each invocation to one Packet, one visible Send activation, and one visible copy-response action.
- Removed DOM response extraction, automatic repair retries, model fallback, and quota-exhaustion triggers.
- Added fail-closed blockers for login, CAPTCHA, rate limits, unusual activity, account restrictions, permissions, ambiguous controls, and selector drift.
- Kept receipts redacted by default and reinforced that imported ChatGPT output is untrusted.
- Added bilingual first-run, revocation, privacy, troubleshooting, and security guidance.

## 0.1.2 - 2026-08-30

- Forced canonical LF text checkouts so SHA-256 evidence remains stable on Windows.

## 0.1.1 - 2026-08-30

- Made the npm test command portable across POSIX shells and Windows PowerShell.

## 0.1.0 - 2026-08-30

- Added the `codex-bridge-chatgpt` Skill and Plugin-ready package.
- Added automatic local Doctor and guided desktop Browser preflight.
- Added bounded Context Packet and structured Reasoning Result contracts.
- Added local adoption gate, privacy checks, artifact hashes, and complete run receipts.
- Added Mac and Windows CI, installation guides, security policy, and architecture documentation.
- Added English-first and Simplified Chinese README documentation with localized architecture diagrams.
