# Security Policy

## Supported Version

Security fixes are provided for the latest tagged release.

## Report a Vulnerability

Use GitHub private vulnerability reporting for `anightmonarch/codex-bridge-chatgpt`. Do not open a public issue containing credentials, private repository content, browser session data, or an exploitable proof of concept.

Include the affected version, operating system, Codex surface, expected trust boundary, observed behavior, and a minimized reproduction without secrets.

## Security Boundary

This project does not authenticate users, store passwords, bypass account entitlements, attest remote model identity, or grant ChatGPT repository execution authority.

Automatic ChatGPT web control is Unofficial Experimental. It requires explicit versioned consent and carries non-zero account and policy risk. Consent does not guarantee compliance, account safety, model availability, or permanent quota separation.

The runtime contract uses visible controls only. It forbids private ChatGPT endpoints, network replay, cookies, local/session storage, hidden authentication data, DOM response extraction, automatic resubmission, background/headless execution, and bypassing login, CAPTCHA, rate limits, permissions, or safety controls. Imported output is untrusted, and ordinary receipts are redacted.
