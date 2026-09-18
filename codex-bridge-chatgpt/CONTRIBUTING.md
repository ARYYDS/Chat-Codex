# Contributing

## Scope

Contributions should preserve the core boundary: ChatGPT proposes; Codex verifies, edits, and tests locally.

## Development

Node.js 18 or newer is required. The repository has no npm dependencies.

```bash
npm test
npm run doctor
npm run validate
```

Before opening a pull request:

1. Add a failing test for behavior changes.
2. Keep `SKILL.md` concise and move conditional detail into `references/`.
3. Preserve Mac and Windows path portability.
4. Scan changes for credentials and private repository content.
5. Update `CHANGELOG.md` for user-visible behavior.
6. Regenerate the README architecture image when the workflow changes.

Do not add API keys, external npm dependencies, background services, account bypasses, or automatic execution of ChatGPT output.
